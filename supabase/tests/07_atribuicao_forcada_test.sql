-- Atribuição forçada validada no banco (migration 20261029230000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d7000000-0000-0000-0000-0000000000ad', 'admin7@teste.local', false, now()),
  ('d7000000-0000-0000-0000-000000000051', 'staff7@teste.local', false, now());
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao) VALUES
  ('e7000000-0000-0000-0000-000000000001', 'Evento Atribuição', false, 2);
INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado) VALUES
  ('17000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Escola A', 'escola a');
INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade) VALUES
  ('27000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Fundamental');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_instituicao, id_modalidade, is_check_in_realizado, is_fora_da_competicao) VALUES
  ('f7000000-0000-0000-0000-000000000001', 'ATR-001', 'Livre', 'e7000000-0000-0000-0000-000000000001', NULL, NULL, true, false),
  ('f7000000-0000-0000-0000-000000000002', 'ATR-002', 'Da Escola A', 'e7000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', NULL, true, false),
  ('f7000000-0000-0000-0000-000000000003', 'ATR-003', 'Fundamental', 'e7000000-0000-0000-0000-000000000001', NULL, '27000000-0000-0000-0000-000000000001', true, false),
  ('f7000000-0000-0000-0000-000000000004', 'ATR-004', 'Sem check-in', 'e7000000-0000-0000-0000-000000000001', NULL, NULL, false, false),
  ('f7000000-0000-0000-0000-000000000005', 'ATR-005', 'Fila 1', 'e7000000-0000-0000-0000-000000000001', NULL, NULL, true, false),
  ('f7000000-0000-0000-0000-000000000006', 'ATR-006', 'Fila 2', 'e7000000-0000-0000-0000-000000000001', NULL, NULL, true, false);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c7000000-0000-0000-0000-0000000000ad', 'admin7@teste.local', 'Admin', 'ADMIN', 'd7000000-0000-0000-0000-0000000000ad'),
  ('c7000000-0000-0000-0000-000000000051', 'staff7@teste.local', 'Staff', 'STAFF', 'd7000000-0000-0000-0000-000000000051'),
  ('c7000000-0000-0000-0000-0000000000a1', 'a71@teste.local', 'Ana', 'AVALIADOR', NULL),
  ('c7000000-0000-0000-0000-0000000000a2', 'a72@teste.local', 'Bia', 'AVALIADOR', NULL),
  ('c7000000-0000-0000-0000-0000000000a3', 'a73@teste.local', 'Caio', 'AVALIADOR', NULL),
  ('c7000000-0000-0000-0000-0000000000a4', 'a74@teste.local', 'Davi', 'AVALIADOR', NULL);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado) VALUES
  ('c7000000-0000-0000-0000-0000000000a1', 'e7000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', true),
  ('c7000000-0000-0000-0000-0000000000a2', 'e7000000-0000-0000-0000-000000000001', NULL, true),
  ('c7000000-0000-0000-0000-0000000000a3', 'e7000000-0000-0000-0000-000000000001', NULL, true),
  ('c7000000-0000-0000-0000-0000000000a4', 'e7000000-0000-0000-0000-000000000001', NULL, false),
  -- Staff credenciado no evento (o credenciamento do Staff fica na mesma tabela): não é avaliador
  ('c7000000-0000-0000-0000-000000000051', 'e7000000-0000-0000-0000-000000000001', NULL, true);
INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade) VALUES
  ('c7000000-0000-0000-0000-0000000000a2', 'e7000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001');
-- Trava vencida não pode ocupar vaga nem deixar o avaliador "ocupado"
INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em) VALUES
  ('c7000000-0000-0000-0000-0000000000a3', 'f7000000-0000-0000-0000-000000000005', now() - interval '1 minute');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

SELECT pg_temp.como('d7000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000001', ARRAY['c7000000-0000-0000-0000-0000000000a2'::uuid]) $$,
  '42501', NULL, 'Staff não atribui banca');
SELECT throws_ok($$ SELECT public.admin_enfileirar_projetos('c7000000-0000-0000-0000-0000000000a2', ARRAY['f7000000-0000-0000-0000-000000000001'::uuid]) $$,
  '42501', NULL, 'Staff não enfileira');

SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');
SELECT throws_like($$ SELECT public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000001', ARRAY['c7000000-0000-0000-0000-000000000051'::uuid]) $$,
  '%não é avaliador%', 'banca recusa Staff credenciado');
SELECT throws_like($$ SELECT public.admin_enfileirar_projetos('c7000000-0000-0000-0000-000000000051', ARRAY['f7000000-0000-0000-0000-000000000001'::uuid]) $$,
  '%não é avaliador%', 'fila recusa Staff credenciado');
SELECT throws_like($$ SELECT public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000002', ARRAY['c7000000-0000-0000-0000-0000000000a1'::uuid]) $$,
  '%Conflito: mesma instituição%', 'banca recusa avaliador da mesma instituição');
SELECT throws_like($$ SELECT public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000003', ARRAY['c7000000-0000-0000-0000-0000000000a2'::uuid]) $$,
  '%Bloqueio: modalidade%', 'banca recusa modalidade bloqueada');
SELECT throws_like($$ SELECT public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000004', ARRAY['c7000000-0000-0000-0000-0000000000a2'::uuid]) $$,
  '%sem check-in%', 'banca recusa projeto sem check-in');
SELECT throws_like($$ SELECT public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000001', ARRAY['c7000000-0000-0000-0000-0000000000a4'::uuid]) $$,
  '%não credenciado%', 'banca recusa avaliador não credenciado');
SELECT throws_like($$ SELECT public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000001',
  ARRAY['c7000000-0000-0000-0000-0000000000a1','c7000000-0000-0000-0000-0000000000a2','c7000000-0000-0000-0000-0000000000a3']::uuid[]) $$,
  '%só 2 vaga(s)%', 'banca recusa quando passa da cota (2)');
SELECT is((SELECT count(*)::int FROM public.locks_ativos WHERE id_projeto = 'f7000000-0000-0000-0000-000000000001'), 0,
  'banca recusada não grava nada (tudo ou nada)');

SELECT is(public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000001',
  ARRAY['c7000000-0000-0000-0000-0000000000a1','c7000000-0000-0000-0000-0000000000a2']::uuid[]), 2,
  'banca com 2 avaliadores elegíveis (a trava vencida de Caio não conta)');
SELECT is((SELECT count(*)::int FROM public.locks_ativos WHERE id_projeto = 'f7000000-0000-0000-0000-000000000001' AND atribuido_por = 'c7000000-0000-0000-0000-0000000000ad'), 2,
  'travas da banca registram o Admin que atribuiu');
SELECT throws_like($$ SELECT public.admin_atribuir_banca('f7000000-0000-0000-0000-000000000005', ARRAY['c7000000-0000-0000-0000-0000000000a1'::uuid]) $$,
  '%Ocupado em outra avaliação%', 'avaliador com trava válida não entra em outra banca');

-- Fila: Caio está livre (a trava dele venceu)
SELECT throws_like($$ SELECT public.admin_enfileirar_projetos('c7000000-0000-0000-0000-0000000000a3', ARRAY['f7000000-0000-0000-0000-000000000001'::uuid]) $$,
  '%Cota de avaliações atingida%', 'fila recusa projeto com a cota já ocupada pela banca');
SELECT is(public.admin_enfileirar_projetos('c7000000-0000-0000-0000-0000000000a3',
  ARRAY['f7000000-0000-0000-0000-000000000005','f7000000-0000-0000-0000-000000000006','f7000000-0000-0000-0000-000000000005']::uuid[]),
  jsonb_build_object('ativado', 'f7000000-0000-0000-0000-000000000005', 'enfileirados', 1),
  'avaliador livre: 1º projeto vira trava, o resto vai para a fila (repetido ignorado)');
SELECT is((SELECT atribuido_por FROM public.locks_ativos WHERE id_usuario = 'c7000000-0000-0000-0000-0000000000a3'),
  'c7000000-0000-0000-0000-0000000000ad'::uuid, 'trava da fila também registra o Admin');
SELECT is((SELECT ordem FROM public.fila_atribuicoes_direcionadas WHERE id_usuario = 'c7000000-0000-0000-0000-0000000000a3' AND id_projeto = 'f7000000-0000-0000-0000-000000000006'), 1,
  'item enfileirado recebe a ordem 1');
SELECT throws_like($$ SELECT public.admin_enfileirar_projetos('c7000000-0000-0000-0000-0000000000a3', ARRAY['f7000000-0000-0000-0000-000000000006'::uuid]) $$,
  '%Já está na fila%', 'fila não duplica projeto pendente');

-- Avaliador ocupado: tudo vai para a fila, depois dos pendentes
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao)
VALUES ('f7000000-0000-0000-0000-000000000007', 'ATR-007', 'Fila 3', 'e7000000-0000-0000-0000-000000000001', true, false);
SELECT is(public.admin_enfileirar_projetos('c7000000-0000-0000-0000-0000000000a3', ARRAY['f7000000-0000-0000-0000-000000000007'::uuid]),
  jsonb_build_object('ativado', NULL, 'enfileirados', 1), 'avaliador ocupado: só enfileira');
SELECT is((SELECT ordem FROM public.fila_atribuicoes_direcionadas WHERE id_projeto = 'f7000000-0000-0000-0000-000000000007'), 2,
  'novo item entra depois dos pendentes que ele já tinha');

SELECT * FROM finish();
ROLLBACK;
