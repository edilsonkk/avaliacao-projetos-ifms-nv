# Como Contribuir

Obrigado por contribuir com o Sistema de Avaliação de Projetos IFMS. Este guia descreve o fluxo de trabalho. A
documentação técnica está em [`docs/`](docs/README.md).

## Ambiente

Pré-requisitos: Node.js 20+ e Docker em execução. O desenvolvimento usa **sempre** o Supabase local; nunca aponte o
`.env` para produção.

```bash
npm install
npx supabase@2.122.0 start     # banco local com migrations e seed
cp .env.example .env           # cole a chave exibida por `npx supabase@2.122.0 status`
npm run dev                    # http://localhost:3000
```

Guia completo: [configuração](docs/arquitetura/configuracao.md#desenvolvimento-local).

## Fluxo de trabalho

1. Abra (ou escolha) uma issue descrevendo o problema ou a feature.
2. Crie uma branch a partir de `main`:

   | Tipo | Prefixo | Exemplo |
   |---|---|---|
   | Funcionalidade | `feat/` | `feat/exportar-ranking-pdf` |
   | Correção | `fix/` | `fix/cota-ignora-canceladas` |
   | Refatoração | `refactor/` | `refactor/extrair-hook-projetos` |
   | Documentação | `docs/` | `docs/regras-de-cota` |
   | Banco de dados | `db/` | `db/indice-avaliacoes-evento` |

3. Escreva o teste primeiro (TDD) e depois o código. Ver
   [`.agents/rules/TESTES_TDD.md`](.agents/rules/TESTES_TDD.md).
4. Faça commits pequenos no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em português:
   ```
   feat(avaliacao): bloquear envio fora da janela do evento
   fix(sorteio): ignorar avaliacoes canceladas na cota
   docs(regras): documentar bloqueio por modalidade
   ```
   Escopos comuns: o nome da feature (`admin`, `avaliacao`, `projetos`…), `db`, `rls`, `ci`, `docs`.
5. Rode localmente antes de abrir o PR:
   ```bash
   npm run lint && npm test && npm run build
   ```
6. Abra o Pull Request para `main` e preencha o template. O CI precisa passar e o PR precisa de aprovação do code
   owner (`.github/CODEOWNERS`).
7. Faça merge com **squash** (ou marque o PR com `gh pr merge <n> --auto --squash --delete-branch` para mergear
   sozinho quando os checks passarem; nunca use auto-merge no PR de release). O **título do PR** vira o commit em `main` e define a próxima versão (`fix:` → patch,
   `feat:` → minor), então ele precisa seguir o padrão.

## Publicar uma versão

O merge em `main` **não** publica nada. O release-please mantém um PR "chore: release X.Y.Z" com o CHANGELOG; o
merge dele publica a versão em produção (backup, migrations, front-end). Rollback, congelamento durante a feira e
backups: [CI/CD e deploy](docs/operacao/ci-cd-e-deploy.md).

## Onde colocar o código

Siga [docs/arquitetura/frontend.md](docs/arquitetura/frontend.md). Resumo:

- Tela ou módulo de um domínio vai em `src/features/<feature>/components/`, exportado no `index.ts` da feature.
- Componente usado por mais de uma feature vai em `src/components/`.
- Lógica pura (sem React) vai em `src/lib/`, com teste em `__tests__/` ao lado.
- Mudança de banco vai numa nova migration em `supabase/migrations/`
  ([guia](docs/banco-de-dados/migrations.md)).

## Definition of Done

Uma tarefa está pronta quando:

- [ ] `npm run lint`, `npm test` e `npm run build` passam.
- [ ] Há testes para todo código novo ou alterado.
- [ ] Nenhum UUID é exibido na interface.
- [ ] Consultas e escritas filtram pelo evento ativo.
- [ ] Escritas administrativas usam `garantirSessaoAdmin()`/`tratarErroEscritaAdmin()`.
- [ ] Nenhum `DELETE` sem filtro ou `TRUNCATE` foi introduzido.
- [ ] Alterações de dados atualizam a tela sem F5.
- [ ] Colunas novas têm fallback para schema cache ou a migration recarrega o cache.
- [ ] Importações usam batch upsert e o botão padrão `Importar (.xls/.xlsx/.csv)`.
- [ ] Modais administrativos novos seguem o [layout canônico](docs/arquitetura/padroes.md#layout-canônico-dos-modais-de-gestão).
- [ ] A documentação do domínio afetado foi atualizada; decisões de arquitetura têm ADR.
- [ ] Migrations seguem o [guia](docs/banco-de-dados/migrations.md), têm RLS/GRANT definidos e `schema.sql` atualizado. A aplicação é feita pelo `db push` no merge.

## Revisão de código

Ao revisar, verifique:

- O comportamento corresponde à doc em `docs/regras-de-negocio/`?
- A regra de segurança está no banco, e não só na interface?
- Os testes cobrem sucesso, erro e casos de borda?
- O código fica na feature certa e respeita as regras de import?

## Segurança

Não abra issue pública para vulnerabilidades. Fale diretamente com o mantenedor. Nunca versione credenciais. Se uma
vazar, avise e revogue imediatamente.
