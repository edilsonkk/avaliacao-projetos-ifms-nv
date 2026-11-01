import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Abas, PainelAba } from '@/components/ui';

const ABAS = [
  { id: 'expositores', rotulo: 'Credenciar Expositores' },
  { id: 'avaliadores', rotulo: 'Credenciar Avaliadores' },
];

const TelaComAbas = () => {
  const [ativa, setAtiva] = useState('expositores');
  return (
    <>
      <Abas abas={ABAS} ativa={ativa} aoTrocar={setAtiva} aria-label="Seções do credenciamento" />
      <PainelAba id="expositores" ativo={ativa === 'expositores'}>
        <p>Lista de expositores</p>
      </PainelAba>
      <PainelAba id="avaliadores" ativo={ativa === 'avaliadores'}>
        <p>Lista de avaliadores</p>
      </PainelAba>
    </>
  );
};

describe('Abas', () => {
  it('deve expor a lista de abas e qual está selecionada', () => {
    // Arrange / Act
    render(<TelaComAbas />);

    // Assert
    expect(screen.getByRole('tablist', { name: 'Seções do credenciamento' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Credenciar Expositores', selected: true })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Credenciar Avaliadores', selected: false })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'Credenciar Expositores' })).toHaveTextContent('Lista de expositores');
  });

  it('deve trocar de aba pelo clique', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<TelaComAbas />);

    // Act
    await user.click(screen.getByRole('tab', { name: 'Credenciar Avaliadores' }));

    // Assert
    expect(screen.getByRole('tabpanel', { name: 'Credenciar Avaliadores' })).toHaveTextContent('Lista de avaliadores');
  });

  it('deve andar entre as abas com as setas e levar o foco', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<TelaComAbas />);
    screen.getByRole('tab', { name: 'Credenciar Expositores' }).focus();

    // Act
    await user.keyboard('{ArrowRight}');

    // Assert
    const segunda = screen.getByRole('tab', { name: 'Credenciar Avaliadores' });
    expect(segunda).toHaveAttribute('aria-selected', 'true');
    expect(segunda).toHaveFocus();

    // Act
    await user.keyboard('{Home}');

    // Assert
    expect(screen.getByRole('tab', { name: 'Credenciar Expositores' })).toHaveFocus();
  });
});
