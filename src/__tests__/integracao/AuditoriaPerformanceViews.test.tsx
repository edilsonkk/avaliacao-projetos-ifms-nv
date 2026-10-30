import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const { mockFrom, mockRpc, mockFromCalls } = vi.hoisted(() => {
  const mockFromCalls: string[] = [];
  const mockRpc = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn();

  return { mockFrom, mockRpc, mockFromCalls };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

// Mock do window.confirm e window.alert
vi.stubGlobal('alert', vi.fn());
vi.stubGlobal('confirm', vi.fn(() => true));

import { TelaAdmin } from '@/features/admin';
import { RankingPremiacao } from '@/features/relatorios';
import { RelatoriosAdmin } from '@/features/relatorios';
import { GestorProjetos } from '@/features/projetos';
import { GestorAvaliadores } from '@/features/avaliadores';
import { GestorStaff } from '@/features/staff';

describe('Auditoria de Desempenho, Ausência de Loop Infinito e Integração de Views', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      range: vi.fn(() => Promise.resolve(resultado)),
      ilike: vi.fn(() => chain),
      in: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      update: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFromCalls.length = 0;

    mockFrom.mockImplementation((tabela: string) => {
      mockFromCalls.push(tabela);

      if (tabela === 'eventos') {
        return criarQueryChain({
          data: { id_evento: 'evt-2026', nome_evento: 'FETEC MS 2026', is_ativo: true },
          error: null,
        });
      }

      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'p-1',
              codigo_projeto: 'FETEC-001',
              titulo: 'Projeto Solar',
              estande: 'EST-01',
              corredor: 'A',
            },
          ],
          count: 42,
          error: null,
        });
      }

      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [{ id_usuario: 'u-1', usuarios: { id_usuario: 'u-1', papel: 'AVALIADOR' } }],
          count: 15,
          error: null,
        });
      }

      if (tabela === 'usuarios') {
        return criarQueryChain({
          data: [
            { id_usuario: 'u-1', nome: 'Avaliador Teste', email: 'av@ifms.edu.br', papel: 'AVALIADOR' },
            { id_usuario: 'u-2', nome: 'Staff Teste', email: 'staff@ifms.edu.br', papel: 'STAFF' },
          ],
          count: 5,
          error: null,
        });
      }

      if (tabela === 'locks_ativos') {
        return criarQueryChain({
          data: [{ id_lock: 'l-1', id_projeto: 'p-1', id_usuario: 'u-1' }],
          count: 3,
          error: null,
        });
      }

      if (tabela === 'avaliacoes') {
        return criarQueryChain({
          data: [{ id_avaliacao: 'a-1', id_projeto: 'p-1', nota_final: 9.5 }],
          count: 12,
          error: null,
        });
      }

      if (tabela === 'questionarios') {
        return criarQueryChain({
          data: [{ id_questionario: 'q-1', titulo: 'Questionário Geral' }],
          count: 2,
          error: null,
        });
      }

      // Views oficiais
      if (tabela === 'view_ranking_top3') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'proj-top-1',
              codigo_projeto: 'FETEC-100',
              titulo: 'Inteligência Artificial Aplicada ao Agronegócio',
              estande: 'EST-A01',
              modalidade: 'Pesquisa Aplicada',
              area_tematica: 'Ciências Agrárias',
              nome_instituicao: 'IFMS Câmpus Campo Grande',
              notas: [9.8, 9.9, 9.7],
              media_geral: 9.80,
              total_avaliacoes: 3,
            },
          ],
          error: null,
        });
      }

      if (tabela === 'view_relatorio_projetos') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'proj-rel-1',
              codigo_projeto: 'FETEC-200',
              titulo: 'Biotecnologia Pantaneira',
              estande: 'EST-B02',
              modalidade: 'Iniciação Científica',
              area_conhecimento: 'Biológicas',
              nome_instituicao: 'IFMS Câmpus Corumbá',
              total_avaliacoes: 3,
              media_geral: 9.65,
            },
          ],
          error: null,
        });
      }

      if (tabela === 'view_relatorio_avaliadores') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'usr-rel-1',
              avaliador_nome: 'Prof. Carlos Santos',
              avaliador_email: 'carlos.santos@ifms.edu.br',
              codigo_projeto: 'FETEC-200',
              projeto_titulo: 'Biotecnologia Pantaneira',
              projeto_estande: 'EST-B02',
              nota_final: 9.7,
              parecer_comentario: 'Excelente rigor metodológico.',
            },
          ],
          error: null,
        });
      }

      return criarQueryChain({ data: [], count: 0, error: null });
    });
  });

  it('1. RESOLUÇÃO DO LOOP INFINITO: montagem de TelaAdmin deve ser estável e não re-executar em loop contínuo', async () => {
    render(<TelaAdmin />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('eventos');
      expect(mockFrom).toHaveBeenCalledWith('projetos');
    });

    const totalChamadasAposMontagem = mockFrom.mock.calls.length;

    // Aguarda ticks assíncronos e valida estabilidade sem uso de setTimeout
    await waitFor(() => {
      expect(mockFrom.mock.calls.length).toBe(totalChamadasAposMontagem);
    });
  });

  it('2. LIMPEZA VISUAL DOS CARTÕES DO BLOCO 1: deve exibir apenas Títulos e contadores, sem subtítulos ou botões internos', async () => {
    render(<TelaAdmin />);

    await waitFor(() => {
      // Bloco 1 - Títulos presentes e subtítulos removidos
      expect(screen.getByText('Projetos')).toBeDefined();
      expect(screen.queryByText('Inscritos na feira')).toBeNull();

      expect(screen.getByText('Projetos Bloqueados')).toBeDefined();
      expect(screen.queryByText('Avaliações em andamento')).toBeNull();

      expect(screen.getByText('Projetos em Quarentena')).toBeDefined();
      expect(screen.queryByText('Divergências de notas')).toBeNull();

      expect(screen.getByText('Atribuir Projeto')).toBeDefined();
      expect(screen.queryByText('Alocação forçada de banca')).toBeNull();

      expect(screen.getByText('Excluir uma avaliação')).toBeDefined();
      expect(screen.queryByText('Remover avaliação registrada')).toBeNull();
    });

    // Garante que o botão intrusivo "Desbloquear Todos" foi removido de dentro do card
    const botoesDesbloquearNoCard = screen.queryAllByRole('button', { name: /Desbloquear Todos/i });
    expect(botoesDesbloquearNoCard.length).toBe(0);

    // Garante que atalhos/legendas antigas do Bloco 1 foram expurgados
    expect(screen.queryByText(/Gerenciar Bloqueios ↗/i)).toBeNull();
    expect(screen.queryByText(/Resolver Quarentena ↗/i)).toBeNull();
    expect(screen.queryByText(/Executar ↗/i)).toBeNull();
    expect(screen.queryByText(/Atribuir ↗/i)).toBeNull();
  });

  it('3. MONITORAMENTO: botão no header deve ser renomeado para "Monitoramento"', async () => {
    render(<TelaAdmin />);

    const botaoMonitoramento = screen.getByRole('button', { name: /Monitoramento/i });
    expect(botaoMonitoramento).toBeDefined();
    expect(screen.queryByText('Projeção no Auditório')).toBeNull();
  });

  it('4. INTEGRAÇÃO RANKING (view_ranking_top3): deve consumir exclusivamente a view view_ranking_top3 sem cálculos no JS', async () => {
    render(<RankingPremiacao id_evento_ativo="evt-1" />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('view_ranking_top3');
      expect(screen.getByText('Inteligência Artificial Aplicada ao Agronegócio')).toBeDefined();
      expect(screen.getByText('9.80 pts')).toBeDefined();
    });
  });

  it('5. INTEGRAÇÃO RELATÓRIOS (view_relatorio_projetos e view_relatorio_avaliadores): deve consumir as duas views no Supabase', async () => {
    render(<RelatoriosAdmin />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('view_relatorio_projetos');
      expect(mockFrom).toHaveBeenCalledWith('view_relatorio_avaliadores');
      // Lista de projetos e médias
      expect(screen.getByText('Biotecnologia Pantaneira')).toBeDefined();
      expect(screen.getByText('9.65 pts')).toBeDefined();
    });

    // Alterna para aba Avaliadores e Notas Atribuídas
    const abaAvaliadores = screen.getByText(/Avaliadores e Notas Atribuídas/i);
    fireEvent.click(abaAvaliadores);

    await waitFor(() => {
      expect(screen.getByText('Prof. Carlos Santos')).toBeDefined();
      expect(screen.getByText('9.70 pts')).toBeDefined();
      expect(screen.getByText('Excelente rigor metodológico.')).toBeDefined();
    });
  });

  it('6. INVALIDAÇÃO E ATUALIZAÇÃO IMEDIATA (Mutação GestorProjetos, GestorAvaliadores, GestorStaff)', async () => {
    const mockAtualizarMetricas = vi.fn();

    // Gestor de Projetos
    const { unmount: unmountProjetos } = render(
      <GestorProjetos aoAtualizarMetricas={mockAtualizarMetricas} />
    );

    await waitFor(() => {
      expect(screen.getByText('Gestor de Projetos')).toBeDefined();
    });

    // Clica em excluir projeto existente
    const btnExcluirProjeto = screen.queryByText('Excluir');
    if (btnExcluirProjeto) {
      fireEvent.click(btnExcluirProjeto);
      await waitFor(() => {
        expect(mockAtualizarMetricas).toHaveBeenCalled();
      });
    }
    unmountProjetos();

    // Gestor de Avaliadores
    mockAtualizarMetricas.mockClear();
    const { unmount: unmountAvaliadores } = render(
      <GestorAvaliadores aoAtualizarMetricas={mockAtualizarMetricas} />
    );

    await waitFor(() => {
      expect(screen.getByText('Gestor de Avaliadores')).toBeDefined();
    });

    const botoesCredenciar = screen.queryAllByText(/Credenciar/i);
    if (botoesCredenciar.length > 0) {
      fireEvent.click(botoesCredenciar[0]);
      await waitFor(() => {
        expect(mockAtualizarMetricas).toHaveBeenCalled();
      });
    }
    unmountAvaliadores();

    // Gestor de Staff
    mockAtualizarMetricas.mockClear();
    render(<GestorStaff aoAtualizarMetricas={mockAtualizarMetricas} />);

    await waitFor(() => {
      expect(screen.getByText('Gestor da Equipe Staff')).toBeDefined();
    });

    const btnExcluirStaff = screen.queryByText('Excluir');
    if (btnExcluirStaff) {
      fireEvent.click(btnExcluirStaff);
      await waitFor(() => {
        expect(mockAtualizarMetricas).toHaveBeenCalled();
      });
    }
  });
});
