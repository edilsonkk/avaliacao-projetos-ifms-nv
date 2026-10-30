-- Gestor da Equipe Staff (migration 20261030010000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('db000000-0000-0000-0000-0000000000ad', 'admin11@teste.local', false, now()),
  ('db000000-0000-0000-0000-000000000051', 'staff11@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('cb000000-0000-0000-0000-0000000000ad', 'admin11@teste.local', 'Admin Onze', 'ADMIN', 'db000000-0000-0000-0000-0000000000ad'),
  ('cb000000-0000-0000-0000-000000000051', 'staff11@teste.local', 'Staff Onze', 'STAFF', 'db000000-0000-0000-0000-000000000051'),
  ('cb000000-0000-0000-0000-0000000000a1', 'avaliador11@teste.local', 'Avaliador Onze', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('eb000000-0000-0000-0000-000000000001', 'Evento Onze', false);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('cb000000-0000-0000-0000-000000000051', 'eb000000-0000-0000-0000-000000000001', true);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

SELECT pg_temp.como('db000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_salvar_staff(NULL, '[]') $$, '42501', NULL, 'Staff não cadastra Staff');
SELECT throws_ok($$ SELECT public.admin_excluir_staff('cb000000-0000-0000-0000-000000000051') $$, '42501', NULL, 'Staff não exclui Staff');

SELECT pg_temp.como('db000000-0000-0000-0000-0000000000ad');
SELECT is(
  public.admin_salvar_staff('eb000000-0000-0000-0000-000000000001', jsonb_build_array(
    jsonb_build_object('nome', 'Nova Monitora', 'email', ' Monitora11@Teste.Local ', 'papel', 'monitor'),
    jsonb_build_object('nome', 'Staff Renomeado', 'email', 'STAFF11@teste.local'),
    jsonb_build_object('nome', 'Tentativa', 'email', 'admin11@teste.local'),
    jsonb_build_object('nome', 'Tentativa', 'email', 'avaliador11@teste.local'),
    jsonb_build_object('nome', 'Papel Ruim', 'email', 'ruim11@teste.local', 'papel', 'ADMIN')
  )) - 'ignorados',
  '{"cadastrados": 1, "atualizados": 1}'::jsonb,
  'cadastra 1 e atualiza 1');
SELECT is((SELECT papel FROM public.usuarios WHERE id_usuario = 'cb000000-0000-0000-0000-0000000000ad'), 'ADMIN', 'Admin continua ADMIN');
SELECT is((SELECT papel FROM public.usuarios WHERE id_usuario = 'cb000000-0000-0000-0000-0000000000a1'), 'AVALIADOR', 'avaliador continua AVALIADOR');
SELECT is((SELECT count(*)::int FROM public.usuarios WHERE email = 'ruim11@teste.local'), 0, 'papel inválido não vira Admin');
SELECT is((SELECT papel FROM public.usuarios WHERE email = 'monitora11@teste.local'), 'MONITOR', 'papel MONITOR aceito e e-mail normalizado');
SELECT is((SELECT nome FROM public.usuarios WHERE id_usuario = 'cb000000-0000-0000-0000-000000000051'), 'Staff Renomeado', 'Staff existente atualizado');
SELECT is(
  (SELECT is_credenciado FROM public.avaliadores_evento WHERE id_usuario = 'cb000000-0000-0000-0000-000000000051' AND id_evento = 'eb000000-0000-0000-0000-000000000001'),
  true, 'reimportar não descredencia quem já está credenciado');
SELECT is(
  (SELECT count(*)::int FROM public.avaliadores_evento ae JOIN public.usuarios u USING (id_usuario) WHERE u.email = 'monitora11@teste.local'),
  1, 'novo membro inscrito no evento');

SELECT throws_ok(
  $$ SELECT public.admin_atualizar_staff('cb000000-0000-0000-0000-000000000051', 'Staff', 'admin11@teste.local') $$,
  'P0001', 'Já existe outro usuário com o e-mail admin11@teste.local.', 'edição recusa e-mail de outra pessoa');
SELECT throws_ok(
  $$ SELECT public.admin_atualizar_staff('cb000000-0000-0000-0000-0000000000a1', 'X', 'x11@teste.local') $$,
  'P0001', 'Este usuário não é da equipe Staff.', 'edição não mexe em avaliador');
SELECT throws_ok(
  $$ SELECT public.admin_excluir_staff('cb000000-0000-0000-0000-0000000000ad') $$,
  'P0001', 'Este usuário não é da equipe Staff.', 'não exclui o Admin pela tela de Staff');
SELECT lives_ok($$ SELECT public.admin_excluir_staff('cb000000-0000-0000-0000-000000000051') $$, 'exclui Staff');
SELECT is((SELECT count(*)::int FROM public.usuarios WHERE id_usuario = 'cb000000-0000-0000-0000-000000000051'), 0, 'Staff excluído');

SELECT * FROM finish();
ROLLBACK;
