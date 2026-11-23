# 0018. A Classificação continua sob RLS: o conserto é o índice da FK, não `SECURITY DEFINER`

- **Status**: Aceito
- **Data**: 2026-11-22

## Contexto

A tela de Classificação (`RankingPremiacao`) lê `view_ranking_top3` **direto**, como `authenticated`. A view é
`security_invoker = true`, então a RLS de `projetos`, `avaliacoes` e `respostas_avaliacao` é avaliada na leitura — é
isso que garante que um avaliador não veja a nota de ninguém. A view chama `fn_chave_desempate` **uma vez por
projeto** para montar a chave de desempate.

Um simulador de carga local mediu a leitura completa estourando o `statement_timeout` de 8 s do papel
`authenticated`: **110 s** num evento de 601 projetos. A tela simplesmente não carregava.

A primeira hipótese foi a postura de autorização: `fn_chave_desempate` é a única função do caminho sem
`SECURITY DEFINER` (`LANGUAGE sql STABLE`), enquanto `fn_memorial_projeto`, `fn_auditar_notas`,
`fn_projetos_situacao` e `fn_telao_resumo` todas têm. Marcá-la como DEFINER faria a RLS sair do caminho e resolveria
o custo.

O plano de execução mostrou outra coisa:

```
->  Seq Scan on respostas_avaliacao r  (actual rows=4113 loops=1)
      Filter: is_admin()
```

`respostas_avaliacao` só tinha a PK (`id_resposta`): **não havia índice em `id_avaliacao`**, apesar da FK
`respostas_avaliacao_id_avaliacao_fkey`. O join de `fn_chave_desempate` varria a tabela inteira a cada chamada, e a
mesma varredura aparece como `postgres` (0,5 ms) e como `authenticated` (26 ms) — a RLS não causava o Seq Scan. O que
ela fazia era rodar `is_admin()` **uma vez por linha varrida**, porque `is_admin()` é `STABLE` e não `IMMUTABLE`,
então não é dobrada em constante no plano. O custo total é `projetos × linhas de respostas_avaliacao`: quadrático no
tamanho do evento.

Também ficou claro que o problema é só do caminho direto. Dentro de uma função `SECURITY DEFINER` pertencente a
`postgres`, o `current_user` é o dono das tabelas e a RLS é ignorada, inclusive pela view `security_invoker`. No
mesmo evento de 120 projetos: `fn_auditar_notas` 118 ms, `fn_memorial_projeto` 158 ms, leitura direta da view
**2 910 ms**.

## Decisão

Criar o índice que faltava e **não** mexer na postura de autorização:

```sql
CREATE INDEX IF NOT EXISTS idx_respostas_avaliacao_avaliacao
  ON public.respostas_avaliacao (id_avaliacao);
```

`fn_chave_desempate` continua `SECURITY INVOKER` e `view_ranking_top3` continua `security_invoker = true`. Nenhum
`GRANT`, `REVOKE` ou policy muda: um índice altera o caminho de acesso, nunca a visibilidade de linha.

Medições da leitura completa do ranking, como `authenticated`, **nos mesmos dados** (o "antes" é o índice derrubado
numa transação revertida, para o par ser comparável linha a linha):

| Evento | Projetos | Avaliações | Linhas em `respostas_avaliacao` | Antes | Depois |
|---|---|---|---|---|---|
| Tamanho da feira real | 176 | 777 | 5 859 | **5 632 ms** | **102 ms** |
| Carga alta | 601 | 2 573 | 25 485 | **110 533 ms** | **431 ms** |

O número que decidiu: **na feira real o problema já existe hoje** — 5,6 s contra um teto de 8 s, sem margem para o
evento encher.

## Consequências

- A Classificação volta a carregar, e o custo deixa de ser quadrático: `is_admin()` passa a ser avaliado por algumas
  linhas por chamada em vez de pela tabela inteira.
- A garantia de privacidade da leitura fica **intacta**: quem lê a classificação continua limitado pela própria RLS.
  Um avaliador continua obtendo `{}` de `fn_chave_desempate`, porque `rls_respostas_avaliacao_admin` só libera
  `is_admin()`.
- Ganho de tabela para todo mundo que busca respostas por avaliação: `fn_memorial_projeto`, `fn_auditar_notas`,
  `admin_lancar_avaliacao`, `excluir_avaliacao` e o `ON DELETE CASCADE` da própria FK, que também varria a tabela
  inteira a cada avaliação apagada.
- A postura passa a ser cobrada por teste: `supabase/tests/39_ranking_postura_e_desempenho_test.sql` afirma que a
  função não é DEFINER, que a view segue `security_invoker`, que `anon` não a executa, que um avaliador obtém `{}`,
  que o índice existe, que a busca por avaliação não varre a tabela e que a leitura completa de 200 projetos cabe no
  `statement_timeout` do papel (lido do catálogo, não decorado).
- **Regra que fica**: função nova no caminho de leitura do front não deve ganhar `SECURITY DEFINER` para resolver
  lentidão. Olhe o plano primeiro — `is_admin()` em policy avaliada por linha é sintoma de índice faltando, não de
  postura errada.

## Alternativas consideradas

- **`fn_chave_desempate` como `SECURITY DEFINER`.** Recusada. Resolveria o custo, mas as irmãs DEFINER todas abrem
  com `IF NOT public.is_admin() THEN RAISE EXCEPTION … '42501'`, e essa guarda quebraria a view para Staff e
  avaliador. Sem a guarda, como a função tem `GRANT ALL … TO authenticated` e o PostgREST expõe toda função com
  EXECUTE, qualquer sessão autenticada — inclusive o celular pareado de um avaliador — passaria a ler as médias por
  critério de **qualquer** projeto por UUID, que é exatamente o dado que decide a premiação. Mudança de postura sem
  necessidade, já que o índice resolve o custo.
- **Reescrever a CTE `com_chave` da view** com `LATERAL`/agregação única, para a RLS ser avaliada uma vez por consulta
  em vez de uma por projeto. Resolveria sem mudar postura, mas mexe numa view com cinco consumidores (dois deles
  funções DEFINER) e quatro testes pgTAP, e exigiria revalidar `posicao` e `chave_desempate`. Fica como próximo passo
  se o índice não bastar em escalas maiores.
- **Embutir o cálculo numa função DEFINER existente** e o front passar a chamar uma RPC. A mais invasiva: exige
  mudança de front-end em duas versões por expand/contract. Descartada pelo mesmo motivo.
