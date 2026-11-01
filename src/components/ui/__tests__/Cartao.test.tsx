import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Cartao } from '@/components/ui';

describe('Cartao', () => {
  it('deve transformar o título em cabeçalho no nível pedido', () => {
    // Arrange / Act
    render(
      <Cartao titulo="Credenciamento" nivelTitulo={2}>
        <p>Conteúdo</p>
      </Cartao>,
    );

    // Assert
    expect(screen.getByRole('heading', { level: 2, name: 'Credenciamento' })).toBeInTheDocument();
  });

  it('deve nomear a região quando usado como section', () => {
    // Arrange / Act
    render(
      <Cartao titulo="Avaliações" como="section">
        <p>Conteúdo</p>
      </Cartao>,
    );

    // Assert
    expect(screen.getByRole('region', { name: 'Avaliações' })).toBeInTheDocument();
  });

  it('não deve criar cabeçalho quando não há título', () => {
    // Arrange / Act
    render(
      <Cartao>
        <p>Só conteúdo</p>
      </Cartao>,
    );

    // Assert
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('Só conteúdo')).toBeInTheDocument();
  });
});
