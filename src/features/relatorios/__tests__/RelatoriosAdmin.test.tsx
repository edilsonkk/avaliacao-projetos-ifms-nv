import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelatoriosAdmin } from '@/features/relatorios';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const ID_EVENTO = 'evt-1';
let respostasRpc: Record<string, { data: unknown[] | null; error: unknown }> = {};

const cadeia = (resultado: { data: unknown; error: unknown; count?: number }) => {
  const chain: any = {};
  ['select', 'eq', 'order'].forEach((m) => (chain[m] = vi.fn(() => chain)));
  chain.range = vi.fn(() => Promise.resolve(resultado));
  chain.maybeSingle = vi.fn(() => Promise.resolve(resultado));
  chain.then = (ok: any, erro: any) => Promise.resolve(resultado).then(ok, erro);
  return chain;
};

const projeto = (codigo: string, estande: string) => ({
  id_projeto: `id-${codigo}`,
  codigo_projeto: codigo,
  titulo: `Projeto ${codigo}`,
  estande,
  modalidade: 'Ensino Médio',
  area_conhecimento: 'Exatas',
  nome_instituicao: 'IFMS',
  total_avaliacoes: 0,
  media_geral: 0,
  notas: [],
  is_check_in_realizado: true,
  detalhes_avaliacoes: [],
});

describe('RelatoriosAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respostasRpc = {
      fn_relatorio_projetos_completo: { data: [projeto('P-10', 'A-01'), projeto('P-2', 'Z-99')], error: null },
      fn_relatorio_avaliadores_completo: { data: [], error: null },
      fn_relatorio_ausencias_completo: { data: [], error: null },
    };
    vi.mocked(supabase.rpc).mockImplementation(((funcao: string) => cadeia(respostasRpc[funcao] ?? { data: [], error: null })) as never);
    vi.mocked(supabase.from).mockImplementation(((tabela: string) =>
      cadeia(tabela === 'eventos' ? { data: { nome_evento: 'Feira Teste' }, error: null } : { data: [], error: null, count: 0 })) as never);
  });

  it('deve ler os relatórios só do evento ativo, pelas funções do banco e sem consultas alternativas', async () => {
    // Arrange / Act
    render(<RelatoriosAdmin id_evento_ativo={ID_EVENTO} />);

    // Assert
    await screen.findByText('Projeto P-10');
    ['fn_relatorio_projetos_completo', 'fn_relatorio_avaliadores_completo', 'fn_relatorio_ausencias_completo'].forEach((f) =>
      expect(supabase.rpc).toHaveBeenCalledWith(f, { p_id_evento: ID_EVENTO })
    );
    const tabelas = vi.mocked(supabase.from).mock.calls.map((c) => c[0]);
    expect(tabelas).not.toContain('view_relatorio_projetos');
    expect(tabelas).not.toContain('projetos');
    expect(tabelas).not.toContain('usuarios');
  });

  it('deve mostrar o erro em vez de um relatório vazio', async () => {
    // Arrange
    respostasRpc.fn_relatorio_projetos_completo = { data: null, error: { code: '42703', message: 'column p.modalidade does not exist' } };

    // Act
    render(<RelatoriosAdmin id_evento_ativo={ID_EVENTO} />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os relatórios: column p.modalidade does not exist');
  });

  it('deve avisar e não consultar nada sem evento ativo (nem um evento guardado no navegador)', async () => {
    // Arrange
    localStorage.setItem('evento_ativo_id', 'evento-antigo');

    // Act
    render(<RelatoriosAdmin id_evento_ativo="" />);

    // Assert
    expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    localStorage.removeItem('evento_ativo_id');
  });

  it('deve ordenar a coluna Código pelo código, em ordem natural, e pelo teclado', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<RelatoriosAdmin id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-10');
    const primeiraLinha = () => screen.getAllByRole('row')[1];

    // Assert (ordem inicial: código crescente, P-2 antes de P-10, sem olhar o estande)
    expect(within(primeiraLinha()).getByText('P-2')).toBeInTheDocument();

    // Act
    screen.getByRole('button', { name: /código do projeto/i }).focus();
    await user.keyboard('{Enter}');

    // Assert
    expect(screen.getByRole('columnheader', { name: /código do projeto/i })).toHaveAttribute('aria-sort', 'descending');
    expect(within(primeiraLinha()).getByText('P-10')).toBeInTheDocument();
  });

  it('deve calcular os indicadores pela cota de cada projeto presente na competição', async () => {
    // Arrange (evento com cota padrão 3)
    const p = (codigo: string, extra: Record<string, unknown>) => ({ ...projeto(codigo, 'A-01'), cota_avaliacoes: 3, is_fora_da_competicao: false, ...extra });
    respostasRpc.fn_relatorio_projetos_completo = {
      data: [
        p('P-1', { cota_avaliacoes: 2, total_avaliacoes: 3 }), // cota customizada 2, uma avaliação a mais
        p('P-2', { total_avaliacoes: 1 }), // abaixo da cota
        p('P-3', { total_avaliacoes: 2, is_fora_da_competicao: true }), // fora da competição: fora da meta
        p('P-4', { is_check_in_realizado: false }), // não credenciado
        p('P-5', {}), // check-in feito, marcado ausente no estande
      ],
      error: null,
    };
    respostasRpc.fn_relatorio_ausencias_completo = {
      data: [{ id_usuario: 'u-1', avaliador_nome: 'Ana', avaliador_email: 'a@x', ausencias: [{ id_projeto: 'id-P-5', codigo_projeto: 'P-5' }] }],
      error: null,
    };
    const user = userEvent.setup();
    render(<RelatoriosAdmin id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Projeto P-1');
    const span = (texto: string) => screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === texto);

    // Act
    await user.click(screen.getByRole('button', { name: /indicadores/i }));

    // Assert (meta = 2 + 3 + 3 = 8; na meta = 2 + 1 + 0 = 3)
    expect(await screen.findByText('3 de 8 avaliações (38%)')).toBeInTheDocument();
    expect(span('Ausentes: 1')).toBeInTheDocument();
    expect(span('Não credenciados: 1')).toBeInTheDocument();
    expect(screen.getByText('Sem avaliação').nextElementSibling).toHaveTextContent('1 proj.');
    expect(screen.getByText('Abaixo da cota').nextElementSibling).toHaveTextContent('1 proj.');
    expect(screen.getByText('Cota concluída').nextElementSibling).toHaveTextContent('1 proj.');
  });
});
