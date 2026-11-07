# 0014. Trilha de auditoria append-only, gravada por trigger

- **Status**: Aceito
- **Data**: 2026-11-06

## Contexto

Não havia como responder "quem alterou esta nota?". A disciplina do sistema diz que nota só se grava por
`fn_enviar_avaliacao` ([ADR 0007](0007-gravacao-de-notas-via-rpc.md)) e que avaliação nunca é apagada, só
cancelada ([ADR 0004](0004-soft-delete-de-avaliacoes-via-rpc.md)). Mas a policy de escrita do Admin é
`FOR ALL` ([ADR 0006](0006-rls-escrita-restrita-a-admin.md)): pela API REST, um `UPDATE avaliacoes SET
nota_final = 10` passava direto, sem validação e **sem deixar vestígio** — `avaliacoes` não tem
`atualizado_em` e não havia trigger nenhuma no banco. O mesmo valia para `respostas_avaliacao` e para o
`peso_calculo` das perguntas, que muda a nota de todas as avaliações daquele questionário.

Havia só dois rastros, ambos parciais: `cancelada_em`/`cancelada_por` (que `restaurar_avaliacao` zerava) e
`quarentena_resolvida_em`/`quarentena_resolvida_por`. Nenhuma tela mostrava os dois.

## Decisão

Uma tabela `public.log_auditoria` **append-only**, preenchida por **trigger** e **não** por RPC.

- Trigger, porque é o único ponto por onde toda escrita passa, inclusive a que vem direto do PostgREST.
  Registrar na RPC só registraria quem já se comporta bem.
- Append-only de verdade: nenhuma policy de escrita, `GRANT` de escrita revogado e um trigger que recusa
  `UPDATE`/`DELETE`/`TRUNCATE` até para o dono da tabela. Leitura só com `is_admin()`.
- Cada RPC confiável se identifica com `auditoria_marcar_origem()`, numa variável local à transação. O que
  não se identifica fica com `origem = 'direto'`.
- A trilha **sobrevive ao reset global**, que passa a registrar antes o resumo do que vai apagar.

**Registrar e alertar, não impedir**: a policy `FOR ALL` do Admin continua como está. A escrita direta
em nota passa a aparecer como achado grave (C10) na conferência e em vermelho na trilha.

## Consequências

- Passa a existir resposta para "quem mexeu, quando, de onde e por quê", com o antes e o depois dos campos.
- Credenciamento e check-in ganham hora e autor, que não existiam em coluna nenhuma.
- Toda tabela nova que afete nota precisa entrar na lista de triggers da auditoria.
- Dado pessoal não entra no log (`cpf`, `celular` e `id_auth` saem do antes/depois de `usuarios`).
- O log cresce com o uso. `respostas_avaliacao` registra só `UPDATE`/`DELETE` — o `INSERT` do envio já fica
  na linha da avaliação, e logar cada resposta encheria a trilha de N linhas por avaliação enviada.
- A trilha começa na data da migration: não há histórico anterior, e as telas dizem isso.

## Alternativas consideradas

- **Fechar a policy do Admin** (escrita de nota só por RPC): resolveria na raiz, mas foi recusada para não
  travar a operação da feira num caminho que hoje é usado pelas telas. Com o ajuste manual oficial
  ([ADR 0015](0015-ajuste-manual-de-notas.md)), o `UPDATE` direto perde o motivo de existir, e fechar a
  policy fica como passo seguinte possível.
- **Coluna `atualizado_em` nas tabelas de nota**: diria que mudou, não o que mudou nem quem mudou.
- **Auditoria no front-end**: só registraria o que passa pelas telas, que é exatamente o que já é confiável.
