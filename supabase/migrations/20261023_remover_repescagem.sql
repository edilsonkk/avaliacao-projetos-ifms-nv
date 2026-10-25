-- ==============================================================================
-- MIGRATION: 20261023_remover_repescagem.sql
-- Exclusão da regra de repescagem de ausentes (admin_repescagem_ausentes)
-- ==============================================================================

DO $$ 
BEGIN
  -- 1. Remove a stored procedure de repescagem de ausentes se existir
  DROP FUNCTION IF EXISTS public.admin_repescagem_ausentes(UUID);
END $$;
