import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelaoAoVivo } from '@/features/relatorios';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  verificar_conexao_configurada: () => true,
}));

describe('TelaoAoVivo', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('evento_ativo_id', 'evt-1');
  });

  it('deve exibir só os totais vindos do resumo público, sem ler tabelas', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { total_projetos: 40, avaliadores_credenciados: 12, avaliacoes_em_andamento: 3, avaliacoes_realizadas: 57, cota_padrao: 3 },
      error: null,
    } as never);

    // Act
    render(<TelaoAoVivo />);

    // Assert
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('fn_telao_resumo', { p_id_evento: 'evt-1' }));
    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('não deve projetar números de exemplo quando o resumo falha', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'falha' } } as never);

    // Act
    render(<TelaoAoVivo />);

    // Assert
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
    expect(screen.queryByText('124')).not.toBeInTheDocument();
    expect(screen.queryByText('36')).not.toBeInTheDocument();
  });
});
