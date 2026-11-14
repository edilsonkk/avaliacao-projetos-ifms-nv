-- ==============================================================================
-- MIGRATION: 20261111070000_voto_popular_conferencia.sql
-- DESCRIÇÃO: voto popular no memorial e na conferência de notas.
--   * fn_memorial_avaliacao: informa is_voto_popular e para de resolver o
--     questionário pelo fixado no projeto quando a nota é de voto popular (daria a
--     escala errada no memorial).
--   * fn_memorial_projeto: a média, as notas e a quarentena passam a ser só de nota
--     técnica, e os votos entram em lista própria (avaliacoes_voto_popular), com
--     total e média à parte.
--   * fn_auditar_notas: a CTE `av` expõe o tipo e resolve o questionário sem o
--     fallback para o fixado quando é voto popular — sem isso, C3a, C3c, C4 e C5
--     acusariam TODA avaliação de voto popular (número de perguntas e escala do
--     questionário técnico). C6 (cota), C7, C9 (média do ranking x relatório) e
--     C12b passam a contar só nota técnica; C8 ignora o voto popular, que usa outro
--     questionário por desenho. C1, C2, C3b, C10 e C11 continuam valendo para o
--     voto popular: é nota gravada e a conta precisa fechar igual.
--   * fn_auditar_voto_popular: dois achados novos — C13, a classificação gravada
--     divergir da marca do questionário (só aconteceria por escrita fora do
--     trigger), e C14, votante com nota entrando na média técnica.
-- FRONT-END: compatível com a versão anterior (chaves novas no jsonb; função nova).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- 1. Memorial de cada nota --------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_memorial_avaliacao(p_id_avaliacao uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: o memorial de cálculo é restrito a administradores.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id_avaliacao',    a.id_avaliacao,
    'codigo_projeto',  p.codigo_projeto,
    'titulo_projeto',  p.titulo,
    'avaliador',       jsonb_build_object('id_usuario', u.id_usuario, 'nome', u.nome, 'email', u.email),
    'status',          coalesce(a.status, 'CONCLUIDA'),
    'enviada_em',      a.tempo_submissao,
    'presenca_em',     a.tempo_presenca,
    'criada_em',       a.created_at,
    'parecer',         a.parecer_final,
    'is_voto_popular',  coalesce(a.is_voto_popular, false),
    'is_quarentena',   coalesce(a.is_quarentena, false),
    'cancelada_em',    a.cancelada_em,
    'cancelada_por',   (SELECT jsonb_build_object('id_usuario', c.id_usuario, 'nome', c.nome)
                          FROM public.usuarios c WHERE c.id_usuario = a.cancelada_por),
    'questionario',    jsonb_build_object(
                         'id_questionario', q.id_questionario,
                         'titulo',          q.titulo,
                         'escala_minima',   q.escala_minima,
                         'escala_maxima',   q.escala_maxima
                       ),
    'criterios',       coalesce(crit.lista, '[]'::jsonb),
    'soma_produtos',   crit.soma_produtos,
    'soma_pesos',      crit.soma_pesos,
    'nota_bruta',      crit.nota_bruta,
    'nota_arredondada',crit.nota_arredondada,
    'nota_gravada',    a.nota_final,
    'confere',         a.nota_final IS NOT DISTINCT FROM crit.nota_arredondada,
    'motivo_do_log',   (SELECT l.motivo FROM public.log_auditoria l
                         WHERE l.id_avaliacao = a.id_avaliacao AND l.motivo IS NOT NULL
                         ORDER BY l.id_log DESC LIMIT 1),
    -- Ajuste manual: é o que distingue nota arbitrada (legítima, com motivo) de
    -- nota que não fecha sem explicação nenhuma.
    'ajuste',          CASE WHEN a.ajuste_tipo IS NULL THEN NULL ELSE jsonb_build_object(
                         'tipo',   a.ajuste_tipo,
                         'em',     a.ajustada_em,
                         'motivo', a.ajuste_motivo,
                         'por',    (SELECT jsonb_build_object('id_usuario', aj.id_usuario, 'nome', aj.nome)
                                      FROM public.usuarios aj WHERE aj.id_usuario = a.ajustada_por)
                       ) END
  )
  INTO v_resultado
  FROM public.avaliacoes a
  JOIN public.projetos p  ON p.id_projeto = a.id_projeto
  LEFT JOIN public.usuarios u ON u.id_usuario = a.id_usuario
  LEFT JOIN public.questionarios q
    -- O fallback para o questionário fixado no projeto só vale para nota técnica: num voto
    -- popular ele apontaria para o questionário técnico e daria a escala errada.
    ON q.id_questionario = CASE WHEN a.is_voto_popular THEN a.id_questionario
                                ELSE coalesce(a.id_questionario, p.id_questionario_fixado) END
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(jsonb_build_object(
        'id_pergunta',    x.id_pergunta,
        'ordem',          x.ordem,
        'criterio',       x.texto_pergunta,
        'ajuda',          x.descricao_lembrete,
        'peso_calculo',   x.peso_calculo,
        'peso_desempate', x.peso_desempate,
        'nota',           x.nota_atribuida,
        'produto',        x.nota_atribuida * x.peso_calculo
      ) ORDER BY x.ordem, x.texto_pergunta) AS lista,
      sum(x.nota_atribuida * x.peso_calculo) FILTER (WHERE x.peso_calculo > 0)        AS soma_produtos,
      sum(x.peso_calculo) FILTER (WHERE x.peso_calculo > 0)                           AS soma_pesos,
      sum(x.nota_atribuida * x.peso_calculo) FILTER (WHERE x.peso_calculo > 0)
        / nullif(sum(x.peso_calculo) FILTER (WHERE x.peso_calculo > 0), 0)             AS nota_bruta,
      round(sum(x.nota_atribuida * x.peso_calculo) FILTER (WHERE x.peso_calculo > 0)
        / nullif(sum(x.peso_calculo) FILTER (WHERE x.peso_calculo > 0), 0), 2)         AS nota_arredondada
    FROM (
      SELECT pq.id_pergunta, pq.ordem, pq.texto_pergunta, pq.descricao_lembrete,
             pq.peso_calculo, pq.peso_desempate, r.nota_atribuida
      FROM public.respostas_avaliacao r
      JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
      WHERE r.id_avaliacao = a.id_avaliacao
    ) x
  ) crit ON true
  WHERE a.id_avaliacao = p_id_avaliacao;

  RETURN v_resultado;
END $function$;


-- 2. Memorial do projeto ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_memorial_projeto(p_id_projeto uuid, p_incluir_achados boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_resultado jsonb;
  v_id_evento uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: o memorial de cálculo é restrito a administradores.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.id_evento INTO v_id_evento FROM public.projetos p WHERE p.id_projeto = p_id_projeto;

  SELECT jsonb_build_object(
    'id_projeto',       p.id_projeto,
    'codigo_projeto',   p.codigo_projeto,
    'titulo',           p.titulo,
    'modalidade',       coalesce(m.nome_modalidade, 'Sem modalidade'),
    'area_tematica',    coalesce(ar.nome_area, 'Sem área temática'),
    'instituicao',      coalesce(inst.nome_exibicao, 'Não informada'),
    'estande',          p.estande,
    'check_in',         coalesce(p.is_check_in_realizado, false),
    'fora_da_competicao', coalesce(p.is_fora_da_competicao, false),
    'cota',             coalesce(p.cota_avaliacoes_customizada, coalesce(e.cota_avaliacoes_padrao, 3)),
    'questionario_fixado', (SELECT jsonb_build_object('id_questionario', q.id_questionario, 'titulo', q.titulo,
                                                      'escala_minima', q.escala_minima, 'escala_maxima', q.escala_maxima)
                              FROM public.questionarios q WHERE q.id_questionario = p.id_questionario_fixado),

    'avaliacoes_ativas', coalesce((
      SELECT jsonb_agg(public.fn_memorial_avaliacao(a.id_avaliacao) ORDER BY a.created_at)
      FROM public.avaliacoes a
      WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
        AND NOT a.is_voto_popular
    ), '[]'::jsonb),
    -- Voto popular em lista própria: não entra na média técnica nem na quarentena
    'avaliacoes_voto_popular', coalesce((
      SELECT jsonb_agg(public.fn_memorial_avaliacao(a.id_avaliacao) ORDER BY a.created_at)
      FROM public.avaliacoes a
      WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
        AND a.is_voto_popular
    ), '[]'::jsonb),
    'total_votos_populares', coalesce(votos.qtd, 0),
    'media_voto_popular', votos.media,
    'avaliacoes_canceladas', coalesce((
      SELECT jsonb_agg(public.fn_memorial_avaliacao(a.id_avaliacao) ORDER BY a.created_at)
      FROM public.avaliacoes a
      WHERE a.id_projeto = p.id_projeto AND a.status = 'CANCELADA'
    ), '[]'::jsonb),

    'total_avaliacoes',  ativas.qtd,
    'notas',             coalesce(ativas.notas, '[]'::jsonb),
    'media_geral',       ativas.media,
    'ajuste_media',      coalesce(p.ajuste_media, 0),
    'media_final',       CASE WHEN ativas.qtd > 0 THEN ativas.media + coalesce(p.ajuste_media, 0) END,
    'ajuste_media_em',   p.ajuste_media_em,
    'ajuste_media_motivo', p.ajuste_media_motivo,
    'ajuste_media_por',  (SELECT jsonb_build_object('id_usuario', c.id_usuario, 'nome', c.nome)
                            FROM public.usuarios c WHERE c.id_usuario = p.ajuste_media_por),
    'media_do_ranking',  rk.media_final,
    'posicao_no_ranking',rk.posicao,

    'desempate', jsonb_build_object(
      'chave', coalesce(to_jsonb(public.fn_chave_desempate(p.id_projeto)), '[]'::jsonb),
      'por_prioridade', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'prioridade', d.peso_desempate,
                 'ordem',      d.ordem,
                 'criterio',   d.texto_pergunta,
                 'media',      d.media
               ) ORDER BY d.peso_desempate, d.ordem)
        FROM (
          SELECT pq.peso_desempate, pq.ordem, pq.texto_pergunta,
                 round(avg(r.nota_atribuida), 2) AS media
          FROM public.avaliacoes a
          JOIN public.respostas_avaliacao r ON r.id_avaliacao = a.id_avaliacao
          JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
          WHERE a.id_projeto = p.id_projeto
            AND (a.status IS NULL OR a.status <> 'CANCELADA')
            AND NOT a.is_voto_popular
            AND pq.peso_desempate > 0
          GROUP BY pq.id_pergunta, pq.peso_desempate, pq.ordem, pq.texto_pergunta
        ) d
      ), '[]'::jsonb)
    ),

    'quarentena', jsonb_build_object(
      'pendente',      EXISTS (SELECT 1 FROM public.view_projetos_quarentena vq WHERE vq.id_projeto = p.id_projeto),
      'nota_minima',   ativas.nota_min,
      'nota_maxima',   ativas.nota_max,
      'divergencia',   round(ativas.nota_max - ativas.nota_min, 2),
      'limite',        2.5,
      'resolvida_em',  p.quarentena_resolvida_em,
      'resolvida_por', (SELECT jsonb_build_object('id_usuario', c.id_usuario, 'nome', c.nome)
                          FROM public.usuarios c WHERE c.id_usuario = p.quarentena_resolvida_por)
    ),

    -- A folha consolidada do evento passa p_incluir_achados = false e anexa os achados
    -- de uma única rodada de fn_auditar_notas: rodar a conferência inteira por projeto
    -- seria o mesmo trabalho repetido centenas de vezes.
    'achados', CASE WHEN NOT p_incluir_achados THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'severidade', f.severidade, 'codigo', f.codigo, 'titulo', f.titulo,
               'id_avaliacao', f.id_avaliacao, 'esperado', f.esperado,
               'encontrado', f.encontrado, 'detalhe', f.detalhe
             ) ORDER BY f.severidade, f.codigo)
      FROM public.fn_auditar_notas(v_id_evento) f
      WHERE f.id_projeto = p.id_projeto
    ), '[]'::jsonb) END,

    'trilha', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id_log', l.id_log, 'quando', l.criado_em, 'acao', l.acao,
               'operacao', l.operacao, 'tabela', l.tabela, 'origem', l.origem,
               'motivo', l.motivo, 'ator_papel', l.ator_papel,
               'ator', (SELECT at.nome FROM public.usuarios at WHERE at.id_usuario = l.ator_usuario),
               'campos_alterados', l.campos_alterados,
               'dados_antes', l.dados_antes, 'dados_depois', l.dados_depois
             ) ORDER BY l.id_log DESC)
      FROM public.log_auditoria l
      WHERE l.id_projeto = p.id_projeto
    ), '[]'::jsonb),

    'trilha_comeca_em', (SELECT min(l.criado_em) FROM public.log_auditoria l)
  )
  INTO v_resultado
  FROM public.projetos p
  LEFT JOIN public.eventos e        ON e.id_evento = p.id_evento
  LEFT JOIN public.modalidades m    ON m.id_modalidade = p.id_modalidade
  LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
  LEFT JOIN public.instituicoes inst  ON inst.id_instituicao = p.id_instituicao
  LEFT JOIN public.view_ranking_top3 rk ON rk.id_projeto = p.id_projeto
  LEFT JOIN LATERAL (
    SELECT count(*) AS qtd,
           round(avg(a.nota_final), 2) AS media,
           min(a.nota_final) AS nota_min,
           max(a.nota_final) AS nota_max,
           jsonb_agg(a.nota_final ORDER BY a.created_at) AS notas
    FROM public.avaliacoes a
    WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
      AND NOT a.is_voto_popular
  ) ativas ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS qtd, round(avg(a.nota_final), 2) AS media
    FROM public.avaliacoes a
    WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
      AND a.is_voto_popular
  ) votos ON true
  WHERE p.id_projeto = p_id_projeto;

  RETURN v_resultado;
END $function$;


-- 3. Conferência de notas --------------------------------------------------
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
  FROM public.fn_auditar_voto_popular(v_id_evento) vp;
END $function$;



-- ------------------------------------------------------------------------------
-- Conferência do voto popular: a denormalização não pode divergir da marca
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auditar_voto_popular(p_id_evento uuid DEFAULT NULL)
RETURNS TABLE(
  severidade text, codigo text, titulo text, id_projeto uuid, codigo_projeto text,
  id_avaliacao uuid, esperado text, encontrado text, detalhe text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ev AS (SELECT coalesce(p_id_evento, public.evento_ativo_id()) AS id_evento)
  SELECT 'grave'::text, 'C13'::text, 'Classificação de voto popular divergente do questionário'::text,
         p.id_projeto, p.codigo_projeto::text, a.id_avaliacao,
         CASE WHEN q.is_voto_popular THEN 'voto popular' ELSE 'nota técnica' END::text,
         CASE WHEN a.is_voto_popular THEN 'voto popular' ELSE 'nota técnica' END::text,
         'avaliacoes.is_voto_popular é cópia da marca do questionário, mantida por trigger. Divergência significa escrita que não passou pelo trigger.'::text
  FROM public.avaliacoes a
  JOIN public.projetos p ON p.id_projeto = a.id_projeto
  JOIN ev ON ev.id_evento = p.id_evento
  JOIN public.questionarios q ON q.id_questionario = a.id_questionario
  WHERE coalesce(a.is_voto_popular, false) IS DISTINCT FROM coalesce(q.is_voto_popular, false)

  UNION ALL
  SELECT 'atencao'::text, 'C14'::text, 'Avaliador de voto popular com nota técnica'::text,
         p.id_projeto, p.codigo_projeto::text, a.id_avaliacao,
         'nota pelo questionário vinculado'::text, 'nota técnica'::text,
         'O avaliador está vinculado a um questionário de voto popular, mas esta nota entrou na média técnica do projeto.'::text
  FROM public.avaliacoes a
  JOIN public.projetos p ON p.id_projeto = a.id_projeto
  JOIN ev ON ev.id_evento = p.id_evento
  WHERE (a.status IS NULL OR a.status <> 'CANCELADA')
    AND NOT coalesce(a.is_voto_popular, false)
    AND public.avaliador_e_voto_popular(a.id_usuario, p.id_evento);
$$;

COMMENT ON FUNCTION public.fn_auditar_voto_popular(uuid) IS
  'Achados próprios do voto popular (C13 e C14): a classificação gravada na avaliação divergir da marca do questionário, e votante com nota na média técnica.';

REVOKE ALL ON FUNCTION public.fn_auditar_voto_popular(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditar_voto_popular(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
