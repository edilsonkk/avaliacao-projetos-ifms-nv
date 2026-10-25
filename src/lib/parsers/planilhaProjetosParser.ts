import * as XLSX from 'xlsx';

export interface ProjetoLinhaPlanilha {
  codigo_projeto: string | null;
  titulo: string;
  estande: string | null;
  corredor: string | null;
  instituicao: string | null;
  sigla_instituicao: string | null;
  area_tematica: string | null;
  modalidade: string | null;
  fora_da_competicao: boolean;
  linha_original: number;
}

export interface ResultadoParsingPlanilha {
  sucesso: boolean;
  projetos: ProjetoLinhaPlanilha[];
  total_lido: number;
  avisos: string[];
}

/**
 * Função utilitária para normalizar strings removendo diacríticos e espaços extras.
 */
export const normalizarChave = (txt: string): string => {
  return txt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

/**
 * Converte valor bruto da planilha para string limpa, tratando números e datas.
 */
export const formatarValorString = (valor: unknown): string => {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) {
    return valor.toISOString().split('T')[0];
  }
  return String(valor).trim();
};

/**
 * Converte valores afirmativos em booleano para fora_da_competicao.
 */
export const formatarBooleano = (valor: unknown): boolean => {
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return valor === 1;
  const texto = normalizarChave(String(valor || ''));
  return ['sim', 's', 'true', '1', 'yes'].includes(texto);
};

/**
 * Parser puro para arquivos Excel (.xlsx / .xls) ou CSV contendo projetos da feira.
 * Executa de forma desacoplada do React, ideal para ambientes Node e testes automatizados.
 */
export const parsePlanilhaProjetos = (
  conteudoArquivo: ArrayBuffer | Uint8Array | string,
  isCSV = false
): ResultadoParsingPlanilha => {
  if (!conteudoArquivo) {
    throw new Error('Conteúdo do arquivo ausente ou inválido.');
  }

  let workbook: XLSX.WorkBook;

  try {
    if (isCSV && typeof conteudoArquivo === 'string') {
      workbook = XLSX.read(conteudoArquivo, { type: 'string', raw: true });
    } else if (conteudoArquivo instanceof Uint8Array) {
      workbook = XLSX.read(conteudoArquivo, { type: 'array', cellDates: true });
    } else if (conteudoArquivo instanceof ArrayBuffer) {
      workbook = XLSX.read(new Uint8Array(conteudoArquivo), { type: 'array', cellDates: true });
    } else {
      workbook = XLSX.read(conteudoArquivo, { type: 'binary', cellDates: true });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha ao ler o formato do arquivo: ${msg}`);
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('A planilha selecionada não contém abas válidas.');
  }

  const primeiraAba = workbook.Sheets[workbook.SheetNames[0]];
  if (!primeiraAba) {
    throw new Error('A aba de dados da planilha está vazia.');
  }

  const dadosBrutos: Record<string, unknown>[] = XLSX.utils.sheet_to_json(primeiraAba, {
    defval: '',
  });

  if (dadosBrutos.length === 0) {
    throw new Error('A planilha selecionada está vazia ou não contém linhas de dados.');
  }

  const projetos: ProjetoLinhaPlanilha[] = [];
  const avisos: string[] = [];

  dadosBrutos.forEach((linha, index) => {
    const numLinha = index + 2;
    const keys = Object.keys(linha);

    let codigo_extraido = '';
    let titulo_extraido = '';
    let estande_extraido = '';
    let corredor_extraido = '';
    let instituicao_extraida = '';
    let sigla_extraida = '';
    let area_extraida = '';
    let modalidade_extraida = '';
    let fora_extraido = '';

    keys.forEach((k) => {
      const kLower = normalizarChave(k);
      const val = formatarValorString(linha[k]);

      if (
        kLower === 'id' ||
        kLower === 'cod' ||
        kLower === 'codigo' ||
        kLower === 'codigo_projeto' ||
        kLower.includes('id do projeto') ||
        kLower.includes('id_projeto') ||
        kLower.includes('id projeto') ||
        kLower.includes('codigo do projeto') ||
        kLower.includes('chave natural')
      ) {
        codigo_extraido = val;
      } else if (
        kLower.includes('titulo') ||
        kLower.includes('nome do projeto') ||
        kLower === 'projeto'
      ) {
        titulo_extraido = val;
      } else if (kLower.includes('estande') || kLower.includes('stand')) {
        estande_extraido = val;
      } else if (kLower.includes('corredor') || kLower.includes('ala') || kLower.includes('bloco')) {
        corredor_extraido = val;
      } else if (kLower.includes('sigla')) {
        sigla_extraida = val;
      } else if (
        kLower.includes('instituicao') ||
        kLower.includes('escola') ||
        kLower.includes('colegio') ||
        kLower.includes('campus')
      ) {
        instituicao_extraida = val;
      } else if (
        kLower.includes('area') ||
        kLower.includes('eixo') ||
        kLower.includes('tematica')
      ) {
        area_extraida = val;
      } else if (
        kLower.includes('modalidade') ||
        kLower.includes('nivel') ||
        kLower.includes('ensino')
      ) {
        modalidade_extraida = val;
      } else if (
        kLower.includes('fora_da_competicao') ||
        kLower.includes('fora da competicao') ||
        kLower.includes('hors-concours') ||
        kLower.includes('apenas exibicao') ||
        kLower.includes('demonstracao')
      ) {
        fora_extraido = val;
      }
    });

    // Fallbacks para título se coluna tiver cabeçalho não reconhecido
    if (!titulo_extraido && keys.length > 1) {
      titulo_extraido = formatarValorString(linha[keys[1]]);
    } else if (!titulo_extraido && keys.length > 0) {
      titulo_extraido = formatarValorString(linha[keys[0]]);
    }

    // Se ambos código e título forem vazios, ignora linha
    if (!titulo_extraido && !codigo_extraido) {
      avisos.push(`Linha ${numLinha}: Título e Código ausentes. Linha ignorada.`);
      return;
    }

    projetos.push({
      codigo_projeto: codigo_extraido || null,
      titulo: titulo_extraido || 'Projeto Sem Título',
      estande: estande_extraido || null,
      corredor: corredor_extraido || null,
      instituicao: instituicao_extraida || null,
      sigla_instituicao: sigla_extraida || null,
      area_tematica: area_extraida || null,
      modalidade: modalidade_extraida || null,
      fora_da_competicao: formatarBooleano(fora_extraido),
      linha_original: numLinha,
    });
  });

  return {
    sucesso: projetos.length > 0,
    projetos,
    total_lido: dadosBrutos.length,
    avisos,
  };
};
