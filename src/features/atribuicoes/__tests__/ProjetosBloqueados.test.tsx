import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjetosBloqueados } from '@/features/atribuicoes';
import { supabase } from '@/lib/supabase';
import { EVENTO_APP_RETOMADA } from '@/lib/keepAliveSessao';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getSession: vi.fn() },
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const ID_EVENTO = 'evt-1';
const daquiMin = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

const trava = (id: string, nome: string, codigo: string, expiraMin: number, idProjeto = `p-${codigo}`) => ({
  id_lock: id,
  id_projeto: idProjeto,
  id_usuario: `u-${id}`,
  bloqueado_em: daquiMin(-5),
  expira_em: daquiMin(expiraMin),
  projetos: { codigo_projeto: codigo, titulo: `Projeto ${codigo}`, estande: 'E-1', corredor: 'A', id_evento: ID_EVENTO },
  usuarios: { nome, email: `${id}@ifms.edu.br` },
});

let filtros: unknown[][] = [];
let linhas: unknown[] = [];

const mockarTravas = () => {
  vi.mocked(supabase.from).mockImplementation((() => {
    const chain: any = {
      select: vi.fn(() => chain),
      gt: vi.fn((...args: unknown[]) => { filtros.push(['gt', ...args]); return chain; }),
      eq: vi.fn((...args: unknown[]) => { filtros.push(['eq', ...args]); return chain; }),
      delete: vi.fn(() => chain),
      then: (resolve: any, reject: any) => Promise.resolve({ data: linhas, error: null }).then(resolve, reject),
    };
    return chain;
  }) as never);
};

const linhaDe = (codigo: string, nome: string) =>
  screen.getAllByRole('row').find((r) => within(r).queryByText(codigo) && within(r).queryByText(nome))!;

describe('ProjetosBloqueados', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filtros = [];
    // Duas pessoas avaliando o mesmo projeto (cota 3) e uma em outro projeto
    linhas = [
      trava('l1', 'Ana Avaliadora', 'FETEC-001', 20, 'p-1'),
      trava('l2', 'Bruno Avaliador', 'FETEC-001', 3, 'p-1'),
      trava('l3', 'Carla Avaliadora', 'FETEC-010', 12, 'p-10'),
    ];
    mockarTravas();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deve listar só as travas válidas de projetos do evento ativo', async () => {
    // Arrange / Act
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} />);

    // Assert
    expect(await screen.findByText('Ana Avaliadora')).toBeInTheDocument();
    expect(filtros).toContainEqual(['eq', 'projetos.id_evento', ID_EVENTO]);
    expect(filtros.some((f) => f[0] === 'gt' && f[1] === 'expira_em')).toBe(true);
    expect(screen.getByText('3 travas em 2 projetos')).toBeInTheDocument();
  });

  it('deve mostrar quanto tempo falta e ordenar pela trava que expira primeiro', async () => {
    // Arrange / Act
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Ana Avaliadora');

    // Assert
    const nomes = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[4].textContent);
    expect(nomes[0]).toContain('Bruno Avaliador');
    expect(within(linhaDe('FETEC-001', 'Bruno Avaliador')).getByText('3 min')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /expira em/i })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('deve liberar só a trava daquele avaliador, mantendo o outro avaliador do mesmo projeto', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoAtualizarMetricas = vi.fn();
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} aoAtualizarMetricas={aoAtualizarMetricas} />);
    await screen.findByText('Ana Avaliadora');

    // Act
    await user.click(screen.getByRole('button', { name: 'Liberar trava de Bruno Avaliador no projeto FETEC-001' }));

    // Assert
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/não conseguirá enviá-la/));
    expect(supabase.rpc).toHaveBeenCalledWith('admin_desbloquear_trava', { p_id_lock: 'l2' });
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_desbloquear_projeto', expect.anything());
    await waitFor(() => expect(screen.queryByText('Bruno Avaliador')).not.toBeInTheDocument());
    expect(screen.getByText('Ana Avaliadora')).toBeInTheDocument();
    expect(aoAtualizarMetricas).toHaveBeenCalled();
  });

  it('não deve liberar nada se o Admin cancelar a confirmação', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Ana Avaliadora');

    // Act
    await user.click(screen.getByRole('button', { name: /liberar trava de ana avaliadora/i }));
    await user.click(screen.getByRole('button', { name: /desbloquear todos/i }));

    // Assert
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByText('Ana Avaliadora')).toBeInTheDocument();
  });

  it('deve avisar quantas travas serão liberadas em "Desbloquear Todos"', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Ana Avaliadora');

    // Act
    await user.click(screen.getByRole('button', { name: /desbloquear todos/i }));

    // Assert
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Liberar as 3 travas ativas?'));
    expect(supabase.rpc).toHaveBeenCalledWith('admin_desbloquear_todos');
    expect(await screen.findByText('Todas as travas foram liberadas.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum projeto bloqueado no momento.')).toBeInTheDocument();
  });

  it('deve mostrar o erro do banco sem tentar apagar travas por fora da função', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: 'P0001', message: 'falha no banco' } } as never);
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Ana Avaliadora');

    // Act
    await user.click(screen.getByRole('button', { name: /desbloquear todos/i }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao liberar as travas: falha no banco');
    expect(screen.getByText('Ana Avaliadora')).toBeInTheDocument();
  });

  it('nunca deve exibir o UUID do avaliador quando o cadastro não traz nome nem e-mail', async () => {
    // Arrange
    linhas = [{ ...trava('l9', 'x', 'FETEC-099', 10), id_usuario: 'b1f4e2a0-1111-4c2d-9e3f-123456789abc', usuarios: null }];

    // Act
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} />);

    // Assert
    expect(await screen.findByText('Avaliador não identificado')).toBeInTheDocument();
    expect(screen.queryByText(/b1f4e2a0/)).not.toBeInTheDocument();
  });

  it('deve recarregar sozinha e ao voltar para a aba', async () => {
    // Arrange
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Ana Avaliadora');
    const consultasIniciais = vi.mocked(supabase.from).mock.calls.length;

    // Act
    act(() => {
      window.dispatchEvent(new Event(EVENTO_APP_RETOMADA));
    });

    // Assert
    await waitFor(() => expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(consultasIniciais));
  });

  it('deve tirar da lista a trava que expirou enquanto a tela está aberta', async () => {
    // Arrange
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ProjetosBloqueados id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Bruno Avaliador');
    linhas = linhas.filter((l: any) => l.id_lock !== 'l2');

    // Act: passam 4 minutos (a trava do Bruno expirava em 3)
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000);
    });

    // Assert
    await waitFor(() => expect(screen.queryByText('Bruno Avaliador')).not.toBeInTheDocument());
    expect(screen.getByText('Ana Avaliadora')).toBeInTheDocument();
  });
});
