# CI/CD e Deploy

Workflows em `.github/workflows/`.

| Workflow | Quando roda | O que faz |
|---|---|---|
| `ci.yml` | `push` e `pull_request` em `main`/`master` | `npm ci`, `npm run lint` (tsc), `npx vitest run`, `npm run build` |
| `deploy-frontend.yml` | `push`/`pull_request` em `main`/`master`, manual | Lint, testes e build; em `push`, publica `dist/` no GitHub Pages |
| `security.yml` | `push`, `pull_request`, toda segunda 06:00 UTC, manual | CodeQL (SAST), Trivy (SCA, bloqueia HIGH/CRITICAL) e `npm audit --audit-level=high` |
| `supabase-migrations.yml` | Mudanças em `supabase/migrations/**` ou `supabase/config.toml`, manual | Validação estática; em `push` (ou manual), `supabase db push` |

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

CLI do Supabase fixada na versão `2.122.0` (variável `SUPABASE_CLI_VERSION` do workflow).

1. **Validação** (sempre, inclusive em PR): nomes no padrão `AAAAMMDDHHMMSS_descricao.sql` com versões únicas;
   sem `DELETE` sem `WHERE`, `TRUNCATE` ou `CREATE INDEX CONCURRENTLY`.
2. **Aplicação** (push em `main`, ou manual): `supabase link`, `migration list` (antes), `db push` e `migration list`
   (depois, para conferir). Execução manual com `dry_run = true` (padrão) roda só `db push --dry-run`.
3. Uma aplicação por ambiente de cada vez, nunca cancelada no meio.
4. A aplicação só roda com a variável `SUPABASE_DB_PUSH_ENABLED = true`. Antes de ligá-la, faça a
   [transição única](../banco-de-dados/migrations.md#transição-para-supabase-db-push).
5. Os secrets `SUPABASE_*` são obrigatórios; sem eles o job falha (não há valor padrão).

## Segredos

*Settings → Secrets and variables → Actions*:

| Nome | Tipo | Uso |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Secret | CLI do Supabase |
| `SUPABASE_DB_PASSWORD` | Secret | `supabase link` / `db push` |
| `SUPABASE_PROJECT_REF` | Secret | ID do projeto Supabase |
| `SUPABASE_DB_PUSH_ENABLED` | Variable | `true` libera o `db push` (depois da transição) |
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
