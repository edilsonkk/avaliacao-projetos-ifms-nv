# AGENTS.md

Guia para agentes de IA (Claude Code, Antigravity, Codex etc.) que trabalham neste repositório. Humanos: leiam o
[CONTRIBUTING](CONTRIBUTING.md).

## Projeto

SPA React 19 + Vite + Tailwind 4 + TypeScript sobre Supabase/PostgreSQL, usada em feiras científicas do IFMS
(credenciamento, sorteio de avaliações, notas, quarentena, relatórios). Interface, código e documentação em
**português**.

## Comandos

```bash
npm install          # dependências (.npmrc usa legacy-peer-deps)
npm run dev          # http://localhost:3000
npm run lint         # tsc --noEmit
npm test             # vitest run (todos os testes)
npx vitest run <caminho>   # um arquivo de teste
npm run build        # build de produção
```

Antes de dar uma tarefa como concluída: `npm run lint`, `npm test` e `npm run build` precisam passar.

## Onde está cada coisa

- `src/app/`: entrypoint e roteamento entre telas.
- `src/features/<feature>/`: `components/`, `__tests__/`, `index.ts` (API pública).
- `src/components/`: componentes compartilhados.
- `src/lib/`: Supabase, sessão do Admin, Excel e parsers puros.
- `supabase/migrations/`: fonte da verdade do banco.
- `docs/`: documentação. Comece por [`docs/README.md`](docs/README.md), que mapeia cada assunto para um arquivo.

Antes de mudar uma regra de negócio, leia o arquivo correspondente em `docs/regras-de-negocio/`.

## Regras invioláveis

1. **Imports**: use o alias `@/`. Entre features, importe só pelo `index.ts` (`@/features/projetos`). Detalhes em
   [frontend](docs/arquitetura/frontend.md).
2. **Testes (TDD)**: siga [`.agents/rules/TESTES_TDD.md`](.agents/rules/TESTES_TDD.md). Use seletores acessíveis e
   nunca classes Tailwind; padrão AAA; `vi.mock('@/lib/supabase')`; nada de rede real.
3. **Segurança no banco**: permissões e validações críticas ficam na RLS e em funções (ver
   [segurança](docs/arquitetura/seguranca.md)). Nunca confie só no front-end. Notas só via `fn_enviar_avaliacao`.
4. **Escritas do Admin**: chame `garantirSessaoAdmin()` antes e trate erros com `tratarErroEscritaAdmin()`.
5. **Escopo por evento**: toda leitura/escrita de dados do evento filtra por `id_evento`.
6. **Nunca exiba UUIDs** na interface; use `codigo_projeto`.
7. **SQL**: nunca use `DELETE` sem `WHERE` nem `TRUNCATE`. Migrations novas devem ser idempotentes, com timestamp
   de 14 dígitos e RLS/GRANT definidos ([migrations](docs/banco-de-dados/migrations.md)).
8. **Importações**: um único batch upsert; nunca grave linha a linha.
9. **Segredos**: nunca escreva chaves, tokens ou senhas em código, docs ou commits.
10. **Documentação**: ao mudar comportamento, atualize a doc do domínio no mesmo commit/PR. Decisões de
    arquitetura viram ADR em `docs/decisoes/`.

## Armadilhas conhecidas

- Erro `PGRST204` / "schema cache": ver [troubleshooting](docs/operacao/troubleshooting.md).
- Consultas `anon` com `select('*')` em `usuarios`/`avaliacoes` falham: projete colunas.
- `projetos` não tem colunas textuais `modalidade`, `area_conhecimento`, `nome_instituicao`: use os relacionamentos.
- `sortear_proximo_projeto` e `sortear_projeto` precisam ficar em sincronia.
- `supabase/schema.sql` está defasado em relação às migrations `20261026*`. As migrations prevalecem.
- Vários componentes são muito grandes (2–3 mil linhas). Leia por trechos e prefira extrair hooks/subcomponentes
  a aumentar o arquivo.

## Git

- Branches: `feat/...`, `fix/...`, `refactor/...`, `docs/...` a partir de `main`.
- Commits no padrão Conventional Commits em português, ex.: `feat(avaliacao): ...`.
- Não faça commit, push ou merge sem pedido explícito.
