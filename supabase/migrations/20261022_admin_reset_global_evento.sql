-- ==============================================================================
-- MIGRATION: 20261022_admin_reset_global_evento.sql
-- Stored Procedure Resiliente para Reset Global do Evento Ativo
-- Compatível com safeupdate e com esquemas legados (sem coluna id_evento em projetos/questionarios).
-- Escopo: Ciclo avaliativo, notas, travas, projetos, questionários, staff e avaliadores.
-- Preserva estritamente Administradores, Superadmins e o Evento ativo.
-- ==============================================================================

-- 1. Garante colunas id_evento com segurança caso ainda não existam no Supabase
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'projetos' AND column_name = 'id_evento'
  ) THEN
    BEGIN
      ALTER TABLE public.projetos ADD COLUMN id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'questionarios' AND column_name = 'id_evento'
  ) THEN
    BEGIN
      ALTER TABLE public.questionarios ADD COLUMN id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;

-- 2. Remove assinaturas anteriores para evitar conflitos de overloading
DROP FUNCTION IF EXISTS public.admin_reset_global();
DROP FUNCTION IF EXISTS public.admin_reset_global(UUID);

-- 3. Stored Procedure resiliente
CREATE OR REPLACE FUNCTION public.admin_reset_global(p_id_evento UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id_evento UUID;
BEGIN
  -- 1. Determina o evento alvo (se especificado ou ativo)
  IF p_id_evento IS NOT NULL THEN
    v_id_evento := p_id_evento;
  ELSE
    SELECT id_evento INTO v_id_evento FROM public.eventos WHERE is_ativo = true LIMIT 1;
  END IF;

  -- 2. Limpeza de respostas de avaliação (com WHERE clause para safeupdate)
  DELETE FROM public.respostas_avaliacao 
  WHERE id_avaliacao IS NOT NULL;

  -- 3. Limpeza de avaliações (com WHERE clause para safeupdate)
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

  -- 7. Limpeza de projetos
  -- Usa execução dinâmica para tolerar tabelas com ou sem coluna id_evento
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'projetos' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.projetos WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.projetos WHERE id_projeto IS NOT NULL;
  END IF;

  -- Fallback para tabela legada no singular 'projeto', se existir
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'projeto'
  ) THEN
    EXECUTE 'DELETE FROM public.projeto WHERE id IS NOT NULL';
  END IF;

  -- 8. Limpeza de perguntas e questionários
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

  -- Fallback para tabela legada no singular 'questionario', se existir
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'questionario'
  ) THEN
    EXECUTE 'DELETE FROM public.questionario WHERE id IS NOT NULL';
  END IF;

  -- 9. Desassociação de avaliadores e staff do evento
  IF v_id_evento IS NOT NULL THEN
    DELETE FROM public.avaliadores_evento WHERE id_evento = v_id_evento;
  ELSE
    DELETE FROM public.avaliadores_evento WHERE id_usuario IS NOT NULL;
  END IF;

  -- 10. Exclusão de usuários temporários (AVALIADOR e STAFF)
  -- Preserva estritamente Administradores e Superadmins
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

-- Permissões de execução
GRANT EXECUTE ON FUNCTION public.admin_reset_global(UUID) TO authenticated, anon, service_role;
