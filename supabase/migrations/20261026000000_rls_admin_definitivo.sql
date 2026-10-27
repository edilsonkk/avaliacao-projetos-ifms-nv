-- ==============================================================================
-- MIGRATION: 20261026000000_rls_admin_definitivo.sql
-- DESCRIÇÃO: Modelo definitivo de RLS.
--   * Escrita administrativa (importações, cadastros, exclusões) somente para
--     usuários authenticated cujo papel em public.usuarios seja ADMIN (is_admin()).
--   * Operações de Avaliador/Staff (login zero-fricção, role anon) preservadas
--     exatamente no escopo operacional atual (avaliar, locks, fila, check-in,
--     autocadastro, bloqueios/áreas no balcão do Staff).
--   * REVOKE TRUNCATE (RLS não se aplica a TRUNCATE).
--   * Views com security_invoker e somente SELECT.
--   * Remove Admins órfãos (sem conta no Supabase Auth).
--
-- IDEMPOTENTE: remove TODAS as policies existentes das tabelas do escopo e
-- recria do zero. Substitui 20261025_ativacao_rls_emergencial.sql e a antiga
-- 20261025213500_ajustar_rls_importacoes_planilhas.sql (removida).
--
-- APLICAÇÃO: o CI não aplica migrations. Cole este arquivo inteiro no
-- SQL Editor do Supabase e execute.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. FUNÇÃO is_admin()
--    SECURITY DEFINER evita recursão de RLS ao consultar public.usuarios.
--    Comparação case-insensitive (o banco grava 'ADMIN').
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 1. LIMPEZA: remove todas as policies existentes nas tabelas do escopo
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 2. EXCEÇÕES OPERACIONAIS (Avaliador / Staff - role anon)
--    Mesmo escopo já vigente; nada é ampliado.
-- ------------------------------------------------------------------------------

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

-- avaliacoes: envio de notas; exclusão apenas de pendentes (sem nota)
CREATE POLICY rls_avaliacoes_insert_operacional ON public.avaliacoes
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY rls_avaliacoes_delete_pendentes ON public.avaliacoes
  FOR DELETE TO anon, authenticated USING (nota_final IS NULL);

-- respostas_avaliacao: envio dos critérios
CREATE POLICY rls_respostas_avaliacao_insert_operacional ON public.respostas_avaliacao
  FOR INSERT TO anon, authenticated WITH CHECK (true);

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

-- ------------------------------------------------------------------------------
-- 3. VIEWS: security_invoker (respeitam RLS do chamador) e somente leitura
-- ------------------------------------------------------------------------------
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
-- 4. ADMINS ÓRFÃOS (papel ADMIN sem conta em auth.users)
--    Tenta excluir; se houver FK impedindo, rebaixa para AVALIADOR.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT u.id_usuario
    FROM public.usuarios u
    LEFT JOIN auth.users a ON a.id = u.id_usuario
    WHERE upper(u.papel::text) = 'ADMIN' AND a.id IS NULL
  LOOP
    BEGIN
      DELETE FROM public.usuarios WHERE id_usuario = r.id_usuario;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE public.usuarios SET papel = 'AVALIADOR' WHERE id_usuario = r.id_usuario;
    END;
  END LOOP;
END $$;

COMMIT;
