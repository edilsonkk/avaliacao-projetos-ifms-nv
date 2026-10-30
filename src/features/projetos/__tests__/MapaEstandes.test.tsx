import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapaEstandes } from '@/features/projetos';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const ID_EVENTO = 'evt-1';
type Chamada = { tabela: string; metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let respostas: Record<string, unknown[]> = {};

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    const chain: any = {};
    ['select', 'eq', 'or', 'order'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return chain;
      });
    });
    const resultado = { data: tabela === 'eventos' ? { cota_avaliacoes_padrao: 3 } : respostas[tabela] ?? [], error: null };
    chain.range = vi.fn(() => Promise.resolve(resultado));
    chain.maybeSingle = vi.fn(() => Promise.resolve(resultado));
    chain.then = (ok: any, erro: any) => Promise.resolve(resultado).then(ok, erro);
    return chain;
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo).map((c) => c.args);

const projeto = (over: Record<string, unknown>) => ({
  titulo: `Projeto ${over.codigo_projeto}`,
  corredor: null,
  is_check_in_realizado: true,
  is_fora_da_competicao: false,
  cota_avaliacoes_customizada: null,
  ...over,
  id_projeto: `id-${over.codigo_projeto}`,
});

const cardDe = (codigo: string) => screen.getByText(`Projeto ${codigo}`).closest('button')!;

describe('MapaEstandes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    respostas = {
      projetos: [
        projeto({ codigo_projeto: 'P-1', estande: 'A-01', cota_avaliacoes_customizada: 2 }),
        projeto({ codigo_projeto: 'P-2', estande: 'EST-12' }),
        projeto({ codigo_projeto: 'P-3', estande: 'B-03', is_check_in_realizado: null }),
      ],
      avaliacoes: [
        { id_projeto: 'id-P-1', nota_final: 9 },
        { id_projeto: 'id-P-1', nota_final: 8 },
      ],
      view_projetos_quarentena: [{ id_projeto: 'id-P-2' }],
      locks_ativos: [],
    };
    mockarBanco();
  });

  it('deve ler avaliações, travas e quarentena só do evento ativo, sem canceladas e sem travas vencidas', async () => {
    // Arrange / Act
    render(<MapaEstandes id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-1');

    // Assert
    expect(chamadasDe('projetos', 'eq')).toContainEqual(['id_evento', ID_EVENTO]);
    expect(chamadasDe('avaliacoes', 'eq')).toContainEqual(['projetos.id_evento', ID_EVENTO]);
    expect(chamadasDe('avaliacoes', 'or')).toContainEqual(['status.is.null,status.neq.CANCELADA']);
    expect(chamadasDe('locks_ativos', 'eq')).toContainEqual(['projetos.id_evento', ID_EVENTO]);
    expect(String(chamadasDe('locks_ativos', 'or')[0][0])).toMatch(/^expira_em\.is\.null,expira_em\.gt\./);
    expect(chamadasDe('view_projetos_quarentena', 'eq')).toContainEqual(['id_evento', ID_EVENTO]);
  });

  it('deve usar a cota customizada do projeto para a cor e o contador', async () => {
    // Arrange / Act
    render(<MapaEstandes id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-1');

    // Assert (2 avaliações com cota 2 = completo, não "faltando 1 de 3")
    expect(within(cardDe('P-1')).getByText('Avaliado (2/2)')).toBeInTheDocument();
  });

  it('deve marcar quarentena pela lista pendente e tratar check-in vazio como não credenciado', async () => {
    // Arrange / Act
    render(<MapaEstandes id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-1');

    // Assert
    expect(within(cardDe('P-2')).getByRole('img', { name: /em quarentena/i })).toBeInTheDocument();
    expect(within(cardDe('P-1')).queryByRole('img', { name: /em quarentena/i })).not.toBeInTheDocument();
    expect(within(cardDe('P-3')).getByText(/não credenciado/i)).toBeInTheDocument();
  });

  it('não deve inventar corredor para estande que não é "letra + número"', async () => {
    // Arrange / Act
    render(<MapaEstandes id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-1');

    // Assert
    expect(screen.getByText('Corredor A')).toBeInTheDocument();
    expect(screen.getByText('Corredor não informado')).toBeInTheDocument();
    expect(screen.queryByText('Corredor E')).not.toBeInTheDocument();
  });

  it('deve avisar e não consultar nada sem evento ativo', async () => {
    // Arrange / Act
    render(<MapaEstandes id_evento_ativo="" />);

    // Assert
    expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('deve abrir a auditoria sem avaliações canceladas', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<MapaEstandes id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-1');
    chamadas = [];

    // Act
    await user.click(cardDe('P-1'));

    // Assert
    expect(chamadasDe('avaliacoes', 'eq')).toContainEqual(['id_projeto', 'id-P-1']);
    expect(chamadasDe('avaliacoes', 'or')).toContainEqual(['status.is.null,status.neq.CANCELADA']);
  });
});
