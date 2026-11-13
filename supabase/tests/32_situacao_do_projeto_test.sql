-- Situação do projeto contada no banco (migration 20261112010000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

-- Cenário: evento com cota 2. P1 tem 1 nota técnica + 2 votos populares + 1 trava de
-- votante (nada disso ocupa vaga técnica). P2 tem 1 nota técnica + 1 trava técnica
-- (cota cheia). P3 tem cota customizada 3 e 1 trava técnica vencida (não ocupa vaga).
-- P4 tem duas notas técnicas bem distantes: entra em quarentena.
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3200000-0000-0000-0000-0000000000ad', 'admin32@teste.local', false, now()),
  ('d3200000-0000-0000-0000-000000000051', 'staff32@teste.local', false, now()),
  ('d3200000-0000-0000-0000-0000000000a1', NULL, true, NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao) VALUES
  ('e3200000-0000-0000-0000-000000000001', 'Feira Trinta e Dois', false, 2);
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('a3200000-0000-0000-0000-0000000000aa', 'e3200000-0000-0000-0000-000000000001', 'Qt técnico', 1, 10, false),
  ('a3200000-0000-0000-0000-0000000000bb', 'e3200000-0000-0000-0000-000000000001', 'Qp voto popular', 1, 10, true);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao, cota_avaliacoes_customizada) VALUES
  ('f3200000-0000-0000-0000-000000000001', 'SIT-1', 'Projeto Um', 'e3200000-0000-0000-0000-000000000001', true, false, NULL),
  ('f3200000-0000-0000-0000-000000000002', 'SIT-2', 'Projeto Dois', 'e3200000-0000-0000-0000-000000000001', true, false, NULL),
  ('f3200000-0000-0000-0000-000000000003', 'SIT-3', 'Projeto Três', 'e3200000-0000-0000-0000-000000000001', true, false, 3),
  ('f3200000-0000-0000-0000-000000000004', 'SIT-4', 'Projeto Quatro', 'e3200000-0000-0000-0000-000000000001', true, false, 5);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c3200000-0000-0000-0000-0000000000ad', 'admin32@teste.local', 'Admin', 'ADMIN', 'd3200000-0000-0000-0000-0000000000ad'),
  ('c3200000-0000-0000-0000-000000000051', 'staff32@teste.local', 'Staff', 'STAFF', 'd3200000-0000-0000-0000-000000000051'),
  ('c3200000-0000-0000-0000-0000000000a1', 'ana32@teste.local', 'Ana', 'AVALIADOR', NULL),
  ('c3200000-0000-0000-0000-0000000000a2', 'bia32@teste.local', 'Bia', 'AVALIADOR', NULL),
  ('c3200000-0000-0000-0000-0000000000e1', 'vera32@teste.local', 'Vera', 'AVALIADOR', NULL),
  ('c3200000-0000-0000-0000-0000000000e2', 'vitor32@teste.local', 'Vitor', 'AVALIADOR', NULL);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_questionario) VALUES
  ('c3200000-0000-0000-0000-0000000000a1', 'e3200000-0000-0000-0000-000000000001', true, NULL),
  ('c3200000-0000-0000-0000-0000000000a2', 'e3200000-0000-0000-0000-000000000001', true, NULL),
  ('c3200000-0000-0000-0000-0000000000e1', 'e3200000-0000-0000-0000-000000000001', true, 'a3200000-0000-0000-0000-0000000000bb'),
  ('c3200000-0000-0000-0000-0000000000e2', 'e3200000-0000-0000-0000-000000000001', true, 'a3200000-0000-0000-0000-0000000000bb');

-- Notas: a trigger classifica cada uma pelo questionário que usou
INSERT INTO public.avaliacoes (id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('f3200000-0000-0000-0000-000000000001', 'c3200000-0000-0000-0000-0000000000a1', 'a3200000-0000-0000-0000-0000000000aa', 8.00, 'CONCLUIDA'),
  ('f3200000-0000-0000-0000-000000000001', 'c3200000-0000-0000-0000-0000000000e1', 'a3200000-0000-0000-0000-0000000000bb', 10.00, 'CONCLUIDA'),
  ('f3200000-0000-0000-0000-000000000001', 'c3200000-0000-0000-0000-0000000000e2', 'a3200000-0000-0000-0000-0000000000bb', 9.00, 'CONCLUIDA'),
  -- Cancelada não conta para a cota nem para a média
  ('f3200000-0000-0000-0000-000000000001', 'c3200000-0000-0000-0000-0000000000a2', 'a3200000-0000-0000-0000-0000000000aa', 2.00, 'CANCELADA'),
  ('f3200000-0000-0000-0000-000000000002', 'c3200000-0000-0000-0000-0000000000a1', 'a3200000-0000-0000-0000-0000000000aa', 7.00, 'CONCLUIDA'),
  ('f3200000-0000-0000-0000-000000000004', 'c3200000-0000-0000-0000-0000000000a1', 'a3200000-0000-0000-0000-0000000000aa', 9.50, 'CONCLUIDA'),
  ('f3200000-0000-0000-0000-000000000004', 'c3200000-0000-0000-0000-0000000000a2', 'a3200000-0000-0000-0000-0000000000aa', 4.00, 'CONCLUIDA');

INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em, is_voto_popular) VALUES
  -- Votante parado no P1: não ocupa vaga técnica
  ('c3200000-0000-0000-0000-0000000000e1', 'f3200000-0000-0000-0000-000000000001', now() + interval '30 minutes', true),
  -- Avaliador técnico no P2: ocupa a última vaga
  ('c3200000-0000-0000-0000-0000000000a2', 'f3200000-0000-0000-0000-000000000002', now() + interval '30 minutes', false),
  -- Trava vencida no P3: não ocupa vaga
  ('c3200000-0000-0000-0000-0000000000a1', 'f3200000-0000-0000-0000-000000000003', now() - interval '5 minutes', false);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- Só o Admin: o Staff não lê avaliações, então não pode receber média nem notas
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d3200000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT * FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'Staff não lê a situação dos projetos');
SELECT pg_temp.como('d3200000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT * FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'Avaliador não lê a situação dos projetos');

SELECT pg_temp.como('d3200000-0000-0000-0000-0000000000ad');

-- ---------------------------------------------------------------------------
-- Voto popular não ocupa cota, não entra na média técnica e tem conta própria
-- ---------------------------------------------------------------------------
SELECT is((SELECT s.avaliacoes_tecnicas FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000001'), 1,
  'P1: só a nota técnica ativa é contada (voto popular e cancelada ficam de fora)');
SELECT is((SELECT s.travas_tecnicas FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000001'), 0,
  'P1: a trava do votante não é trava técnica');
SELECT is((SELECT s.vagas_restantes FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000001'), 1,
  'P1: sobra 1 vaga técnica das 2 da cota');
SELECT is((SELECT s.media_tecnica FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000001'), 8.00,
  'P1: a média técnica ignora o voto popular e a nota cancelada');
SELECT is((SELECT s.votos_populares FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000001'), 2,
  'P1: os dois votos populares são contados à parte');
SELECT is((SELECT s.media_voto_popular FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000001'), 9.50,
  'P1: o voto popular tem média própria');

-- ---------------------------------------------------------------------------
-- Cota, travas e quarentena seguem a regra do sorteio
-- ---------------------------------------------------------------------------
SELECT is((SELECT s.vagas_restantes FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000002'), 0,
  'P2: nota técnica + trava técnica fecham a cota');
SELECT is((SELECT s.vagas_restantes FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000003'), 3,
  'P3: trava vencida não ocupa vaga, e vale a cota customizada do projeto');
SELECT is((SELECT s.notas_tecnicas FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000003'), '{}'::numeric[],
  'P3: sem nota, devolve array vazio em vez de nulo');
SELECT ok((SELECT s.em_quarentena FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000004'),
  'P4: notas distantes acusam quarentena, igual à tela da Quarentena');
SELECT ok(NOT (SELECT s.em_quarentena FROM public.fn_projetos_situacao('e3200000-0000-0000-0000-000000000001') s
           WHERE s.id_projeto = 'f3200000-0000-0000-0000-000000000001'),
  'P1: sem divergência, sem quarentena');

SELECT * FROM finish();
ROLLBACK;
