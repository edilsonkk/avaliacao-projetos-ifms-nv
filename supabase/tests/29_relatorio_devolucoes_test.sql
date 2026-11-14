-- Relatório de devoluções (fn_relatorio_devolucoes_completo, migration 20261111010000).
-- Devolução = botão "Devolver (Conflito de Interesse)" do avaliador, gravado em
-- historico_impedimentos com tipo = 'conflito'.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d2900000-0000-0000-0000-0000000000ad', 'admin29@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c2900000-0000-0000-0000-0000000000ad', 'admin29@teste.local', 'Admin', 'ADMIN', 'd2900000-0000-0000-0000-0000000000ad'),
  ('c2900000-0000-0000-0000-0000000000a1', 'av291@teste.local', 'Ana', 'AVALIADOR', NULL),
  ('c2900000-0000-0000-0000-0000000000a2', 'av292@teste.local', 'Bia', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao) VALUES
  ('e2900000-0000-0000-0000-000000000001', 'Evento Vinte e Nove', false, 3),
  ('e2900000-0000-0000-0000-000000000002', 'Evento Antigo', false, 3);
INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade) VALUES
  ('b2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000001', 'Ensino Médio');
INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado) VALUES
  ('a2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000001', 'IFMS Coxim', 'ifms coxim');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade, id_instituicao, is_check_in_realizado) VALUES
  ('f2900000-0000-0000-0000-000000000001', 'DEV-001', 'Devolvido duas vezes', 'e2900000-0000-0000-0000-000000000001', 'b2900000-0000-0000-0000-000000000001', 'a2900000-0000-0000-0000-000000000001', true),
  ('f2900000-0000-0000-0000-000000000002', 'DEV-002', 'Só ausência', 'e2900000-0000-0000-0000-000000000001', NULL, NULL, true),
  ('f2900000-0000-0000-0000-000000000009', 'OLD-029', 'Outro evento', 'e2900000-0000-0000-0000-000000000002', NULL, NULL, true);

-- Ana devolveu dois projetos; Bia devolveu um, e num evento que não é o consultado.
-- A ausência de Ana não é devolução e não pode aparecer.
INSERT INTO public.historico_impedimentos (id_usuario, id_projeto, tipo, created_at) VALUES
  ('c2900000-0000-0000-0000-0000000000a1', 'f2900000-0000-0000-0000-000000000001', 'conflito', '2026-11-10T09:00:00Z'),
  ('c2900000-0000-0000-0000-0000000000a1', 'f2900000-0000-0000-0000-000000000002', 'conflito', '2026-11-10T10:00:00Z'),
  ('c2900000-0000-0000-0000-0000000000a1', 'f2900000-0000-0000-0000-000000000002', 'ausencia', '2026-11-10T11:00:00Z'),
  ('c2900000-0000-0000-0000-0000000000a2', 'f2900000-0000-0000-0000-000000000009', 'conflito', '2026-11-10T12:00:00Z');

-- Uma nota ativa e uma cancelada em DEV-001: a situação atual do projeto conta só a ativa
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status) VALUES
  ('f2900000-0000-0000-0000-000000000001', 'c2900000-0000-0000-0000-0000000000a2', 8.0, 'CONCLUIDA'),
  ('f2900000-0000-0000-0000-000000000001', 'c2900000-0000-0000-0000-0000000000ad', 2.0, 'CANCELADA');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

SELECT pg_temp.como('d2900000-0000-0000-0000-0000000000ad');

SELECT lives_ok($$ SELECT * FROM public.fn_relatorio_devolucoes_completo('e2900000-0000-0000-0000-000000000001') $$,
  'relatório de devoluções não falha');

SELECT is((SELECT string_agg(avaliador_nome || ':' || total_devolucoes, ',' ORDER BY avaliador_nome)
           FROM public.fn_relatorio_devolucoes_completo('e2900000-0000-0000-0000-000000000001')),
  'Ana:2', 'conta só conflitos do evento pedido: a ausência não entra e o outro evento não entra');

SELECT is((SELECT total_ausencias FROM public.fn_relatorio_ausencias_completo('e2900000-0000-0000-0000-000000000001')
           WHERE avaliador_nome = 'Ana'), 1,
  'o relatório de ausências continua contando só a ausência');

SELECT is((SELECT jsonb_array_length(devolucoes) FROM public.fn_relatorio_devolucoes_completo('e2900000-0000-0000-0000-000000000001')
           WHERE avaliador_nome = 'Ana'), 2, 'uma entrada por devolução no detalhamento');

SELECT is((SELECT devolucoes -> 0 ->> 'codigo_projeto' FROM public.fn_relatorio_devolucoes_completo('e2900000-0000-0000-0000-000000000001')
           WHERE avaliador_nome = 'Ana'), 'DEV-002',
  'detalhamento em ordem decrescente de data, com o código do projeto (nunca UUID na interface)');

SELECT is((SELECT (devolucoes -> 1 ->> 'projeto_modalidade') || '|' || (devolucoes -> 1 ->> 'projeto_instituicao')
           FROM public.fn_relatorio_devolucoes_completo('e2900000-0000-0000-0000-000000000001')
           WHERE avaliador_nome = 'Ana'), 'Ensino Médio|IFMS Coxim',
  'modalidade e instituição vêm dos relacionamentos do projeto');

SELECT is((SELECT (devolucoes -> 1 ->> 'total_avaliacoes_atuais')::int
           FROM public.fn_relatorio_devolucoes_completo('e2900000-0000-0000-0000-000000000001')
           WHERE avaliador_nome = 'Ana'), 1,
  'situação atual do projeto: a avaliação cancelada não conta');

RESET role;
SET LOCAL role anon;
SELECT throws_ok($$ SELECT * FROM public.fn_relatorio_devolucoes_completo('e2900000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'anon não executa o relatório de devoluções');

SELECT * FROM finish();
ROLLBACK;
