# Modelo de Dados

Fonte da verdade: `supabase/migrations/`. Este documento descreve o significado das tabelas; para o tipo exato de
cada coluna, consulte as migrations (ou `supabase/schema.sql`, ver [migrations](migrations.md#schemasql)).

Permissões de acesso por tabela: [segurança](../arquitetura/seguranca.md).

## Diagrama resumido

```
eventos ─┬─< instituicoes ──< instituicao_aliases
         ├─< modalidades ───< modalidade_aliases
         ├─< areas_tematicas
         ├─< questionarios ─< perguntas_questionario
         ├─< projetos >── instituicoes / areas_tematicas / modalidades / questionarios
         └─< avaliadores_evento >── usuarios, instituicoes

usuarios ─┬─< avaliacoes >── projetos ;  avaliacoes ─< respostas_avaliacao >── perguntas_questionario
          ├─< locks_ativos >── projetos
          ├─< fila_atribuicoes_direcionadas >── projetos
          ├─< avaliador_modalidades_bloqueadas (por evento)
          ├─< avaliador_areas (por evento)
          └─< historico_impedimentos >── projetos
```

## Evento e cadastros base

### `eventos`
A feira. Quase todas as tabelas são isoladas por `id_evento`.

| Coluna | Descrição |
|---|---|
| `id_evento` | PK |
| `nome_evento`, `edicao`, `descricao` | Identificação |
| `data_evento`, `horario_inicio`, `horario_fim` | Janela em que avaliações são permitidas (ver [eventos](../regras-de-negocio/eventos.md#janela-de-avaliação)) |
| `data_inicio`, `data_fim` | Legadas; não usadas pelo modal de configurações |
| `is_ativo` | Evento ativo |
| `sistema_liberado` | `false` bloqueia novas avaliações |
| `minutos_timeout_lock` | Duração da trava de avaliação (padrão 30) |
| `cota_avaliacoes_padrao` | Avaliações por projeto (padrão 3) |
| `limite_corte` | Numérico |
| `minutos_validade_pareamento` | Validade do código de pareamento do celular (padrão 10; 1–60) |
| `minutos_validade_codigo_acesso` | Validade do código de acesso gerado pelo Staff (padrão 15; 1–120) |
| `tamanho_codigo` | Tamanho dos dois códigos (padrão 6; 6–10) |
| `max_tentativas_codigo` | Tentativas por código de acesso antes de invalidá-lo (padrão 5; 1–10) |
| `metodos_vinculo` | `pareamento` (padrão) ou `codigo`; `ambos` é legado e não é mais oferecido na interface |
| `fixar_questionario_primeira_avaliacao` | Ligada (padrão): a primeira avaliação fixa o questionário do projeto |
| `url_icone` | Ícone do evento (bucket `identidade-visual`): substitui o "IF" do cabeçalho e serve de favicon |
| `url_imagem_evento` | Imagem do evento: login, autocadastro, Telão, relatórios impressos e topo da tela do avaliador |
| `logo_url` | **Morta**: anterior à identidade visual, nunca lida pela aplicação. Use `url_icone` / `url_imagem_evento` |
| `intervalo_pausa_avaliador` | **Morta**: gravada como `0` na criação do evento e nunca lida |

Os limites ficam em `CHECK` no banco e são editados nas Configurações do evento (engrenagem).

### `instituicoes`
Instituições de ensino de projetos e avaliadores. Base do bloqueio de conflito de interesse.
`id_instituicao`, `id_evento`, `nome_exibicao`, `nome_normalizado`, `sigla`, `campus`, `cidade`, `estado`.
Único por `(id_evento, nome_normalizado)`. O trigger `instituicoes_normalizar` calcula `nome_normalizado`
(`fn_normalizar_nome`) e põe a sigla em maiúsculas em todo insert/update.

### `modalidades`
`id_modalidade`, `id_evento`, `codigo`, `nome_modalidade`, `nivel` (Fundamental, Médio, Médio/Técnico, Técnico,
Superior, Geral), `area_tematica`, `descricao`. Único por `(id_evento, nome_modalidade)`.

### `areas_tematicas`
`id_area`, `id_evento`, `nome_area` (padronizado pelas grandes áreas do CNPq). Único por `(id_evento, nome_area)`.

### `instituicao_aliases` e `modalidade_aliases`
Dicionário aprendido de variações de escrita usado na importação.
`id_alias`, `id_instituicao`/`id_modalidade`, `alias`, `alias_normalizado`, `criado_em`.
Único por `(id_instituicao|id_modalidade, alias_normalizado)`. Ver
[importação](../regras-de-negocio/importacao-de-planilhas.md#dicionário-de-aliases).

## Pessoas

### `usuarios`
Login e identidade de todos os perfis.
`id_usuario`, `email` (único), `nome`, `papel`, `cpf`, `celular`, `created_at`.

- `papel` é `VARCHAR`. Valores usados: `ADMIN`, `SUPERADMIN`, `STAFF`, `MONITOR`, `AVALIADOR` (padrão).
  Existe também o tipo enum `papel_usuario` (`ADMIN`, `STAFF`, `AVALIADOR`), não usado pela coluna.
- A senha do Admin fica no Supabase Auth. A coluna `senha_hash` foi removida em
  `20261026020000_restringir_leitura_sensivel.sql`.

### `usuarios.id_auth`
Liga a conta do Supabase Auth (e-mail e senha) ao perfil do Staff, preenchido no primeiro login por
`fn_vincular_conta_staff`. A PK `id_usuario` não muda.

### `dispositivos_avaliador`
Aparelho (sessão do Auth, `auth_uid`) vinculado a um avaliador. Um aparelho ativo por avaliador: um novo vínculo
revoga o anterior (`revogado_em`). `metodo`: `pareamento` ou `codigo`. Sem acesso direto; só por funções.

### `pareamentos_pendentes`
Código que o celular mostra para o Staff parear. Não é credencial (só aponta o aparelho; quem decide é o Staff), por
isso é gravado em texto. Expira conforme o evento.

### `codigos_acesso`
Código que o Staff gera para o avaliador digitar. É credencial: só o hash bcrypt é gravado, tem uso único e conta
tentativas (`max_tentativas`). Gerar um novo invalida o anterior.

### `registro_autocadastro`
Contador do limite do autocadastro, que é endpoint público: `id`, `id_evento`, `criado_em`, `criou_instituicao`.
`fn_autocadastro_avaliador` recusa a partir de 30 cadastros por minuto no sistema e apaga os registros com mais de
um dia. Sem acesso para `anon` nem `authenticated` (só `service_role` e as funções `SECURITY DEFINER`).

### `configuracoes_seguranca`
Política de segurança do sistema, **linha única** (`id boolean` com `CHECK`), não por evento: `exigir_mfa_admin`,
`minutos_inatividade_sessao` (`0` = sem expiração, ou 5–720), `atualizado_em`, `atualizado_por`. Escrita só por
`admin_salvar_configuracoes_seguranca`; mudar o MFA exige sessão `aal2`
([ADR 0012](../decisoes/0012-mfa-admin-e-expiracao-de-sessao.md)).

### `avaliadores_evento`
Vínculo da pessoa com o evento. PK `(id_usuario, id_evento)`.
`id_instituicao` (usada no conflito de interesse), `is_credenciado` (check-in presencial) e `id_questionario`:
questionário fixado para aquele avaliador no evento, gravado por `admin_vincular_questionario_avaliador`. Se ele
aponta para um questionário de voto popular, a pessoa é **votante**, não avaliador técnico.

### `avaliador_modalidades_bloqueadas`
Modalidades que o avaliador não pode avaliar. PK `(id_usuario, id_evento, id_modalidade)`, `ON DELETE CASCADE`.

### `avaliador_areas`
Áreas de afinidade do avaliador. PK `(id_usuario, id_evento, id_area)`, `ON DELETE CASCADE`.

## Projetos e questionários

### `projetos`
| Coluna | Descrição |
|---|---|
| `id_projeto` | PK (nunca exibida na interface) |
| `codigo_projeto` | **Chave natural**, única por evento: `UNIQUE (id_evento, codigo_projeto)` (ex.: `FETEC-001`) |
| `id_evento`, `id_instituicao`, `id_area`, `id_modalidade` | FKs. Projeto sem `id_evento` nunca é sorteado |
| `id_questionario_fixado` | Questionário usado nas avaliações do projeto |
| `titulo`, `expositores`, `estande`, `corredor` | Dados de exibição |
| `cota_avaliacoes_customizada` | Sobrepõe `eventos.cota_avaliacoes_padrao` |
| `contagem_ausencia` | Vezes em que foi marcado ausente |
| `is_check_in_realizado` | Presença confirmada pelo Staff |
| `is_fora_da_competicao` | Participa sem concorrer |
| `forcar_topo_fila` | Prioridade máxima no sorteio |
| `quarentena_resolvida_em`, `quarentena_resolvida_por` | Quando e qual Admin aceitou a divergência de notas (quarentena) |
| `ajuste_media` | Bónus (positivo) ou penalidade (negativo) de comissão somado à média. `0` = sem ajuste; `media_final = media_geral + ajuste_media` |
| `ajuste_media_em`, `ajuste_media_por`, `ajuste_media_motivo` | Quando, quem e por quê |

A tabela **não** tem colunas textuais `modalidade`, `area_conhecimento` ou `nome_instituicao`. Use os relacionamentos
(`modalidades(nome_modalidade)`, `areas_tematicas(nome_area)`, `instituicoes(nome_exibicao, sigla)`).

### `questionarios` e `perguntas_questionario`
- `questionarios`: `id_questionario`, `id_evento`, `titulo`, `escala_minima`, `escala_maxima`, `id_origem` (modelo
  ou questionário de outro evento de onde a cópia veio; único por evento).
- `questionarios.is_voto_popular`: **a marca que define a pista**. Nota dada por um questionário marcado não entra
  na média técnica, na cota, na quarentena, no ranking técnico nem na meta do Telão
  ([ADR 0016](../decisoes/0016-voto-popular-separado-e-media-bayesiana.md)). Só muda por
  `admin_marcar_questionario_voto_popular`, e não muda depois de o questionário ter avaliação.
- `modelos_questionario` e `perguntas_modelo_questionario`: questionários prontos, fora de qualquer evento (só o Admin
  lê; carga pela migration `20261031050000`). Ativar um modelo copia para `questionarios`. `is_original` marca os 7
  do documento (restauráveis). Escrita só pelas funções `admin_*_modelo_*`.
- `perguntas_questionario`: `id_pergunta`, `id_questionario`, `texto_pergunta`, `descricao_lembrete` (texto de ajuda
  para o avaliador), `peso_calculo`, `peso_desempate`, `ordem`.
- `respostas_avaliacao.id_pergunta` é `ON DELETE CASCADE`: apagar uma pergunta apaga as notas por critério já dadas.
  Por isso a escrita é só por `admin_salvar_questionario` / `admin_excluir_questionario`, que travam questionários
  já usados.

## Avaliação

### `avaliacoes`
| Coluna | Descrição |
|---|---|
| `id_avaliacao` | PK |
| `id_projeto`, `id_usuario`, `id_questionario` | FKs |
| `nota_final` | Calculada no servidor por `fn_enviar_avaliacao` |
| `parecer_final` | Texto do avaliador |
| `status` | `CONCLUIDA` (padrão) ou `CANCELADA` (soft delete). Ausência **não** é um status de avaliação: vai para `historico_impedimentos` |
| `is_voto_popular` | Cópia da marca do questionário no momento da nota, por trigger. `true`: a nota não entra na média técnica, na cota, na quarentena nem no ranking |
| `status_avaliacao` | Espelho legado de `status` em minúsculas |
| `is_quarentena` | Marcada por divergência de notas (recalculada ao cancelar/restaurar) |
| `cancelada_em`, `cancelada_por` | Quando e qual Admin cancelou (sem FK: ver regra 12 de migrations) |
| `ajuste_tipo` | Ajuste manual do Admin: `respostas_corrigidas`, `nota_arbitrada` ou `lancada_pelo_admin`. `NULL` = enviada pelo avaliador ([auditoria](../regras-de-negocio/auditoria-de-notas.md#ajuste-manual-do-admin)) |
| `ajustada_em`, `ajustada_por`, `ajuste_motivo` | Quando, quem e por quê (sem FK, como `cancelada_por`) |
| `tempo_presenca` | Início da avaliação (confirmação de presença no estande) |
| `tempo_submissao` | Envio |

Restrição `unica_avaliacao_por_usuario UNIQUE (id_projeto, id_usuario)`: um avaliador avalia um projeto **uma única
vez**, inclusive se a avaliação foi cancelada. Ver
[ADR 0005](../decisoes/0005-sorteio-nao-repete-avaliador.md).

As FKs `id_projeto` e `id_usuario` são **`ON DELETE RESTRICT`**: apagar um projeto ou um usuário com nota é
recusado (erro `23503`). Antes eram `CASCADE` e levavam as notas em silêncio — apagar um cadastro apagava
resultado de feira. `respostas_avaliacao → avaliacoes` continua `CASCADE` (a resposta é parte da avaliação, e o
soft delete nunca apaga a avaliação); `respostas_avaliacao → perguntas_questionario` também passou a `RESTRICT`.

### `respostas_avaliacao`
Nota por critério: `id_resposta`, `id_avaliacao`, `id_pergunta`, `nota_atribuida`.
Índice `idx_respostas_avaliacao_avaliacao` em `id_avaliacao` (migration `20261122210113`): sem ele, buscar as
respostas de uma avaliação varre a tabela inteira, e como `fn_chave_desempate` é chamada **uma vez por projeto** em
`view_ranking_top3`, a Classificação estourava o `statement_timeout` de 8 s (110 s em 601 projetos). É também o
índice da FK `ON DELETE CASCADE`. Ver [ADR 0018](../decisoes/0018-indice-em-respostas-avaliacao.md).
Índice `idx_respostas_avaliacao_pergunta` em `id_pergunta` (migration `20261122213930`): lado filho de uma FK
`ON DELETE RESTRICT` na maior tabela do banco — sem ele, cada pergunta removida ao editar um questionário a varre
inteira.

### Índices de chave estrangeira

O PostgreSQL **não** indexa o lado filho de uma FK. Sem índice, toda ação referencial (`CASCADE`, `SET NULL`,
`RESTRICT`) varre a tabela filha a cada linha do pai apagada e, numa sessão `authenticated`, a policy de RLS entra
como filtro de linha nessa varredura — `is_admin()` é `STABLE` e não `IMMUTABLE`, então roda **uma vez por linha
varrida**. A varredura do schema achou 15 FKs sem cobertura; cinco foram indexadas (`20261122210113` e
`20261122213930`) e dez ficaram de fora por serem tabelas pequenas com delete raro, com o motivo de cada uma no
cabeçalho da migration.

**Qual padrão é perigoso, medido:** subconsulta correlacionada por projeto **não** é. O planejador converte
`EXISTS (… WHERE filho.id = pai.id)` em *SubPlan hasheado* — varre a tabela uma vez e sonda o hash (`loops=1`), e o
ganho do índice em `historico_impedimentos` ficou em ~9% mesmo com 3.005 linhas. O que o planejador **não** otimiza é
**chamada de função por linha**: em `view_ranking_top3` cada uma das 601 invocações de `fn_chave_desempate` planeja e
executa a própria consulta, e é daí que vinham os 110 s. Ao investigar lentidão, procure a função por linha antes da
subconsulta.

### `locks_ativos`
Travas de avaliação em andamento: `id_lock`, `id_usuario` (**único**: um projeto por vez por avaliador),
`id_projeto` (vários avaliadores permitidos: banca), `bloqueado_em`, `expira_em`, `atribuido_por` (Admin da
atribuição forçada; `NULL` = sorteio), `is_voto_popular` (trava de votante: não ocupa vaga da cota técnica nem
aparece nas contagens do sorteio).

### `fila_atribuicoes_direcionadas`
Atribuições feitas pela coordenação: `id_atribuicao`, `id_usuario`, `id_projeto`, `ordem`,
`status` (`pendente`, `em_andamento`, `concluido`, `cancelado`, `ja_avaliado`).

### `historico_impedimentos`
Registro de conflitos e ausências: `id_usuario`, `id_projeto`, `tipo` (`'ausencia'` ou `'conflito'`), `created_at`,
gravado por `fn_registrar_impedimento`. A chave primária inclui `created_at`, então o histórico de repetições é
preservado. Alimenta dois relatórios separados: **ausências** (`tipo = 'ausencia'`) e **devoluções**
(`tipo = 'conflito'`, o botão "Devolver (Conflito de Interesse)" da tela do avaliador). No sorteio, o impedimento
veta o par avaliador/projeto — só para aquele avaliador, não para os demais.

### `log_auditoria`
Trilha de auditoria **append-only** (ver [auditoria de notas](../regras-de-negocio/auditoria-de-notas.md) e
[ADR 0014](../decisoes/0014-trilha-de-auditoria-append-only.md)). Preenchida por trigger, inclusive quando a
escrita vem direto da API REST. Sobrevive ao reset global.

| Coluna | Descrição |
|---|---|
| `id_log` | PK (identidade) |
| `criado_em` | Quando |
| `id_evento`, `id_projeto`, `id_avaliacao`, `id_registro` | Escopo do que mudou (`id_registro` guarda a chave do registro em texto) |
| `tabela`, `operacao`, `acao` | Onde (`avaliacoes`…), o quê (`INSERT`/`UPDATE`/`DELETE`/`EVENTO`) e o rótulo semântico (`nota_alterada`, `credenciamento_concedido`…) |
| `ator_auth`, `ator_usuario`, `ator_papel` | Quem (sessão do Auth, usuário resolvido e papel) |
| `origem` | Nome da RPC que se identificou, ou `direto` quando não passou por função nenhuma |
| `motivo` | Justificativa opcional informada pelo Admin |
| `dados_antes`, `dados_depois`, `campos_alterados` | O antes, o depois e quais colunas mudaram |

Ninguém altera nem apaga: não há policy de escrita, os `GRANT` de escrita são revogados e um trigger recusa
`UPDATE`/`DELETE`/`TRUNCATE`. Leitura só com `is_admin()`. Dado pessoal de `usuarios` (`cpf`, `celular`,
`id_auth`) não entra no antes/depois.

## Views

| View | Conteúdo |
|---|---|
| `view_ranking_top3` | Apesar do nome: todos os projetos **na competição** com avaliação não cancelada, com modalidade, área, notas, `media_geral` (média simples das notas), `ajuste_media`, `media_final` (= `media_geral + ajuste_media`), `posicao` (`RANK()` por evento, modalidade e área **pela média final**; empate divide) e `em_quarentena`. O front filtra por `id_evento` e mostra quem tem posição até 3 |
| `view_relatorio_admin` | Por projeto: quantidade de avaliações, estande e média (só avaliações **não canceladas**) |
| `view_relatorio_projetos` | Projetos com notas individuais em JSON (`avaliacoes_detalhadas`) |
| `view_relatorio_avaliadores` | Avaliações por avaliador com início, fim e duração (`tempo_formatado`) |
| `view_relatorio_ausencias` | Ausências de `historico_impedimentos` (`tipo = 'ausencia'`); view legada, o front-end lê `fn_relatorio_ausencias_completo` |
| `view_projetos_quarentena` | Projetos com divergência > 2,5 pontos (com 2+ avaliações) ou `is_quarentena = true`; divergência já aceita pelo Admin (`projetos.quarentena_resolvida_em`) só volta com avaliação nova |
| `view_projetos_pendentes_avaliacao` | Projetos abaixo da cota |
| `view_avaliadores_credenciados` | Avaliadores com check-in no evento ativo |

Todas as views usam `security_invoker` e são somente leitura.

## Storage

| Bucket | Leitura | Escrita | Conteúdo |
|---|---|---|---|
| `identidade-visual` | pública (o login mostra a imagem antes de existir sessão) | só Admin, por policy em `storage.objects` | `eventos/<id_evento>/icone.<ext>` e `.../imagem.<ext>`, até 2 MB, só PNG/JPG/WEBP/SVG |

Apagar e substituir passam pela Storage API: um gatilho do Supabase proíbe `DELETE` direto nas tabelas de
storage. Os caminhos são fixos por evento e por tipo (`upsert`), então trocar a imagem não deixa arquivo órfão.
