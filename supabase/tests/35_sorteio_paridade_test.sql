-- `sortear_projeto` e `sortear_proximo_projeto` precisam ficar em sincronia (AGENTS.md).
-- Hoje a primeira é um alias que delega para a segunda; estas asserções existem para o dia em que
-- alguém copiar a regra para dentro do alias, que é como as duas divergem em silêncio.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

-- ---------------------------------------------------------------------------
-- Cenário: evento ativo com a janela aberta agora (fuso de MS), dois projetos com check-in,
-- avaliadora credenciada com celular vinculado e uma segunda avaliadora sem vínculo
-- ---------------------------------------------------------------------------
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3500000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d3500000-0000-0000-0000-0000000000b1', NULL, true, NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, sistema_liberado, data_evento, horario_inicio, horario_fim)
VALUES ('e3500000-0000-0000-0000-000000000001', 'Feira Paridade', true, 3, true,
        (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao)
VALUES ('f3500000-0000-0000-0000-000000000001', 'PAR-1', 'Projeto 1', 'e3500000-0000-0000-0000-000000000001', true, false),
       ('f3500000-0000-0000-0000-000000000002', 'PAR-2', 'Projeto 2', 'e3500000-0000-0000-0000-000000000001', true, false);
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c3500000-0000-0000-0000-0000000000a1', 'ana35@teste.local', 'Ana', 'AVALIADOR'),
  ('c3500000-0000-0000-0000-0000000000b1', 'bia35@teste.local', 'Bia', 'AVALIADOR');
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c3500000-0000-0000-0000-0000000000a1', 'e3500000-0000-0000-0000-000000000001', true),
  ('c3500000-0000-0000-0000-0000000000b1', 'e3500000-0000-0000-0000-000000000001', true);
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d3500000-0000-0000-0000-0000000000a1', 'c3500000-0000-0000-0000-0000000000a1', 'e3500000-0000-0000-0000-000000000001', 'pareamento'),
  ('d3500000-0000-0000-0000-0000000000b1', 'c3500000-0000-0000-0000-0000000000b1', 'e3500000-0000-0000-0000-000000000001', 'pareamento');

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

-- ---------------------------------------------------------------------------
-- A regra mora em um lugar só: o alias delega, não copia
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT prosrc LIKE '%sortear_proximo_projeto%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sortear_projeto'),
  'sortear_projeto delega para sortear_proximo_projeto (não duplica a regra do sorteio)');

SELECT is(
  (SELECT count(DISTINCT pg_get_function_identity_arguments(p.oid))::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('sortear_projeto', 'sortear_proximo_projeto')),
  1, 'as duas recebem os mesmos argumentos');

SELECT is(
  (SELECT count(DISTINCT p.prorettype)::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('sortear_projeto', 'sortear_proximo_projeto')),
  1, 'as duas devolvem o mesmo tipo');

SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('sortear_projeto', 'sortear_proximo_projeto')
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']),
  2, 'as duas são SECURITY DEFINER com search_path fixado');

-- ---------------------------------------------------------------------------
-- Mesma permissão: nenhuma das duas é alcançável por visitante anônimo
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'public.sortear_projeto(uuid,uuid)', 'EXECUTE'),
          'anon não executa sortear_projeto');
SELECT ok(NOT has_function_privilege('anon', 'public.sortear_proximo_projeto(uuid,uuid)', 'EXECUTE'),
          'anon não executa sortear_proximo_projeto');
SELECT ok(has_function_privilege('authenticated', 'public.sortear_projeto(uuid,uuid)', 'EXECUTE'),
          'authenticated executa sortear_projeto');

-- ---------------------------------------------------------------------------
-- Mesmo comportamento: o alias sorteia, respeita a trava e recusa o mesmo abuso
-- ---------------------------------------------------------------------------
SELECT pg_temp.como('d3500000-0000-0000-0000-0000000000a1');

SELECT ok(
  public.sortear_projeto('c3500000-0000-0000-0000-0000000000a1', 'e3500000-0000-0000-0000-000000000001')
    IN ('f3500000-0000-0000-0000-000000000001', 'f3500000-0000-0000-0000-000000000002'),
  'sortear_projeto devolve um projeto elegível do evento');

SELECT is(
  (SELECT count(*)::int FROM public.locks_ativos
    WHERE id_usuario = 'c3500000-0000-0000-0000-0000000000a1'),
  1, 'o sorteio pelo alias cria a trava, como o do caminho principal');

-- As duas gravam a trava no mesmo lugar e da mesma forma: um novo sorteio substitui a trava
-- anterior em vez de acumular. Se o alias gravasse em outro lugar, sobrariam duas travas e a
-- vaga do primeiro projeto ficaria presa até expirar.
SELECT is(
  (SELECT count(*)::int FROM public.locks_ativos
    WHERE id_usuario = 'c3500000-0000-0000-0000-0000000000a1'
      AND id_projeto = public.sortear_proximo_projeto('c3500000-0000-0000-0000-0000000000a1',
                                                      'e3500000-0000-0000-0000-000000000001')),
  1, 'sortear pelo caminho principal substitui a trava criada pelo alias, sem acumular');

-- Sortear em nome de outra pessoa: as duas recusam igual
SELECT throws_ok(
  $$ SELECT public.sortear_projeto('c3500000-0000-0000-0000-0000000000b1', 'e3500000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'sortear_projeto recusa sorteio em nome de outro avaliador');
SELECT throws_ok(
  $$ SELECT public.sortear_proximo_projeto('c3500000-0000-0000-0000-0000000000b1', 'e3500000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'sortear_proximo_projeto recusa o mesmo abuso');

SELECT * FROM finish();
ROLLBACK;
