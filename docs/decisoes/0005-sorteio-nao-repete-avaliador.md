# 0005. Sorteio nunca repete o par projeto/avaliador

- **Status**: Aceito
- **Data**: 2026-10-25

## Contexto

Depois de um soft delete ([0004](0004-soft-delete-de-avaliacoes-via-rpc.md)), o sorteio voltava a entregar o mesmo
projeto ao mesmo avaliador, e o envio falhava com `unica_avaliacao_por_usuario`. Além disso, reavaliar pelo mesmo
avaliador não faz sentido para a banca.

## Decisão

- O sorteio exclui **qualquer** projeto já avaliado pelo avaliador, inclusive com avaliação cancelada.
- A cota do projeto ignora canceladas, então o projeto volta à fila para **outros** avaliadores.
- A atribuição forçada recusa com "Já avaliou este projeto".

## Consequências

- Uma avaliação cancelada não pode ser refeita pelo mesmo avaliador, apenas restaurada.
