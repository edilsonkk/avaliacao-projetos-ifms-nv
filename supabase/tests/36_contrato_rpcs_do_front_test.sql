-- Contrato entre o front-end e o banco: toda RPC que `src/` chama por nome precisa existir, com a
-- permissão certa. É a costura que nenhum outro teste cruza — no Vitest o banco é falso, e nos
-- outros testes pgTAP não existe interface, então um `rpc()` com nome errado passava pelos dois.
--
-- A lista abaixo é cobrada nas duas direções: a guarda `rpc-no-contrato` de
-- `scripts/guardas-auditoria.mjs` recusa o lint se `src/` chamar uma RPC que não está aqui.
--
-- Além de existir e ser alcançável, cada RPC é CHAMADA de verdade contra uma fixture
-- mínima (asserts 5 a 7). Isso não valida regra de negócio: o teste aceita recusa de
-- regra (P0001), de permissão (42501) e de dado (classe 22/23), e só reprova o que é
-- SQL quebrado — SQLSTATE de classe 42 (coluna, função, tabela ou tipo que não
-- existe), exceto 42501. Foi exatamente essa lacuna que deixou duas funções de
-- relatório falhando em toda chamada por anos: `column p.modalidade does not exist`
-- (42703) e `operator does not exist: timestamp with time zone - character varying`
-- (42883), achadas por scripts/simular-feira.mjs e corrigidas em
-- 20261122201657_corrigir_relatorios_instituicoes_e_indicadores.sql.
--
-- Limite conhecido: o PL/pgSQL planeja cada comando na primeira execução, então uma
-- consulta dentro de um ramo que a fixture não alcança continua sem cobertura. Por
-- isso as chamadas usam o caminho felizes onde é barato (trava real para enviar nota,
-- janela de avaliação aberta, questionário com perguntas), e não só o argumento nulo.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

CREATE TEMP TABLE rpcs_do_front (nome text PRIMARY KEY);
INSERT INTO rpcs_do_front (nome) VALUES
  ('admin_atribuir_banca'),
  ('admin_atualizar_avaliador'),
  ('admin_atualizar_staff'),
  ('admin_bloquear_modalidade_avaliador'),
  ('admin_copiar_questionario'),
  ('admin_desbloquear_todos'),
  ('admin_desbloquear_trava'),
  ('admin_enfileirar_projetos'),
  ('admin_excluir_instituicao'),
  ('admin_excluir_modalidade'),
  ('admin_excluir_modelo_questionario'),
  ('admin_excluir_questionario'),
  ('admin_excluir_staff'),
  ('admin_finalizar_evento'),
  ('admin_listar_questionarios_reaproveitaveis'),
  ('admin_marcar_questionario_voto_popular'),
  ('admin_reclassificar_questionario_voto_popular'),
  ('admin_remover_avaliador_evento'),
  ('admin_remover_quarentena'),
  ('admin_remover_quarentena_evento'),
  ('admin_reset_global'),
  ('admin_restaurar_modelos_originais'),
  ('admin_salvar_avaliadores'),
  ('admin_salvar_configuracoes_seguranca'),
  ('admin_salvar_instituicoes'),
  ('admin_salvar_modalidades'),
  ('admin_salvar_modelo_questionario'),
  ('admin_salvar_questionario'),
  ('admin_salvar_questionario_como_modelo'),
  ('admin_salvar_staff'),
  ('admin_vincular_questionario_avaliador'),
  ('excluir_avaliacao'),
  ('fn_assumir_item_fila'),
  ('fn_auditar_notas'),
  ('fn_autocadastro_avaliador'),
  ('fn_avaliacoes_do_questionario'),
  ('fn_check_in_projeto'),
  ('fn_desvincular_dispositivo'),
  ('fn_enviar_avaliacao'),
  ('fn_feira_concluida'),
  ('fn_gerar_codigo_acesso'),
  ('fn_identidade_visual'),
  ('fn_memorial_evento'),
  ('fn_memorial_por_codigo'),
  ('fn_memorial_projeto'),
  ('fn_meu_perfil'),
  ('fn_parear_dispositivo'),
  ('fn_politica_seguranca'),
  ('fn_projetos_situacao'),
  ('fn_registrar_impedimento'),
  ('fn_relatorio_ausencias_completo'),
  ('fn_relatorio_avaliadores_completo'),
  ('fn_relatorio_devolucoes_completo'),
  ('fn_relatorio_projetos_completo'),
  ('fn_relatorio_voto_popular_completo'),
  ('fn_situacao_vinculos'),
  ('fn_solicitar_pareamento'),
  ('fn_telao_resumo'),
  ('fn_vincular_com_codigo'),
  ('fn_vincular_conta_staff'),
  ('restaurar_avaliacao'),
  ('sortear_projeto'),
  ('sortear_proximo_projeto');

-- ---------------------------------------------------------------------------
-- 1. Existe: nome trocado ou função removida quebra a tela em produção, não no teste
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(r.nome, ', ' ORDER BY r.nome), '')
     FROM rpcs_do_front r
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.nome)),
  '', 'toda RPC chamada pelo front existe no schema public');

-- ---------------------------------------------------------------------------
-- 2. Alcançável por quem está logado (Admin, Staff e avaliador com aparelho vinculado)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(DISTINCT r.nome, ', '), '')
     FROM rpcs_do_front r
     JOIN pg_proc p ON p.proname = r.nome
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  '', 'toda RPC chamada pelo front é executável por authenticated');

-- ---------------------------------------------------------------------------
-- 3. Nenhuma função de coordenação alcançável por visitante anônimo
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(DISTINCT p.proname, ', '), '')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  '', 'nenhuma função admin_* é executável por anon');

-- ---------------------------------------------------------------------------
-- 4. A assinatura que a tela do avaliador monta, parâmetro por parâmetro: é por aqui que a nota
--    entra no banco, e um nome de parâmetro trocado só apareceria com a feira em andamento
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT pg_get_function_identity_arguments(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_enviar_avaliacao'),
  'p_id_usuario uuid, p_id_projeto uuid, p_id_questionario uuid, p_respostas jsonb, p_parecer text, p_tempo_presenca text',
  'fn_enviar_avaliacao mantém os parâmetros que TelaAvaliador envia');


-- ===========================================================================
-- Fixture mínima para CHAMAR as RPCs. Só o bastante para o corpo das funções
-- executar: evento ativo com a janela aberta, um projeto com nota e outro livre,
-- Admin, Staff, avaliador com aparelho vinculado e três celulares anônimos.
-- ===========================================================================
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d3600000-0000-0000-0000-0000000000ad', 'admin36@teste.local', false, now()),
  ('d3600000-0000-0000-0000-000000000051', 'staff36@teste.local', false, now()),
  ('d3600000-0000-0000-0000-0000000000a1', NULL, true, NULL),
  ('d3600000-0000-0000-0000-0000000000a9', NULL, true, NULL),
  ('d3600000-0000-0000-0000-0000000000aa', NULL, true, NULL);

INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c3600000-0000-0000-0000-0000000000ad', 'admin36@teste.local', 'Admin 36', 'ADMIN', 'd3600000-0000-0000-0000-0000000000ad'),
  ('c3600000-0000-0000-0000-000000000051', 'staff36@teste.local', 'Staff 36', 'STAFF', 'd3600000-0000-0000-0000-000000000051'),
  ('c3600000-0000-0000-0000-0000000000a1', 'ava36@teste.local', 'Ana 36', 'AVALIADOR', NULL),
  ('c3600000-0000-0000-0000-0000000000a2', 'bia36@teste.local', 'Bia 36', 'AVALIADOR', NULL);

-- Janela aberta agora: sem isso o sorteio e o envio param na primeira guarda e o
-- resto do corpo não chega a ser planejado.
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, sistema_liberado, cota_avaliacoes_padrao,
                            data_evento, horario_inicio, horario_fim, metodos_vinculo)
VALUES ('e3600000-0000-0000-0000-000000000001', 'Evento Contrato 36', true, true, 3,
        (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59', 'ambos');

INSERT INTO public.modalidades (id_modalidade, id_evento, nome_modalidade) VALUES
  ('b3600000-0000-0000-0000-000000000001', 'e3600000-0000-0000-0000-000000000001', 'Ensino Médio 36');
INSERT INTO public.areas_tematicas (id_area, id_evento, nome_area) VALUES
  ('93600000-0000-0000-0000-000000000001', 'e3600000-0000-0000-0000-000000000001', 'Computação 36');
INSERT INTO public.instituicoes (id_instituicao, id_evento, nome_exibicao, nome_normalizado) VALUES
  ('a3600000-0000-0000-0000-000000000001', 'e3600000-0000-0000-0000-000000000001', 'IFMS 36', 'ifms 36');

INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('73600000-0000-0000-0000-000000000001', 'e3600000-0000-0000-0000-000000000001', 'Técnico 36', 0, 10, false),
  ('73600000-0000-0000-0000-000000000002', 'e3600000-0000-0000-0000-000000000001', 'Voto Popular 36', 1, 5, true);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('83600000-0000-0000-0000-000000000001', '73600000-0000-0000-0000-000000000001', 1, 'Clareza', 1, 1),
  ('83600000-0000-0000-0000-000000000002', '73600000-0000-0000-0000-000000000001', 2, 'Execução', 2, 2),
  ('83600000-0000-0000-0000-000000000003', '73600000-0000-0000-0000-000000000002', 1, 'Gostou?', 1, 0);

INSERT INTO public.modelos_questionario (id_modelo, codigo, titulo, escala_minima, escala_maxima, ordem, is_original) VALUES
  ('63600000-0000-0000-0000-000000000001', 'contrato-36', 'Modelo 36', 0, 10, 99, false);
INSERT INTO public.perguntas_modelo_questionario (id_modelo, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('63600000-0000-0000-0000-000000000001', 1, 'Pergunta do modelo 36', 1, 1);

-- Projeto 1 com nota (alimenta relatórios, ranking e quarentena); projeto 2 livre,
-- sem instituição, para o envio de nota não cair no conflito institucional.
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade, id_area,
                             id_instituicao, is_check_in_realizado, is_fora_da_competicao) VALUES
  ('f3600000-0000-0000-0000-000000000001', 'C36-001', 'Com nota', 'e3600000-0000-0000-0000-000000000001',
   'b3600000-0000-0000-0000-000000000001', '93600000-0000-0000-0000-000000000001',
   'a3600000-0000-0000-0000-000000000001', true, false),
  ('f3600000-0000-0000-0000-000000000002', 'C36-002', 'Livre', 'e3600000-0000-0000-0000-000000000001',
   NULL, NULL, NULL, true, false);

INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado, id_questionario) VALUES
  ('c3600000-0000-0000-0000-0000000000a1', 'e3600000-0000-0000-0000-000000000001', NULL, true, NULL),
  ('c3600000-0000-0000-0000-0000000000a2', 'e3600000-0000-0000-0000-000000000001',
   'a3600000-0000-0000-0000-000000000001', true, NULL);
INSERT INTO public.avaliador_areas (id_usuario, id_evento, id_area) VALUES
  ('c3600000-0000-0000-0000-0000000000a1', 'e3600000-0000-0000-0000-000000000001', '93600000-0000-0000-0000-000000000001');

INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo) VALUES
  ('d3600000-0000-0000-0000-0000000000a1', 'c3600000-0000-0000-0000-0000000000a1',
   'e3600000-0000-0000-0000-000000000001', 'pareamento');

-- Duas avaliações: uma com tempo_presenca ISO e outra com texto lixo. É o par que
-- cobre a guarda por regex de fn_relatorio_indicadores_gerenciais e da irmã — sem a
-- linha malformada, o cast passaria por acaso.
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, id_questionario, nota_final, status,
                               tempo_presenca, tempo_submissao) VALUES
  ('53600000-0000-0000-0000-000000000001', 'f3600000-0000-0000-0000-000000000001',
   'c3600000-0000-0000-0000-0000000000a2', '73600000-0000-0000-0000-000000000001', 8.5, 'CONCLUIDA',
   '2026-11-20T10:00:00Z', '2026-11-20T10:07:00Z'),
  ('53600000-0000-0000-0000-000000000002', 'f3600000-0000-0000-0000-000000000001',
   'c3600000-0000-0000-0000-0000000000a1', '73600000-0000-0000-0000-000000000001', 6.0, 'CONCLUIDA',
   'ontem de manhã', NULL);
INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida) VALUES
  ('53600000-0000-0000-0000-000000000001', '83600000-0000-0000-0000-000000000001', 8),
  ('53600000-0000-0000-0000-000000000001', '83600000-0000-0000-0000-000000000002', 9),
  ('53600000-0000-0000-0000-000000000002', '83600000-0000-0000-0000-000000000001', 6),
  ('53600000-0000-0000-0000-000000000002', '83600000-0000-0000-0000-000000000002', 6);

INSERT INTO public.historico_impedimentos (id_usuario, id_projeto, tipo) VALUES
  ('c3600000-0000-0000-0000-0000000000a2', 'f3600000-0000-0000-0000-000000000002', 'ausencia'),
  ('c3600000-0000-0000-0000-0000000000a2', 'f3600000-0000-0000-0000-000000000001', 'conflito');

-- Trava de verdade para fn_enviar_avaliacao percorrer o corpo todo, não só a guarda.
INSERT INTO public.locks_ativos (id_lock, id_usuario, id_projeto, expira_em, is_voto_popular) VALUES
  ('43600000-0000-0000-0000-000000000001', 'c3600000-0000-0000-0000-0000000000a1',
   'f3600000-0000-0000-0000-000000000002', now() + interval '30 minutes', false);

INSERT INTO public.fila_atribuicoes_direcionadas (id_usuario, id_projeto, ordem, status) VALUES
  ('c3600000-0000-0000-0000-0000000000a1', 'f3600000-0000-0000-0000-000000000001', 1, 'pendente');

-- Código de acesso pendente, com o mesmo hash que fn_vincular_com_codigo confere.
INSERT INTO public.codigos_acesso (id_usuario, id_evento, codigo_hash, expira_em, max_tentativas) VALUES
  ('c3600000-0000-0000-0000-0000000000a2', 'e3600000-0000-0000-0000-000000000001',
   extensions.crypt(public.normalizar_codigo('C36ABC'), extensions.gen_salt('bf', 8)),
   now() + interval '15 minutes', 5);

-- Pareamento pendente para o Staff concluir.
INSERT INTO public.pareamentos_pendentes (codigo, auth_uid, id_evento, expira_em) VALUES
  ('C36PAR', 'd3600000-0000-0000-0000-0000000000a9', 'e3600000-0000-0000-0000-000000000001',
   now() + interval '10 minutes');

-- ===========================================================================
-- Sessões e o executor das chamadas
-- ===========================================================================
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

-- ordem: o que muda o estado vem depois do que só lê, e o que destrói vem por último
-- (admin_finalizar_evento revoga aparelhos; admin_reset_global apaga as avaliações).
CREATE TEMP TABLE chamadas (ordem int, nome text, sub text, sql text);

-- sub: NULL = visitante anônimo; os demais são o auth.uid() da sessão
INSERT INTO chamadas (ordem, nome, sub, sql) VALUES
-- -------------------------------------------------- 100: leitura pública (anon)
(100, 'fn_identidade_visual', NULL, $q$ SELECT public.fn_identidade_visual() $q$),
(101, 'fn_politica_seguranca', NULL, $q$ SELECT public.fn_politica_seguranca() $q$),
(102, 'fn_telao_resumo', NULL, $q$ SELECT public.fn_telao_resumo('e3600000-0000-0000-0000-000000000001') $q$),
-- -------------------------------------------------- 200: leitura do Admin
(200, 'fn_relatorio_projetos_completo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_relatorio_projetos_completo('e3600000-0000-0000-0000-000000000001') $q$),
(201, 'fn_relatorio_avaliadores_completo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_relatorio_avaliadores_completo('e3600000-0000-0000-0000-000000000001') $q$),
(202, 'fn_relatorio_ausencias_completo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_relatorio_ausencias_completo('e3600000-0000-0000-0000-000000000001') $q$),
(203, 'fn_relatorio_devolucoes_completo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_relatorio_devolucoes_completo('e3600000-0000-0000-0000-000000000001') $q$),
(204, 'fn_relatorio_voto_popular_completo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_relatorio_voto_popular_completo('e3600000-0000-0000-0000-000000000001') $q$),
(205, 'fn_relatorio_instituicoes_completo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_relatorio_instituicoes_completo('e3600000-0000-0000-0000-000000000001') $q$),
(206, 'fn_relatorio_indicadores_gerenciais', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.fn_relatorio_indicadores_gerenciais('e3600000-0000-0000-0000-000000000001') $q$),
-- com argumento nulo: o ramo "evento ativo" é outro caminho de código
(207, 'fn_relatorio_indicadores_gerenciais', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.fn_relatorio_indicadores_gerenciais(NULL) $q$),
(208, 'fn_relatorio_instituicoes_completo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_relatorio_instituicoes_completo(NULL) $q$),
(210, 'fn_projetos_situacao', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_projetos_situacao('e3600000-0000-0000-0000-000000000001') $q$),
(211, 'fn_feira_concluida', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.fn_feira_concluida('e3600000-0000-0000-0000-000000000001') $q$),
(212, 'fn_auditar_notas', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_auditar_notas('e3600000-0000-0000-0000-000000000001') $q$),
(213, 'fn_avaliacoes_do_questionario', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.fn_avaliacoes_do_questionario('73600000-0000-0000-0000-000000000001') $q$),
(214, 'admin_listar_questionarios_reaproveitaveis', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.admin_listar_questionarios_reaproveitaveis('e3600000-0000-0000-0000-000000000001') $q$),
(215, 'fn_memorial_evento', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.fn_memorial_evento('e3600000-0000-0000-0000-000000000001') $q$),
(216, 'fn_memorial_projeto', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.fn_memorial_projeto('f3600000-0000-0000-0000-000000000001', true) $q$),
(217, 'fn_memorial_por_codigo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.fn_memorial_por_codigo('C36-001', 'e3600000-0000-0000-0000-000000000001') $q$),
(218, 'fn_meu_perfil', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.fn_meu_perfil() $q$),
(219, 'fn_situacao_vinculos', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT * FROM public.fn_situacao_vinculos('e3600000-0000-0000-0000-000000000001') $q$),
-- -------------------------------------------------- 300: avaliador com aparelho
(300, 'fn_meu_perfil', 'd3600000-0000-0000-0000-0000000000a1', $q$ SELECT public.fn_meu_perfil() $q$),
(301, 'fn_enviar_avaliacao', 'd3600000-0000-0000-0000-0000000000a1', $q$ SELECT public.fn_enviar_avaliacao('c3600000-0000-0000-0000-0000000000a1', 'f3600000-0000-0000-0000-000000000002', '73600000-0000-0000-0000-000000000001', '[{"id_pergunta":"83600000-0000-0000-0000-000000000001","nota":7},{"id_pergunta":"83600000-0000-0000-0000-000000000002","nota":8}]'::jsonb, 'Parecer do contrato 36', '2026-11-20T09:00:00Z') $q$),
(302, 'sortear_proximo_projeto', 'd3600000-0000-0000-0000-0000000000a1', $q$ SELECT public.sortear_proximo_projeto('c3600000-0000-0000-0000-0000000000a1', 'e3600000-0000-0000-0000-000000000001') $q$),
(303, 'fn_registrar_impedimento', 'd3600000-0000-0000-0000-0000000000a1', $q$ SELECT public.fn_registrar_impedimento('f3600000-0000-0000-0000-000000000001', 'conflito') $q$),
(304, 'fn_assumir_item_fila', 'd3600000-0000-0000-0000-0000000000a1', $q$ SELECT public.fn_assumir_item_fila() $q$),
(310, 'fn_solicitar_pareamento', 'd3600000-0000-0000-0000-0000000000aa', $q$ SELECT public.fn_solicitar_pareamento() $q$),
-- -------------------------------------------------- 400: Staff na portaria
(400, 'fn_vincular_conta_staff', 'd3600000-0000-0000-0000-000000000051', $q$ SELECT public.fn_vincular_conta_staff() $q$),
(401, 'fn_check_in_projeto', 'd3600000-0000-0000-0000-000000000051', $q$ SELECT public.fn_check_in_projeto('f3600000-0000-0000-0000-000000000001', true) $q$),
(402, 'fn_gerar_codigo_acesso', 'd3600000-0000-0000-0000-000000000051', $q$ SELECT public.fn_gerar_codigo_acesso('c3600000-0000-0000-0000-0000000000a1') $q$),
(403, 'fn_parear_dispositivo', 'd3600000-0000-0000-0000-000000000051', $q$ SELECT public.fn_parear_dispositivo('C36PAR', 'c3600000-0000-0000-0000-0000000000a2') $q$),
(404, 'fn_desvincular_dispositivo', 'd3600000-0000-0000-0000-000000000051', $q$ SELECT public.fn_desvincular_dispositivo('c3600000-0000-0000-0000-0000000000a2') $q$),
-- -------------------------------------------------- 500: celular anônimo
(500, 'fn_vincular_com_codigo', 'd3600000-0000-0000-0000-0000000000a9', $q$ SELECT public.fn_vincular_com_codigo('bia36@teste.local', 'C36ABC') $q$),
(501, 'fn_autocadastro_avaliador', NULL, $q$ SELECT public.fn_autocadastro_avaliador('e3600000-0000-0000-0000-000000000001', 'Novo 36', 'novo36@teste.local', 'a3600000-0000-0000-0000-000000000001', NULL, ARRAY['93600000-0000-0000-0000-000000000001']::uuid[]) $q$),
-- -------------------------------------------------- 600: coordenação escrevendo
(600, 'admin_salvar_instituicoes', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_salvar_instituicoes('e3600000-0000-0000-0000-000000000001', '[{"nome":"IFMS Nova 36","sigla":"IN36","campus":"Campo Grande","codigo":"in36","nivel":"medio","descricao":"","area_tematica":"Computação 36","id_existente":null}]'::jsonb) $q$),
(601, 'admin_salvar_modalidades', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_salvar_modalidades('e3600000-0000-0000-0000-000000000001', '[{"nome":"Modalidade Nova 36","codigo":"mn36","nivel":"medio","descricao":"","id_existente":null}]'::jsonb) $q$),
(602, 'admin_salvar_avaliadores', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_salvar_avaliadores('e3600000-0000-0000-0000-000000000001', '[{"nome":"Carlos 36","email":"carlos36@teste.local","id_instituicao":"a3600000-0000-0000-0000-000000000001","ids_areas":["93600000-0000-0000-0000-000000000001"],"ids_modalidades_bloqueadas":[]}]'::jsonb) $q$),
(603, 'admin_salvar_staff', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_salvar_staff('e3600000-0000-0000-0000-000000000001', '[{"nome":"Staff Novo 36","email":"staffnovo36@teste.local","papel":"STAFF"}]'::jsonb) $q$),
(604, 'admin_atualizar_avaliador', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_atualizar_avaliador('c3600000-0000-0000-0000-0000000000a1', 'e3600000-0000-0000-0000-000000000001', 'Ana 36 Editada', 'ava36@teste.local', 'a3600000-0000-0000-0000-000000000001', ARRAY['b3600000-0000-0000-0000-000000000001']::uuid[], ARRAY['93600000-0000-0000-0000-000000000001']::uuid[]) $q$),
(605, 'admin_atualizar_staff', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_atualizar_staff('c3600000-0000-0000-0000-000000000051', 'Staff 36 Editado', 'staff36@teste.local') $q$),
(606, 'admin_bloquear_modalidade_avaliador', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_bloquear_modalidade_avaliador('c3600000-0000-0000-0000-0000000000a1', 'e3600000-0000-0000-0000-000000000001', 'b3600000-0000-0000-0000-000000000001', true) $q$),
(607, 'admin_vincular_questionario_avaliador', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_vincular_questionario_avaliador('c3600000-0000-0000-0000-0000000000a2', 'e3600000-0000-0000-0000-000000000001', '73600000-0000-0000-0000-000000000002') $q$),
(608, 'admin_salvar_questionario', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_salvar_questionario(NULL, 'e3600000-0000-0000-0000-000000000001', 'Questionário Novo 36', 0, 10, '[{"texto_pergunta":"Nova pergunta 36","descricao_lembrete":"","peso_calculo":1,"peso_desempate":1}]'::jsonb) $q$),
(609, 'admin_copiar_questionario', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_copiar_questionario('63600000-0000-0000-0000-000000000001', 'e3600000-0000-0000-0000-000000000001') $q$),
(610, 'admin_salvar_questionario_como_modelo', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_salvar_questionario_como_modelo('73600000-0000-0000-0000-000000000001') $q$),
(611, 'admin_salvar_modelo_questionario', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_salvar_modelo_questionario('63600000-0000-0000-0000-000000000001', 'Modelo 36 Editado', 'descrição', 0, 10, '[{"texto_pergunta":"Pergunta do modelo 36","descricao_lembrete":"","peso_calculo":1,"peso_desempate":1}]'::jsonb) $q$),
(612, 'admin_marcar_questionario_voto_popular', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_marcar_questionario_voto_popular('73600000-0000-0000-0000-000000000002', true) $q$),
(613, 'admin_reclassificar_questionario_voto_popular', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_reclassificar_questionario_voto_popular('73600000-0000-0000-0000-000000000002', true) $q$),
(614, 'admin_atribuir_banca', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_atribuir_banca('f3600000-0000-0000-0000-000000000002', ARRAY['c3600000-0000-0000-0000-0000000000a2']::uuid[]) $q$),
(615, 'admin_enfileirar_projetos', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_enfileirar_projetos('c3600000-0000-0000-0000-0000000000a2', ARRAY['f3600000-0000-0000-0000-000000000001']::uuid[]) $q$),
(616, 'sortear_projeto', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.sortear_projeto('c3600000-0000-0000-0000-0000000000a2', 'e3600000-0000-0000-0000-000000000001') $q$),
(617, 'admin_desbloquear_trava', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_desbloquear_trava('43600000-0000-0000-0000-000000000001') $q$),
(618, 'admin_desbloquear_todos', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_desbloquear_todos() $q$),
(619, 'admin_remover_quarentena', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_remover_quarentena('f3600000-0000-0000-0000-000000000001', 'contrato 36') $q$),
(620, 'admin_remover_quarentena_evento', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_remover_quarentena_evento('e3600000-0000-0000-0000-000000000001', 'contrato 36') $q$),
(621, 'admin_salvar_configuracoes_seguranca', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_salvar_configuracoes_seguranca(false, 30) $q$),
(622, 'admin_restaurar_modelos_originais', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_restaurar_modelos_originais() $q$),
(630, 'excluir_avaliacao', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.excluir_avaliacao('53600000-0000-0000-0000-000000000002', 'contrato 36') $q$),
(631, 'restaurar_avaliacao', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.restaurar_avaliacao('53600000-0000-0000-0000-000000000002', 'contrato 36') $q$),
-- -------------------------------------------------- 800: remoções
(800, 'admin_remover_avaliador_evento', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_remover_avaliador_evento('c3600000-0000-0000-0000-0000000000a2', 'e3600000-0000-0000-0000-000000000001') $q$),
(801, 'admin_excluir_questionario', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_excluir_questionario('73600000-0000-0000-0000-000000000002') $q$),
(802, 'admin_excluir_modelo_questionario', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_excluir_modelo_questionario('63600000-0000-0000-0000-000000000001') $q$),
(803, 'admin_excluir_instituicao', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_excluir_instituicao('a3600000-0000-0000-0000-000000000001') $q$),
(804, 'admin_excluir_modalidade', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_excluir_modalidade('b3600000-0000-0000-0000-000000000001') $q$),
(805, 'admin_excluir_staff', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_excluir_staff('c3600000-0000-0000-0000-000000000051') $q$),
-- -------------------------------------------------- 900: o que encerra e o que zera
(900, 'admin_finalizar_evento', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_finalizar_evento('e3600000-0000-0000-0000-000000000001') $q$),
(910, 'admin_reset_global', 'd3600000-0000-0000-0000-0000000000ad', $q$ SELECT public.admin_reset_global('e3600000-0000-0000-0000-000000000001') $q$);

/*
 * Roda cada chamada na sessão dela e devolve só o que falhou por SQL quebrado.
 * A lista vai para arrays antes do laço: dentro dele a sessão vira `anon` ou
 * `authenticated`, que não têm permissão na tabela temporária.
 */
CREATE FUNCTION pg_temp.rodar_chamadas() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_nomes text[];
  v_subs text[];
  v_sqls text[];
  v_falhas text := '';
  v_estado text;
  v_msg text;
  i int;
BEGIN
  SELECT array_agg(c.nome ORDER BY c.ordem, c.nome),
         array_agg(c.sub ORDER BY c.ordem, c.nome),
         array_agg(c.sql ORDER BY c.ordem, c.nome)
    INTO v_nomes, v_subs, v_sqls
    FROM chamadas c;

  FOR i IN 1 .. coalesce(array_length(v_nomes, 1), 0) LOOP
    PERFORM pg_temp.como(v_subs[i]);
    BEGIN
      EXECUTE v_sqls[i];
    EXCEPTION WHEN OTHERS THEN
      v_estado := SQLSTATE;
      v_msg := SQLERRM;
      -- Classe 42 é "syntax error or access rule violation": coluna, função, tabela
      -- ou tipo que não existe. 42501 (sem permissão) é resposta legítima de guarda;
      -- recusa de regra (P0001) e de dado (classes 22 e 23) também. O resto é bug.
      IF v_estado LIKE '42%' AND v_estado <> '42501' THEN
        v_falhas := v_falhas || format(E'\n  %s [%s] %s', v_nomes[i], v_estado, v_msg);
      END IF;
    END;
  END LOOP;

  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_falhas;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Toda fn_relatorio_* é chamada aqui: um relatório novo não entra sem cobertura
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(p.proname, ', ' ORDER BY p.proname), '')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_relatorio\_%'
      AND NOT EXISTS (SELECT 1 FROM chamadas c WHERE c.nome = p.proname)),
  '', 'toda função fn_relatorio_* tem chamada de fumaça neste teste');

-- ---------------------------------------------------------------------------
-- 6. Toda RPC que o front chama é exercitada, não só conferida no catálogo
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT coalesce(string_agg(r.nome, ', ' ORDER BY r.nome), '')
     FROM rpcs_do_front r
    WHERE NOT EXISTS (SELECT 1 FROM chamadas c WHERE c.nome = r.nome)),
  '', 'toda RPC chamada pelo front tem chamada de fumaça neste teste');

-- ---------------------------------------------------------------------------
-- 7. Nenhuma delas falha por SQL quebrado (classe 42, menos 42501)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.rodar_chamadas(), '',
  'nenhuma RPC do front falha por coluna, função ou tipo inexistente');

RESET role;

SELECT * FROM finish();
ROLLBACK;
