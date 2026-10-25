-- ==============================================================================
-- MIGRATION: 20261025_garantir_data_evento_persistente.sql
-- Garante colunas de data e horário do evento para persistência estrita no Admin
-- ==============================================================================

DO $$ 
BEGIN
  -- 1. Garante coluna data_evento como DATE
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

  -- 3. Garante coluna sistema_liberado
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'eventos' AND column_name = 'sistema_liberado'
  ) THEN
    ALTER TABLE public.eventos ADD COLUMN sistema_liberado BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Comentários descritivos
COMMENT ON COLUMN public.eventos.data_evento IS 'Data oficial de realização do evento (DATE)';
COMMENT ON COLUMN public.eventos.horario_inicio IS 'Horário de início das avaliações do evento (TIME)';
COMMENT ON COLUMN public.eventos.horario_fim IS 'Horário de término das avaliações do evento (TIME)';
COMMENT ON COLUMN public.eventos.sistema_liberado IS 'Controle booleano que permite ou pausa o sorteio de avaliações';
