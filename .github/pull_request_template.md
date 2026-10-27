## O que muda

<!-- Descreva a mudança e o motivo. Referencie a issue: Closes #123 -->

## Tipo

- [ ] Funcionalidade
- [ ] Correção
- [ ] Refatoração
- [ ] Banco de dados (migration)
- [ ] Documentação / CI

## Como testar

<!-- Passos para validar manualmente, se aplicável. -->

## Checklist

- [ ] `npm run lint`, `npm test` e `npm run build` passam localmente
- [ ] Testes adicionados/atualizados para o código novo ou alterado
- [ ] Nenhum UUID exibido na interface; dados filtrados pelo evento ativo
- [ ] Escritas administrativas usam `garantirSessaoAdmin()` / `tratarErroEscritaAdmin()`
- [ ] Sem `DELETE` sem filtro ou `TRUNCATE`
- [ ] Documentação do domínio atualizada em `docs/` (e ADR, se for decisão de arquitetura)

### Se houver migration

- [ ] Nome com timestamp de 14 dígitos, idempotente, com RLS/GRANT definidos
- [ ] `supabase/schema.sql` atualizado
- [ ] Forma de aplicação descrita e status informado (aplicada / pendente)
