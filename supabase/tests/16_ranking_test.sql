-- Classificação (view_ranking_top3, migration 20261030060000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d1600000-0000-0000-0000-0000000000ad', 'admin16@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c1600000-0000-0000-0000-0000000000ad', 'admin16@teste.local', 'Admin', 'ADMIN', 'd1600000-0000-0000-0000-0000000000ad'),
  ('c1600000-0000-0000-0000-0000000000a1', 'av161@teste.local', 'Av 1', 'AVALIADOR', NULL),
  ('c1600000-0000-0000-0000-0000000000a2', 'av162@teste.local', 'Av 2', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('e1600000-0000-0000-0000-000000000001', 'Evento Dezesseis', false),
  ('e1600000-0000-0000-0000-000000000002', 'Evento Antigo', false);
INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade) VALUES
  ('b1600000-0000-0000-0000-000000000001', 'e1600000-0000-0000-0000-000000000001', 'Ensino Médio');
INSERT INTO public.areas_tematicas (id_area, id_evento, nome_area) VALUES
  ('a1600000-0000-0000-0000-000000000001', 'e1600000-0000-0000-0000-000000000001', 'Exatas');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade, id_area, is_fora_da_competicao) VALUES
  ('f1600000-0000-0000-0000-000000000001', 'R-001', 'Empate A', 'e1600000-0000-0000-0000-000000000001', 'b1600000-0000-0000-0000-000000000001', 'a1600000-0000-0000-0000-000000000001', false),
  ('f1600000-0000-0000-0000-000000000002', 'R-002', 'Empate B', 'e1600000-0000-0000-0000-000000000001', 'b1600000-0000-0000-0000-000000000001', 'a1600000-0000-0000-0000-000000000001', false),
  ('f1600000-0000-0000-0000-000000000003', 'R-003', 'Divergente', 'e1600000-0000-0000-0000-000000000001', 'b1600000-0000-0000-0000-000000000001', 'a1600000-0000-0000-0000-000000000001', false),
  ('f1600000-0000-0000-0000-000000000004', 'R-004', 'Fora da competição', 'e1600000-0000-0000-0000-000000000001', 'b1600000-0000-0000-0000-000000000001', 'a1600000-0000-0000-0000-000000000001', true),
  ('f1600000-0000-0000-0000-000000000005', 'R-005', 'Sem modalidade', 'e1600000-0000-0000-0000-000000000001', NULL, NULL, false);
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status) VALUES
  ('f1600000-0000-0000-0000-000000000001', 'c1600000-0000-0000-0000-0000000000a1', 9.0, 'CONCLUIDA'),
  ('f1600000-0000-0000-0000-000000000002', 'c1600000-0000-0000-0000-0000000000a1', 9.0, 'CONCLUIDA'),
  ('f1600000-0000-0000-0000-000000000003', 'c1600000-0000-0000-0000-0000000000a1', 10.0, 'CONCLUIDA'),
  ('f1600000-0000-0000-0000-000000000003', 'c1600000-0000-0000-0000-0000000000a2', 6.0, 'CONCLUIDA'),
  ('f1600000-0000-0000-0000-000000000004', 'c1600000-0000-0000-0000-0000000000a1', 10.0, 'CONCLUIDA'),
  ('f1600000-0000-0000-0000-000000000005', 'c1600000-0000-0000-0000-0000000000a1', 7.0, 'CONCLUIDA'),
  ('f1600000-0000-0000-0000-000000000005', 'c1600000-0000-0000-0000-0000000000a2', 3.0, 'CANCELADA');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

SELECT pg_temp.como('d1600000-0000-0000-0000-0000000000ad');

SELECT is((SELECT count(*)::int FROM public.view_ranking_top3 WHERE codigo_projeto = 'R-004'), 0,
  'projeto fora da competição não entra na classificação');
SELECT is((SELECT array_agg(posicao::int ORDER BY codigo_projeto) FROM public.view_ranking_top3
           WHERE id_evento = 'e1600000-0000-0000-0000-000000000001' AND modalidade = 'Ensino Médio'),
  ARRAY[1, 1, 3], 'empate divide a posição (9,00 e 9,00 em 1º; 8,00 em 3º)');
SELECT is((SELECT em_quarentena FROM public.view_ranking_top3 WHERE codigo_projeto = 'R-003'), true,
  'projeto com notas divergentes aparece marcado em quarentena');
SELECT is((SELECT em_quarentena FROM public.view_ranking_top3 WHERE codigo_projeto = 'R-001'), false,
  'projeto sem divergência não é marcado');
SELECT is((SELECT modalidade || '|' || area_tematica || '|' || nome_instituicao FROM public.view_ranking_top3 WHERE codigo_projeto = 'R-005'),
  'Sem modalidade|Sem área temática|Não informada', 'sem modalidade/área não inventa "Geral"/"Multidisciplinar"');
SELECT is((SELECT total_avaliacoes::int || '|' || media_geral FROM public.view_ranking_top3 WHERE codigo_projeto = 'R-005'),
  '1|7.00', 'avaliação cancelada não conta');
SELECT is((SELECT posicao::int FROM public.view_ranking_top3 WHERE codigo_projeto = 'R-005'), 1,
  'posição é calculada dentro de cada modalidade e área');

RESET role;
SET LOCAL role anon;
SELECT throws_ok($$ SELECT 1 FROM public.view_ranking_top3 LIMIT 1 $$, '42501', NULL, 'anon não lê a classificação');

SELECT * FROM finish();
ROLLBACK;
