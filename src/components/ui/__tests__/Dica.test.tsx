import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Dica } from '@/components/ui/Dica';

describe('Dica', () => {
  it('deve ligar o texto ao ícone para leitores de tela', () => {
    // Arrange / Act
    render(<Dica>Explica o campo.</Dica>);

    // Assert
    expect(screen.getByRole('button', { name: /mais informações/i })).toHaveAccessibleDescription('Explica o campo.');
  });

  it('deve abrir ao tocar e fechar com Esc', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<Dica>Explica o campo.</Dica>);
    const botao = screen.getByRole('button', { name: /mais informações/i });

    // Act
    await user.click(botao);

    // Assert
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toBeVisible();

    // Act
    await user.keyboard('{Escape}');

    // Assert
    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });

  it('não deve enviar formulário ao ser clicado', async () => {
    // Arrange
    const user = userEvent.setup();
    let enviado = false;
    render(
      <form onSubmit={(e) => { e.preventDefault(); enviado = true; }}>
        <Dica>Texto</Dica>
      </form>,
    );

    // Act
    await user.click(screen.getByRole('button', { name: /mais informações/i }));

    // Assert
    expect(enviado).toBe(false);
  });
});
