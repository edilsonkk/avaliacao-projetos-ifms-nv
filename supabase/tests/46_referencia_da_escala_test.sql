-- Referência da escala em coluna própria (migration 20261125120000_referencia_da_escala_nas_perguntas).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

-- Cenário: E1 ativo, um questionário próprio já usado em avaliação e um Admin
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d4600000-0000-0000-0000-0000000000ad', 'admin46@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('d4600000-0000-0000-0000-0000000000ad', 'admin46@teste.local', 'Admin', 'ADMIN', NULL),
  ('c4600000-0000-0000-0000-0000000000a1', 'ana46@teste.local', 'Ana', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES ('e4600000-0000-0000-0000-000000000001', 'Feira 2026', true);
INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima) VALUES
  ('a4600000-0000-0000-0000-000000000001', 'e4600000-0000-0000-0000-000000000001', 'Usado em avaliação', 1, 5);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, descricao_lembrete, referencia_escala, peso_calculo, peso_desempate) VALUES
  ('b4600000-0000-0000-0000-000000000011', 'a4600000-0000-0000-0000-000000000001', 1, 'Metodologia', 'Adequação dos métodos.', '1: frágil · 5: reprodutível', 1, 1);
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento) VALUES
  ('f4600000-0000-0000-0000-000000000001', 'CM-46', 'Projeto', 'e4600000-0000-0000-0000-000000000001');
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status) VALUES
  ('a9600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000001', 'c4600000-0000-0000-0000-0000000000a1', 'a4600000-0000-0000-0000-000000000001', 4, 'CONCLUIDA');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'perguntas_questionario', 'referencia_escala', 'perguntas_questionario tem referencia_escala');
SELECT has_column('public', 'perguntas_modelo_questionario', 'referencia_escala', 'perguntas_modelo_questionario tem referencia_escala');

-- ---------------------------------------------------------------------------
-- Corte do texto: as duas funções que definem o marcador
-- ---------------------------------------------------------------------------
SELECT is(public.fn_orientacao_da_pergunta('Mede o rigor. Referência — 1: pouco · 5: muito'), 'Mede o rigor.',
  'a orientação é o que vem antes do marcador');
SELECT is(public.fn_referencia_da_escala('Mede o rigor. Referência — 1: pouco · 5: muito'), '1: pouco · 5: muito',
  'a referência é o que vem depois do marcador');
SELECT is(public.fn_orientacao_da_pergunta('Clareza na formulação.'), 'Clareza na formulação.',
  'sem marcador, a orientação é o texto inteiro');
SELECT is(public.fn_referencia_da_escala('Clareza na formulação.'), NULL,
  'sem marcador, não há referência');

-- ---------------------------------------------------------------------------
-- Backfill dos modelos pré-cadastrados
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::integer FROM public.perguntas_modelo_questionario WHERE referencia_escala IS NOT NULL), 40,
  'as 40 perguntas dos 4 modelos técnicos ganharam referência');
SELECT is((SELECT count(*)::integer FROM public.perguntas_modelo_questionario WHERE referencia_escala IS NULL), 23,
  'as 23 perguntas de voto popular e feira de ciências seguem sem referência');
SELECT is((SELECT count(*)::integer FROM public.perguntas_modelo_questionario WHERE descricao_lembrete LIKE '% Referência — %'), 0,
  'nenhum texto de ajuda de modelo guarda mais as âncoras coladas');
SELECT is((SELECT descricao_lembrete FROM public.perguntas_modelo_questionario
           WHERE id_modelo = '0d0de100-0000-4000-8000-000000000001' AND ordem = 1),
  'Relevância e delimitação do problema e de quem é afetado por ele.',
  'q1 ordem 1: o texto de ajuda ficou só com a orientação');
SELECT is((SELECT referencia_escala FROM public.perguntas_modelo_questionario
           WHERE id_modelo = '0d0de100-0000-4000-8000-000000000001' AND ordem = 1),
  '1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais',
  'q1 ordem 1: as âncoras foram para a coluna própria');
SELECT is((SELECT descricao_lembrete FROM public.perguntas_modelo_questionario
           WHERE id_modelo = '0d0de100-0000-4000-8000-000000000006' AND ordem = 1),
  'Clareza na formulação, delimitação e relação com os objetivos.',
  'q6 ordem 1: pergunta sem âncoras não foi tocada');

-- ---------------------------------------------------------------------------
-- Restaurar originais: o seed guarda o texto colado, a restauração separa
-- ---------------------------------------------------------------------------
-- Estraga a linha antes de assumir o papel do Admin: a tabela de modelos não aceita UPDATE
-- direto de `authenticated` (só as funções admin_* escrevem nela), e é isso que se quer.
UPDATE public.perguntas_modelo_questionario
SET descricao_lembrete = 'texto que o Admin estragou', referencia_escala = NULL
WHERE id_modelo = '0d0de100-0000-4000-8000-000000000001' AND ordem = 1;
SELECT pg_temp.como('d4600000-0000-0000-0000-0000000000ad');
SELECT is(public.admin_restaurar_modelos_originais(), 7, 'restaurar originais devolve os 7 modelos');
SELECT is((SELECT descricao_lembrete FROM public.perguntas_modelo_questionario
           WHERE id_modelo = '0d0de100-0000-4000-8000-000000000001' AND ordem = 1),
  'Relevância e delimitação do problema e de quem é afetado por ele.',
  'restaurar devolve o texto de ajuda sem as âncoras');
SELECT is((SELECT referencia_escala FROM public.perguntas_modelo_questionario
           WHERE id_modelo = '0d0de100-0000-4000-8000-000000000001' AND ordem = 1),
  '1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais',
  'restaurar devolve as âncoras na coluna própria');

-- ---------------------------------------------------------------------------
-- A referência acompanha a cópia do modelo para o evento
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE copia AS
  SELECT public.admin_copiar_questionario('0d0de100-0000-4000-8000-000000000001', 'e4600000-0000-0000-0000-000000000001') AS id;
SELECT is((SELECT referencia_escala FROM public.perguntas_questionario
           WHERE id_questionario = (SELECT id FROM copia) AND ordem = 1),
  '1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais',
  'copiar o modelo para o evento leva a referência');

-- ---------------------------------------------------------------------------
-- Exceção da trava: em questionário já usado, só a referência pode mudar
--
-- A referência é texto informativo e não entra em nenhum cálculo, então um erro de digitação
-- descoberto durante a feira pode ser corrigido. Texto, ajuda, pesos e escala seguem travados.
-- ---------------------------------------------------------------------------
SELECT lives_ok($$
  SELECT public.admin_salvar_questionario('a4600000-0000-0000-0000-000000000001', NULL, 'Usado em avaliação', 1, 5,
    '[{"id_pergunta":"b4600000-0000-0000-0000-000000000011","texto_pergunta":"Metodologia","descricao_lembrete":"Adequação dos métodos.","referencia_escala":"1: sem método descrito · 5: método reprodutível","peso_calculo":1,"peso_desempate":1}]')
$$, 'questionário já usado aceita mudar a referência');
SELECT is((SELECT referencia_escala FROM public.perguntas_questionario WHERE id_pergunta = 'b4600000-0000-0000-0000-000000000011'),
  '1: sem método descrito · 5: método reprodutível',
  'a referência nova foi gravada, e não descartada em silêncio');
SELECT throws_ok($$
  SELECT public.admin_salvar_questionario('a4600000-0000-0000-0000-000000000001', NULL, 'Usado em avaliação', 1, 5,
    '[{"id_pergunta":"b4600000-0000-0000-0000-000000000011","texto_pergunta":"Metodologia","descricao_lembrete":"Outro texto de ajuda","referencia_escala":"1: sem método descrito · 5: método reprodutível","peso_calculo":1,"peso_desempate":1}]')
$$, 'P0001', NULL, 'questionário já usado continua recusando mudança no texto de ajuda');

-- ---------------------------------------------------------------------------
-- Limite de tamanho
-- ---------------------------------------------------------------------------
SELECT throws_ok(format($$
  SELECT public.admin_salvar_modelo_questionario(NULL, 'Modelo com referência enorme', NULL, 1, 5,
    '[{"texto_pergunta":"Clareza","referencia_escala":"%s"}]')
$$, repeat('x', 2001)), '22001', NULL, 'referência acima de 2000 caracteres é recusada');

SELECT * FROM finish();
ROLLBACK;
