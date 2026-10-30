import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GestorQuestionarios, extrairLinhaPergunta } from '@/features/cadastros/components/GestorQuestionarios';
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
let usos = 0;
let respostaSalvar: { data: unknown; error: unknown } = { data: 'q-novo', error: null };

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    const chain: any = {};
    ['select', 'eq', 'order', 'insert', 'update', 'delete'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return chain;
      });
    });
    chain.then = (resolve: any, reject: any) => Promise.resolve({ data: dados[tabela] ?? [], error: null }).then(resolve, reject);
    return chain;
  }) as never);
  vi.mocked(supabase.rpc).mockImplementation(((nome: string) => {
    if (nome === 'fn_avaliacoes_do_questionario') return Promise.resolve({ data: usos, error: null });
    return Promise.resolve(respostaSalvar);
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);

const renderizar = (props: Partial<React.ComponentProps<typeof GestorQuestionarios>> = {}) =>
  render(<GestorQuestionarios id_evento_ativo={ID_EVENTO} {...props} />);

describe('GestorQuestionarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    usos = 0;
    respostaSalvar = { data: 'q-novo', error: null };
    dados = {
      questionarios: [
        { id_questionario: 'q-1', titulo: 'Pesquisa Aplicada', escala_minima: 0, escala_maxima: 10, perguntas_questionario: [{ count: 2 }] },
      ],
      perguntas_questionario: [
        { id_pergunta: 'pg-1', ordem: 1, texto_pergunta: 'Método', descricao_lembrete: 'Considere hipóteses', peso_calculo: 1, peso_desempate: 1 },
        { id_pergunta: 'pg-2', ordem: 2, texto_pergunta: 'Inovação', descricao_lembrete: null, peso_calculo: 1, peso_desempate: 2 },
      ],
    };
    mockarBanco();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
  });

  it('deve listar os questionários do evento com o título real, sem mostrar códigos internos', async () => {
    // Arrange / Act
    renderizar();

    // Assert
    expect(await screen.findByText('Pesquisa Aplicada')).toBeInTheDocument();
    expect(screen.getByText('Notas de 0 a 10 · 2 pergunta(s)')).toBeInTheDocument();
    expect(screen.queryByText('q-1')).not.toBeInTheDocument();
    expect(chamadasDe('questionarios', 'eq').map((c) => c.args)).toContainEqual(['id_evento', ID_EVENTO]);
  });

  it('deve criar pela função do banco, com título, escala e perguntas', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    await screen.findByText('Pesquisa Aplicada');

    // Act
    await user.type(screen.getByLabelText('Título'), 'Feira 2026');
    await user.type(screen.getByLabelText('Texto da pergunta 1'), 'Método científico');
    await user.type(screen.getByLabelText('Texto de ajuda da pergunta 1 (opcional)'), 'Considere hipóteses');
    await user.click(screen.getByRole('button', { name: /adicionar pergunta/i }));
    await user.type(screen.getByLabelText('Texto da pergunta 2'), 'Inovação');
    await user.click(screen.getByRole('button', { name: 'Salvar Questionário' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_questionario', {
      p_id_questionario: null,
      p_id_evento: ID_EVENTO,
      p_titulo: 'Feira 2026',
      p_escala_minima: 0,
      p_escala_maxima: 10,
      p_perguntas: [
        { id_pergunta: null, texto_pergunta: 'Método científico', descricao_lembrete: 'Considere hipóteses', peso_calculo: 1, peso_desempate: 1 },
        { id_pergunta: null, texto_pergunta: 'Inovação', descricao_lembrete: '', peso_calculo: 1, peso_desempate: 2 },
      ],
    });
    expect(chamadasDe('questionarios', 'insert')).toHaveLength(0);
    expect(chamadasDe('perguntas_questionario', 'insert')).toHaveLength(0);
    expect(await screen.findByRole('status')).toHaveTextContent('Questionário "Feira 2026" cadastrado com 2 pergunta(s).');
  });

  it('deve mostrar o erro do banco e não limpar o formulário', async () => {
    // Arrange
    const user = userEvent.setup();
    respostaSalvar = { data: null, error: { code: 'P0001', message: 'Escala inválida: a mínima precisa ser menor que a máxima (entre 0 e 100).' } };
    renderizar();
    await screen.findByText('Pesquisa Aplicada');
    await user.type(screen.getByLabelText('Título'), 'Feira');
    await user.type(screen.getByLabelText('Texto da pergunta 1'), 'Método');

    // Act
    await user.click(screen.getByRole('button', { name: 'Salvar Questionário' }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Escala inválida');
    expect(screen.getByLabelText('Título')).toHaveValue('Feira');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('deve recusar escala mínima maior ou igual à máxima antes de enviar', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    await screen.findByText('Pesquisa Aplicada');
    await user.type(screen.getByLabelText('Título'), 'Feira');
    await user.type(screen.getByLabelText('Texto da pergunta 1'), 'Método');

    // Act
    await user.clear(screen.getByLabelText('Nota máxima'));
    await user.type(screen.getByLabelText('Nota máxima'), '0');
    await user.click(screen.getByRole('button', { name: 'Salvar Questionário' }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('A escala mínima precisa ser menor que a máxima.');
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_salvar_questionario', expect.anything());
  });

  it('deve editar mantendo o id das perguntas (nunca apaga e recria)', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    await screen.findByText('Pesquisa Aplicada');

    // Act
    await user.click(screen.getByRole('button', { name: 'Editar Pesquisa Aplicada' }));
    await screen.findByDisplayValue('Método');
    await user.click(screen.getByRole('button', { name: 'Mover pergunta 2 para cima' }));
    await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }));

    // Assert
    const chamada = vi.mocked(supabase.rpc).mock.calls.find((c) => c[0] === 'admin_salvar_questionario')!;
    expect(chamada[1]).toMatchObject({ p_id_questionario: 'q-1', p_titulo: 'Pesquisa Aplicada' });
    expect((chamada[1] as any).p_perguntas.map((p: any) => p.id_pergunta)).toEqual(['pg-2', 'pg-1']);
    expect(chamadasDe('perguntas_questionario', 'delete')).toHaveLength(0);
  });

  it('deve travar perguntas e escala de questionário já usado, deixando só o título', async () => {
    // Arrange
    const user = userEvent.setup();
    usos = 3;
    renderizar();
    await screen.findByText('Pesquisa Aplicada');

    // Act
    await user.click(screen.getByRole('button', { name: 'Editar Pesquisa Aplicada' }));

    // Assert
    expect(await screen.findByText(/já foi usado em 3 avaliação/)).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toBeEnabled();
    expect(screen.getByLabelText('Texto da pergunta 1')).toBeDisabled();
    expect(screen.getByLabelText('Nota mínima')).toBeDisabled();
    expect(screen.getByRole('button', { name: /adicionar pergunta/i })).toBeDisabled();
  });

  it('deve excluir só depois de confirmar e explicar a recusa do banco', async () => {
    // Arrange
    const user = userEvent.setup();
    respostaSalvar = { data: null, error: { code: 'P0001', message: 'Este questionário já foi usado em 3 avaliação(ões) e não pode ser excluído: as notas por critério seriam apagadas.' } };
    renderizar();
    await screen.findByText('Pesquisa Aplicada');

    // Act
    await user.click(screen.getByRole('button', { name: 'Excluir Pesquisa Aplicada' }));
    const dialogo = screen.getByRole('alertdialog', { name: 'Excluir o questionário "Pesquisa Aplicada"?' });
    expect(supabase.rpc).not.toHaveBeenCalled();
    await user.click(within(dialogo).getByRole('button', { name: 'Excluir' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_excluir_questionario', { p_id_questionario: 'q-1' });
    expect(chamadasDe('perguntas_questionario', 'delete')).toHaveLength(0);
    expect(await screen.findByRole('alert')).toHaveTextContent('não pode ser excluído');
    expect(screen.getByText('Pesquisa Aplicada')).toBeInTheDocument();
  });

  it('deve avisar e impedir criar sem evento ativo', async () => {
    // Arrange / Act
    renderizar({ id_evento_ativo: '' });

    // Assert
    expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar Questionário' })).toBeDisabled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  describe('importação', () => {
    it('deve ler pergunta, ajuda e peso com variações de coluna', () => {
      // Arrange / Act
      const item = extrairLinhaPergunta({ 'Critério': ' Método ', 'Descrição': 'Ajuda', Peso: '2,5' });

      // Assert
      expect(item).toEqual({ texto_pergunta: 'Método', descricao_lembrete: 'Ajuda', peso_calculo: 2.5 });
    });

    it('deve perguntar se anexa ou começa novo quando o formulário já tem perguntas', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Pesquisa Aplicada');
      await user.type(screen.getByLabelText('Texto da pergunta 1'), 'Já digitada');
      const csv = 'pergunta,lembrete,peso\nApresentação,Clareza,1\n';

      // Act
      await user.upload(screen.getByLabelText('Arquivo de perguntas (.xlsx ou .csv)'), new File([csv], 'criterios_extra.csv', { type: 'text/csv' }));
      await user.click(await screen.findByRole('button', { name: 'Anexar ao questionário aberto' }));

      // Assert
      expect(screen.getByLabelText('Texto da pergunta 1')).toHaveValue('Já digitada');
      expect(screen.getByLabelText('Texto da pergunta 2')).toHaveValue('Apresentação');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('deve preparar um questionário novo direto quando o formulário está vazio', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Pesquisa Aplicada');
      const csv = 'pergunta\nMétodo\nInovação\n';

      // Act
      await user.upload(screen.getByLabelText('Arquivo de perguntas (.xlsx ou .csv)'), new File([csv], 'feira_2026.csv', { type: 'text/csv' }));

      // Assert
      await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('feira 2026'));
      expect(screen.getByLabelText('Texto da pergunta 2')).toHaveValue('Inovação');
    });
  });
});
