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

- `admin_repescagem_ausentes`: removida em `20261023_remover_repescagem.sql`. Ver
  [ADR 0003](../decisoes/0003-remocao-da-repescagem.md).
