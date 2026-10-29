-- ==============================================================================
-- MIGRATION: 20261029210000_admin_desbloquear_trava.sql
-- DESCRIÇÃO: Desbloqueio de UMA trava (um avaliador) pelo Admin.
--   O "Forçar Desbloqueio" da tela Projetos Bloqueados chamava
--   admin_desbloquear_projeto, que apaga todas as travas do projeto. Como até
--   a cota (3) de avaliadores pode estar com o mesmo projeto, soltar uma linha
--   derrubava os outros avaliadores, que perdiam a avaliação em andamento
--   (fn_enviar_avaliacao exige a trava).
--   admin_desbloquear_trava(p_id_lock) apaga só aquela trava e devolve se ela
--   ainda existia (false = já tinha expirado ou sido liberada).
-- PRÉ-REQUISITO: public.is_admin() (20261026000000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_desbloquear_trava(p_id_lock uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apagadas integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.locks_ativos WHERE id_lock = p_id_lock;
  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RETURN v_apagadas > 0;
END;
$$;

COMMENT ON FUNCTION public.admin_desbloquear_trava(uuid) IS
  'Admin libera a trava de um avaliador (uma linha de locks_ativos), sem afetar os outros avaliadores do projeto.';

REVOKE ALL ON FUNCTION public.admin_desbloquear_trava(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_desbloquear_trava(uuid) TO authenticated, service_role;

COMMIT;
