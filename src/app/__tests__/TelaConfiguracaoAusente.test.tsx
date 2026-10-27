import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TelaConfiguracaoAusente } from '@/app/TelaConfiguracaoAusente';

describe('TelaConfiguracaoAusente', () => {
  it('deve informar cada problema de configuração e como corrigir', () => {
    // Arrange
    const problemas = ['VITE_SUPABASE_URL não está definida', 'VITE_SUPABASE_ANON_KEY não está definida'];

    // Act
    render(<TelaConfiguracaoAusente problemas={problemas} />);

    // Assert
    expect(screen.getByRole('heading', { name: /configuração do supabase ausente/i })).toBeInTheDocument();
    const itens = screen.getAllByRole('listitem');
    expect(itens.map((item) => item.textContent)).toEqual(problemas);
    expect(screen.getByText(/cp \.env\.example \.env/)).toBeInTheDocument();
  });
});
