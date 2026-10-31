import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RankingPremiacao } from '@/features/relatorios';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const ID_EVENTO = 'evt-1';

type Chamada = { metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let linhas: Record<string, unknown>[] = [];
let erro: unknown = null;

const linha = (over: Record<string, unknown>) => ({
  id_projeto: `id-${over.codigo_projeto}`,
  titulo: `Projeto ${over.codigo_projeto}`,
  estande: null,
  nome_instituicao: 'IFMS Câmpus Coxim',
  modalidade: 'Ensino Médio',
  area_tematica: 'Exatas',
  notas: [9],
  media_geral: 9,
  total_avaliacoes: 1,
  posicao: 1,
  em_quarentena: false,
  ...over,
});

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation((() => {
    const chain: any = {};
    ['select', 'eq', 'order'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ metodo, args });
        return chain;
      });
    });
    chain.range = vi.fn(() => Promise.resolve({ data: erro ? null : linhas, error: erro }));
    return chain;
  }) as never);
};

describe('RankingPremiacao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    erro = null;
    linhas = [
      linha({ codigo_projeto: 'R-003', media_geral: 8, posicao: 3, notas: [10, 6], em_quarentena: true }),
      linha({ codigo_projeto: 'R-002', posicao: 1 }),
      linha({ codigo_projeto: 'R-001', posicao: 1, estande: 'B-07' }),
      linha({ codigo_projeto: 'R-009', media_geral: 5, posicao: 4 }),
    ];
    mockarBanco();
  });

  it('deve ler só a classificação do evento ativo', async () => {
    // Arrange / Act
    render(<RankingPremiacao id_evento_ativo={ID_EVENTO} />);

    // Assert
    await screen.findByText('Projeto R-001');
    expect(supabase.from).toHaveBeenCalledWith('view_ranking_top3');
    expect(chamadas.filter((c) => c.metodo === 'eq').map((c) => c.args)).toContainEqual(['id_evento', ID_EVENTO]);
  });

  it('deve mostrar o empate na mesma posição e só quem está até o 3º lugar', async () => {
    // Arrange / Act
    render(<RankingPremiacao id_evento_ativo={ID_EVENTO} />);

    // Assert
    const itens = await screen.findAllByRole('listitem');
    expect(itens.map((i) => i.getAttribute('aria-label'))).toEqual([
      '1º lugar: Projeto R-001',
      '1º lugar: Projeto R-002',
      '3º lugar: Projeto R-003',
    ]);
    expect(within(itens[0]).getByText('1º Lugar (empate)')).toBeInTheDocument();
    expect(screen.queryByText('Projeto R-009')).not.toBeInTheDocument();
  });

  it('deve marcar o empate na média desfeito pela prioridade das perguntas', async () => {
    // Arrange
    linhas = [
      linha({ codigo_projeto: 'D-001', media_geral: 4, posicao: 1, chave_desempate: [5, 3] }),
      linha({ codigo_projeto: 'D-002', media_geral: 4, posicao: 2, chave_desempate: [3, 5] }),
    ];

    // Act
    render(<RankingPremiacao id_evento_ativo={ID_EVENTO} />);

    // Assert
    const primeiro = await screen.findByRole('listitem', { name: '1º lugar: Projeto D-001' });
    expect(within(primeiro).getByText('Desempate')).toHaveAttribute('title', 'Médias por pergunta, na ordem de prioridade: 5.00 · 3.00');
    expect(within(primeiro).queryByText('1º Lugar (empate)')).not.toBeInTheDocument();
    expect(chamadas.find((c) => c.metodo === 'select')?.args[0]).toContain('chave_desempate');
  });

  it('deve avisar quando um projeto do pódio está em quarentena', async () => {
    // Arrange / Act
    render(<RankingPremiacao id_evento_ativo={ID_EVENTO} />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('1 projeto(s) do pódio estão em quarentena');
    const item = screen.getByRole('listitem', { name: '3º lugar: Projeto R-003' });
    expect(within(item).getByText('Em quarentena')).toBeInTheDocument();
  });

  it('não deve inventar estande nem instituição', async () => {
    // Arrange
    linhas = [linha({ codigo_projeto: 'R-001', estande: null, nome_instituicao: null })];

    // Act
    render(<RankingPremiacao id_evento_ativo={ID_EVENTO} />);

    // Assert
    const item = await screen.findByRole('listitem', { name: '1º lugar: Projeto R-001' });
    expect(within(item).queryByText('EST-00')).not.toBeInTheDocument();
    expect(within(item).queryByText('IFMS')).not.toBeInTheDocument();
    expect(within(item).getByText('R-001')).toBeInTheDocument();
  });

  it('deve mostrar o erro de leitura em vez de "nenhum projeto"', async () => {
    // Arrange
    erro = { code: 'XX000', message: 'banco fora do ar' };

    // Act
    render(<RankingPremiacao id_evento_ativo={ID_EVENTO} />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar a classificação: banco fora do ar');
    expect(screen.queryByText(/nenhum projeto/i)).not.toBeInTheDocument();
  });

  it('deve avisar e não consultar nada sem evento ativo', async () => {
    // Arrange / Act
    render(<RankingPremiacao id_evento_ativo="" />);

    // Assert
    expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('deve filtrar por modalidade', async () => {
    // Arrange
    const user = userEvent.setup();
    linhas = [linha({ codigo_projeto: 'R-001' }), linha({ codigo_projeto: 'S-001', modalidade: 'Superior' })];
    render(<RankingPremiacao id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto S-001');

    // Act
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por modalidade' }), 'Superior');

    // Assert
    expect(screen.getByRole('region', { name: 'Superior' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Ensino Médio' })).not.toBeInTheDocument();
  });

  it('deve exportar CSV com BOM, posição do banco e campos protegidos contra fórmula', async () => {
    // Arrange
    const user = userEvent.setup();
    linhas = [linha({ codigo_projeto: 'R-001', titulo: '=HYPERLINK("x")', posicao: 1 })];
    let blob: Blob | null = null;
    globalThis.URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:x';
    }) as never;
    globalThis.URL.revokeObjectURL = vi.fn();
    render(<RankingPremiacao id_evento_ativo={ID_EVENTO} />);
    await screen.findByRole('listitem');

    // Act
    await user.click(screen.getByRole('button', { name: /exportar ranking/i }));

    // Assert
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(new Uint8Array(leitor.result as ArrayBuffer));
      leitor.readAsArrayBuffer(blob!);
    });
    const texto = new TextDecoder().decode(bytes);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(texto).toContain('"Ensino Médio","Exatas","1","R-001","","\'=HYPERLINK(""x"")"');
  });
});
