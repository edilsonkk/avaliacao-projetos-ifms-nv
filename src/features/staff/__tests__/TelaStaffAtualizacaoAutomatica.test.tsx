import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelaStaff } from '@/features/staff';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  verificar_conexao_configurada: () => true,
}));

const ID_EVENTO = 'evt-1';
const MARIA = { id_usuario: 'u-1', nome: 'Maria Souza', email: 'maria@ifms.edu.br', papel: 'AVALIADOR' };
const JOAO = { id_usuario: 'u-2', nome: 'João Autocadastrado', email: 'joao@ifms.edu.br', papel: 'AVALIADOR' };
const vinculo = (id: string) => ({ id_usuario: id, is_credenciado: true, id_evento: ID_EVENTO, id_instituicao: null });

/** Trocado entre as cargas para simular o autocadastro feito em outro aparelho. */
let dados: Record<string, unknown>;

const mockarTabelas = () => {
  vi.mocked(supabase.from).mockImplementation((tabela: string) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(() => Promise.resolve({ data: dados[tabela] ?? [], error: null })),
      single: vi.fn(() => Promise.resolve({ data: dados[tabela] ?? [], error: null })),
      update: vi.fn(() => chain),
      then: (resolve: any) => Promise.resolve({ data: dados[tabela] ?? [], error: null }).then(resolve),
    };
    return chain;
  });
};

describe('TelaStaff - atualização automática da lista', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('evento_ativo_id', ID_EVENTO);
    dados = {
      eventos: { id_evento: ID_EVENTO, nome_evento: 'FETEC' },
      projetos: [],
      usuarios: [MARIA],
      avaliadores_evento: [vinculo('u-1')],
    };
    mockarTabelas();
    vi.mocked(supabase.rpc).mockImplementation(() => Promise.resolve({ data: [], error: null }) as never);
    // Só o relógio do polling é falso: o resto (setTimeout, microtarefas) continua real,
    // senão as esperas do Testing Library nunca resolvem.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deve trazer o avaliador que acabou de se autocadastrar, sem a recepção recarregar a página', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<TelaStaff />);
    await user.click(await screen.findByRole('button', { name: /credenciar avaliadores/i }));
    expect(screen.getByText('Maria Souza')).toBeInTheDocument();
    expect(screen.queryByText('João Autocadastrado')).not.toBeInTheDocument();

    // Act: o avaliador se cadastra pelo QR Code em outro aparelho
    dados.usuarios = [MARIA, JOAO];
    dados.avaliadores_evento = [vinculo('u-1'), vinculo('u-2')];
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    // Assert
    expect(await screen.findByText('João Autocadastrado')).toBeInTheDocument();
    expect(screen.getByText('Maria Souza')).toBeInTheDocument();
  });

  it('não deve trocar a lista por um estado de carregamento durante a atualização automática', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<TelaStaff />);
    await user.click(await screen.findByRole('button', { name: /credenciar avaliadores/i }));

    // Act: dispara a atualização sem deixar as consultas terminarem
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    // Assert: a lista continua na tela e o botão de recarregar segue disponível
    expect(screen.getByText('Maria Souza')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recarregar dados/i })).toBeEnabled();
    await act(async () => {});
  });
});
