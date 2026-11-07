-- Ajuste manual do Admin (migration 20261106050000): corrigir critérios, lançar
-- avaliação, arbitrar nota e ajustar média — tudo validado e marcado na trilha.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(34);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d8000000-0000-0000-0000-0000000000ad', 'admin28@teste.local', false, now()),
  ('d8000000-0000-0000-0000-000000000051', 'staff28@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c8000000-0000-0000-0000-0000000000ad', 'admin28@teste.local', 'Admin 28', 'ADMIN', 'd8000000-0000-0000-0000-0000000000ad'),
  ('c8000000-0000-0000-0000-000000000051', 'staff28@teste.local', 'Staff 28', 'STAFF', 'd8000000-0000-0000-0000-000000000051'),
  ('c8000000-0000-0000-0000-0000000000a1', 'ava281@teste.local', 'Ana 28', 'AVALIADOR', NULL),
  ('c8000000-0000-0000-0000-0000000000a2', 'ava282@teste.local', 'Bruno 28', 'AVALIADOR', NULL),
  ('c8000000-0000-0000-0000-0000000000a3', 'ava283@teste.local', 'Carla 28 (outro evento)', 'AVALIADOR', NULL);
UPDATE public.eventos SET is_ativo = false;
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao) VALUES
  ('e8000000-0000-0000-0000-000000000001', 'Feira do Ajuste', true, 3),
  ('e8000000-0000-0000-0000-000000000002', 'Outra Feira', false, 3);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c8000000-0000-0000-0000-0000000000a1', 'e8000000-0000-0000-0000-000000000001', true),
  ('c8000000-0000-0000-0000-0000000000a2', 'e8000000-0000-0000-0000-000000000001', true),
  ('c8000000-0000-0000-0000-0000000000a3', 'e8000000-0000-0000-0000-000000000002', true);
INSERT INTO public.modalidades (id_modalidade, nome_modalidade, id_evento) VALUES
  ('aa800000-0000-0000-0000-000000000001', 'Tecnológico', 'e8000000-0000-0000-0000-000000000001');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade, is_check_in_realizado, cota_avaliacoes_customizada) VALUES
  ('f8000000-0000-0000-0000-000000000001', 'AJU-001', 'Projeto do Ajuste', 'e8000000-0000-0000-0000-000000000001', 'aa800000-0000-0000-0000-000000000001', true, 2),
  ('f8000000-0000-0000-0000-000000000002', 'AJU-002', 'Projeto Rival',     'e8000000-0000-0000-0000-000000000001', 'aa800000-0000-0000-0000-000000000001', true, 2);
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima) VALUES
  ('b8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001', 'Quest do Ajuste', 1, 5);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('c8800000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 1, 'Critério peso 2', 2, 1),
  ('c8800000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001', 2, 'Critério peso 1', 1, 2);
UPDATE public.projetos SET id_questionario_fixado = 'b8000000-0000-0000-0000-000000000001'
WHERE id_evento = 'e8000000-0000-0000-0000-000000000001';

-- AJU-001 com uma avaliação coerente: (5×2 + 2×1)/3 = 4.00
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('ab800000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-0000000000a1', 'b8000000-0000-0000-0000-000000000001', 4.00, 'CONCLUIDA');
INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('ab800000-0000-0000-0000-000000000001', 'c8800000-0000-0000-0000-000000000001', 5),
  ('ab800000-0000-0000-0000-000000000001', 'c8800000-0000-0000-0000-000000000002', 2);
-- AJU-002 com média 3.00, para disputar o pódio com AJU-001
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('ab800000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-0000000000a1', 'b8000000-0000-0000-0000-000000000001', 3.00, 'CONCLUIDA');
INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('ab800000-0000-0000-0000-000000000002', 'c8800000-0000-0000-0000-000000000001', 3),
  ('ab800000-0000-0000-0000-000000000002', 'c8800000-0000-0000-0000-000000000002', 3);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.respostas(p_n1 numeric, p_n2 numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id_pergunta', 'c8800000-0000-0000-0000-000000000001', 'nota', p_n1),
    jsonb_build_object('id_pergunta', 'c8800000-0000-0000-0000-000000000002', 'nota', p_n2));
$$;
CREATE FUNCTION pg_temp.achados(p_codigo text, p_sev text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.fn_auditar_notas('e8000000-0000-0000-0000-000000000001')
  WHERE codigo = p_codigo AND severidade = p_sev;
$$;

-- ============================================================================
-- 1. Nenhuma das quatro ações é de quem não é Admin
-- ============================================================================
SELECT pg_temp.como('d8000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('ab800000-0000-0000-0000-000000000001', '[]'::jsonb) $$,
  '42501', NULL, 'Staff não corrige notas por critério');
SELECT throws_ok($$ SELECT public.admin_arbitrar_nota_final('ab800000-0000-0000-0000-000000000001', 5) $$,
  '42501', NULL, 'Staff não arbitra nota final');
SELECT throws_ok($$ SELECT public.admin_ajustar_media_projeto('f8000000-0000-0000-0000-000000000001', 1) $$,
  '42501', NULL, 'Staff não ajusta média de projeto');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f8000000-0000-0000-0000-000000000001',
  'c8000000-0000-0000-0000-0000000000a2', 'b8000000-0000-0000-0000-000000000001', '[]'::jsonb) $$,
  '42501', NULL, 'Staff não lança avaliação');
RESET role;

-- ============================================================================
-- 2. Corrigir as notas por critério: a conta continua fechando
-- ============================================================================
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('ab800000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('id_pergunta', 'c8800000-0000-0000-0000-000000000001', 'nota', 4))) $$,
  '22023', NULL, 'corrigir recusa conjunto incompleto de respostas');
SELECT throws_ok($$ SELECT public.admin_corrigir_respostas_avaliacao('ab800000-0000-0000-0000-000000000001',
  pg_temp.respostas(9, 2)) $$,
  '22023', NULL, 'corrigir recusa nota fora da escala');

-- (4×2 + 1×1) / 3 = 3.00
SELECT is(
  (public.admin_corrigir_respostas_avaliacao('ab800000-0000-0000-0000-000000000001',
     pg_temp.respostas(4, 1), 'erro de digitação conferido com a avaliadora') ->> 'nota_nova')::numeric,
  3.00::numeric, 'corrigir recalcula a nota final pela fórmula oficial');
RESET role;
SELECT is((SELECT nota_final FROM public.avaliacoes WHERE id_avaliacao = 'ab800000-0000-0000-0000-000000000001'),
  3.00::numeric, 'a nota corrigida fica gravada');
SELECT is((SELECT ajuste_tipo FROM public.avaliacoes WHERE id_avaliacao = 'ab800000-0000-0000-0000-000000000001'),
  'respostas_corrigidas', 'a avaliação fica marcada como corrigida');
SELECT is((SELECT ajuste_motivo FROM public.avaliacoes WHERE id_avaliacao = 'ab800000-0000-0000-0000-000000000001'),
  'erro de digitação conferido com a avaliadora', 'o motivo fica no registro');
SELECT is(
  (SELECT origem FROM public.log_auditoria WHERE acao = 'nota_alterada' ORDER BY id_log DESC LIMIT 1),
  'admin_corrigir_respostas_avaliacao', 'a correção se identifica na trilha');
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.achados('C1', 'grave'), 0::bigint, 'depois de corrigir, a conferência não acusa nada de grave');
SELECT is(pg_temp.achados('C12', 'informativo'), 1::bigint, 'o ajuste entra na lista informativa C12');
RESET role;

-- ============================================================================
-- 3. Arbitrar a nota final: a conta deixa de fechar, mas de forma declarada
-- ============================================================================
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_arbitrar_nota_final('ab800000-0000-0000-0000-000000000001', 9) $$,
  '22023', NULL, 'arbitrar recusa nota fora da escala do questionário');
SELECT is(
  (public.admin_arbitrar_nota_final('ab800000-0000-0000-0000-000000000001', 4.5, 'decisão da comissão de recurso') ->> 'nota_nova')::numeric,
  4.50::numeric, 'arbitrar grava a nota informada');
SELECT is(pg_temp.achados('C1', 'grave'), 0::bigint, 'nota arbitrada não é acusada como adulteração');
SELECT is(pg_temp.achados('C1', 'informativo'), 1::bigint, 'nota arbitrada aparece como achado informativo');
SELECT alike(
  (SELECT detalhe FROM public.fn_auditar_notas('e8000000-0000-0000-0000-000000000001')
    WHERE codigo = 'C1' LIMIT 1),
  '%decisão da comissão de recurso%', 'o motivo da arbitragem aparece na conferência');
SELECT ok(
  (public.fn_memorial_avaliacao('ab800000-0000-0000-0000-000000000001') -> 'ajuste' ->> 'tipo') = 'nota_arbitrada',
  'o memorial mostra que a nota foi arbitrada');
RESET role;

-- ============================================================================
-- 4. Lançar avaliação em nome de um avaliador identificado
-- ============================================================================
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f8000000-0000-0000-0000-000000000001',
  'c8000000-0000-0000-0000-0000000000a3', 'b8000000-0000-0000-0000-000000000001', pg_temp.respostas(5, 5)) $$,
  '22023', NULL, 'lançar recusa avaliador de outro evento');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f8000000-0000-0000-0000-000000000001',
  'c8000000-0000-0000-0000-0000000000a1', 'b8000000-0000-0000-0000-000000000001', pg_temp.respostas(5, 5)) $$,
  '22023', NULL, 'lançar recusa quem já avaliou o projeto');

-- (5×2 + 5×1)/3 = 5.00; a cota do projeto é 2 e já tem 1 ativa, então ainda cabe
SELECT is(
  (public.admin_lancar_avaliacao('f8000000-0000-0000-0000-000000000001',
     'c8000000-0000-0000-0000-0000000000a2', 'b8000000-0000-0000-0000-000000000001',
     pg_temp.respostas(5, 5), 'ficha em papel do avaliador', 'celular sem acesso no dia') ->> 'nota_final')::numeric,
  5.00::numeric, 'lançar calcula a nota pela fórmula oficial');
RESET role;
SELECT is((SELECT count(*) FROM public.avaliacoes
            WHERE id_projeto = 'f8000000-0000-0000-0000-000000000001'
              AND (status IS NULL OR status <> 'CANCELADA')),
  2::bigint, 'a avaliação lançada entra no projeto');
SELECT is((SELECT ajuste_tipo FROM public.avaliacoes
            WHERE id_projeto = 'f8000000-0000-0000-0000-000000000001'
              AND id_usuario = 'c8000000-0000-0000-0000-0000000000a2'),
  'lancada_pelo_admin', 'a avaliação lançada fica marcada');

-- A cota (2) está cheia: a terceira só passa com confirmação explícita
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c8000000-0000-0000-0000-0000000000a4', 'ava284@teste.local', 'Davi 28', 'AVALIADOR');
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c8000000-0000-0000-0000-0000000000a4', 'e8000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_lancar_avaliacao('f8000000-0000-0000-0000-000000000001',
  'c8000000-0000-0000-0000-0000000000a4', 'b8000000-0000-0000-0000-000000000001', pg_temp.respostas(2, 2)) $$,
  '22023', NULL, 'lançar acima da cota é recusado sem confirmação');
SELECT ok(
  (public.admin_lancar_avaliacao('f8000000-0000-0000-0000-000000000001',
     'c8000000-0000-0000-0000-0000000000a4', 'b8000000-0000-0000-0000-000000000001',
     pg_temp.respostas(2, 2), NULL, 'banca extra autorizada', true) -> 'acima_da_cota')::text::boolean,
  'com confirmação, lançar acima da cota passa e fica marcado como tal');
RESET role;

-- ============================================================================
-- 5. Ajuste de média do projeto: entra no pódio com a conta aberta
-- ============================================================================
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_ajustar_media_projeto('f8000000-0000-0000-0000-000000000002', 9) $$,
  '22023', NULL, 'ajuste maior que a amplitude da escala é recusado');
SELECT lives_ok($$ SELECT public.admin_ajustar_media_projeto('f8000000-0000-0000-0000-000000000002', 1.5, 'prêmio de inovação da comissão') $$,
  'ajuste dentro da amplitude é aceito');
RESET role;
SELECT is((SELECT media_final FROM public.view_ranking_top3 WHERE codigo_projeto = 'AJU-002'),
  4.50::numeric, 'a média final do ranking soma o ajuste (3.00 + 1.50)');
SELECT is((SELECT media_geral FROM public.view_ranking_top3 WHERE codigo_projeto = 'AJU-002'),
  3.00::numeric, 'a média das notas continua visível, sem o ajuste');
SELECT is((SELECT media_final FROM public.fn_relatorio_projetos_completo('e8000000-0000-0000-0000-000000000001')
            WHERE codigo_projeto = 'AJU-002'),
  4.50::numeric, 'o relatório de projetos mostra a mesma média final do ranking');
SELECT pg_temp.como('d8000000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.achados('C9', 'grave'), 0::bigint, 'ranking e relatório continuam de acordo depois do ajuste');
SELECT lives_ok($$ SELECT public.admin_ajustar_media_projeto('f8000000-0000-0000-0000-000000000002', 0) $$,
  'ajuste zero remove o ajuste');
RESET role;
SELECT is((SELECT ajuste_media_motivo FROM public.projetos WHERE codigo_projeto = 'AJU-002'),
  NULL, 'remover o ajuste limpa o motivo e o autor');

SELECT * FROM finish();
ROLLBACK;
