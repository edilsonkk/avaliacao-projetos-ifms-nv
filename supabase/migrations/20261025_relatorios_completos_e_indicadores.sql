-- ==============================================================================
-- MIGRATION: 20261025_relatorios_completos_e_indicadores.sql
-- DESCRIÇÃO: Expansão do sistema de relatórios administrativos e métricas gerenciais:
--            1. Coluna 'tempo_submissao' na tabela avaliacoes;
--            2. Atualização da view 'view_relatorio_projetos' com joins normalizados;
--            3. Atualização da view 'view_relatorio_avaliadores' com tempos e parecer;
--            4. Criação da view 'view_relatorio_ausencias' com joins normalizados.
-- ==============================================================================

-- 1. Garante coluna tempo_submissao na tabela avaliacoes
ALTER TABLE public.avaliacoes 
ADD COLUMN IF NOT EXISTS tempo_submissao TIMESTAMPTZ DEFAULT now();

-- Preenche retroativamente tempo_submissao para registros legados onde nulo
UPDATE public.avaliacoes 
SET tempo_submissao = created_at 
WHERE tempo_submissao IS NULL;

-- Remove views antigas para evitar conflito de tipos de colunas do PostgreSQL
DROP VIEW IF EXISTS public.view_relatorio_ausencias CASCADE;
DROP VIEW IF EXISTS public.view_relatorio_avaliadores CASCADE;
DROP VIEW IF EXISTS public.view_relatorio_projetos CASCADE;

-- 2. Atualização da View: view_relatorio_projetos (Projetos e Médias com Notas Individuais)
CREATE OR REPLACE VIEW public.view_relatorio_projetos AS
SELECT
  p.id_projeto,
  p.id_evento,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  m.nome_modalidade AS modalidade,
  ar.nome_area AS area_conhecimento,
  inst.nome_exibicao AS nome_instituicao,
  p.id_instituicao,
  p.id_modalidade,
  p.id_area,
  p.is_check_in_realizado,
  p.is_fora_da_competicao,
  COUNT(a.id_avaliacao) AS total_avaliacoes,
  COALESCE(ROUND(AVG(a.nota_final)::numeric, 2), 0.00) AS media_geral,
  COALESCE(
    ARRAY_AGG(
      ROUND(a.nota_final::numeric, 2)
    ) FILTER (WHERE a.nota_final IS NOT NULL AND (a.status IS NULL OR a.status != 'CANCELADA')),
    '{}'
  ) AS notas
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
LEFT JOIN public.avaliacoes a 
  ON a.id_projeto = p.id_projeto 
 AND (a.status IS NULL OR a.status != 'CANCELADA')
GROUP BY 
  p.id_projeto, 
  p.id_evento, 
  p.codigo_projeto, 
  p.titulo, 
  p.estande, 
  p.corredor, 
  m.nome_modalidade, 
  ar.nome_area, 
  inst.nome_exibicao,
  p.id_instituicao,
  p.id_modalidade,
  p.id_area,
  p.is_check_in_realizado,
  p.is_fora_da_competicao
ORDER BY media_geral DESC;

-- 3. Atualização da View: view_relatorio_avaliadores (Avaliadores e Notas Atribuídas com Tempos)
CREATE OR REPLACE VIEW public.view_relatorio_avaliadores AS
SELECT
  a.id_avaliacao,
  u.id_usuario,
  u.nome AS avaliador_nome,
  u.email AS avaliador_email,
  p.id_projeto,
  p.id_evento,
  p.codigo_projeto,
  p.titulo AS projeto_titulo,
  p.estande AS projeto_estande,
  m.nome_modalidade AS projeto_modalidade,
  ar.nome_area AS projeto_area,
  a.nota_final,
  COALESCE(a.parecer_final, '') AS parecer_comentario,
  a.parecer_final,
  a.tempo_presenca,
  a.tempo_submissao,
  a.created_at AS data_avaliacao,
  a.status
FROM public.avaliacoes a
JOIN public.usuarios u ON u.id_usuario = a.id_usuario
JOIN public.projetos p ON p.id_projeto = a.id_projeto
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
WHERE a.status IS NULL OR a.status != 'CANCELADA'
ORDER BY u.nome ASC, a.created_at DESC;

-- 4. Criação da View: view_relatorio_ausencias (Avaliadores e Ausências Atribuídas)
CREATE OR REPLACE VIEW public.view_relatorio_ausencias AS
SELECT
  hi.id_usuario,
  hi.id_projeto,
  hi.tipo,
  hi.created_at AS data_ausencia,
  u.nome AS avaliador_nome,
  u.email AS avaliador_email,
  p.id_evento,
  p.codigo_projeto,
  p.titulo AS projeto_titulo,
  p.estande AS projeto_estande,
  m.nome_modalidade AS projeto_modalidade,
  ar.nome_area AS projeto_area,
  inst.nome_exibicao AS projeto_instituicao,
  (
    SELECT COUNT(*) 
    FROM public.avaliacoes av 
    WHERE av.id_projeto = p.id_projeto 
      AND (av.status IS NULL OR av.status != 'CANCELADA')
  ) AS total_avaliacoes_atuais
FROM public.historico_impedimentos hi
JOIN public.usuarios u ON u.id_usuario = hi.id_usuario
JOIN public.projetos p ON p.id_projeto = hi.id_projeto
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
WHERE hi.tipo = 'ausencia'
ORDER BY hi.created_at DESC;

-- 5. Concessão de Permissões
GRANT SELECT ON public.view_relatorio_projetos TO authenticated, anon, service_role;
GRANT SELECT ON public.view_relatorio_avaliadores TO authenticated, anon, service_role;
GRANT SELECT ON public.view_relatorio_ausencias TO authenticated, anon, service_role;
