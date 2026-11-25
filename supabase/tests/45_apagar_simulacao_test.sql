-- `admin_apagar_simulacao` (migration 20261124220000): a limpeza do evento de simulação.
--
-- O que este teste cobra, e por quê:
--   1. as guardas recusam ANTES de escrever (evento inexistente, não-simulação, evento ativo);
--   2. só Admin executa;
--   3. a ordem imposta pelas chaves estrangeiras funciona (avaliações antes do evento, que é
--      ON DELETE RESTRICT), e o evento some com projetos, questionários e catálogos;
--   4. quem tem vínculo ou nota em OUTRO evento é preservado;
--   5. a trilha NÃO registra a limpeza como escrita "direta" — este é o ponto que motivou a
--      função. A cascata pelo cliente gravava `origem = 'direto'` com `id_evento` nulo em
--      `respostas_avaliacao` e `perguntas_questionario`, e a regra C10 de `fn_auditar_notas`
--      inclui `id_evento IS NULL`: o achado grave aparecia em TODOS os eventos, inclusive na
--      feira real, e `log_auditoria` é append-only, então não dava para desfazer.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

UPDATE public.eventos SET is_ativo = false WHERE is_ativo;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d4500000-0000-0000-0000-0000000000ad', 'admin45@teste.local', false, now()),
  ('d4500000-0000-0000-0000-000000000051', 'staff45@teste.local', false, now());

INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c4500000-0000-0000-0000-0000000000ad', 'admin45@teste.local', 'Admin 45', 'ADMIN', 'd4500000-0000-0000-0000-0000000000ad'),
  ('c4500000-0000-0000-0000-000000000051', 'staff45@teste.local', 'Staff 45', 'STAFF', 'd4500000-0000-0000-0000-000000000051');

-- Duas pessoas fictícias da simulação e uma que também participa de outro evento
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c4500000-0000-0000-0000-000000000001', 'avaliador.0001.x@simulacao.invalid', 'Fictício Um',  'AVALIADOR'),
  ('c4500000-0000-0000-0000-000000000002', 'avaliador.0002.x@simulacao.invalid', 'Fictício Dois', 'AVALIADOR'),
  ('c4500000-0000-0000-0000-000000000003', 'avaliador.0003.x@simulacao.invalid', 'Fictício Três', 'AVALIADOR');

-- Evento de simulação (inativo) e um evento real, que não pode ser tocado
INSERT INTO public.eventos (id_evento, nome_evento, data_evento, horario_inicio, horario_fim, is_ativo, sistema_liberado, cota_avaliacoes_padrao) VALUES
  ('e4500000-0000-0000-0000-000000000001', 'Simulação de Carga 2026-11-24 10:00:00', CURRENT_DATE, '00:00:00', '23:59:59', false, true, 3),
  ('e4500000-0000-0000-0000-000000000002', 'FETEC-MS 2026',                          CURRENT_DATE, '08:00:00', '18:00:00', false, true, 3);

INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado) VALUES
  ('14500000-0000-0000-0000-000000000001', 'e4500000-0000-0000-0000-000000000001', 'IFMS — Campus Teste', 'IFMS CAMPUS TESTE');
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima) VALUES
  ('94500000-0000-0000-0000-000000000001', 'e4500000-0000-0000-0000-000000000001', 'Técnica — Simulação', 0, 10);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, texto_pergunta, peso_calculo, ordem) VALUES
  ('74500000-0000-0000-0000-000000000001', '94500000-0000-0000-0000-000000000001', 'Critério um', 1, 1);
INSERT INTO public.projetos (id_projeto, id_evento, codigo_projeto, titulo, is_check_in_realizado) VALUES
  ('f4500000-0000-0000-0000-000000000001', 'e4500000-0000-0000-0000-000000000001', 'SIM-0001', 'Projeto fictício', true);
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('a4500000-0000-0000-0000-000000000001', 'f4500000-0000-0000-0000-000000000001', 'c4500000-0000-0000-0000-000000000001', '94500000-0000-0000-0000-000000000001', 8.0, 'CONCLUIDA');
INSERT INTO public.respostas_avaliacao (id_resposta, id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('b4500000-0000-0000-0000-000000000001', 'a4500000-0000-0000-0000-000000000001', '74500000-0000-0000-0000-000000000001', 8.0);

INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c4500000-0000-0000-0000-000000000001', 'e4500000-0000-0000-0000-000000000001', true),
  ('c4500000-0000-0000-0000-000000000002', 'e4500000-0000-0000-0000-000000000001', true),
  ('c4500000-0000-0000-0000-000000000003', 'e4500000-0000-0000-0000-000000000001', true),
  -- também inscrito na feira real: não pode ser apagado junto
  ('c4500000-0000-0000-0000-000000000003', 'e4500000-0000-0000-0000-000000000002', true);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

-- ============================================================================
-- 1. Permissão
-- ============================================================================
SELECT pg_temp.como('d4500000-0000-0000-0000-000000000051');
SELECT throws_ok(
  $$ SELECT public.admin_apagar_simulacao('e4500000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'Staff não apaga simulação');

SELECT pg_temp.como('d4500000-0000-0000-0000-0000000000ad');

-- ============================================================================
-- 2. Guardas: recusam antes de escrever
-- ============================================================================
SELECT throws_ok(
  $$ SELECT public.admin_apagar_simulacao('e4500000-0000-0000-0000-0000000000ff') $$,
  'P0002', NULL, 'evento inexistente é recusado');

SELECT throws_ok(
  $$ SELECT public.admin_apagar_simulacao('e4500000-0000-0000-0000-000000000002') $$,
  '22023', NULL, 'evento que não é simulação é recusado');

UPDATE public.eventos SET is_ativo = true WHERE id_evento = 'e4500000-0000-0000-0000-000000000001';
SELECT throws_ok(
  $$ SELECT public.admin_apagar_simulacao('e4500000-0000-0000-0000-000000000001') $$,
  '22023', NULL, 'simulação ativa é recusada: apagá-la deixaria o banco sem evento');
SELECT is((SELECT count(*) FROM public.avaliacoes WHERE id_avaliacao = 'a4500000-0000-0000-0000-000000000001'),
  1::bigint, 'recusa não apagou nada');
UPDATE public.eventos SET is_ativo = false WHERE id_evento = 'e4500000-0000-0000-0000-000000000001';

-- ============================================================================
-- 3. A limpeza em si
-- ============================================================================
CREATE TEMP TABLE resultado AS
SELECT public.admin_apagar_simulacao('e4500000-0000-0000-0000-000000000001') AS r;

SELECT is((SELECT (r->>'avaliacoes_apagadas')::int FROM resultado), 1, 'conta a avaliação apagada');
SELECT is((SELECT (r->>'usuarios_apagados')::int FROM resultado), 2, 'apaga só quem era exclusivo da simulação');
SELECT is((SELECT (r->>'usuarios_preservados')::int FROM resultado), 1, 'preserva quem está em outro evento');

SELECT is((SELECT count(*) FROM public.eventos WHERE id_evento = 'e4500000-0000-0000-0000-000000000001'),
  0::bigint, 'o evento de simulação sumiu');
SELECT is((SELECT count(*) FROM public.projetos WHERE id_evento = 'e4500000-0000-0000-0000-000000000001'),
  0::bigint, 'os projetos sumiram por cascata');
SELECT is((SELECT count(*) FROM public.respostas_avaliacao WHERE id_resposta = 'b4500000-0000-0000-0000-000000000001'),
  0::bigint, 'as respostas sumiram com a avaliação');
SELECT is((SELECT count(*) FROM public.usuarios WHERE id_usuario = 'c4500000-0000-0000-0000-000000000003'),
  1::bigint, 'o avaliador da feira real continua lá');

-- ============================================================================
-- 4. O ponto da função: a trilha não acusa escrita fora do fluxo
-- ============================================================================
SELECT is(
  (SELECT count(*) FROM public.log_auditoria
    WHERE origem = 'direto'
      AND tabela IN ('avaliacoes', 'respostas_avaliacao', 'perguntas_questionario')
      AND operacao IN ('UPDATE', 'DELETE')
      AND criado_em >= now() - interval '1 minute'),
  0::bigint,
  'a limpeza não deixa registro "direto": sem ela, a conferência acusaria C10 grave em todo evento');

SELECT * FROM finish();
ROLLBACK;
