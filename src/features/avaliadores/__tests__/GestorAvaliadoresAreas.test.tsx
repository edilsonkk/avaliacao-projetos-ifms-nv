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

// Mock do excelUtils para inspecionar download de modelo
const { mockBaixarPlanilhaModelo } = vi.hoisted(() => {
  const mockBaixarPlanilhaModelo = vi.fn().mockResolvedValue(undefined);
  return { mockBaixarPlanilhaModelo };
});

vi.mock('@/lib/excel/excelUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/excel/excelUtils')>();
  return {
    ...actual,
    baixarPlanilhaModelo: mockBaixarPlanilhaModelo,
  };
});

import { GestorAvaliadores } from '@/features/avaliadores';

describe('Gestor de Avaliadores - Múltiplas Áreas de Avaliação e Afinidade Temática', () => {
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
          data: { id_evento: 'evt-100', is_ativo: true },
          error: null,
        });
      }

      if (tabela === 'instituicoes') {
        return criarQueryChain({
          data: [
            { id_instituicao: 'inst-1', nome_exibicao: 'IFMS Dourados', sigla: 'IFMS' },
          ],
          error: null,
        });
      }

      if (tabela === 'modalidades') {
        return criarQueryChain({
          data: [
            { id_modalidade: 'mod-1', nome_modalidade: 'Ensino Médio Integrado' },
          ],
          error: null,
        });
      }

      if (tabela === 'areas_tematicas') {
        return criarQueryChain({
          data: [
            { id_area: 'area-1', nome_area: 'Ciências Agrárias' },
            { id_area: 'area-2', nome_area: 'Ciências Exatas e da Terra' },
            { id_area: 'area-3', nome_area: 'Engenharias' },
          ],
          error: null,
        });
      }

      if (tabela === 'usuarios') {
        const chain = criarQueryChain({
          data: [
            {
              id_usuario: 'user-av-1',
              nome: 'Profa. Maria Agronomia',
              email: 'maria@ifms.edu.br',
              papel: 'AVALIADOR',
            },
            {
              id_usuario: 'user-av-2',
              nome: 'Prof. João Geraldo',
              email: 'joao@ifms.edu.br',
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
              id_evento: 'evt-100',
              is_credenciado: true,
              id_instituicao: 'inst-1',
              instituicoes: { nome_exibicao: 'IFMS Dourados' },
            },
            {
              id_usuario: 'user-av-2',
              id_evento: 'evt-100',
              is_credenciado: false,
              id_instituicao: null,
              instituicoes: null,
            },
          ],
          error: null,
        });
      }

      if (tabela === 'avaliador_modalidades_bloqueadas') {
        return criarQueryChain({
          data: [],
          error: null,
        });
      }

      if (tabela === 'avaliador_areas') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-av-1',
              id_evento: 'evt-100',
              id_area: 'area-1',
              areas_tematicas: { nome_area: 'Ciências Agrárias' },
            },
            {
              id_usuario: 'user-av-1',
              id_evento: 'evt-100',
              id_area: 'area-3',
              areas_tematicas: { nome_area: 'Engenharias' },
            },
          ],
          error: null,
        });
      }

      return criarQueryChain({ data: [], error: null });
    });
  });

  it('1. LISTAGEM: exibe a coluna "Áreas", badges das áreas vinculadas e "Geral (todas as áreas)" para sem áreas', async () => {
    render(<GestorAvaliadores id_evento_ativo="evt-100" />);

    // Verifica cabeçalho da tabela
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Áreas/i })).toBeInTheDocument();
    });

    // Profa. Maria possui 'Ciências Agrárias' e 'Engenharias'
    expect(await screen.findByText('Profa. Maria Agronomia')).toBeInTheDocument();
    expect(screen.getByText('Ciências Agrárias')).toBeInTheDocument();
    expect(screen.getByText('Engenharias')).toBeInTheDocument();

    // Prof. João não possui áreas vinculadas -> fallback "Geral (todas as áreas)"
    expect(screen.getByText('Prof. João Geraldo')).toBeInTheDocument();
    expect(screen.getByText(/Geral \(todas as áreas\)/i)).toBeInTheDocument();
  });

  it('2. CADASTRO MANUAL: exibe seleção múltipla de áreas e persiste na tabela avaliador_areas', async () => {
    const user = userEvent.setup();
    render(<GestorAvaliadores id_evento_ativo="evt-100" />);

    await waitFor(() => {
      expect(screen.getByText('Profa. Maria Agronomia')).toBeInTheDocument();
    });

    // Clica em "Novo Avaliador" para abrir o formulário
    const btnNovo = screen.getByRole('button', { name: /Novo Avaliador/i });
    await user.click(btnNovo);

    // Valida que a seção de Áreas de Avaliação está visível
    expect(screen.getByText(/Áreas de Avaliação \(Afinidade temática/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ciências Exatas e da Terra/i)).toBeInTheDocument();

    // Preenche campos
    await user.type(screen.getByPlaceholderText('Nome do Avaliador'), 'Carlos Exatas');
    await user.type(screen.getByPlaceholderText('E-mail do Avaliador'), 'carlos@ifms.edu.br');

    // Seleciona as áreas: Ciências Exatas e Engenharias
    await user.click(screen.getByLabelText(/Ciências Exatas e da Terra/i));
    await user.click(screen.getByLabelText(/^Engenharias$/i));

    // Submete formulário
    const btnSalvar = screen.getByRole('button', { name: /Cadastrar Avaliador/i });
    await user.click(btnSalvar);

    await waitFor(() => {
      // Verifica inserção/upsert em avaliador_areas
      expect(mockFrom).toHaveBeenCalledWith('avaliador_areas');
      expect(mockUpsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            id_usuario: 'user-novo-999',
            id_evento: 'evt-100',
            id_area: 'area-2',
          }),
          expect.objectContaining({
            id_usuario: 'user-novo-999',
            id_evento: 'evt-100',
            id_area: 'area-3',
          }),
        ],
        expect.objectContaining({ onConflict: 'id_usuario,id_evento,id_area' })
      );
    });
  });

  it('3. MODELO XLSX: modelo exportado contém o campo "areas"', async () => {
    const user = userEvent.setup();
    render(<GestorAvaliadores id_evento_ativo="evt-100" />);

    await waitFor(() => {
      expect(screen.getByText('Profa. Maria Agronomia')).toBeInTheDocument();
    });

    const btnModelo = screen.getByTitle(/Baixar Planilha Modelo/i);
    await user.click(btnModelo);

    // Valida que baixarPlanilhaModelo recebeu a coluna 'areas' e linhas de exemplo com a propriedade areas
    expect(mockBaixarPlanilhaModelo).toHaveBeenCalledWith(
      'modelo_importacao_avaliadores.xlsx',
      'Avaliadores',
      expect.arrayContaining(['areas']),
      expect.arrayContaining([
        expect.objectContaining({
          areas: expect.any(String),
        }),
      ])
    );
  });
});
