-- Etapa 1 da revisão de segurança (OWASP API Security Top 10 / ASVS cap. 8): matriz papel × objeto.
-- Migration 20261031010000_seguranca_matriz_papeis. Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(26);

-- Cenário: evento ativo, 3 projetos, Admin, Staff, avaliador com celular, celular sem vínculo
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d1900000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d1900000-0000-0000-0000-0000000000ff', NULL, true, NULL),
  ('d1900000-0000-0000-0000-000000000051', 'staff19@teste.local', false, now());
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao)
VALUES ('e1900000-0000-0000-0000-000000000001', 'Evento Segurança', true, 2);
INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade)
VALUES ('b1900000-0000-0000-0000-000000000001', 'e1900000-0000-0000-0000-000000000001', 'Bloqueada');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade, is_check_in_realizado, is_fora_da_competicao) VALUES
  ('f1900000-0000-0000-0000-000000000001', 'SEG-1', 'Livre', 'e1900000-0000-0000-0000-000000000001', NULL, true, false),
  ('f1900000-0000-0000-0000-000000000002', 'SEG-2', 'Da modalidade bloqueada', 'e1900000-0000-0000-0000-000000000001', 'b1900000-0000-0000-0000-000000000001', true, false),
  ('f1900000-0000-0000-0000-000000000003', 'SEG-3', 'Cota cheia', 'e1900000-0000-0000-0000-000000000001', NULL, true, false);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth, cpf, celular) VALUES
  ('c1900000-0000-0000-0000-0000000000ad', 'admin19@teste.local', 'Admin', 'ADMIN', NULL, NULL, NULL),
  ('c1900000-0000-0000-0000-000000000051', 'staff19@teste.local', 'Staff', 'STAFF', 'd1900000-0000-0000-0000-000000000051', NULL, NULL),
  ('c1900000-0000-0000-0000-0000000000a1', 'ava19@teste.local', 'Ana', 'AVALIADOR', NULL, '123.456.789-00', '67999990000'),
  ('c1900000-0000-0000-0000-0000000000a2', 'bia19@teste.local', 'Bia', 'AVALIADOR', NULL, NULL, NULL),
  ('c1900000-0000-0000-0000-0000000000a3', 'cid19@teste.local', 'Cid', 'AVALIADOR', NULL, NULL, NULL);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c1900000-0000-0000-0000-0000000000a1', 'e1900000-0000-0000-0000-000000000001', true);
INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade) VALUES
  ('c1900000-0000-0000-0000-0000000000a1', 'e1900000-0000-0000-0000-000000000001', 'b1900000-0000-0000-0000-000000000001');
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d1900000-0000-0000-0000-0000000000a1', 'c1900000-0000-0000-0000-0000000000a1', 'e1900000-0000-0000-0000-000000000001', 'codigo');
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status) VALUES
  ('f1900000-0000-0000-0000-000000000003', 'c1900000-0000-0000-0000-0000000000a2', 8, 'CONCLUIDA'),
  ('f1900000-0000-0000-0000-000000000003', 'c1900000-0000-0000-0000-0000000000a3', 8, 'CONCLUIDA');
-- Fila montada pelo Admin: modalidade bloqueada, cota cheia e, por último, o projeto livre
INSERT INTO public.fila_atribuicoes_direcionadas (id_usuario, id_projeto, ordem, status) VALUES
  ('c1900000-0000-0000-0000-0000000000a1', 'f1900000-0000-0000-0000-000000000002', 1, 'pendente'),
  ('c1900000-0000-0000-0000-0000000000a1', 'f1900000-0000-0000-0000-000000000003', 2, 'pendente'),
  ('c1900000-0000-0000-0000-0000000000a1', 'f1900000-0000-0000-0000-000000000001', 3, 'pendente');

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
-- Visitante sem login: sem permissão de gravação nas tabelas (não depende só da RLS)
-- ---------------------------------------------------------------------------
SELECT pg_temp.como(NULL);
SELECT throws_ok($$ UPDATE public.eventos SET cota_avaliacoes_padrao = 1 $$, '42501', NULL, 'anon não tem UPDATE em eventos');
SELECT throws_ok($$ DELETE FROM public.modalidades $$, '42501', NULL, 'anon não tem DELETE em modalidades');
SELECT throws_ok($$ UPDATE public.perguntas_questionario SET peso_calculo = 0 $$, '42501', NULL, 'anon não tem UPDATE em perguntas');
SELECT throws_ok($$ INSERT INTO public.projetos (codigo_projeto, titulo) VALUES ('X', 'X') $$, '42501', NULL, 'anon não tem INSERT em projetos');
SELECT lives_ok($$ SELECT id_evento FROM public.eventos $$, 'anon continua lendo eventos (autocadastro e Telão)');

-- ---------------------------------------------------------------------------
-- Celular com login anônimo, ainda sem vínculo
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d1900000-0000-0000-0000-0000000000ff');
SELECT throws_ok($$ SELECT public.fn_avaliacoes_do_questionario(gen_random_uuid()) $$, '42501', NULL,
  'fn_avaliacoes_do_questionario é só do Admin');
SELECT throws_ok($$ SELECT public.fn_assumir_item_fila() $$, '42501', NULL, 'celular sem vínculo não assume fila');
SELECT throws_ok($$ SELECT public.fn_registrar_impedimento('f1900000-0000-0000-0000-000000000001', 'ausencia') $$, '42501', NULL,
  'celular sem vínculo não registra impedimento');

-- ---------------------------------------------------------------------------
-- Avaliador: nada de gravação direta; tudo pelas funções, que validam
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d1900000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em)
  VALUES ('c1900000-0000-0000-0000-0000000000a1', 'f1900000-0000-0000-0000-000000000003', '2099-01-01') $$,
  '42501', NULL, 'avaliador não grava trava direto (escolher projeto, furar cota, bloquear por anos)');
SELECT is(pg_temp.afetadas($q$UPDATE public.fila_atribuicoes_direcionadas SET id_projeto = 'f1900000-0000-0000-0000-000000000003'
  WHERE id_usuario = 'c1900000-0000-0000-0000-0000000000a1'$q$), 0, 'avaliador não troca o projeto da própria fila');
SELECT throws_ok($$ INSERT INTO public.historico_impedimentos (id_usuario, id_projeto, tipo)
  VALUES ('c1900000-0000-0000-0000-0000000000a1', 'f1900000-0000-0000-0000-000000000003', 'ausencia') $$,
  '42501', NULL, 'avaliador não registra ausência direto');
SELECT throws_ok($$ SELECT public.fn_registrar_impedimento('f1900000-0000-0000-0000-000000000003', 'ausencia') $$,
  '42501', NULL, 'impedimento só no projeto em que o avaliador está (com trava)');

SELECT is(public.fn_assumir_item_fila(), 'f1900000-0000-0000-0000-000000000001'::uuid,
  'fila pula modalidade bloqueada e cota cheia e entrega o projeto livre');
RESET role;
SELECT is((SELECT array_agg(status ORDER BY ordem) FROM public.fila_atribuicoes_direcionadas
  WHERE id_usuario = 'c1900000-0000-0000-0000-0000000000a1')::text[],
  ARRAY['bloqueada_por_modalidade', 'concluida_por_outros', 'em_andamento'], 'cada item da fila recebe o motivo');
SELECT is((SELECT expira_em <= now() + interval '2 hours 1 minute' FROM public.locks_ativos
  WHERE id_usuario = 'c1900000-0000-0000-0000-0000000000a1' AND id_projeto = 'f1900000-0000-0000-0000-000000000001'), true,
  'trava da fila criada pelo banco, com validade de 2 horas');
SELECT pg_temp.como('d1900000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT public.fn_registrar_impedimento('f1900000-0000-0000-0000-000000000001', 'qualquer') $$,
  '22023', NULL, 'tipo de impedimento inválido é recusado');
SELECT lives_ok($$ SELECT public.fn_registrar_impedimento('f1900000-0000-0000-0000-000000000001', 'ausencia') $$,
  'avaliador registra ausência do projeto em que está');
RESET role;
SELECT is((SELECT count(*)::int FROM public.historico_impedimentos WHERE id_usuario = 'c1900000-0000-0000-0000-0000000000a1'
  AND id_projeto = 'f1900000-0000-0000-0000-000000000001' AND tipo = 'ausencia'), 1, 'ausência gravada');
SELECT is((SELECT count(*)::int FROM public.locks_ativos WHERE id_usuario = 'c1900000-0000-0000-0000-0000000000a1'), 0,
  'ausência libera a trava');
SELECT pg_temp.como('d1900000-0000-0000-0000-0000000000a1');
SELECT is(public.fn_assumir_item_fila(), NULL, 'fila sem pendentes: devolve nulo (segue para o sorteio)');

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d1900000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT cpf FROM public.usuarios $$, '42501', NULL, 'Staff não lê CPF (LGPD: dado que nenhuma tela usa)');
SELECT throws_ok($$ SELECT celular FROM public.usuarios $$, '42501', NULL, 'Staff não lê celular');
SELECT lives_ok($$ SELECT id_usuario, nome, email, papel FROM public.usuarios $$, 'Staff lê nome e e-mail dos avaliadores');
SELECT throws_ok($$ INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
  VALUES ('c1900000-0000-0000-0000-0000000000ad', 'e1900000-0000-0000-0000-000000000001', true) $$,
  '42501', NULL, 'Staff só credencia avaliadores (não o Admin)');
SELECT lives_ok($$ INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
  VALUES ('c1900000-0000-0000-0000-0000000000a2', 'e1900000-0000-0000-0000-000000000001', true) $$,
  'Staff credencia avaliador');

RESET role;
SELECT is((SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE proname = 'admin_reset_global'),
  'search_path=public, pg_temp', 'admin_reset_global com search_path fechado (pg_temp por último)');

SELECT * FROM finish();
ROLLBACK;
