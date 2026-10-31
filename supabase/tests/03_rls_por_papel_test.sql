-- Fase 3: RLS por papel. Cada ataque da análise de segurança precisa ser negado.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

-- ---------------------------------------------------------------------------
-- Cenário: evento, projeto, Admin, Staff, dois avaliadores com aparelho e um celular sem vínculo
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d1000000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d1000000-0000-0000-0000-0000000000a2', NULL, true, NULL),
  ('d1000000-0000-0000-0000-0000000000ff', NULL, true, NULL),
  ('d1000000-0000-0000-0000-000000000051', 'staff3@teste.local', false, now());

-- Janela de avaliação aberta agora (o sorteio confere data e horário no fuso de MS)
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, created_at, cota_avaliacoes_padrao, data_evento, horario_inicio, horario_fim)
VALUES ('e1000000-0000-0000-0000-000000000001', 'Evento Teste RLS', true, now() + interval '2 days', 3,
        (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');
INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado) VALUES
  ('11000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Escola A', 'escola a'),
  ('11000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'Escola B', 'escola b');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_instituicao, is_check_in_realizado, expositores)
VALUES ('f1000000-0000-0000-0000-000000000001', 'RLS-001', 'Projeto RLS', 'e1000000-0000-0000-0000-000000000001',
        '11000000-0000-0000-0000-000000000001', true, 'Estudante Menor de Idade');

INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'admin3@teste.local', 'Admin', 'ADMIN', NULL),
  ('c1000000-0000-0000-0000-000000000051', 'staff3@teste.local', 'Staff', 'STAFF', 'd1000000-0000-0000-0000-000000000051'),
  ('c1000000-0000-0000-0000-0000000000a1', 'ava1@teste.local', 'Avaliadora 1', 'AVALIADOR', NULL),
  ('c1000000-0000-0000-0000-0000000000a2', 'ava2@teste.local', 'Avaliador 2', 'AVALIADOR', NULL);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado) VALUES
  ('c1000000-0000-0000-0000-0000000000a1', 'e1000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', true),
  ('c1000000-0000-0000-0000-0000000000a2', 'e1000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', true);
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d1000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-0000000000a1', 'e1000000-0000-0000-0000-000000000001', 'pareamento'),
  ('d1000000-0000-0000-0000-0000000000a2', 'c1000000-0000-0000-0000-0000000000a2', 'e1000000-0000-0000-0000-000000000001', 'pareamento');
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status, parecer_final)
VALUES ('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-0000000000a2', 9.5, 'CONCLUIDA', 'Parecer sigiloso');

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

CREATE FUNCTION pg_temp.afetadas(p_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- Visitante anônimo (qualquer pessoa na internet)
-- ---------------------------------------------------------------------------
SELECT pg_temp.como(NULL);
SELECT ok((SELECT count(*) FROM public.eventos) > 0, 'anon lê eventos (catálogo do autocadastro)');
SELECT throws_ok($$ SELECT email FROM public.usuarios $$, '42501', NULL, 'C3: anon não lê e-mails de usuários');
SELECT throws_ok($$ SELECT id_projeto FROM public.avaliacoes $$, '42501', NULL, 'anon não lê avaliações');
SELECT is((SELECT count(*)::int FROM public.projetos), 0, 'H3: anon não lê projetos (nomes de expositores)');
SELECT throws_ok($$ INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em)
  VALUES ('c1000000-0000-0000-0000-0000000000a2', 'f1000000-0000-0000-0000-000000000001', now() + interval '1 hour') $$,
  '42501', NULL, 'C2: anon não cria trava em nome de avaliador');
SELECT throws_ok($$ SELECT public.sortear_proximo_projeto('c1000000-0000-0000-0000-0000000000a2', 'e1000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'anon não sorteia em nome de avaliador');
SELECT throws_ok($$ INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
  VALUES ('e1000000-0000-0000-0000-000000000001', 'Spam', 'spam') $$, '42501', NULL, 'anon não insere instituições direto');
SELECT throws_ok($$ UPDATE public.projetos SET forcar_topo_fila = true $$, '42501', NULL,
  'H1: anon não altera projetos (sem permissão de gravação, não só RLS)');

-- ---------------------------------------------------------------------------
-- Celular com sessão, mas sem vínculo
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d1000000-0000-0000-0000-0000000000ff');
SELECT is((SELECT count(*)::int FROM public.projetos), 0, 'Celular sem vínculo não lê projetos');
SELECT throws_ok($$ INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em)
  VALUES ('c1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-000000000001', now() + interval '1 hour') $$,
  '42501', NULL, 'Celular sem vínculo não cria trava');
SELECT is((SELECT count(*)::int FROM public.usuarios), 0, 'Celular sem vínculo não lê usuários');

-- ---------------------------------------------------------------------------
-- Avaliadora 1 (aparelho vinculado) tentando agir como o Avaliador 2
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d1000000-0000-0000-0000-0000000000a1');
SELECT is((SELECT count(*)::int FROM public.projetos WHERE id_evento = 'e1000000-0000-0000-0000-000000000001'), 1, 'Avaliador vinculado lê projetos');
SELECT is((SELECT count(*)::int FROM public.usuarios), 1, 'Avaliador só lê o próprio usuário');
SELECT is((SELECT count(*)::int FROM public.avaliacoes), 0, 'Avaliador não lê notas e pareceres de outros');
SELECT throws_ok($$ INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em)
  VALUES ('c1000000-0000-0000-0000-0000000000a2', 'f1000000-0000-0000-0000-000000000001', now() + interval '1 hour') $$,
  '42501', NULL, 'C2: avaliador não cria trava em nome de outro');
SELECT throws_ok($$ SELECT public.sortear_proximo_projeto('c1000000-0000-0000-0000-0000000000a2', 'e1000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'C2: avaliador não sorteia em nome de outro');
SELECT throws_ok($$ SELECT public.fn_enviar_avaliacao('c1000000-0000-0000-0000-0000000000a2', 'f1000000-0000-0000-0000-000000000001', NULL, '[]'::jsonb, NULL, NULL) $$,
  '42501', NULL, 'C2: avaliador não envia nota em nome de outro');
SELECT throws_ok($$ INSERT INTO public.historico_impedimentos (id_usuario, id_projeto, tipo)
  VALUES ('c1000000-0000-0000-0000-0000000000a2', 'f1000000-0000-0000-0000-000000000001', 'ausencia') $$,
  '42501', NULL, 'H1: avaliador não marca ausência em nome de outro');
SELECT is(pg_temp.afetadas($q$UPDATE public.avaliadores_evento SET id_instituicao = '11000000-0000-0000-0000-000000000001'$q$), 0,
  'C2: avaliador não troca a própria instituição para burlar o conflito de interesse');
SELECT is(pg_temp.afetadas($q$UPDATE public.avaliadores_evento SET is_credenciado = true WHERE id_usuario = 'c1000000-0000-0000-0000-0000000000a1'$q$), 0,
  'H1: avaliador não se credencia sozinho');
SELECT is(pg_temp.afetadas($q$UPDATE public.projetos SET forcar_topo_fila = true$q$), 0,
  'H1: avaliador não altera projetos');
SELECT is(public.sortear_proximo_projeto('c1000000-0000-0000-0000-0000000000a1', 'e1000000-0000-0000-0000-000000000001'),
  'f1000000-0000-0000-0000-000000000001'::uuid, 'Avaliador recebe a trava pelo sorteio (gravação direta é negada, ver 19)');
SELECT lives_ok($$ SELECT public.fn_fixar_questionario('f1000000-0000-0000-0000-000000000001', NULL) $$,
  'Avaliador com a trava fixa o questionário');
SELECT is(public.fn_avaliacoes_ativas_do_projeto('f1000000-0000-0000-0000-000000000001'), 1,
  'Avaliador vê a contagem de avaliações (para a cota) sem ver as notas');
SELECT lives_ok($$ DELETE FROM public.locks_ativos WHERE id_usuario = 'c1000000-0000-0000-0000-0000000000a1' $$,
  'Avaliador libera a própria trava');

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d1000000-0000-0000-0000-000000000051');
SELECT is((SELECT count(*)::int FROM public.usuarios WHERE upper(papel) = 'ADMIN'), 0, 'Staff não lê dados do Admin');
SELECT ok((SELECT count(*) FROM public.usuarios WHERE upper(papel) = 'AVALIADOR') >= 2, 'Staff lê os avaliadores');
SELECT is((SELECT count(*)::int FROM public.avaliacoes), 0, 'Staff não lê notas');
SELECT is(pg_temp.afetadas($q$UPDATE public.avaliadores_evento SET is_credenciado = false
  WHERE id_usuario = 'c1000000-0000-0000-0000-0000000000a2'$q$), 1,
  'Staff credencia/descredencia avaliador');
SELECT lives_ok($$ SELECT public.fn_check_in_projeto('f1000000-0000-0000-0000-000000000001', true) $$,
  'Staff faz check-in pelo RPC');

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('c1000000-0000-0000-0000-000000000001');
SELECT is((SELECT count(*)::int FROM public.avaliacoes WHERE id_projeto = 'f1000000-0000-0000-0000-000000000001'), 1,
  'Admin lê todas as avaliações');

SELECT * FROM finish();
ROLLBACK;
