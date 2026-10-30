import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalExclusaoAvaliacao } from '@/features/atribuicoes';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getSession: vi.fn() },
  },
  verificar_conexao_configurada: () => true,
}));

const ID_EVENTO = 'evt-1';

const avaliacao = (id: string, codigo: string, avaliador: string, nota: number, extra: Record<string, unknown> = {}) => ({
  id_avaliacao: id,
  id_projeto: `p-${codigo}`,
  id_usuario: `u-${avaliador}`,
  nota_final: nota,
  status: 'CONCLUIDA',
  status_avaliacao: 'concluida',
  parecer_final: `Parecer de ${avaliador}`,
  is_quarentena: false,
  created_at: '2026-10-29T10:00:00Z',
  projetos: { id_projeto: `p-${codigo}`, codigo_projeto: codigo, titulo: `Projeto ${codigo}`, estande: 'E-1', id_evento: ID_EVENTO, id_area: 'area-1' },
  usuarios: { id_usuario: `u-${avaliador}`, nome: avaliador, email: `${avaliador.toLowerCase()}@ifms.edu.br` },
  respostas_avaliacao: [
    { id_resposta: `${id}-r1`, id_pergunta: 'q1', nota_atribuida: nota, perguntas_questionario: { texto_pergunta: 'Domínio do Conteúdo', peso_calculo: 1 } },
  ],
  ...extra,
});

type Chamada = { tabela: string; metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let paginas: unknown[][] = [];
let dados: Record<string, unknown[]> = {};

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    let pagina = 0;
    const chain: any = {};
    ['select', 'eq', 'order', 'update'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return chain;
      });
    });
    chain.range = vi.fn((inicio: number, fim: number) => {
      chamadas.push({ tabela, metodo: 'range', args: [inicio, fim] });
      pagina = inicio / 1000;
      return chain;
    });
    chain.then = (resolve: any, reject: any) => {
      const data = tabela === 'avaliacoes' ? paginas[pagina] ?? [] : dados[tabela] ?? [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return chain;
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);

const renderizar = (aoSucesso = vi.fn()) =>
  render(<ModalExclusaoAvaliacao id_evento_ativo={ID_EVENTO} ao_fechar={vi.fn()} aoSucesso={aoSucesso} />);

describe('ModalExclusaoAvaliacao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    paginas = [[
      avaliacao('av-1', 'AGRO-01', 'Carlos', 9.5),
      avaliacao('av-2', 'AGRO-01', 'Bruna', 4.0, { is_quarentena: true }),
      avaliacao('av-3', 'ROBO-02', 'Ana', 8.0, { status: 'CANCELADA', status_avaliacao: 'CANCELADA' }),
    ]];
    dados = {
      areas_tematicas: [{ id_area: 'area-1', nome_area: 'CIÊNCIAS AGRÁRIAS', id_evento: ID_EVENTO }],
      avaliador_areas: [{ id_usuario: 'u-Carlos', id_area: 'area-1', id_evento: ID_EVENTO }],
    };
    mockarBanco();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { sucesso: true, projeto_em_quarentena: false }, error: null } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
  });

  describe('carregamento', () => {
    it('deve buscar só avaliações do evento ativo, no banco', async () => {
      // Arrange / Act
      renderizar();
      await screen.findByText('Carlos');

      // Assert
      expect(chamadasDe('avaliacoes', 'eq').map((c) => c.args)).toContainEqual(['projetos.id_evento', ID_EVENTO]);
      expect(String(chamadasDe('avaliacoes', 'select')[0].args[0])).toContain('projetos!inner');
    });

    // Renderiza 1001 linhas: no runner do CI passa de 5 s, por isso o timeout maior.
    it('deve trazer todas as avaliações, mesmo acima de 1000 (paginado)', { timeout: 30000 }, async () => {
      // Arrange: 1000 na primeira página e 1 na segunda
      paginas = [
        Array.from({ length: 1000 }, (_, i) => avaliacao(`av-${i}`, `P-${i}`, `Aval ${i}`, 8)),
        [avaliacao('av-ultima', 'P-ULTIMA', 'Última Pessoa', 7)],
      ];

      // Act
      renderizar();

      // Assert
      expect(await screen.findByText('Última Pessoa', {}, { timeout: 20000 })).toBeInTheDocument();
      expect(chamadasDe('avaliacoes', 'range').map((c) => c.args)).toEqual([[0, 999], [1000, 1999]]);
      expect(screen.getByRole('button', { name: /todas \(1001\)/i })).toBeInTheDocument();
    });

    it('deve mostrar quantas estão concluídas e canceladas e filtrar por status', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Carlos');

      // Act
      await user.click(screen.getByRole('button', { name: /canceladas \(1\)/i }));

      // Assert
      expect(screen.getByRole('button', { name: /concluídas \(2\)/i })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Ana')).toBeInTheDocument();
      expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
    });

    it('deve mostrar os critérios ao abrir os detalhes', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Carlos');

      // Act
      const botao = screen.getByRole('button', { name: 'Ver critérios da avaliação de Carlos no projeto AGRO-01' });
      await user.click(botao);

      // Assert
      expect(botao).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Domínio do Conteúdo')).toBeInTheDocument();
      expect(screen.getByText(/Parecer de Carlos/)).toBeInTheDocument();
    });

    it('deve ordenar pelo teclado no cabeçalho', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Carlos');

      // Act
      screen.getByRole('button', { name: /^nota/i }).focus();
      await user.keyboard('{Enter}');

      // Assert
      expect(screen.getByRole('columnheader', { name: /nota/i })).toHaveAttribute('aria-sort', 'ascending');
      const primeira = screen.getAllByRole('row')[1];
      expect(within(primeira).getByText('Bruna')).toBeInTheDocument();
    });
  });

  describe('cancelar', () => {
    it('deve pedir confirmação com os dados da avaliação', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Carlos');

      // Act
      await user.click(screen.getByRole('button', { name: 'Excluir avaliação de Carlos no projeto AGRO-01' }));

      // Assert
      const dialogo = screen.getByRole('alertdialog', { name: 'Excluir esta avaliação?' });
      expect(within(dialogo).getByText('AGRO-01')).toBeInTheDocument();
      expect(within(dialogo).getAllByText('CIÊNCIAS AGRÁRIAS')).toHaveLength(2); // área do projeto e do avaliador
      expect(within(dialogo).getByText('9.5')).toBeInTheDocument();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('deve cancelar pela função do banco e avisar quando o projeto sai da quarentena', async () => {
      // Arrange
      const user = userEvent.setup();
      const aoSucesso = vi.fn();
      renderizar(aoSucesso);
      await screen.findByText('Bruna');

      // Act
      await user.click(screen.getByRole('button', { name: 'Excluir avaliação de Bruna no projeto AGRO-01' }));
      await user.click(screen.getByRole('button', { name: /confirmar exclusão/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('excluir_avaliacao', { p_id_avaliacao: 'av-2' });
      expect(chamadasDe('avaliacoes', 'update')).toHaveLength(0);
      expect(await screen.findByText(/o projeto saiu da quarentena/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Restaurar avaliação de Bruna no projeto AGRO-01' })).toBeInTheDocument();
      expect(aoSucesso).toHaveBeenCalled();
    });

    it('não deve mostrar sucesso quando o banco recusa', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } } as never);
      renderizar();
      await screen.findByText('Carlos');

      // Act
      await user.click(screen.getByRole('button', { name: 'Excluir avaliação de Carlos no projeto AGRO-01' }));
      await user.click(screen.getByRole('button', { name: /confirmar exclusão/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent(/erro ao cancelar a avaliação/i);
      expect(screen.queryByRole('button', { name: /desfazer/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Excluir avaliação de Carlos no projeto AGRO-01' })).toBeInTheDocument();
      expect(chamadasDe('avaliacoes', 'update')).toHaveLength(0);
    });

    it('deve desfazer logo após cancelar', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Carlos');
      await user.click(screen.getByRole('button', { name: 'Excluir avaliação de Carlos no projeto AGRO-01' }));
      await user.click(screen.getByRole('button', { name: /confirmar exclusão/i }));

      // Act
      await user.click(await screen.findByRole('button', { name: /desfazer/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('restaurar_avaliacao', { p_id_avaliacao: 'av-1' });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Excluir avaliação de Carlos no projeto AGRO-01' })).toBeInTheDocument()
      );
    });
  });

  describe('restaurar', () => {
    it('deve explicar quando a vaga já foi ocupada e manter a avaliação cancelada', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'O projeto ROBO-02 já está com a cota completa (3 de 3 vagas ocupadas).' },
      } as never);
      renderizar();
      await screen.findByText('Ana');

      // Act
      await user.click(screen.getByRole('button', { name: 'Restaurar avaliação de Ana no projeto ROBO-02' }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('cota completa');
      expect(screen.getByRole('button', { name: 'Restaurar avaliação de Ana no projeto ROBO-02' })).toBeInTheDocument();
    });
  });
});
