# 0020. A configuração de questionários é conferida, não travada

- **Status**: Aceito
- **Data**: 2026-11-23

## Contexto

A configuração combinada para a feira é **um questionário técnico por evento, numa escala só**, com vínculo de
questionário reservado aos votantes do voto popular. Nada no banco cobrava isso. Em particular, dois questionários
técnicos de escalas diferentes no mesmo evento produziam notas que entram na **mesma** média e no **mesmo** ranking:
a posição do projeto passava a depender da escala de quem o avaliou, e nenhuma linha de código reclamava.

A primeira ideia foi travar na escrita: fazer `admin_vincular_questionario_avaliador` recusar questionário técnico, e
talvez impedir o segundo técnico por `CHECK`. A investigação desmontou as duas.

**Travar o vínculo técnico removeria recurso em uso.** `fn_enviar_avaliacao` tem a regra "avaliador vinculado a um
questionário só usa aquele", e ela vale para **qualquer** questionário, não só para os de voto popular:

```sql
v_quest_vinculado := public.questionario_do_avaliador(p_id_usuario, v_id_evento);
IF v_quest_vinculado IS NOT NULL AND v_quest_vinculado IS DISTINCT FROM p_id_questionario THEN
  RAISE EXCEPTION 'Este avaliador está vinculado a outro questionário neste evento.' USING ERRCODE = '42501';
END IF;
```

É assim que uma feira com mais de um questionário técnico diz qual banca usa qual. O seletor de
`GestorAvaliadores` oferece os técnicos de propósito (marcando só os de voto popular com um sufixo), e
`scripts/simular-feira.mjs` exercita esse caminho num grupo próprio, `tecnico-vinculado`. A recusa teria quebrado os
três.

**Travar o segundo técnico por constraint reprovaria dado legítimo.** Trocar o questionário de um evento é criar o
novo e apagar o antigo; nesse intervalo existem dois técnicos de verdade. Uma `CHECK` também reprovaria o que já está
gravado em produção, derrubando a migração.

## Decisão

Conferir, não travar. `fn_auditar_configuracao_questionarios(p_id_evento)` devolve três achados no formato dos
demais, e `fn_auditar_notas` a agrega por `UNION ALL` — o mesmo caminho por onde C13 e C14 chegam ao Painel de
Auditoria, que lê só essa função. **Sem mudança de front-end**: o Painel renderiza código que não conhece.

| Código | Achado | Severidade |
|---|---|---|
| C15 | evento com mais de um questionário técnico | informativo |
| C16 | questionários técnicos com escalas diferentes | grave |
| C17 | avaliadores fixados num questionário técnico, agregado por questionário | informativo |

**Só C16 é grave.** As outras duas severidades foram decididas por medição, depois de a configuração real da feira
ser informada: 300 projetos, 120 avaliadores, 10 de staff, **três** questionários técnicos de mesma escala, um de
voto popular e cota 3. Com ela, o modo drenagem de `scripts/simular-feira.mjs` fechou a feira — `fn_feira_concluida`
confirmou em 6 varreduras, 289 projetos com a cota cheia, **zero incompletos**, os 48 avaliadores vinculados
distribuídos 16/16/16 entre os três técnicos e as dez invariantes válidas. Uma configuração que fecha a feira não é
achado grave; chamar de grave o que funciona treina a coordenação a ignorar a faixa vermelha.

C15 é **informativo**: vários questionários técnicos por evento são configuração **prevista**. O que o achado faz é
mostrar quantos o evento tem e qual o efeito a conhecer — a trava do questionário prende o projeto ao primeiro
técnico que o avaliar, então um avaliador vinculado a outro técnico não consegue avaliá-lo, e a cota daquele projeto
depende de sobrar quem possa —, com o comando que confere o fechamento antes da feira
(`npm run local:simular -- --questionarios=existentes --ate-concluir`).

C17 é **informativo** e vem **agregado por questionário**, com a contagem e os três primeiros nomes: por pessoa
seriam 48 achados na configuração real, que enterrariam o resto do Painel. Travar o vínculo seria decisão de
produto, e exigiria antes filtrar o seletor de `GestorAvaliadores` e reescrever o grupo `tecnico-vinculado` do
simulador.

Migration `20261123174858_conferencia_configuracao_questionarios.sql`; teste
`supabase/tests/44_configuracao_de_questionarios_test.sql`, validado por mutação em sete pontos.

## Consequências

- A coordenação vê a configuração errada **antes** da feira, no Painel de Auditoria, com os títulos dos
  questionários e as escalas em conflito nomeados. Nenhum UUID aparece nos achados (regra 6), e há asserção para isso.
- Nada passa a ser recusado: configuração que funcionava continua funcionando.
- C15 e C16 são por evento e vêm sem projeto e sem avaliação — `id_projeto` e `id_avaliacao` nulos, o que o Painel já
  tolera porque C12 de ajuste de média também não tem avaliação.
- A função tem trava própria de `is_admin()`, e não só a de quem a chama. Escrevê-la assim revelou que
  `fn_auditar_voto_popular` era a exceção da família — ver a revisão abaixo, que a fechou.

## Ponto cego conhecido

Um vínculo **cruzado** entre eventos — avaliador do evento A apontado para questionário do evento B — não é
reportado por nenhum dos dois lados: a conferência de B filtra pelo evento do avaliador e a de A pelo evento do
questionário. `admin_vincular_questionario_avaliador` recusa criar esse estado ("o questionário precisa ser do mesmo
evento do avaliador"), então ele só nasce por SQL direto. O teste 44 planta a linha e **afirma o silêncio**, para que
a mudança desse comportamento apareça em vez de passar batido.

## Revisão de 23/11/2026

Duas correções, as duas vindas de informação que chegou depois da decisão original. Migration
`20261123191829_varios_tecnicos_e_trava_do_voto_popular.sql`.

**1. C15 passou de atenção para informativo.** A decisão original partia da regra "um questionário técnico por
evento"; medida a configuração real (três técnicos), C15 caiu de grave para atenção. A informação que faltava é mais
simples: **vários questionários técnicos por evento são previstos**. Um achado de atenção sobre configuração
escolhida de propósito continua sendo alarme falso — menor, mas falso. C16 segue o único grave, e com vários
técnicos sendo o normal ele fica mais importante, não menos.

**2. `fn_auditar_voto_popular` ganhou a trava de `is_admin()`.** O limite registrado nas consequências acima foi
medido com uma sessão de avaliador pareado de verdade, antes de decidir:

```
select count(*) from avaliacoes             -> 0        (rls_avaliacoes_leitura: só as próprias)
select * from fn_auditar_voto_popular(NULL) -> 1 linha: C14, projeto SIM-0001,
                                               com o id_avaliacao DE OUTRA PESSOA
```

É furo de RLS: a função entregava a existência e o id de avaliação alheia, que a policy entrega zero. O alcance é
estreito — só linhas que já são anomalia, sem nota, sem nome, sem média, e num evento saudável ela devolve nada —,
mas não havia motivo para manter a exceção: o único chamador é `fn_auditar_notas`, que já exigia Admin, e nada em
`src/` a chama, então **nenhum caminho do front-end muda**. A função passou de `sql` para `plpgsql` só para poder
`RAISE`; o corpo da consulta é o mesmo.

As duas mudanças foram validadas por mutação, e o teste 44 passou a cobrar a postura das **três** funções de
conferência no mesmo lugar, junto da linha de base que elas respeitam (a RLS não entrega avaliação alheia).
