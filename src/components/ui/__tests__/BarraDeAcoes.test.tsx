import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BarraDeAcoes, Botao } from '@/components/ui';
import { esperarSemViolacoesDeAcessibilidade } from '@/test/axe';

describe('BarraDeAcoes', () => {
  it('deve manter todos os botões alcançáveis', () => {
    // Arrange / Act
    render(
      <BarraDeAcoes>
        <Botao>Salvar</Botao>
        <Botao variante="secundario">Cancelar</Botao>
      </BarraDeAcoes>,
    );

    // Assert
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('deve virar agrupamento nomeado quando recebe rótulo', () => {
    // Arrange / Act
    render(
      <BarraDeAcoes rotulo="Ações do avaliador">
        <Botao>Credenciar</Botao>
      </BarraDeAcoes>,
    );

    // Assert
    expect(screen.getByRole('group', { name: 'Ações do avaliador' })).toBeInTheDocument();
  });

  it('não deve virar agrupamento sem rótulo, para não poluir o leitor de tela', () => {
    // Arrange / Act
    render(
      <BarraDeAcoes>
        <Botao>Salvar</Botao>
      </BarraDeAcoes>,
    );

    // Assert
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('não deve ter violação de acessibilidade', async () => {
    // Arrange / Act
    const { container } = render(
      <BarraDeAcoes rotulo="Ações" empilhar>
        <Botao>Salvar</Botao>
        <Botao variante="secundario">Cancelar</Botao>
      </BarraDeAcoes>,
    );

    // Assert
    await esperarSemViolacoesDeAcessibilidade(container);
  });
});
