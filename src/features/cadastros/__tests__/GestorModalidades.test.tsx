import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GestorModalidades, montarItensModalidades } from '@/features/cadastros/components/GestorModalidades';
import type { DecisaoMapeamento } from '@/components/importacao/ModalDeParaMapping';
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

type Chamada = { tabela: string; metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let dados: Record<string, unknown[]> = {};
let erroLeitura: unknown = null;
let erroUpdate: unknown = null;

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    let operacao = 'select';
    const chain: any = {};
    ['select', 'eq', 'order', 'insert', 'update', 'delete'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        if (['insert', 'update', 'delete'].includes(metodo)) operacao = metodo;
        return chain;
      });
    });
    chain.then = (resolve: any, reject: any) => {
      if (operacao === 'update') return Promise.resolve({ data: null, error: erroUpdate }).then(resolve, reject);
      return Promise.resolve({ data: erroLeitura ? null : dados[tabela] ?? [], error: erroLeitura }).then(resolve, reject);
    };
    return chain;
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);

const renderizar = (props: Partial<React.ComponentProps<typeof GestorModalidades>> = {}) =>
  render(<GestorModalidades id_evento_ativo={ID_EVENTO} {...props} />);

describe('GestorModalidades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    erroLeitura = null;
    erroUpdate = null;
    dados = {
      modalidades: [
        { id_modalidade: 'm-1', codigo: 'EM-01', nome_modalidade: 'Ensino Médio', nivel: 'Médio', area_tematica: 'Exatas', descricao: 'Alunos do médio' },
        { id_modalidade: 'm-2', codigo: null, nome_modalidade: 'Superior', nivel: null, area_tematica: null, descricao: null },
      ],
      areas_tematicas: [{ id_area: 'a-1', nome_area: 'CIÊNCIAS EXATAS' }],
      modalidade_aliases: [],
    };
    mockarBanco();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
  });

  it('deve listar só as modalidades do evento ativo, sem inventar dados', async () => {
    // Arrange / Act
    renderizar();

    // Assert
    expect(await screen.findByText('Ensino Médio')).toBeInTheDocument();
    expect(chamadasDe('modalidades', 'eq').map((c) => c.args)).toContainEqual(['id_evento', ID_EVENTO]);
    const linha = screen.getByText('Superior').closest('tr')!;
    expect(within(linha).getByText('Sem código')).toBeInTheDocument();
    expect(within(linha).getByText('Não informado')).toBeInTheDocument();
  });

  it('deve mostrar o erro de leitura em vez de lista vazia silenciosa', async () => {
    // Arrange
    erroLeitura = { code: 'XX000', message: 'banco fora do ar' };

    // Act
    renderizar();

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as modalidades: banco fora do ar');
  });

  it('deve avisar e não carregar nada sem evento ativo', async () => {
    // Arrange / Act
    renderizar({ id_evento_ativo: '' });

    // Assert
    expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nova modalidade/i })).toBeDisabled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('deve cadastrar pela função do banco', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { cadastradas: 1, atualizadas: 0, associadas: 0, ignoradas: [] }, error: null } as never);
    renderizar();
    await screen.findByText('Ensino Médio');
    await user.click(screen.getByRole('button', { name: /nova modalidade/i }));

    // Act
    await user.type(screen.getByRole('textbox', { name: 'Código' }), 'EF-01');
    await user.type(screen.getByRole('textbox', { name: 'Nome da modalidade' }), 'Ensino Fundamental');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Nível de ensino' }), 'Fundamental');
    await user.click(screen.getByRole('button', { name: /cadastrar modalidade/i }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_modalidades', {
      p_id_evento: ID_EVENTO,
      p_itens: [{ nome: 'Ensino Fundamental', codigo: 'EF-01', nivel: 'Fundamental', area_tematica: null, descricao: null }],
    });
    expect(chamadasDe('modalidades', 'insert')).toHaveLength(0);
    expect(await screen.findByRole('status')).toHaveTextContent('Modalidade "Ensino Fundamental" cadastrada.');
  });

  it('deve traduzir nome repetido na edição e manter o formulário aberto', async () => {
    // Arrange
    const user = userEvent.setup();
    erroUpdate = { code: '23505', message: 'duplicate key value violates unique constraint "uq_idx_modalidades_evento_nome"' };
    renderizar();
    await screen.findByText('Superior');
    await user.click(screen.getByRole('button', { name: 'Editar Superior' }));
    const dialogo = screen.getByRole('dialog', { name: 'Editar Modalidade' });

    // Act
    await user.clear(within(dialogo).getByLabelText('Modalidade'));
    await user.type(within(dialogo).getByLabelText('Modalidade'), 'Ensino Médio');
    await user.click(within(dialogo).getByRole('button', { name: /salvar alterações/i }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma modalidade com esse nome neste evento.');
    expect(screen.getByRole('dialog', { name: 'Editar Modalidade' })).toBeInTheDocument();
  });

  it('deve excluir só depois de confirmar e explicar quando está em uso', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'A modalidade tem 12 projeto(s) e está bloqueada para 2 avaliador(es).' },
    } as never);
    renderizar();
    await screen.findByText('Ensino Médio');

    // Act
    await user.click(screen.getByRole('button', { name: 'Excluir Ensino Médio' }));
    const dialogo = screen.getByRole('alertdialog', { name: 'Excluir "Ensino Médio"?' });
    expect(supabase.rpc).not.toHaveBeenCalled();
    await user.click(within(dialogo).getByRole('button', { name: 'Excluir' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_excluir_modalidade', { p_id_modalidade: 'm-1' });
    expect(chamadasDe('modalidades', 'delete')).toHaveLength(0);
    expect(await screen.findByRole('alert')).toHaveTextContent('12 projeto(s)');
    expect(screen.getByText('Ensino Médio')).toBeInTheDocument();
  });

  it('deve ordenar pelo teclado', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    await screen.findByText('Ensino Médio');

    // Act
    screen.getByRole('button', { name: /^código/i }).focus();
    await user.keyboard('{Enter}');

    // Assert
    expect(screen.getByRole('columnheader', { name: /^código/i })).toHaveAttribute('aria-sort', 'ascending');
    expect(within(screen.getAllByRole('row')[1]).getByText('Ensino Médio')).toBeInTheDocument();
  });

  describe('importação', () => {
    it('deve transformar a associação do De-Para em apelido e o resto em cadastro/atualização', () => {
      // Arrange
      const decisoes = new Map<string, DecisaoMapeamento>([
        ['Médio Integrado', { termo_original: 'Médio Integrado', tipo: 'modalidade', acao: 'associar_existente', id_destino: 'm-1' }],
        ['Pós', { termo_original: 'Pós', tipo: 'modalidade', acao: 'cadastrar_novo', novo_nome: 'Pós-Graduação' }],
      ]);

      // Act
      const itens = montarItensModalidades(
        [
          { nome_modalidade: 'Médio Integrado', linha_original: 2 },
          { nome_modalidade: 'Pós', codigo: 'POS', linha_original: 3 },
          { nome_modalidade: 'Ensino Médio', nivel: 'Médio', linha_original: 4 },
        ],
        decisoes
      );

      // Assert
      expect(itens).toEqual([
        { nome: 'Médio Integrado', id_existente: 'm-1' },
        { nome: 'Pós-Graduação', codigo: 'POS', nivel: null, area_tematica: null, descricao: null },
        { nome: 'Ensino Médio', codigo: null, nivel: 'Médio', area_tematica: null, descricao: null },
      ]);
    });

    it('deve reimportar modalidades já existentes numa única chamada, sem insert direto', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: { cadastradas: 0, atualizadas: 2, associadas: 0, ignoradas: [] }, error: null } as never);
      renderizar();
      await screen.findByText('Ensino Médio');
      const csv = 'Código,Modalidade,Nível\nEM-01,Ensino Médio,Médio\nSUP,Superior,Superior\n';

      // Act
      await user.upload(screen.getByLabelText('Arquivo de modalidades (.xlsx ou .csv)'), new File([csv], 'mod.csv', { type: 'text/csv' }));

      // Assert
      await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
      const [funcao, args] = vi.mocked(supabase.rpc).mock.calls[0] as [string, { p_itens: { nome: string }[] }];
      expect(funcao).toBe('admin_salvar_modalidades');
      expect(args.p_itens.map((i) => i.nome)).toEqual(['Ensino Médio', 'Superior']);
      expect(chamadasDe('modalidades', 'insert')).toHaveLength(0);
      const log = await screen.findByRole('list', { name: 'Resultado da importação' });
      expect(within(log).getByText(/0 cadastrada\(s\), 2 já existente\(s\) atualizada\(s\)/)).toBeInTheDocument();
    });
  });
});
