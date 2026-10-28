-- Fases 1 e 2: vínculo do celular ao avaliador, códigos de acesso, Staff e RPCs públicas.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(30);

-- ---------------------------------------------------------------------------
-- Cenário
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d0000000-0000-0000-0000-0000000000d1', NULL, true, NULL),               -- celular 1
  ('d0000000-0000-0000-0000-0000000000d2', NULL, true, NULL),               -- celular 2
  ('d0000000-0000-0000-0000-0000000000d3', NULL, true, NULL),               -- celular 3
  ('d0000000-0000-0000-0000-0000000000aa', 'staff@teste.local', false, now()); -- conta do Staff

INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, created_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'Evento Teste Identidade', true, now() + interval '1 day');

INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('b0000000-0000-0000-0000-000000000051', 'staff@teste.local', 'Staff Teste', 'STAFF'),
  ('b0000000-0000-0000-0000-0000000000a1', 'aval1@teste.local', 'Avaliador Um', 'AVALIADOR'),
  ('b0000000-0000-0000-0000-0000000000a2', 'aval2@teste.local', 'Avaliador Dois', 'AVALIADOR');
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('b0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-0000000000a2', 'e0000000-0000-0000-0000-000000000001', false);

CREATE TEMP TABLE t (chave text PRIMARY KEY, valor text);
GRANT ALL ON t TO anon, authenticated;

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
-- Staff: primeiro login liga a conta do Auth ao perfil
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000aa');
SELECT is(public.is_staff(), false, 'Staff ainda sem vínculo de conta não é reconhecido');
SELECT is((public.fn_vincular_conta_staff()->>'papel'), 'staff', 'fn_vincular_conta_staff liga a conta confirmada ao perfil STAFF');
SELECT is(public.is_staff(), true, 'Depois do vínculo, is_staff() = true');

-- ---------------------------------------------------------------------------
-- Pareamento: o celular pede, só o Staff confirma
-- ---------------------------------------------------------------------------
SELECT pg_temp.como(NULL);
SELECT throws_ok($$ SELECT public.fn_solicitar_pareamento() $$, '42501', NULL, 'anon sem sessão não pede pareamento');

SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d1');
INSERT INTO t VALUES ('par1', public.fn_solicitar_pareamento()->>'codigo');
SELECT matches((SELECT valor FROM t WHERE chave = 'par1'), '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$', 'Código de pareamento: 6 caracteres sem ambíguos');
SELECT is(public.avaliador_atual(), NULL, 'Celular ainda não vinculado');
SELECT is(public.fn_meu_perfil()->>'papel', NULL, 'Perfil sem papel antes do vínculo');
SELECT throws_ok(format($$ SELECT public.fn_parear_dispositivo(%L, 'b0000000-0000-0000-0000-0000000000a1') $$, (SELECT valor FROM t WHERE chave = 'par1')),
  '42501', NULL, 'O próprio celular não consegue se parear (só o Staff)');

SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000aa');
SELECT throws_ok($$ SELECT public.fn_parear_dispositivo('ZZZZZZ', 'b0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', NULL, 'Código de pareamento inexistente é recusado');
SELECT is((public.fn_parear_dispositivo(lower((SELECT valor FROM t WHERE chave = 'par1')), 'b0000000-0000-0000-0000-0000000000a1')->>'ok'),
  'true', 'Staff pareia o celular 1 ao Avaliador Um (aceita minúsculas)');

SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d1');
SELECT is(public.avaliador_atual(), 'b0000000-0000-0000-0000-0000000000a1'::uuid, 'Celular 1 agora é o Avaliador Um');
SELECT is(public.fn_meu_perfil()->>'papel', 'avaliador', 'fn_meu_perfil devolve papel avaliador');
SELECT throws_ok($$ SELECT public.fn_gerar_codigo_acesso('b0000000-0000-0000-0000-0000000000a2') $$,
  '42501', NULL, 'Avaliador não gera código de acesso para outro');

RESET ROLE;
SELECT is((SELECT is_credenciado FROM public.avaliadores_evento WHERE id_usuario = 'b0000000-0000-0000-0000-0000000000a1' AND id_evento = 'e0000000-0000-0000-0000-000000000001'),
  true, 'Parear no balcão também credencia o avaliador');

-- ---------------------------------------------------------------------------
-- Código de acesso: hash, uso único, tentativas
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000aa');
INSERT INTO t VALUES ('cod2', public.fn_gerar_codigo_acesso('b0000000-0000-0000-0000-0000000000a2')->>'codigo');
RESET ROLE;
SELECT ok((SELECT codigo_hash LIKE '$2%' AND codigo_hash <> (SELECT valor FROM t WHERE chave = 'cod2')
           FROM public.codigos_acesso WHERE id_usuario = 'b0000000-0000-0000-0000-0000000000a2' AND usado_em IS NULL),
  'Só o hash bcrypt do código é gravado');

SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d2');
SELECT is(public.fn_vincular_com_codigo('aval2@teste.local', 'AAAAAA')->>'ok', 'false', 'Código errado é recusado');
RESET ROLE;
SELECT is((SELECT tentativas FROM public.codigos_acesso WHERE id_usuario = 'b0000000-0000-0000-0000-0000000000a2' AND usado_em IS NULL),
  1, 'Tentativa errada é contabilizada (mesmo sem exceção)');

SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d2');
SELECT is(public.fn_vincular_com_codigo(' AVAL2@teste.local ', (SELECT valor FROM t WHERE chave = 'cod2'))->>'ok', 'true',
  'E-mail + código corretos vinculam o celular 2 ao Avaliador Dois');
SELECT is(public.avaliador_atual(), 'b0000000-0000-0000-0000-0000000000a2'::uuid, 'Celular 2 agora é o Avaliador Dois');

SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d3');
SELECT is(public.fn_vincular_com_codigo('aval2@teste.local', (SELECT valor FROM t WHERE chave = 'cod2'))->>'ok', 'false',
  'O mesmo código não serve uma segunda vez (uso único)');

-- Força bruta: esgota as tentativas e o código correto deixa de valer
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000aa');
INSERT INTO t VALUES ('cod2b', public.fn_gerar_codigo_acesso('b0000000-0000-0000-0000-0000000000a2')->>'codigo');
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d3');
SELECT public.fn_vincular_com_codigo('aval2@teste.local', 'AAAAAA') FROM generate_series(1, 5);
SELECT is(public.fn_vincular_com_codigo('aval2@teste.local', (SELECT valor FROM t WHERE chave = 'cod2b'))->>'ok', 'false',
  'Depois de 5 erros o código é invalidado, mesmo que o próximo esteja certo');

-- Um aparelho ativo por avaliador
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d3');
INSERT INTO t VALUES ('par3', public.fn_solicitar_pareamento()->>'codigo');
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000aa');
SELECT public.fn_parear_dispositivo((SELECT valor FROM t WHERE chave = 'par3'), 'b0000000-0000-0000-0000-0000000000a1');
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d1');
SELECT is(public.avaliador_atual(), NULL, 'Parear um novo celular revoga o anterior do mesmo avaliador');

-- Desvincular
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000aa');
SELECT public.fn_desvincular_dispositivo('b0000000-0000-0000-0000-0000000000a2');
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000d2');
SELECT is(public.avaliador_atual(), NULL, 'Staff desvincula o aparelho do Avaliador Dois');

-- ---------------------------------------------------------------------------
-- Autocadastro (anon): cria novos, nunca altera existentes
-- ---------------------------------------------------------------------------
SELECT pg_temp.como(NULL);
SELECT is(public.fn_autocadastro_avaliador('e0000000-0000-0000-0000-000000000001', 'Pessoa Nova', 'nova@teste.local', NULL, 'Instituto Ação Teste', NULL)->>'situacao',
  'cadastrado', 'Autocadastro cria avaliador novo');
SELECT is(public.fn_autocadastro_avaliador('e0000000-0000-0000-0000-000000000001', 'Nome Trocado', 'aval1@teste.local', NULL, NULL, NULL)->>'situacao',
  'ja_cadastrado', 'Autocadastro com e-mail existente não recadastra');
SELECT throws_ok($$ SELECT public.fn_autocadastro_avaliador('e0000000-0000-0000-0000-000000000001', 'X', 'nao-e-email', NULL, NULL, NULL) $$,
  'P0001', NULL, 'Autocadastro valida nome e e-mail');
RESET ROLE;
SELECT is((SELECT nome FROM public.usuarios WHERE id_usuario = 'b0000000-0000-0000-0000-0000000000a1'), 'Avaliador Um',
  'Autocadastro não renomeia avaliador existente');
SELECT is((SELECT i.nome_normalizado FROM public.usuarios u
           JOIN public.avaliadores_evento ae ON ae.id_usuario = u.id_usuario
           JOIN public.instituicoes i ON i.id_instituicao = ae.id_instituicao
           WHERE u.email = 'nova@teste.local'), 'instituto acao teste',
  'Instituição nova é gravada com nome_normalizado (sem acento, minúsculo)');

-- ---------------------------------------------------------------------------
-- Telão e configuração do evento
-- ---------------------------------------------------------------------------
SELECT pg_temp.como(NULL);
SELECT ok(public.fn_telao_resumo('e0000000-0000-0000-0000-000000000001') ?& ARRAY['total_projetos', 'avaliadores_credenciados', 'avaliacoes_em_andamento', 'avaliacoes_realizadas'],
  'Telão (anon) recebe só os totais');
RESET ROLE;
SELECT throws_ok($$ UPDATE public.eventos SET tamanho_codigo = 3 WHERE id_evento = 'e0000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'O banco recusa código com menos de 6 caracteres');

SELECT * FROM finish();
ROLLBACK;
