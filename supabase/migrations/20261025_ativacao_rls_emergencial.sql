-- ==============================================================================
-- MIGRATION: 20261025_ativacao_rls_emergencial.sql
-- DESCRIÇÃO: Ativação formal de Row Level Security (RLS) em 100% das tabelas
--            expostas do schema público. Implementa políticas cirúrgicas de
--            contenção contra abusos anônimos, bloqueando mutações administrativas
--            para usuários não autenticados via JWT, enquanto preserva a
--            operação do Login Zero-Fricção (Avaliador/Staff), sorteio e avaliação.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HABILITAÇÃO DO RLS EM TODAS AS TABELAS PÚBLICAS
-- ------------------------------------------------------------------------------
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instituicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas_tematicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perguntas_questionario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliadores_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.respostas_avaliacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locks_ativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fila_atribuicoes_direcionadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_impedimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliador_modalidades_bloqueadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliador_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instituicao_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modalidade_aliases ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. TABELA: eventos
--    - SELECT: livre (anon, authenticated)
--    - INSERT, UPDATE, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'eventos' AND policyname = 'politica_eventos_select') THEN
    CREATE POLICY politica_eventos_select ON public.eventos
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'eventos' AND policyname = 'politica_eventos_admin_mutacao') THEN
    CREATE POLICY politica_eventos_admin_mutacao ON public.eventos
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON TABLE public.eventos TO anon;
GRANT ALL ON TABLE public.eventos TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. TABELA: instituicoes
--    - SELECT: livre (anon, authenticated)
--    - INSERT: livre (permite nova instituição no autocadastro do avaliador)
--    - UPDATE, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'instituicoes' AND policyname = 'politica_instituicoes_select') THEN
    CREATE POLICY politica_instituicoes_select ON public.instituicoes
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'instituicoes' AND policyname = 'politica_instituicoes_insert') THEN
    CREATE POLICY politica_instituicoes_insert ON public.instituicoes
      FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'instituicoes' AND policyname = 'politica_instituicoes_admin_mutacao') THEN
    CREATE POLICY politica_instituicoes_admin_mutacao ON public.instituicoes
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON TABLE public.instituicoes TO anon;
GRANT ALL ON TABLE public.instituicoes TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. TABELA: modalidades
--    - SELECT: livre (anon, authenticated)
--    - INSERT, UPDATE, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'modalidades' AND policyname = 'politica_modalidades_select') THEN
    CREATE POLICY politica_modalidades_select ON public.modalidades
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'modalidades' AND policyname = 'politica_modalidades_admin_mutacao') THEN
    CREATE POLICY politica_modalidades_admin_mutacao ON public.modalidades
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON TABLE public.modalidades TO anon;
GRANT ALL ON TABLE public.modalidades TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. TABELA: areas_tematicas
--    - SELECT: livre (anon, authenticated)
--    - INSERT, UPDATE, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'areas_tematicas' AND policyname = 'politica_areas_tematicas_select') THEN
    CREATE POLICY politica_areas_tematicas_select ON public.areas_tematicas
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'areas_tematicas' AND policyname = 'politica_areas_tematicas_admin_mutacao') THEN
    CREATE POLICY politica_areas_tematicas_admin_mutacao ON public.areas_tematicas
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON TABLE public.areas_tematicas TO anon;
GRANT ALL ON TABLE public.areas_tematicas TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. TABELA: usuarios
--    - SELECT: livre (necessário para Login Zero-Fricção por e-mail e exibição)
--    - INSERT: anon permitido com restrição estrita de papel 'AVALIADOR' (autocadastro);
--              authenticated pode inserir qualquer papel
--    - UPDATE: anon permitido apenas se papel mantido como 'AVALIADOR';
--              authenticated tem controle irrestrito
--    - DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usuarios' AND policyname = 'politica_usuarios_select') THEN
    CREATE POLICY politica_usuarios_select ON public.usuarios
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usuarios' AND policyname = 'politica_usuarios_insert_anon') THEN
    CREATE POLICY politica_usuarios_insert_anon ON public.usuarios
      FOR INSERT TO anon WITH CHECK (papel = 'AVALIADOR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usuarios' AND policyname = 'politica_usuarios_update_anon') THEN
    CREATE POLICY politica_usuarios_update_anon ON public.usuarios
      FOR UPDATE TO anon USING (papel = 'AVALIADOR') WITH CHECK (papel = 'AVALIADOR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usuarios' AND policyname = 'politica_usuarios_admin_mutacao') THEN
    CREATE POLICY politica_usuarios_admin_mutacao ON public.usuarios
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.usuarios TO anon;
GRANT ALL ON TABLE public.usuarios TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. TABELAS: questionarios e perguntas_questionario
--    - SELECT: livre (anon, authenticated)
--    - INSERT, UPDATE, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'questionarios' AND policyname = 'politica_questionarios_select') THEN
    CREATE POLICY politica_questionarios_select ON public.questionarios
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'questionarios' AND policyname = 'politica_questionarios_admin_mutacao') THEN
    CREATE POLICY politica_questionarios_admin_mutacao ON public.questionarios
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'perguntas_questionario' AND policyname = 'politica_perguntas_select') THEN
    CREATE POLICY politica_perguntas_select ON public.perguntas_questionario
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'perguntas_questionario' AND policyname = 'politica_perguntas_admin_mutacao') THEN
    CREATE POLICY politica_perguntas_admin_mutacao ON public.perguntas_questionario
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON TABLE public.questionarios TO anon;
GRANT ALL ON TABLE public.questionarios TO authenticated, service_role;

GRANT SELECT ON TABLE public.perguntas_questionario TO anon;
GRANT ALL ON TABLE public.perguntas_questionario TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 8. TABELA: projetos
--    - SELECT: livre (anon, authenticated)
--    - UPDATE: livre (anon e authenticated - permite check-in e contagem ausência via Staff)
--    - INSERT, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'projetos' AND policyname = 'politica_projetos_select') THEN
    CREATE POLICY politica_projetos_select ON public.projetos
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'projetos' AND policyname = 'politica_projetos_update_operacional') THEN
    CREATE POLICY politica_projetos_update_operacional ON public.projetos
      FOR UPDATE USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'projetos' AND policyname = 'politica_projetos_admin_mutacao') THEN
    CREATE POLICY politica_projetos_admin_mutacao ON public.projetos
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, UPDATE ON TABLE public.projetos TO anon;
GRANT ALL ON TABLE public.projetos TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. TABELA: avaliadores_evento
--    - SELECT: livre (anon, authenticated)
--    - INSERT, UPDATE: livre (vinculação no autocadastro e credenciamento)
--    - DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'avaliadores_evento' AND policyname = 'politica_avaliadores_evento_select') THEN
    CREATE POLICY politica_avaliadores_evento_select ON public.avaliadores_evento
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'avaliadores_evento' AND policyname = 'politica_avaliadores_evento_mutacao_operacional') THEN
    CREATE POLICY politica_avaliadores_evento_mutacao_operacional ON public.avaliadores_evento
      FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'avaliadores_evento' AND policyname = 'politica_avaliadores_evento_update_operacional') THEN
    CREATE POLICY politica_avaliadores_evento_update_operacional ON public.avaliadores_evento
      FOR UPDATE USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'avaliadores_evento' AND policyname = 'politica_avaliadores_evento_admin_delete') THEN
    CREATE POLICY politica_avaliadores_evento_admin_delete ON public.avaliadores_evento
      FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.avaliadores_evento TO anon;
GRANT ALL ON TABLE public.avaliadores_evento TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 10. TABELA: avaliacoes
--    - SELECT: livre (anon, authenticated)
--    - INSERT: livre (permite envio de notas pelo avaliador)
--    - UPDATE: estrito para authenticated (Admin)
--    - DELETE: authenticated total; anon permitido apenas para avaliações pendentes sem nota
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'avaliacoes' AND policyname = 'politica_avaliacoes_select') THEN
    CREATE POLICY politica_avaliacoes_select ON public.avaliacoes
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'avaliacoes' AND policyname = 'politica_avaliacoes_insert') THEN
    CREATE POLICY politica_avaliacoes_insert ON public.avaliacoes
      FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'avaliacoes' AND policyname = 'politica_avaliacoes_delete_pendentes_anon') THEN
    CREATE POLICY politica_avaliacoes_delete_pendentes_anon ON public.avaliacoes
      FOR DELETE TO anon USING (nota_final IS NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'avaliacoes' AND policyname = 'politica_avaliacoes_admin_mutacao') THEN
    CREATE POLICY politica_avaliacoes_admin_mutacao ON public.avaliacoes
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON TABLE public.avaliacoes TO anon;
GRANT ALL ON TABLE public.avaliacoes TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 11. TABELA: respostas_avaliacao
--    - SELECT: livre (anon, authenticated)
--    - INSERT: livre (envio dos critérios avaliados pelo avaliador)
--    - UPDATE, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'respostas_avaliacao' AND policyname = 'politica_respostas_select') THEN
    CREATE POLICY politica_respostas_select ON public.respostas_avaliacao
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'respostas_avaliacao' AND policyname = 'politica_respostas_insert') THEN
    CREATE POLICY politica_respostas_insert ON public.respostas_avaliacao
      FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'respostas_avaliacao' AND policyname = 'politica_respostas_admin_mutacao') THEN
    CREATE POLICY politica_respostas_admin_mutacao ON public.respostas_avaliacao
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON TABLE public.respostas_avaliacao TO anon;
GRANT ALL ON TABLE public.respostas_avaliacao TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 12. TABELA: locks_ativos
--    - ALL: livre para anon, authenticated e service_role (gestão dinâmica de travas)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'locks_ativos' AND policyname = 'politica_locks_ativos_operacional') THEN
    CREATE POLICY politica_locks_ativos_operacional ON public.locks_ativos
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.locks_ativos TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 13. TABELA: fila_atribuicoes_direcionadas
--    - ALL: livre para anon, authenticated e service_role (fila de projetos staff/avaliador)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fila_atribuicoes_direcionadas' AND policyname = 'politica_fila_atribuicoes_operacional') THEN
    CREATE POLICY politica_fila_atribuicoes_operacional ON public.fila_atribuicoes_direcionadas
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.fila_atribuicoes_direcionadas TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 14. TABELA: historico_impedimentos
--    - SELECT, INSERT: livre para anon e authenticated (registro de conflitos/ausências)
--    - UPDATE, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'historico_impedimentos' AND policyname = 'politica_historico_impedimentos_select') THEN
    CREATE POLICY politica_historico_impedimentos_select ON public.historico_impedimentos
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'historico_impedimentos' AND policyname = 'politica_historico_impedimentos_insert') THEN
    CREATE POLICY politica_historico_impedimentos_insert ON public.historico_impedimentos
      FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'historico_impedimentos' AND policyname = 'politica_historico_impedimentos_admin') THEN
    CREATE POLICY politica_historico_impedimentos_admin ON public.historico_impedimentos
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON TABLE public.historico_impedimentos TO anon;
GRANT ALL ON TABLE public.historico_impedimentos TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 15. TABELAS: instituicao_aliases e modalidade_aliases
--    - SELECT: livre (anon, authenticated)
--    - INSERT, UPDATE, DELETE: estrito para authenticated (Admin)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'instituicao_aliases' AND policyname = 'politica_instituicao_aliases_select') THEN
    CREATE POLICY politica_instituicao_aliases_select ON public.instituicao_aliases
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'instituicao_aliases' AND policyname = 'politica_instituicao_aliases_admin') THEN
    CREATE POLICY politica_instituicao_aliases_admin ON public.instituicao_aliases
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'modalidade_aliases' AND policyname = 'politica_modalidade_aliases_select') THEN
    CREATE POLICY politica_modalidade_aliases_select ON public.modalidade_aliases
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'modalidade_aliases' AND policyname = 'politica_modalidade_aliases_admin') THEN
    CREATE POLICY politica_modalidade_aliases_admin ON public.modalidade_aliases
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON TABLE public.instituicao_aliases TO anon;
GRANT ALL ON TABLE public.instituicao_aliases TO authenticated, service_role;

GRANT SELECT ON TABLE public.modalidade_aliases TO anon;
GRANT ALL ON TABLE public.modalidade_aliases TO authenticated, service_role;
