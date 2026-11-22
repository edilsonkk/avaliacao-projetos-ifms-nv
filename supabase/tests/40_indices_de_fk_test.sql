-- Índices de chave estrangeira decididos nas migrations 20261122210113 e 20261122213930,
-- e custo das duas funções de relatório consertadas em 20261122201657.
--
-- Por que existe: o PostgreSQL não indexa o lado filho de uma FK. Sem índice, toda ação
-- referencial varre a tabela filha inteira e, numa sessão `authenticated`, a policy de
-- RLS entra como filtro de linha nessa varredura — `is_admin()` é STABLE, não
-- IMMUTABLE, então roda uma vez por linha varrida. Foi assim que a Classificação
-- estourou o statement_timeout (ADR 0018).
--
-- As duas funções de relatório nunca tinham executado antes do conserto (falhavam em
-- toda chamada por SQL quebrado), então o custo delas em escala era desconhecido.
-- Medido depois: em 601 projetos / 2.573 avaliações, 80 ms e 61 ms contra um teto de
-- 8.000 ms — ~1% do teto. O assert aqui é contra o teto do próprio papel, lido do
-- catálogo, e o tempo medido sai em diag() para quem for investigar lentidão.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

-- ---------------------------------------------------------------------------
-- 1. Os quatro índices da migration 20261122213930
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(esperado.nome, ', ' ORDER BY esperado.nome), '')
     FROM (VALUES
       ('idx_respostas_avaliacao_pergunta'),
       ('idx_avaliacoes_questionario'),
       ('idx_historico_impedimentos_projeto'),
       ('idx_perguntas_questionario_questionario')
     ) AS esperado(nome)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_indexes i
       WHERE i.schemaname = 'public' AND i.indexname = esperado.nome)),
  '', 'os quatro índices de FK da migration 20261122213930 existem');

-- ---------------------------------------------------------------------------
-- 2. A propriedade de verdade: estas cinco FKs têm índice de cobertura (a coluna da
--    FK é prefixo de algum índice). Vale mesmo se alguém renomear um índice.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(f.tabela || '(' || f.coluna || ')', ', ' ORDER BY f.tabela, f.coluna), '')
     FROM (VALUES
       ('respostas_avaliacao', 'id_avaliacao'),
       ('respostas_avaliacao', 'id_pergunta'),
       ('avaliacoes', 'id_questionario'),
       ('historico_impedimentos', 'id_projeto'),
       ('perguntas_questionario', 'id_questionario')
     ) AS f(tabela, coluna)
    WHERE NOT EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = ('public.' || f.tabela)::regclass
         AND a.attname = f.coluna)),
  '', 'as cinco FKs decididas têm a coluna como primeira do índice');

-- ---------------------------------------------------------------------------
-- Cenário para o custo: 200 projetos, 3 avaliações cada, 6 respostas por avaliação e
-- ausências em metade dos projetos (é o que a subconsulta de instituições consulta).
-- ---------------------------------------------------------------------------
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d4000000-0000-0000-0000-0000000000ad', 'admin40@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c4000000-0000-0000-0000-0000000000ad', 'admin40@teste.local', 'Admin 40', 'ADMIN', 'd4000000-0000-0000-0000-0000000000ad'),
  ('c4000000-0000-0000-0000-0000000000a1', 'ava401@teste.local', 'Ana 40', 'AVALIADOR', NULL),
  ('c4000000-0000-0000-0000-0000000000a2', 'ava402@teste.local', 'Bia 40', 'AVALIADOR', NULL),
  ('c4000000-0000-0000-0000-0000000000a3', 'ava403@teste.local', 'Cid 40', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, data_evento, horario_inicio, horario_fim)
VALUES ('e4000000-0000-0000-0000-000000000001', 'Evento Índices 40', true, 3,
        (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');
INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade) VALUES
  ('b4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'Modalidade 40');
INSERT INTO public.areas_tematicas (id_area, id_evento, nome_area) VALUES
  ('94000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'Área 40');
INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado) VALUES
  ('a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'Escola 40 A', 'escola 40 a'),
  ('a4000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000001', 'Escola 40 B', 'escola 40 b');
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('74000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'Técnico 40', 0, 10, false);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate)
SELECT ('84000000-0000-0000-0000-00000000000' || g)::uuid, '74000000-0000-0000-0000-000000000001',
       g, 'Critério 40 nº ' || g, 1, g
  FROM generate_series(1, 6) g;

INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade, id_area,
                             id_instituicao, is_check_in_realizado, is_fora_da_competicao)
SELECT ('f4000000-0000-0000-' || lpad(g::text, 4, '0') || '-000000000001')::uuid,
       'IDX-' || lpad(g::text, 4, '0'), 'Projeto 40 nº ' || g, 'e4000000-0000-0000-0000-000000000001',
       'b4000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001',
       ('a4000000-0000-0000-0000-00000000000' || (1 + (g % 2)))::uuid, true, false
  FROM generate_series(1, 200) g;

INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status,
                               tempo_presenca, tempo_submissao)
SELECT ('54000000-0000-' || lpad(g::text, 4, '0') || '-000' || a || '-000000000001')::uuid,
       ('f4000000-0000-0000-' || lpad(g::text, 4, '0') || '-000000000001')::uuid,
       ('c4000000-0000-0000-0000-0000000000a' || a)::uuid,
       '74000000-0000-0000-0000-000000000001',
       5 + ((g + a) % 5), 'CONCLUIDA', '2026-11-20T10:00:00Z', '2026-11-20T10:05:00Z'
  FROM generate_series(1, 200) g, generate_series(1, 3) a;

INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida)
SELECT ('54000000-0000-' || lpad(g::text, 4, '0') || '-000' || a || '-000000000001')::uuid,
       ('84000000-0000-0000-0000-00000000000' || q)::uuid,
       4 + ((g + a + q) % 7)
  FROM generate_series(1, 200) g, generate_series(1, 3) a, generate_series(1, 6) q;

-- Ausências em metade dos projetos: é o EXISTS por projeto de fn_relatorio_instituicoes_completo
INSERT INTO public.historico_impedimentos (id_usuario, id_projeto, tipo)
SELECT 'c4000000-0000-0000-0000-0000000000a1',
       ('f4000000-0000-0000-' || lpad(g::text, 4, '0') || '-000000000001')::uuid, 'ausencia'
  FROM generate_series(1, 200, 2) g;

ANALYZE public.respostas_avaliacao;
ANALYZE public.avaliacoes;
ANALYZE public.projetos;
ANALYZE public.historico_impedimentos;

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

/* Teto real do papel `authenticated`, lido do catálogo: se mudar no banco, o teste
   acompanha em vez de ficar com 8 s decorado. */
CREATE FUNCTION pg_temp.teto_ms() RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT round(extract(epoch FROM split_part(c, '=', 2)::interval) * 1000)
    FROM (SELECT unnest(r.rolconfig) AS c FROM pg_roles r WHERE r.rolname = 'authenticated') z
   WHERE c LIKE 'statement_timeout=%';
$$;

CREATE FUNCTION pg_temp.ms_instituicoes() RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; n int;
BEGIN
  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.fn_relatorio_instituicoes_completo('e4000000-0000-0000-0000-000000000001');
  RETURN round(extract(epoch FROM (clock_timestamp() - t0)) * 1000);
END $$;

CREATE FUNCTION pg_temp.ms_indicadores() RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; j jsonb;
BEGIN
  t0 := clock_timestamp();
  SELECT public.fn_relatorio_indicadores_gerenciais('e4000000-0000-0000-0000-000000000001') INTO j;
  RETURN round(extract(epoch FROM (clock_timestamp() - t0)) * 1000);
END $$;

SELECT pg_temp.como('d4000000-0000-0000-0000-0000000000ad');
SET LOCAL statement_timeout = '60s';

SELECT diag('fn_relatorio_instituicoes_completo (200 projetos): ' || pg_temp.ms_instituicoes() ||
            ' ms, teto do papel ' || pg_temp.teto_ms() || ' ms');
SELECT cmp_ok(pg_temp.ms_instituicoes(), '<', pg_temp.teto_ms(),
  'fn_relatorio_instituicoes_completo cabe no statement_timeout do papel authenticated');

SELECT diag('fn_relatorio_indicadores_gerenciais (200 projetos): ' || pg_temp.ms_indicadores() ||
            ' ms, teto do papel ' || pg_temp.teto_ms() || ' ms');
SELECT cmp_ok(pg_temp.ms_indicadores(), '<', pg_temp.teto_ms(),
  'fn_relatorio_indicadores_gerenciais cabe no statement_timeout do papel authenticated');

RESET statement_timeout;
RESET role;
SELECT * FROM finish();
ROLLBACK;
