# Sorteio e Atribuição de Projetos

Como os projetos chegam aos avaliadores: sorteio automático (`sortear_proximo_projeto`) ou atribuição forçada pela
coordenação (`AtribuicaoForcada`).

Código: `src/features/atribuicoes/`, `src/features/avaliacao/components/TelaAvaliador.tsx`,
migration `20261025_sorteio_impedir_mesmo_avaliador_soft_delete.sql` (versão vigente do sorteio).

## Ordem e filtros do sorteio

Ao ser chamada, a função:

1. Remove travas expiradas de todos e a trava anterior do próprio avaliador.
2. Busca a instituição do avaliador (`avaliadores_evento.id_instituicao`), o timeout de trava e a cota do evento.
3. Seleciona **um** projeto que satisfaça **todos** os filtros:

| # | Filtro |
|---|---|
| a | Pertence ao evento (`id_evento`). Projeto sem evento nunca é sorteado |
| b | Check-in realizado (`is_check_in_realizado = true`) |
| c | **Não** está fora da competição (`is_fora_da_competicao = false`) |
| d | Não tem nenhuma trava ativa (o sorteio não forma bancas; banca só por atribuição forçada) |
| e | Não é da mesma instituição do avaliador ([conflito de interesse](#conflito-de-interesse-institucional)) |
| f | Modalidade não bloqueada para o avaliador ([bloqueio por modalidade](#bloqueio-por-modalidade)) |
| g | Nunca foi avaliado por este avaliador, **nem mesmo com avaliação cancelada** ([ADR 0005](../decisoes/0005-sorteio-nao-repete-avaliador.md)) |
| h | Sem impedimento registrado por este avaliador em `historico_impedimentos` (ausência/conflito) |
| i | Abaixo da cota: avaliações não canceladas + travas < `COALESCE(cota_avaliacoes_customizada, cota_avaliacoes_padrao)` |

4. Ordena por:
   1. `forcar_topo_fila` (ativos primeiro);
   2. afinidade temática (projetos das áreas do avaliador primeiro, se ele tiver áreas cadastradas);
   3. menos avaliações não canceladas;
   4. menos ausências (`contagem_ausencia`);
   5. estande.
5. Cria a trava (`locks_ativos`) com `expira_em = now() + minutos_timeout_lock` e retorna o `id_projeto`
   (ou `NULL` se não houver projeto elegível).

`sortear_projeto` é um alias com a mesma lógica; qualquer mudança deve ser aplicada nas duas.

## Conflito de interesse institucional

Um avaliador **nunca** avalia projeto da própria instituição.

- Sorteio: `p.id_instituicao IS DISTINCT FROM <instituição do avaliador>`.
- Atribuição forçada: validado nos modos Banca e Fila, com o motivo `Conflito: Mesma Instituição`.
- `fn_enviar_avaliacao` repete a checagem no envio.
- O vínculo fica em `avaliadores_evento.id_instituicao`, definido no Gestor de Avaliadores (manual ou planilha).

## Bloqueio por modalidade

Tabela `avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade)`.

- Definido no Gestor de Avaliadores e no balcão do Staff: checkboxes no cadastro/edição ou chip de alternância na
  coluna Modalidades da tabela (`Shield` liberada / `ShieldOff` "Bloq: Nome").
- **Ao bloquear**, o sistema remove na hora as travas (`locks_ativos`) e os itens pendentes da fila
  (`fila_atribuicoes_direcionadas`) do avaliador que apontem para projetos dessa modalidade.
- O sorteio descarta projetos da modalidade; a atribuição forçada recusa com `Bloqueio: Modalidade do Projeto`.
- Defesa em profundidade na `TelaAvaliador`: travas herdadas e itens de fila de modalidade bloqueada são descartados
  e um novo sorteio é feito.
- Ao salvar, o evento ativo é resolvido com fallbacks (estado → `localStorage` → consulta), para o bloqueio não ser
  perdido se o estado ainda não carregou.

## Afinidade temática

Tabela `avaliador_areas (id_usuario, id_evento, id_area)`. Um avaliador pode ter várias áreas.

- Projetos das áreas do avaliador têm prioridade no sorteio.
- Esgotados esses, o avaliador recebe projetos de outras áreas (não bloqueadas), para o fluxo não parar.

## Cota estrita

- Nenhum projeto recebe avaliações além da cota (`cota_avaliacoes_customizada` ou `cota_avaliacoes_padrao`, padrão 3).
- Avaliações canceladas **não** contam. O projeto volta à fila para **outros** avaliadores.
- Quando nenhum projeto é elegível e todos atingiram a cota, a `TelaAvaliador` mostra:
  `"Avaliações da Feira Concluídas! Todos os projetos atingiram a cota necessária."`

## Forçar topo da fila

Botão `Topo da Fila` / `Normal` ao lado do Check-in em cada linha do Gestor de Projetos (âmbar quando ativo). Liga
`projetos.forcar_topo_fila`, primeiro critério de ordenação do sorteio.

## Atribuição forçada (`AtribuicaoForcada`)

Card **Atribuir Projeto** no Bloco 1 do painel Admin.

- **Modo Banca**: vários avaliadores no mesmo projeto ao mesmo tempo.
- **Modo Fila**: enfileira projetos para um avaliador em `fila_atribuicoes_direcionadas` (por `ordem`).
- Lista só projetos do evento ativo.
- Recusa e sinaliza: mesma instituição, modalidade bloqueada e `"Já avaliou este projeto"`. Esta última vale para
  qualquer par `(projeto, avaliador)` já registrado, inclusive cancelado.
- Para a cota, avaliações canceladas não contam.
- Na `TelaAvaliador`, itens da fila de projetos já avaliados pelo usuário viram `ja_avaliado` e são descartados antes
  do sorteio.

## Travas (locks)

- Um avaliador tem no máximo uma trava (`locks_ativos.id_usuario` é único).
- A trava expira após `eventos.minutos_timeout_lock` (padrão 30 min). Depois disso, o projeto pode ser sorteado de
  novo.
- Na inicialização, se a trava do avaliador aponta para projeto que ele já avaliou, a trava é removida e é feito
  novo sorteio.
- O Admin libera travas no card **Projetos Bloqueados** (`admin_desbloquear_projeto` / `admin_desbloquear_todos`).

Testes: `src/features/atribuicoes/__tests__/`, `src/__tests__/integracao/BloqueioModalidadesSorteioEAtribuicao.test.tsx`,
`SorteioImpedirMesmoAvaliadorSoftDelete.test.tsx`, `CotaEstritaEAutoCadastroDePara.test.tsx`,
`src/features/avaliadores/__tests__/GestorAvaliadoresBloqueios.test.tsx`.
