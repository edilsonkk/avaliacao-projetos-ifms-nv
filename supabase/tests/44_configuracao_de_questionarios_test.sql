-- Conferência da CONFIGURAÇÃO de questionários do evento (migration 20261123174858):
-- C15 mais de um questionário técnico, C16 escalas diferentes entre os técnicos,
-- C17 avaliador fixado num questionário técnico.
--
-- A configuração combinada para a feira é um questionário técnico por evento, numa escala
-- só, com vínculo de questionário reservado aos votantes do voto popular. Nada no banco
-- cobrava isso: dois técnicos de escalas diferentes entravam na mesma média e no mesmo
-- ranking sem uma linha de reclamação.
--
-- Três eventos, um por configuração, porque é a configuração do EVENTO que está sob teste:
--   EV1 um técnico + um voto popular, vínculos só de votante  -> nenhum achado
--   EV2 dois técnicos de mesma escala, um avaliador vinculado  -> C15 e C17
--   EV3 dois técnicos de escalas diferentes                    -> C15 e C16
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);

UPDATE public.eventos SET is_ativo = false WHERE is_ativo;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d4400000-0000-0000-0000-0000000000ad', 'admin44@teste.local', false, now()),
  ('d4400000-0000-0000-0000-000000000001', 'ava441@teste.local',  false, now());

INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c4400000-0000-0000-0000-0000000000ad', 'admin44@teste.local', 'Admin 44',     'ADMIN',     'd4400000-0000-0000-0000-0000000000ad'),
  ('c4400000-0000-0000-0000-000000000001', 'ava441@teste.local',  'Ana Primeira', 'AVALIADOR', 'd4400000-0000-0000-0000-000000000001');
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c4400000-0000-0000-0000-000000000002', 'ava442@teste.local', 'Bruno Segundo',  'AVALIADOR'),
  ('c4400000-0000-0000-0000-000000000003', 'ava443@teste.local', 'Carla Terceira', 'AVALIADOR'),
  ('c4400000-0000-0000-0000-000000000004', 'ava444@teste.local', 'Dalia Quarta',   'AVALIADOR');

INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao) VALUES
  ('e4400000-0000-0000-0000-000000000001', 'Evento 44 bem configurado', true,  2),
  ('e4400000-0000-0000-0000-000000000002', 'Evento 44 com dois técnicos', false, 2),
  ('e4400000-0000-0000-0000-000000000003', 'Evento 44 com escalas tortas', false, 2);

INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  -- EV1: a configuração pretendida — um técnico, mais o voto popular na escala dele
  ('74400000-0000-0000-0000-000000000001', 'e4400000-0000-0000-0000-000000000001', 'Técnico da feira',    0, 10, false),
  ('74400000-0000-0000-0000-000000000002', 'e4400000-0000-0000-0000-000000000001', 'Voto popular',        1,  5, true),
  -- EV2: dois técnicos, mesma escala
  ('74400000-0000-0000-0000-000000000003', 'e4400000-0000-0000-0000-000000000002', 'Técnico Ensino Médio', 0, 10, false),
  ('74400000-0000-0000-0000-000000000004', 'e4400000-0000-0000-0000-000000000002', 'Técnico Superior',     0, 10, false),
  -- EV3: dois técnicos, escalas diferentes
  ('74400000-0000-0000-0000-000000000005', 'e4400000-0000-0000-0000-000000000003', 'Técnico de 0 a 10',   0, 10, false),
  ('74400000-0000-0000-0000-000000000006', 'e4400000-0000-0000-0000-000000000003', 'Técnico de 1 a 5',    1,  5, false);

INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('84400000-0000-0000-0000-000000000001', '74400000-0000-0000-0000-000000000001', 1, 'Critério', 1, 1);

-- EV1: uma votante (vínculo de voto popular) e uma avaliadora sem vínculo. Nenhuma das
-- duas pode virar achado: é exatamente a configuração pretendida.
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_questionario) VALUES
  ('c4400000-0000-0000-0000-000000000001', 'e4400000-0000-0000-0000-000000000001', true, '74400000-0000-0000-0000-000000000002'),
  ('c4400000-0000-0000-0000-000000000002', 'e4400000-0000-0000-0000-000000000001', true, NULL);
-- EV2: uma avaliadora fixada num dos técnicos
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_questionario) VALUES
  ('c4400000-0000-0000-0000-000000000003', 'e4400000-0000-0000-0000-000000000002', true, '74400000-0000-0000-0000-000000000004');

-- Vínculo CRUZADO: avaliadora do EV3 apontada para questionário do EV2. A RPC
-- `admin_vincular_questionario_avaliador` recusa isso ("o questionário precisa ser do
-- mesmo evento do avaliador"), mas o banco aceita por SQL direto — e é só com esta linha
-- que os dois filtros de escopo do C17 (o JOIN em `tec` e o `ae.id_evento`) deixam de ser
-- indistinguíveis: sem um deles, um dos dois eventos passa a reportar a Dalia.
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_questionario) VALUES
  ('c4400000-0000-0000-0000-000000000004', 'e4400000-0000-0000-0000-000000000003', true, '74400000-0000-0000-0000-000000000004');

-- Uma avaliação que não fecha no EV1, só para provar que os achados antigos continuam
-- saindo de fn_auditar_notas depois do UNION ALL novo.
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, id_questionario_fixado) VALUES
  ('f4400000-0000-0000-0000-000000000001', 'CFG-001', 'Projeto do EV1', 'e4400000-0000-0000-0000-000000000001', true, '74400000-0000-0000-0000-000000000001');
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('a4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000001', 'c4400000-0000-0000-0000-000000000002', '74400000-0000-0000-0000-000000000001', 9.00, 'CONCLUIDA');
INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('a4400000-0000-0000-0000-000000000001', '84400000-0000-0000-0000-000000000001', 3);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION pg_temp.conf(p_evento uuid, p_codigo text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.fn_auditar_configuracao_questionarios(p_evento) WHERE codigo = p_codigo;
$$;
CREATE FUNCTION pg_temp.campo(p_evento uuid, p_codigo text, p_campo text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SELECT %I FROM public.fn_auditar_configuracao_questionarios(%L) WHERE codigo = %L',
                 p_campo, p_evento, p_codigo) INTO v;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.pelo_painel(p_evento uuid, p_codigo text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.fn_auditar_notas(p_evento) WHERE codigo = p_codigo;
$$;

-- ============================================================================
-- 1. A conferência da configuração é do Admin
-- ============================================================================
SELECT pg_temp.como('d4400000-0000-0000-0000-000000000001');
SELECT throws_ok($$ SELECT * FROM public.fn_auditar_configuracao_questionarios('e4400000-0000-0000-0000-000000000002') $$,
  '42501', NULL, 'avaliadora não lê a conferência de configuração');
RESET role;

SELECT pg_temp.como('d4400000-0000-0000-0000-0000000000ad');

-- ============================================================================
-- 2. A configuração pretendida não gera achado nenhum
-- ============================================================================
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000001', 'C15'), 0::bigint,
  'um questionário técnico só: nenhum achado de C15');
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000001', 'C16'), 0::bigint,
  'com um técnico só não há escala divergente');
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000001', 'C17'), 0::bigint,
  'votante e avaliadora sem vínculo não viram achado');
SELECT is((SELECT count(*) FROM public.fn_auditar_configuracao_questionarios('e4400000-0000-0000-0000-000000000001')),
  0::bigint, 'o evento bem configurado sai limpo da conferência de configuração');

-- ============================================================================
-- 3. Dois questionários técnicos no mesmo evento
-- ============================================================================
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000002', 'C15'), 1::bigint,
  'dois questionários técnicos: C15 acusa uma vez, não uma por questionário');
SELECT is(pg_temp.campo('e4400000-0000-0000-0000-000000000002', 'C15', 'severidade'), 'grave',
  'C15 é grave: a trava do questionário pode impedir a cota de fechar');
SELECT is(pg_temp.campo('e4400000-0000-0000-0000-000000000002', 'C15', 'encontrado'), '2 questionários técnicos',
  'C15 diz quantos técnicos encontrou');
SELECT ok(pg_temp.campo('e4400000-0000-0000-0000-000000000002', 'C15', 'detalhe')
            LIKE '%Técnico Ensino Médio, Técnico Superior%',
  'C15 nomeia os questionários técnicos do evento, em ordem');
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000002', 'C16'), 0::bigint,
  'dois técnicos de mesma escala não acusam C16');

-- ============================================================================
-- 4. Escalas diferentes entre os técnicos
-- ============================================================================
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000003', 'C16'), 1::bigint,
  'técnicos de escalas diferentes: C16 acusa');
SELECT is(pg_temp.campo('e4400000-0000-0000-0000-000000000003', 'C16', 'severidade'), 'grave',
  'C16 é grave: a posição passaria a depender da escala de quem avaliou');
SELECT ok(pg_temp.campo('e4400000-0000-0000-0000-000000000003', 'C16', 'encontrado') LIKE '%0 a 10%'
      AND pg_temp.campo('e4400000-0000-0000-0000-000000000003', 'C16', 'encontrado') LIKE '%1 a 5%',
  'C16 mostra as duas escalas em uso');
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000003', 'C17'), 0::bigint,
  'o vínculo técnico do EV2 não vaza para a conferência do EV3');

-- ============================================================================
-- 5. Avaliador fixado num questionário técnico
-- ============================================================================
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000002', 'C17'), 1::bigint,
  'avaliadora fixada num técnico: C17 acusa');
SELECT is(pg_temp.campo('e4400000-0000-0000-0000-000000000002', 'C17', 'severidade'), 'atencao',
  'C17 é atenção, não grave: o vínculo técnico é configuração legítima');
SELECT ok(pg_temp.campo('e4400000-0000-0000-0000-000000000002', 'C17', 'detalhe') LIKE '%Carla Terceira%'
      AND pg_temp.campo('e4400000-0000-0000-0000-000000000002', 'C17', 'detalhe') LIKE '%Técnico Superior%',
  'C17 nomeia a pessoa e o questionário ao qual ela está presa');
SELECT is(pg_temp.conf('e4400000-0000-0000-0000-000000000002', 'C17'), 1::bigint,
  'a conferência do EV2 não adota a avaliadora do EV3 presa a um questionário do EV2');
SELECT is((SELECT count(*) FROM public.fn_auditar_configuracao_questionarios('e4400000-0000-0000-0000-000000000003')
            WHERE codigo = 'C17' AND detalhe LIKE '%Dalia%'), 0::bigint,
  'nem a do EV3: vínculo cruzado entre eventos não é reportado por nenhum dos dois lados');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.fn_auditar_configuracao_questionarios('e4400000-0000-0000-0000-000000000002')
   WHERE detalhe ~ '[0-9a-f]{8}-[0-9a-f]{4}-' OR encontrado ~ '[0-9a-f]{8}-[0-9a-f]{4}-'
      OR esperado ~ '[0-9a-f]{8}-[0-9a-f]{4}-'),
  'nenhum achado de configuração mostra UUID: a interface lê isso direto');

-- ============================================================================
-- 6. O Painel de Auditoria enxerga os três sem mudança de front-end
-- ============================================================================
SELECT is(pg_temp.pelo_painel('e4400000-0000-0000-0000-000000000002', 'C15'), 1::bigint,
  'fn_auditar_notas agrega C15: o Painel vê sem conhecer o código');
SELECT is(pg_temp.pelo_painel('e4400000-0000-0000-0000-000000000002', 'C17'), 1::bigint,
  'fn_auditar_notas agrega C17');
SELECT is(pg_temp.pelo_painel('e4400000-0000-0000-0000-000000000003', 'C16'), 1::bigint,
  'fn_auditar_notas agrega C16');
SELECT is(pg_temp.pelo_painel('e4400000-0000-0000-0000-000000000001', 'C15'), 0::bigint,
  'o Painel do evento bem configurado não inventa achado de configuração');
-- O UNION ALL novo não substituiu o que já havia: a nota 9.00 não vem da resposta 3.
SELECT is(pg_temp.pelo_painel('e4400000-0000-0000-0000-000000000001', 'C1'), 1::bigint,
  'os achados antigos continuam saindo de fn_auditar_notas depois do UNION novo');
RESET role;

SELECT * FROM finish();
ROLLBACK;
