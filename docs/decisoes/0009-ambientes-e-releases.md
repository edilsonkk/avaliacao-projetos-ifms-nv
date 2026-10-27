# 0009. Ambientes local e produção, com releases versionadas

- **Status**: Aceito
- **Data**: 2026-10-27

## Contexto

O projeto vai passar a ter vários contribuidores. Até aqui, cada push em `main` publicava o front-end, migrations
eram coladas à mão no SQL Editor, e o código tinha a URL e a chave de produção como valor padrão. A restrição é
usar o plano gratuito do Supabase, que permite dois projetos; o segundo fica reservado para outra aplicação.

## Decisão

- **Dois ambientes**: local (Supabase em Docker) e produção. Sem homologação.
- **Sem valores padrão** de configuração por ambiente: sem `.env`, a aplicação mostra a tela de configuração
  ausente; no CI, o job falha se faltar um secret.
- **Produção só muda por versão**: o release-please calcula a versão pelos Conventional Commits e mantém um PR de
  release. O merge desse PR cria a tag e publica: backup criptografado, `supabase db push` e front-end, nessa ordem.
- **Migrations compatíveis com a versão anterior** (expand/contract), para que o rollback do front-end nunca exija
  desfazer o banco.
- **Rollback do front-end** por reexecução do deploy com uma tag anterior.
- **Congelamento** durante a feira por variável do repositório, com exceção explícita para emergências.

## Consequências

- Sem homologação, a validação antes da produção depende de testes automatizados, `db reset` local e revisão do PR
  de release. Mudanças arriscadas devem ser testadas localmente com dados parecidos com os reais.
- Desenvolvedores precisam de Docker para rodar o banco local.
- O título do PR (squash) passa a determinar a versão; títulos fora do padrão não geram release.
- Os backups ficam 30 dias como artefato; o backup de fim de evento precisa ser guardado fora do GitHub.

## Alternativas consideradas

- **Homologação em um segundo projeto Supabase**: descartada pelo limite do plano gratuito.
- **Supabase Branching**: exige plano pago.
