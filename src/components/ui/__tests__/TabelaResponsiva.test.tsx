import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { TabelaResponsiva, Botao, type ColunaTabela } from '@/components/ui';
import { esperarSemViolacoesDeAcessibilidade } from '@/test/axe';

interface Avaliador {
  id: string;
  nome: string;
  email: string;
}

const LINHAS: Avaliador[] = [
  { id: 'a-1', nome: 'Ana Souza', email: 'ana@exemplo.br' },
  { id: 'a-2', nome: 'Bruno Lima', email: 'bruno@exemplo.br' },
];

const colunas = (aoCredenciar = vi.fn()): ColunaTabela<Avaliador>[] => [
  { chave: 'nome', rotulo: 'Nome', renderizar: (l) => l.nome, ordenavel: true },
  { chave: 'email', rotulo: 'E-mail', renderizar: (l) => l.email },
  {
    chave: 'acoes',
    rotulo: 'Ações',
    acoes: true,
    renderizar: (l) => (
      <Botao onClick={() => aoCredenciar(l.id)}>Credenciar</Botao>
    ),
  },
];

const renderizar = (extra: Partial<Parameters<typeof TabelaResponsiva<Avaliador>>[0]> = {}) =>
  render(
    <TabelaResponsiva<Avaliador>
      legenda="Avaliadores do evento"
      colunas={colunas()}
      linhas={LINHAS}
      chaveLinha={(l) => l.id}
      {...extra}
    />,
  );

describe('TabelaResponsiva', () => {
  it('deve manter a semântica de tabela, com cabeçalho e células', () => {
    // Arrange / Act
    renderizar();

    // Assert
    expect(screen.getByRole('table', { name: 'Avaliadores do evento' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'E-mail' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // cabeçalho + 2 avaliadores
  });

  /**
   * A reflow para cartões não pode duplicar o DOM: dois botões "Credenciar" por linha
   * confundiriam o leitor de tela e tornariam ambíguo qualquer `getByRole` nos testes
   * das telas que usam este componente.
   */
  it('deve renderizar cada ação uma única vez', () => {
    // Arrange / Act
    renderizar();

    // Assert
    expect(screen.getAllByRole('button', { name: 'Credenciar' })).toHaveLength(LINHAS.length);
  });

  it('deve manter a coluna de ações alcançável e acionável', async () => {
    // Arrange
    const aoCredenciar = vi.fn();
    const user = userEvent.setup();
    render(
      <TabelaResponsiva<Avaliador>
        legenda="Avaliadores do evento"
        colunas={colunas(aoCredenciar)}
        linhas={LINHAS}
        chaveLinha={(l) => l.id}
      />,
    );

    // Act
    await user.click(screen.getAllByRole('button', { name: 'Credenciar' })[0]);

    // Assert
    expect(aoCredenciar).toHaveBeenCalledWith('a-1');
  });

  /**
   * O rótulo do cartão sai por pseudo-elemento (`data-rotulo` + `content: attr()`), não por
   * um nó no DOM: ele não entra no `textContent` da célula — o que contaminava asserções de
   * teste e a cópia de texto — e o leitor de tela não o lê duas vezes, porque já conhece a
   * coluna pela semântica da tabela.
   */
  it('deve marcar o rótulo do cartão sem colocá-lo no conteúdo da célula', () => {
    // Arrange / Act
    renderizar();

    // Assert
    const celulas = screen.getAllByRole('cell');
    const email = celulas.find((c) => c.textContent === 'ana@exemplo.br');
    expect(email).toHaveAttribute('data-rotulo', 'E-mail');
    expect(screen.queryByText('E-mail:')).not.toBeInTheDocument();

    // A coluna de ações não ganha rótulo: "Ações: [Credenciar]" não ajuda ninguém
    const acoes = celulas.find((c) => c.textContent === 'Credenciar');
    expect(acoes).not.toHaveAttribute('data-rotulo');
  });

  it('deve ordenar pela coluna pedida, anunciando o estado', async () => {
    // Arrange
    const aoOrdenar = vi.fn();
    const user = userEvent.setup();
    renderizar({ colunaOrdenacao: 'nome', direcao: 'desc', aoOrdenar });

    // Act
    await user.click(screen.getByRole('button', { name: /nome/i }));

    // Assert
    expect(aoOrdenar).toHaveBeenCalledWith('nome');
    expect(screen.getByRole('columnheader', { name: /nome/i })).toHaveAttribute('aria-sort', 'descending');
  });

  it('deve permitir rolar a tabela pelo teclado', () => {
    // Arrange / Act
    renderizar();

    // Assert: sem isto, quem usa só o teclado não alcança o que ficou à direita (WCAG 2.1.1)
    expect(screen.getByRole('region', { name: 'Avaliadores do evento' })).toHaveAttribute('tabindex', '0');
  });

  /**
   * Listas como a Quarentena abrem as notas por projeto numa linha extra. Em tabela isso é
   * um `<tr>` com `colSpan`; no cartão do celular é só mais um bloco dentro do mesmo cartão.
   */
  it('deve renderizar a linha de detalhe quando a tela pede', () => {
    // Arrange / Act
    renderizar({
      detalhe: (l) => (l.id === 'a-1' ? <p>Notas de {l.nome}</p> : null),
    });

    // Assert
    expect(screen.getByText('Notas de Ana Souza')).toBeInTheDocument();
    expect(screen.queryByText('Notas de Bruno Lima')).not.toBeInTheDocument();
  });

  it('deve manter a contagem de linhas honesta com detalhe aberto', () => {
    // Arrange / Act
    renderizar({ detalhe: (l) => (l.id === 'a-1' ? <p>Notas</p> : null) });

    // Assert: cabeçalho + 2 avaliadores + 1 detalhe
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('não deve ter violação de acessibilidade', async () => {
    // Arrange / Act
    const { container } = renderizar();

    // Assert
    await esperarSemViolacoesDeAcessibilidade(container);
  });
});
