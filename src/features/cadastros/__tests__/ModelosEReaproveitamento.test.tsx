import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GestorQuestionarios } from '@/features/cadastros';
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
const MODELO_IDEIA = 'modelo-1';
const MODELO_PROTOTIPO = 'modelo-2';

let questionariosDoEvento: unknown[] = [];
let respostasRpc: Record<string, { data: unknown; error: unknown }> = {};

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    const chain: any = {};
    ['select', 'eq', 'order'].forEach((metodo) => {
      chain[metodo] = vi.fn(() => chain);
    });
    const dados =
      tabela === 'modelos_questionario'
        ? [
            { id_modelo: MODELO_IDEIA, titulo: 'Técnico · Nível 1 Ideia', descricao: 'Núcleo comum e nível Ideia.', escala_minima: 1, escala_maxima: 5, perguntas_modelo_questionario: [{ count: 10 }] },
            { id_modelo: MODELO_PROTOTIPO, titulo: 'Técnico · Nível 2 Protótipo', descricao: null, escala_minima: 1, escala_maxima: 5, perguntas_modelo_questionario: [{ count: 10 }] },
          ]
        : tabela === 'questionarios'
          ? questionariosDoEvento
          : tabela === 'perguntas_modelo_questionario'
            ? [
                { ordem: 1, texto_pergunta: 'Problema e Público-Alvo', descricao_lembrete: 'Relevância do problema.', peso_calculo: 1, peso_desempate: 1 },
                { ordem: 2, texto_pergunta: 'Coerência da Solução', descricao_lembrete: null, peso_calculo: 2, peso_desempate: 0 },
              ]
            : [];
    chain.then = (resolve: any, reject: any) => Promise.resolve({ data: dados, error: null }).then(resolve, reject);
    return chain;
  }) as never);
  vi.mocked(supabase.rpc).mockImplementation(((nome: string) =>
    Promise.resolve(respostasRpc[nome] ?? { data: null, error: null })) as never);
};

const renderizar = () => render(<GestorQuestionarios id_evento_ativo={ID_EVENTO} />);

describe('Questionários prontos e reaproveitamento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    questionariosDoEvento = [
      { id_questionario: 'q-ideia', titulo: 'Técnico · Nível 1 Ideia', escala_minima: 1, escala_maxima: 5, id_origem: MODELO_IDEIA, perguntas_questionario: [{ count: 10 }] },
    ];
    respostasRpc = {};
    mockarBanco();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
  });

  it('mostra os questionários prontos com o interruptor ligado só nos já ativos no evento', async () => {
    // Arrange / Act
    renderizar();

    // Assert
    const ideia = await screen.findByRole('switch', { name: 'Ativo neste evento: Técnico · Nível 1 Ideia' });
    expect(ideia).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Ativo neste evento: Técnico · Nível 2 Protótipo' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByText('10 perguntas · escala 1–5')).toHaveLength(2);
  });

  it('marcar ativo copia o modelo para o evento pela função do banco e recarrega a lista', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    const prototipo = await screen.findByRole('switch', { name: 'Ativo neste evento: Técnico · Nível 2 Protótipo' });
    questionariosDoEvento = [
      ...questionariosDoEvento,
      { id_questionario: 'q-prot', titulo: 'Técnico · Nível 2 Protótipo', escala_minima: 1, escala_maxima: 5, id_origem: MODELO_PROTOTIPO, perguntas_questionario: [{ count: 10 }] },
    ];

    // Act
    await user.click(prototipo);

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_copiar_questionario', { p_id_origem: MODELO_PROTOTIPO, p_id_evento: ID_EVENTO });
    expect(await screen.findByRole('switch', { name: 'Ativo neste evento: Técnico · Nível 2 Protótipo', checked: true })).toBeInTheDocument();
  });

  it('desmarcar pede confirmação e mostra a recusa do banco quando a cópia já foi usada', async () => {
    // Arrange
    const user = userEvent.setup();
    respostasRpc.admin_excluir_questionario = {
      data: null,
      error: { code: 'P0001', message: 'Este questionário já foi usado em 2 avaliação(ões) e não pode ser excluído.' },
    };
    renderizar();

    // Act
    await user.click(await screen.findByRole('switch', { name: 'Ativo neste evento: Técnico · Nível 1 Ideia' }));
    const dialogo = screen.getByRole('alertdialog');
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_excluir_questionario', expect.anything());
    await user.click(within(dialogo).getByRole('button', { name: 'Excluir' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_excluir_questionario', { p_id_questionario: 'q-ideia' });
    expect(await screen.findByRole('alert')).toHaveTextContent('não pode ser excluído');
    expect(screen.getByRole('switch', { name: 'Ativo neste evento: Técnico · Nível 1 Ideia' })).toHaveAttribute('aria-checked', 'true');
  });

  it('reaproveita um questionário de evento anterior e marca "Já está neste evento"', async () => {
    // Arrange
    const user = userEvent.setup();
    respostasRpc.admin_listar_questionarios_reaproveitaveis = {
      data: [
        { id_questionario: 'q-2025', titulo: 'Critérios 2025', nome_evento: 'Feira 2025', data_evento: '2025-10-30', total_perguntas: 8, total_avaliacoes: 120, ja_no_evento: false },
        { id_questionario: 'q-ideia-2025', titulo: 'Ideia 2025', nome_evento: 'Feira 2025', data_evento: '2025-10-30', total_perguntas: 10, total_avaliacoes: 40, ja_no_evento: true },
      ],
      error: null,
    };
    renderizar();
    await screen.findByRole('switch', { name: 'Ativo neste evento: Técnico · Nível 1 Ideia' });

    // Act
    await user.click(screen.getByRole('button', { name: 'Reaproveitar de eventos anteriores' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Reaproveitar questionário de evento anterior' });
    const grupo = await within(dialogo).findByRole('region', { name: 'Feira 2025 (30/10/2025)' });
    expect(within(grupo).getByText('8 pergunta(s) · usado em 120 avaliação(ões)')).toBeInTheDocument();
    expect(within(grupo).queryByRole('button', { name: 'Copiar Ideia 2025 para este evento' })).not.toBeInTheDocument();
    await user.click(within(grupo).getByRole('button', { name: 'Copiar Critérios 2025 para este evento' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_listar_questionarios_reaproveitaveis', { p_id_evento: ID_EVENTO });
    expect(supabase.rpc).toHaveBeenCalledWith('admin_copiar_questionario', { p_id_origem: 'q-2025', p_id_evento: ID_EVENTO });
    expect(within(grupo).getAllByText('Já está neste evento')).toHaveLength(2);
  });

  it('avisa quando não há questionários em eventos anteriores', async () => {
    // Arrange
    const user = userEvent.setup();
    respostasRpc.admin_listar_questionarios_reaproveitaveis = { data: [], error: null };
    renderizar();
    await screen.findByRole('switch', { name: 'Ativo neste evento: Técnico · Nível 1 Ideia' });

    // Act
    await user.click(screen.getByRole('button', { name: 'Reaproveitar de eventos anteriores' }));

    // Assert
    expect(await screen.findByText('Nenhum questionário em eventos anteriores.')).toBeInTheDocument();
  });

  it('o lápis carrega o modelo no formulário abaixo e salvar grava o modelo, avisando que a cópia ativa foi atualizada', async () => {
    // Arrange
    const user = userEvent.setup();
    respostasRpc.admin_salvar_modelo_questionario = { data: { id_modelo: MODELO_IDEIA, copia: 'atualizada', usos: 0 }, error: null };
    renderizar();

    // Act
    await user.click(await screen.findByRole('button', { name: 'Editar modelo Técnico · Nível 1 Ideia' }));
    const formulario = await screen.findByRole('form', { name: 'Editar modelo' });
    expect(within(formulario).getByText(/Editando o modelo "Técnico · Nível 1 Ideia"/)).toBeInTheDocument();
    expect(within(formulario).getByLabelText('Descrição do modelo (opcional)')).toHaveValue('Núcleo comum e nível Ideia.');
    expect(within(formulario).getByLabelText('Texto da pergunta 2')).toHaveValue('Coerência da Solução');
    await user.clear(within(formulario).getByLabelText('Título'));
    await user.type(within(formulario).getByLabelText('Título'), 'Ideia revisada');
    await user.click(within(formulario).getByRole('button', { name: 'Salvar Modelo' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_modelo_questionario', {
      p_id_modelo: MODELO_IDEIA,
      p_titulo: 'Ideia revisada',
      p_descricao: 'Núcleo comum e nível Ideia.',
      p_escala_minima: 1,
      p_escala_maxima: 5,
      p_perguntas: [
        { texto_pergunta: 'Problema e Público-Alvo', descricao_lembrete: 'Relevância do problema.', peso_calculo: 1, peso_desempate: 1 },
        { texto_pergunta: 'Coerência da Solução', descricao_lembrete: '', peso_calculo: 2, peso_desempate: 0 },
      ],
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_salvar_questionario', expect.anything());
    expect(await screen.findByRole('status')).toHaveTextContent('A cópia ativa neste evento também foi atualizada.');
    expect(screen.getByRole('form', { name: 'Novo questionário' })).toBeInTheDocument();
  });

  it('avisa quando a cópia do evento já foi usada e por isso não mudou', async () => {
    // Arrange
    const user = userEvent.setup();
    respostasRpc.admin_salvar_modelo_questionario = { data: { id_modelo: MODELO_IDEIA, copia: 'em_uso', usos: 4 }, error: null };
    renderizar();

    // Act
    await user.click(await screen.findByRole('button', { name: 'Editar modelo Técnico · Nível 1 Ideia' }));
    await user.click(await screen.findByRole('button', { name: 'Salvar Modelo' }));

    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent('já foi usada em 4 avaliação(ões) e não foi alterada');
  });

  it('"Novo modelo" abre o formulário em branco na escala 1 a 5 e cria pela função de modelos', async () => {
    // Arrange
    const user = userEvent.setup();
    respostasRpc.admin_salvar_modelo_questionario = { data: { id_modelo: 'novo', copia: 'sem_copia', usos: 0 }, error: null };
    renderizar();

    // Act
    await user.click(await screen.findByRole('button', { name: 'Novo modelo' }));
    const formulario = screen.getByRole('form', { name: 'Novo modelo' });
    await user.type(within(formulario).getByLabelText('Título'), 'Banca externa');
    await user.type(within(formulario).getByLabelText('Texto da pergunta 1'), 'Impacto');
    await user.click(within(formulario).getByRole('button', { name: 'Salvar Modelo' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith(
      'admin_salvar_modelo_questionario',
      expect.objectContaining({ p_id_modelo: null, p_titulo: 'Banca externa', p_escala_minima: 1, p_escala_maxima: 5 })
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Modelo "Banca externa" criado com 1 pergunta(s).');
  });

  it('cancelar a edição do modelo volta ao formulário de questionário do evento', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    await user.click(await screen.findByRole('button', { name: 'Editar modelo Técnico · Nível 1 Ideia' }));
    await screen.findByRole('form', { name: 'Editar modelo' });

    // Act
    await user.click(screen.getByRole('button', { name: 'Cancelar Edição' }));

    // Assert
    expect(screen.getByRole('form', { name: 'Novo questionário' })).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveValue('');
  });

  it('excluir modelo pede confirmação e chama a função do banco', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();

    // Act
    await user.click(await screen.findByRole('button', { name: 'Excluir modelo Técnico · Nível 2 Protótipo' }));
    const dialogo = screen.getByRole('alertdialog', { name: 'Excluir o modelo "Técnico · Nível 2 Protótipo"?' });
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_excluir_modelo_questionario', expect.anything());
    await user.click(within(dialogo).getByRole('button', { name: 'Excluir modelo' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_excluir_modelo_questionario', { p_id_modelo: MODELO_PROTOTIPO });
    expect(await screen.findByRole('status')).toHaveTextContent('Modelo "Técnico · Nível 2 Protótipo" excluído.');
  });

  it('"Restaurar originais" pede confirmação e chama a função do banco', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();

    // Act
    await user.click(await screen.findByRole('button', { name: 'Restaurar originais' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Restaurar os modelos originais?' })).getByRole('button', { name: 'Restaurar' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_restaurar_modelos_originais');
    expect(await screen.findByRole('status')).toHaveTextContent('Modelos originais restaurados.');
  });

  it('"Salvar como modelo" transforma um questionário do evento em modelo', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();

    // Act
    await user.click(await screen.findByRole('button', { name: 'Salvar Técnico · Nível 1 Ideia como modelo' }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_questionario_como_modelo', { p_id_questionario: 'q-ideia' });
    expect(await screen.findByRole('status')).toHaveTextContent('agora também é um questionário pronto');
  });
});
