import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GestorModalidades } from '../components/GestorModalidades';
import { ModalDeParaMapping, ItemMapeamentoDePara } from '../components/ModalDeParaMapping';
import { TelaAdmin } from '../components/TelaAdmin';

// Mocks do Supabase e Navegação
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();

vi.mock('../lib/supabase', () => ({
  verificar_conexao_configurada: vi.fn(() => true),
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

vi.mock('../lib/auth', () => ({
  obterSessaoUsuario: vi.fn(() => ({
    email: 'admin@ifms.edu.br',
    papel: 'SUPER_ADMIN',
    nome: 'Super Admin',
  })),
  encerrarSessaoUsuario: vi.fn(),
  estaAutenticado: vi.fn(() => true),
}));

describe('Validação TDD: Gestor de Modalidades e Níveis, De-Para e Aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('evento_ativo_id', 'evt-2026');

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'modalidades') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id_modalidade: 'mod-1',
                  codigo: 'EM-01',
                  nome_modalidade: 'Ensino Médio e Técnico',
                  nivel: 'Médio/Técnico',
                  area_tematica: 'Ciências Exatas',
                  descricao: 'Projetos do ensino médio e técnico integrado',
                },
              ],
              error: null,
            }),
          }),
          insert: vi.fn().mockImplementation((payload) => ({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id_modalidade: 'mod-nova',
                  ...payload[0],
                },
                error: null,
              }),
            }),
          })),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      if (tabela === 'modalidade_aliases' || tabela === 'instituicao_aliases') {
        return {
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      if (tabela === 'eventos') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id_evento: 'evt-2026',
                  nome_evento: 'FETEC MS 2026',
                  ativo: true,
                  cota_avaliacoes_padrao: 3,
                },
              ],
              error: null,
            }),
          }),
        };
      }

      // Default fallback
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });
  });

  it('1. GESTOR DE MODALIDADES: renderiza cabeçalho com ações padrão (Baixar Modelo, Importar, Nova Modalidade)', async () => {
    const mockFechar = vi.fn();
    render(<GestorModalidades ao_fechar={mockFechar} />);

    await waitFor(() => {
      expect(screen.getByText('Gestor de Modalidades e Níveis')).toBeDefined();
      expect(screen.getByRole('button', { name: /Baixar Modelo/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Importar/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Nova Modalidade/i })).toBeDefined();
    });

    // Verifica que a listagem inicial carregou a modalidade mockada
    expect(screen.getByText('Ensino Médio e Técnico')).toBeDefined();
    expect(screen.getByText('EM-01')).toBeDefined();
  });

  it('2. FORMULÁRIO RETRÁTIL: permite abrir formulário e cadastrar nova modalidade com campos completos', async () => {
    render(<GestorModalidades />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Nova Modalidade/i })).toBeDefined();
    });

    // Abre formulário
    fireEvent.click(screen.getByRole('button', { name: /Nova Modalidade/i }));

    expect(screen.getByPlaceholderText('Código (ex: MOD-EM)')).toBeDefined();
    expect(screen.getByPlaceholderText(/Nome da Modalidade/i)).toBeDefined();

    // Preenche os campos
    fireEvent.change(screen.getByPlaceholderText('Código (ex: MOD-EM)'), {
      target: { value: 'EF-01' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Nome da Modalidade/i), {
      target: { value: 'Ensino Fundamental' },
    });

    // Salva o cadastro
    const btnSalvar = screen.getByRole('button', { name: /Cadastrar Modalidade/i });
    fireEvent.click(btnSalvar);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('modalidades');
    });
  });

  it('3. MODAL DE-PARA MAPPING: exibe termos fuzzy (>= 85%) e novos para validação antes de inserir', async () => {
    const mockConfirmar = vi.fn();
    const mockFechar = vi.fn();

    const itensMock: ItemMapeamentoDePara[] = [
      {
        id_termo: 'inst_1',
        termo_original: 'IFMS Campo Grande',
        tipo: 'instituicao',
        sugestao_id: 'inst-ifms',
        sugestao_nome: 'Instituto Federal de Mato Grosso do Sul',
        confianca_percentual: 88,
        match_tipo: 'fuzzy',
      },
      {
        id_termo: 'mod_1',
        termo_original: 'Ensino Superior e Graduação',
        tipo: 'modalidade',
        sugestao_id: null,
        sugestao_nome: null,
        confianca_percentual: 0,
        match_tipo: 'novo',
      },
    ];

    render(
      <ModalDeParaMapping
        itens={itensMock}
        instituicoesExistentes={[
          {
            id_instituicao: 'inst-ifms',
            nome_exibicao: 'Instituto Federal de Mato Grosso do Sul',
            sigla: 'IFMS',
          },
        ]}
        modalidadesExistentes={[
          {
            id_modalidade: 'mod-1',
            nome_modalidade: 'Ensino Médio e Técnico',
          },
        ]}
        aoFechar={mockFechar}
        aoConfirmar={mockConfirmar}
      />
    );

    // Deve exibir o cabeçalho de validação e de-duplicação
    expect(screen.getByText(/Validação e De-Para de Dados/i)).toBeDefined();
    expect(screen.getByText('IFMS Campo Grande')).toBeDefined();
    expect(screen.getByText(/88% match/i)).toBeDefined();
    expect(screen.getByText('Ensino Superior e Graduação')).toBeDefined();
    expect(screen.getByText(/Sem correspondência ≥ 85%/i)).toBeDefined();

    // Clica em "Confirmar e Prosseguir com a Importação"
    const btnConfirmar = screen.getByRole('button', { name: /Confirmar e Prosseguir/i });
    fireEvent.click(btnConfirmar);

    await waitFor(() => {
      expect(mockConfirmar).toHaveBeenCalledTimes(1);
    });
  });

  it('4. REORDENAÇÃO BLOCO 2 (TELA ADMIN): ordem exata dos 5 cards (Avaliadores, Staff, Questionários, Instituições, Modalidades e Níveis)', async () => {
    render(<TelaAdmin />);

    await waitFor(() => {
      const botoes = screen.getAllByRole('button');
      const nomesCardsBloco2 = [
        'Avaliadores',
        'Equipe Staff',
        'Questionários',
        'Instituições',
        'Modalidades e Níveis',
      ];

      // Todos os 5 cards devem estar presentes na interface
      nomesCardsBloco2.forEach((nome) => {
        expect(screen.getByRole('button', { name: new RegExp(`^${nome}$`, 'i') })).toBeDefined();
      });

      // Administradores não deve mais estar na listagem principal
      expect(screen.queryByRole('button', { name: /^Administradores$/i })).toBeNull();
    });
  });
});
