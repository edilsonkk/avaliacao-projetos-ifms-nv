import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const { mockFrom, mockInsert, mockUpdate, mockUpsert, mockDelete } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ data: { id_usuario: 'user-novo-123' }, error: null });
  const mockUpdate = vi.fn().mockResolvedValue({ error: null });
  const mockUpsert = vi.fn().mockResolvedValue({ error: null });
  const mockDelete = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn();

  return { mockFrom, mockInsert, mockUpdate, mockUpsert, mockDelete };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: vi.fn(),
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { GestorAvaliadores } from '@/features/avaliadores';
import { AtribuicaoForcada } from '@/features/atribuicoes';

describe('TDD: Gestor de Avaliadores - Bloqueio de Modalidade, Instituição e Cota Estrita', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      in: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      insert: mockInsert,
      update: mockUpdate,
      upsert: mockUpsert,
      delete: vi.fn(() => {
        const delChain: any = {
          eq: vi.fn(() => delChain),
          then: (res: any, rej?: any) => Promise.resolve({ error: null }).then(res, rej),
        };
        return delChain;
      }),
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'instituicoes') {
        return criarQueryChain({
          data: [
            { id_instituicao: 'inst-1', nome_exibicao: 'IFMS Campus CG', sigla: 'IFMS-CG' },
            { id_instituicao: 'inst-2', nome_exibicao: 'UFMS', sigla: 'UFMS' },
          ],
          error: null,
        });
      }

      if (tabela === 'modalidades') {
        return criarQueryChain({
          data: [
            { id_modalidade: 'mod-1', nome_modalidade: 'Ensino Médio' },
            { id_modalidade: 'mod-2', nome_modalidade: 'Ensino Técnico' },
          ],
          error: null,
        });
      }

      if (tabela === 'usuarios') {
        const chain = criarQueryChain({
          data: [
            {
              id_usuario: 'user-av-1',
              nome: 'Prof. Roberto Carlos',
              email: 'roberto@ifms.edu.br',
              papel: 'AVALIADOR',
            },
          ],
          error: null,
        });
        chain.insert = vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { id_usuario: 'user-novo-999' }, error: null }),
          })),
        }));
        return chain;
      }

      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-av-1',
              id_evento: 'evt-1',
              is_credenciado: true,
              id_instituicao: 'inst-1',
              instituicoes: { nome_exibicao: 'IFMS Campus CG' },
              usuarios: { nome: 'Prof. Roberto Carlos', email: 'roberto@ifms.edu.br' },
            },
          ],
          error: null,
        });
      }

      if (tabela === 'avaliador_modalidades_bloqueadas') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-av-1',
              id_evento: 'evt-1',
              id_modalidade: 'mod-1',
            },
          ],
          error: null,
        });
      }

      if (tabela === 'eventos') {
        return criarQueryChain({
          data: { id_evento: 'evt-1', is_ativo: true, cota_avaliacoes_padrao: 3 },
          error: null,
        });
      }

      if (tabela === 'locks_ativos') {
        return criarQueryChain({ data: [], error: null });
      }

      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'proj-1',
              codigo_projeto: 'AGRO-01',
              titulo: 'Cultivo Hidropônico',
              id_instituicao: 'inst-1', // Mesma instituição de user-av-1 (Conflito!)
              id_modalidade: 'mod-1', // Modalidade bloqueada para user-av-1 (Bloqueio!)
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
              cota_avaliacoes_customizada: 3,
            },
          ],
          error: null,
        });
      }

      if (tabela === 'avaliacoes') {
        return criarQueryChain({ data: [], error: null });
      }

      if (tabela === 'view_avaliadores_credenciados') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-av-1',
              nome: 'Prof. Roberto Carlos',
              email: 'roberto@ifms.edu.br',
              is_credenciado: true,
            },
          ],
          error: null,
        });
      }

      return criarQueryChain({ data: [], error: null });
    });
  });

  it('deve exibir o botão "Baixar Modelo (.xlsx)" no cabeçalho do Gestor de Avaliadores', async () => {
    render(<GestorAvaliadores id_evento_ativo="evt-1" />);

    const botaoBaixar = await screen.findByRole('button', { name: /Baixar Modelo \(\.xlsx\)/i });
    expect(botaoBaixar).toBeInTheDocument();
  });

  it('deve exibir badges de Instituição e Bloqueio de Modalidade na lista de avaliadores', async () => {
    render(<GestorAvaliadores id_evento_ativo="evt-1" />);

    // Verifica nome do avaliador
    expect(await screen.findByText('Prof. Roberto Carlos')).toBeInTheDocument();

    // Verifica badge da instituição
    expect(screen.getByText('IFMS Campus CG')).toBeInTheDocument();

    // Verifica badge de bloqueio da modalidade Ensino Médio
    expect(screen.getByText(/Bloq:\s*Ensino Médio/i)).toBeInTheDocument();
  });

  it('deve permitir abrir o formulário e selecionar Instituição e Modalidades Bloqueadas ao cadastrar novo avaliador', async () => {
    const user = userEvent.setup();
    render(<GestorAvaliadores id_evento_ativo="evt-1" />);

    const botaoNovo = await screen.findByRole('button', { name: /Novo Avaliador/i });
    await user.click(botaoNovo);

    // Campos do formulário
    const inputNome = screen.getByPlaceholderText(/Nome do Avaliador/i);
    const inputEmail = screen.getByPlaceholderText(/E-mail do Avaliador/i);
    const selectInst = screen.getByRole('combobox');

    expect(inputNome).toBeInTheDocument();
    expect(inputEmail).toBeInTheDocument();
    expect(selectInst).toBeInTheDocument();

    // Checkbox da modalidade disponível
    const checkModalidade = screen.getByLabelText(/Ensino Técnico/i);
    expect(checkModalidade).toBeInTheDocument();

    await user.type(inputNome, 'Prof. Mariana Lima');
    await user.type(inputEmail, 'mariana@ufms.br');
    await user.selectOptions(selectInst, 'inst-2');
    await user.click(checkModalidade);

    const botaoSalvar = screen.getByRole('button', { name: /Cadastrar Avaliador/i });
    await user.click(botaoSalvar);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('usuarios');
    });
  });

  it('deve validar bloqueio de modalidade e conflito institucional na Atribuição Forçada', async () => {
    render(<AtribuicaoForcada isOpen={true} aoFechar={vi.fn()} id_evento_ativo="evt-1" />);

    // Aguarda carregar dados
    const projetoCard = await screen.findByText(/Cultivo Hidropônico/i);
    expect(projetoCard).toBeInTheDocument();

    // Clica no projeto da banca
    const user = userEvent.setup();
    await user.click(projetoCard);

    // Verifica se o avaliador que tem a mesma instituição ou modalidade bloqueada é sinalizado como inelegível
    await waitFor(() => {
      const avalCard = screen.getByText('Prof. Roberto Carlos');
      expect(avalCard).toBeInTheDocument();
      // O motivo de inelegibilidade de conflito institucional ou bloqueio de modalidade deve estar visível
      expect(screen.getByText(/Conflito: Mesma Instituição|Bloqueio: Modalidade do Projeto/i)).toBeInTheDocument();
    });
  });
});
