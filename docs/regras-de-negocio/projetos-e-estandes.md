# Projetos e Mapa de Estandes

Código: `src/features/projetos/` (`GestorProjetos`, `MapaEstandes`).

## Gestão de projetos (`GestorProjetos`)

- Segue o [layout canônico dos gestores](../arquitetura/padroes.md#layout-canônico-dos-modais-de-gestão).
- Cadastro manual e edição gravam `id_evento`, `id_instituicao`, `id_area`, `id_modalidade` e
  `is_fora_da_competicao` (selects de Instituição, Área e Modalidade e checkbox "Fora da Competição").
  O formulário rápido tem Código, Título, Estande e Corredor.
- Cada linha tem `Check-in / Desmarcar Presença` e o toggle `Topo da Fila` / `Normal`
  ([forçar topo](sorteio-e-atribuicao.md#forçar-topo-da-fila)).
- O código do projeto (`codigo_projeto`) é a chave natural. O UUID nunca aparece.
- Importação: ver [importação de planilhas](importacao-de-planilhas.md).
- Projeto **fora da competição** não entra no sorteio.

## Mapa de Estandes (`MapaEstandes`)

Card no Bloco 3. Visão do pavilhão para acompanhamento em tempo real.

**Layout**
- Modal ocupando quase toda a tela (`99vw × 98vh`) e botão de **tela cheia**.
- Seletor de densidade: **Cards Grandes** (detalhes completos) ou **Cards Compactos** (mais projetos por linha).
  Grade responsiva de 1 coluna (celular) até 6 (expandido) ou 8 (compacto) em telas ultrawide.
- Agrupado por corredor (ordem alfabética); estandes em ordem natural (`A-1`, `A-2`, …, `A-10`, via
  `localeCompare(..., { numeric: true })`). Projetos sem estande ficam na seção "Sem Estande Atribuído".

**Cores de status**

| Status | Cor | Regra |
|---|---|---|
| Não Credenciado | Cinza | `is_check_in_realizado = false` |
| Credenciado / Aguardando | Azul | Presente, 0 avaliações |
| Faltando Avaliações | Âmbar | `0 < avaliações < cota` |
| Avaliado / Cota Completa | Verde | `avaliações >= cota` |

Indicadores extras: ícone pulsante de **trava ativa** (avaliador no estande) e **quarentena**.

**Notas**: cada card mostra `Média Geral: 9.45 pts` (ou `-`) e as notas individuais em badges
(`[ 9.5 ] [ 8.5 ] [ 9.0 ]`), para ver a dispersão de relance.

**Auditoria**: clicar num card abre o histórico de avaliações (notas, pareceres, dados do projeto) com botão
"Editar Dados do Projeto".

**Consulta**: usa os relacionamentos do PostgREST (`modalidades(...)`, `areas_tematicas(...)`, `instituicoes(...)`).
Se falhar por schema cache, cai para as colunas nativas de `projetos`, para o mapa nunca ficar em branco.

Testes: `src/features/projetos/__tests__/` (`GestorProjetosCamposCompletos`, `ChaveNaturalUpsert`,
`MapaEstandesVisualEStatus`).
