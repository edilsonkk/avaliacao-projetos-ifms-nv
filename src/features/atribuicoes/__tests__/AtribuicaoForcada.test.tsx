import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtribuicaoForcada } from '@/features/atribuicoes';
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
/** Linhas de fn_projetos_situacao: cota e vagas contadas no banco, não no navegador. */
let situacao: unknown[] = [];
/** Resposta das demais RPCs (atribuir banca, enfileirar). */
let respostaRpc: unknown = { data: 1, error: null };

const linhaSituacao = (id: string, over: Record<string, unknown> = {}) => ({
  id_projeto: id,
  cota: 3,
  avaliacoes_tecnicas: 0,
  travas_tecnicas: 0,
  vagas_restantes: 3,
  ...over,
});

const mockarRpc = () => {
  vi.mocked(supabase.rpc).mockImplementation(((nome: string) =>
    Promise.resolve(nome === 'fn_projetos_situacao' ? { data: situacao, error: null } : respostaRpc)) as never);
};

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    const chain: any = {};
    ['select', 'eq', 'gt', 'order', 'insert', 'update', 'delete', 'maybeSingle'].forEach((metodo) => {
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

const projeto = (id: string, codigo: string, extra: Record<string, unknown> = {}) => ({
  id_projeto: id,
  codigo_projeto: codigo,
  titulo: `Projeto ${codigo}`,
  estande: 'E-1',
  is_check_in_realizado: true,
  is_fora_da_competicao: false,
  id_instituicao: null,
  id_modalidade: null,
  ...extra,
});

const avaliador = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id_usuario: id,
  id_evento: ID_EVENTO,
  is_credenciado: true,
  id_instituicao: null,
  instituicoes: null,
  usuarios: { nome, email: `${id}@ifms.edu.br`, papel: 'AVALIADOR' },
  ...extra,
});

const renderizar = () =>
  render(<AtribuicaoForcada isOpen aoFechar={vi.fn()} id_evento_ativo={ID_EVENTO} cota_padrao_evento={3} />);

describe('AtribuicaoForcada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    dados = {
      projetos: [
        projeto('p-1', 'PROJ-ELEGIVEL'),
        projeto('p-2', 'PROJ-LOTADO'),
        projeto('p-3', 'PROJ-ESCOLA-A', { id_instituicao: 'inst-a' }),
      ],
      avaliadores_evento: [
        avaliador('u-1', 'Dra. Ana Credenciada'),
        avaliador('u-2', 'Dr. Bruno Sem Credencial', { is_credenciado: false }),
        avaliador('u-3', 'Carla da Escola A', { id_instituicao: 'inst-a' }),
        avaliador('u-4', 'Davi Declarou Conflito'),
        // Credenciamento do Staff fica na mesma tabela: não é avaliador
        avaliador('u-5', 'Sara do Staff', { usuarios: { nome: 'Sara do Staff', email: 'u-5@ifms.edu.br', papel: 'STAFF' } }),
      ],
      avaliacoes: [
        { id_projeto: 'p-2', id_usuario: 'x1', status: 'CONCLUIDA' },
        { id_projeto: 'p-2', id_usuario: 'x2', status: 'CONCLUIDA' },
        { id_projeto: 'p-2', id_usuario: 'x3', status: 'CONCLUIDA' },
        { id_projeto: 'p-1', id_usuario: 'x1', status: 'CANCELADA' },
      ],
      questionarios: [],
      locks_ativos: [],
      historico_impedimentos: [{ id_projeto: 'p-1', id_usuario: 'u-4' }],
      avaliador_modalidades_bloqueadas: [],
    };
    // p-2 com a cota cheia pela conta do banco; a avaliação cancelada de p-1 não ocupa vaga
    situacao = [
      linhaSituacao('p-1'),
      linhaSituacao('p-2', { avaliacoes_tecnicas: 3, vagas_restantes: 0 }),
      linhaSituacao('p-3'),
    ];
    mockarBanco();
    respostaRpc = { data: 1, error: null };
    mockarRpc();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
  });

  describe('carregamento', () => {
    it('deve listar só projetos com vaga e avaliadores credenciados no evento', async () => {
      // Arrange / Act
      renderizar();

      // Assert
      expect(await screen.findByText('PROJ-ELEGIVEL')).toBeInTheDocument();
      expect(screen.queryByText('PROJ-LOTADO')).not.toBeInTheDocument();
      expect(screen.getByText(/1 com cota atingida/i)).toBeInTheDocument();
      expect(supabase.from).not.toHaveBeenCalledWith('view_avaliadores_credenciados');
    });

    it('não deve listar Staff credenciado como avaliador', async () => {
      // Arrange / Act
      renderizar();

      // Assert
      expect(await screen.findByText('Dra. Ana Credenciada')).toBeInTheDocument();
      expect(screen.queryByText('Sara do Staff')).not.toBeInTheDocument();
    });

    it('deve usar a vaga contada pelo banco, não a contagem das avaliações cruas', async () => {
      // Arrange: no navegador p-1 pareceria cheio (3 avaliações); o banco diz que há vaga,
      // porque voto popular não ocupa cota. Quem manda é fn_projetos_situacao.
      dados.avaliacoes = [
        { id_projeto: 'p-1', id_usuario: 'x1', status: 'CONCLUIDA' },
        { id_projeto: 'p-1', id_usuario: 'x2', status: 'CONCLUIDA' },
        { id_projeto: 'p-1', id_usuario: 'x3', status: 'CONCLUIDA' },
      ];
      situacao = [linhaSituacao('p-1', { avaliacoes_tecnicas: 1, vagas_restantes: 2 })];

      // Act
      renderizar();

      // Assert
      expect(await screen.findByText('PROJ-ELEGIVEL')).toBeInTheDocument();
      expect(vi.mocked(supabase.rpc).mock.calls.map((c) => c[0])).toContain('fn_projetos_situacao');
    });

    it('não deve listar votante do voto popular como avaliador da atribuição técnica', async () => {
      // Arrange
      dados.questionarios = [
        { id_questionario: 'q-vp', is_voto_popular: true },
        { id_questionario: 'q-tec', is_voto_popular: false },
      ];
      dados.avaliadores_evento = [
        avaliador('u-1', 'Dra. Ana Credenciada'),
        avaliador('u-6', 'Vera Votante', { id_questionario: 'q-vp' }),
        avaliador('u-7', 'Téo Técnico', { id_questionario: 'q-tec' }),
      ];

      // Act
      renderizar();

      // Assert
      expect(await screen.findByText('Dra. Ana Credenciada')).toBeInTheDocument();
      expect(screen.getByText('Téo Técnico')).toBeInTheDocument();
      expect(screen.queryByText('Vera Votante')).not.toBeInTheDocument();
    });

    it('sem evento ativo deve avisar e não consultar nada, nem um evento guardado no navegador', async () => {
      // Arrange
      localStorage.setItem('evento_ativo_id', 'evento-do-ano-passado');

      // Act
      render(<AtribuicaoForcada isOpen aoFechar={vi.fn()} id_evento_ativo="" cota_padrao_evento={3} />);

      // Assert
      expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
      expect(supabase.from).not.toHaveBeenCalled();
      localStorage.removeItem('evento_ativo_id');
    });

    it('deve buscar travas válidas e dados só do evento ativo', async () => {
      // Arrange / Act
      renderizar();
      await screen.findByText('PROJ-ELEGIVEL');

      // Assert
      expect(chamadasDe('locks_ativos', 'gt').map((c) => c.args[0])).toContain('expira_em');
      for (const tabela of ['locks_ativos', 'avaliacoes', 'historico_impedimentos']) {
        expect(chamadasDe(tabela, 'eq').map((c) => c.args)).toContainEqual(['projetos.id_evento', ID_EVENTO]);
      }
      expect(chamadasDe('historico_impedimentos', 'eq').map((c) => c.args)).toContainEqual(['tipo', 'conflito']);
    });

    it('não deve inventar estande nem corredor quando o projeto não tem', async () => {
      // Arrange
      dados.projetos = [projeto('p-9', 'PROJ-SEM-ESTANDE', { estande: null })];

      // Act
      renderizar();

      // Assert
      const item = await screen.findByRole('radio', { name: /PROJ-SEM-ESTANDE/ });
      expect(within(item).getByText('Estande: -')).toBeInTheDocument();
      expect(screen.queryByText(/EST-S\/N/)).not.toBeInTheDocument();
    });
  });

  describe('banca (um projeto, vários avaliadores)', () => {
    it('deve sinalizar conflito de instituição e conflito declarado pelo avaliador', async () => {
      // Arrange
      const user = userEvent.setup();
      dados.projetos = [projeto('p-1', 'PROJ-ELEGIVEL', { id_instituicao: 'inst-a' })];
      renderizar();

      // Act
      await user.click(await screen.findByRole('radio', { name: /PROJ-ELEGIVEL/ }));

      // Assert
      expect(screen.getByRole('checkbox', { name: /Carla da Escola A: Conflito: Mesma Instituição/ })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('checkbox', { name: /Davi Declarou Conflito: Declarou conflito com este projeto/ })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('checkbox', { name: 'Avaliador Dra. Ana Credenciada' })).toHaveAttribute('aria-disabled', 'false');
    });

    it('deve gravar a banca pela função do banco, nunca direto nas travas', async () => {
      // Arrange
      const user = userEvent.setup();
      const aoSucesso = vi.fn();
      render(<AtribuicaoForcada isOpen aoFechar={vi.fn()} aoSucesso={aoSucesso} id_evento_ativo={ID_EVENTO} cota_padrao_evento={3} />);
      await user.click(await screen.findByRole('radio', { name: /PROJ-ELEGIVEL/ }));

      // Act
      await user.click(screen.getByRole('checkbox', { name: 'Avaliador Dra. Ana Credenciada' }));
      await user.click(screen.getByRole('button', { name: /forçar atribuição elegível/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_atribuir_banca', { p_id_projeto: 'p-1', p_ids_usuarios: ['u-1'] });
      expect(chamadasDe('locks_ativos', 'insert')).toHaveLength(0);
      expect(await screen.findByRole('status')).toHaveTextContent(/atribuído a 1 avaliador/i);
    });

    it('deve mostrar o motivo quando o banco recusa (ex.: outra pessoa pegou a última vaga)', async () => {
      // Arrange
      const user = userEvent.setup();
      respostaRpc = {
        data: null,
        error: { code: 'P0001', message: 'O projeto PROJ-ELEGIVEL tem só 0 vaga(s) e foram escolhidos 1 avaliadores.' },
      };
      renderizar();
      await user.click(await screen.findByRole('radio', { name: /PROJ-ELEGIVEL/ }));
      await user.click(screen.getByRole('checkbox', { name: 'Avaliador Dra. Ana Credenciada' }));

      // Act
      await user.click(screen.getByRole('button', { name: /forçar atribuição elegível/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('tem só 0 vaga(s)');
    });

    it('deve permitir selecionar pelo teclado', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      const item = await screen.findByRole('radio', { name: /PROJ-ELEGIVEL/ });

      // Act
      item.focus();
      await user.keyboard('{Enter}');

      // Assert
      expect(item).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('fila (um avaliador, vários projetos)', () => {
    it('deve enfileirar pela função do banco na ordem escolhida', async () => {
      // Arrange
      const user = userEvent.setup();
      dados.projetos = [projeto('p-1', 'PROJ-A'), projeto('p-5', 'PROJ-B')];
      dados.historico_impedimentos = [];
      respostaRpc = { data: { ativado: 'p-5', enfileirados: 1 }, error: null };
      renderizar();
      await user.click(await screen.findByRole('button', { name: /enfileirar para avaliador/i }));
      await user.click(await screen.findByRole('radio', { name: /Dra. Ana Credenciada/ }));

      // Act
      await user.click(screen.getByRole('checkbox', { name: /Projeto PROJ-B/ }));
      await user.click(screen.getByRole('checkbox', { name: /Projeto PROJ-A/ }));
      await user.click(screen.getByRole('button', { name: /forçar atribuição elegível/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_enfileirar_projetos', { p_id_usuario: 'u-1', p_ids_projetos: ['p-5', 'p-1'] });
      expect(chamadasDe('fila_atribuicoes_direcionadas', 'insert')).toHaveLength(0);
      expect(await screen.findByRole('status')).toHaveTextContent('1º projeto já está com Dra. Ana Credenciada e 1 entraram na fila.');
    });

    it('não deve mostrar sucesso quando o banco recusa a fila', async () => {
      // Arrange
      const user = userEvent.setup();
      respostaRpc = {
        data: null,
        error: { code: 'P0001', message: 'Projeto PROJ-ELEGIVEL: Avaliador declarou conflito com este projeto.' },
      };
      renderizar();
      await user.click(await screen.findByRole('button', { name: /enfileirar para avaliador/i }));
      await user.click(await screen.findByRole('radio', { name: /Dra. Ana Credenciada/ }));
      await user.click(screen.getByRole('checkbox', { name: /Projeto PROJ-ELEGIVEL/ }));

      // Act
      await user.click(screen.getByRole('button', { name: /forçar atribuição elegível/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('declarou conflito');
      expect(screen.queryByText(/entraram na fila|enfileirados com sucesso/i)).not.toBeInTheDocument();
    });
  });
});
