# Troubleshooting

Problemas já enfrentados, com causa e solução. Ao resolver um problema novo e não óbvio, adicione uma entrada aqui
no mesmo formato (sintoma, causa, solução, teste).

---

## `DELETE requires a WHERE clause` (safeupdate)

**Sintoma**: Reset Global ou "Desbloquear Todos" abortavam com erro de `DELETE` sem `WHERE`.
**Causa**: o banco gerenciado rejeita `DELETE` sem filtro.
**Solução**: sempre usar filtro explícito.
```sql
DELETE FROM public.locks_ativos WHERE id_lock IS NOT NULL;
```
```ts
await supabase.from('locks_ativos').delete().neq('id_lock', '00000000-0000-0000-0000-000000000000');
```
O CI bloqueia migrations com `DELETE` sem `WHERE`.
**Teste**: `src/__tests__/integracao/RestricaoExclusaoZumbis.test.tsx`.

---

## Reset global falha com `column "id_evento" does not exist`

**Sintoma**: `"Falha no Reset: column 'id_evento' does not exist"`.
**Causa**: bancos com esquema legado tinham `projetos`/`questionarios` sem `id_evento` (e até a tabela no singular
`projeto`).
**Solução**: `admin_reset_global` consulta `information_schema.columns` antes de usar a coluna e usa SQL dinâmico
(migration `20261022000000_admin_reset_global_evento.sql`).
**Teste**: `src/features/admin/__tests__/ResetGlobal.test.tsx`.

---

## Schema cache desatualizado no PostgREST

**Sintoma**: `Could not find the 'data_evento' column of 'eventos' in the schema cache` (código `PGRST204`).
**Causa**: o PostgREST mantém o esquema em cache. Depois de um DDL, rejeita colunas novas até recarregar.
**Solução**:
1. No banco: `NOTIFY pgrst, 'reload schema';` depois de migrations que mudam colunas.
2. No cliente: segunda tentativa sem as colunas novas.
```ts
let res = await supabase.from('eventos').insert(payloadCompleto).select('id_evento').single();
if (res.error && (res.error.message?.includes('schema cache') || res.error.code === 'PGRST204')) {
  const { data_evento, data_inicio, data_fim, edicao, descricao, ...payloadBase } = payloadCompleto;
  res = await supabase.from('eventos').insert(payloadBase).select('id_evento').single();
}
```
**Cuidado**: o fallback pode esconder bugs. Ver o próximo item.
**Teste**: `src/features/admin/__tests__/GestaoNovoEvento.test.tsx`.

---

## Erro PGRST201 "more than one relationship was found"

**Sintoma**: uma tela para de carregar e o PostgREST responde `PGRST201 Could not embed because more than one
relationship was found for 'locks_ativos' and 'usuarios'`.
**Causa**: a tabela ganhou uma segunda FK para a mesma tabela (ex.: `locks_ativos.atribuido_por → usuarios`, além de
`id_usuario`), e o embed `usuarios(...)` ficou ambíguo. Aconteceu na 0.6.4 com a tela Projetos Bloqueados.
**Solução**: migration `20261029235000_remover_fk_ambiguas.sql` remove as FKs das colunas de auditoria. Regra 9 de
[migrations](../banco-de-dados/migrations.md) e teste `supabase/tests/09_embeds_sem_ambiguidade_test.sql`.

---

## Erro "no unique or exclusion constraint matching the ON CONFLICT" ao importar projetos

**Sintoma**: "Importar (.xlsx/.csv)" em Projetos falhava com `there is no unique or exclusion constraint matching the
ON CONFLICT specification`.
**Causa**: o upsert usava `onConflict: 'codigo_projeto'`, mas a tabela não tinha constraint única nessa coluna.
**Solução**: migration `20261029200000_chave_natural_projetos.sql` cria `UNIQUE (id_evento, codigo_projeto)` e o
`GestorProjetos` usa `onConflict: 'id_evento,codigo_projeto'`. Se a migration acusar códigos repetidos no mesmo
evento, decida qual projeto fica (veja se há avaliações ligadas) e corrija o código do outro antes de publicar.
**Teste**: `supabase/tests/04_chave_natural_projetos_test.sql` e `src/features/projetos/__tests__/GestorProjetos.test.tsx`.

---

## Erro "invalid input syntax for type numeric" ao cadastrar evento

**Sintoma**: "Novo Evento" falhava com `invalid input syntax for type numeric: "AAAA-MM-DDT23:59:59+00:00"`, e o
evento que estava ativo ficava desativado.
**Causa**: o cadastro enviava a data em `limite_corte` (numérica) e desativava os outros eventos antes do insert.
**Solução**: o payload não envia mais `limite_corte`, e os outros eventos só são desativados depois que o novo é
gravado ([criação de evento](../regras-de-negocio/eventos.md#configurações-do-evento)).
**Teste**: `src/features/admin/__tests__/GestaoNovoEvento.test.tsx`.

---

## Data do evento não era salva

**Sintoma**: alterar a data no `ModalConfiguracoesEvento` não tinha efeito.
**Causa**: o payload enviava `data_inicio`/`data_fim` (legadas) e string ISO em `limite_corte` (numérica). O
`PGRST204` acionava o fallback, que removia `data_evento` e salvava só o nome.
**Solução**: payload só com as colunas oficiais
([configurações do evento](../regras-de-negocio/eventos.md#configurações-do-evento)) e migration idempotente
`20261025000000_garantir_data_evento_persistente.sql`.
**Teste**: `src/features/admin/__tests__/ModalConfiguracoesEventoData.test.tsx`.

---

## Contagem duplicada de credenciados

**Sintoma**: ao credenciar alguém, o contador pulava de 1 para 2.
**Causa**: `JOIN` com `avaliadores_evento` sem deduplicação; contava vínculos em vez de pessoas.
**Solução**: `Set<string>` de `id_usuario`, filtro por `papel` e por `id_evento`. Os contadores saíram dos cards do
painel e ficaram dentro dos modais.
**Teste**: `src/features/admin/__tests__/SincroniaContadores.test.tsx`.

---

## Loop infinito de requisições no painel Admin

**Sintoma**: `TelaAdmin` disparava requisições sem parar e travava o navegador.
**Causa**: função de fetch criada a cada render, usada como dependência de `useEffect`.
**Solução**: `useCallback(async () => {...}, [conexao_banco_configurada])` e atualização funcional do estado
(`set_metricas_admin(anterior => ({ ...anterior, ... }))`).
**Teste**: `src/__tests__/integracao/AuditoriaPerformanceViews.test.tsx`.

---

## `duplicate key value violates unique constraint "unica_avaliacao_por_usuario"`

**Sintoma**: ao salvar uma avaliação, erro de chave duplicada.
**Causa**: o sorteio ignorava avaliações `CANCELADA` ao excluir projetos já avaliados pelo usuário. Depois de um soft
delete, o mesmo projeto voltava para o mesmo avaliador e o `INSERT` colidia com `UNIQUE (id_projeto, id_usuario)`.
**Solução**: o sorteio exclui **incondicionalmente** projetos já avaliados pelo usuário. A cota continua ignorando
canceladas, então o projeto vai para outro avaliador. Defesa no front: travas e itens de fila de projetos já avaliados
são descartados. Ver [ADR 0005](../decisoes/0005-sorteio-nao-repete-avaliador.md).
**Teste**: `src/__tests__/integracao/SorteioImpedirMesmoAvaliadorSoftDelete.test.tsx`.

---

## `column projetos.modalidade does not exist`

**Sintoma**: `Erro ao carregar mapa de estandes: column projetos.modalidade does not exist`.
**Causa**: código e 3 views (`view_ranking_top3`, `view_projetos_quarentena`, `view_projetos_pendentes_avaliacao`)
usavam colunas textuais que não existem em `projetos` (`modalidade`, `area_conhecimento`, `nome_instituicao`).
**Solução**: usar os relacionamentos (`modalidades(nome_modalidade)`, `areas_tematicas(nome_area)`,
`instituicoes(nome_exibicao, sigla)`) e `LEFT JOIN` nas views
(`20261025010000_corrigir_views_schema_fk_projetos.sql`). O mapa tem fallback para colunas nativas.
**Teste**: `src/features/projetos/__tests__/MapaEstandesVisualEStatus.test.tsx`.

---

## Exclusão de avaliações mostrando `N/I`

**Sintoma**: o modal de exclusão mostrava `N/I` e "Título não especificado".
**Causa**: a consulta com joins pedia colunas inexistentes; o fallback `select('*')` não trazia projetos e usuários.
**Solução**: projetar só colunas existentes e completar em lote por IDs
([exclusão](../regras-de-negocio/avaliacao-e-quarentena.md#exclusão-de-avaliação-soft-delete)).
**Teste**: `src/features/atribuicoes/__tests__/ModalExclusaoAvaliacaoCustom.test.tsx`.

---

## Projetos importados sem evento (invisíveis no sorteio)

**Sintoma**: projetos importados nunca eram sorteados nem apareciam nos relatórios.
**Causa**: cadastro/importação não gravavam `id_evento`, `id_instituicao`, `id_area`, `id_modalidade` e
`is_fora_da_competicao`. Com `id_evento` nulo, `NULL = p_id_evento` é falso.
**Solução**: gravar todos os campos, criar entidades relacionadas ausentes e atribuir o evento ativo a projetos
legados ao abrir o gestor ([eventos](../regras-de-negocio/eventos.md#escopo-por-evento)).
**Teste**: `src/features/projetos/__tests__/GestorProjetos.test.tsx`.

---

## Importação lenta de avaliadores/staff

**Sintoma**: importar planilhas levava dezenas de segundos e travava a tela.
**Causa**: `for` com `await supabase...upsert` por linha (um round-trip por registro).
**Solução**: parsing em memória e um único batch upsert
([importação](../regras-de-negocio/importacao-de-planilhas.md#regras-gerais)).
**Teste**: `src/__tests__/integracao/RegrasNegocioBloco2.test.tsx`.

---

## Escrita administrativa falha com erro de permissão

**Sintoma**: ao importar ou salvar no painel Admin, erro `42501` / "row-level security".
**Causa**: sessão do Supabase Auth expirada. A requisição sai como `anon` e a RLS bloqueia.
**Solução**: o app detecta o erro (`tratarErroEscritaAdmin`) e volta para o login do Admin. Faça login de novo.
Se persistir, confira se o usuário tem `usuarios.papel = 'ADMIN'` e conta no Supabase Auth.
**Teste**: `src/lib/__tests__/SessaoAdmin.test.ts`.

---

## `select('*')` anônimo falha em `usuarios` ou `avaliacoes`

**Causa**: a `anon` não tem grant em todas as colunas ([segurança](../arquitetura/seguranca.md#regras-por-tabela)).
**Solução**: listar explicitamente as colunas permitidas.

---

## `Port 3000 is already in use` ao rodar `npm run dev`

**Causa**: já existe outro `npm run dev` rodando, às vezes esquecido em outra aba do terminal.
**Solução**: feche o terminal antigo (Ctrl+C) ou encerre o processo:
```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN     # mostra o PID
kill <PID>
```
O script usa `--strictPort` de propósito: abrir em outra porta escondia servidores antigos usando outro `.env`
(por exemplo, ainda apontando para produção).
