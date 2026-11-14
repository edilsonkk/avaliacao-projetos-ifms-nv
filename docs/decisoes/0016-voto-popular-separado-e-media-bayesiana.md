# ADR 0016 — Voto popular em pista separada, ordenado por média bayesiana

- **Data:** 2026-11-11
- **Situação:** aceita

## Contexto

A feira passou a ter dois julgamentos sobre o mesmo projeto: a **avaliação técnica**, feita por
avaliadores com cota, quarentena e ranking por modalidade e área, e o **voto popular**, dado por
visitantes ou por um júri popular. Misturar os dois na mesma média destruiria os dois: a nota técnica
seria diluída por centenas de votos de público, e o voto popular seria limitado pela cota de três
avaliações por projeto.

Duas decisões precisavam ser tomadas: **como separar** e **como ordenar** o voto popular.

## Decisão

### 1. A marca fica no questionário, não no avaliador

`questionarios.is_voto_popular` é a fonte da verdade. Cada avaliação copia a marca no momento em que
é gravada (`avaliacoes.is_voto_popular`, mantida por trigger `BEFORE`), e `admin_marcar_questionario_voto_popular`
recusa trocar a marca de um questionário que já tem avaliação.

A alternativa era deduzir do vínculo do avaliador (`avaliadores_evento.id_questionario`). Foi
recusada: mudar o vínculo de alguém depois da feira reclassificaria notas antigas e alteraria médias
já publicadas. A marca no questionário congela a classificação no histórico.

A coluna denormalizada em `avaliacoes` existe por desempenho e por clareza: toda contagem de cota,
média, quarentena, meta e ranking ganha um `AND NOT a.is_voto_popular` em vez de um join a mais, e o
achado **C13** da conferência acusa qualquer divergência entre a cópia e a marca.

### 2. O voto popular corre em pista separada

Nota de voto popular **não** entra na média técnica, **não** ocupa cota, **não** aciona quarentena por
divergência, **não** entra no ranking técnico nem na meta do Telão, e **não** fixa o questionário do
projeto. Tem média, classificação e relatório próprios.

No sorteio, o votante ignora a cota técnica e as travas: vários votantes podem estar no mesmo projeto
ao mesmo tempo, e a presença de um votante não impede o avaliador técnico (nem o contrário). Cada
votante vota cada projeto no máximo uma vez, garantido pela restrição `unica_avaliacao_por_usuario`
que já existia.

### 3. A classificação do voto popular usa média bayesiana

```
média bayesiana = (v / (v + m)) × R  +  (m / (v + m)) × C

R = média dos votos do projeto
v = quantidade de votos do projeto
C = média de todos os votos do evento (a âncora)
m = peso da âncora, em votos
```

`m` é **automático**: total de votos ÷ projetos com ao menos um voto, ou seja, a média de votos por
projeto votado. Acompanha o volume real da feira, sem ninguém precisar calibrar um número.

A alternativa era um **mínimo de votos** para entrar no ranking. Foi preterida porque exclui projetos
em vez de pesá-los, e porque exige escolher um corte arbitrário.

## Consequências

- **`media_geral` e `total_avaliacoes` mudaram de significado**: passam a ser só de nota técnica. Em
  evento sem voto popular nada muda, porque a coluna nasce `false`.
- **As posições do voto popular mudam durante a votação**, mesmo sem um projeto receber voto novo:
  `m` e `C` são do evento inteiro e crescem conforme os votos chegam. Isso está escrito na tela da
  Classificação e na aba do relatório, para não parecer erro de cálculo.
- **A bayesiana reduz, mas não elimina, a vantagem de um voto alto isolado.** Ela puxa a nota do
  projeto para a âncora `C`; quando `C` é alta (feira com médias altas) e há poucos projetos votados
  (`m` pequeno), um único voto 10 ainda pode liderar. Garantia só existiria com um mínimo de votos —
  que foi preterido. Se isso incomodar na prática, o caminho é acrescentar o mínimo **junto** da
  bayesiana, sem trocar uma pela outra.
- **O Telão continua público e sem nota**: dele só saem contagens (`votos_populares`,
  `projetos_votados`, `votantes_credenciados`). A média do voto popular fica na Classificação, que é
  do Admin.
- A atribuição forçada (banca e fila direcionada) recusa votante: são ferramentas de avaliação
  técnica e a trava ocuparia vaga indevidamente.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Voto popular como `papel_usuario` novo | Mexeria na identidade do banco (`is_admin()`, `avaliador_atual()`, RLS) para resolver um problema de classificação de **nota** |
| Média simples, sem âncora | Um projeto com um voto 10 lideraria sempre |
| Mínimo de votos para entrar no ranking | Exclui projeto em vez de pesar; exige corte arbitrário |
| Ordenar por quantidade de votos | Ignora as notas dadas pelo público |
| Voto popular ocupando a cota do projeto | Reduziria as notas técnicas disponíveis e misturaria os dois mundos na meta do Telão |

## Referências

- [Avaliação e quarentena](../regras-de-negocio/avaliacao-e-quarentena.md)
- [Sorteio e atribuição](../regras-de-negocio/sorteio-e-atribuicao.md)
- [Relatórios e monitoramento](../regras-de-negocio/relatorios-e-monitoramento.md)
- [ADR 0001 — lógica crítica no banco](0001-logica-critica-no-banco.md)
