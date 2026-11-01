import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Botao, Modal } from '@/components/ui';

/** Página mínima com um gatilho, para conferir a devolução do foco. */
const PaginaComModal = () => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Botao onClick={() => setAberto(true)}>Abrir configurações</Botao>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Configurações do evento">
        <Botao data-foco-inicial>Salvar</Botao>
        <Botao variante="secundario">Descartar</Botao>
      </Modal>
    </>
  );
};

describe('Modal', () => {
  it('deve anunciar-se como diálogo com título ligado', () => {
    // Arrange / Act
    render(
      <Modal aberto aoFechar={vi.fn()} titulo="Confirmar conflito" descricao="Esta ação libera o projeto.">
        <p>Conteúdo</p>
      </Modal>,
    );

    // Assert
    const dialogo = screen.getByRole('dialog', { name: 'Confirmar conflito' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(dialogo).toHaveAccessibleDescription('Esta ação libera o projeto.');
  });

  it('deve dar o foco inicial ao elemento marcado e travar a rolagem do fundo', () => {
    // Arrange / Act
    render(
      <Modal aberto aoFechar={vi.fn()} titulo="Configurações">
        <Botao>Primeiro</Botao>
        <Botao data-foco-inicial>Segundo</Botao>
      </Modal>,
    );

    // Assert
    expect(screen.getByRole('button', { name: 'Segundo' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('deve fechar com Esc', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoFechar = vi.fn();
    render(
      <Modal aberto aoFechar={aoFechar} titulo="Configurações">
        <Botao>Salvar</Botao>
      </Modal>,
    );

    // Act
    await user.keyboard('{Escape}');

    // Assert
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('deve prender o foco: do último elemento, Tab volta ao primeiro', async () => {
    // Arrange
    const user = userEvent.setup();
    render(
      <Modal aberto aoFechar={vi.fn()} titulo="Configurações">
        <Botao data-foco-inicial>Primeiro</Botao>
        <Botao>Último</Botao>
      </Modal>,
    );
    const ultimo = screen.getByRole('button', { name: 'Último' });
    ultimo.focus();

    // Act
    await user.tab();

    // Assert
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus();
  });

  it('deve devolver o foco a quem abriu', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<PaginaComModal />);
    const gatilho = screen.getByRole('button', { name: 'Abrir configurações' });

    // Act
    await user.click(gatilho);
    await user.click(screen.getByRole('button', { name: 'Fechar' }));

    // Assert
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(gatilho).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('deve fechar ao clicar no fundo, mas não quando é alertdialog', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoFecharDialogo = vi.fn();
    const { unmount } = render(
      <Modal aberto aoFechar={aoFecharDialogo} titulo="Editar avaliador">
        <Botao>Salvar</Botao>
      </Modal>,
    );

    // Act
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);

    // Assert
    expect(aoFecharDialogo).toHaveBeenCalledTimes(1);

    // Arrange
    unmount();
    const aoFecharAlerta = vi.fn();
    render(
      <Modal aberto aoFechar={aoFecharAlerta} titulo="Excluir avaliação" papel="alertdialog">
        <Botao>Excluir</Botao>
      </Modal>,
    );

    // Act
    await user.click(screen.getByRole('alertdialog').parentElement as HTMLElement);

    // Assert
    expect(aoFecharAlerta).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  });
});
