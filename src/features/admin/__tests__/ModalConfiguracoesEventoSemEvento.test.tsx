import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModalConfiguracoesEvento } from '@/features/admin';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  isSupabaseConfigured: () => true,
  verificar_conexao_configurada: () => true,
}));

describe('ModalConfiguracoesEvento sem evento ativo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as any);
  });

  const renderizar = (props: Partial<React.ComponentProps<typeof ModalConfiguracoesEvento>> = {}) =>
    render(<ModalConfiguracoesEvento id_evento_ativo="" ao_fechar={vi.fn()} {...props} />);

  it('avisa que não há evento ativo e desabilita o salvamento', async () => {
    // Arrange / Act
    renderizar();

    // Assert
    expect(await screen.findByText(/Nenhum evento ativo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar Configurações/ })).toBeDisabled();
  });

  it('não consulta nem grava na tabela eventos com o id vazio', async () => {
    // Arrange
    renderizar();
    const botao_salvar = await screen.findByRole('button', { name: /Salvar Configurações/ });

    // Act
    fireEvent.submit(botao_salvar.closest('form')!);

    // Assert
    expect(supabase.from).not.toHaveBeenCalledWith('eventos');
  });

  it('oferece atalhos para criar um evento ou ativar um anterior', async () => {
    // Arrange
    const ao_abrir_novo_evento = vi.fn();
    const ao_abrir_historico = vi.fn();
    renderizar({ ao_abrir_novo_evento, ao_abrir_historico });

    // Act
    fireEvent.click(await screen.findByRole('button', { name: 'Criar um evento agora' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ativar um evento anterior' }));

    // Assert
    expect(ao_abrir_novo_evento).toHaveBeenCalledTimes(1);
    expect(ao_abrir_historico).toHaveBeenCalledTimes(1);
  });
});
