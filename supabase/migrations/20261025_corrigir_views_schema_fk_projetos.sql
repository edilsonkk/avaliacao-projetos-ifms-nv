-- ==============================================================================
-- MIGRATION: 20261025_corrigir_views_schema_fk_projetos.sql
-- DESCRIÇÃO: Remove e recria com segurança as views legadas (view_ranking_top3,
--            view_projetos_quarentena e view_projetos_pendentes_avaliacao),
--            preservando a ordem de colunas e utilizando chaves estrangeiras
--            (modalidades, areas_tematicas, instituicoes), evitando erro 42P16.
-- ==============================================================================

-- 1. DROP DAS VIEWS COM CASCADE PARA LIBERAR ALTERAÇÃO DE COLUNAS NO POSTGRESQL
DROP VIEW IF EXISTS public.view_ranking_top3 CASCADE;
DROP VIEW IF EXISTS public.view_projetos_quarentena CASCADE;
DROP VIEW IF EXISTS public.view_projetos_pendentes_avaliacao CASCADE;

-- 2. RECRIAR VIEW: view_ranking_top3
CREATE VIEW public.view_ranking_top3 AS
SELECT
  p.id_projeto,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  COALESCE(m.nome_modalidade, 'Geral') AS modalidade,
  COALESCE(ar.nome_area, 'Multidisciplinar') AS area_tematica,
  COALESCE(inst.nome_exibicao, 'Não informada') AS nome_instituicao,
  COALESCE(ARRAY_AGG(ROUND(a.nota_final::numeric, 2)) FILTER (WHERE a.nota_final IS NOT NULL AND (a.status IS NULL OR a.status != 'CANCELADA')), '{}') AS notas,
  COALESCE(ROUND(AVG(a.nota_final)::numeric, 2), 0.00) AS media_geral,
  COUNT(a.id_avaliacao) AS total_avaliacoes,
  p.id_evento
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status != 'CANCELADA')
GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento
ORDER BY media_geral DESC;

-- 3. RECRIAR VIEW: view_projetos_quarentena
CREATE VIEW public.view_projetos_quarentena AS
SELECT 
  p.id_projeto,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  COALESCE(m.nome_modalidade, 'Geral') AS modalidade,
  COALESCE(ar.nome_area, 'Multidisciplinar') AS area_tematica,
  COALESCE(inst.nome_exibicao, 'Não informada') AS nome_instituicao,
  p.id_evento,
  COUNT(a.id_avaliacao) as total_avaliacoes,
  ROUND(MIN(a.nota_final)::numeric, 2) as nota_minima,
  ROUND(MAX(a.nota_final)::numeric, 2) as nota_maxima,
  ROUND((MAX(a.nota_final) - MIN(a.nota_final))::numeric, 2) as diferenca_notas,
  BOOL_OR(COALESCE(a.is_quarentena, false)) as tem_flag_quarentena
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
LEFT JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status != 'CANCELADA')
GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento
HAVING BOOL_OR(COALESCE(a.is_quarentena, false)) = true 
    OR (COUNT(a.id_avaliacao) >= 2 AND (MAX(a.nota_final) - MIN(a.nota_final)) > 2.5);

-- 4. RECRIAR VIEW: view_projetos_pendentes_avaliacao
CREATE VIEW public.view_projetos_pendentes_avaliacao AS
SELECT 
  p.id_projeto,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  COALESCE(m.nome_modalidade, 'Geral') AS modalidade,
  p.id_instituicao,
  COALESCE(inst.nome_exibicao, 'Não informada') AS nome_instituicao,
  p.id_evento,
  COUNT(a.id_avaliacao) FILTER (WHERE a.status IS NULL OR a.status != 'CANCELADA') as total_avaliacoes
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
LEFT JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto
WHERE COALESCE(p.is_check_in_realizado, true) = true
  AND COALESCE(p.is_fora_da_competicao, false) = false
GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, p.id_instituicao, inst.nome_exibicao, p.id_evento
HAVING COUNT(a.id_avaliacao) FILTER (WHERE a.status IS NULL OR a.status != 'CANCELADA') < 3;

-- 5. RECONCEDER PERMISSÕES
GRANT SELECT ON public.view_ranking_top3 TO authenticated, anon, service_role;
GRANT SELECT ON public.view_projetos_quarentena TO authenticated, anon, service_role;
GRANT SELECT ON public.view_projetos_pendentes_avaliacao TO authenticated, anon, service_role;
