-- ==============================================================================
-- MIGRATION: 20261030090000_telao_contagens.sql
-- DESCRIÇÃO: contagens do Telão iguais às das telas de gestão.
--   * "Avaliadores credenciados" contava toda linha credenciada de
--     avaliadores_evento, onde também fica o credenciamento do Staff. Agora conta
--     só usuários com papel AVALIADOR (mesma regra das telas Avaliadores e Staff).
--   * Nova chave em_andamento_na_meta: travas válidas que ainda cabem na meta
--     (projeto presente, na competição e abaixo da cota). Antes o Telão descontava
--     de "Restantes" travas de projetos ausentes, fora da competição ou já com a
--     cota cheia.
-- FRONT-END: compatível com a versão anterior (só uma chave nova).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_telao_resumo(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ev AS (
    SELECT id_evento, nome_evento, edicao, coalesce(data_inicio, data_evento) AS data_evento,
      horario_inicio, horario_fim, coalesce(cota_avaliacoes_padrao, 3) AS cota
    FROM public.eventos WHERE id_evento = coalesce(p_id_evento, public.evento_ativo_id())
  ),
  validas AS (
    SELECT a.id_projeto, count(*) AS qtd
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE (a.status IS NULL OR a.status <> 'CANCELADA') AND a.nota_final IS NOT NULL
    GROUP BY a.id_projeto
  ),
  travas AS (
    SELECT l.id_projeto, count(*) AS qtd
    FROM public.locks_ativos l
    JOIN public.projetos p ON p.id_projeto = l.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE l.expira_em > now()
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
    'cota_padrao', (SELECT cota FROM ev)
  );
$$;

REVOKE ALL ON FUNCTION public.fn_telao_resumo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_telao_resumo(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
