import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelaStaff } from '@/features/staff';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  verificar_conexao_configurada: () => true,
}));

const ID_EVENTO = 'evt-1';

const dados: Record<string, unknown> = {
  eventos: { id_evento: ID_EVENTO, nome_evento: 'FETEC' },
  projetos: [{ id_projeto: 'p-1', codigo_projeto: 'FETEC-001', titulo: 'Horta Inteligente', estande: 'A-1', corredor: 'A', expositores: 'Ana', is_check_in_realizado: false, id_instituicao: null }],
  usuarios: [{ id_usuario: 'u-1', nome: 'Maria Souza', email: 'maria@ifms.edu.br', papel: 'AVALIADOR' }],
  avaliadores_evento: [{ id_usuario: 'u-1', is_credenciado: true, id_evento: ID_EVENTO, id_instituicao: null }],
};

const mockarTabelas = () => {
  vi.mocked(supabase.from).mockImplementation((tabela: string) => {
    const valor = dados[tabela] ?? [];
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: valor, error: null }),
      single: vi.fn().mockResolvedValue({ data: valor, error: null }),
      update: vi.fn(() => chain),
      then: (resolve: any) => Promise.resolve({ data: valor, error: null }).then(resolve),
    };
    return chain;
  });
};

describe('TelaStaff conectada ao banco', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('evento_ativo_id', ID_EVENTO);
    mockarTabelas();
    vi.mocked(supabase.rpc).mockImplementation((nome: string) =>
      Promise.resolve(
        nome === 'fn_situacao_vinculos'
          ? { data: [{ id_usuario: 'u-1', aparelho_vinculado: true }], error: null }
          : { data: null, error: null },
      ) as never,
    );
  });

  it('deve registrar o check-in pelo RPC, sem alterar projetos diretamente', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<TelaStaff />);

    // Act
    await user.click(await screen.findByRole('button', { name: /confirmar check-in/i }));

    // Assert
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('fn_check_in_projeto', { p_id_projeto: 'p-1', p_check_in: true }),
    );
  });

  it('deve mostrar quem já tem celular vinculado e abrir o painel do aparelho', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<TelaStaff />);

    // Act
    await user.click(await screen.findByRole('button', { name: /credenciar avaliadores/i }));
    const botaoAparelho = await screen.findByRole('button', { name: /aparelho de maria souza/i });
    await user.click(botaoAparelho);

    // Assert
    expect(within(botaoAparelho).getByText('Vinculado')).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: /aparelho de maria souza/i })).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith('fn_situacao_vinculos', { p_id_evento: ID_EVENTO });
  });

  it('sem evento ativo no banco deve avisar e não carregar dados de outro evento, nem do guardado no navegador', async () => {
    // Arrange (beforeEach guardou um evento no navegador; o banco não tem evento ativo)
    const eventoAtivo = dados.eventos;
    dados.eventos = null;

    // Act
    render(<TelaStaff />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/não há evento ativo/i);
    const tabelas = vi.mocked(supabase.from).mock.calls.map((c) => c[0]);
    expect(tabelas).not.toContain('projetos');
    expect(tabelas).not.toContain('avaliadores_evento');
    dados.eventos = eventoAtivo;
  });
});
