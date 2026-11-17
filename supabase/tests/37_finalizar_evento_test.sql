-- Finalizar evento (admin_finalizar_evento, migration 20261116010000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

-- Cenário: dois eventos, cada um com projeto, avaliador credenciado, trava ativa,
-- celular vinculado e código de acesso pendente. Finalizar o primeiro não pode
-- tocar em nada do segundo (regra 5: escopo por evento).
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3700000-0000-0000-0000-0000000000ad', 'admin37@teste.local', false, now()),
  ('d3700000-0000-0000-0000-000000000051', 'staff37@teste.local', false, now()),
  ('d3700000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d3700000-0000-0000-0000-0000000000a9', NULL, true, NULL);

INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, sistema_liberado, cota_avaliacoes_padrao) VALUES
  ('e3700000-0000-0000-0000-000000000001', 'Feira Trinta e Sete', true, true, 3),
  ('e3700000-0000-0000-0000-000000000002', 'Feira Vizinha', false, true, 3);

INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado) VALUES
  ('f3700000-0000-0000-0000-000000000001', 'FIN-1', 'Projeto Um', 'e3700000-0000-0000-0000-000000000001', true),
  ('f3700000-0000-0000-0000-000000000009', 'FIN-9', 'Projeto Vizinho', 'e3700000-0000-0000-0000-000000000002', true);

INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c3700000-0000-0000-0000-0000000000ad', 'admin37@teste.local', 'Admin', 'ADMIN', 'd3700000-0000-0000-0000-0000000000ad'),
  ('c3700000-0000-0000-0000-000000000051', 'staff37@teste.local', 'Staff', 'STAFF', 'd3700000-0000-0000-0000-000000000051'),
  ('c3700000-0000-0000-0000-0000000000a1', 'ana37@teste.local', 'Ana', 'AVALIADOR', NULL),
  ('c3700000-0000-0000-0000-0000000000a9', 'val37@teste.local', 'Valdo', 'AVALIADOR', NULL);

INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c3700000-0000-0000-0000-0000000000a1', 'e3700000-0000-0000-0000-000000000001', true),
  ('c3700000-0000-0000-0000-0000000000a9', 'e3700000-0000-0000-0000-000000000002', true);

INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em) VALUES
  ('c3700000-0000-0000-0000-0000000000a1', 'f3700000-0000-0000-0000-000000000001', now() + interval '30 minutes'),
  ('c3700000-0000-0000-0000-0000000000a9', 'f3700000-0000-0000-0000-000000000009', now() + interval '30 minutes');

INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo, vinculado_por) VALUES
  ('d3700000-0000-0000-0000-0000000000a1', 'c3700000-0000-0000-0000-0000000000a1', 'e3700000-0000-0000-0000-000000000001', 'pareamento', 'c3700000-0000-0000-0000-000000000051'),
  ('d3700000-0000-0000-0000-0000000000a9', 'c3700000-0000-0000-0000-0000000000a9', 'e3700000-0000-0000-0000-000000000002', 'pareamento', 'c3700000-0000-0000-0000-000000000051');

INSERT INTO public.codigos_acesso (id_usuario, id_evento, codigo_hash, expira_em, max_tentativas) VALUES
  ('c3700000-0000-0000-0000-0000000000a1', 'e3700000-0000-0000-0000-000000000001', 'hash-1', now() + interval '20 minutes', 4),
  ('c3700000-0000-0000-0000-0000000000a9', 'e3700000-0000-0000-0000-000000000002', 'hash-9', now() + interval '20 minutes', 4);

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- Só o Admin finaliza
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d3700000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_finalizar_evento('e3700000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'Staff não finaliza o evento');
SELECT pg_temp.como('d3700000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT public.admin_finalizar_evento('e3700000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'Avaliador não finaliza o evento');

SELECT pg_temp.como('d3700000-0000-0000-0000-0000000000ad');

-- Evento inexistente é recusado, em vez de encerrar silenciosamente nada
SELECT throws_ok($$ SELECT public.admin_finalizar_evento('e3700000-0000-0000-0000-0000000000ff') $$,
  'P0001', NULL, 'Evento inexistente é recusado');

-- ---------------------------------------------------------------------------
-- O encerramento em si. O resultado é guardado enquanto a sessão ainda é a do
-- Admin; as conferências vêm depois, já com o papel de dono — `authenticated` não
-- lê `dispositivos_avaliador` nem `codigos_acesso`, e é essa a intenção da RLS.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE resultado_final AS
  SELECT public.admin_finalizar_evento('e3700000-0000-0000-0000-000000000001') AS saida;

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);

SELECT is((SELECT (saida -> 'travas_liberadas')::int FROM resultado_final),
  1, 'Devolve quantas travas foram liberadas');

SELECT ok(NOT (SELECT sistema_liberado FROM public.eventos WHERE id_evento = 'e3700000-0000-0000-0000-000000000001'),
  'Sistema fica fechado para os avaliadores');

SELECT ok((SELECT is_ativo FROM public.eventos WHERE id_evento = 'e3700000-0000-0000-0000-000000000001'),
  'O evento continua ativo: relatórios, classificação e telão leem o evento ativo');

SELECT is((SELECT count(*)::int FROM public.locks_ativos l
             JOIN public.projetos p ON p.id_projeto = l.id_projeto
            WHERE p.id_evento = 'e3700000-0000-0000-0000-000000000001'),
  0, 'As travas do evento foram apagadas');

SELECT is((SELECT count(*)::int FROM public.dispositivos_avaliador
            WHERE id_evento = 'e3700000-0000-0000-0000-000000000001' AND revogado_em IS NULL),
  0, 'Os celulares do evento foram desvinculados');

SELECT is((SELECT count(*)::int FROM public.codigos_acesso
            WHERE id_evento = 'e3700000-0000-0000-0000-000000000001' AND usado_em IS NULL),
  0, 'Os códigos de acesso pendentes do evento foram queimados');

-- ---------------------------------------------------------------------------
-- Nada do evento vizinho é tocado (regra 5)
-- ---------------------------------------------------------------------------
SELECT ok((SELECT sistema_liberado FROM public.eventos WHERE id_evento = 'e3700000-0000-0000-0000-000000000002'),
  'O evento vizinho continua liberado');

SELECT is((SELECT count(*)::int FROM public.locks_ativos l
             JOIN public.projetos p ON p.id_projeto = l.id_projeto
            WHERE p.id_evento = 'e3700000-0000-0000-0000-000000000002'),
  1, 'A trava do evento vizinho sobrevive');

SELECT is((SELECT count(*)::int FROM public.dispositivos_avaliador
            WHERE id_evento = 'e3700000-0000-0000-0000-000000000002' AND revogado_em IS NULL),
  1, 'O celular do evento vizinho segue vinculado');

-- ---------------------------------------------------------------------------
-- A trilha registra o encerramento
-- ---------------------------------------------------------------------------
SELECT ok(EXISTS (
    SELECT 1 FROM public.log_auditoria
     WHERE acao = 'evento_finalizado'
       AND id_evento = 'e3700000-0000-0000-0000-000000000001'
       AND (dados_depois ->> 'aparelhos_desvinculados')::int = 1
  ), 'A trilha guarda o encerramento com as contagens');

SELECT * FROM finish();
ROLLBACK;
