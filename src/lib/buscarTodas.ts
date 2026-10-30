/** O PostgREST devolve no máximo 1000 linhas por requisição (`max_rows`). */
export const TAMANHO_PAGINA = 1000;

interface ConsultaPaginavel<T> {
  range: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Busca todas as linhas de uma consulta, página por página.
 * `montarConsulta` deve devolver uma consulta nova a cada chamada, com ordenação estável (`.order`).
 */
export const buscarTodas = async <T>(montarConsulta: () => ConsultaPaginavel<T>): Promise<T[]> => {
  const todas: T[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await montarConsulta().range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    todas.push(...(data ?? []));
    if (!data || data.length < TAMANHO_PAGINA) return todas;
  }
};
