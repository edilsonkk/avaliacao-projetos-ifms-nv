-- ==============================================================================
-- SISTEMA DE AVALIAÇÃO DE PROJETOS IFMS (FETEC MS)
-- MIGRAÇÃO: Dicionário de Aliases, Fuzzy Matching e Modalidades e Níveis
-- Data: 2026-10-24
-- ==============================================================================

-- 1. ADIÇÃO DE COLUNAS EM public.modalidades
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'modalidades' AND column_name = 'codigo'
  ) THEN
    ALTER TABLE public.modalidades ADD COLUMN codigo VARCHAR(50);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'modalidades' AND column_name = 'nivel'
  ) THEN
    ALTER TABLE public.modalidades ADD COLUMN nivel VARCHAR(100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'modalidades' AND column_name = 'area_tematica'
  ) THEN
    ALTER TABLE public.modalidades ADD COLUMN area_tematica VARCHAR(150);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'modalidades' AND column_name = 'descricao'
  ) THEN
    ALTER TABLE public.modalidades ADD COLUMN descricao TEXT;
  END IF;
END $$;

-- 2. TABELA DE ALIASES DE INSTITUIÇÕES (Dicionário de Sinônimos/Aliases)
CREATE TABLE IF NOT EXISTS public.instituicao_aliases (
  id_alias UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_instituicao UUID NOT NULL REFERENCES public.instituicoes(id_instituicao) ON DELETE CASCADE,
  alias VARCHAR(255) NOT NULL,
  alias_normalizado VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_instituicao_alias_normalizado UNIQUE (id_instituicao, alias_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_instituicao_aliases_norm ON public.instituicao_aliases(alias_normalizado);

-- 3. TABELA DE ALIASES DE MODALIDADES
CREATE TABLE IF NOT EXISTS public.modalidade_aliases (
  id_alias UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_modalidade UUID NOT NULL REFERENCES public.modalidades(id_modalidade) ON DELETE CASCADE,
  alias VARCHAR(255) NOT NULL,
  alias_normalizado VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_modalidade_alias_normalizado UNIQUE (id_modalidade, alias_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_modalidade_aliases_norm ON public.modalidade_aliases(alias_normalizado);

-- 4. POLÍTICAS DE RLS (Acesso Aberto e Seguro para Anon/Authenticated)
ALTER TABLE public.instituicao_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modalidade_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'instituicao_aliases' AND policyname = 'politica_instituicao_aliases_livre') THEN
    CREATE POLICY politica_instituicao_aliases_livre ON public.instituicao_aliases FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'modalidade_aliases' AND policyname = 'politica_modalidade_aliases_livre') THEN
    CREATE POLICY politica_modalidade_aliases_livre ON public.modalidade_aliases FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
