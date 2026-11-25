#!/usr/bin/env node
/**
 * simular-feira.mjs — simulador de uso CONCORRENTE contra o Supabase LOCAL, no
 * evento criado por scripts/semear-simulacao.mjs.
 *
 * Por que existe: os testes Vitest trocam o cliente por `vi.mock('@/lib/supabase')`
 * e os testes pgTAP rodam numa sessão única. Nenhum dos dois exercita concorrência
 * real nem o supabase-js de verdade — é essa lacuna que este script fecha.
 *
 * Uso:
 *   node scripts/simular-feira.mjs --avaliadores=10 --staff=2 --telao=1 --ate-concluir --questionarios=misto
 *   node scripts/simular-feira.mjs            # 120 avaliadores, 10 staff, 2 telões
 *
 * Flags:
 *   --avaliadores=N --staff=N --telao=N --autocadastro=N --por-avaliador=N
 *   --mutacao-ms=N --telao-ms=N --checkin-ms=N --disputa-ms=N
 *   --ritmo-ms=N                             tempo de pensar por ação do avaliador
 *                                            (0 = sem pausa, o modo de medição)
 *   --tecnicos-vinculados=N                  quantos avaliadores técnicos ficam FIXADOS num
 *                                            questionário; sem a flag, metade. Com 0, nenhum —
 *                                            é a configuração recomendada quando o evento tem
 *                                            mais de um técnico, e a que não gera impedimento
 *   --questionarios=criados|copiados|misto|existentes
 *                                            caminho de montagem dos questionários;
 *                                            `existentes` não cria nada e usa os que o
 *                                            semeador já pôs no evento
 *   --ate-concluir                           drenagem: avalia até a feira concluir ou empacar
 *   --teto-ms=N --teto-varreduras=N          limites de parada do modo drenagem
 *   --finalizar                              encerra a feira ao fim da drenagem (exige --ate-concluir)
 *
 * Credenciais (NUNCA no código, doc ou commit — regra 9 do AGENTS.md):
 *   SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD
 *   SUPABASE_STAFF_EMAIL / SUPABASE_STAFF_PASSWORD
 *     (ou SUPABASE_STAFF_EMAILS / SUPABASE_STAFF_PASSWORDS, listas separadas por vírgula)
 *   Podem vir do ambiente ou de .env.simulacao.local (coberto por `.env.*` no .gitignore).
 *
 * Atores — cada um com a CHAVE ANÔNIMA e a própria sessão. A service role key é
 * proibida aqui: ela anula auth.uid() e contorna a RLS, o que invalidaria a simulação.
 *   - avaliador técnico: sessão anônima -> fn_solicitar_pareamento -> (staff pareia) ->
 *     sortear_proximo_projeto -> fn_enviar_avaliacao;
 *   - votante do voto popular: mesmo fluxo, vinculado ao questionário de voto popular;
 *   - staff: fn_parear_dispositivo e fn_check_in_projeto;
 *   - telão: polling de fn_telao_resumo (sem sessão, chave anônima);
 *   - admin: uma sessão só para tentar admin_salvar_questionario em questionário em uso;
 *   - disputa de nota: DOIS admins ao mesmo tempo na MESMA avaliação — um chama
 *     admin_corrigir_respostas_avaliacao e o outro admin_arbitrar_nota_final. pgTAP
 *     roda numa sessão só e não alcança essa corrida; a invariante 10 cobra que a
 *     nota sobrevivente combine com o ajuste_tipo sobrevivente;
 *   - autocadastro: rajada anônima em fn_autocadastro_avaliador.
 *
 * Guardas (AGENTS.md):
 *   - aborta se VITE_SUPABASE_URL não for 127.0.0.1/localhost, antes de qualquer escrita;
 *   - recusa chave de service_role;
 *   - nunca chama admin_reset_global;
 *   - só chama admin_finalizar_evento com --finalizar, depois da drenagem, com o
 *     id_evento explícito (o default resolve por evento_ativo_id() e encerraria a
 *     feira errada num banco com dois eventos), e nunca reverte sozinho;
 *   - nenhum DELETE sem WHERE, nenhum TRUNCATE;
 *   - toda leitura/escrita filtra por id_evento (regra 5);
 *   - não limpa nem resemeia entre rodadas: o evento acumula de propósito.
 *
 * Credenciamento: os avaliadores com `is_credenciado = false` ENTRAM como atores.
 * `fn_parear_dispositivo` faz `UPDATE avaliadores_evento SET is_credenciado = true`,
 * então o pareamento pelo staff é o fluxo real de credenciamento na portaria — e a
 * invariante 9 prova que ninguém sorteia nem avalia antes dele. A pré-condição exige
 * apenas `id_instituicao` preenchido, necessário para a invariante 4.
 *
 * Finalização (--finalizar): tira um retrato de tudo que a premiação lê (avaliações,
 * contagem por projeto, Telão, ranking, fn_relatorio_*), encerra, tira outro e compara.
 * Travas e aparelhos DEVEM mudar; nota, média e posição não. Depois sonda, sem supor o
 * resultado, se um avaliador ainda sorteia ou envia, se dá para parear um aparelho e se
 * um código de acesso pendente ainda vale.
 *
 * Nenhuma nota sai de constante: escala e perguntas vêm sempre do questionário
 * efetivamente escolhido, lido do banco. As escalas em ESCALA_CRIADA são definição
 * de questionário novo (entrada de admin_salvar_questionario), não premissa de leitura.
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'
import { garantirContasLocais, resumirContas } from './lib/contas-locais.mjs'
// Fonte única, compartilhada com a interface (src/features/simulacao/). O Node importa o
// .ts direto pelo type-stripping nativo; por isso esses módulos não usam o alias `@/`.
import { criarSorteio } from '../src/lib/simulacao/aleatorio.ts'

// ------------------------------------------------------------------ constantes

const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1'])
const ARQUIVOS_ENV = ['../.env', '../.env.simulacao.local']
const PAGINA_POSTGREST = 1000
const LIMITE_PAREAMENTO_MS = 60_000
const FRACAO_CHECKIN_LIMPO = 0.2
const FRACAO_VOTANTES = 0.2
const ESPERA_VARREDURA_MS = 15_000
const ESPERA_SEM_ELEGIVEL_MS = 300
const VAZIOS_ATE_DESISTIR = 3
const TETO_CICLOS_POR_AVALIADOR = 2000
const TENTATIVAS_QUESTIONARIO_ERRADO = 2

const PADROES = {
  avaliadores: 120,
  staff: 10,
  telao: 2,
  autocadastro: 5,
  porAvaliador: 3,
  mutacaoMs: 250,
  telaoMs: 1000,
  checkinMs: 200,
  disputaMs: 150,
  // null = metade dos técnicos vinculados (o comportamento de sempre). Um número fixa
  // exatamente essa quantidade; 0 deixa todos livres.
  tecnicosVinculados: null,
  // Tempo de pensar entre as ações de cada avaliador. 0 por padrão: o simulador nasceu
  // para medir, e pausa ia virar ruído na medição. Com ritmo, a feira simulada roda em
  // tempo observável no telão — é só isso que a flag muda.
  ritmoMs: 0,
  tetoMs: 900_000,
  tetoVarreduras: 400,
  questionarios: 'misto',
  ateConcluir: false,
  finalizar: false,
}

const MODOS_QUESTIONARIO = new Set(['criados', 'copiados', 'misto', 'existentes'])

/** Códigos dos modelos usados no modo `copiados` (sem UUID no código). */
const CODIGOS_MODELO = { tecnico: 'feira-software-q2', votoPopular: 'feira-software-q5' }

/** Escala de questionário CRIADO (entrada do admin_salvar_questionario). */
const ESCALA_CRIADA = { minima: 0, maxima: 10 }

const TITULOS_CRIADOS = {
  tecnico: 'Técnica — Simulação (criado)',
  votoPopular: 'Voto Popular — Simulação (criado)',
}

/** Pesos diferentes de propósito: a nota final é média PONDERADA. */
const PERGUNTAS_CRIADAS = {
  tecnico: [
    'Clareza do problema e da proposta',
    'Fundamentação técnica da solução',
    'Qualidade da execução e do protótipo',
    'Resultados e evidências',
    'Apresentação e domínio do grupo',
  ],
  votoPopular: [
    'O projeto despertou seu interesse',
    'A explicação ficou clara para o público',
    'Você indicaria este projeto a outras pessoas',
  ],
}

/**
 * Recusas que são ACERTO do teste: a regra de negócio funcionando sob concorrência.
 * Tudo que não casa aqui entra no balde de erros.
 */
const NEGATIVOS_ESPERADOS = [
  { rotulo: 'avaliador vinculado mandou outro questionário', teste: /vinculado a outro question/i },
  { rotulo: 'questionário em uso: alteração recusada', teste: /j[áa] foi usado em \d+ avalia/i },
  { rotulo: 'throttle do autocadastro', teste: /Muitos cadastros neste momento/i },
  { rotulo: 'aparelho sem pareamento: acesso negado', teste: /aparelho n[ãa]o est[áa] vinculado a este avaliador/i },
  { rotulo: 'projeto já fixado em outro questionário', teste: /projeto j[áa] [ée] avaliado com outro question/i },
  { rotulo: 'cota do projeto cheia: envio recusado', teste: /Cota de avalia[çc][õo]es do projeto j[áa] atingida/i },
  { rotulo: 'avaliador já tinha avaliado este projeto', teste: /j[áa] possui avalia[çc][ãa]o registrada para este projeto/i },
]

// ------------------------------------------------------------------ argumentos

const ARGUMENTOS_NUMERICOS = {
  avaliadores: 'avaliadores',
  staff: 'staff',
  telao: 'telao',
  autocadastro: 'autocadastro',
  'por-avaliador': 'porAvaliador',
  'mutacao-ms': 'mutacaoMs',
  'telao-ms': 'telaoMs',
  'checkin-ms': 'checkinMs',
  'disputa-ms': 'disputaMs',
  'ritmo-ms': 'ritmoMs',
  'tecnicos-vinculados': 'tecnicosVinculados',
  'teto-ms': 'tetoMs',
  'teto-varreduras': 'tetoVarreduras',
}
const ARGUMENTOS_TEXTO = { questionarios: 'questionarios' }
const ARGUMENTOS_LIGADOS = { 'ate-concluir': 'ateConcluir', finalizar: 'finalizar' }

function ajudaArgumentos() {
  return 'Use: ' +
    Object.keys(ARGUMENTOS_NUMERICOS).map((nome) => `--${nome}=N`).join(' ') +
    ' --questionarios=criados|copiados|misto|existentes --ate-concluir --finalizar'
}

function lerArgumentos(argv) {
  const opcoes = { ...PADROES }
  for (const argumento of argv) {
    const ligado = /^--([a-z-]+)$/.exec(argumento)
    if (ligado && ARGUMENTOS_LIGADOS[ligado[1]]) {
      opcoes[ARGUMENTOS_LIGADOS[ligado[1]]] = true
      continue
    }
    const comValor = /^--([a-z-]+)=(.+)$/.exec(argumento)
    const nome = comValor?.[1]
    if (comValor && ARGUMENTOS_NUMERICOS[nome] && /^\d+$/.test(comValor[2])) {
      opcoes[ARGUMENTOS_NUMERICOS[nome]] = Number(comValor[2])
      continue
    }
    if (comValor && ARGUMENTOS_TEXTO[nome]) {
      opcoes[ARGUMENTOS_TEXTO[nome]] = comValor[2].trim().toLowerCase()
      continue
    }
    throw new Error(`Argumento desconhecido ou inválido: ${argumento}\n${ajudaArgumentos()}`)
  }
  if (opcoes.avaliadores < 1) throw new Error('--avaliadores precisa ser maior que zero.')
  if (opcoes.staff < 1) throw new Error('--staff precisa ser maior que zero: sem staff ninguém pareia.')
  if (opcoes.porAvaliador < 1) throw new Error('--por-avaliador precisa ser maior que zero.')
  if (opcoes.mutacaoMs < 50) throw new Error('--mutacao-ms mínimo é 50.')
  if (opcoes.disputaMs < 50) throw new Error('--disputa-ms mínimo é 50.')
  if (!MODOS_QUESTIONARIO.has(opcoes.questionarios)) {
    throw new Error(`--questionarios precisa ser ${[...MODOS_QUESTIONARIO].join(', ')}.`)
  }
  // Finalizar sem drenar encerraria uma feira no meio: a flag não roda sozinha.
  if (opcoes.finalizar && !opcoes.ateConcluir) {
    throw new Error(
      '--finalizar só roda depois da drenagem, na mesma execução: use junto com --ate-concluir.\n' +
      'Sozinha ela encerraria a feira com avaliação pendente, o que não é o cenário a testar.',
    )
  }
  return opcoes
}

// ------------------------------------------------------------ guarda e sessões

function carregarEnv() {
  // Variáveis já definidas no ambiente têm precedência sobre o arquivo.
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

function exigirSupabaseLocal() {
  const url = process.env.VITE_SUPABASE_URL
  const chaveAnonima = process.env.VITE_SUPABASE_ANON_KEY
  if (!url) throw new Error('VITE_SUPABASE_URL não definida. Este script só roda contra o Supabase local.')
  if (!chaveAnonima) throw new Error('VITE_SUPABASE_ANON_KEY não definida.')

  let host
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`VITE_SUPABASE_URL não é uma URL válida: ${url}`)
  }
  if (!HOSTS_LOCAIS.has(host)) {
    throw new Error(
      `RECUSADO: VITE_SUPABASE_URL aponta para "${host}", que não é local.\n` +
      'Este script só pode rodar contra 127.0.0.1 ou localhost. Nada foi escrito.',
    )
  }
  if (papelDaChave(chaveAnonima) === 'service_role') {
    throw new Error(
      'RECUSADO: VITE_SUPABASE_ANON_KEY é uma chave de service_role.\n' +
      'Ela anula auth.uid() e contorna a RLS — a simulação perderia o sentido.',
    )
  }
  return { url, chaveAnonima }
}

function exigirCredenciais() {
  const lista = (valor) => (valor ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const admin = {
    email: (process.env.SUPABASE_ADMIN_EMAIL ?? '').trim(),
    senha: process.env.SUPABASE_ADMIN_PASSWORD ?? '',
  }
  const emailsStaff = lista(process.env.SUPABASE_STAFF_EMAILS ?? process.env.SUPABASE_STAFF_EMAIL)
  const senhasStaff = lista(process.env.SUPABASE_STAFF_PASSWORDS ?? process.env.SUPABASE_STAFF_PASSWORD)

  const faltando = []
  if (!admin.email) faltando.push('SUPABASE_ADMIN_EMAIL')
  if (!admin.senha) faltando.push('SUPABASE_ADMIN_PASSWORD')
  if (emailsStaff.length === 0) faltando.push('SUPABASE_STAFF_EMAIL (ou SUPABASE_STAFF_EMAILS)')
  if (senhasStaff.length === 0) faltando.push('SUPABASE_STAFF_PASSWORD (ou SUPABASE_STAFF_PASSWORDS)')
  if (faltando.length > 0) {
    throw new Error(
      `Faltam credenciais: ${faltando.join(', ')}.\n` +
      'Defina-as no ambiente ou em .env.simulacao.local (ignorado pelo git).\n' +
      'Nunca escreva senha no script, na doc ou no commit.',
    )
  }
  if (senhasStaff.length !== 1 && senhasStaff.length !== emailsStaff.length) {
    throw new Error('SUPABASE_STAFF_PASSWORDS precisa ter uma senha só (comum) ou uma por e-mail.')
  }
  return {
    admin,
    staff: emailsStaff.map((email, indice) => ({ email, senha: senhasStaff[indice] ?? senhasStaff[0] })),
  }
}

// --------------------------------------------------------------------- apoio

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Tempo de pensar do avaliador (--ritmo-ms). Com jitter de 0,5x a 1,5x: sem ele os
 * 120 atores entrariam em lockstep e produziriam uma rajada sincronizada a cada
 * intervalo, que é o oposto do que a flag existe para mostrar. Com --ritmo-ms=0
 * (padrão) não há await nenhum, e a medição fica igual à de antes da flag.
 */
async function pensar(ctx) {
  const ritmo = ctx.opcoes.ritmoMs
  if (!ritmo) return
  await dormir(Math.round(ritmo * (0.5 + Math.random())))
}

async function comLimiteDeTempo(promessa, ms, descricao) {
  let agulha
  const expirar = new Promise((_, rejeitar) => {
    agulha = setTimeout(() => rejeitar(new Error(`Tempo esgotado em ${descricao} (${ms} ms).`)), ms)
  })
  try {
    return await Promise.race([promessa, expirar])
  } finally {
    clearTimeout(agulha)
  }
}

/**
 * De que leitura veio o erro. Sem isto um "canceling statement due to statement
 * timeout" chega sem dizer qual consulta estourou, e o diagnóstico vira adivinhação.
 */
function descreverConsulta(consulta) {
  try {
    const url = new URL(String(consulta.url))
    const alvo = url.pathname.replace('/rest/v1/', '')
    return `${alvo}?${decodeURIComponent(url.searchParams.toString()).slice(0, 140)}`
  } catch {
    return 'consulta PostgREST'
  }
}

/** PostgREST devolve no máximo max_rows (1000) por requisição: pagina até o fim. */
async function lerTudo(montarConsulta) {
  const linhas = []
  for (let inicio = 0; ; inicio += PAGINA_POSTGREST) {
    const consulta = montarConsulta()
    const { data, error } = await consulta.range(inicio, inicio + PAGINA_POSTGREST - 1)
    if (error) throw new Error(`${descreverConsulta(consulta)} -> ${error.message}`)
    linhas.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGINA_POSTGREST) return linhas
  }
}

function emBlocos(itens, tamanho) {
  const blocos = []
  for (let indice = 0; indice < itens.length; indice += tamanho) {
    blocos.push(itens.slice(indice, indice + tamanho))
  }
  return blocos
}

// ------------------------------------------------------------------- métricas

const metricas = new Map()

function metrica(nome) {
  if (!metricas.has(nome)) {
    metricas.set(nome, {
      amostras: [], instantes: [], ok: 0, vazios: 0, limite: 0, negativos: new Map(), erros: new Map(),
    })
  }
  return metricas.get(nome)
}

function somar(mapa, chave, quanto = 1) {
  mapa.set(chave, (mapa.get(chave) ?? 0) + quanto)
}

/** Agrupa mensagens equivalentes: os números variam (cota, perguntas, usos). */
function resumirMensagem(mensagem) {
  return String(mensagem).replace(/\s+/g, ' ').replace(/\d+/g, 'N').trim().slice(0, 140)
}

function classificarErro(mensagem, status) {
  if (status === 429 || /rate limit|too many requests|limite de requisi/i.test(mensagem)) return { tipo: 'limite' }
  for (const negativo of NEGATIVOS_ESPERADOS) {
    if (negativo.teste.test(mensagem)) return { tipo: 'negativo', rotulo: negativo.rotulo }
  }
  return { tipo: 'erro' }
}

/**
 * Executa uma chamada do supabase-js medindo a latência e classificando o
 * resultado. Nada é impresso por chamada: só o resumo final.
 */
async function medir(nome, executar) {
  const alvo = metrica(nome)
  const inicio = performance.now()
  let resposta = null
  let excecao = null
  try {
    resposta = await executar()
  } catch (erro) {
    excecao = erro
  }
  alvo.amostras.push(performance.now() - inicio)
  alvo.instantes.push(inicio)

  const erro = excecao ?? resposta?.error ?? null
  if (!erro) {
    alvo.ok += 1
    return { data: resposta?.data ?? null, error: null }
  }
  const mensagem = erro.message ?? String(erro)
  const classe = classificarErro(mensagem, erro.status)
  if (classe.tipo === 'limite') alvo.limite += 1
  else if (classe.tipo === 'negativo') somar(alvo.negativos, classe.rotulo)
  else somar(alvo.erros, resumirMensagem(mensagem))
  return { data: null, error: erro, classe }
}

function percentil(ordenado, posicao) {
  if (ordenado.length === 0) return 0
  const indice = Math.min(ordenado.length - 1, Math.max(0, Math.ceil((posicao / 100) * ordenado.length) - 1))
  return ordenado[indice]
}

/** p95 por terço da rodada: mostra a deriva de latência conforme avaliacoes cresce. */
function derivaPorTerco(nome, inicio, fim) {
  const dados = metricas.get(nome)
  if (!dados || dados.amostras.length === 0) return null
  const passo = (fim - inicio) / 3
  const tercos = [[], [], []]
  dados.amostras.forEach((ms, indice) => {
    const posicao = Math.min(2, Math.max(0, Math.floor((dados.instantes[indice] - inicio) / passo)))
    tercos[posicao].push(ms)
  })
  return tercos.map((amostras) => ({
    chamadas: amostras.length,
    p95: percentil([...amostras].sort((a, b) => a - b), 95),
  }))
}

// -------------------------------------------------------------------- clientes

function criarCliente(ctx) {
  return createClient(ctx.url, ctx.chaveAnonima, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  })
}

async function entrarComoAdmin(ctx, nome) {
  const cliente = criarCliente(ctx)
  const { error } = await medir(nome, () => cliente.auth.signInWithPassword({
    email: ctx.credenciais.admin.email,
    password: ctx.credenciais.admin.senha,
  }))
  if (error) {
    throw new Error(
      `Login do Admin falhou: ${error.message}\n` +
      'Confira SUPABASE_ADMIN_EMAIL/SUPABASE_ADMIN_PASSWORD.',
    )
  }
  const { data: perfil, error: erroPerfil } = await medir('fn_meu_perfil (admin)', () => cliente.rpc('fn_meu_perfil'))
  if (erroPerfil) throw new Error(`Não consegui ler o perfil do Admin: ${erroPerfil.message}`)
  if (perfil?.papel !== 'admin') {
    throw new Error(
      `A conta ${ctx.credenciais.admin.email} entrou, mas o banco não a reconhece como ADMIN ` +
      `(papel = ${perfil?.papel ?? 'nenhum'}). is_admin() lê usuarios.papel; nada foi alterado.`,
    )
  }
  return cliente
}

/**
 * Garante que cada conta de staff configurada existe como STAFF no banco e tem
 * conta de autenticação própria — pelo caminho real: o Admin cadastra
 * (admin_salvar_staff), a pessoa faz login (ou se cadastra) com a chave anônima e
 * fn_vincular_conta_staff amarra o auth.uid ao usuário. Sem service role.
 */
async function prepararStaff(ctx) {
  const { data, error } = await medir('admin_salvar_staff', () => ctx.admin.rpc('admin_salvar_staff', {
    // p_id_evento nulo: is_staff() é global e não queremos inscrever staff em avaliadores_evento.
    p_id_evento: null,
    p_itens: ctx.credenciais.staff.map((conta, indice) => ({
      nome: `Staff Simulação ${String(indice + 1).padStart(2, '0')}`,
      email: conta.email,
      papel: 'STAFF',
    })),
  }))
  if (error) throw new Error(`Não consegui cadastrar o staff: ${error.message}`)
  const ignorados = data?.ignorados ?? []
  if (ignorados.length > 0) {
    throw new Error(
      'O Admin não pôde cadastrar alguma conta de staff:\n' +
      ignorados.map((item) => `  - ${item.email}: ${item.motivo}`).join('\n'),
    )
  }

  // Quem já tem id_auth não precisa de signUp: cada login à toa consome o limite
  // de sign_in_sign_ups (30 a cada 5 minutos por IP).
  const linhas = await lerTudo(() => ctx.admin
    .from('usuarios')
    .select('email, id_auth')
    .in('email', ctx.credenciais.staff.map((conta) => conta.email)))
  ctx.staffComConta = new Set(linhas.filter((linha) => linha.id_auth).map((linha) => linha.email.toLowerCase()))
}

async function entrarComoStaff(ctx, conta) {
  const cliente = criarCliente(ctx)
  const credencial = { email: conta.email, password: conta.senha }
  let sessao = null

  if (!ctx.staffComConta.has(conta.email.toLowerCase())) {
    const criacao = await medir('auth.signUp (staff)', () => cliente.auth.signUp(credencial))
    if (criacao.error && !/already registered|already been registered/i.test(criacao.error.message)) {
      throw new Error(`Não consegui criar a conta de ${conta.email}: ${criacao.error.message}`)
    }
    sessao = criacao.data?.session ?? null
  }
  if (!sessao) {
    const login = await medir('auth.signInWithPassword (staff)', () => cliente.auth.signInWithPassword(credencial))
    if (login.error) {
      throw new Error(
        `Login do staff ${conta.email} falhou: ${login.error.message}\n` +
        'Confira SUPABASE_STAFF_EMAIL/SUPABASE_STAFF_PASSWORD (mínimo de 8 caracteres).',
      )
    }
  }

  const vinculo = await medir('fn_vincular_conta_staff', () => cliente.rpc('fn_vincular_conta_staff'))
  if (vinculo.error) throw new Error(`fn_vincular_conta_staff falhou para ${conta.email}: ${vinculo.error.message}`)
  if (vinculo.data?.papel !== 'staff') {
    throw new Error(`A conta ${conta.email} entrou, mas o banco não a reconhece como STAFF.`)
  }
  ctx.staffComConta.add(conta.email.toLowerCase())
  return cliente
}

// ---------------------------------------------------------------- pré-condições

/**
 * Pré-condições que não dependem da composição dos questionários. As do
 * questionário ficam em `conferirQuestionarios`, depois de o modo montá-los.
 */
async function conferirPreCondicoes(ctx) {
  const avisos = []

  const eventos = await lerTudo(() => ctx.admin
    .from('eventos')
    .select('id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, minutos_timeout_lock, ' +
            'data_evento, horario_inicio, horario_fim, sistema_liberado')
    .eq('is_ativo', true))
  if (eventos.length !== 1) {
    throw new Error(`PRÉ-CONDIÇÃO: esperava exatamente 1 evento com is_ativo = true; encontrei ${eventos.length}.`)
  }
  const evento = eventos[0]
  ctx.idEvento = evento.id_evento
  ctx.nomeEvento = evento.nome_evento
  ctx.cotaPadrao = evento.cota_avaliacoes_padrao ?? 3

  const janela = await medir('fn_janela_avaliacao_aberta', () => ctx.admin
    .rpc('fn_janela_avaliacao_aberta', { p_id_evento: ctx.idEvento }))
  if (janela.error) throw new Error(`PRÉ-CONDIÇÃO: fn_janela_avaliacao_aberta falhou: ${janela.error.message}`)
  if (janela.data !== true) {
    // fn_janela_avaliacao_aberta compara agora (America/Campo_Grande) com
    // data_evento + horario_inicio/horario_fim. O motivo mais comum é o evento ter
    // nascido em outro dia. Quem muda a data é a coordenação, não este script.
    throw new Error(
      'PRÉ-CONDIÇÃO: fn_janela_avaliacao_aberta devolveu false — fora da janela de avaliação. Nada foi escrito.\n' +
      `  evento ativo: ${evento.nome_evento}\n` +
      `  data_evento: ${evento.data_evento}, janela ${evento.horario_inicio ?? '—'} às ${evento.horario_fim ?? '—'}, ` +
      `sistema_liberado: ${evento.sistema_liberado}\n` +
      `  agora em America/Campo_Grande: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Campo_Grande' })}\n` +
      '  Ajuste a data/janela do evento no Admin (ou rode o seeder de novo) e tente outra vez.',
    )
  }

  const inscritos = await lerTudo(() => ctx.admin
    .from('avaliadores_evento')
    .select('id_usuario, id_instituicao, is_credenciado, id_questionario, usuarios!inner(papel)')
    .eq('id_evento', ctx.idEvento))
  const avaliadores = inscritos.filter((linha) => String(linha.usuarios?.papel ?? '').toUpperCase() === 'AVALIADOR')
  // Credenciamento NÃO é exigido: o pareamento pelo staff é o credenciamento real
  // (fn_parear_dispositivo faz is_credenciado = true). Instituição é, por causa da invariante 4.
  const candidatos = avaliadores.filter((linha) => linha.id_instituicao)
  const semInstituicao = avaliadores.length - candidatos.length
  if (semInstituicao > 0) {
    avisos.push(
      `${semInstituicao} de ${avaliadores.length} avaliadores do evento estão sem id_instituicao ` +
      '(não exercitariam a invariante 4): ficaram fora dos atores, nada foi alterado.',
    )
  }
  if (candidatos.length < ctx.opcoes.avaliadores) {
    throw new Error(
      `PRÉ-CONDIÇÃO: preciso de ${ctx.opcoes.avaliadores} avaliadores com instituição no evento, ` +
      `e só há ${candidatos.length} (de ${avaliadores.length} inscritos).\n` +
      'Rode scripts/semear-simulacao.mjs com mais avaliadores. Nada foi escrito.',
    )
  }

  ctx.candidatos = [...candidatos].sort((a, b) => a.id_usuario.localeCompare(b.id_usuario))
  ctx.totalAvaliadoresDoEvento = avaliadores.length
  ctx.semCredenciamentoNoEvento = avaliadores.filter((linha) => linha.is_credenciado !== true).length
  return avisos
}

function conferirQuestionarios(questionarios, perguntas) {
  const semPergunta = questionarios
    .filter((quest) => !perguntas.some((pergunta) => pergunta.id_questionario === quest.id_questionario))
  if (semPergunta.length > 0) {
    throw new Error(
      'PRÉ-CONDIÇÃO: questionário sem nenhuma linha em perguntas_questionario:\n' +
      semPergunta.map((quest) => `  - ${quest.titulo}`).join('\n'),
    )
  }
  if (!questionarios.some((quest) => quest.is_voto_popular === false)) {
    throw new Error('PRÉ-CONDIÇÃO: o evento não tem questionário técnico (is_voto_popular = false).')
  }
  if (!questionarios.some((quest) => quest.is_voto_popular === true)) {
    throw new Error('PRÉ-CONDIÇÃO: o evento não tem questionário de voto popular (is_voto_popular = true).')
  }
}

// ------------------------------------------------------ montagem dos questionários

async function lerQuestionariosDoEvento(ctx) {
  const questionarios = await lerTudo(() => ctx.admin
    .from('questionarios')
    .select('id_questionario, titulo, escala_minima, escala_maxima, is_voto_popular, id_origem')
    .eq('id_evento', ctx.idEvento))
  const perguntas = questionarios.length === 0 ? [] : await lerTudo(() => ctx.admin
    .from('perguntas_questionario')
    .select('id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate, descricao_lembrete')
    .in('id_questionario', questionarios.map((item) => item.id_questionario)))
  return { questionarios, perguntas }
}

async function contarUsos(ctx, idQuestionario) {
  const { count, error } = await ctx.admin
    .from('avaliacoes')
    .select('id_avaliacao', { count: 'exact', head: true })
    .eq('id_questionario', idQuestionario)
    .neq('status', 'CANCELADA')
  if (error) throw new Error(`Não consegui contar os usos do questionário: ${error.message}`)
  return count ?? 0
}

/** Pesos escalonados: a média ponderada precisa de pesos diferentes para valer algo. */
function pesosVariados(indice) {
  return { peso_calculo: Number((1 + (indice % 5) * 0.5).toFixed(2)), peso_desempate: indice + 1 }
}

async function criarQuestionario(ctx, titulo, textos, notas) {
  const existente = ctx.estadoQuestionarios.questionarios
    .find((quest) => quest.titulo.trim().toLowerCase() === titulo.trim().toLowerCase())
  const perguntasAtuais = existente
    ? ctx.estadoQuestionarios.perguntas
      .filter((pergunta) => pergunta.id_questionario === existente.id_questionario)
      .sort((a, b) => a.ordem - b.ordem)
    : []

  if (existente && await contarUsos(ctx, existente.id_questionario) > 0) {
    notas.push(`"${titulo}" já existia e já tem avaliação: reaproveitado como está (nada pode mudar).`)
    return existente.id_questionario
  }

  const payload = textos.map((texto, indice) => ({
    ...(perguntasAtuais[indice] ? { id_pergunta: perguntasAtuais[indice].id_pergunta } : {}),
    texto_pergunta: texto,
    ...pesosVariados(indice),
  }))
  const { data, error } = await medir('admin_salvar_questionario (criação)', () => ctx.admin
    .rpc('admin_salvar_questionario', {
      p_id_questionario: existente?.id_questionario ?? null,
      p_id_evento: ctx.idEvento,
      p_titulo: titulo,
      p_escala_minima: ESCALA_CRIADA.minima,
      p_escala_maxima: ESCALA_CRIADA.maxima,
      p_perguntas: payload,
    }))
  if (error && /j[áa] foi usado em \d+ avalia/i.test(error.message)) {
    notas.push(`"${titulo}" já existia e já está em uso: reaproveitado como está.`)
    return existente.id_questionario
  }
  if (error) throw new Error(`Não consegui criar o questionário "${titulo}": ${error.message}`)
  notas.push(existente
    ? `"${titulo}" criado antes e reescrito por admin_salvar_questionario (escala ${ESCALA_CRIADA.minima}–${ESCALA_CRIADA.maxima}).`
    : `"${titulo}" criado por admin_salvar_questionario (escala ${ESCALA_CRIADA.minima}–${ESCALA_CRIADA.maxima}).`)
  return data
}

async function copiarModelo(ctx, codigo, notas) {
  const modelos = await lerTudo(() => ctx.admin
    .from('modelos_questionario')
    .select('id_modelo, codigo, titulo, escala_minima, escala_maxima')
    .eq('codigo', codigo))
  if (modelos.length !== 1) {
    throw new Error(
      `Não achei o modelo de questionário com codigo "${codigo}" em modelos_questionario ` +
      `(encontrei ${modelos.length}). Use "Restaurar originais" no Gestor de Questionários. Nada foi escrito.`,
    )
  }
  const modelo = modelos[0]
  const { data, error } = await medir('admin_copiar_questionario', () => ctx.admin
    .rpc('admin_copiar_questionario', { p_id_origem: modelo.id_modelo, p_id_evento: ctx.idEvento }))
  if (error) throw new Error(`admin_copiar_questionario falhou para ${codigo}: ${error.message}`)
  notas.push(
    `"${modelo.titulo}" (${codigo}) copiado por admin_copiar_questionario ` +
    `(escala ${Number(modelo.escala_minima)}–${Number(modelo.escala_maxima)}).`,
  )

  // Pesos do modelo são todos 1: escalona-os enquanto a cópia não tem avaliação,
  // senão a média ponderada seria média simples.
  const usos = await contarUsos(ctx, data)
  if (usos > 0) {
    notas.push(`a cópia de ${codigo} já tem ${usos} avaliação(ões): pesos ficaram como estão.`)
    return data
  }
  const atual = await lerQuestionariosDoEvento(ctx)
  const quest = atual.questionarios.find((item) => item.id_questionario === data)
  const perguntas = atual.perguntas
    .filter((pergunta) => pergunta.id_questionario === data)
    .sort((a, b) => a.ordem - b.ordem)
  const { error: erroPesos } = await medir('admin_salvar_questionario (pesos da cópia)', () => ctx.admin
    .rpc('admin_salvar_questionario', {
      p_id_questionario: data,
      p_id_evento: ctx.idEvento,
      p_titulo: quest.titulo,
      p_escala_minima: Number(quest.escala_minima),
      p_escala_maxima: Number(quest.escala_maxima),
      p_perguntas: perguntas.map((pergunta, indice) => ({
        id_pergunta: pergunta.id_pergunta,
        texto_pergunta: pergunta.texto_pergunta,
        descricao_lembrete: pergunta.descricao_lembrete,
        ...pesosVariados(indice),
      })),
    }))
  if (erroPesos && /j[áa] foi usado em \d+ avalia/i.test(erroPesos.message)) {
    notas.push(`a cópia de ${codigo} já está em uso: pesos ficaram como estão.`)
    return data
  }
  if (erroPesos) throw new Error(`Não consegui escalonar os pesos da cópia de ${codigo}: ${erroPesos.message}`)
  notas.push(`pesos da cópia de ${codigo} escalonados (média ponderada de verdade).`)
  return data
}

/**
 * A marca de voto popular é CONFERIDA no banco, não presumida: cópia de MODELO
 * nasce técnica (o comentário da função diz isso, e o corpo confirma), cópia de
 * questionário herda a marca.
 */
async function garantirVotoPopular(ctx, idQuestionario, notas) {
  const atual = await lerQuestionariosDoEvento(ctx)
  const quest = atual.questionarios.find((item) => item.id_questionario === idQuestionario)
  if (!quest) throw new Error('O questionário de voto popular desapareceu depois de criado.')
  if (quest.is_voto_popular === true) {
    notas.push(`"${quest.titulo}" já veio com is_voto_popular = true.`)
    return
  }
  const { error } = await medir('admin_marcar_questionario_voto_popular', () => ctx.admin
    .rpc('admin_marcar_questionario_voto_popular', {
      p_id_questionario: idQuestionario,
      p_is_voto_popular: true,
    }))
  if (error) {
    throw new Error(
      `"${quest.titulo}" nasceu sem a marca de voto popular e admin_marcar_questionario_voto_popular ` +
      `recusou: ${error.message}\nNão tente contornar: use a reclassificação pelo Gestor de Questionários.`,
    )
  }
  notas.push(`"${quest.titulo}" nasceu técnico e foi marcado por admin_marcar_questionario_voto_popular.`)
}

async function comporQuestionarios(ctx) {
  const notas = []
  const modo = ctx.opcoes.questionarios
  ctx.estadoQuestionarios = await lerQuestionariosDoEvento(ctx)

  let idTecnico
  let idVotoPopular
  const caminhos = {}
  if (modo === 'criados') {
    idTecnico = await criarQuestionario(ctx, TITULOS_CRIADOS.tecnico, PERGUNTAS_CRIADAS.tecnico, notas)
    idVotoPopular = await criarQuestionario(ctx, TITULOS_CRIADOS.votoPopular, PERGUNTAS_CRIADAS.votoPopular, notas)
    caminhos.tecnico = 'criado'
    caminhos.votoPopular = 'criado'
  } else if (modo === 'copiados') {
    idTecnico = await copiarModelo(ctx, CODIGOS_MODELO.tecnico, notas)
    idVotoPopular = await copiarModelo(ctx, CODIGOS_MODELO.votoPopular, notas)
    caminhos.tecnico = 'copiado'
    caminhos.votoPopular = 'copiado'
  } else if (modo === 'existentes') {
    // Nada é criado nem copiado: a rodada usa a configuração que o evento já tem. É o
    // modo para medir a configuração REAL da feira — com `--questionarios=misto` a
    // rodada acrescentaria um técnico próprio e a pergunta deixaria de ser sobre ela.
    const tecnico = ctx.estadoQuestionarios.questionarios.find((quest) => quest.is_voto_popular === false)
    const votoPopular = ctx.estadoQuestionarios.questionarios.find((quest) => quest.is_voto_popular === true)
    if (!tecnico || !votoPopular) {
      throw new Error(
        '--questionarios=existentes exige que o evento já tenha um questionário técnico e um de voto ' +
        'popular. Rode `npm run local:semear` antes (use --tecnicos=N para a configuração da feira).',
      )
    }
    idTecnico = tecnico.id_questionario
    idVotoPopular = votoPopular.id_questionario
    caminhos.tecnico = 'existente'
    caminhos.votoPopular = 'existente'
    const tecnicos = ctx.estadoQuestionarios.questionarios.filter((q) => q.is_voto_popular === false).length
    notas.push(`configuração do evento usada como está: ${tecnicos} questionário(s) técnico(s) e 1 de voto popular.`)
  } else {
    // misto: um de cada caminho — e escalas diferentes na MESMA rodada (1–5 e 0–10).
    idTecnico = await copiarModelo(ctx, CODIGOS_MODELO.tecnico, notas)
    idVotoPopular = await criarQuestionario(ctx, TITULOS_CRIADOS.votoPopular, PERGUNTAS_CRIADAS.votoPopular, notas)
    caminhos.tecnico = 'copiado'
    caminhos.votoPopular = 'criado'
  }
  await garantirVotoPopular(ctx, idVotoPopular, notas)

  const atual = await lerQuestionariosDoEvento(ctx)
  conferirQuestionarios(atual.questionarios, atual.perguntas)

  ctx.questionarios = atual.questionarios
  ctx.perguntas = atual.perguntas
  ctx.questionarioTecnico = atual.questionarios.find((quest) => quest.id_questionario === idTecnico)
  ctx.questionarioVotoPopular = atual.questionarios.find((quest) => quest.id_questionario === idVotoPopular)
  if (ctx.questionarioTecnico.is_voto_popular !== false) {
    throw new Error('O questionário escolhido como técnico está marcado como voto popular. Nada foi escrito depois disto.')
  }
  // Questionário de outro caminho para o caso negativo do vínculo.
  ctx.questionarioAlternativo = atual.questionarios
    .find((quest) => quest.is_voto_popular === false && quest.id_questionario !== idTecnico)
    ?? ctx.questionarioVotoPopular
  ctx.caminhosQuestionario = caminhos
  ctx.notasQuestionario = notas
}

// --------------------------------------------------------------------- preparo

/** Definição de um questionário como ela está AGORA (para comparar no fim). */
function montarDefinicoes(questionarios, perguntas) {
  const definicoes = new Map()
  for (const quest of questionarios) {
    definicoes.set(quest.id_questionario, {
      escala_minima: Number(quest.escala_minima),
      escala_maxima: Number(quest.escala_maxima),
      perguntas: new Map(perguntas
        .filter((pergunta) => pergunta.id_questionario === quest.id_questionario)
        .map((pergunta) => [pergunta.id_pergunta, {
          ordem: pergunta.ordem,
          texto_pergunta: pergunta.texto_pergunta,
          peso_calculo: Number(pergunta.peso_calculo),
          peso_desempate: Number(pergunta.peso_desempate),
        }])),
    })
  }
  return definicoes
}

async function lerDefinicoesAtuais(ctx) {
  const { questionarios, perguntas } = await lerQuestionariosDoEvento(ctx)
  return { questionarios, perguntas, definicoes: montarDefinicoes(questionarios, perguntas) }
}

/**
 * Os projetos do seeder já vêm com check-in, o que deixaria o staff sem trabalho:
 * limpa 20% deles para que o check-in aconteça DURANTE a rodada. Até lá, o sorteio
 * tem de ignorá-los. No modo drenagem, a fila do staff recebe também os projetos
 * que já estavam sem check-in — a feira só conclui quando todos entram.
 */
async function limparCheckIn(ctx) {
  const comCheckIn = await lerTudo(() => ctx.admin
    .from('projetos')
    .select('id_projeto')
    .eq('id_evento', ctx.idEvento)
    .eq('is_check_in_realizado', true)
    .eq('is_fora_da_competicao', false)
    .order('id_projeto'))
  const semCheckIn = await lerTudo(() => ctx.admin
    .from('projetos')
    .select('id_projeto')
    .eq('id_evento', ctx.idEvento)
    .eq('is_check_in_realizado', false)
    .eq('is_fora_da_competicao', false)
    .order('id_projeto'))

  const quantidade = Math.floor(comCheckIn.length * FRACAO_CHECKIN_LIMPO)
  const escolhidos = []
  const passo = quantidade > 0 ? comCheckIn.length / quantidade : 0
  for (let indice = 0; indice < quantidade; indice += 1) {
    escolhidos.push(comCheckIn[Math.floor(indice * passo)].id_projeto)
  }
  if (escolhidos.length > 0) {
    const { error } = await medir('update projetos (limpa check-in)', () => ctx.admin
      .from('projetos')
      .update({ is_check_in_realizado: false })
      .eq('id_evento', ctx.idEvento)
      .in('id_projeto', escolhidos))
    if (error) throw new Error(`Não consegui limpar o check-in: ${error.message}`)
  }
  return {
    limpos: escolhidos,
    pendentesAntes: semCheckIn.map((linha) => linha.id_projeto),
    elegiveis: comCheckIn.length,
  }
}

/**
 * Três grupos: votantes do voto popular, técnicos vinculados a um questionário técnico
 * e técnicos livres (resolvem pelo questionário fixado do projeto).
 *
 * Os vinculados são distribuídos em rodízio por TODOS os técnicos do evento, não só
 * pelo que esta rodada compôs. Com um técnico só isso não muda nada; com mais de um é
 * o que faz a trava do questionário valer de verdade, porque um avaliador vinculado ao
 * técnico A não consegue avaliar projeto já fixado no técnico B — e aí a pergunta
 * "a cota de todos os projetos fecha?" deixa de ter resposta óbvia.
 */
async function vincularQuestionarios(ctx) {
  const tecnicos = ctx.questionarios.filter((quest) => !quest.is_voto_popular)
  const resultado = { votantes: 0, vinculados: 0, livres: 0, porTecnico: new Map() }
  const tarefas = ctx.atores.map((ator, indice) => async () => {
    const tecnico = tecnicos[indice % tecnicos.length] ?? ctx.questionarioTecnico
    const idQuestionario = ator.grupo === 'votante'
      ? ctx.questionarioVotoPopular.id_questionario
      : (ator.grupo === 'tecnico-vinculado' ? tecnico.id_questionario : null)
    const { error } = await medir('admin_vincular_questionario_avaliador', () => ctx.admin
      .rpc('admin_vincular_questionario_avaliador', {
        p_id_usuario: ator.idUsuario,
        p_id_evento: ctx.idEvento,
        p_id_questionario: idQuestionario,
      }))
    if (error) throw new Error(`Não consegui vincular o questionário: ${error.message}`)
    ator.questionarioVinculado = idQuestionario
    if (ator.grupo === 'votante') resultado.votantes += 1
    else if (ator.grupo === 'tecnico-vinculado') {
      resultado.vinculados += 1
      somar(resultado.porTecnico, tecnico.titulo ?? tecnico.id_questionario)
    } else resultado.livres += 1
  })
  for (const bloco of emBlocos(tarefas, 10)) await Promise.all(bloco.map((executar) => executar()))
  return resultado
}

/**
 * Atores: inclui os sem credenciamento na mesma proporção em que aparecem no
 * evento, porque o pareamento pelo staff é o credenciamento real.
 */
function escolherAtores(ctx) {
  const semCredencial = ctx.candidatos.filter((linha) => linha.is_credenciado !== true)
  const comCredencial = ctx.candidatos.filter((linha) => linha.is_credenciado === true)
  const fracao = ctx.candidatos.length > 0 ? semCredencial.length / ctx.candidatos.length : 0
  const total = ctx.opcoes.avaliadores
  const votantes = total >= 5 ? Math.max(1, Math.round(total * FRACAO_VOTANTES)) : 0
  const passoVotante = votantes > 0 ? Math.max(1, Math.floor(total / votantes)) : 0

  const escolhidos = []
  let usadosSemCredencial = 0
  let votantesEscolhidos = 0
  let vinculadosEscolhidos = 0
  const tetoVinculados = ctx.opcoes.tecnicosVinculados
  for (let indice = 0; indice < total; indice += 1) {
    const alvo = Math.round((indice + 1) * fracao)
    const pegarSemCredencial = (usadosSemCredencial < alvo && usadosSemCredencial < semCredencial.length)
      || comCredencial.length + usadosSemCredencial <= indice
    const linha = pegarSemCredencial
      ? semCredencial[usadosSemCredencial++]
      : comCredencial[indice - usadosSemCredencial]

    const viraVotante = votantes > 0 && votantesEscolhidos < votantes && indice % passoVotante === 0
    if (viraVotante) votantesEscolhidos += 1
    // Sem --tecnicos-vinculados, metade dos técnicos é vinculada, alternando (o
    // comportamento de sempre). Com a flag, exatamente N são — e com 0, nenhum.
    const viraVinculado = tetoVinculados === null
      ? (indice - votantesEscolhidos) % 2 === 0
      : vinculadosEscolhidos < tetoVinculados
    if (!viraVotante && viraVinculado) vinculadosEscolhidos += 1
    const grupo = viraVotante ? 'votante' : (viraVinculado ? 'tecnico-vinculado' : 'tecnico-livre')

    escolhidos.push({
      idUsuario: linha.id_usuario,
      idInstituicao: linha.id_instituicao,
      credenciadoAntes: linha.is_credenciado === true,
      grupo,
      semente: 7919 + indice * 131,
      questionarioVinculado: null,
      ciclos: 0,
      enviadas: 0,
      vazios: 0,
      exaurido: false,
      motivoFim: null,
      pareado: false,
      perfilAntes: null,
      sorteioAntesRecusado: null,
      projetosQueFalharam: new Set(),
    })
  }
  return escolhidos
}

async function marcoDaTrilha(ctx) {
  const { data, error } = await ctx.admin
    .from('log_auditoria')
    .select('criado_em')
    .order('id_log', { ascending: false })
    .limit(1)
  if (error || !data?.[0]) return null
  return data[0].criado_em
}

// ----------------------------------------------------------------- questionário

/**
 * A MESMA regra de resolução de fn_enviar_avaliacao / TelaAvaliador:
 * vínculo do avaliador -> questionário fixado do projeto -> questionário técnico
 * do evento. p_id_questionario nunca vai nulo.
 */
function resolverQuestionario(ctx, ator, projeto) {
  return ator.questionarioVinculado
    ?? projeto?.id_questionario_fixado
    ?? ctx.questionarioTecnico.id_questionario
}

/** Um questionário do evento que NÃO é o do vínculo, para o caso negativo. */
function questionarioErrado(ctx, ator) {
  const candidatos = [ctx.questionarioAlternativo, ctx.questionarioTecnico, ctx.questionarioVotoPopular]
  return candidatos.find((quest) => quest && quest.id_questionario !== ator.questionarioVinculado) ?? null
}

/** Escala e perguntas vêm do questionário efetivamente escolhido, nunca de constante. */
function lerQuestionarioDoBanco(ctx, cliente, idQuestionario) {
  if (!ctx.cacheQuestionarios.has(idQuestionario)) {
    ctx.cacheQuestionarios.set(idQuestionario, (async () => {
      const quest = await medir('select questionarios', () => cliente
        .from('questionarios')
        .select('id_questionario, escala_minima, escala_maxima, is_voto_popular')
        .eq('id_questionario', idQuestionario)
        .single())
      if (quest.error) throw new Error(`Não consegui ler o questionário: ${quest.error.message}`)
      const perguntas = await medir('select perguntas_questionario', () => cliente
        .from('perguntas_questionario')
        .select('id_pergunta, ordem')
        .eq('id_questionario', idQuestionario)
        .order('ordem'))
      if (perguntas.error) throw new Error(`Não consegui ler as perguntas: ${perguntas.error.message}`)
      if ((perguntas.data ?? []).length === 0) {
        throw new Error(`Questionário ${idQuestionario} sem perguntas no banco.`)
      }
      return {
        escalaMinima: Number(quest.data.escala_minima),
        escalaMaxima: Number(quest.data.escala_maxima),
        perguntas: perguntas.data.map((pergunta) => pergunta.id_pergunta),
      }
    })())
  }
  return ctx.cacheQuestionarios.get(idQuestionario)
}

/** Uma resposta por pergunta, com nota dentro da escala daquele questionário. */
function montarRespostas(questionario, sorteio) {
  const faixa = Math.floor(questionario.escalaMaxima - questionario.escalaMinima) + 1
  return questionario.perguntas.map((idPergunta) => ({
    id_pergunta: idPergunta,
    nota: questionario.escalaMinima + Math.floor(sorteio() * faixa),
  }))
}

// ---------------------------------------------------------------------- atores

/**
 * Invariante 9: antes do pareamento, avaliador_atual() é nulo — o perfil não é de
 * avaliador e o sorteio é recusado. Registrado para TODOS os atores, com destaque
 * para os que entraram sem credenciamento.
 */
async function conferirAntesDoPareamento(ctx, ator, cliente) {
  const perfil = await medir('fn_meu_perfil (antes do pareamento)', () => cliente.rpc('fn_meu_perfil'))
  ator.perfilAntes = perfil.data?.papel ?? null

  const sorteio = await medir('sortear_proximo_projeto (antes do pareamento)', () => cliente
    .rpc('sortear_proximo_projeto', { p_id_usuario: ator.idUsuario, p_id_evento: ctx.idEvento }))
  ator.sorteioAntesRecusado = Boolean(sorteio.error)
}

async function atorAvaliador(ctx, ator) {
  const cliente = criarCliente(ctx)
  ator.cliente = cliente
  const sorteio = criarSorteio(ator.semente)

  const anonima = await medir('auth.signInAnonymously', () => cliente.auth.signInAnonymously())
  if (anonima.error) { ator.exaurido = true; ator.motivoFim = 'sessão anônima recusada'; return }

  await conferirAntesDoPareamento(ctx, ator, cliente)

  const pedido = await medir('fn_solicitar_pareamento', () => cliente.rpc('fn_solicitar_pareamento'))
  if (pedido.error || !pedido.data?.codigo) {
    ator.exaurido = true
    ator.motivoFim = 'não consegui pedir pareamento'
    return
  }

  try {
    await comLimiteDeTempo(
      new Promise((resolver, rejeitar) => {
        ctx.filaPareamento.push({ codigo: pedido.data.codigo, idUsuario: ator.idUsuario, resolver, rejeitar })
      }),
      LIMITE_PAREAMENTO_MS,
      'pareamento pelo staff',
    )
  } catch (erro) {
    somar(metrica('fn_parear_dispositivo').erros, resumirMensagem(erro.message))
    ator.exaurido = true
    ator.motivoFim = 'pareamento não aconteceu'
    return
  }

  // O vínculo vem do banco (questionario_do_avaliador, via fn_meu_perfil), não de palpite.
  const perfil = await medir('fn_meu_perfil (avaliador)', () => cliente.rpc('fn_meu_perfil'))
  if (perfil.error) { ator.exaurido = true; ator.motivoFim = 'fn_meu_perfil falhou'; return }
  ator.perfilDepois = perfil.data?.papel ?? null
  if (perfil.data?.papel !== 'avaliador') {
    somar(metrica('fn_meu_perfil (avaliador)').erros,
      `perfil veio como "${perfil.data?.papel ?? 'nenhum'}" depois do pareamento`)
    ator.exaurido = true
    ator.motivoFim = 'perfil não virou avaliador'
    return
  }
  ator.questionarioVinculado = perfil.data?.id_questionario_vinculado ?? null
  ator.ehVotante = perfil.data?.voto_popular === true
  ator.pareado = true
  ctx.pareados += 1

  const limite = ctx.opcoes.ateConcluir ? Infinity : ctx.opcoes.porAvaliador
  let tentativasErradas = 0

  while (ctx.rodadaAtiva && !ator.exaurido && ator.enviadas < limite && ator.ciclos < TETO_CICLOS_POR_AVALIADOR) {
    ator.ciclos += 1

    const sorteado = await medir('sortear_proximo_projeto', () => cliente.rpc('sortear_proximo_projeto', {
      p_id_usuario: ator.idUsuario,
      p_id_evento: ctx.idEvento,
    }))
    if (sorteado.error) { ator.exaurido = true; ator.motivoFim = `sorteio recusado: ${sorteado.error.message}`; break }
    const idProjeto = typeof sorteado.data === 'object' && sorteado.data !== null
      ? Object.values(sorteado.data)[0]
      : sorteado.data
    if (!idProjeto) {
      metrica('sortear_proximo_projeto').vazios += 1
      ator.vazios += 1
      // Duas razões para insistir antes de desistir: o staff ainda está liberando
      // check-in, e um projeto elegível pode estar travado por outro avaliador
      // neste instante (o sorteio não oferece projeto travado).
      const esperando = ctx.filaCheckin.length > 0 || ctx.checkinEmCurso > 0
      if (ctx.opcoes.ateConcluir && (esperando || ator.vazios < VAZIOS_ATE_DESISTIR)) {
        await dormir(ESPERA_SEM_ELEGIVEL_MS)
        continue
      }
      ator.exaurido = true
      ator.motivoFim = 'nenhum projeto elegível'
      break
    }

    const projeto = await medir('select projetos', () => cliente
      .from('projetos')
      .select('id_projeto, codigo_projeto, id_questionario_fixado')
      .eq('id_projeto', idProjeto)
      .single())
    if (projeto.error) { ator.exaurido = true; ator.motivoFim = 'não consegui ler o projeto sorteado'; break }

    // Chegar no estande e ler a ficha: a primeira das duas pausas de --ritmo-ms.
    await pensar(ctx)

    const idQuestionario = resolverQuestionario(ctx, ator, projeto.data)
    let questionario
    try {
      questionario = await lerQuestionarioDoBanco(ctx, cliente, idQuestionario)
    } catch (erro) {
      somar(metrica('select questionarios').erros, resumirMensagem(erro.message))
      ator.exaurido = true
      ator.motivoFim = 'não consegui ler o questionário resolvido'
      break
    }

    // Caso negativo esperado: avaliador vinculado mandando outro questionário.
    // Só nas primeiras voltas — o que importa é provar a regra, não inflar a carga.
    const errado = ator.questionarioVinculado ? questionarioErrado(ctx, ator) : null
    if (errado && tentativasErradas < TENTATIVAS_QUESTIONARIO_ERRADO) {
      tentativasErradas += 1
      try {
        const outro = await lerQuestionarioDoBanco(ctx, cliente, errado.id_questionario)
        await medir('fn_enviar_avaliacao (questionário errado)', () => cliente.rpc('fn_enviar_avaliacao', {
          p_id_usuario: ator.idUsuario,
          p_id_projeto: idProjeto,
          p_id_questionario: errado.id_questionario,
          p_respostas: montarRespostas(outro, sorteio),
          p_parecer: 'Tentativa com questionário fora do vínculo (caso negativo esperado).',
          p_tempo_presenca: new Date().toISOString(),
        }))
      } catch (erro) {
        somar(metrica('fn_enviar_avaliacao (questionário errado)').erros, resumirMensagem(erro.message))
      }
    }

    const envio = await medir('fn_enviar_avaliacao', () => cliente.rpc('fn_enviar_avaliacao', {
      p_id_usuario: ator.idUsuario,
      p_id_projeto: idProjeto,
      p_id_questionario: idQuestionario,
      p_respostas: montarRespostas(questionario, sorteio),
      p_parecer: `Simulação de carga — ${projeto.data.codigo_projeto}.`,
      p_tempo_presenca: new Date().toISOString(),
    }))
    if (!envio.error) {
      ator.vazios = 0
      ator.enviadas += 1
      ctx.enviadas += 1
      if (ator.ehVotante) ctx.votosEnviados += 1
      // Caminhar até o próximo estande: a segunda pausa de --ritmo-ms.
      await pensar(ctx)
      continue
    }

    const mensagem = envio.error.message ?? ''
    if (/Cota de avalia[çc][õo]es do projeto j[áa] atingida/i.test(mensagem)) {
      ctx.recusasPorCota.push({ idProjeto, idUsuario: ator.idUsuario })
      continue
    }
    // Projeto fixado em outro questionário e o avaliador está vinculado: ele nunca
    // vai conseguir avaliar este projeto. O caminho real é registrar o impedimento,
    // que solta a trava e tira o projeto do sorteio DELE.
    const semSaida = /projeto j[áa] [ée] avaliado com outro question/i.test(mensagem)
      || ator.projetosQueFalharam.has(idProjeto)
    ator.projetosQueFalharam.add(idProjeto)
    if (semSaida) {
      const impedimento = await medir('fn_registrar_impedimento', () => cliente
        .rpc('fn_registrar_impedimento', { p_id_projeto: idProjeto, p_tipo: 'conflito' }))
      if (!impedimento.error) ctx.impedimentos += 1
      else { ator.exaurido = true; ator.motivoFim = `impedimento recusado: ${impedimento.error.message}` }
      continue
    }
    if (envio.classe?.tipo === 'negativo' || envio.classe?.tipo === 'limite') continue
    ator.exaurido = true
    ator.motivoFim = `envio recusado: ${mensagem}`
  }

  if (!ator.motivoFim && ator.enviadas >= limite) ator.motivoFim = 'cota de avaliações do ator'
  if (!ator.motivoFim) ator.motivoFim = 'rodada encerrada'
  // Com --finalizar, a primeira sessão pareada fica viva para a sonda de depois:
  // é ela que mostra se um avaliador ainda sorteia ou envia com a feira encerrada.
  if (ctx.opcoes.finalizar && !ctx.sondaAvaliador && ator.pareado) ctx.sondaAvaliador = ator
  else await cliente.auth.signOut()
}

async function atorStaff(ctx, cliente) {
  while (true) {
    const pedido = ctx.filaPareamento.shift()
    if (pedido) {
      const resposta = await medir('fn_parear_dispositivo', () => cliente.rpc('fn_parear_dispositivo', {
        p_codigo: pedido.codigo,
        p_id_usuario: pedido.idUsuario,
      }))
      if (resposta.error) pedido.rejeitar(new Error(resposta.error.message))
      else pedido.resolver(resposta.data)
      continue
    }
    const idProjeto = ctx.filaCheckin.shift()
    if (idProjeto) {
      ctx.checkinEmCurso += 1
      const resposta = await medir('fn_check_in_projeto', () => cliente.rpc('fn_check_in_projeto', {
        p_id_projeto: idProjeto,
        p_check_in: true,
      }))
      if (!resposta.error) ctx.checkinsFeitos += 1
      ctx.checkinEmCurso -= 1
      await dormir(ctx.opcoes.checkinMs)
      continue
    }
    if (!ctx.rodadaAtiva) break
    await dormir(25)
  }
  await cliente.auth.signOut()
}

async function atorTelao(ctx) {
  const cliente = criarCliente(ctx)
  while (ctx.rodadaAtiva) {
    await medir('fn_telao_resumo', () => cliente.rpc('fn_telao_resumo', { p_id_evento: ctx.idEvento }))
    await dormir(ctx.opcoes.telaoMs)
  }
}

/**
 * Com a rodada em andamento, uma sessão de Admin tenta mudar peso_calculo de um
 * questionário já usado. O esperado é a recusa ("já foi usado em N avaliação(ões)").
 * Uma aceitação com avaliação já gravada é a corrida da invariante 6.
 */
async function atorMutacaoQuestionario(ctx, cliente) {
  const idQuestionario = ctx.questionarioTecnico.id_questionario

  while (ctx.rodadaAtiva) {
    const definicao = ctx.definicoesBase.get(idQuestionario)
    const perguntas = [...definicao.perguntas.entries()]
      .sort((a, b) => a[1].ordem - b[1].ordem)
      .map(([idPergunta, dados], indice) => ({
        id_pergunta: idPergunta,
        texto_pergunta: dados.texto_pergunta,
        peso_calculo: indice === 0 ? Number((dados.peso_calculo + 0.25).toFixed(2)) : dados.peso_calculo,
        peso_desempate: dados.peso_desempate,
      }))

    const usosAntes = await ctx.admin
      .from('avaliacoes')
      .select('id_avaliacao', { count: 'exact', head: true })
      .eq('id_questionario', idQuestionario)

    const tentativa = await medir('admin_salvar_questionario (peso sob uso)', () => cliente
      .rpc('admin_salvar_questionario', {
        p_id_questionario: idQuestionario,
        p_id_evento: ctx.idEvento,
        p_titulo: ctx.questionarioTecnico.titulo,
        p_escala_minima: definicao.escala_minima,
        p_escala_maxima: definicao.escala_maxima,
        p_perguntas: perguntas,
      }))
    ctx.mutacoes.tentativas += 1

    if (!tentativa.error) {
      const usos = usosAntes.count ?? 0
      if (usos > 0) ctx.mutacoes.aceitasEmUso += 1
      else ctx.mutacoes.aceitasSemUso += 1
      // A definição aceita passa a ser a nova base de comparação da invariante 6.
      const atual = await lerDefinicoesAtuais(ctx)
      ctx.definicoesBase = atual.definicoes
    }
    await dormir(ctx.opcoes.mutacaoMs)
  }
  await cliente.auth.signOut()
}

/**
 * DOIS admins na MESMA avaliação, ao mesmo tempo: um corrige as respostas por critério
 * (admin_corrigir_respostas_avaliacao) e o outro arbitra a nota final
 * (admin_arbitrar_nota_final). As duas gravam `nota_final` e `ajuste_tipo` da mesma
 * linha, por caminhos diferentes — corrigir deriva a nota das respostas, arbitrar a
 * impõe —, então um lost update deixaria a linha incoerente: `ajuste_tipo` de uma e
 * `nota_final` da outra. É a corrida que pgTAP não alcança, porque roda numa sessão só.
 *
 * As duas funções fazem `FOR UPDATE OF a` na avaliação, então o esperado é
 * serialização: uma espera a outra e a última a escrever define as DUAS colunas. A
 * invariante 10 é quem cobra isso; aqui só se produz a disputa e se registra o alvo.
 */
async function atorDisputaDeNota(ctx, clienteA, clienteB) {
  while (ctx.rodadaAtiva) {
    const alvo = await escolherAvaliacaoParaDisputa(ctx)
    if (!alvo) { await dormir(ctx.opcoes.disputaMs); continue }

    let questionario
    try {
      questionario = await lerQuestionarioDoBanco(ctx, ctx.admin, alvo.id_questionario)
    } catch { await dormir(ctx.opcoes.disputaMs); continue }

    // criarSorteio espera número: a semente vem da ordem da disputa, para a rodada
    // ser reproduzível sem depender do UUID sorteado pelo banco.
    const sorteio = criarSorteio(ctx.disputas.tentativas * 7919 + 13)
    const respostas = montarRespostas(questionario, sorteio)
    // Dentro da escala, senão a recusa viria da validação e não haveria disputa.
    const arbitrada = Number(
      (questionario.escalaMinima + (questionario.escalaMaxima - questionario.escalaMinima) * 0.5).toFixed(2))

    ctx.disputas.tentativas += 1
    ctx.disputas.alvos.set(alvo.id_avaliacao, { respostas, arbitrada })

    const [corrigir, arbitrar] = await Promise.all([
      medir('admin_corrigir_respostas_avaliacao (disputa)', () => clienteA
        .rpc('admin_corrigir_respostas_avaliacao', {
          p_id_avaliacao: alvo.id_avaliacao,
          p_respostas: respostas,
          p_motivo: 'disputa de nota na simulação',
        })),
      medir('admin_arbitrar_nota_final (disputa)', () => clienteB
        .rpc('admin_arbitrar_nota_final', {
          p_id_avaliacao: alvo.id_avaliacao,
          p_nota: arbitrada,
          p_motivo: 'disputa de nota na simulação',
        })),
    ])
    if (corrigir.error) somar(ctx.disputas.recusas, resumirMensagem(corrigir.error.message))
    else ctx.disputas.corrigidas += 1
    if (arbitrar.error) somar(ctx.disputas.recusas, resumirMensagem(arbitrar.error.message))
    else ctx.disputas.arbitradas += 1

    await dormir(ctx.opcoes.disputaMs)
  }
  await Promise.all([clienteA.auth.signOut(), clienteB.auth.signOut()])
}

/** Uma avaliação técnica já gravada nesta rodada, ainda não disputada. */
async function escolherAvaliacaoParaDisputa(ctx) {
  const { data, error } = await medir('select avaliacoes (disputa)', () => ctx.admin
    .from('avaliacoes')
    .select('id_avaliacao, id_questionario, projetos!inner(id_evento)')
    .eq('projetos.id_evento', ctx.idEvento)
    .eq('is_voto_popular', false)
    .not('id_questionario', 'is', null)
    .order('tempo_submissao', { ascending: false })
    .limit(40))
  if (error || !data) return null
  return data.find((linha) => !ctx.disputas.alvos.has(linha.id_avaliacao)) ?? null
}

/**
 * Autocadastro: endpoint público, com pg_advisory_xact_lock global e throttle
 * próprio. Serialização e recusa ali são desenho, não gargalo.
 */
async function rajadaAutocadastro(ctx) {
  if (ctx.opcoes.autocadastro < 1) return
  const cliente = criarCliente(ctx)
  const carimbo = Date.now()
  const instituicoes = await lerTudo(() => ctx.admin
    .from('instituicoes')
    .select('id_instituicao')
    .eq('id_evento', ctx.idEvento))

  await Promise.all(Array.from({ length: ctx.opcoes.autocadastro }, (_, indice) => medir(
    'fn_autocadastro_avaliador',
    () => cliente.rpc('fn_autocadastro_avaliador', {
      p_id_evento: ctx.idEvento,
      p_nome: `Avaliador Autocadastro ${indice + 1}`,
      p_email: `autocadastro.${carimbo}.${indice + 1}@simulacao.invalid`,
      p_id_instituicao: instituicoes[indice % instituicoes.length]?.id_instituicao ?? null,
      p_nome_instituicao_nova: null,
      p_ids_areas: [],
    }),
  )))
}

/**
 * Vigia do modo drenagem: fecha a rodada quando a feira conclui, quando ninguém
 * tem mais projeto elegível, quando duas varreduras seguidas de todos os
 * avaliadores não produzem avaliação nova (impasse) ou nos tetos de tempo e
 * iterações. Nunca fica em laço.
 */
async function vigiaDrenagem(ctx) {
  const inicio = Date.now()
  let semProgresso = 0

  while (ctx.rodadaAtiva) {
    await dormir(ESPERA_SEM_ELEGIVEL_MS)
    const marcas = ctx.atores.map((ator) => ator.ciclos)
    const enviadasAntes = ctx.enviadas
    const prazo = Date.now() + ESPERA_VARREDURA_MS
    while (ctx.rodadaAtiva) {
      const deramVolta = ctx.atores.every((ator, indice) => ator.exaurido || ator.ciclos > marcas[indice])
      if (deramVolta || Date.now() > prazo) break
      await dormir(50)
    }
    ctx.varreduras += 1
    semProgresso = ctx.enviadas === enviadasAntes ? semProgresso + 1 : 0

    const concluida = await medir('fn_feira_concluida', () => ctx.admin
      .rpc('fn_feira_concluida', { p_id_evento: ctx.idEvento }))
    const checkinPendente = ctx.filaCheckin.length > 0 || ctx.checkinEmCurso > 0

    if (concluida.data === true && !checkinPendente) { ctx.fimDaRodada = 'feira concluída (fn_feira_concluida)'; break }
    if (!checkinPendente && ctx.atores.every((ator) => ator.exaurido)) {
      ctx.fimDaRodada = 'todos os avaliadores ficaram sem projeto elegível'
      break
    }
    if (!checkinPendente && semProgresso >= 2) {
      ctx.fimDaRodada = 'impasse: duas varreduras seguidas sem avaliação nova'
      break
    }
    if (ctx.varreduras >= ctx.opcoes.tetoVarreduras) { ctx.fimDaRodada = 'teto de varreduras'; break }
    if (Date.now() - inicio > ctx.opcoes.tetoMs) { ctx.fimDaRodada = 'teto de tempo de parede'; break }
  }
  ctx.rodadaAtiva = false
}

// ----------------------------------------------------------------- invariantes

/**
 * Invariante 10: a nota que sobreviveu à disputa combina com o ajuste que sobreviveu.
 *
 * Duas escritas concorrentes na mesma avaliação, por caminhos diferentes: corrigir
 * DERIVA nota_final das respostas gravadas; arbitrar a IMPÕE sem tocar nas respostas.
 * As duas também gravam ajuste_tipo. Serializadas, a última a escrever define as duas
 * colunas e a linha fica coerente. Num lost update a linha mistura as duas: ajuste_tipo
 * de uma com nota_final da outra — e aí a nota que decide a premiação não vem de lugar
 * nenhum que alguém possa reconstituir.
 *
 * Coerência cobrada, por avaliação disputada:
 *   ajuste_tipo = 'nota_arbitrada'       -> nota_final é a nota que a arbitragem mandou;
 *   ajuste_tipo = 'respostas_corrigidas' -> nota_final é Σ(nota×peso) ÷ Σ(pesos) das
 *                                           respostas que estão gravadas agora.
 * E, de fora: fn_auditar_notas não acusa C1 grave em nenhuma delas — é a conferência do
 * próprio sistema dizendo que a conta fecha.
 */
async function conferirDisputaDeNota(ctx, estado) {
  const ids = [...ctx.disputas.alvos.keys()]
  if (ids.length === 0) {
    return { ok: true, detalhe: 'nenhuma disputa executada: rodada curta demais para haver nota gravada' }
  }

  const linhas = []
  const respostas = []
  for (const bloco of emBlocos(ids, 200)) {
    linhas.push(...await lerTudo(() => ctx.admin
      .from('avaliacoes')
      .select('id_avaliacao, id_questionario, nota_final, ajuste_tipo')
      .in('id_avaliacao', bloco)))
    respostas.push(...await lerTudo(() => ctx.admin
      .from('respostas_avaliacao')
      .select('id_avaliacao, id_pergunta, nota_atribuida')
      .in('id_avaliacao', bloco)))
  }

  const porAvaliacao = new Map()
  for (const r of respostas) {
    if (!porAvaliacao.has(r.id_avaliacao)) porAvaliacao.set(r.id_avaliacao, [])
    porAvaliacao.get(r.id_avaliacao).push(r)
  }

  const incoerentes = []
  for (const linha of linhas) {
    const alvo = ctx.disputas.alvos.get(linha.id_avaliacao)
    const nota = Number(linha.nota_final)

    if (linha.ajuste_tipo === 'nota_arbitrada') {
      if (Math.abs(nota - alvo.arbitrada) > 0.005) {
        incoerentes.push(`${linha.id_avaliacao}: ajuste_tipo arbitrada, nota ${nota} ≠ ${alvo.arbitrada}`)
      }
      continue
    }
    if (linha.ajuste_tipo === 'respostas_corrigidas') {
      const definicao = estado.atual.definicoes.get(linha.id_questionario)
      const gravadas = porAvaliacao.get(linha.id_avaliacao) ?? []
      let produtos = 0
      let pesos = 0
      for (const r of gravadas) {
        const peso = definicao?.perguntas.get(r.id_pergunta)?.peso_calculo ?? 0
        if (peso <= 0) continue
        produtos += Number(r.nota_atribuida) * peso
        pesos += peso
      }
      const esperada = pesos > 0 ? Math.round((produtos / pesos) * 100) / 100 : null
      if (esperada === null || Math.abs(nota - esperada) > 0.005) {
        incoerentes.push(`${linha.id_avaliacao}: ajuste_tipo corrigidas, nota ${nota} ≠ ${esperada} das respostas`)
      }
      continue
    }
    incoerentes.push(`${linha.id_avaliacao}: ajuste_tipo inesperado "${linha.ajuste_tipo}" depois da disputa`)
  }

  const achados = await medir('fn_auditar_notas (disputa)', () => ctx.admin
    .rpc('fn_auditar_notas', { p_id_evento: ctx.idEvento }))
  const graves = (achados.data ?? []).filter((a) => a.codigo === 'C1' && a.severidade === 'grave'
    && ctx.disputas.alvos.has(a.id_avaliacao))

  const recusas = [...ctx.disputas.recusas.entries()].map(([msg, n]) => `${n}× ${msg}`)
  return {
    ok: incoerentes.length === 0 && graves.length === 0 && !achados.error,
    detalhe: incoerentes.length === 0 && graves.length === 0
      ? `${ids.length} avaliação(ões) disputada(s) por dois admins ao mesmo tempo; ` +
        `${ctx.disputas.corrigidas} correção(ões) e ${ctx.disputas.arbitradas} arbitragem(ns) aceitas; ` +
        'nota e ajuste_tipo coerentes em todas, e nenhum C1 grave' +
        (recusas.length > 0 ? ` (recusas: ${recusas.join('; ')})` : '')
      : [...incoerentes.slice(0, 5),
         ...graves.slice(0, 5).map((a) => `C1 grave em ${a.codigo_projeto}`)].join('; '),
  }
}

async function coletarEstadoFinal(ctx) {
  const situacao = await medir('fn_projetos_situacao', () => ctx.admin
    .rpc('fn_projetos_situacao', { p_id_evento: ctx.idEvento }))
  if (situacao.error) throw new Error(`fn_projetos_situacao falhou: ${situacao.error.message}`)

  const projetos = await lerTudo(() => ctx.admin
    .from('projetos')
    .select('id_projeto, codigo_projeto, id_instituicao, id_modalidade, id_questionario_fixado, ' +
            'is_check_in_realizado, is_fora_da_competicao, cota_avaliacoes_customizada')
    .eq('id_evento', ctx.idEvento))

  const avaliacoes = await lerTudo(() => ctx.admin
    .from('avaliacoes')
    .select('id_avaliacao, id_projeto, id_usuario, id_questionario, status, is_voto_popular, is_quarentena, ' +
            'tempo_submissao, projetos!inner(id_evento, id_instituicao)')
    .eq('projetos.id_evento', ctx.idEvento))

  const travas = await lerTudo(() => ctx.admin
    .from('locks_ativos')
    .select('id_usuario, id_projeto, expira_em, is_voto_popular, projetos!inner(id_evento)')
    .eq('projetos.id_evento', ctx.idEvento))

  const inscritos = await lerTudo(() => ctx.admin
    .from('avaliadores_evento')
    .select('id_usuario, id_instituicao, id_questionario, is_credenciado')
    .eq('id_evento', ctx.idEvento))

  const bloqueios = await lerTudo(() => ctx.admin
    .from('avaliador_modalidades_bloqueadas')
    .select('id_usuario, id_modalidade')
    .eq('id_evento', ctx.idEvento))

  const impedimentos = await lerTudo(() => ctx.admin
    .from('historico_impedimentos')
    .select('id_usuario, id_projeto, tipo, projetos!inner(id_evento)')
    .eq('projetos.id_evento', ctx.idEvento))

  const ativas = avaliacoes.filter((linha) => (linha.status ?? '') !== 'CANCELADA')
  const respostas = []
  for (const bloco of emBlocos(ativas.map((linha) => linha.id_avaliacao), 200)) {
    respostas.push(...await lerTudo(() => ctx.admin
      .from('respostas_avaliacao')
      .select('id_avaliacao, id_pergunta')
      .in('id_avaliacao', bloco)))
  }

  const atual = await lerDefinicoesAtuais(ctx)
  return {
    situacao: situacao.data ?? [], projetos, avaliacoes, ativas, travas, inscritos,
    bloqueios, impedimentos, respostas, atual,
  }
}

async function lerTrilha(ctx, tabela, coluna, ids) {
  // Em log_auditoria, projetos entram por codigo_projeto em id_registro, mas id_projeto é preenchido.
  if (!ctx.marcoRodada || ids.length === 0) return []
  const linhas = []
  for (const bloco of emBlocos(ids, 100)) {
    linhas.push(...await lerTudo(() => ctx.admin
      .from('log_auditoria')
      .select('tabela, operacao, id_registro, id_projeto, criado_em, campos_alterados, dados_depois')
      .eq('tabela', tabela)
      .gte('criado_em', ctx.marcoRodada)
      .in(coluna, bloco)))
  }
  return linhas
}

function conferirCota(estado) {
  const furos = estado.situacao.filter((linha) => linha.avaliacoes_tecnicas > linha.cota)
  return {
    ok: furos.length === 0,
    detalhe: furos.length === 0
      ? `${estado.situacao.length} projetos dentro da cota`
      : furos.slice(0, 5).map((linha) => `${linha.id_projeto}: ${linha.avaliacoes_tecnicas}/${linha.cota}`).join('; '),
  }
}

function conferirDuplicidade(estado) {
  const contagem = new Map()
  for (const avaliacao of estado.ativas) {
    somar(contagem, `${avaliacao.id_usuario}|${avaliacao.id_projeto}`)
  }
  const furos = [...contagem.entries()].filter(([, total]) => total > 1)
  return {
    ok: furos.length === 0,
    detalhe: furos.length === 0
      ? `${estado.ativas.length} avaliações ativas, nenhum par repetido`
      : `${furos.length} par(es) com avaliação duplicada`,
  }
}

function conferirTravas(estado) {
  const comAvaliacao = new Set(estado.avaliacoes.map((linha) => `${linha.id_usuario}|${linha.id_projeto}`))
  const agora = Date.now()
  const orfas = []
  const naoLiberadas = []
  let emAndamento = 0
  for (const trava of estado.travas) {
    const chave = `${trava.id_usuario}|${trava.id_projeto}`
    if (comAvaliacao.has(chave)) naoLiberadas.push(chave)
    else if (new Date(trava.expira_em).getTime() < agora) orfas.push(chave)
    else emAndamento += 1
  }
  return {
    ok: orfas.length === 0 && naoLiberadas.length === 0,
    detalhe: orfas.length === 0 && naoLiberadas.length === 0
      ? `${estado.travas.length} travas, ${emAndamento} válidas em andamento`
      : `${orfas.length} vencida(s) sem avaliação, ${naoLiberadas.length} não liberada(s) após a nota`,
  }
}

function conferirConflitoInstitucional(estado) {
  const instituicaoDoAvaliador = new Map(estado.inscritos.map((linha) => [linha.id_usuario, linha.id_instituicao]))
  const furos = estado.ativas.filter((avaliacao) => {
    const doAvaliador = instituicaoDoAvaliador.get(avaliacao.id_usuario)
    const doProjeto = avaliacao.projetos?.id_instituicao
    return doAvaliador && doProjeto && doAvaliador === doProjeto
  })
  return {
    ok: furos.length === 0,
    detalhe: furos.length === 0
      ? `${estado.ativas.length} avaliações ativas sem conflito de instituição`
      : `${furos.length} avaliação(ões) entre avaliador e projeto da mesma instituição`,
  }
}

function conferirQuestionarioResolvido(ctx, estado) {
  const doEvento = new Set(estado.atual.questionarios.map((linha) => linha.id_questionario))
  const vinculo = new Map(estado.inscritos.map((linha) => [linha.id_usuario, linha.id_questionario]))
  const foraDoEvento = estado.ativas.filter((linha) => !doEvento.has(linha.id_questionario))
  const daRodada = ctx.marcoRodada
    ? estado.ativas.filter((linha) => new Date(linha.tempo_submissao).getTime() >= new Date(ctx.marcoRodada).getTime())
    : estado.ativas
  const foraDoVinculo = daRodada.filter((linha) => {
    const vinculado = vinculo.get(linha.id_usuario)
    return vinculado && vinculado !== linha.id_questionario
  })
  return {
    ok: foraDoEvento.length === 0 && foraDoVinculo.length === 0,
    detalhe: foraDoEvento.length === 0 && foraDoVinculo.length === 0
      ? `${daRodada.length} avaliações da rodada com o questionário que a regra manda`
      : `${foraDoEvento.length} com questionário de outro evento, ${foraDoVinculo.length} fora do vínculo`,
  }
}

function conferirRespostasEPesos(ctx, estado, trilhaPerguntas, trilhaQuestionarios) {
  const perguntaPertence = new Map(estado.atual.perguntas.map((linha) => [linha.id_pergunta, linha.id_questionario]))
  const totalPerguntas = new Map()
  for (const pergunta of estado.atual.perguntas) somar(totalPerguntas, pergunta.id_questionario)

  const porAvaliacao = new Map()
  for (const resposta of estado.respostas) {
    if (!porAvaliacao.has(resposta.id_avaliacao)) porAvaliacao.set(resposta.id_avaliacao, [])
    porAvaliacao.get(resposta.id_avaliacao).push(resposta.id_pergunta)
  }

  const orfas = []
  const contagemErrada = []
  for (const avaliacao of estado.ativas) {
    const minhas = porAvaliacao.get(avaliacao.id_avaliacao) ?? []
    for (const idPergunta of minhas) {
      if (perguntaPertence.get(idPergunta) !== avaliacao.id_questionario) orfas.push(idPergunta)
    }
    if (minhas.length !== (totalPerguntas.get(avaliacao.id_questionario) ?? 0)) {
      contagemErrada.push(avaliacao.id_avaliacao)
    }
  }

  // Pesos, ordem, texto e escala de questionário em uso não podem mudar durante a rodada.
  const emUso = new Set(estado.ativas.map((linha) => linha.id_questionario))
  const alterados = []
  for (const idQuestionario of emUso) {
    const base = ctx.definicoesBase.get(idQuestionario)
    const agora = estado.atual.definicoes.get(idQuestionario)
    if (!base || !agora) { alterados.push(`${idQuestionario}: questionário apareceu/desapareceu`); continue }
    if (base.escala_minima !== agora.escala_minima || base.escala_maxima !== agora.escala_maxima) {
      alterados.push(`${idQuestionario}: escala`)
    }
    for (const [idPergunta, valores] of base.perguntas) {
      const atuais = agora.perguntas.get(idPergunta)
      if (!atuais) { alterados.push(`${idPergunta}: pergunta removida`); continue }
      for (const campo of ['ordem', 'texto_pergunta', 'peso_calculo', 'peso_desempate']) {
        if (valores[campo] !== atuais[campo]) alterados.push(`${idPergunta}: ${campo}`)
      }
    }
  }

  // A trilha diz, com o relógio do banco, se a mudança veio DEPOIS do primeiro uso.
  const primeiroUso = new Map()
  for (const avaliacao of estado.ativas) {
    const instante = new Date(avaliacao.tempo_submissao).getTime()
    const atual = primeiroUso.get(avaliacao.id_questionario)
    if (atual === undefined || instante < atual) primeiroUso.set(avaliacao.id_questionario, instante)
  }
  const camposVigiados = ['peso_calculo', 'peso_desempate', 'ordem', 'texto_pergunta']
  const sobUso = []
  for (const linha of trilhaPerguntas) {
    const idQuestionario = perguntaPertence.get(linha.id_registro)
    const inicio = primeiroUso.get(idQuestionario)
    if (inicio === undefined) continue
    const mexeu = (linha.campos_alterados ?? []).some((campo) => camposVigiados.includes(campo))
    if (mexeu && new Date(linha.criado_em).getTime() > inicio) sobUso.push(`${linha.id_registro}`)
  }
  for (const linha of trilhaQuestionarios) {
    const inicio = primeiroUso.get(linha.id_registro)
    if (inicio === undefined) continue
    const mexeu = (linha.campos_alterados ?? []).some((campo) => ['escala_minima', 'escala_maxima'].includes(campo))
    if (mexeu && new Date(linha.criado_em).getTime() > inicio) sobUso.push(`${linha.id_registro}: escala`)
  }

  const ok = orfas.length === 0 && contagemErrada.length === 0 && alterados.length === 0 && sobUso.length === 0
  return {
    ok,
    detalhe: ok
      ? `${estado.respostas.length} respostas conferidas; nenhum peso alterado sob uso`
      : `${orfas.length} resposta(s) órfã(s), ${contagemErrada.length} com contagem errada, ` +
        `${alterados.length} campo(s) alterado(s) [${alterados.slice(0, 3).join(', ')}], ` +
        `${sobUso.length} mudança(s) na trilha depois do primeiro uso`,
  }
}

/**
 * Invariante 7: voto popular não consome cota. A contagem que fn_feira_concluida
 * usa (não canceladas, NOT is_voto_popular) não pode ser inflada por voto, e
 * nenhum projeto pode ser recusado por cota por causa deles.
 */
function conferirVotoPopularForaDaCota(ctx, estado) {
  const tecnicas = new Map()
  const votos = new Map()
  for (const avaliacao of estado.ativas) {
    somar(avaliacao.is_voto_popular === true ? votos : tecnicas, avaliacao.id_projeto)
  }
  const inflados = estado.situacao.filter((linha) => {
    const minhasTecnicas = tecnicas.get(linha.id_projeto) ?? 0
    const meusVotos = votos.get(linha.id_projeto) ?? 0
    return linha.avaliacoes_tecnicas !== minhasTecnicas || linha.votos_populares !== meusVotos
  })
  // Recusa por cota só vale se o projeto estava de fato com a cota técnica cheia.
  const cotaPorProjeto = new Map(estado.situacao.map((linha) => [linha.id_projeto, linha.cota]))
  const recusasIndevidas = ctx.recusasPorCota.filter((recusa) => {
    const cota = cotaPorProjeto.get(recusa.idProjeto) ?? ctx.cotaPadrao
    return (tecnicas.get(recusa.idProjeto) ?? 0) < cota
  })
  const totalVotos = [...votos.values()].reduce((soma, item) => soma + item, 0)
  const comCotaCheiaEVoto = estado.situacao
    .filter((linha) => linha.avaliacoes_tecnicas >= linha.cota && (votos.get(linha.id_projeto) ?? 0) > 0).length
  const ok = inflados.length === 0 && recusasIndevidas.length === 0
  return {
    ok,
    detalhe: ok
      ? `${totalVotos} votos populares fora da conta técnica; ${comCotaCheiaEVoto} projetos com cota cheia ainda receberam voto; ` +
        `${ctx.recusasPorCota.length} recusa(s) por cota, todas com a cota técnica cheia`
      : `${inflados.length} projeto(s) com contagem técnica inflada, ` +
        `${recusasIndevidas.length} recusa(s) por cota sem a cota técnica cheia`,
  }
}

/** Invariante 8: voto popular nunca fixa o questionário do projeto. */
function conferirFixacaoDoQuestionario(estado) {
  const votoPopular = new Set(estado.atual.questionarios
    .filter((quest) => quest.is_voto_popular === true)
    .map((quest) => quest.id_questionario))
  const furos = estado.projetos.filter((projeto) => projeto.id_questionario_fixado
    && votoPopular.has(projeto.id_questionario_fixado))
  const fixados = estado.projetos.filter((projeto) => projeto.id_questionario_fixado).length
  return {
    ok: furos.length === 0,
    detalhe: furos.length === 0
      ? `${fixados} projetos com questionário fixado, nenhum de voto popular`
      : `${furos.length} projeto(s) fixados em questionário de voto popular ` +
        `(${furos.slice(0, 3).map((projeto) => projeto.codigo_projeto).join(', ')})`,
  }
}

/**
 * Invariante 9: ninguém sorteia nem avalia antes de o staff parear o aparelho.
 * O instante do pareamento vem do relógio do banco (trilha de dispositivos).
 */
function conferirPareamentoAntesDeTudo(ctx, estado, trilhaDispositivos) {
  const pareadoEm = new Map()
  for (const linha of trilhaDispositivos) {
    const instante = Date.parse(linha.dados_depois?.vinculado_em ?? linha.criado_em)
    if (Number.isNaN(instante)) continue
    const atual = pareadoEm.get(linha.id_registro)
    if (atual === undefined || instante < atual) pareadoEm.set(linha.id_registro, instante)
  }

  const inicio = ctx.marcoRodada ? new Date(ctx.marcoRodada).getTime() : 0
  const porAvaliador = new Map()
  for (const avaliacao of estado.ativas) {
    if (new Date(avaliacao.tempo_submissao).getTime() < inicio) continue
    if (!porAvaliador.has(avaliacao.id_usuario)) porAvaliador.set(avaliacao.id_usuario, [])
    porAvaliador.get(avaliacao.id_usuario).push(new Date(avaliacao.tempo_submissao).getTime())
  }

  const furos = []
  let semCredencialAntes = 0
  let resolvidos = 0
  let semMarco = 0
  for (const ator of ctx.atores) {
    if (!ator.credenciadoAntes) semCredencialAntes += 1
    if (ator.perfilAntes === 'avaliador') furos.push(`${ator.idUsuario}: perfil já era avaliador antes do pareamento`)
    if (ator.sorteioAntesRecusado !== true) furos.push(`${ator.idUsuario}: sorteou antes do pareamento`)
    if (!ator.pareado) continue
    if (ator.perfilDepois !== 'avaliador') furos.push(`${ator.idUsuario}: perfil não resolveu depois do pareamento`)
    else resolvidos += 1
    const marco = pareadoEm.get(ator.idUsuario)
    if (marco === undefined) { semMarco += 1; continue }
    const antes = (porAvaliador.get(ator.idUsuario) ?? []).filter((instante) => instante < marco)
    if (antes.length > 0) furos.push(`${ator.idUsuario}: ${antes.length} avaliação(ões) antes do pareamento`)
  }
  return {
    ok: furos.length === 0,
    detalhe: furos.length === 0
      ? `${ctx.atores.length} atores (${semCredencialAntes} sem credenciamento na largada): ` +
        `avaliador_atual() nulo e sorteio recusado antes do pareamento, ${resolvidos} resolvidos depois` +
        (semMarco > 0 ? `; ${semMarco} sem linha de pareamento na trilha desta rodada` : '')
      : `${furos.length} furo(s): ${furos.slice(0, 3).join('; ')}`,
  }
}

/** Auxiliar: o sorteio ignorou os projetos sem check-in até o staff fazer o check-in? */
function conferirCheckIn(ctx, estado, trilhaProjetos) {
  if (ctx.projetosLimpos.length === 0) return { ok: true, detalhe: 'nenhum projeto teve o check-in limpo' }
  if (!ctx.marcoRodada) return { ok: true, detalhe: 'sem marco na trilha: checagem não aplicada' }

  const restaurado = new Map()
  for (const linha of trilhaProjetos) {
    if (linha.dados_depois?.is_check_in_realizado !== true) continue
    if (!(linha.campos_alterados ?? []).includes('is_check_in_realizado')) continue
    const instante = new Date(linha.criado_em).getTime()
    const atual = restaurado.get(linha.id_projeto)
    if (atual === undefined || instante < atual) restaurado.set(linha.id_projeto, instante)
  }

  // Só as avaliações DESTA rodada: um projeto pode ter nota de uma execução anterior,
  // gravada quando ele ainda estava com check-in.
  const inicio = new Date(ctx.marcoRodada).getTime()
  const limpos = new Set(ctx.projetosLimpos)
  const cedoDemais = estado.ativas.filter((avaliacao) => {
    if (!limpos.has(avaliacao.id_projeto)) return false
    const submissao = new Date(avaliacao.tempo_submissao).getTime()
    if (submissao < inicio) return false
    const liberado = restaurado.get(avaliacao.id_projeto)
    return liberado === undefined || submissao < liberado
  })
  return {
    ok: cedoDemais.length === 0,
    detalhe: cedoDemais.length === 0
      ? `${ctx.projetosLimpos.length} projetos sem check-in, ${restaurado.size} liberados pelo staff na rodada`
      : `${cedoDemais.length} avaliação(ões) em projeto antes do check-in`,
  }
}

/**
 * Relatório do modo drenagem: por projeto incompleto, quantas avaliações faltam e
 * por que nenhum avaliador técnico disponível é elegível. Este relatório é o
 * resultado mais valioso do modo, não um erro do script.
 */
function diagnosticarIncompletos(ctx, estado) {
  const tecnicos = ctx.atores.filter((ator) => ator.grupo !== 'votante')
  const instituicaoDoAvaliador = new Map(estado.inscritos.map((linha) => [linha.id_usuario, linha.id_instituicao]))
  const vinculoDoAvaliador = new Map(estado.inscritos.map((linha) => [linha.id_usuario, linha.id_questionario]))
  const bloqueadas = new Map()
  for (const linha of estado.bloqueios) {
    if (!bloqueadas.has(linha.id_usuario)) bloqueadas.set(linha.id_usuario, new Set())
    bloqueadas.get(linha.id_usuario).add(linha.id_modalidade)
  }
  const impedidos = new Set(estado.impedimentos.map((linha) => `${linha.id_usuario}|${linha.id_projeto}`))
  const jaAvaliou = new Set(estado.avaliacoes.map((linha) => `${linha.id_usuario}|${linha.id_projeto}`))
  const porProjeto = new Map(estado.situacao.map((linha) => [linha.id_projeto, linha]))

  const concluidos = []
  const incompletos = []
  for (const projeto of estado.projetos) {
    if (projeto.is_fora_da_competicao === true) continue
    if (projeto.is_check_in_realizado !== true) continue
    const situacao = porProjeto.get(projeto.id_projeto)
    const cota = situacao?.cota ?? projeto.cota_avaliacoes_customizada ?? ctx.cotaPadrao
    const feitas = situacao?.avaliacoes_tecnicas ?? 0
    if (feitas >= cota) { concluidos.push(projeto.id_projeto); continue }

    const motivos = new Map()
    let elegiveis = 0
    for (const ator of tecnicos) {
      const chave = `${ator.idUsuario}|${projeto.id_projeto}`
      if (jaAvaliou.has(chave)) { somar(motivos, 'já avaliou'); continue }
      if (instituicaoDoAvaliador.get(ator.idUsuario) && instituicaoDoAvaliador.get(ator.idUsuario) === projeto.id_instituicao) {
        somar(motivos, 'mesma instituição')
        continue
      }
      if (projeto.id_modalidade && bloqueadas.get(ator.idUsuario)?.has(projeto.id_modalidade)) {
        somar(motivos, 'modalidade bloqueada')
        continue
      }
      if (impedidos.has(chave)) { somar(motivos, 'impedimento registrado'); continue }
      const vinculo = vinculoDoAvaliador.get(ator.idUsuario)
      if (vinculo && projeto.id_questionario_fixado && vinculo !== projeto.id_questionario_fixado) {
        somar(motivos, 'questionário fixado incompatível')
        continue
      }
      elegiveis += 1
    }
    incompletos.push({
      codigo: projeto.codigo_projeto,
      faltam: cota - feitas,
      elegiveis,
      motivos: [...motivos.entries()].sort((a, b) => b[1] - a[1]),
    })
  }

  const porMotivo = new Map()
  for (const item of incompletos) {
    if (item.elegiveis > 0) somar(porMotivo, 'havia avaliador elegível (faltou tempo/sorteio)')
    else for (const [motivo, total] of item.motivos) somar(porMotivo, motivo, total)
  }
  return {
    concluidos: concluidos.length,
    incompletos,
    faltamNoTotal: incompletos.reduce((soma, item) => soma + item.faltam, 0),
    porMotivo: [...porMotivo.entries()].sort((a, b) => b[1] - a[1]),
  }
}

async function conferirInvariantes(ctx) {
  const estado = await coletarEstadoFinal(ctx)
  const trilhaPerguntas = await lerTrilha(ctx, 'perguntas_questionario', 'id_registro', estado.atual.perguntas.map((p) => p.id_pergunta))
  const trilhaQuestionarios = await lerTrilha(ctx, 'questionarios', 'id_registro', estado.atual.questionarios.map((q) => q.id_questionario))
  const trilhaProjetos = await lerTrilha(ctx, 'projetos', 'id_projeto', ctx.projetosLimpos)
  const trilhaDispositivos = await lerTrilha(ctx, 'dispositivos_avaliador', 'id_registro', ctx.atores.map((ator) => ator.idUsuario))

  return {
    invariantes: [
      { numero: 1, nome: 'cota de avaliações técnicas', ...conferirCota(estado) },
      { numero: 2, nome: 'par (avaliador, projeto) único', ...conferirDuplicidade(estado) },
      { numero: 3, nome: 'travas sem órfã nem sobra', ...conferirTravas(estado) },
      { numero: 4, nome: 'conflito de mesma instituição', ...conferirConflitoInstitucional(estado) },
      { numero: 5, nome: 'questionário pela regra de resolução', ...conferirQuestionarioResolvido(ctx, estado) },
      { numero: 6, nome: 'respostas e pesos íntegros', ...conferirRespostasEPesos(ctx, estado, trilhaPerguntas, trilhaQuestionarios) },
      { numero: 7, nome: 'voto popular não consome cota', ...conferirVotoPopularForaDaCota(ctx, estado) },
      { numero: 8, nome: 'voto popular não fixa questionário', ...conferirFixacaoDoQuestionario(estado) },
      { numero: 9, nome: 'sem pareamento, sem sorteio nem nota', ...conferirPareamentoAntesDeTudo(ctx, estado, trilhaDispositivos) },
      { numero: 10, nome: 'nota em disputa ficou coerente', ...await conferirDisputaDeNota(ctx, estado) },
    ],
    auxiliares: [
      { nome: 'check-in respeitado pelo sorteio', ...conferirCheckIn(ctx, estado, trilhaProjetos) },
    ],
    drenagem: ctx.opcoes.ateConcluir ? diagnosticarIncompletos(ctx, estado) : null,
    totais: {
      pesosAlvo: [...(estado.atual.definicoes.get(ctx.questionarioTecnico.id_questionario)?.perguntas.values() ?? [])]
        .map((pergunta) => pergunta.peso_calculo),
      avaliacoesAtivas: estado.ativas.length,
      votosPopulares: estado.ativas.filter((linha) => linha.is_voto_popular === true).length,
      quarentena: estado.ativas.filter((linha) => linha.is_quarentena === true).length,
      projetosEmQuarentena: estado.situacao.filter((linha) => linha.em_quarentena === true).length,
      travas: estado.travas.length,
    },
  }
}

// ------------------------------------------------------------------ finalização

/** O que a coordenação lê na premiação. A finalização não pode mexer em nada disto. */
const RELATORIOS_DA_PREMIACAO = [
  'fn_relatorio_projetos_completo',
  'fn_relatorio_avaliadores_completo',
  'fn_relatorio_instituicoes_completo',
  'fn_relatorio_ausencias_completo',
  'fn_relatorio_devolucoes_completo',
  'fn_relatorio_voto_popular_completo',
  'fn_relatorio_indicadores_gerenciais',
]

/** As mesmas colunas que RankingPremiacao.tsx pede de view_ranking_top3. */
const COLUNAS_RANKING =
  'id_projeto, codigo_projeto, titulo, estande, nome_instituicao, modalidade, area_tematica, notas, ' +
  'media_geral, ajuste_media, media_final, total_avaliacoes, posicao, em_quarentena, chave_desempate'

/**
 * Campos do Telão que saem de locks_ativos (trava não vencida). A finalização apaga
 * as travas de propósito, então estes DEVEM cair a zero — é a invariante 12, não
 * perda de dado. Qualquer outro campo que mude é perda.
 */
const CAMPOS_TELAO_DE_TRAVA = new Set(['avaliacoes_em_andamento', 'em_andamento_na_meta'])

/** Campos de fn_projetos_situacao que dependem de trava, pelo mesmo motivo. */
const CAMPOS_SITUACAO_DE_TRAVA = new Set(['travas_tecnicas', 'vagas_restantes'])

const CODIGOS_PLANTADOS = 3
const CHAVES_DE_LINHA = ['id_projeto', 'id_usuario', 'id_instituicao', 'id_avaliacao']

function canonico(valor) {
  if (Array.isArray(valor)) {
    return valor.map(canonico).sort((a, b) => (JSON.stringify(a) <= JSON.stringify(b) ? -1 : 1))
  }
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort().map((chave) => [chave, canonico(valor[chave])]))
  }
  return valor
}

function indexar(lista) {
  if (lista.length === 0) return null
  const chave = CHAVES_DE_LINHA.find((nome) => lista.every((item) => item && typeof item === 'object' && item[nome]))
  if (!chave) return null
  return new Map(lista.map((item) => [`${chave}=${item[chave]}`, item]))
}

function recortar(valor, limite = 120) {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor)
  if (texto === undefined) return 'ausente'
  return texto.length > limite ? `${texto.slice(0, limite)}…` : texto
}

/**
 * Primeira diferença entre dois retratos, com o caminho até ela — "difere" sozinho
 * não serviria de nada no relatório. Listas de linhas são comparadas por id, não por
 * posição, senão uma reordenação apareceria como mil diferenças.
 */
function primeiraDiferenca(antes, depois, ignorar = new Set(), caminho = '') {
  if (JSON.stringify(canonico(antes)) === JSON.stringify(canonico(depois))) return null

  if (Array.isArray(antes) && Array.isArray(depois)) {
    const mapaAntes = indexar(antes)
    const mapaDepois = indexar(depois)
    if (mapaAntes && mapaDepois) {
      for (const chave of mapaAntes.keys()) {
        if (!mapaDepois.has(chave)) return { caminho: `${caminho}[${chave}]`, antes: 'presente', depois: 'ausente' }
        const dentro = primeiraDiferenca(mapaAntes.get(chave), mapaDepois.get(chave), ignorar, `${caminho}[${chave}]`)
        if (dentro) return dentro
      }
      for (const chave of mapaDepois.keys()) {
        if (!mapaAntes.has(chave)) return { caminho: `${caminho}[${chave}]`, antes: 'ausente', depois: 'presente' }
      }
      return null
    }
    if (antes.length !== depois.length) {
      return { caminho: `${caminho}.length`, antes: antes.length, depois: depois.length }
    }
  }

  if (antes && depois && typeof antes === 'object' && typeof depois === 'object'
      && !Array.isArray(antes) && !Array.isArray(depois)) {
    for (const chave of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
      if (ignorar.has(chave)) continue
      const dentro = primeiraDiferenca(antes[chave], depois[chave], ignorar, caminho ? `${caminho}.${chave}` : chave)
      if (dentro) return dentro
    }
    return null
  }

  return { caminho: caminho || '(raiz)', antes, depois }
}

/**
 * Plantio de códigos de acesso pendentes. Sem ele, a parte "códigos pendentes do
 * evento marcados como usados" da invariante 12 seria vácua: o evento de simulação
 * usa metodos_vinculo = 'pareamento' e fn_gerar_codigo_acesso recusa nesse modo.
 * Os escolhidos são avaliadores do evento que NÃO foram atores — a rodada já acabou,
 * mas não custa deixar o que ela provou fora do caminho. metodos_vinculo é restaurado
 * no fim da finalização.
 */
async function plantarCodigosPendentes(ctx, relato) {
  const evento = await medir('select eventos (metodos_vinculo)', () => ctx.admin
    .from('eventos').select('metodos_vinculo').eq('id_evento', ctx.idEvento).single())
  if (evento.error) throw new Error(`Não consegui ler metodos_vinculo: ${evento.error.message}`)
  const metodoOriginal = evento.data.metodos_vinculo
  const trocou = !['ambos', 'codigo'].includes(metodoOriginal)

  if (trocou) {
    const { error } = await medir('update eventos (metodos_vinculo)', () => ctx.admin
      .from('eventos').update({ metodos_vinculo: 'ambos' }).eq('id_evento', ctx.idEvento))
    if (error) {
      relato.avisos.push(`não consegui liberar o código de acesso (${error.message}); plantio pulado`)
      return { metodoOriginal, trocou: false, codigos: [] }
    }
  }

  const atores = new Set(ctx.atores.map((ator) => ator.idUsuario))
  const candidatos = await lerTudo(() => ctx.admin
    .from('avaliadores_evento')
    .select('id_usuario, usuarios!inner(email)')
    .eq('id_evento', ctx.idEvento))
  const escolhidos = candidatos.filter((linha) => !atores.has(linha.id_usuario)).slice(0, CODIGOS_PLANTADOS)

  const codigos = []
  for (const escolhido of escolhidos) {
    const resposta = await medir('fn_gerar_codigo_acesso', () => ctx.admin
      .rpc('fn_gerar_codigo_acesso', { p_id_usuario: escolhido.id_usuario }))
    if (resposta.error) {
      relato.avisos.push(`fn_gerar_codigo_acesso recusou para um avaliador: ${resposta.error.message}`)
      continue
    }
    codigos.push({
      idUsuario: escolhido.id_usuario,
      email: escolhido.usuarios.email,
      codigo: resposta.data.codigo,
    })
  }
  return { metodoOriginal, trocou, codigos }
}

/**
 * Retrato do evento: o que a finalização não pode destruir (avaliações, contagem por
 * projeto, ranking, Telão, relatórios) e o que ela deve mudar (janela, travas,
 * aparelhos). dispositivos_avaliador e codigos_acesso têm RLS ligada sem policy e sem
 * grant para `authenticated`, então nem o Admin lê as tabelas: o aparelho vem por
 * fn_situacao_vinculos, que é a janela real do Staff/Admin para o vínculo.
 */
/**
 * Leitura de premiação que não derruba a verificação. Uma leitura que já falhava
 * ANTES da finalização não é perda causada por ela — mas calar sobre isso também não
 * serve. O erro entra no retrato e a invariante 14 compara os dois lados: igual antes
 * e depois = nada mudou; só depois = a finalização quebrou.
 */
async function leituraTolerante(nome, executar) {
  const resposta = await medir(nome, executar)
  if (resposta.error) return { ok: false, erro: resumirMensagem(resposta.error.message) }
  return { ok: true, dados: resposta.data ?? null }
}

async function listaTolerante(nome, montarConsulta) {
  try {
    return { ok: true, dados: await lerTudo(montarConsulta) }
  } catch (erro) {
    somar(metrica(nome).erros, resumirMensagem(erro.message))
    return { ok: false, erro: resumirMensagem(erro.message) }
  }
}

function fontesDaPremiacao(retrato) {
  return new Map([
    ['fn_telao_resumo', retrato.telao],
    ['view_ranking_top3', retrato.ranking],
    ['fn_projetos_situacao', retrato.situacao],
    ...RELATORIOS_DA_PREMIACAO.map((nome) => [nome, retrato.relatorios[nome]]),
  ])
}

async function retratoDoEvento(ctx, quando) {
  const avaliacoes = await lerTudo(() => ctx.admin
    .from('avaliacoes')
    .select('id_avaliacao, id_projeto, status, is_voto_popular, nota_final, projetos!inner(id_evento)')
    .eq('projetos.id_evento', ctx.idEvento))
  const ativas = avaliacoes.filter((linha) => (linha.status ?? '') !== 'CANCELADA')
  const porProjeto = new Map()
  for (const linha of ativas) somar(porProjeto, linha.id_projeto)

  const travas = await lerTudo(() => ctx.admin
    .from('locks_ativos')
    .select('id_usuario, id_projeto, expira_em, projetos!inner(id_evento)')
    .eq('projetos.id_evento', ctx.idEvento))

  const vinculos = await medir(`fn_situacao_vinculos (${quando})`, () => ctx.admin
    .rpc('fn_situacao_vinculos', { p_id_evento: ctx.idEvento }))
  if (vinculos.error) throw new Error(`fn_situacao_vinculos falhou: ${vinculos.error.message}`)

  const janela = await medir(`fn_janela_avaliacao_aberta (${quando})`, () => ctx.admin
    .rpc('fn_janela_avaliacao_aberta', { p_id_evento: ctx.idEvento }))
  if (janela.error) throw new Error(`fn_janela_avaliacao_aberta falhou: ${janela.error.message}`)

  const telao = await leituraTolerante(`fn_telao_resumo (${quando})`, () => ctx.admin
    .rpc('fn_telao_resumo', { p_id_evento: ctx.idEvento }))

  const situacao = await leituraTolerante(`fn_projetos_situacao (${quando})`, () => ctx.admin
    .rpc('fn_projetos_situacao', { p_id_evento: ctx.idEvento }))

  const ranking = await listaTolerante(`view_ranking_top3 (${quando})`, () => ctx.admin
    .from('view_ranking_top3')
    .select(COLUNAS_RANKING)
    .eq('id_evento', ctx.idEvento)
    .order('id_projeto', { ascending: true }))

  const relatorios = {}
  for (const nome of RELATORIOS_DA_PREMIACAO) {
    relatorios[nome] = await leituraTolerante(`${nome} (${quando})`, () => ctx.admin
      .rpc(nome, { p_id_evento: ctx.idEvento }))
  }

  const evento = await medir(`select eventos (${quando})`, () => ctx.admin
    .from('eventos')
    .select('sistema_liberado, metodos_vinculo, is_ativo')
    .eq('id_evento', ctx.idEvento)
    .single())
  if (evento.error) throw new Error(`Não consegui ler o evento: ${evento.error.message}`)

  return {
    ativas: ativas.length,
    canceladas: avaliacoes.length - ativas.length,
    votos: ativas.filter((linha) => linha.is_voto_popular === true).length,
    porProjeto,
    travas: travas.length,
    vinculos: vinculos.data ?? [],
    aparelhosVinculados: (vinculos.data ?? []).filter((linha) => linha.aparelho_vinculado === true).length,
    janela: janela.data,
    telao,
    situacao,
    ranking,
    relatorios,
    sistemaLiberado: evento.data.sistema_liberado,
    isAtivo: evento.data.is_ativo,
  }
}

/**
 * Invariante 12: há outro evento neste banco (o "Evento Local de Teste" do seed), e a
 * regra 5 vale para a finalização também. Aparelhos vêm por fn_situacao_vinculos, que
 * aceita o id_evento; travas e avaliações, pela coluna de evento do projeto.
 */
async function retratoDeOutrosEventos(ctx) {
  const eventos = await lerTudo(() => ctx.admin
    .from('eventos')
    .select('id_evento, nome_evento, sistema_liberado, metodos_vinculo')
    .neq('id_evento', ctx.idEvento))

  const retratos = []
  for (const evento of eventos) {
    const vinculos = await medir('fn_situacao_vinculos (outro evento)', () => ctx.admin
      .rpc('fn_situacao_vinculos', { p_id_evento: evento.id_evento }))
    if (vinculos.error) throw new Error(`fn_situacao_vinculos (outro evento) falhou: ${vinculos.error.message}`)
    const travas = await lerTudo(() => ctx.admin
      .from('locks_ativos')
      .select('id_usuario, id_projeto, projetos!inner(id_evento)')
      .eq('projetos.id_evento', evento.id_evento))
    const avaliacoes = await lerTudo(() => ctx.admin
      .from('avaliacoes')
      .select('id_avaliacao, status, projetos!inner(id_evento)')
      .eq('projetos.id_evento', evento.id_evento))
    retratos.push({
      idEvento: evento.id_evento,
      nome: evento.nome_evento,
      sistemaLiberado: evento.sistema_liberado,
      metodosVinculo: evento.metodos_vinculo,
      vinculos: vinculos.data ?? [],
      aparelhosVinculados: (vinculos.data ?? []).filter((linha) => linha.aparelho_vinculado === true).length,
      travas: travas.length,
      avaliacoes: avaliacoes.length,
    })
  }
  return retratos
}

/** Sonda: um avaliador que ficou com a sessão viva tenta sortear e enviar. */
async function sondarAvaliador(ctx) {
  const ator = ctx.sondaAvaliador
  if (!ator?.cliente) return { feita: false, detalhe: 'nenhuma sessão de avaliador sobrou para a sonda' }

  const perfil = await medir('fn_meu_perfil (após finalizar)', () => ator.cliente.rpc('fn_meu_perfil'))
  const sorteio = await medir('sortear_proximo_projeto (após finalizar)', () => ator.cliente
    .rpc('sortear_proximo_projeto', { p_id_usuario: ator.idUsuario, p_id_evento: ctx.idEvento }))

  const projeto = await medir('select projetos (sonda)', () => ctx.admin
    .from('projetos')
    .select('id_projeto, codigo_projeto, id_questionario_fixado')
    .eq('id_evento', ctx.idEvento)
    .limit(1)
    .single())
  if (projeto.error) throw new Error(`Não consegui escolher projeto para a sonda: ${projeto.error.message}`)

  const idQuestionario = projeto.data.id_questionario_fixado ?? ctx.questionarioTecnico.id_questionario
  const questionario = await lerQuestionarioDoBanco(ctx, ctx.admin, idQuestionario)
  const envio = await medir('fn_enviar_avaliacao (após finalizar)', () => ator.cliente
    .rpc('fn_enviar_avaliacao', {
      p_id_usuario: ator.idUsuario,
      p_id_projeto: projeto.data.id_projeto,
      p_id_questionario: idQuestionario,
      p_respostas: montarRespostas(questionario, criarSorteio(7)),
      p_parecer: 'Sonda de pós-finalização (precisa ser recusada).',
      p_tempo_presenca: new Date().toISOString(),
    }))

  await ator.cliente.auth.signOut()
  return {
    feita: true,
    perfil: perfil.data?.papel ?? null,
    sorteioRecusado: Boolean(sorteio.error),
    sorteioMensagem: sorteio.error?.message ?? (sorteio.data ? 'sorteou projeto' : 'devolveu vazio sem erro'),
    sorteioVazio: !sorteio.error && !sorteio.data,
    envioRecusado: Boolean(envio.error),
    envioMensagem: envio.error?.message ?? 'aceitou o envio',
  }
}

/**
 * Sonda: alguém tenta parear um aparelho depois da finalização. Não assumo nada —
 * nem que falha nem que funciona. Roda DEPOIS das invariantes, porque um pareamento
 * que der certo cria aparelho não revogado e mudaria o estado que elas conferem.
 */
async function sondarPareamento(ctx, relato) {
  const alvo = ctx.sondaAvaliador ?? ctx.atores[0]
  if (!alvo) return { feita: false, detalhe: 'nenhum avaliador para a sonda' }

  const cliente = criarCliente(ctx)
  const anonima = await medir('auth.signInAnonymously (sonda)', () => cliente.auth.signInAnonymously())
  if (anonima.error) return { feita: false, detalhe: `sessão anônima recusada: ${anonima.error.message}` }

  const pedido = await medir('fn_solicitar_pareamento (após finalizar)', () => cliente
    .rpc('fn_solicitar_pareamento'))
  if (pedido.error || !pedido.data?.codigo) {
    await cliente.auth.signOut()
    return {
      feita: true, solicitou: false, pareou: false,
      mensagem: pedido.error?.message ?? 'fn_solicitar_pareamento não devolveu código',
    }
  }

  const staff = await entrarComoStaff(ctx, ctx.credenciais.staff[0])
  const pareamento = await medir('fn_parear_dispositivo (após finalizar)', () => staff
    .rpc('fn_parear_dispositivo', { p_codigo: pedido.data.codigo, p_id_usuario: alvo.idUsuario }))

  let perfilDepois = null
  if (!pareamento.error) {
    const perfil = await medir('fn_meu_perfil (após pareamento pós-finalização)', () => cliente.rpc('fn_meu_perfil'))
    perfilDepois = perfil.data?.papel ?? null
    relato.avisos.push(
      'o pareamento FUNCIONOU depois da finalização: fn_parear_dispositivo não olha ' +
      'sistema_liberado, e parametros_acesso() só exige evento. Um aparelho novo ficou ' +
      'vinculado — conte com ele na reversão.',
    )
  }
  await staff.auth.signOut()
  await cliente.auth.signOut()
  return {
    feita: true,
    solicitou: true,
    pareou: !pareamento.error,
    mensagem: pareamento.error?.message ?? 'pareamento aceito',
    perfilDepois,
  }
}

/** Sonda: um código de acesso que estava pendente ainda vale depois da finalização? */
async function sondarCodigoDeAcesso(ctx, plantio) {
  if (plantio.codigos.length === 0) return { feita: false, detalhe: 'nenhum código plantado' }
  const alvo = plantio.codigos[0]

  const cliente = criarCliente(ctx)
  const anonima = await medir('auth.signInAnonymously (sonda código)', () => cliente.auth.signInAnonymously())
  if (anonima.error) return { feita: false, detalhe: `sessão anônima recusada: ${anonima.error.message}` }

  const resposta = await medir('fn_vincular_com_codigo (após finalizar)', () => cliente
    .rpc('fn_vincular_com_codigo', { p_email: alvo.email, p_codigo: alvo.codigo }))
  await cliente.auth.signOut()

  if (resposta.error) return { feita: true, aceito: false, mensagem: resposta.error.message }
  return {
    feita: true,
    aceito: resposta.data?.ok === true,
    mensagem: resposta.data?.ok === true ? 'código ainda valia' : (resposta.data?.erro ?? 'recusado sem mensagem'),
  }
}

// ---------------------------------------------------- invariantes 11 a 14

function conferirNadaPerdido(antes, depois) {
  const problemas = []
  if (antes.ativas !== depois.ativas) {
    problemas.push(`total de avaliações ativas ${antes.ativas} -> ${depois.ativas}`)
  }
  if (antes.canceladas !== depois.canceladas) {
    problemas.push(`canceladas ${antes.canceladas} -> ${depois.canceladas}`)
  }
  for (const [idProjeto, total] of antes.porProjeto) {
    const agora = depois.porProjeto.get(idProjeto) ?? 0
    if (agora !== total) problemas.push(`projeto ${idProjeto}: ${total} -> ${agora}`)
  }
  for (const idProjeto of depois.porProjeto.keys()) {
    if (!antes.porProjeto.has(idProjeto)) problemas.push(`projeto ${idProjeto} apareceu do nada`)
  }
  return {
    ok: problemas.length === 0,
    detalhe: problemas.length === 0
      ? `${depois.ativas} avaliações ativas (${depois.votos} de voto popular) e a contagem de ` +
        `${depois.porProjeto.size} projetos idênticas antes e depois`
      : `${problemas.length} divergência(s): ${problemas.slice(0, 3).join('; ')}`,
  }
}

function conferirEfeitosDaFinalizacao(antes, depois, retorno, plantio, sonda) {
  const problemas = []
  const notas = []

  if (depois.janela !== false) problemas.push(`fn_janela_avaliacao_aberta ainda é ${depois.janela}`)
  else notas.push(`janela ${antes.janela} -> false`)

  if (depois.sistemaLiberado !== false) problemas.push(`sistema_liberado ainda é ${depois.sistemaLiberado}`)

  if (depois.travas !== 0) problemas.push(`${depois.travas} trava(s) sobraram em locks_ativos`)
  else notas.push(`travas ${antes.travas} -> 0 (RPC relatou ${retorno.travas_liberadas} liberadas)`)

  if (depois.aparelhosVinculados !== 0) {
    problemas.push(`${depois.aparelhosVinculados} aparelho(s) ainda sem revogado_em (fn_situacao_vinculos)`)
  } else {
    notas.push(`aparelhos vinculados ${antes.aparelhosVinculados} -> 0 (RPC relatou ` +
      `${retorno.aparelhos_desvinculados} desvinculados)`)
  }

  if (plantio.codigos.length === 0) {
    notas.push('nenhum código pendente plantado: a parte de códigos ficou sem teste')
  } else if (retorno.codigos_invalidados < plantio.codigos.length) {
    problemas.push(`plantei ${plantio.codigos.length} código(s) pendente(s) e a RPC invalidou ` +
      `apenas ${retorno.codigos_invalidados}`)
  } else {
    notas.push(`códigos pendentes queimados: ${retorno.codigos_invalidados} (${plantio.codigos.length} plantados)`)
  }

  if (!sonda.feita) {
    notas.push(`sonda do avaliador não rodou: ${sonda.detalhe}`)
  } else {
    if (!sonda.sorteioRecusado && !sonda.sorteioVazio) {
      problemas.push(`o avaliador conseguiu sortear depois da finalização: ${sonda.sorteioMensagem}`)
    }
    if (!sonda.envioRecusado) problemas.push('o avaliador conseguiu ENVIAR avaliação depois da finalização')
    notas.push(`sonda do avaliador: perfil "${sonda.perfil ?? 'nenhum'}", sorteio ${sonda.sorteioRecusado ? 'recusado' : (sonda.sorteioVazio ? 'vazio' : 'ACEITO')}, envio ${sonda.envioRecusado ? 'recusado' : 'ACEITO'}`)
  }

  return {
    ok: problemas.length === 0,
    detalhe: problemas.length === 0 ? notas.join('; ') : problemas.join('; '),
    notas,
  }
}

function conferirEscopoDoEvento(antes, depois) {
  const problemas = []
  const porId = new Map(antes.map((item) => [item.idEvento, item]))
  for (const agora of depois) {
    const antigo = porId.get(agora.idEvento)
    if (!antigo) { problemas.push(`evento "${agora.nome}" apareceu entre os retratos`); continue }
    const diferenca = primeiraDiferenca(
      { vinculos: antigo.vinculos, travas: antigo.travas, avaliacoes: antigo.avaliacoes, sistemaLiberado: antigo.sistemaLiberado, metodosVinculo: antigo.metodosVinculo },
      { vinculos: agora.vinculos, travas: agora.travas, avaliacoes: agora.avaliacoes, sistemaLiberado: agora.sistemaLiberado, metodosVinculo: agora.metodosVinculo },
    )
    if (diferenca) {
      problemas.push(`"${agora.nome}": ${diferenca.caminho} ${recortar(diferenca.antes, 40)} -> ${recortar(diferenca.depois, 40)}`)
    }
  }
  const resumo = depois.map((item) =>
    `"${item.nome}": ${item.aparelhosVinculados} aparelho(s), ${item.travas} trava(s), ${item.avaliacoes} avaliação(ões)`)
  return {
    ok: problemas.length === 0,
    detalhe: problemas.length === 0
      ? `${depois.length} outro(s) evento(s) intacto(s) — ${resumo.join('; ')}`
      : problemas.join('; '),
  }
}

function conferirLeiturasDaPremiacao(antes, depois) {
  const problemas = []
  const esperadas = []
  const quebradas = []
  const comparadas = []

  const fontesAntes = fontesDaPremiacao(antes)
  const fontesDepois = fontesDaPremiacao(depois)

  for (const [nome, antiga] of fontesAntes) {
    const nova = fontesDepois.get(nome)

    // Leitura que já falhava antes: não é perda causada pela finalização, mas também
    // não some do relatório — e se o erro MUDOU, isso sim é problema.
    if (!antiga.ok && !nova.ok) {
      quebradas.push(antiga.erro === nova.erro
        ? `${nome}: já falhava antes e falha igual depois — ${antiga.erro}`
        : `${nome}: erro mudou — antes "${antiga.erro}", depois "${nova.erro}"`)
      if (antiga.erro !== nova.erro) problemas.push(`${nome} trocou de erro depois da finalização`)
      continue
    }
    if (antiga.ok && !nova.ok) {
      problemas.push(`${nome} parou de responder depois da finalização: ${nova.erro}`)
      continue
    }
    if (!antiga.ok && nova.ok) {
      quebradas.push(`${nome}: falhava antes ("${antiga.erro}") e voltou a responder depois`)
      continue
    }

    if (nome === 'fn_telao_resumo') {
      const chaves = new Set([...Object.keys(antiga.dados ?? {}), ...Object.keys(nova.dados ?? {})])
      for (const chave of chaves) {
        if (JSON.stringify(antiga.dados?.[chave]) === JSON.stringify(nova.dados?.[chave])) continue
        const texto = `${nome}.${chave}: ${recortar(antiga.dados?.[chave], 40)} -> ${recortar(nova.dados?.[chave], 40)}`
        if (CAMPOS_TELAO_DE_TRAVA.has(chave) && Number(nova.dados?.[chave]) === 0) esperadas.push(texto)
        else problemas.push(texto)
      }
      comparadas.push(nome)
      continue
    }

    const ignorar = nome === 'fn_projetos_situacao' ? CAMPOS_SITUACAO_DE_TRAVA : new Set()
    const diferenca = primeiraDiferenca(antiga.dados, nova.dados, ignorar)
    if (diferenca) {
      problemas.push(`${nome}${diferenca.caminho}: ${recortar(diferenca.antes, 40)} -> ${recortar(diferenca.depois, 40)}`)
    }
    comparadas.push(nome)
  }

  return {
    ok: problemas.length === 0,
    detalhe: problemas.length === 0
      ? `${comparadas.length} leitura(s) com os mesmos números` +
        (quebradas.length > 0 ? `; ${quebradas.length} já estava(m) quebrada(s) antes da finalização` : '') +
        (esperadas.length > 0 ? `; só os contadores de trava caíram: ${esperadas.join(', ')}` : '')
      : problemas.slice(0, 4).join(' | '),
    comparadas,
    quebradas,
    esperadas,
  }
}

/**
 * --finalizar: roda só depois da drenagem, na mesma execução, nunca sozinha. Chama
 * admin_finalizar_evento com o id_evento EXPLÍCITO — o default resolve por
 * evento_ativo_id() e, num banco com dois eventos, é como se encerra a feira errada.
 * Nunca chama admin_reset_global. Não reverte nada: imprime como reverter.
 */
async function finalizarEvento(ctx) {
  const relato = { avisos: [] }
  relato.plantio = await plantarCodigosPendentes(ctx, relato)
  try {
    return await finalizarEventoInterno(ctx, relato)
  } finally {
    // Em finally: um erro no meio não pode deixar o evento com metodos_vinculo trocado.
    if (relato.plantio.trocou) {
      const { error } = await medir('update eventos (metodos_vinculo de volta)', () => ctx.admin
        .from('eventos')
        .update({ metodos_vinculo: relato.plantio.metodoOriginal })
        .eq('id_evento', ctx.idEvento))
      if (error) relato.avisos.push(`não consegui restaurar metodos_vinculo: ${error.message}`)
    }
  }
}

async function finalizarEventoInterno(ctx, relato) {
  const antes = await retratoDoEvento(ctx, 'antes')
  const outrosAntes = await retratoDeOutrosEventos(ctx)

  const chamada = await medir('admin_finalizar_evento', () => ctx.admin
    .rpc('admin_finalizar_evento', { p_id_evento: ctx.idEvento }))
  if (chamada.error) throw new Error(`admin_finalizar_evento falhou: ${chamada.error.message}`)
  relato.retorno = chamada.data ?? {}

  const depois = await retratoDoEvento(ctx, 'depois')
  const outrosDepois = await retratoDeOutrosEventos(ctx)
  relato.sonda = await sondarAvaliador(ctx)

  relato.invariantes = [
    { numero: 11, nome: 'nenhuma avaliação perdida', ...conferirNadaPerdido(antes, depois) },
    { numero: 12, nome: 'feira fechada de verdade', ...conferirEfeitosDaFinalizacao(antes, depois, relato.retorno, relato.plantio, relato.sonda) },
    { numero: 13, nome: 'nada escapou do escopo do evento', ...conferirEscopoDoEvento(outrosAntes, outrosDepois) },
    { numero: 14, nome: 'leituras da premiação íntegras', ...conferirLeiturasDaPremiacao(antes, depois) },
  ]

  // Depois das invariantes: estas duas sondas escrevem.
  relato.sondaPareamento = await sondarPareamento(ctx, relato)
  relato.sondaCodigo = await sondarCodigoDeAcesso(ctx, relato.plantio)

  relato.antes = antes
  relato.depois = depois
  return relato
}

function imprimirFinalizacao(ctx, final) {
  console.log('')
  console.log('  finalização (--finalizar, depois da drenagem):')
  console.log(
    `    admin_finalizar_evento(id_evento explícito) devolveu: ${final.retorno.travas_liberadas} travas, ` +
    `${final.retorno.aparelhos_desvinculados} aparelhos, ${final.retorno.codigos_invalidados} códigos`,
  )
  console.log(
    `    códigos pendentes plantados antes: ${final.plantio.codigos.length}` +
    (final.plantio.trocou
      ? ` (metodos_vinculo "${final.plantio.metodoOriginal}" -> "ambos" e restaurado no fim)`
      : ''),
  )

  for (const item of final.invariantes) {
    const rotulo = `${item.numero}. ${item.nome}`.padEnd(42, '.')
    console.log(`    ${rotulo} ${item.ok ? 'OK  ' : 'FUROU'}  ${item.detalhe}`)
  }

  const sondas = []
  if (final.sondaPareamento?.feita) {
    sondas.push(final.sondaPareamento.solicitou
      ? `pareamento depois da finalização: ${final.sondaPareamento.pareou ? 'FUNCIONOU' : 'recusado'} — ` +
        `${final.sondaPareamento.mensagem}` +
        (final.sondaPareamento.pareou ? ` (fn_meu_perfil voltou "${final.sondaPareamento.perfilDepois}")` : '')
      : `fn_solicitar_pareamento recusado: ${final.sondaPareamento.mensagem}`)
  } else if (final.sondaPareamento) {
    sondas.push(`sonda de pareamento não rodou: ${final.sondaPareamento.detalhe}`)
  }
  if (final.sondaCodigo?.feita) {
    sondas.push(`código de acesso pendente depois da finalização: ` +
      `${final.sondaCodigo.aceito ? 'AINDA VALIA' : 'recusado'} — ${final.sondaCodigo.mensagem}`)
  } else if (final.sondaCodigo) {
    sondas.push(`sonda de código não rodou: ${final.sondaCodigo.detalhe}`)
  }
  if (sondas.length > 0) {
    console.log('    sondas de pós-finalização (resultado real, sem suposição):')
    for (const linha of sondas) console.log(`      ${linha}`)
  }

  const leituras = final.invariantes.find((item) => item.numero === 13)
  if (leituras?.quebradas?.length > 0) {
    console.log('    leituras que JÁ estavam quebradas antes da finalização (não é efeito dela):')
    for (const linha of leituras.quebradas) console.log(`      ${linha}`)
  }

  console.log('    limite da verificação: codigos_acesso tem RLS sem policy e sem grant para')
  console.log('      `authenticated`, então nem o Admin lê a tabela. Os códigos de outros eventos')
  console.log('      não são observáveis daqui; o escopo vem do filtro `c.id_evento = v_id_evento`')
  console.log('      no corpo de admin_finalizar_evento e da contagem que ela devolve.')

  if (final.avisos.length > 0) {
    console.log('    avisos:')
    for (const aviso of final.avisos) console.log(`      ${aviso}`)
  }

  console.log('')
  console.log('    reversão (à mão — o script não reverte):')
  console.log('      1. Admin > Configurações do evento: religue sistema_liberado (hoje false).')
  console.log(`      2. Todos os avaliadores precisam parear o aparelho de novo: ` +
    `${final.retorno.aparelhos_desvinculados} aparelho(s) foram revogados.`)
  if (final.retorno.codigos_invalidados > 0) {
    console.log(`      3. ${final.retorno.codigos_invalidados} código(s) de acesso foram queimados; ` +
      'gere novos se for usar esse método.')
  }
  if (final.sondaPareamento?.pareou) {
    console.log('      4. A sonda deixou UM aparelho pareado depois da finalização ' +
      '(Admin > Avaliadores > desvincular, se quiser o estado limpo).')
  }
  console.log(`      As ${final.retorno.travas_liberadas} trava(s) apagadas não voltam: ` +
    'os avaliadores sorteiam de novo.')
  console.log('      admin_reset_global NÃO foi chamado — e não deve ser: ele apaga avaliações.')
}

// --------------------------------------------------------------------- relatório

function alinhar(texto, largura, direita = false) {
  const valor = String(texto)
  return direita ? valor.padStart(largura) : valor.padEnd(largura)
}

function imprimirResumo(ctx, resultado, duracaoSegundos) {
  const linhas = [...metricas.entries()].map(([nome, dados]) => {
    const ordenado = [...dados.amostras].sort((a, b) => a - b)
    const negativos = [...dados.negativos.values()].reduce((soma, item) => soma + item, 0)
    const erros = [...dados.erros.values()].reduce((soma, item) => soma + item, 0)
    return {
      nome,
      chamadas: dados.amostras.length,
      ok: dados.ok,
      negativos,
      erros,
      limite: dados.limite,
      p50: percentil(ordenado, 50),
      p95: percentil(ordenado, 95),
      p99: percentil(ordenado, 99),
    }
  }).sort((a, b) => b.chamadas - a.chamadas)

  const totalChamadas = linhas.reduce((soma, linha) => soma + linha.chamadas, 0)
  const larguraNome = Math.max(10, ...linhas.map((linha) => linha.nome.length))
  const escala = (quest) => `${Number(quest.escala_minima)}–${Number(quest.escala_maxima)}`

  console.log('')
  console.log(`Simulação de carga — ${ctx.nomeEvento}`)
  console.log(
    `  modo: questionários ${ctx.opcoes.questionarios}` +
    `${ctx.opcoes.ateConcluir ? ', drenagem (--ate-concluir)' : `, ${ctx.opcoes.porAvaliador} avaliações por avaliador`}`,
  )
  console.log(
    `  técnico: "${ctx.questionarioTecnico.titulo}" (${ctx.caminhosQuestionario.tecnico}, escala ${escala(ctx.questionarioTecnico)})`,
  )
  console.log(
    `  voto popular: "${ctx.questionarioVotoPopular.titulo}" ` +
    `(${ctx.caminhosQuestionario.votoPopular}, escala ${escala(ctx.questionarioVotoPopular)})`,
  )
  for (const nota of ctx.notasQuestionario) console.log(`    - ${nota}`)
  console.log(
    `  atores: ${ctx.opcoes.avaliadores} avaliadores (${ctx.vinculo.votantes} voto popular / ` +
    `${ctx.vinculo.vinculados} técnicos vinculados / ${ctx.vinculo.livres} técnicos livres; ` +
    `${ctx.atores.filter((ator) => !ator.credenciadoAntes).length} sem credenciamento na largada), ` +
    `${ctx.opcoes.staff} staff, ${ctx.opcoes.telao} telão, 1 admin em mutação, ` +
    `2 admins em disputa de nota, ${ctx.opcoes.autocadastro} autocadastros`,
  )
  if (ctx.vinculo.porTecnico.size > 1) {
    console.log(
      `  vínculos técnicos por questionário: ` +
      [...ctx.vinculo.porTecnico.entries()].map(([titulo, n]) => `${titulo}: ${n}`).join(' / '),
    )
  }
  console.log(
    `  preparo: ${ctx.projetosLimpos.length} check-ins limpos de ${ctx.elegiveis} com check-in; ` +
    `${ctx.pendentesAntes.length} projetos já estavam pendentes; ${ctx.totalFilaCheckin} na fila do staff; ` +
    `cota ${ctx.cotaPadrao}`,
  )
  console.log(
    `  rodada: ${duracaoSegundos.toFixed(1)} s, ${totalChamadas} chamadas, ` +
    `${(totalChamadas / duracaoSegundos).toFixed(1)} chamadas/s — ${ctx.pareados} aparelhos pareados, ` +
    `${ctx.enviadas} avaliações nesta rodada (${ctx.votosEnviados} votos), ${ctx.checkinsFeitos} check-ins`,
  )
  if (ctx.opcoes.ateConcluir) {
    console.log(`  fim da rodada: ${ctx.fimDaRodada ?? 'não registrado'} (${ctx.varreduras} varreduras)`)
  }
  console.log(
    `  acumulado no evento: ${resultado.totais.avaliacoesAtivas} avaliações ativas ` +
    `(${resultado.totais.votosPopulares} voto popular), ${resultado.totais.quarentena} em quarentena ` +
    `(esperado, não é erro), ${resultado.totais.projetosEmQuarentena} projetos em quarentena`,
  )
  for (const aviso of ctx.avisos) console.log(`  aviso: ${aviso}`)
  for (const falha of ctx.falhasDePreparo) console.log(`  falha de preparo: ${falha}`)

  console.log('')
  console.log(
    `  ${alinhar('RPC / chamada', larguraNome)}  ${alinhar('qtd', 6, true)} ${alinhar('ok', 6, true)} ` +
    `${alinhar('neg', 5, true)} ${alinhar('err', 5, true)} ${alinhar('429', 5, true)} ` +
    `${alinhar('p50', 8, true)} ${alinhar('p95', 8, true)} ${alinhar('p99', 8, true)}`,
  )
  for (const linha of linhas) {
    console.log(
      `  ${alinhar(linha.nome, larguraNome)}  ${alinhar(linha.chamadas, 6, true)} ${alinhar(linha.ok, 6, true)} ` +
      `${alinhar(linha.negativos, 5, true)} ${alinhar(linha.erros, 5, true)} ${alinhar(linha.limite, 5, true)} ` +
      `${alinhar(linha.p50.toFixed(0) + 'ms', 8, true)} ${alinhar(linha.p95.toFixed(0) + 'ms', 8, true)} ` +
      `${alinhar(linha.p99.toFixed(0) + 'ms', 8, true)}`,
    )
  }

  console.log('')
  console.log('  deriva de latência (p95 por terço da rodada):')
  for (const nome of ['sortear_proximo_projeto', 'fn_enviar_avaliacao']) {
    const deriva = derivaPorTerco(nome, ctx.inicioRodada, ctx.fimRodada)
    if (!deriva) { console.log(`    ${nome.padEnd(28)} sem amostra`); continue }
    console.log(
      `    ${nome.padEnd(28)} ` +
      deriva.map((terco, indice) => `T${indice + 1} ${terco.p95.toFixed(0)}ms (${terco.chamadas})`).join('  '),
    )
  }

  const negativos = new Map()
  const erros = new Map()
  let limites = 0
  for (const [nome, dados] of metricas) {
    for (const [rotulo, total] of dados.negativos) somar(negativos, `${rotulo}`, total)
    for (const [mensagem, total] of dados.erros) somar(erros, `${nome}: ${mensagem}`, total)
    limites += dados.limite
  }

  console.log('')
  console.log(`  sorteios sem projeto elegível: ${metrica('sortear_proximo_projeto').vazios}`)
  console.log(`  impedimentos registrados pelos avaliadores: ${ctx.impedimentos}`)
  console.log(`  429 / limite de requisições: ${limites}`)
  console.log('  casos negativos esperados (acerto do teste):')
  if (negativos.size === 0) console.log('    nenhum')
  for (const [rotulo, total] of [...negativos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${total.toString().padStart(5)}  ${rotulo}`)
  }
  console.log('  erros (agrupados por mensagem):')
  if (erros.size === 0) console.log('    nenhum')
  for (const [mensagem, total] of [...erros.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${total.toString().padStart(5)}  ${mensagem}`)
  }

  if (resultado.drenagem) {
    const dren = resultado.drenagem
    console.log('')
    console.log(
      `  drenagem: ${dren.concluidos} projetos com a cota cheia, ${dren.incompletos.length} incompletos ` +
      `(${dren.faltamNoTotal} avaliações faltando)`,
    )
    for (const [motivo, total] of dren.porMotivo) {
      console.log(`    ${total.toString().padStart(5)}  ${motivo}`)
    }
    for (const item of dren.incompletos.slice(0, 12)) {
      const porque = item.elegiveis > 0
        ? `${item.elegiveis} avaliador(es) ainda elegível(eis): faltou tempo de rodada`
        : item.motivos.map(([motivo, total]) => `${motivo} ${total}`).join(', ')
      console.log(`    ${item.codigo}: faltam ${item.faltam} — ${porque}`)
    }
    if (dren.incompletos.length > 12) console.log(`    … e outros ${dren.incompletos.length - 12} projetos`)
  }

  console.log('')
  console.log('  invariantes:')
  for (const item of resultado.invariantes) {
    const rotulo = `${item.numero}. ${item.nome}`.padEnd(42, '.')
    console.log(`    ${rotulo} ${item.ok ? 'OK  ' : 'FUROU'}  ${item.detalhe}`)
  }
  console.log('  checagens auxiliares:')
  for (const item of resultado.auxiliares) {
    console.log(`    ${item.nome.padEnd(42, '.')} ${item.ok ? 'OK  ' : 'FUROU'}  ${item.detalhe}`)
  }
  console.log(
    `    ${'mutação de questionário em uso'.padEnd(42, '.')} ${ctx.mutacoes.tentativas} tentativas: ` +
    `${ctx.mutacoes.aceitasEmUso} aceita(s) com avaliação, ${ctx.mutacoes.aceitasSemUso} aceita(s) antes do primeiro uso`,
  )
  console.log(
    `    ${'disputa de nota entre dois admins'.padEnd(42, '.')} ${ctx.disputas.tentativas} avaliação(ões): ` +
    `${ctx.disputas.corrigidas} correção(ões) e ${ctx.disputas.arbitradas} arbitragem(ns) aceitas` +
    (ctx.disputas.recusas.size > 0
      ? `, recusas: ${[...ctx.disputas.recusas.entries()].map(([msg, n]) => `${n}× ${msg}`).join('; ')}`
      : ''),
  )
  if (resultado.finalizacao) imprimirFinalizacao(ctx, resultado.finalizacao)

  if (String(ctx.pesosAlvoAntes) !== String(resultado.totais.pesosAlvo)) {
    console.log(
      `    ${'efeito colateral: pesos do questionário'.padEnd(42, '.')} peso_calculo ` +
      `[${ctx.pesosAlvoAntes.join(', ')}] -> [${resultado.totais.pesosAlvo.join(', ')}]: aceito antes ` +
      'do primeiro uso, o que o banco permite',
    )
  }
  console.log('')
}

// -------------------------------------------------------------------------- main

async function principal() {
  const opcoes = lerArgumentos(process.argv.slice(2))
  carregarEnv()
  const { url, chaveAnonima } = exigirSupabaseLocal()
  const credenciais = exigirCredenciais()

  // Antes das pré-condições: depois de um `db reset` as contas não existem, e sem elas
  // o login de Admin abaixo falharia. Idempotente e silencioso quando nada falta.
  console.log(resumirContas(await garantirContasLocais()))

  const ctx = {
    url, chaveAnonima, credenciais, opcoes,
    filaPareamento: [], filaCheckin: [], cacheQuestionarios: new Map(),
    rodadaAtiva: true, pareados: 0, enviadas: 0, votosEnviados: 0, checkinsFeitos: 0, checkinEmCurso: 0,
    projetosLimpos: [], pendentesAntes: [], totalFilaCheckin: 0, elegiveis: 0,
    avisos: [], falhasDePreparo: [], impedimentos: 0, recusasPorCota: [],
    varreduras: 0, fimDaRodada: null,
    mutacoes: { tentativas: 0, aceitasEmUso: 0, aceitasSemUso: 0 },
    disputas: { tentativas: 0, corrigidas: 0, arbitradas: 0, alvos: new Map(), recusas: new Map() },
  }

  ctx.admin = await entrarComoAdmin(ctx, 'auth.signInWithPassword (admin)')
  ctx.avisos = await conferirPreCondicoes(ctx)

  // Preparo (nenhuma escrita antes das pré-condições que não dependem dele).
  await comporQuestionarios(ctx)
  await prepararStaff(ctx)
  const clientesStaff = []
  for (let indice = 0; indice < opcoes.staff; indice += 1) {
    clientesStaff.push(await entrarComoStaff(ctx, credenciais.staff[indice % credenciais.staff.length]))
  }
  const adminMutacao = await entrarComoAdmin(ctx, 'auth.signInWithPassword (admin mutação)')
  // Duas sessões a mais: a disputa de nota precisa de dois clientes de verdade, não de
  // duas chamadas na mesma conexão — é a concorrência que está sob teste.
  const adminDisputaA = await entrarComoAdmin(ctx, 'auth.signInWithPassword (admin disputa A)')
  const adminDisputaB = await entrarComoAdmin(ctx, 'auth.signInWithPassword (admin disputa B)')

  ctx.atores = escolherAtores(ctx)
  if (ctx.semCredenciamentoNoEvento > 0) {
    ctx.avisos.push(
      `${ctx.semCredenciamentoNoEvento} de ${ctx.totalAvaliadoresDoEvento} avaliadores do evento estavam sem ` +
      `credenciamento; ${ctx.atores.filter((ator) => !ator.credenciadoAntes).length} deles entraram como atores e ` +
      'foram credenciados pelo staff no pareamento (fluxo real da portaria).',
    )
  }

  const base = await lerDefinicoesAtuais(ctx)
  ctx.definicoesBase = base.definicoes
  ctx.pesosAlvoAntes = [...base.definicoes.get(ctx.questionarioTecnico.id_questionario).perguntas.values()]
    .map((pergunta) => pergunta.peso_calculo)
  const checkin = await limparCheckIn(ctx)
  ctx.projetosLimpos = checkin.limpos
  ctx.pendentesAntes = checkin.pendentesAntes
  ctx.elegiveis = checkin.elegiveis
  // No modo drenagem o staff precisa concluir TODOS os check-ins pendentes.
  ctx.filaCheckin = opcoes.ateConcluir
    ? [...checkin.limpos, ...checkin.pendentesAntes]
    : [...checkin.limpos]
  ctx.totalFilaCheckin = ctx.filaCheckin.length
  ctx.vinculo = await vincularQuestionarios(ctx)
  ctx.marcoRodada = await marcoDaTrilha(ctx)

  // Rodada: todos os atores em paralelo.
  ctx.inicioRodada = performance.now()
  const dePlantao = [
    ...clientesStaff.map((cliente) => atorStaff(ctx, cliente)),
    ...Array.from({ length: opcoes.telao }, () => atorTelao(ctx)),
    atorMutacaoQuestionario(ctx, adminMutacao),
    atorDisputaDeNota(ctx, adminDisputaA, adminDisputaB),
  ]
  await Promise.all([
    Promise.all(ctx.atores.map((ator) => atorAvaliador(ctx, ator))),
    rajadaAutocadastro(ctx),
    ...(opcoes.ateConcluir ? [vigiaDrenagem(ctx)] : []),
  ])
  // A rodada só acaba quando o staff também termina o check-in: senão o telão e a
  // tentativa de mutação parariam no primeiro segundo, sem concorrência de verdade.
  while (ctx.filaCheckin.length > 0 || ctx.checkinEmCurso > 0) await dormir(50)
  ctx.rodadaAtiva = false
  await Promise.all(dePlantao)
  ctx.fimRodada = performance.now()
  const duracaoSegundos = (ctx.fimRodada - ctx.inicioRodada) / 1000

  const resultado = await conferirInvariantes(ctx)
  // A finalização vem DEPOIS das invariantes 1-10: ela apaga travas e revoga aparelhos,
  // que é justamente o estado que elas conferem.
  if (opcoes.finalizar) resultado.finalizacao = await finalizarEvento(ctx)
  imprimirResumo(ctx, resultado, duracaoSegundos)

  await ctx.admin.auth.signOut()
  const furadas = resultado.invariantes.filter((item) => !item.ok)
  const auxiliaresFuradas = resultado.auxiliares.filter((item) => !item.ok)
  const finaisFuradas = (resultado.finalizacao?.invariantes ?? []).filter((item) => !item.ok)
  if (furadas.length > 0 || auxiliaresFuradas.length > 0 || finaisFuradas.length > 0) process.exit(1)
}

principal().catch((erro) => {
  console.error(`\n${erro.message}`)
  process.exit(1)
})
