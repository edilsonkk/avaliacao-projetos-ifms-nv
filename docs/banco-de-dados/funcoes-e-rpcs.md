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
5. Calcula `nota_final` no servidor (média ponderada pelo `peso_calculo` das perguntas; o valor enviado pelo cliente é ignorado).
6. Grava `avaliacoes` + `respostas_avaliacao`, remove a trava e conclui o item da fila.
7. Recalcula a quarentena do projeto por `fn_recalcular_quarentena` (a mesma regra da view e de excluir/restaurar: duas avaliações ativas, divergência acima de 2,5 e respeitando `quarentena_resolvida_em`).

## Identidade e vínculo do celular

Desenho completo em [segurança](../arquitetura/seguranca.md). Erros de negócio são `RAISE EXCEPTION` com mensagem em
português; `fn_vincular_com_codigo` devolve `{ok, erro}` para que a tentativa errada fique gravada.

| Função | Quem chama | Descrição |
|---|---|---|
| `is_admin()`, `is_staff()` | RLS e funções | Papel da sessão (`id_usuario` ou `id_auth` = `auth.uid()`) |
| `avaliador_atual()` | RLS e funções | Avaliador vinculado ao aparelho atual, ou `NULL` |
| `conta_da_equipe(auth_uid)`, `sessao_de_conta_da_equipe()` | Funções de vínculo | O `auth_uid` (ou a sessão atual) é de ADMIN/STAFF/MONITOR? Sem depender do MFA |
| `fn_meu_perfil()` | Qualquer um | Papel, identificação, métodos de vínculo liberados no evento e `sessao_equipe` |
| `fn_solicitar_pareamento()` | Celular (sessão anônima) | Gera o código de pareamento; recusa a sessão da equipe |
| `fn_vincular_com_codigo(email, codigo)` | Celular | Vincula com o código de acesso; recusa a sessão da equipe sem gastar o código |
| `fn_parear_dispositivo(codigo, id_usuario)` | Staff/Admin | Vincula o celular que mostrou o código e credencia o avaliador; recusa código vindo da sessão da equipe |
| `fn_gerar_codigo_acesso(id_usuario)` | Staff/Admin | Gera o código de acesso (mostrado uma única vez) |
| `fn_desvincular_dispositivo(id_usuario)` | Staff/Admin | Revoga o aparelho e os códigos e libera a trava |
| `fn_situacao_vinculos(id_evento)` | Staff/Admin | Quem já tem aparelho vinculado |
| `fn_vincular_conta_staff()` | Staff (primeiro login) | Liga a conta do Auth ao perfil `STAFF` |
| `fn_check_in_projeto(id_projeto, bool)` | Staff/Admin | Check-in do estande |
| `fn_fixar_questionario(id_projeto, id_questionario)` | Avaliador com a trava | Fixa o questionário na primeira avaliação |
| `fn_avaliacoes_ativas_do_projeto(id_projeto)` | Avaliador/Staff/Admin | Contagem para a cota, sem expor notas |
| `fn_assumir_item_fila()` | Avaliador | Primeiro item pendente da própria fila que pode ser avaliado (elegibilidade e cota no banco); grava a trava de 2 h e devolve o projeto, ou nulo |
| `fn_registrar_impedimento(id_projeto, tipo)` | Avaliador | Ausência ou conflito no projeto em que está (com trava); libera a trava |
| `fn_politica_seguranca()` | Logados | MFA do Admin exigido? e minutos sem uso para encerrar a sessão de Admin/Staff |
| `admin_salvar_configuracoes_seguranca(exigir_mfa, minutos)` | Admin | Grava a política; mudar o MFA exige sessão com segundo fator (`aal2`) |
| `fn_janela_avaliacao_aberta(id_evento)` | Logados | Janela do evento aberta agora (data, horário no fuso de MS e sistema liberado); usada pelo sorteio e pela fila |
| `fn_feira_concluida(id_evento)` | Avaliador/Staff/Admin | Avaliação finalizada: há projetos presentes (check-in) na competição e todos atingiram a cota (mesma regra de `avaliacao_finalizada` do Telão) |
| `fn_autocadastro_avaliador(...)` | Público | Autocadastro pelo QR; nunca altera cadastro existente |
| `fn_telao_resumo(id_evento)` | Público | Totais do Telão (evento ativo se nulo): nome/data/horário do evento, projetos presentes, meta pela cota de cada projeto, avaliações na meta, travas (todas e as que cabem na meta), avaliadores credenciados (só papel Avaliador), quarentena pendente, `avaliacao_finalizada`; sem nomes de pessoas, títulos nem notas |

## Administração

| Função | Descrição |
|---|---|
| `admin_reset_global(p_id_evento uuid default null)` → `jsonb` | Apaga os dados **do evento** (notas incluídas) e registra na trilha o resumo do que apagou. Recusa rodar sem evento definido. Ver [eventos](../regras-de-negocio/eventos.md#reset-global) |
| `admin_desbloquear_todos()` | Remove todas as travas |
| `admin_desbloquear_projeto(p_id_projeto uuid)` | Remove **todas** as travas de um projeto (não é usada pela tela) |
| `admin_desbloquear_trava(p_id_lock uuid)` | Remove a trava de um avaliador; devolve `false` se ela já não existia |
| `admin_remover_quarentena_evento(p_id_evento uuid, p_motivo text default null)` | Aceita a divergência de todos os projetos em quarentena do evento; devolve quantos. O motivo vai para a trilha |
| `admin_atribuir_banca(p_id_projeto uuid, p_ids_usuarios uuid[])` | Atribuição forçada em banca (tudo ou nada); devolve quantas travas |
| `admin_enfileirar_projetos(p_id_usuario uuid, p_ids_projetos uuid[])` | Atribuição forçada em fila; devolve `{ativado, enfileirados}` |
| `fn_motivo_inelegivel(p_id_projeto uuid, p_id_usuario uuid)` | Interna: motivo de o avaliador não poder avaliar o projeto (`NULL` = pode) |
| `fn_vagas_projeto(p_id_projeto uuid)` | Interna: cota − avaliações ativas − travas válidas (as duas só de nota técnica) |
| `fn_projetos_situacao(p_id_evento uuid)` | Um registro por projeto do evento com a conta pronta: `cota`, `avaliacoes_tecnicas`, `travas_tecnicas`, `vagas_restantes`, `media_tecnica`, `notas_tecnicas`, `votos_populares`, `media_voto_popular` e `em_quarentena`. Mesma regra de `fn_vagas_projeto` e do sorteio, por evento e numa consulta só. Fonte do Mapa de Estandes e da Atribuição Forçada, para a tela não recontar cota e média no navegador ([ADR 0001](../decisoes/0001-logica-critica-no-banco.md)). Só Admin: `SECURITY DEFINER` com `is_admin()`, porque o Staff não lê `avaliacoes` |
| `admin_remover_quarentena(p_id_projeto uuid, p_motivo text default null)` | Aceita a divergência do projeto (registra `quarentena_resolvida_em/_por`) |
| `admin_remover_quarentena_todos()` | Aceita a divergência de todos os projetos em quarentena, de todos os eventos (a tela usa a versão por evento) |
| `excluir_avaliacao(p_id_avaliacao uuid, p_motivo text default null)` | Soft delete: `status = 'CANCELADA'`, `cancelada_em/_por`; recalcula a quarentena; devolve `projeto_em_quarentena` |
| `restaurar_avaliacao(p_id_avaliacao uuid, p_motivo text default null)` | Volta a avaliação para `CONCLUIDA` se houver vaga na cota; recalcula a quarentena |
| `admin_salvar_avaliadores(p_id_evento uuid, p_itens jsonb)` → `jsonb` | Cadastro manual e importação de avaliadores numa transação: cria ou atualiza o nome, inscreve no evento, grava bloqueios e áreas do evento. E-mails de Admin/Staff são ignorados (nunca rebaixados). Devolve `{cadastrados, atualizados, ignorados: [{email, motivo}]}` |
| `admin_atualizar_avaliador(p_id_usuario, p_id_evento, p_nome, p_email, p_id_instituicao, p_ids_modalidades_bloqueadas, p_ids_areas)` | Edição do avaliador de uma vez (substitui instituição, bloqueios e áreas no evento); recusa e-mail de outra pessoa |
| `admin_bloquear_modalidade_avaliador(p_id_usuario, p_id_evento, p_id_modalidade, p_bloquear boolean)` | Chip de modalidade do Gestor de Avaliadores |
| `admin_remover_avaliador_evento(p_id_usuario, p_id_evento)` → `jsonb` | Tira o avaliador do evento. Recusa se ele tem avaliação ativa no evento; só apaga o cadastro se não sobrar evento nem avaliação. Devolve `{sucesso, cadastro_apagado}` |
| `admin_salvar_staff(p_id_evento uuid, p_itens jsonb)` → `jsonb` | Cadastro manual e importação da equipe Staff (`papel` `STAFF`/`MONITOR`); ignora e-mails de Admin/Avaliador; inscreve no evento sem mexer no credenciamento. Devolve `{cadastrados, atualizados, ignorados}` |
| `admin_atualizar_staff(p_id_usuario, p_nome, p_email)` | Edição de membro do Staff; recusa e-mail de outra pessoa |
| `admin_excluir_staff(p_id_usuario)` | Exclui membro do Staff/Monitor (recusa outros papéis) |
| `admin_salvar_questionario(p_id_questionario, p_id_evento, p_titulo, p_escala_minima, p_escala_maxima, p_perguntas jsonb)` → `uuid` | Cria (`p_id_questionario` nulo) ou edita o questionário numa transação; perguntas atualizadas no lugar. Questionário já usado só muda o título |
| `admin_excluir_questionario(p_id_questionario)` | Exclui questionário nunca usado em avaliação |
| `admin_copiar_questionario(p_id_origem, p_id_evento)` → `uuid` | Copia um modelo ou um questionário de outro evento para o evento (perguntas, ajuda e pesos). Não duplica: devolve a cópia existente |
| `admin_salvar_modelo_questionario(p_id_modelo, p_titulo, p_descricao, p_escala_minima, p_escala_maxima, p_perguntas)` → `jsonb` | Cria (`p_id_modelo` nulo) ou edita um modelo. Ao editar, atualiza a cópia do evento ativo se ela não foi usada; devolve `copia` = `atualizada`, `em_uso` ou `sem_copia` |
| `admin_excluir_modelo_questionario(p_id_modelo)` | Exclui um modelo; as cópias nos eventos continuam |
| `admin_salvar_questionario_como_modelo(p_id_questionario)` → `uuid` | Cria um modelo a partir de um questionário do evento |
| `admin_restaurar_modelos_originais()` → `integer` | Recria/restaura os 7 modelos originais; modelos do Admin não mudam |
| `admin_listar_questionarios_reaproveitaveis(p_id_evento)` | Questionários dos outros eventos, com evento, data, perguntas, avaliações e se já estão no evento |
| `fn_chave_desempate(p_id_projeto)` → `numeric[]` | Médias do projeto por pergunta, na ordem de `peso_desempate` (usada por `view_ranking_top3`) |
| `fn_avaliacoes_do_questionario(p_id_questionario)` → `integer` | Quantas avaliações usaram o questionário (trava a edição na tela) |
| `admin_salvar_instituicoes(p_id_evento uuid, p_itens jsonb)` → `jsonb` | Cadastro manual e importação de instituições por `(id_evento, nome_normalizado)`. Devolve `{cadastradas, atualizadas, ignoradas}` |
| `admin_excluir_instituicao(p_id_instituicao)` | Exclui instituição sem projeto nem avaliador vinculado |
| `fn_normalizar_nome(p_texto)` → `text` | Chave de comparação de nomes (minúsculas, NFD sem acentos, pontas aparadas como `String.trim()`), igual a `normalizarChave()` no front; usada pelo trigger de `instituicoes`, pelo autocadastro e pelas funções de instituições/modalidades |
| `fn_aparar_texto(p_texto)` → `text` | Apara as pontas com o mesmo conjunto de espaços de `String.trim()` (inclui espaço não separável) |
| `admin_salvar_modalidades(p_id_evento uuid, p_itens jsonb)` → `jsonb` | Cadastro manual e importação de modalidades (cria ou atualiza pelo nome; `id_existente` grava apelido). Devolve `{cadastradas, atualizadas, associadas, ignoradas}` |
| `admin_excluir_modalidade(p_id_modalidade)` | Exclui modalidade sem projeto nem bloqueio de avaliador |
| `fn_expurgar_modalidades_bloqueadas(p_id_usuario, p_id_evento)` | Interna: remove travas e fila do avaliador em projetos das modalidades bloqueadas |
| `fn_recalcular_quarentena(p_id_projeto uuid)` | Interna: marca/desmarca `is_quarentena` das avaliações ativas pela regra da view |
| `is_admin()` → `boolean` | Usuário autenticado tem papel `ADMIN` |

## Auditoria de notas

Desenho completo em [auditoria de notas](../regras-de-negocio/auditoria-de-notas.md). Todas exigem
`is_admin()`; as de ajuste registram o motivo na trilha.

| Função | Retorno | Descrição |
|---|---|---|
| `fn_auditar_notas(p_id_evento uuid default null)` | `TABLE` | Conferência do evento: recalcula cada nota a partir das respostas e lista os achados (C1 a C12) com severidade |
| `fn_memorial_avaliacao(p_id_avaliacao uuid)` | `jsonb` | A conta de uma nota: critério, peso, nota, produto, somas, divisão sem arredondar, valor gravado e marca de ajuste |
| `fn_memorial_projeto(p_id_projeto uuid, p_incluir_achados boolean default true)` | `jsonb` | Memorial do projeto: avaliações ativas e canceladas, média aberta, desempate, quarentena, achados e trilha |
| `fn_memorial_por_codigo(p_codigo_projeto text, p_id_evento uuid default null)` | `jsonb` | O mesmo, achando o projeto pelo código (a interface nunca pede UUID) |
| `fn_memorial_evento(p_id_evento uuid default null)` | `jsonb` | Folha de conferência consolidada: todos os projetos do evento, com os achados de uma única rodada da conferência |
| `fn_validar_respostas(p_id_questionario uuid, p_respostas jsonb)` | `numeric` | Valida o conjunto de respostas e devolve a média ponderada. Mesma regra de `fn_enviar_avaliacao` |
| `admin_corrigir_respostas_avaliacao(p_id_avaliacao, p_respostas jsonb, p_motivo)` | `jsonb` | Corrige as notas por critério e recalcula a nota final pela fórmula oficial |
| `admin_lancar_avaliacao(p_id_projeto, p_id_usuario, p_id_questionario, p_respostas, p_parecer, p_motivo, p_confirmar_acima_da_cota)` | `jsonb` | Lança a avaliação de um avaliador do evento; acima da cota só com confirmação |
| `admin_arbitrar_nota_final(p_id_avaliacao, p_nota numeric, p_motivo)` | `jsonb` | Define a nota final sem mexer nas respostas (vira achado informativo na conferência) |
| `admin_ajustar_media_projeto(p_id_projeto, p_delta numeric, p_motivo)` | `jsonb` | Bónus ou penalidade na média do projeto, limitado à amplitude da escala; `p_delta = 0` remove |
| `auditoria_marcar_origem(p_origem, p_motivo)` | `void` | Interna: cada RPC confiável se identifica na trilha. **Não** é executável pela API |
| `auditoria_registrar(p_acao, p_tabela, p_id_evento, p_dados, p_motivo)` | `void` | Interna: registro feito à mão por uma RPC (o reset global usa) |
| `fn_auditar()` | `trigger` | Interna: a trigger que grava a trilha em cada tabela auditada |

## Relatórios

Todas recebem `p_id_evento uuid` (nulo não devolve nada) e são `SECURITY INVOKER`. As três primeiras são
`LANGUAGE sql` (colunas conferidas ao criar a função) e são as únicas fontes de `RelatoriosAdmin.tsx`, que não tem
consultas alternativas e mostra o erro se uma falhar.

| Função | Retorna |
|---|---|
| `fn_relatorio_projetos_completo` | Projetos com `detalhes_avaliacoes` e `cota_avaliacoes` (cota do projeto ou a padrão do evento) |
| `fn_relatorio_avaliadores_completo` | Avaliadores com contagem, média, tempo médio e `avaliacoes` (cada uma com `duracao_segundos`) |
| `fn_relatorio_ausencias_completo` | Avaliadores com `ausencias` (de `historico_impedimentos` com `tipo = 'ausencia'`) |
| `fn_relatorio_devolucoes_completo` | Avaliadores com `devolucoes` (de `historico_impedimentos` com `tipo = 'conflito'`: o botão "Devolver (Conflito de Interesse)") |
| `fn_relatorio_voto_popular_completo` | Voto popular por projeto: votos, média simples, **média bayesiana**, âncora (`media_evento`), peso (`peso_ancora`) e posição. Fonte única do relatório e da classificação do voto popular |
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
