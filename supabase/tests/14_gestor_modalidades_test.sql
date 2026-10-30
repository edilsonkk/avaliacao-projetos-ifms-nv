-- Gestor de Modalidades (migration 20261030040000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('de000000-0000-0000-0000-0000000000ad', 'admin14@teste.local', false, now()),
  ('de000000-0000-0000-0000-000000000051', 'staff14@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('ce000000-0000-0000-0000-0000000000ad', 'admin14@teste.local', 'Admin', 'ADMIN', 'de000000-0000-0000-0000-0000000000ad'),
  ('ce000000-0000-0000-0000-000000000051', 'staff14@teste.local', 'Staff', 'STAFF', 'de000000-0000-0000-0000-000000000051'),
  ('ce000000-0000-0000-0000-0000000000a1', 'av14@teste.local', 'Av', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('ee000000-0000-0000-0000-000000000001', 'Evento Quatorze', false),
  ('ee000000-0000-0000-0000-000000000002', 'Outro Evento', false);
INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade, codigo) VALUES
  ('be000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000001', 'Ensino Médio', 'EM'),
  ('be000000-0000-0000-0000-000000000002', 'ee000000-0000-0000-0000-000000000001', 'Sem Uso', NULL),
  ('be000000-0000-0000-0000-000000000003', 'ee000000-0000-0000-0000-000000000002', 'De Outro Evento', NULL);
INSERT INTO public.projetos (codigo_projeto, titulo, id_evento, id_modalidade) VALUES
  ('M-001', 'P', 'ee000000-0000-0000-0000-000000000001', 'be000000-0000-0000-0000-000000000001');
INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade) VALUES
  ('ce000000-0000-0000-0000-0000000000a1', 'ee000000-0000-0000-0000-000000000001', 'be000000-0000-0000-0000-000000000001');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

SELECT pg_temp.como('de000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_salvar_modalidades('ee000000-0000-0000-0000-000000000001', '[]') $$, '42501', NULL, 'Staff não importa modalidades');
SELECT throws_ok($$ SELECT public.admin_excluir_modalidade('be000000-0000-0000-0000-000000000002') $$, '42501', NULL, 'Staff não exclui modalidade');

SELECT pg_temp.como('de000000-0000-0000-0000-0000000000ad');
SELECT is(
  public.admin_salvar_modalidades('ee000000-0000-0000-0000-000000000001', jsonb_build_array(
    jsonb_build_object('nome', 'ENSINO MEDIO', 'nivel', 'Médio'),
    jsonb_build_object('nome', 'Superior', 'codigo', 'SUP'),
    jsonb_build_object('nome', 'Médio Integrado', 'id_existente', 'be000000-0000-0000-0000-000000000001'),
    jsonb_build_object('nome', 'Intruso', 'id_existente', 'be000000-0000-0000-0000-000000000003'),
    jsonb_build_object('nome', 'X')
  )) - 'ignoradas',
  '{"cadastradas": 1, "atualizadas": 1, "associadas": 1}'::jsonb,
  'reimportar não falha: atualiza a existente, cadastra a nova e associa a do De-Para');
SELECT is((SELECT count(*)::int FROM public.modalidades WHERE id_evento = 'ee000000-0000-0000-0000-000000000001'), 3, 'nenhuma duplicada (sem diferenciar maiúsculas/acentos)');
SELECT is((SELECT codigo || '/' || nivel FROM public.modalidades WHERE id_modalidade = 'be000000-0000-0000-0000-000000000001'), 'EM/Médio', 'mantém o código e preenche o nível');
SELECT is((SELECT nome_modalidade FROM public.modalidades WHERE id_modalidade = 'be000000-0000-0000-0000-000000000001'), 'Ensino Médio', 'não troca o nome da existente');
SELECT is((SELECT alias FROM public.modalidade_aliases WHERE id_modalidade = 'be000000-0000-0000-0000-000000000001'), 'Médio Integrado', 'associação vira apelido');
SELECT is((SELECT count(*)::int FROM public.modalidade_aliases WHERE id_modalidade = 'be000000-0000-0000-0000-000000000003'), 0, 'não associa a modalidade de outro evento');

SELECT throws_ok($$ SELECT public.admin_excluir_modalidade('be000000-0000-0000-0000-000000000001') $$, 'P0001', NULL, 'não exclui modalidade com projeto e bloqueio');
SELECT is((SELECT count(*)::int FROM public.avaliador_modalidades_bloqueadas WHERE id_modalidade = 'be000000-0000-0000-0000-000000000001'), 1, 'bloqueio do avaliador continua');
SELECT is((SELECT id_modalidade FROM public.projetos WHERE codigo_projeto = 'M-001'), 'be000000-0000-0000-0000-000000000001'::uuid, 'projeto continua com a modalidade');
SELECT lives_ok($$ SELECT public.admin_excluir_modalidade('be000000-0000-0000-0000-000000000002') $$, 'exclui modalidade sem uso');
SELECT is((SELECT count(*)::int FROM public.modalidades WHERE id_modalidade = 'be000000-0000-0000-0000-000000000002'), 0, 'modalidade sem uso excluída');

SELECT * FROM finish();
ROLLBACK;
