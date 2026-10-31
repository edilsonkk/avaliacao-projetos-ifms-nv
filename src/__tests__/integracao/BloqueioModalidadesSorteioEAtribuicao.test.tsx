import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GestorAvaliadores } from '@/features/avaliadores';
import { AtribuicaoForcada } from '@/features/atribuicoes';
import { TelaAvaliador } from '@/features/avaliacao';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null }) },
  },
  isSupabaseConfigured: () => true,
  verificar_conexao_configurada: () => true,
}));

describe('Auditoria de Regressão: Bloqueio Estrito por Modalidade no Sorteio e Atribuição', () => {
  const eventoIdTeste = 'e0000000-0000-0000-0000-000000000001';
  const usuarioAvaliadorId = 'u0000000-0000-0000-0000-000000000001';
  const modalidadeBloqueadaId = 'm0000000-0000-0000-0000-000000000001';
  const modalidadeLivreId = 'm0000000-0000-0000-0000-000000000002';

  let chamadasDeleteLocks: any[] = [];
  let chamadasInsertBloqueios: any[] = [];
  let chamadasRpcSorteio: any[] = [];

  const criarQueryChain = (resultadoFinal: any) => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(resultadoFinal),
      single: vi.fn().mockResolvedValue(resultadoFinal),
      delete: vi.fn().mockImplementation(() => {
        return {
          eq: vi.fn().mockImplementation((col, val) => {
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
              in: vi.fn().mockImplementation((colIn, valsIn) => {
                chamadasDeleteLocks.push({ col, val, colIn, valsIn });
                return Promise.resolve({ error: null });
              }),
            };
          }),
        };
      }),
      insert: vi.fn().mockImplementation((dados) => {
        chamadasInsertBloqueios.push(dados);
        return Promise.resolve({ error: null });
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resultadoFinal).then(resolve),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasDeleteLocks = [];
    chamadasInsertBloqueios = [];
    chamadasRpcSorteio = [];
    localStorage.clear();
    localStorage.setItem('evento_ativo_id', eventoIdTeste);
    localStorage.setItem('sessao_id_usuario', usuarioAvaliadorId);

    vi.mocked(supabase.rpc).mockImplementation((nomeFn: string, params: any) => {
      chamadasRpcSorteio.push({ nomeFn, params });
      // Fila direcionada vazia: o projeto vem do sorteio
      if (nomeFn === 'fn_assumir_item_fila') return Promise.resolve({ data: null, error: null }) as any;
      return Promise.resolve({ data: 'p0000000-0000-0000-0000-000000000002', error: null }) as any;
    });

    vi.mocked(supabase.from).mockImplementation((tabela: string) => {
      if (tabela === 'usuarios' || tabela === 'view_avaliadores_credenciados') {
        return criarQueryChain({
          data: [
            {
              id_usuario: usuarioAvaliadorId,
              nome: 'Avaliador Teste Modalidade',
              email: 'avaliador.mod@ifms.edu.br',
              papel: 'AVALIADOR',
              is_credenciado: true,
            },
          ],
          error: null,
        });
      }

      if (tabela === 'modalidades') {
        return criarQueryChain({
          data: [
            { id_modalidade: modalidadeBloqueadaId, nome_modalidade: 'Informática e Computação' },
            { id_modalidade: modalidadeLivreId, nome_modalidade: 'Robótica Educacional' },
          ],
          error: null,
        });
      }

      if (tabela === 'instituicoes') {
        return criarQueryChain({
          data: [{ id_instituicao: 'inst-1', nome_exibicao: 'IFMS Campus CG', sigla: 'IFMS' }],
          error: null,
        });
      }

      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            {
              id_usuario: usuarioAvaliadorId,
              id_evento: eventoIdTeste,
              is_credenciado: true,
              id_instituicao: 'inst-1',
              instituicoes: { nome_exibicao: 'IFMS Campus CG' },
              usuarios: { nome: 'Avaliador Teste Modalidade', email: 'avaliador.mod@ifms.edu.br', papel: 'AVALIADOR' },
            },
          ],
          error: null,
        });
      }

      if (tabela === 'avaliador_modalidades_bloqueadas') {
        return criarQueryChain({
          data: [
            {
              id_usuario: usuarioAvaliadorId,
              id_evento: eventoIdTeste,
              id_modalidade: modalidadeBloqueadaId,
            },
          ],
          error: null,
        });
      }

      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'p0000000-0000-0000-0000-000000000001',
              codigo_projeto: 'INF-01',
              titulo: 'Sistema Web em Informática',
              id_modalidade: modalidadeBloqueadaId,
              id_instituicao: 'inst-outra',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
              estande: 'EST-01',
              corredor: 'A',
              modalidades: { nome_modalidade: 'Informática e Computação' },
              instituicoes: { nome_exibicao: 'Outra Escola' },
            },
            {
              id_projeto: 'p0000000-0000-0000-0000-000000000002',
              codigo_projeto: 'ROB-01',
              titulo: 'Braço Robótico Autônomo',
              id_modalidade: modalidadeLivreId,
              id_instituicao: 'inst-outra',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
              estande: 'EST-02',
              corredor: 'B',
              modalidades: { nome_modalidade: 'Robótica Educacional' },
              instituicoes: { nome_exibicao: 'Outra Escola' },
            },
          ],
          error: null,
        });
      }

      if (tabela === 'locks_ativos') {
        return criarQueryChain({
          data: [],
          error: null,
        });
      }

      if (tabela === 'avaliacoes') {
        return criarQueryChain({
          data: [],
          error: null,
        });
      }

      if (tabela === 'fila_atribuicoes_direcionadas') {
        return criarQueryChain({
          data: null,
          error: null,
        });
      }

      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: eventoIdTeste,
            is_ativo: true,
            cota_avaliacoes_padrao: 3,
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

      return criarQueryChain({ data: [], error: null });
    });
  });

  it('1. GESTOR DE AVALIADORES: ao salvar modalidades bloqueadas, grava pela função do banco (que também expurga as travas)', async () => {
    render(
      <GestorAvaliadores
        id_evento_ativo={eventoIdTeste}
        ao_fechar={vi.fn()}
      />
    );

    expect(await screen.findByText('Avaliador Teste Modalidade')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Avaliador Teste Modalidade' }));
    expect(await screen.findByRole('dialog', { name: 'Editar Avaliador' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('admin_atualizar_avaliador', expect.objectContaining({
        p_id_usuario: usuarioAvaliadorId,
        p_id_evento: eventoIdTeste,
        p_ids_modalidades_bloqueadas: [modalidadeBloqueadaId],
      }));
    });
    expect(chamadasDeleteLocks).toHaveLength(0);
  });

  it('2. ATRIBUIR PROJETO: identifica e sinaliza o bloqueio no modo Enfileirar para projetos da modalidade bloqueada', async () => {
    render(
      <AtribuicaoForcada
        isOpen={true}
        aoFechar={vi.fn()}
        id_evento_ativo={eventoIdTeste}
        cota_padrao_evento={3}
      />
    );

    // Alterna para o modo Enfileirar (1 Avaliador -> Múltiplos Projetos)
    const btnModoEnfileirar = await screen.findByRole('button', { name: /Enfileirar para Avaliador/i });
    fireEvent.click(btnModoEnfileirar);

    // Seleciona o avaliador na coluna da esquerda
    const avalCard = await screen.findByText('Avaliador Teste Modalidade');
    fireEvent.click(avalCard);

    // Na coluna da direita, o projeto da modalidade bloqueada deve conter o badge de bloqueio
    await waitFor(() => {
      const badgesBloqueio = screen.getAllByText(/Bloqueio: Modalidade do Projeto/i);
      expect(badgesBloqueio.length).toBeGreaterThan(0);
    });
  });

  it('3. TELA DO AVALIADOR: se existir trava anterior de modalidade bloqueada, remove a trava e aciona sorteio', async () => {
    // Configura lock ativo apontando para o projeto com modalidade bloqueada
    vi.mocked(supabase.from).mockImplementation((tabela: string) => {
      if (tabela === 'locks_ativos') {
        return criarQueryChain({
          data: { id_projeto: 'p0000000-0000-0000-0000-000000000001' },
          error: null,
        });
      }
      if (tabela === 'avaliador_modalidades_bloqueadas') {
        return criarQueryChain({
          data: [{ id_modalidade: modalidadeBloqueadaId }],
          error: null,
        });
      }
      if (tabela === 'projetos') {
        return criarQueryChain({
          data: {
            id_projeto: 'p0000000-0000-0000-0000-000000000001',
            codigo_projeto: 'INF-01',
            titulo: 'Projeto com Modalidade Bloqueada',
            id_modalidade: modalidadeBloqueadaId,
          },
          error: null,
        });
      }
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: eventoIdTeste,
            is_ativo: true,
            cota_avaliacoes_padrao: 3,
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
      return criarQueryChain({ data: [], error: null });
    });

    render(
      <TelaAvaliador
        id_usuario_logado={usuarioAvaliadorId}
        id_evento_ativo={eventoIdTeste}
      />
    );

    // Deve detectar a violação e disparar o sorteio pela RPC
    await waitFor(() => {
      expect(chamadasRpcSorteio.map((c) => c.nomeFn)).toContain('sortear_proximo_projeto');
    });
  });
});
