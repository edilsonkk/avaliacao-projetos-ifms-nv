# 0007. Gravação de notas só via `fn_enviar_avaliacao`

- **Status**: Aceito
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
- A identidade do avaliador ainda vem do cliente até existir login autenticado.
