/**
 * Parser puro de Planilhas de Modalidades e Níveis (.xlsx, .csv)
 * Conforme diretrizes TDD (Regra 2.A): funções puras desacopladas de React/DOM.
 */
import { lerPlanilhaParaJson } from '@/lib/excel/excelUtils';
import { sanitizarTexto } from '@/lib/parsers/fuzzyMatcher';

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
export async function parsePlanilhaModalidades(
  dataBuffer: ArrayBuffer | Uint8Array | string,
  isCSV: boolean = false
): Promise<ResultadoParsingModalidades> {
  try {
    const rawRows = await lerPlanilhaParaJson(dataBuffer, isCSV);

    if (!rawRows || rawRows.length === 0) {
      return {
        sucesso: false,
        modalidades: [],
        erros: [{ linha: 0, mensagem: 'A planilha está vazia ou não contém abas válidas.' }],
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

      const valorModalidade = chaveModalidade ? String(row[chaveModalidade] ?? '').trim() : '';

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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      sucesso: false,
      modalidades: [],
      erros: [{ linha: 0, mensagem: `Erro ao decodificar arquivo: ${msg}` }],
      totalLinhasLidas: 0,
    };
  }
}
