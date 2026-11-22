-- Classificação: postura de autorização de `fn_chave_desempate` e custo da leitura do
-- ranking. Migration 20261122210113_indice_respostas_avaliacao_por_avaliacao.
--
-- Por que este teste existe: `RankingPremiacao.tsx` lê `view_ranking_top3` DIRETO, como
-- `authenticated`, então a RLS de `avaliacoes` e `respostas_avaliacao` é avaliada na
-- leitura. A view chama `fn_chave_desempate` uma vez por projeto; sem índice em
-- `respostas_avaliacao(id_avaliacao)` cada chamada varre a tabela inteira e a policy
-- `rls_respostas_avaliacao_admin USING is_admin()` roda uma vez POR LINHA varrida — a
-- tela estourava o statement_timeout de 8 s do papel (110 s medidos em 601 projetos).
--
-- A tentação é marcar a função como SECURITY DEFINER. Este teste existe para impedir
-- isso: com DEFINER e sem guarda, qualquer sessão `authenticated` — inclusive o celular
-- pareado de um avaliador — leria as médias por critério de QUALQUER projeto, que é o
-- dado que decide a premiação. Ver docs/decisoes/0018-indice-em-respostas-avaliacao.md.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

-- ---------------------------------------------------------------------------
-- Postura: a função NÃO ignora a RLS, e quem a executa é só quem já podia
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_chave_desempate'),
  false,
  'fn_chave_desempate continua SECURITY INVOKER (a RLS de quem lê é que vale)');

SELECT is(
  (SELECT c.reloptions::text FROM pg_class c WHERE c.relname = 'view_ranking_top3'),
  '{security_invoker=true}',
  'view_ranking_top3 continua security_invoker: a classificação respeita a RLS do leitor');

SELECT ok(
  NOT has_function_privilege('anon', 'public.fn_chave_desempate(uuid)', 'EXECUTE'),
  'visitante anônimo não executa fn_chave_desempate');
SELECT ok(
  has_function_privilege('authenticated', 'public.fn_chave_desempate(uuid)', 'EXECUTE'),
  'quem está logado executa fn_chave_desempate (a tela de Classificação depende dela)');

-- ---------------------------------------------------------------------------
-- Cenário: um evento com volume suficiente para o plano escolher o índice e para a
-- leitura doer se ele não existir. 200 projetos x 3 avaliações x 6 respostas.
-- ---------------------------------------------------------------------------
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3900000-0000-0000-0000-0000000000ad', 'admin39@teste.local', false, now()),
  ('d3900000-0000-0000-0000-0000000000a1', NULL, true, NULL);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c3900000-0000-0000-0000-0000000000ad', 'admin39@teste.local', 'Admin 39', 'ADMIN', 'd3900000-0000-0000-0000-0000000000ad'),
  ('c3900000-0000-0000-0000-0000000000a1', 'ava391@teste.local', 'Ana 39', 'AVALIADOR', NULL),
  ('c3900000-0000-0000-0000-0000000000a2', 'ava392@teste.local', 'Bia 39', 'AVALIADOR', NULL),
  ('c3900000-0000-0000-0000-0000000000a3', 'ava393@teste.local', 'Cid 39', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, data_evento, horario_inicio, horario_fim)
VALUES ('e3900000-0000-0000-0000-000000000001', 'Evento Classificação 39', true, 3,
        (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');
INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade) VALUES
  ('b3900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000001', 'Modalidade 39');
INSERT INTO public.areas_tematicas (id_area, id_evento, nome_area) VALUES
  ('93900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000001', 'Área 39');
INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado) VALUES
  ('a3900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000001', 'Escola 39', 'escola 39');
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('73900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000001', 'Técnico 39', 0, 10, false);
-- peso_desempate > 0 em todas: é o que fn_chave_desempate agrega
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate)
SELECT ('83900000-0000-0000-0000-00000000000' || g)::uuid, '73900000-0000-0000-0000-000000000001',
       g, 'Critério ' || g, 1, g
  FROM generate_series(1, 6) g;

INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade, id_area,
                             id_instituicao, is_check_in_realizado, is_fora_da_competicao)
SELECT ('f3900000-0000-0000-' || lpad(g::text, 4, '0') || '-000000000001')::uuid,
       'CLA-' || lpad(g::text, 4, '0'), 'Projeto 39 nº ' || g, 'e3900000-0000-0000-0000-000000000001',
       'b3900000-0000-0000-0000-000000000001', '93900000-0000-0000-0000-000000000001',
       'a3900000-0000-0000-0000-000000000001', true, false
  FROM generate_series(1, 200) g;

INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status,
                               tempo_presenca, tempo_submissao)
SELECT ('53900000-0000-' || lpad(g::text, 4, '0') || '-000' || a || '-000000000001')::uuid,
       ('f3900000-0000-0000-' || lpad(g::text, 4, '0') || '-000000000001')::uuid,
       ('c3900000-0000-0000-0000-0000000000a' || a)::uuid,
       '73900000-0000-0000-0000-000000000001',
       5 + ((g + a) % 5), 'CONCLUIDA', '2026-11-20T10:00:00Z', '2026-11-20T10:05:00Z'
  FROM generate_series(1, 200) g, generate_series(1, 3) a;

INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida)
SELECT ('53900000-0000-' || lpad(g::text, 4, '0') || '-000' || a || '-000000000001')::uuid,
       ('83900000-0000-0000-0000-00000000000' || q)::uuid,
       4 + ((g + a + q) % 7)
  FROM generate_series(1, 200) g, generate_series(1, 3) a, generate_series(1, 6) q;

INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d3900000-0000-0000-0000-0000000000a1', 'c3900000-0000-0000-0000-0000000000a1',
   'e3900000-0000-0000-0000-000000000001', 'pareamento');
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c3900000-0000-0000-0000-0000000000a1', 'e3900000-0000-0000-0000-000000000001', true);

ANALYZE public.respostas_avaliacao;
ANALYZE public.avaliacoes;
ANALYZE public.projetos;

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

/*
 * Plano da busca que fn_chave_desempate faz por avaliação. É esta a consulta que
 * variava: sem índice vira Seq Scan da tabela inteira, e a policy
 * rls_respostas_avaliacao_admin reavalia is_admin() por linha varrida.
 * (EXPLAIN da view não serve: o plano interno de uma função não aparece nele.)
 */
CREATE FUNCTION pg_temp.plano_da_busca_por_avaliacao() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_linhas text := '';
  v_linha text;
BEGIN
  FOR v_linha IN
    EXECUTE $e$ EXPLAIN (COSTS OFF)
      SELECT r.id_pergunta, r.nota_atribuida FROM public.respostas_avaliacao r
       WHERE r.id_avaliacao = '53900000-0000-0001-0001-000000000001'::uuid $e$
  LOOP
    v_linhas := v_linhas || v_linha || E'\n';
  END LOOP;
  RETURN v_linhas;
END $$;

/* Milissegundos da leitura completa da classificação, medidos aqui dentro: uma
 * regressão reporta o número em vez de abortar o arquivo no statement_timeout
 * (57014 não é capturável por WHEN OTHERS, então lives_ok não o pegaria). */
CREATE FUNCTION pg_temp.ms_do_ranking() RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; n int;
BEGIN
  t0 := clock_timestamp();
  SELECT count(x.chave_desempate) INTO n FROM (
    SELECT chave_desempate FROM public.view_ranking_top3
     WHERE id_evento = 'e3900000-0000-0000-0000-000000000001'
     ORDER BY id_projeto) x;
  RETURN round(extract(epoch FROM (clock_timestamp() - t0)) * 1000);
END $$;

-- ---------------------------------------------------------------------------
-- A RLS continua filtrando de verdade: é isto que SECURITY DEFINER destruiria
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d3900000-0000-0000-0000-0000000000ad');
SELECT isnt(
  (SELECT public.fn_chave_desempate('f3900000-0000-0000-0001-000000000001')),
  '{}'::numeric[],
  'Admin obtém a chave de desempate do projeto');

SELECT pg_temp.como('d3900000-0000-0000-0000-0000000000a1');
SELECT is(
  (SELECT public.fn_chave_desempate('f3900000-0000-0000-0001-000000000001')),
  '{}'::numeric[],
  'avaliador com aparelho vinculado NÃO lê a chave de desempate (RLS de respostas_avaliacao)');

-- ---------------------------------------------------------------------------
-- Caminho de acesso e custo: o índice da FK é o que mantém a tela de pé
-- ---------------------------------------------------------------------------
RESET role;
SELECT is(
  (SELECT count(*)::int FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'respostas_avaliacao'
      AND indexdef LIKE '%(id_avaliacao)%'),
  1,
  'existe índice em respostas_avaliacao(id_avaliacao)');

SELECT pg_temp.como('d3900000-0000-0000-0000-0000000000ad');
SELECT ok(
  pg_temp.plano_da_busca_por_avaliacao() NOT LIKE '%Seq Scan on respostas_avaliacao%',
  'a busca das respostas de uma avaliação não varre a tabela (usa o índice da FK)');

-- O teto é o do próprio papel `authenticated`, lido do catálogo: se alguém mudar
-- statement_timeout no banco, o teste acompanha em vez de ficar com 8 s decorado.
-- O teto da sessão fica folgado só para a medida poder ser reportada.
SET LOCAL statement_timeout = '60s';
SELECT cmp_ok(
  pg_temp.ms_do_ranking(), '<',
  (SELECT round(extract(epoch FROM split_part(c, '=', 2)::interval) * 1000)
     FROM (SELECT unnest(r.rolconfig) AS c FROM pg_roles r WHERE r.rolname = 'authenticated') z
    WHERE c LIKE 'statement_timeout=%'),
  'a leitura completa da classificação (200 projetos) cabe no statement_timeout do papel authenticated');
RESET statement_timeout;

RESET role;
SELECT * FROM finish();
ROLLBACK;
