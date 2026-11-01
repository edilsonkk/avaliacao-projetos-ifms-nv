-- CRUD dos questionários prontos (migration 20261031060000_crud_modelos_questionario).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(22);

-- Cenário: E1 ativo com as cópias dos modelos 1 (sem uso) e 2 (já usada em avaliação) e um questionário próprio
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d2400000-0000-0000-0000-0000000000ad', 'admin24@teste.local', false, now()),
  ('d2400000-0000-0000-0000-000000000051', 'staff24@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('d2400000-0000-0000-0000-0000000000ad', 'admin24@teste.local', 'Admin', 'ADMIN', NULL),
  ('c2400000-0000-0000-0000-000000000051', 'staff24@teste.local', 'Staff', 'STAFF', 'd2400000-0000-0000-0000-000000000051'),
  ('c2400000-0000-0000-0000-0000000000a1', 'ana24@teste.local', 'Ana', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES ('e2400000-0000-0000-0000-000000000001', 'Feira 2026', true);
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, id_origem) VALUES
  ('a2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000001', 'Técnico · Nível 1 Ideia', 1, 5, '0d0de100-0000-4000-8000-000000000001'),
  ('a2400000-0000-0000-0000-000000000002', 'e2400000-0000-0000-0000-000000000001', 'Técnico · Nível 2 Protótipo', 1, 5, '0d0de100-0000-4000-8000-000000000002'),
  ('a2400000-0000-0000-0000-000000000003', 'e2400000-0000-0000-0000-000000000001', 'Próprio do evento', 0, 10, NULL);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate) VALUES
  ('b2400000-0000-0000-0000-000000000011', 'a2400000-0000-0000-0000-000000000001', 1, 'Antiga', NULL, 1, 1),
  ('b2400000-0000-0000-0000-000000000021', 'a2400000-0000-0000-0000-000000000002', 1, 'Usada', NULL, 1, 1),
  ('b2400000-0000-0000-0000-000000000031', 'a2400000-0000-0000-0000-000000000003', 2, 'Segunda', 'ajuda 2', 2, 0),
  ('b2400000-0000-0000-0000-000000000032', 'a2400000-0000-0000-0000-000000000003', 1, 'Primeira', NULL, 1, 1);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento) VALUES
  ('f2400000-0000-0000-0000-000000000001', 'CM-1', 'Projeto', 'e2400000-0000-0000-0000-000000000001');
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('a9400000-0000-0000-0000-000000000001', 'f2400000-0000-0000-0000-000000000001', 'c2400000-0000-0000-0000-0000000000a1', 'a2400000-0000-0000-0000-000000000002', 4, 'CONCLUIDA');

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
CREATE FUNCTION pg_temp.salvar(p_id text, p_titulo text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.admin_salvar_modelo_questionario(p_id::uuid, p_titulo, 'Descrição nova', 1, 5,
    '[{"texto_pergunta":"Clareza","descricao_lembrete":"Ajuda A","peso_calculo":2,"peso_desempate":1},{"texto_pergunta":"Utilidade","peso_calculo":1,"peso_desempate":0}]');
$$;

-- ---------------------------------------------------------------------------
-- Acesso
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d2400000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT pg_temp.salvar(NULL, 'Do Staff') $$, '42501', NULL, 'Staff não cria modelo');
SELECT throws_ok($$ SELECT public.admin_excluir_modelo_questionario('0d0de100-0000-4000-8000-000000000001') $$, '42501', NULL, 'Staff não exclui modelo');
SELECT throws_ok($$ SELECT public.admin_restaurar_modelos_originais() $$, '42501', NULL, 'Staff não restaura modelos');
SELECT throws_ok($$ SELECT public.admin_salvar_questionario_como_modelo('a2400000-0000-0000-0000-000000000003') $$, '42501', NULL,
  'Staff não salva questionário como modelo');
SELECT pg_temp.como(NULL);
SELECT throws_ok($$ SELECT pg_temp.salvar(NULL, 'Do anon') $$, '42501', NULL, 'anon não cria modelo');

-- ---------------------------------------------------------------------------
-- Criar e validar
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d2400000-0000-0000-0000-0000000000ad');
SELECT ok(public.admin_restaurar_modelos_originais() = 7, 'os 7 originais existem e estão marcados');
CREATE TEMP TABLE novo AS SELECT (pg_temp.salvar(NULL, 'Modelo do Admin')->>'id_modelo')::uuid AS id;
SELECT is((SELECT titulo || ' | ' || descricao || ' | ' || is_original FROM public.modelos_questionario WHERE id_modelo = (SELECT id FROM novo)),
  'Modelo do Admin | Descrição nova | false', 'Admin cria modelo novo');
SELECT is((SELECT array_agg(texto_pergunta || '/' || coalesce(descricao_lembrete, '-') || '/' || peso_calculo || '/' || peso_desempate ORDER BY ordem)
           FROM public.perguntas_modelo_questionario WHERE id_modelo = (SELECT id FROM novo)),
  ARRAY['Clareza/Ajuda A/2.00/1.00', 'Utilidade/-/1.00/0.00'], 'perguntas, ajuda e pesos gravados na ordem');
SELECT throws_ok($$ SELECT public.admin_salvar_modelo_questionario(NULL, 'ab', NULL, 1, 5, '[{"texto_pergunta":"x"}]') $$, '22023', NULL,
  'título curto é recusado');
SELECT throws_ok($$ SELECT public.admin_salvar_modelo_questionario(NULL, 'Sem perguntas', NULL, 1, 5, '[]') $$, '22023', NULL,
  'modelo sem perguntas é recusado');
SELECT throws_ok($$ SELECT public.admin_salvar_modelo_questionario(NULL, 'Escala ruim', NULL, 5, 1, '[{"texto_pergunta":"x"}]') $$, '22023', NULL,
  'escala invertida é recusada');

-- ---------------------------------------------------------------------------
-- Editar: a cópia do evento ativo acompanha, se ainda não foi usada
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.salvar('0d0de100-0000-4000-8000-000000000001', 'Ideia revisada')->>'copia', 'atualizada',
  'editar modelo ativo e sem uso: avisa que a cópia foi atualizada');
SELECT is((SELECT titulo || ' ' || (SELECT string_agg(texto_pergunta, ',' ORDER BY ordem) FROM public.perguntas_questionario WHERE id_questionario = q.id_questionario)
           FROM public.questionarios q WHERE id_questionario = 'a2400000-0000-0000-0000-000000000001'),
  'Ideia revisada Clareza,Utilidade', 'a cópia no evento recebe título e perguntas novas');
SELECT is(pg_temp.salvar('0d0de100-0000-4000-8000-000000000002', 'Protótipo revisado'), '{"copia": "em_uso", "id_modelo": "0d0de100-0000-4000-8000-000000000002", "usos": 1}'::jsonb,
  'editar modelo cuja cópia já foi usada: avisa e não mexe na cópia');
SELECT is((SELECT string_agg(texto_pergunta, ',') FROM public.perguntas_questionario WHERE id_questionario = 'a2400000-0000-0000-0000-000000000002'),
  'Usada', 'cópia já usada continua com as perguntas originais');
SELECT is(pg_temp.salvar('0d0de100-0000-4000-8000-000000000003', 'Produção revisada')->>'copia', 'sem_copia', 'modelo sem cópia no evento');

-- ---------------------------------------------------------------------------
-- Salvar como modelo, excluir e restaurar
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE do_evento AS SELECT public.admin_salvar_questionario_como_modelo('a2400000-0000-0000-0000-000000000003') AS id;
SELECT is((SELECT array_agg(ordem || ':' || texto_pergunta || '/' || peso_calculo ORDER BY ordem) FROM public.perguntas_modelo_questionario WHERE id_modelo = (SELECT id FROM do_evento)),
  ARRAY['1:Primeira/1.00', '2:Segunda/2.00'], 'salvar como modelo copia as perguntas na ordem, com pesos');
SELECT is((SELECT id_origem FROM public.questionarios WHERE id_questionario = 'a2400000-0000-0000-0000-000000000003'), (SELECT id FROM do_evento),
  'o questionário do evento passa a aparecer como ativo do novo modelo');
SELECT lives_ok($$ SELECT public.admin_excluir_modelo_questionario('0d0de100-0000-4000-8000-000000000001') $$, 'Admin exclui um modelo original');
SELECT ok(EXISTS (SELECT 1 FROM public.questionarios WHERE id_questionario = 'a2400000-0000-0000-0000-000000000001'),
  'a cópia no evento continua existindo');
SELECT lives_ok($$ SELECT public.admin_restaurar_modelos_originais() $$, 'restaurar os originais');
SELECT is((SELECT array_agg(m.titulo || ':' || (SELECT count(*) FROM public.perguntas_modelo_questionario p WHERE p.id_modelo = m.id_modelo) ORDER BY m.codigo)
           FROM public.modelos_questionario m WHERE m.codigo IN ('feira-software-q1', 'feira-software-q2', 'feira-software-q3'))
          || (SELECT titulo FROM public.modelos_questionario WHERE id_modelo = (SELECT id FROM novo))::text,
  ARRAY['Técnico · Nível 1 Ideia:10', 'Técnico · Nível 2 Protótipo:10', 'Técnico · Nível 3 Produção:10', 'Modelo do Admin'],
  'restaurar recria o excluído, desfaz as edições e não mexe nos modelos do Admin');

SELECT * FROM finish();
ROLLBACK;
