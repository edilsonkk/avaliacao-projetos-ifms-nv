import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const {
  mockFrom,
  mockSelect,
  mockOrder,
  mockUpsert,
  mockInsert,
  mockUpdate,
  mockEq,
  mockIs,
} = vi.hoisted(() => {
  const mockIs = vi.fn().mockResolvedValue({ error: null });
  const mockEq = vi.fn().mockResolvedValue({ error: null });
  const mockUpdate = vi.fn(() => ({
    eq: mockEq,
    is: mockIs,
  }));
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  const mockUpsert = vi.fn().mockResolvedValue({ error: null });
  const mockOrder = vi.fn();
  const mockSelect = vi.fn(() => ({ order: mockOrder }));
  const mockFrom = vi.fn(() => ({
    select: mockSelect,
    upsert: mockUpsert,
    insert: mockInsert,
    update: mockUpdate,
  }));

  return {
    mockFrom,
    mockSelect,
    mockOrder,
    mockUpsert,
    mockInsert,
    mockUpdate,
    mockEq,
    mockIs,
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { GestorProjetos } from '../components/GestorProjetos';

describe('Auditoria de Gestor de Projetos: Campos Completos e Topo da Fila', () => {
  const ID_EVENTO_TESTE = 'evt-999-ativo';
  const PROJETO_MOCK = {
    id_projeto: 'proj-uuid-1',
    codigo_projeto: 'FETEC-001',
    titulo: 'Desenvolvimento Sustentável',
    estande: 'EST-A01',
    corredor: 'A',
    is_check_in_realizado: false,
    id_evento: ID_EVENTO_TESTE,
    id_instituicao: 'inst-1',
    id_area: 'area-1',
    id_modalidade: 'mod-1',
    is_fora_da_competicao: false,
    forcar_topo_fila: false,
    instituicoes: { id_instituicao: 'inst-1', nome_exibicao: 'IFMS Campus CG', sigla: 'IFMS-CG' },
    areas_tematicas: { id_area: 'area-1', nome_area: 'Ciências Exatas' },
    modalidades: { id_modalidade: 'mod-1', nome_modalidade: 'Ensino Médio' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder.mockImplementation((col: string) => {
      // Simula retorno para projetos ou tabelas de referência
      return Promise.resolve({
        data: [PROJETO_MOCK],
        error: null,
      });
    });
  });

  it('1. Renderiza o botão "Baixar Modelo (.xlsx)" no cabeçalho ao lado de Importar', async () => {
    render(<GestorProjetos id_evento_ativo={ID_EVENTO_TESTE} />);

    await waitFor(() => {
      expect(screen.getByText('Baixar Modelo (.xlsx)')).toBeInTheDocument();
      expect(screen.getByText('Importar (.xlsx/.csv)')).toBeInTheDocument();
    });
  });

  it('2. Renderiza o botão "Topo da Fila" na listagem de projetos e alterna o status no Supabase', async () => {
    render(<GestorProjetos id_evento_ativo={ID_EVENTO_TESTE} />);

    await waitFor(() => {
      expect(screen.getByText('Normal')).toBeInTheDocument();
    });

    const botaoTopo = screen.getByTitle('Forçar este projeto para o Topo da Fila de sorteio dos avaliadores');
    expect(botaoTopo).toBeInTheDocument();

    fireEvent.click(botaoTopo);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('projetos');
      expect(mockUpdate).toHaveBeenCalledWith({ forcar_topo_fila: true });
      expect(mockEq).toHaveBeenCalledWith('id_projeto', 'proj-uuid-1');
    });
  });

  it('3. Formulário de Novo Projeto contém campos para Instituição, Área, Modalidade e Fora da Competição', async () => {
    render(<GestorProjetos id_evento_ativo={ID_EVENTO_TESTE} />);

    // Abrir formulário retrátil
    const btnNovo = screen.getByText('Novo Projeto');
    fireEvent.click(btnNovo);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Título completo do projeto *')).toBeInTheDocument();
      expect(screen.getByText('Instituição')).toBeInTheDocument();
      expect(screen.getByText('Área Temática')).toBeInTheDocument();
      expect(screen.getByText('Modalidade')).toBeInTheDocument();
      expect(screen.getByText('Fora da Competição')).toBeInTheDocument();
    });

    // Preencher título
    const inputTitulo = screen.getByPlaceholderText('Título completo do projeto *');
    fireEvent.change(inputTitulo, { target: { value: 'Novo Projeto Robótica' } });

    // Clicar em salvar
    const btnSalvar = screen.getByText('Cadastrar Projeto');
    fireEvent.click(btnSalvar);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('projetos');
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          titulo: 'Novo Projeto Robótica',
          id_evento: ID_EVENTO_TESTE,
          forcar_topo_fila: false,
          is_check_in_realizado: false,
        }),
      ]);
    });
  });

  it('4. Executa migração retroativa de id_evento para projetos legados sem vínculo', async () => {
    render(<GestorProjetos id_evento_ativo={ID_EVENTO_TESTE} />);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ id_evento: ID_EVENTO_TESTE });
      expect(mockIs).toHaveBeenCalledWith('id_evento', null);
    });
  });
});
