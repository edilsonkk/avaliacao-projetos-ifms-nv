import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Check } from 'lucide-react';
import { Selo } from '@/components/ui';

describe('Selo', () => {
  it('deve mostrar o texto sem o ícone no nome acessível', () => {
    // Arrange / Act
    render(
      <Selo tom="sucesso" icone={<Check className="w-3 h-3" />} role="status" aria-label="Situação do aparelho">
        credenciado
      </Selo>,
    );

    // Assert
    expect(screen.getByRole('status', { name: 'Situação do aparelho' })).toHaveTextContent('credenciado');
  });

  it('deve manter o texto visível no tom neutro', () => {
    // Arrange / Act
    render(<Selo>local</Selo>);

    // Assert
    expect(screen.getByText('local')).toBeVisible();
  });
});
