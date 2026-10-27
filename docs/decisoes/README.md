# Registros de Decisão de Arquitetura (ADRs)

Um ADR registra **por que** uma decisão importante foi tomada: contexto, decisão e consequências. Assim quem chega
depois não desfaz a decisão sem entender o motivo.

## Quando escrever

- Mudança de arquitetura, de modelo de dados ou de segurança.
- Remoção ou mudança de uma regra de negócio.
- Escolha entre alternativas com trade-offs reais.

Correções de bug e ajustes visuais não precisam de ADR: o commit e a doc do domínio bastam.

## Como escrever

1. Copie `0000-modelo.md` para `NNNN-titulo-curto.md` (próximo número).
2. Preencha e abra o PR junto com a mudança.
3. ADRs aceitos não são editados. Se a decisão mudar, crie um novo ADR com status "Substitui NNNN" e marque o antigo
   como "Substituído por NNNN".

## Índice

| # | Decisão | Status |
|---|---|---|
| [0001](0001-logica-critica-no-banco.md) | Lógica crítica no banco (front-end fino) | Aceito |
| [0002](0002-chave-natural-e-uuid-oculto.md) | Upsert por chave natural e UUID oculto na interface | Aceito |
| [0003](0003-remocao-da-repescagem.md) | Remoção da repescagem de ausentes | Aceito |
| [0004](0004-soft-delete-de-avaliacoes-via-rpc.md) | Soft delete de avaliações via RPC | Aceito |
| [0005](0005-sorteio-nao-repete-avaliador.md) | Sorteio nunca repete o par projeto/avaliador | Aceito |
| [0006](0006-rls-escrita-restrita-a-admin.md) | RLS com escrita administrativa restrita ao Admin | Aceito |
| [0007](0007-gravacao-de-notas-via-rpc.md) | Gravação de notas só via `fn_enviar_avaliacao` | Aceito |
| [0008](0008-frontend-organizado-por-features.md) | Front-end organizado por features | Aceito |
| [0009](0009-ambientes-e-releases.md) | Ambientes local e produção, com releases versionadas | Aceito |
| [0010](0010-hospedagem-firebase.md) | Front-end no Firebase Hosting; backend continua no Supabase | Aceito |
