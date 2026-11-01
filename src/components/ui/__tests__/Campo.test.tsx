import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Campo, CampoArea, CampoSelecao } from '@/components/ui';

describe('Campo', () => {
  it('deve ligar o rótulo ao campo e aceitar digitação', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<Campo rotulo="Nome completo" />);

    // Act
    await user.type(screen.getByLabelText('Nome completo'), 'Maria Souza');

    // Assert
    expect(screen.getByLabelText('Nome completo')).toHaveValue('Maria Souza');
  });

  it('deve marcar o erro no próprio campo e anunciá-lo', () => {
    // Arrange / Act
    render(<Campo rotulo="E-mail" erro="Informe um e-mail válido." />);
    const campo = screen.getByLabelText('E-mail');

    // Assert
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription('Informe um e-mail válido.');
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um e-mail válido.');
  });

  it('deve ligar o texto de apoio ao campo', () => {
    // Arrange / Act
    render(<Campo rotulo="Código de acesso" descricao="Seis caracteres, fornecidos pelo Staff." />);

    // Assert
    expect(screen.getByLabelText('Código de acesso')).toHaveAccessibleDescription('Seis caracteres, fornecidos pelo Staff.');
  });

  it('não deve marcar aria-invalid quando não há erro', () => {
    // Arrange / Act
    render(<Campo rotulo="Instituição" />);

    // Assert
    expect(screen.getByLabelText('Instituição')).not.toHaveAttribute('aria-invalid');
  });
});

describe('CampoArea', () => {
  it('deve ligar o rótulo à área de texto', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<CampoArea rotulo="Parecer final" />);

    // Act
    await user.type(screen.getByLabelText('Parecer final'), 'Projeto bem apresentado.');

    // Assert
    expect(screen.getByLabelText('Parecer final')).toHaveValue('Projeto bem apresentado.');
  });
});

describe('CampoSelecao', () => {
  it('deve ligar o rótulo à escolha', async () => {
    // Arrange
    const user = userEvent.setup();
    render(
      <CampoSelecao rotulo="Modalidade">
        <option value="">Selecione</option>
        <option value="eja">EJA</option>
      </CampoSelecao>,
    );

    // Act
    await user.selectOptions(screen.getByLabelText('Modalidade'), 'eja');

    // Assert
    expect(screen.getByLabelText('Modalidade')).toHaveValue('eja');
  });
});
