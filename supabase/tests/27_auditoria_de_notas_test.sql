-- Auditoria de notas (migrations 20261106010000 a 20261106040000):
-- trilha append-only, conferência por recálculo, memorial de cálculo e os
-- caminhos que apagavam nota sem rastro.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(43);

-- ----------------------------------------------------------------------------
-- Cenário: dois eventos, para provar que o reset de um não apaga o outro
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d7000000-0000-0000-0000-0000000000ad', 'admin27@teste.local', false, now()),
  ('d7000000-0000-0000-0000-000000000051', 'staff27@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c7000000-0000-0000-0000-0000000000ad', 'admin27@teste.local', 'Admin 27', 'ADMIN', 'd7000000-0000-0000-0000-0000000000ad'),
  ('c7000000-0000-0000-0000-000000000051', 'staff27@teste.local', 'Staff 27', 'STAFF', 'd7000000-0000-0000-0000-000000000051'),
  ('c7000000-0000-0000-0000-0000000000a1', 'ava271@teste.local', 'Ana 27', 'AVALIADOR', NULL),
  ('c7000000-0000-0000-0000-0000000000a2', 'ava272@teste.local', 'Bruno 27', 'AVALIADOR', NULL),
  ('c7000000-0000-0000-0000-0000000000a3', 'ava273@teste.local', 'Carla 27', 'AVALIADOR', NULL);
UPDATE public.eventos SET is_ativo = false;
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao) VALUES
  ('e7000000-0000-0000-0000-000000000001', 'Feira Auditada', true, 3),
  ('e7000000-0000-0000-0000-000000000002', 'Feira Anterior', false, 3);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado) VALUES
  ('f7000000-0000-0000-0000-000000000001', 'AUD-001', 'Projeto Auditado', 'e7000000-0000-0000-0000-000000000001', true),
  ('f7000000-0000-0000-0000-000000000002', 'AUD-002', 'Projeto Vizinho',  'e7000000-0000-0000-0000-000000000001', true),
  ('f7000000-0000-0000-0000-000000000003', 'ANT-001', 'Projeto Passado',  'e7000000-0000-0000-0000-000000000002', true);
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima) VALUES
  ('a7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Quest Auditado', 1, 5);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 1, 'Critério peso 2', 2, 1),
  ('b7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', 2, 'Critério peso 1', 1, 2);
UPDATE public.projetos SET id_questionario_fixado = 'a7000000-0000-0000-0000-000000000001'
WHERE id_projeto IN ('f7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000002');

-- AUD-001: (5×2 + 2×1) / 3 = 4.00 — a conta fecha
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('aa700000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-0000000000a1', 'a7000000-0000-0000-0000-000000000001', 4.00, 'CONCLUIDA'),
  ('aa700000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-0000000000a2', 'a7000000-0000-0000-0000-000000000001', 3.00, 'CONCLUIDA'),
  ('aa700000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-000000000003', 'c7000000-0000-0000-0000-0000000000a3', NULL, 5.00, 'CONCLUIDA');
INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('aa700000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 5),
  ('aa700000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002', 2),
  ('aa700000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 3),
  ('aa700000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000002', 3);

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

CREATE FUNCTION pg_temp.achados(p_codigo text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.fn_auditar_notas('e7000000-0000-0000-0000-000000000001')
  WHERE codigo = p_codigo;
$$;

-- ============================================================================
-- 1. A trilha registra, inclusive o que não passa por RPC
-- ============================================================================
SELECT is(
  (SELECT count(*) FROM public.log_auditoria
    WHERE tabela = 'avaliacoes' AND acao = 'avaliacao_criada'
      AND id_projeto = 'f7000000-0000-0000-0000-000000000001'),
  2::bigint, 'INSERT de avaliação entra na trilha');

UPDATE public.avaliacoes SET nota_final = 5.00 WHERE id_avaliacao = 'aa700000-0000-0000-0000-000000000001';

SELECT is((SELECT acao FROM public.log_auditoria ORDER BY id_log DESC LIMIT 1),
  'nota_alterada', 'UPDATE de nota_final vira ação nota_alterada');
SELECT is((SELECT origem FROM public.log_auditoria ORDER BY id_log DESC LIMIT 1),
  'direto', 'UPDATE fora de RPC fica marcado como direto');
SELECT is((SELECT dados_antes ->> 'nota_final' FROM public.log_auditoria ORDER BY id_log DESC LIMIT 1),
  '4.00', 'a trilha guarda o valor anterior da nota');
SELECT is((SELECT campos_alterados FROM public.log_auditoria ORDER BY id_log DESC LIMIT 1),
  ARRAY['nota_final'], 'a trilha diz qual campo mudou');

-- UPDATE que não muda nada não vira ruído
CREATE TEMP TABLE t27_contagem AS SELECT count(*) AS n FROM public.log_auditoria;
UPDATE public.avaliacoes SET nota_final = 5.00 WHERE id_avaliacao = 'aa700000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*) FROM public.log_auditoria), (SELECT n FROM t27_contagem),
  'UPDATE que não altera valor nenhum não gera linha de log');

-- ============================================================================
-- 2. A trilha é append-only e só o Admin lê
-- ============================================================================
SELECT throws_ok($$ UPDATE public.log_auditoria SET acao = 'mentira' WHERE id_log IS NOT NULL $$,
  '42501', NULL, 'UPDATE na trilha é recusado');
SELECT throws_ok($$ DELETE FROM public.log_auditoria WHERE id_log IS NOT NULL $$,
  '42501', NULL, 'DELETE na trilha é recusado');
SELECT throws_ok($$ TRUNCATE public.log_auditoria $$,
  '42501', NULL, 'TRUNCATE na trilha é recusado');

SELECT pg_temp.como(NULL);
SELECT throws_ok($$ SELECT count(*) FROM public.log_auditoria $$,
  '42501', NULL, 'anon não lê a trilha');
SELECT pg_temp.como('d7000000-0000-0000-0000-000000000051');
SELECT is((SELECT count(*) FROM public.log_auditoria), 0::bigint, 'Staff não lê a trilha');
SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');
SELECT cmp_ok((SELECT count(*) FROM public.log_auditoria), '>', 0::bigint, 'Admin lê a trilha');
RESET role;

-- ============================================================================
-- 3. Conferência de notas
-- ============================================================================
SELECT pg_temp.como('d7000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT * FROM public.fn_auditar_notas(NULL) $$,
  '42501', NULL, 'Staff não roda a conferência de notas');
SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');

-- A nota adulterada acima (4.00 -> 5.00) tem de aparecer por dois caminhos
SELECT is(pg_temp.achados('C1'), 1::bigint, 'C1 acha a nota que não fecha com as respostas');
SELECT is(pg_temp.achados('C10'), 1::bigint, 'C10 acha a escrita de nota fora do fluxo');
SELECT is(
  (SELECT detalhe FROM public.fn_auditar_notas('e7000000-0000-0000-0000-000000000001') WHERE codigo = 'C1'),
  'Σ(nota × peso) = 12.0000 · Σ(pesos) = 3.00 · 12.0000 ÷ 3.00 = 4.00, mas está gravado 5.00',
  'C1 mostra a conta aberta, não só o veredito');

-- Devolvendo a nota correta, a conferência silencia sobre C1
RESET role;
UPDATE public.avaliacoes SET nota_final = 4.00 WHERE id_avaliacao = 'aa700000-0000-0000-0000-000000000001';
SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.achados('C1'), 0::bigint, 'nota corrigida não aparece mais em C1');

-- Avaliação sem respostas e nota fora da escala
RESET role;
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status)
VALUES ('aa700000-0000-0000-0000-000000000004', 'f7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-0000000000a1', 'a7000000-0000-0000-0000-000000000001', 99.00, 'CONCLUIDA');
SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.achados('C2'), 1::bigint, 'C2 acha avaliação ativa sem nenhuma resposta');
SELECT is(pg_temp.achados('C5'), 1::bigint, 'C5 acha nota final fora da escala do questionário');
RESET role;
DELETE FROM public.avaliacoes WHERE id_avaliacao = 'aa700000-0000-0000-0000-000000000004';

-- ============================================================================
-- 4. Memorial de cálculo
-- ============================================================================
SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');
SELECT is(
  (public.fn_memorial_avaliacao('aa700000-0000-0000-0000-000000000001') ->> 'nota_arredondada')::numeric,
  4.00::numeric, 'o memorial refaz a média ponderada (peso 2 e peso 1)');
SELECT is(
  (public.fn_memorial_avaliacao('aa700000-0000-0000-0000-000000000001') ->> 'soma_produtos')::numeric,
  12.00::numeric, 'o memorial mostra a soma dos produtos');
SELECT ok(
  (public.fn_memorial_avaliacao('aa700000-0000-0000-0000-000000000001') ->> 'confere')::boolean,
  'avaliação coerente é marcada como confere');
SELECT is(
  jsonb_array_length(public.fn_memorial_avaliacao('aa700000-0000-0000-0000-000000000001') -> 'criterios'),
  2, 'o memorial lista um item por critério, com o peso');
SELECT is(
  (public.fn_memorial_projeto('f7000000-0000-0000-0000-000000000001') ->> 'media_geral')::numeric,
  3.50::numeric, 'o memorial do projeto traz a média das notas ativas');
SELECT is(
  public.fn_memorial_por_codigo('aud-001') ->> 'codigo_projeto',
  'AUD-001', 'o memorial acha o projeto pelo código, sem precisar de UUID');
SELECT throws_ok($$ SELECT public.fn_memorial_por_codigo('NAO-EXISTE') $$,
  'P0002', NULL, 'código inexistente devolve erro claro');
RESET role;

-- ============================================================================
-- 5. Motivo opcional e origem nas ações do Admin
-- ============================================================================
SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');
SELECT lives_ok($$ SELECT public.excluir_avaliacao('aa700000-0000-0000-0000-000000000002', 'nota fora da curva conferida com o avaliador') $$,
  'excluir_avaliacao aceita motivo');
RESET role;
SELECT is(
  (SELECT motivo FROM public.log_auditoria
    WHERE acao = 'avaliacao_cancelada' ORDER BY id_log DESC LIMIT 1),
  'nota fora da curva conferida com o avaliador', 'o motivo do Admin fica na trilha');
SELECT is(
  (SELECT origem FROM public.log_auditoria
    WHERE acao = 'avaliacao_cancelada' ORDER BY id_log DESC LIMIT 1),
  'excluir_avaliacao', 'a ação pela RPC é identificada na trilha');

SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');
SELECT lives_ok($$ SELECT public.restaurar_avaliacao('aa700000-0000-0000-0000-000000000002') $$,
  'restaurar_avaliacao segue funcionando sem motivo');
RESET role;
SELECT is(
  (SELECT origem FROM public.log_auditoria
    WHERE acao = 'avaliacao_restaurada' ORDER BY id_log DESC LIMIT 1),
  'restaurar_avaliacao', 'a restauração também deixa rastro (antes não deixava nenhum)');

-- ============================================================================
-- 5b. Ações do Staff: credenciamento e check-in, com hora e autor
--     (antes só existia o booleano; não havia coluna de quando nem de quem)
-- ============================================================================
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
VALUES ('c7000000-0000-0000-0000-0000000000a1', 'e7000000-0000-0000-0000-000000000001', true);

SELECT is(
  (SELECT acao FROM public.log_auditoria
    WHERE tabela = 'avaliadores_evento' ORDER BY id_log DESC LIMIT 1),
  'credenciamento_concedido', 'credenciar entra na trilha');
SELECT ok(
  (SELECT criado_em IS NOT NULL FROM public.log_auditoria
    WHERE tabela = 'avaliadores_evento' ORDER BY id_log DESC LIMIT 1),
  'o credenciamento passa a ter hora registrada');

UPDATE public.avaliadores_evento SET is_credenciado = false
WHERE id_usuario = 'c7000000-0000-0000-0000-0000000000a1' AND id_evento = 'e7000000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT acao FROM public.log_auditoria WHERE tabela = 'avaliadores_evento' ORDER BY id_log DESC LIMIT 1),
  'credenciamento_suspenso', 'suspender o credenciamento também entra na trilha');

-- Check-in pela RPC do Staff: a origem fica identificada
-- (o projeto do cenário já entrou com check-in, e UPDATE que não muda nada não gera linha:
--  o Staff desfaz e refaz, que é o que acontece quando o projeto chega depois)
SELECT pg_temp.como('d7000000-0000-0000-0000-000000000051');
SELECT lives_ok(
  $$ SELECT public.fn_check_in_projeto('f7000000-0000-0000-0000-000000000002', false) $$,
  'Staff desfaz o check-in pela RPC');
SELECT lives_ok(
  $$ SELECT public.fn_check_in_projeto('f7000000-0000-0000-0000-000000000002', true) $$,
  'Staff faz check-in pela RPC');
RESET role;
SELECT is(
  (SELECT origem FROM public.log_auditoria WHERE acao = 'check_in_realizado' ORDER BY id_log DESC LIMIT 1),
  'fn_check_in_projeto', 'o check-in se identifica na trilha (não fica como escrita direta)');

-- ============================================================================
-- 6. Nota não desaparece por tabela de cadastro
-- ============================================================================
SELECT throws_ok($$ DELETE FROM public.projetos WHERE id_projeto = 'f7000000-0000-0000-0000-000000000001' $$,
  '23503', NULL, 'apagar projeto com nota é recusado (era CASCADE silencioso)');
SELECT throws_ok($$ DELETE FROM public.usuarios WHERE id_usuario = 'c7000000-0000-0000-0000-0000000000a1' $$,
  '23503', NULL, 'apagar usuário com nota é recusado (era CASCADE silencioso)');

-- ============================================================================
-- 7. Reset global: o evento, e só ele
-- ============================================================================
SELECT pg_temp.como('d7000000-0000-0000-0000-0000000000ad');
SELECT lives_ok($$ SELECT public.admin_reset_global('e7000000-0000-0000-0000-000000000001') $$,
  'reset global do evento roda');
RESET role;
SELECT is(
  (SELECT count(*) FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    WHERE p.id_evento = 'e7000000-0000-0000-0000-000000000002'),
  1::bigint, 'o reset de um evento não toca nas notas do outro');
SELECT cmp_ok((SELECT count(*) FROM public.log_auditoria), '>', 0::bigint,
  'a trilha sobrevive ao reset global');
SELECT is(
  (SELECT (dados_depois ->> 'avaliacoes_apagadas')::int FROM public.log_auditoria
    WHERE acao = 'reset_global' ORDER BY id_log DESC LIMIT 1),
  2, 'o reset registra quantas avaliações apagou, antes de apagar');

SELECT * FROM finish();
ROLLBACK;
