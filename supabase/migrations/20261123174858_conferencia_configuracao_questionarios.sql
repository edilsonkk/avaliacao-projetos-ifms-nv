-- ==============================================================================
-- MIGRATION: 20261123174858_conferencia_configuracao_questionarios.sql
-- DESCRIÇÃO: três achados novos na conferência do Admin, sobre a CONFIGURAÇÃO de
--   questionários do evento — não sobre uma nota específica:
--
--     C15 (grave)   mais de um questionário técnico no evento
--     C16 (grave)   questionários técnicos com escalas diferentes
--     C17 (atenção) avaliador fixado num questionário técnico
--
--   Vêm de `fn_auditar_configuracao_questionarios`, agregada por UNION ALL ao fim de
--   `fn_auditar_notas` — o mesmo caminho por onde C13 e C14 chegam ao Painel de
--   Auditoria, que lê só essa função. Nenhuma mudança de front-end: o Painel renderiza
--   código novo sem conhecê-lo.
--
-- O PORQUÊ: a configuração combinada para a feira é um questionário técnico por evento,
--   numa escala só, com vínculo de questionário reservado aos votantes do voto popular.
--   Isso não era verificável em lugar nenhum: nada no banco reclamava de dois técnicos,
--   e C16 é o que mais pesa na premiação — notas de escalas diferentes entram na MESMA
--   média e no MESMO ranking, então a posição passa a depender da escala de quem avaliou.
--
-- POR QUE CONFERÊNCIA E NÃO CONSTRAINT: trocar o questionário de um evento é criar o
--   novo e apagar o antigo, e nesse intervalo existem dois técnicos legitimamente; uma
--   CHECK também reprovaria dado de produção já gravado. A conferência acusa sem travar.
--
-- POR QUE C17 É "ATENÇÃO" E NÃO RECUSA NA ESCRITA: a intenção original era fazer
--   `admin_vincular_questionario_avaliador` recusar questionário técnico. A investigação
--   mostrou que isso removeria recurso em uso: `fn_enviar_avaliacao` tem a regra
--   "avaliador vinculado a um questionário só usa aquele" valendo para QUALQUER
--   questionário, e é assim que uma feira com mais de um técnico diz qual banca usa qual.
--   `scripts/simular-feira.mjs` exercita esse caminho no grupo `tecnico-vinculado`, e o
--   seletor de GestorAvaliadores oferece os técnicos de propósito. Então o vínculo
--   técnico é configuração legítima: o achado INFORMA a coordenação (naquele evento o
--   avaliador só envia por aquele questionário, e é recusado em qualquer outro), em vez
--   de proibir.
--
-- IDEMPOTENTE: só CREATE OR REPLACE FUNCTION, REVOKE/GRANT e COMMENT.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- A conferência da configuração
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auditar_configuracao_questionarios(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(severidade text, codigo text, titulo text, id_projeto uuid, codigo_projeto text,
               id_avaliacao uuid, esperado text, encontrado text, detalhe text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id_evento uuid := coalesce(p_id_evento, public.evento_ativo_id());
BEGIN
  -- Mesma postura de fn_auditar_notas: a conferência é do Admin. (Diferente de
  -- fn_auditar_voto_popular, que hoje não tem essa trava — ver ADR 0020.)
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: a conferência de notas é restrita a administradores.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH tec AS (
    SELECT q.id_questionario, q.titulo AS titulo_quest, q.escala_minima, q.escala_maxima
    FROM public.questionarios q
    WHERE q.id_evento = v_id_evento
      AND NOT coalesce(q.is_voto_popular, false)
  ),
  escalas AS (
    SELECT DISTINCT t.escala_minima, t.escala_maxima FROM tec t
  )

  -- C15: a feira combinou um questionário técnico por evento
  SELECT 'grave'::text, 'C15'::text, 'Mais de um questionário técnico no evento'::text,
         NULL::uuid, NULL::text, NULL::uuid,
         '1 questionário técnico'::text,
         ((SELECT count(*) FROM tec) || ' questionários técnicos')::text,
         ('Com mais de um questionário técnico, o projeto fica preso ao primeiro que o avaliar '
          || '(trava do questionário) e avaliadores de banca diferente podem não conseguir avaliar '
          || 'o mesmo projeto. Técnicos no evento: '
          || (SELECT string_agg(t.titulo_quest, ', ' ORDER BY t.titulo_quest) FROM tec t))::text
  WHERE (SELECT count(*) FROM tec) > 1

  UNION ALL
  -- C16: escala única entre os técnicos, senão a posição depende de quem avaliou
  SELECT 'grave'::text, 'C16'::text, 'Questionários técnicos com escalas diferentes'::text,
         NULL::uuid, NULL::text, NULL::uuid,
         'uma escala só entre os questionários técnicos'::text,
         -- trim_scale: as colunas são numeric(5,2), então 0 e 10 sairiam '0.00 a 10.00'
         -- no Painel. A ordem é fixada para o texto não variar entre execuções.
         (SELECT string_agg(trim_scale(e.escala_minima) || ' a ' || trim_scale(e.escala_maxima), '; '
                            ORDER BY e.escala_minima, e.escala_maxima)
            FROM escalas e)::text,
         ('Notas de escalas diferentes entram na mesma média e no mesmo ranking: a posição do '
          || 'projeto passa a depender da escala de quem o avaliou, não do projeto.')::text
  WHERE (SELECT count(*) FROM escalas) > 1

  UNION ALL
  -- C17: vínculo técnico — legítimo, mas restringe o avaliador a um questionário só
  SELECT 'atencao'::text, 'C17'::text, 'Avaliador vinculado a questionário técnico'::text,
         NULL::uuid, NULL::text, NULL::uuid,
         'vínculo de questionário reservado aos votantes do voto popular'::text,
         ('vinculado a ' || t.titulo_quest)::text,
         format('%s só consegue enviar nota pelo questionário %s: fn_enviar_avaliacao recusa '
             || 'qualquer outro. O vínculo é legítimo quando a feira usa mais de um questionário '
             || 'técnico; na configuração de um técnico só, deixe o vínculo vazio e o avaliador '
             || 'usa o questionário do projeto.', u.nome, t.titulo_quest)::text
  FROM public.avaliadores_evento ae
  JOIN tec t ON t.id_questionario = ae.id_questionario
  JOIN public.usuarios u ON u.id_usuario = ae.id_usuario
  WHERE ae.id_evento = v_id_evento;
END $function$;

REVOKE ALL ON FUNCTION public.fn_auditar_configuracao_questionarios(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_auditar_configuracao_questionarios(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_auditar_configuracao_questionarios(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_auditar_configuracao_questionarios(uuid) IS
  'Achados de configuração de questionários do evento (C15, C16 e C17): mais de um questionário técnico, escalas divergentes entre eles e avaliador fixado num questionário técnico. Só Admin.';


-- ------------------------------------------------------------------------------
-- fn_auditar_notas: a mesma função de antes, com o UNION ALL dos achados novos no fim.
-- Nada mais mudou — o diff contra 20261111070000 é só o bloco final.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auditar_notas(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(severidade text, codigo text, titulo text, id_projeto uuid, codigo_projeto text, id_avaliacao uuid, esperado text, encontrado text, detalhe text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
           coalesce(p.ajuste_media, 0) AS ajuste_media,
           coalesce(p.cota_avaliacoes_customizada,
                    (SELECT coalesce(e.cota_avaliacoes_padrao, 3) FROM public.eventos e WHERE e.id_evento = v_id_evento)
           ) AS cota
    FROM public.projetos p
    WHERE p.id_evento = v_id_evento
  ),
  av AS (
    SELECT a.id_avaliacao, a.id_projeto, a.nota_final, a.id_usuario, a.created_at,
           a.ajuste_tipo, a.ajustada_em, a.ajustada_por, a.ajuste_motivo,
           pr.codigo_projeto, pr.id_questionario_fixado,
           coalesce(a.is_voto_popular, false) AS is_voto_popular,
           -- O fallback para o questionário fixado é da nota técnica. Num voto popular ele
           -- apontaria para o questionário técnico e C3a, C3c, C4 e C5 acusariam todas as notas.
           CASE WHEN a.is_voto_popular THEN a.id_questionario
                ELSE coalesce(a.id_questionario, pr.id_questionario_fixado) END AS id_quest
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
  SELECT CASE WHEN av.ajuste_tipo = 'nota_arbitrada' THEN 'informativo' ELSE 'grave' END,
         'C1',
         CASE WHEN av.ajuste_tipo = 'nota_arbitrada'
              THEN 'Nota arbitrada pelo Admin (não vem das respostas)'
              ELSE 'Nota final não confere com as notas por critério' END,
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         to_char(rc.nota_calculada, 'FM999990.00'), to_char(av.nota_final, 'FM999990.00'),
         CASE WHEN av.ajuste_tipo = 'nota_arbitrada'
              THEN format('Nota arbitrada em %s. Motivo: %s. As respostas dariam %s.',
                          to_char(av.ajustada_em, 'DD-MM-YYYY HH24:MI'),
                          coalesce(av.ajuste_motivo, 'não informado'), rc.nota_calculada)
              ELSE format('Σ(nota × peso) = %s · Σ(pesos) = %s · %s ÷ %s = %s, mas está gravado %s',
                          rc.soma_produtos, rc.soma_pesos, rc.soma_produtos, rc.soma_pesos,
                          rc.nota_calculada, av.nota_final) END
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
  JOIN LATERAL (SELECT count(*) AS qtd FROM av
                WHERE av.id_projeto = pr.id_projeto AND NOT av.is_voto_popular) c ON true
  WHERE c.qtd > pr.cota

  UNION ALL
  -- C7a: avaliação ativa de projeto fora da competição
  SELECT 'atencao', 'C7', 'Projeto fora da competição com avaliação ativa',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         'nenhuma avaliação', c.qtd::text || ' avaliações',
         'O projeto não entra no ranking, mas as notas continuam gravadas.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av
                WHERE av.id_projeto = pr.id_projeto AND NOT av.is_voto_popular) c ON true
  WHERE pr.is_fora_da_competicao AND c.qtd > 0

  UNION ALL
  -- C7b: avaliação ativa de projeto sem check-in
  SELECT 'atencao', 'C7', 'Projeto sem check-in com avaliação ativa',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         'check-in feito antes da avaliação', 'sem check-in',
         'fn_enviar_avaliacao exige check-in: uma avaliação assim entrou por outro caminho.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av
                WHERE av.id_projeto = pr.id_projeto AND NOT av.is_voto_popular) c ON true
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
    AND NOT av.is_voto_popular
    AND av.id_quest IS DISTINCT FROM av.id_questionario_fixado
    -- Só é achado quando o evento trava o questionário no primeiro avaliador: com a trava
    -- desligada, questionário diferente é a regra do evento, não um erro.
    AND coalesce((SELECT e.fixar_questionario_primeira_avaliacao FROM public.eventos e
                   WHERE e.id_evento = v_id_evento), true)

  UNION ALL
  -- C9: a mesma média com números diferentes em telas diferentes
  SELECT 'grave', 'C9', 'Média diferente entre a Classificação e os Relatórios',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         to_char(direto.media, 'FM999990.00'),
         format('ranking %s · relatório %s',
                coalesce(to_char(rk.media_final, 'FM999990.00'), '—'),
                coalesce(to_char(rel.media_final, 'FM999990.00'), '—')),
         'As telas calculam a média em lugares diferentes: divergência aqui é erro de uma das fontes.'
  FROM proj pr
  JOIN LATERAL (SELECT round(avg(av.nota_final), 2) + pr.ajuste_media AS media, count(*) AS qtd
                FROM av WHERE av.id_projeto = pr.id_projeto AND NOT av.is_voto_popular) direto ON true
  LEFT JOIN public.view_ranking_top3 rk ON rk.id_projeto = pr.id_projeto
  LEFT JOIN public.fn_relatorio_projetos_completo(v_id_evento) rel ON rel.id_projeto = pr.id_projeto
  WHERE direto.qtd > 0
    AND NOT pr.is_fora_da_competicao
    AND (rk.media_final IS DISTINCT FROM direto.media OR rel.media_final IS DISTINCT FROM direto.media)

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
    )

  UNION ALL
  -- C12a: avaliação ajustada à mão pelo Admin (nunca é erro: é a lista que a
  --       comissão confere antes de homologar)
  SELECT 'informativo', 'C12',
         CASE av.ajuste_tipo
           WHEN 'respostas_corrigidas' THEN 'Notas por critério corrigidas pelo Admin'
           WHEN 'nota_arbitrada'       THEN 'Nota final arbitrada pelo Admin'
           WHEN 'lancada_pelo_admin'   THEN 'Avaliação lançada pelo Admin'
           ELSE 'Avaliação ajustada pelo Admin'
         END,
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         '—', to_char(av.nota_final, 'FM999990.00'),
         format('Em %s, por %s. Motivo: %s',
                to_char(av.ajustada_em, 'DD-MM-YYYY HH24:MI'),
                coalesce((SELECT u.nome FROM public.usuarios u WHERE u.id_usuario = av.ajustada_por), 'Admin'),
                coalesce(av.ajuste_motivo, 'não informado'))
  FROM av
  WHERE av.ajuste_tipo IS NOT NULL

  UNION ALL
  -- C12b: média do projeto ajustada por decisão de comissão
  SELECT 'informativo', 'C12', 'Média do projeto ajustada por decisão de comissão',
         p.id_projeto, p.codigo_projeto::text, NULL::uuid,
         to_char(media.valor, 'FM999990.00'),
         to_char(media.valor + p.ajuste_media, 'FM999990.00'),
         format('Ajuste de %s ponto(s) em %s, por %s. Motivo: %s',
                to_char(p.ajuste_media, 'FM999990.00'),
                to_char(p.ajuste_media_em, 'DD-MM-YYYY HH24:MI'),
                coalesce((SELECT u.nome FROM public.usuarios u WHERE u.id_usuario = p.ajuste_media_por), 'Admin'),
                coalesce(p.ajuste_media_motivo, 'não informado'))
  FROM public.projetos p
  JOIN LATERAL (SELECT coalesce(round(avg(a.nota_final), 2), 0) AS valor
                FROM public.avaliacoes a
                WHERE a.id_projeto = p.id_projeto
                  AND (a.status IS NULL OR a.status <> 'CANCELADA')
                  AND NOT a.is_voto_popular) media ON true
  WHERE p.id_evento = v_id_evento AND p.ajuste_media <> 0

  UNION ALL
  -- C13 e C14: achados próprios do voto popular. Ficam aqui porque o Painel de
  -- Auditoria e o memorial do projeto leem só fn_auditar_notas.
  SELECT vp.severidade, vp.codigo, vp.titulo, vp.id_projeto, vp.codigo_projeto,
         vp.id_avaliacao, vp.esperado, vp.encontrado, vp.detalhe
  FROM public.fn_auditar_voto_popular(v_id_evento) vp
  UNION ALL
  -- C15, C16 e C17: configuração de questionários do evento. Ficam agregados aqui pelo
  -- mesmo motivo de C13 e C14: o Painel de Auditoria lê só fn_auditar_notas.
  SELECT cq.severidade, cq.codigo, cq.titulo, cq.id_projeto, cq.codigo_projeto,
         cq.id_avaliacao, cq.esperado, cq.encontrado, cq.detalhe
  FROM public.fn_auditar_configuracao_questionarios(v_id_evento) cq;
END $function$;

COMMENT ON FUNCTION public.fn_auditar_notas(uuid) IS
  'Conferência de notas do evento: recalcula a nota final a partir das respostas e lista o que não fecha. Agrega os achados do voto popular (C13, C14) e os de configuração de questionários (C15, C16, C17). Só Admin.';
