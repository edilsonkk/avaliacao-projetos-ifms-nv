import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ModalExclusaoAvaliacao } from '@/features/atribuicoes';

// Mock do módulo supabase
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/supabase', () => ({
  verificar_conexao_configurada: () => true,
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    from: (...args: any[]) => mockFrom(...args),
  },
}));

describe('ModalExclusaoAvaliacao - Testes Detalhados das Novas Especificações', () => {
  const dadosAvaliacoes = [
    {
      id_avaliacao: 'av-101',
      id_projeto: 'proj-1',
      id_usuario: 'user-1',
      nota_final: 9.5,
      status: 'CONCLUIDA',
      status_avaliacao: 'concluida',
      parecer_final: 'Excelente trabalho na parte de hardware.',
      is_quarentena: false,
      projetos: {
        id_projeto: 'proj-1',
        codigo_projeto: 'AGRO-01',
        titulo: 'Sistema de Irrigação Inteligente',
        estande: 'E-12',
        area_tematica: 'CIÊNCIAS AGRÁRIAS',
      },
      usuarios: {
        id_usuario: 'user-1',
        nome: 'Prof. Carlos Eduardo',
        email: 'carlos.edu@ifms.edu.br',
      },
      respostas_avaliacao: [
        {
          id_resposta: 'resp-1',
          id_pergunta: 'p-1',
          nota_atribuida: 10.0,
          perguntas_questionario: {
            texto_pergunta: 'Domínio do Conteúdo',
            peso_calculo: 1,
          },
        },
        {
          id_resposta: 'resp-2',
          id_pergunta: 'p-2',
          nota_atribuida: 9.0,
          perguntas_questionario: {
            texto_pergunta: 'Clareza na Apresentação',
            peso_calculo: 1,
          },
        },
      ],
    },
    {
      id_avaliacao: 'av-102',
      id_projeto: 'proj-2',
      id_usuario: 'user-2',
      nota_final: 7.0,
      status: 'CONCLUIDA',
      status_avaliacao: 'concluida',
      parecer_final: null,
      is_quarentena: false,
      projetos: {
        id_projeto: 'proj-2',
        codigo_projeto: 'BIO-05',
        titulo: 'Análise de Solo com Fungos Nativos',
        estande: 'B-04',
        area_conhecimento: 'CIÊNCIAS BIOLÓGICAS',
      },
      usuarios: {
        id_usuario: 'user-2',
        nome: 'Dra. Beatriz Santos',
        email: 'beatriz.santos@ufms.br',
      },
      respostas_avaliacao: [],
    },
  ];

  const dadosAreasTematicas = [
    { id_area: 'area-1', nome_area: 'CIÊNCIAS AGRÁRIAS' },
    { id_area: 'area-2', nome_area: 'CIÊNCIAS BIOLÓGICAS' },
    { id_area: 'area-3', nome_area: 'ENGENHARIAS' },
  ];

  const dadosAvaliadorAreas = [
    { id_usuario: 'user-1', id_area: 'area-1', id_evento: 'evt-2026' },
    { id_usuario: 'user-1', id_area: 'area-3', id_evento: 'evt-2026' },
    { id_usuario: 'user-2', id_area: 'area-2', id_evento: 'evt-2026' },
  ];

  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      update: vi.fn((dados: any) => {
        mockUpdate(dados);
        return chain;
      }),
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockRpc.mockResolvedValue({
      data: { sucesso: true, mensagem: 'Operação realizada com sucesso.' },
      error: null,
    });

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'areas_tematicas') {
        return criarQueryChain({ data: dadosAreasTematicas, error: null });
      }
      if (tabela === 'avaliador_areas') {
        return criarQueryChain({ data: dadosAvaliadorAreas, error: null });
      }
      if (tabela === 'avaliacoes') {
        return criarQueryChain({ data: dadosAvaliacoes, error: null });
      }
      return criarQueryChain({ data: [], error: null });
    });
  });

  it('1. Limpeza Visual: não deve conter o texto "SOFT DELETE & AUDITORIA" e o placeholder não deve ter "(FETEC-001)"', async () => {
    render(<ModalExclusaoAvaliacao ao_fechar={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Exclusão de Avaliações')).toBeDefined();
    });

    // Badge "Soft Delete & Auditoria" não deve existir no cabeçalho
    expect(screen.queryByText(/Soft Delete & Auditoria/i)).toBeNull();

    // Placeholder do filtro deve estar limpo
    const inputBusca = screen.getByPlaceholderText('Buscar por código, título do projeto ou avaliador...');
    expect(inputBusca).toBeDefined();
    expect(inputBusca.getAttribute('placeholder')).not.toContain('(FETEC-001)');
  });

  it('2. Colunas da Listagem: exibe corretamente código, nome e área do projeto, nome e área do avaliador, critérios e excluir', async () => {
    const { container } = render(<ModalExclusaoAvaliacao ao_fechar={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText(/Carregando avaliações/i)).toBeNull();
    });

    await waitFor(() => {
      // Cabeçalhos de coluna na tabela
      const ths = within(container).getAllByRole('columnheader');
      expect(ths.length).toBe(7);
      expect(screen.getByText('Nome do Projeto')).toBeDefined();
      expect(screen.getByText('Área do Projeto')).toBeDefined();
      expect(screen.getByText('Nome do Avaliador')).toBeDefined();
      expect(screen.getByText('Área do Avaliador')).toBeDefined();
      expect(screen.getAllByText('Critérios')[0]).toBeDefined();
      expect(screen.getByText('Excluir')).toBeDefined();
    });

    // Dados das linhas
    await waitFor(() => {
      expect(screen.getByText('AGRO-01')).toBeDefined();
      expect(screen.getByText('Sistema de Irrigação Inteligente')).toBeDefined();
      expect(screen.getAllByText('CIÊNCIAS AGRÁRIAS').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Prof. Carlos Eduardo')).toBeDefined();
      // Avaliador user-1 tem duas áreas vinculadas: CIÊNCIAS AGRÁRIAS e ENGENHARIAS
      expect(screen.getByText('ENGENHARIAS')).toBeDefined();
      expect(screen.getByText('9.5')).toBeDefined();
    });
  });

  it('3. Ordenamento de Colunas: permite alternar ordenação por código, nome, área, avaliador e critérios', async () => {
    render(<ModalExclusaoAvaliacao ao_fechar={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('AGRO-01')).toBeDefined();
    });

    const thNomeProjeto = screen.getByText('Nome do Projeto').closest('th');
    expect(thNomeProjeto).toBeDefined();

    // Clica para ordenar por Nome do Projeto
    fireEvent.click(thNomeProjeto!);
    // Clica novamente para inverter ordem desc
    fireEvent.click(thNomeProjeto!);

    // Clica para ordenar por Critérios
    const thCriterios = screen.getAllByText('Critérios')[0].closest('th');
    expect(thCriterios).toBeDefined();
    fireEvent.click(thCriterios!);

    // Clica para ordenar por Área do Projeto
    const thAreaProjeto = screen.getByText('Área do Projeto').closest('th');
    expect(thAreaProjeto).toBeDefined();
    fireEvent.click(thAreaProjeto!);
  });

  it('4. Detalhamento de Critérios: expande accordion exibindo notas por critério e parecer', async () => {
    render(<ModalExclusaoAvaliacao ao_fechar={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('AGRO-01')).toBeDefined();
    });

    // Localiza e clica no botão "Critérios" da primeira avaliação
    const botoesCriterios = screen.getAllByRole('button', { name: /Critérios/i });
    fireEvent.click(botoesCriterios[0]);

    await waitFor(() => {
      expect(screen.getByText(/Detalhamento dos Critérios Avaliados/i)).toBeDefined();
      expect(screen.getByText(/Domínio do Conteúdo/i)).toBeDefined();
      expect(screen.getByText('10.0')).toBeDefined();
      expect(screen.getByText(/Clareza na Apresentação/i)).toBeDefined();
      expect(screen.getByText('9.0')).toBeDefined();
      expect(screen.getByText(/Excelente trabalho na parte de hardware/i)).toBeDefined();
    });
  });

  it('5. Tela de Confirmação: exibe modal detalhado de alerta antes da exclusão com todas as informações', async () => {
    render(<ModalExclusaoAvaliacao ao_fechar={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('AGRO-01')).toBeDefined();
    });

    // Clica no ícone de lixeira da linha AGRO-01
    const botoesLixeira = screen.getAllByTitle('Excluir Avaliação');
    fireEvent.click(botoesLixeira[0]);

    // Modal de confirmação surge com os dados da avaliação
    await waitFor(() => {
      expect(screen.getByText('Confirmar Cancelamento?')).toBeDefined();
      expect(screen.getByText('Código do Projeto:')).toBeDefined();
      expect(screen.getByText('Área do Projeto:')).toBeDefined();
      expect(screen.getByText('Área(s) do Avaliador:')).toBeDefined();
      expect(screen.getByRole('button', { name: /Confirmar Exclusão/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Cancelar/i })).toBeDefined();
    });

    // Clica em Cancelar
    const btnCancelar = screen.getByRole('button', { name: /Cancelar/i });
    fireEvent.click(btnCancelar);

    // O modal deve fechar
    await waitFor(() => {
      expect(screen.queryByText('Confirmar Cancelamento?')).toBeNull();
    });
  });

  it('6. Execução via RPC: confirmação chama excluir_avaliacao e exibe toast com opção de Desfazer', async () => {
    const mockSucesso = vi.fn();
    render(<ModalExclusaoAvaliacao ao_fechar={vi.fn()} aoSucesso={mockSucesso} />);

    await waitFor(() => {
      expect(screen.getByText('AGRO-01')).toBeDefined();
    });

    // Abre diálogo de confirmação
    const botoesLixeira = screen.getAllByTitle('Excluir Avaliação');
    fireEvent.click(botoesLixeira[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Confirmar Exclusão/i })).toBeDefined();
    });

    // Confirma exclusão
    const btnConfirmar = screen.getByRole('button', { name: /Confirmar Exclusão/i });
    fireEvent.click(btnConfirmar);

    // Verifica que RPC foi disparada
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('excluir_avaliacao', {
        p_id_avaliacao: 'av-101',
      });
      expect(mockSucesso).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Desfazer/i })).toBeDefined();
    });

    // Clica em Desfazer
    const btnDesfazer = screen.getByRole('button', { name: /Desfazer/i });
    fireEvent.click(btnDesfazer);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('restaurar_avaliacao', {
        p_id_avaliacao: 'av-101',
      });
    });
  });

  it('7. Blindagem contra N/I: se o join inicial vier cru sem objetos embutidos, enriquece em lote por IDs', async () => {
    // Simula avaliações cruas sem objetos 'projetos' ou 'usuarios' aninhados
    const avaliacoesCruas = [
      {
        id_avaliacao: 'av-raw-1',
        id_projeto: 'proj-raw-1',
        id_usuario: 'user-raw-1',
        nota_final: 8.8,
        status: 'CONCLUIDA',
        status_avaliacao: 'concluida',
        parecer_final: null,
      },
    ];

    const projetosBanco = [
      {
        id_projeto: 'proj-raw-1',
        codigo_projeto: 'ENGI-03',
        titulo: 'Robô Seguidor de Linha para Automação',
        estande: 'C-08',
        id_area: 'area-3',
        id_evento: 'evt-2026',
      },
    ];

    const usuariosBanco = [
      {
        id_usuario: 'user-raw-1',
        nome: 'Prof. Rafael Mendonça',
        email: 'rafael.mendonca@ifms.edu.br',
      },
    ];

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'avaliacoes') {
        return criarQueryChain({ data: avaliacoesCruas, error: null });
      }
      if (tabela === 'projetos') {
        return criarQueryChain({ data: projetosBanco, error: null });
      }
      if (tabela === 'usuarios') {
        return criarQueryChain({ data: usuariosBanco, error: null });
      }
      if (tabela === 'areas_tematicas') {
        return criarQueryChain({ data: dadosAreasTematicas, error: null });
      }
      if (tabela === 'avaliador_areas') {
        return criarQueryChain({ data: dadosAvaliadorAreas, error: null });
      }
      return criarQueryChain({ data: [], error: null });
    });

    render(<ModalExclusaoAvaliacao id_evento_ativo="evt-2026" ao_fechar={vi.fn()} />);

    // Deve resolver os dados enriquecidos sem exibir 'N/I' ou 'Título não especificado'
    await waitFor(() => {
      expect(screen.getByText('ENGI-03')).toBeDefined();
      expect(screen.getByText('Robô Seguidor de Linha para Automação')).toBeDefined();
      expect(screen.getByText('Prof. Rafael Mendonça')).toBeDefined();
      expect(screen.queryByText('N/I')).toBeNull();
      expect(screen.queryByText('Título não especificado')).toBeNull();
      expect(screen.queryByText('Avaliador não identificado')).toBeNull();
    });
  });
});

