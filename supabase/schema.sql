-- ==============================================================================
-- SISTEMA DE AVALIAÇÃO DE PROJETOS IFMS
-- DDL CONSOLIDADO DO BANCO DE DADOS (PostgreSQL / Supabase)
--
-- Retrato do estado final após todas as migrations em supabase/migrations/
-- (até 20261026030000). Arquivo de REFERÊNCIA para leitura: não é aplicado no
-- banco. A fonte da verdade são as migrations. Ver docs/banco-de-dados/migrations.md.
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

-- RLS e policies: seção 23.

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

-- RLS e policies: seção 23.

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
-- Remove todas as travas temporárias ativas na tabela locks_ativos.
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
-- Remove a trava de um projeto específico.
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
-- Remove a flag de quarentena de um projeto específico.
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
-- Remove a flag de quarentena de todas as avaliações.
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
-- Motor inteligente de sorteio que atribui um projeto elegível ao avaliador.
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
-- 19. PERMISSÕES DE EXECUÇÃO DAS FUNÇÕES
-- ------------------------------------------------------------------------------
-- Funções administrativas: somente Admin autenticado (20261026030000).
-- Sorteio: também anon, pois o avaliador (sem login autenticado) precisa delas.
REVOKE EXECUTE ON FUNCTION public.admin_reset_global(uuid)          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_desbloquear_todos()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_desbloquear_projeto(uuid)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_remover_quarentena(uuid)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_remover_quarentena_todos()  FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_reset_global(uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_desbloquear_todos()         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_desbloquear_projeto(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena(uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena_todos()  TO authenticated, service_role;

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

-- ------------------------------------------------------------------------------
-- 22. FUNÇÕES DE EXCLUSÃO E RESTAURAÇÃO DE AVALIAÇÕES (RPC, somente Admin)
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

REVOKE EXECUTE ON FUNCTION public.excluir_avaliacao(uuid)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restaurar_avaliacao(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.excluir_avaliacao(uuid)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.restaurar_avaliacao(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 23. ROW LEVEL SECURITY: leitura pública, escrita administrativa só para ADMIN
--     (20261026000000). Ver docs/arquitetura/seguranca.md
-- ------------------------------------------------------------------------------
-- 23.1 is_admin(): SECURITY DEFINER evita recursão de RLS ao consultar usuarios.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id_usuario = auth.uid()
      AND upper(u.papel::text) = 'ADMIN'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 23.2 Base: SELECT para todos, ALL só para Admin; TRUNCATE revogado.
DO $$
DECLARE
  r record;
  tabelas text[] := ARRAY[
    'eventos', 'instituicoes', 'modalidades', 'areas_tematicas', 'usuarios',
    'questionarios', 'perguntas_questionario', 'projetos', 'avaliadores_evento',
    'avaliacoes', 'respostas_avaliacao', 'locks_ativos',
    'fila_atribuicoes_direcionadas', 'historico_impedimentos',
    'avaliador_modalidades_bloqueadas', 'avaliador_areas',
    'instituicao_aliases', 'modalidade_aliases'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      FOR r IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
      END LOOP;

      -- Base comum: leitura pública + escrita total do Admin autenticado
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
        'rls_' || t || '_select', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
        'rls_' || t || '_admin', t);

      -- TRUNCATE ignora RLS: nunca permitir via API
      EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- 23.3 Exceções operacionais (Avaliador / Staff, role anon)
-- instituicoes: autocadastro do avaliador pode criar instituição nova
CREATE POLICY rls_instituicoes_insert_operacional ON public.instituicoes
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- usuarios: autocadastro e edição no balcão do Staff, restritos a papel AVALIADOR
CREATE POLICY rls_usuarios_insert_operacional ON public.usuarios
  FOR INSERT TO anon, authenticated
  WITH CHECK (upper(coalesce(papel::text, 'AVALIADOR')) = 'AVALIADOR');
CREATE POLICY rls_usuarios_update_operacional ON public.usuarios
  FOR UPDATE TO anon, authenticated
  USING (upper(coalesce(papel::text, 'AVALIADOR')) = 'AVALIADOR')
  WITH CHECK (upper(coalesce(papel::text, 'AVALIADOR')) = 'AVALIADOR');

-- projetos: check-in do Staff e fixação de questionário pelo Avaliador
CREATE POLICY rls_projetos_update_operacional ON public.projetos
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- avaliadores_evento: vínculo no autocadastro e no balcão do Staff
CREATE POLICY rls_avaliadores_evento_insert_operacional ON public.avaliadores_evento
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY rls_avaliadores_evento_update_operacional ON public.avaliadores_evento
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- avaliacoes: sem INSERT anônimo (notas só via fn_enviar_avaliacao, 20261026010000);
-- exclusão apenas de pendentes (sem nota)
CREATE POLICY rls_avaliacoes_delete_pendentes ON public.avaliacoes
  FOR DELETE TO anon, authenticated USING (nota_final IS NULL);

-- respostas_avaliacao: sem INSERT anônimo (gravadas por fn_enviar_avaliacao)

-- historico_impedimentos: registro de conflito/ausência
CREATE POLICY rls_historico_impedimentos_insert_operacional ON public.historico_impedimentos
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Tabelas operacionais dinâmicas (travas, fila, bloqueios e áreas do balcão)
CREATE POLICY rls_locks_ativos_operacional ON public.locks_ativos
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY rls_fila_atribuicoes_operacional ON public.fila_atribuicoes_direcionadas
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY rls_avaliador_modalidades_bloqueadas_operacional ON public.avaliador_modalidades_bloqueadas
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY rls_avaliador_areas_operacional ON public.avaliador_areas
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 23.4 Views: security_invoker e somente leitura
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.relname);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', v.relname);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', v.relname);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 24. PRIVILÉGIOS DE LEITURA POR COLUNA (20261026020000)
-- ------------------------------------------------------------------------------
REVOKE SELECT ON public.usuarios FROM anon;
GRANT  SELECT (id_usuario, nome, email, papel, created_at)
  ON public.usuarios TO anon;
-- authenticated (admin) mantém leitura total, já gated pela RLS da 20261026000000.
GRANT SELECT ON public.usuarios TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. avaliacoes: anon lê só o mínimo para a dedupe; notas/pareceres só admin.
-- ------------------------------------------------------------------------------
REVOKE SELECT ON public.avaliacoes FROM anon;
GRANT  SELECT (id_avaliacao, id_projeto, id_usuario, status, status_avaliacao)
  ON public.avaliacoes TO anon;
GRANT SELECT ON public.avaliacoes TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. respostas_avaliacao: nenhum fluxo anon lê; só relatórios admin.
-- ------------------------------------------------------------------------------
REVOKE SELECT ON public.respostas_avaliacao FROM anon;
GRANT SELECT ON public.respostas_avaliacao TO authenticated;

-- ------------------------------------------------------------------------------
-- 25. GRAVAÇÃO DE NOTAS COM VALIDAÇÃO NO SERVIDOR (20261026010000)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_enviar_avaliacao(
  p_id_usuario      uuid,
  p_id_projeto      uuid,
  p_id_questionario uuid,
  p_respostas       jsonb,          -- [{ "id_pergunta": uuid, "nota": numeric }, ...]
  p_parecer         text DEFAULT NULL,
  p_tempo_presenca  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_evento             uuid;
  v_id_instituicao_aval   uuid;
  v_inst_projeto          uuid;
  v_modalidade_projeto    uuid;
  v_check_in              boolean;
  v_fora_competicao       boolean;
  v_tinha_trava           boolean;
  v_cota_padrao           integer;
  v_cota_projeto          integer;
  v_sistema_liberado      boolean;
  v_escala_min            numeric(5,2);
  v_escala_max            numeric(5,2);
  v_qtd_respostas         integer;
  v_qtd_fora_escala       integer;
  v_soma                  numeric;
  v_nota_final            numeric(5,2);
  v_avaliacoes_ativas     integer;
  v_nota_min              numeric(5,2);
  v_nota_max              numeric(5,2);
  v_is_quarentena         boolean := false;
  v_id_avaliacao          uuid;
BEGIN
  -- 1. POSSE DE TRAVA: o avaliador só grava se detém a trava ativa deste projeto.
  SELECT EXISTS (
    SELECT 1 FROM public.locks_ativos
    WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto
  ) INTO v_tinha_trava;

  IF NOT v_tinha_trava THEN
    RAISE EXCEPTION 'Sem trava ativa para este avaliador/projeto. Sorteie o projeto antes de avaliar.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. PROJETO ELEGÍVEL.
  SELECT p.id_evento, p.id_instituicao, p.id_modalidade,
         COALESCE(p.is_check_in_realizado, false),
         COALESCE(p.is_fora_da_competicao, false),
         p.cota_avaliacoes_customizada
    INTO v_id_evento, v_inst_projeto, v_modalidade_projeto,
         v_check_in, v_fora_competicao, v_cota_projeto
  FROM public.projetos p
  WHERE p.id_projeto = p_id_projeto;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto inexistente.' USING ERRCODE = '42501';
  END IF;
  IF v_fora_competicao THEN
    RAISE EXCEPTION 'Projeto fora da competição não pode ser avaliado.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_check_in THEN
    RAISE EXCEPTION 'Projeto sem check-in presencial.' USING ERRCODE = '42501';
  END IF;

  -- 3. SEM DUPLICIDADE (respeita unica_avaliacao_por_usuario; inclui canceladas).
  IF EXISTS (
    SELECT 1 FROM public.avaliacoes
    WHERE id_projeto = p_id_projeto AND id_usuario = p_id_usuario
  ) THEN
    RAISE EXCEPTION 'Este avaliador já possui avaliação registrada para este projeto.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. CONFLITO INSTITUCIONAL (mesma regra de sortear_proximo_projeto).
  SELECT ae.id_instituicao INTO v_id_instituicao_aval
  FROM public.avaliadores_evento ae
  WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = v_id_evento;

  IF v_id_instituicao_aval IS NOT NULL
     AND v_inst_projeto IS NOT DISTINCT FROM v_id_instituicao_aval THEN
    RAISE EXCEPTION 'Conflito de interesse: avaliador da mesma instituição do projeto.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. MODALIDADE BLOQUEADA.
  IF v_modalidade_projeto IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.avaliador_modalidades_bloqueadas amb
    WHERE amb.id_usuario = p_id_usuario
      AND amb.id_evento = v_id_evento
      AND amb.id_modalidade = v_modalidade_projeto
  ) THEN
    RAISE EXCEPTION 'Modalidade do projeto bloqueada para este avaliador.'
      USING ERRCODE = '42501';
  END IF;

  -- 6. COTA ESTRITA. A trava deste avaliador (que agora vira avaliação) não conta
  --    como avaliação ativa, então basta garantir que as avaliações já concluídas
  --    não tenham atingido a cota. O excesso de travas simultâneas é barrado no
  --    sorteio; aqui o avaliador já detém a sua e está concluindo.
  SELECT COALESCE(e.cota_avaliacoes_padrao, 3),
         COALESCE(e.sistema_liberado, true)
    INTO v_cota_padrao, v_sistema_liberado
  FROM public.eventos e WHERE e.id_evento = v_id_evento;

  SELECT COUNT(*) INTO v_avaliacoes_ativas
  FROM public.avaliacoes a
  WHERE a.id_projeto = p_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA');

  IF v_avaliacoes_ativas >= COALESCE(v_cota_projeto, v_cota_padrao) THEN
    RAISE EXCEPTION 'Cota de avaliações do projeto já atingida.' USING ERRCODE = '42501';
  END IF;

  -- 7. JANELA TEMPORAL. Tolerância: como há trava ativa, o avaliador está
  --    concluindo um projeto em andamento; só bloqueamos se o sistema foi
  --    explicitamente desligado.
  IF v_sistema_liberado = false THEN
    RAISE EXCEPTION 'Sistema de avaliação bloqueado pela coordenação.' USING ERRCODE = '42501';
  END IF;

  -- 8. FAIXA DE NOTA conforme o questionário.
  SELECT COALESCE(q.escala_minima, 0), COALESCE(q.escala_maxima, 10)
    INTO v_escala_min, v_escala_max
  FROM public.questionarios q WHERE q.id_questionario = p_id_questionario;
  IF NOT FOUND THEN
    v_escala_min := 0; v_escala_max := 10;
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (
           WHERE (r->>'nota')::numeric < v_escala_min
              OR (r->>'nota')::numeric > v_escala_max
         ),
         COALESCE(SUM((r->>'nota')::numeric), 0)
    INTO v_qtd_respostas, v_qtd_fora_escala, v_soma
  FROM jsonb_array_elements(p_respostas) AS r;

  IF v_qtd_respostas = 0 THEN
    RAISE EXCEPTION 'Nenhuma nota informada.' USING ERRCODE = '22023';
  END IF;
  IF v_qtd_fora_escala > 0 THEN
    RAISE EXCEPTION 'Nota fora da escala permitida (% a %).', v_escala_min, v_escala_max
      USING ERRCODE = '22003';
  END IF;

  -- 9. NOTA FINAL calculada no servidor (média simples, mesma semântica do front).
  v_nota_final := ROUND(v_soma / v_qtd_respostas, 2);

  -- 10. GRAVAÇÃO ATÔMICA.
  INSERT INTO public.avaliacoes (
    id_projeto, id_usuario, id_questionario, nota_final, parecer_final,
    tempo_presenca, tempo_submissao, status, status_avaliacao
  ) VALUES (
    p_id_projeto, p_id_usuario, p_id_questionario, v_nota_final, p_parecer,
    p_tempo_presenca, now(), 'CONCLUIDA', 'concluida'
  )
  RETURNING id_avaliacao INTO v_id_avaliacao;

  INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida)
  SELECT v_id_avaliacao, (r->>'id_pergunta')::uuid, (r->>'nota')::numeric
  FROM jsonb_array_elements(p_respostas) AS r;

  -- Fixa o questionário do projeto se ainda não houver.
  UPDATE public.projetos
  SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL
    AND p_id_questionario IS NOT NULL;

  -- Quarentena por divergência > 2.5 entre a maior e a menor nota ativa.
  SELECT MIN(nota_final), MAX(nota_final) INTO v_nota_min, v_nota_max
  FROM public.avaliacoes
  WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA');
  IF v_nota_max IS NOT NULL AND (v_nota_max - v_nota_min) > 2.5 THEN
    v_is_quarentena := true;
    UPDATE public.avaliacoes SET is_quarentena = true
    WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA');
  END IF;

  -- Libera a trava e conclui a fila direcionada, se houver.
  DELETE FROM public.locks_ativos
  WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto;

  UPDATE public.fila_atribuicoes_direcionadas
  SET status = 'concluido'
  WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto
    AND status IN ('pendente', 'em_andamento');

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', v_id_avaliacao,
    'nota_final', v_nota_final,
    'is_quarentena', v_is_quarentena
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_enviar_avaliacao(uuid, uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_enviar_avaliacao(uuid, uuid, uuid, jsonb, text, text)
  TO anon, authenticated, service_role;
