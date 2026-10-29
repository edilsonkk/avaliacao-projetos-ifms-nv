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
| `metodos_vinculo` | `ambos`, `pareamento` ou `codigo` |

Os limites ficam em `CHECK` no banco e são editados nas Configurações do evento (engrenagem).

### `instituicoes`
Instituições de ensino de projetos e avaliadores. Base do bloqueio de conflito de interesse.
`id_instituicao`, `id_evento`, `nome_exibicao`, `nome_normalizado`, `sigla`, `campus`, `cidade`, `estado`.
Único por `(id_evento, nome_normalizado)`.

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

### `avaliadores_evento`
Vínculo da pessoa com o evento. PK `(id_usuario, id_evento)`.
`id_instituicao` (usada no conflito de interesse) e `is_credenciado` (check-in presencial).

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

A tabela **não** tem colunas textuais `modalidade`, `area_conhecimento` ou `nome_instituicao`. Use os relacionamentos
(`modalidades(nome_modalidade)`, `areas_tematicas(nome_area)`, `instituicoes(nome_exibicao, sigla)`).

### `questionarios` e `perguntas_questionario`
- `questionarios`: `id_questionario`, `id_evento`, `titulo`, `escala_minima`, `escala_maxima`.
- `perguntas_questionario`: `id_pergunta`, `id_questionario`, `texto_pergunta`, `peso_calculo`, `peso_desempate`,
  `ordem`.

## Avaliação

### `avaliacoes`
| Coluna | Descrição |
|---|---|
| `id_avaliacao` | PK |
| `id_projeto`, `id_usuario`, `id_questionario` | FKs |
| `nota_final` | Calculada no servidor por `fn_enviar_avaliacao` |
| `parecer_final` | Texto do avaliador |
| `status` | `CONCLUIDA` (padrão), `CANCELADA` (soft delete), `AUSENTE` |
| `status_avaliacao` | Espelho legado de `status` em minúsculas |
| `is_quarentena` | Marcada por divergência de notas |
| `tempo_presenca` | Início da avaliação (confirmação de presença no estande) |
| `tempo_submissao` | Envio |

Restrição `unica_avaliacao_por_usuario UNIQUE (id_projeto, id_usuario)`: um avaliador avalia um projeto **uma única
vez**, inclusive se a avaliação foi cancelada. Ver
[ADR 0005](../decisoes/0005-sorteio-nao-repete-avaliador.md).

### `respostas_avaliacao`
Nota por critério: `id_resposta`, `id_avaliacao`, `id_pergunta`, `nota_atribuida`.

### `locks_ativos`
Travas de avaliação em andamento: `id_lock`, `id_usuario` (**único**: um projeto por vez por avaliador),
`id_projeto` (vários avaliadores permitidos: banca), `bloqueado_em`, `expira_em`, `atribuido_por` (Admin da
atribuição forçada; `NULL` = sorteio).

### `fila_atribuicoes_direcionadas`
Atribuições feitas pela coordenação: `id_atribuicao`, `id_usuario`, `id_projeto`, `ordem`,
`status` (`pendente`, `em_andamento`, `concluido`, `cancelado`, `ja_avaliado`).

### `historico_impedimentos`
Registro de conflitos e ausências: `id_usuario`, `id_projeto`, `tipo`, `created_at`. Alimenta o relatório de
ausências.

## Views

| View | Conteúdo |
|---|---|
| `view_ranking_top3` | Apesar do nome: **todos** os projetos com avaliação não cancelada, com modalidade, área, notas e média **simples**, ordenados pela média. O corte por modalidade e o top 3 são feitos no front-end (ver PRD, L11) |
| `view_relatorio_admin` | Por projeto: quantidade de avaliações, estande e média |
| `view_relatorio_projetos` | Projetos com notas individuais em JSON (`avaliacoes_detalhadas`) |
| `view_relatorio_avaliadores` | Avaliações por avaliador com início, fim e duração (`tempo_formatado`) |
| `view_relatorio_ausencias` | Ausências de `avaliacoes` (status `AUSENTE`) e `historico_impedimentos` |
| `view_projetos_quarentena` | Projetos com divergência > 2,5 pontos (com 2+ avaliações) ou `is_quarentena = true`; divergência já aceita pelo Admin (`projetos.quarentena_resolvida_em`) só volta com avaliação nova |
| `view_projetos_pendentes_avaliacao` | Projetos abaixo da cota |
| `view_avaliadores_credenciados` | Avaliadores com check-in no evento ativo |

Todas as views usam `security_invoker` e são somente leitura.
