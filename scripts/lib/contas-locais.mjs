/**
 * contas-locais.mjs — garante que o Admin e o Staff existem no Supabase LOCAL.
 *
 * Implementação única, usada por três chamadores:
 *   - scripts/criar-contas-locais.mjs  (CLI, modo detalhado)
 *   - scripts/semear-simulacao.mjs     (na partida, modo silencioso)
 *   - scripts/simular-feira.mjs        (na partida, modo silencioso)
 *
 * Por que existe: `supabase/seed.sql` não cria conta nenhuma — e não deve, porque
 * credencial não entra em arquivo versionado. Todo `db reset` leva `auth.users` e
 * `usuarios` a zero (medido), então sem este passo o primeiro `signInWithPassword` de
 * qualquer rodada falha.
 *
 * Caminho usado, igual ao da aplicação (docs/arquitetura/configuracao.md):
 *   - conta de autenticação: `signUp` com a CHAVE ANÔNIMA, como a tela de cadastro;
 *   - perfil do Staff: `admin_salvar_staff(NULL, …)` numa sessão de Admin, que é o
 *     Gestor de Staff, e `fn_vincular_conta_staff()` na sessão do próprio staff, que é
 *     o que acontece no primeiro login dele.
 *
 * A ÚNICA escrita fora do caminho da aplicação é a linha de `usuarios` do Admin com
 * `papel = 'ADMIN'`, e só quando ela falta. Não existe RPC que promova alguém a Admin,
 * e não deve existir — seria escalada de privilégio exposta na API. A doc manda fazer
 * pelo SQL Editor; aqui sai pela chave de serviço, que só existe no ambiente local.
 *
 * Idempotente e com atalho: se o Admin já entra e `fn_meu_perfil` devolve `admin`, e se
 * o Staff já tem perfil vinculado, nada é escrito e a chave de serviço nem é buscada.
 * Senha de conta existente NUNCA é trocada, e senha nunca é impressa.
 */
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const ARQUIVOS_ENV = ['../../.env', '../../.env.simulacao.local']
const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1'])
const ARQUIVO_CREDENCIAIS = '.env.simulacao.local'

/** Variáveis já definidas no ambiente têm precedência sobre o arquivo. */
export function carregarEnv() {
  for (const relativo of ARQUIVOS_ENV) {
    const arquivo = new URL(relativo, import.meta.url)
    if (existsSync(arquivo)) process.loadEnvFile(arquivo)
  }
}

function papelDaChave(chave) {
  const partes = chave.split('.')
  if (partes.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')).role ?? null
  } catch {
    return null
  }
}

/** Guarda de ambiente: roda ANTES de qualquer escrita. */
export function exigirSupabaseLocal() {
  const url = process.env.VITE_SUPABASE_URL
  const chaveAnonima = process.env.VITE_SUPABASE_ANON_KEY
  if (!url) {
    throw new Error(
      'VITE_SUPABASE_URL não definida — defina-a em `.env` (copie de `.env.example`).\n' +
      'Estes scripts só rodam contra o Supabase local.',
    )
  }
  if (!chaveAnonima) {
    throw new Error('VITE_SUPABASE_ANON_KEY não definida — defina-a em `.env` (veja `npx supabase@2.122.0 status`).')
  }
  let host
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`VITE_SUPABASE_URL não é uma URL válida: ${url}`)
  }
  if (!HOSTS_LOCAIS.has(host)) {
    throw new Error(
      `RECUSADO: VITE_SUPABASE_URL aponta para "${host}", que não é local.\n` +
      'Este passo cria contas e só pode rodar contra 127.0.0.1 ou localhost. Nada foi escrito.',
    )
  }
  if (papelDaChave(chaveAnonima) === 'service_role') {
    throw new Error('RECUSADO: VITE_SUPABASE_ANON_KEY é uma chave de service_role.')
  }
  return { url, chaveAnonima }
}

/**
 * Credenciais só do ambiente (regra 9 do AGENTS.md). A mensagem diz exatamente o que
 * falta e em qual arquivo definir: nada é inventado nem gerado em silêncio.
 */
export function exigirCredenciais() {
  const lista = (valor) => (valor ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const admin = {
    email: (process.env.SUPABASE_ADMIN_EMAIL ?? '').trim().toLowerCase(),
    senha: process.env.SUPABASE_ADMIN_PASSWORD ?? '',
  }
  const emails = lista(process.env.SUPABASE_STAFF_EMAILS ?? process.env.SUPABASE_STAFF_EMAIL)
  const senhas = lista(process.env.SUPABASE_STAFF_PASSWORDS ?? process.env.SUPABASE_STAFF_PASSWORD)

  const faltando = []
  if (!admin.email) faltando.push('SUPABASE_ADMIN_EMAIL')
  if (!admin.senha) faltando.push('SUPABASE_ADMIN_PASSWORD')
  if (emails.length === 0) faltando.push('SUPABASE_STAFF_EMAIL (ou SUPABASE_STAFF_EMAILS, lista por vírgula)')
  if (senhas.length === 0) faltando.push('SUPABASE_STAFF_PASSWORD (ou SUPABASE_STAFF_PASSWORDS, lista por vírgula)')
  if (faltando.length > 0) {
    throw new Error(
      `Faltam credenciais para garantir as contas locais:\n` +
      faltando.map((nome) => `  - ${nome}`).join('\n') + '\n' +
      `Defina-as em \`${ARQUIVO_CREDENCIAIS}\` (o .gitignore cobre \`.env.*\`) ou no ambiente.\n` +
      'Escolha você a senha: nenhuma conta é criada com senha gerada sem o seu conhecimento.\n' +
      'Nunca escreva senha no script, na doc ou no commit (regra 9 do AGENTS.md).',
    )
  }
  return {
    admin,
    staff: emails.map((email, indice) => ({
      email: email.toLowerCase(),
      senha: senhas[indice] ?? senhas[0],
      nome: emails.length === 1 ? 'Staff (local)' : `Staff ${indice + 1} (local)`,
    })),
  }
}

const anonimo = ({ url, chaveAnonima }) => createClient(url, chaveAnonima, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Só para a linha de `usuarios` do Admin, e só quando ela falta. */
function obterChaveDeServico() {
  const doAmbiente = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
  if (doAmbiente) return doAmbiente
  let saida
  try {
    saida = execFileSync('npx', ['supabase@2.122.0', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: new URL('../..', import.meta.url),
    })
  } catch {
    throw new Error(
      'Não consegui ler a chave do Supabase local. Suba a stack (npx supabase@2.122.0 start) ' +
      'ou exporte SUPABASE_SERVICE_ROLE_KEY.',
    )
  }
  const achado = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(saida)
  if (!achado) throw new Error('SERVICE_ROLE_KEY ausente na saída de `supabase status`.')
  return achado[1]
}

/**
 * Cria a conta de autenticação pela chave anônima. Conta existente é reaproveitada: a
 * senha não é trocada, e se a senha do ambiente não entrar nela o passo para e explica.
 */
async function garantirConta(ctx, email, senha) {
  const sb = anonimo(ctx)
  const cadastro = await sb.auth.signUp({ email, password: senha })
  if (!cadastro.error && cadastro.data?.user?.id) {
    await sb.auth.signOut()
    return { authUid: cadastro.data.user.id, criada: true }
  }
  const jaExiste = /already registered|already been registered|User already/i.test(cadastro.error?.message ?? '')
  if (!jaExiste && cadastro.error) throw new Error(`signUp de ${email} falhou: ${cadastro.error.message}`)

  const login = await sb.auth.signInWithPassword({ email, password: senha })
  if (login.error) {
    throw new Error(
      `A conta ${email} já existe, mas a senha do ambiente não entra nela: ${login.error.message}\n` +
      `Ajuste a variável em \`${ARQUIVO_CREDENCIAIS}\` ou apague a conta no Studio. ` +
      'Este passo nunca troca senha de conta existente.',
    )
  }
  const uid = login.data.user.id
  await sb.auth.signOut()
  return { authUid: uid, criada: false }
}

/**
 * Garante Admin e Staff. Devolve o que fez, para o chamador resumir numa linha.
 * `detalhado` imprime passo a passo (uso de CLI); o padrão não imprime nada.
 */
export async function garantirContasLocais({ detalhado = false } = {}) {
  carregarEnv()
  const ctx = exigirSupabaseLocal()
  const { admin, staff } = exigirCredenciais()
  const diga = (texto) => { if (detalhado) console.log(texto) }

  const relato = { adminCriado: false, perfilAdminCriado: false, staffCriados: 0, staffVinculados: 0, staff: staff.length }

  // ---------------------------------------------------------------- atalho
  // Se o Admin já entra e o banco já o reconhece, nada falta nele — e a chave de
  // serviço nem precisa ser buscada (o `npx supabase status` custa segundos).
  let sessaoAdmin = anonimo(ctx)
  let loginAdmin = await sessaoAdmin.auth.signInWithPassword({ email: admin.email, password: admin.senha })
  let perfilAdmin = loginAdmin.error ? null : (await sessaoAdmin.rpc('fn_meu_perfil')).data?.papel ?? null

  if (perfilAdmin !== 'admin') {
    const conta = await garantirConta(ctx, admin.email, admin.senha)
    relato.adminCriado = conta.criada
    diga(`ADMIN  ${admin.email}`)
    diga(`  conta de autenticação: ${conta.criada ? 'criada' : 'já existia (senha intacta)'}`)

    const servico = createClient(ctx.url, obterChaveDeServico(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const existente = await servico
      .from('usuarios')
      .select('id_usuario, papel, id_auth')
      .eq('email', admin.email)
      .maybeSingle()
    if (existente.error) throw new Error(`Falha ao ler usuarios: ${existente.error.message}`)
    if (existente.data && String(existente.data.papel).toUpperCase() !== 'ADMIN') {
      throw new Error(
        `RECUSADO: ${admin.email} já existe em usuarios com papel "${existente.data.papel}". ` +
        'Não vou promovê-lo a ADMIN por conta própria.',
      )
    }
    const perfil = await servico
      .from('usuarios')
      .upsert({ email: admin.email, nome: 'Coordenação (local)', papel: 'ADMIN', id_auth: conta.authUid },
        { onConflict: 'email' })
      .select('id_usuario')
      .single()
    if (perfil.error) throw new Error(`Falha ao gravar o perfil do Admin: ${perfil.error.message}`)
    relato.perfilAdminCriado = !existente.data
    diga(`  perfil em usuarios: ${existente.data ? 'reaproveitado' : 'criado'} com papel ADMIN`)

    sessaoAdmin = anonimo(ctx)
    loginAdmin = await sessaoAdmin.auth.signInWithPassword({ email: admin.email, password: admin.senha })
    if (loginAdmin.error) throw new Error(`Login do Admin falhou: ${loginAdmin.error.message}`)
    perfilAdmin = (await sessaoAdmin.rpc('fn_meu_perfil')).data?.papel ?? null
    if (perfilAdmin !== 'admin') {
      throw new Error(`fn_meu_perfil devolveu "${perfilAdmin ?? 'nenhum'}" para ${admin.email}, não "admin".`)
    }
  }
  diga(`ADMIN  ${admin.email}: pronto (fn_meu_perfil devolve admin)`)

  // ----------------------------------------------------------------- staff
  // O Admin consegue ler `usuarios` (rls_usuarios_leitura): dá para saber quem falta
  // sem abrir uma sessão por staff, o que pouparia logins do limite de 30/5min.
  const perfis = await sessaoAdmin
    .from('usuarios')
    .select('email, papel, id_auth')
    .in('email', staff.map((conta) => conta.email))
  if (perfis.error) throw new Error(`Falha ao ler os perfis de staff: ${perfis.error.message}`)
  const porEmail = new Map((perfis.data ?? []).map((linha) => [String(linha.email).toLowerCase(), linha]))

  const pendentes = staff.filter((conta) => {
    const linha = porEmail.get(conta.email)
    return !linha || String(linha.papel).toUpperCase() !== 'STAFF' || !linha.id_auth
  })

  if (pendentes.length > 0) {
    const itens = pendentes.map(({ email, nome }) => ({ nome, email, papel: 'STAFF' }))
    const salvo = await sessaoAdmin.rpc('admin_salvar_staff', { p_id_evento: null, p_itens: itens })
    if (salvo.error) throw new Error(`admin_salvar_staff falhou: ${salvo.error.message}`)
    diga('STAFF  admin_salvar_staff(NULL, …) — o Gestor de Staff:')
    diga(`  ${salvo.data?.cadastrados ?? 0} cadastrado(s), ${salvo.data?.atualizados ?? 0} atualizado(s), ` +
      `${(salvo.data?.ignorados ?? []).length} ignorado(s)`)
    for (const ignorado of salvo.data?.ignorados ?? []) {
      diga(`  ignorado: ${ignorado.email} — ${ignorado.motivo}`)
    }

    for (const conta of pendentes) {
      const contaStaff = await garantirConta(ctx, conta.email, conta.senha)
      if (contaStaff.criada) relato.staffCriados += 1
      const sessaoStaff = anonimo(ctx)
      const login = await sessaoStaff.auth.signInWithPassword({ email: conta.email, password: conta.senha })
      if (login.error) throw new Error(`Login do Staff ${conta.email} falhou: ${login.error.message}`)
      const vinculo = await sessaoStaff.rpc('fn_vincular_conta_staff')
      if (vinculo.error) throw new Error(`fn_vincular_conta_staff falhou para ${conta.email}: ${vinculo.error.message}`)
      const perfilStaff = (await sessaoStaff.rpc('fn_meu_perfil')).data?.papel ?? null
      await sessaoStaff.auth.signOut()
      if (perfilStaff !== 'staff') {
        throw new Error(`fn_meu_perfil devolveu "${perfilStaff ?? 'nenhum'}" para ${conta.email}, não "staff".`)
      }
      relato.staffVinculados += 1
      diga(`  ${conta.email}`)
      diga(`    conta de autenticação: ${contaStaff.criada ? 'criada' : 'já existia (senha intacta)'}`)
      diga('    fn_vincular_conta_staff: ok, fn_meu_perfil devolve: staff')
    }
  } else {
    diga(`STAFF  ${staff.length} conta(s): pronta(s) (perfil vinculado)`)
  }

  await sessaoAdmin.auth.signOut()
  return relato
}

/** Uma linha, para a partida dos outros scripts. Silenciosa no sentido de curta. */
export function resumirContas(relato) {
  const mexeu = []
  if (relato.adminCriado || relato.perfilAdminCriado) mexeu.push('Admin criado')
  if (relato.staffCriados > 0) mexeu.push(`${relato.staffCriados} staff criado(s)`)
  else if (relato.staffVinculados > 0) mexeu.push(`${relato.staffVinculados} staff vinculado(s)`)
  return mexeu.length === 0
    ? `contas locais: ok (Admin e ${relato.staff} staff já prontos)`
    : `contas locais: ${mexeu.join(', ')}`
}
