-- Ajustes da revisão do voto popular (migration 20261114010000):
-- questionário fixado sempre técnico, contagem de avaliador sem votante,
-- views legadas sem voto popular e cópia de questionário com a marca.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

-- Cenário: evento com cota 1, Qt técnico e Qp de voto popular. Téo é avaliador
-- técnico (sem vínculo) e Val é votante (vinculada ao Qp). Os dois credenciados.
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3300000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d3300000-0000-0000-0000-0000000000e1', NULL, true, NULL),
  ('d3300000-0000-0000-0000-0000000000ad', 'admin33@teste.local', false, now());
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, sistema_liberado, data_evento, horario_inicio, horario_fim) VALUES
  ('e3300000-0000-0000-0000-000000000001', 'Feira Trinta e Três', true, 1, true, (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59'),
  ('e3300000-0000-0000-0000-000000000002', 'Feira Destino da Cópia', false, 3, false, (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('a3300000-0000-0000-0000-0000000000aa', 'e3300000-0000-0000-0000-000000000001', 'Qt técnico 33', 1, 10, false),
  ('a3300000-0000-0000-0000-0000000000bb', 'e3300000-0000-0000-0000-000000000001', 'Qp voto popular 33', 1, 10, true);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta) VALUES
  ('b3300000-0000-0000-0000-0000000000cc', 'a3300000-0000-0000-0000-0000000000aa', 1, 'Critério técnico'),
  ('b3300000-0000-0000-0000-0000000000dd', 'a3300000-0000-0000-0000-0000000000bb', 1, 'Gostei do projeto');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao) VALUES
  ('f3300000-0000-0000-0000-000000000001', 'AR-1', 'Projeto da Revisão', 'e3300000-0000-0000-0000-000000000001', true, false);
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c3300000-0000-0000-0000-0000000000a1', 'teo33@teste.local', 'Téo', 'AVALIADOR', NULL),
  ('c3300000-0000-0000-0000-0000000000e1', 'val33@teste.local', 'Val', 'AVALIADOR', NULL),
  ('c3300000-0000-0000-0000-0000000000ad', 'admin33@teste.local', 'Admin', 'ADMIN', 'd3300000-0000-0000-0000-0000000000ad');
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_questionario) VALUES
  ('c3300000-0000-0000-0000-0000000000a1', 'e3300000-0000-0000-0000-000000000001', true, NULL),
  ('c3300000-0000-0000-0000-0000000000e1', 'e3300000-0000-0000-0000-000000000001', true, 'a3300000-0000-0000-0000-0000000000bb');
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d3300000-0000-0000-0000-0000000000a1', 'c3300000-0000-0000-0000-0000000000a1', 'e3300000-0000-0000-0000-000000000001', 'codigo'),
  ('d3300000-0000-0000-0000-0000000000e1', 'c3300000-0000-0000-0000-0000000000e1', 'e3300000-0000-0000-0000-000000000001', 'codigo');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- O questionário fixado do projeto é sempre de nota técnica
-- ---------------------------------------------------------------------------
-- A tela do avaliador impõe o fixado quando o evento trava o questionário: um
-- fixado de voto popular prendia o projeto e o avaliador técnico não escolhia.
SELECT throws_ok($$ UPDATE public.projetos
                      SET id_questionario_fixado = 'a3300000-0000-0000-0000-0000000000bb'
                    WHERE id_projeto = 'f3300000-0000-0000-0000-000000000001' $$,
  '22023', NULL, 'Questionário de voto popular não pode ser gravado como fixado do projeto');

SELECT lives_ok($$ UPDATE public.projetos
                     SET id_questionario_fixado = 'a3300000-0000-0000-0000-0000000000aa'
                   WHERE id_projeto = 'f3300000-0000-0000-0000-000000000001' $$,
  'Questionário técnico continua podendo ser fixado');

-- Nenhum projeto do banco ficou preso em questionário de voto popular (reparo)
SELECT is((SELECT count(*)::int FROM public.projetos p
           JOIN public.questionarios q ON q.id_questionario = p.id_questionario_fixado
           WHERE coalesce(q.is_voto_popular, false)), 0,
  'Nenhum projeto tem questionário de voto popular fixado');

-- ---------------------------------------------------------------------------
-- Lançamento manual: o fixado respeita a trava do evento
-- ---------------------------------------------------------------------------
UPDATE public.projetos SET id_questionario_fixado = NULL
 WHERE id_projeto = 'f3300000-0000-0000-0000-000000000001';
UPDATE public.eventos SET fixar_questionario_primeira_avaliacao = false
 WHERE id_evento = 'e3300000-0000-0000-0000-000000000001';

SELECT pg_temp.como('d3300000-0000-0000-0000-0000000000ad');
SELECT isnt(
  (public.admin_lancar_avaliacao('f3300000-0000-0000-0000-000000000001',
     'c3300000-0000-0000-0000-0000000000a1', 'a3300000-0000-0000-0000-0000000000aa',
     jsonb_build_array(jsonb_build_object('id_pergunta', 'b3300000-0000-0000-0000-0000000000cc', 'nota', 8)),
     'ficha de papel', 'teste do fixado') ->> 'nota_final'),
  NULL, 'Admin lança a nota técnica com a trava do evento desligada');

RESET role;
SELECT is((SELECT id_questionario_fixado FROM public.projetos
           WHERE id_projeto = 'f3300000-0000-0000-0000-000000000001'), NULL,
  'Com a trava desligada, o lançamento manual não fixa o questionário do projeto');

-- ---------------------------------------------------------------------------
-- Contagem: votante é credenciado, mas não é avaliador técnico
-- ---------------------------------------------------------------------------
SELECT is(public.fn_telao_resumo('e3300000-0000-0000-0000-000000000001')->>'avaliadores_credenciados', '1',
  'O Telão conta só o avaliador técnico em avaliadores_credenciados');
SELECT is(public.fn_telao_resumo('e3300000-0000-0000-0000-000000000001')->>'votantes_credenciados', '1',
  'O votante credenciado entra no contador próprio');

-- ---------------------------------------------------------------------------
-- Views legadas: média sem voto popular
-- ---------------------------------------------------------------------------
-- Val vota 2 no projeto que já tem a nota técnica 8: a média legada era 5
INSERT INTO public.avaliacoes (id_projeto, id_usuario, id_questionario, nota_final, status, tempo_submissao)
VALUES ('f3300000-0000-0000-0000-000000000001', 'c3300000-0000-0000-0000-0000000000e1',
        'a3300000-0000-0000-0000-0000000000bb', 2, 'CONCLUIDA', now());

SELECT is((SELECT media_notas FROM public.view_relatorio_admin
           WHERE id_projeto = 'f3300000-0000-0000-0000-000000000001'), 8.00,
  'view_relatorio_admin ignora o voto popular na média');
SELECT is((SELECT total_avaliacoes::int FROM public.view_relatorio_projetos
           WHERE id_projeto = 'f3300000-0000-0000-0000-000000000001'), 1,
  'view_relatorio_projetos conta só a nota técnica');

-- ---------------------------------------------------------------------------
-- Cópia de questionário carrega a marca de voto popular
-- ---------------------------------------------------------------------------
-- A leitura vai dentro de uma função: no mesmo comando, o snapshot do SELECT de
-- fora não veria a linha que a cópia acabou de inserir.
CREATE FUNCTION pg_temp.marca_da_copia(p_origem text, p_destino text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  v_id := public.admin_copiar_questionario(p_origem::uuid, p_destino::uuid);
  RETURN (SELECT coalesce(is_voto_popular, false) FROM public.questionarios WHERE id_questionario = v_id);
END $$;

SELECT pg_temp.como('d3300000-0000-0000-0000-0000000000ad');
SELECT is(pg_temp.marca_da_copia('a3300000-0000-0000-0000-0000000000bb', 'e3300000-0000-0000-0000-000000000002'),
  true, 'A cópia de um questionário de voto popular continua sendo de voto popular');
RESET role;

SELECT * FROM finish();
ROLLBACK;
