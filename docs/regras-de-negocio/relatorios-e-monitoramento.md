# Relatórios, Classificação e Telão

Código: `src/features/relatorios/` (`RelatoriosAdmin`, `RankingPremiacao`, `TelaoAoVivo`).
Dados: funções `fn_relatorio_*` com fallback para views e tabelas ([funções](../banco-de-dados/funcoes-e-rpcs.md#relatórios)).

## Relatórios (`RelatoriosAdmin`)

Card **Relatórios** no Bloco 3, com cinco abas:

1. **Projetos e Médias**: código do projeto em destaque (o estande **não** aparece). A coluna Avaliações expande as
   notas individuais: avaliador, data/hora de envio e parecer.
2. **Avaliadores e Notas Atribuídas**: agrupado por avaliador (nome, e-mail, quantidade, média, tempo médio). Ao
   expandir, aparecem os projetos com código, título, nota, início, fim, duração e parecer.
3. **Avaliadores e Ausências Atribuídas**: agrupado por avaliador (nome, e-mail, total). Ao expandir: código, título,
   área, modalidade, instituição, data/hora e status atual (sem estande). Fonte: `historico_impedimentos` e
   avaliações com status `AUSENTE`.
4. **Instituições e Projetos Submetidos**: agrupado por escola com total de trabalhos. Ao expandir: código, nome,
   área, modalidade e média (ou "Ausente"/"Não Credenciado").
5. **Indicadores do evento: NOME DO EVENTO**: horário inicial e final, status, barra de conclusão global, KPIs de
   projetos (total, presentes, ausentes, não credenciados), de avaliadores (cadastrados, credenciados, ausentes) e de
   eficiência (avaliações, média geral, tempo médio por projeto). Inclui distribuição por cota (0, 1, 2, 3+
   avaliações), quarentena, top 5 avaliadores mais produtivos e distribuição por modalidade e grande área.

Regras comuns:
- Grupos começam recolhidos, com `Expandir Todos` / `Recolher Todos`.
- Datas no formato `DD-MM-YYYY`.
- **Exportar CSV** exporta a aba ativa (sem estande).
- Duração de avaliação = `tempo_submissao − tempo_presenca`, formatada `Xm Ys`.

## Impressão em PDF

Botão **Imprimir PDF** em todas as abas (`window.print()`).

- Página: Indicadores em **A4 paisagem** (margem 8 mm); demais abas em **A4 retrato** (10 mm), via `@page` dinâmico.
- Imprime **100% dos registros do evento**, ignorando a busca da tela e mantendo a ordenação escolhida (listas
  memoizadas `*_todos_ordenados`).
- Layout **só texto**: sem badges, cards, sombras ou bordas. Detalhes recuados abaixo de cada item
  (`• Avaliador: Nota | Parecer`). Grupos expandidos automaticamente.
- Cabeçalho oficial: nome do evento em maiúsculas, nome do relatório, data/hora de emissão e data do evento.
- Isolamento do DOM: só `#relatorio-print-root` fica visível; o modal pai em `TelaAdmin` remove posicionamento fixo,
  backdrop e scroll na impressão. Botões, abas e busca ficam ocultos (`print:hidden`); linhas não quebram entre
  páginas (`break-inside: avoid`).

## Classificação (`RankingPremiacao`)

Card **Classificação**: pódio para homologação e premiação. Os dados vêm de `view_ranking_top3`, que devolve todos
os projetos avaliados ordenados pela média simples. O agrupamento por modalidade e o corte nos três primeiros são
feitos no componente.

> ⚠️ A view não exclui projetos fora da competição nem usa `peso_desempate` (PRD, L11).

## Telão ao Vivo (`TelaoAoVivo`)

Projeção pública. Durante a feira mostra a evolução das metas **sem revelar notas**. Na premiação, revela o ranking
top 3. Acesso só pelo Admin (oculto para o Staff).

Testes: `src/features/relatorios/__tests__/RelatoriosAdminCompletosEIndicadores.test.tsx`,
`src/__tests__/integracao/AuditoriaPerformanceViews.test.tsx`.
