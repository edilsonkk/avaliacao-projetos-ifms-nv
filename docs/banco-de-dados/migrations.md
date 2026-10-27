# Migrations

`supabase/migrations/` é a **fonte da verdade** do banco. Toda mudança de estrutura, função, view ou permissão entra
como uma nova migration. Nunca altere o banco só pelo painel do Supabase.

## Como criar

1. Gere o arquivo com a CLI (cria o nome com timestamp de 14 dígitos):
   ```bash
   npx supabase@2.122.0 migration new descricao_em_snake_case
   ```
   Padrão obrigatório: `AAAAMMDDHHMMSS_descricao_em_snake_case.sql`, versão única. O CI rejeita nomes fora do padrão.
2. Cabeçalho com `MIGRATION`, `DESCRIÇÃO`, pré-requisitos e `APLICAÇÃO: supabase db push`. Siga o modelo das
   migrations `20261026*`.
3. **Idempotente**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION/VIEW`,
   `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
4. **Proibido** (o CI rejeita):
   - `DELETE FROM tabela;` sem `WHERE` (use `WHERE id IS NOT NULL`);
   - `TRUNCATE`;
   - `CREATE INDEX CONCURRENTLY` (o `db push` roda cada arquivo numa transação).
5. Ao criar tabela ou função, defina RLS e `GRANT`/`REVOKE` na mesma migration
   ([segurança](../arquitetura/seguranca.md)).
6. Ao mudar colunas usadas pelo PostgREST, recarregue o schema cache no fim do arquivo:
   `NOTIFY pgrst, 'reload schema';`.
7. Atualize `supabase/schema.sql` e a documentação afetada (modelo de dados, funções, regras de negócio).
8. Se a migration exige mudança no front-end, descreva isso no cabeçalho e entregue as duas no mesmo PR.
9. **Nunca edite nem renomeie uma migration já aplicada.** Para corrigir, crie outra.

## Como aplicar

Pelo workflow `supabase-migrations.yml` ([CI/CD](../operacao/ci-cd-e-deploy.md#migrations-do-banco)):

| Evento | O que acontece |
|---|---|
| Pull request | Só validação estática (nomes, `DELETE` sem `WHERE`, `TRUNCATE`) |
| Merge em `main` | `supabase db push`: aplica as migrations que o banco ainda não registrou |
| Manual (*Actions → Run workflow*) | `dry_run = true` mostra o que seria aplicado; `false` aplica |

O job de aplicação só roda quando a variável do repositório `SUPABASE_DB_PUSH_ENABLED` vale `true`. Ela existe para
impedir a reexecução das migrations antigas antes da [transição](#transição-para-supabase-db-push).

**Nunca** aplique migrations pelo SQL Editor do painel: o banco não registra a aplicação e o próximo `db push` tenta
executá-la de novo.

Para conferir o estado a partir da sua máquina:
```bash
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref <project-ref>
npx supabase@2.122.0 migration list          # colunas Local x Remote
npx supabase@2.122.0 db push --dry-run       # o que seria aplicado
```

## Transição para `supabase db push`

Feita **uma única vez**. Até 2026-10-27 as migrations eram coladas no SQL Editor, então o banco de produção não tem
o histórico (`supabase_migrations.schema_migrations`). Sem esta etapa, o primeiro `db push` tentaria executar as 22
migrations de novo.

Em 2026-10-27 os arquivos foram renomeados para o padrão de 14 dígitos. A ordem dentro de cada dia foi definida pelas
dependências entre eles (ex.: a versão final de `admin_reset_global` está em `20261024020000`).

1. **Descubra a última migration de fato executada no banco.** Não presuma que as `20261026*` foram aplicadas: o
   PRD as lista como pendentes. Confira no SQL Editor:
   ```sql
   SELECT proname FROM pg_proc WHERE proname IN ('is_admin', 'fn_enviar_avaliacao');       -- 20261026000000 / 010000
   SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'rls_%'; -- 20261026000000
   SELECT has_function_privilege('anon', 'public.admin_reset_global(uuid)', 'EXECUTE');    -- false após 030000
   SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'usuarios' AND column_name = 'senha_hash';                            -- 0 após 020000
   ```
   Resolva também a [pendência](#pendências) de `usuarios.id_evento`.
2. **Faça um backup** do banco (Supabase → Database → Backups, ou `pg_dump`).
3. Rode o script, informando a última versão **confirmada** no passo 1. Ele marca como aplicadas, **sem
   executar**, só as migrations até essa versão:
   ```bash
   SUPABASE_PROJECT_REF=<project-ref> scripts/supabase/alinhar-historico-migrations.sh <ultima_versao_aplicada>
   ```
   As posteriores ficam pendentes e serão aplicadas pelo `db push`.
   Se o `migration list` mostrar versões remotas antigas (ex.: `20261024`), marque-as como revertidas:
   `npx supabase@2.122.0 migration repair --status reverted <versao>`.
4. Confira: `npx supabase@2.122.0 db push --dry-run` deve informar que o banco está atualizado.
5. Configure os secrets do ambiente `production` (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
   `SUPABASE_PROJECT_REF`) e crie a variável `SUPABASE_DB_PUSH_ENABLED = true`
   (*Settings → Secrets and variables → Actions → Variables*).
6. Rode o workflow manualmente com `dry_run = true` e confira o log.

## Pendências

> ⚠️ **`usuarios.id_evento`**: a migration `20261026020000_restringir_leitura_sensivel.sql` concede
> `SELECT (..., id_evento, ...)` em `usuarios`, mas nenhuma migration cria essa coluna. Em um banco novo, essa
> migration **falha**. Verifique em produção:
> ```sql
> SELECT column_name FROM information_schema.columns
> WHERE table_schema = 'public' AND table_name = 'usuarios' ORDER BY ordinal_position;
> ```
> - Se a coluna **existe** em produção (criada fora das migrations): crie uma migration
>   `20261026015000_usuarios_id_evento.sql` com `ADD COLUMN IF NOT EXISTS id_evento uuid` e marque-a como aplicada
>   na transição.
> - Se **não existe**: a `20261026020000` nunca foi aplicada com sucesso. Remova `id_evento` do `GRANT` antes da
>   transição e aplique-a pelo `db push`.

## `schema.sql`

`supabase/schema.sql` é o DDL consolidado **para leitura**: o estado final de todas as migrations num só arquivo. Ele
**não é aplicado** no banco. Se divergir de uma migration, a migration prevalece.

Ao criar uma migration, reflita o resultado final no `schema.sql`: altere o `CREATE TABLE`, substitua a função ou
policy e remova o que foi apagado. Não acrescente a migration no fim do arquivo.

## Rollback

As migrations são idempotentes e não há migrations de reversão. Para desfazer uma mudança, crie uma **nova**
migration que reverta o efeito. Em perda de dados, restaure o backup.

## Histórico

| Migration | Assunto |
|---|---|
| `20261019000000_schema.sql` | DDL inicial |
| `20261021000000_atribuicoes_e_bancas.sql` | Bancas simultâneas e fila direcionada |
| `20261022000000_admin_reset_global_evento.sql` | Reset global por evento |
| `20261022010000_eventos_campos_data.sql` | Datas e horários do evento |
| `20261023000000_remover_repescagem.sql` | Remove a repescagem de ausentes |
| `20261024000000_aliases_e_modalidades_niveis.sql` | Aliases e modalidades com níveis |
| `20261024010000_instituicoes_modalidades_evento_e_reset.sql` | Instituições/modalidades por evento e reset |
| `20261024020000_areas_tematicas_evento_e_ajustes.sql` | Áreas temáticas por evento |
| `20261024030000_bloqueio_modalidades_sorteio_e_atribuicao.sql` | Bloqueio por modalidade no sorteio |
| `20261024040000_bloqueio_modalidades_e_cota_estrita.sql` | Bloqueio por modalidade e cota estrita |
| `20261024050000_avaliador_areas_e_afinidade_tematica.sql` | Áreas do avaliador e afinidade no sorteio |
| `20261025000000_garantir_data_evento_persistente.sql` | Garante colunas de data/horário do evento |
| `20261025010000_corrigir_views_schema_fk_projetos.sql` | Views usando FKs de projetos |
| `20261025020000_funcao_exclusao_avaliacao_rpc.sql` | `excluir_avaliacao` / `restaurar_avaliacao` |
| `20261025030000_sorteio_impedir_mesmo_avaliador_soft_delete.sql` | Sorteio não repete avaliador |
| `20261025040000_relatorios_completos_e_indicadores.sql` | `tempo_submissao` e views de relatório |
| `20261025050000_relatorios_functions_rpc.sql` | Funções `fn_relatorio_*` |
| `20261025060000_ativacao_rls_emergencial.sql` | RLS emergencial (substituída pela `20261026000000`) |
| `20261026000000_rls_admin_definitivo.sql` | Modelo definitivo de RLS |
| `20261026010000_rpc_enviar_avaliacao.sql` | `fn_enviar_avaliacao` |
| `20261026020000_restringir_leitura_sensivel.sql` | Restrição de leitura por coluna |
| `20261026030000_proteger_funcoes_admin.sql` | Funções admin só para `authenticated` |
