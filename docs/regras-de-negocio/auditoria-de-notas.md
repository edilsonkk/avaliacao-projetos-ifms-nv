# Auditoria de Notas

Como conferir se uma nota está certa, como a média se formou e quem mexeu nela.

Código: `src/features/auditoria/` (`PainelAuditoria`, `MemorialAvaliacao`, `FolhaConferencia`),
`src/lib/formatoNota.ts`. Banco: `log_auditoria`, `fn_auditar_notas`, `fn_memorial_avaliacao`,
`fn_memorial_projeto`, `fn_memorial_evento` ([funções](../banco-de-dados/funcoes-e-rpcs.md#auditoria-de-notas)).
Decisões: [ADR 0014](../decisoes/0014-trilha-de-auditoria-append-only.md) e
[ADR 0015](../decisoes/0015-ajuste-manual-de-notas.md).

## Painel de Auditoria (Admin)

Card **Auditoria de Notas** no Bloco 3, com quatro abas. Sem evento ativo, avisa e não consulta nada.

1. **Conferência** — roda `fn_auditar_notas` no evento ativo e lista o que não fecha. Vazio significa
   "todas as notas conferem". O código do projeto é um botão: abre a aba Projeto.
2. **Projeto** — busca pelo **código do projeto** (nunca por UUID) e mostra a média aberta, o memorial
   de cada avaliação, o desempate, a quarentena, os achados e o histórico de alterações.
3. **Trilha** — a `log_auditoria` do evento, com filtro por tabela e pelo que foi feito fora do sistema.
4. **Ajustes** — os ajustes manuais do Admin no evento (achado `C12`). Não são erros: é a lista que a
   comissão confere antes de homologar.

## Memorial de cálculo

A nota de cada avaliação é a **média das notas por critério ponderada pelo `peso_calculo`** de cada
pergunta ([avaliação](avaliacao-e-quarentena.md#nota-final)). O memorial mostra a conta inteira:

| Critério | Peso | Nota | Peso × Nota |
|---|---|---|---|
| Rigor metodológico | 2 | 5,00 | 10,00 |
| Apresentação | 1 | 2,00 | 2,00 |
| **Soma** | **3** | | **12,00** |

`12,00 ÷ 3 = 4,00 · gravado: 4,00` → selo **Confere**. Quando o valor sem arredondar difere, ele aparece
ao lado (`3,3333`), que é o que explica por que a nota é 3,33 e não 3,34.

O memorial aparece no painel de auditoria, no card **Excluir uma avaliação**, no accordion da aba
**Projetos e Médias** dos Relatórios (sob demanda, no link "Ver a conta das notas") e na folha de
conferência impressa.

## Conferência: o que é verificado

`fn_auditar_notas(p_id_evento)` recalcula tudo no banco e devolve achados com severidade
**grave**, **atenção** ou **informativo**:

| Código | O que acha | Severidade |
|---|---|---|
| C1 | `nota_final` diferente de Σ(nota × peso) ÷ Σ(pesos) | grave; **informativo** quando é nota arbitrada |
| C2 | avaliação ativa sem nenhuma resposta gravada | grave |
| C3 | respostas faltando, repetidas ou de pergunta de outro questionário | grave |
| C4 | nota por critério fora da escala do questionário | grave |
| C5 | nota final fora da escala | grave |
| C6 | projeto com mais avaliações ativas que a cota | atenção |
| C7 | avaliação ativa de projeto fora da competição ou sem check-in | atenção |
| C8 | avaliação com questionário diferente do fixado no projeto (só quando o evento trava o questionário no primeiro avaliador) | grave |
| C9 | a mesma média com números diferentes entre Classificação e Relatórios | grave |
| C10 | nota alterada sem passar por RPC nenhuma (`origem = 'direto'`) | grave |
| C11 | peso de pergunta alterado depois da primeira avaliação | atenção |
| C12 | ajustes manuais do Admin no evento | informativo |
| C13 | `avaliacoes.is_voto_popular` divergente da marca do questionário (`fn_auditar_voto_popular`) | grave |
| C14 | avaliador vinculado a questionário de voto popular com nota na média técnica (`fn_auditar_voto_popular`) | atenção |
| C15 | evento com mais de um questionário técnico (`fn_auditar_configuracao_questionarios`) | grave |
| C16 | questionários técnicos do evento com escalas diferentes (`fn_auditar_configuracao_questionarios`) | grave |
| C17 | avaliador fixado num questionário técnico (`fn_auditar_configuracao_questionarios`) | atenção |

C13 e C14 vivem em `fn_auditar_voto_popular`, que `fn_auditar_notas` agrega por `UNION ALL`: o Painel
de Auditoria e o memorial do projeto leem só `fn_auditar_notas`.

C15, C16 e C17 vivem em `fn_auditar_configuracao_questionarios`, agregada pelo mesmo `UNION ALL`, e
são achados da **configuração do evento**, não de uma nota: vêm sem projeto e sem avaliação. A
configuração combinada para a feira é um questionário técnico por evento, numa escala só. C16 é o que
mais pesa na premiação — notas de escalas diferentes entram na mesma média e no mesmo ranking, então a
posição passaria a depender da escala de quem avaliou.

C17 é **atenção**, não grave, porque o vínculo técnico é configuração legítima: `fn_enviar_avaliacao`
tem a regra "avaliador vinculado a um questionário só usa aquele" valendo para qualquer questionário, e
é assim que uma feira com mais de um técnico diz qual banca usa qual. O achado informa que aquele
avaliador é recusado em qualquer outro questionário — na configuração de um técnico só, o vínculo deve
ficar vazio. Ver [ADR 0020](../decisoes/0020-conferencia-de-configuracao-de-questionarios.md).

As contagens de cota (C6), de questionário fixado (C8) e de média (C9, C12) consideram **só nota
técnica**: o [voto popular](avaliacao-e-quarentena.md#voto-popular) usa outro questionário e corre fora
da cota por desenho, então acusá-lo seria falso positivo. A conta de cada voto continua conferida
(C1, C2, C3b, C10, C11).

A Classificação mostra uma faixa vermelha quando há achado grave: homologar com nota que não fecha é o
erro que essa faixa evita.

## Trilha de auditoria (`log_auditoria`)

Tabela **append-only**: não há policy de escrita, os `GRANT` de escrita são revogados e um trigger
recusa `UPDATE`, `DELETE` e `TRUNCATE` — inclusive para o dono da tabela. Só `is_admin()` lê.
O **reset global não a apaga**: sem isso, o reset apagaria justamente a prova.

A gravação é por **trigger**, não por RPC. É o que registra também a escrita direta na API REST: a
policy de escrita do Admin é `FOR ALL` ([ADR 0006](../decisoes/0006-rls-escrita-restrita-a-admin.md)), e
um `UPDATE avaliacoes SET nota_final = 10` não passava por função nenhuma.

Cada RPC confiável se identifica com `auditoria_marcar_origem()`, numa variável local à transação. O que
não se identifica fica com `origem = 'direto'`:

- em **nota** (`avaliacoes`, `respostas_avaliacao`, `perguntas_questionario`), `direto` é suspeito e vira
  o achado **C10**;
- em **credenciamento** e **check-in**, `direto` é o fluxo normal da tela do Staff, e não é acusado.

O que a trilha cobre: notas, notas por critério, pesos e escala do questionário, check-in, cota,
competição, quarentena resolvida, credenciamento (hora e autor, que antes não existiam em lugar nenhum),
pareamento e revogação de aparelho, papel do usuário, configuração do evento e o reset global (com o
resumo do que foi apagado, registrado **antes** de apagar).

Dado pessoal não entra na trilha: em `usuarios`, `cpf`, `celular` e `id_auth` são removidos do antes/depois
(LGPD, minimização). `UPDATE` que não muda valor nenhum não gera linha.

> A trilha registra a partir da data da migration `20261106010000`. Para o que é anterior, a folha de
> conferência mostra o que já existia no banco (`cancelada_em`/`cancelada_por`,
> `quarentena_resolvida_em`/`quarentena_resolvida_por`, `created_at`) e diz isso no rodapé.

## Ajuste manual do Admin

Quatro ações oficiais, todas com **motivo opcional** registrado na trilha, todas restritas ao Admin e
todas marcadas no registro afetado. Ficam no painel de auditoria, ao lado do memorial: quem ajusta está
vendo a conta que vai mudar.

| Ação | RPC | O que faz | Marca |
|---|---|---|---|
| Corrigir notas por critério | `admin_corrigir_respostas_avaliacao` | troca as notas e recalcula a nota final pela fórmula oficial | `ajuste_tipo = 'respostas_corrigidas'` |
| Lançar avaliação | `admin_lancar_avaliacao` | registra a avaliação de um avaliador do evento (ficha em papel, celular sem acesso) | `ajuste_tipo = 'lancada_pelo_admin'` |
| Arbitrar nota final | `admin_arbitrar_nota_final` | define a nota sem mexer nas respostas | `ajuste_tipo = 'nota_arbitrada'` |
| Ajustar média do projeto | `admin_ajustar_media_projeto` | bónus ou penalidade de comissão, sem tocar em avaliação | `projetos.ajuste_media` |

Validações do banco: nota dentro da escala do questionário, conjunto completo de respostas, questionário
do evento e compatível com `projetos.id_questionario_fixado`, um avaliador não avalia o mesmo projeto duas
vezes. **Passar da cota** exige confirmação explícita (`p_confirmar_acima_da_cota`) e fica marcado na
trilha. Avaliador com avaliação **cancelada** daquele projeto: a RPC recusa e manda **restaurar** em vez de
lançar outra (a unicidade `(id_projeto, id_usuario)` vale inclusive para cancelada). O ajuste de média é
limitado à amplitude da escala em uso, e `p_delta = 0` remove o ajuste.

**Nota arbitrada é o único caso em que a conta não fecha por desenho.** A conferência a trata como achado
*informativo*, com o motivo — é essa distinção que separa um ajuste legítimo de uma adulteração.

## A média do projeto, sempre aberta

`media_geral` (média das notas ativas) **+** `ajuste_media` **=** `media_final`. O quadro **Média geral do
projeto** (`src/features/auditoria/components/MemorialMediaProjeto.tsx`) mostra essa conta por extenso —
`(nota + nota + nota) ÷ n = média das notas`, o ajuste e a média final — e é o mesmo componente usado na aba
Projetos e Médias dos relatórios, para o número não divergir entre as telas. O `RANK()` do pódio ordena
pela média final, e Classificação, Relatórios e memorial mostram as três colunas
([relatórios](relatorios-e-monitoramento.md#classificação-rankingpremiacao)). O indicador **Média Geral de
Notas** dos Indicadores continua sendo a média das notas lançadas: é um indicador sobre notas, não sobre o
resultado final.

## Folha de conferência (PDF)

Botão **Folha de conferência** (um projeto) e **Folha do evento** (todos, um por página), impressas por
`window.print()` com raiz isolada por `src/lib/cssImpressao.ts`, o mesmo utilitário dos
[Relatórios](relatorios-e-monitoramento.md#impressão-em-pdf). A folha saía **em branco** enquanto isolava com
`body > *:not(#raiz) { display: none }`: a raiz de impressão não é filha de `body` — mora dentro de `#root` —, então
a regra escondia o ancestral do próprio documento. O modal que a envolve também precisa das classes `print:`, senão
os ancestrais `fixed` com altura travada cortam tudo em uma página. Conteúdo: cabeçalho oficial com data de
emissão, questionário e pesos, memorial de cada avaliação, média aberta, desempate, divergência,
conferência automática e histórico de alterações.

Dois interruptores decidem o que vai no papel:

- **Ocultar identidade dos avaliadores** — troca o nome por "Avaliador 1, 2, 3…". É o que se entrega a
  participante ou instituição.
- **Incluir os ajustes manuais** — ligado por padrão. Num recurso sobre uma nota ajustada, omitir o ajuste
  trabalha contra a coordenação.

## Formato das notas

`src/lib/formatoNota.ts` é o único lugar que decide como nota aparece: **duas casas e vírgula**
(`8,75`), peso sem casas desnecessárias (`2`, `1,5`), ajuste com sinal (`+1,50`, `−0,50`) e travessão
para valor ausente. Toda tela de nota passa por ele: dois formatos para a mesma nota bastam para alguém
achar, numa conferência, que a conta não fecha.

## Histórico

As seis falhas que esta auditoria encontrou no caminho das notas (nota alterável sem rastro, conta invisível,
reset global sem filtro de evento, `ON DELETE CASCADE`, formulário com nota máxima pré-marcada e caminho legado
de gravação) estão em [lacunas, riscos e roadmap](../roadmap.md) como `L15`–`L21`, com a migration que fechou
cada uma. O desenho das correções está no [ADR 0014](../decisoes/0014-trilha-de-auditoria-append-only.md) e no
[ADR 0015](../decisoes/0015-ajuste-manual-de-notas.md).
