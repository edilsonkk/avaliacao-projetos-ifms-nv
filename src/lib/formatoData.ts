/**
 * Data e hora na interface, no formato do país.
 *
 * Vive em `src/lib/` porque mais de uma tela de relatório precisa da mesma formatação: deixá-la
 * dentro de `RelatoriosAdmin` obrigava os subcomponentes a importar do componente pai (import
 * circular) ou a repetir a função.
 */

/** `10/11, 09:00` — dia, mês e hora, para colunas de registro. Valor ausente é `--`. */
export const formatarDataHora = (isoStr?: string | null): string => {
  if (!isoStr) return '--';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
};
