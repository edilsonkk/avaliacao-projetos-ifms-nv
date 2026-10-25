-- ==============================================================================
-- MIGRATION: 20261022_eventos_campos_data.sql
-- Adiciona suporte a data_evento e garante colunas de horário e configuração em eventos
-- ==============================================================================

DO $$ 
BEGIN
  -- 1. Garante coluna data_evento (DATE)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'eventos' AND column_name = 'data_evento'
  ) THEN
    ALTER TABLE public.eventos ADD COLUMN data_evento DATE DEFAULT CURRENT_DATE;
  END IF;

  -- 2. Garante colunas de horário caso ausentes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'eventos' AND column_name = 'horario_inicio'
  ) THEN
    ALTER TABLE public.eventos ADD COLUMN horario_inicio TIME DEFAULT '08:00';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'eventos' AND column_name = 'horario_fim'
  ) THEN
    ALTER TABLE public.eventos ADD COLUMN horario_fim TIME DEFAULT '18:00';
  END IF;

  -- 3. Garante colunas de data_inicio e data_fim para interoperabilidade
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'eventos' AND column_name = 'data_inicio'
  ) THEN
    ALTER TABLE public.eventos ADD COLUMN data_inicio DATE DEFAULT CURRENT_DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'eventos' AND column_name = 'data_fim'
  ) THEN
    ALTER TABLE public.eventos ADD COLUMN data_fim DATE DEFAULT CURRENT_DATE;
  END IF;

  -- 4. Garante colunas edicao e descricao
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'eventos' AND column_name = 'edicao'
  ) THEN
    ALTER TABLE public.eventos ADD COLUMN edicao VARCHAR(100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'eventos' AND column_name = 'descricao'
  ) THEN
    ALTER TABLE public.eventos ADD COLUMN descricao TEXT;
  END IF;

  -- 5. Garante que limite_corte seja flexível
  ALTER TABLE public.eventos ALTER COLUMN limite_corte DROP NOT NULL;
END $$;
