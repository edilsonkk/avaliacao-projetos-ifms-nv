# CI/CD e Deploy

Workflows em `.github/workflows/`.

| Workflow | Quando roda | O que faz |
|---|---|---|
| `ci.yml` | `push` e `pull_request` em `main`/`master` | `npm ci`, `npm run lint` (tsc), `npx vitest run`, `npm run build` |
| `deploy-frontend.yml` | `push`/`pull_request` em `main`/`master`, manual | Lint, testes e build; em `push`, publica `dist/` no GitHub Pages |
| `security.yml` | `push`, `pull_request`, toda segunda 06:00 UTC, manual | CodeQL (SAST), Trivy (SCA, bloqueia HIGH/CRITICAL) e `npm audit --audit-level=high` |
| `supabase-migrations.yml` | Mudanças em `supabase/migrations/**` ou `supabase/schema.sql`, manual | Validação estática do SQL; em `push`, `supabase link` + `supabase db push` |

## Front-end

1. Gates: `tsc --noEmit`, todos os testes Vitest e build de produção.
2. `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` vêm dos secrets do ambiente.
3. `dist/` é publicado com `actions/deploy-pages@v4`. Em pull requests, só build (sem deploy).

> ⚠️ O workflow tem valores padrão (fallback) para URL e anon key escritos no YAML, usados se os secrets não
> existirem. O recomendado é configurar os secrets e remover os fallbacks.

## Segurança

- **CodeQL** com `security-extended` e `security-and-quality`.
- **Trivy** varre o repositório e envia SARIF para *Security → Code scanning*. Falha em vulnerabilidade HIGH ou
  CRITICAL.
- **npm audit** falha em vulnerabilidade `high` ou maior.
- A execução semanal pega vulnerabilidades novas mesmo sem commits.

## Migrations do banco

1. **Validação** (sempre): lista os arquivos e falha se encontrar `DELETE FROM x;` sem `WHERE` ou `TRUNCATE`.
2. **Aplicação** (em `push`, ou manual com `dry_run = false`): `supabase link --project-ref` e `supabase db push`.
   Concorrência serializada (`cancel-in-progress: false`).

> ⚠️ Ver o aviso em [migrations](../banco-de-dados/migrations.md#como-aplicar): as migrations recentes são aplicadas
> manualmente pelo SQL Editor, e a nomeação antiga (prefixo só com a data) não é compatível com `supabase db push`.
> Confirme o estado do job antes de confiar nele.

## Segredos

*Settings → Secrets and variables → Actions*:

| Nome | Tipo | Uso |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Secret | CLI do Supabase |
| `SUPABASE_DB_PASSWORD` | Secret | `supabase link` / `db push` |
| `SUPABASE_PROJECT_REF` | Secret | ID do projeto Supabase |
| `VITE_SUPABASE_URL` | Secret | URL do Supabase no build |
| `VITE_SUPABASE_ANON_KEY` | Secret | Anon key no build |
| `APP_URL` | Variable | URL pública da aplicação |

Nunca versione tokens, senhas ou a `service_role` key. Se um segredo vazar (inclusive em URL de remote do git),
revogue e gere outro.

## Releases e rollback

- Versionamento semântico (`vMAJOR.MINOR.PATCH`) por tags Git. **Hoje nenhuma tag existe e nenhum workflow é
  disparado por tag**; o deploy acontece a cada push em `main`.
- **Rollback do front-end**: reexecutar o deploy de um commit estável (*Actions → deploy-frontend → Re-run*) ou
  reverter o commit em `main` (`git revert`).
- **Rollback do banco**: não há migrations de reversão. Crie uma nova migration que desfaça a mudança
  ([migrations](../banco-de-dados/migrations.md#rollback)).
