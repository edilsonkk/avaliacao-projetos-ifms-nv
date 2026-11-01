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
7. Regenere o `supabase/schema.sql` ([como](#schemasql)), crie ou ajuste testes em `supabase/tests/` e atualize a
   documentação afetada (modelo de dados, funções, regras de negócio).
8. Se a migration exige mudança no front-end, descreva isso no cabeçalho e entregue as duas no mesmo PR.
9. Garanta compatibilidade com a versão anterior do front-end ([expand/contract](#compatibilidade-com-a-versão-anterior-expandcontract)).
10. Teste localmente com `npx supabase@2.122.0 db reset` antes de abrir o PR.
11. **Nunca edite nem renomeie uma migration já aplicada em produção.** Para corrigir, crie outra.
12. **Nunca crie uma segunda FK de uma tabela para a mesma tabela** (ex.: uma coluna de auditoria `*_por` apontando
    para `usuarios` numa tabela que já tem `id_usuario`). O PostgREST passa a recusar o embed `usuarios(...)` com
    `PGRST201` e as telas param. Guarde o id sem FK e documente no `COMMENT`. Coberto por
    `supabase/tests/09_embeds_sem_ambiguidade_test.sql` (aconteceu com `locks_ativos.atribuido_por`, corrigido em
    `20261029235000`).

## Compatibilidade com a versão anterior (expand/contract)

Na publicação de uma versão, as migrations são aplicadas **antes** do novo front-end. Por alguns minutos, e em
qualquer rollback do front-end, a versão **anterior** do front-end roda sobre o banco **novo**. Por isso, toda
migration precisa ser compatível com o front-end da versão anterior:

| Mudança | Como fazer |
|---|---|
| Nova coluna | Adicione como opcional (`NULL` ou com `DEFAULT`). O front-end antigo a ignora |
| Renomear coluna | Versão N: crie a nova e mantenha as duas sincronizadas. Versão N+1: o front-end usa a nova. Versão N+2: remova a antiga |
| Remover coluna/tabela/função | Primeiro uma versão em que o front-end para de usar; depois a migration que remove |
| Mudar assinatura de RPC | Crie uma função nova (ou um novo parâmetro com `DEFAULT`); remova a antiga numa versão posterior |
| Restringir permissão (RLS/GRANT) | Garanta que a versão anterior do front-end não dependa do que será fechado |

Assim, voltar o front-end para a versão anterior nunca exige desfazer o banco.

## Como aplicar

Só pelo workflow `supabase-migrations.yml` ([CI/CD](../operacao/ci-cd-e-deploy.md#migrations-do-banco)):

| Evento | O que acontece |
|---|---|
| Pull request | Validação estática (nomes, `DELETE` sem `WHERE`, `TRUNCATE`, `CONCURRENTLY`) |
| Publicação de versão (merge do PR de release) | Backup criptografado do banco e `supabase db push` |
| Manual (*Actions → Run workflow*) | `dry_run = true` (padrão) mostra o que seria aplicado; `false` faz backup e aplica |

**Nunca** aplique migrations pelo SQL Editor do painel: o banco não registra a aplicação e o próximo `db push` tenta
executá-la de novo. No ambiente local, use `npx supabase@2.122.0 db reset` (recria o banco local com todas as
migrations e o `seed.sql`).

Para conferir o estado de produção a partir da sua máquina:
```bash
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref <project-ref>
npx supabase@2.122.0 migration list          # colunas Local x Remote
npx supabase@2.122.0 db push --dry-run       # o que seria aplicado
```

## Recriar o banco remoto do zero

Só enquanto **não houver dados reais**. Apaga tudo no banco e aplica todas as migrations, registrando o histórico.
Foi o procedimento usado para inaugurar o `db push` em 2026-10-27, quando o projeto ainda era de teste.

```bash
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref <project-ref>
npx supabase@2.122.0 db reset --linked --no-seed     # --no-seed: nunca levar o seed local para o remoto
npx supabase@2.122.0 migration list                  # todas as versões devem aparecer em Local e Remote
```

Depois, recrie o vínculo do Admin, porque a tabela `usuarios` volta vazia
([criar Admin](../arquitetura/configuracao.md#criar-um-administrador)).

Com dados reais, **nunca** use `db reset --linked`. Corrija com uma nova migration.

## `schema.sql`

`supabase/schema.sql` é o DDL do schema `public` **gerado a partir do banco local**, ou seja, o estado final de todas
as migrations. Serve para leitura e **não é aplicado** no banco. Não edite à mão: depois de criar uma migration,
regenere:

```bash
npx supabase@2.122.0 db reset
npx supabase@2.122.0 db dump --local -s public -f /tmp/dump.sql
# mantenha o cabeçalho de supabase/schema.sql e substitua o resto pelo conteúdo de /tmp/dump.sql
```

## Testes do banco

Regras de acesso (RLS, `GRANT`, guards em funções) têm testes pgTAP em `supabase/tests/`. Ao mudar permissões, crie
ou ajuste um teste e rode `npx supabase@2.122.0 test db` ([segurança](../arquitetura/seguranca.md#testes-de-segurança)).

## Rollback

Não há migrations de reversão. Para desfazer uma mudança, crie uma **nova** migration que reverta o efeito. Em perda
de dados, restaure o backup gerado antes do `db push` ([restaurar backup](../operacao/ci-cd-e-deploy.md#restaurar-um-backup)).

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
| `20261028200000_proteger_funcoes_admin_e_relatorios.sql` | Guard `is_admin()` em todas as `admin_*`; relatórios `SECURITY INVOKER` |
| `20261028210000_identidade_avaliador_staff.sql` | Vínculo do celular ao avaliador, códigos de acesso, Staff com conta, parâmetros por evento, RPCs de autocadastro e Telão |
| `20261028220000_rls_por_papel.sql` | RLS por papel; sorteio e notas só em nome do avaliador do aparelho |
| `20261029200000_chave_natural_projetos.sql` | `UNIQUE (id_evento, codigo_projeto)` para o upsert da importação de projetos |
| `20261029210000_admin_desbloquear_trava.sql` | `admin_desbloquear_trava(p_id_lock)`: Admin libera a trava de um avaliador só |
| `20261029220000_resolver_quarentena.sql` | `projetos.quarentena_resolvida_em/_por`; a view ignora divergência já aceita até chegar avaliação nova |
| `20261029230000_atribuicao_forcada.sql` | Atribuição forçada validada no banco; `locks_ativos.atribuido_por` |
| `20261029235000_remover_fk_ambiguas.sql` | Hotfix: remove FKs de auditoria que deixavam o embed `usuarios(...)` ambíguo |
| `20261029240000_excluir_restaurar_avaliacao.sql` | Cancelar/restaurar recalculam a quarentena; restaurar respeita a cota; `cancelada_em/_por` |
| `20261030000000_gestor_avaliadores.sql` | Escritas do Gestor de Avaliadores por função: remover só do evento (nunca apaga notas), importação sem rebaixar Admin/Staff, edição atômica |
| `20261030010000_gestor_staff.sql` | Escritas do Gestor da Equipe Staff por função: cadastro/importação sem mudar o papel de Admin/Avaliador, sem descredenciar; exclusão só de Staff |
| `20261030020000_gestor_questionarios.sql` | `perguntas_questionario.descricao_lembrete`; questionários gravados por função, sem apagar notas por critério; questionário usado só muda o título |
| `20261030030000_gestor_instituicoes.sql` | Trigger de `nome_normalizado` (fim das duplicatas); importação por função; exclusão recusada se houver vínculo |
| `20261030040000_gestor_modalidades.sql` | Modalidades por função: reimportação sem erro, apelidos do De-Para; exclusão recusada se houver projeto ou bloqueio |
| `20261030050000_normalizar_nome_igual_front.sql` | `fn_normalizar_nome` igual ao front (sem `unaccent`): instituição com travessão na importação de projetos não fica mais sem vínculo; autocadastro usa a mesma chave |
| `20261030060000_classificacao.sql` | `view_ranking_top3` sem projetos fora da competição, com `posicao` (`RANK()`, empate divide) e `em_quarentena`; sem "Geral"/"Multidisciplinar" inventados |
| `20261030070000_relatorios.sql` | `fn_relatorio_projetos/avaliadores/ausencias_completo` voltam a funcionar (liam colunas inexistentes de `projetos`); LANGUAGE sql; evento obrigatório |
| `20261030080000_telao.sql` | `fn_telao_resumo` com nome/data/horário do evento, meta pela cota de cada projeto presente, avaliações na meta e quarentena pendente |
| `20261030090000_telao_contagens.sql` | `fn_telao_resumo`: avaliadores credenciados só com papel Avaliador (sem Staff) e nova chave `em_andamento_na_meta` |
| `20261030100000_atribuicao_sem_staff.sql` | `fn_motivo_inelegivel` recusa quem não tem papel Avaliador: banca e fila não aceitam mais Staff credenciado |
| `20261030110000_relatorio_cota_projeto.sql` | `fn_relatorio_projetos_completo` devolve `cota_avaliacoes` (customizada ou padrão do evento) para a meta dos Indicadores |
| `20261030120000_avaliacao_finalizada.sql` | `avaliacao_finalizada` no `fn_telao_resumo`; `fn_feira_concluida` ignora projetos sem check-in; cronômetro do Telão usa `data_evento` |
| `20261030130000_sorteio_concorrente.sql` | `sortear_proximo_projeto` reserva a linha do projeto (`FOR UPDATE SKIP LOCKED`) e reconfere trava/cota: sorteios simultâneos não estouram a cota |
| `20261031010000_seguranca_matriz_papeis.sql` | Revisão de segurança, etapa 1: trava da fila e ausência/conflito só por função (`fn_assumir_item_fila`, `fn_registrar_impedimento`); CPF/celular fora da leitura; Staff credencia só avaliadores; `anon` sem gravação em cadastros |
| `20261031020000_seguranca_sessao.sql` | Revisão de segurança, etapa 2: celular só vale no evento ativo e credenciado; código de acesso sem vazamento por tempo e credencia; autocadastro com resposta neutra |
| `20261031030000_mfa_e_sessao.sql` | `configuracoes_seguranca`: MFA do Admin (`is_admin()` exige `aal2` quando ligado) e tempo de expiração de sessão; usuário lê a própria linha de `usuarios` |
| `20261031040000_seguranca_regras_negocio.sql` | Revisão de segurança, etapa 3: nota exige todas as perguntas do questionário do projeto; sorteio e fila só na janela do evento; limites no autocadastro |
| `20261031050000_modelos_questionario.sql` | 7 questionários prontos (modelos), cópia para o evento e reaproveitamento de eventos anteriores; nota ponderada pelo peso das perguntas; desempate do ranking pela prioridade das perguntas |
| `20261031060000_crud_modelos_questionario.sql` | CRUD dos questionários prontos: editar (atualiza a cópia ainda não usada do evento ativo), criar, salvar questionário como modelo, excluir e restaurar os 7 originais |
| `20261101200000_identidade_visual_evento.sql` | `eventos.url_icone` e `eventos.url_imagem_evento`, bucket público `identidade-visual` (o primeiro do projeto) com escrita só para o Admin, e `fn_identidade_visual()` pública |
