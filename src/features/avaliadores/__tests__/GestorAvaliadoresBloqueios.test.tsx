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

// Lista, bloqueios e cadastro do Gestor de Avaliadores: ver GestorAvaliadores.test.tsx
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
              usuarios: { nome: 'Prof. Roberto Carlos', email: 'roberto@ifms.edu.br', papel: 'AVALIADOR' },
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
