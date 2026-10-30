-- Normalização de nomes igual à do front-end (migration 20261030050000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('ef000000-0000-0000-0000-000000000001', 'Evento Quinze', true);

SELECT is(public.fn_normalizar_nome('  IFMS – Câmpus “Sul”  '), 'ifms – campus “sul”',
  'mantém travessão e aspas, como normalizarChave() no front');
SELECT is(public.fn_normalizar_nome(E' Escola São João\t'), 'escola sao joao',
  'apara espaços não separáveis e tabulações nas pontas, como String.trim()');
SELECT is(public.fn_normalizar_nome('Colégio Œ 1º'), 'colegio œ 1º', 'não troca ligaduras nem ordinais');

-- GestorProjetos grava a chave calculada no front e casa os ids pela chave devolvida
INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
VALUES ('ef000000-0000-0000-0000-000000000001', 'IFMS – Câmpus Sul', 'ifms – campus sul');
SELECT is((SELECT nome_normalizado FROM public.instituicoes WHERE id_evento = 'ef000000-0000-0000-0000-000000000001'),
  'ifms – campus sul', 'chave gravada pelo front não é reescrita com outra normalização');

INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
VALUES ('ef000000-0000-0000-0000-000000000001', E' Escola Norte ', 'x');
SELECT is((SELECT nome_exibicao || '|' || nome_normalizado FROM public.instituicoes
           WHERE id_evento = 'ef000000-0000-0000-0000-000000000001' AND nome_exibicao LIKE '%Norte%'),
  'Escola Norte|escola norte', 'trigger apara o nome de exibição como o front');

SELECT throws_ok($$
  INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
  VALUES ('ef000000-0000-0000-0000-000000000001', 'ifms – CAMPUS sul', 'qualquer')
$$, '23505', NULL, 'mesma instituição (só muda caixa/acento) continua barrada');

-- Autocadastro reaproveita a instituição existente
SET LOCAL role anon;
SELECT lives_ok($$
  SELECT public.fn_autocadastro_avaliador('ef000000-0000-0000-0000-000000000001', 'Avaliador Quinze',
    'av15@teste.local', NULL, 'Ifms – Câmpus Sul', NULL)
$$, 'autocadastro com instituição já cadastrada não falha');
RESET role;
SELECT is((SELECT count(*)::int FROM public.instituicoes WHERE id_evento = 'ef000000-0000-0000-0000-000000000001'), 2,
  'não duplica a instituição');
SELECT is((SELECT i.nome_exibicao FROM public.avaliadores_evento ae
           JOIN public.usuarios u ON u.id_usuario = ae.id_usuario
           JOIN public.instituicoes i ON i.id_instituicao = ae.id_instituicao
           WHERE u.email = 'av15@teste.local'), 'IFMS – Câmpus Sul', 'avaliador ligado à instituição existente');

SELECT * FROM finish();
ROLLBACK;
