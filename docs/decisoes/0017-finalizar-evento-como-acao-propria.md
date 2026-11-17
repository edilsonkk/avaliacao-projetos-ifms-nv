# ADR 0017 — Finalizar evento é ação própria, separada da pausa

- **Data:** 2026-11-16
- **Situação:** aceita

## Contexto

Até aqui, encerrar a feira era desmarcar **"Sistema liberado para avaliadores"**
(`eventos.sistema_liberado`). A própria dica do campo dizia, textualmente, "use para pausar **ou**
encerrar a feira", e [eventos](../regras-de-negocio/eventos.md) instruía: "Para encerrar a feira, o
Admin define `sistema_liberado = false`".

O campo fazia só metade do trabalho. Depois de desmarcá-lo:

- as **travas** (`locks_ativos`) continuavam de pé até vencerem pelo `minutos_timeout_lock` — e
  travas vencidas só são apagadas no próximo sorteio, que não aconteceria mais;
- os **celulares** seguiam vinculados (`dispositivos_avaliador`), então o avaliador continuava
  dentro do sistema, vendo a tela de bloqueio, e o evento seguinte começava com vínculos antigos;
- os **códigos de acesso** pendentes continuavam válidos.

A alternativa óbvia — fazer o próprio campo desparear ao ser desmarcado — foi recusada, e é o ponto
central desta decisão: aquele campo também é a **pausa** da feira (almoço, problema de rede, atraso
na programação). Desparear numa pausa é destrutivo e irreversível na prática: o vínculo do celular é
uma sessão anônima sem senha, então "religar" o campo não traz ninguém de volta — cada avaliador
precisaria ser pareado outra vez no balcão ([troubleshooting](../operacao/troubleshooting.md)). Uma
pausa de dez minutos custaria o repareamento de toda a equipe de avaliação, no meio da feira.

Também não há agendador no projeto: nenhum `pg_cron`, `pg_net` ou job. Um encerramento "por tempo"
só poderia ser preguiçoso (na próxima leitura ou RPC), e portanto sem hora garantida — ruim para uma
ação que solta todo mundo.

## Decisão

Encerrar passa a ser um ato **explícito**, com botão próprio, e `sistema_liberado` volta a significar
apenas pausa.

`admin_finalizar_evento(p_id_evento)` (migration `20261116010000`) faz tudo numa transação, exigindo
`is_admin()`:

1. `sistema_liberado = false`;
2. apaga as travas **dos projetos daquele evento**;
3. revoga o vínculo de celular dos avaliadores daquele evento;
4. queima os códigos de acesso pendentes daquele evento;
5. grava uma linha de resumo na trilha, com as três contagens.

Três escolhas dentro dela merecem registro:

- **O evento continua ativo** (`is_ativo` segue `true`). Relatórios, Classificação, Auditoria, Telão
  e Mapa de Estandes leem o *evento ativo*, e é deles que a comissão precisa justamente depois do
  encerramento, na homologação e na premiação. Desativar o evento apagaria essas telas da mesa.
- **Nenhuma nota é apagada.** Finalizar não é reset: só devolve travas, e trava não é nota.
- **A confirmação diz quantas avaliações estão em andamento** naquele instante, lido de
  `fn_telao_resumo`. Finalizar devolve essas travas, e quem estava preenchendo perde o que não
  enviou — o Admin precisa saber disso antes de confirmar, não depois.

## Consequências

- Encerrar a feira é um clique com confirmação, e não mais um campo com dois significados.
- Pausar voltou a ser seguro e reversível.
- O evento seguinte começa sem vínculo de celular herdado.
- O encerramento fica na trilha de auditoria, com quem fez e quanto soltou.
- **Não existe encerramento automático** — nem por horário, nem ao desmarcar a pausa. É intencional:
  sem agendador, "automático" seria impreciso, e o efeito é destrutivo demais para um gatilho
  indireto. A janela por horário (`fn_janela_avaliacao_aberta`) continua barrando sorteio e envio
  fora do horário, como sempre.
- Quem precisar encerrar sem soltar os celulares ainda pode apenas desmarcar a pausa.
