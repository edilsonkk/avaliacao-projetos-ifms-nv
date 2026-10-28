# Funções e RPCs

Funções PostgreSQL chamadas pelo front-end via `supabase.rpc()`. Quem pode executar cada uma está em
[segurança](../arquitetura/seguranca.md#funções).

## Avaliação

| Função | Retorno | Descrição |
|---|---|---|
| `sortear_proximo_projeto(p_id_usuario uuid, p_id_evento uuid)` | `uuid` | Sorteia o próximo projeto para o avaliador e cria a trava. Regras em [sorteio](../regras-de-negocio/sorteio-e-atribuicao.md#ordem-e-filtros-do-sorteio) |
| `sortear_projeto(...)` | — | Alias legado de `sortear_proximo_projeto`; deve ser mantido em sincronia |
| `fn_enviar_avaliacao(...)` | — | **Único caminho** para gravar notas. Ver abaixo |

### `fn_enviar_avaliacao`
`SECURITY DEFINER`. Numa única transação:

1. Exige que o avaliador tenha **trava ativa** no projeto.
2. Valida projeto elegível, ausência de avaliação anterior (inclusive cancelada), conflito institucional, modalidade
   bloqueada e cota estrita.
3. Valida a janela temporal. Com trava ativa, o avaliador pode concluir mesmo após o horário; só é bloqueado se
   `sistema_liberado = false`.
4. Valida a faixa de cada nota conforme o questionário.
5. Calcula `nota_final` no servidor (média simples; o valor enviado pelo cliente é ignorado).
6. Grava `avaliacoes` + `respostas_avaliacao`, remove a trava e conclui o item da fila.
7. Aplica quarentena se a divergência entre maior e menor nota ativa do projeto passar de 2,5.

## Identidade e vínculo do celular

Desenho completo em [segurança](../arquitetura/seguranca.md). Erros de negócio são `RAISE EXCEPTION` com mensagem em
português; `fn_vincular_com_codigo` devolve `{ok, erro}` para que a tentativa errada fique gravada.

| Função | Quem chama | Descrição |
|---|---|---|
| `is_admin()`, `is_staff()` | RLS e funções | Papel da sessão (`id_usuario` ou `id_auth` = `auth.uid()`) |
| `avaliador_atual()` | RLS e funções | Avaliador vinculado ao aparelho atual, ou `NULL` |
| `fn_meu_perfil()` | Qualquer um | Papel, identificação e métodos de vínculo liberados no evento |
| `fn_solicitar_pareamento()` | Celular (sessão anônima) | Gera o código de pareamento |
| `fn_vincular_com_codigo(email, codigo)` | Celular | Vincula com o código de acesso |
| `fn_parear_dispositivo(codigo, id_usuario)` | Staff/Admin | Vincula o celular que mostrou o código e credencia o avaliador |
| `fn_gerar_codigo_acesso(id_usuario)` | Staff/Admin | Gera o código de acesso (mostrado uma única vez) |
| `fn_desvincular_dispositivo(id_usuario)` | Staff/Admin | Revoga o aparelho e os códigos e libera a trava |
| `fn_situacao_vinculos(id_evento)` | Staff/Admin | Quem já tem aparelho vinculado |
| `fn_vincular_conta_staff()` | Staff (primeiro login) | Liga a conta do Auth ao perfil `STAFF` |
| `fn_check_in_projeto(id_projeto, bool)` | Staff/Admin | Check-in do estande |
| `fn_fixar_questionario(id_projeto, id_questionario)` | Avaliador com a trava | Fixa o questionário na primeira avaliação |
| `fn_avaliacoes_ativas_do_projeto(id_projeto)` | Avaliador/Staff/Admin | Contagem para a cota, sem expor notas |
| `fn_feira_concluida(id_evento)` | Avaliador/Staff/Admin | Todos os projetos em competição atingiram a cota |
| `fn_autocadastro_avaliador(...)` | Público | Autocadastro pelo QR; nunca altera cadastro existente |
| `fn_telao_resumo(id_evento)` | Público | Totais do Telão, sem nomes nem notas |

## Administração

| Função | Descrição |
|---|---|
| `admin_reset_global(p_id_evento uuid default null)` → `jsonb` | Apaga todos os dados do evento. Ver [eventos](../regras-de-negocio/eventos.md#reset-global) |
| `admin_desbloquear_todos()` | Remove todas as travas |
| `admin_desbloquear_projeto(p_id_projeto uuid)` | Remove as travas de um projeto |
| `admin_remover_quarentena(p_id_projeto uuid)` | Tira um projeto da quarentena |
| `admin_remover_quarentena_todos()` | Tira todos os projetos da quarentena |
| `excluir_avaliacao(p_id_avaliacao uuid)` | Soft delete: `status = 'CANCELADA'`, `is_quarentena = false` |
| `restaurar_avaliacao(p_id_avaliacao uuid)` | Volta a avaliação para `CONCLUIDA` |
| `is_admin()` → `boolean` | Usuário autenticado tem papel `ADMIN` |

## Relatórios

Todas recebem `p_id_evento uuid` e agregam com `json_agg`. O front-end tenta a RPC primeiro e, se falhar, usa as
views e depois as tabelas (`RelatoriosAdmin.tsx`).

| Função | Retorna |
|---|---|
| `fn_relatorio_projetos_completo` | Projetos com `detalhes_avaliacoes` |
| `fn_relatorio_avaliadores_completo` | Avaliadores com contagem, média, tempo médio e `avaliacoes` |
| `fn_relatorio_ausencias_completo` | Avaliadores com `ausencias` (de `avaliacoes` e `historico_impedimentos`) |
| `fn_relatorio_instituicoes_completo` | Instituições com `projetos`, status e médias |
| `fn_relatorio_indicadores_gerenciais` | Métricas globais e distribuições do evento |

## Rotinas

Não há jobs agendados. A limpeza de travas expiradas acontece a cada chamada de sorteio:

```sql
DELETE FROM public.locks_ativos WHERE expira_em < now();
```

## Removidas

- `admin_repescagem_ausentes`: removida em `20261023000000_remover_repescagem.sql`. Ver
  [ADR 0003](../decisoes/0003-remocao-da-repescagem.md).
