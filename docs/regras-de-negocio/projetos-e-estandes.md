# Projetos e Mapa de Estandes

Código: `src/features/projetos/` (`GestorProjetos`, `MapaEstandes`).

## Gestão de projetos (`GestorProjetos`)

- Segue o [layout canônico dos gestores](../arquitetura/padroes.md#layout-canônico-dos-modais-de-gestão).
- Cadastro manual e edição gravam `id_evento`, `id_instituicao`, `id_area`, `id_modalidade` e
  `is_fora_da_competicao` (selects de Instituição, Área e Modalidade e checkbox "Fora da Competição").
  O formulário rápido tem Código, Título, Estande e Corredor.
- A lista mostra só os projetos do **evento ativo**. Cadastro manual e importação exigem evento ativo.
- Cada linha tem `Check-in / Desmarcar Presença` e o botão `Priorizar` / `Topo da Fila` (`aria-pressed`)
  ([forçar topo](sorteio-e-atribuicao.md#forçar-topo-da-fila)). Abaixo de 1280px os botões mostram só o ícone; o nome
  acessível identifica o projeto (ex.: "Editar projeto FETEC-001").
- Colunas ordenáveis por clique ou teclado (`aria-sort`); o código usa ordem natural (`PROJ-2` antes de `PROJ-10`).
- A busca mostra "Mostrando X de Y projetos".
- O código do projeto (`codigo_projeto`) é a chave natural **dentro do evento** (constraint
  `uq_projetos_evento_codigo`). Cadastrar um código repetido mostra "Já existe um projeto com o código … neste
  evento". O UUID nunca aparece.
- Importação: ver [importação de planilhas](importacao-de-planilhas.md).
- Projeto **fora da competição** não entra no sorteio.

## Mapa de Estandes (`MapaEstandes`)

Card no Bloco 3. Visão do pavilhão para acompanhamento em tempo real.

**Layout**
- Modal ocupando quase toda a tela (`99vw × 98vh`) e botão de **tela cheia**.
- Seletor de densidade: **Cards Grandes** (detalhes completos) ou **Cards Compactos** (mais projetos por linha).
  Grade responsiva de 1 coluna (celular) até 6 (expandido) ou 8 (compacto) em telas ultrawide.
- Agrupado por corredor (ordem alfabética); estandes em ordem natural (`A-1`, `A-2`, …, `A-10`, via
  `compararNatural`). Projetos sem estande ficam na seção "Sem Estande Atribuído". Sem corredor cadastrado, o corredor
  só é deduzido quando o estande é "letra + número" (`A-01`, `B12` → Corredor A/B); os demais (ex.: `EST-12`) ficam
  em "Corredor não informado".
- Só o **evento ativo**: sem evento ativo, a tela avisa e não consulta nada.

**Cores de status**

| Status | Cor | Regra |
|---|---|---|
| Não Credenciado | Cinza | `is_check_in_realizado` diferente de `true` (vazio conta como não credenciado) |
| Credenciado / Aguardando | Azul | Presente, 0 avaliações |
| Faltando Avaliações | Âmbar | `0 < avaliações < cota` |
| Avaliado / Cota Completa | Verde | `avaliações >= cota` |

A **cota** é a do projeto (`cota_avaliacoes_customizada`) ou, se vazia, a padrão do evento. Contam só avaliações não
canceladas dos projetos do evento (paginadas, sem o limite de 1000 linhas).

Indicadores extras: ícone pulsante de **trava ativa** (só travas não vencidas: as vencidas só são apagadas no próximo
sorteio), **quarentena** (a mesma lista pendente da tela Quarentena, `view_projetos_quarentena`: projeto resolvido
deixa de aparecer) e etiqueta **Fora da competição**.

**Notas**: cada card mostra `Média Geral: 9.45 pts` (ou `-`) e as notas individuais em badges
(`[ 9.5 ] [ 8.5 ] [ 9.0 ]`), para ver a dispersão de relance.

**Auditoria**: clicar num card abre o histórico de avaliações não canceladas (notas, pareceres, dados do projeto)
com botão "Editar Dados do Projeto".

**Consulta**: usa os relacionamentos do PostgREST (`modalidades(...)`, `areas_tematicas(...)`, `instituicoes(...)`).
Se alguma leitura falhar, a tela mostra o erro (não um mapa incompleto com cores erradas).

Testes: `src/features/projetos/__tests__/` (`GestorProjetos`,
`MapaEstandesVisualEStatus`).
