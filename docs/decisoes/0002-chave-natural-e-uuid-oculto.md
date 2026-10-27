# 0002. Upsert por chave natural e UUID oculto na interface

- **Status**: Aceito
- **Data**: 2026-10-21

## Contexto

Planilhas são reimportadas várias vezes durante a preparação. Usar o UUID como identificador criava duplicatas, e
exibir UUIDs dificultava localizar projetos nos estandes.

## Decisão

- Importações fazem upsert pela chave natural: `codigo_projeto` (projetos), `email` (pessoas), `nome_normalizado`
  (instituições).
- O UUID interno nunca é exibido; a interface usa o código do projeto.

## Consequências

- Importações são idempotentes.
- A chave natural precisa ser única e estável; mudar o código de um projeto equivale a criar outro.
