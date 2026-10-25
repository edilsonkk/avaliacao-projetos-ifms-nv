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
-- 3. TABELA: eventos
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
  data_evento DATE DEFAULT CURRENT_DATE,
  horario_inicio TIME,
  horario_fim TIME,
  intervalo_pausa_avaliador INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 4. TABELA: instituicoes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instituicoes (
  id_instituicao UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  nome_exibicao VARCHAR(255) NOT NULL,
  nome_normalizado VARCHAR(255) NOT NULL,
  sigla VARCHAR(50),
  campus VARCHAR(150),
  cidade VARCHAR(150),
  estado VARCHAR(2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. TABELA: modalidades
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modalidades (
  id_modalidade UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  codigo VARCHAR(50),
  nome_modalidade VARCHAR(150) NOT NULL,
  nivel VARCHAR(100),
  area_tematica VARCHAR(150),
  descricao TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 6. TABELA: areas_tematicas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.areas_tematicas (
  id_area UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
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
  status VARCHAR(30) DEFAULT 'CONCLUIDA',
  status_avaliacao VARCHAR(30) DEFAULT 'concluida',
  parecer_final TEXT,
  tempo_presenca VARCHAR(50),
  tempo_submissao TIMESTAMPTZ DEFAULT now(),
  is_quarentena BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unica_avaliacao_por_usuario UNIQUE (id_projeto, id_usuario)
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
  id_projeto UUID NOT NULL REFERENCES public.projetos(id_projeto) ON DELETE CASCADE,
  bloqueado_em TIMESTAMPTZ DEFAULT now(),
  expira_em TIMESTAMPTZ NOT NULL
);

-- ------------------------------------------------------------------------------
-- 14.1 TABELA: fila_atribuicoes_direcionadas (Enfileiramento 1-para-Vários)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fila_atribuicoes_direcionadas (
  id_atribuicao UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_projeto UUID NOT NULL REFERENCES public.projetos(id_projeto) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMPTZ DEFAULT now()
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
-- 16. TABELA: avaliador_modalidades_bloqueadas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.avaliador_modalidades_bloqueadas (
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_evento UUID NOT NULL REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  id_modalidade UUID NOT NULL REFERENCES public.modalidades(id_modalidade) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id_usuario, id_evento, id_modalidade)
);

CREATE INDEX IF NOT EXISTS idx_amb_usuario_evento ON public.avaliador_modalidades_bloqueadas(id_usuario, id_evento);
CREATE INDEX IF NOT EXISTS idx_amb_modalidade ON public.avaliador_modalidades_bloqueadas(id_modalidade);

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

-- ------------------------------------------------------------------------------
-- 16.1 TABELA: avaliador_areas (Áreas de Avaliação / Afinidade Temática)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.avaliador_areas (
  id_usuario UUID NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_evento UUID NOT NULL REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  id_area UUID NOT NULL REFERENCES public.areas_tematicas(id_area) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id_usuario, id_evento, id_area)
);

CREATE INDEX IF NOT EXISTS idx_aa_usuario_evento ON public.avaliador_areas(id_usuario, id_evento);
CREATE INDEX IF NOT EXISTS idx_aa_area ON public.avaliador_areas(id_area);

ALTER TABLE public.avaliador_areas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'avaliador_areas' 
      AND policyname = 'politica_avaliador_areas_livre'
  ) THEN
    CREATE POLICY politica_avaliador_areas_livre ON public.avaliador_areas 
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.avaliador_areas TO anon, authenticated, service_role;

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

-- View: view_ranking_top3
CREATE OR REPLACE VIEW public.view_ranking_top3 AS
SELECT
  p.id_projeto,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  COALESCE(m.nome_modalidade, 'Geral') AS modalidade,
  COALESCE(ar.nome_area, 'Multidisciplinar') AS area_tematica,
  COALESCE(inst.nome_exibicao, 'Não informada') AS nome_instituicao,
  COALESCE(ARRAY_AGG(ROUND(a.nota_final::numeric, 2)) FILTER (WHERE a.nota_final IS NOT NULL AND (a.status IS NULL OR a.status != 'CANCELADA')), '{}') AS notas,
  COALESCE(ROUND(AVG(a.nota_final)::numeric, 2), 0.00) AS media_geral,
  COUNT(a.id_avaliacao) AS total_avaliacoes,
  p.id_evento
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status != 'CANCELADA')
GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento
ORDER BY media_geral DESC;

-- View: view_relatorio_projetos
CREATE OR REPLACE VIEW public.view_relatorio_projetos AS
SELECT
  p.id_projeto,
  p.id_evento,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  m.nome_modalidade AS modalidade,
  ar.nome_area AS area_conhecimento,
  inst.nome_exibicao AS nome_instituicao,
  p.id_instituicao,
  p.id_modalidade,
  p.id_area,
  p.is_check_in_realizado,
  p.is_fora_da_competicao,
  COUNT(a.id_avaliacao) AS total_avaliacoes,
  COALESCE(ROUND(AVG(a.nota_final)::numeric, 2), 0.00) AS media_geral,
  COALESCE(
    ARRAY_AGG(
      ROUND(a.nota_final::numeric, 2)
    ) FILTER (WHERE a.nota_final IS NOT NULL AND (a.status IS NULL OR a.status != 'CANCELADA')),
    '{}'
  ) AS notas
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
LEFT JOIN public.avaliacoes a 
  ON a.id_projeto = p.id_projeto 
 AND (a.status IS NULL OR a.status != 'CANCELADA')
GROUP BY 
  p.id_projeto, 
  p.id_evento, 
  p.codigo_projeto, 
  p.titulo, 
  p.estande, 
  p.corredor, 
  m.nome_modalidade, 
  ar.nome_area, 
  inst.nome_exibicao,
  p.id_instituicao,
  p.id_modalidade,
  p.id_area,
  p.is_check_in_realizado,
  p.is_fora_da_competicao
ORDER BY media_geral DESC;

-- View: view_relatorio_avaliadores
CREATE OR REPLACE VIEW public.view_relatorio_avaliadores AS
SELECT
  a.id_avaliacao,
  u.id_usuario,
  u.nome AS avaliador_nome,
  u.email AS avaliador_email,
  p.id_projeto,
  p.id_evento,
  p.codigo_projeto,
  p.titulo AS projeto_titulo,
  p.estande AS projeto_estande,
  m.nome_modalidade AS projeto_modalidade,
  ar.nome_area AS projeto_area,
  a.nota_final,
  COALESCE(a.parecer_final, '') AS parecer_comentario,
  a.parecer_final,
  a.tempo_presenca,
  a.tempo_submissao,
  a.created_at AS data_avaliacao,
  a.status
FROM public.avaliacoes a
JOIN public.usuarios u ON u.id_usuario = a.id_usuario
JOIN public.projetos p ON p.id_projeto = a.id_projeto
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
WHERE a.status IS NULL OR a.status != 'CANCELADA'
ORDER BY u.nome ASC, a.created_at DESC;

-- View: view_relatorio_ausencias
CREATE OR REPLACE VIEW public.view_relatorio_ausencias AS
SELECT
  hi.id_usuario,
  hi.id_projeto,
  hi.tipo,
  hi.created_at AS data_ausencia,
  u.nome AS avaliador_nome,
  u.email AS avaliador_email,
  p.id_evento,
  p.codigo_projeto,
  p.titulo AS projeto_titulo,
  p.estande AS projeto_estande,
  m.nome_modalidade AS projeto_modalidade,
  ar.nome_area AS projeto_area,
  inst.nome_exibicao AS projeto_instituicao,
  (
    SELECT COUNT(*) 
    FROM public.avaliacoes av 
    WHERE av.id_projeto = p.id_projeto 
      AND (av.status IS NULL OR av.status != 'CANCELADA')
  ) AS total_avaliacoes_atuais
FROM public.historico_impedimentos hi
JOIN public.usuarios u ON u.id_usuario = hi.id_usuario
JOIN public.projetos p ON p.id_projeto = hi.id_projeto
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
WHERE hi.tipo = 'ausencia'
ORDER BY hi.created_at DESC;

-- View: view_projetos_quarentena
-- Projetos com discrepância entre maior e menor nota > 2.5 OU com flag is_quarentena = true
CREATE OR REPLACE VIEW public.view_projetos_quarentena AS
SELECT 
  p.id_projeto,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  COALESCE(m.nome_modalidade, 'Geral') AS modalidade,
  COALESCE(ar.nome_area, 'Multidisciplinar') AS area_tematica,
  COALESCE(inst.nome_exibicao, 'Não informada') AS nome_instituicao,
  p.id_evento,
  COUNT(a.id_avaliacao) as total_avaliacoes,
  ROUND(MIN(a.nota_final)::numeric, 2) as nota_minima,
  ROUND(MAX(a.nota_final)::numeric, 2) as nota_maxima,
  ROUND((MAX(a.nota_final) - MIN(a.nota_final))::numeric, 2) as diferenca_notas,
  BOOL_OR(COALESCE(a.is_quarentena, false)) as tem_flag_quarentena
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
LEFT JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status != 'CANCELADA')
GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento
HAVING BOOL_OR(COALESCE(a.is_quarentena, false)) = true 
    OR (COUNT(a.id_avaliacao) >= 2 AND (MAX(a.nota_final) - MIN(a.nota_final)) > 2.5);

-- View: view_projetos_pendentes_avaliacao
-- Projetos com check-in presencial, em competição e com menos de 3 avaliações concluídas
CREATE OR REPLACE VIEW public.view_projetos_pendentes_avaliacao AS
SELECT 
  p.id_projeto,
  p.id_evento,
  p.codigo_projeto,
  p.titulo,
  p.estande,
  p.corredor,
  p.id_instituicao,
  COALESCE(m.nome_modalidade, 'Geral') AS modalidade,
  COALESCE(ar.nome_area, 'Multidisciplinar') AS area_conhecimento,
  COALESCE(inst.nome_exibicao, 'Não informada') AS nome_instituicao,
  COUNT(a.id_avaliacao) FILTER (WHERE a.status IS NULL OR a.status != 'CANCELADA') as total_avaliacoes
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
LEFT JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto
WHERE COALESCE(p.is_check_in_realizado, true) = true
  AND COALESCE(p.is_fora_da_competicao, false) = false
GROUP BY p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo, p.estande, p.corredor, p.id_instituicao, m.nome_modalidade, ar.nome_area, inst.nome_exibicao
HAVING COUNT(a.id_avaliacao) FILTER (WHERE a.status IS NULL OR a.status != 'CANCELADA') < 3;

-- ------------------------------------------------------------------------------
-- 18. STORED PROCEDURES / RPCS (Compatíveis com safeupdate)
-- ------------------------------------------------------------------------------

-- 18.1 admin_reset_global
-- Reseta avaliações, respostas, locks, atribuições, projetos, questionários e usuários temporários (avaliadores e staff).
-- Preserva rigorosamente Administradores, Superadmins e o registro do Evento ativo.
-- Compatível com safeupdate e com esquemas legados (sem coluna id_evento em projetos/questionarios).
CREATE OR REPLACE FUNCTION public.admin_reset_global(p_id_evento UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id_evento UUID;
BEGIN
  -- 1. Determina o evento alvo
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

  -- 7. Limpeza de projetos (tolerante a versões com ou sem id_evento)
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

  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'questionario'
  ) THEN
    EXECUTE 'DELETE FROM public.questionario WHERE id IS NOT NULL';
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
  IF v_id_evento IS NOT NULL THEN
    DELETE FROM public.modalidades WHERE id_evento = v_id_evento;
  ELSE
    DELETE FROM public.modalidades WHERE id_modalidade IS NOT NULL;
  END IF;

  -- 12. Limpeza de Instituições do evento ativo (aliases são deletados por CASCADE)
  IF v_id_evento IS NOT NULL THEN
    DELETE FROM public.instituicoes WHERE id_evento = v_id_evento;
  ELSE
    DELETE FROM public.instituicoes WHERE id_instituicao IS NOT NULL;
  END IF;

  -- 12. Exclusão de usuários temporários (AVALIADOR e STAFF)
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

-- 18.4 admin_remover_quarentena
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
  --    c) Não pertence a modalidade bloqueada para este avaliador;
  --    d) Não está bloqueado atualmente por outro avaliador;
  --    e) Não foi avaliado anteriormente por este avaliador;
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
    -- Bloqueia incondicionalmente qualquer projeto já avaliado (ativo ou cancelado) pelo mesmo avaliador.
    -- Evita colisão na constraint UNIQUE (id_projeto, id_usuario) e redistribui para outro avaliador.
    AND p.id_projeto NOT IN (
      SELECT a.id_projeto FROM public.avaliacoes a 
      WHERE a.id_usuario = p_id_usuario
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
    -- Prioridade por Afinidade Temática: 0 se o projeto for da área do avaliador, 1 se for de outra área
    CASE 
      WHEN EXISTS (SELECT 1 FROM public.avaliador_areas aa WHERE aa.id_usuario = p_id_usuario AND aa.id_evento = p_id_evento)
      THEN (
        CASE 
          WHEN p.id_area IN (SELECT aa.id_area FROM public.avaliador_areas aa WHERE aa.id_usuario = p_id_usuario AND aa.id_evento = p_id_evento) THEN 0 
          ELSE 1 
        END
      )
      ELSE 0
    END ASC,
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
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena_todos() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sortear_proximo_projeto(UUID, UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sortear_projeto(UUID, UUID) TO authenticated, anon, service_role;

-- ------------------------------------------------------------------------------
-- 20. TABELAS: instituicao_aliases e modalidade_aliases (Dicionários de Alias)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instituicao_aliases (
  id_alias UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_instituicao UUID NOT NULL REFERENCES public.instituicoes(id_instituicao) ON DELETE CASCADE,
  alias VARCHAR(255) NOT NULL,
  alias_normalizado VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_instituicao_alias_normalizado UNIQUE (id_instituicao, alias_normalizado)
);

CREATE TABLE IF NOT EXISTS public.modalidade_aliases (
  id_alias UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_modalidade UUID NOT NULL REFERENCES public.modalidades(id_modalidade) ON DELETE CASCADE,
  alias VARCHAR(255) NOT NULL,
  alias_normalizado VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_modalidade_alias_normalizado UNIQUE (id_modalidade, alias_normalizado)
);

-- ------------------------------------------------------------------------------
-- 21. ÍNDICES DE EVENTO E RESTRIÇÕES DE UNICIDADE POR EVENTO
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_instituicoes_evento ON public.instituicoes(id_evento);
CREATE INDEX IF NOT EXISTS idx_modalidades_evento ON public.modalidades(id_evento);
CREATE INDEX IF NOT EXISTS idx_areas_tematicas_evento ON public.areas_tematicas(id_evento);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_instituicoes_evento_norm ON public.instituicoes (id_evento, nome_normalizado) WHERE id_evento IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_modalidades_evento_nome ON public.modalidades (id_evento, nome_modalidade) WHERE id_evento IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_areas_tematicas_evento_nome ON public.areas_tematicas (id_evento, nome_area) WHERE id_evento IS NOT NULL;

