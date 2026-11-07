-- ==============================================================================
-- MIGRATION: 20261106020000_verificacao_de_notas.sql
-- DESCRIÇÃO: fn_auditar_notas(), a conferência que recalcula tudo e aponta o que
--   não fecha. É o que responde "as notas estão certas?" sem abrir o banco.
--   * C1  nota_final ≠ Σ(nota × peso) / Σ(peso) recalculado das respostas
--   * C2  avaliação ativa sem nenhuma resposta gravada
--   * C3  respostas faltando, repetidas ou de pergunta de outro questionário
--   * C4  nota por critério fora da escala do questionário
--   * C5  nota final fora da escala
--   * C6  projeto com mais avaliações ativas que a cota
--   * C7  avaliação ativa de projeto fora da competição ou sem check-in
--   * C8  avaliação com questionário diferente do fixado no projeto
--   * C9  a mesma média dando números diferentes entre ranking e relatório
--   * C10 escrita de nota que não passou por RPC (origem 'direto' no log)
--   * C11 peso de pergunta alterado depois da primeira avaliação
--   A fórmula de C1 é a mesma de fn_enviar_avaliacao: se as duas divergirem, é
--   esta função que está errada, e o teste 27 cobre isso.
-- FRONT-END: compatível com a versão anterior (função nova).
-- PRÉ-REQUISITOS: public.is_admin(), public.evento_ativo_id(),
--   public.log_auditoria (20261106010000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_auditar_notas(p_id_evento uuid DEFAULT NULL)
  RETURNS TABLE (
    severidade     text,
    codigo         text,
    titulo         text,
    id_projeto     uuid,
    codigo_projeto text,
    id_avaliacao   uuid,
    esperado       text,
    encontrado     text,
    detalhe        text
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id_evento uuid := coalesce(p_id_evento, public.evento_ativo_id());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: a conferência de notas é restrita a administradores.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH proj AS (
    SELECT p.id_projeto, p.codigo_projeto::text AS codigo_projeto, p.titulo, p.id_questionario_fixado,
           p.is_check_in_realizado, p.is_fora_da_competicao,
           coalesce(p.cota_avaliacoes_customizada,
                    (SELECT coalesce(e.cota_avaliacoes_padrao, 3) FROM public.eventos e WHERE e.id_evento = v_id_evento)
           ) AS cota
    FROM public.projetos p
    WHERE p.id_evento = v_id_evento
  ),
  av AS (
    SELECT a.id_avaliacao, a.id_projeto, a.nota_final, a.id_usuario, a.created_at,
           pr.codigo_projeto, pr.id_questionario_fixado,
           coalesce(a.id_questionario, pr.id_questionario_fixado) AS id_quest
    FROM public.avaliacoes a
    JOIN proj pr ON pr.id_projeto = a.id_projeto
    WHERE a.status IS NULL OR a.status <> 'CANCELADA'
  ),
  escala AS (
    SELECT q.id_questionario, q.escala_minima, q.escala_maxima,
           (SELECT count(*) FROM public.perguntas_questionario pq WHERE pq.id_questionario = q.id_questionario) AS qtd_perguntas
    FROM public.questionarios q
  ),
  recalculo AS (
    SELECT r.id_avaliacao,
           round(sum(r.nota_atribuida * pq.peso_calculo) / nullif(sum(pq.peso_calculo), 0), 2) AS nota_calculada,
           sum(r.nota_atribuida * pq.peso_calculo) AS soma_produtos,
           sum(pq.peso_calculo) AS soma_pesos
    FROM public.respostas_avaliacao r
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE pq.peso_calculo > 0
    GROUP BY r.id_avaliacao
  )

  -- C1: a conta não fecha
  SELECT 'grave', 'C1', 'Nota final não confere com as notas por critério',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         to_char(rc.nota_calculada, 'FM999990.00'), to_char(av.nota_final, 'FM999990.00'),
         format('Σ(nota × peso) = %s · Σ(pesos) = %s · %s ÷ %s = %s, mas está gravado %s',
                rc.soma_produtos, rc.soma_pesos, rc.soma_produtos, rc.soma_pesos,
                rc.nota_calculada, av.nota_final)
  FROM av JOIN recalculo rc ON rc.id_avaliacao = av.id_avaliacao
  WHERE av.nota_final IS DISTINCT FROM rc.nota_calculada

  UNION ALL
  -- C2: avaliação ativa sem resposta nenhuma
  SELECT 'grave', 'C2', 'Avaliação ativa sem notas por critério',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         'uma resposta por pergunta do questionário', 'nenhuma resposta gravada',
         'Sem as respostas não há como refazer a conta desta nota.'
  FROM av
  WHERE NOT EXISTS (SELECT 1 FROM public.respostas_avaliacao r WHERE r.id_avaliacao = av.id_avaliacao)

  UNION ALL
  -- C3a: número de respostas diferente do número de perguntas
  SELECT 'grave', 'C3', 'Quantidade de respostas diferente do questionário',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         e.qtd_perguntas::text || ' respostas', cnt.qtd::text || ' respostas',
         'O questionário tem outra quantidade de perguntas do que o que foi respondido.'
  FROM av
  JOIN escala e ON e.id_questionario = av.id_quest
  JOIN LATERAL (SELECT count(*) AS qtd FROM public.respostas_avaliacao r WHERE r.id_avaliacao = av.id_avaliacao) cnt ON true
  WHERE cnt.qtd > 0 AND cnt.qtd <> e.qtd_perguntas

  UNION ALL
  -- C3b: pergunta respondida mais de uma vez
  SELECT 'grave', 'C3', 'Pergunta respondida mais de uma vez',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         'uma resposta por pergunta', d.qtd::text || ' respostas para a mesma pergunta',
         'Repetir uma pergunta muda o peso dela na média.'
  FROM av
  JOIN LATERAL (
    SELECT r.id_pergunta, count(*) AS qtd
    FROM public.respostas_avaliacao r
    WHERE r.id_avaliacao = av.id_avaliacao
    GROUP BY r.id_pergunta HAVING count(*) > 1
    LIMIT 1
  ) d ON true

  UNION ALL
  -- C3c: resposta de pergunta que não é do questionário da avaliação
  SELECT 'grave', 'C3', 'Resposta de pergunta de outro questionário',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         'perguntas do questionário da avaliação', 'pergunta de outro questionário',
         'A nota foi composta com critério que não pertence ao questionário usado.'
  FROM av
  WHERE EXISTS (
    SELECT 1 FROM public.respostas_avaliacao r
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE r.id_avaliacao = av.id_avaliacao
      AND pq.id_questionario IS DISTINCT FROM av.id_quest
  )

  UNION ALL
  -- C4: nota por critério fora da escala
  SELECT 'grave', 'C4', 'Nota por critério fora da escala',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         format('entre %s e %s', e.escala_minima, e.escala_maxima),
         to_char(r.nota_atribuida, 'FM999990.00'),
         'Uma nota fora da escala do questionário distorce a média.'
  FROM av
  JOIN escala e ON e.id_questionario = av.id_quest
  JOIN public.respostas_avaliacao r ON r.id_avaliacao = av.id_avaliacao
  WHERE r.nota_atribuida < e.escala_minima OR r.nota_atribuida > e.escala_maxima

  UNION ALL
  -- C5: nota final fora da escala
  SELECT 'grave', 'C5', 'Nota final fora da escala',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         format('entre %s e %s', e.escala_minima, e.escala_maxima),
         to_char(av.nota_final, 'FM999990.00'),
         'A média ponderada nunca pode cair fora da escala do questionário.'
  FROM av JOIN escala e ON e.id_questionario = av.id_quest
  WHERE av.nota_final IS NOT NULL
    AND (av.nota_final < e.escala_minima OR av.nota_final > e.escala_maxima)

  UNION ALL
  -- C6: mais avaliações ativas do que a cota
  SELECT 'atencao', 'C6', 'Projeto com mais avaliações que a cota',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         pr.cota::text || ' avaliações', c.qtd::text || ' avaliações',
         'Avaliação além da cota entra na média e desequilibra a comparação com os outros projetos.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av WHERE av.id_projeto = pr.id_projeto) c ON true
  WHERE c.qtd > pr.cota

  UNION ALL
  -- C7a: avaliação ativa de projeto fora da competição
  SELECT 'atencao', 'C7', 'Projeto fora da competição com avaliação ativa',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         'nenhuma avaliação', c.qtd::text || ' avaliações',
         'O projeto não entra no ranking, mas as notas continuam gravadas.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av WHERE av.id_projeto = pr.id_projeto) c ON true
  WHERE pr.is_fora_da_competicao AND c.qtd > 0

  UNION ALL
  -- C7b: avaliação ativa de projeto sem check-in
  SELECT 'atencao', 'C7', 'Projeto sem check-in com avaliação ativa',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         'check-in feito antes da avaliação', 'sem check-in',
         'fn_enviar_avaliacao exige check-in: uma avaliação assim entrou por outro caminho.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av WHERE av.id_projeto = pr.id_projeto) c ON true
  WHERE NOT coalesce(pr.is_check_in_realizado, false) AND c.qtd > 0

  UNION ALL
  -- C8: questionário diferente do fixado no projeto
  SELECT 'grave', 'C8', 'Avaliação com questionário diferente do fixado',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         coalesce(qf.titulo, 'questionário fixado no projeto'),
         coalesce(qa.titulo, 'outro questionário'),
         'Projetos da mesma modalidade precisam ser comparados pelo mesmo questionário.'
  FROM av
  LEFT JOIN public.questionarios qf ON qf.id_questionario = av.id_questionario_fixado
  LEFT JOIN public.questionarios qa ON qa.id_questionario = av.id_quest
  WHERE av.id_questionario_fixado IS NOT NULL
    AND av.id_quest IS DISTINCT FROM av.id_questionario_fixado

  UNION ALL
  -- C9: a mesma média com números diferentes em telas diferentes
  SELECT 'grave', 'C9', 'Média diferente entre a Classificação e os Relatórios',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         to_char(direto.media, 'FM999990.00'),
         format('ranking %s · relatório %s',
                coalesce(to_char(rk.media_geral, 'FM999990.00'), '—'),
                coalesce(to_char(rel.media_geral, 'FM999990.00'), '—')),
         'As telas calculam a média em lugares diferentes: divergência aqui é erro de uma das fontes.'
  FROM proj pr
  JOIN LATERAL (SELECT round(avg(av.nota_final), 2) AS media, count(*) AS qtd
                FROM av WHERE av.id_projeto = pr.id_projeto) direto ON true
  LEFT JOIN public.view_ranking_top3 rk ON rk.id_projeto = pr.id_projeto
  LEFT JOIN public.fn_relatorio_projetos_completo(v_id_evento) rel ON rel.id_projeto = pr.id_projeto
  WHERE direto.qtd > 0
    AND NOT pr.is_fora_da_competicao
    AND (rk.media_geral IS DISTINCT FROM direto.media OR rel.media_geral IS DISTINCT FROM direto.media)

  UNION ALL
  -- C10: escrita de nota que não passou por RPC nenhuma
  SELECT 'grave', 'C10', 'Nota alterada fora do fluxo do sistema',
         l.id_projeto, coalesce(pr.codigo_projeto, l.id_registro), l.id_avaliacao,
         'alteração por RPC (fn_enviar_avaliacao, excluir_avaliacao...)',
         format('%s direto em %s', l.operacao, l.tabela),
         format('Em %s, por %s. Antes: %s · Depois: %s',
                to_char(l.criado_em, 'DD-MM-YYYY HH24:MI'),
                coalesce(l.ator_papel, 'origem não identificada'),
                coalesce(l.dados_antes ->> 'nota_final', l.dados_antes ->> 'nota_atribuida', '—'),
                coalesce(l.dados_depois ->> 'nota_final', l.dados_depois ->> 'nota_atribuida', '—'))
  FROM public.log_auditoria l
  LEFT JOIN proj pr ON pr.id_projeto = l.id_projeto
  WHERE l.origem = 'direto'
    AND l.tabela IN ('avaliacoes', 'respostas_avaliacao', 'perguntas_questionario')
    AND l.operacao IN ('UPDATE', 'DELETE')
    AND (l.id_evento = v_id_evento OR l.id_evento IS NULL)

  UNION ALL
  -- C11: peso alterado depois de o questionário já ter sido usado
  SELECT 'atencao', 'C11', 'Peso de pergunta alterado depois da primeira avaliação',
         NULL::uuid, NULL::text, NULL::uuid,
         coalesce(l.dados_antes ->> 'peso_calculo', '—'),
         coalesce(l.dados_depois ->> 'peso_calculo', '—'),
         format('Pergunta "%s" em %s: as notas gravadas antes disso usaram o peso antigo.',
                coalesce(l.dados_depois ->> 'texto_pergunta', '?'),
                to_char(l.criado_em, 'DD-MM-YYYY HH24:MI'))
  FROM public.log_auditoria l
  WHERE l.acao = 'peso_calculo_alterado'
    AND l.id_evento = v_id_evento
    AND EXISTS (
      SELECT 1 FROM av
      JOIN public.respostas_avaliacao r ON r.id_avaliacao = av.id_avaliacao
      WHERE r.id_pergunta = (l.dados_depois ->> 'id_pergunta')::uuid
        AND av.created_at < l.criado_em
    );
END $$;

ALTER FUNCTION public.fn_auditar_notas(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_auditar_notas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditar_notas(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_auditar_notas(uuid) IS
  'Conferência de notas do evento: recalcula a nota final a partir das respostas e lista o que não fecha. Só Admin.';

COMMIT;
