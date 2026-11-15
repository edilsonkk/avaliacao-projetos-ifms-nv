# 0007. Gravação de notas só via `fn_enviar_avaliacao`

- **Status**: Aceito, emendado por [0011](0011-identidade-real-avaliador-e-staff.md) e
  [0015](0015-ajuste-manual-de-notas.md)
- **Data**: 2026-10-26

## Contexto

A `TelaAvaliador` inseria direto em `avaliacoes`/`respostas_avaliacao` com `id_usuario` vindo do `localStorage`, e a
RLS aceitava qualquer insert. Qualquer cliente podia gravar qualquer nota em nome de qualquer avaliador.

## Decisão

Criar `fn_enviar_avaliacao` (`SECURITY DEFINER`), que exige trava ativa, aplica todas as regras (conflito,
modalidade, cota, janela, faixa de nota), calcula a nota final no servidor e grava tudo numa transação. Remover o
`INSERT` anônimo nessas tabelas (`20261026010000_rpc_enviar_avaliacao.sql`).

## Consequências

- Regras de avaliação não podem ser contornadas pelo cliente.
- Regras novas de avaliação devem ser implementadas na função, não só no front-end.
- A identidade do avaliador vinha do cliente quando esta decisão foi tomada. O
  [ADR 0011](0011-identidade-real-avaliador-e-staff.md) fechou isso: a função recusa `p_id_usuario` diferente de
  `avaliador_atual()`, a identidade do aparelho vinculado.

## Emendas

- **[0011](0011-identidade-real-avaliador-e-staff.md)** (identidade real): a nota não depende mais de um
  `id_usuario` escolhido pelo cliente.
- **[0015](0015-ajuste-manual-de-notas.md)** (ajuste manual): o título desta decisão vale para a **tela do
  avaliador**. A coordenação passou a ter caminhos oficiais de escrita de nota (`admin_lancar_avaliacao`,
  `admin_corrigir_respostas_avaliacao`, `admin_arbitrar_nota_final`, `admin_ajustar_media_projeto`), todos com
  `is_admin()`, marca em `ajuste_tipo` e registro na trilha. O que continua proibido é gravar nota **fora** de uma
  função.
