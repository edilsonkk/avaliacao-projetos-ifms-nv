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
| C15 | evento com mais de um questionário técnico | grave |
| C16 | questionários técnicos com escalas diferentes | grave |
| C17 | avaliador fixado num questionário técnico | atenção |

C17 é **atenção** porque descreve configuração legítima: informa que aquele avaliador só envia nota por aquele
questionário e é recusado em qualquer outro — na configuração de um técnico só, o vínculo deve ficar vazio. Travar
isso seria decisão de produto, e exigiria antes filtrar o seletor de `GestorAvaliadores` e reescrever o grupo
`tecnico-vinculado` do simulador.

Migration `20261123174858_conferencia_configuracao_questionarios.sql`; teste
`supabase/tests/44_configuracao_de_questionarios_test.sql`, validado por mutação em sete pontos.

## Consequências

- A coordenação vê a configuração errada **antes** da feira, no Painel de Auditoria, com os títulos dos
  questionários e as escalas em conflito nomeados. Nenhum UUID aparece nos achados (regra 6), e há asserção para isso.
- Nada passa a ser recusado: configuração que funcionava continua funcionando.
- C15 e C16 são por evento e vêm sem projeto e sem avaliação — `id_projeto` e `id_avaliacao` nulos, o que o Painel já
  tolera porque C12 de ajuste de média também não tem avaliação.
- A função tem trava própria de `is_admin()`, e não só a de quem a chama. Isso a põe em desacordo com
  `fn_auditar_voto_popular`, que é `SECURITY DEFINER`, está concedida a `authenticated` e **não** tem essa trava —
  qualquer sessão autenticada lê os achados C13/C14 do evento, contornando a RLS de `avaliacoes` e `projetos`. É
  achado pré-existente, não introduzido aqui, e fechá-lo é mudança de postura que pede decisão própria: está
  registrado para isso.

## Ponto cego conhecido

Um vínculo **cruzado** entre eventos — avaliador do evento A apontado para questionário do evento B — não é
reportado por nenhum dos dois lados: a conferência de B filtra pelo evento do avaliador e a de A pelo evento do
questionário. `admin_vincular_questionario_avaliador` recusa criar esse estado ("o questionário precisa ser do mesmo
evento do avaliador"), então ele só nasce por SQL direto. O teste 44 planta a linha e **afirma o silêncio**, para que
a mudança desse comportamento apareça em vez de passar batido.
