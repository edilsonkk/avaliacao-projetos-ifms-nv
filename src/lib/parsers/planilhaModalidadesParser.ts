/**
 * Parser puro de Planilhas de Modalidades e Níveis (.xlsx, .xls, .csv)
 * Conforme diretrizes TDD (Regra 2.A): funções puras desacopladas de React/DOM.
 */
import * as XLSX from 'xlsx';
import { sanitizarTexto } from './fuzzyMatcher';

export interface ModalidadeImportada {
  codigo?: string | null;
  nome_modalidade: string;
  nivel?: string | null;
  area_tematica?: string | null;
  descricao?: string | null;
  linha_original: number;
}

export interface ResultadoParsingModalidades {
  sucesso: boolean;
  modalidades: ModalidadeImportada[];
  erros: Array<{ linha: number; mensagem: string }>;
  totalLinhasLidas: number;
}

/**
 * Normaliza cabeçalho para comparação tolerante
 */
export function normalizarHeader(header: string): string {
  return sanitizarTexto(header);
}

/**
 * Realiza parsing determinístico de planilhas de modalidades e níveis
 */
export function parsePlanilhaModalidades(
  dataBuffer: ArrayBuffer | string,
  isCSV: boolean = false
): ResultadoParsingModalidades {
  try {
    let workbook: XLSX.WorkBook;

    if (isCSV && typeof dataBuffer === 'string') {
      workbook = XLSX.read(dataBuffer, { type: 'string' });
    } else {
      workbook = XLSX.read(dataBuffer, { type: 'array' });
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return {
        sucesso: false,
        modalidades: [],
        erros: [{ linha: 0, mensagem: 'O arquivo não possui nenhuma planilha/aba válida.' }],
        totalLinhasLidas: 0,
      };
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      return {
        sucesso: false,
        modalidades: [],
        erros: [{ linha: 0, mensagem: 'A planilha está vazia.' }],
        totalLinhasLidas: 0,
      };
    }

    const modalidades: ModalidadeImportada[] = [];
    const erros: Array<{ linha: number; mensagem: string }> = [];

    rawRows.forEach((row, index) => {
      const numLinha = index + 2; // +1 cabeçalho, +1 base 1
      const chaves = Object.keys(row);

      // Localiza chave correspondente para cada coluna desejada
      const chaveCodigo = chaves.find((k) => {
        const norm = normalizarHeader(k);
        return norm === 'CODIGO' || norm === 'COD' || norm === 'ID';
      });

      const chaveModalidade = chaves.find((k) => {
        const norm = normalizarHeader(k);
        return norm === 'MODALIDADE' || norm === 'NOME' || norm === 'MODALIDADE E NIVEL' || norm === 'NOME DA MODALIDADE';
      });

      const chaveNivel = chaves.find((k) => {
        const norm = normalizarHeader(k);
        return norm === 'NIVEL' || norm === 'NIVEL DE ENSINO' || norm === 'ESCOLARIDADE';
      });

      const chaveArea = chaves.find((k) => {
        const norm = normalizarHeader(k);
        return norm === 'AREA TEMATICA' || norm === 'AREA' || norm === 'EIXO';
      });

      const chaveDescricao = chaves.find((k) => {
        const norm = normalizarHeader(k);
        return norm === 'DESCRICAO' || norm === 'OBSERVACAO' || norm === 'DETALHES';
      });

      const valorModalidade = chaveModalidade ? String(row[chaveModalidade]).trim() : '';

      if (!valorModalidade) {
        erros.push({
          linha: numLinha,
          mensagem: `Linha ${numLinha}: Nome da Modalidade é obrigatório e não foi informado.`,
        });
        return;
      }

      modalidades.push({
        codigo: chaveCodigo && row[chaveCodigo] ? String(row[chaveCodigo]).trim() : null,
        nome_modalidade: valorModalidade,
        nivel: chaveNivel && row[chaveNivel] ? String(row[chaveNivel]).trim() : null,
        area_tematica: chaveArea && row[chaveArea] ? String(row[chaveArea]).trim() : null,
        descricao: chaveDescricao && row[chaveDescricao] ? String(row[chaveDescricao]).trim() : null,
        linha_original: numLinha,
      });
    });

    return {
      sucesso: modalidades.length > 0,
      modalidades,
      erros,
      totalLinhasLidas: rawRows.length,
    };
  } catch (err: any) {
    return {
      sucesso: false,
      modalidades: [],
      erros: [{ linha: 0, mensagem: `Erro ao decodificar arquivo: ${err?.message || 'Arquivo corrompido'}` }],
      totalLinhasLidas: 0,
    };
  }
}
