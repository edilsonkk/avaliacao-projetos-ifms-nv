-- Comportamento das quatro RPCs que escrevem nota: `admin_corrigir_respostas_avaliacao`,
-- `admin_arbitrar_nota_final`, `admin_lancar_avaliacao` e `admin_ajustar_media_projeto`.
-- Elas gravam ou alteram a nota que decide a premiação, inclusive a nota final arbitrada.
--
-- O teste 28 já cobre o caminho feliz das quatro num evento só. Este arquivo cobra o
-- contorno: cada recusa com o seu motivo, os limites de escala e de cota, o arredondamento,
-- a propagação para a Classificação e para os relatórios, e o que acontece quando o Admin
-- aponta para avaliação ou projeto de OUTRO evento — a dimensão que nenhum teste exercitava,
-- porque todos os cenários existentes têm um evento único.
--
-- Concorrência não cabe aqui: pgTAP roda numa sessão só. Dois admins disputando a mesma
-- avaliação é papel do simulador (`scripts/simular-feira.mjs`).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(75);

-- ---------------------------------------------------------------------------
-- Cenário: dois eventos. O A (ativo) com três questionários — dois técnicos de escala 0–10
-- e um de voto popular de escala 1–5 — e oito projetos, um por assunto. O B (inativo) com
-- um questionário técnico, um projeto e uma avaliadora própria: é com ele que o escopo
-- cruzado é cobrado. Cota padrão 2 nos dois.
--
-- Pesos do questionário técnico A: critério 1 peso 2, critério 2 peso 1 — a nota é
-- (n1×2 + n2×1) / 3, a fórmula oficial de fn_validar_respostas.
-- ---------------------------------------------------------------------------
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d4300000-0000-0000-0000-0000000000ad', 'admin43@teste.local', false, now()),
  ('d4300000-0000-0000-0000-000000000001', 'ava431@teste.local',  false, now());

INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c4300000-0000-0000-0000-0000000000ad', 'admin43@teste.local', 'Admin 43',      'ADMIN',     'd4300000-0000-0000-0000-0000000000ad'),
  ('c4300000-0000-0000-0000-000000000001', 'ava431@teste.local',  'Avaliadora 1',  'AVALIADOR', 'd4300000-0000-0000-0000-000000000001');
INSERT INTO public.usuarios (id_usuario, email, nome, papel)
SELECT ('c4300000-0000-0000-0000-00000000000' || g)::uuid, 'ava43' || g || '@teste.local',
       'Avaliadora ' || g, 'AVALIADOR'
  FROM generate_series(2, 6) g;
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c4300000-0000-0000-0000-0000000000b1', 'ava43b@teste.local', 'Avaliadora do evento B', 'AVALIADOR'),
  ('c4300000-0000-0000-0000-0000000000f1', 'staff43@teste.local', 'Staff 43', 'STAFF');

INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, sistema_liberado, cota_avaliacoes_padrao,
                            data_evento, horario_inicio, horario_fim, fixar_questionario_primeira_avaliacao)
VALUES
  ('e4300000-0000-0000-0000-000000000001', 'Evento 43 A', true,  true, 2,
   (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59', true),
  ('e4300000-0000-0000-0000-000000000002', 'Evento 43 B', false, true, 2,
   (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59', true);

INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('74300000-0000-0000-0000-000000000001', 'e4300000-0000-0000-0000-000000000001', 'Técnico 43 A',     0, 10, false),
  ('74300000-0000-0000-0000-000000000002', 'e4300000-0000-0000-0000-000000000001', 'Técnico 43 A alt', 0, 10, false),
  ('74300000-0000-0000-0000-000000000003', 'e4300000-0000-0000-0000-000000000001', 'Voto popular 43',  1,  5, true),
  ('74300000-0000-0000-0000-000000000004', 'e4300000-0000-0000-0000-000000000002', 'Técnico 43 B',     0, 10, false);

INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('84300000-0000-0000-0000-000000000001', '74300000-0000-0000-0000-000000000001', 1, 'Critério A', 2, 2),
  ('84300000-0000-0000-0000-000000000002', '74300000-0000-0000-0000-000000000001', 2, 'Critério B', 1, 1),
  ('84300000-0000-0000-0000-000000000003', '74300000-0000-0000-0000-000000000002', 1, 'Critério único', 1, 1),
  ('84300000-0000-0000-0000-000000000004', '74300000-0000-0000-0000-000000000003', 1, 'Gostou?', 1, 1),
  ('84300000-0000-0000-0000-000000000005', '74300000-0000-0000-0000-000000000004', 1, 'Critério A do B', 2, 2),
  ('84300000-0000-0000-0000-000000000006', '74300000-0000-0000-0000-000000000004', 2, 'Critério B do B', 1, 1);

-- P1 correção, P2 arbitragem, P3 lançamento, P4 ajuste de média, P5 cota cheia e voto popular,
-- P6 já fixado no questionário alternativo, P7 sem questionário fixado.
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado,
                             is_fora_da_competicao, id_questionario_fixado, cota_avaliacoes_customizada) VALUES
  ('f4300000-0000-0000-0000-000000000001', 'COR-001', 'Projeto da correção',   'e4300000-0000-0000-0000-000000000001', true, false, '74300000-0000-0000-0000-000000000001', NULL),
  ('f4300000-0000-0000-0000-000000000002', 'ARB-001', 'Projeto da arbitragem', 'e4300000-0000-0000-0000-000000000001', true, false, '74300000-0000-0000-0000-000000000001', NULL),
  ('f4300000-0000-0000-0000-000000000003', 'LAN-001', 'Projeto do lançamento', 'e4300000-0000-0000-0000-000000000001', true, false, NULL, NULL),
  ('f4300000-0000-0000-0000-000000000004', 'MED-001', 'Projeto da média',      'e4300000-0000-0000-0000-000000000001', true, false, '74300000-0000-0000-0000-000000000001', NULL),
  ('f4300000-0000-0000-0000-000000000005', 'VOT-001', 'Projeto do voto',       'e4300000-0000-0000-0000-000000000001', true, false, '74300000-0000-0000-0000-000000000001', 1),
  ('f4300000-0000-0000-0000-000000000006', 'FIX-001', 'Projeto já fixado',     'e4300000-0000-0000-0000-000000000001', true, false, '74300000-0000-0000-0000-000000000002', NULL),
  ('f4300000-0000-0000-0000-000000000007', 'SEM-001', 'Projeto sem fixação',   'e4300000-0000-0000-0000-000000000001', true, false, NULL, NULL),
  ('f4300000-0000-0000-0000-0000000000b1', 'CRU-001', 'Projeto do evento B',   'e4300000-0000-0000-0000-000000000002', true, false, '74300000-0000-0000-0000-000000000004', NULL);

INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_instituicao)
SELECT ('c4300000-0000-0000-0000-00000000000' || g)::uuid, 'e4300000-0000-0000-0000-000000000001', true, NULL
  FROM generate_series(1, 6) g;
-- O Staff entra em avaliadores_evento de propósito: assim a recusa de lançar em nome dele
-- só pode vir da checagem de papel, não da de vínculo com o evento.
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_instituicao) VALUES
  ('c4300000-0000-0000-0000-0000000000f1', 'e4300000-0000-0000-0000-000000000001', true, NULL),
  ('c4300000-0000-0000-0000-0000000000b1', 'e4300000-0000-0000-0000-000000000002', true, NULL);

-- Avaliações de partida, todas com a conta fechando: (n1×2 + n2×1)/3.
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('a4300000-0000-0000-0000-000000000001', 'f4300000-0000-0000-0000-000000000001', 'c4300000-0000-0000-0000-000000000001', '74300000-0000-0000-0000-000000000001', 4.00, 'CONCLUIDA'),
  ('a4300000-0000-0000-0000-000000000002', 'f4300000-0000-0000-0000-000000000002', 'c4300000-0000-0000-0000-000000000002', '74300000-0000-0000-0000-000000000001', 6.00, 'CONCLUIDA'),
  ('a4300000-0000-0000-0000-000000000003', 'f4300000-0000-0000-0000-000000000001', 'c4300000-0000-0000-0000-000000000003', '74300000-0000-0000-0000-000000000001', 1.00, 'CANCELADA'),
  ('a4300000-0000-0000-0000-000000000004', 'f4300000-0000-0000-0000-000000000007', 'c4300000-0000-0000-0000-000000000004', NULL,                                   5.00, 'CONCLUIDA'),
  ('a4300000-0000-0000-0000-000000000005', 'f4300000-0000-0000-0000-000000000005', 'c4300000-0000-0000-0000-000000000005', '74300000-0000-0000-0000-000000000001', 7.00, 'CONCLUIDA'),
  ('a4300000-0000-0000-0000-000000000006', 'f4300000-0000-0000-0000-000000000006', 'c4300000-0000-0000-0000-000000000006', '74300000-0000-0000-0000-000000000002', 8.00, 'CONCLUIDA'),
  ('a4300000-0000-0000-0000-000000000007', 'f4300000-0000-0000-0000-000000000004', 'c4300000-0000-0000-0000-000000000001', '74300000-0000-0000-0000-000000000001', 5.00, 'CONCLUIDA'),
  ('a4300000-0000-0000-0000-0000000000b1', 'f4300000-0000-0000-0000-0000000000b1', 'c4300000-0000-0000-0000-0000000000b1', '74300000-0000-0000-0000-000000000004', 8.00, 'CONCLUIDA');

INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('a4300000-0000-0000-0000-000000000001', '84300000-0000-0000-0000-000000000001', 5),
  ('a4300000-0000-0000-0000-000000000001', '84300000-0000-0000-0000-000000000002', 2),
  ('a4300000-0000-0000-0000-000000000002', '84300000-0000-0000-0000-000000000001', 6),
  ('a4300000-0000-0000-0000-000000000002', '84300000-0000-0000-0000-000000000002', 6),
  ('a4300000-0000-0000-0000-000000000003', '84300000-0000-0000-0000-000000000001', 1),
  ('a4300000-0000-0000-0000-000000000003', '84300000-0000-0000-0000-000000000002', 1),
  ('a4300000-0000-0000-0000-000000000005', '84300000-0000-0000-0000-000000000001', 7),
  ('a4300000-0000-0000-0000-000000000005', '84300000-0000-0000-0000-000000000002', 7),
  ('a4300000-0000-0000-0000-000000000006', '84300000-0000-0000-0000-000000000003', 8),
  ('a4300000-0000-0000-0000-000000000007', '84300000-0000-0000-0000-000000000001', 5),
  ('a4300000-0000-0000-0000-000000000007', '84300000-0000-0000-0000-000000000002', 5),
  ('a4300000-0000-0000-0000-0000000000b1', '84300000-0000-0000-0000-000000000005', 8),
  ('a4300000-0000-0000-0000-0000000000b1', '84300000-0000-0000-0000-000000000006', 8);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

-- Respostas por questionário, para as chamadas não virarem paredes de UUID.
CREATE FUNCTION pg_temp.resp_a(p_n1 numeric, p_n2 numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000001', 'nota', p_n1),
    jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000002', 'nota', p_n2));
$$;
CREATE FUNCTION pg_temp.resp_alt(p_n numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000003', 'nota', p_n));
$$;
CREATE FUNCTION pg_temp.resp_vp(p_n numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000004', 'nota', p_n));
$$;
CREATE FUNCTION pg_temp.resp_b(p_n1 numeric, p_n2 numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000005', 'nota', p_n1),
    jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000006', 'nota', p_n2));
$$;
CREATE FUNCTION pg_temp.achados(p_codigo text, p_sev text, p_id_avaliacao uuid DEFAULT NULL,
                                p_id_projeto uuid DEFAULT NULL) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.fn_auditar_notas('e4300000-0000-0000-0000-000000000001')
  WHERE codigo = p_codigo AND severidade = p_sev
    AND (p_id_avaliacao IS NULL OR id_avaliacao = p_id_avaliacao)
    AND (p_id_projeto   IS NULL OR id_projeto   = p_id_projeto);
$$;

-- O retorno jsonb é guardado: lê-lo duas vezes significaria chamar a função duas vezes.
CREATE TEMP TABLE retorno43 (chave text PRIMARY KEY, valor jsonb);
GRANT INSERT, SELECT ON retorno43 TO authenticated;

-- ============================================================================
-- 1. Nenhuma das quatro é de quem não é Admin
-- ============================================================================
SELECT pg_temp.como('d4300000-0000-0000-0000-000000000001');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000001', '[]'::jsonb) $$,
  '42501', NULL, 'avaliadora não corrige notas por critério');
SELECT throws_ok($$ SELECT public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-000000000001', 5) $$,
  '42501', NULL, 'avaliadora não arbitra nota final');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000003',
  'c4300000-0000-0000-0000-000000000002', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(5, 5)) $$,
  '42501', NULL, 'avaliadora não lança avaliação em nome de outra');
SELECT throws_ok($$ SELECT public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-000000000004', 1) $$,
  '42501', NULL, 'avaliadora não ajusta média de projeto');
RESET role;

-- ============================================================================
-- 2. admin_corrigir_respostas_avaliacao: a nota sai das respostas, sempre
-- ============================================================================
SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');

-- Cada recusa com o seu motivo, antes do caminho que grava.
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000001', 'nota', 4))) $$,
  '22023', NULL, 'corrigir recusa conjunto incompleto');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000001', 'nota', 4),
                    jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000001', 'nota', 5))) $$,
  '22023', NULL, 'corrigir recusa a mesma pergunta duas vezes');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000001', 'nota', 4),
                    jsonb_build_object('id_pergunta', '84300000-0000-0000-0000-000000000003', 'nota', 5))) $$,
  '22023', NULL, 'corrigir recusa pergunta de outro questionário');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000001',
  pg_temp.resp_a(11, 2)) $$,
  '22023', NULL, 'corrigir recusa nota fora da escala');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000001',
  '{}'::jsonb) $$,
  '22023', NULL, 'corrigir recusa respostas que não são uma lista');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000003',
  pg_temp.resp_a(4, 1)) $$,
  '22023', NULL, 'corrigir recusa avaliação cancelada');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-00000000ffff',
  pg_temp.resp_a(4, 1)) $$,
  'P0002', NULL, 'corrigir recusa avaliação inexistente');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000004',
  pg_temp.resp_a(4, 1)) $$,
  '22023', NULL, 'corrigir recusa avaliação sem questionário definido');

-- (4×2 + 1×1) / 3 = 3.00
INSERT INTO retorno43 VALUES ('corrigir',
  public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000001',
    pg_temp.resp_a(4, 1), 'erro de digitação conferido com a avaliadora'));
RESET role;

SELECT is((SELECT (valor ->> 'nota_nova')::numeric FROM retorno43 WHERE chave = 'corrigir'),
  3.00::numeric, 'corrigir recalcula a nota pela fórmula ponderada');
SELECT is((SELECT (valor ->> 'nota_anterior')::numeric FROM retorno43 WHERE chave = 'corrigir'),
  4.00::numeric, 'corrigir devolve a nota que havia antes');
SELECT is((SELECT nota_final FROM public.avaliacoes WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000001'),
  3.00::numeric, 'a nota corrigida fica gravada na avaliação');
SELECT is((SELECT ajuste_tipo FROM public.avaliacoes WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000001'),
  'respostas_corrigidas', 'a avaliação fica marcada como corrigida');
SELECT is((SELECT ajuste_motivo FROM public.avaliacoes WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000001'),
  'erro de digitação conferido com a avaliadora', 'o motivo da correção fica no registro');
SELECT is((SELECT ajustada_por FROM public.avaliacoes WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000001'),
  'c4300000-0000-0000-0000-0000000000ad'::uuid, 'a correção fica atribuída ao Admin da sessão');
SELECT is((SELECT array_agg(nota_atribuida ORDER BY id_pergunta) FROM public.respostas_avaliacao
            WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000001'),
  ARRAY[4, 1]::numeric[], 'as notas por critério ficam como o Admin corrigiu');

-- Critério sem resposta gravada: a função insere em vez de deixar a conta sem parcela.
DELETE FROM public.respostas_avaliacao
 WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000001'
   AND id_pergunta  = '84300000-0000-0000-0000-000000000002';
SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');
SELECT is((public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-000000000001',
            pg_temp.resp_a(4, 1), 'critério reposto') ->> 'nota_nova')::numeric,
  3.00::numeric, 'corrigir repõe o critério que não tinha resposta gravada');
SELECT is(pg_temp.achados('C1', 'grave', 'a4300000-0000-0000-0000-000000000001'),
  0::bigint, 'depois de corrigir, a conferência não acusa a avaliação como adulterada');
RESET role;
SELECT is((SELECT count(*) FROM public.respostas_avaliacao
            WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000001'),
  2::bigint, 'a avaliação volta a ter uma resposta por critério');

-- ============================================================================
-- 3. admin_arbitrar_nota_final: a conta deixa de fechar, mas declaradamente
-- ============================================================================
SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-000000000002', 10.5) $$,
  '22023', NULL, 'arbitrar recusa nota acima da escala do questionário');
SELECT throws_ok($$ SELECT public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-000000000002', -0.5) $$,
  '22023', NULL, 'arbitrar recusa nota abaixo da escala do questionário');
SELECT throws_ok($$ SELECT public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-000000000002', NULL) $$,
  '22023', NULL, 'arbitrar recusa nota em branco');
SELECT throws_ok($$ SELECT public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-000000000003', 5) $$,
  '22023', NULL, 'arbitrar recusa avaliação cancelada');
SELECT throws_ok($$ SELECT public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-00000000ffff', 5) $$,
  'P0002', NULL, 'arbitrar recusa avaliação inexistente');

INSERT INTO retorno43 VALUES ('arbitrar',
  public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-000000000002', 10, 'decisão da comissão de recurso'));
RESET role;

SELECT is((SELECT (valor ->> 'nota_nova')::numeric FROM retorno43 WHERE chave = 'arbitrar'),
  10.00::numeric, 'arbitrar aceita o limite superior da escala');
SELECT is((SELECT (valor ->> 'nota_anterior')::numeric FROM retorno43 WHERE chave = 'arbitrar'),
  6.00::numeric, 'arbitrar devolve a nota que havia antes');
SELECT is((SELECT nota_final FROM public.avaliacoes WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000002'),
  10.00::numeric, 'a nota arbitrada fica gravada');
SELECT is((SELECT ajuste_tipo FROM public.avaliacoes WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000002'),
  'nota_arbitrada', 'a avaliação fica marcada como arbitrada');
SELECT is((SELECT array_agg(nota_atribuida ORDER BY id_pergunta) FROM public.respostas_avaliacao
            WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000002'),
  ARRAY[6, 6]::numeric[], 'arbitrar não mexe nas notas por critério');

SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.achados('C1', 'grave', 'a4300000-0000-0000-0000-000000000002'),
  0::bigint, 'nota arbitrada não é acusada como adulteração');
SELECT is(pg_temp.achados('C1', 'informativo', 'a4300000-0000-0000-0000-000000000002'),
  1::bigint, 'nota arbitrada aparece como achado informativo');

-- Arredondamento e limite inferior, no mesmo registro.
SELECT is((public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-000000000002', 7.456,
            'ata relida') ->> 'nota_nova')::numeric,
  7.46::numeric, 'arbitrar arredonda a nota para duas casas');
SELECT is((public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-000000000002', 0,
            'projeto desclassificado pela comissão') ->> 'nota_nova')::numeric,
  0.00::numeric, 'arbitrar aceita o limite inferior da escala');
RESET role;
SELECT is((SELECT nota_final FROM public.avaliacoes WHERE id_avaliacao = 'a4300000-0000-0000-0000-000000000002'),
  0.00::numeric, 'a última arbitragem é a que vale');

-- ============================================================================
-- 4. admin_lancar_avaliacao: a ficha de papel entra com as regras do sorteio
-- ============================================================================
SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000003',
  'c4300000-0000-0000-0000-0000000000b1', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(5, 5)) $$,
  '22023', NULL, 'lançar recusa avaliadora de outro evento');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000003',
  'c4300000-0000-0000-0000-0000000000f1', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(5, 5)) $$,
  '22023', NULL, 'lançar recusa quem está no evento mas não é avaliador');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000003',
  'c4300000-0000-0000-0000-000000000002', '74300000-0000-0000-0000-000000000004', pg_temp.resp_b(5, 5)) $$,
  '22023', NULL, 'lançar recusa questionário de outro evento');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000006',
  'c4300000-0000-0000-0000-000000000002', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(5, 5)) $$,
  '22023', NULL, 'lançar recusa questionário diferente do que o projeto já fixou');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000001',
  'c4300000-0000-0000-0000-000000000001', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(5, 5)) $$,
  '22023', NULL, 'lançar recusa quem já avaliou o projeto');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000001',
  'c4300000-0000-0000-0000-000000000003', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(5, 5)) $$,
  '22023', NULL, 'lançar recusa quem tem avaliação cancelada do projeto: o caminho é restaurar');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-00000000ffff',
  'c4300000-0000-0000-0000-000000000002', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(5, 5)) $$,
  'P0002', NULL, 'lançar recusa projeto inexistente');

-- (5×2 + 2×1)/3 = 4.00, no projeto sem questionário fixado e com a cota vazia
INSERT INTO retorno43 VALUES ('lancar',
  public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000003',
    'c4300000-0000-0000-0000-000000000001', '74300000-0000-0000-0000-000000000001',
    pg_temp.resp_a(5, 2), 'ficha em papel', 'celular sem acesso no dia'));
RESET role;

SELECT is((SELECT (valor ->> 'nota_final')::numeric FROM retorno43 WHERE chave = 'lancar'),
  4.00::numeric, 'lançar calcula a nota pela fórmula ponderada');
SELECT is((SELECT (valor -> 'acima_da_cota')::text::boolean FROM retorno43 WHERE chave = 'lancar'),
  false, 'lançar dentro da cota não se declara acima dela');
SELECT is((SELECT ajuste_tipo FROM public.avaliacoes
            WHERE id_projeto = 'f4300000-0000-0000-0000-000000000003'
              AND id_usuario = 'c4300000-0000-0000-0000-000000000001'),
  'lancada_pelo_admin', 'a avaliação lançada fica marcada como tal');
SELECT is((SELECT status FROM public.avaliacoes
            WHERE id_projeto = 'f4300000-0000-0000-0000-000000000003'
              AND id_usuario = 'c4300000-0000-0000-0000-000000000001'),
  'CONCLUIDA'::varchar, 'a avaliação lançada nasce concluída');
SELECT is((SELECT count(*) FROM public.respostas_avaliacao r
            JOIN public.avaliacoes a ON a.id_avaliacao = r.id_avaliacao
            WHERE a.id_projeto = 'f4300000-0000-0000-0000-000000000003'),
  2::bigint, 'as respostas por critério ficam gravadas uma a uma');
SELECT is((SELECT id_questionario_fixado FROM public.projetos
            WHERE id_projeto = 'f4300000-0000-0000-0000-000000000003'),
  '74300000-0000-0000-0000-000000000001'::uuid, 'o primeiro lançamento fixa o questionário do projeto');

-- A cota do evento é 2: a segunda cabe, a terceira só com confirmação explícita.
SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');
SELECT lives_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000003',
  'c4300000-0000-0000-0000-000000000002', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(6, 6)) $$,
  'o segundo lançamento ainda cabe na cota');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000003',
  'c4300000-0000-0000-0000-000000000003', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(2, 2)) $$,
  '22023', NULL, 'lançar acima da cota é recusado sem confirmação');
SELECT ok((public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000003',
            'c4300000-0000-0000-0000-000000000003', '74300000-0000-0000-0000-000000000001',
            pg_temp.resp_a(2, 2), NULL, 'banca extra autorizada', true) -> 'acima_da_cota')::text::boolean,
  'com confirmação, lançar acima da cota passa e fica declarado');

-- Voto popular: não consome cota, não fixa questionário e não entra na média técnica.
-- VOT-001 tem cota 1, já cheia por uma nota técnica.
SELECT lives_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-000000000005',
  'c4300000-0000-0000-0000-000000000006', '74300000-0000-0000-0000-000000000003', pg_temp.resp_vp(5)) $$,
  'voto popular entra mesmo com a cota técnica cheia, sem confirmação');
RESET role;
SELECT ok((SELECT is_voto_popular FROM public.avaliacoes
            WHERE id_projeto = 'f4300000-0000-0000-0000-000000000005'
              AND id_usuario = 'c4300000-0000-0000-0000-000000000006'),
  'a avaliação lançada herda a marca de voto popular do questionário');
SELECT is((SELECT id_questionario_fixado FROM public.projetos
            WHERE id_projeto = 'f4300000-0000-0000-0000-000000000005'),
  '74300000-0000-0000-0000-000000000001'::uuid, 'voto popular não refixa o questionário do projeto');
SELECT is((SELECT media_geral FROM public.view_ranking_top3 WHERE codigo_projeto = 'VOT-001'),
  7.00::numeric, 'voto popular não entra na média técnica da Classificação');

-- ============================================================================
-- 5. admin_ajustar_media_projeto: bônus e penalidade com a conta aberta
-- ============================================================================
SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-000000000004', 11) $$,
  '22023', NULL, 'ajuste acima da amplitude do questionário fixado é recusado');
-- SEM-001 não fixou questionário: o teto vem da maior amplitude do evento (10).
SELECT throws_ok($$ SELECT public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-000000000007', 11) $$,
  '22023', NULL, 'sem questionário fixado, o teto vem da maior amplitude do evento');
SELECT throws_ok($$ SELECT public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-00000000ffff', 1) $$,
  'P0002', NULL, 'ajustar média recusa projeto inexistente');
SELECT is((public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-000000000004', 10,
            'limite da amplitude') ->> 'ajuste_media')::numeric,
  10.00::numeric, 'o ajuste aceita exatamente a amplitude da escala');
SELECT is((public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-000000000004', 0.555,
            'três casas na ata') ->> 'ajuste_media')::numeric,
  0.56::numeric, 'o ajuste é arredondado para duas casas');
SELECT lives_ok($$ SELECT public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-000000000004', 1.5,
  'prêmio de inovação da comissão') $$, 'o ajuste da comissão é aceito');
SELECT is(pg_temp.achados('C12', 'informativo', NULL, 'f4300000-0000-0000-0000-000000000004'),
  1::bigint, 'o ajuste de média entra na lista informativa C12');
RESET role;

SELECT is((SELECT media_geral FROM public.view_ranking_top3 WHERE codigo_projeto = 'MED-001'),
  5.00::numeric, 'o ajuste não contamina a média das notas');
SELECT is((SELECT media_final FROM public.view_ranking_top3 WHERE codigo_projeto = 'MED-001'),
  6.50::numeric, 'a Classificação soma o ajuste à média');
SELECT is((SELECT media_final FROM public.fn_relatorio_projetos_completo('e4300000-0000-0000-0000-000000000001')
            WHERE codigo_projeto = 'MED-001'),
  6.50::numeric, 'o relatório mostra a mesma média final que a Classificação');

-- Zerar o ajuste apaga o rastro do ajuste anterior, não só o número.
SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');
SELECT is((public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-000000000004', 0) ->> 'ajuste_media')::numeric,
  0.00::numeric, 'ajuste zero remove o bônus');
RESET role;
SELECT ok((SELECT ajuste_media_em IS NULL AND ajuste_media_por IS NULL AND ajuste_media_motivo IS NULL
             FROM public.projetos WHERE id_projeto = 'f4300000-0000-0000-0000-000000000004'),
  'ajuste zero limpa data, autor e motivo do ajuste');

-- ============================================================================
-- 6. Escopo cruzado entre eventos
--
-- As quatro recebem o id do objeto, não o do evento, e `is_admin()` é global: não existe
-- "Admin do evento A". As três primeiras asserções abaixo REGISTRAM esse comportamento —
-- a coordenação alcança avaliação e projeto de evento inativo — em vez de afirmar que ele
-- é desejável. Mudar isso é decisão de regra de negócio e pede ADR; o que este teste
-- impede é a mudança acontecer sem ninguém notar.
-- `admin_lancar_avaliacao` é a exceção: ela deriva o evento do projeto e recusa os dois
-- atravessamentos possíveis.
-- ============================================================================
SELECT pg_temp.como('d4300000-0000-0000-0000-0000000000ad');
SELECT is((public.admin_arbitrar_nota_final('a4300000-0000-0000-0000-0000000000b1', 9,
            'recurso do evento B') ->> 'nota_nova')::numeric,
  9.00::numeric, 'arbitrar alcança avaliação de outro evento, inclusive inativo');
-- (2×2 + 2×1)/3 = 2.00
SELECT is((public.admin_corrigir_respostas_avaliacao('a4300000-0000-0000-0000-0000000000b1',
            pg_temp.resp_b(2, 2), 'correção do evento B') ->> 'nota_nova')::numeric,
  2.00::numeric, 'corrigir alcança avaliação de outro evento');
SELECT is((public.admin_ajustar_media_projeto('f4300000-0000-0000-0000-0000000000b1', 1,
            'ajuste do evento B') ->> 'ajuste_media')::numeric,
  1.00::numeric, 'ajustar média alcança projeto de outro evento');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-0000000000b1',
  'c4300000-0000-0000-0000-000000000002', '74300000-0000-0000-0000-000000000004', pg_temp.resp_b(5, 5)) $$,
  '22023', NULL, 'lançar recusa avaliadora do evento A em projeto do evento B');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f4300000-0000-0000-0000-0000000000b1',
  'c4300000-0000-0000-0000-0000000000b1', '74300000-0000-0000-0000-000000000001', pg_temp.resp_a(5, 5)) $$,
  '22023', NULL, 'lançar recusa questionário do evento A em projeto do evento B');
RESET role;
SELECT is((SELECT count(*) FROM public.fn_relatorio_projetos_completo('e4300000-0000-0000-0000-000000000001')
            WHERE codigo_projeto = 'CRU-001'),
  0::bigint, 'o relatório do evento A não enxerga o projeto do evento B');

SELECT * FROM finish();
ROLLBACK;
