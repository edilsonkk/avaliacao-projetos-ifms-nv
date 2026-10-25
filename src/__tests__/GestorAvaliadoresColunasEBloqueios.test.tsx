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

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: vi.fn(),
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { GestorAvaliadores } from '../components/GestorAvaliadores';

describe('Gestor de Avaliadores - Novas Colunas Instituição, Modalidades e Toggle Instantâneo de Bloqueio', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      in: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      insert: mockInsert,
      update: mockUpdate,
      upsert: mockUpsert,
      delete: vi.fn(() => {
        const delChain: any = {
          eq: vi.fn(() => delChain),
          in: vi.fn(() => delChain),
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
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: { id_evento: 'evt-200', is_ativo: true },
          error: null,
        });
      }

      if (tabela === 'instituicoes') {
        return criarQueryChain({
          data: [
            { id_instituicao: 'inst-1', nome_exibicao: 'IFMS Campus CG', sigla: 'IFMS-CG' },
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

      if (tabela === 'areas_tematicas') {
        return criarQueryChain({
          data: [
            { id_area: 'area-1', nome_area: 'Ciências Agrárias' },
          ],
          error: null,
        });
      }

      if (tabela === 'usuarios') {
        return criarQueryChain({
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
      }

      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-av-1',
              id_evento: 'evt-200',
              is_credenciado: true,
              id_instituicao: 'inst-1',
              instituicoes: { nome_exibicao: 'IFMS Campus CG' },
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
              id_evento: 'evt-200',
              id_modalidade: 'mod-1',
            },
          ],
          error: null,
        });
      }

      if (tabela === 'avaliador_areas') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-av-1',
              id_evento: 'evt-200',
              id_area: 'area-1',
              areas_tematicas: { nome_area: 'Ciências Agrárias' },
            },
          ],
          error: null,
        });
      }

      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [
            { id_projeto: 'proj-123' },
          ],
          error: null,
        });
      }

      if (tabela === 'locks_ativos' || tabela === 'fila_atribuicoes_direcionadas') {
        return criarQueryChain({
          data: [],
          error: null,
        });
      }

      return criarQueryChain({ data: [], error: null });
    });
  });

  it('1. CABEÇALHO E ESTRUTURA: exibe colunas Instituição e Modalidades com ordenamento e remove coluna Papel', async () => {
    render(<GestorAvaliadores id_evento_ativo="evt-200" />);

    await waitFor(() => {
      expect(screen.getByText('Prof. Roberto Carlos')).toBeInTheDocument();
    });

    // Colunas esperadas
    expect(screen.getByRole('columnheader', { name: /Credenciamento/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Nome/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Instituição/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /E-mail/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Modalidades/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Áreas/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Ações/i })).toBeInTheDocument();

    // Coluna Papel deve ter sido removida do cabeçalho
    expect(screen.queryByRole('columnheader', { name: /^Papel$/i })).not.toBeInTheDocument();
  });

  it('2. COLUNA NOME LIMPA: não renderiza badges de instituição nem de modalidade abaixo do nome', async () => {
    render(<GestorAvaliadores id_evento_ativo="evt-200" />);

    const nomeCell = await screen.findByText('Prof. Roberto Carlos');
    expect(nomeCell).toBeInTheDocument();

    // O elemento pai do nome não deve conter os badges
    const tdNome = nomeCell.closest('td');
    expect(tdNome).not.toHaveTextContent(/IFMS Campus CG/);
    expect(tdNome).not.toHaveTextContent(/Bloq:/);
  });

  it('3. COLUNA MODALIDADES: renderiza botões de toggle e permite bloquear/desbloquear com reflexo no banco', async () => {
    const user = userEvent.setup();
    render(<GestorAvaliadores id_evento_ativo="evt-200" />);

    await waitFor(() => {
      expect(screen.getByText('Prof. Roberto Carlos')).toBeInTheDocument();
    });

    // Modalidade 1 (Ensino Médio) está bloqueada inicialmente
    const btnBloqueado = screen.getByRole('button', { name: /Bloq:\s*Ensino Médio/i });
    expect(btnBloqueado).toBeInTheDocument();

    // Modalidade 2 (Ensino Técnico) está liberada inicialmente
    const btnLiberado = screen.getByRole('button', { name: /^Ensino Técnico$/i });
    expect(btnLiberado).toBeInTheDocument();

    // Clica para BLOQUEAR a modalidade Ensino Técnico
    await user.click(btnLiberado);

    await waitFor(() => {
      // Deve ter acionado upsert em avaliador_modalidades_bloqueadas
      expect(mockFrom).toHaveBeenCalledWith('avaliador_modalidades_bloqueadas');
      expect(mockUpsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            id_usuario: 'user-av-1',
            id_evento: 'evt-200',
            id_modalidade: 'mod-2',
          }),
        ],
        expect.objectContaining({ onConflict: 'id_usuario,id_evento,id_modalidade' })
      );
    });

    // Clica para LIBERAR a modalidade Ensino Médio
    await user.click(btnBloqueado);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('avaliador_modalidades_bloqueadas');
    });
  });
});
