import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Botao, Estado } from '@/components/ui';

describe('Estado', () => {
  it('deve anunciar o carregamento', () => {
    // Arrange / Act
    render(<Estado situacao="carregando" titulo="Carregando avaliadores..." />);

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('Carregando avaliadores...');
  });

  it('deve anunciar o erro e oferecer a saída', () => {
    // Arrange / Act
    render(
      <Estado
        situacao="erro"
        titulo="Não foi possível carregar"
        descricao="Verifique a conexão e tente de novo."
        acao={<Botao>Tentar de novo</Botao>}
      />,
    );

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('deve mostrar o estado vazio sem interromper o leitor de tela', () => {
    // Arrange / Act
    render(<Estado situacao="vazio" titulo="Nenhum projeto importado" />);

    // Assert
    expect(screen.getByText('Nenhum projeto importado')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
