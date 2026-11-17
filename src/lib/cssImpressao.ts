/**
 * CSS de impressão compartilhado pelas telas que geram PDF pelo `window.print()`.
 *
 * Por que existe: a Folha de Conferência isolava a impressão com
 * `body > *:not(#raiz) { display: none !important }`. A raiz de impressão **nunca** é filha
 * direta de `body` — ela mora dentro de `#root`, a árvore do React —, então a regra casava com
 * `#root`, que é ancestral da folha, e escondia o próprio documento: o PDF saía em branco.
 *
 * A estratégia correta, que os Relatórios já usavam, é isolar por `visibility`: esconde tudo,
 * revela a raiz e seus descendentes. Funciona em qualquer profundidade da árvore. Além disso a
 * raiz é tirada do fluxo (`position: absolute`), porque os modais que a envolvem são `fixed` e
 * têm altura travada com rolagem — sem isso o conteúdo sai cortado em uma página só.
 */

export type OrientacaoImpressao = 'retrato' | 'paisagem';

export interface OpcoesImpressao {
  /** Orientação da folha. Padrão: retrato. */
  orientacao?: OrientacaoImpressao;
  /** Margem da página, com unidade (ex.: `8mm`). Padrão: `10mm`. */
  margem?: string;
  /** Regras próprias da tela, inseridas dentro do mesmo `@media print`. */
  extra?: string;
}

/**
 * Monta o bloco `@media print` que isola `#idRaiz` para impressão.
 *
 * @param idRaiz `id` do elemento que contém o documento a imprimir, sem `#`.
 */
export const cssImpressao = (idRaiz: string, opcoes: OpcoesImpressao = {}): string => {
  const { orientacao = 'retrato', margem = '10mm', extra = '' } = opcoes;
  const tamanho = orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait';

  return `
@media print {
  @page {
    size: ${tamanho};
    margin: ${margem};
  }

  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    overflow: visible !important;
    height: auto !important;
    min-height: 100% !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Isolamento por visibilidade: não depende de a raiz ser filha de body */
  body * {
    visibility: hidden;
  }

  #${idRaiz},
  #${idRaiz} * {
    visibility: visible;
  }

  /* Fora do fluxo: os modais que envolvem a raiz são fixed e travam altura/rolagem */
  #${idRaiz} {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    /* Explícito, e nunca pelo atalho de quatro lados — vindo depois de left/top, ele os
       zeraria de volta para auto. A folha é fixed inset-0, e right/bottom têm de soltar
       a altura, senão o documento sai cortado em uma página. */
    right: auto !important;
    bottom: auto !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: transparent !important;
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
  }

  /* Com visibility, o elemento oculto continuaria ocupando espaço: tira do fluxo */
  .print\\:hidden {
    display: none !important;
  }
${extra ? `\n${extra}\n` : ''}}
`;
};
