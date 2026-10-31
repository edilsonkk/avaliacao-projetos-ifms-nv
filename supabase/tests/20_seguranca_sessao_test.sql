-- Etapa 2 da revisão de segurança (ASVS cap. 6 e 7): identidade e sessão do avaliador.
-- Migration 20261031020000_seguranca_sessao. Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

-- Cenário: evento ativo e evento anterior; Ana (credenciada), Bia (não credenciada), Cid (só do evento anterior)
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d2000000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d2000000-0000-0000-0000-0000000000b1', NULL, true, NULL),
  ('d2000000-0000-0000-0000-0000000000c1', NULL, true, NULL),
  ('d2000000-0000-0000-0000-000000000051', 'staff20@teste.local', false, now());
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, metodos_vinculo) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'Feira Atual', true, 3, 'ambos'),
  ('e2000000-0000-0000-0000-000000000002', 'Feira Anterior', false, 3, 'ambos');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao) VALUES
  ('f2000000-0000-0000-0000-000000000001', 'SES-1', 'Projeto', 'e2000000-0000-0000-0000-000000000001', true, false);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c2000000-0000-0000-0000-000000000051', 'staff20@teste.local', 'Staff', 'STAFF', 'd2000000-0000-0000-0000-000000000051'),
  ('c2000000-0000-0000-0000-0000000000a1', 'ana20@teste.local', 'Ana', 'AVALIADOR', NULL),
  ('c2000000-0000-0000-0000-0000000000b1', 'bia20@teste.local', 'Bia', 'AVALIADOR', NULL),
  ('c2000000-0000-0000-0000-0000000000c1', 'cid20@teste.local', 'Cid', 'AVALIADOR', NULL),
  ('c2000000-0000-0000-0000-0000000000ad', 'admin20@teste.local', 'Admin', 'ADMIN', NULL);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c2000000-0000-0000-0000-0000000000a1', 'e2000000-0000-0000-0000-000000000001', true),
  ('c2000000-0000-0000-0000-0000000000b1', 'e2000000-0000-0000-0000-000000000001', false),
  ('c2000000-0000-0000-0000-0000000000c1', 'e2000000-0000-0000-0000-000000000002', true);
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d2000000-0000-0000-0000-0000000000a1', 'c2000000-0000-0000-0000-0000000000a1', 'e2000000-0000-0000-0000-000000000001', 'pareamento'),
  ('d2000000-0000-0000-0000-0000000000b1', 'c2000000-0000-0000-0000-0000000000b1', 'e2000000-0000-0000-0000-000000000001', 'codigo'),
  ('d2000000-0000-0000-0000-0000000000c1', 'c2000000-0000-0000-0000-0000000000c1', 'e2000000-0000-0000-0000-000000000002', 'pareamento');

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

-- ---------------------------------------------------------------------------
-- O celular só vale para avaliador credenciado no evento ativo
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d2000000-0000-0000-0000-0000000000a1');
SELECT is(public.avaliador_atual(), 'c2000000-0000-0000-0000-0000000000a1'::uuid, 'avaliadora credenciada no evento ativo é reconhecida');

SELECT pg_temp.como('d2000000-0000-0000-0000-0000000000b1');
SELECT is(public.avaliador_atual(), NULL, 'celular de avaliadora não credenciada não vale');
SELECT throws_ok($$ SELECT public.sortear_proximo_projeto('c2000000-0000-0000-0000-0000000000b1', 'e2000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'não credenciada não sorteia');

SELECT pg_temp.como('d2000000-0000-0000-0000-0000000000c1');
SELECT is(public.avaliador_atual(), NULL, 'celular vinculado em evento anterior não vale no evento ativo');
SELECT throws_ok($$ SELECT public.sortear_proximo_projeto('c2000000-0000-0000-0000-0000000000c1', 'e2000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'celular do evento anterior não sorteia');

-- Staff suspende o credenciamento da Ana: o celular dela para na hora
SELECT pg_temp.como('d2000000-0000-0000-0000-000000000051');
UPDATE public.avaliadores_evento SET is_credenciado = false
WHERE id_usuario = 'c2000000-0000-0000-0000-0000000000a1' AND id_evento = 'e2000000-0000-0000-0000-000000000001';
SELECT pg_temp.como('d2000000-0000-0000-0000-0000000000a1');
SELECT is(public.avaliador_atual(), NULL, 'credenciamento suspenso: o celular deixa de valer');
SELECT throws_ok($$ SELECT public.sortear_proximo_projeto('c2000000-0000-0000-0000-0000000000a1', 'e2000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'suspensa não sorteia');
SELECT is((public.fn_meu_perfil())->>'papel', NULL, 'perfil sem papel: o app volta ao login');

-- Staff credencia de novo: volta a valer sem novo pareamento
SELECT pg_temp.como('d2000000-0000-0000-0000-000000000051');
UPDATE public.avaliadores_evento SET is_credenciado = true
WHERE id_usuario = 'c2000000-0000-0000-0000-0000000000a1' AND id_evento = 'e2000000-0000-0000-0000-000000000001';
SELECT pg_temp.como('d2000000-0000-0000-0000-0000000000a1');
SELECT is(public.avaliador_atual(), 'c2000000-0000-0000-0000-0000000000a1'::uuid, 'credenciada de novo: volta a valer');

-- Gerar código de acesso é ato do Staff que libera o avaliador (como o pareamento)
SELECT pg_temp.como('d2000000-0000-0000-0000-000000000051');
SELECT lives_ok($$ SELECT public.fn_gerar_codigo_acesso('c2000000-0000-0000-0000-0000000000b1') $$, 'Staff gera código para a Bia');
RESET role;
SELECT is((SELECT is_credenciado FROM public.avaliadores_evento
  WHERE id_usuario = 'c2000000-0000-0000-0000-0000000000b1' AND id_evento = 'e2000000-0000-0000-0000-000000000001'), true,
  'gerar código credencia o avaliador (como o pareamento)');

-- ---------------------------------------------------------------------------
-- Autocadastro público não revela quem já tem conta
-- ---------------------------------------------------------------------------
SELECT pg_temp.como(NULL);
SELECT is((public.fn_autocadastro_avaliador('e2000000-0000-0000-0000-000000000001', 'Admin Qualquer', 'admin20@teste.local', NULL, NULL, NULL))->>'situacao',
  'recebido', 'e-mail de Admin: mesma resposta de um cadastro novo');
SELECT is((public.fn_autocadastro_avaliador('e2000000-0000-0000-0000-000000000001', 'Pessoa Nova', 'nova20@teste.local', NULL, NULL, NULL))->>'situacao',
  'recebido', 'e-mail novo: cadastro recebido');

SELECT * FROM finish();
ROLLBACK;
