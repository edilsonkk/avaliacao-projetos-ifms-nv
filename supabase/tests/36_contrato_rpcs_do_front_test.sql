-- Contrato entre o front-end e o banco: toda RPC que `src/` chama por nome precisa existir, com a
-- permissão certa. É a costura que nenhum outro teste cruza — no Vitest o banco é falso, e nos
-- outros testes pgTAP não existe interface, então um `rpc()` com nome errado passava pelos dois.
--
-- A lista abaixo é cobrada nas duas direções: a guarda `rpc-no-contrato` de
-- `scripts/guardas-auditoria.mjs` recusa o lint se `src/` chamar uma RPC que não está aqui.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

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

SELECT * FROM finish();
ROLLBACK;
