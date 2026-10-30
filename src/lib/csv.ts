/** Campo de CSV entre aspas; texto começado por =, +, -, @ vira texto para o Excel não executá-lo como fórmula. */
export const campoCsv = (valor: unknown): string => {
  let texto = String(valor ?? '');
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
};

/** Monta o CSV (UTF-8 com BOM, para o Excel acertar os acentos) e dispara o download. */
export const baixarCsv = (nomeArquivo: string, linhas: unknown[][]): void => {
  const csv = '\uFEFF' + linhas.map((linha) => linha.map(campoCsv).join(',')).join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', nomeArquivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
