import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjetosQuarentena } from '@/features/atribuicoes';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getSession: vi.fn() },
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const ID_EVENTO = 'evt-1';

const projeto = (codigo: string, diferenca: number, extra: Record<string, unknown> = {}) => ({
  id_projeto: `p-${codigo}`,
  codigo_projeto: codigo,
  titulo: `Projeto ${codigo}`,
  estande: 'E-1',
  corredor: 'Corredor A',
  modalidade: 'Ensino Médio',
  area_tematica: 'Exatas',
  nome_instituicao: 'IFMS Campo Grande',
  total_avaliacoes: 2,
  nota_minima: 9.5 - diferenca,
  nota_maxima: 9.5,
  diferenca_notas: diferenca,
  tem_flag_quarentena: true,
  ...extra,
});

type Chamada = { tabela: string; metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let dados: Record<string, unknown[]> = {};

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    const chain: any = {};
    ['select', 'eq', 'neq', 'or', 'order', 'update'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return chain;
      });
    });
    chain.then = (resolve: any, reject: any) => Promise.resolve({ data: dados[tabela] ?? [], error: null }).then(resolve, reject);
    return chain;
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);

describe('ProjetosQuarentena', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    dados = {
      view_projetos_quarentena: [projeto('FETEC-001', 3), projeto('FETEC-002', 4.5), projeto('FETEC-003', 1, { nota_minima: 8.5 })],
      avaliacoes: [
        { id_avaliacao: 'a1', nota_final: 9.5, created_at: null, status: 'CONCLUIDA', usuarios: { nome: 'Ana' } },
        { id_avaliacao: 'a2', nota_final: 6.5, created_at: null, status: 'CONCLUIDA', usuarios: { nome: 'Bruno' } },
      ],
    };
    mockarBanco();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('deve listar só os projetos do evento ativo, começando pela maior divergência', async () => {
    // Arrange / Act
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('FETEC-002');

    // Assert
    expect(chamadasDe('view_projetos_quarentena', 'eq').map((c) => c.args)).toContainEqual(['id_evento', ID_EVENTO]);
    const codigos = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(codigos).toEqual(['FETEC-002', 'FETEC-001', 'FETEC-003']);
    expect(screen.getByText('3 projetos')).toBeInTheDocument();
  });

  it('deve mostrar a divergência com a menor e a maior nota, sem dados inventados', async () => {
    // Arrange / Act
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} />);
    const linha = (await screen.findByText('FETEC-002')).closest('tr')!;

    // Assert
    expect(within(linha).getByText('4,5 pts')).toBeInTheDocument();
    expect(within(linha).getByText('Menor 5,0 · Maior 9,5')).toBeInTheDocument();
    expect(screen.queryByText('EST-00')).not.toBeInTheDocument();
    expect(screen.queryByText(/flag manual|divergência aritmética/i)).not.toBeInTheDocument();
  });

  it('deve indicar quando o projeto foi marcado pelo sistema sem divergência acima do limite', async () => {
    // Arrange / Act
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} />);
    const linha = (await screen.findByText('FETEC-003')).closest('tr')!;

    // Assert
    expect(within(linha).getByText('Marcado pelo sistema')).toBeInTheDocument();
  });

  it('deve mostrar as notas de cada avaliador ao abrir os detalhes', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('FETEC-001');

    // Act
    const botao = screen.getByRole('button', { name: 'Ver notas do projeto FETEC-001' });
    await user.click(botao);

    // Assert
    const lista = await screen.findByRole('list', { name: 'Notas do projeto FETEC-001' });
    expect(within(lista).getByText('Ana')).toBeInTheDocument();
    expect(within(lista).getByText('6,5')).toBeInTheDocument();
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(chamadasDe('avaliacoes', 'or').map((c) => c.args[0])).toContain('status.is.null,status.neq.CANCELADA');
  });

  it('deve aceitar a divergência de um projeto pela função do banco, após confirmar', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoAtualizarMetricas = vi.fn();
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} aoAtualizarMetricas={aoAtualizarMetricas} />);
    await screen.findByText('FETEC-001');

    // Act
    await user.click(screen.getByRole('button', { name: 'Aceitar divergência do projeto FETEC-001' }));

    // Assert
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/só volta se chegar uma avaliação nova/));
    expect(supabase.rpc).toHaveBeenCalledWith('admin_remover_quarentena', { p_id_projeto: 'p-FETEC-001' });
    await waitFor(() => expect(screen.queryByText('FETEC-001')).not.toBeInTheDocument());
    expect(aoAtualizarMetricas).toHaveBeenCalled();
    expect(chamadasDe('avaliacoes', 'update')).toHaveLength(0);
  });

  it('não deve fazer nada se o Admin cancelar a confirmação', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('FETEC-001');

    // Act
    await user.click(screen.getByRole('button', { name: 'Aceitar divergência do projeto FETEC-001' }));
    await user.click(screen.getByRole('button', { name: /resolver todos/i }));

    // Assert
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByText('FETEC-001')).toBeInTheDocument();
  });

  it('deve resolver só o evento ativo em "Resolver Todos"', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('FETEC-001');

    // Act
    await user.click(screen.getByRole('button', { name: /resolver todos/i }));

    // Assert
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('dos 3 projetos em quarentena deste evento'));
    expect(supabase.rpc).toHaveBeenCalledWith('admin_remover_quarentena_evento', { p_id_evento: ID_EVENTO });
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_remover_quarentena_todos');
    expect(await screen.findByText('Nenhum projeto em quarentena.')).toBeInTheDocument();
  });

  it('deve mostrar o erro do banco sem tentar alterar as avaliações por fora da função', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: 'P0001', message: 'falha no banco' } } as never);
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('FETEC-001');

    // Act
    await user.click(screen.getByRole('button', { name: 'Aceitar divergência do projeto FETEC-001' }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao tirar da quarentena: falha no banco');
    expect(chamadasDe('avaliacoes', 'update')).toHaveLength(0);
    expect(screen.getByText('FETEC-001')).toBeInTheDocument();
  });

  it('deve mostrar o estado vazio quando não há quarentena', async () => {
    // Arrange
    dados.view_projetos_quarentena = [];

    // Act
    render(<ProjetosQuarentena id_evento_ativo={ID_EVENTO} />);

    // Assert
    expect(await screen.findByText('Nenhum projeto em quarentena.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resolver todos/i })).toBeDisabled();
    expect(supabase.from).not.toHaveBeenCalledWith('avaliacoes');
  });

  it('sem evento ativo deve avisar e não consultar nada, nem um evento guardado no navegador', async () => {
    // Arrange
    localStorage.setItem('evento_ativo_id', 'evento-do-ano-passado');

    // Act
    render(<ProjetosQuarentena id_evento_ativo="" />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/não há evento ativo/i);
    expect(supabase.from).not.toHaveBeenCalled();
    localStorage.removeItem('evento_ativo_id');
  });
});
