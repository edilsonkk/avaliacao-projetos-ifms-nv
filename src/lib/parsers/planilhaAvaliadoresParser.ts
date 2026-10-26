import { lerPlanilhaParaJson } from '@/lib/excelUtils';

export interface AvaliadorLinhaPlanilha {
  nome: string;
  email: string;
  instituicao: string | null;
  sigla_instituicao: string | null;
  modalidades_bloqueadas: string[];
  areas: string[];
  linha_original: number;
}

export interface ResultadoParsingAvaliadores {
  sucesso: boolean;
  avaliadores: AvaliadorLinhaPlanilha[];
  total_lido: number;
  erros: Array<{ linha: number; mensagem: string }>;
  avisos: string[];
}

/**
 * Normaliza strings removendo diacríticos e convertendo para minúsculas.
 */
export const normalizarChave = (txt: string): string => {
  return txt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

/**
 * Converte valor bruto da planilha para string limpa.
 */
export const formatarValorString = (valor: unknown): string => {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
};

/**
 * Converte uma string com nomes de modalidades separados por vírgula ou ponto-e-vírgula em array limpo.
 */
export const extrairModalidadesBloqueadas = (valor: unknown): string[] => {
  if (!valor) return [];
  const texto = formatarValorString(valor);
  if (!texto) return [];

  return texto
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

/**
 * Converte uma string com nomes de áreas de avaliação separados por vírgula, barra, traço, ponto-e-vírgula, etc. em array limpo.
 */
export const extrairAreas = (valor: unknown): string[] => {
  if (!valor) return [];
  const texto = formatarValorString(valor);
  if (!texto) return [];

  return texto
    .split(/[,;\/\\|–—]|(?:\s*-\s*)/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

/**
 * Parser puro para arquivos Excel (.xlsx) ou CSV contendo avaliadores da feira.
 * Desacoplado do React e compatível com ambiente Node (para testes unitários).
 */
export const parsePlanilhaAvaliadores = async (
  conteudoArquivo: ArrayBuffer | Uint8Array | string,
  isCSV = false
): Promise<ResultadoParsingAvaliadores> => {
  if (!conteudoArquivo) {
    throw new Error('Conteúdo do arquivo ausente ou inválido.');
  }

  const dadosBrutos = await lerPlanilhaParaJson(conteudoArquivo, isCSV);

  if (dadosBrutos.length === 0) {
    throw new Error('A planilha selecionada está vazia ou não contém linhas de dados.');
  }

  const avaliadoresMap = new Map<string, AvaliadorLinhaPlanilha>();
  const erros: Array<{ linha: number; mensagem: string }> = [];
  const avisos: string[] = [];

  dadosBrutos.forEach((linha, index) => {
    const numLinha = index + 2;
    const keys = Object.keys(linha);

    let nome_extraido = '';
    let email_extraido = '';
    let instituicao_extraida = '';
    let sigla_extraida = '';
    let modalidades_brutas = '';
    let areas_brutas = '';

    keys.forEach((k) => {
      const kLower = normalizarChave(k);
      const val = formatarValorString(linha[k]);

      if (kLower.includes('email') || kLower.includes('mail') || kLower.includes('contato')) {
        email_extraido = val.toLowerCase();
      } else if (
        kLower.includes('modalidade_bloqueada') ||
        kLower.includes('modalidades_bloqueadas') ||
        kLower.includes('bloqueio_modalidade') ||
        kLower.includes('bloqueio de modalidade') ||
        kLower.includes('modalidades bloqueadas') ||
        kLower.includes('bloqueio') ||
        kLower.includes('bloqueadas')
      ) {
        modalidades_brutas = val;
      } else if (
        kLower === 'area' ||
        kLower === 'areas' ||
        kLower.includes('area_avaliacao') ||
        kLower.includes('areas_avaliacao') ||
        kLower.includes('area de avaliacao') ||
        kLower.includes('areas de avaliacao') ||
        kLower.includes('area_tematica') ||
        kLower.includes('areas_tematicas') ||
        kLower.includes('area tematica') ||
        kLower.includes('areas tematicas') ||
        kLower.includes('afinidade') ||
        kLower.includes('grande_area') ||
        kLower.includes('grandes_areas')
      ) {
        areas_brutas = val;
      } else if (kLower.includes('sigla')) {
        sigla_extraida = val;
      } else if (
        kLower.includes('instituicao') ||
        kLower.includes('instituic') ||
        kLower.includes('origem') ||
        kLower.includes('campus') ||
        kLower.includes('escola')
      ) {
        instituicao_extraida = val;
      } else if (
        kLower.includes('nome') ||
        kLower.includes('avaliador') ||
        kLower === 'nome completo'
      ) {
        nome_extraido = val;
      }
    });

    // Fallbacks para nome e e-mail com base em índices se colunas forem genéricas
    if (!nome_extraido && keys.length > 0) {
      nome_extraido = formatarValorString(linha[keys[0]]);
    }
    if (!email_extraido && keys.length > 1) {
      const possivelEmail = formatarValorString(linha[keys[1]]).toLowerCase();
      if (possivelEmail.includes('@')) {
        email_extraido = possivelEmail;
      }
    }

    if (!email_extraido || !email_extraido.includes('@')) {
      erros.push({
        linha: numLinha,
        mensagem: `Linha ${numLinha}: E-mail ausente ou inválido ("${email_extraido || 'vazio'}"). Linha ignorada.`,
      });
      return;
    }

    const modalidadesBloqueadas = extrairModalidadesBloqueadas(modalidades_brutas);
    const areasExtraidas = extrairAreas(areas_brutas);

    avaliadoresMap.set(email_extraido, {
      nome: nome_extraido || 'Avaliador Convidado',
      email: email_extraido,
      instituicao: instituicao_extraida || null,
      sigla_instituicao: sigla_extraida || null,
      modalidades_bloqueadas: modalidadesBloqueadas,
      areas: areasExtraidas,
      linha_original: numLinha,
    });
  });

  const avaliadores = Array.from(avaliadoresMap.values());

  return {
    sucesso: avaliadores.length > 0,
    avaliadores,
    total_lido: dadosBrutos.length,
    erros,
    avisos,
  };
};
