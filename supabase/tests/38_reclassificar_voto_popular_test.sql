-- Reclassificação da marca de voto popular (migration 20261116020000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

-- Cenário da feira: o questionário de voto popular nasceu SEM a marca, e os votos
-- dados com ele entraram como nota técnica (o gatilho copia a marca na gravação).
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3800000-0000-0000-0000-0000000000ad', 'admin38@teste.local', false, now()),
  ('d3800000-0000-0000-0000-000000000051', 'staff38@teste.local', false, now());

INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao) VALUES
  ('e3800000-0000-0000-0000-000000000001', 'Feira Trinta e Oito', true, 3);

INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('a3800000-0000-0000-0000-0000000000bb', 'e3800000-0000-0000-0000-000000000001', 'Voto popular', 1, 10, false),
  ('a3800000-0000-0000-0000-0000000000aa', 'e3800000-0000-0000-0000-000000000001', 'Técnico', 1, 10, false);

INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado) VALUES
  ('f3800000-0000-0000-0000-000000000001', '5178', 'Projeto Cinco Um Sete Oito', 'e3800000-0000-0000-0000-000000000001', true);

INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c3800000-0000-0000-0000-0000000000ad', 'admin38@teste.local', 'Admin', 'ADMIN', 'd3800000-0000-0000-0000-0000000000ad'),
  ('c3800000-0000-0000-0000-000000000051', 'staff38@teste.local', 'Staff', 'STAFF', 'd3800000-0000-0000-0000-000000000051'),
  ('c3800000-0000-0000-0000-0000000000e1', 'vera38@teste.local', 'Vera Votante', 'AVALIADOR', NULL),
  ('c3800000-0000-0000-0000-0000000000a1', 'ana38@teste.local', 'Ana Técnica', 'AVALIADOR', NULL);

-- A votante está vinculada ao questionário de voto popular (ainda sem a marca)
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_questionario) VALUES
  ('c3800000-0000-0000-0000-0000000000e1', 'e3800000-0000-0000-0000-000000000001', true, 'a3800000-0000-0000-0000-0000000000bb'),
  ('c3800000-0000-0000-0000-0000000000a1', 'e3800000-0000-0000-0000-000000000001', true, NULL);

INSERT INTO public.avaliacoes (id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('f3800000-0000-0000-0000-000000000001', 'c3800000-0000-0000-0000-0000000000e1', 'a3800000-0000-0000-0000-0000000000bb', 10, 'CONCLUIDA'),
  ('f3800000-0000-0000-0000-000000000001', 'c3800000-0000-0000-0000-0000000000a1', 'a3800000-0000-0000-0000-0000000000aa', 8, 'CONCLUIDA');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- O voto nasceu técnico: é o defeito que esta migration conserta
-- ---------------------------------------------------------------------------
SELECT ok(NOT (SELECT is_voto_popular FROM public.avaliacoes
                WHERE id_questionario = 'a3800000-0000-0000-0000-0000000000bb'),
  'O voto nasceu como nota técnica, porque o questionário não tinha a marca');

-- ---------------------------------------------------------------------------
-- Recusa de marcar direto: regra de negócio (P0001), não permissão (42501).
-- Com 42501 o front traduzia como "sessão expirada" e escondia o motivo.
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d3800000-0000-0000-0000-0000000000ad');
SELECT throws_ok(
  $$ SELECT public.admin_marcar_questionario_voto_popular('a3800000-0000-0000-0000-0000000000bb', true) $$,
  'P0001', NULL, 'Marcar questionário já usado é recusado como regra de negócio, não como falta de permissão');

-- ---------------------------------------------------------------------------
-- Só o Admin reclassifica
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d3800000-0000-0000-0000-000000000051');
SELECT throws_ok(
  $$ SELECT public.admin_reclassificar_questionario_voto_popular('a3800000-0000-0000-0000-0000000000bb', true) $$,
  '42501', NULL, 'Staff não reclassifica questionário');

SELECT pg_temp.como('d3800000-0000-0000-0000-0000000000ad');

-- Questionário que já está na marca pedida é recusado, em vez de gravar à toa
SELECT throws_ok(
  $$ SELECT public.admin_reclassificar_questionario_voto_popular('a3800000-0000-0000-0000-0000000000aa', false) $$,
  'P0001', NULL, 'Reclassificar para a mesma marca é recusado');

-- ---------------------------------------------------------------------------
-- A correção em si
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE saida_reclassificacao AS
  SELECT public.admin_reclassificar_questionario_voto_popular(
    'a3800000-0000-0000-0000-0000000000bb', true) AS saida;

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);

SELECT is((SELECT (saida -> 'avaliacoes_reclassificadas')::int FROM saida_reclassificacao),
  1, 'Devolve quantas avaliações foram reclassificadas');

SELECT ok((SELECT is_voto_popular FROM public.questionarios
            WHERE id_questionario = 'a3800000-0000-0000-0000-0000000000bb'),
  'O questionário passou a ser de voto popular');

SELECT ok((SELECT is_voto_popular FROM public.avaliacoes
            WHERE id_questionario = 'a3800000-0000-0000-0000-0000000000bb'),
  'O voto já lançado virou voto popular');

SELECT ok(NOT (SELECT is_voto_popular FROM public.avaliacoes
                WHERE id_questionario = 'a3800000-0000-0000-0000-0000000000aa'),
  'A nota técnica do outro questionário não foi tocada');

-- ---------------------------------------------------------------------------
-- O efeito que a comissão vê: o voto sai da trilha técnica e entra na própria
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT (public.fn_telao_resumo('e3800000-0000-0000-0000-000000000001') ->> 'avaliacoes_realizadas')::int),
  1, 'O Telão passa a contar só a avaliação técnica');

SELECT is(
  (SELECT (public.fn_telao_resumo('e3800000-0000-0000-0000-000000000001') ->> 'votos_populares')::int),
  1, 'O Telão passa a contar o voto popular à parte');

-- ---------------------------------------------------------------------------
-- A trilha registra a correção
-- ---------------------------------------------------------------------------
SELECT ok(EXISTS (
    SELECT 1 FROM public.log_auditoria
     WHERE acao = 'questionario_voto_popular_reclassificado'
       AND id_evento = 'e3800000-0000-0000-0000-000000000001'
       AND (dados_depois ->> 'avaliacoes_reclassificadas')::int = 1
  ), 'A trilha guarda a reclassificação com as contagens');

SELECT * FROM finish();
ROLLBACK;
