import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GestorInstituicoes, extrairLinhaInstituicao } from '@/features/cadastros/components/GestorInstituicoes';
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
    ['select', 'eq', 'order', 'insert', 'update', 'delete', 'upsert'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        if (['insert', 'update', 'delete', 'upsert'].includes(metodo)) operacao = metodo;
        return chain;
      });
    });
    chain.range = vi.fn(() => chain);
    chain.then = (resolve: any, reject: any) => {
      if (operacao === 'update') return Promise.resolve({ data: null, error: erroUpdate }).then(resolve, reject);
      return Promise.resolve({ data: erroLeitura ? null : dados[tabela] ?? [], error: erroLeitura }).then(resolve, reject);
    };
    return chain;
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);

const renderizar = (props: Partial<React.ComponentProps<typeof GestorInstituicoes>> = {}) =>
  render(<GestorInstituicoes id_evento_ativo={ID_EVENTO} {...props} />);

describe('GestorInstituicoes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    erroLeitura = null;
    erroUpdate = null;
    dados = {
      instituicoes: [
        { id_instituicao: 'i-1', nome_exibicao: 'Instituto Federal de MS', sigla: 'IFMS', campus: 'Campo Grande' },
        { id_instituicao: 'i-2', nome_exibicao: 'Escola Estadual Joaquim Murtinho', sigla: null, campus: null },
      ],
    };
    mockarBanco();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
  });

  it('deve listar as instituições do evento ativo, sem dados inventados', async () => {
    // Arrange / Act
    renderizar();

    // Assert
    expect(await screen.findByText('Instituto Federal de MS')).toBeInTheDocument();
    expect(chamadasDe('instituicoes', 'eq').map((c) => c.args)).toContainEqual(['id_evento', ID_EVENTO]);
    const linha = screen.getByText('Escola Estadual Joaquim Murtinho').closest('tr')!;
    expect(within(linha).getByText('Sem sigla')).toBeInTheDocument();
    expect(within(linha).getByText('Não informado')).toBeInTheDocument();
  });

  it('deve mostrar o erro de leitura em vez de instituições de exemplo', async () => {
    // Arrange
    erroLeitura = { code: 'XX000', message: 'banco fora do ar' };

    // Act
    renderizar();

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as instituições: banco fora do ar');
    expect(screen.queryByText(/UFMS|UCDB|Câmpus Corumbá/)).not.toBeInTheDocument();
  });

  it('deve avisar e não carregar nada sem evento ativo', async () => {
    // Arrange / Act
    renderizar({ id_evento_ativo: '' });

    // Assert
    expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nova instituição/i })).toBeDisabled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('deve cadastrar pela função do banco, sem inventar sigla', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { cadastradas: 1, atualizadas: 0, ignoradas: [] }, error: null } as never);
    renderizar();
    await screen.findByText('Instituto Federal de MS');
    await user.click(screen.getByRole('button', { name: /nova instituição/i }));

    // Act
    await user.type(screen.getByRole('textbox', { name: 'Nome da instituição' }), 'Escola Nova');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_instituicoes', {
      p_id_evento: ID_EVENTO,
      p_itens: [{ nome: 'Escola Nova', sigla: '', campus: '' }],
    });
    expect(chamadasDe('instituicoes', 'insert')).toHaveLength(0);
    expect(await screen.findByRole('status')).toHaveTextContent('Instituição "Escola Nova" cadastrada.');
  });

  it('deve traduzir nome repetido na edição', async () => {
    // Arrange
    const user = userEvent.setup();
    erroUpdate = { code: '23505', message: 'duplicate key value violates unique constraint "uq_idx_instituicoes_evento_norm"' };
    renderizar();
    await screen.findByText('Escola Estadual Joaquim Murtinho');
    await user.click(screen.getByRole('button', { name: 'Editar Escola Estadual Joaquim Murtinho' }));
    const dialogo = screen.getByRole('dialog', { name: 'Editar Instituição' });

    // Act
    await user.clear(within(dialogo).getByLabelText('Nome'));
    await user.type(within(dialogo).getByLabelText('Nome'), 'instituto federal de ms');
    await user.click(within(dialogo).getByRole('button', { name: /salvar alterações/i }));

    // Assert
    expect(chamadasDe('instituicoes', 'update')[0].args[0]).toEqual({ nome_exibicao: 'instituto federal de ms', sigla: null, campus: null });
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma instituição com esse nome neste evento.');
    expect(screen.getByRole('dialog', { name: 'Editar Instituição' })).toBeInTheDocument();
  });

  it('deve excluir só depois de confirmar e explicar quando há vínculo', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'A instituição está vinculada a 4 projeto(s) e 1 avaliador(es). Troque a instituição deles antes de excluir.' },
    } as never);
    renderizar();
    await screen.findByText('Instituto Federal de MS');

    // Act
    await user.click(screen.getByRole('button', { name: 'Excluir Instituto Federal de MS' }));
    const dialogo = screen.getByRole('alertdialog', { name: 'Excluir "Instituto Federal de MS"?' });
    expect(supabase.rpc).not.toHaveBeenCalled();
    await user.click(within(dialogo).getByRole('button', { name: 'Excluir' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_excluir_instituicao', { p_id_instituicao: 'i-1' });
    expect(chamadasDe('instituicoes', 'delete')).toHaveLength(0);
    expect(await screen.findByRole('alert')).toHaveTextContent('vinculada a 4 projeto(s)');
    expect(screen.getByText('Instituto Federal de MS')).toBeInTheDocument();
  });

  it('deve ordenar pelo teclado e pesquisar sem diferenciar acentos', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    await screen.findByText('Instituto Federal de MS');

    // Act
    screen.getByRole('button', { name: /^instituição/i }).focus();
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar instituições' }), 'joaquim');

    // Assert
    expect(screen.getByRole('columnheader', { name: /^instituição/i })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByText('Escola Estadual Joaquim Murtinho')).toBeInTheDocument();
    expect(screen.queryByText('Instituto Federal de MS')).not.toBeInTheDocument();
  });

  describe('importação', () => {
    it('deve ler nome, sigla e câmpus com variações de coluna', () => {
      // Arrange / Act
      const item = extrairLinhaInstituicao({ 'Instituição': ' UFMS ', Sigla: 'ufms', 'Câmpus': 'Cidade Universitária' });

      // Assert
      expect(item).toEqual({ nome: 'UFMS', sigla: 'UFMS', campus: 'Cidade Universitária' });
    });

    it('deve gravar a planilha numa única chamada, sem repetir a mesma escola', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: { cadastradas: 1, atualizadas: 1, ignoradas: [] }, error: null } as never);
      renderizar();
      await screen.findByText('Instituto Federal de MS');
      const csv = 'nome,sigla,campus\nInstituto Federal de MS,IFMS,Corumbá\nUCDB,ucdb,\nInstituto Federal de MS,IFMS,Corumbá\n,X,\n';

      // Act
      await user.upload(screen.getByLabelText('Arquivo de instituições (.xlsx ou .csv)'), new File([csv], 'inst.csv', { type: 'text/csv' }));

      // Assert
      await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
      expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_instituicoes', {
        p_id_evento: ID_EVENTO,
        p_itens: [
          { nome: 'Instituto Federal de MS', sigla: 'IFMS', campus: 'Corumbá' },
          { nome: 'UCDB', sigla: 'UCDB', campus: '' },
        ],
      });
      expect(chamadasDe('instituicoes', 'upsert')).toHaveLength(0);
      const log = await screen.findByRole('list', { name: 'Resultado da importação' });
      expect(within(log).getByText(/Linha 5: nome da instituição não encontrado/)).toBeInTheDocument();
      expect(within(log).getByText(/1 cadastrada\(s\), 1 já existente\(s\) atualizada\(s\)/)).toBeInTheDocument();
    });
  });
});
