import axe, { type AxeResults, type Result } from 'axe-core';

/**
 * Auditoria de acessibilidade do que está renderizado, com as regras da WCAG 2.2 AA.
 *
 * Complementa (não substitui) os seletores acessíveis dos testes: o axe pega o que a
 * asserção manual não vê — rótulo faltando, papel errado, atributo ARIA inválido,
 * ordem de títulos, contraste no DOM.
 *
 * Uso:
 *   it('não deve ter violação de acessibilidade', async () => {
 *     const { container } = render(<Tela />);
 *     await esperarSemViolacoesDeAcessibilidade(container);
 *   });
 */

/** Regras que o jsdom não consegue avaliar (precisam de layout e de cor pintada). */
const REGRAS_DESLIGADAS = ['color-contrast'];

const formatar = (violacoes: Result[]): string =>
  violacoes
    .map((v) => {
      const alvos = v.nodes.map((n) => `      - ${n.target.join(' ')}`).join('\n');
      return `  [${v.impact ?? 'sem impacto'}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${alvos}`;
    })
    .join('\n\n');

export const auditarAcessibilidade = async (elemento: Element): Promise<AxeResults> =>
  axe.run(elemento, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: Object.fromEntries(REGRAS_DESLIGADAS.map((id) => [id, { enabled: false }])),
  });

/** Falha o teste listando cada violação, com a regra, o elemento e o link da explicação. */
export const esperarSemViolacoesDeAcessibilidade = async (elemento: Element): Promise<void> => {
  const resultado = await auditarAcessibilidade(elemento);
  if (resultado.violations.length > 0) {
    throw new Error(
      `axe encontrou ${resultado.violations.length} violação(ões) de acessibilidade:\n\n${formatar(resultado.violations)}`,
    );
  }
};
