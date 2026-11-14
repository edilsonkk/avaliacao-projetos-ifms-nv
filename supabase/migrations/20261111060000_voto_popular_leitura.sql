-- ==============================================================================
-- MIGRATION: 20261111060000_voto_popular_leitura.sql
-- DESCRIÇÃO: voto popular na leitura (parte 3 de 3): relatórios, ranking e telão.
--   * Toda média, contagem e meta técnica passa a excluir o voto popular:
--     fn_relatorio_projetos_completo (que ganha três colunas no fim com os dados
--     do voto popular), fn_relatorio_avaliadores_completo (só nota técnica, já que
--     os votantes têm relatório próprio), fn_relatorio_ausencias_completo e
--     fn_relatorio_devolucoes_completo (situação atual do projeto),
--     fn_relatorio_instituicoes_completo, fn_chave_desempate, view_ranking_top3,
--     view_projetos_quarentena e view_projetos_pendentes_avaliacao.
--   * fn_telao_resumo: meta, realizadas, em andamento e conclusão só com nota
--     técnica, e três contadores novos do voto popular. Só agregados: o Telão é
--     público e segue sem nome, nota ou ranking (o teste 18_telao_test.sql exige
--     que o jsonb não contenha 'nota', 'media', 'titulo' nem 'email' — por isso as
--     chaves são votos_populares, projetos_votados e votantes_credenciados).
--   * fn_relatorio_voto_popular_completo: a fonte única do voto popular, com média
--     simples e bayesiana. Bayesiana = (v/(v+m))*R + (m/(v+m))*C, com R = média do
--     projeto, v = votos do projeto, C = média de todos os votos do evento e
--     m = votos por projeto votado (automático). Sem voto no evento, devolve vazio.
--   * admin_listar_questionarios_reaproveitaveis mostra a marca, para o Admin não
--     reaproveitar um questionário de voto popular como técnico sem perceber.
-- FRONT-END: compatível com a versão anterior (colunas novas só no fim; chaves
--   novas no jsonb do telão são ignoradas por quem não as lê). Mudança de
--   SIGNIFICADO: media_geral e total_avaliacoes passam a ser só de nota técnica.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- As duas trocam o RETURNS TABLE, então precisam de DROP antes do CREATE.
DROP FUNCTION IF EXISTS public.fn_relatorio_projetos_completo(uuid);
DROP FUNCTION IF EXISTS public.admin_listar_questionarios_reaproveitaveis(uuid);

-- 1. Projetos e médias (média técnica + colunas do voto popular) -------------
CREATE OR REPLACE FUNCTION public.fn_relatorio_projetos_completo(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id_projeto uuid, id_evento uuid, codigo_projeto text, titulo text, estande text, corredor text, modalidade text, area_conhecimento text, nome_instituicao text, id_instituicao uuid, is_check_in_realizado boolean, is_fora_da_competicao boolean, total_avaliacoes integer, media_geral numeric, notas numeric[], detalhes_avaliacoes jsonb, cota_avaliacoes integer, ajuste_media numeric, media_final numeric, tem_ajuste_manual boolean, total_votos_populares integer, media_voto_popular numeric, votos_populares jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH avaliacoes_validas AS (
    SELECT a.id_avaliacao, a.id_projeto, a.id_usuario, u.nome AS avaliador_nome,
      round(a.nota_final::numeric, 2) AS nota_final,
      coalesce(a.parecer_final, '') AS parecer,
      coalesce(a.tempo_submissao, a.created_at) AS data,
      a.ajuste_tipo, a.ajuste_motivo, a.is_voto_popular
    FROM public.avaliacoes a
    JOIN public.usuarios u ON u.id_usuario = a.id_usuario
    WHERE a.status IS NULL OR a.status <> 'CANCELADA'
  )
  SELECT p.id_projeto, p.id_evento, p.codigo_projeto::text, p.titulo::text, p.estande::text, p.corredor::text,
    coalesce(m.nome_modalidade, 'Sem modalidade')::text,
    coalesce(ar.nome_area, 'Sem área temática')::text,
    coalesce(inst.nome_exibicao, 'Não informada')::text,
    p.id_instituicao,
    coalesce(p.is_check_in_realizado, false),
    coalesce(p.is_fora_da_competicao, false),
    count(av.id_avaliacao) FILTER (WHERE NOT av.is_voto_popular)::int,
    coalesce(round(avg(av.nota_final) FILTER (WHERE NOT av.is_voto_popular), 2), 0.00),
    coalesce(array_agg(av.nota_final ORDER BY av.data DESC) FILTER (WHERE av.nota_final IS NOT NULL AND NOT av.is_voto_popular), '{}'::numeric[]),
    coalesce(jsonb_agg(jsonb_build_object(
      'id_avaliacao', av.id_avaliacao, 'id_usuario', av.id_usuario, 'avaliador_nome', av.avaliador_nome,
      'nota_final', av.nota_final, 'parecer', av.parecer, 'data', av.data,
      'ajuste_tipo', av.ajuste_tipo, 'ajuste_motivo', av.ajuste_motivo
    ) ORDER BY av.data DESC) FILTER (WHERE av.id_avaliacao IS NOT NULL AND NOT av.is_voto_popular), '[]'::jsonb),
    coalesce(p.cota_avaliacoes_customizada, ev.cota_avaliacoes_padrao, 3)::int,
    coalesce(p.ajuste_media, 0),
    coalesce(round(avg(av.nota_final) FILTER (WHERE NOT av.is_voto_popular), 2), 0.00) + coalesce(p.ajuste_media, 0),
    coalesce(p.ajuste_media, 0) <> 0 OR coalesce(bool_or(av.ajuste_tipo IS NOT NULL) FILTER (WHERE NOT av.is_voto_popular), false),
    count(av.id_avaliacao) FILTER (WHERE av.is_voto_popular)::int,
    round(avg(av.nota_final) FILTER (WHERE av.is_voto_popular), 2),
    coalesce(jsonb_agg(jsonb_build_object(
      'id_avaliacao', av.id_avaliacao, 'id_usuario', av.id_usuario, 'avaliador_nome', av.avaliador_nome,
      'nota_final', av.nota_final, 'parecer', av.parecer, 'data', av.data
    ) ORDER BY av.data DESC) FILTER (WHERE av.id_avaliacao IS NOT NULL AND av.is_voto_popular), '[]'::jsonb)
  FROM public.projetos p
  JOIN public.eventos ev ON ev.id_evento = p.id_evento
  LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
  LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
  LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
  LEFT JOIN avaliacoes_validas av ON av.id_projeto = p.id_projeto
  WHERE p.id_evento = p_id_evento
  GROUP BY p.id_projeto, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, ev.cota_avaliacoes_padrao
  ORDER BY p.codigo_projeto, p.id_projeto;
$function$;


-- 2. Avaliadores e notas: só nota técnica -----------------------------------
CREATE OR REPLACE FUNCTION public.fn_relatorio_avaliadores_completo(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id_usuario uuid, avaliador_nome text, avaliador_email text, total_avaliacoes integer, media_notas numeric, tempo_medio_segundos integer, avaliacoes jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH avaliacoes_enriquecidas AS (
    SELECT a.id_avaliacao, a.id_usuario, u.nome AS avaliador_nome, u.email AS avaliador_email,
      p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo AS projeto_titulo, p.estande AS projeto_estande,
      coalesce(m.nome_modalidade, 'Sem modalidade') AS projeto_modalidade,
      coalesce(ar.nome_area, 'Sem área temática') AS projeto_area,
      round(a.nota_final::numeric, 2) AS nota_final,
      coalesce(a.parecer_final, '') AS parecer_comentario,
      a.tempo_presenca,
      coalesce(a.tempo_submissao, a.created_at) AS tempo_submissao,
      a.created_at AS data_avaliacao,
      -- tempo_presenca é texto: só converte o que tem cara de data ISO (um valor ruim não derruba o relatório)
      CASE
        WHEN a.tempo_presenca ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
         AND coalesce(a.tempo_submissao, a.created_at) > a.tempo_presenca::timestamptz
        THEN extract(epoch FROM (coalesce(a.tempo_submissao, a.created_at) - a.tempo_presenca::timestamptz))::int
        ELSE 0
      END AS duracao_segundos
    FROM public.avaliacoes a
    JOIN public.usuarios u ON u.id_usuario = a.id_usuario
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    WHERE (a.status IS NULL OR a.status <> 'CANCELADA')
      AND NOT a.is_voto_popular
      AND p.id_evento = p_id_evento
  )
  SELECT ae.id_usuario, ae.avaliador_nome::text, ae.avaliador_email::text,
    count(ae.id_avaliacao)::int,
    coalesce(round(avg(ae.nota_final), 2), 0.00),
    coalesce(round(avg(ae.duracao_segundos) FILTER (WHERE ae.duracao_segundos > 0))::int, 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id_avaliacao', ae.id_avaliacao, 'id_projeto', ae.id_projeto, 'id_evento', ae.id_evento,
      'codigo_projeto', ae.codigo_projeto, 'projeto_titulo', ae.projeto_titulo, 'projeto_estande', ae.projeto_estande,
      'projeto_modalidade', ae.projeto_modalidade, 'projeto_area', ae.projeto_area, 'nota_final', ae.nota_final,
      'parecer_comentario', ae.parecer_comentario, 'tempo_presenca', ae.tempo_presenca,
      'tempo_submissao', ae.tempo_submissao, 'data_avaliacao', ae.data_avaliacao, 'duracao_segundos', ae.duracao_segundos
    ) ORDER BY ae.data_avaliacao DESC), '[]'::jsonb)
  FROM avaliacoes_enriquecidas ae
  GROUP BY ae.id_usuario, ae.avaliador_nome, ae.avaliador_email
  ORDER BY ae.avaliador_nome, ae.id_usuario;
$function$;


-- 3. Situação atual do projeto nas ausências e devoluções -------------------
CREATE OR REPLACE FUNCTION public.fn_relatorio_ausencias_completo(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id_usuario uuid, avaliador_nome text, avaliador_email text, total_ausencias integer, ausencias jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ausencias_enriquecidas AS (
    SELECT hi.id_usuario, u.nome AS avaliador_nome, u.email AS avaliador_email,
      p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo AS projeto_titulo, p.estande AS projeto_estande,
      coalesce(m.nome_modalidade, 'Sem modalidade') AS projeto_modalidade,
      coalesce(ar.nome_area, 'Sem área temática') AS projeto_area,
      coalesce(inst.nome_exibicao, 'Não informada') AS projeto_instituicao,
      hi.created_at AS data_ausencia,
      (SELECT count(*)::int FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto AND (av.status IS NULL OR av.status <> 'CANCELADA')
          AND NOT av.is_voto_popular) AS total_avaliacoes_atuais
    FROM public.historico_impedimentos hi
    JOIN public.usuarios u ON u.id_usuario = hi.id_usuario
    JOIN public.projetos p ON p.id_projeto = hi.id_projeto
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    WHERE hi.tipo = 'ausencia'
      AND p.id_evento = p_id_evento
  )
  SELECT ae.id_usuario, ae.avaliador_nome::text, ae.avaliador_email::text,
    count(ae.id_projeto)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'id_projeto', ae.id_projeto, 'id_evento', ae.id_evento, 'codigo_projeto', ae.codigo_projeto,
      'projeto_titulo', ae.projeto_titulo, 'projeto_estande', ae.projeto_estande,
      'projeto_modalidade', ae.projeto_modalidade, 'projeto_area', ae.projeto_area,
      'projeto_instituicao', ae.projeto_instituicao, 'data_ausencia', ae.data_ausencia,
      'total_avaliacoes_atuais', ae.total_avaliacoes_atuais
    ) ORDER BY ae.data_ausencia DESC), '[]'::jsonb)
  FROM ausencias_enriquecidas ae
  GROUP BY ae.id_usuario, ae.avaliador_nome, ae.avaliador_email
  ORDER BY ae.avaliador_nome, ae.id_usuario;
$function$;


CREATE OR REPLACE FUNCTION public.fn_relatorio_devolucoes_completo(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id_usuario uuid, avaliador_nome text, avaliador_email text, total_devolucoes integer, devolucoes jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH devolucoes_enriquecidas AS (
    SELECT hi.id_usuario, u.nome AS avaliador_nome, u.email AS avaliador_email,
      p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo AS projeto_titulo, p.estande AS projeto_estande,
      coalesce(m.nome_modalidade, 'Sem modalidade') AS projeto_modalidade,
      coalesce(ar.nome_area, 'Sem área temática') AS projeto_area,
      coalesce(inst.nome_exibicao, 'Não informada') AS projeto_instituicao,
      hi.created_at AS data_devolucao,
      (SELECT count(*)::int FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto AND (av.status IS NULL OR av.status <> 'CANCELADA')
          AND NOT av.is_voto_popular) AS total_avaliacoes_atuais
    FROM public.historico_impedimentos hi
    JOIN public.usuarios u ON u.id_usuario = hi.id_usuario
    JOIN public.projetos p ON p.id_projeto = hi.id_projeto
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    WHERE hi.tipo = 'conflito'
      AND p.id_evento = p_id_evento
  )
  SELECT de.id_usuario, de.avaliador_nome::text, de.avaliador_email::text,
    count(de.id_projeto)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'id_projeto', de.id_projeto, 'id_evento', de.id_evento, 'codigo_projeto', de.codigo_projeto,
      'projeto_titulo', de.projeto_titulo, 'projeto_estande', de.projeto_estande,
      'projeto_modalidade', de.projeto_modalidade, 'projeto_area', de.projeto_area,
      'projeto_instituicao', de.projeto_instituicao, 'data_devolucao', de.data_devolucao,
      'total_avaliacoes_atuais', de.total_avaliacoes_atuais
    ) ORDER BY de.data_devolucao DESC), '[]'::jsonb)
  FROM devolucoes_enriquecidas de
  GROUP BY de.id_usuario, de.avaliador_nome, de.avaliador_email
  ORDER BY de.avaliador_nome, de.id_usuario;
$function$;


-- 4. Instituições ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_relatorio_instituicoes_completo(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id_instituicao uuid, nome_instituicao text, total_projetos integer, total_credenciados integer, total_avaliados integer, media_geral_escola numeric, projetos jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH dados_base_projetos AS (
    SELECT
      p.id_projeto,
      p.id_evento,
      p.codigo_projeto,
      p.titulo,
      COALESCE(m.nome_modalidade, p.modalidade, 'Geral') AS modalidade,
      COALESCE(ar.nome_area, p.area_conhecimento, 'Multidisciplinar') AS area_conhecimento,
      COALESCE(inst.id_instituicao, p.id_instituicao, '00000000-0000-0000-0000-000000000000'::uuid) AS id_instituicao_norm,
      COALESCE(inst.nome_exibicao, p.nome_instituicao, 'Instituição Não Informada') AS nome_instituicao_norm,
      COALESCE(p.is_check_in_realizado, true) AS is_check_in_realizado,
      (
        SELECT COUNT(*)::int
        FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto
          AND (av.status IS NULL OR av.status != 'CANCELADA')
          AND NOT av.is_voto_popular
      ) AS total_avaliacoes,
      (
        SELECT COALESCE(ROUND(AVG(av.nota_final)::numeric, 2) + coalesce(p.ajuste_media, 0), 0.00)
        FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto
          AND (av.status IS NULL OR av.status != 'CANCELADA')
          AND NOT av.is_voto_popular
      ) AS media_geral,
      EXISTS(
        SELECT 1 FROM public.historico_impedimentos hi
        WHERE hi.id_projeto = p.id_projeto AND hi.tipo = 'ausencia'
      ) AS foi_marcado_ausente
    FROM public.projetos p
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    WHERE (p_id_evento IS NULL OR p.id_evento = p_id_evento)
  )
  SELECT
    dbp.id_instituicao_norm AS id_instituicao,
    dbp.nome_instituicao_norm AS nome_instituicao,
    COUNT(dbp.id_projeto)::int AS total_projetos,
    COUNT(dbp.id_projeto) FILTER (WHERE dbp.is_check_in_realizado = true)::int AS total_credenciados,
    COUNT(dbp.id_projeto) FILTER (WHERE dbp.total_avaliacoes > 0)::int AS total_avaliados,
    COALESCE(
      ROUND(AVG(dbp.media_geral) FILTER (WHERE dbp.total_avaliacoes > 0)::numeric, 2),
      0.00
    ) AS media_geral_escola,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id_projeto', dbp.id_projeto,
          'codigo_projeto', dbp.codigo_projeto,
          'titulo', dbp.titulo,
          'modalidade', dbp.modalidade,
          'area_conhecimento', dbp.area_conhecimento,
          'is_check_in_realizado', dbp.is_check_in_realizado,
          'total_avaliacoes', dbp.total_avaliacoes,
          'media_geral', dbp.media_geral,
          'foi_marcado_ausente', dbp.foi_marcado_ausente
        ) ORDER BY dbp.titulo ASC
      ),
      '[]'::jsonb
    ) AS projetos
  FROM dados_base_projetos dbp
  GROUP BY dbp.id_instituicao_norm, dbp.nome_instituicao_norm
  ORDER BY total_projetos DESC, dbp.nome_instituicao_norm ASC;
END;
$function$;


-- 5. Desempate -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_chave_desempate(p_id_projeto uuid)
 RETURNS numeric[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(array_agg(x.media ORDER BY x.prioridade, x.ordem), '{}'::numeric[])
  FROM (
    SELECT pq.peso_desempate AS prioridade, pq.ordem, round(avg(r.nota_atribuida), 2) AS media
    FROM public.avaliacoes a
    JOIN public.respostas_avaliacao r ON r.id_avaliacao = a.id_avaliacao
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE a.id_projeto = p_id_projeto
      AND (a.status IS NULL OR a.status <> 'CANCELADA')
      AND NOT a.is_voto_popular
      AND pq.peso_desempate > 0
    GROUP BY pq.id_pergunta, pq.peso_desempate, pq.ordem
  ) x;
$function$;


-- 6. Telão -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_telao_resumo(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ev AS (
    SELECT id_evento, nome_evento, edicao, coalesce(data_evento, data_inicio) AS data_evento,
      horario_inicio, horario_fim, coalesce(cota_avaliacoes_padrao, 3) AS cota
    FROM public.eventos WHERE id_evento = coalesce(p_id_evento, public.evento_ativo_id())
  ),
  validas AS (
    SELECT a.id_projeto, count(*) AS qtd
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE (a.status IS NULL OR a.status <> 'CANCELADA') AND a.nota_final IS NOT NULL
      AND NOT a.is_voto_popular
    GROUP BY a.id_projeto
  ),
  votos AS (
    SELECT a.id_projeto, count(*) AS qtd
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE (a.status IS NULL OR a.status <> 'CANCELADA') AND a.nota_final IS NOT NULL
      AND a.is_voto_popular
    GROUP BY a.id_projeto
  ),
  travas AS (
    SELECT l.id_projeto, count(*) AS qtd
    FROM public.locks_ativos l
    JOIN public.projetos p ON p.id_projeto = l.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE l.expira_em > now()
      AND NOT l.is_voto_popular
    GROUP BY l.id_projeto
  ),
  presentes AS (
    SELECT p.id_projeto, coalesce(p.cota_avaliacoes_customizada, ev.cota) AS cota,
      coalesce(v.qtd, 0) AS qtd, coalesce(t.qtd, 0) AS travas
    FROM public.projetos p
    JOIN ev ON ev.id_evento = p.id_evento
    LEFT JOIN validas v ON v.id_projeto = p.id_projeto
    LEFT JOIN travas t ON t.id_projeto = p.id_projeto
    WHERE p.is_check_in_realizado IS TRUE AND NOT coalesce(p.is_fora_da_competicao, false)
  )
  SELECT jsonb_build_object(
    'nome_evento', (SELECT nome_evento FROM ev),
    'edicao', (SELECT edicao FROM ev),
    'data_evento', (SELECT data_evento FROM ev),
    'horario_inicio', (SELECT horario_inicio FROM ev),
    'horario_fim', (SELECT horario_fim FROM ev),
    'total_projetos', (SELECT count(*) FROM public.projetos p JOIN ev ON ev.id_evento = p.id_evento),
    'projetos_presentes', (SELECT count(*) FROM presentes),
    'avaliadores_credenciados', (SELECT count(*) FROM public.avaliadores_evento ae
                                 JOIN ev ON ev.id_evento = ae.id_evento
                                 JOIN public.usuarios u ON u.id_usuario = ae.id_usuario
                                 WHERE ae.is_credenciado AND upper(u.papel) = 'AVALIADOR'),
    'avaliacoes_em_andamento', (SELECT coalesce(sum(qtd), 0) FROM travas),
    'em_andamento_na_meta', (SELECT coalesce(sum(least(travas, greatest(cota - qtd, 0))), 0) FROM presentes),
    'avaliacoes_realizadas', (SELECT coalesce(sum(qtd), 0) FROM validas),
    'meta_global', (SELECT coalesce(sum(cota), 0) FROM presentes),
    'avaliacoes_na_meta', (SELECT coalesce(sum(least(qtd, cota)), 0) FROM presentes),
    'projetos_quarentena', (SELECT count(*) FROM public.view_projetos_quarentena q JOIN ev ON ev.id_evento = q.id_evento),
    'cota_padrao', (SELECT cota FROM ev),
    'avaliacao_finalizada', (SELECT count(*) > 0 AND bool_and(qtd >= cota) FROM presentes),
    'votos_populares', (SELECT coalesce(sum(qtd), 0) FROM votos),
    'projetos_votados', (SELECT count(*) FROM votos),
    'votantes_credenciados', (SELECT count(*) FROM public.avaliadores_evento ae
                              JOIN ev ON ev.id_evento = ae.id_evento
                              JOIN public.questionarios q ON q.id_questionario = ae.id_questionario
                              WHERE ae.is_credenciado AND q.is_voto_popular)
  );
$function$;


-- 7. Ranking técnico -------------------------------------------------------
CREATE OR REPLACE VIEW public.view_ranking_top3 WITH (security_invoker = true) AS
 WITH base AS (
         SELECT p.id_projeto,
            p.codigo_projeto,
            p.titulo,
            p.estande,
            p.corredor,
            COALESCE(m.nome_modalidade, 'Sem modalidade'::character varying) AS modalidade,
            COALESCE(ar.nome_area, 'Sem área temática'::character varying) AS area_tematica,
            COALESCE(inst.nome_exibicao, 'Não informada'::character varying) AS nome_instituicao,
            COALESCE(array_agg(round(a.nota_final::numeric, 2) ORDER BY a.tempo_submissao, a.created_at) FILTER (WHERE a.nota_final IS NOT NULL), '{}'::numeric[]) AS notas,
            COALESCE(round(avg(a.nota_final), 2), 0.00) AS media_geral,
            COALESCE(p.ajuste_media, 0::numeric) AS ajuste_media,
            COALESCE(round(avg(a.nota_final), 2), 0.00) + COALESCE(p.ajuste_media, 0::numeric) AS media_final,
            count(a.id_avaliacao) AS total_avaliacoes,
            p.id_evento
           FROM projetos p
             LEFT JOIN modalidades m ON m.id_modalidade = p.id_modalidade
             LEFT JOIN areas_tematicas ar ON ar.id_area = p.id_area
             LEFT JOIN instituicoes inst ON inst.id_instituicao = p.id_instituicao
             JOIN avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status::text <> 'CANCELADA'::text)
               AND NOT a.is_voto_popular
          WHERE NOT COALESCE(p.is_fora_da_competicao, false)
          GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento, p.ajuste_media
        ), com_chave AS (
         SELECT b_1.id_projeto,
            b_1.codigo_projeto,
            b_1.titulo,
            b_1.estande,
            b_1.corredor,
            b_1.modalidade,
            b_1.area_tematica,
            b_1.nome_instituicao,
            b_1.notas,
            b_1.media_geral,
            b_1.ajuste_media,
            b_1.media_final,
            b_1.total_avaliacoes,
            b_1.id_evento,
            fn_chave_desempate(b_1.id_projeto) AS chave_desempate
           FROM base b_1
        )
 SELECT id_projeto,
    codigo_projeto,
    titulo,
    estande,
    corredor,
    modalidade,
    area_tematica,
    nome_instituicao,
    notas,
    media_geral,
    total_avaliacoes,
    id_evento,
    rank() OVER (PARTITION BY id_evento, modalidade, area_tematica ORDER BY media_final DESC, chave_desempate DESC) AS posicao,
    (EXISTS ( SELECT 1
           FROM view_projetos_quarentena q
          WHERE q.id_projeto = b.id_projeto)) AS em_quarentena,
    chave_desempate,
    ajuste_media,
    media_final
   FROM com_chave b
  ORDER BY media_final DESC, codigo_projeto;


-- 8. Quarentena e pendentes ------------------------------------------------
CREATE OR REPLACE VIEW public.view_projetos_quarentena WITH (security_invoker = true) AS
 SELECT p.id_projeto,
    p.codigo_projeto,
    p.titulo,
    p.estande,
    p.corredor,
    COALESCE(m.nome_modalidade, 'Geral'::character varying) AS modalidade,
    COALESCE(ar.nome_area, 'Multidisciplinar'::character varying) AS area_tematica,
    COALESCE(inst.nome_exibicao, 'Não informada'::character varying) AS nome_instituicao,
    p.id_evento,
    count(a.id_avaliacao) AS total_avaliacoes,
    round(min(a.nota_final), 2) AS nota_minima,
    round(max(a.nota_final), 2) AS nota_maxima,
    round(max(a.nota_final) - min(a.nota_final), 2) AS diferenca_notas,
    bool_or(COALESCE(a.is_quarentena, false)) AS tem_flag_quarentena,
    p.quarentena_resolvida_em,
    max(a.created_at) AS ultima_avaliacao_em
   FROM projetos p
     LEFT JOIN modalidades m ON m.id_modalidade = p.id_modalidade
     LEFT JOIN areas_tematicas ar ON ar.id_area = p.id_area
     LEFT JOIN instituicoes inst ON inst.id_instituicao = p.id_instituicao
     LEFT JOIN avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status::text <> 'CANCELADA'::text)
       AND NOT a.is_voto_popular
  GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento, p.quarentena_resolvida_em
 HAVING bool_or(COALESCE(a.is_quarentena, false)) OR count(a.id_avaliacao) >= 2 AND (max(a.nota_final) - min(a.nota_final)) > 2.5 AND (p.quarentena_resolvida_em IS NULL OR max(a.created_at) > p.quarentena_resolvida_em);


CREATE OR REPLACE VIEW public.view_projetos_pendentes_avaliacao WITH (security_invoker = true) AS
 SELECT p.id_projeto,
    p.codigo_projeto,
    p.titulo,
    p.estande,
    p.corredor,
    COALESCE(m.nome_modalidade, 'Geral'::character varying) AS modalidade,
    p.id_instituicao,
    COALESCE(inst.nome_exibicao, 'Não informada'::character varying) AS nome_instituicao,
    p.id_evento,
    count(a.id_avaliacao) FILTER (WHERE a.status IS NULL OR a.status::text <> 'CANCELADA'::text) AS total_avaliacoes
   FROM projetos p
     LEFT JOIN modalidades m ON m.id_modalidade = p.id_modalidade
     LEFT JOIN areas_tematicas ar ON ar.id_area = p.id_area
     LEFT JOIN instituicoes inst ON inst.id_instituicao = p.id_instituicao
     LEFT JOIN avaliacoes a ON a.id_projeto = p.id_projeto AND NOT a.is_voto_popular
  WHERE COALESCE(p.is_check_in_realizado, true) = true AND COALESCE(p.is_fora_da_competicao, false) = false
  GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, p.id_instituicao, inst.nome_exibicao, p.id_evento
 HAVING count(a.id_avaliacao) FILTER (WHERE a.status IS NULL OR a.status::text <> 'CANCELADA'::text) < 3;


-- 9. Questionários reaproveitáveis: mostra a marca -------------------------
CREATE OR REPLACE FUNCTION public.admin_listar_questionarios_reaproveitaveis(p_id_evento uuid)
 RETURNS TABLE(id_questionario uuid, titulo text, nome_evento text, data_evento date, total_perguntas integer, total_avaliacoes integer, ja_no_evento boolean, is_voto_popular boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT q.id_questionario,
         q.titulo::text,
         e.nome_evento::text,
         coalesce(e.data_evento, e.data_inicio)::date,
         (SELECT count(*)::integer FROM public.perguntas_questionario pq WHERE pq.id_questionario = q.id_questionario),
         (SELECT count(*)::integer FROM public.avaliacoes a WHERE a.id_questionario = q.id_questionario),
         EXISTS (
           SELECT 1 FROM public.questionarios c
           WHERE c.id_evento = p_id_evento
             AND c.id_origem IN (q.id_questionario, q.id_origem)
         )
    , coalesce(q.is_voto_popular, false)
  FROM public.questionarios q
  JOIN public.eventos e ON e.id_evento = q.id_evento
  WHERE q.id_evento IS DISTINCT FROM p_id_evento
  ORDER BY coalesce(e.data_evento, e.data_inicio) DESC NULLS LAST, e.nome_evento, q.titulo;
END;
$function$;


-- 10. Voto popular: a fonte única do relatório e da classificação ----------
CREATE OR REPLACE FUNCTION public.fn_relatorio_voto_popular_completo(p_id_evento uuid DEFAULT NULL)
RETURNS TABLE(
  id_projeto uuid, codigo_projeto text, titulo text, modalidade text, area_tematica text,
  nome_instituicao text, total_votos integer, media_simples numeric, media_bayesiana numeric,
  media_evento numeric, peso_ancora numeric, posicao integer, votos jsonb)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH votos_validos AS (
    SELECT a.id_avaliacao, a.id_projeto, a.id_usuario, u.nome AS avaliador_nome,
      round(a.nota_final::numeric, 2) AS nota,
      coalesce(a.tempo_submissao, a.created_at) AS data
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    JOIN public.usuarios u ON u.id_usuario = a.id_usuario
    WHERE p.id_evento = p_id_evento
      AND a.is_voto_popular
      AND (a.status IS NULL OR a.status <> 'CANCELADA')
      AND a.nota_final IS NOT NULL
  ),
  por_projeto AS (
    SELECT v.id_projeto, count(*)::int AS total_votos, round(avg(v.nota), 2) AS media_simples,
      jsonb_agg(jsonb_build_object(
        'id_avaliacao', v.id_avaliacao, 'id_usuario', v.id_usuario,
        'avaliador_nome', v.avaliador_nome, 'nota_final', v.nota, 'data', v.data
      ) ORDER BY v.data DESC) AS votos
    FROM votos_validos v
    GROUP BY v.id_projeto
  ),
  -- Âncora da média bayesiana: C = média de todos os votos do evento;
  -- m = votos por projeto votado (automático, acompanha o volume real da feira).
  ancora AS (
    SELECT round(avg(v.nota), 4) AS media_evento,
      round(count(*)::numeric / nullif((SELECT count(*) FROM por_projeto), 0), 4) AS peso
    FROM votos_validos v
  ),
  calculo AS (
    SELECT pp.id_projeto, pp.total_votos, pp.media_simples, pp.votos,
      an.media_evento, an.peso,
      round(
        (pp.total_votos::numeric / nullif(pp.total_votos + an.peso, 0)) * pp.media_simples
        + (an.peso / nullif(pp.total_votos + an.peso, 0)) * an.media_evento
      , 2) AS media_bayesiana
    FROM por_projeto pp CROSS JOIN ancora an
  )
  SELECT c.id_projeto, p.codigo_projeto::text, p.titulo::text,
    coalesce(m.nome_modalidade, 'Sem modalidade')::text,
    coalesce(ar.nome_area, 'Sem área temática')::text,
    coalesce(inst.nome_exibicao, 'Não informada')::text,
    c.total_votos, c.media_simples, c.media_bayesiana, c.media_evento, c.peso,
    rank() OVER (ORDER BY c.media_bayesiana DESC, c.total_votos DESC, p.codigo_projeto)::int,
    c.votos
  FROM calculo c
  JOIN public.projetos p ON p.id_projeto = c.id_projeto
  LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
  LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
  LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
  ORDER BY c.media_bayesiana DESC, c.total_votos DESC, p.codigo_projeto;
$$;

COMMENT ON FUNCTION public.fn_relatorio_voto_popular_completo(uuid) IS
  'Voto popular por projeto no evento: votos, média simples e média bayesiana, com a âncora (media_evento) e o peso (peso_ancora) para a conta aberta na tela. Ordena pela bayesiana. Alimenta o relatório e a classificação do voto popular — um lugar só, para os dois não divergirem.';

REVOKE ALL ON FUNCTION public.fn_relatorio_projetos_completo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_relatorio_voto_popular_completo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_listar_questionarios_reaproveitaveis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_projetos_completo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_voto_popular_completo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_listar_questionarios_reaproveitaveis(uuid) TO authenticated, service_role;
GRANT SELECT ON public.view_ranking_top3 TO authenticated, anon, service_role;
GRANT SELECT ON public.view_projetos_quarentena TO authenticated, anon, service_role;
GRANT SELECT ON public.view_projetos_pendentes_avaliacao TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
