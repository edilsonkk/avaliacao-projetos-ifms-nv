# 0019. Toda chamada de função em policy de RLS vai dentro de um subselect escalar

- **Status**: Aceito
- **Data**: 2026-11-22

## Contexto

As policies de RLS deste banco decidem acesso chamando quatro funções de zero argumento:
`public.is_admin()`, `public.is_staff()`, `public.avaliador_atual()` e `auth.uid()`. As quatro são `STABLE`, não
`IMMUTABLE` — correto, porque o resultado depende da sessão —, e é justamente por isso que o planejador **não** as
dobra em constante. Numa cláusula `USING`, a chamada entra como filtro de linha e é avaliada **uma vez por linha
varrida**; num `WITH CHECK`, uma vez por linha escrita.

Isso não é teoria: lendo `projetos` como avaliador, o plano era

```
Filter: (is_admin() OR is_staff() OR (avaliador_atual() IS NOT NULL))
Execution Time: 12.637 ms      (176 linhas)
```

`avaliador_atual()` é a mais caríssima das quatro — três tabelas em join, um `EXISTS` e uma chamada aninhada a
`evento_ativo_id()` —, e no caminho do avaliador as duas primeiras dão falso, então ela **sempre** roda. Custo medido:
~69 µs por linha para a expressão inteira, dos quais ~50 µs são dela; `is_admin()` sozinha, ~9,6 µs por chamada.

Existe um idioma conhecido para isso: envolver a chamada num subselect escalar sem referência externa,
`USING ((SELECT public.is_admin()))`. O planejador o resolve como `InitPlan`, avaliado uma vez por comando.

## Decisão

Envolver em subselect escalar **toda** chamada dessas funções em `USING` e `WITH CHECK`, nas 46 policies de 21
tabelas que as chamam (migration `20261123001529_policies_com_initplan.sql`). As outras 4 policies de `public` são
`USING (true)` e não entram. O idioma passa a ser o padrão para policy nova.

**Critério de segurança que autoriza a troca:** o idioma só é aplicável quando os **argumentos** da chamada não
referenciam a linha. As quatro funções são de zero argumento, então `(SELECT f())` devolve o mesmo valor para todas as
linhas do comando e a semântica é idêntica. O predicado em volta pode continuar variando por linha —
`id_usuario = (SELECT avaliador_atual())` ainda compara coluna a coluna; só a chamada é içada. Por isso **não** foram
tocados:

- os `EXISTS` correlacionados à linha (`rls_avaliadores_evento_staff_atualiza`, `..._staff_insere`,
  `rls_avaliacoes_staff_apaga_pendentes`): dependem da linha, e içá-los mudaria o significado da policy;
- `upper((papel)::text) = 'AVALIADOR'`: `upper` recebe coluna.

Aplicar o idioma a uma chamada que recebe coluna seria um **defeito de segurança**, não uma otimização: a policy
passaria a decidir por uma linha só e valer para todas.

**Escopo de uma vez, agrupado por tabela**, e não policy por policy, por um motivo concreto: policies permissivas da
mesma tabela são OR'd numa única expressão de filtro. Com uma irmã sem envolver, a chamada dela continua por linha e
só o curto-circuito do `OR` evita o custo — o que é ordem de avaliação, não garantia. Foi observado no plano: ao
envolver apenas `rls_projetos_leitura`, sobrou `OR is_admin()` vindo de `rls_projetos_admin`.

## O que o idioma resolve, e o que não resolve

Esta seção existe porque confundir as duas coisas custa caro.

O estouro da Classificação, que abriu esta investigação, tinha **duas causas empilhadas**:

1. **A raiz:** `view_ranking_top3` chama `fn_chave_desempate` **uma vez por projeto**, na lista de seleção da view.
   O planejador não iça nem hasheia nada por cima de invocação de função: cada uma das 601 chamadas planeja e executa
   a própria consulta. Quem resolveu isso foi o índice da migration `20261122210113`
   ([ADR 0018](0018-indice-em-respostas-avaliacao.md)), que reduziu as linhas varridas por chamada.
2. **O amplificador:** dentro de cada chamada, a policy era reavaliada por linha varrida. É só isto que o idioma
   deste ADR resolve.

Ou seja: **o idioma não protege contra função chamada por linha numa lista de seleção.** Uma função nova escrita
nesse padrão nasce com o mesmo defeito da `fn_chave_desempate` original, e o idioma não a salva. Dizer que ele
"elimina o custo por linha" sem essa qualificação é o caminho mais curto para alguém concluir, no próximo incidente,
que o idioma falhou.

**Critério de diagnóstico, para a próxima suspeita de lentidão:**

| Padrão | O otimizador resolve? | Evidência no plano |
|---|---|---|
| Subconsulta correlacionada (`EXISTS (… WHERE filho.id = pai.id)`) | **Sim** — vira `SubPlan` hasheado | `Seq Scan on … (actual rows=N loops=1)` |
| Chamada de função por linha na lista de seleção | **Não** | uma execução por linha, custo ∝ linhas × tamanho da tabela lida dentro |
| Função `STABLE` em `USING`/`WITH CHECK` de policy | **Não por si**, mas o idioma resolve | `Filter: f()` → `Filter: (InitPlan 1).col1` |

Foi medido: com 3.005 linhas em `historico_impedimentos`, o `EXISTS` correlacionado de
`fn_relatorio_instituicoes_completo` sai como `loops=1` e o índice rende ~9%, não o estouro que se esperava por
analogia com o ranking. Procure a função por linha antes da subconsulta.

## Consequências

Medido em 601 projetos / 3.003 avaliações / 26.769 respostas, nos mesmos dados, antes e depois da migration:

| Leitura | Antes | Depois | |
|---|---|---|---|
| Classificação completa, como Admin | 371 ms | **111 ms** | 3,3× |
| `projetos` inteira, como avaliador | 28,60 ms | **0,36 ms** | 79× |

Em lote de escrita, onde o ganho vai para o `WITH CHECK`: `INSERT` de 2.000 linhas em `respostas_avaliacao` como
Admin, 30,96 ms → 11,71 ms (−62%). Escrita de uma linha não ganha nada — o ganho é proporcional ao tamanho do
comando, e por isso casa com a regra 8 do `AGENTS.md`, que exige batch upsert.

- Nenhum papel, `GRANT`, `REVOKE`, comando (`FOR …`) ou conjunto de linhas visível muda. A suíte pgTAP inteira foi
  rodada contra o idioma **antes** de a migration existir, cada arquivo numa transação revertida: 621 ok, 0 not ok,
  inclusive `19_seguranca_matriz_test.sql`.
- **Regra que fica:** policy nova chama função de zero argumento sempre como `(SELECT f())`.
  `supabase/tests/41_policies_com_initplan_test.sql` recusa qualquer chamada direta, nomeando a policy.
- **Dependência escondida que o teste guarda:** o idioma só é equivalente porque as quatro funções são `STABLE`. Se
  uma virar `VOLATILE`, `(SELECT f())` passa a ser avaliada uma vez por comando onde antes era por linha — isso
  **muda comportamento**, sem erro de execução e sem sinal no plano. O teste 41 cobra a volatilidade das quatro por
  isso, e não por zelo.
- A migration é feita de 46 `ALTER POLICY` nus, de propósito: `ALTER POLICY` não aceita `IF EXISTS` nesta forma e não
  há bloco que engula ausência, então renomear ou remover uma policy quebra a migration com `42704` em vez de pular
  em silêncio.

## Alternativas consideradas

- **Não fazer nada.** Era a resposta se o piloto fosse o único dado: em `rls_perguntas_questionario_leitura`, a tabela
  tem 19 linhas e a economia é de 0,63 ms por carregamento de tela. Depois do índice do ADR 0018 nada estava perto do
  teto de 8 s, então isto é otimização de segunda ordem, não conserto. O que mudou a decisão foi medir onde há linhas:
  3,3× na tela de premiação e 79× na leitura de `projetos` pelo avaliador.
- **Tornar as funções `IMMUTABLE`** para o planejador dobrá-las em constante. Recusado sem hesitação: elas leem
  tabelas e dependem da sessão. `IMMUTABLE` seria mentira para o planejador e produziria resultado errado em cache de
  plano.
- **Marcar as funções como `LEAKPROOF`** para o planejador empurrar os quals do usuário por baixo do filtro da policy.
  Não ataca este custo (a chamada continuaria por linha) e afrouxa uma garantia de vazamento de informação por
  mensagem de erro. Recusado.
- **Um passe parcial, só nas tabelas grandes.** Deixa dois idiomas convivendo no schema e mantém a dependência do
  curto-circuito entre policies irmãs da mesma tabela. Mais risco, menos ganho.
