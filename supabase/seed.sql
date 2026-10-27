-- ==============================================================================
-- SEED DO AMBIENTE LOCAL
-- Executado por `supabase start` e `supabase db reset` (local).
--
-- Não coloque credenciais, usuários do Auth nem dados reais aqui: em um
-- `db reset --linked` sem --no-seed este arquivo também roda no banco remoto.
-- Como criar o Admin local: docs/arquitetura/configuracao.md#desenvolvimento-local
-- ==============================================================================

INSERT INTO public.eventos (nome_evento, edicao, data_evento, horario_inicio, horario_fim, is_ativo, sistema_liberado)
SELECT 'Evento Local de Teste', 'Dev', CURRENT_DATE, '08:00', '18:00', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.eventos WHERE nome_evento = 'Evento Local de Teste');
