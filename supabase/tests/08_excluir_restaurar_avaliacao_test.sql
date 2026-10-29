-- Cancelar e restaurar avaliação (migration 20261029240000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d8000000-0000-0000-0000-0000000000ad', 'admin8@teste.local', false, now()),
  ('d8000000-0000-0000-0000-000000000051', 'staff8@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c8000000-0000-0000-0000-0000000000ad', 'admin8@teste.local', 'Admin', 'ADMIN', 'd8000000-0000-0000-0000-0000000000ad'),
  ('c8000000-0000-0000-0000-000000000051', 'staff8@teste.local', 'Staff', 'STAFF', 'd8000000-0000-0000-0000-000000000051'),
  ('c8000000-0000-0000-0000-0000000000a1', 'a81@teste.local', 'Av 1', 'AVALIADOR', NULL),
  ('c8000000-0000-0000-0000-0000000000a2', 'a82@teste.local', 'Av 2', 'AVALIADOR', NULL),
  ('c8000000-0000-0000-0000-0000000000a3', 'a83@teste.local', 'Av 3', 'AVALIADOR', NULL),
  ('c8000000-0000-0000-0000-0000000000a4', 'a84@teste.local', 'Av 4', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao) VALUES
  ('e8000000-0000-0000-0000-000000000001', 'Evento Cancelamento', false, 3);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento) VALUES
  ('f8000000-0000-0000-0000-000000000001', 'CAN-001', 'Com nota fora da curva', 'e8000000-0000-0000-0000-000000000001');
-- fn_enviar_avaliacao marca todas as avaliações do projeto quando há divergência
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, nota_final, status, is_quarentena) VALUES
  ('a8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-0000000000a1', 9.0, 'CONCLUIDA', true),
  ('a8000000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-0000000000a2', 8.5, 'CONCLUIDA', true),
  ('a8000000-0000-0000-0000-000000000003', 'f8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-0000000000a3', 4.0, 'CONCLUIDA', true);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.em_quarentena() RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.view_projetos_quarentena WHERE codigo_projeto = 'CAN-001')
$$;

SELECT ok(pg_temp.em_quarentena(), 'projeto começa em quarentena (9,0 x 4,0)');

SELECT pg_temp.como('d8000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.excluir_avaliacao('a8000000-0000-0000-0000-000000000003') $$, '42501', NULL, 'Staff não cancela avaliação');
SELECT throws_ok($$ SELECT public.restaurar_avaliacao('a8000000-0000-0000-0000-000000000003') $$, '42501', NULL, 'Staff não restaura avaliação');

SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT is((public.excluir_avaliacao('a8000000-0000-0000-0000-000000000003')->>'projeto_em_quarentena')::boolean, false,
  'cancelar a nota fora da curva informa que o projeto saiu da quarentena');
RESET role;
SELECT ok(NOT pg_temp.em_quarentena(), 'projeto sai da quarentena (as outras notas são desmarcadas)');
SELECT is((SELECT count(*)::int FROM public.avaliacoes WHERE id_projeto = 'f8000000-0000-0000-0000-000000000001' AND is_quarentena), 0,
  'nenhuma avaliação do projeto fica marcada');
SELECT is((SELECT cancelada_por FROM public.avaliacoes WHERE id_avaliacao = 'a8000000-0000-0000-0000-000000000003'),
  'c8000000-0000-0000-0000-0000000000ad'::uuid, 'registra qual Admin cancelou');

SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT is(public.restaurar_avaliacao('a8000000-0000-0000-0000-000000000003')->>'novo_status', 'CONCLUIDA', 'Desfazer restaura a avaliação');
RESET role;
SELECT ok(pg_temp.em_quarentena(), 'restaurar a nota fora da curva devolve o projeto à quarentena');
SELECT is((SELECT cancelada_em FROM public.avaliacoes WHERE id_avaliacao = 'a8000000-0000-0000-0000-000000000003'), NULL,
  'restaurar limpa a auditoria de cancelamento');

-- A vaga liberada é ocupada por outra pessoa: restaurar estouraria a cota
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT lives_ok($$ SELECT public.excluir_avaliacao('a8000000-0000-0000-0000-000000000003') $$, 'cancela de novo');
RESET role;
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status)
VALUES ('f8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-0000000000a4', 8.8, 'CONCLUIDA');
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT throws_like($$ SELECT public.restaurar_avaliacao('a8000000-0000-0000-0000-000000000003') $$,
  '%cota completa (3 de 3 vagas ocupadas)%', 'restaurar recusa quando a cota já foi ocupada por outra avaliação');
RESET role;
SELECT is((SELECT count(*)::int FROM public.avaliacoes WHERE id_projeto = 'f8000000-0000-0000-0000-000000000001' AND status <> 'CANCELADA'), 3,
  'o projeto continua com 3 avaliações ativas');

-- Divergência já aceita pelo Admin não volta só por recalcular
UPDATE public.projetos SET quarentena_resolvida_em = now() + interval '1 minute' WHERE id_projeto = 'f8000000-0000-0000-0000-000000000001';
UPDATE public.avaliacoes SET nota_final = 3.0 WHERE id_usuario = 'c8000000-0000-0000-0000-0000000000a4';
SELECT is(public.fn_recalcular_quarentena('f8000000-0000-0000-0000-000000000001'), false,
  'recalcular respeita a divergência aceita pelo Admin');

SELECT * FROM finish();
ROLLBACK;
