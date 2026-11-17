import { describe, it, expect } from 'vitest';
import { cssImpressao } from '@/lib/cssImpressao';

/**
 * A Folha de Conferência saía em branco porque isolava a impressão com
 * `body > *:not(#raiz) { display: none }`. A raiz de impressão nunca é filha direta de
 * `body` — ela mora dentro de `#root`, a árvore do React —, então a regra escondia
 * justamente o ancestral do que se queria imprimir. Este utilitário existe para que
 * as duas telas que imprimem usem a mesma estratégia, que não depende de profundidade.
 */
describe('cssImpressao', () => {
  it('deve isolar por visibilidade, e não escondendo os filhos diretos de body', () => {
    // Arrange / Act
    const css = cssImpressao('minha-raiz');

    // Assert
    expect(css).toContain('body * {');
    expect(css).toContain('visibility: hidden');
    expect(css).toContain('#minha-raiz,');
    expect(css).toContain('#minha-raiz * {');
    expect(css).toContain('visibility: visible');
    // A regra que causava a página em branco não pode voltar
    expect(css).not.toContain('body > *');
  });

  it('deve tirar a raiz de dentro de ancestral posicionado ou com rolagem', () => {
    // Arrange / Act
    const css = cssImpressao('minha-raiz');

    // Assert: o modal que envolve a folha é `fixed` e tem altura travada com overflow
    expect(css).toContain('position: absolute !important');
    expect(css).toContain('overflow: visible !important');
    expect(css).toContain('height: auto !important');
    // A folha é `fixed inset-0`: right/bottom têm de soltar, senão a altura fica presa
    expect(css).toContain('right: auto !important');
    expect(css).toContain('bottom: auto !important');
    // Declaração do atalho de quatro lados, que depois de left/top os zeraria para auto
    expect(css).not.toMatch(/^\s*inset:/m);
  });

  it('deve usar retrato com margem de 10mm por padrão', () => {
    // Arrange / Act
    const css = cssImpressao('r');

    // Assert
    expect(css).toContain('size: A4 portrait');
    expect(css).toContain('margin: 10mm');
  });

  it('deve aceitar paisagem e margem própria', () => {
    // Arrange / Act
    const css = cssImpressao('r', { orientacao: 'paisagem', margem: '8mm' });

    // Assert
    expect(css).toContain('size: A4 landscape');
    expect(css).toContain('margin: 8mm');
  });

  it('deve manter oculto o que a tela marcou como print:hidden', () => {
    // Arrange / Act
    const css = cssImpressao('r');

    // Assert: com `visibility`, o elemento continuaria ocupando espaço sem o display:none
    expect(css).toContain('.print\\:hidden');
    expect(css).toContain('display: none !important');
  });

  it('deve acrescentar as regras próprias da tela dentro do @media print', () => {
    // Arrange
    const propria = '#r .folha-projeto { break-inside: avoid; }';

    // Act
    const css = cssImpressao('r', { extra: propria });

    // Assert
    expect(css).toContain(propria);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });
});
