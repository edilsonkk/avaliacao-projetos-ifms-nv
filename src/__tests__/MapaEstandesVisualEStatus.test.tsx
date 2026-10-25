import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MapaEstandes } from '../components/MapaEstandes';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => {
  const mockFrom = vi.fn();
  return {
    supabase: {
      from: mockFrom
    },
    verificar_conexao_configurada: vi.fn(() => true)
  };
});

describe('MapaEstandes: Visualização Expandida, Cores e Badges de Notas', () => {
  const mockProjetos = [
    {
      id_projeto: 'p-01',
      id_evento: 'evt-2026',
      codigo_projeto: 'FETEC-001',
      titulo: 'Robô Pantaneiro Autônomo',
      estande: 'A-01',
      corredor: 'Corredor A',
      is_check_in_realizado: true, // Credenciado com 3 avaliações => 'avaliado'
      modalidades: { nome_modalidade: 'Engenharia' },
      areas_tematicas: { nome_area: 'Robótica' },
      instituicoes: { nome_exibicao: 'IFMS Câmpus Campo Grande' }
    },
    {
      id_projeto: 'p-02',
      id_evento: 'evt-2026',
      codigo_projeto: 'FETEC-002',
      titulo: 'Extratos Botânicos Medicinais',
      estande: 'A-02',
      corredor: 'Corredor A',
      is_check_in_realizado: false, // Não credenciado => 'nao_credenciado'
      modalidades: { nome_modalidade: 'Biológicas' },
      areas_tematicas: { nome_area: 'Farmacologia' },
      instituicoes: { nome_exibicao: 'Escola Estadual Pantanal' }
    },
    {
      id_projeto: 'p-03',
      id_evento: 'evt-2026',
      codigo_projeto: 'FETEC-003',
      titulo: 'Sistema IoT para Monitoramento de Queimadas',
      estande: 'B-01',
      corredor: 'Corredor B',
      is_check_in_realizado: true, // Credenciado com 1 avaliação de 3 => 'faltando'
      modalidades: { nome_modalidade: 'Informática' },
      areas_tematicas: { nome_area: 'Sistemas' },
      instituicoes: { nome_exibicao: 'IFMS Câmpus Corumbá' }
    },
    {
      id_projeto: 'p-04',
      id_evento: 'evt-2026',
      codigo_projeto: 'FETEC-004',
      titulo: 'Tratamento de Efluentes com Moringa',
      estande: null, // Sem estande => vai para 'Sem Estande Atribuído'
      corredor: null,
      is_check_in_realizado: true, // Credenciado com 0 avaliações => 'credenciado'
      modalidades: { nome_modalidade: 'Química' },
      areas_tematicas: { nome_area: 'Meio Ambiente' },
      instituicoes: { nome_exibicao: 'Colégio Militar' }
    }
  ];

  const mockAvaliacoes = [
    // p-01 tem 3 avaliações (cota atingida = avaliado)
    { id_avaliacao: 'av-1', id_projeto: 'p-01', nota_final: 9.5, is_quarentena: false, status: 'CONCLUIDA' },
    { id_avaliacao: 'av-2', id_projeto: 'p-01', nota_final: 8.5, is_quarentena: false, status: 'CONCLUIDA' },
    { id_avaliacao: 'av-3', id_projeto: 'p-01', nota_final: 9.0, is_quarentena: false, status: 'CONCLUIDA' },
    // p-03 tem 1 avaliação (faltando)
    { id_avaliacao: 'av-4', id_projeto: 'p-03', nota_final: 10.0, is_quarentena: false, status: 'CONCLUIDA' }
  ];

  const mockLocks = [
    { id_projeto: 'p-03' } // p-03 tem lock ativo
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    (supabase.from as any).mockImplementation((tabela: string) => {
      if (tabela === 'projetos') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockProjetos, error: null })
            }),
            order: vi.fn().mockResolvedValue({ data: mockProjetos, error: null })
          })
        };
      }
      if (tabela === 'avaliacoes') {
        return {
          select: vi.fn().mockImplementation((campos: string) => {
            if (campos.includes('parecer_final')) {
              // Chamada do modal de auditoria
              return {
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id_avaliacao: 'av-1',
                        nota_final: 9.5,
                        parecer_final: 'Excelente trabalho!',
                        created_at: '2026-10-25T10:00:00Z',
                        usuarios: { nome: 'Prof. Carlos Dr.', email: 'carlos@ifms.edu.br' }
                      }
                    ],
                    error: null
                  })
                })
              };
            }
            return Promise.resolve({ data: mockAvaliacoes, error: null });
          })
        };
      }
      if (tabela === 'locks_ativos') {
        return {
          select: vi.fn().mockResolvedValue({ data: mockLocks, error: null })
        };
      }
      if (tabela === 'eventos') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { cota_avaliacoes_padrao: 3 },
                error: null
              })
            })
          })
        };
      }
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      };
    });
  });

  it('1. RENDERIZAÇÃO INICIAL: agrupa projetos por corredores e projeta projetos sem estande em seção separada', async () => {
    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
      />
    );

    await waitFor(() => {
      // Corredor A
      expect(screen.getByText('Corredor A')).toBeDefined();
      // Corredor B
      expect(screen.getByText('Corredor B')).toBeDefined();
      // Sem Estande
      expect(screen.getByText('Sem Estande Atribuído')).toBeDefined();
    });

    // Projetos renderizados
    expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    expect(screen.getByText('Extratos Botânicos Medicinais')).toBeDefined();
    expect(screen.getByText('Sistema IoT para Monitoramento de Queimadas')).toBeDefined();
    expect(screen.getByText('Tratamento de Efluentes com Moringa')).toBeDefined();
  });

  it('2. VALIDAÇÃO DOS 4 ESTADOS DE CORES E STATUS: Não Credenciado, Credenciado, Faltando e Avaliado', async () => {
    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // p-01: Avaliado (3/3 cota)
    expect(screen.getByText('Avaliado (3/3)')).toBeDefined();

    // p-02: Não Credenciado (is_check_in_realizado = false)
    expect(screen.getAllByText('Não Credenciado').length).toBeGreaterThanOrEqual(1);

    // p-03: Faltando Avaliações (1/3 cota -> Faltam 2)
    expect(screen.getByText('Faltam 2 aval.')).toBeDefined();

    // p-04: Credenciado (is_check_in_realizado = true e 0 avaliações)
    expect(screen.getAllByText('Credenciado').length).toBeGreaterThanOrEqual(1);
  });

  it('3. MÉDIA GERAL E BADGES DE NOTAS INDIVIDUAIS: exibe média calculada e notas em badges pequenos', async () => {
    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Média de p-01: (9.5 + 8.5 + 9.0) / 3 = 9.00 pts
    expect(screen.getByText('9.00 pts')).toBeDefined();

    // Badges das notas individuais de p-01
    expect(screen.getByText('9.5')).toBeDefined();
    expect(screen.getByText('8.5')).toBeDefined();
    expect(screen.getByText('9.0')).toBeDefined();

    // Média de p-03: 10.00 pts
    expect(screen.getByText('10.00 pts')).toBeDefined();
    expect(screen.getByText('10.0')).toBeDefined();

    // p-02 e p-04 não possuem notas
    expect(screen.getAllByText('Nenhuma nota atribuída ainda').length).toBe(2);
  });

  it('4. SELETOR DE ZOOM / DENSIDADE: alterna entre Cards Grandes e Compacto', async () => {
    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Clica no botão "Compacto"
    const btnCompacto = screen.getByTitle('Cards Compactos (Mais por Linha)');
    fireEvent.click(btnCompacto);

    // No modo compacto, o texto reduzido de cota aparece
    expect(screen.getByText('3/3')).toBeDefined();

    // Volta para "Cards Grandes"
    const btnGrandes = screen.getByTitle('Cards Grandes e Detalhados');
    fireEvent.click(btnGrandes);

    expect(screen.getByText('Avaliado (3/3)')).toBeDefined();
  });

  it('5. FILTRAGEM POR STATUS: filtra a grade apenas para os projetos do status clicado', async () => {
    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Clica no filtro "Avaliado (1)"
    const btnFiltroAvaliado = screen.getByRole('button', { name: /Avaliado \(1\)/i });
    fireEvent.click(btnFiltroAvaliado);

    // Somente Robô Pantaneiro Autônomo deve estar visível
    expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    expect(screen.queryByText('Extratos Botânicos Medicinais')).toBeNull();
    expect(screen.queryByText('Sistema IoT para Monitoramento de Queimadas')).toBeNull();

    // Clica em "Todos (4)"
    const btnTodos = screen.getByRole('button', { name: /Todos \(4\)/i });
    fireEvent.click(btnTodos);

    expect(screen.getByText('Extratos Botânicos Medicinais')).toBeDefined();
  });

  it('6. BUSCA TEXTUAL: filtra por estande, código ou título do projeto', async () => {
    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    const inputBusca = screen.getByPlaceholderText('Buscar por estande, código, título...');
    fireEvent.change(inputBusca, { target: { value: 'FETEC-003' } });

    expect(screen.getByText('Sistema IoT para Monitoramento de Queimadas')).toBeDefined();
    expect(screen.queryByText('Robô Pantaneiro Autônomo')).toBeNull();
  });

  it('7. MODAL DE AUDITORIA: ao clicar no bloco de projeto, abre modal detalhado com notas e botão de edição', async () => {
    const mockAoEditar = vi.fn();
    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
        aoEditarProjeto={mockAoEditar}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Clica no card do Robô Pantaneiro Autônomo
    const cardProjeto = screen.getByText('Robô Pantaneiro Autônomo').closest('button');
    expect(cardProjeto).not.toBeNull();
    fireEvent.click(cardProjeto!);

    await waitFor(() => {
      // Modal de auditoria aberto
      expect(screen.getByText('Prof. Carlos Dr.')).toBeDefined();
      expect(screen.getByText(/Excelente trabalho!/i)).toBeDefined();
      expect(screen.getByText('Editar Dados do Projeto')).toBeDefined();
    });

    // Clica no botão "Editar Dados do Projeto"
    const btnEditar = screen.getByRole('button', { name: /Editar Dados do Projeto/i });
    fireEvent.click(btnEditar);

    expect(mockAoEditar).toHaveBeenCalledWith('p-01');
  });

  it('8. MODO TELA CHEIA (FULLSCREEN): alterna a classe de visualização para ocupar 100vw x 100vh', async () => {
    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    const btnFullscreen = screen.getByTitle('Modo Tela Cheia (Expandir Janela)');
    fireEvent.click(btnFullscreen);

    expect(screen.getByTitle('Sair da Tela Cheia')).toBeDefined();
  });

  it('9. RESILIÊNCIA A ERROS DE SCHEMA: se a query relacional falhar por ausência de FK ou coluna, aciona fallback para colunas base sem crashar', async () => {
    let primeiraChamada = true;
    (supabase.from as any).mockImplementation((tabela: string) => {
      if (tabela === 'projetos') {
        return {
          select: vi.fn().mockImplementation((campos: string) => {
            if (primeiraChamada) {
              primeiraChamada = false;
              // Simula o erro do Supabase reportado pelo usuário
              return {
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'column projetos.modalidade does not exist' }
                  })
                }),
                order: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'column projetos.modalidade does not exist' }
                })
              };
            }
            // Segunda chamada: Fallback com colunas base nativas
            return {
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id_projeto: 'p-fallback',
                      id_evento: 'evt-2026',
                      codigo_projeto: 'FETEC-999',
                      titulo: 'Projeto Resiliente em Modo Fallback',
                      estande: 'C-01',
                      corredor: 'Corredor C',
                      is_check_in_realizado: true
                    }
                  ],
                  error: null
                })
              }),
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id_projeto: 'p-fallback',
                    id_evento: 'evt-2026',
                    codigo_projeto: 'FETEC-999',
                    titulo: 'Projeto Resiliente em Modo Fallback',
                    estande: 'C-01',
                    corredor: 'Corredor C',
                    is_check_in_realizado: true
                  }
                ],
                error: null
              })
            };
          })
        };
      }
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      };
    });

    render(
      <MapaEstandes
        id_evento_ativo="evt-2026"
        cota_padrao_evento={3}
      />
    );

    await waitFor(() => {
      // O projeto do fallback deve ser renderizado com sucesso
      expect(screen.getByText('Projeto Resiliente em Modo Fallback')).toBeDefined();
      expect(screen.getByText('Corredor C')).toBeDefined();
      expect(screen.getByText('C-01')).toBeDefined();
    });
  });
});
