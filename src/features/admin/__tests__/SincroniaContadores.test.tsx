import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TelaAdmin } from '@/features/admin';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const cadeia = (resultado: { data: unknown; error: unknown }) => {
  const chain: any = {};
  ['select', 'eq', 'neq', 'gt', 'in', 'order', 'range'].forEach((m) => (chain[m] = vi.fn(() => chain)));
  chain.maybeSingle = vi.fn(() => Promise.resolve(resultado));
  chain.then = (ok: any, erro: any) => Promise.resolve(resultado).then(ok, erro);
  return chain;
};

describe('Painel do Admin: sincronia do evento ativo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.from).mockImplementation(((tabela: string) =>
      cadeia(
        tabela === 'eventos'
          ? { data: { id_evento: 'evt-1', nome_evento: 'Feira Ativa', edicao: '3ª', cota_avaliacoes_padrao: 4 }, error: null }
          : { data: [], error: null }
      )) as never);
  });

  it('deve mostrar o nome do evento ativo lido do banco', async () => {
    // Arrange / Act
    render(<TelaAdmin />);

    // Assert
    expect(await screen.findByText('Feira Ativa')).toBeInTheDocument();
  });

  it('não deve varrer tabelas para contadores que o Painel não exibe', async () => {
    // Arrange / Act
    render(<TelaAdmin />);
    await screen.findByText('Feira Ativa');

    // Assert
    await waitFor(() => expect(supabase.from).toHaveBeenCalledWith('eventos'));
    const tabelas = vi.mocked(supabase.from).mock.calls.map((c) => c[0]);
    ['usuarios', 'avaliadores_evento', 'avaliacoes', 'locks_ativos', 'questionarios', 'view_projetos_quarentena'].forEach((t) =>
      expect(tabelas).not.toContain(t)
    );
  });

  it('deve avisar quando não consegue ler o evento ativo', async () => {
    // Arrange
    vi.mocked(supabase.from).mockImplementation((() => cadeia({ data: null, error: { message: 'falha' } })) as never);

    // Act
    render(<TelaAdmin />);

    // Assert
    expect(await screen.findByText('Falha ao sincronizar o evento ativo com o banco de dados.')).toBeInTheDocument();
  });

  it('sem evento ativo deve dizer isso no cabeçalho, e não mostrar o nome guardado no navegador', async () => {
    // Arrange
    localStorage.setItem('evento_ativo_nome', 'Feira do Ano Passado');
    vi.mocked(supabase.from).mockImplementation((() => cadeia({ data: null, error: null })) as never);

    // Act
    render(<TelaAdmin />);

    // Assert
    expect(await screen.findByText('Nenhum evento ativo')).toBeInTheDocument();
    expect(screen.queryByText('Feira do Ano Passado')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar Nome do Evento' })).toBeDisabled();
    localStorage.removeItem('evento_ativo_nome');
  });

  it('deve indicar no painel quando a avaliação do evento foi finalizada', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { avaliacao_finalizada: true }, error: null } as never);

    // Act
    render(<TelaAdmin />);

    // Assert
    expect(await screen.findByText(/avaliação finalizada/i)).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith('fn_telao_resumo', { p_id_evento: 'evt-1' });
  });
});
