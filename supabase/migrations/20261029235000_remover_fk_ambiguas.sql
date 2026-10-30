-- ==============================================================================
-- MIGRATION: 20261029235000_remover_fk_ambiguas.sql
-- DESCRIÇÃO: HOTFIX. As colunas de auditoria locks_ativos.atribuido_por
--   (20261029230000) e projetos.quarentena_resolvida_por (20261029220000) foram
--   criadas com FOREIGN KEY para usuarios. Com isso, locks_ativos passou a ter
--   DUAS ligações com usuarios e o PostgREST recusa o embed "usuarios(...)" com
--   PGRST201 ("more than one relationship was found"). A tela Projetos Bloqueados
--   (select de locks_ativos com usuarios(nome, email)) parou de carregar.
--   As colunas continuam (auditoria); só a FK sai. Regra registrada em
--   docs/banco-de-dados/migrations.md e coberta por supabase/tests/09.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

ALTER TABLE public.locks_ativos DROP CONSTRAINT IF EXISTS locks_ativos_atribuido_por_fkey;
ALTER TABLE public.projetos DROP CONSTRAINT IF EXISTS projetos_quarentena_resolvida_por_fkey;

COMMENT ON COLUMN public.locks_ativos.atribuido_por IS
  'Admin (usuarios.id_usuario) que atribuiu o projeto. Sem FK de propósito: uma 2ª FK para usuarios quebra o embed usuarios(...) do PostgREST. NULL = trava do sorteio.';
COMMENT ON COLUMN public.projetos.quarentena_resolvida_por IS
  'Admin (usuarios.id_usuario) que resolveu a quarentena. Sem FK de propósito (embed do PostgREST).';

NOTIFY pgrst, 'reload schema';

COMMIT;
