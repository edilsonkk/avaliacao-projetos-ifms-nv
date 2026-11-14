/**
 * Apoio para mocks de `supabase.rpc` lidas de forma paginada.
 *
 * `fn_projetos_situacao` devolve uma linha por projeto do evento, então o Mapa de
 * Estandes e a Atribuição Forçada a leem com `buscarTodas`, que monta
 * `.order(...).range(inicio, fim)`. Um mock que devolve só uma Promise quebra nesse
 * `.order`. Este apoio devolve um objeto que é, ao mesmo tempo:
 *  - aguardável (`await supabase.rpc(...)`), para as RPCs lidas direto; e
 *  - encadeável (`.order(...).range(...)`), para as lidas por `buscarTodas`.
 *
 * O `range` entrega todas as linhas de uma vez: abaixo de 1000 linhas, `buscarTodas`
 * para na primeira página, que é o caso de todos os testes.
 */
export interface ResultadoRpc<T = unknown> {
  data: T[] | T | null;
  error: unknown;
}

export interface RpcPaginavel<T = unknown> extends PromiseLike<ResultadoRpc<T>> {
  order: (coluna?: string, opcoes?: unknown) => { range: (inicio: number, fim: number) => Promise<ResultadoRpc<T>> };
  range: (inicio: number, fim: number) => Promise<ResultadoRpc<T>>;
}

/** Envelopa o resultado de uma RPC para aceitar `await` e `.order(...).range(...)`. */
export const rpcPaginavel = <T = unknown>(resultado: ResultadoRpc<T>): RpcPaginavel<T> => {
  const entregar = () => Promise.resolve(resultado);
  const encadeavel = {
    then: <R1, R2>(ok?: ((v: ResultadoRpc<T>) => R1 | PromiseLike<R1>) | null, erro?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null) =>
      entregar().then(ok, erro),
    order: () => ({ range: entregar }),
    range: entregar,
  };
  return encadeavel as unknown as RpcPaginavel<T>;
};
