import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Variáveis hoisted para uso seguro dentro de vi.mock (Vitest)
const { mockFrom, mockSelect, mockIlike, mockEq, mockSingle } = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockIlike = vi.fn(() => ({ single: mockSingle }));
  const mockEq = vi.fn(() => ({ single: mockSingle }));
  const mockSelect = vi.fn(() => ({
    ilike: mockIlike,
    eq: mockEq,
  }));
  const mockFrom = vi.fn(() => ({
    select: mockSelect,
  }));

  return { mockFrom, mockSelect, mockIlike, mockEq, mockSingle };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { TelaLogin } from '@/features/auth';

describe('Auditoria de Regressão: Login Zero-Fricção', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSingle.mockResolvedValue({
      data: { id_usuario: 'usr-456', papel: 'AVALIADOR' },
      error: null,
    });
  });

  it('DEVE higienizar o input com .trim().toLowerCase() e consultar usando .ilike("email", ...)', async () => {
    render(<TelaLogin />);

    // Localiza o input de e-mail
    const emailInput = screen.getByPlaceholderText('seu.email@ifms.edu.br');
    expect(emailInput).toBeInTheDocument();

    // Insere e-mail com espaços extras e letras maiúsculas
    fireEvent.change(emailInput, { target: { value: '   Avaliador.Silva@IFMS.EDU.BR   ' } });

    // Localiza o botão de entrar/submeter e submete o formulário
    const submitBtn = screen.getByRole('button', { name: /acessar fila de avaliação/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // 1. Deve consultar a tabela 'usuarios'
      expect(mockFrom).toHaveBeenCalledWith('usuarios');

      // 2. OBRIGATÓRIO: A consulta deve usar .ilike('email', emailSanitizado)
      expect(mockIlike).toHaveBeenCalledWith('email', 'avaliador.silva@ifms.edu.br');

      // 3. OBRIGATÓRIO: NÃO deve usar .eq('email', ...) case-sensitive
      expect(mockEq).not.toHaveBeenCalled();
    });
  });

  it('DEVE higienizar e usar .ilike no portal da equipe Staff', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id_usuario: 'staff-789', papel: 'STAFF' },
      error: null,
    });

    render(<TelaLogin abaInicial="staff" />);

    const emailInput = screen.getByPlaceholderText('seu.email@ifms.edu.br');
    fireEvent.change(emailInput, { target: { value: '  MONITOR.LUCAS@IFMS.EDU.BR  ' } });

    const submitBtn = screen.getByRole('button', { name: /entrar/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('usuarios');
      expect(mockIlike).toHaveBeenCalledWith('email', 'monitor.lucas@ifms.edu.br');
      expect(mockEq).not.toHaveBeenCalled();
    });
  });
});
