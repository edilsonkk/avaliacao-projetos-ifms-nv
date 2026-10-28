# Avaliação, Quarentena e Exclusão de Avaliações

Código: `src/features/avaliacao/components/TelaAvaliador.tsx`, `src/features/atribuicoes/components/`
(`ModalExclusaoAvaliacao`, `ProjetosQuarentena`, `ProjetosBloqueados`).

## Fluxo do avaliador

1. Celular vinculado no credenciamento (pareamento ou código de acesso; ver [credenciamento](credenciamento-e-pessoas.md#login)).
2. A `TelaAvaliador` valida a [janela de avaliação](eventos.md#janela-de-avaliação). Fora da janela, mostra o estado
   correspondente e não sorteia.
3. Consome primeiro a fila direcionada; se vazia, chama o [sorteio](sorteio-e-atribuicao.md).
4. Ao confirmar presença no estande, registra o horário de início (`tempo_presenca`).
5. Preenche as notas por critério do questionário (escala Likert do questionário) e o parecer.
6. Envia por `supabase.rpc('fn_enviar_avaliacao', ...)`. Regras do servidor em
   [funções e RPCs](../banco-de-dados/funcoes-e-rpcs.md#fn_enviar_avaliacao).
7. Sem projetos elegíveis, mostra o status da fila e o botão `"Consultar Novamente"` (sem subtítulo explicativo).

**Avaliação em andamento no fim do horário:** se o avaliador tem trava ativa quando a janela fecha, ele pode concluir
e enviar normalmente. Depois disso, novos sorteios ficam bloqueados e a tela mostra `"Avaliações Encerradas"`.

**Ausência e conflito:** ao chegar ao estande, o avaliador pode marcar o projeto como **ausente** ou declarar
**conflito** de interesse. O sistema grava `historico_impedimentos` (`tipo = 'ausencia'` ou `'conflito'`), libera a
trava e sorteia outro projeto. Esse projeto não volta a ser sorteado para o mesmo avaliador.
(`projetos.contagem_ausencia` é usado como critério de ordenação do sorteio, mas não é incrementado por esse fluxo.)

## Nota final

- Calculada **no servidor** por `fn_enviar_avaliacao` (média simples das notas dos critérios). O valor enviado pelo
  cliente é ignorado.
- Cada nota deve estar dentro de `escala_minima`–`escala_maxima` do questionário.
- O projeto usa o questionário em `projetos.id_questionario_fixado`, fixado na primeira avaliação, se ainda não houver.

## Quarentena

- Um projeto entra em quarentena quando a diferença entre a **maior e a menor nota ativa** passa de **2,5 pontos**
  (com pelo menos 2 avaliações), ou quando `avaliacoes.is_quarentena = true`.
- Aplicada automaticamente por `fn_enviar_avaliacao`; listada por `view_projetos_quarentena`.
- A coordenação analisa no card **Projetos em Quarentena** e libera com `admin_remover_quarentena` (um) ou
  `admin_remover_quarentena_todos`.

## Exclusão de avaliação (soft delete)

Card **Excluir uma avaliação** (`ModalExclusaoAvaliacao`). Decisão: [ADR 0004](../decisoes/0004-soft-delete-de-avaliacoes-via-rpc.md).

- **Nunca apaga**: `excluir_avaliacao` marca `status = 'CANCELADA'` (e `status_avaliacao`) e zera `is_quarentena`.
- **Desfazer** disponível por 8 segundos num toast; depois, a restauração continua possível pelo botão `RotateCcw`
  (`restaurar_avaliacao` → `CONCLUIDA`).
- Confirmação obrigatória: um modal vermelho mostra código, nome e área do projeto, nome e áreas do avaliador e nota
  final antes de `Confirmar Exclusão`.
- Avaliação cancelada libera a cota do projeto para **outros** avaliadores; o mesmo avaliador nunca recebe o projeto
  de novo ([ADR 0005](../decisoes/0005-sorteio-nao-repete-avaliador.md)).

**Tabela do modal** (todas as colunas ordenáveis): Código (com estande) · Nome do Projeto · Área do Projeto ·
Nome do Avaliador (e-mail abaixo) · Área do Avaliador · Critérios (nota final + detalhamento expansível por pergunta,
peso, nota e parecer) · Excluir/Restaurar.

**Busca**: código, título, área do projeto, nome e áreas do avaliador. Placeholder:
`"Buscar por código, título do projeto ou avaliador..."`.

**Carregamento robusto**: a consulta com joins seleciona só colunas existentes
(`projetos(id_projeto, codigo_projeto, titulo, estande, corredor, id_evento, id_area)`, `usuarios(id_usuario, nome, email)`).
Se algum registro vier sem os objetos relacionados, o componente busca em lote por IDs em `projetos`, `usuarios`,
`respostas_avaliacao`, `perguntas_questionario` e `areas_tematicas` e completa os dados em memória. Isso evita exibir
`N/I`.

## Projetos bloqueados

Card **Projetos Bloqueados**: mostra travas ativas (avaliador em campo). Libera com `admin_desbloquear_projeto` ou
`admin_desbloquear_todos`, por exemplo no intervalo do almoço, para travas abandonadas.

Testes: `src/features/avaliacao/__tests__/TelaAvaliadorJanelaHorarios.test.tsx`,
`src/features/atribuicoes/__tests__/ModalExclusaoAvaliacaoCustom.test.tsx`,
`src/__tests__/integracao/RegrasNegocioBloco1.test.tsx`, `RestricaoExclusaoZumbis.test.tsx`.
