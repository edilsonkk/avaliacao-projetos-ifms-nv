-- Gestor de Questionários (migration 20261030020000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(16);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('dc000000-0000-0000-0000-0000000000ad', 'admin12@teste.local', false, now()),
  ('dc000000-0000-0000-0000-000000000051', 'staff12@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('cc000000-0000-0000-0000-0000000000ad', 'admin12@teste.local', 'Admin', 'ADMIN', 'dc000000-0000-0000-0000-0000000000ad'),
  ('cc000000-0000-0000-0000-000000000051', 'staff12@teste.local', 'Staff', 'STAFF', 'dc000000-0000-0000-0000-000000000051'),
  ('cc000000-0000-0000-0000-0000000000a1', 'av12@teste.local', 'Av', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES ('ec000000-0000-0000-0000-000000000001', 'Evento Doze', false);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento) VALUES
  ('fc000000-0000-0000-0000-000000000001', 'Q-001', 'P', 'ec000000-0000-0000-0000-000000000001');
-- Questionário já usado em uma avaliação
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima) VALUES
  ('9c000000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-000000000001', 'Usado', 0, 10);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta) VALUES
  ('8c000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000001', 1, 'Critério A');
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('acc00000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-0000000000a1', '9c000000-0000-0000-0000-000000000001', 8, 'CONCLUIDA');
INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('acc00000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000001', 8);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

SELECT has_column('public', 'perguntas_questionario', 'descricao_lembrete', 'pergunta tem texto de ajuda');

SELECT pg_temp.como('dc000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_salvar_questionario(NULL, 'ec000000-0000-0000-0000-000000000001', 'Novo', 0, 10, '[{"texto_pergunta":"X"}]') $$, '42501', NULL, 'Staff não cria questionário');
SELECT throws_ok($$ SELECT public.admin_excluir_questionario('9c000000-0000-0000-0000-000000000001') $$, '42501', NULL, 'Staff não exclui questionário');

SELECT pg_temp.como('dc000000-0000-0000-0000-0000000000ad');

-- Criar
CREATE TEMP TABLE novo AS SELECT public.admin_salvar_questionario(NULL, 'ec000000-0000-0000-0000-000000000001', '  Feira   2026 ', 1, 5,
  '[{"texto_pergunta":"Método","descricao_lembrete":"Considere hipóteses","peso_calculo":2},{"texto_pergunta":"Inovação"}]') AS id;
SELECT is((SELECT titulo FROM public.questionarios WHERE id_questionario = (SELECT id FROM novo)), 'Feira 2026', 'cria com o título normalizado');
SELECT is((SELECT count(*)::int FROM public.perguntas_questionario WHERE id_questionario = (SELECT id FROM novo)), 2, 'cria as perguntas');
SELECT is((SELECT descricao_lembrete FROM public.perguntas_questionario WHERE id_questionario = (SELECT id FROM novo) AND ordem = 1), 'Considere hipóteses', 'grava o texto de ajuda');
SELECT throws_ok($$ SELECT public.admin_salvar_questionario(NULL, 'ec000000-0000-0000-0000-000000000001', 'Ruim', 5, 5, '[{"texto_pergunta":"X"}]') $$,
  'P0001', NULL, 'recusa escala mínima igual à máxima');
SELECT throws_ok($$ SELECT public.admin_salvar_questionario(NULL, 'ec000000-0000-0000-0000-000000000001', 'Vazio', 0, 10, '[]') $$,
  'P0001', 'O questionário precisa de pelo menos uma pergunta.', 'recusa questionário sem pergunta');

-- Editar questionário não usado: atualiza no lugar, reordena e remove
SELECT lives_ok(format($$ SELECT public.admin_salvar_questionario(%L, 'ec000000-0000-0000-0000-000000000001', 'Feira 2026 v2', 0, 10,
  jsonb_build_array(jsonb_build_object('texto_pergunta', 'Inovação revisada', 'id_pergunta',
    (SELECT id_pergunta FROM public.perguntas_questionario WHERE id_questionario = %L AND ordem = 2)))) $$,
  (SELECT id FROM novo), (SELECT id FROM novo)), 'edita questionário não usado');
SELECT is((SELECT count(*)::int FROM public.perguntas_questionario WHERE id_questionario = (SELECT id FROM novo)), 1, 'remove a pergunta retirada');
SELECT is((SELECT texto_pergunta || '#' || ordem FROM public.perguntas_questionario WHERE id_questionario = (SELECT id FROM novo)), 'Inovação revisada#1', 'mantém o id e reordena');

-- Questionário usado: nunca apaga as notas por critério
SELECT throws_ok($$ SELECT public.admin_salvar_questionario('9c000000-0000-0000-0000-000000000001', NULL, 'Usado', 0, 10, '[{"texto_pergunta":"Outro critério"}]') $$,
  'P0001', NULL, 'questionário usado não troca perguntas');
SELECT lives_ok($$ SELECT public.admin_salvar_questionario('9c000000-0000-0000-0000-000000000001', NULL, 'Usado (renomeado)', 0, 10,
  '[{"id_pergunta":"8c000000-0000-0000-0000-000000000001","texto_pergunta":"Critério A"}]') $$, 'questionário usado aceita só o título');
SELECT throws_ok($$ SELECT public.admin_excluir_questionario('9c000000-0000-0000-0000-000000000001') $$, 'P0001', NULL, 'questionário usado não é excluído');
SELECT is((SELECT count(*)::int FROM public.respostas_avaliacao WHERE id_avaliacao = 'acc00000-0000-0000-0000-000000000001'), 1, 'notas por critério continuam lá');
SELECT lives_ok(format($$ SELECT public.admin_excluir_questionario(%L) $$, (SELECT id FROM novo)), 'exclui questionário não usado');

SELECT * FROM finish();
ROLLBACK;
