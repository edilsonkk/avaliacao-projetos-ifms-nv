import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GestorAvaliadores } from '@/features/avaliadores';
import { supabase } from '@/lib/supabase';
import { baixarPlanilhaModelo } from '@/lib/excel/excelUtils';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getSession: vi.fn() },
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));
vi.mock('@/lib/excel/excelUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/excel/excelUtils')>()),
  baixarPlanilhaModelo: vi.fn(),
}));

const ID_EVENTO = 'evt-1';

const vinculo = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id_usuario: id,
  is_credenciado: false,
  id_instituicao: null,
  usuarios: { nome, email: `${id}@ifms.edu.br`, papel: 'AVALIADOR' },
  ...extra,
});

type Chamada = { tabela: string; metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let dados: Record<string, unknown[]> = {};
let paginasVinculos: unknown[][] | null = null;
let erroUpdate: { code: string; message: string } | null = null;

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    let pagina = 0;
    let operacao = 'select';
    const chain: any = {};
    ['select', 'eq', 'order', 'insert', 'update', 'delete', 'upsert', 'single', 'in'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        if (['insert', 'update', 'delete', 'upsert'].includes(metodo)) operacao = metodo;
        return chain;
      });
    });
    chain.range = vi.fn((inicio: number) => {
      pagina = inicio / 1000;
      return chain;
    });
    chain.then = (resolve: any, reject: any) => {
      if (operacao === 'update') return Promise.resolve({ data: null, error: erroUpdate }).then(resolve, reject);
      const data =
        tabela === 'avaliadores_evento' && paginasVinculos ? paginasVinculos[pagina] ?? [] : pagina > 0 ? [] : dados[tabela] ?? [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return chain;
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);
const linhaDe = (nome: string) => screen.getByText(nome).closest('tr')!;

const renderizar = (props: Partial<React.ComponentProps<typeof GestorAvaliadores>> = {}) =>
  render(<GestorAvaliadores id_evento_ativo={ID_EVENTO} ao_fechar={vi.fn()} {...props} />);

describe('GestorAvaliadores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    chamadas = [];
    paginasVinculos = null;
    erroUpdate = null;
    dados = {
      instituicoes: [{ id_instituicao: 'inst-1', nome_exibicao: 'IFMS', sigla: 'IFMS-CG' }],
      modalidades: [{ id_modalidade: 'mod-1', nome_modalidade: 'Ensino Médio' }],
      areas_tematicas: [{ id_area: 'area-1', nome_area: 'EXATAS' }],
      avaliadores_evento: [
        vinculo('u-ana', 'Ana Credenciada', { is_credenciado: true, id_instituicao: 'inst-1' }),
        vinculo('u-bruno', 'Bruno Pendente'),
        { id_usuario: 'u-staff', is_credenciado: true, id_instituicao: null, usuarios: { nome: 'Sara Staff', email: 's@x', papel: 'STAFF' } },
      ],
      avaliador_modalidades_bloqueadas: [{ id_usuario: 'u-bruno', id_modalidade: 'mod-1' }],
      avaliador_areas: [{ id_usuario: 'u-ana', id_area: 'area-1' }],
      instituicao_aliases: [],
      modalidade_aliases: [],
    };
    mockarBanco();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { sucesso: true }, error: null } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
  });

  describe('carregamento', () => {
    it('deve listar só os avaliadores inscritos no evento ativo', async () => {
      // Arrange / Act
      renderizar();

      // Assert
      expect(await screen.findByText('Ana Credenciada')).toBeInTheDocument();
      expect(screen.queryByText('Sara Staff')).not.toBeInTheDocument();
      expect(chamadasDe('avaliadores_evento', 'eq').map((c) => c.args)).toContainEqual(['id_evento', ID_EVENTO]);
      expect(supabase.from).not.toHaveBeenCalledWith('usuarios');
      expect(screen.getByText(/avaliadores no evento/)).toHaveTextContent('Total: 2 avaliadores no evento (1 credenciados)');
    });

    it('deve mostrar instituição, bloqueios e áreas de cada avaliador', async () => {
      // Arrange / Act
      renderizar();
      await screen.findByText('Ana Credenciada');

      // Assert
      expect(within(linhaDe('Ana Credenciada')).getByText('IFMS (IFMS-CG)')).toBeInTheDocument();
      expect(within(linhaDe('Ana Credenciada')).getByText('EXATAS')).toBeInTheDocument();
      expect(within(linhaDe('Bruno Pendente')).getByRole('button', { name: 'Liberar Ensino Médio para Bruno Pendente' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(linhaDe('Bruno Pendente')).getByText('Geral (todas as áreas)')).toBeInTheDocument();
    });

    it('deve trazer todos os avaliadores mesmo acima de 1000 (paginado)', async () => {
      // Arrange
      paginasVinculos = [
        Array.from({ length: 1000 }, (_, i) => vinculo(`u-${i}`, `Avaliador ${i}`)),
        [vinculo('u-ultimo', 'Último Avaliador')],
      ];

      // Act
      renderizar();

      // Assert
      expect(await screen.findByText('Último Avaliador', {}, { timeout: 20000 })).toBeInTheDocument();
      expect(screen.getByText(/avaliadores no evento/)).toHaveTextContent('1001');
    }, 30000);

    it('deve mostrar o credenciamento do banco, ignorando o que ficou salvo no navegador', async () => {
      // Arrange: versão antiga guardava o status no localStorage e ele vencia o banco
      localStorage.setItem('avaliadores_credenciados_local', JSON.stringify({ 'u-bruno': true }));

      // Act
      renderizar();
      await screen.findByText('Bruno Pendente');

      // Assert
      expect(within(linhaDe('Bruno Pendente')).getByText('Pendente')).toBeInTheDocument();
      expect(localStorage.getItem('avaliadores_credenciados_local')).toBeNull();
    });

    it('deve ordenar pelo teclado', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Ana Credenciada');

      // Act
      screen.getByRole('button', { name: /^nome/i }).focus();
      await user.keyboard('{Enter}');

      // Assert
      expect(screen.getByRole('columnheader', { name: /^nome/i })).toHaveAttribute('aria-sort', 'descending');
      expect(within(screen.getAllByRole('row')[1]).getByText('Bruno Pendente')).toBeInTheDocument();
    });

    it('deve avisar e bloquear o cadastro quando não há evento ativo', async () => {
      // Arrange / Act
      renderizar({ id_evento_ativo: '' });

      // Assert
      expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /novo avaliador/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /importar/i })).toBeDisabled();
    });
  });

  describe('credenciamento', () => {
    it('deve credenciar no evento ativo', async () => {
      // Arrange
      const user = userEvent.setup();
      const aoAtualizarMetricas = vi.fn();
      renderizar({ aoAtualizarMetricas });
      await screen.findByText('Bruno Pendente');

      // Act
      await user.click(screen.getByRole('button', { name: 'Credenciar Bruno Pendente' }));

      // Assert
      expect(chamadasDe('avaliadores_evento', 'update')[0].args[0]).toEqual({ is_credenciado: true });
      expect(chamadasDe('avaliadores_evento', 'eq').map((c) => c.args)).toContainEqual(['id_usuario', 'u-bruno']);
      expect(await screen.findByRole('button', { name: 'Descredenciar Bruno Pendente' })).toBeInTheDocument();
      expect(aoAtualizarMetricas).toHaveBeenCalled();
      expect(localStorage.getItem('avaliadores_credenciados_local')).toBeNull();
    });

    it('não deve mostrar sucesso quando o banco recusa', async () => {
      // Arrange
      const user = userEvent.setup();
      erroUpdate = { code: 'P0001', message: 'falha no banco' };
      renderizar();
      await screen.findByText('Bruno Pendente');

      // Act
      await user.click(screen.getByRole('button', { name: 'Credenciar Bruno Pendente' }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao credenciar Bruno Pendente: falha no banco');
      expect(within(linhaDe('Bruno Pendente')).getByText('Pendente')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('modalidades', () => {
    it('deve bloquear pela função do banco, que também tira as travas', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Ana Credenciada');

      // Act
      await user.click(screen.getByRole('button', { name: 'Bloquear Ensino Médio para Ana Credenciada' }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_bloquear_modalidade_avaliador', {
        p_id_usuario: 'u-ana',
        p_id_evento: ID_EVENTO,
        p_id_modalidade: 'mod-1',
        p_bloquear: true,
      });
      expect(chamadasDe('locks_ativos', 'delete')).toHaveLength(0);
      expect(await screen.findByRole('button', { name: 'Liberar Ensino Médio para Ana Credenciada' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('remover', () => {
    it('deve pedir confirmação e remover só do evento, sem apagar o usuário', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: { sucesso: true, cadastro_apagado: false }, error: null } as never);
      renderizar();
      await screen.findByText('Bruno Pendente');

      // Act
      await user.click(screen.getByRole('button', { name: 'Remover Bruno Pendente do evento' }));

      // Assert: nada é feito antes de confirmar
      const dialogo = screen.getByRole('alertdialog', { name: 'Remover Bruno Pendente deste evento?' });
      expect(supabase.rpc).not.toHaveBeenCalled();

      // Act
      await user.click(within(dialogo).getByRole('button', { name: /remover do evento/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_remover_avaliador_evento', { p_id_usuario: 'u-bruno', p_id_evento: ID_EVENTO });
      expect(chamadasDe('usuarios', 'delete')).toHaveLength(0);
      await waitFor(() => expect(screen.queryByText('Bruno Pendente')).not.toBeInTheDocument());
      expect(screen.getByRole('status')).toHaveTextContent('Bruno Pendente foi removido deste evento.');
    });

    it('deve explicar quando o avaliador já tem notas e mantê-lo na lista', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'Este avaliador já tem 2 avaliação(ões) neste evento. Para ele não avaliar mais, use Descredenciar; as notas continuam valendo.' },
      } as never);
      renderizar();
      await screen.findByText('Ana Credenciada');

      // Act
      await user.click(screen.getByRole('button', { name: 'Remover Ana Credenciada do evento' }));
      await user.click(screen.getByRole('button', { name: /remover do evento/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('use Descredenciar');
      expect(screen.getByText('Ana Credenciada')).toBeInTheDocument();
    });
  });

  describe('cadastro', () => {
    it('deve cadastrar pela função do banco, no evento ativo', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: { cadastrados: 1, atualizados: 0, ignorados: [] }, error: null } as never);
      renderizar();
      await screen.findByText('Ana Credenciada');
      await user.click(screen.getByRole('button', { name: /novo avaliador/i }));

      // Act
      await user.type(screen.getByRole('textbox', { name: 'Nome do avaliador' }), 'Carla Nova');
      await user.type(screen.getByRole('textbox', { name: 'E-mail do avaliador' }), 'Carla@IFMS.edu.br');
      await user.click(within(screen.getByRole('group', { name: 'Áreas de avaliação' })).getByRole('checkbox', { name: 'EXATAS' }));
      await user.click(screen.getByRole('button', { name: /cadastrar avaliador/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_avaliadores', {
        p_id_evento: ID_EVENTO,
        p_itens: [{ nome: 'Carla Nova', email: 'carla@ifms.edu.br', id_instituicao: null, ids_modalidades_bloqueadas: [], ids_areas: ['area-1'] }],
      });
      expect(chamadasDe('usuarios', 'insert')).toHaveLength(0);
      expect(await screen.findByRole('status')).toHaveTextContent('Avaliador cadastrado com sucesso!');
    });

    it('não deve rebaixar Admin/Staff: mostra o motivo e não dá sucesso', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { cadastrados: 0, atualizados: 0, ignorados: [{ email: 'admin@ifms.edu.br', motivo: 'O e-mail pertence a um usuário ADMIN; ele não foi alterado.' }] },
        error: null,
      } as never);
      renderizar();
      await screen.findByText('Ana Credenciada');
      await user.click(screen.getByRole('button', { name: /novo avaliador/i }));

      // Act
      await user.type(screen.getByRole('textbox', { name: 'Nome do avaliador' }), 'Tentativa');
      await user.type(screen.getByRole('textbox', { name: 'E-mail do avaliador' }), 'admin@ifms.edu.br');
      await user.click(screen.getByRole('button', { name: /cadastrar avaliador/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('pertence a um usuário ADMIN');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('edição', () => {
    it('deve salvar tudo de uma vez pela função do banco', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Bruno Pendente');
      await user.click(screen.getByRole('button', { name: 'Editar Bruno Pendente' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar Avaliador' });

      // Act
      await user.selectOptions(within(dialogo).getByLabelText('Instituição de origem'), 'inst-1');
      await user.click(within(dialogo).getByRole('checkbox', { name: 'Ensino Médio' }));
      await user.click(within(dialogo).getByRole('button', { name: /salvar alterações/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_atualizar_avaliador', {
        p_id_usuario: 'u-bruno',
        p_id_evento: ID_EVENTO,
        p_nome: 'Bruno Pendente',
        p_email: 'u-bruno@ifms.edu.br',
        p_id_instituicao: 'inst-1',
        p_ids_modalidades_bloqueadas: [],
        p_ids_areas: [],
      });
      expect(chamadasDe('avaliador_modalidades_bloqueadas', 'delete')).toHaveLength(0);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('deve manter o formulário aberto e mostrar o erro do banco', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Já existe outro usuário com o e-mail x@y.z.' } } as never);
      renderizar();
      await screen.findByText('Bruno Pendente');
      await user.click(screen.getByRole('button', { name: 'Editar Bruno Pendente' }));

      // Act
      await user.click(screen.getByRole('button', { name: /salvar alterações/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('Já existe outro usuário com o e-mail x@y.z.');
      expect(screen.getByRole('dialog', { name: 'Editar Avaliador' })).toBeInTheDocument();
    });
  });

  describe('importação', () => {
    it('deve baixar o modelo com as colunas de instituição, modalidades e áreas', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Ana Credenciada');

      // Act
      await user.click(screen.getByRole('button', { name: /baixar modelo/i }));

      // Assert
      expect(baixarPlanilhaModelo).toHaveBeenCalledWith(
        'modelo_importacao_avaliadores.xlsx',
        'Avaliadores',
        ['nome', 'email', 'instituicao', 'sigla_instituicao', 'modalidades_bloqueadas', 'areas'],
        expect.arrayContaining([expect.objectContaining({ areas: expect.any(String) })])
      );
    });

    it('deve gravar a planilha numa única chamada e listar quem foi ignorado', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { cadastrados: 1, atualizados: 0, ignorados: [{ email: 'staff@ifms.edu.br', motivo: 'O e-mail pertence a um usuário STAFF; ele não foi alterado.' }] },
        error: null,
      } as never);
      renderizar();
      await screen.findByText('Ana Credenciada');
      const csv = 'nome,email,instituicao\nDiego Novo,Diego@IFMS.edu.br,IFMS\nStaff,staff@ifms.edu.br,IFMS\n';
      const arquivo = new File([csv], 'avaliadores.csv', { type: 'text/csv' });

      // Act
      await user.upload(screen.getByLabelText('Arquivo de avaliadores (.xlsx ou .csv)'), arquivo);

      // Assert
      await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
      const [funcao, args] = vi.mocked(supabase.rpc).mock.calls[0] as [string, { p_itens: { email: string; id_instituicao: string }[] }];
      expect(funcao).toBe('admin_salvar_avaliadores');
      expect(args.p_itens.map((i) => i.email)).toEqual(['diego@ifms.edu.br', 'staff@ifms.edu.br']);
      expect(args.p_itens[0].id_instituicao).toBe('inst-1');
      expect(chamadasDe('usuarios', 'upsert')).toHaveLength(0);
      const log = await screen.findByRole('list', { name: 'Resultado da importação' });
      expect(within(log).getByText(/staff@ifms\.edu\.br: O e-mail pertence a um usuário STAFF/)).toBeInTheDocument();
      expect(within(log).getByText(/1 cadastrado\(s\), 0 já existente\(s\) atualizado\(s\), 1 ignorado\(s\)/)).toBeInTheDocument();
    });
  });
});
