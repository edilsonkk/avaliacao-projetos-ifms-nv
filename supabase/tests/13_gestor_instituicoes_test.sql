-- Gestor de Instituições (migration 20261030030000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('dd000000-0000-0000-0000-0000000000ad', 'admin13@teste.local', false, now()),
  ('dd000000-0000-0000-0000-000000000051', 'staff13@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('cd000000-0000-0000-0000-0000000000ad', 'admin13@teste.local', 'Admin', 'ADMIN', 'dd000000-0000-0000-0000-0000000000ad'),
  ('cd000000-0000-0000-0000-000000000051', 'staff13@teste.local', 'Staff', 'STAFF', 'dd000000-0000-0000-0000-000000000051');
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('ed000000-0000-0000-0000-000000000001', 'Evento Treze', false),
  ('ed000000-0000-0000-0000-000000000002', 'Outro Evento', false);
INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado, sigla) VALUES
  ('1d000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-000000000001', 'IFMS Câmpus Campo Grande', 'qualquer coisa', 'ifms'),
  ('1d000000-0000-0000-0000-000000000002', 'ed000000-0000-0000-0000-000000000001', 'Escola Sem Vínculo', 'x', NULL);
INSERT INTO public.projetos (codigo_projeto, titulo, id_evento, id_instituicao) VALUES
  ('I-001', 'P', 'ed000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000001');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

SELECT is((SELECT nome_normalizado FROM public.instituicoes WHERE id_instituicao = '1d000000-0000-0000-0000-000000000001'),
  'ifms campus campo grande', 'trigger calcula a chave igual às outras telas (sem acento, minúsculas)');
SELECT is((SELECT sigla FROM public.instituicoes WHERE id_instituicao = '1d000000-0000-0000-0000-000000000001'), 'IFMS', 'sigla em maiúsculas');
SELECT throws_ok(
  $$ INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado) VALUES ('ed000000-0000-0000-0000-000000000001', '  IFMS CAMPUS Campo Grande ', 'outra-chave') $$,
  '23505', NULL, 'a mesma escola escrita de outro jeito não duplica no evento');

SELECT pg_temp.como('dd000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_salvar_instituicoes('ed000000-0000-0000-0000-000000000001', '[]') $$, '42501', NULL, 'Staff não importa instituições');
SELECT throws_ok($$ SELECT public.admin_excluir_instituicao('1d000000-0000-0000-0000-000000000002') $$, '42501', NULL, 'Staff não exclui instituição');

SELECT pg_temp.como('dd000000-0000-0000-0000-0000000000ad');
SELECT is(
  public.admin_salvar_instituicoes('ed000000-0000-0000-0000-000000000001', jsonb_build_array(
    jsonb_build_object('nome', 'IFMS CÂMPUS CAMPO GRANDE', 'sigla', 'ifms-cg', 'campus', 'Campo Grande'),
    jsonb_build_object('nome', 'UFMS', 'sigla', 'ufms'),
    jsonb_build_object('nome', 'X')
  )) - 'ignoradas',
  '{"cadastradas": 1, "atualizadas": 1}'::jsonb,
  'reimportar atualiza a existente e cadastra a nova');
SELECT is((SELECT count(*)::int FROM public.instituicoes WHERE id_evento = 'ed000000-0000-0000-0000-000000000001'), 3, 'nenhuma duplicada');
SELECT is((SELECT sigla || '/' || campus FROM public.instituicoes WHERE id_instituicao = '1d000000-0000-0000-0000-000000000001'), 'IFMS-CG/Campo Grande', 'atualiza sigla e câmpus');
SELECT is(
  jsonb_array_length(public.admin_salvar_instituicoes('ed000000-0000-0000-0000-000000000002',
    jsonb_build_array(jsonb_build_object('nome', 'UFMS'))) -> 'ignoradas'),
  0, 'a mesma escola pode existir em outro evento');
SELECT is((SELECT count(*)::int FROM public.instituicoes WHERE nome_normalizado = 'ufms'
  AND id_evento IN ('ed000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-000000000002')), 2, 'uma por evento');
SELECT is((SELECT sigla FROM public.instituicoes WHERE id_evento = 'ed000000-0000-0000-0000-000000000002'), NULL, 'sem sigla inventada');

SELECT throws_ok($$ SELECT public.admin_excluir_instituicao('1d000000-0000-0000-0000-000000000001') $$, 'P0001', NULL, 'não exclui instituição com projeto');
SELECT is((SELECT id_instituicao FROM public.projetos WHERE codigo_projeto = 'I-001'), '1d000000-0000-0000-0000-000000000001'::uuid, 'projeto continua com a instituição');
SELECT lives_ok($$ SELECT public.admin_excluir_instituicao('1d000000-0000-0000-0000-000000000002') $$, 'exclui instituição sem vínculo');

SELECT * FROM finish();
ROLLBACK;
