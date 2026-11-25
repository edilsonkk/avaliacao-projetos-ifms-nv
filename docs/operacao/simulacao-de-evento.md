# Simulação de evento

Cria uma feira fictícia inteira — projetos, avaliadores, staff, questionários — e a executa pelo caminho real,
para você acompanhar no telão. Serve a dois usos: **ensaiar** a feira com a equipe, sem terminal, e **medir** se
a aplicação aguenta o volume antes do dia.

Onde fica: painel do Admin → ícone de engrenagem → **Simulação de Evento**.

O mesmo existe em linha de comando, para o banco local, em
[ambiente local do zero](ambiente-local-do-zero.md). Os dois caminhos convivem: o painel roda numa aba e serve
para ver a feira acontecer; os scripts rodam vários processos e servem para medir vazão.

## O que acontece quando você inicia

1. Um evento novo é criado, com o nome começando em `Simulação de Carga`, e **passa a ser o evento ativo** —
   é a única forma de a feira fictícia aparecer no telão, que sempre lê o evento ativo do banco.
2. Catálogos, questionários, projetos e avaliadores fictícios são gravados em lote.
3. A rodada começa: a coordenação vai confirmando a presença nos estandes enquanto os avaliadores sorteiam
   projetos e enviam notas, pelas mesmas funções do banco que a feira real usa.
4. Ao encerrar, as travas são liberadas e **o evento que estava ativo antes volta a ser o ativo**. Depois você
   pode apagar a simulação.

O evento anterior é guardado pelo **nome**, na descrição do evento de simulação, e também no navegador. Se a aba
fechar no meio, o modal reconhece a simulação esquecida na próxima vez e oferece encerrar, restaurar ou apagar.

## Os parâmetros, e o que cada um realmente muda

| Campo | Efeito |
|---|---|
| Projetos | Quantos projetos fictícios o evento terá, com código `SIM-0001` em diante, estande e corredor. |
| Avaliadores | Quantas pessoas avaliam, somando técnicos e público votante. |
| Staff | **Só cadastra as pessoas.** O check-in da simulação é feito pela coordenação, que tem esse direito no banco; o staff fictício não entra em cena. |
| Avaliações por projeto | A cota do evento. É o que define quando um projeto está concluído. |
| Questionários técnicos | Com mais de um, a trava do questionário no primeiro avaliador passa a valer, e recusas por "projeto fixado em outro questionário" aparecem — o que é acerto. |
| Semente do sorteio | A mesma semente repete exatamente a mesma feira. Serve para reproduzir uma rodada que deu problema. |
| Tempo entre avaliações | Tempo de pensar de cada avaliador, com variação de 0,5× a 1,5× para os atores não entrarem em lockstep. Zero roda sem pausa, que é o modo de medição. |
| Requisições simultâneas | Quantas chamadas ficam em voo. Veja o teto realista abaixo. |
| Modo de sessão | Ver a seção própria. |
| Voto popular (%) | Fatia dos avaliadores que entra como público votante, fixada no questionário de voto popular. Enche o bloco de voto popular do telão. |
| Check-in (%) | Projetos que chegam ao estande durante a rodada. Projeto sem check-in **não é sorteado**: com 0%, o telão não sai do zero. |
| Credenciamento (%) | **Move o contador do telão, e só.** O sorteio e o envio não conferem `is_credenciado` — as únicas conferências estão em `fn_motivo_inelegivel`, que é diagnóstico, e nas leituras do telão. Não é isso que dá direito de avaliar. |
| Dispersão das notas (%) | Zero concentra tudo no meio da escala; 100 usa a escala inteira. A escala vem do questionário lido do banco, nunca de valor fixo. |
| Projetos divergentes (%) | Recebem notas opostas de propósito, para cair em quarentena. Quem marca a quarentena é o banco, pela regra dele. |

## Os dois modos de sessão

| Modo | Onde roda | O que exercita |
|---|---|---|
| **Pela sessão da coordenação** (padrão) | local e produção | sorteio, trava e timeout, cota, conflito de instituição, modalidade bloqueada, fixação de questionário, quarentena, voto popular e o telão |
| **Uma sessão por avaliador** | **só no banco local** | tudo o acima **mais** a sessão do aparelho, o pareamento na portaria, o credenciamento e a RLS pelo caminho do próprio avaliador |

O modo padrão funciona porque `sortear_proximo_projeto` e `fn_enviar_avaliacao` deixam a coordenação agir em nome
de um avaliador do evento — o mesmo portão do lançamento de nota em papel.

O modo fiel não roda em produção por dois motivos concretos. Cada sessão anônima cria uma linha permanente em
`auth.users`, e **nenhuma função do projeto apaga `auth.users`**: só a chave de serviço, que por desenho não
existe no navegador. No banco local, `npx supabase@2.122.0 db reset` zera tudo; em produção o lixo seria
permanente. E o limite de sessões anônimas é **por IP** (`supabase/config.toml`, 300 por hora no local), sendo
que todos os "aparelhos" da simulação saem do mesmo IP.

## Rodar em produção

O botão funciona nos dois ambientes, porque medir carga no ambiente real é justamente um dos usos. Em produção o
sistema pede mais:

- aviso de que o evento ativo será trocado, e de que o telão público e os celulares passarão a mostrar a feira
  fictícia enquanto a rodada acontece;
- aviso em destaque quando a **janela de avaliação do evento atual está aberta** — ou seja, quando há feira em
  andamento de verdade. A conta é do banco, no fuso do evento, não do relógio de quem abriu a tela;
- **o nome exato do evento ativo digitado à mão** antes de iniciar, como no Reset Global;
- limites de volume menores, e o modo "sessão por avaliador" indisponível.

Escolha um horário fora de qualquer janela de avaliação, comece pequeno e apague ao terminar.

## Limites honestos

- **A rodada morre com a aba.** Fechar ou recarregar interrompe a simulação. As travas que sobram expiram
  sozinhas pelo tempo de timeout do evento, e o modal oferece encerrar e restaurar na próxima abertura.
- **Deixe a janela visível**, ao lado do telão, em vez de atrás de outra aba: o navegador segura os
  temporizadores em aba escondida e o ritmo se desfaz. Com tempo zero entre avaliações isso não acontece, porque
  o laço passa a ser dirigido pela rede.
- **O teto útil de concorrência é baixo**: entre 8 e 16 requisições em voo o ganho para de crescer. Acima disso,
  o que se mede é a fila. O padrão é 8 no local e 4 em produção.
- **Isto não substitui o simulador de linha de comando.** As chamadas saem de um só token, um só IP e uma só
  conexão: dá para medir banco, funções, índices e disputa de travas, não o caminho de autenticação de cada
  aparelho nem limites por IP. Para vazão, use `npm run local:simular`.
- **A trilha de auditoria cresce e não é apagada.** Cada avaliação simulada deixa linhas em `log_auditoria`, que
  é append-only por desenho ([ADR 0014](../decisoes/0014-trilha-de-auditoria-append-only.md)). Numa rodada
  grande em produção, esse é o custo mais relevante — mais que o pico de requisições.
- **Custo de requisições**: duas chamadas por avaliação, mais as recusadas. 300 projetos com cota 3 dão cerca de
  900 avaliações, ou seja, perto de 1.800 chamadas.

## Lendo o painel durante a rodada

- **Recusas pela regra** não são falhas: é o sistema recusando o que deve recusar — cota cheia, avaliador
  repetido no mesmo projeto, conflito de instituição, modalidade bloqueada, projeto fixado em outro
  questionário, projeto sem check-in. Elas aparecem rotuladas e contadas à parte.
- **Erros** são o que não casa com nenhuma recusa conhecida. Qualquer número acima de zero aqui merece olhada.
- O botão **Abrir o telão em outra janela** leva para `/telao`, que atualiza a cada dez segundos.

## Encerrar e apagar

**Encerrar** libera as travas do evento de simulação e devolve o posto de ativo ao evento anterior. É o que você
faz sempre ao terminar.

**Apagar** remove o evento fictício, seus projetos, avaliações e os avaliadores que nasceram nele. Recusa rodar
se o evento não for de simulação ou se ainda for o ativo, e preserva quem tiver vínculo ou nota em outro evento.
A trilha de auditoria permanece, porque não pode ser apagada.

A limpeza inteira é feita por uma função do banco, `admin_apagar_simulacao`, e não pelo navegador. Dois motivos:

- **`admin_reset_global` não serve**: aquela função apaga avaliadores e staff **de toda a base** que ainda não
  tenham nota, sem filtrar por evento. Em produção levaria gente de outros eventos.
- **Apagar pelo navegador sujava a auditoria da feira real.** A cascata do apagamento registrava as respostas e
  as perguntas na trilha como "escrita fora do fluxo", e a
  [conferência de notas](../regras-de-negocio/auditoria-de-notas.md) passava a acusar achado **grave** C10 em
  **todos** os eventos. Numa medição, apagar uma simulação de 31 avaliações deixou 141 alarmes falsos — e
  permanentes, porque a trilha não pode ser apagada.

Se você vir achados C10 de `respostas_avaliacao` ou `perguntas_questionario` sem evento, é disso que vêm: uma
simulação apagada pelo caminho antigo. Ver
[ADR 0021](../decisoes/0021-motor-de-simulacao-no-navegador.md).

## Quando algo não anda

| Sintoma | Causa provável |
|---|---|
| O telão não sai do zero | Check-in em 0%, ou a simulação não é o evento ativo. Projeto sem check-in não é sorteado. |
| Nenhum projeto fecha a cota | Avaliadores em número menor que a cota: um avaliador não avalia o mesmo projeto duas vezes. O painel avisa antes de iniciar. |
| Muitas recusas por conflito de interesse | Poucas instituições no catálogo em relação aos avaliadores; é a regra funcionando. |
| A rodada para dizendo que nenhum avaliador avançou | Todos os projetos elegíveis já estão na cota, ou as modalidades bloqueadas e os conflitos esgotaram as combinações. |
| "Sessão de administrador expirada" | Entre de novo na aba Admin: toda escrita confere a sessão antes. |
| Em produção, o botão de iniciar fica apagado | Falta digitar o nome exato do evento ativo, ou o volume passa do limite do ambiente. |
