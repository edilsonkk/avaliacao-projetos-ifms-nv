-- ==============================================================================
-- MIGRATION: 20261030060000_classificacao.sql
-- DESCRIÇÃO: view_ranking_top3 pronta para a premiação (PRD L11).
--   * Projeto marcado "fora da competição" entrava no pódio (bastava uma
--     avaliação por atribuição forçada). Agora fica de fora.
--   * Empates: a posição era o índice no array do front, então dois projetos
--     com a mesma média recebiam 1º e 2º em ordem arbitrária. A coluna nova
--     `posicao` usa RANK() por evento, modalidade e área: empate divide a
--     posição (1º, 1º, 3º). Não há critério oficial de desempate (PRD, questão
--     em aberto), então a comissão decide.
--   * Coluna nova `em_quarentena`: projeto com notas divergentes ainda não
--     auditado (view_projetos_quarentena) aparece marcado para não ser
--     homologado sem conferência.
--   * Sem modalidade/área, a view inventava "Geral"/"Multidisciplinar"; agora
--     mostra "Sem modalidade"/"Sem área temática".
-- FRONT-END: compatível com a versão anterior (mesmas colunas, duas novas no fim).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.view_ranking_top3
WITH (security_invoker = true) AS
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
    count(a.id_avaliacao) AS total_avaliacoes,
    p.id_evento
  FROM public.projetos p
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status::text <> 'CANCELADA'::text)
  WHERE NOT COALESCE(p.is_fora_da_competicao, false)
  GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento
)
SELECT b.id_projeto,
  b.codigo_projeto,
  b.titulo,
  b.estande,
  b.corredor,
  b.modalidade,
  b.area_tematica,
  b.nome_instituicao,
  b.notas,
  b.media_geral,
  b.total_avaliacoes,
  b.id_evento,
  rank() OVER (PARTITION BY b.id_evento, b.modalidade, b.area_tematica ORDER BY b.media_geral DESC) AS posicao,
  EXISTS (SELECT 1 FROM public.view_projetos_quarentena q WHERE q.id_projeto = b.id_projeto) AS em_quarentena
FROM base b
ORDER BY b.media_geral DESC, b.codigo_projeto;

REVOKE ALL ON public.view_ranking_top3 FROM anon;
GRANT SELECT ON public.view_ranking_top3 TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
