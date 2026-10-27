# 0008. Front-end organizado por features

- **Status**: Aceito
- **Data**: 2026-10-27

## Contexto

`src/components/` reunia 23 componentes de domínios diferentes, com imports relativos e absolutos misturados. Isso
dificultava achar código e preparar o projeto para vários contribuidores.

## Decisão

Organizar `src/` por domínio (`src/features/<feature>/` com `components/`, `__tests__/` e `index.ts` como API
pública), com compartilhados em `src/components/` e código sem React em `src/lib/`. Imports entre módulos usam o alias
`@/`. Detalhes em [frontend](../arquitetura/frontend.md).

## Consequências

- Uma feature só importa outra pelo `index.ts`.
- Os componentes grandes ainda precisam ser divididos em hooks e subcomponentes.
