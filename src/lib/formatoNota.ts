/**
 * Formato das notas na interface, num lugar só.
 *
 * Antes havia três padrões disputando a mesma informação: `toFixed(1)` no modal de exclusão,
 * `toFixed(2)` nos relatórios e no ranking, e `toLocaleString('pt-BR')` na quarentena — ou seja,
 * a mesma nota aparecia como 8.8, 8.75 e 8,75 em telas diferentes. Numa conferência de notas isso
 * é o bastante para alguém achar que a conta não fecha.
 *
 * Regra: **duas casas, vírgula decimal**, porque é o formato do país e o que o banco grava
 * (`numeric(5,2)`). Valor ausente é travessão, nunca `0` nem `N/I`.
 */

const ausente = '—';

const formatar = (valor: number, casasMin: number, casasMax: number): string =>
  valor.toLocaleString('pt-BR', { minimumFractionDigits: casasMin, maximumFractionDigits: casasMax });

const numero = (valor: unknown): number | null => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
};

/** Nota ou média como a pessoa lê: `8,75`. Sempre duas casas, para a coluna alinhar. */
export const formatarNota = (valor: unknown): string => {
  const n = numero(valor);
  return n === null ? ausente : formatar(n, 2, 2);
};

/** Média do projeto: mesmo formato da nota (é a mesma grandeza). */
export const formatarMedia = formatarNota;

/** Nota com a unidade, para onde o texto é lido solto: `8,75 pts`. */
export const formatarPontos = (valor: unknown): string => {
  const n = numero(valor);
  return n === null ? ausente : `${formatar(n, 2, 2)} pts`;
};

/**
 * Peso do critério: `2`, `1,5`. Sem casas desnecessárias, porque peso quase sempre é inteiro
 * e `2,00` polui a tabela do memorial.
 */
export const formatarPeso = (valor: unknown): string => {
  const n = numero(valor);
  return n === null ? ausente : formatar(n, 0, 2);
};

/**
 * Valor sem arredondar, para o memorial de cálculo: `3,3333`. Até quatro casas, sem zeros à
 * direita. É o que mostra por que a nota gravada é 3,33 e não 3,34.
 */
export const formatarNotaPrecisa = (valor: unknown): string => {
  const n = numero(valor);
  return n === null ? ausente : formatar(n, 0, 4);
};

/** `true` quando o valor bruto não é o mesmo depois de arredondar para duas casas. */
export const notaPerdeuPrecisao = (valor: unknown): boolean => {
  const n = numero(valor);
  if (n === null) return false;
  return Math.abs(n - Math.round(n * 100) / 100) > 1e-9;
};

/** Ajuste de média com o sinal à mostra: `+1,50`, `−0,50`, `0,00`. */
export const formatarAjuste = (valor: unknown): string => {
  const n = numero(valor);
  if (n === null) return ausente;
  if (n === 0) return formatar(0, 2, 2);
  // Menos tipográfico (U+2212): alinha com o dígito e não é confundido com hífen de separação
  return `${n > 0 ? '+' : '−'}${formatar(Math.abs(n), 2, 2)}`;
};
