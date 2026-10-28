import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const estado = vi.hoisted(() => ({ ambiente: 'local' as 'local' | 'producao' | null }));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
  verificar_conexao_configurada: () => estado.ambiente !== null,
  get ambiente_supabase() {
    return estado.ambiente;
  },
}));

import { Cabecalho } from '@/components/layout/Cabecalho';

const renderizar = () => render(<Cabecalho tela_atual="admin" ao_mudar_tela={vi.fn()} papel="admin" />);

describe('Cabecalho - indicador de ambiente do Supabase', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('deve indicar quando a aplicação usa o Supabase local', () => {
    // Arrange
    estado.ambiente = 'local';

    // Act
    renderizar();

    // Assert
    expect(screen.getByRole('status', { name: /ambiente do banco/i })).toHaveTextContent('Supabase LOCAL');
  });

  it('deve destacar quando a aplicação usa o Supabase de produção', () => {
    // Arrange
    estado.ambiente = 'producao';

    // Act
    renderizar();

    // Assert
    expect(screen.getByRole('status', { name: /ambiente do banco/i })).toHaveTextContent('Supabase PRODUÇÃO');
  });

  it('deve informar quando o Supabase não está configurado', () => {
    // Arrange
    estado.ambiente = null;

    // Act
    renderizar();

    // Assert
    expect(screen.getByRole('status', { name: /ambiente do banco/i })).toHaveTextContent('Supabase não configurado');
  });
});
