-- ==============================================================================
-- MIGRATION: 20261026030000_proteger_funcoes_admin.sql
-- DESCRIÇÃO: Fecha a execução ANÔNIMA das funções administrativas.
--
--   As funções admin_* / excluir_avaliacao / restaurar_avaliacao são
--   SECURITY DEFINER, não checam quem chama e têm GRANT EXECUTE ... TO anon.
--   Hoje qualquer visitante anônimo chama admin_reset_global() e apaga o
--   evento inteiro, ou cancela/restaura avaliações.
--
--   Correção (zero risco de regressão, sem reescrever corpos): REVOKE EXECUTE
--   de anon/PUBLIC e GRANT só a authenticated/service_role. Como avaliador e
--   Staff são anon e só o Admin possui sessão authenticated, isso restringe
--   essas operações ao Admin.
--
--   Camada extra (defense-in-depth): guard explícito is_admin() dentro de
--   excluir_avaliacao/restaurar_avaliacao (corpos curtos, reproduzidos
--   verbatim de schema.sql), protegendo mesmo que surja um authenticated
--   não-admin no futuro.
--
--   sortear_proximo_projeto/sortear_projeto NÃO são tocadas: o avaliador anon
--   precisa delas.
--
-- PRÉ-REQUISITO: a função public.is_admin() (criada em 20261026000000).
-- IDEMPOTENTE. APLICAÇÃO: colar no SQL Editor do Supabase e executar.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. REVOKE/GRANT de EXECUTE em todas as funções administrativas.
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_reset_global(uuid)          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_desbloquear_todos()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_desbloquear_projeto(uuid)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_remover_quarentena(uuid)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_remover_quarentena_todos()  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.excluir_avaliacao(uuid)           FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restaurar_avaliacao(uuid)         FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_reset_global(uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_desbloquear_todos()         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_desbloquear_projeto(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena(uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena_todos()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_avaliacao(uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restaurar_avaliacao(uuid)         TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. Guard is_admin() em excluir/restaurar (reproduzidos verbatim + a checagem).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_avaliacao(p_id_avaliacao UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_projeto UUID;
  v_id_usuario UUID;
  v_status_antigo VARCHAR;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id_projeto, id_usuario, status
  INTO v_id_projeto, v_id_usuario, v_status_antigo
  FROM public.avaliacoes
  WHERE id_avaliacao = p_id_avaliacao;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'mensagem', 'Avaliação não encontrada no sistema.'
    );
  END IF;

  UPDATE public.avaliacoes
  SET
    status = 'CANCELADA',
    status_avaliacao = 'CANCELADA',
    is_quarentena = false
  WHERE id_avaliacao = p_id_avaliacao;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', p_id_avaliacao,
    'id_projeto', v_id_projeto,
    'id_usuario', v_id_usuario,
    'status_anterior', v_status_antigo,
    'novo_status', 'CANCELADA',
    'mensagem', 'Avaliação cancelada com sucesso.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.restaurar_avaliacao(p_id_avaliacao UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_projeto UUID;
  v_id_usuario UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id_projeto, id_usuario
  INTO v_id_projeto, v_id_usuario
  FROM public.avaliacoes
  WHERE id_avaliacao = p_id_avaliacao;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'mensagem', 'Avaliação não encontrada no sistema.'
    );
  END IF;

  UPDATE public.avaliacoes
  SET
    status = 'CONCLUIDA',
    status_avaliacao = 'concluida'
  WHERE id_avaliacao = p_id_avaliacao;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', p_id_avaliacao,
    'id_projeto', v_id_projeto,
    'id_usuario', v_id_usuario,
    'novo_status', 'CONCLUIDA',
    'mensagem', 'Avaliação restaurada com sucesso.'
  );
END;
$$;

-- Reaplica os privilégios após o CREATE OR REPLACE (mantém o lockdown do passo 1).
REVOKE EXECUTE ON FUNCTION public.excluir_avaliacao(uuid)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restaurar_avaliacao(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.excluir_avaliacao(uuid)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.restaurar_avaliacao(uuid) TO authenticated, service_role;

COMMIT;
