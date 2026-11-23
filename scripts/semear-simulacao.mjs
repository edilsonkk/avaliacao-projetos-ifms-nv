#!/usr/bin/env node
/**
 * semear-simulacao.mjs — cria um evento de simulação isolado no Supabase LOCAL
 * e o popula com volume realista, para exercitar a aplicação sem encostar no
 * "Evento Local de Teste" do seed.
 *
 * Uso:
 *   node scripts/semear-simulacao.mjs [--projetos=300] [--avaliadores=60]
 *   node scripts/semear-simulacao.mjs --reutilizar   # completa o último evento de simulação
 *   node scripts/semear-simulacao.mjs --limpar       # apaga os eventos de simulação e reativa o seed
 *
 * --projetos e --avaliadores são TOTAIS DESEJADOS, não quantidades a acrescentar:
 * o script cria apenas a diferença que falta e não escreve nada se já houver o
 * suficiente. Com --reutilizar --avaliadores=120 sobre um evento que já tem 75,
 * entram 45 — não 120. Por isso o padrão de uma flag que você não passou nunca
 * infla o evento: ele já está acima do padrão.
 *
 * --reutilizar também move data_evento para hoje, pela sessão de Admin (chave
 * anônima + SUPABASE_ADMIN_EMAIL/SUPABASE_ADMIN_PASSWORD), porque a janela de
 * fn_janela_avaliacao_aberta é de um dia só (data_evento + horario_inicio/fim) e o
 * evento expira à meia-noite. Só esse campo muda: horario_inicio, horario_fim e
 * qualquer outro evento ficam intactos.
 *
 * Guardas (AGENTS.md):
 *   - aborta se VITE_SUPABASE_URL não for 127.0.0.1/localhost, antes de qualquer escrita;
 *   - nunca chama admin_reset_global;
 *   - nenhum DELETE sem WHERE, nenhum TRUNCATE;
 *   - toda leitura/escrita de dados do evento filtra/preenche id_evento (regra 5);
 *   - um único batch upsert por tabela (regra 8).
 */
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { garantirContasLocais, resumirContas } from './lib/contas-locais.mjs'

const PREFIXO_EVENTO = 'Simulação de Carga'
const EVENTO_SEED = 'Evento Local de Teste'
const DOMINIO_SIMULACAO = 'simulacao.invalid'
const FUSO = 'America/Campo_Grande'
const PADRAO_PROJETOS = 300
const PADRAO_AVALIADORES = 60
const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1'])
const ARQUIVOS_ENV = ['../.env', '../.env.simulacao.local']

// ---------------------------------------------------------------- argumentos

function lerArgumentos(argv) {
  const opcoes = {
    projetos: PADRAO_PROJETOS,
    avaliadores: PADRAO_AVALIADORES,
    reutilizar: false,
    limpar: false,
  }
  for (const argumento of argv) {
    const numerico = /^--(projetos|avaliadores)=(\d+)$/.exec(argumento)
    if (numerico) {
      opcoes[numerico[1]] = Number(numerico[2])
      continue
    }
    if (argumento === '--reutilizar') { opcoes.reutilizar = true; continue }
    if (argumento === '--limpar') { opcoes.limpar = true; continue }
    throw new Error(
      `Argumento desconhecido: ${argumento}\n` +
      'Use: --projetos=N --avaliadores=N --reutilizar --limpar',
    )
  }
  if (opcoes.limpar && opcoes.reutilizar) {
    throw new Error('--limpar e --reutilizar não podem ser usados juntos.')
  }
  if (opcoes.projetos < 1 || opcoes.avaliadores < 1) {
    throw new Error('--projetos e --avaliadores precisam ser maiores que zero.')
  }
  return opcoes
}

// --------------------------------------------------------- guarda de ambiente

function exigirSupabaseLocal() {
  // Variáveis já definidas no ambiente têm precedência sobre o arquivo.
  for (const relativo of ARQUIVOS_ENV) {
    const arquivo = new URL(relativo, import.meta.url)
    if (existsSync(arquivo)) process.loadEnvFile(arquivo)
  }

  const url = process.env.VITE_SUPABASE_URL
  if (!url) {
    throw new Error('VITE_SUPABASE_URL não definida. Este script só roda contra o Supabase local.')
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
      'Este script só pode rodar contra 127.0.0.1 ou localhost. Nada foi escrito.',
    )
  }
  return url
}

function obterChaveDeServico() {
  const doAmbiente = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
  if (doAmbiente) return doAmbiente
  let saida
  try {
    saida = execFileSync('npx', ['supabase@2.122.0', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
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

// -------------------------------------------------------------------- apoio

function criarSorteio(semente) {
  let estado = semente >>> 0
  return () => {
    estado |= 0
    estado = (estado + 0x6d2b79f5) | 0
    let valor = Math.imul(estado ^ (estado >>> 15), 1 | estado)
    valor = (valor + Math.imul(valor ^ (valor >>> 7), 61 | valor)) ^ valor
    return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296
  }
}

function partesDeAgoraNoFuso() {
  const formatador = new Intl.DateTimeFormat('sv-SE', {
    timeZone: FUSO,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  // 'sv-SE' formata como "2026-11-21 14:03:09"
  const [data, hora] = formatador.format(new Date()).split(' ')
  return { data, hora }
}

async function emLotes(sb, tabela, linhas, conflito) {
  if (linhas.length === 0) return 0
  const { error } = await sb.from(tabela).upsert(linhas, { onConflict: conflito })
  if (error) throw new Error(`Falha ao gravar em ${tabela}: ${error.message}`)
  return linhas.length
}

async function contar(sb, tabela, coluna, aplicarFiltro) {
  let consulta = sb.from(tabela).select(coluna, { count: 'exact', head: true })
  consulta = aplicarFiltro(consulta)
  const { count, error } = await consulta
  if (error) throw new Error(`Falha ao contar ${tabela}: ${error.message}`)
  return count ?? 0
}

// -------------------------------------------------- etapa 1: evento isolado

/**
 * Monta a linha completa de `eventos`, com todos os campos de que a simulação
 * depende escritos à mão (sem confiar nos defaults da tabela).
 */
function montarEvento(nome, agora) {
  return {
    id_evento: crypto.randomUUID(),
    nome_evento: nome,
    edicao: 'Simulação',
    descricao: 'Evento gerado por scripts/semear-simulacao.mjs para testes de carga locais.',
    logo_url: null,
    is_ativo: true,
    // a simulação depende destes:
    sistema_liberado: true,
    data_evento: agora.data,
    horario_inicio: '00:00:00',
    horario_fim: '23:59:59',
    cota_avaliacoes_padrao: 3,
    minutos_timeout_lock: 30,
    minutos_validade_pareamento: 10,
    metodos_vinculo: 'pareamento',
    // demais colunas, explícitas para não depender de default:
    limite_corte: 0,
    intervalo_pausa_avaliador: 0,
    created_at: new Date().toISOString(),
    data_inicio: agora.data,
    data_fim: agora.data,
    minutos_validade_codigo_acesso: 15,
    tamanho_codigo: 6,
    max_tentativas_codigo: 5,
    url_icone: null,
    url_imagem_evento: null,
    fixar_questionario_primeira_avaliacao: true,
  }
}

/**
 * Troca o evento ativo em UMA requisição (um único INSERT ... ON CONFLICT):
 * todos os outros saem com is_ativo = false e o alvo entra com true no mesmo
 * statement. Não existe instante com dois ativos nem com nenhum ativo, e uma
 * falha não muda nada — o que preserva a garantia de
 * docs/regras-de-negocio/eventos.md ("se a gravação falhar, o evento ativo
 * atual continua ativo") sem a janela de dois ativos que faria
 * evento_ativo_id() divergir de admin_reset_global().
 */
async function aplicarEventoAtivo(sb, { novo = null, idAtivo = null }) {
  const { data: existentes, error } = await sb.from('eventos').select('*')
  if (error) throw new Error(`Falha ao ler eventos: ${error.message}`)

  const alvo = novo ? novo.id_evento : idAtivo
  const linhas = existentes.map((evento) => ({ ...evento, is_ativo: evento.id_evento === alvo }))

  if (novo) {
    const linhaNova = { ...novo }
    // O upsert exige o mesmo conjunto de chaves em todas as linhas.
    for (const coluna of Object.keys(existentes[0] ?? {})) {
      if (!(coluna in linhaNova)) {
        console.warn(`aviso: coluna "${coluna}" de eventos é nova para este script; gravando NULL.`)
        linhaNova[coluna] = null
      }
    }
    linhas.push(linhaNova)
  }

  await emLotes(sb, 'eventos', linhas, 'id_evento')
  return alvo
}

async function ultimoEventoDeSimulacao(sb) {
  const { data, error } = await sb
    .from('eventos')
    .select('id_evento, nome_evento')
    .like('nome_evento', `${PREFIXO_EVENTO}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Falha ao procurar evento de simulação: ${error.message}`)
  return data[0] ?? null
}

/**
 * Sessão de Admin de verdade: chave anônima + login, como a coordenação usa. A chave
 * de serviço do resto do script anula auth.uid(), e então a trilha de auditoria
 * registraria a mudança da data sem autor. Credenciais só de process.env (regra 9).
 */
async function sessaoAdmin(url) {
  const chaveAnonima = process.env.VITE_SUPABASE_ANON_KEY
  const email = (process.env.SUPABASE_ADMIN_EMAIL ?? '').trim()
  const senha = process.env.SUPABASE_ADMIN_PASSWORD ?? ''

  const faltando = []
  if (!chaveAnonima) faltando.push('VITE_SUPABASE_ANON_KEY')
  if (!email) faltando.push('SUPABASE_ADMIN_EMAIL')
  if (!senha) faltando.push('SUPABASE_ADMIN_PASSWORD')
  if (faltando.length > 0) {
    throw new Error(
      `Faltam credenciais para a sessão de Admin: ${faltando.join(', ')}.\n` +
      '--reutilizar move data_evento pela sessão de Admin, não pela chave de serviço.\n' +
      'Defina-as no ambiente ou em .env.simulacao.local (ignorado pelo git). ' +
      'Nunca escreva senha no script, na doc ou no commit.',
    )
  }
  if (papelDaChave(chaveAnonima) === 'service_role') {
    throw new Error('RECUSADO: VITE_SUPABASE_ANON_KEY é uma chave de service_role; ela anula auth.uid().')
  }

  const cliente = createClient(url, chaveAnonima, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await cliente.auth.signInWithPassword({ email, password: senha })
  if (error) {
    throw new Error(
      `Login do Admin falhou: ${error.message}\n` +
      'Confira SUPABASE_ADMIN_EMAIL/SUPABASE_ADMIN_PASSWORD.',
    )
  }
  return cliente
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

/**
 * Move data_evento para hoje — e nada mais. A janela de fn_janela_avaliacao_aberta é
 * de um dia (data_evento + horario_inicio..horario_fim no fuso do evento), então um
 * evento de simulação reaproveitado no dia seguinte já nasce fora da janela e a
 * simulação aborta na pré-condição. O UPDATE filtra por id_evento (regra 5), então
 * nenhum outro evento é tocado, e não encosta em horario_inicio/horario_fim.
 */
async function moverDataDoEvento(url, idEvento, hoje) {
  const admin = await sessaoAdmin(url)
  try {
    const { data: antes, error: erroLeitura } = await admin
      .from('eventos')
      .select('nome_evento, data_evento, horario_inicio, horario_fim, sistema_liberado')
      .eq('id_evento', idEvento)
      .single()
    if (erroLeitura) throw new Error(`Falha ao ler o evento como Admin: ${erroLeitura.message}`)

    const mudou = antes.data_evento !== hoje
    if (mudou) {
      const { error } = await admin.from('eventos').update({ data_evento: hoje }).eq('id_evento', idEvento)
      if (error) {
        throw new Error(
          `Falha ao mover data_evento pela sessão de Admin: ${error.message}\n` +
          'A conta de SUPABASE_ADMIN_EMAIL precisa ter papel ADMIN (policy rls_eventos_admin).',
        )
      }
    }

    const { data: janela, error: erroJanela } = await admin
      .rpc('fn_janela_avaliacao_aberta', { p_id_evento: idEvento })
    if (erroJanela) throw new Error(`Falha ao conferir a janela de avaliação: ${erroJanela.message}`)

    return {
      de: antes.data_evento,
      para: hoje,
      mudou,
      janela,
      horarios: `${antes.horario_inicio ?? '—'} às ${antes.horario_fim ?? '—'}`,
      sistemaLiberado: antes.sistema_liberado,
    }
  } finally {
    await admin.auth.signOut()
  }
}

// ------------------------------------------------- etapa 2: dados do evento

const CAMPI = [
  ['Campo Grande', 'CG', 'Campo Grande'],
  ['Três Lagoas', 'TL', 'Três Lagoas'],
  ['Dourados', 'DR', 'Dourados'],
  ['Corumbá', 'CB', 'Corumbá'],
  ['Aquidauana', 'AQ', 'Aquidauana'],
  ['Nova Andradina', 'NA', 'Nova Andradina'],
  ['Ponta Porã', 'PP', 'Ponta Porã'],
  ['Coxim', 'CX', 'Coxim'],
]

const MODALIDADES = [
  ['Ensino Fundamental', 'EF', 'Fundamental'],
  ['Ensino Médio', 'EM', 'Médio'],
  ['Ensino Técnico Integrado', 'ETI', 'Médio'],
  ['Ensino Técnico Subsequente', 'ETS', 'Técnico'],
  ['Ensino Superior', 'ES', 'Superior'],
  ['Pós-Graduação', 'PG', 'Pós-Graduação'],
]

const AREAS = [
  'Ciências Agrárias', 'Ciências Biológicas', 'Ciências da Saúde',
  'Ciências Exatas e da Terra', 'Ciências Humanas', 'Ciências Sociais Aplicadas',
  'Engenharias', 'Linguística, Letras e Artes', 'Meio Ambiente',
  'Tecnologia da Informação',
]

const CRITERIOS_TECNICOS = [
  ['Relevância e originalidade do tema', 2.5, 'O problema é pertinente e a abordagem traz algo novo?'],
  ['Metodologia científica', 2.5, 'Os métodos são adequados, descritos e reprodutíveis?'],
  ['Resultados e conclusões', 2.0, 'Os resultados sustentam as conclusões apresentadas?'],
  ['Apresentação oral e domínio do conteúdo', 1.5, 'A equipe explica com clareza e responde às perguntas?'],
  ['Qualidade do material e do estande', 1.5, 'Banner, protótipo e organização do estande.'],
]

const VERBOS = ['Desenvolvimento de', 'Avaliação de', 'Análise de', 'Monitoramento de', 'Automação de', 'Estudo de', 'Prototipagem de', 'Mapeamento de']
const OBJETOS = ['um sistema de irrigação', 'biossensores de baixo custo', 'resíduos sólidos urbanos', 'energia solar fotovoltaica', 'qualidade da água do Pantanal', 'um aplicativo de acessibilidade', 'compostagem escolar', 'drones para agricultura familiar', 'cerâmica de resíduo de construção', 'hortas hidropônicas', 'bioplástico de amido', 'rede de sensores IoT']
const CONTEXTOS = ['no Pantanal sul-mato-grossense', 'em comunidades ribeirinhas', 'na agricultura familiar', 'em escolas públicas', 'no Cerrado', 'em assentamentos rurais', 'na indústria local', 'em áreas urbanas periféricas']

const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nelson', 'Olívia', 'Paulo', 'Queila', 'Rafael', 'Sabrina', 'Thiago', 'Úrsula', 'Vinícius', 'Wagner', 'Yara']
const SOBRENOMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Almeida', 'Costa', 'Gomes', 'Martins', 'Araújo', 'Barbosa', 'Ribeiro', 'Carvalho', 'Lima', 'Nogueira', 'Pereira', 'Cavalcante']

function normalizar(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
}

function umDe(sorteio, lista) {
  return lista[Math.floor(sorteio() * lista.length)]
}

async function catalogosDoEvento(sb, idEvento) {
  const [instituicoes, modalidades, areas, questionarios] = await Promise.all([
    sb.from('instituicoes').select('id_instituicao').eq('id_evento', idEvento),
    sb.from('modalidades').select('id_modalidade').eq('id_evento', idEvento),
    sb.from('areas_tematicas').select('id_area').eq('id_evento', idEvento),
    sb.from('questionarios').select('id_questionario, is_voto_popular').eq('id_evento', idEvento),
  ])
  for (const resposta of [instituicoes, modalidades, areas, questionarios]) {
    if (resposta.error) throw new Error(`Falha ao ler catálogos: ${resposta.error.message}`)
  }
  return {
    instituicoes: instituicoes.data.map((linha) => linha.id_instituicao),
    modalidades: modalidades.data.map((linha) => linha.id_modalidade),
    areas: areas.data.map((linha) => linha.id_area),
    questionarios: questionarios.data,
  }
}

async function semearCatalogos(sb, idEvento) {
  const instituicoes = CAMPI.map(([nome, sigla, cidade]) => ({
    id_instituicao: crypto.randomUUID(),
    id_evento: idEvento,
    nome_exibicao: `IFMS — Campus ${nome}`,
    nome_normalizado: normalizar(`IFMS Campus ${nome}`),
    sigla: `IFMS-${sigla}`,
    campus: nome,
    cidade,
    estado: 'MS',
  }))
  const modalidades = MODALIDADES.map(([nome, codigo, nivel]) => ({
    id_modalidade: crypto.randomUUID(),
    id_evento: idEvento,
    nome_modalidade: nome,
    codigo,
    nivel,
    descricao: `Projetos de ${nome.toLowerCase()}.`,
  }))
  const areas = AREAS.map((nome) => ({
    id_area: crypto.randomUUID(),
    id_evento: idEvento,
    nome_area: nome,
  }))

  const idTecnico = crypto.randomUUID()
  const idVotoPopular = crypto.randomUUID()
  const questionarios = [
    {
      id_questionario: idTecnico,
      id_evento: idEvento,
      titulo: 'Avaliação Técnica — Simulação',
      escala_minima: 0,
      escala_maxima: 10,
      is_voto_popular: false,
    },
    {
      id_questionario: idVotoPopular,
      id_evento: idEvento,
      titulo: 'Voto Popular — Simulação',
      escala_minima: 0,
      escala_maxima: 10,
      is_voto_popular: true,
    },
  ]
  const perguntas = [
    ...CRITERIOS_TECNICOS.map(([texto, peso, lembrete], indice) => ({
      id_pergunta: crypto.randomUUID(),
      id_questionario: idTecnico,
      ordem: indice + 1,
      texto_pergunta: texto,
      peso_calculo: peso,
      peso_desempate: peso,
      descricao_lembrete: lembrete,
    })),
    {
      id_pergunta: crypto.randomUUID(),
      id_questionario: idVotoPopular,
      ordem: 1,
      texto_pergunta: 'O quanto você gostou deste projeto?',
      peso_calculo: 1,
      peso_desempate: 1,
      descricao_lembrete: 'Nota livre do público visitante.',
    },
  ]

  await emLotes(sb, 'instituicoes', instituicoes, 'id_instituicao')
  await emLotes(sb, 'modalidades', modalidades, 'id_modalidade')
  await emLotes(sb, 'areas_tematicas', areas, 'id_area')
  await emLotes(sb, 'questionarios', questionarios, 'id_questionario')
  await emLotes(sb, 'perguntas_questionario', perguntas, 'id_pergunta')

  return {
    instituicoes: instituicoes.map((linha) => linha.id_instituicao),
    modalidades: modalidades.map((linha) => linha.id_modalidade),
    areas: areas.map((linha) => linha.id_area),
    questionarios: questionarios.map(({ id_questionario, is_voto_popular }) => ({ id_questionario, is_voto_popular })),
  }
}

async function semearProjetos(sb, idEvento, catalogos, quantidade, sorteio) {
  if (quantidade <= 0) return 0
  const { count, error } = await sb
    .from('projetos')
    .select('id_projeto', { count: 'exact', head: true })
    .eq('id_evento', idEvento)
  if (error) throw new Error(`Falha ao contar projetos existentes: ${error.message}`)

  const inicio = (count ?? 0) + 1
  const projetos = []
  for (let indice = 0; indice < quantidade; indice += 1) {
    const sequencial = inicio + indice
    projetos.push({
      id_projeto: crypto.randomUUID(),
      id_evento: idEvento,
      codigo_projeto: `SIM-${String(sequencial).padStart(4, '0')}`,
      id_instituicao: umDe(sorteio, catalogos.instituicoes),
      id_area: umDe(sorteio, catalogos.areas),
      id_modalidade: umDe(sorteio, catalogos.modalidades),
      titulo: `${umDe(sorteio, VERBOS)} ${umDe(sorteio, OBJETOS)} ${umDe(sorteio, CONTEXTOS)}`,
      estande: String(sequencial).padStart(3, '0'),
      corredor: String.fromCharCode(65 + (sequencial % 6)),
      expositores: Array.from({ length: 1 + Math.floor(sorteio() * 3) }, () =>
        `${umDe(sorteio, NOMES)} ${umDe(sorteio, SOBRENOMES)}`).join(', '),
      is_check_in_realizado: sorteio() < 0.85,
      is_fora_da_competicao: sorteio() < 0.04,
      forcar_topo_fila: false,
      contagem_ausencia: 0,
      ajuste_media: 0,
    })
  }
  return emLotes(sb, 'projetos', projetos, 'id_projeto')
}

async function semearAvaliadores(sb, idEvento, catalogos, quantidade, sorteio, carimbo, deslocamento = 0) {
  if (quantidade <= 0) return 0
  const idVotoPopular = catalogos.questionarios.find((q) => q.is_voto_popular)?.id_questionario ?? null

  const usuarios = []
  const inscricoes = []
  const afinidades = []
  const bloqueios = []

  for (let indice = 0; indice < quantidade; indice += 1) {
    const idUsuario = crypto.randomUUID()
    const nome = `${umDe(sorteio, NOMES)} ${umDe(sorteio, SOBRENOMES)} ${umDe(sorteio, SOBRENOMES)}`
    usuarios.push({
      id_usuario: idUsuario,
      nome,
      // o carimbo mantém o e-mail único entre execuções (usuarios.email é UNIQUE global)
      email: `avaliador.${String(deslocamento + indice + 1).padStart(3, '0')}.${carimbo}@${DOMINIO_SIMULACAO}`,
      papel: 'AVALIADOR',
    })
    inscricoes.push({
      id_usuario: idUsuario,
      id_evento: idEvento,
      id_instituicao: umDe(sorteio, catalogos.instituicoes),
      is_credenciado: sorteio() < 0.85,
      // ~10% são votantes do voto popular; o resto usa o questionário do projeto
      id_questionario: sorteio() < 0.1 ? idVotoPopular : null,
    })

    const areasSorteadas = new Set()
    const quantasAreas = 1 + Math.floor(sorteio() * 3)
    while (areasSorteadas.size < quantasAreas) areasSorteadas.add(umDe(sorteio, catalogos.areas))
    for (const idArea of areasSorteadas) {
      afinidades.push({ id_usuario: idUsuario, id_evento: idEvento, id_area: idArea })
    }

    if (sorteio() < 0.3) {
      bloqueios.push({
        id_usuario: idUsuario,
        id_evento: idEvento,
        id_modalidade: umDe(sorteio, catalogos.modalidades),
      })
    }
  }

  await emLotes(sb, 'usuarios', usuarios, 'email')
  await emLotes(sb, 'avaliadores_evento', inscricoes, 'id_usuario,id_evento')
  await emLotes(sb, 'avaliador_areas', afinidades, 'id_usuario,id_evento,id_area')
  await emLotes(sb, 'avaliador_modalidades_bloqueadas', bloqueios, 'id_usuario,id_evento,id_modalidade')
  return usuarios.length
}

// ----------------------------------------------------------------- limpeza

async function limpar(sb) {
  const { data: eventos, error } = await sb
    .from('eventos')
    .select('id_evento, nome_evento')
    .like('nome_evento', `${PREFIXO_EVENTO}%`)
  if (error) throw new Error(`Falha ao listar eventos de simulação: ${error.message}`)

  if (eventos.length === 0) {
    console.log('Nenhum evento de simulação encontrado. Nada a apagar.')
  } else {
    const idsEventos = eventos.map((evento) => evento.id_evento)

    // Avaliadores da simulação: só apaga quem não participa de nenhum outro evento.
    const { data: candidatos, error: erroUsuarios } = await sb
      .from('usuarios')
      .select('id_usuario')
      .like('email', `%@${DOMINIO_SIMULACAO}`)
    if (erroUsuarios) throw new Error(`Falha ao listar avaliadores da simulação: ${erroUsuarios.message}`)

    let idsParaApagar = []
    if (candidatos.length > 0) {
      const { data: fora, error: erroFora } = await sb
        .from('avaliadores_evento')
        .select('id_usuario')
        .in('id_usuario', candidatos.map((linha) => linha.id_usuario))
        .not('id_evento', 'in', `(${idsEventos.join(',')})`)
      if (erroFora) throw new Error(`Falha ao conferir vínculos externos: ${erroFora.message}`)

      const protegidos = new Set(fora.map((linha) => linha.id_usuario))
      idsParaApagar = candidatos
        .map((linha) => linha.id_usuario)
        .filter((id) => !protegidos.has(id))

      if (idsParaApagar.length > 0) {
        const { error: erroApagar } = await sb.from('usuarios').delete().in('id_usuario', idsParaApagar)
        if (erroApagar) throw new Error(`Falha ao apagar avaliadores da simulação: ${erroApagar.message}`)
      }
      if (protegidos.size > 0) {
        console.log(`${protegidos.size} avaliador(es) preservados: têm vínculo em outro evento.`)
      }
    }

    // Apagar o evento leva junto projetos, questionários, instituições,
    // modalidades e áreas, por ON DELETE CASCADE.
    const { error: erroEventos } = await sb.from('eventos').delete().in('id_evento', idsEventos)
    if (erroEventos) throw new Error(`Falha ao apagar eventos de simulação: ${erroEventos.message}`)

    console.log(`Apagados ${eventos.length} evento(s) de simulação e ${idsParaApagar.length} avaliador(es).`)
  }

  // Reativa o evento do seed; se ele não existir neste banco, cai para o evento
  // não-simulado mais recente, para nunca deixar o banco sem evento ativo.
  const { data: restantes, error: erroRestantes } = await sb
    .from('eventos')
    .select('id_evento, nome_evento')
    .not('nome_evento', 'like', `${PREFIXO_EVENTO}%`)
    .order('created_at', { ascending: false })
  if (erroRestantes) throw new Error(`Falha ao listar eventos restantes: ${erroRestantes.message}`)

  const alvo = restantes.find((evento) => evento.nome_evento === EVENTO_SEED) ?? restantes[0]
  if (!alvo) {
    console.warn('aviso: não sobrou nenhum evento não-simulado; o banco ficou sem evento ativo.')
    return
  }
  if (alvo.nome_evento !== EVENTO_SEED) {
    console.warn(`aviso: "${EVENTO_SEED}" não existe neste banco.`)
  }
  await aplicarEventoAtivo(sb, { idAtivo: alvo.id_evento })
  console.log(`"${alvo.nome_evento}" reativado.`)
}

// ---------------------------------------------------------------- relatório

/**
 * Conta, por tabela, o que já existe no evento. Chamado antes e depois da semeadura:
 * "criados" é a diferença entre os dois retratos, lida do banco, não do que o script
 * acha que gravou — um upsert que caiu em linha existente aparece como 0 criado.
 */
async function contarTabelas(sb, idEvento) {
  const { data: questionarios, error } = await sb
    .from('questionarios')
    .select('id_questionario')
    .eq('id_evento', idEvento)
  if (error) throw new Error(`Falha ao ler questionários: ${error.message}`)
  const idsQuestionarios = questionarios.map((linha) => linha.id_questionario)

  const porEvento = (consulta) => consulta.eq('id_evento', idEvento)

  return {
    instituicoes: await contar(sb, 'instituicoes', 'id_instituicao', porEvento),
    modalidades: await contar(sb, 'modalidades', 'id_modalidade', porEvento),
    areas_tematicas: await contar(sb, 'areas_tematicas', 'id_area', porEvento),
    questionarios: idsQuestionarios.length,
    perguntas_questionario: idsQuestionarios.length === 0 ? 0 : await contar(
      sb, 'perguntas_questionario', 'id_pergunta', (c) => c.in('id_questionario', idsQuestionarios)),
    projetos: await contar(sb, 'projetos', 'id_projeto', porEvento),
    avaliadores_evento: await contar(sb, 'avaliadores_evento', 'id_usuario', porEvento),
    avaliador_areas: await contar(sb, 'avaliador_areas', 'id_usuario', porEvento),
    avaliador_modalidades_bloqueadas: await contar(
      sb, 'avaliador_modalidades_bloqueadas', 'id_usuario', porEvento),
    'usuarios (domínio da simulação, global)': await contar(
      sb, 'usuarios', 'id_usuario', (c) => c.like('email', `%@${DOMINIO_SIMULACAO}`)),
  }
}

function relatorio(idEvento, antes, depois) {
  const nomes = Object.keys(depois)
  const maior = Math.max(...nomes.map((nome) => nome.length), 6)
  console.log('')
  console.log(`id_evento: ${idEvento}`)
  console.log('')
  console.log(`  ${'tabela'.padEnd(maior)}  ${'já havia'.padStart(9)}  ${'criados'.padStart(7)}  ${'total'.padStart(6)}`)
  console.log(`  ${'-'.repeat(maior)}  ${'-'.repeat(9)}  ${'-'.repeat(7)}  ${'-'.repeat(6)}`)
  for (const nome of nomes) {
    const criados = depois[nome] - antes[nome]
    console.log(
      `  ${nome.padEnd(maior)}  ${String(antes[nome]).padStart(9)}  ` +
      `${String(criados).padStart(7)}  ${String(depois[nome]).padStart(6)}`,
    )
  }
}

// -------------------------------------------------------------------- main

async function principal() {
  const opcoes = lerArgumentos(process.argv.slice(2))
  const url = exigirSupabaseLocal()
  const sb = createClient(url, obterChaveDeServico(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (opcoes.limpar) {
    // `--limpar` não precisa de conta nem de credencial: não exigir nada aqui.
    await limpar(sb)
    return
  }

  // Antes de qualquer semeadura: sem Admin e Staff o evento semeado é inútil, e a
  // rodada abortaria no primeiro login. Idempotente e silencioso quando nada falta.
  console.log(resumirContas(await garantirContasLocais()))

  const agora = partesDeAgoraNoFuso()
  const carimbo = `${agora.data} ${agora.hora}`
  const sorteio = criarSorteio(Date.now() % 2147483647)

  let idEvento
  if (opcoes.reutilizar) {
    const existente = await ultimoEventoDeSimulacao(sb)
    if (!existente) {
      console.log('Nenhum evento de simulação encontrado; criando um novo.')
    } else {
      idEvento = await aplicarEventoAtivo(sb, { idAtivo: existente.id_evento })
      console.log(`Reutilizando "${existente.nome_evento}".`)
      // Antes de qualquer escrita de volume: se faltar credencial de Admin, aborta aqui.
      const data = await moverDataDoEvento(url, idEvento, agora.data)
      console.log(data.mudou
        ? `data_evento: ${data.de} -> ${data.para} (sessão de Admin; janela ${data.horarios} intacta)`
        : `data_evento: ${data.para} (já era hoje; nada mudado)`)
      console.log(`fn_janela_avaliacao_aberta: ${data.janela}` +
        (data.janela ? '' : `  (sistema_liberado: ${data.sistemaLiberado}, janela ${data.horarios})`))
    }
  }

  if (!idEvento) {
    const evento = montarEvento(`${PREFIXO_EVENTO} ${carimbo}`, agora)
    idEvento = await aplicarEventoAtivo(sb, { novo: evento })
    console.log(`Evento criado: "${evento.nome_evento}" (data_evento: ${evento.data_evento})`)
  }
  console.log(`id_evento: ${idEvento}`)

  const antes = await contarTabelas(sb, idEvento)

  const existentes = await catalogosDoEvento(sb, idEvento)
  const catalogos = existentes.instituicoes.length > 0 && existentes.questionarios.length > 0
    ? existentes
    : await semearCatalogos(sb, idEvento)

  // --projetos e --avaliadores são totais desejados: cria só a diferença que falta.
  const faltamProjetos = Math.max(0, opcoes.projetos - antes.projetos)
  const faltamAvaliadores = Math.max(0, opcoes.avaliadores - antes.avaliadores_evento)
  console.log(
    `alvo: ${opcoes.projetos} projetos (faltam ${faltamProjetos}), ` +
    `${opcoes.avaliadores} avaliadores (faltam ${faltamAvaliadores})`,
  )

  await semearProjetos(sb, idEvento, catalogos, faltamProjetos, sorteio)
  await semearAvaliadores(sb, idEvento, catalogos, faltamAvaliadores, sorteio,
    carimbo.replace(/[^0-9]/g, ''), antes.avaliadores_evento)

  const depois = await contarTabelas(sb, idEvento)
  relatorio(idEvento, antes, depois)
}

principal().catch((erro) => {
  console.error(`\n${erro.message}`)
  process.exit(1)
})
