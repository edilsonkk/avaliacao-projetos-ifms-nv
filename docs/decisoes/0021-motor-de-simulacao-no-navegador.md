# 0021. O motor da simulação roda no navegador, com a sessão do Admin

- **Status**: Aceito
- **Data**: 2026-11-24

## Contexto

A feira já podia ser simulada por linha de comando, com `scripts/semear-simulacao.mjs` (cria um evento de
simulação e o popula) e `scripts/simular-feira.mjs` (roda avaliadores, staff e telões concorrentes). Os dois
exigem Node, Docker, a chave `service_role` e credenciais em `.env.simulacao.local`, e **só rodam contra o
Supabase local**: abortam se `VITE_SUPABASE_URL` não for `127.0.0.1`.

Faltavam dois usos: ensaiar a feira pela própria interface, sem terminal, e medir se a aplicação aguenta a carga
no ambiente real, antes do dia do evento. Um botão no painel do Admin resolveria, mas a pergunta é por qual
caminho ele grava — e o AGENTS.md é taxativo: nota do avaliador só por `fn_enviar_avaliacao`, nada de chave de
serviço no navegador (regra 9), nada que confie só no front-end (regra 3).

A observação que destrava o desenho é que `sortear_proximo_projeto` (`supabase/schema.sql` (linha 5513)) e
`fn_enviar_avaliacao` (`schema.sql` (linha 3306)) já têm, as duas, a mesma isenção:

```sql
IF NOT public.is_admin() AND public.avaliador_atual() IS DISTINCT FROM p_id_usuario THEN
  RAISE EXCEPTION 'Acesso negado: ...' USING ERRCODE = '42501';
```

Ela existe para o lançamento de nota em papel pela coordenação. O mesmo portão serve à simulação: o Admin já
autenticado pode acionar o fluxo **real** em nome de qualquer avaliador do evento, com uma única sessão.
`fn_check_in_projeto` (`schema.sql` (linha 3266)) chama `exigir_staff_ou_admin()`, então o check-in também cabe.

## Decisão

O motor da simulação roda no navegador, em `src/lib/simulacao/motor.ts`, e fala com o banco por uma interface
(`PonteSimulacao`) implementada em `src/features/simulacao/api.ts` com a sessão do Admin. Consequências diretas: nenhuma
chave de serviço no cliente e nenhum segredo. O caminho de escrita reaproveita as RPCs que já
existiam; a única função nova é a da limpeza, pelo motivo da decisão 3.

Cinco escolhas acompanham essa:

1. **O caminho é o real**: `sortear_proximo_projeto` cria a trava e `fn_enviar_avaliacao` calcula a nota no
   servidor. Por isso `admin_lancar_avaliacao` foi **recusada**: ela marca `ajuste_tipo = 'lancada_pelo_admin'`
   e não cria trava, então falsearia a auditoria e não exercitaria trava, timeout nem cota.
2. **A simulação cria um evento novo e o torna ativo**, porque `fn_telao_resumo` sempre lê o evento ativo do
   banco — é a única forma de a feira fictícia aparecer no telão. O evento nasce inativo e só é ativado no fim
   da semeadura; ao encerrar, o anterior volta. O nome do evento anterior fica na `descricao` da simulação, não
   o UUID (regra 6).
3. **A limpeza é uma função nova no banco, `admin_apagar_simulacao`** — a única migration desta mudança.
   Duas razões a empurraram para lá, nenhuma delas prevista no desenho inicial:

   - **`admin_reset_global` não serve.** O passo 13 dela apaga `usuarios` com papel `AVALIADOR` ou `STAFF` em
     **toda a base**, sem filtrar por evento, preservando apenas quem já tem avaliação — em produção levaria
     avaliadores reais de outros eventos ainda sem nota.
   - **Apagar pelo cliente suja a auditoria da feira real.** Medido num banco local: a cascata do `DELETE` em
     `avaliacoes` e em `questionarios` dispara os gatilhos de `respostas_avaliacao` e
     `perguntas_questionario`, que gravam com `origem = 'direto'` e `id_evento` nulo. A regra C10 de
     `fn_auditar_notas` ("nota alterada fora do fluxo") inclui `id_evento IS NULL`, então o achado **grave**
     passa a aparecer em **todos** os eventos. Apagar uma simulação de 31 avaliações deixou 141 achados falsos
     — e permanentes, porque `log_auditoria` é append-only. `auditoria_marcar_origem` resolveria, mas vale só
     dentro da transação, e pelo PostgREST cada chamada é uma transação própria: marcar numa requisição e
     apagar na seguinte não tem efeito.

   A função marca a origem, põe as guardas no servidor (só Admin, só evento com o prefixo de simulação, nunca
   o evento ativo) e segue a ordem que as chaves estrangeiras impõem — avaliações, evento, pessoas —, porque
   `avaliacoes.id_projeto` e `id_usuario` são `ON DELETE RESTRICT`. Teste em
   `supabase/tests/45_apagar_simulacao_test.sql`.
4. **Dois modos de sessão.** O padrão usa a sessão do Admin e roda nos dois ambientes. O modo fiel abre uma
   sessão anônima por avaliador e passa pelo pareamento do aparelho, exercitando a RLS por `avaliador_atual()` —
   mas só no banco local, porque cada `signInAnonymously` cria uma linha permanente em `auth.users` que
   **nenhuma função do projeto apaga** (só a chave de serviço, que por desenho não existe no navegador), e
   porque o limite de sessões anônimas é por IP, de onde saem todos os "aparelhos" da simulação.
5. **Exceção consciente à regra "um só cliente Supabase"** (`docs/arquitetura/frontend.md`, regra 5): o modo
   fiel cria um cliente por avaliador, com `persistSession: false` para não encostar no `localStorage` nem
   derrubar a sessão do Admin. A exceção vale só para `src/features/simulacao/apiSessaoPorAvaliador.ts`.

Em produção a confirmação é em duas etapas, com o nome do evento ativo digitado à mão, e os limites de volume
são menores. O detalhe de operação está em [simulação de evento](../operacao/simulacao-de-evento.md).

## Consequências

Aceitas, e escritas na própria tela para quem usa:

- **A rodada morre com a aba.** Fechar ou recarregar interrompe a simulação. O que fica são travas em
  `locks_ativos`, que expiram por `minutos_timeout_lock`, e o evento de simulação ativo — por isso o modal
  detecta simulação esquecida e oferece encerrar, restaurar ou apagar.
- **Aba escondida estrangula o ritmo**, porque o navegador segura os temporizadores. Com ritmo zero o laço é
  dirigido por `await` de rede e não sofre disso.
- **O teto de concorrência é baixo.** Entre 8 e 16 requisições em voo o ganho para de crescer; acima disso se
  mede a fila, não a aplicação. Uma aba de navegador não satura um Supabase, e as chamadas saem de um só JWT,
  um só IP e uma só conexão HTTP/2 — então esta ferramenta **não substitui** `scripts/simular-feira.mjs`, que
  roda vários processos com sessões distintas e continua sendo o jeito de medir vazão.
- **A trilha cresce e não é limpa.** `auditar_avaliacoes` (`schema.sql` (linha 6798)) dispara por linha: uma rodada de
  2.000 avaliações mais a limpeza deixa cerca de 4.000 linhas permanentes em `log_auditoria`, que é append-only
  por desenho ([ADR 0014](0014-trilha-de-auditoria-append-only.md)). Em produção esse é o custo mais relevante,
  mais que o pico de requisições.

## Alternativas consideradas

- **Uma RPC `admin_simular_*` no banco**, que geraria tudo de uma vez. Rápida e atômica, mas não exercitaria
  concorrência nem o supabase-js de verdade — justamente a lacuna que a simulação existe para cobrir — e
  acrescentaria superfície de função privilegiada à API por uma necessidade de teste.
- **Manter só a linha de comando.** Resolve o teste de carga local, mas não atende quem opera a feira pela
  interface nem permite medir no ambiente real, que era o pedido.
- **Web Worker** para a rodada sobreviver à aba escondida. Resolveria o estrangulamento dos temporizadores, mas
  exige o cliente Supabase dentro do worker e mais caminho de erro; ficou de fora, com "retomar" cobrindo o
  caso de a aba fechar.
