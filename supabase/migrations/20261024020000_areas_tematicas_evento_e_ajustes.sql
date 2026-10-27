-- ==============================================================================
-- MIGRATION: 20261024020000_areas_tematicas_evento_e_ajustes.sql
-- DESCRIÇÃO: 
-- 1. Vincula tabelas 'instituicoes', 'modalidades' e 'areas_tematicas' ao evento ativo (id_evento)
-- 2. Adiciona coluna 'created_at' em instituicoes, modalidades e areas_tematicas caso inexistente
-- 3. Torna 'sigla' opcional em instituicoes (DROP NOT NULL)
-- 4. Migra registros legados sem evento para o evento ativo atual
-- 5. Desduplica registros legados com segurança (ordenando por id_*, sem depender de created_at)
-- 6. Cria índices e restrições UNIQUE por evento em Instituições, Modalidades e Áreas Temáticas
-- 7. Atualiza 'admin_reset_global' para incluir a exclusão atômica de Áreas Temáticas do evento ativo
-- ==============================================================================

-- 1. ADICIONA id_evento E created_at EM instituicoes, modalidades E areas_tematicas
ALTER TABLE public.instituicoes ADD COLUMN IF NOT EXISTS id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE;
ALTER TABLE public.modalidades ADD COLUMN IF NOT EXISTS id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE;
ALTER TABLE public.areas_tematicas ADD COLUMN IF NOT EXISTS id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE;

ALTER TABLE public.instituicoes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.modalidades ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.areas_tematicas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

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
    UPDATE public.areas_tematicas SET id_evento = v_ativo WHERE id_evento IS NULL;
  END IF;
END $$;

-- 4. DESDUPLICAÇÃO SEGURA ANTES DE CRIAR ÍNDICES ÚNICOS (Ordena por ID sem depender de created_at)
-- A. Áreas Temáticas
DO $$
DECLARE
  rec RECORD;
  v_keep_id UUID;
BEGIN
  FOR rec IN
    SELECT id_evento, nome_area, ARRAY_AGG(id_area ORDER BY id_area ASC) AS ids
    FROM public.areas_tematicas
    GROUP BY id_evento, nome_area
    HAVING COUNT(*) > 1
  LOOP
    v_keep_id := rec.ids[1];
    UPDATE public.projetos 
    SET id_area = v_keep_id 
    WHERE id_area = ANY(rec.ids[2:]);

    DELETE FROM public.areas_tematicas 
    WHERE id_area = ANY(rec.ids[2:]);
  END LOOP;
END $$;

-- B. Modalidades
DO $$
DECLARE
  rec RECORD;
  v_keep_id UUID;
BEGIN
  FOR rec IN
    SELECT id_evento, nome_modalidade, ARRAY_AGG(id_modalidade ORDER BY id_modalidade ASC) AS ids
    FROM public.modalidades
    GROUP BY id_evento, nome_modalidade
    HAVING COUNT(*) > 1
  LOOP
    v_keep_id := rec.ids[1];
    UPDATE public.projetos 
    SET id_modalidade = v_keep_id 
    WHERE id_modalidade = ANY(rec.ids[2:]);

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'avaliador_modalidades_bloqueadas') THEN
      DELETE FROM public.avaliador_modalidades_bloqueadas a1
      WHERE a1.id_modalidade = ANY(rec.ids[2:])
        AND EXISTS (
          SELECT 1 FROM public.avaliador_modalidades_bloqueadas a2
          WHERE a2.id_usuario = a1.id_usuario
            AND a2.id_evento = a1.id_evento
            AND a2.id_modalidade = v_keep_id
        );

      UPDATE public.avaliador_modalidades_bloqueadas
      SET id_modalidade = v_keep_id
      WHERE id_modalidade = ANY(rec.ids[2:]);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'modalidade_aliases') THEN
      DELETE FROM public.modalidade_aliases a1
      WHERE a1.id_modalidade = ANY(rec.ids[2:])
        AND EXISTS (
          SELECT 1 FROM public.modalidade_aliases a2
          WHERE a2.id_evento = a1.id_evento
            AND a2.alias = a1.alias
            AND a2.id_modalidade = v_keep_id
        );

      UPDATE public.modalidade_aliases
      SET id_modalidade = v_keep_id
      WHERE id_modalidade = ANY(rec.ids[2:]);
    END IF;

    DELETE FROM public.modalidades 
    WHERE id_modalidade = ANY(rec.ids[2:]);
  END LOOP;
END $$;

-- C. Instituições
DO $$
DECLARE
  rec RECORD;
  v_keep_id UUID;
BEGIN
  FOR rec IN
    SELECT id_evento, nome_normalizado, ARRAY_AGG(id_instituicao ORDER BY id_instituicao ASC) AS ids
    FROM public.instituicoes
    GROUP BY id_evento, nome_normalizado
    HAVING COUNT(*) > 1
  LOOP
    v_keep_id := rec.ids[1];
    UPDATE public.projetos 
    SET id_instituicao = v_keep_id 
    WHERE id_instituicao = ANY(rec.ids[2:]);

    UPDATE public.avaliadores_evento
    SET id_instituicao = v_keep_id
    WHERE id_instituicao = ANY(rec.ids[2:]);

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'instituicao_aliases') THEN
      DELETE FROM public.instituicao_aliases a1
      WHERE a1.id_instituicao = ANY(rec.ids[2:])
        AND EXISTS (
          SELECT 1 FROM public.instituicao_aliases a2
          WHERE a2.id_evento = a1.id_evento
            AND a2.alias = a1.alias
            AND a2.id_instituicao = v_keep_id
        );

      UPDATE public.instituicao_aliases
      SET id_instituicao = v_keep_id
      WHERE id_instituicao = ANY(rec.ids[2:]);
    END IF;

    DELETE FROM public.instituicoes 
    WHERE id_instituicao = ANY(rec.ids[2:]);
  END LOOP;
END $$;

-- 5. CRIAÇÃO DE ÍNDICES E RESTRIÇÕES DE UNICIDADE
CREATE INDEX IF NOT EXISTS idx_instituicoes_evento ON public.instituicoes(id_evento);
CREATE INDEX IF NOT EXISTS idx_modalidades_evento ON public.modalidades(id_evento);
CREATE INDEX IF NOT EXISTS idx_areas_tematicas_evento ON public.areas_tematicas(id_evento);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_instituicoes_evento_norm ON public.instituicoes (id_evento, nome_normalizado) WHERE id_evento IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_modalidades_evento_nome ON public.modalidades (id_evento, nome_modalidade) WHERE id_evento IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_areas_tematicas_evento_nome ON public.areas_tematicas (id_evento, nome_area) WHERE id_evento IS NOT NULL;

-- 6. ATUALIZAÇÃO DA STORED PROCEDURE admin_reset_global
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

GRANT EXECUTE ON FUNCTION public.admin_reset_global(UUID) TO authenticated, anon, service_role;
