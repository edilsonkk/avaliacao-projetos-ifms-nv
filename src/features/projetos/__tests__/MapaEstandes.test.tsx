import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapaEstandes } from '@/features/projetos';
import { supabase } from '@/lib/supabase';
import { rpcPaginavel } from '@/test/rpcPaginavel';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const ID_EVENTO = 'evt-1';
type Chamada = { tabela: string; metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let respostas: Record<string, unknown[]> = {};
/** Uma linha de fn_projetos_situacao: a conta de cota, vagas, média e quarentena feita no banco. */
let situacao: unknown[] = [];

const linhaSituacao = (over: Record<string, unknown>) => ({
  cota: 3,
  avaliacoes_tecnicas: 0,
  travas_tecnicas: 0,
  vagas_restantes: 3,
  media_tecnica: null,
  notas_tecnicas: [],
  votos_populares: 0,
  media_voto_popular: null,
  em_quarentena: false,
  ...over,
});

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
  vi.mocked(supabase.rpc).mockImplementation(((nome: string, args: unknown) => {
    chamadas.push({ tabela: `rpc:${nome}`, metodo: 'rpc', args: [args] });
    return rpcPaginavel({ data: situacao, error: null }) as never;
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
      avaliacoes: [],
    };
    situacao = [
      linhaSituacao({
        id_projeto: 'id-P-1',
        cota: 2,
        avaliacoes_tecnicas: 2,
        vagas_restantes: 0,
        media_tecnica: 8.5,
        notas_tecnicas: [9, 8],
      }),
      linhaSituacao({ id_projeto: 'id-P-2', em_quarentena: true }),
      linhaSituacao({ id_projeto: 'id-P-3' }),
    ];
    mockarBanco();
  });

  it('deve pedir cota, vagas, média e quarentena ao banco, só do evento ativo', async () => {
    // Arrange / Act
    render(<MapaEstandes id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-1');

    // Assert
    expect(chamadasDe('projetos', 'eq')).toContainEqual(['id_evento', ID_EVENTO]);
    expect(chamadasDe('rpc:fn_projetos_situacao', 'rpc')).toContainEqual([{ p_id_evento: ID_EVENTO }]);
    // A conta não é mais refeita no navegador: nada de ler avaliações nem travas cruas
    expect(chamadas.some((c) => c.tabela === 'locks_ativos')).toBe(false);
    expect(chamadas.some((c) => c.tabela === 'view_projetos_quarentena')).toBe(false);
    expect(chamadas.some((c) => c.tabela === 'avaliacoes')).toBe(false);
  });

  it('deve paginar fn_projetos_situacao: projeto além da primeira página também recebe a situação do banco', async () => {
    // Arrange: o PostgREST corta em 1000 linhas. P-2 é a linha 1001, então só chega
    // na segunda página — sem paginar, o estande ficaria com o padrão do navegador.
    const encheLinhas = Array.from({ length: 1000 }, (_, i) => linhaSituacao({ id_projeto: `id-enche-${i}` }));
    const todas = [...encheLinhas, linhaSituacao({ id_projeto: 'id-P-2', media_tecnica: 7.5, notas_tecnicas: [7, 8] })];
    const faixas: Array<[number, number]> = [];
    vi.mocked(supabase.rpc).mockImplementation(((nome: string, args: unknown) => {
      chamadas.push({ tabela: `rpc:${nome}`, metodo: 'rpc', args: [args] });
      return {
        order: () => ({
          range: (inicio: number, fim: number) => {
            faixas.push([inicio, fim]);
            return Promise.resolve({ data: todas.slice(inicio, fim + 1), error: null });
          },
        }),
      } as never;
    }) as never);

    // Act
    render(<MapaEstandes id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-2');

    // Assert: buscou a segunda página e usou a média que veio dela
    expect(faixas).toEqual([[0, 999], [1000, 1999]]);
    expect(within(cardDe('P-2')).getByText('7,50 pts')).toBeInTheDocument();
  });

  it('deve mostrar a média e as notas técnicas que vieram do banco', async () => {
    // Arrange / Act
    render(<MapaEstandes id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-1');

    // Assert
    expect(within(cardDe('P-1')).getByText('8,50 pts')).toBeInTheDocument();
    expect(within(cardDe('P-1')).getByText('9.0')).toBeInTheDocument();
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
    expect(supabase.rpc).not.toHaveBeenCalled();
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
    expect(chamadasDe('avaliacoes', 'eq')).toContainEqual(['is_voto_popular', false]);
    expect(chamadasDe('avaliacoes', 'or')).toContainEqual(['status.is.null,status.neq.CANCELADA']);
  });
});
