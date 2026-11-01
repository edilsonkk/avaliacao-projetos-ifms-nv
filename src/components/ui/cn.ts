/** Valores aceitos na junção de classes: strings e condições que viram `false`/`undefined`. */
export type ValorClasse = string | false | null | undefined;

/**
 * Junta classes condicionais numa string.
 * Substitui `clsx`/`tailwind-merge`, que o projeto não usa (ver AGENTS.md: sem dependência nova de UI).
 * Não resolve conflito entre utilidades: quem chama coloca a classe que deve vencer no fim.
 */
export const cn = (...valores: ValorClasse[]): string => valores.filter(Boolean).join(' ');
