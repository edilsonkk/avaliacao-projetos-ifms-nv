import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GestorStaff, extrairLinhaStaff } from '@/features/staff/components/GestorStaff';
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
let erroUpsert: { code: string; message: string } | null = null;

const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    let operacao = 'select';
    const chain: any = {};
    ['select', 'eq', 'or', 'in', 'order', 'insert', 'update', 'delete', 'upsert'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        if (['insert', 'update', 'delete', 'upsert'].includes(metodo)) operacao = metodo;
        return chain;
      });
    });
    chain.then = (resolve: any, reject: any) => {
      if (operacao === 'upsert') return Promise.resolve({ data: null, error: erroUpsert }).then(resolve, reject);
      return Promise.resolve({ data: dados[tabela] ?? [], error: null }).then(resolve, reject);
    };
    return chain;
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);
const linhaDe = (nome: string) => screen.getByText(nome).closest('tr')!;

const renderizar = (props: Partial<React.ComponentProps<typeof GestorStaff>> = {}) =>
  render(<GestorStaff id_evento_ativo={ID_EVENTO} ao_fechar={vi.fn()} {...props} />);

describe('GestorStaff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    chamadas = [];
    erroUpsert = null;
    dados = {
      usuarios: [
        { id_usuario: 'u-lucas', nome: 'Lucas Staff', email: 'lucas@ifms.edu.br', papel: 'STAFF' },
        { id_usuario: 'u-joana', nome: 'Joana Monitora', email: 'joana@ifms.edu.br', papel: 'MONITOR' },
      ],
      avaliadores_evento: [{ id_usuario: 'u-lucas', is_credenciado: true }],
    };
    mockarBanco();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
  });

  describe('carregamento', () => {
    it('deve filtrar Staff/Monitor no banco, sem baixar todos os usuários', async () => {
      // Arrange / Act
      renderizar();

      // Assert
      expect(await screen.findByText('Lucas Staff')).toBeInTheDocument();
      expect(chamadasDe('usuarios', 'or').map((c) => c.args[0])).toEqual(['papel.ilike.staff,papel.ilike.monitor']);
      expect(chamadasDe('avaliadores_evento', 'eq').map((c) => c.args)).toContainEqual(['id_evento', ID_EVENTO]);
      expect(within(linhaDe('Lucas Staff')).getByText('Credenciado')).toBeInTheDocument();
      expect(within(linhaDe('Joana Monitora')).getByText('Pendente')).toBeInTheDocument();
    });

    it('deve ignorar o credenciamento que ficou salvo no navegador', async () => {
      // Arrange
      localStorage.setItem('staff_credenciados_local', JSON.stringify({ 'u-joana': true }));

      // Act
      renderizar();
      await screen.findByText('Joana Monitora');

      // Assert
      expect(within(linhaDe('Joana Monitora')).getByText('Pendente')).toBeInTheDocument();
      expect(localStorage.getItem('staff_credenciados_local')).toBeNull();
    });

    it('deve ordenar pelo teclado', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Lucas Staff');

      // Act
      screen.getByRole('button', { name: /^papel/i }).focus();
      await user.keyboard('{Enter}');

      // Assert
      expect(screen.getByRole('columnheader', { name: /^papel/i })).toHaveAttribute('aria-sort', 'ascending');
      expect(within(screen.getAllByRole('row')[1]).getByText('Joana Monitora')).toBeInTheDocument();
    });
  });

  describe('credenciamento', () => {
    it('deve credenciar no evento ativo', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Joana Monitora');

      // Act
      await user.click(screen.getByRole('button', { name: 'Credenciar Joana Monitora' }));

      // Assert
      expect(chamadasDe('avaliadores_evento', 'upsert')[0].args[0]).toEqual({ id_usuario: 'u-joana', id_evento: ID_EVENTO, is_credenciado: true });
      expect(await screen.findByRole('button', { name: 'Descredenciar Joana Monitora' })).toBeInTheDocument();
    });

    it('não deve mostrar sucesso quando o banco recusa', async () => {
      // Arrange
      const user = userEvent.setup();
      erroUpsert = { code: 'P0001', message: 'falha no banco' };
      renderizar();
      await screen.findByText('Joana Monitora');

      // Act
      await user.click(screen.getByRole('button', { name: 'Credenciar Joana Monitora' }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao credenciar Joana Monitora: falha no banco');
      expect(within(linhaDe('Joana Monitora')).getByText('Pendente')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('deve desabilitar o credenciamento sem evento ativo', async () => {
      // Arrange / Act
      renderizar({ id_evento_ativo: '' });

      // Assert
      expect(await screen.findByRole('button', { name: 'Credenciar Joana Monitora' })).toBeDisabled();
    });
  });

  describe('cadastro', () => {
    it('deve cadastrar pela função do banco com o papel escolhido', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: { cadastrados: 1, atualizados: 0, ignorados: [] }, error: null } as never);
      renderizar();
      await screen.findByText('Lucas Staff');
      await user.click(screen.getByRole('button', { name: /novo membro staff/i }));

      // Act
      await user.type(screen.getByRole('textbox', { name: 'Nome do membro do Staff' }), 'Rita Nova');
      await user.type(screen.getByRole('textbox', { name: 'E-mail do membro do Staff' }), 'Rita@IFMS.edu.br');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Papel' }), 'MONITOR');
      await user.click(screen.getByRole('button', { name: /cadastrar membro/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_staff', {
        p_id_evento: ID_EVENTO,
        p_itens: [{ nome: 'Rita Nova', email: 'rita@ifms.edu.br', papel: 'MONITOR' }],
      });
      expect(chamadasDe('usuarios', 'insert')).toHaveLength(0);
      expect(await screen.findByRole('status')).toHaveTextContent('Membro do Staff cadastrado.');
    });

    it('não deve transformar o Admin em Staff', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { cadastrados: 0, atualizados: 0, ignorados: [{ email: 'admin@ifms.edu.br', motivo: 'O e-mail pertence a um usuário ADMIN; ele não foi alterado.' }] },
        error: null,
      } as never);
      renderizar();
      await screen.findByText('Lucas Staff');
      await user.click(screen.getByRole('button', { name: /novo membro staff/i }));

      // Act
      await user.type(screen.getByRole('textbox', { name: 'Nome do membro do Staff' }), 'Admin');
      await user.type(screen.getByRole('textbox', { name: 'E-mail do membro do Staff' }), 'admin@ifms.edu.br');
      await user.click(screen.getByRole('button', { name: /cadastrar membro/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('pertence a um usuário ADMIN');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('edição e exclusão', () => {
    it('deve salvar a edição pela função do banco e mostrar recusa sem fechar', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Já existe outro usuário com o e-mail joana@ifms.edu.br.' } } as never);
      renderizar();
      await screen.findByText('Lucas Staff');
      await user.click(screen.getByRole('button', { name: 'Editar Lucas Staff' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar Membro do Staff' });

      // Act
      await user.clear(within(dialogo).getByLabelText('E-mail'));
      await user.type(within(dialogo).getByLabelText('E-mail'), 'joana@ifms.edu.br');
      await user.click(within(dialogo).getByRole('button', { name: /salvar alterações/i }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_atualizar_staff', { p_id_usuario: 'u-lucas', p_nome: 'Lucas Staff', p_email: 'joana@ifms.edu.br' });
      expect(await screen.findByRole('alert')).toHaveTextContent('Já existe outro usuário');
      expect(screen.getByRole('dialog', { name: 'Editar Membro do Staff' })).toBeInTheDocument();
    });

    it('deve excluir só depois de confirmar, pela função do banco', async () => {
      // Arrange
      const user = userEvent.setup();
      renderizar();
      await screen.findByText('Lucas Staff');

      // Act
      await user.click(screen.getByRole('button', { name: 'Excluir Lucas Staff' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Excluir Lucas Staff da equipe?' });
      expect(supabase.rpc).not.toHaveBeenCalled();
      await user.click(within(dialogo).getByRole('button', { name: 'Excluir' }));

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('admin_excluir_staff', { p_id_usuario: 'u-lucas' });
      expect(chamadasDe('usuarios', 'delete')).toHaveLength(0);
      expect(chamadasDe('avaliadores_evento', 'delete')).toHaveLength(0);
      await waitFor(() => expect(screen.queryByText('Lucas Staff')).not.toBeInTheDocument());
    });
  });

  describe('importação', () => {
    it('deve ler nome, e-mail e papel com variações de coluna', () => {
      // Arrange / Act
      const item = extrairLinhaStaff({ 'Nome Completo': ' Ana ', 'E-mail': 'Ana@X.COM ', Papel: 'monitor' });

      // Assert
      expect(item).toEqual({ nome: 'Ana', email: 'ana@x.com', papel: 'MONITOR' });
    });

    it('deve gravar a planilha numa única chamada e listar quem foi ignorado', async () => {
      // Arrange
      const user = userEvent.setup();
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { cadastrados: 1, atualizados: 0, ignorados: [{ email: 'aval@ifms.edu.br', motivo: 'O e-mail pertence a um usuário AVALIADOR; ele não foi alterado.' }] },
        error: null,
      } as never);
      renderizar();
      await screen.findByText('Lucas Staff');
      const csv = 'nome,email,papel\nPedro,Pedro@IFMS.edu.br,STAFF\nAval,aval@ifms.edu.br,\nSem Email,,STAFF\n';

      // Act
      await user.upload(screen.getByLabelText('Arquivo da equipe Staff (.xlsx ou .csv)'), new File([csv], 'staff.csv', { type: 'text/csv' }));

      // Assert
      await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
      expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_staff', {
        p_id_evento: ID_EVENTO,
        p_itens: [
          { nome: 'Pedro', email: 'pedro@ifms.edu.br', papel: 'STAFF' },
          { nome: 'Aval', email: 'aval@ifms.edu.br', papel: '' },
        ],
      });
      const log = await screen.findByRole('list', { name: 'Resultado da importação' });
      expect(within(log).getByText(/Linha 4: e-mail inválido/)).toBeInTheDocument();
      expect(within(log).getByText(/aval@ifms\.edu\.br: O e-mail pertence a um usuário AVALIADOR/)).toBeInTheDocument();
    });
  });
});
