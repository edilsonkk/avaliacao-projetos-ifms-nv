# 0004. Soft delete de avaliações via RPC

- **Status**: Aceito
- **Data**: 2026-10-25

## Contexto

A coordenação precisa anular avaliações (erro, conflito descoberto depois), mas apagar dados de nota impede
auditoria. Cliques acidentais também precisam ser reversíveis.

## Decisão

- Avaliações nunca são apagadas: `excluir_avaliacao` marca `status = 'CANCELADA'`; `restaurar_avaliacao` desfaz.
- A operação é uma função no banco, restrita ao Admin.
- A interface exige confirmação com o resumo da avaliação e oferece Desfazer por 8 segundos.

## Consequências

- Histórico completo para auditoria.
- Toda consulta de notas e cotas deve ignorar `CANCELADA`.
- A restrição `UNIQUE (id_projeto, id_usuario)` continua valendo para canceladas (ver [0005](0005-sorteio-nao-repete-avaliador.md)).
