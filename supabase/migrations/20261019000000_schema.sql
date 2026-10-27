-- ==============================================================================
-- SISTEMA DE AVALIAÇÃO DE PROJETOS IFMS
-- DDL COMPLETO DO BANCO DE DADOS (PostgreSQL / Supabase)
-- Data de Exportação / Consolidação: 2026-10-19
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSÕES
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. TIPOS E ENUMS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'papel_usuario') THEN
    CREATE TYPE papel_usuario AS ENUM ('ADMIN', 'STAFF', 'AVALIADOR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_impedimento') THEN
    CREATE TYPE tipo_impedimento AS ENUM ('AUSENCIA', 'CONFLITO');
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. TABELA: instituicoes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instituicoes (
  id_instituicao UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_exibicao VARCHAR(255) NOT NULL,
  nome_normalizado VARCHAR(255) NOT NULL,
  sigla VARCHAR(50) NOT NULL,
  campus VARCHAR(150),
  cidade VARCHAR(150),
  estado VARCHAR(2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 4. TABELA: eventos
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.eventos (
  id_evento UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_evento VARCHAR(255) NOT NULL,
  edicao VARCHAR(100),
  descricao TEXT,
  logo_url TEXT,
  is_ativo BOOLEAN DEFAULT true,
  minutos_timeout_lock INTEGER DEFAULT 30,
  cota_avaliacoes_padrao INTEGER DEFAULT 3,
  limite_corte NUMERIC(5,2) DEFAULT 0.00,
  sistema_liberado BOOLEAN DEFAULT true,
  horario_inicio TIME,
  horario_fim TIME,
  intervalo_pausa_avaliador INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. TABELA: modalidades
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modalidades (
  id_modalidade UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_modalidade VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 6. TABELA: areas_tematicas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.areas_tematicas (
  id_area UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_area VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 7. TABELA: usuarios
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuarios (
  id_usuario UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  nome VARCHAR(255) NOT NULL,
  papel VARCHAR(50) DEFAULT 'AVALIADOR',
  senha_hash TEXT,
  cpf VARCHAR(14),
  celular VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 8. TABELA: questionarios
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.questionarios (
  id_questionario UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  titulo VARCHAR(255) NOT NULL,
  escala_minima NUMERIC(5,2) DEFAULT 0.00,
  escala_maxima NUMERIC(5,2) DEFAULT 10.00,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 9. TABELA: perguntas_questionario
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.perguntas_questionario (
  id_pergunta UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_questionario UUID REFERENCES public.questionarios(id_questionario) ON DELETE CASCADE,
  ordem INTEGER DEFAULT 1,
  texto_pergunta TEXT NOT NULL,
  peso_calculo NUMERIC(5,2) DEFAULT 1.00,
  peso_desempate NUMERIC(5,2) DEFAULT 1.00,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 10. TABELA: projetos
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos (
  id_projeto UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_projeto VARCHAR(50),
  codigo_legado VARCHAR(50),
  id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  id_instituicao UUID REFERENCES public.instituicoes(id_instituicao) ON DELETE SET NULL,
  id_area UUID REFERENCES public.areas_tematicas(id_area) ON DELETE SET NULL,
  id_modalidade UUID REFERENCES public.modalidades(id_modalidade) ON DELETE SET NULL,
  id_questionario_fixado UUID REFERENCES public.questionarios(id_questionario) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  estande VARCHAR(50),
  corredor VARCHAR(50),
  expositores TEXT,
  cota_avaliacoes_customizada INTEGER,
  contagem_ausencia INTEGER DEFAULT 0,
  is_check_in_realizado BOOLEAN DEFAULT false,
  is_fora_da_competicao BOOLEAN DEFAULT false,
  forcar_topo_fila BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 11. TABELA: avaliadores_evento
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.avaliadores_evento (
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_evento UUID NOT NULL REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  id_instituicao UUID REFERENCES public.instituicoes(id_instituicao) ON DELETE SET NULL,
  is_credenciado BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id_usuario, id_evento)
);

-- ------------------------------------------------------------------------------
-- 12. TABELA: avaliacoes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.avaliacoes (
  id_avaliacao UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_projeto UUID NOT NULL REFERENCES public.projetos(id_projeto) ON DELETE CASCADE,
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_questionario UUID REFERENCES public.questionarios(id_questionario) ON DELETE SET NULL,
  nota_final NUMERIC(5,2),
  parecer_final TEXT,
  tempo_presenca VARCHAR(50),
  is_quarentena BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 13. TABELA: respostas_avaliacao
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.respostas_avaliacao (
  id_resposta UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_avaliacao UUID NOT NULL REFERENCES public.avaliacoes(id_avaliacao) ON DELETE CASCADE,
  id_pergunta UUID NOT NULL REFERENCES public.perguntas_questionario(id_pergunta) ON DELETE CASCADE,
  nota_atribuida NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 14. TABELA: locks_ativos (Travas de Avaliação em Andamento)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locks_ativos (
  id_lock UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL UNIQUE REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_projeto UUID NOT NULL UNIQUE REFERENCES public.projetos(id_projeto) ON DELETE CASCADE,
  bloqueado_em TIMESTAMPTZ DEFAULT now(),
  expira_em TIMESTAMPTZ NOT NULL
);

-- ------------------------------------------------------------------------------
-- 15. TABELA: historico_impedimentos (Conflitos e Ausências)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.historico_impedimentos (
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_projeto UUID NOT NULL REFERENCES public.projetos(id_projeto) ON DELETE CASCADE,
  tipo VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id_usuario, id_projeto, tipo, created_at)
);

-- ------------------------------------------------------------------------------
-- 16. ÍNDICES DE PERFORMANCE
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projetos_evento ON public.projetos(id_evento);
CREATE INDEX IF NOT EXISTS idx_projetos_estande ON public.projetos(estande);
CREATE INDEX IF NOT EXISTS idx_projetos_area ON public.projetos(id_area);
CREATE INDEX IF NOT EXISTS idx_projetos_modalidade ON public.projetos(id_modalidade);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_projeto ON public.avaliacoes(id_projeto);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_usuario ON public.avaliacoes(id_usuario);
CREATE INDEX IF NOT EXISTS idx_locks_expira ON public.locks_ativos(expira_em);

-- ------------------------------------------------------------------------------
-- 17. VIEWS ANALÍTICAS
-- ------------------------------------------------------------------------------

-- View: view_relatorio_admin
CREATE OR REPLACE VIEW public.view_relatorio_admin AS
SELECT
  p.id_projeto,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  COALESCE(ROUND(AVG(a.nota_final)::numeric, 2), 0.00) AS media_notas
FROM public.projetos p
LEFT JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto
GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor;

-- View: view_avaliadores_credenciados
CREATE OR REPLACE VIEW public.view_avaliadores_credenciados AS
SELECT
  u.id_usuario,
  u.nome,
  u.email,
  ae.is_credenciado
FROM public.usuarios u
JOIN public.avaliadores_evento ae ON ae.id_usuario = u.id_usuario
WHERE ae.is_credenciado = true;

-- ------------------------------------------------------------------------------
-- 18. STORED PROCEDURES / RPCS (Compatíveis com safeupdate)
-- ------------------------------------------------------------------------------

-- 18.1 admin_reset_global
CREATE OR REPLACE FUNCTION public.admin_reset_global()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Exclui respostas de avaliação
  DELETE FROM public.respostas_avaliacao 
  WHERE id_avaliacao IS NOT NULL;

  -- 2. Exclui avaliações
  DELETE FROM public.avaliacoes 
  WHERE id_avaliacao IS NOT NULL;

  -- 3. Exclui todas as travas ativas de avaliadores
  DELETE FROM public.locks_ativos 
  WHERE id_lock IS NOT NULL;

  -- 4. Exclui histórico de impedimentos e ausências
  DELETE FROM public.historico_impedimentos 
  WHERE id_usuario IS NOT NULL;

  -- 5. Reseta status de check-in e faltas dos projetos
  UPDATE public.projetos 
  SET is_check_in_realizado = false, 
      contagem_ausencia = 0 
  WHERE id_projeto IS NOT NULL;
END;
$$;

-- 18.2 admin_desbloquear_todos
CREATE OR REPLACE FUNCTION public.admin_desbloquear_todos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.locks_ativos 
  WHERE id_lock IS NOT NULL;
END;
$$;

-- 18.3 admin_desbloquear_projeto
CREATE OR REPLACE FUNCTION public.admin_desbloquear_projeto(p_id_projeto UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.locks_ativos 
  WHERE id_projeto = p_id_projeto;
END;
$$;

-- 18.4 admin_repescagem_ausentes
CREATE OR REPLACE FUNCTION public.admin_repescagem_ausentes(p_id_evento UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.projetos 
  SET contagem_ausencia = 0 
  WHERE id_evento = p_id_evento
    AND id_projeto IS NOT NULL;
END;
$$;

-- 18.5 admin_remover_quarentena
CREATE OR REPLACE FUNCTION public.admin_remover_quarentena(p_id_projeto UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.avaliacoes
  SET is_quarentena = false
  WHERE id_projeto = p_id_projeto;
END;
$$;

-- 18.6 admin_remover_quarentena_todos
CREATE OR REPLACE FUNCTION public.admin_remover_quarentena_todos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.avaliacoes
  SET is_quarentena = false
  WHERE id_avaliacao IS NOT NULL;
END;
$$;

-- 18.7 sortear_proximo_projeto
CREATE OR REPLACE FUNCTION public.sortear_proximo_projeto(p_id_usuario UUID, p_id_evento UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_instituicao_avaliador UUID;
  v_id_projeto_sorteado UUID;
  v_minutos_lock INTEGER := 30;
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

  -- 4. Obtém o tempo de timeout configurado no evento
  SELECT COALESCE(minutos_timeout_lock, 30) INTO v_minutos_lock
  FROM public.eventos
  WHERE id_evento = p_id_evento;

  -- 5. Seleciona o projeto mais prioritário que:
  --    a) Pertence ao evento ativo e tem check-in presencial confirmado;
  --    b) Não é da mesma instituição do avaliador (se vinculada);
  --    c) Não está bloqueado atualmente por outro avaliador;
  --    d) Não foi avaliado anteriormente por este avaliador;
  --    e) Não possui impedimento registrado (ausência/conflito) por este avaliador;
  --    f) Ordena prioritariamente por projetos que precisam de mais avaliações para atingir a cota.
  SELECT p.id_projeto INTO v_id_projeto_sorteado
  FROM public.projetos p
  LEFT JOIN public.locks_ativos l ON l.id_projeto = p.id_projeto
  WHERE p.id_evento = p_id_evento
    AND p.is_check_in_realizado = true
    AND p.is_fora_da_competicao = false
    AND l.id_projeto IS NULL
    AND (v_id_instituicao_avaliador IS NULL OR p.id_instituicao IS DISTINCT FROM v_id_instituicao_avaliador)
    AND p.id_projeto NOT IN (
      SELECT a.id_projeto FROM public.avaliacoes a WHERE a.id_usuario = p_id_usuario
    )
    AND p.id_projeto NOT IN (
      SELECT hi.id_projeto FROM public.historico_impedimentos hi WHERE hi.id_usuario = p_id_usuario
    )
  ORDER BY 
    p.forcar_topo_fila DESC,
    (
      SELECT COUNT(*) FROM public.avaliacoes a WHERE a.id_projeto = p.id_projeto
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
AS $$
BEGIN
  RETURN public.sortear_proximo_projeto(p_id_usuario, p_id_evento);
END;
$$;

-- ------------------------------------------------------------------------------
-- 19. PERMISSÕES DE ACESSO (GRANT EXECUTE)
-- ------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.admin_reset_global() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_desbloquear_todos() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_desbloquear_projeto(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_repescagem_ausentes(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena_todos() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sortear_proximo_projeto(UUID, UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sortear_projeto(UUID, UUID) TO authenticated, anon, service_role;
