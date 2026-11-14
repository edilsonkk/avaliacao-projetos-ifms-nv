-- Trava do questionário no primeiro avaliador como opção do evento
-- (eventos.fixar_questionario_primeira_avaliacao, migration 20261111030000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

-- Cenário: evento ativo com a janela aberta agora, dois questionários do evento (Q1 e Q2, uma
-- pergunta cada), dois projetos com check-in e duas avaliadoras com celular vinculado.
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3000000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d3000000-0000-0000-0000-0000000000a2', NULL, true, NULL),
  ('d3000000-0000-0000-0000-0000000000ad', 'admin30@teste.local', false, now());
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, sistema_liberado, data_evento, horario_inicio, horario_fim) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'Feira Trinta', true, 3, true, (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima) VALUES
  ('a3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'Q1', 1, 10),
  ('a3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001', 'Q2', 1, 10);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta) VALUES
  ('b3000000-0000-0000-0000-000000000011', 'a3000000-0000-0000-0000-000000000001', 1, 'Q1 pergunta 1'),
  ('b3000000-0000-0000-0000-000000000021', 'a3000000-0000-0000-0000-000000000002', 1, 'Q2 pergunta 1');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao) VALUES
  ('f3000000-0000-0000-0000-000000000001', 'TQ-1', 'Trava desligada', 'e3000000-0000-0000-0000-000000000001', true, false),
  ('f3000000-0000-0000-0000-000000000002', 'TQ-2', 'Trava ligada', 'e3000000-0000-0000-0000-000000000001', true, false);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c3000000-0000-0000-0000-0000000000a1', 'ana30@teste.local', 'Ana', 'AVALIADOR', NULL),
  ('c3000000-0000-0000-0000-0000000000a2', 'bia30@teste.local', 'Bia', 'AVALIADOR', NULL),
  ('c3000000-0000-0000-0000-0000000000ad', 'admin30@teste.local', 'Admin', 'ADMIN', 'd3000000-0000-0000-0000-0000000000ad');
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c3000000-0000-0000-0000-0000000000a1', 'e3000000-0000-0000-0000-000000000001', true),
  ('c3000000-0000-0000-0000-0000000000a2', 'e3000000-0000-0000-0000-000000000001', true);
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d3000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-0000000000a1', 'e3000000-0000-0000-0000-000000000001', 'codigo'),
  ('d3000000-0000-0000-0000-0000000000a2', 'c3000000-0000-0000-0000-0000000000a2', 'e3000000-0000-0000-0000-000000000001', 'codigo');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION pg_temp.travar(p_usuario text, p_projeto text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em)
  VALUES (p_usuario::uuid, p_projeto::uuid, now() + interval '30 minutes');
$$;

CREATE FUNCTION pg_temp.enviar(p_usuario text, p_projeto text, p_questionario text, p_pergunta text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.fn_enviar_avaliacao(p_usuario::uuid, p_projeto::uuid, p_questionario::uuid,
    jsonb_build_array(jsonb_build_object('id_pergunta', p_pergunta, 'nota', 8)), 'ok', NULL);
$$;

-- ---------------------------------------------------------------------------
-- Padrão: a trava vem ligada e o comportamento é o de sempre
-- ---------------------------------------------------------------------------
SELECT is((SELECT fixar_questionario_primeira_avaliacao FROM public.eventos WHERE id_evento = 'e3000000-0000-0000-0000-000000000001'),
  true, 'Evento novo nasce travando o questionário no primeiro avaliador');

SELECT is((SELECT (public.fn_meu_perfil()->>'fixar_questionario')), 'true',
  'fn_meu_perfil informa a trava para a tela do avaliador');

-- Ana avalia TQ-2 com Q1: fixa o questionário do projeto
SELECT pg_temp.travar('c3000000-0000-0000-0000-0000000000a1', 'f3000000-0000-0000-0000-000000000002');
SELECT pg_temp.como('d3000000-0000-0000-0000-0000000000a1');
SELECT is(pg_temp.enviar('c3000000-0000-0000-0000-0000000000a1', 'f3000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000011')->>'sucesso', 'true',
  'Com a trava ligada, a primeira avaliação é aceita');
RESET role;
SELECT is((SELECT id_questionario_fixado FROM public.projetos WHERE id_projeto = 'f3000000-0000-0000-0000-000000000002'),
  'a3000000-0000-0000-0000-000000000001'::uuid, 'Com a trava ligada, o questionário do projeto fica fixado');

-- Bia tenta o Q2 no mesmo projeto: recusado
SELECT pg_temp.travar('c3000000-0000-0000-0000-0000000000a2', 'f3000000-0000-0000-0000-000000000002');
SELECT pg_temp.como('d3000000-0000-0000-0000-0000000000a2');
SELECT throws_ok($$ SELECT pg_temp.enviar('c3000000-0000-0000-0000-0000000000a2', 'f3000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000021') $$,
  '42501', NULL, 'Com a trava ligada, questionário diferente do fixado é recusado');

-- ---------------------------------------------------------------------------
-- Trava desligada: cada avaliador escolhe e nada é fixado
-- ---------------------------------------------------------------------------
RESET role;
DELETE FROM public.locks_ativos WHERE id_usuario = 'c3000000-0000-0000-0000-0000000000a2';
UPDATE public.eventos SET fixar_questionario_primeira_avaliacao = false
 WHERE id_evento = 'e3000000-0000-0000-0000-000000000001';

SELECT pg_temp.travar('c3000000-0000-0000-0000-0000000000a1', 'f3000000-0000-0000-0000-000000000001');
SELECT pg_temp.como('d3000000-0000-0000-0000-0000000000a1');
SELECT is(pg_temp.enviar('c3000000-0000-0000-0000-0000000000a1', 'f3000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000011')->>'sucesso', 'true',
  'Com a trava desligada, a avaliação é aceita');
RESET role;
SELECT is((SELECT id_questionario_fixado FROM public.projetos WHERE id_projeto = 'f3000000-0000-0000-0000-000000000001'),
  NULL, 'Com a trava desligada, o projeto não fica preso a nenhum questionário');

-- Bia usa outro questionário no mesmo projeto: aceito
SELECT pg_temp.travar('c3000000-0000-0000-0000-0000000000a2', 'f3000000-0000-0000-0000-000000000001');
SELECT pg_temp.como('d3000000-0000-0000-0000-0000000000a2');
SELECT is(pg_temp.enviar('c3000000-0000-0000-0000-0000000000a2', 'f3000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000021')->>'sucesso', 'true',
  'Com a trava desligada, dois avaliadores usam questionários diferentes no mesmo projeto');

-- Conferência: C8 não acusa o que é regra do evento (TQ-2 tem questionário fixado de antes)
SELECT pg_temp.como('d3000000-0000-0000-0000-0000000000ad');
SELECT is((SELECT count(*)::int FROM public.fn_auditar_notas('e3000000-0000-0000-0000-000000000001') WHERE codigo = 'C8'),
  0, 'Com a trava desligada, a conferência não acusa C8');

SELECT * FROM finish();
ROLLBACK;
