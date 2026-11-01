import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Botao, ProvedorAvisos, useAvisos } from '@/components/ui';

/** Tela de teste que usa a API de avisos como uma feature usaria. */
const TelaDeTeste = ({ aoResultado }: { aoResultado?: (valor: unknown) => void }) => {
  const { avisar, confirmar, notificar } = useAvisos();
  return (
    <>
      <Botao onClick={() => avisar({ tipo: 'sucesso', titulo: 'Avaliação enviada', mensagem: 'A nota foi gravada.' }).then(() => aoResultado?.('fechado'))}>
        Enviar nota
      </Botao>
      <Botao onClick={() => confirmar({ titulo: 'Sair e desvincular?', mensagem: 'Será preciso um novo código.', rotuloConfirmar: 'Sair e desvincular', rotuloCancelar: 'Continuar avaliando' }).then((v) => aoResultado?.(v))}>
        Sair
      </Botao>
      <Botao onClick={() => notificar('Novo projeto sorteado', 'sucesso')}>Sortear</Botao>
    </>
  );
};

describe('ProvedorAvisos', () => {
  it('deve mostrar o aviso em diálogo, com o foco no botão, e resolver ao fechar', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoResultado = vi.fn();
    render(
      <ProvedorAvisos>
        <TelaDeTeste aoResultado={aoResultado} />
      </ProvedorAvisos>,
    );

    // Act
    await user.click(screen.getByRole('button', { name: 'Enviar nota' }));

    // Assert
    expect(screen.getByRole('dialog', { name: 'Avaliação enviada' })).toBeInTheDocument();
    expect(screen.getByText('A nota foi gravada.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Entendi' })).toHaveFocus();

    // Act
    await user.click(screen.getByRole('button', { name: 'Entendi' }));

    // Assert
    await waitFor(() => expect(aoResultado).toHaveBeenCalledWith('fechado'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deve confirmar a ação destrutiva com o caminho seguro em primeiro lugar', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoResultado = vi.fn();
    render(
      <ProvedorAvisos>
        <TelaDeTeste aoResultado={aoResultado} />
      </ProvedorAvisos>,
    );

    // Act
    await user.click(screen.getByRole('button', { name: 'Sair' }));

    // Assert
    expect(screen.getByRole('alertdialog', { name: 'Sair e desvincular?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar avaliando' })).toHaveFocus();

    // Act
    await user.keyboard('{Escape}');

    // Assert
    await waitFor(() => expect(aoResultado).toHaveBeenCalledWith(false));

    // Act
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    await user.click(screen.getByRole('button', { name: 'Sair e desvincular' }));

    // Assert
    await waitFor(() => expect(aoResultado).toHaveBeenLastCalledWith(true));
  });

  it('deve anunciar a mensagem passageira na região viva, sem roubar o foco', async () => {
    // Arrange
    const user = userEvent.setup();
    render(
      <ProvedorAvisos>
        <TelaDeTeste />
      </ProvedorAvisos>,
    );
    const botao = screen.getByRole('button', { name: 'Sortear' });

    // Act
    await user.click(botao);

    // Assert
    const regiao = screen.getByRole('status');
    expect(regiao).toHaveAttribute('aria-live', 'polite');
    expect(regiao).toHaveTextContent('Novo projeto sorteado');
    expect(botao).toHaveFocus();
  });

  it('deve avisar quem usar a API sem o provedor', () => {
    // Arrange
    const erroDoConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act / Assert
    expect(() => render(<TelaDeTeste />)).toThrow(/ProvedorAvisos/);
    erroDoConsole.mockRestore();
  });
});
