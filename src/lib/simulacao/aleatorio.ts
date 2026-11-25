/**
 * Sorteio determinístico da simulação de evento.
 *
 * Determinístico de propósito: a mesma semente reproduz a mesma feira fictícia, então um
 * problema visto numa rodada pode ser reproduzido exatamente. É o mesmo gerador usado por
 * `scripts/semear-simulacao.mjs`, que importa este arquivo.
 *
 * Sem React, sem Supabase: este módulo é puro (docs/arquitetura/frontend.md, regra 3).
 */

/** Função de sorteio: devolve um número em [0, 1), como `Math.random`. */
export type Sorteio = () => number;

/**
 * PRNG com semente (mulberry32). `Math.random` não aceita semente, e sem semente a
 * rodada não é reproduzível.
 */
export const criarSorteio = (semente: number): Sorteio => {
  let estado = semente >>> 0;
  return () => {
    estado |= 0;
    estado = (estado + 0x6d2b79f5) | 0;
    let valor = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    valor = (valor + Math.imul(valor ^ (valor >>> 7), 61 | valor)) ^ valor;
    return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296;
  };
};

/** Um item qualquer da lista. Lista vazia é erro de programação, não de dado. */
export const umDe = <T>(sorteio: Sorteio, lista: readonly T[]): T => {
  if (lista.length === 0) throw new Error('umDe: lista vazia.');
  return lista[Math.floor(sorteio() * lista.length)] as T;
};

/** Inteiro entre `minimo` e `maximo`, ambos incluídos. */
export const inteiroEntre = (sorteio: Sorteio, minimo: number, maximo: number): number =>
  minimo + Math.floor(sorteio() * (maximo - minimo + 1));

/**
 * Espalha um tempo de espera entre 0,5x e 1,5x do valor base.
 *
 * Sem isso os atores da simulação entram em lockstep e a carga vira rajada sincronizada,
 * que não se parece com uma feira (ver docs/operacao/ambiente-local-do-zero.md).
 */
export const comJitter = (sorteio: Sorteio, baseMs: number): number =>
  Math.round(baseMs * (0.5 + sorteio()));

/** Para onde a nota é puxada quando o projeto foi escolhido para divergir. */
export type TendenciaNota = 'alta' | 'baixa' | 'centro';

/**
 * Largura da faixa de uma tendência, como fração da escala.
 *
 * As tendências ficam nos extremos e NÃO se alargam com a dispersão: o objetivo delas é
 * garantir divergência entre as notas do mesmo projeto. Se a faixa crescesse com a
 * dispersão, "alta" e "baixa" se encontrariam no centro e a divergência desapareceria
 * justamente na configuração que a pedia.
 */
const FAIXA_DA_TENDENCIA = 0.15;

/**
 * Nota dentro da escala REAL do questionário, nunca de constante.
 *
 * `dispersao` vai de 0 (todas as notas no centro) a 1 (usa a escala inteira) e vale para a
 * tendência `centro`, que é o caso comum. As tendências `alta` e `baixa` servem à fatia de
 * projetos que a simulação escolhe para divergir: ficam nos extremos da escala, distantes o
 * bastante para a regra de quarentena do banco (diferença maior que 2,5) reagir.
 */
export const notaSorteada = (
  sorteio: Sorteio,
  escalaMinima: number,
  escalaMaxima: number,
  dispersao: number,
  tendencia: TendenciaNota = 'centro',
): number => {
  const amplitude = escalaMaxima - escalaMinima;
  if (amplitude <= 0) return escalaMinima;

  const faixa = amplitude * FAIXA_DA_TENDENCIA;
  let base: number;

  if (tendencia === 'alta') {
    base = escalaMaxima - faixa * sorteio();
  } else if (tendencia === 'baixa') {
    base = escalaMinima + faixa * sorteio();
  } else {
    const forca = Math.min(Math.max(dispersao, 0), 1);
    const centro = escalaMinima + amplitude / 2;
    base = centro + (sorteio() * 2 - 1) * (amplitude / 2) * forca;
  }

  const inteira = Math.round(base);
  return Math.min(Math.max(inteira, escalaMinima), escalaMaxima);
};
