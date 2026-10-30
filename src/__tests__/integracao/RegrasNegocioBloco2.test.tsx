import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';

// Mock do window.confirm e window.alert
vi.stubGlobal('alert', vi.fn());
vi.stubGlobal('confirm', vi.fn(() => true));

const { mockFrom, mockRpc, mockInsert, mockUpdate, mockDelete } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  const mockUpdate = vi.fn().mockResolvedValue({ error: null });
  const mockDelete = vi.fn().mockResolvedValue({ error: null });
  const mockRpc = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn();
  return { mockFrom, mockRpc, mockInsert, mockUpdate, mockDelete };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null }) },
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { TelaAdmin } from '@/features/admin';
import { ModalExclusaoAvaliacao } from '@/features/atribuicoes';
import { ModalDetalhamento } from '@/features/admin';
import { GestorAvaliadores } from '@/features/avaliadores';
import { GestorProjetos } from '@/features/projetos';
import { GestorStaff } from '@/features/staff';
import { GestorInstituicoes } from '@/features/cadastros';
import { GestorQuestionarios } from '@/features/cadastros';

describe('Validação de Regras de Negócio e Layout do Bloco 2', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      range: vi.fn(() => chain),
      ilike: vi.fn(() => chain),
      in: vi.fn(() => chain),
      delete: mockDelete,
      update: vi.fn((dados: any) => {
        mockUpdate(dados);
        return chain;
      }),
      is: vi.fn(() => chain),
      insert: mockInsert,
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: { id_evento: 'evt-2026', nome_evento: 'FETEC MS 2026', is_ativo: true },
          error: null,
        });
      }

      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-aval-1',
              is_credenciado: true,
              usuarios: { id_usuario: 'user-aval-1', papel: 'AVALIADOR' },
            },
            {
              id_usuario: 'user-staff-1',
              is_credenciado: true,
              usuarios: { id_usuario: 'user-staff-1', papel: 'STAFF' },
            },
          ],
          count: 28,
          error: null,
        });
      }

      if (tabela === 'usuarios') {
        return criarQueryChain({
          data: [
            { id_usuario: 'admin-1', nome: 'Coordenação Geral FETEC', email: 'coord@ifms.edu.br', papel: 'SUPERADMIN' },
            { id_usuario: 'admin-2', nome: 'Administrador Adjunto', email: 'admin2@ifms.edu.br', papel: 'ADMIN' },
            { id_usuario: 'user-aval-1', nome: 'Dr. Roberto Magalhães', email: 'roberto@ifms.edu.br', papel: 'AVALIADOR' },
            { id_usuario: 'user-aval-2', nome: 'Dra. Patricia Alencar', email: 'patricia@ifms.edu.br', papel: 'AVALIADOR' },
            { id_usuario: 'user-staff-1', nome: 'Monitor Lucas', email: 'lucas@ifms.edu.br', papel: 'STAFF' },
          ],
          count: 5,
          error: null,
        });
      }

      if (tabela === 'questionarios') {
        return criarQueryChain({
          data: [{ id_questionario: 'q-1', titulo: 'Questionário Geral de Avaliação' }],
          count: 5,
          error: null,
        });
      }

      if (tabela === 'avaliacoes') {
        return criarQueryChain({
          data: [
            {
              id_avaliacao: 'av-test-1',
              id_projeto: 'proj-1',
              id_usuario: 'user-aval-1',
              nota_final: 92.0,
              status: 'CONCLUIDA',
              status_avaliacao: 'concluida',
              parecer_final: 'Excelente apresentação',
              is_quarentena: false,
              projetos: {
                codigo_projeto: 'FETEC-001',
                titulo: 'Automação Agrícola com IoT',
                estande: 'A-01',
              },
              usuarios: {
                nome: 'Prof. Carlos Santos',
                email: 'carlos@ifms.edu.br',
              },
            },
            {
              id_avaliacao: 'av-test-2',
              id_projeto: 'proj-2',
              id_usuario: 'user-aval-2',
              nota_final: 65.0,
              status: 'CONCLUIDA',
              status_avaliacao: 'concluida',
              parecer_final: 'Precisa melhorar testes',
              is_quarentena: false,
              projetos: {
                codigo_projeto: 'FETEC-002',
                titulo: 'Reciclagem Inteligente',
                estande: 'B-02',
              },
              usuarios: {
                nome: 'Profa. Ana Lima',
                email: 'ana@ufms.br',
              },
            },
          ],
          count: 45,
          error: null,
        });
      }

      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [],
          count: 60,
          error: null,
        });
      }

      if (tabela === 'locks_ativos') {
        return criarQueryChain({
          data: [],
          count: 3,
          error: null,
        });
      }

      if (tabela === 'view_projetos_quarentena') {
        return criarQueryChain({
          data: [],
          count: 0,
          error: null,
        });
      }

      if (tabela === 'view_projetos_pendentes_avaliacao') {
        return criarQueryChain({
          data: [],
          count: 10,
          error: null,
        });
      }

      return criarQueryChain({ data: [], count: 0, error: null });
    });
  });

  it('1. CARD AVALIADORES: sem contadores internos e exibe badge de credenciamento ao abrir o modal', async () => {
    const { unmount } = render(<TelaAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Avaliadores')).toBeDefined();
      expect(screen.queryByText(/credenciados de .* cadastrados/i)).toBeNull();
      expect(screen.queryByText(/Abrir Gestor \(CRUD\)/i)).toBeNull();
      expect(screen.queryByText(/is_credenciado = true/i)).toBeNull();
    });

    const cardAvaliadores = screen.getByRole('button', { name: /Avaliadores/i });
    expect(cardAvaliadores.textContent).not.toMatch(/\d+/);

    fireEvent.click(cardAvaliadores);
    expect(await screen.findByText('Gestor de Avaliadores')).toBeDefined();
    expect(await screen.findByText(/credenciados/i)).toBeDefined();

    unmount();
  });

  it('2. CARD EQUIPE STAFF: sem contadores internos e exibe badge de credenciamento ao abrir o modal', async () => {
    const { unmount } = render(<TelaAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Equipe Staff')).toBeDefined();
      expect(screen.queryByText('Monitores de suporte e credenciamento')).toBeNull();
      expect(screen.queryByText(/credenciados de .* cadastrados/i)).toBeNull();
      expect(screen.queryByText(/Abrir Gestor \(CRUD\)/i)).toBeNull();
    });

    const cardStaff = screen.getByRole('button', { name: /Equipe Staff/i });
    expect(cardStaff.textContent).not.toMatch(/\d+/);

    fireEvent.click(cardStaff);
    expect(await screen.findByText('Gestor da Equipe Staff')).toBeDefined();
    expect(await screen.findByText(/credenciados/i)).toBeDefined();

    unmount();
  });

  it('3. BOTÃO DE CONFIGURAÇÕES (ENGRENAGEM): abre configurações gerais contendo acesso para Gestão de Administradores', async () => {
    const { unmount } = render(<TelaAdmin />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Configurações Gerais/i })).toBeDefined();
    });

    const btnConfig = screen.getByRole('button', { name: /Configurações Gerais/i });
    fireEvent.click(btnConfig);

    // O modal de configurações deve exibir o botão "Gestão de Administradores"
    expect(await screen.findByRole('button', { name: /Gestão de Administradores/i })).toBeDefined();

    // Ao clicar em "Gestão de Administradores", abre o modal de Administradores
    const btnAdminModal = screen.getByRole('button', { name: /Gestão de Administradores/i });
    fireEvent.click(btnAdminModal);

    expect(await screen.findByText('Gestão de Administradores')).toBeDefined();

    unmount();
  });

  it('4. EDIÇÃO DE ADMINISTRADORES: ModalDetalhamento suporta edição segura inline de nome, email e papel', async () => {
    const mockFechar = vi.fn();
    const { container, unmount } = render(
      <ModalDetalhamento
        tipo="administradores"
        titulo="Gestão de Administradores"
        id_evento_ativo="evt-2026"
        ao_fechar={mockFechar}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Coordenação Geral FETEC')).toBeDefined();
      expect(screen.getByText('Administrador Adjunto')).toBeDefined();
    });

    // Clica no botão "Editar" dentro da tabela de administradores
    const botoesEditar = within(container).getAllByTitle('Editar Administrador');
    expect(botoesEditar.length).toBeGreaterThan(0);
    fireEvent.click(botoesEditar[0]);

    // O input com o nome deve estar disponível
    const inputNome = screen.getByDisplayValue('Coordenação Geral FETEC');
    fireEvent.change(inputNome, { target: { value: 'Coordenação Geral FETEC Atualizada' } });

    // Salva a edição
    const btnSalvar = within(container).getByTitle('Salvar Alterações');
    fireEvent.click(btnSalvar);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('usuarios');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          nome: 'Coordenação Geral FETEC Atualizada',
        })
      );
    });

    unmount();
  });

  it('5. CARD QUESTIONÁRIOS: exibe padrão limpo sem subtítulo', async () => {
    const { unmount } = render(<TelaAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Questionários')).toBeDefined();
      expect(screen.queryByText('Questionários de avaliação')).toBeNull();
    });

    unmount();
  });

  it('6. ESTRUTURA DO BLOCO 2 (PESSOAL & FORMULÁRIOS): deve conter 5 cards (Avaliadores, Staff, Questionários, Instituições e Modalidades e Níveis)', async () => {
    const { unmount } = render(<TelaAdmin />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Avaliadores$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^Equipe Staff$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^Questionários$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^Instituições$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^Modalidades e Níveis$/i })).toBeDefined();
      // O card Administradores não deve mais estar no grid direto
      expect(screen.queryByRole('button', { name: /^Administradores$/i })).toBeNull();
    });

    // Clica no card de Modalidades e Níveis para verificar que abre o modal do GestorModalidades
    const btnModalidades = screen.getByRole('button', { name: /^Modalidades e Níveis$/i });
    fireEvent.click(btnModalidades);

    await waitFor(() => {
      expect(screen.getByText(/Gestor de Modalidades e Níveis/i)).toBeDefined();
    });

    unmount();
  });

  it('7. MODAL EXCLUSÃO DE AVALIAÇÃO: cancela pela função do banco com confirmação e suporte a desfazer (undo)', async () => {
    const mockSucesso = vi.fn();
    const mockFechar = vi.fn();

    const { container, unmount } = render(
      <ModalExclusaoAvaliacao
        id_evento_ativo="evt-2026"
        ao_fechar={mockFechar}
        aoSucesso={mockSucesso}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Excluir uma avaliação')).toBeDefined();
      expect(screen.getByText('FETEC-001')).toBeDefined();
      expect(screen.getByText('Prof. Carlos Santos')).toBeDefined();
    });

    // 1. Testa filtro de busca
    const inputBusca = screen.getByPlaceholderText(/Buscar por código/i);
    fireEvent.change(inputBusca, { target: { value: 'FETEC-002' } });

    await waitFor(() => {
      expect(screen.getByText('FETEC-002')).toBeDefined();
      expect(screen.queryByText('FETEC-001')).toBeNull();
    });

    // Limpa filtro
    fireEvent.change(inputBusca, { target: { value: '' } });

    await waitFor(() => {
      expect(screen.getByText('FETEC-001')).toBeDefined();
    });

    // 2. Clica no botão "Excluir" da linha FETEC-001
    const botoesExcluir = within(container).getAllByTitle(/Excluir Avaliação/i);
    fireEvent.click(botoesExcluir[0]);

    // 3. Modal de confirmação surge
    await waitFor(() => {
      expect(screen.getByText('Excluir esta avaliação?')).toBeDefined();
      expect(screen.getByText(/fica como cancelada e pode ser restaurada/i)).toBeDefined();
    });

    // 4. Confirma exclusão (soft delete)
    const btnConfirmar = screen.getByRole('button', { name: /Confirmar Exclusão/i });
    fireEvent.click(btnConfirmar);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('excluir_avaliacao', { p_id_avaliacao: expect.any(String) });
      expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELADA' }));
      expect(mockSucesso).toHaveBeenCalled();
      // Toast flutuante com Desfazer
      expect(screen.getByRole('button', { name: /Desfazer/i })).toBeDefined();
    });

    // 5. Clica em Desfazer (Undo)
    const btnDesfazer = screen.getByRole('button', { name: /Desfazer/i });
    fireEvent.click(btnDesfazer);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('restaurar_avaliacao', { p_id_avaliacao: expect.any(String) });
    });
    expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'CONCLUIDA' }));

    unmount();
  });

  it('8. PERSISTÊNCIA DE CREDENCIAMENTO: credenciar grava no banco (não no navegador) e atualiza métricas', async () => {
    localStorage.clear();
    const mockAtualizarMetricas = vi.fn();
    const implementacaoPadrao = mockFrom.getMockImplementation()!;
    mockFrom.mockImplementation((tabela: string) =>
      tabela === 'avaliadores_evento'
        ? criarQueryChain({
            data: [
              { id_usuario: 'user-aval-2', is_credenciado: false, id_instituicao: null, usuarios: { nome: 'Dra. Patricia Alencar', email: 'patricia@ifms.edu.br', papel: 'AVALIADOR' } },
            ],
            error: null,
          })
        : implementacaoPadrao(tabela)
    );

    render(<GestorAvaliadores id_evento_ativo="evt-2026" aoAtualizarMetricas={mockAtualizarMetricas} />);
    expect(await screen.findByText('Dra. Patricia Alencar')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Credenciar Dra. Patricia Alencar' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ is_credenciado: true });
      expect(mockAtualizarMetricas).toHaveBeenCalled();
    });
    expect(localStorage.getItem('avaliadores_credenciados_local')).toBeNull();
    const linhaPatricia = screen.getByText('Dra. Patricia Alencar').closest('tr')!;
    expect(within(linhaPatricia).getByText('Credenciado')).toBeDefined();
  });

  it('9. PADRONIZAÇÃO DE BOTÕES DE IMPORTAÇÃO: todos os 5 gestores exibem botão "Importar (.xlsx/.csv)"', async () => {
    // 1. GestorProjetos
    const { unmount: u1 } = render(<GestorProjetos />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Importar \(\.xlsx\/\.csv\)/i })).toBeDefined();
    });
    u1();

    // 2. GestorAvaliadores
    const { unmount: u2 } = render(<GestorAvaliadores id_evento_ativo="evt-2026" />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Importar \(\.xlsx\/\.csv\)/i })[0]).toBeDefined();
    });
    u2();

    // 3. GestorStaff
    const { unmount: u3 } = render(<GestorStaff id_evento_ativo="evt-2026" />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Importar \(\.xlsx\/\.csv\)/i })[0]).toBeDefined();
    });
    u3();

    // 4. GestorInstituicoes
    const { unmount: u4 } = render(<GestorInstituicoes />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Importar \(\.xlsx\/\.csv\)/i })).toBeDefined();
    });
    u4();

    // 5. GestorQuestionarios
    const { unmount: u5 } = render(<GestorQuestionarios id_evento_ativo="evt-2026" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Importar \(\.xlsx\/\.csv\)/i })).toBeDefined();
    });
    u5();
  });
});
