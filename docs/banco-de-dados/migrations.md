# Migrations

`supabase/migrations/` é a **fonte da verdade** do banco. Toda mudança de estrutura, função, view ou permissão entra
como uma nova migration. Nunca altere o banco só pelo painel do Supabase.

## Como criar

1. Nome: `AAAAMMDDHHMMSS_descricao_em_snake_case.sql`, com timestamp completo de 14 dígitos
   (ex.: `20261027140000_adicionar_coluna_x.sql`).
2. Cabeçalho com `MIGRATION`, `DESCRIÇÃO`, pré-requisitos e forma de aplicação. Siga o modelo das migrations
   `20261026*`.
3. **Idempotente**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION/VIEW`,
   `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
4. **Proibido**:
   - `DELETE FROM tabela;` sem `WHERE` (use `WHERE id IS NOT NULL`);
   - `TRUNCATE`.
   O CI rejeita os dois.
5. Ao criar tabela ou função, defina RLS e `GRANT`/`REVOKE` na mesma migration
   ([segurança](../arquitetura/seguranca.md)).
6. Ao mudar colunas usadas pelo PostgREST, recarregue o schema cache: `NOTIFY pgrst, 'reload schema';`.
7. Atualize `supabase/schema.sql` e a documentação afetada (modelo de dados, funções, regras de negócio).
8. Se a migration exige mudança no front-end, descreva isso no cabeçalho e entregue as duas no mesmo PR.

## Como aplicar

> ⚠️ **Estado atual a confirmar.** O workflow `supabase-migrations.yml` executa `supabase db push` em push para
> `main`. Porém, as migrations recentes dizem "o CI não aplica migrations; cole no SQL Editor do Supabase". Além
> disso, os arquivos antigos usam prefixo só de data (ex.: vários `20261024_*.sql`), o que gera versões repetidas
> para a Supabase CLI. Até isso ser resolvido, a forma em uso é a manual:
>
> 1. Abrir o SQL Editor do projeto no Supabase.
> 2. Colar e executar o arquivo da migration inteiro.
> 3. Conferir o resultado e registrar no PR que foi aplicada.

Detalhes do pipeline: [CI/CD e deploy](../operacao/ci-cd-e-deploy.md#migrations-do-banco).

## `schema.sql`

`supabase/schema.sql` é um DDL consolidado **para leitura** (entender o banco sem ler 20+ migrations). Ele não é
aplicado automaticamente.

> ⚠️ Hoje ele está defasado em relação às migrations `20261026*`. Ainda contém `usuarios.senha_hash` e não inclui
> `is_admin()`, `fn_enviar_avaliacao` nem as novas policies. Em caso de dúvida, as migrations prevalecem.

## Rollback

As migrations são idempotentes e não há migrations de reversão versionadas. Para desfazer uma mudança, crie uma
**nova** migration que reverta o efeito. Nunca edite uma migration já aplicada.

## Histórico

| Migration | Assunto |
|---|---|
| `20261019_schema.sql` | DDL inicial |
| `20261021_atribuicoes_e_bancas.sql` | Bancas simultâneas e fila direcionada |
| `20261022_admin_reset_global_evento.sql` | Reset global por evento |
| `20261022_eventos_campos_data.sql` | Datas e horários do evento |
| `20261023_remover_repescagem.sql` | Remove a repescagem de ausentes |
| `20261024_aliases_e_modalidades_niveis.sql` | Aliases e modalidades com níveis |
| `20261024_areas_tematicas_evento_e_ajustes.sql` | Áreas temáticas por evento |
| `20261024_avaliador_areas_e_afinidade_tematica.sql` | Áreas do avaliador e afinidade no sorteio |
| `20261024_bloqueio_modalidades_e_cota_estrita.sql` | Bloqueio por modalidade e cota estrita |
| `20261024_bloqueio_modalidades_sorteio_e_atribuicao.sql` | Bloqueio por modalidade no sorteio |
| `20261024_instituicoes_modalidades_evento_e_reset.sql` | Instituições/modalidades por evento e reset |
| `20261025_ativacao_rls_emergencial.sql` | RLS emergencial (substituída pela `20261026000000`) |
| `20261025_corrigir_views_schema_fk_projetos.sql` | Views usando FKs de projetos |
| `20261025_funcao_exclusao_avaliacao_rpc.sql` | `excluir_avaliacao` / `restaurar_avaliacao` |
| `20261025_garantir_data_evento_persistente.sql` | Garante colunas de data/horário do evento |
| `20261025_relatorios_completos_e_indicadores.sql` | `tempo_submissao` e views de relatório |
| `20261025_relatorios_functions_rpc.sql` | Funções `fn_relatorio_*` |
| `20261025_sorteio_impedir_mesmo_avaliador_soft_delete.sql` | Sorteio não repete avaliador |
| `20261026000000_rls_admin_definitivo.sql` | Modelo definitivo de RLS |
| `20261026010000_rpc_enviar_avaliacao.sql` | `fn_enviar_avaliacao` |
| `20261026020000_restringir_leitura_sensivel.sql` | Restrição de leitura por coluna |
| `20261026030000_proteger_funcoes_admin.sql` | Funções admin só para `authenticated` |
