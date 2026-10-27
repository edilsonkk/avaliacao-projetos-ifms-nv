# CI/CD, Releases e Deploy

Há dois ambientes: **local** e **produção** ([configuração](../arquitetura/configuracao.md#ambientes)). Produção só
muda quando uma **versão** é publicada. Decisão: [ADR 0009](../decisoes/0009-ambientes-e-releases.md).

```
PR ───────────────► ci.yml (lint, testes, build) · security.yml · supabase-migrations.yml (validação)
merge em main ────► release.yml → release-please abre/atualiza o "PR de release" (versão + CHANGELOG)
merge do PR de    ► release.yml → tag vX.Y.Z + GitHub Release
release               └─► supabase-migrations.yml: backup criptografado + supabase db push
                          └─► deploy-frontend.yml: build da tag + GitHub Pages
manual ───────────► deploy-frontend.yml (rollback para uma tag) · supabase-migrations.yml (dry run)
```

## Workflows

| Workflow | Quando roda | O que faz |
|---|---|---|
| `ci.yml` | PR e push em `main` | `npm ci`, `npm run lint`, `npx vitest run`, `npm run build` |
| `security.yml` | PR, push em `main`, toda segunda 06:00 UTC, manual | CodeQL, Trivy (bloqueia HIGH/CRITICAL), `npm audit --audit-level=high` |
| `release.yml` | Push em `main` | release-please; ao publicar versão, chama migrations e deploy |
| `supabase-migrations.yml` | PR com migrations (validação); chamado pelo release; manual | Validação, backup e `supabase db push` |
| `deploy-frontend.yml` | Chamado pelo release; manual (rollback) | Lint, testes, build da tag e publicação no GitHub Pages |
| `backup-banco.yml` | Manual | Backup criptografado de produção, sem alterar nada (não é bloqueado pelo congelamento) |

## Como uma versão é publicada

1. Cada PR é mergeado em `main` (squash) com título no padrão Conventional Commits. O título define a versão:

   | Commit | Efeito na versão (enquanto `0.x`) | Exemplo |
   |---|---|---|
   | `fix:` | patch: `0.3.0 → 0.3.1` | `fix(sorteio): ignorar canceladas na cota` |
   | `feat:` | minor: `0.3.1 → 0.4.0` | `feat(relatorios): exportar ranking em PDF` |
   | `feat!:` ou `BREAKING CHANGE:` | minor enquanto `0.x`; major a partir de `1.0.0` | `feat!: novo login do avaliador` |
   | `docs:`, `refactor:`, `build:` | entram no CHANGELOG, sem nova versão sozinhos | |
   | `chore:`, `ci:`, `test:`, `style:` | não aparecem no CHANGELOG | |

2. O release-please mantém aberto um PR **"chore: release X.Y.Z"** com a versão calculada, o `CHANGELOG.md` e o
   `package.json` atualizados.
3. Para publicar, revise e faça merge desse PR. O workflow então:
   1. cria a tag `vX.Y.Z` e o GitHub Release;
   2. faz backup do banco e aplica as migrations pendentes;
   3. faz o build da tag e publica o front-end.

   Se as migrations falharem, o front-end **não** é publicado.

As migrations vão antes do front-end, então precisam ser compatíveis com a versão anterior
([expand/contract](../banco-de-dados/migrations.md#compatibilidade-com-a-versão-anterior-expandcontract)).

## Rollback

**Front-end** (cerca de 2 minutos): *Actions → Deploy do Front-end (Produção) → Run workflow* e informe a tag
anterior (ex.: `v0.3.0`). O banco não precisa voltar, porque as migrations são compatíveis com a versão anterior.

**Banco**: não há migrations de reversão. Crie uma nova migration que desfaça o efeito e publique uma versão `fix`.

**Dados**: restaure o backup gerado antes do `db push` (abaixo).

## Backups

Antes de todo `db push` em produção, o workflow gera `supabase db dump` (estrutura e dados), compacta, **criptografa
com AES-256** (senha no secret `BACKUP_PASSPHRASE`) e guarda como artefato do run por **30 dias**. A criptografia é
necessária porque artefatos podem ser baixados por qualquer colaborador do repositório, e o banco tem dados pessoais
(CPF, e-mail, notas).

Para um backup avulso (fim de evento, antes de uma operação arriscada): *Actions → Backup do Banco (Produção)*.

> ⚠️ A confirmar no painel: o plano gratuito do Supabase pode não oferecer backups restauráveis. Não dependa dele;
> ao fim de cada evento, baixe e guarde o backup em local seguro ([cronograma](cronograma-da-feira.md)).

### Restaurar um backup

1. Baixe o artefato `backup-banco-<run_id>` do run desejado (*Actions → run → Artifacts*).
2. Descriptografe e extraia:
   ```bash
   gpg --decrypt backup-<run_id>.tar.gz.gpg > backup.tar.gz   # pede a BACKUP_PASSPHRASE
   tar -xzf backup.tar.gz                                     # gera backup/estrutura.sql e backup/dados.sql
   ```
3. Teste primeiro no banco **local** (`npx supabase@2.122.0 db reset`, depois rode os dois arquivos com `psql`).
4. Em produção, a restauração substitui dados: faça com o sistema parado e só com certeza do que está fazendo.

## Congelamento durante a feira

Com a variável `CONGELAMENTO_DEPLOY = true`, migrations e deploy do front-end **falham de propósito**. Ligue-a no
início da feira e desligue no fim ([cronograma](cronograma-da-feira.md)).

Correção crítica durante a feira: rode o workflow manualmente marcando **emergencia**. O dry run de migrations não
é bloqueado.

## Segredos e variáveis

Ambiente **production** (*Settings → Environments → production*):

| Nome | Tipo | Uso |
|---|---|---|
| `VITE_SUPABASE_URL` | Secret | URL do Supabase de produção no build |
| `VITE_SUPABASE_ANON_KEY` | Secret | Chave pública de produção no build |
| `SUPABASE_ACCESS_TOKEN` | Secret | CLI do Supabase (*Account → Access Tokens*) |
| `SUPABASE_DB_PASSWORD` | Secret | Senha do Postgres de produção |
| `SUPABASE_PROJECT_REF` | Secret | ID do projeto Supabase |
| `BACKUP_PASSPHRASE` | Secret | Senha de criptografia dos backups. **Guarde-a também fora do GitHub**: sem ela o backup é inútil |

Variáveis do repositório (*Settings → Secrets and variables → Actions → Variables*):

| Nome | Uso |
|---|---|
| `APP_URL` | URL pública da aplicação |
| `CONGELAMENTO_DEPLOY` | `true` bloqueia publicações (feira em andamento) |

Nenhum workflow tem valor padrão para esses itens: se faltarem, o job falha com mensagem clara. Nunca versione
tokens, senhas ou a `service_role` key. Se um segredo vazar (inclusive em URL de remote do git), revogue e gere outro.

## Configuração única do repositório (GitHub)

Feita uma vez, por quem administra o repositório:

1. **Proteger a `main`** (*Settings → Branches → Add branch ruleset*, alvo `main`):
   - *Require a pull request before merging* (1 aprovação; *Require review from Code Owners*);
   - *Require status checks to pass*: `Testes Automatizados (Vitest & Linter)` e `Validação Estática das Migrações SQL`;
   - *Block force pushes* e *Restrict deletions*;
   - Sendo o único mantenedor, adicione-se em *Bypass list* para poder aprovar os próprios PRs, ou aceite fazer
     merge sem aprovação de terceiros.
2. **Merge**: em *Settings → General → Pull Requests*, deixe só *Allow squash merging* e use o título do PR como
   mensagem.
3. **Permitir que o release-please abra PRs**: *Settings → Actions → General → Workflow permissions* → marque
   *Allow GitHub Actions to create and approve pull requests*.
4. **Ambiente `production`**: crie em *Settings → Environments* e cadastre os secrets acima.
5. **GitHub Pages**: *Settings → Pages → Source: GitHub Actions*.

## Segurança

- **CodeQL** com `security-extended` e `security-and-quality`.
- **Trivy** varre o repositório e envia SARIF para *Security → Code scanning*; falha em HIGH ou CRITICAL.
- **npm audit** falha em vulnerabilidade `high` ou maior.
- A execução semanal pega vulnerabilidades novas mesmo sem commits.

## Migrations do banco

CLI do Supabase fixada na versão `2.122.0` (`SUPABASE_CLI_VERSION`).

1. **Validação** (sempre, inclusive em PR): nomes `AAAAMMDDHHMMSS_descricao.sql` com versões únicas; sem `DELETE`
   sem `WHERE`, `TRUNCATE` ou `CREATE INDEX CONCURRENTLY`.
2. **Aplicação** (publicação de versão ou manual com `dry_run = false`): `link`, `migration list`, backup,
   `db push`, `migration list`.
3. Uma aplicação de cada vez, nunca cancelada no meio.

Guia: [migrations](../banco-de-dados/migrations.md).
