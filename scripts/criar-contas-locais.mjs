#!/usr/bin/env node
/**
 * criar-contas-locais.mjs — recria as contas de Admin e Staff no Supabase LOCAL.
 *
 * Todo `db reset` leva `auth.users` e `usuarios` a zero, e o `seed.sql` não cria conta
 * nenhuma (credencial não entra em arquivo versionado). Sem isto, o primeiro
 * `signInWithPassword` de qualquer rodada falha.
 *
 * Uso:
 *   npm run local:reset              # db reset + este script
 *   node scripts/criar-contas-locais.mjs
 *
 * Credenciais (NUNCA no código, doc ou commit — regra 9 do AGENTS.md):
 *   SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD
 *   SUPABASE_STAFF_EMAIL / SUPABASE_STAFF_PASSWORD
 *     (ou SUPABASE_STAFF_EMAILS / SUPABASE_STAFF_PASSWORDS, listas por vírgula)
 *   Em `.env.simulacao.local` (coberto por `.env.*` no .gitignore) ou no ambiente.
 *   A saída imprime só e-mail e o que aconteceu. Senha nunca é impressa nem trocada.
 *
 * A lógica vive em scripts/lib/contas-locais.mjs, que `semear-simulacao.mjs` e
 * `simular-feira.mjs` também chamam na partida — uma implementação só. Este arquivo é
 * o modo detalhado dela, para quando você quer ver passo a passo.
 */
import { garantirContasLocais } from './lib/contas-locais.mjs'

const url = process.env.VITE_SUPABASE_URL
if (url) console.log(`Supabase local: ${url}`)
console.log('')
await garantirContasLocais({ detalhado: true }).catch((erro) => {
  console.error(`\n${erro.message}`)
  process.exit(1)
})
console.log('')
console.log('Pronto. Próximo passo: npm run local:semear')
