/**
 * Carregamento de tela sob demanda em rede instável.
 *
 * Com as telas divididas em pedaços (`lazy()` no `App.tsx`), o navegador busca o pedaço no momento
 * em que a pessoa troca de tela — e na rede do ginásio essa busca falha. O `React.lazy` guarda o
 * resultado da primeira tentativa, inclusive a falha: depois de rejeitar uma vez, ele rejeita
 * sempre, e nenhum "tentar de novo" na interface reexecuta o `import()`.
 *
 * Por isso a retentativa é aqui, antes de o `lazy()` ver o resultado: a queda de um segundo não
 * chega a virar erro. O que não voltar depois das tentativas é falha de verdade, e aí o
 * `LimiteDeErro` oferece recarregar a página.
 */

/** Espera entre tentativas, dobrando a cada falha. */
const ESPERA_INICIAL_MS = 400;
const TENTATIVAS = 3;

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export interface OpcoesCarregamento {
  tentativas?: number;
  esperaInicialMs?: number;
  /** Injetável para o teste não depender de timer real. */
  aguardar?: (ms: number) => Promise<void>;
}

/**
 * Executa `carregar` e, se ele falhar, tenta de novo com espera crescente.
 * Rejeita com o erro da última tentativa.
 */
export const carregarComRetentativa = async <T>(
  carregar: () => Promise<T>,
  { tentativas = TENTATIVAS, esperaInicialMs = ESPERA_INICIAL_MS, aguardar = esperar }: OpcoesCarregamento = {},
): Promise<T> => {
  let espera = esperaInicialMs;
  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= Math.max(1, tentativas); tentativa += 1) {
    try {
      return await carregar();
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa === Math.max(1, tentativas)) break;
      await aguardar(espera);
      espera *= 2;
    }
  }

  throw ultimoErro;
};

/**
 * Açúcar para o `lazy()`: pega o módulo da tela e devolve no formato que o `React.lazy` espera,
 * com retentativa. `nome` é a exportação da tela dentro do módulo.
 */
export const carregarTela = <M extends Record<string, unknown>, N extends keyof M>(
  importar: () => Promise<M>,
  nome: N,
) => carregarComRetentativa(importar).then((modulo) => ({ default: modulo[nome] }));
