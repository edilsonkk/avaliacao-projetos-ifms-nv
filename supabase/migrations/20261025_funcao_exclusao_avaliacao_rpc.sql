-- ------------------------------------------------------------------------------
-- MIGRATION: 20261025_funcao_exclusao_avaliacao_rpc.sql
-- DESCRIÇÃO: Funções PL/pgSQL com SECURITY DEFINER para exclusão segura 
--            (soft-delete) e restauração de avaliações via RPC no Supabase.
-- ------------------------------------------------------------------------------

-- 1. Function para exclusão (Soft Delete) de avaliação
CREATE OR REPLACE FUNCTION public.excluir_avaliacao(p_id_avaliacao UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_projeto UUID;
  v_id_usuario UUID;
  v_status_antigo VARCHAR;
BEGIN
  -- Verifica existência da avaliação
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

  -- Atualiza o status para CANCELADA (soft delete)
  -- Remove flag de quarentena se houver para não deixar em estado inconsistente
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

-- 2. Function para restauração de avaliação previamente cancelada (Desfazer / Undo)
CREATE OR REPLACE FUNCTION public.restaurar_avaliacao(p_id_avaliacao UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_projeto UUID;
  v_id_usuario UUID;
BEGIN
  -- Verifica existência da avaliação
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

  -- Restaura o status para CONCLUIDA
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

-- Permissões de execução para usuários autenticados e chave anon
GRANT EXECUTE ON FUNCTION public.excluir_avaliacao(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.restaurar_avaliacao(UUID) TO authenticated, anon, service_role;
