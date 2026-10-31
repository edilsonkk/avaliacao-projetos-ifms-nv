# Eventos

O evento (feira) é a unidade de isolamento de todos os dados. Código: `src/features/admin/`
(`TelaAdmin`, `ModalConfiguracoesEvento`).

## Escopo por evento

- `instituicoes`, `modalidades`, `areas_tematicas`, `questionarios`, `projetos`, `avaliadores_evento`,
  `avaliador_areas` e `avaliador_modalidades_bloqueadas` têm `id_evento` (FK para `eventos`, `ON DELETE CASCADE`).
- Os gestores (`GestorProjetos`, `GestorAvaliadores`, `GestorModalidades`, `GestorInstituicoes`…) filtram sempre por
  `.eq('id_evento', id_evento_ativo)`.
- Unicidade por evento: `instituicoes (id_evento, nome_normalizado)`, `modalidades (id_evento, nome_modalidade)`,
  `areas_tematicas (id_evento, nome_area)`.
- **Projeto sem `id_evento` fica invisível** para o sorteio e para os relatórios (`NULL = p_id_evento` é falso). Por
  isso, cadastro, edição e importação de projetos sempre gravam `id_evento`. Ao abrir o `GestorProjetos`, projetos
  legados com `id_evento IS NULL` recebem o evento ativo automaticamente.
- O evento ativo vem **sempre do banco** (`eventos.is_ativo`): o painel do Admin o lê e o repassa às telas; Staff,
  Telão e autocadastro o leem direto (o autocadastro aceita também `?evento=` no link). O `localStorage`
  (`evento_ativo_id`, `evento_ativo_nome`, `evento_ativo_data`) é só registro e nunca escolhe o evento: num aparelho
  usado em outra feira ele apontaria para o evento antigo.
- Sem evento ativo, Projetos, Atribuir Projeto, Projetos Bloqueados, Quarentena, Relatórios, Staff e autocadastro
  avisam "não há evento ativo" e não mostram dados de outros eventos.

## Configurações do evento

`ModalConfiguracoesEvento` grava somente as colunas oficiais de `eventos`: `nome_evento`, `data_evento`,
`horario_inicio`, `horario_fim`, `minutos_timeout_lock`, `cota_avaliacoes_padrao` e `sistema_liberado`.

- Não envie `data_inicio`/`data_fim` (legadas) nem string ISO em `limite_corte` (coluna numérica). Isso já causou
  `PGRST204` e perda silenciosa da data (ver [troubleshooting](../operacao/troubleshooting.md#data-do-evento-não-era-salva)).
- Ao salvar, `ao_salvar_sucesso(nome_evento, dataFormatada)` atualiza o painel e o `localStorage` na hora, sem F5.
- Também dá acesso à **Gestão de Administradores**.
- **Segurança das contas** (gravada à parte, botão **Salvar segurança**; vale para o sistema todo, não por evento):
  exigir segundo fator (MFA) no login do Admin e encerrar a sessão de Admin e Staff após N minutos sem uso. Detalhes
  em [segurança](../arquitetura/seguranca.md#segundo-fator-do-admin-e-expiração-de-sessão).
- Layout em três colunas (Evento, Acesso dos avaliadores, Segurança das contas + Gestão de Eventos + Zona de Perigo), sem rolagem a partir
  de 1280×720; em telas menores as colunas empilham e o modal rola por dentro.
- Cada campo tem um ícone de dica (`Dica`, em `src/components/ui/`) que explica o campo ao passar o mouse, ao focar
  pelo teclado ou ao tocar. Os textos das dicas de acesso ficam em `LIMITES_ACESSO` (`acessoAvaliadores.ts`).

Criação de evento: se o PostgREST rejeitar colunas novas por schema cache, o insert é refeito só com os campos base
(ver [troubleshooting](../operacao/troubleshooting.md#schema-cache-desatualizado-no-postgrest)).

- O cadastro não envia `limite_corte`: a data do evento vai só em `data_evento`.
- Ao criar ou ativar um evento, o novo evento é gravado (ou ativado) **antes** de os outros serem desativados. Se a
  gravação falhar, o evento ativo atual continua ativo.

## Janela de avaliação

Avaliações só acontecem dentro de `data_evento` + `horario_inicio`…`horario_fim` e com `sistema_liberado = true`.

Função pura `validarJanelaAvaliacao(info, dataHoraReferencia)` (`TelaAvaliador.tsx`):

| Status | Quando | Tela |
|---|---|---|
| `sistema_bloqueado` | `sistema_liberado === false` | Bloqueado |
| `horario_nao_configurado` | Data ou horários nulos | "Login Conectado com Sucesso" + aviso de horários em definição, botão de verificar e sair |
| `antes_do_inicio` | Antes de `data_evento + horario_inicio` | "Login Conectado com Sucesso" (`CheckCircle2`), avaliador, data, horário de início, `Atualizar / Verificar Horário` e `Sair da Conta` |
| `liberado` | Dentro da janela | Fluxo normal |
| `apos_o_fim` | Depois de `data_evento + horario_fim` | "Avaliações Encerradas", horário de término, `Sair da Conta` |

Exceção: quem tem avaliação em andamento (trava ativa) conclui normalmente após o fim. O servidor só recusa se
`sistema_liberado = false`.

Para encerrar a feira, o Admin define `sistema_liberado = false`.

## Reset global

`admin_reset_global(p_id_evento)` apaga **atomicamente** todos os dados do evento: respostas, avaliações, fila,
travas, projetos, questionários, avaliadores temporários, instituições, modalidades e áreas temáticas
(`WHERE id_evento = ...`).

- Exige digitar o token do evento (ex.: `RESETAR-FETEC-MS-2026`) e confirmar num segundo modal.
- Só o Admin autenticado pode executar ([segurança](../arquitetura/seguranca.md#funções)).
- A função verifica em `information_schema.columns` se `id_evento` existe antes de usá-la, para funcionar com
  esquemas legados (ver [troubleshooting](../operacao/troubleshooting.md#reset-global-falha-com-column-id_evento-does-not-exist)).

Testes: `src/features/admin/__tests__/` (`GestaoNovoEvento`, `ModalConfiguracoesEventoData`, `ResetGlobal`,
`SincroniaContadores`).
