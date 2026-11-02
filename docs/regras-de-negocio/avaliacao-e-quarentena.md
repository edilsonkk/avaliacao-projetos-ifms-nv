# Avaliação, Quarentena e Exclusão de Avaliações

Código: `src/features/avaliacao/components/TelaAvaliador.tsx`, `src/features/atribuicoes/components/`
(`ModalExclusaoAvaliacao`, `ProjetosQuarentena`, `ProjetosBloqueados`).

## Fluxo do avaliador

1. Celular vinculado no credenciamento (pareamento ou código de acesso; ver [credenciamento](credenciamento-e-pessoas.md#login)).
2. A `TelaAvaliador` valida a [janela de avaliação](eventos.md#janela-de-avaliação). Fora da janela, mostra o estado
   correspondente e não sorteia.
3. Consome primeiro a fila direcionada (`fn_assumir_item_fila`: o banco pula itens inelegíveis ou com cota cheia e
   grava a trava); se não houver item válido, chama o [sorteio](sorteio-e-atribuicao.md).
4. Ao confirmar presença no estande, registra o horário de início (`tempo_presenca`).
5. Preenche as notas por critério do questionário (escala Likert do questionário) e o parecer. Cada critério é um
   grupo de campos com o título no `legend`, e cada nota é um botão de opção que o leitor de tela anuncia como
   "Nota 4 de 5" — dá para escolher pelo teclado, com as setas.
6. Envia por `supabase.rpc('fn_enviar_avaliacao', ...)`. Regras do servidor em
   [funções e RPCs](../banco-de-dados/funcoes-e-rpcs.md#fn_enviar_avaliacao).
7. Sem projetos elegíveis, mostra o status da fila e o botão `"Consultar Novamente"` (sem subtítulo explicativo).

**Avaliação em andamento no fim do horário:** se o avaliador tem trava ativa quando a janela fecha, ele pode concluir
e enviar normalmente. Depois disso, novos sorteios ficam bloqueados e a tela mostra `"Avaliações Encerradas"`.

**Ausência e conflito:** ao chegar ao estande, o avaliador pode marcar o projeto como **ausente** ou declarar
**conflito** de interesse. O sistema grava `historico_impedimentos` (`tipo = 'ausencia'` ou `'conflito'`) por
`fn_registrar_impedimento`, que só aceita o projeto em que o avaliador está (com trava), libera a trava e sorteia outro
projeto. Esse projeto não volta a ser sorteado para o mesmo avaliador.
(`projetos.contagem_ausencia` é usado como critério de ordenação do sorteio, mas não é incrementado por esse fluxo.)

## Nota final

- Calculada **no servidor** por `fn_enviar_avaliacao` (média das notas dos critérios **ponderada pelo `peso_calculo`** de cada pergunta, lido do banco; com pesos iguais, é a média simples). O valor enviado pelo
  cliente é ignorado.
- Cada nota deve estar dentro de `escala_minima`–`escala_maxima` do questionário.
- O banco exige **todas as perguntas do questionário, uma vez cada, com nota**: responder só algumas, repetir uma
  pergunta ou usar perguntas de outro questionário é recusado. O questionário precisa ser do evento do projeto.
- O projeto usa o questionário em `projetos.id_questionario_fixado`, fixado na primeira avaliação, se ainda não houver;
  depois disso, outro questionário é recusado.
- Parecer: até 5000 caracteres.

## Gestor de Questionários (Admin)

- Lista os questionários do **evento ativo** (título, escala e número de perguntas). Sem evento ativo, não cria.
- Cada pergunta tem texto, texto de ajuda opcional (aparece para o avaliador), peso e prioridade de desempate. O
  **peso** entra na nota final (média ponderada) e a **prioridade** define a ordem do desempate no ranking (1, 2, 3…;
  0 = fora do desempate). Ver [relatórios](relatorios-e-monitoramento.md).
- **Questionários prontos:** 7 modelos (Feira de Software: Técnico Ideia, Protótipo e Produção; Convalidação de TCC;
  Voto popular; Feira de Ciências científica e tecnológica), escala 1 a 5, peso 1. Em cada item "Critério: texto de
  ajuda" do documento de origem, o critério é o texto da pergunta e o resto é o texto de ajuda (com as âncoras 1/3/5,
  quando houver). O interruptor **"Ativo neste evento"** copia o modelo para o evento (`admin_copiar_questionario`);
  desligar exclui a cópia, o que o banco recusa se ela já foi usada. A cópia é editável sem alterar o modelo. O voto
  popular não tem fluxo de visitante: se ativado, aparece aos avaliadores como mais um questionário.
- **CRUD dos modelos:** o lápis carrega o modelo no mesmo formulário abaixo (aviso "Editando o modelo…", com
  descrição opcional); salvar grava o modelo (`admin_salvar_modelo_questionario`). Se o modelo está ativo no evento
  ativo e a cópia **ainda não foi usada** em avaliação, a cópia é atualizada junto; se já foi usada, fica como está e a
  tela avisa. "Novo modelo" abre o formulário em branco (escala 1–5); "Salvar como modelo", em cada questionário do
  evento, cria um modelo a partir dele (e o interruptor do novo modelo aparece ligado). Qualquer modelo pode ser
  excluído, com confirmação; as cópias nos eventos continuam. **"Restaurar originais"** recria os 7 originais
  excluídos e devolve o texto original aos editados, sem mexer nos modelos criados pelo Admin.
- **Reaproveitar de eventos anteriores:** lista os questionários dos outros eventos, agrupados por evento, e copia o
  escolhido para o evento ativo com perguntas, textos de ajuda e pesos. O original não muda. Copiar de novo não
  duplica; a cópia de algo que veio de um modelo fica ligada ao modelo (o interruptor aparece ligado).
- O avaliador só vê os questionários do evento do projeto.
- Criar e editar passam por `admin_salvar_questionario`, numa transação. A edição atualiza as perguntas no lugar
  (mesmo `id_pergunta`), sem apagar e recriar.
- **Questionário já usado em avaliação:** só o título pode mudar. Perguntas, pesos e escala ficam travados, e excluir
  é recusado, porque apagar perguntas apagaria as notas por critério.
- Importação de planilha: coluna `pergunta`/`critério` (e opcionais `lembrete`/`descrição` e `peso`). Se o formulário
  já tem perguntas, a tela pergunta se anexa ou começa um questionário novo. Nada é gravado até clicar em salvar.

## Quarentena

- Um projeto entra em quarentena quando a diferença entre a **maior e a menor nota ativa** passa de **2,5 pontos**
  (com pelo menos 2 avaliações), ou quando `avaliacoes.is_quarentena = true`.
- Aplicada automaticamente por `fn_enviar_avaliacao`; listada por `view_projetos_quarentena`.
- A coordenação analisa no card **Projetos em Quarentena**, que mostra só o **evento ativo**, começando pela maior
  divergência, com a menor e a maior nota e o número de avaliações. **Ver notas** abre a nota de cada avaliador.
- Para resolver, há dois caminhos:
  1. **Descartar uma nota fora da curva**: card **Excluir uma avaliação** (soft delete). A divergência é recalculada
     sem ela.
  2. **Aceitar divergência**: `admin_remover_quarentena(p_id_projeto)` registra em `projetos.quarentena_resolvida_em`
     / `quarentena_resolvida_por` que o Admin aceitou as notas atuais. O projeto sai da lista e do contador do painel
     e **só volta se chegar uma avaliação nova** (com `created_at` depois da resolução).
     **Resolver Todos** faz o mesmo para o evento ativo (`admin_remover_quarentena_evento(p_id_evento)`).
- As duas ações de aceite pedem confirmação. O contador do painel conta projetos (não avaliações) do evento ativo.
- Antes da migration `20261029220000`, "Tirar de Quarentena" só zerava `is_quarentena`: a divergência continuava e o
  projeto voltava para a lista ao recarregar.

## Exclusão de avaliação (soft delete)

Card **Excluir uma avaliação** (`ModalExclusaoAvaliacao`). Decisão: [ADR 0004](../decisoes/0004-soft-delete-de-avaliacoes-via-rpc.md).

- **Nunca apaga**: `excluir_avaliacao` marca `status = 'CANCELADA'` (e `status_avaliacao`), registra
  `cancelada_em` / `cancelada_por` e **recalcula a quarentena do projeto** (`fn_recalcular_quarentena`, mesma regra da
  view). Cancelar a nota fora da curva tira o projeto da quarentena; o aviso diz "O projeto saiu da quarentena".
- **Desfazer** disponível por 8 segundos num toast; depois, a restauração continua possível pelo botão **Restaurar**
  (`restaurar_avaliacao` → `CONCLUIDA`, também recalcula a quarentena).
- **Restaurar respeita a cota**: se a vaga liberada já foi ocupada (outra avaliação ativa ou trava válida), o banco
  recusa com "O projeto X já está com a cota completa (N de N vagas ocupadas)". Cancele outra avaliação antes.
- A lista mostra **todas** as avaliações do evento ativo (filtro no banco, paginada de 1000 em 1000), com contadores
  de concluídas e canceladas. Erros do banco aparecem na tela; nada é gravado por fora das funções.
- Antes da migration `20261029240000`, cancelar só desmarcava a avaliação cancelada (as outras continuavam marcadas
  e o projeto seguia em quarentena), restaurar podia passar da cota, e a tela lia só as 300 avaliações mais recentes
  de todos os eventos.
- Confirmação obrigatória: um modal vermelho mostra código, nome e área do projeto, nome e áreas do avaliador e nota
  final antes de `Confirmar Exclusão` (`role="alertdialog"`).
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

Card **Projetos Bloqueados**: mostra as travas ativas (avaliador em campo) dos projetos do **evento ativo**. Cada
linha é a trava de **um** avaliador; o mesmo projeto aparece uma vez por avaliador (até a cota). A lista mostra quanto
falta para cada trava expirar (em vermelho nos últimos 5 minutos), começa pela que expira primeiro, atualiza a cada
30 segundos e ao voltar para a aba, e tira da lista na hora a trava que venceu.

- **Liberar trava** (linha): `admin_desbloquear_trava(p_id_lock)` solta só aquele avaliador; os outros do mesmo
  projeto continuam.
- **Desbloquear Todos**: `admin_desbloquear_todos()`, por exemplo no intervalo do almoço, para travas abandonadas.
- As duas ações **pedem confirmação**: quem perde a trava não consegue enviar a avaliação em andamento
  (`fn_enviar_avaliacao` exige a trava) e precisa sortear de novo. A trava expira sozinha; libere só se o avaliador
  desistiu ou trocou de aparelho.
- O contador do card no painel conta as mesmas travas da tela (válidas e do evento ativo).

Testes: `src/features/avaliacao/__tests__/TelaAvaliadorJanelaHorarios.test.tsx`,
`src/features/atribuicoes/__tests__/ModalExclusaoAvaliacaoCustom.test.tsx`,
`src/__tests__/integracao/RegrasNegocioBloco1.test.tsx`, `RestricaoExclusaoZumbis.test.tsx`.
