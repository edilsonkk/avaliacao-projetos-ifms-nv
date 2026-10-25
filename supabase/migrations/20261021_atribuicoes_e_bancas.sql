-- ==============================================================================
-- MIGRATION: 20261021_atribuicoes_e_bancas.sql
-- Permite bancas simultâneas (múltiplos avaliadores no mesmo projeto) e fila direcionada
-- ==============================================================================

-- 1. Permite que múltiplos avaliadores avaliem o mesmo projeto ao mesmo tempo (Banca Simultânea)
-- Remove restrição de unicidade apenas em id_projeto, mantendo id_usuario único
ALTER TABLE public.locks_ativos DROP CONSTRAINT IF EXISTS locks_ativos_id_projeto_key;
ALTER TABLE public.locks_ativos DROP CONSTRAINT IF EXISTS locks_ativos_id_usuario_key;
ALTER TABLE public.locks_ativos ADD CONSTRAINT locks_ativos_id_usuario_key UNIQUE (id_usuario);

-- 2. Tabela para fila de projetos atribuídos pela coordenação (Enfileiramento 1-para-Vários)
CREATE TABLE IF NOT EXISTS public.fila_atribuicoes_direcionadas (
  id_atribuicao UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_projeto UUID NOT NULL REFERENCES public.projetos(id_projeto) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'pendente', -- pendente, em_andamento, concluido, cancelado
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para alta performance de consulta
CREATE INDEX IF NOT EXISTS idx_fila_atribuicoes_usuario ON public.fila_atribuicoes_direcionadas(id_usuario, status, ordem);
CREATE INDEX IF NOT EXISTS idx_fila_atribuicoes_projeto ON public.fila_atribuicoes_direcionadas(id_projeto);

-- Habilitar RLS e políticas padrão
ALTER TABLE public.fila_atribuicoes_direcionadas ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'fila_atribuicoes_direcionadas' AND policyname = 'Acesso geral fila_atribuicoes_direcionadas'
  ) THEN
    CREATE POLICY "Acesso geral fila_atribuicoes_direcionadas" 
    ON public.fila_atribuicoes_direcionadas FOR ALL 
    USING (true) 
    WITH CHECK (true);
  END IF;
END $$;
