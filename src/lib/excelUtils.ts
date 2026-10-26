import ExcelJS from 'exceljs';

/**
 * Utilitário centralizado para leitura, parsing e exportação de planilhas (.xlsx e .csv)
 * utilizando a biblioteca ExcelJS.
 */

const OLE2_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Verifica se um buffer binário corresponde ao formato legatário .xls (BIFF8 / OLE2)
 */
export function isLegacyXls(buffer: Uint8Array): boolean {
  if (buffer.length < 8) return false;
  return OLE2_HEADER.every((byte, idx) => buffer[idx] === byte);
}

/**
 * Validador para arquivos selecionados via input de upload no navegador.
 */
export function validarArquivoPlanilha(arquivo: File): {
  valido: boolean;
  erro?: string;
  isCSV: boolean;
} {
  const nome = arquivo.name.toLowerCase();

  if (nome.endsWith('.xls') && !nome.endsWith('.xlsx')) {
    return {
      valido: false,
      erro: 'O formato legado .xls (Excel 97-2003) não é suportado. Por favor, salve a planilha como .xlsx ou .csv antes de importar.',
      isCSV: false,
    };
  }

  const isCSV = nome.endsWith('.csv');
  const isXLSX = nome.endsWith('.xlsx');

  if (!isCSV && !isXLSX) {
    return {
      valido: false,
      erro: 'Formato de arquivo não suportado. Por favor, selecione um arquivo .xlsx ou .csv.',
      isCSV: false,
    };
  }

  return { valido: true, isCSV };
}

/**
 * Realiza o parsing de texto CSV respeitando delimitadores (; ou ,) e campos entre aspas.
 */
export function parseCSVText(csvText: string): Record<string, unknown>[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const countSemicolon = (firstLine.match(/;/g) || []).length;
  const countComma = (firstLine.match(/,/g) || []).length;
  const delimiter = countSemicolon >= countComma ? ';' : ',';

  const splitRow = (rowStr: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < rowStr.length; i++) {
      const char = rowStr[i];
      if (char === '"') {
        if (inQuotes && rowStr[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = splitRow(lines[0]);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rowValues = splitRow(lines[i]);
    const obj: Record<string, unknown> = {};
    let hasContent = false;

    headers.forEach((header, idx) => {
      if (!header) return;
      const val = rowValues[idx] !== undefined ? rowValues[idx] : '';
      if (val !== '') hasContent = true;
      obj[header] = val;
    });

    if (hasContent) {
      rows.push(obj);
    }
  }

  return rows;
}

/**
 * Converte qualquer valor bruto de célula do ExcelJS em string/primitivo utilizável.
 */
function extrairValorCelula(val: unknown): unknown {
  if (val === null || val === undefined) return '';

  if (typeof val === 'object') {
    // RichText: { richText: [{ text: '...' }] }
    if ('richText' in (val as Record<string, unknown>) && Array.isArray((val as { richText: Array<{ text: string }> }).richText)) {
      return (val as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('');
    }
    // Fórmula: { formula: '...', result: 123 }
    if ('result' in (val as Record<string, unknown>)) {
      return extrairValorCelula((val as { result: unknown }).result);
    }
    // Hiperlink: { text: '...', hyperlink: '...' }
    if ('text' in (val as Record<string, unknown>)) {
      return (val as { text: unknown }).text;
    }
    // Objeto Date
    if (val instanceof Date) {
      return val;
    }
  }

  return val;
}

/**
 * Lê o conteúdo de um arquivo (.xlsx ou .csv) e o converte para uma lista de registros chave-valor.
 */
export async function lerPlanilhaParaJson(
  conteudoArquivo: ArrayBuffer | Uint8Array | string,
  isCSV: boolean = false
): Promise<Record<string, unknown>[]> {
  if (!conteudoArquivo) {
    throw new Error('Conteúdo do arquivo ausente ou inválido.');
  }

  // 1. Caso seja CSV ou string
  if (isCSV || typeof conteudoArquivo === 'string') {
    let texto: string;
    if (typeof conteudoArquivo === 'string') {
      texto = conteudoArquivo;
    } else {
      const bytes = conteudoArquivo instanceof Uint8Array ? conteudoArquivo : new Uint8Array(conteudoArquivo);
      if (isLegacyXls(bytes)) {
        throw new Error(
          'O formato legado .xls (Excel 97-2003) não é suportado. Por favor, salve a planilha como .xlsx ou .csv antes de importar.'
        );
      }
      texto = new TextDecoder('utf-8').decode(bytes);
    }
    return parseCSVText(texto);
  }

  // 2. Converte para Uint8Array para análise
  const bytes = conteudoArquivo instanceof Uint8Array ? conteudoArquivo : new Uint8Array(conteudoArquivo);

  // 3. Validação imediata de cabeçalho .xls legado (BIFF)
  if (isLegacyXls(bytes)) {
    throw new Error(
      'O formato legado .xls (Excel 97-2003) não é suportado. Por favor, salve a planilha como .xlsx ou .csv antes de importar.'
    );
  }

  // 4. Carrega via ExcelJS
  const workbook = new ExcelJS.Workbook();
  try {
    // Passa ArrayBuffer para o loader
    const bufferParaLoad = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(bufferParaLoad as ArrayBuffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha ao ler o formato da planilha: ${msg}`);
  }

  if (!workbook.worksheets || workbook.worksheets.length === 0) {
    throw new Error('A planilha selecionada não contém abas válidas.');
  }

  const primeiraAba = workbook.worksheets[0];
  if (!primeiraAba || primeiraAba.rowCount === 0) {
    return [];
  }

  // Extrai cabeçalhos da primeira linha
  const headers: string[] = [];
  primeiraAba.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(extrairValorCelula(cell.value) || '').trim();
  });

  if (headers.filter(Boolean).length === 0) {
    return [];
  }

  const registros: Record<string, unknown>[] = [];

  for (let r = 2; r <= primeiraAba.rowCount; r++) {
    const row = primeiraAba.getRow(r);
    const obj: Record<string, unknown> = {};
    let linhaPossuiConteudo = false;

    for (let c = 1; c < headers.length; c++) {
      const header = headers[c];
      if (!header) continue;

      const cell = row.getCell(c);
      const valor = extrairValorCelula(cell.value);

      if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
        linhaPossuiConteudo = true;
      }
      obj[header] = valor !== undefined && valor !== null ? valor : '';
    }

    if (linhaPossuiConteudo) {
      registros.push(obj);
    }
  }

  return registros;
}

/**
 * Gera um buffer binário XLSX formatado a partir de colunas e linhas.
 */
export async function gerarBufferPlanilha(
  nomeAba: string,
  colunas: string[],
  linhas: Record<string, unknown>[]
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sistema de Avaliação IFMS';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(nomeAba);

  // Configura colunas com largura calculada
  worksheet.columns = colunas.map((coluna) => {
    const maxValLen = linhas.reduce((max, linha) => {
      const valStr = String(linha[coluna] ?? '');
      return Math.max(max, valStr.length);
    }, 0);

    return {
      header: coluna,
      key: coluna,
      width: Math.max(coluna.length + 4, maxValLen + 2, 16),
    };
  });

  // Estilização profissional do cabeçalho
  const headerRow = worksheet.getRow(1);
  headerRow.height = 26;
  headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Slate-800 elegante
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Adiciona as linhas de dados
  linhas.forEach((linha) => {
    const row = worksheet.addRow(linha);
    row.alignment = { vertical: 'middle' };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/**
 * Cria e dispara o download automático de uma planilha modelo (.xlsx) estilizada no navegador.
 */
export async function baixarPlanilhaModelo(
  nomeArquivo: string,
  nomeAba: string,
  colunas: string[],
  linhasExemplo: Record<string, unknown>[]
): Promise<void> {
  const buffer = await gerarBufferPlanilha(nomeAba, colunas, linhasExemplo);

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([buffer as Uint8Array<ArrayBuffer>], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo.toLowerCase().endsWith('.xlsx') ? nomeArquivo : `${nomeArquivo}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
}
