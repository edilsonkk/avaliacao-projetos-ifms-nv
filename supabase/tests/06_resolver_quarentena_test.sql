-- Resolver quarentena (migration 20261029220000): o projeto sai da lista e só volta com avaliação nova.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d6000000-0000-0000-0000-0000000000ad', 'admin6@teste.local', false, now()),
  ('d6000000-0000-0000-0000-000000000051', 'staff6@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c6000000-0000-0000-0000-0000000000ad', 'admin6@teste.local', 'Admin', 'ADMIN', 'd6000000-0000-0000-0000-0000000000ad'),
  ('c6000000-0000-0000-0000-000000000051', 'staff6@teste.local', 'Staff', 'STAFF', 'd6000000-0000-0000-0000-000000000051'),
  ('c6000000-0000-0000-0000-0000000000a1', 'ava61@teste.local', 'Av 1', 'AVALIADOR', NULL),
  ('c6000000-0000-0000-0000-0000000000a2', 'ava62@teste.local', 'Av 2', 'AVALIADOR', NULL),
  ('c6000000-0000-0000-0000-0000000000a3', 'ava63@teste.local', 'Av 3', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('e6000000-0000-0000-0000-000000000001', 'Evento Q1', false),
  ('e6000000-0000-0000-0000-000000000002', 'Evento Q2', false);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento) VALUES
  ('f6000000-0000-0000-0000-000000000001', 'QRT-001', 'Divergente 1', 'e6000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000002', 'QRT-002', 'Divergente 2', 'e6000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000003', 'QRT-003', 'Outro evento', 'e6000000-0000-0000-0000-000000000002');
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status, is_quarentena, created_at) VALUES
  ('f6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-0000000000a1', 9.5, 'CONCLUIDA', true, now() - interval '1 hour'),
  ('f6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-0000000000a2', 5.0, 'CONCLUIDA', true, now() - interval '1 hour'),
  ('f6000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-0000000000a1', 9.0, 'CONCLUIDA', false, now() - interval '1 hour'),
  ('f6000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-0000000000a2', 4.0, 'CONCLUIDA', false, now() - interval '1 hour'),
  ('f6000000-0000-0000-0000-000000000003', 'c6000000-0000-0000-0000-0000000000a1', 9.0, 'CONCLUIDA', true, now() - interval '1 hour'),
  ('f6000000-0000-0000-0000-000000000003', 'c6000000-0000-0000-0000-0000000000a2', 4.0, 'CONCLUIDA', true, now() - interval '1 hour');

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

CREATE FUNCTION pg_temp.em_quarentena(p_codigo text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.view_projetos_quarentena WHERE codigo_projeto = p_codigo)
$$;

SELECT ok(pg_temp.em_quarentena('QRT-001') AND pg_temp.em_quarentena('QRT-002'), 'projetos divergentes entram na quarentena');

SELECT pg_temp.como('d6000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_remover_quarentena('f6000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'Staff não resolve quarentena');

SELECT pg_temp.como('d6000000-0000-0000-0000-0000000000ad');
SELECT lives_ok($$ SELECT public.admin_remover_quarentena('f6000000-0000-0000-0000-000000000001') $$, 'Admin resolve um projeto');
RESET role;
SELECT ok(NOT pg_temp.em_quarentena('QRT-001'), 'projeto resolvido sai da lista mesmo com a divergência mantida');
SELECT is((SELECT quarentena_resolvida_por FROM public.projetos WHERE codigo_projeto = 'QRT-001'),
  'c6000000-0000-0000-0000-0000000000ad'::uuid, 'registra qual Admin resolveu');
SELECT ok(pg_temp.em_quarentena('QRT-002'), 'resolver um projeto não mexe nos outros');

-- Avaliação nova depois da resolução reabre a quarentena
-- now() é fixo dentro da transação: a resolução é recuada 30 min para a avaliação nova vir depois dela
UPDATE public.projetos SET quarentena_resolvida_em = now() - interval '30 minutes' WHERE codigo_projeto = 'QRT-001';
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status)
VALUES ('f6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-0000000000a3', 7.0, 'CONCLUIDA');
SELECT ok(pg_temp.em_quarentena('QRT-001'), 'avaliação nova com divergência reabre a quarentena');

SELECT pg_temp.como('d6000000-0000-0000-0000-0000000000ad');
SELECT is(public.admin_remover_quarentena_evento('e6000000-0000-0000-0000-000000000001'), 2,
  'resolver o evento devolve quantos projetos saíram');
RESET role;
SELECT ok(NOT pg_temp.em_quarentena('QRT-001') AND NOT pg_temp.em_quarentena('QRT-002'), 'o evento fica sem quarentena');
SELECT ok(pg_temp.em_quarentena('QRT-003'), 'resolver um evento não mexe em outro evento');

SELECT pg_temp.como(NULL);
SELECT throws_ok($$ SELECT count(*) FROM public.view_projetos_quarentena $$, '42501', NULL, 'anon não lê a view de quarentena');

SELECT * FROM finish();
ROLLBACK;
