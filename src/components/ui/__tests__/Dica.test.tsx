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

  it('deve usar o rótulo informado no nome do botão', () => {
    // Arrange / Act
    render(<Dica rotulo="Referência de notas de 1. Problema e Público-Alvo">1: pouco · 5: muito</Dica>);

    // Assert
    expect(screen.getByRole('button', { name: 'Referência de notas de 1. Problema e Público-Alvo' }))
      .toHaveAccessibleDescription('1: pouco · 5: muito');
    expect(screen.queryByRole('button', { name: /mais informações/i })).not.toBeInTheDocument();
  });

  it('não deve virar bloco de contenção com largura="bloco", para o balão caber na tela estreita', () => {
    // Arrange / Act
    const { container } = render(<Dica largura="bloco">1: pouco · 5: muito</Dica>);

    // Assert — sem `relative`, o balão se posiciona pelo ancestral que o chamador marcou
    expect(container.firstElementChild).not.toHaveClass('relative');
    expect(screen.getByRole('tooltip')).toHaveClass('w-full');
  });

  it('deve manter o texto acessível quando o conteúdo é uma lista', async () => {
    // Arrange
    const user = userEvent.setup();
    render(
      <Dica largura="bloco" rotulo="Referência de notas">
        <ul>
          <li>1: Problema vago</li>
          <li>5: Problema relevante</li>
        </ul>
      </Dica>,
    );

    // Act
    await user.click(screen.getByRole('button', { name: 'Referência de notas' }));

    // Assert
    expect(screen.getByRole('tooltip')).toBeVisible();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['1: Problema vago', '5: Problema relevante']);
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
