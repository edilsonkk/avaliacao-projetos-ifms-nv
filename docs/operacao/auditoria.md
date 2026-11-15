# Auditoria e endurecimento

Como auditar este projeto, o que a auditoria de 15/11/2026 encontrou e o que ficou cobrado por guarda.

O princípio: **nenhum achado conta como corrigido sem evidência independente de quem escreveu o código** —
um teste que falhava antes e passa depois, ou um número medido antes e depois. Vale também para achados
produzidos por um agente de IA, inclusive os desta página.

## Ordem das fases

Nesta ordem, porque cada uma cobre o que a anterior não vê:

1. **Linha de base.** Branch e inventário: rotas, quem pode chamar, que dados tocam, qual chave do Supabase.
2. **Varreduras automatizadas.** Não opinam e são reproduzíveis: segredos no histórico, dependências,
   SAST, tipagem, cabeçalhos HTTP.
3. **Supabase.** Scanner nenhum lê política de RLS: a verificação é por SQL e pelo teste com dois usuários.
4. **Revisão assistida.** O LLM entende a regra de negócio, mas só vale com arquivo, linha, cenário e teste
   que falha. Sessão limpa, descoberta separada de correção.
5. **Enxugar.** Código morto, duplicação, ciclos de import e fronteiras arquiteturais.
6. **Performance em rede lenta.** Medida sob throttling, nunca em fibra.
7. **Gates de CI.** O que não trava o merge volta a entrar na semana seguinte.

O comando `/auditar` (em `.claude/commands/auditar.md`) roda as fases 1 a 5 em um subagente de contexto
limpo. Use a cada PR que mexa em permissão, rota ou import pesado.

### Comandos das varreduras

```bash
npx gitleaks detect --source . --log-opts="--all" --redact   # segredos no histórico inteiro
npm audit --omit=dev                                         # dependências vulneráveis
npx osv-scanner@latest scan source -r .
npx knip                                                     # arquivos e dependências mortos
npx madge --circular src/                                    # ciclos de import
npx vite-bundle-visualizer                                   # o que está pesando, por arquivo
```

Segredo encontrado: **rotacione a chave primeiro**, limpar o histórico vem depois. Chave que esteve em um
push público está comprometida mesmo depois da reescrita do histórico.

### As cinco consultas de RLS

Rode no SQL Editor do projeto (local, não em produção) e confira: tabela sem RLS, RLS sem política,
`qual = true`, política de escrita com `with_check` nulo, e `GRANT` para `anon`/`authenticated`.

```sql
select tablename from pg_tables where schemaname = 'public' and rowsecurity = false;

select c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
group by c.relname having count(p.polname) = 0;

select tablename, policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public' order by tablename;

select n.nspname, p.proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema') and p.prosecdef;

select table_name, grantee, string_agg(privilege_type, ', ') as permissoes
from information_schema.role_table_grants
where grantee in ('anon', 'authenticated') and table_schema = 'public'
group by table_name, grantee order by table_name;
```

A chave `anon` ser pública é correto e esperado — a proteção é a RLS atrás dela. O que nunca sai do
servidor é a `service_role`; a guarda `service-role-no-src` cobra isso no código do navegador.

Consulta de catálogo mostra intenção; só dois usuários reais provam efeito. Os testes de permissão ficam em
[`supabase/tests/`](../../supabase/tests) e rodam com `npx supabase@2.122.0 test db`.

## Resultado da auditoria de 15/11/2026

O que já estava certo, e é incomum: RLS em 26 de 26 tabelas, `search_path` fixado em 86 de 86 funções
`SECURITY DEFINER`, 35 de 35 funções `admin_*` conferindo papel antes de agir, nenhum segredo versionado,
e um CI com actions fixadas por hash, `npm ci --ignore-scripts`, CodeQL, Trivy e `npm audit` bloqueante.
A única função de escrita pública, `fn_autocadastro_avaliador`, valida evento ativo, limita a 30 cadastros
por minuto e responde igual para e-mail novo e existente, sem permitir enumeração.

O trabalho que faltava não era de segurança.

### Achado 1 — Alto: a aplicação inteira ia em um único bundle · corrigido

`src/app/App.tsx` importava as seis telas de topo de forma estática, não havia um único `React.lazy` em
`src/`, e o ExcelJS entrava pela linha 1 de `src/lib/excel/excelUtils.ts`. Quem abria o sistema no celular,
em 4G congestionado do ginásio, baixava o painel administrativo completo e a biblioteca de planilhas antes
de ver a tela de login — código que o perfil dele nunca executa. O mesmo para quem chegava pelo QR Code de
autocadastro, sem login nenhum.

O que foi feito:

- As cinco telas de depois do login (`TelaAvaliador`, `TelaStaff`, `TelaAdmin`, `TelaRedefinirSenha`,
  `TelaoAoVivo`) entram por `lazy(() => import(...))`, com um `<Suspense>` em volta da troca de tela.
- `TelaLogin` e `TelaAutocadastroAvaliador` **ficam estáticas de propósito** — ver a seção seguinte.
- O ExcelJS entra por `await import('exceljs')` dentro de `excelUtils.ts`. É um ponto só, e não os treze
  pontos de chamada, porque os parsers de `src/lib/parsers/` importam `excelUtils` de forma estática: mudar
  só os componentes deixaria a biblioteca presa ao pedaço do painel.

Medido com `npm run build`, em KB comprimidos (gzip):

| | Antes | Depois |
|---|---|---|
| JavaScript do carregamento inicial | 553 | 158 |
| Arquivos no carregamento inicial | 1 | 3 |
| Painel do Admin (sob demanda) | — | 121 |
| ExcelJS (sob demanda) | — | 256 |
| Tela do Staff (sob demanda) | — | 18 |
| Telão (sob demanda) | — | 5 |

Queda de 71% no que a pessoa baixa antes da primeira tela. A guarda `bundle-telas-lazy`, `bundle-excel` e
`orcamento-bundle` impedem a volta.

### Achado 2 — Médio: `tsconfig.json` sem `strict` · corrigido em parte

Sem `"strict"`, o portão `tsc --noEmit` validava pouco mais que sintaxe e aridade. Ligado na auditoria:
`strict`, `noImplicitOverride` e `noFallthroughCasesInSwitch` passaram com **zero erros** — o código já
estava correto, só não era cobrado.

O que sobra, medido um sinalizador por vez, para a catraca de `ts-strict` tratar uma pasta por PR:

| Sinalizador | Erros | Em teste |
|---|---|---|
| `noUncheckedIndexedAccess` | 192 | 113 |
| `noUnusedLocals` | 66 | 31 |
| `exactOptionalPropertyTypes` | 18 | 0 |
| `noUnusedParameters` | 6 | 4 |

### Achado 3 — Baixo: `rls_eventos_leitura` expõe a linha inteira · corrigido

A política libera `SELECT` em `eventos` para `anon` com `USING (true)`. Para o catálogo público está certo — a
tela de login e o autocadastro pelo QR Code leem nome, edição, datas e identidade visual antes de existir
sessão. A conferência coluna a coluna das 26 colunas encontrou dois grupos que não deveriam ser públicos:

- **Parâmetros do código de acesso**: `tamanho_codigo`, `max_tentativas_codigo`,
  `minutos_validade_codigo_acesso`, `minutos_validade_pareamento`. Nenhum dá acesso a ninguém, mas juntos
  dizem a quem tentar força bruta o tamanho do alvo, quantas tentativas cabem e por quanto tempo.
- **`limite_corte`**: o corte da premiação, visível antes do resultado sair.

A correção foi por **permissão de coluna**, não por view: `REVOKE SELECT ... FROM anon` seguido de
`GRANT SELECT (<colunas públicas>)`, na migration `20261115010000_eventos_colunas_publicas.sql`. O PostgREST
respeita a permissão por coluna, a política e a RLS continuam as mesmas, e nenhuma tela mudou — as consultas
de `anon` nesta tabela projetam só colunas da lista pública. Uma view com `security_invoker = true` daria o
mesmo resultado ao custo de trocar a tabela pela view em 26 pontos de leitura.

A lista das colunas está em [segurança](../arquitetura/seguranca.md#colunas-públicas-de-eventos) e o teste em
`supabase/tests/34_eventos_colunas_publicas_test.sql`. Coluna nova em `eventos` não fica pública por padrão.

Fora do alcance desta correção: `anon` mantém o privilégio `MAINTAIN` na tabela (`VACUUM`/`ANALYZE`), herdado
dos privilégios padrão do Supabase. Não lê dado nenhum, então ficou registrado em vez de alterado.

### Sobre o ESLint ausente

O comentário em `scripts/guardas.mjs` está correto: o `typescript-eslint` ainda não suporta TypeScript 7.
Mas `oxlint` e `biome` não dependem dele e rodariam hoje, trazendo regras de React e de segurança sem
esperar a migração. Vale como complemento ao `guardas.mjs`, não como substituto.

## Por que o login não entra no lazy

Um pedaço separado custa um round-trip a mais: o navegador baixa o bundle inicial, executa o React, descobre
que precisa daquele pedaço e só então o pede. Com 500 ms de latência, isso é meio segundo de tela vazia. A
regra é separar o que a pessoa **não precisa agora**:

| Tela | Quando aparece | Decisão |
|---|---|---|
| `TelaLogin` | rota `/` e `/login`, primeira tela da maioria | estática |
| `TelaAutocadastroAvaliador` | chegada pelo QR Code, sem login | estática |
| `TelaAvaliador`, `TelaStaff`, `TelaAdmin` | só depois de autenticar | lazy |
| `TelaoAoVivo`, `TelaRedefinirSenha` | acesso pontual | lazy |

As quatro últimas são ganho puro: o pedaço baixa enquanto a pessoa digita as credenciais. E é nelas que mora
o peso — os gestores de planilha e o ExcelJS vivem no Admin e no Staff.

Refinamento seguinte, ainda não feito: disparar o `import()` da tela do perfil assim que o login for
submetido, antes da resposta do Supabase chegar.

## Guardas e pendências

`npm run lint` roda `scripts/guardas-auditoria.mjs`. Bloqueantes:

| Regra | O que cobra |
|---|---|
| `bundle-telas-lazy` | as cinco telas pós-login por `lazy()`, com `<Suspense>`, e nenhuma em import estático |
| `bundle-excel` | nenhum import estático de `exceljs` em código de produção |
| `service-role-no-src` | nenhuma chave `service_role` em código que vai para o navegador |
| `orcamento-bundle` | JS inicial dentro do teto de catraca (165 KB comprimidos), quando há `dist/` |

Pendências, contadas sem travar, para virar bloqueante no dia em que zerarem:

- **`telas-lazy-efetivas`** (2 itens): `TelaAvaliador` e `TelaRedefinirSenha` entram por `lazy()` mas
  continuam no pedaço inicial. O `App.tsx` importa `@/features/avaliacao` e `@/features/auth` de forma
  estática (para `TelaAutocadastroAvaliador`, `TelaLogin` e `CAMINHO_REDEFINIR_SENHA`) e o `index.ts` dessas
  features reexporta a tela — o empacotador avisa `INEFFECTIVE_DYNAMIC_IMPORT` e não tem como mover nada.
  Tirar as duas telas do `index.ts` resolve e economiza cerca de 11 KB comprimidos no carregamento inicial,
  ao custo de imports profundos entre features nos testes de integração, que a
  [regra 2 de dependência](../arquitetura/frontend.md#regras-de-dependência) proíbe. Fica como decisão
  aberta, não como correção silenciosa.
- **`ts-strict`** (4 itens): os sinalizadores da tabela do Achado 2, com a contagem de erros de cada um.

A meta de performance vive em `lighthouse-budget.json` (150 KB de script, 400 KB no total, medidos sob
Slow 4G). O teto da guarda é 165 KB porque a medição atual é 158 KB: ele impede a regressão enquanto a meta
não é alcançada. Gate que fica vermelho todo dia é gate que a equipe aprende a ignorar.

## O que ainda não está coberto

Em ordem de valor:

1. **Lighthouse no CI.** `lighthouse-budget.json` existe, mas nenhum job o cobra contra o preview. A guarda
   `orcamento-bundle` mede o tamanho do pedaço inicial, não LCP nem cadeia de requisições.
2. **Varredura de segredos no histórico.** O passo de `gitleaks` entrou no
   [pipeline de segurança](ci-cd-e-deploy.md), mas o *secret scanning* com *push protection* precisa ser
   ligado nas configurações do repositório — é o único controle que atua **antes** do vazamento, quando
   ainda dá para evitar a rotação.
3. **Código morto e fronteiras de import.** `knip` e `dependency-cruiser` ainda não estão no projeto. Uma
   regra de fronteira `publico-nao-importa-admin` é o que impediria a divisão do bundle de se desfazer
   sozinha na próxima feature.
4. **Teste de RLS com dois usuários** para cada tabela com dado de pessoa, em `supabase/tests/`. O schema
   está correto; falta a regressão que impede ele de deixar de estar.
