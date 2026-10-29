-- Desbloqueio de uma trava pelo Admin (migration 20261029210000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d5000000-0000-0000-0000-0000000000ad', 'admin5@teste.local', false, now()),
  ('d5000000-0000-0000-0000-000000000051', 'staff5@teste.local', false, now());
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES ('e5000000-0000-0000-0000-000000000001', 'Evento Travas', false);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento)
VALUES ('f5000000-0000-0000-0000-000000000001', 'TRV-001', 'Projeto com duas travas', 'e5000000-0000-0000-0000-000000000001');
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('d5000000-0000-0000-0000-0000000000ad', 'admin5@teste.local', 'Admin', 'ADMIN', 'd5000000-0000-0000-0000-0000000000ad'),
  ('c5000000-0000-0000-0000-000000000051', 'staff5@teste.local', 'Staff', 'STAFF', 'd5000000-0000-0000-0000-000000000051'),
  ('c5000000-0000-0000-0000-0000000000a1', 'ava51@teste.local', 'Avaliadora 1', 'AVALIADOR', NULL),
  ('c5000000-0000-0000-0000-0000000000a2', 'ava52@teste.local', 'Avaliador 2', 'AVALIADOR', NULL);
INSERT INTO public.locks_ativos (id_lock, id_usuario, id_projeto, expira_em) VALUES
  ('a5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-0000000000a1', 'f5000000-0000-0000-0000-000000000001', now() + interval '20 minutes'),
  ('a5000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-0000000000a2', 'f5000000-0000-0000-0000-000000000001', now() + interval '20 minutes');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_sub IS NULL THEN
    PERFORM set_config('role', 'anon', true);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  ELSE
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  END IF;
END $$;

SELECT pg_temp.como(NULL);
SELECT throws_ok($$ SELECT public.admin_desbloquear_trava('a5000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'visitante anônimo não desbloqueia');

SELECT pg_temp.como('d5000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_desbloquear_trava('a5000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'Staff não usa o desbloqueio do Admin');

SELECT pg_temp.como('d5000000-0000-0000-0000-0000000000ad');
SELECT is(public.admin_desbloquear_trava('a5000000-0000-0000-0000-000000000001'), true,
  'Admin desbloqueia a trava de um avaliador');

RESET role;
SELECT is((SELECT count(*)::int FROM public.locks_ativos WHERE id_lock = 'a5000000-0000-0000-0000-000000000001'), 0,
  'a trava escolhida foi removida');
SELECT is((SELECT count(*)::int FROM public.locks_ativos WHERE id_lock = 'a5000000-0000-0000-0000-000000000002'), 1,
  'o outro avaliador do mesmo projeto continua com a trava');

SELECT pg_temp.como('d5000000-0000-0000-0000-0000000000ad');
SELECT is(public.admin_desbloquear_trava('a5000000-0000-0000-0000-000000000001'), false,
  'trava que já não existe devolve false');

RESET role;
SELECT ok(NOT has_function_privilege('anon', 'public.admin_desbloquear_trava(uuid)', 'EXECUTE'),
  'anon não tem EXECUTE na função');

SELECT * FROM finish();
ROLLBACK;
