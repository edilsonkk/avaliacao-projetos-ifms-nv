-- ==============================================================================
-- MIGRATION: 20261030080000_telao.sql
-- DESCRIÇÃO: resumo do Telão ao Vivo com os números certos.
--   * O Telão mostrava "FETEC MS 2026" fixo, um cronômetro que começava em zero
--     ao abrir a página e uma "Meta Global" de todos os projetos × cota padrão
--     (incluindo ausentes, fora da competição e ignorando a cota do projeto),
--     com 100% inalcançável. O card de quarentena ficava sempre em 0%.
--   * fn_telao_resumo passa a devolver também: nome/edição/data/horário do
--     evento, projetos presentes na competição, a meta (soma da cota de cada
--     projeto presente), as avaliações que contam para a meta (no máximo a cota
--     de cada projeto) e o número de projetos em quarentena pendente.
--   * Continua só com agregados (o Telão é público): sem nomes, títulos ou notas.
-- FRONT-END: compatível com a versão anterior (as chaves antigas continuam).
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
  presentes AS (
    SELECT p.id_projeto, coalesce(p.cota_avaliacoes_customizada, ev.cota) AS cota, coalesce(v.qtd, 0) AS qtd
    FROM public.projetos p
    JOIN ev ON ev.id_evento = p.id_evento
    LEFT JOIN validas v ON v.id_projeto = p.id_projeto
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
    'avaliadores_credenciados', (SELECT count(*) FROM public.avaliadores_evento ae JOIN ev ON ev.id_evento = ae.id_evento
                                 WHERE ae.is_credenciado),
    'avaliacoes_em_andamento', (SELECT count(*) FROM public.locks_ativos l
                                JOIN public.projetos p ON p.id_projeto = l.id_projeto
                                JOIN ev ON ev.id_evento = p.id_evento
                                WHERE l.expira_em > now()),
    'avaliacoes_realizadas', (SELECT coalesce(sum(qtd), 0) FROM validas),
    'meta_global', (SELECT coalesce(sum(cota), 0) FROM presentes),
    'avaliacoes_na_meta', (SELECT coalesce(sum(least(qtd, cota)), 0) FROM presentes),
    'projetos_quarentena', (SELECT count(*) FROM public.view_projetos_quarentena q JOIN ev ON ev.id_evento = q.id_evento),
    'cota_padrao', (SELECT cota FROM ev)
  );
$$;

GRANT EXECUTE ON FUNCTION public.fn_telao_resumo(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
