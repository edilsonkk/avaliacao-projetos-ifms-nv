-- ==============================================================================
-- MIGRATION: 20261028200000_proteger_funcoes_admin_e_relatorios.sql
-- DESCRIÇÃO: Fase 0 da correção de segurança (docs/arquitetura/seguranca.md).
--   * C1: as funções admin_* não checavam quem chama, só estavam fechadas para
--     anon. Qualquer conta criada no Supabase Auth (cadastro público aberto)
--     conseguia rodar admin_reset_global. Agora todas exigem is_admin().
--     Corpos reproduzidos verbatim da última definição + guard no início.
--   * H2: fn_relatorio_* eram SECURITY DEFINER e executáveis por anon,
--     ignorando RLS e privilégios de coluna (notas). Passam a SECURITY INVOKER
--     (respeitam a RLS de quem chama) e deixam de ser executáveis por anon.
--   * search_path fixo em toda função SECURITY DEFINER.
-- PRÉ-REQUISITO: public.is_admin() (20261026000000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Funções administrativas: guard is_admin() + search_path fixo
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reset_global(p_id_evento UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id_evento UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  -- 1. Determina o evento alvo (especificado ou ativo)
  IF p_id_evento IS NOT NULL THEN
    v_id_evento := p_id_evento;
  ELSE
    SELECT id_evento INTO v_id_evento FROM public.eventos WHERE is_ativo = true LIMIT 1;
  END IF;

  -- 2. Limpeza de respostas de avaliação
  DELETE FROM public.respostas_avaliacao 
  WHERE id_avaliacao IS NOT NULL;

  -- 3. Limpeza de avaliações
  DELETE FROM public.avaliacoes 
  WHERE id_avaliacao IS NOT NULL;

  -- 4. Limpeza da fila de bancas / atribuições direcionadas (se existir)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'fila_atribuicoes_direcionadas'
  ) THEN
    EXECUTE 'DELETE FROM public.fila_atribuicoes_direcionadas WHERE id_atribuicao IS NOT NULL';
  END IF;

  -- 5. Limpeza de travas ativas (locks) de estandes
  DELETE FROM public.locks_ativos 
  WHERE id_lock IS NOT NULL;

  -- 6. Limpeza do histórico de impedimentos e ausências
  DELETE FROM public.historico_impedimentos 
  WHERE id_usuario IS NOT NULL;

  -- 7. Limpeza de projetos vinculados ao evento
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'projetos' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.projetos WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.projetos WHERE id_projeto IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'projeto'
  ) THEN
    EXECUTE 'DELETE FROM public.projeto WHERE id IS NOT NULL';
  END IF;

  -- 8. Limpeza de questionários do evento
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'perguntas_questionario'
  ) THEN
    EXECUTE 'DELETE FROM public.perguntas_questionario WHERE id_pergunta IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'questionarios' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.questionarios WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.questionarios WHERE id_questionario IS NOT NULL;
  END IF;

  -- 9. Desassociação de avaliadores e staff do evento
  IF v_id_evento IS NOT NULL THEN
    DELETE FROM public.avaliadores_evento WHERE id_evento = v_id_evento;
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'avaliador_modalidades_bloqueadas'
    ) THEN
      DELETE FROM public.avaliador_modalidades_bloqueadas WHERE id_evento = v_id_evento;
    END IF;
  ELSE
    DELETE FROM public.avaliadores_evento WHERE id_usuario IS NOT NULL;
  END IF;

  -- 10. Limpeza de Áreas Temáticas do evento ativo
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'areas_tematicas' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.areas_tematicas WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'areas_tematicas'
  ) THEN
    DELETE FROM public.areas_tematicas WHERE id_area IS NOT NULL;
  END IF;

  -- 11. Limpeza de Modalidades e Níveis do evento ativo (aliases são deletados por CASCADE)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'modalidades' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.modalidades WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.modalidades WHERE id_modalidade IS NOT NULL;
  END IF;

  -- 12. Limpeza de Instituições do evento ativo (aliases são deletados por CASCADE)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'instituicoes' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.instituicoes WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.instituicoes WHERE id_instituicao IS NOT NULL;
  END IF;

  -- 13. Exclusão de usuários temporários (AVALIADOR e STAFF)
  DELETE FROM public.usuarios
  WHERE papel IN ('AVALIADOR', 'STAFF')
    AND papel NOT IN ('ADMIN', 'SUPERADMIN')
    AND id_usuario IS NOT NULL;

  RETURN jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Reset Global executado com sucesso.',
    'id_evento', v_id_evento
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_desbloquear_todos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.locks_ativos 
  WHERE id_lock IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_desbloquear_projeto(p_id_projeto UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.locks_ativos 
  WHERE id_projeto = p_id_projeto;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remover_quarentena(p_id_projeto UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.avaliacoes
  SET is_quarentena = false
  WHERE id_projeto = p_id_projeto;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remover_quarentena_todos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.avaliacoes
  SET is_quarentena = false
  WHERE id_avaliacao IS NOT NULL;
END;
$$;

-- Privilégios (mantém o lockdown de 20261026030000)
REVOKE EXECUTE ON FUNCTION public.admin_reset_global(uuid)          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_desbloquear_todos()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_desbloquear_projeto(uuid)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_remover_quarentena(uuid)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_remover_quarentena_todos()  FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reset_global(uuid)          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_desbloquear_todos()         TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_desbloquear_projeto(uuid)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_remover_quarentena(uuid)    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_remover_quarentena_todos()  TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. Relatórios: SECURITY INVOKER e sem acesso anônimo
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.fn_relatorio_ausencias_completo(uuid) SECURITY INVOKER;
ALTER FUNCTION public.fn_relatorio_ausencias_completo(uuid) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.fn_relatorio_ausencias_completo(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_relatorio_ausencias_completo(uuid) TO authenticated, service_role;
ALTER FUNCTION public.fn_relatorio_avaliadores_completo(uuid) SECURITY INVOKER;
ALTER FUNCTION public.fn_relatorio_avaliadores_completo(uuid) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.fn_relatorio_avaliadores_completo(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_relatorio_avaliadores_completo(uuid) TO authenticated, service_role;
ALTER FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) SECURITY INVOKER;
ALTER FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) TO authenticated, service_role;
ALTER FUNCTION public.fn_relatorio_instituicoes_completo(uuid) SECURITY INVOKER;
ALTER FUNCTION public.fn_relatorio_instituicoes_completo(uuid) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.fn_relatorio_instituicoes_completo(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_relatorio_instituicoes_completo(uuid) TO authenticated, service_role;
ALTER FUNCTION public.fn_relatorio_projetos_completo(uuid) SECURITY INVOKER;
ALTER FUNCTION public.fn_relatorio_projetos_completo(uuid) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.fn_relatorio_projetos_completo(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_relatorio_projetos_completo(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. Demais funções SECURITY DEFINER: search_path fixo
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.sortear_projeto(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.sortear_proximo_projeto(uuid, uuid) SET search_path = public, pg_temp;

COMMIT;
