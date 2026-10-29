-- Chave natural de projetos (migration 20261029200000): a importação faz upsert por (id_evento, codigo_projeto).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('e4000000-0000-0000-0000-000000000001', 'Feira 2026', false),
  ('e4000000-0000-0000-0000-000000000002', 'Feira 2027', false);

INSERT INTO public.projetos (codigo_projeto, titulo, id_evento, is_check_in_realizado, forcar_topo_fila)
VALUES ('CHV-001', 'Título original', 'e4000000-0000-0000-0000-000000000001', true, true);

SELECT col_is_unique('public', 'projetos', ARRAY['id_evento', 'codigo_projeto']::name[],
  'projetos tem chave única (id_evento, codigo_projeto)');

-- Mesmo comando que o PostgREST gera para upsert({ onConflict: 'id_evento,codigo_projeto' })
SELECT lives_ok($$
  INSERT INTO public.projetos (codigo_projeto, titulo, id_evento)
  VALUES ('CHV-001', 'Título reimportado', 'e4000000-0000-0000-0000-000000000001')
  ON CONFLICT (id_evento, codigo_projeto) DO UPDATE SET titulo = excluded.titulo
$$, 'upsert pela chave natural é aceito');

SELECT is((SELECT count(*)::int FROM public.projetos WHERE codigo_projeto = 'CHV-001' AND id_evento = 'e4000000-0000-0000-0000-000000000001'),
  1, 'reimportar a mesma planilha não duplica o projeto');

SELECT is((SELECT titulo || '|' || is_check_in_realizado || '|' || forcar_topo_fila FROM public.projetos
           WHERE codigo_projeto = 'CHV-001' AND id_evento = 'e4000000-0000-0000-0000-000000000001'),
  'Título reimportado|true|true', 'reimportar atualiza o título e mantém check-in e topo da fila');

SELECT lives_ok($$
  INSERT INTO public.projetos (codigo_projeto, titulo, id_evento)
  VALUES ('CHV-001', 'Mesmo código em outra edição', 'e4000000-0000-0000-0000-000000000002')
$$, 'o mesmo código pode existir em outro evento');

SELECT throws_ok($$
  INSERT INTO public.projetos (codigo_projeto, titulo, id_evento)
  VALUES ('CHV-001', 'Duplicado', 'e4000000-0000-0000-0000-000000000001')
$$, '23505', NULL, 'código repetido no mesmo evento é recusado');

SELECT lives_ok($$
  INSERT INTO public.projetos (codigo_projeto, titulo, id_evento) VALUES
    (NULL, 'Sem código 1', 'e4000000-0000-0000-0000-000000000001'),
    (NULL, 'Sem código 2', 'e4000000-0000-0000-0000-000000000001')
$$, 'projetos sem código continuam permitidos');

SELECT * FROM finish();
ROLLBACK;
