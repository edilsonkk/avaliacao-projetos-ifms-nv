-- ==============================================================================
-- MIGRATION: 20261024_instituicoes_modalidades_evento_e_reset.sql
-- DESCRIÇÃO: 
-- 1. Vincula tabelas 'instituicoes' e 'modalidades' ao evento ativo (id_evento)
-- 2. Torna 'sigla' opcional em instituicoes (DROP NOT NULL)
-- 3. Atualiza 'admin_reset_global' para excluir Instituições e Modalidades do evento ativo
-- 4. Reforça cálculo de cota estrita em 'sortear_proximo_projeto'
-- ==============================================================================

-- 1. ADICIONA id_evento EM instituicoes E modalidades (CASO NÃO EXISTA)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'instituicoes' AND column_name = 'id_evento'
  ) THEN
    ALTER TABLE public.instituicoes 
      ADD COLUMN id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'modalidades' AND column_name = 'id_evento'
  ) THEN
    ALTER TABLE public.modalidades 
      ADD COLUMN id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. TORNA A COLUNA SIGLA OPCIONAL NA TABELA INSTITUICOES
ALTER TABLE public.instituicoes ALTER COLUMN sigla DROP NOT NULL;

-- 3. MIGRAÇÃO DE REGISTROS LEGADOS EXISTENTES PARA O EVENTO ATIVO ATUAL
DO $$
DECLARE
  v_ativo UUID;
BEGIN
  SELECT id_evento INTO v_ativo FROM public.eventos WHERE is_ativo = true LIMIT 1;
  IF v_ativo IS NOT NULL THEN
    UPDATE public.instituicoes SET id_evento = v_ativo WHERE id_evento IS NULL;
    UPDATE public.modalidades SET id_evento = v_ativo WHERE id_evento IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_instituicoes_evento ON public.instituicoes(id_evento);
CREATE INDEX IF NOT EXISTS idx_modalidades_evento ON public.modalidades(id_evento);

-- 4. ATUALIZAÇÃO DA STORED PROCEDURE admin_reset_global
DROP FUNCTION IF EXISTS public.admin_reset_global();
DROP FUNCTION IF EXISTS public.admin_reset_global(UUID);

CREATE OR REPLACE FUNCTION public.admin_reset_global(p_id_evento UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id_evento UUID;
BEGIN
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

  -- 10. Limpeza de Modalidades e Níveis do evento ativo (aliases são deletados por CASCADE)
  IF v_id_evento IS NOT NULL THEN
    DELETE FROM public.modalidades WHERE id_evento = v_id_evento;
  ELSE
    DELETE FROM public.modalidades WHERE id_modalidade IS NOT NULL;
  END IF;

  -- 11. Limpeza de Instituições do evento ativo (aliases são deletados por CASCADE)
  IF v_id_evento IS NOT NULL THEN
    DELETE FROM public.instituicoes WHERE id_evento = v_id_evento;
  ELSE
    DELETE FROM public.instituicoes WHERE id_instituicao IS NOT NULL;
  END IF;

  -- 12. Exclusão de usuários temporários (AVALIADOR e STAFF)
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

GRANT EXECUTE ON FUNCTION public.admin_reset_global(UUID) TO authenticated, anon, service_role;

-- 5. ATUALIZAÇÃO DA STORED PROCEDURE sortear_proximo_projeto
CREATE OR REPLACE FUNCTION public.sortear_proximo_projeto(p_id_usuario UUID, p_id_evento UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_instituicao_avaliador UUID;
  v_id_projeto_sorteado UUID;
  v_minutos_lock INTEGER := 30;
  v_cota_padrao INTEGER := 3;
BEGIN
  -- 1. Limpa locks expirados do sistema
  DELETE FROM public.locks_ativos 
  WHERE expira_em < now();

  -- 2. Limpa lock anterior do avaliador, se houver
  DELETE FROM public.locks_ativos 
  WHERE id_usuario = p_id_usuario;

  -- 3. Obtém instituição de origem do avaliador para evitar conflito de interesse
  SELECT id_instituicao INTO v_id_instituicao_avaliador
  FROM public.avaliadores_evento
  WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;

  -- 4. Obtém o tempo de timeout e cota padrão do evento
  SELECT COALESCE(minutos_timeout_lock, 30), COALESCE(cota_avaliacoes_padrao, 3)
  INTO v_minutos_lock, v_cota_padrao
  FROM public.eventos
  WHERE id_evento = p_id_evento;

  -- 5. Seleciona o projeto mais prioritário que:
  --    a) Pertence ao evento ativo e tem check-in presencial confirmado;
  --    b) Não é da mesma instituição do avaliador (se vinculada);
  --    c) Não pertence a modalidade bloqueada para este avaliador;
  --    d) Não está bloqueado atualmente por outro avaliador;
  --    e) Não foi avaliado anteriormente por este avaliador;
  --    f) Não possui impedimento registrado por este avaliador;
  --    g) Respeita estritamente a cota (feitas + locks < cota);
  --    h) Ordena por topo da fila, menos avaliações, menos ausências e estande.
  SELECT p.id_projeto INTO v_id_projeto_sorteado
  FROM public.projetos p
  LEFT JOIN public.locks_ativos l ON l.id_projeto = p.id_projeto
  WHERE p.id_evento = p_id_evento
    AND p.is_check_in_realizado = true
    AND p.is_fora_da_competicao = false
    AND l.id_projeto IS NULL
    AND (v_id_instituicao_avaliador IS NULL OR p.id_instituicao IS DISTINCT FROM v_id_instituicao_avaliador)
    AND (
      p.id_modalidade IS NULL OR p.id_modalidade NOT IN (
        SELECT amb.id_modalidade 
        FROM public.avaliador_modalidades_bloqueadas amb 
        WHERE amb.id_usuario = p_id_usuario AND amb.id_evento = p_id_evento
      )
    )
    AND p.id_projeto NOT IN (
      SELECT a.id_projeto FROM public.avaliacoes a WHERE a.id_usuario = p_id_usuario
    )
    AND p.id_projeto NOT IN (
      SELECT hi.id_projeto FROM public.historico_impedimentos hi WHERE hi.id_usuario = p_id_usuario
    )
    AND (
      (
        SELECT COUNT(*) 
        FROM public.avaliacoes a 
        WHERE a.id_projeto = p.id_projeto
      ) +
      (
        SELECT COUNT(*) 
        FROM public.locks_ativos lk 
        WHERE lk.id_projeto = p.id_projeto
      )
    ) < COALESCE(p.cota_avaliacoes_customizada, v_cota_padrao)
  ORDER BY 
    p.forcar_topo_fila DESC,
    (
      SELECT COUNT(*) 
      FROM public.avaliacoes a 
      WHERE a.id_projeto = p.id_projeto
    ) ASC,
    p.contagem_ausencia ASC,
    p.estande ASC
  LIMIT 1;

  -- 6. Se um projeto elegível foi encontrado, cria lock ativo imediato para este avaliador
  IF v_id_projeto_sorteado IS NOT NULL THEN
    INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em)
    VALUES (p_id_usuario, v_id_projeto_sorteado, now() + (v_minutos_lock || ' minutes')::interval);
  END IF;

  RETURN v_id_projeto_sorteado;
END;
$$;

-- Suporte a alias de RPC (sortear_projeto / sortear_proximo_projeto)
CREATE OR REPLACE FUNCTION public.sortear_projeto(p_id_usuario UUID, p_id_evento UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.sortear_proximo_projeto(p_id_usuario, p_id_evento);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sortear_proximo_projeto(UUID, UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sortear_projeto(UUID, UUID) TO authenticated, anon, service_role;
