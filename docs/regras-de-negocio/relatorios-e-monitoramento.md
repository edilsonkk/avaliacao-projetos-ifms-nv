# Relatórios, Classificação e Telão

Código: `src/features/relatorios/` (`RelatoriosAdmin`, `RankingPremiacao`, `TelaoAoVivo`).
Dados: funções `fn_relatorio_projetos_completo`, `fn_relatorio_avaliadores_completo`,
`fn_relatorio_ausencias_completo`, `fn_relatorio_devolucoes_completo` e `fn_relatorio_voto_popular_completo`,
sempre com o `id_evento` do evento ativo ([funções](../banco-de-dados/funcoes-e-rpcs.md#relatórios)). Não há consultas
alternativas: se uma função falhar, a tela mostra o erro (não um relatório vazio). Sem evento ativo, a tela avisa e não
consulta nada (o id de evento guardado no navegador não é usado).

## Relatórios (`RelatoriosAdmin`)

Card **Relatórios** no Bloco 3, com sete abas:

1. **Projetos e Médias**: código do projeto em destaque (o estande **não** aparece). A coluna Avaliações expande as
   notas individuais: avaliador, data/hora de envio e parecer. No accordion, o quadro **Média geral do projeto** abre
   a conta do projeto — `(nota + nota + nota) ÷ n = média das notas`, o ajuste da comissão e a média final — com os
   dados que a própria consulta do relatório já traz (sem consulta a mais) e avisando quando o resultado exato foi
   arredondado para duas casas. Logo abaixo, o link **"Ver a conta das notas"** abre o
   [memorial de cálculo](auditoria-de-notas.md#memorial-de-cálculo) de cada avaliação (critério, peso e produto),
   carregado sob demanda. A coluna de média mostra a **média final** e, quando há ajuste de comissão, a conta aberta
   embaixo (`média das notas ± ajuste`), com o selo **Ajustada**; a ordenação dessa coluna usa a média final, que é o
   número exibido. O mesmo quadro é usado na [auditoria de notas](auditoria-de-notas.md), para a conta do projeto ser
   idêntica nas duas telas (`src/features/auditoria/components/MemorialMediaProjeto.tsx`). Uma coluna **Voto
   Popular** mostra a média e a quantidade de votos do projeto, sempre **fora** da média técnica; `media_geral`,
   `media_final` e a contagem de avaliações são só de nota técnica.
2. **Avaliadores e Notas Atribuídas**: agrupado por avaliador (nome, e-mail, quantidade, média, tempo médio). Ao
   expandir, aparecem os projetos com código, título, nota, início, fim, duração e parecer.
3. **Avaliadores e Ausências Atribuídas**: agrupado por avaliador (nome, e-mail, total). Ao expandir: código, título,
   área, modalidade, instituição, data/hora e status atual (sem estande). Fonte: `historico_impedimentos` com
   `tipo = 'ausencia'`, por `fn_relatorio_ausencias_completo`.
4. **Avaliadores e Devoluções Atribuídas**: quantas devoluções cada avaliador fez. **Devolução** é o botão
   **"Devolver (Conflito de Interesse)"** da tela do avaliador, que devolve o projeto à fila e grava
   `historico_impedimentos` com `tipo = 'conflito'` (`fn_registrar_impedimento`). Mesmas colunas da aba de
   Ausências — código, título, modalidade, área, instituição, data/hora da devolução e situação atual do projeto
   (sem estande) —, por `fn_relatorio_devolucoes_completo`. Ausência e devolução são contagens **separadas**: cada
   aba conta só o seu tipo.
5. **Voto Popular**: um projeto por linha, ordenado pela **média bayesiana** calculada no banco
   (`fn_relatorio_voto_popular_completo`), com posição, votos, média dos votos e média bayesiana. Acima da tabela,
   a conta aberta da fórmula, com a âncora (média de todos os votos do evento) e o peso em votos. A aba só mostra
   projetos que receberam voto. Ver [voto popular](avaliacao-e-quarentena.md#voto-popular) e
   [ADR 0016](../decisoes/0016-voto-popular-separado-e-media-bayesiana.md).
6. **Instituições e Projetos Submetidos**: agrupado por escola com total de trabalhos. Ao expandir: código, nome,
   área, modalidade e média (ou "Ausente"/"Não Credenciado").
7. **Indicadores do evento: NOME DO EVENTO**: horário inicial e final, status, barra de conclusão global, KPIs de
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
- Grupos começam recolhidos, com `Expandir Todos` / `Recolher Todos`. As abas de Ausências e de Devoluções são o
  mesmo componente (`src/features/relatorios/components/AbaImpedimentos.tsx`) com rótulos diferentes, e o
  agrupamento, a busca e a ordenação vêm de `src/features/relatorios/impedimentos.ts`.
- Datas no formato `DD-MM-YYYY`. Notas e médias em **duas casas com vírgula** (`8,75 pts`), por
  `src/lib/formatoNota.ts` — o mesmo formato em todas as telas.
- **Exportar CSV** exporta a aba ativa (sem estande), em UTF-8 com BOM e com campos protegidos contra fórmulas
  (`src/lib/csv.ts`). Na aba Projetos saem três colunas de resultado: **Média das Notas**, **Ajuste de Comissão** e
  **Média Final**.
- Duração de avaliação = `tempo_submissao − tempo_presenca`, formatada `Xm Ys`.

## Impressão em PDF

Botão **Imprimir PDF** em todas as abas (`window.print()`).

- Página: Indicadores em **A4 paisagem** (margem 8 mm); demais abas em **A4 retrato** (10 mm), via `@page` dinâmico.
- Imprime **100% dos registros do evento**, ignorando a busca da tela e mantendo a ordenação escolhida (listas
  memoizadas `*_todos_ordenados`).
- Layout **só texto**: sem badges, cards, sombras ou bordas. Detalhes recuados abaixo de cada item
  (`• Avaliador: Nota | Parecer`). Grupos expandidos automaticamente. Na aba Projetos sai também a linha
  `Conta da média: (… + …) ÷ n = … | ajuste da comissão: … | média final: … pts`, a mesma conta que a tela mostra.
- Cabeçalho oficial: nome do evento em maiúsculas, nome do relatório, data/hora de emissão e data do evento.
- Isolamento do DOM: só `#relatorio-print-root` fica visível; o modal pai em `TelaAdmin` remove posicionamento fixo,
  backdrop e scroll na impressão. Botões, abas e busca ficam ocultos (`print:hidden`); linhas não quebram entre
  páginas (`break-inside: avoid`).

## Classificação (`RankingPremiacao`)

Card **Classificação**: pódio para homologação e premiação, só do **evento ativo** (sem evento ativo, a tela avisa e
não consulta nada). Os dados vêm de `view_ranking_top3`:

- Entram os projetos com ao menos uma avaliação não cancelada; projetos **fora da competição não entram**.
- A média é a simples das notas finais, calculada no banco, e aparece aberta: `media_geral` (média das notas)
  **+** `ajuste_media` (bónus ou penalidade de comissão) **=** `media_final`. A `posicao` também vem do banco:
  `RANK()` por evento, modalidade e área, **ordenado pela média final**. **Empate na média é desfeito pela prioridade das perguntas** (`peso_desempate` 1, 2, 3…; 0 fica
  fora): vence a maior média do projeto na pergunta de prioridade 1; persistindo, a 2, e assim por diante
  (`fn_chave_desempate`, coluna `chave_desempate`). O card desempatado mostra o selo "Desempate" e as médias por
  pergunta **em texto** (antes elas ficavam só no `title`, e a comissão precisa ler, não passar o mouse). Se tudo empatar, a posição é dividida (1º, 1º, 3º), o card mostra "(empate)" e a comissão decide. Projetos
  com questionários diferentes na mesma modalidade/área são comparados posição a posição da prioridade.
- O pódio de cada modalidade/área mostra todos com posição até 3 (um empate pode colocar mais de três).
- Projeto com notas divergentes ainda não resolvidas na Quarentena (`em_quarentena`) aparece marcado, e a tela avisa
  para resolver antes de homologar.
- Se a [conferência de notas](auditoria-de-notas.md#conferência-o-que-é-verificado) achar algo **grave** no evento,
  uma faixa vermelha aparece no topo: há nota que não fecha com as notas por critério, e homologar nesse estado é o
  erro que a faixa evita.
- **Folha de conferência**: o PDF por projeto e o consolidado do evento saem do painel de Auditoria de Notas
  ([auditoria](auditoria-de-notas.md#folha-de-conferência-pdf)).
- Sem modalidade/área, aparece "Sem modalidade"/"Sem área temática"; estande e instituição ausentes não são
  inventados.
- Erro de leitura aparece como alerta (não como "nenhum projeto").
- **Exportar CSV** (`classificacao_premiacao.csv`): UTF-8 com BOM (acentos certos no Excel), posição do banco, coluna
  "Em quarentena", as colunas **Média das Notas**, **Ajuste de Comissão** e **Média Final**, e campos começados por
  `=`, `+`, `-` ou `@` prefixados com `'` (não viram fórmula).
- **Voto popular**: seção à parte no fim da tela, com classificação própria ordenada pela **média bayesiana**
  (`fn_relatorio_voto_popular_completo`), mostrando média dos votos, quantidade de votos e a conta da âncora. Não
  interfere no pódio técnico, que segue por `view_ranking_top3` (já sem o voto popular). As posições do voto popular
  **mudam durante a votação**, porque a âncora e o peso são do evento inteiro — está escrito na tela.

## Telão ao Vivo (`TelaoAoVivo`)

Projeção pública (rota `/telao`, sem login). O botão **Telão** do cabeçalho abre essa rota **em uma aba nova**, para
a tela em uso (o painel do Admin, por exemplo) não se perder; o botão não aparece para o Staff nem dentro do próprio
Telão. Não há painel de monitoramento separado: o Telão é a única tela de acompanhamento ao vivo. Mostra a evolução da feira
**sem revelar notas, nomes ou títulos**: os dados vêm só de `fn_telao_resumo` (agregados), atualizada a cada 10 s e na
hora em que a tela volta do segundo plano. O Telão **não** mostra o ranking (a premiação usa a Classificação).

- **Voto popular**: um bloco com três contadores — votos registrados, projetos votados e votantes credenciados —,
  exibido só quando o evento tem votante ou voto. São **agregados**, nunca nota ou nome: a média do voto popular fica
  na Classificação, que é do Admin. O teste `supabase/tests/18_telao_test.sql` garante que o resumo do Telão não
  contenha `nota`, `media`, `titulo` nem `email` — é por isso que as chaves são `votos_populares`, `projetos_votados`
  e `votantes_credenciados`.
- Meta, realizadas, em andamento e "avaliação finalizada" contam **só nota técnica**.

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
- **Avaliação finalizada**: quando há projetos presentes na competição e todos atingiram a sua cota, o Telão mostra
  o aviso "Avaliação finalizada" e o painel do Admin mostra a mesma faixa (atualizada a cada 30 s). A tela do
  avaliador usa a mesma regra (`fn_feira_concluida`). Projeto sem check-in não impede o fim (o sorteio não o entrega);
  se ele fizer check-in depois, a avaliação reabre.
- **Tempo decorrido**: desde a data (`data_evento`) e o horário de início do evento, no relógio do computador do telão ("Começa às
  HH:MM" antes do início; "Início não configurado" sem horário).
- Selo "Ao vivo — atualizado às HH:MM:SS"; se a consulta falhar, "Sem conexão — dados de HH:MM:SS", mantendo os
  últimos números.

Testes: `src/features/relatorios/__tests__/RelatoriosAdminCompletosEIndicadores.test.tsx`,
`TelaoAoVivo.test.tsx`, `supabase/tests/18_telao_test.sql`,
`src/__tests__/integracao/AuditoriaPerformanceViews.test.tsx`.
