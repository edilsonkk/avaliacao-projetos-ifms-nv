-- Idioma do subselect escalar nas policies de RLS (migration 20261123001529).
--
-- `is_admin()`, `is_staff()`, `avaliador_atual()` e `auth.uid()` são STABLE, não
-- IMMUTABLE: numa cláusula USING o planejador as avalia UMA VEZ POR LINHA VARRIDA.
-- Envolvidas em `(SELECT f())` viram InitPlan — uma avaliação por comando. Medido em
-- 601 projetos: leitura completa da Classificação 371 ms -> 111 ms; `projetos` inteira
-- pelo avaliador 28,6 ms -> 0,36 ms.
--
-- Este teste guarda duas coisas que, se mudarem sem aviso, desfazem o idioma:
--   (a) nenhuma policy volta a chamar as funções direto (uma policy nova escrita no
--       padrão antigo reintroduz o custo por linha naquela tabela);
--   (b) as quatro funções continuam STABLE. Se uma virar VOLATILE, `(SELECT f())`
--       passa a ser avaliada uma vez por comando onde antes era por linha, e isso
--       MUDA COMPORTAMENTO — sem nenhum sinal no plano nem erro de execução.
--
-- E duas de semântica, porque o idioma não pode mexer em quem vê o quê.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

-- ---------------------------------------------------------------------------
-- (a) Nenhuma chamada direta. O catálogo desparsa o idioma como
--     `( SELECT is_admin() AS is_admin)`, então tiramos as chamadas já envolvidas e
--     cobramos que não sobrou nenhuma solta.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(x.tablename || '.' || x.policyname, ', ' ORDER BY x.tablename, x.policyname), '')
     FROM (
       SELECT p.tablename, p.policyname,
              regexp_replace(
                coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
                'SELECT (public\.|auth\.)?(is_admin|is_staff|avaliador_atual|uid)\(\)',
                '', 'g') AS sobra
         FROM pg_policies p
        WHERE p.schemaname = 'public'
     ) x
    WHERE x.sobra ~ '(is_admin|is_staff|avaliador_atual|uid)\(\)'),
  '', 'nenhuma policy de public chama is_admin/is_staff/avaliador_atual/auth.uid direto em USING ou WITH CHECK');

-- ---------------------------------------------------------------------------
-- (b) Volatilidade: é o que mantém o idioma correto no futuro
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(n.nspname || '.' || p.proname || ' é ' || p.provolatile::text, ', ' ORDER BY p.proname), '')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE ((n.nspname = 'public' AND p.proname IN ('is_admin', 'is_staff', 'avaliador_atual'))
        OR (n.nspname = 'auth' AND p.proname = 'uid'))
      AND p.provolatile <> 's'),
  '', 'is_admin, is_staff, avaliador_atual e auth.uid continuam STABLE');

-- ---------------------------------------------------------------------------
-- Semântica: o idioma iça a CHAMADA, não o predicado. A RLS tem de continuar
-- filtrando linha a linha.
-- ---------------------------------------------------------------------------
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d4100000-0000-0000-0000-0000000000a1', NULL, true, NULL);
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c4100000-0000-0000-0000-0000000000a1', 'ava411@teste.local', 'Ana 41', 'AVALIADOR'),
  ('c4100000-0000-0000-0000-0000000000a2', 'ava412@teste.local', 'Bia 41', 'AVALIADOR');
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, data_evento, horario_inicio, horario_fim)
VALUES ('e4100000-0000-0000-0000-000000000001', 'Evento InitPlan 41', true, 3,
        (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima) VALUES
  ('74100000-0000-0000-0000-000000000001', 'e4100000-0000-0000-0000-000000000001', 'Técnico 41', 0, 10);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('84100000-0000-0000-0000-000000000001', '74100000-0000-0000-0000-000000000001', 1, 'Critério 41', 1, 1);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado) VALUES
  ('f4100000-0000-0000-0000-000000000001', 'INI-001', 'Projeto 41', 'e4100000-0000-0000-0000-000000000001', true);
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('54100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001',
   'c4100000-0000-0000-0000-0000000000a1', '74100000-0000-0000-0000-000000000001', 8, 'CONCLUIDA'),
  ('54100000-0000-0000-0000-000000000002', 'f4100000-0000-0000-0000-000000000001',
   'c4100000-0000-0000-0000-0000000000a2', '74100000-0000-0000-0000-000000000001', 6, 'CONCLUIDA');
INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('54100000-0000-0000-0000-000000000001', '84100000-0000-0000-0000-000000000001', 8);
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c4100000-0000-0000-0000-0000000000a1', 'e4100000-0000-0000-0000-000000000001', true);
INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d4100000-0000-0000-0000-0000000000a1', 'c4100000-0000-0000-0000-0000000000a1',
   'e4100000-0000-0000-0000-000000000001', 'pareamento');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'd4100000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

-- `id_usuario = (SELECT avaliador_atual())`: a chamada é içada, a comparação não
SELECT is(
  (SELECT count(*)::int FROM public.avaliacoes WHERE id_projeto = 'f4100000-0000-0000-0000-000000000001'),
  1, 'avaliador continua vendo só a avaliação dele (a comparação por linha sobreviveu ao idioma)');

-- policy admin-only envolvida continua negando para quem não é Admin
SELECT is(
  (SELECT count(*)::int FROM public.respostas_avaliacao),
  0, 'avaliador continua sem ler respostas_avaliacao (policy admin-only com o idioma segue negando)');

RESET role;
SELECT * FROM finish();
ROLLBACK;
