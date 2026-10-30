# Relatórios, Classificação e Telão

Código: `src/features/relatorios/` (`RelatoriosAdmin`, `RankingPremiacao`, `TelaoAoVivo`).
Dados: funções `fn_relatorio_projetos_completo`, `fn_relatorio_avaliadores_completo` e `fn_relatorio_ausencias_completo`,
sempre com o `id_evento` do evento ativo ([funções](../banco-de-dados/funcoes-e-rpcs.md#relatórios)). Não há consultas
alternativas: se uma função falhar, a tela mostra o erro (não um relatório vazio). Sem evento ativo, a tela avisa e não
consulta nada (o id de evento guardado no navegador não é usado).

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
   eficiência (avaliações, média geral, tempo médio por projeto). Inclui distribuição por cota (sem avaliação,
   abaixo da cota, cota concluída), quarentena, top 5 avaliadores mais produtivos e distribuição por modalidade e
   grande área.

Regras comuns:
- Na aba Projetos, a coluna **Código do Projeto** ordena pelo código em ordem natural (PROJ-2 antes de PROJ-10); os
  cabeçalhos funcionam pelo teclado.
- Indicadores: avaliadores cadastrados/credenciados vêm de `avaliadores_evento` do evento, só com papel Avaliador (sem o Staff; sem estimativa).
- Indicadores, meta e conclusão (mesma regra do Telão): a meta soma a cota de cada projeto **presente e na competição**
  (`cota_avaliacoes` de `fn_relatorio_projetos_completo`: a customizada do projeto ou a padrão do evento); cada projeto
  conta no máximo até a sua cota. A distribuição por cota considera só esses projetos.
- Indicadores, projetos: **não credenciados** = sem check-in; **ausentes** = com check-in, marcados ausentes no
  estande e sem avaliação.
- Grupos começam recolhidos, com `Expandir Todos` / `Recolher Todos`.
- Datas no formato `DD-MM-YYYY`.
- **Exportar CSV** exporta a aba ativa (sem estande), em UTF-8 com BOM e com campos protegidos contra fórmulas
  (`src/lib/csv.ts`).
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

Card **Classificação**: pódio para homologação e premiação, só do **evento ativo** (sem evento ativo, a tela avisa e
não consulta nada). Os dados vêm de `view_ranking_top3`:

- Entram os projetos com ao menos uma avaliação não cancelada; projetos **fora da competição não entram**.
- A média é a simples das notas finais, calculada no banco. A `posicao` também vem do banco: `RANK()` por evento,
  modalidade e área. **Empate divide a posição** (1º, 1º, 3º) e o card mostra "(empate)". Não há critério oficial de
  desempate (`peso_desempate` não é usado): a comissão decide.
- O pódio de cada modalidade/área mostra todos com posição até 3 (um empate pode colocar mais de três).
- Projeto com notas divergentes ainda não resolvidas na Quarentena (`em_quarentena`) aparece marcado, e a tela avisa
  para resolver antes de homologar.
- Sem modalidade/área, aparece "Sem modalidade"/"Sem área temática"; estande e instituição ausentes não são
  inventados.
- Erro de leitura aparece como alerta (não como "nenhum projeto").
- **Exportar CSV** (`classificacao_premiacao.csv`): UTF-8 com BOM (acentos certos no Excel), posição do banco, coluna
  "Em quarentena" e campos começados por `=`, `+`, `-` ou `@` prefixados com `'` (não viram fórmula).

## Telão ao Vivo (`TelaoAoVivo`)

Projeção pública (rota `/telao`, sem login; também abre como modal no painel do Admin). Mostra a evolução da feira
**sem revelar notas, nomes ou títulos**: os dados vêm só de `fn_telao_resumo` (agregados), atualizada a cada 10 s e na
hora em que a tela volta do segundo plano. O Telão **não** mostra o ranking (a premiação usa a Classificação).

- Sempre o **evento ativo do banco** (não um id guardado no navegador). O título é o nome (e a edição) do evento; sem
  evento ativo, "Nenhum evento ativo".
- **Meta global**: soma da cota de cada projeto **presente** (check-in feito) e **na competição**, usando a cota do
  projeto ou a padrão do evento. **Concluídas**: avaliações não canceladas desses projetos, no máximo a cota de cada um
  (avaliação extra não infla o progresso). **Em andamento**: travas não vencidas do evento (o card mostra todas; na
  distribuição da meta só contam as de projetos presentes, na competição e abaixo da cota). **Restantes**: o que falta
  da meta.
- **Avaliadores**: credenciados no evento com papel **Avaliador** (o credenciamento do Staff, guardado na mesma
  tabela, não entra), igual às telas Avaliadores e Staff.
- **Quarentena**: número de projetos com quarentena pendente (`view_projetos_quarentena`).
- **Tempo decorrido**: desde a data e o horário de início do evento, no relógio do computador do telão ("Começa às
  HH:MM" antes do início; "Início não configurado" sem horário).
- Selo "Ao vivo — atualizado às HH:MM:SS"; se a consulta falhar, "Sem conexão — dados de HH:MM:SS", mantendo os
  últimos números.

Testes: `src/features/relatorios/__tests__/RelatoriosAdminCompletosEIndicadores.test.tsx`,
`TelaoAoVivo.test.tsx`, `supabase/tests/18_telao_test.sql`,
`src/__tests__/integracao/AuditoriaPerformanceViews.test.tsx`.
