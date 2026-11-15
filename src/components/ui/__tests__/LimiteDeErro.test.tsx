import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LimiteDeErro } from '@/components/ui';

/**
 * Erro que escapa de uma tela não pode apagar a página. Sem este anteparo, qualquer exceção na
 * renderização desmonta a árvore e a pessoa fica olhando uma tela branca — e o caso mais provável
 * é o pedaço de uma tela que não terminou de baixar.
 */

const Explode = () => {
  throw new Error('Failed to fetch dynamically imported module');
};

describe('LimiteDeErro', () => {
  beforeEach(() => {
    // O React escreve o erro no console de propósito; aqui ele só poluiria a saída do teste
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve mostrar o conteúdo quando nada falha', () => {
    // Arrange / Act
    render(
      <LimiteDeErro>
        <p>Tela do Avaliador</p>
      </LimiteDeErro>,
    );

    // Assert
    expect(screen.getByText('Tela do Avaliador')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('deve explicar a falha em vez de deixar a tela branca', () => {
    // Arrange / Act
    render(
      <LimiteDeErro>
        <Explode />
      </LimiteDeErro>,
    );

    // Assert
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent(/não foi possível abrir esta tela/i);
    expect(alerta).toHaveTextContent(/queda de internet/i);
    expect(screen.getByRole('button', { name: /recarregar a página/i })).toBeInTheDocument();
  });

  it('deve recarregar a página quando a pessoa pede', async () => {
    // Arrange: recarregar de verdade não existe no jsdom, então a ação é injetada
    const aoRecarregar = vi.fn();
    render(
      <LimiteDeErro aoRecarregar={aoRecarregar}>
        <Explode />
      </LimiteDeErro>,
    );

    // Act
    await userEvent.click(screen.getByRole('button', { name: /recarregar a página/i }));

    // Assert
    expect(aoRecarregar).toHaveBeenCalledTimes(1);
  });

  it('deve registrar o erro no console, a única trilha que existe no navegador da pessoa', () => {
    // Arrange / Act
    render(
      <LimiteDeErro>
        <Explode />
      </LimiteDeErro>,
    );

    // Assert
    expect(console.error).toHaveBeenCalledWith(
      'Erro não tratado na interface:',
      expect.objectContaining({ message: 'Failed to fetch dynamically imported module' }),
      expect.anything(),
    );
  });

  it('deve aceitar texto próprio por contexto', () => {
    // Arrange / Act
    render(
      <LimiteDeErro titulo="O relatório não abriu" descricao="Tente de novo em instantes.">
        <Explode />
      </LimiteDeErro>,
    );

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('O relatório não abriu');
    expect(screen.getByRole('alert')).toHaveTextContent('Tente de novo em instantes.');
  });
});
