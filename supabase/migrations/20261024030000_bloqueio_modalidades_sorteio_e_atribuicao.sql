-- ==============================================================================
-- MIGRATION: 20261024030000_bloqueio_modalidades_sorteio_e_atribuicao.sql
-- DESCRIÇÃO: 
-- 1. Garante a tabela 'avaliador_modalidades_bloqueadas', índices e políticas RLS
-- 2. Concede permissões completas (GRANT ALL) para anon, authenticated e service_role
-- 3. Atualiza a Stored Procedure 'sortear_proximo_projeto' e 'sortear_projeto' com filtro estrito por UUID
-- 4. Expurgamento imediato de travas ativas (locks) e filas que conflitem com modalidades bloqueadas
-- ==============================================================================

-- 1. TABELA avaliador_modalidades_bloqueadas
CREATE TABLE IF NOT EXISTS public.avaliador_modalidades_bloqueadas (
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_evento UUID NOT NULL REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  id_modalidade UUID NOT NULL REFERENCES public.modalidades(id_modalidade) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id_usuario, id_evento, id_modalidade)
);

CREATE INDEX IF NOT EXISTS idx_amb_usuario_evento ON public.avaliador_modalidades_bloqueadas(id_usuario, id_evento);
CREATE INDEX IF NOT EXISTS idx_amb_modalidade ON public.avaliador_modalidades_bloqueadas(id_modalidade);

-- Habilita RLS e cria política de acesso livre para leitura e escrita
ALTER TABLE public.avaliador_modalidades_bloqueadas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'avaliador_modalidades_bloqueadas' 
      AND policyname = 'politica_amb_livre'
  ) THEN
    CREATE POLICY politica_amb_livre ON public.avaliador_modalidades_bloqueadas 
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.avaliador_modalidades_bloqueadas TO anon, authenticated, service_role;

-- 2. TABELA fila_atribuicoes_direcionadas (Garante existência para evitar erro 42P01)
CREATE TABLE IF NOT EXISTS public.fila_atribuicoes_direcionadas (
  id_atribuicao UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_projeto UUID NOT NULL REFERENCES public.projetos(id_projeto) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fila_atribuicoes_usuario ON public.fila_atribuicoes_direcionadas(id_usuario, status, ordem);
CREATE INDEX IF NOT EXISTS idx_fila_atribuicoes_projeto ON public.fila_atribuicoes_direcionadas(id_projeto);

ALTER TABLE public.fila_atribuicoes_direcionadas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'fila_atribuicoes_direcionadas' 
      AND policyname = 'politica_fila_atribuicoes_livre'
  ) THEN
    CREATE POLICY politica_fila_atribuicoes_livre ON public.fila_atribuicoes_direcionadas 
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.fila_atribuicoes_direcionadas TO anon, authenticated, service_role;

-- 3. TABELA historico_impedimentos (Garante existência)
CREATE TABLE IF NOT EXISTS public.historico_impedimentos (
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_projeto UUID NOT NULL REFERENCES public.projetos(id_projeto) ON DELETE CASCADE,
  tipo VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id_usuario, id_projeto, tipo, created_at)
);

ALTER TABLE public.historico_impedimentos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'historico_impedimentos' 
      AND policyname = 'politica_historico_impedimentos_livre'
  ) THEN
    CREATE POLICY politica_historico_impedimentos_livre ON public.historico_impedimentos 
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.historico_impedimentos TO anon, authenticated, service_role;

-- 4. TABELA avaliacoes (Garante colunas status e status_avaliacao para evitar erro 42703)
ALTER TABLE public.avaliacoes ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'CONCLUIDA';
ALTER TABLE public.avaliacoes ADD COLUMN IF NOT EXISTS status_avaliacao VARCHAR(30) DEFAULT 'concluida';
UPDATE public.avaliacoes SET status = 'CONCLUIDA' WHERE status IS NULL;
UPDATE public.avaliacoes SET status_avaliacao = 'concluida' WHERE status_avaliacao IS NULL;

-- 5. ATUALIZAÇÃO DA STORED PROCEDURE sortear_proximo_projeto
CREATE OR REPLACE FUNCTION public.sortear_proximo_projeto(p_id_usuario UUID, p_id_evento UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- 4. Obtém o tempo de timeout e cota padrão configurados no evento
  SELECT COALESCE(minutos_timeout_lock, 30), COALESCE(cota_avaliacoes_padrao, 3)
  INTO v_minutos_lock, v_cota_padrao
  FROM public.eventos
  WHERE id_evento = p_id_evento;

  -- 5. Seleciona o projeto mais prioritário que:
  --    a) Pertence ao evento ativo e tem check-in presencial confirmado;
  --    b) Não é da mesma instituição do avaliador (se vinculada);
  --    c) Não pertence a modalidade bloqueada para este avaliador (critério estrito por UUID);
  --    d) Não está bloqueado atualmente por outro avaliador;
  --    e) Não foi avaliado anteriormente por este avaliador (exceto se cancelada);
  --    f) Não possui impedimento registrado (ausência/conflito) por este avaliador;
  --    g) Respeita a cota estrita (avaliações concluídas + locks < cota);
  --    h) Ordena prioritariamente por topo da fila, menos avaliações recebidas, menos faltas e estande.
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
      SELECT a.id_projeto FROM public.avaliacoes a 
      WHERE a.id_usuario = p_id_usuario 
        AND (a.status IS NULL OR a.status != 'CANCELADA')
    )
    AND p.id_projeto NOT IN (
      SELECT hi.id_projeto FROM public.historico_impedimentos hi WHERE hi.id_usuario = p_id_usuario
    )
    AND (
      (
        SELECT COUNT(*) 
        FROM public.avaliacoes a 
        WHERE a.id_projeto = p.id_projeto 
          AND (a.status IS NULL OR a.status != 'CANCELADA')
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
        AND (a.status IS NULL OR a.status != 'CANCELADA')
    ) ASC,
    p.contagem_ausencia ASC,
    p.estande ASC
  LIMIT 1;

  -- 6. Se encontrou um projeto, insere a trava na tabela locks_ativos
  IF v_id_projeto_sorteado IS NOT NULL THEN
    INSERT INTO public.locks_ativos (id_usuario, id_projeto, bloqueado_em, expira_em)
    VALUES (
      p_id_usuario,
      v_id_projeto_sorteado,
      now(),
      now() + (v_minutos_lock || ' minutes')::interval
    );
  END IF;

  RETURN v_id_projeto_sorteado;
END;
$$;

-- Alias de compatibilidade
CREATE OR REPLACE FUNCTION public.sortear_projeto(p_id_usuario UUID, p_id_evento UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.sortear_proximo_projeto(p_id_usuario, p_id_evento);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sortear_proximo_projeto(UUID, UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sortear_projeto(UUID, UUID) TO authenticated, anon, service_role;

-- 3. EXPURGAMENTO IMEDIATO DE TRAVAS E FILAS CONFLITANTES
DELETE FROM public.locks_ativos l
USING public.projetos p, public.avaliador_modalidades_bloqueadas amb
WHERE l.id_projeto = p.id_projeto
  AND l.id_usuario = amb.id_usuario
  AND p.id_modalidade = amb.id_modalidade
  AND p.id_evento = amb.id_evento;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'fila_atribuicoes_direcionadas'
  ) THEN
    EXECUTE '
      DELETE FROM public.fila_atribuicoes_direcionadas f
      USING public.projetos p, public.avaliador_modalidades_bloqueadas amb
      WHERE f.id_projeto = p.id_projeto
        AND f.id_usuario = amb.id_usuario
        AND p.id_modalidade = amb.id_modalidade
        AND p.id_evento = amb.id_evento
    ';
  END IF;
END $$;
