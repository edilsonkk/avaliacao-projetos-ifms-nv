import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Check } from 'lucide-react';
import { Botao } from '@/components/ui';

describe('Botao', () => {
  it('deve chamar a ação ao ser clicado', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoClicar = vi.fn();
    render(<Botao onClick={aoClicar}>Salvar nota</Botao>);

    // Act
    await user.click(screen.getByRole('button', { name: 'Salvar nota' }));

    // Assert
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it('deve anunciar o carregamento e não aceitar clique enquanto carrega', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoClicar = vi.fn();
    render(
      <Botao carregando onClick={aoClicar}>
        Salvar nota
      </Botao>,
    );
    const botao = screen.getByRole('button', { name: 'Salvar nota' });

    // Act
    await user.click(botao);

    // Assert
    expect(botao).toHaveAttribute('aria-busy', 'true');
    expect(botao).toBeDisabled();
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it('deve manter o ícone fora do nome acessível', () => {
    // Arrange / Act
    render(<Botao icone={<Check className="w-4 h-4" />}>Confirmar presença</Botao>);

    // Assert
    expect(screen.getByRole('button', { name: 'Confirmar presença' })).toBeInTheDocument();
  });

  it('deve usar o aria-label quando o botão é só ícone', () => {
    // Arrange / Act
    render(<Botao aria-label="Fechar" variante="fantasma" icone={<Check className="w-4 h-4" />} />);

    // Assert
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('não deve enviar o formulário sem pedir (type button por padrão)', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoEnviar = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={aoEnviar}>
        <Botao>Gerar código</Botao>
      </form>,
    );

    // Act
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));

    // Assert
    expect(aoEnviar).not.toHaveBeenCalled();
  });
});
