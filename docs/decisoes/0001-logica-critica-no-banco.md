# 0001. Lógica crítica no banco (front-end fino)

- **Status**: Aceito
- **Data**: 2026-10-19

## Contexto

Durante a feira, dezenas de avaliadores atuam ao mesmo tempo, em dispositivos variados. Regras calculadas no
navegador (médias, ranking, sorteio, cota) ficariam inconsistentes entre clientes e seriam fáceis de burlar.

## Decisão

Agregações, ranking, relatórios, sorteio e validações de envio ficam no PostgreSQL, em views e funções
`SECURITY DEFINER`. O front-end consome os resultados.

## Consequências

- Uma única fonte de verdade para notas e ranking; o Telão e os relatórios mostram os mesmos números.
- Mudanças de regra exigem migration, além do código React.
- O front-end mantém fallbacks para quando uma função ainda não foi aplicada ou o schema cache está defasado.
