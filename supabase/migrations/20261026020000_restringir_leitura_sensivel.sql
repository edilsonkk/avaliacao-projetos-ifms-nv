-- ==============================================================================
-- MIGRATION: 20261026020000_restringir_leitura_sensivel.sql
-- DESCRIÇÃO: Fecha a leitura pública (role anon) de dados sensíveis sem quebrar
--   os fluxos anônimos ainda vigentes (login zero-fricção e balcão do Staff).
--
--   A RLS definitiva (20261026000000) dá SELECT a anon em todas as tabelas, o
--   que expõe usuarios.cpf, usuarios.celular, usuarios.senha_hash (coluna morta)
--   e todas as notas/pareceres. RLS é por LINHA; a restrição por COLUNA é feita
--   com GRANT/REVOKE de privilégio de coluna — o instrumento correto aqui.
--
--   * usuarios: anon passa a ler só colunas não sensíveis (login e Staff seguem
--     funcionando); cpf/celular ficam só para authenticated (admin).
--   * avaliacoes: anon lê só o necessário para a dedupe do avaliador
--     (id_projeto/status); nota_final e parecer_final deixam de vazar.
--   * respostas_avaliacao: nenhum fluxo anon lê; SELECT removido de anon.
--   * senha_hash: coluna nunca escrita (senha fica no Supabase Auth) — removida.
--
-- OBS. PostgREST exige a coluna no grant: um select('*') anônimo nessas tabelas
--   passa a precisar de projeção explícita. Os fluxos atuais já projetam apenas
--   as colunas permitidas (verificado em TelaAvaliador.tsx e TelaLogin.tsx).
--
-- IDEMPOTENTE. APLICAÇÃO: colar no SQL Editor do Supabase e executar.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. usuarios: remove a coluna morta e restringe cpf/celular a authenticated.
-- ------------------------------------------------------------------------------
ALTER TABLE public.usuarios DROP COLUMN IF EXISTS senha_hash;

REVOKE SELECT ON public.usuarios FROM anon;
GRANT  SELECT (id_usuario, nome, email, papel, id_evento, created_at)
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

COMMIT;
