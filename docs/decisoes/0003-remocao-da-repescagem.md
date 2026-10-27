# 0003. Remoção da repescagem de ausentes

- **Status**: Aceito
- **Data**: 2026-10-23

## Contexto

A função `admin_repescagem_ausentes` zerava o contador de faltas de projetos ausentes para que voltassem ao
sorteio. Isso gerava inconsistência com projetos que de fato não estavam no estande.

## Decisão

Remover a repescagem (`20261023_remover_repescagem.sql`). As posições do Bloco 1 passaram a ser **Atribuir Projeto**
e **Excluir uma avaliação**.

## Consequências

- Projetos ausentes não voltam automaticamente. A coordenação usa a atribuição forçada quando necessário.
