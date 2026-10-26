-- ==============================================================================
-- MIGRATION: 20261025213500_ajustar_rls_importacoes_planilhas.sql
-- DESCRIÇÃO: Ajuste de Row Level Security (RLS) nas tabelas públicas para 
--            suportar importações por planilha (UPSERT/INSERT), auto-cadastro 
--            de dependências (Instituições, Modalidades, Áreas) e operações 
--            administrativas executadas pelo frontend via anon key.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PROJETOS
-- ------------------------------------------------------------------------------
ALTER TABLE public.projetos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_projetos_select ON public.projetos;
DROP POLICY IF EXISTS politica_projetos_update_operacional ON public.projetos;
DROP POLICY IF EXISTS politica_projetos_admin_mutacao ON public.projetos;
DROP POLICY IF EXISTS politica_projetos_livre ON public.projetos;

CREATE POLICY politica_projetos_livre ON public.projetos 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.projetos TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. INSTITUICOES
-- ------------------------------------------------------------------------------
ALTER TABLE public.instituicoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_instituicoes_select ON public.instituicoes;
DROP POLICY IF EXISTS politica_instituicoes_insert ON public.instituicoes;
DROP POLICY IF EXISTS politica_instituicoes_admin_mutacao ON public.instituicoes;
DROP POLICY IF EXISTS politica_instituicoes_livre ON public.instituicoes;

CREATE POLICY politica_instituicoes_livre ON public.instituicoes 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.instituicoes TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. MODALIDADES
-- ------------------------------------------------------------------------------
ALTER TABLE public.modalidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_modalidades_select ON public.modalidades;
DROP POLICY IF EXISTS politica_modalidades_admin_mutacao ON public.modalidades;
DROP POLICY IF EXISTS politica_modalidades_livre ON public.modalidades;

CREATE POLICY politica_modalidades_livre ON public.modalidades 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.modalidades TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. AREAS_TEMATICAS
-- ------------------------------------------------------------------------------
ALTER TABLE public.areas_tematicas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_areas_tematicas_select ON public.areas_tematicas;
DROP POLICY IF EXISTS politica_areas_tematicas_admin_mutacao ON public.areas_tematicas;
DROP POLICY IF EXISTS politica_areas_tematicas_livre ON public.areas_tematicas;

CREATE POLICY politica_areas_tematicas_livre ON public.areas_tematicas 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.areas_tematicas TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. USUARIOS
-- ------------------------------------------------------------------------------
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_usuarios_select ON public.usuarios;
DROP POLICY IF EXISTS politica_usuarios_insert_anon ON public.usuarios;
DROP POLICY IF EXISTS politica_usuarios_update_anon ON public.usuarios;
DROP POLICY IF EXISTS politica_usuarios_admin_mutacao ON public.usuarios;
DROP POLICY IF EXISTS politica_usuarios_livre ON public.usuarios;

CREATE POLICY politica_usuarios_livre ON public.usuarios 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.usuarios TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. QUESTIONARIOS E PERGUNTAS
-- ------------------------------------------------------------------------------
ALTER TABLE public.questionarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_questionarios_select ON public.questionarios;
DROP POLICY IF EXISTS politica_questionarios_admin_mutacao ON public.questionarios;
DROP POLICY IF EXISTS politica_questionarios_livre ON public.questionarios;

CREATE POLICY politica_questionarios_livre ON public.questionarios 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.questionarios TO anon, authenticated, service_role;

ALTER TABLE public.perguntas_questionario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_perguntas_select ON public.perguntas_questionario;
DROP POLICY IF EXISTS politica_perguntas_admin_mutacao ON public.perguntas_questionario;
DROP POLICY IF EXISTS politica_perguntas_livre ON public.perguntas_questionario;

CREATE POLICY politica_perguntas_livre ON public.perguntas_questionario 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.perguntas_questionario TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. EVENTOS
-- ------------------------------------------------------------------------------
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_eventos_select ON public.eventos;
DROP POLICY IF EXISTS politica_eventos_admin_mutacao ON public.eventos;
DROP POLICY IF EXISTS politica_eventos_livre ON public.eventos;

CREATE POLICY politica_eventos_livre ON public.eventos 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.eventos TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 8. AVALIADORES_EVENTO
-- ------------------------------------------------------------------------------
ALTER TABLE public.avaliadores_evento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_avaliadores_evento_select ON public.avaliadores_evento;
DROP POLICY IF EXISTS politica_avaliadores_evento_mutacao_operacional ON public.avaliadores_evento;
DROP POLICY IF EXISTS politica_avaliadores_evento_update_operacional ON public.avaliadores_evento;
DROP POLICY IF EXISTS politica_avaliadores_evento_admin_delete ON public.avaliadores_evento;
DROP POLICY IF EXISTS politica_avaliadores_evento_livre ON public.avaliadores_evento;

CREATE POLICY politica_avaliadores_evento_livre ON public.avaliadores_evento 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.avaliadores_evento TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. AVALIACOES E RESPOSTAS_AVALIACAO
-- ------------------------------------------------------------------------------
ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_avaliacoes_select ON public.avaliacoes;
DROP POLICY IF EXISTS politica_avaliacoes_insert ON public.avaliacoes;
DROP POLICY IF EXISTS politica_avaliacoes_delete_pendentes_anon ON public.avaliacoes;
DROP POLICY IF EXISTS politica_avaliacoes_admin_mutacao ON public.avaliacoes;
DROP POLICY IF EXISTS politica_avaliacoes_livre ON public.avaliacoes;

CREATE POLICY politica_avaliacoes_livre ON public.avaliacoes 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.avaliacoes TO anon, authenticated, service_role;

ALTER TABLE public.respostas_avaliacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_respostas_select ON public.respostas_avaliacao;
DROP POLICY IF EXISTS politica_respostas_insert ON public.respostas_avaliacao;
DROP POLICY IF EXISTS politica_respostas_admin_mutacao ON public.respostas_avaliacao;
DROP POLICY IF EXISTS politica_respostas_livre ON public.respostas_avaliacao;

CREATE POLICY politica_respostas_livre ON public.respostas_avaliacao 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.respostas_avaliacao TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 10. LOCKS, FILAS E IMPEDIMENTOS
-- ------------------------------------------------------------------------------
ALTER TABLE public.locks_ativos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_locks_ativos_operacional ON public.locks_ativos;
DROP POLICY IF EXISTS politica_locks_ativos_livre ON public.locks_ativos;

CREATE POLICY politica_locks_ativos_livre ON public.locks_ativos 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.locks_ativos TO anon, authenticated, service_role;

ALTER TABLE public.fila_atribuicoes_direcionadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_fila_atribuicoes_operacional ON public.fila_atribuicoes_direcionadas;
DROP POLICY IF EXISTS politica_fila_atribuicoes_livre ON public.fila_atribuicoes_direcionadas;

CREATE POLICY politica_fila_atribuicoes_livre ON public.fila_atribuicoes_direcionadas 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.fila_atribuicoes_direcionadas TO anon, authenticated, service_role;

ALTER TABLE public.historico_impedimentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_historico_impedimentos_select ON public.historico_impedimentos;
DROP POLICY IF EXISTS politica_historico_impedimentos_insert ON public.historico_impedimentos;
DROP POLICY IF EXISTS politica_historico_impedimentos_admin ON public.historico_impedimentos;
DROP POLICY IF EXISTS politica_historico_impedimentos_livre ON public.historico_impedimentos;

CREATE POLICY politica_historico_impedimentos_livre ON public.historico_impedimentos 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.historico_impedimentos TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 11. BLOQUEIOS DE MODALIDADE E ÁREAS DO AVALIADOR
-- ------------------------------------------------------------------------------
ALTER TABLE public.avaliador_modalidades_bloqueadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_amb_livre ON public.avaliador_modalidades_bloqueadas;
CREATE POLICY politica_amb_livre ON public.avaliador_modalidades_bloqueadas 
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.avaliador_modalidades_bloqueadas TO anon, authenticated, service_role;

ALTER TABLE public.avaliador_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_avaliador_areas_livre ON public.avaliador_areas;
CREATE POLICY politica_avaliador_areas_livre ON public.avaliador_areas 
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON TABLE public.avaliador_areas TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 12. TABELAS DE ALIASES
-- ------------------------------------------------------------------------------
ALTER TABLE public.instituicao_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_instituicao_aliases_select ON public.instituicao_aliases;
DROP POLICY IF EXISTS politica_instituicao_aliases_admin ON public.instituicao_aliases;
DROP POLICY IF EXISTS politica_instituicao_aliases_livre ON public.instituicao_aliases;

CREATE POLICY politica_instituicao_aliases_livre ON public.instituicao_aliases 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.instituicao_aliases TO anon, authenticated, service_role;

ALTER TABLE public.modalidade_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS politica_modalidade_aliases_select ON public.modalidade_aliases;
DROP POLICY IF EXISTS politica_modalidade_aliases_admin ON public.modalidade_aliases;
DROP POLICY IF EXISTS politica_modalidade_aliases_livre ON public.modalidade_aliases;

CREATE POLICY politica_modalidade_aliases_livre ON public.modalidade_aliases 
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.modalidade_aliases TO anon, authenticated, service_role;
