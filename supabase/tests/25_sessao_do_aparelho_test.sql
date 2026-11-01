-- Sessão do aparelho do avaliador: o vínculo não acontece na sessão do Admin/Staff.
-- Migration 20261101190000_sessao_do_aparelho_do_avaliador. Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

-- Cenário: evento ativo com os dois métodos; Ana (avaliadora inscrita), Admin e Staff
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d5000000-0000-0000-0000-0000000000a1', NULL, true, NULL),               -- celular da Ana
  ('d5000000-0000-0000-0000-0000000000ad', 'admin25@teste.local', false, now()),
  ('d5000000-0000-0000-0000-000000000051', 'staff25@teste.local', false, now());
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, metodos_vinculo) VALUES
  ('e5000000-0000-0000-0000-000000000001', 'Feira Atual', true, 3, 'ambos');
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('d5000000-0000-0000-0000-0000000000ad', 'admin25@teste.local', 'Admin', 'ADMIN', NULL),
  ('c5000000-0000-0000-0000-000000000051', 'staff25@teste.local', 'Staff', 'STAFF', 'd5000000-0000-0000-0000-000000000051'),
  ('c5000000-0000-0000-0000-0000000000a1', 'ana25@teste.local', 'Ana', 'AVALIADOR', NULL);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c5000000-0000-0000-0000-0000000000a1', 'e5000000-0000-0000-0000-000000000001', false);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', 'aal2')::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- Quem é conta da equipe
-- ---------------------------------------------------------------------------
SELECT ok(public.conta_da_equipe('d5000000-0000-0000-0000-0000000000ad'), 'auth_uid do Admin é conta da equipe');
SELECT ok(public.conta_da_equipe('d5000000-0000-0000-0000-000000000051'), 'auth_uid do Staff (id_auth) é conta da equipe');
SELECT ok(NOT public.conta_da_equipe('d5000000-0000-0000-0000-0000000000a1'), 'sessão anônima do celular não é conta da equipe');
SELECT ok(NOT public.conta_da_equipe(NULL), 'visitante sem sessão não é conta da equipe');

-- ---------------------------------------------------------------------------
-- A aba Avaliador aberta na sessão do Admin/Staff é recusada
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d5000000-0000-0000-0000-0000000000ad');
SELECT is((public.fn_meu_perfil())->>'sessao_equipe', 'true', 'perfil avisa que o navegador está com a conta da equipe');
SELECT throws_ok($$ SELECT public.fn_solicitar_pareamento() $$, '42501', NULL,
  'Admin não gera código de pareamento para o próprio navegador');

-- O código de acesso é recusado sem ser consumido
SELECT pg_temp.como('d5000000-0000-0000-0000-000000000051');
SELECT lives_ok($$ SELECT public.fn_gerar_codigo_acesso('c5000000-0000-0000-0000-0000000000a1') $$, 'Staff gera código para a Ana');
SELECT pg_temp.como('d5000000-0000-0000-0000-0000000000ad');
SELECT is((public.fn_vincular_com_codigo('ana25@teste.local', 'QUALQUER'))->>'ok', 'false',
  'sessão do Admin não vincula com código de acesso');
-- A conferência lê a tabela como dona (authenticated não lê codigos_acesso, por RLS/GRANT)
SELECT set_config('role', 'postgres', true);
SELECT is((SELECT count(*)::int FROM public.codigos_acesso
           WHERE id_usuario = 'c5000000-0000-0000-0000-0000000000a1' AND usado_em IS NULL AND tentativas = 0),
  1, 'o código continua intacto: nada de consumir ou contar tentativa');

-- ---------------------------------------------------------------------------
-- Celular de verdade: segue funcionando
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d5000000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT public.fn_solicitar_pareamento() $$, 'celular com sessão própria gera código de pareamento');

-- Balcão do Staff: código pendente criado por uma sessão da equipe não pareia
SELECT set_config('role', 'postgres', true);
INSERT INTO public.pareamentos_pendentes (codigo, auth_uid, id_evento, expira_em)
VALUES ('ZZZZZZ', 'd5000000-0000-0000-0000-0000000000ad', 'e5000000-0000-0000-0000-000000000001', now() + interval '10 min');
SELECT pg_temp.como('d5000000-0000-0000-0000-000000000051');
SELECT throws_like($$ SELECT public.fn_parear_dispositivo('ZZZZZZ', 'c5000000-0000-0000-0000-0000000000a1') $$,
  '%logado como Admin ou Staff%', 'Staff não pareia código vindo da sessão da equipe');

SELECT * FROM finish();
ROLLBACK;
