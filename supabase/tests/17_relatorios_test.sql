-- Relatórios (fn_relatorio_*_completo, migration 20261030070000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d1700000-0000-0000-0000-0000000000ad', 'admin17@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c1700000-0000-0000-0000-0000000000ad', 'admin17@teste.local', 'Admin', 'ADMIN', 'd1700000-0000-0000-0000-0000000000ad'),
  ('c1700000-0000-0000-0000-0000000000a1', 'av171@teste.local', 'Ana', 'AVALIADOR', NULL),
  ('c1700000-0000-0000-0000-0000000000a2', 'av172@teste.local', 'Bia', 'AVALIADOR', NULL),
  ('c1700000-0000-0000-0000-0000000000a3', 'av173@teste.local', 'Cid', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('e1700000-0000-0000-0000-000000000001', 'Evento Dezessete', false),
  ('e1700000-0000-0000-0000-000000000002', 'Evento Antigo', false);
INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade) VALUES
  ('b1700000-0000-0000-0000-000000000001', 'e1700000-0000-0000-0000-000000000001', 'Ensino Médio');
INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado) VALUES
  ('a1700000-0000-0000-0000-000000000001', 'e1700000-0000-0000-0000-000000000001', 'IFMS Coxim', 'ifms coxim');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade, id_instituicao, is_check_in_realizado) VALUES
  ('f1700000-0000-0000-0000-000000000001', 'REL-001', 'Com notas', 'e1700000-0000-0000-0000-000000000001', 'b1700000-0000-0000-0000-000000000001', 'a1700000-0000-0000-0000-000000000001', true),
  ('f1700000-0000-0000-0000-000000000002', 'REL-002', 'Sem nada', 'e1700000-0000-0000-0000-000000000001', NULL, NULL, NULL),
  ('f1700000-0000-0000-0000-000000000009', 'OLD-001', 'Outro evento', 'e1700000-0000-0000-0000-000000000002', NULL, NULL, true);
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status, tempo_presenca, tempo_submissao) VALUES
  ('f1700000-0000-0000-0000-000000000001', 'c1700000-0000-0000-0000-0000000000a1', 9.0, 'CONCLUIDA', '2026-10-30T10:00:00Z', '2026-10-30T10:05:00Z'),
  ('f1700000-0000-0000-0000-000000000001', 'c1700000-0000-0000-0000-0000000000a2', 7.0, 'CONCLUIDA', NULL, NULL),
  ('f1700000-0000-0000-0000-000000000001', 'c1700000-0000-0000-0000-0000000000a3', 1.0, 'CANCELADA', NULL, NULL),
  ('f1700000-0000-0000-0000-000000000009', 'c1700000-0000-0000-0000-0000000000a1', 5.0, 'CONCLUIDA', NULL, NULL);
INSERT INTO public.historico_impedimentos (id_usuario, id_projeto, tipo) VALUES
  ('c1700000-0000-0000-0000-0000000000a1', 'f1700000-0000-0000-0000-000000000002', 'ausencia'),
  ('c1700000-0000-0000-0000-0000000000a1', 'f1700000-0000-0000-0000-000000000009', 'ausencia'),
  ('c1700000-0000-0000-0000-0000000000a2', 'f1700000-0000-0000-0000-000000000002', 'conflito');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

SELECT pg_temp.como('d1700000-0000-0000-0000-0000000000ad');

SELECT lives_ok($$ SELECT * FROM public.fn_relatorio_projetos_completo('e1700000-0000-0000-0000-000000000001') $$,
  'relatório de projetos não falha');
SELECT is((SELECT count(*)::int FROM public.fn_relatorio_projetos_completo('e1700000-0000-0000-0000-000000000001')), 2,
  'só projetos do evento pedido');
SELECT is((SELECT total_avaliacoes || '|' || media_geral || '|' || modalidade || '|' || nome_instituicao
           FROM public.fn_relatorio_projetos_completo('e1700000-0000-0000-0000-000000000001') WHERE codigo_projeto = 'REL-001'),
  '2|8.00|Ensino Médio|IFMS Coxim', 'média sem a avaliação cancelada, com modalidade e instituição');
SELECT is((SELECT modalidade || '|' || area_conhecimento || '|' || nome_instituicao || '|' || is_check_in_realizado
           FROM public.fn_relatorio_projetos_completo('e1700000-0000-0000-0000-000000000001') WHERE codigo_projeto = 'REL-002'),
  'Sem modalidade|Sem área temática|Não informada|false', 'sem dados: rótulos neutros e sem check-in presumido');

SELECT lives_ok($$ SELECT * FROM public.fn_relatorio_avaliadores_completo('e1700000-0000-0000-0000-000000000001') $$,
  'relatório de avaliadores não falha');
SELECT is((SELECT string_agg(avaliador_nome || ':' || total_avaliacoes, ',' ORDER BY avaliador_nome)
           FROM public.fn_relatorio_avaliadores_completo('e1700000-0000-0000-0000-000000000001')),
  'Ana:1,Bia:1', 'conta só avaliações não canceladas do evento');
SELECT is((SELECT tempo_medio_segundos FROM public.fn_relatorio_avaliadores_completo('e1700000-0000-0000-0000-000000000001')
           WHERE avaliador_nome = 'Ana'), 300, 'duração média em segundos');

SELECT lives_ok($$ SELECT * FROM public.fn_relatorio_ausencias_completo('e1700000-0000-0000-0000-000000000001') $$,
  'relatório de ausências não falha');
SELECT is((SELECT avaliador_nome || ':' || total_ausencias FROM public.fn_relatorio_ausencias_completo('e1700000-0000-0000-0000-000000000001')),
  'Ana:1', 'só ausências (não conflitos) do evento pedido');

RESET role;
SET LOCAL role anon;
SELECT throws_ok($$ SELECT * FROM public.fn_relatorio_projetos_completo('e1700000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'anon não executa o relatório');

SELECT * FROM finish();
ROLLBACK;
