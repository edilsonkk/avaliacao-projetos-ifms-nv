-- Etapa 3 da revisão de segurança (OWASP Top 10 A04, API6, CAPEC): regras de negócio e abuso.
-- Migration 20261031040000_seguranca_regras_negocio. Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(19);

-- Cenário: evento ativo com a janela aberta agora (fuso de MS); questionário Q1 (3 perguntas, 1 a 10), Q3 (outro do
-- mesmo evento), Q2 (de outro evento); P1 livre, P2 com Q1 fixado; avaliadora Ana com celular vinculado
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES ('d2200000-0000-0000-0000-0000000000a1', NULL, true, NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, sistema_liberado, data_evento, horario_inicio, horario_fim) VALUES
  ('e2200000-0000-0000-0000-000000000001', 'Feira', true, 3, true, (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59'),
  ('e2200000-0000-0000-0000-000000000002', 'Outra', false, 3, true, NULL, NULL, NULL);
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima) VALUES
  ('a2200000-0000-0000-0000-000000000001', 'e2200000-0000-0000-0000-000000000001', 'Q1', 1, 10),
  ('a2200000-0000-0000-0000-000000000002', 'e2200000-0000-0000-0000-000000000002', 'Q2 de outro evento', 1, 10),
  ('a2200000-0000-0000-0000-000000000003', 'e2200000-0000-0000-0000-000000000001', 'Q3', 1, 10);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta) VALUES
  ('b2200000-0000-0000-0000-000000000011', 'a2200000-0000-0000-0000-000000000001', 1, 'Q1 pergunta 1'),
  ('b2200000-0000-0000-0000-000000000012', 'a2200000-0000-0000-0000-000000000001', 2, 'Q1 pergunta 2'),
  ('b2200000-0000-0000-0000-000000000013', 'a2200000-0000-0000-0000-000000000001', 3, 'Q1 pergunta 3'),
  ('b2200000-0000-0000-0000-000000000021', 'a2200000-0000-0000-0000-000000000002', 1, 'Q2 pergunta 1'),
  ('b2200000-0000-0000-0000-000000000031', 'a2200000-0000-0000-0000-000000000003', 1, 'Q3 pergunta 1');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao, id_questionario_fixado) VALUES
  ('f2200000-0000-0000-0000-000000000001', 'RN-1', 'Livre', 'e2200000-0000-0000-0000-000000000001', true, false, NULL),
  ('f2200000-0000-0000-0000-000000000002', 'RN-2', 'Com Q1 fixado', 'e2200000-0000-0000-0000-000000000001', true, false, 'a2200000-0000-0000-0000-000000000001');
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c2200000-0000-0000-0000-0000000000a1', 'ana22@teste.local', 'Ana', 'AVALIADOR');
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c2200000-0000-0000-0000-0000000000a1', 'e2200000-0000-0000-0000-000000000001', true);
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d2200000-0000-0000-0000-0000000000a1', 'c2200000-0000-0000-0000-0000000000a1', 'e2200000-0000-0000-0000-000000000001', 'codigo');
INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em) VALUES
  ('c2200000-0000-0000-0000-0000000000a1', 'f2200000-0000-0000-0000-000000000001', now() + interval '30 minutes');

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
-- Envia a avaliação da Ana no projeto e questionário dados, com as respostas [(pergunta, nota)]
CREATE FUNCTION pg_temp.enviar(p_projeto text, p_questionario text, p_respostas jsonb, p_parecer text DEFAULT 'ok') RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.fn_enviar_avaliacao('c2200000-0000-0000-0000-0000000000a1', p_projeto::uuid, p_questionario::uuid, p_respostas, p_parecer, NULL);
$$;

-- ---------------------------------------------------------------------------
-- C1: a nota só vale com todas as perguntas do questionário do projeto, uma vez cada
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d2200000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000001', 'a2200000-0000-0000-0000-000000000001',
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000011","nota":10}]') $$, '22023', NULL, 'responder só 1 de 3 perguntas é recusado');
SELECT throws_ok($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000001', 'a2200000-0000-0000-0000-000000000001',
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000011","nota":10},{"id_pergunta":"b2200000-0000-0000-0000-000000000011","nota":10},{"id_pergunta":"b2200000-0000-0000-0000-000000000012","nota":1}]') $$,
  '22023', NULL, 'pergunta repetida (para pesar mais) é recusada');
SELECT throws_ok($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000001', 'a2200000-0000-0000-0000-000000000001',
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000011","nota":8},{"id_pergunta":"b2200000-0000-0000-0000-000000000012","nota":8},{"id_pergunta":"b2200000-0000-0000-0000-000000000031","nota":8}]') $$,
  '22023', NULL, 'pergunta de outro questionário é recusada');
SELECT throws_ok($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000001', NULL,
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000011","nota":10}]') $$, '22023', NULL, 'sem questionário é recusado');
SELECT throws_ok($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000001', 'a2200000-0000-0000-0000-000000000002',
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000021","nota":10}]') $$, '42501', NULL, 'questionário de outro evento é recusado');
SELECT throws_ok($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000001', 'a2200000-0000-0000-0000-000000000001',
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000011","nota":8},{"id_pergunta":"b2200000-0000-0000-0000-000000000012","nota":null},{"id_pergunta":"b2200000-0000-0000-0000-000000000013","nota":8}]') $$,
  '22023', NULL, 'nota vazia é recusada');
SELECT throws_ok(format($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000001', 'a2200000-0000-0000-0000-000000000001',
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000011","nota":8},{"id_pergunta":"b2200000-0000-0000-0000-000000000012","nota":8},{"id_pergunta":"b2200000-0000-0000-0000-000000000013","nota":8}]', %L) $$, repeat('x', 5001)),
  '22001', NULL, 'parecer com mais de 5000 caracteres é recusado');
SELECT lives_ok($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000001', 'a2200000-0000-0000-0000-000000000001',
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000011","nota":9},{"id_pergunta":"b2200000-0000-0000-0000-000000000012","nota":6},{"id_pergunta":"b2200000-0000-0000-0000-000000000013","nota":6}]') $$,
  'todas as perguntas, uma vez cada: aceito');
RESET role;
SELECT is((SELECT nota_final FROM public.avaliacoes WHERE id_usuario = 'c2200000-0000-0000-0000-0000000000a1' AND id_projeto = 'f2200000-0000-0000-0000-000000000001'),
  7.00::numeric(5,2), 'nota = média das 3 perguntas');

-- Projeto com questionário fixado: outro questionário do mesmo evento é recusado
INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em) VALUES
  ('c2200000-0000-0000-0000-0000000000a1', 'f2200000-0000-0000-0000-000000000002', now() + interval '30 minutes');
SELECT pg_temp.como('d2200000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT pg_temp.enviar('f2200000-0000-0000-0000-000000000002', 'a2200000-0000-0000-0000-000000000003',
  '[{"id_pergunta":"b2200000-0000-0000-0000-000000000031","nota":10}]') $$, '42501', NULL, 'questionário diferente do fixado no projeto é recusado');

-- ---------------------------------------------------------------------------
-- C2: sorteio e fila só dentro da janela do evento (data, horário e sistema liberado)
-- ---------------------------------------------------------------------------
RESET role;
DELETE FROM public.locks_ativos WHERE id_usuario = 'c2200000-0000-0000-0000-0000000000a1';
SELECT pg_temp.como('d2200000-0000-0000-0000-0000000000a1');
SELECT is(public.sortear_proximo_projeto('c2200000-0000-0000-0000-0000000000a1', 'e2200000-0000-0000-0000-000000000001'),
  'f2200000-0000-0000-0000-000000000002'::uuid, 'janela aberta: sorteia');
RESET role;
UPDATE public.eventos SET sistema_liberado = false WHERE id_evento = 'e2200000-0000-0000-0000-000000000001';
SELECT pg_temp.como('d2200000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT public.sortear_proximo_projeto('c2200000-0000-0000-0000-0000000000a1', 'e2200000-0000-0000-0000-000000000001') $$,
  'P0001', NULL, 'sistema pausado pela coordenação: não sorteia');
SELECT throws_ok($$ SELECT public.fn_assumir_item_fila() $$, 'P0001', NULL, 'sistema pausado: não assume fila');
RESET role;
UPDATE public.eventos SET sistema_liberado = true, data_evento = (now() AT TIME ZONE 'America/Campo_Grande')::date + 1
WHERE id_evento = 'e2200000-0000-0000-0000-000000000001';
SELECT pg_temp.como('d2200000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT public.sortear_proximo_projeto('c2200000-0000-0000-0000-0000000000a1', 'e2200000-0000-0000-0000-000000000001') $$,
  'P0001', NULL, 'antes do dia do evento: não sorteia');
RESET role;
UPDATE public.eventos SET data_evento = (now() AT TIME ZONE 'America/Campo_Grande')::date, horario_inicio = NULL
WHERE id_evento = 'e2200000-0000-0000-0000-000000000001';
SELECT pg_temp.como('d2200000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT public.sortear_proximo_projeto('c2200000-0000-0000-0000-0000000000a1', 'e2200000-0000-0000-0000-000000000001') $$,
  'P0001', NULL, 'horário não configurado: não sorteia');

-- ---------------------------------------------------------------------------
-- C3: autocadastro público com limite (cadastro em massa e instituições inventadas)
-- ---------------------------------------------------------------------------
RESET role;
INSERT INTO public.registro_autocadastro (id_evento, criado_em, criou_instituicao)
SELECT 'e2200000-0000-0000-0000-000000000001', now() - interval '10 minutes', true FROM generate_series(1, 20);
SELECT pg_temp.como(NULL);
SELECT lives_ok($$ SELECT public.fn_autocadastro_avaliador('e2200000-0000-0000-0000-000000000001', 'Pessoa Nova', 'nova22@teste.local', NULL, 'Escola Inventada', NULL) $$,
  'cadastro aceito mesmo com o limite de instituições novas atingido');
RESET role;
SELECT is((SELECT ae.id_instituicao FROM public.avaliadores_evento ae JOIN public.usuarios u USING (id_usuario) WHERE u.email = 'nova22@teste.local'), NULL,
  'limite de instituições novas na hora: cadastra sem criar a instituição (o Staff ajusta)');
SELECT is((SELECT count(*)::int FROM public.instituicoes WHERE nome_exibicao = 'Escola Inventada'), 0, 'instituição não criada');
INSERT INTO public.registro_autocadastro (id_evento, criado_em, criou_instituicao)
SELECT 'e2200000-0000-0000-0000-000000000001', now(), false FROM generate_series(1, 30);
SELECT pg_temp.como(NULL);
SELECT throws_ok($$ SELECT public.fn_autocadastro_avaliador('e2200000-0000-0000-0000-000000000001', 'Robo', 'robo22@teste.local', NULL, NULL, NULL) $$,
  'P0001', NULL, 'mais de 30 autocadastros no último minuto: recusa');

SELECT * FROM finish();
ROLLBACK;
