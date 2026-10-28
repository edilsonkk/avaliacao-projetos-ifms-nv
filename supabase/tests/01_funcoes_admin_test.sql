-- Fase 0 (C1, H2): funções administrativas e relatórios só para Admin.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

-- Identidades de teste
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@teste.local', 'Admin Teste', 'ADMIN'),
  ('a0000000-0000-0000-0000-000000000002', 'comum@teste.local', 'Conta Comum', 'AVALIADOR');

-- Conta comum autenticada (ex.: alguém que se cadastrou pelo Auth público)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT throws_ok($$ SELECT public.admin_reset_global(NULL) $$, '42501', NULL, 'C1: conta comum não roda admin_reset_global');
SELECT throws_ok($$ SELECT public.admin_desbloquear_todos() $$, '42501', NULL, 'C1: conta comum não roda admin_desbloquear_todos');
SELECT throws_ok($$ SELECT public.admin_desbloquear_projeto(gen_random_uuid()) $$, '42501', NULL, 'C1: conta comum não roda admin_desbloquear_projeto');
SELECT throws_ok($$ SELECT public.admin_remover_quarentena(gen_random_uuid()) $$, '42501', NULL, 'C1: conta comum não roda admin_remover_quarentena');
SELECT throws_ok($$ SELECT public.admin_remover_quarentena_todos() $$, '42501', NULL, 'C1: conta comum não roda admin_remover_quarentena_todos');

-- Visitante anônimo
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok($$ SELECT public.admin_reset_global(NULL) $$, '42501', NULL, 'anon não roda admin_reset_global');
SELECT throws_ok($$ SELECT public.fn_relatorio_projetos_completo(gen_random_uuid()) $$, '42501', NULL, 'H2: anon não roda fn_relatorio_projetos_completo');
SELECT throws_ok($$ SELECT public.fn_relatorio_avaliadores_completo(gen_random_uuid()) $$, '42501', NULL, 'H2: anon não roda fn_relatorio_avaliadores_completo');

-- Admin legítimo
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok($$ SELECT public.admin_desbloquear_todos() $$, 'Admin roda admin_desbloquear_todos');
SELECT lives_ok($$ SELECT public.admin_remover_quarentena_todos() $$, 'Admin roda admin_remover_quarentena_todos');

-- Relatórios deixam de ignorar a RLS
RESET ROLE;
SELECT is(
  (SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE proname LIKE 'fn_relatorio_%' AND pronamespace = 'public'::regnamespace),
  true, 'H2: fn_relatorio_* são SECURITY INVOKER');

SELECT * FROM finish();
ROLLBACK;
