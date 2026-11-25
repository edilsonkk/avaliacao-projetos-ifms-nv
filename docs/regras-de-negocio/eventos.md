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

`ModalConfiguracoesEvento` grava as colunas oficiais de `eventos`: `nome_evento`, `edicao`, `data_evento`, `horario_inicio`,
`horario_fim`, `minutos_timeout_lock`, `cota_avaliacoes_padrao` e `sistema_liberado`, mais os parâmetros de acesso
dos avaliadores (`minutos_validade_pareamento`, `minutos_validade_codigo_acesso`, `tamanho_codigo`,
`max_tentativas_codigo` e `metodos_vinculo`).

- **Formas de vincular o celular** (`metodos_vinculo`): uma por evento — `pareamento` (padrão) ou `codigo`. Ver
  [credenciamento](credenciamento-e-pessoas.md#login).
- **Travar o questionário no primeiro avaliador** (`fixar_questionario_primeira_avaliacao`, padrão ligado): ver
  [avaliação](avaliacao-e-quarentena.md#fluxo-do-avaliador).

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
O banco confere a mesma regra no sorteio e na fila (`fn_janela_avaliacao_aberta`, no fuso `America/Campo_Grande`):
pela API não dá para sortear fora da janela. Quem já está com o projeto pode enviar depois do horário, mas não com o
sistema pausado.

Função pura `validarJanelaAvaliacao(info, dataHoraReferencia)` (`TelaAvaliador.tsx`):

| Status | Quando | Tela |
|---|---|---|
| `sistema_bloqueado` | `sistema_liberado === false` | Bloqueado |
| `horario_nao_configurado` | Data ou horários nulos | "Login Conectado com Sucesso" + aviso de horários em definição, botão de verificar e `Sair e desvincular` |
| `antes_do_inicio` | Antes de `data_evento + horario_inicio` | "Login Conectado com Sucesso" (`CheckCircle2`), avaliador, data, horário de início, `Atualizar / Verificar Horário` e `Sair e desvincular` |
| `liberado` | Dentro da janela | Fluxo normal |
| `apos_o_fim` | Depois de `data_evento + horario_fim` | "Avaliações Encerradas", horário de término, `Sair e desvincular` |

Exceção: quem tem avaliação em andamento (trava ativa) conclui normalmente após o fim. O servidor só recusa se
`sistema_liberado = false`.

**A janela é de um único dia.** Ela não é um intervalo livre: deriva de `data_evento` somada a `horario_inicio` e
`horario_fim`, então virar a meia-noite fecha o sistema, e não existe `data_fim`. Feira de dois dias precisa de
`data_evento` atualizada no segundo dia — a mesma razão pela qual o seeder local adianta a data com `--reutilizar`
([ambiente local](../operacao/ambiente-local-do-zero.md#idempotência)). Sintoma típico: tudo funcionava e, sem
ninguém mexer em nada, `fn_janela_avaliacao_aberta` passou a devolver `false`.

Para **pausar** a feira (almoço, rede caindo, atraso na programação), o Admin desmarca
`sistema_liberado`; marcar de novo retoma tudo, sem mexer em vínculo de celular.

Para **encerrar**, o botão **Finalizar evento** (Configurações do evento) chama
`admin_finalizar_evento(p_id_evento)`, que numa transação: fecha `sistema_liberado`, apaga as travas dos projetos
do evento, revoga o vínculo de celular dos avaliadores do evento, queima os códigos de acesso pendentes e grava um
resumo na [trilha](auditoria-de-notas.md#trilha-de-auditoria-log_auditoria) com as três contagens.

- **O evento continua ativo** (`is_ativo`): relatórios, classificação, auditoria e Telão leem o evento ativo, e é
  deles que a comissão precisa depois do encerramento.
- **Nenhuma nota é apagada** — finalizar não é reset; trava não é nota.
- A confirmação informa **quantas avaliações estão em andamento** naquele instante (de `fn_telao_resumo`): elas são
  devolvidas sem gravar nota.
- Depois de finalizar, o avaliador precisa **parear o celular de novo** com a equipe, porque o vínculo é uma sessão
  anônima sem senha ([troubleshooting](../operacao/troubleshooting.md#avaliador-saiu-e-o-código-de-acesso-não-serve-mais)).
- **Não há encerramento automático**, nem por horário nem ao desmarcar a pausa: não existe agendador no projeto e o
  efeito é destrutivo demais para gatilho indireto ([ADR 0017](../decisoes/0017-finalizar-evento-como-acao-propria.md)).

### O que finalizar NÃO tranca: o pareamento

Finalizar **não** fecha a porta do pareamento. `fn_parear_dispositivo` não consulta `sistema_liberado`, e
`parametros_acesso()` só exige que o evento exista — então, depois de `admin_finalizar_evento`, o Staff ainda pareia
um aparelho normalmente, e o pareamento **regrava `is_credenciado = true`** no avaliador. Medido com uma sonda logo
após finalizar um evento: `fn_solicitar_pareamento` devolveu código, `fn_parear_dispositivo` aceitou e
`fn_meu_perfil` voltou a dizer `avaliador`; no banco sobrou um aparelho não revogado entre os que a finalização
havia revogado.

**A trava real depois de finalizar é a janela de horário, não a finalização.** O aparelho recém-pareado não sorteia
nem envia nota, porque `admin_finalizar_evento` deixou `sistema_liberado = false` e
`fn_janela_avaliacao_aberta` passa a devolver false — é isso que impede a avaliação, não o estado "finalizado"
(que, a rigor, não existe: o evento continua ativo e nenhuma coluna o marca como encerrado).

Consequências práticas para a coordenação:

- depois de finalizar, **não conte com a finalização para impedir credenciamento**: um pareamento feito por engano
  recoloca o avaliador como credenciado e deixa um aparelho vinculado, o que suja a contagem de
  `avaliadores_credenciados` do Telão e dos relatórios;
- se o estado precisa ficar limpo, confira os vínculos depois (`fn_situacao_vinculos`) e desvincule o que sobrou
  (Admin → Avaliadores);
- em contrapartida, é exatamente por isso que **recuperar de uma finalização acidental é simples**: religar
  `sistema_liberado` e parear de novo, sem nenhum destravamento especial.

Acrescentar a checagem de `sistema_liberado` a `fn_parear_dispositivo` é uma mudança em aberto, **não decidida** —
com o custo de proibir pareamento durante qualquer **pausa**, que a [ADR 0017](../decisoes/0017-finalizar-evento-como-acao-propria.md)
separou de propósito do encerramento. Credenciar a fila na portaria durante a pausa do almoço é uso legítimo e
deixaria de funcionar.

## Identidade visual

Cada evento pode ter um **ícone** e uma **imagem** próprios, enviados na engrenagem
([como](../arquitetura/configuracao.md#identidade-visual-do-evento)). O ícone substitui o "IF" do cabeçalho e
vira o favicon; a imagem aparece no login, no autocadastro, no Telão, nos relatórios impressos e no topo da tela
do avaliador. Trocar de evento ativo troca as duas, porque ficam em `eventos`. Sem ícone enviado, o cabeçalho
mostra um marcador de pendência em vez de inventar um logotipo.

## Reset global

`admin_reset_global(p_id_evento)` apaga **atomicamente** todos os dados do evento: respostas, avaliações, fila,
travas, projetos, questionários, avaliadores temporários, instituições, modalidades e áreas temáticas
(`WHERE id_evento = ...`).

- Exige digitar o token do evento (ex.: `RESETAR-FETEC-MS-2026`) e confirmar num segundo modal.
- Só o Admin autenticado pode executar ([segurança](../arquitetura/seguranca.md#funções)).
- **Recusa rodar sem evento definido.** Antes, sem `p_id_evento` e sem evento ativo, o reset caía num caminho que
  apagava os dados de todos os eventos.
- **As notas apagadas são só as do evento.** Antes, os `DELETE` de `respostas_avaliacao` e `avaliacoes` não tinham
  filtro nenhum e levavam as avaliações de todas as feiras já realizadas (os demais passos sempre filtraram).
- Avaliador ou membro do Staff que ainda tem nota em **outro** evento não é apagado: antes, o `ON DELETE CASCADE`
  apagava as avaliações dele junto, sem deixar vestígio.
- **A trilha de auditoria sobrevive ao reset** e recebe, antes de apagar, um registro com quantas avaliações e
  quantos projetos serão apagados ([auditoria](auditoria-de-notas.md#trilha-de-auditoria-log_auditoria)).
- A função verifica em `information_schema.columns` se `id_evento` existe antes de usá-la, para funcionar com
  esquemas legados (ver [troubleshooting](../operacao/troubleshooting.md#reset-global-falha-com-column-id_evento-does-not-exist)).

Testes: `src/features/admin/__tests__/` (`GestaoNovoEvento`, `ModalConfiguracoesEventoData`, `ResetGlobal`,
`SincroniaContadores`).

## Evento de simulação

Um evento cujo nome começa com `Simulação de Carga` é uma **feira fictícia**, criada pelo painel do Admin
(engrenagem → Simulação de Evento) ou pelos scripts locais. Ele é um evento como qualquer outro para o banco:
tem os próprios projetos, avaliadores e questionários, e todo o escopo por `id_evento` vale igual.

Duas particularidades importam para a operação:

- **Enquanto a simulação roda, ela é o evento ativo.** É o que faz a feira fictícia aparecer no telão, que lê
  sempre o evento ativo. Ao encerrar, o evento que estava ativo antes volta ao posto — o nome dele fica guardado
  na `descricao` da simulação, para a restauração funcionar mesmo em outro navegador.
- **A limpeza dele não usa `admin_reset_global`**, porque aquele caminho apaga avaliadores e staff sem nota de
  toda a base. A simulação é apagada de forma dirigida, só com o que nasceu nela.

Detalhes de uso e limites em [simulação de evento](../operacao/simulacao-de-evento.md); o porquê do desenho em
[ADR 0021](../decisoes/0021-motor-de-simulacao-no-navegador.md).
