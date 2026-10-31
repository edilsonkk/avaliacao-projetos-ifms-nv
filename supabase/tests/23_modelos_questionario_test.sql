-- Questionários prontos (modelos), reaproveitamento entre eventos, nota ponderada e desempate
-- (migration 20261031050000_modelos_questionario). Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);

-- Cenário: E1 ativo (janela aberta), E2 anterior com 2 questionários (um copiado do modelo 1); Admin, Staff e a
-- avaliadora Ana (celular vinculado) com trava no projeto P1
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d2300000-0000-0000-0000-0000000000ad', 'admin23@teste.local', false, now()),
  ('d2300000-0000-0000-0000-000000000051', 'staff23@teste.local', false, now()),
  ('d2300000-0000-0000-0000-0000000000a1', NULL, true, NULL);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('d2300000-0000-0000-0000-0000000000ad', 'admin23@teste.local', 'Admin', 'ADMIN', NULL),
  ('c2300000-0000-0000-0000-000000000051', 'staff23@teste.local', 'Staff', 'STAFF', 'd2300000-0000-0000-0000-000000000051'),
  ('c2300000-0000-0000-0000-0000000000a1', 'ana23@teste.local', 'Ana', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, sistema_liberado, data_evento, horario_inicio, horario_fim) VALUES
  ('e2300000-0000-0000-0000-000000000001', 'Feira 2026', true, 3, true, (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59'),
  ('e2300000-0000-0000-0000-000000000002', 'Feira 2025', false, 3, true, '2025-10-30', NULL, NULL);
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, id_origem) VALUES
  ('a2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000002', 'Ponderado 2025', 1, 5, NULL),
  ('a2300000-0000-0000-0000-000000000002', 'e2300000-0000-0000-0000-000000000002', 'Ideia 2025', 1, 5, '0d0de100-0000-4000-8000-000000000001'),
  ('a2300000-0000-0000-0000-000000000003', 'e2300000-0000-0000-0000-000000000001', 'Técnico · Nível 3 Produção', 1, 5, NULL),
  ('a2300000-0000-0000-0000-000000000004', 'e2300000-0000-0000-0000-000000000001', 'Desempate', 1, 5, NULL);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('b2300000-0000-0000-0000-000000000011', 'a2300000-0000-0000-0000-000000000001', 1, 'Vale triplo', 3, 1),
  ('b2300000-0000-0000-0000-000000000012', 'a2300000-0000-0000-0000-000000000001', 2, 'Vale um', 1, 2),
  ('b2300000-0000-0000-0000-000000000021', 'a2300000-0000-0000-0000-000000000002', 1, 'Ideia', 1, 1),
  ('b2300000-0000-0000-0000-000000000031', 'a2300000-0000-0000-0000-000000000003', 1, 'Manual', 1, 1),
  ('b2300000-0000-0000-0000-000000000041', 'a2300000-0000-0000-0000-000000000004', 1, 'Prioridade 1', 1, 1),
  ('b2300000-0000-0000-0000-000000000042', 'a2300000-0000-0000-0000-000000000004', 2, 'Prioridade 2', 1, 2);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao) VALUES
  ('f2300000-0000-0000-0000-000000000001', 'MQ-1', 'Ponderado', 'e2300000-0000-0000-0000-000000000001', true, false),
  ('f2300000-0000-0000-0000-00000000000a', 'MQ-A', 'Empate A', 'e2300000-0000-0000-0000-000000000001', true, false),
  ('f2300000-0000-0000-0000-00000000000b', 'MQ-B', 'Empate B', 'e2300000-0000-0000-0000-000000000001', true, false),
  ('f2300000-0000-0000-0000-00000000000c', 'MQ-C', 'Empate C', 'e2300000-0000-0000-0000-000000000001', true, false);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c2300000-0000-0000-0000-0000000000a1', 'e2300000-0000-0000-0000-000000000001', true);
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d2300000-0000-0000-0000-0000000000a1', 'c2300000-0000-0000-0000-0000000000a1', 'e2300000-0000-0000-0000-000000000001', 'codigo');
INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em) VALUES
  ('c2300000-0000-0000-0000-0000000000a1', 'f2300000-0000-0000-0000-000000000001', now() + interval '30 minutes');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_sub IS NULL THEN
    PERFORM set_config('role', 'anon', true);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  ELSE
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  END IF;
END $$;
CREATE FUNCTION pg_temp.copiar(p_origem text) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.admin_copiar_questionario(p_origem::uuid, 'e2300000-0000-0000-0000-000000000001');
$$;

-- ---------------------------------------------------------------------------
-- Modelos carregados e restritos ao Admin
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d2300000-0000-0000-0000-0000000000ad');
SELECT is((SELECT count(*)::int FROM public.modelos_questionario WHERE codigo LIKE 'feira-software-q%'), 7, 'Admin vê os 7 modelos');
SELECT is((SELECT array_agg(n ORDER BY m.ordem) FROM public.modelos_questionario m
           CROSS JOIN LATERAL (SELECT count(*)::int n FROM public.perguntas_modelo_questionario p WHERE p.id_modelo = m.id_modelo) c
           WHERE m.codigo LIKE 'feira-software-q%'),
  ARRAY[10, 10, 10, 10, 3, 10, 10], '10 perguntas em cada modelo e 3 no voto popular');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.modelos_questionario WHERE codigo LIKE 'feira-software-q%' AND (escala_minima <> 1 OR escala_maxima <> 5)),
  'todos os modelos na escala de 1 a 5');
SELECT is((SELECT texto_pergunta || ' | ' || descricao_lembrete FROM public.perguntas_modelo_questionario
           WHERE id_modelo = '0d0de100-0000-4000-8000-000000000006' AND ordem = 1),
  'Problema e Hipótese | Clareza na formulação, delimitação e relação com os objetivos.',
  'critério antes dos dois pontos; texto de ajuda depois');

SELECT pg_temp.como('d2300000-0000-0000-0000-000000000051');
SELECT is((SELECT count(*)::int FROM public.modelos_questionario), 0, 'Staff não lê os modelos');
SELECT throws_ok($$ SELECT pg_temp.copiar('0d0de100-0000-4000-8000-000000000002') $$, '42501', NULL, 'Staff não copia questionário');
SELECT throws_ok($$ SELECT public.admin_listar_questionarios_reaproveitaveis('e2300000-0000-0000-0000-000000000001') $$, '42501', NULL,
  'Staff não lista questionários de outros eventos');
SELECT pg_temp.como('d2300000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT pg_temp.copiar('0d0de100-0000-4000-8000-000000000002') $$, '42501', NULL, 'avaliador não copia questionário');
SELECT pg_temp.como(NULL);
SELECT throws_ok($$ SELECT count(*) FROM public.modelos_questionario $$, '42501', NULL, 'anon não lê os modelos');
SELECT throws_ok($$ SELECT pg_temp.copiar('0d0de100-0000-4000-8000-000000000002') $$, '42501', NULL, 'anon não copia questionário');

-- ---------------------------------------------------------------------------
-- Ativar modelo (cópia para o evento)
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d2300000-0000-0000-0000-0000000000ad');
CREATE TEMP TABLE copia AS SELECT pg_temp.copiar('0d0de100-0000-4000-8000-000000000002') AS id;
SELECT is((SELECT array_agg(texto_pergunta ORDER BY ordem) FROM public.perguntas_questionario WHERE id_questionario = (SELECT id FROM copia)),
  (SELECT array_agg(texto_pergunta ORDER BY ordem) FROM public.perguntas_modelo_questionario WHERE id_modelo = '0d0de100-0000-4000-8000-000000000002'),
  'ativar o modelo copia as 10 perguntas na mesma ordem');
SELECT is((SELECT id_evento::text || ' ' || titulo FROM public.questionarios WHERE id_questionario = (SELECT id FROM copia)),
  'e2300000-0000-0000-0000-000000000001 Técnico · Nível 2 Protótipo', 'a cópia pertence ao evento');
SELECT is(pg_temp.copiar('0d0de100-0000-4000-8000-000000000002'), (SELECT id FROM copia), 'ativar de novo não duplica');
CREATE TEMP TABLE copia3 AS SELECT pg_temp.copiar('0d0de100-0000-4000-8000-000000000003') AS id;
SELECT is((SELECT titulo FROM public.questionarios WHERE id_questionario = (SELECT id FROM copia3)),
  'Técnico · Nível 3 Produção (cópia)', 'título repetido no evento ganha "(cópia)"');

-- ---------------------------------------------------------------------------
-- Reaproveitar de evento anterior
-- ---------------------------------------------------------------------------
SELECT is((SELECT array_agg(titulo || ':' || ja_no_evento ORDER BY titulo)
           FROM public.admin_listar_questionarios_reaproveitaveis('e2300000-0000-0000-0000-000000000001') WHERE nome_evento = 'Feira 2025'),
  ARRAY['Ideia 2025:false', 'Ponderado 2025:false'], 'lista os questionários do evento anterior');
CREATE TEMP TABLE reaproveitado AS SELECT pg_temp.copiar('a2300000-0000-0000-0000-000000000001') AS id;
SELECT is((SELECT array_agg(texto_pergunta || '/' || peso_calculo || '/' || peso_desempate ORDER BY ordem)
           FROM public.perguntas_questionario WHERE id_questionario = (SELECT id FROM reaproveitado)),
  ARRAY['Vale triplo/3.00/1.00', 'Vale um/1.00/2.00'], 'reaproveitar copia perguntas e pesos');
CREATE TEMP TABLE copia_ideia AS SELECT pg_temp.copiar('a2300000-0000-0000-0000-000000000002') AS id;
SELECT is((SELECT id_origem FROM public.questionarios WHERE id_questionario = (SELECT id FROM copia_ideia)),
  '0d0de100-0000-4000-8000-000000000001'::uuid, 'cópia de um questionário que veio de modelo continua ligada ao modelo');
SELECT is((SELECT array_agg(ja_no_evento ORDER BY titulo) FROM public.admin_listar_questionarios_reaproveitaveis('e2300000-0000-0000-0000-000000000001') WHERE nome_evento = 'Feira 2025'),
  ARRAY[true, true], 'a lista marca o que já está no evento');
SELECT throws_ok($$ SELECT pg_temp.copiar('a2300000-0000-0000-0000-000000000003') $$, '22023', NULL,
  'não copia um questionário do próprio evento');

-- ---------------------------------------------------------------------------
-- Nota ponderada pelos pesos das perguntas
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d2300000-0000-0000-0000-0000000000a1');
SELECT lives_ok(format($$ SELECT public.fn_enviar_avaliacao('c2300000-0000-0000-0000-0000000000a1', 'f2300000-0000-0000-0000-000000000001', %L,
  jsonb_build_array(
    jsonb_build_object('id_pergunta', (SELECT id_pergunta FROM public.perguntas_questionario WHERE id_questionario = %L AND ordem = 1), 'nota', 5),
    jsonb_build_object('id_pergunta', (SELECT id_pergunta FROM public.perguntas_questionario WHERE id_questionario = %L AND ordem = 2), 'nota', 2)),
  NULL, NULL) $$, (SELECT id FROM reaproveitado), (SELECT id FROM reaproveitado), (SELECT id FROM reaproveitado)),
  'avaliação com o questionário reaproveitado é aceita');
RESET role;
SELECT is((SELECT nota_final FROM public.avaliacoes WHERE id_projeto = 'f2300000-0000-0000-0000-000000000001'), 4.25::numeric(5,2),
  'nota = média ponderada (5×3 + 2×1) ÷ 4 = 4,25; a média simples daria 3,50');
SELECT pg_temp.como('d2300000-0000-0000-0000-0000000000ad');
SELECT throws_ok(format($$ SELECT public.admin_excluir_questionario(%L) $$, (SELECT id FROM reaproveitado)), NULL, NULL,
  'desativar (excluir) uma cópia já usada em avaliação é recusado');

-- ---------------------------------------------------------------------------
-- Desempate pela prioridade das perguntas (A e C: 5/3; B: 3/5; todos com média 4)
-- ---------------------------------------------------------------------------
RESET role;
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('a9300000-0000-0000-0000-00000000000a', 'f2300000-0000-0000-0000-00000000000a', 'c2300000-0000-0000-0000-0000000000a1', 'a2300000-0000-0000-0000-000000000004', 4, 'CONCLUIDA'),
  ('a9300000-0000-0000-0000-00000000000b', 'f2300000-0000-0000-0000-00000000000b', 'c2300000-0000-0000-0000-0000000000a1', 'a2300000-0000-0000-0000-000000000004', 4, 'CONCLUIDA'),
  ('a9300000-0000-0000-0000-00000000000c', 'f2300000-0000-0000-0000-00000000000c', 'c2300000-0000-0000-0000-0000000000a1', 'a2300000-0000-0000-0000-000000000004', 4, 'CONCLUIDA');
INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('a9300000-0000-0000-0000-00000000000a', 'b2300000-0000-0000-0000-000000000041', 5), ('a9300000-0000-0000-0000-00000000000a', 'b2300000-0000-0000-0000-000000000042', 3),
  ('a9300000-0000-0000-0000-00000000000b', 'b2300000-0000-0000-0000-000000000041', 3), ('a9300000-0000-0000-0000-00000000000b', 'b2300000-0000-0000-0000-000000000042', 5),
  ('a9300000-0000-0000-0000-00000000000c', 'b2300000-0000-0000-0000-000000000041', 5), ('a9300000-0000-0000-0000-00000000000c', 'b2300000-0000-0000-0000-000000000042', 3);
CREATE FUNCTION pg_temp.posicoes() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(codigo_projeto || '=' || posicao, ' ' ORDER BY codigo_projeto)
  FROM public.view_ranking_top3 WHERE id_evento = 'e2300000-0000-0000-0000-000000000001' AND codigo_projeto LIKE 'MQ-_' AND codigo_projeto <> 'MQ-1';
$$;
SELECT pg_temp.como('d2300000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.posicoes(), 'MQ-A=2 MQ-B=4 MQ-C=2',
  'média igual: vence a maior nota na pergunta de prioridade 1; A e C, iguais em tudo, continuam empatados');
RESET role;
UPDATE public.perguntas_questionario SET peso_desempate = 0 WHERE id_pergunta = 'b2300000-0000-0000-0000-000000000041';
SELECT pg_temp.como('d2300000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.posicoes(), 'MQ-A=3 MQ-B=2 MQ-C=3', 'prioridade 0 tira a pergunta do desempate');
RESET role;
UPDATE public.projetos SET is_fora_da_competicao = true WHERE id_projeto = 'f2300000-0000-0000-0000-00000000000b';
SELECT pg_temp.como('d2300000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.posicoes(), 'MQ-A=2 MQ-C=2', 'fora da competição não entra no ranking nem no desempate');

SELECT * FROM finish();
ROLLBACK;
