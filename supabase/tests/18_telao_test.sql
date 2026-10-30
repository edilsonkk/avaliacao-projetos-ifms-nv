-- Telão ao Vivo (fn_telao_resumo, migration 20261030080000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

-- Só o evento do teste fica ativo dentro desta transação
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO public.eventos (id_evento, nome_evento, edicao, is_ativo, cota_avaliacoes_padrao, data_evento, horario_inicio) VALUES
  ('e1800000-0000-0000-0000-000000000001', 'Feira Dezoito', '18ª', true, 3, '2026-10-30', '08:00'),
  ('e1800000-0000-0000-0000-000000000002', 'Evento Antigo', NULL, false, 3, NULL, NULL);
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c1800000-0000-0000-0000-0000000000a1', 'av181@teste.local', 'A1', 'AVALIADOR'),
  ('c1800000-0000-0000-0000-0000000000a2', 'av182@teste.local', 'A2', 'AVALIADOR'),
  ('c1800000-0000-0000-0000-0000000000a3', 'av183@teste.local', 'A3', 'AVALIADOR'),
  ('c1800000-0000-0000-0000-0000000000a4', 'av184@teste.local', 'A4', 'AVALIADOR'),
  ('c1800000-0000-0000-0000-0000000000b1', 'staff18@teste.local', 'S1', 'STAFF');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao, cota_avaliacoes_customizada) VALUES
  -- presente, cota customizada 2, com 3 avaliações (a 3ª passa da cota)
  ('f1800000-0000-0000-0000-000000000001', 'T-1', 'P1', 'e1800000-0000-0000-0000-000000000001', true, false, 2),
  -- presente, cota padrão 3, com 2 avaliações divergentes (quarentena)
  ('f1800000-0000-0000-0000-000000000002', 'T-2', 'P2', 'e1800000-0000-0000-0000-000000000001', true, false, NULL),
  -- ausente: não entra na meta
  ('f1800000-0000-0000-0000-000000000003', 'T-3', 'P3', 'e1800000-0000-0000-0000-000000000001', false, false, NULL),
  -- fora da competição: não entra na meta
  ('f1800000-0000-0000-0000-000000000004', 'T-4', 'P4', 'e1800000-0000-0000-0000-000000000001', true, true, NULL),
  ('f1800000-0000-0000-0000-000000000009', 'O-1', 'Outro', 'e1800000-0000-0000-0000-000000000002', true, false, NULL);
INSERT INTO public.avaliacoes (id_projeto, id_usuario, nota_final, status) VALUES
  ('f1800000-0000-0000-0000-000000000001', 'c1800000-0000-0000-0000-0000000000a1', 8, 'CONCLUIDA'),
  ('f1800000-0000-0000-0000-000000000001', 'c1800000-0000-0000-0000-0000000000a2', 8, 'CONCLUIDA'),
  ('f1800000-0000-0000-0000-000000000001', 'c1800000-0000-0000-0000-0000000000a3', 8, 'CONCLUIDA'),
  ('f1800000-0000-0000-0000-000000000002', 'c1800000-0000-0000-0000-0000000000a1', 10, 'CONCLUIDA'),
  ('f1800000-0000-0000-0000-000000000002', 'c1800000-0000-0000-0000-0000000000a2', 5, 'CONCLUIDA'),
  ('f1800000-0000-0000-0000-000000000004', 'c1800000-0000-0000-0000-0000000000a1', 9, 'CONCLUIDA'),
  ('f1800000-0000-0000-0000-000000000009', 'c1800000-0000-0000-0000-0000000000a4', 9, 'CONCLUIDA');
-- Credenciamento: 2 avaliadores credenciados, 1 pendente e 1 Staff credenciado (não é avaliador)
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('c1800000-0000-0000-0000-0000000000a1', 'e1800000-0000-0000-0000-000000000001', true),
  ('c1800000-0000-0000-0000-0000000000a2', 'e1800000-0000-0000-0000-000000000001', true),
  ('c1800000-0000-0000-0000-0000000000a3', 'e1800000-0000-0000-0000-000000000001', false),
  ('c1800000-0000-0000-0000-0000000000b1', 'e1800000-0000-0000-0000-000000000001', true);
-- Travas: P2 (falta 1 para a cota), P1 (cota já cheia), P3 (ausente) e uma vencida em P2
INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em) VALUES
  ('c1800000-0000-0000-0000-0000000000a3', 'f1800000-0000-0000-0000-000000000002', now() + interval '10 minutes'),
  ('c1800000-0000-0000-0000-0000000000a4', 'f1800000-0000-0000-0000-000000000001', now() + interval '10 minutes'),
  ('c1800000-0000-0000-0000-0000000000a2', 'f1800000-0000-0000-0000-000000000003', now() + interval '10 minutes'),
  ('c1800000-0000-0000-0000-0000000000a1', 'f1800000-0000-0000-0000-000000000002', now() - interval '1 minute');

SET LOCAL role anon;
SELECT is(public.fn_telao_resumo(NULL)->>'nome_evento', 'Feira Dezoito', 'sem evento informado, usa o evento ativo e devolve o nome');
SELECT is(public.fn_telao_resumo(NULL)->>'total_projetos', '4', 'total de projetos do evento');
SELECT is(public.fn_telao_resumo(NULL)->>'projetos_presentes', '2', 'presentes na competição: sem ausentes e sem fora da competição');
SELECT is(public.fn_telao_resumo(NULL)->>'avaliadores_credenciados', '2', 'só avaliadores credenciados: sem pendentes e sem Staff');
SELECT is(public.fn_telao_resumo(NULL)->>'avaliacoes_em_andamento', '3', 'em andamento: travas válidas do evento, sem a vencida');
SELECT is(public.fn_telao_resumo(NULL)->>'em_andamento_na_meta', '1', 'na meta só conta a trava de projeto presente que ainda não bateu a cota');
SELECT is(public.fn_telao_resumo(NULL)->>'meta_global', '5', 'meta soma a cota de cada projeto presente (2 + 3)');
SELECT is(public.fn_telao_resumo(NULL)->>'avaliacoes_na_meta', '4', 'avaliação além da cota não conta para a meta (2 + 2)');
SELECT is(public.fn_telao_resumo(NULL)->>'projetos_quarentena', '1', 'quarentena pendente do evento');
SELECT is(public.fn_telao_resumo(NULL)->>'data_evento' || ' ' || (public.fn_telao_resumo(NULL)->>'horario_inicio'), '2026-10-30 08:00:00',
  'devolve data e horário de início para o cronômetro');
SELECT ok(NOT (public.fn_telao_resumo(NULL)::text ~* 'nota|media|titulo|email'), 'só agregados: sem notas, títulos ou e-mails');
SELECT is(public.fn_telao_resumo('e1800000-0000-0000-0000-000000000002')->>'total_projetos', '1', 'evento pedido explicitamente');

SELECT * FROM finish();
ROLLBACK;
