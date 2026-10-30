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
| `admin_desbloquear_projeto(p_id_projeto uuid)` | Remove **todas** as travas de um projeto (não é usada pela tela) |
| `admin_desbloquear_trava(p_id_lock uuid)` | Remove a trava de um avaliador; devolve `false` se ela já não existia |
| `admin_remover_quarentena_evento(p_id_evento uuid)` | Aceita a divergência de todos os projetos em quarentena do evento; devolve quantos |
| `admin_atribuir_banca(p_id_projeto uuid, p_ids_usuarios uuid[])` | Atribuição forçada em banca (tudo ou nada); devolve quantas travas |
| `admin_enfileirar_projetos(p_id_usuario uuid, p_ids_projetos uuid[])` | Atribuição forçada em fila; devolve `{ativado, enfileirados}` |
| `fn_motivo_inelegivel(p_id_projeto uuid, p_id_usuario uuid)` | Interna: motivo de o avaliador não poder avaliar o projeto (`NULL` = pode) |
| `fn_vagas_projeto(p_id_projeto uuid)` | Interna: cota − avaliações ativas − travas válidas |
| `admin_remover_quarentena(p_id_projeto uuid)` | Aceita a divergência do projeto (registra `quarentena_resolvida_em/_por`) |
| `admin_remover_quarentena_todos()` | Aceita a divergência de todos os projetos em quarentena, de todos os eventos (a tela usa a versão por evento) |
| `excluir_avaliacao(p_id_avaliacao uuid)` | Soft delete: `status = 'CANCELADA'`, `cancelada_em/_por`; recalcula a quarentena; devolve `projeto_em_quarentena` |
| `restaurar_avaliacao(p_id_avaliacao uuid)` | Volta a avaliação para `CONCLUIDA` se houver vaga na cota; recalcula a quarentena |
| `admin_salvar_avaliadores(p_id_evento uuid, p_itens jsonb)` → `jsonb` | Cadastro manual e importação de avaliadores numa transação: cria ou atualiza o nome, inscreve no evento, grava bloqueios e áreas do evento. E-mails de Admin/Staff são ignorados (nunca rebaixados). Devolve `{cadastrados, atualizados, ignorados: [{email, motivo}]}` |
| `admin_atualizar_avaliador(p_id_usuario, p_id_evento, p_nome, p_email, p_id_instituicao, p_ids_modalidades_bloqueadas, p_ids_areas)` | Edição do avaliador de uma vez (substitui instituição, bloqueios e áreas no evento); recusa e-mail de outra pessoa |
| `admin_bloquear_modalidade_avaliador(p_id_usuario, p_id_evento, p_id_modalidade, p_bloquear boolean)` | Chip de modalidade do Gestor de Avaliadores |
| `admin_remover_avaliador_evento(p_id_usuario, p_id_evento)` → `jsonb` | Tira o avaliador do evento. Recusa se ele tem avaliação ativa no evento; só apaga o cadastro se não sobrar evento nem avaliação. Devolve `{sucesso, cadastro_apagado}` |
| `admin_salvar_staff(p_id_evento uuid, p_itens jsonb)` → `jsonb` | Cadastro manual e importação da equipe Staff (`papel` `STAFF`/`MONITOR`); ignora e-mails de Admin/Avaliador; inscreve no evento sem mexer no credenciamento. Devolve `{cadastrados, atualizados, ignorados}` |
| `admin_atualizar_staff(p_id_usuario, p_nome, p_email)` | Edição de membro do Staff; recusa e-mail de outra pessoa |
| `admin_excluir_staff(p_id_usuario)` | Exclui membro do Staff/Monitor (recusa outros papéis) |
| `admin_salvar_questionario(p_id_questionario, p_id_evento, p_titulo, p_escala_minima, p_escala_maxima, p_perguntas jsonb)` → `uuid` | Cria (`p_id_questionario` nulo) ou edita o questionário numa transação; perguntas atualizadas no lugar. Questionário já usado só muda o título |
| `admin_excluir_questionario(p_id_questionario)` | Exclui questionário nunca usado em avaliação |
| `fn_avaliacoes_do_questionario(p_id_questionario)` → `integer` | Quantas avaliações usaram o questionário (trava a edição na tela) |
| `admin_salvar_instituicoes(p_id_evento uuid, p_itens jsonb)` → `jsonb` | Cadastro manual e importação de instituições por `(id_evento, nome_normalizado)`. Devolve `{cadastradas, atualizadas, ignoradas}` |
| `admin_excluir_instituicao(p_id_instituicao)` | Exclui instituição sem projeto nem avaliador vinculado |
| `fn_normalizar_nome(p_texto)` → `text` | Chave de comparação de nomes (minúsculas, sem acento, sem espaços nas pontas); usada pelo trigger de `instituicoes` |
| `fn_expurgar_modalidades_bloqueadas(p_id_usuario, p_id_evento)` | Interna: remove travas e fila do avaliador em projetos das modalidades bloqueadas |
| `fn_recalcular_quarentena(p_id_projeto uuid)` | Interna: marca/desmarca `is_quarentena` das avaliações ativas pela regra da view |
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
