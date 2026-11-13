-- Voto popular: pista separada da nota técnica (migrations 20261111040000 a 070000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(28);

-- Cenário: evento ativo com janela aberta e COTA 1 (para a cota técnica encher com uma nota só).
-- Qt = questionário técnico, Qp = questionário de voto popular (marca is_voto_popular).
-- P1 e P2 com check-in. Ana e Bruno avaliam; Vera, Vitor e Val são votantes (vinculados ao Qp).
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3100000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d3100000-0000-0000-0000-0000000000a2', NULL, true, NULL),
  ('d3100000-0000-0000-0000-0000000000e1', NULL, true, NULL),
  ('d3100000-0000-0000-0000-0000000000e2', NULL, true, NULL),
  ('d3100000-0000-0000-0000-0000000000e3', NULL, true, NULL),
  ('d3100000-0000-0000-0000-0000000000ad', 'admin31@teste.local', false, now());
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, sistema_liberado, data_evento, horario_inicio, horario_fim) VALUES
  ('e3100000-0000-0000-0000-000000000001', 'Feira Trinta e Um', true, 1, true, (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('a3100000-0000-0000-0000-0000000000aa', 'e3100000-0000-0000-0000-000000000001', 'Qt técnico', 1, 10, false),
  ('a3100000-0000-0000-0000-0000000000bb', 'e3100000-0000-0000-0000-000000000001', 'Qp voto popular', 1, 10, true);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta) VALUES
  ('b3100000-0000-0000-0000-0000000000cc', 'a3100000-0000-0000-0000-0000000000aa', 1, 'Critério técnico'),
  ('b3100000-0000-0000-0000-0000000000dd', 'a3100000-0000-0000-0000-0000000000bb', 1, 'Gostei do projeto');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao) VALUES
  ('f3100000-0000-0000-0000-000000000001', 'VP-1', 'Projeto Um', 'e3100000-0000-0000-0000-000000000001', true, false),
  ('f3100000-0000-0000-0000-000000000002', 'VP-2', 'Projeto Dois', 'e3100000-0000-0000-0000-000000000001', true, false);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c3100000-0000-0000-0000-0000000000a1', 'ana31@teste.local', 'Ana', 'AVALIADOR', NULL),
  ('c3100000-0000-0000-0000-0000000000a2', 'bruno31@teste.local', 'Bruno', 'AVALIADOR', NULL),
  ('c3100000-0000-0000-0000-0000000000e1', 'vera31@teste.local', 'Vera', 'AVALIADOR', NULL),
  ('c3100000-0000-0000-0000-0000000000e2', 'vitor31@teste.local', 'Vitor', 'AVALIADOR', NULL),
  ('c3100000-0000-0000-0000-0000000000e3', 'val31@teste.local', 'Val', 'AVALIADOR', NULL),
  ('c3100000-0000-0000-0000-0000000000ad', 'admin31@teste.local', 'Admin', 'ADMIN', 'd3100000-0000-0000-0000-0000000000ad');
-- Os três votantes ficam vinculados ao questionário de voto popular
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_questionario) VALUES
  ('c3100000-0000-0000-0000-0000000000a1', 'e3100000-0000-0000-0000-000000000001', true, NULL),
  ('c3100000-0000-0000-0000-0000000000a2', 'e3100000-0000-0000-0000-000000000001', true, NULL),
  ('c3100000-0000-0000-0000-0000000000e1', 'e3100000-0000-0000-0000-000000000001', true, 'a3100000-0000-0000-0000-0000000000bb'),
  ('c3100000-0000-0000-0000-0000000000e2', 'e3100000-0000-0000-0000-000000000001', true, 'a3100000-0000-0000-0000-0000000000bb'),
  ('c3100000-0000-0000-0000-0000000000e3', 'e3100000-0000-0000-0000-000000000001', true, 'a3100000-0000-0000-0000-0000000000bb');
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d3100000-0000-0000-0000-0000000000a1', 'c3100000-0000-0000-0000-0000000000a1', 'e3100000-0000-0000-0000-000000000001', 'codigo'),
  ('d3100000-0000-0000-0000-0000000000a2', 'c3100000-0000-0000-0000-0000000000a2', 'e3100000-0000-0000-0000-000000000001', 'codigo'),
  ('d3100000-0000-0000-0000-0000000000e1', 'c3100000-0000-0000-0000-0000000000e1', 'e3100000-0000-0000-0000-000000000001', 'codigo'),
  ('d3100000-0000-0000-0000-0000000000e2', 'c3100000-0000-0000-0000-0000000000e2', 'e3100000-0000-0000-0000-000000000001', 'codigo'),
  ('d3100000-0000-0000-0000-0000000000e3', 'c3100000-0000-0000-0000-0000000000e3', 'e3100000-0000-0000-0000-000000000001', 'codigo');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION pg_temp.travar(p_usuario text, p_projeto text, p_votante boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em, is_voto_popular)
  VALUES (p_usuario::uuid, p_projeto::uuid, now() + interval '30 minutes', p_votante);
$$;

CREATE FUNCTION pg_temp.enviar(p_usuario text, p_projeto text, p_quest text, p_pergunta text, p_nota numeric) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.fn_enviar_avaliacao(p_usuario::uuid, p_projeto::uuid, p_quest::uuid,
    jsonb_build_array(jsonb_build_object('id_pergunta', p_pergunta, 'nota', p_nota)), 'ok', NULL);
$$;

-- ---------------------------------------------------------------------------
-- A marca classifica a nota, e a trigger a congela na avaliação
-- ---------------------------------------------------------------------------
SELECT pg_temp.travar('c3100000-0000-0000-0000-0000000000a1', 'f3100000-0000-0000-0000-000000000001');
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000a1');
SELECT is(pg_temp.enviar('c3100000-0000-0000-0000-0000000000a1', 'f3100000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-0000000000aa', 'b3100000-0000-0000-0000-0000000000cc', 8)->>'sucesso', 'true',
  'Nota técnica é aceita e enche a cota 1 do projeto');

RESET role;
SELECT is((SELECT is_voto_popular FROM public.avaliacoes WHERE id_projeto = 'f3100000-0000-0000-0000-000000000001'), false,
  'Nota pelo questionário técnico nasce classificada como técnica');
SELECT is((SELECT id_questionario_fixado FROM public.projetos WHERE id_projeto = 'f3100000-0000-0000-0000-000000000001'),
  'a3100000-0000-0000-0000-0000000000aa'::uuid, 'A nota técnica fixou o questionário do projeto');

-- ---------------------------------------------------------------------------
-- Sorteio: o votante ignora a cota técnica cheia
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000e1');
SELECT isnt(public.sortear_proximo_projeto('c3100000-0000-0000-0000-0000000000e1', 'e3100000-0000-0000-0000-000000000001'),
  NULL, 'Votante recebe projeto mesmo com a cota técnica cheia');

RESET role;
SELECT is((SELECT is_voto_popular FROM public.locks_ativos WHERE id_usuario = 'c3100000-0000-0000-0000-0000000000e1'),
  true, 'A trava do votante nasce marcada como voto popular');

-- O avaliador técnico não é impedido pela trava do votante
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000a2');
SELECT is(public.sortear_proximo_projeto('c3100000-0000-0000-0000-0000000000a2', 'e3100000-0000-0000-0000-000000000001'),
  'f3100000-0000-0000-0000-000000000002'::uuid,
  'Avaliador técnico recebe o projeto livre, ainda que um votante esteja nele');

-- ---------------------------------------------------------------------------
-- Envio do voto: não bate na trava do questionário nem na cota
-- ---------------------------------------------------------------------------
RESET role;
DELETE FROM public.locks_ativos;
SELECT pg_temp.travar('c3100000-0000-0000-0000-0000000000e1', 'f3100000-0000-0000-0000-000000000001', true);
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000e1');
SELECT is(pg_temp.enviar('c3100000-0000-0000-0000-0000000000e1', 'f3100000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-0000000000bb', 'b3100000-0000-0000-0000-0000000000dd', 10)->>'sucesso', 'true',
  'Voto popular é aceito em projeto com cota cheia e questionário já fixado');

-- Votante não pode usar o questionário técnico
RESET role;
SELECT pg_temp.travar('c3100000-0000-0000-0000-0000000000e2', 'f3100000-0000-0000-0000-000000000001', true);
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000e2');
SELECT throws_ok($$ SELECT pg_temp.enviar('c3100000-0000-0000-0000-0000000000e2', 'f3100000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-0000000000aa', 'b3100000-0000-0000-0000-0000000000cc', 1) $$,
  '42501', NULL, 'Avaliador vinculado não envia outro questionário');

-- ---------------------------------------------------------------------------
-- O voto não entra na média técnica, na quarentena nem no ranking
-- ---------------------------------------------------------------------------
RESET role;
SELECT is((SELECT media_geral FROM public.fn_relatorio_projetos_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-1'), 8.00,
  'A média do relatório é só da nota técnica (o voto 10 não entra)');
SELECT is((SELECT total_avaliacoes FROM public.fn_relatorio_projetos_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-1'), 1,
  'A contagem de avaliações do relatório é só da nota técnica');
SELECT is((SELECT total_votos_populares FROM public.fn_relatorio_projetos_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-1'), 1,
  'O relatório traz o voto popular em coluna própria');
SELECT is((SELECT media_geral FROM public.view_ranking_top3 WHERE codigo_projeto = 'VP-1'), 8.00,
  'O ranking técnico ignora o voto popular');
SELECT is((SELECT count(*)::int FROM public.view_projetos_quarentena WHERE id_projeto = 'f3100000-0000-0000-0000-000000000001'),
  0, 'Divergência de 8 para 10 entre nota técnica e voto popular não gera quarentena');
SELECT is((SELECT public.fn_vagas_projeto('f3100000-0000-0000-0000-000000000001')), 0,
  'O voto popular não consome vaga: a cota segue decidida pela nota técnica');

-- Telão: só contadores agregados, sem nota nem nome
SELECT is(public.fn_telao_resumo('e3100000-0000-0000-0000-000000000001')->>'votos_populares', '1',
  'O Telão conta os votos populares');
SELECT is(public.fn_telao_resumo('e3100000-0000-0000-0000-000000000001')->>'avaliacoes_realizadas', '1',
  'As avaliações realizadas do Telão são só as técnicas');
SELECT ok(NOT (public.fn_telao_resumo('e3100000-0000-0000-0000-000000000001')::text ~* 'nota|media|titulo|email'),
  'O Telão segue sem nota, média, título ou e-mail');

-- ---------------------------------------------------------------------------
-- Média bayesiana: o voto isolado é puxado para a âncora do evento
-- ---------------------------------------------------------------------------
-- VP-2 recebe três votos 9 (Vera, Vitor e Val); VP-1 tem um voto 10
RESET role;
DELETE FROM public.locks_ativos;
SELECT pg_temp.travar('c3100000-0000-0000-0000-0000000000e1', 'f3100000-0000-0000-0000-000000000002', true);
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000e1');
SELECT pg_temp.enviar('c3100000-0000-0000-0000-0000000000e1', 'f3100000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-0000000000bb', 'b3100000-0000-0000-0000-0000000000dd', 9);
RESET role;
SELECT pg_temp.travar('c3100000-0000-0000-0000-0000000000e2', 'f3100000-0000-0000-0000-000000000002', true);
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000e2');
SELECT pg_temp.enviar('c3100000-0000-0000-0000-0000000000e2', 'f3100000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-0000000000bb', 'b3100000-0000-0000-0000-0000000000dd', 9);
RESET role;
SELECT pg_temp.travar('c3100000-0000-0000-0000-0000000000e3', 'f3100000-0000-0000-0000-000000000002', true);
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000e3');
SELECT pg_temp.enviar('c3100000-0000-0000-0000-0000000000e3', 'f3100000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-0000000000bb', 'b3100000-0000-0000-0000-0000000000dd', 9);

RESET role;
SELECT is((SELECT total_votos FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-2'), 3, 'Três votos contados em VP-2');
SELECT is((SELECT media_simples FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-2'), 9.00, 'Média simples dos votos de VP-2');
-- C = (10 + 9 + 9 + 9) / 4 = 9,25 e m = 4 votos / 2 projetos votados = 2
SELECT is((SELECT media_evento FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-1'), 9.2500, 'Âncora C = média de todos os votos do evento');
SELECT is((SELECT peso_ancora FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-1'), 2.0000, 'Peso m = votos por projeto votado (automático)');
-- (1/3)*10 + (2/3)*9,25 = 9,50: o voto isolado perde força em direção à âncora
SELECT is((SELECT media_bayesiana FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-1'), 9.50,
  'Um voto 10 vira 9,50 na bayesiana: puxado para a âncora do evento');
-- (3/5)*9 + (2/5)*9,25 = 9,10: com mais votos, a nota fica perto da média real
SELECT is((SELECT media_bayesiana FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000001')
           WHERE codigo_projeto = 'VP-2'), 9.10,
  'Com três votos, a bayesiana fica perto da média simples');
SELECT ok(
  (SELECT abs(media_bayesiana - media_simples) FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000001') WHERE codigo_projeto = 'VP-2')
  < (SELECT abs(media_bayesiana - media_simples) FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000001') WHERE codigo_projeto = 'VP-1'),
  'Quanto mais votos, menos a bayesiana se afasta da média simples');

-- Evento sem voto nenhum: nada a ranquear, sem divisão por zero
SELECT is((SELECT count(*)::int FROM public.fn_relatorio_voto_popular_completo('e3100000-0000-0000-0000-000000000009')),
  0, 'Evento sem voto popular devolve vazio');

-- ---------------------------------------------------------------------------
-- A marca não muda depois de usada, e a conferência não acusa o voto popular
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d3100000-0000-0000-0000-0000000000ad');
SELECT throws_ok($$ SELECT public.admin_marcar_questionario_voto_popular('a3100000-0000-0000-0000-0000000000bb', false) $$,
  '42501', NULL, 'Questionário já usado não troca de marca (reclassificaria notas lançadas)');

SELECT is((SELECT count(*)::int FROM public.fn_auditar_notas('e3100000-0000-0000-0000-000000000001')
           WHERE codigo IN ('C6', 'C8', 'C3', 'C4', 'C5')), 0,
  'A conferência não acusa cota, questionário fixado nem escala por causa do voto popular');
SELECT is((SELECT count(*)::int FROM public.fn_auditar_voto_popular('e3100000-0000-0000-0000-000000000001')), 0,
  'Sem achados próprios do voto popular: classificação e vínculos coerentes');

SELECT * FROM finish();
ROLLBACK;
