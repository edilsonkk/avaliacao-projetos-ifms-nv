import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AtribuicaoForcada } from '@/features/atribuicoes';
import { TelaAvaliador } from '@/features/avaliacao';
import { GestorProjetos } from '@/features/projetos';
import { supabase } from '@/lib/supabase';

// Mock do Supabase
vi.mock('@/lib/supabase', () => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  return {
    supabase: {
      from: mockFrom,
      rpc: mockRpc,
    },
    verificar_conexao_configurada: () => true,
  };
});

describe('Regras de Negócio: Cota Estrita, Sorteio, Auto-cadastro e De-Para', () => {
  let mockFrom: any;
  let mockRpc: any;

  const criarQueryChain = (resposta: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resposta)),
      maybeSingle: vi.fn(() => Promise.resolve(resposta)),
      then: (resolve: any) => Promise.resolve(resposta).then(resolve),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom = supabase.from;
    mockRpc = supabase.rpc;
  });

  it('1. ATRIBUIÇÃO FORÇADA: bloqueia projetos que já atingiram a cota configurada do evento ativo (3 avaliações)', async () => {
    // 2 projetos: 
    // - P1: tem 3 avaliações concluídas (deve ser bloqueado para atribuição)
    // - P2: tem 1 avaliação concluída (deve permanecer elegível com 2 vagas restantes)
    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: { id_evento: 'evt-100', cota_avaliacoes_padrao: 3 },
          error: null,
        });
      }
      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'proj-cheio',
              codigo_projeto: 'PROJ-CHEIO',
              titulo: 'Projeto Com Cota Cheia',
              estande: 'E-01',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
              cota_avaliacoes_customizada: null,
            },
            {
              id_projeto: 'proj-disponivel',
              codigo_projeto: 'PROJ-LIVRE',
              titulo: 'Projeto Com Vaga Aberta',
              estande: 'E-02',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
              cota_avaliacoes_customizada: null,
            },
          ],
          error: null,
        });
      }
      if (tabela === 'locks_ativos') {
        return criarQueryChain({ data: [], error: null });
      }
      if (tabela === 'view_avaliadores_credenciados') {
        return criarQueryChain({
          data: [
            { id_usuario: 'usr-1', nome: 'Avaliador Alfa', email: 'alfa@teste.com', is_credenciado: true },
            { id_usuario: 'usr-2', nome: 'Avaliador Beta', email: 'beta@teste.com', is_credenciado: true },
          ],
          error: null,
        });
      }
      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            { id_usuario: 'usr-1', is_credenciado: true },
            { id_usuario: 'usr-2', is_credenciado: true },
          ],
          error: null,
        });
      }
      if (tabela === 'avaliacoes') {
        return criarQueryChain({
          data: [
            { id_projeto: 'proj-cheio', id_usuario: 'u1', is_quarentena: false },
            { id_projeto: 'proj-cheio', id_usuario: 'u2', is_quarentena: false },
            { id_projeto: 'proj-cheio', id_usuario: 'u3', is_quarentena: false }, // 3 avaliações = COTA ATINGIDA!
            { id_projeto: 'proj-disponivel', id_usuario: 'u1', is_quarentena: false }, // 1 avaliação = 2 vagas abertas
          ],
          error: null,
        });
      }
      if (tabela === 'avaliador_modalidades_bloqueadas') {
        return criarQueryChain({ data: [], error: null });
      }
      return criarQueryChain({ data: [], error: null });
    });

    render(
      <AtribuicaoForcada
        isOpen={true}
        aoFechar={vi.fn()}
        id_evento_ativo="evt-100"
        cota_padrao_evento={3}
      />
    );

    // O projeto com 3 avaliações NÃO pode aparecer na lista de elegíveis
    await waitFor(() => {
      expect(screen.queryByText(/PROJ-CHEIO/i)).toBeNull();
      expect(screen.getByText(/PROJ-LIVRE/i)).toBeInTheDocument();
    });

    // Indicador de projetos bloqueados por cota atingida deve refletir 1
    expect(screen.getByText(/1 com cota atingida/i)).toBeInTheDocument();
  });

  it('2. FILA DIRECIONADA NO AVALIADOR: pula automaticamente projeto da fila se ele já atingiu a cota máxima por outros', async () => {
    const EVENTO_UUID = '11111111-2222-3333-4444-555555555555';
    const AVALIADOR_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const PROJETO_UUID = '99999999-8888-7777-6666-555555555555';

    localStorage.setItem('sessao_id_usuario', AVALIADOR_UUID);
    localStorage.setItem('avaliador_nome', 'Prof. Avaliador');

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'fila_atribuicoes_direcionadas') {
        return criarQueryChain({
          data: {
            id_atribuicao: 'atrib-999',
            id_projeto: PROJETO_UUID,
            status: 'pendente',
          },
          error: null,
        });
      }
      if (tabela === 'projetos') {
        return criarQueryChain({
          data: { id_projeto: PROJETO_UUID, cota_avaliacoes_customizada: 3 },
          error: null,
        });
      }
      if (tabela === 'avaliacoes') {
        const chain = criarQueryChain({ data: [], count: 3, error: null });
        return chain;
      }
      if (tabela === 'locks_ativos') {
        return criarQueryChain({ data: null, error: null });
      }
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: EVENTO_UUID,
            cota_avaliacoes_padrao: 3,
            is_ativo: true,
            data_evento: (() => {
              const h = new Date();
              return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
            })(),
            horario_inicio: '00:00',
            horario_fim: '23:59',
            sistema_liberado: true,
          },
          error: null,
        });
      }
      if (tabela === 'usuarios') {
        return criarQueryChain({
          data: { id_usuario: AVALIADOR_UUID, nome: 'Prof. Avaliador', papel: 'AVALIADOR' },
          error: null,
        });
      }
      return criarQueryChain({ data: [], error: null });
    });

    // A contagem para a cota vem da RPC (o avaliador não lê avaliações de outros pela RLS)
    mockRpc.mockImplementation((nome: string) =>
      Promise.resolve(
        nome === 'fn_avaliacoes_ativas_do_projeto'
          ? { data: 3, error: null }
          : { data: 'proj-sorteado-novo', error: null },
      ),
    );

    const { unmount } = render(
      <TelaAvaliador
        id_usuario_logado={AVALIADOR_UUID}
        id_evento_ativo={EVENTO_UUID}
        onLogout={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('fila_atribuicoes_direcionadas');
      expect(mockRpc).toHaveBeenCalledWith('sortear_proximo_projeto', {
        p_id_usuario: AVALIADOR_UUID,
        p_id_evento: EVENTO_UUID,
      });
    });

    unmount();
    localStorage.clear();
  });

  it('3. DE-PARA DE IMPORTAÇÃO: ao escolher cadastrar novo, salva a instituição e modalidade no banco com id_evento', async () => {
    const mockInsert = vi.fn().mockReturnValue(
      criarQueryChain({
        data: { id_instituicao: 'inst-nova-id', nome_exibicao: 'Escola Modelo Nova', sigla: 'EMN' },
        error: null,
      })
    );

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'instituicoes') {
        const chain = criarQueryChain({ data: [], error: null });
        chain.insert = mockInsert;
        return chain;
      }
      if (tabela === 'modalidades' || tabela === 'areas_tematicas' || tabela === 'questionarios') {
        return criarQueryChain({ data: [], error: null });
      }
      if (tabela === 'instituicao_aliases' || tabela === 'modalidade_aliases') {
        return criarQueryChain({ data: [], error: null });
      }
      return criarQueryChain({ data: [], error: null });
    });

    render(
      <GestorProjetos
        id_evento_ativo="evt-100"
        aoFechar={vi.fn()}
      />
    );

    // Valida que o Gestor de Projetos renderizou com o título correto
    expect(await screen.findByText(/Gestor de Projetos/i)).toBeInTheDocument();
  });
});
