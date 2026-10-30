import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock do window.confirm e window.alert
vi.stubGlobal('alert', vi.fn());
vi.stubGlobal('confirm', vi.fn(() => true));

const { mockFrom, mockRpc, mockInsert } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  const mockRpc = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn();
  return { mockFrom, mockRpc, mockInsert };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null }) },
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { TelaAdmin } from '@/features/admin';
import { ProjetosBloqueados } from '@/features/atribuicoes';
import { ProjetosQuarentena } from '@/features/atribuicoes';
import { AtribuicaoForcada } from '@/features/atribuicoes';

describe('Validação de Regras de Negócio Remodeladas do Bloco 1', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      ilike: vi.fn(() => chain),
      in: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      update: vi.fn(() => chain),
      is: vi.fn(() => chain),
      insert: mockInsert,
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((tabela: string) => {
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
              id_projeto: 'proj-1',
              codigo_projeto: 'FETEC-001',
              titulo: 'Projeto Automação Agrícola',
              estande: 'A-01',
              corredor: 'A',
              contagem_ausencia: 2,
              id_instituicao: 'inst-1',
              nome_instituicao: 'IFMS Câmpus CG',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
            },
            {
              id_projeto: 'proj-2',
              codigo_projeto: 'FETEC-002',
              titulo: 'Projeto Inteligência Artificial',
              estande: 'B-02',
              corredor: 'B',
              contagem_ausencia: 0,
              id_instituicao: 'inst-2',
              nome_instituicao: 'UFMS',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
            },
          ],
          count: 50,
          error: null,
        });
      }

      if (tabela === 'locks_ativos') {
        const futuroIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        return criarQueryChain({
          data: [
            {
              id_lock: 'lock-1',
              id_projeto: 'proj-bloqueado-outro',
              id_usuario: 'user-ocupado-88',
              expira_em: futuroIso,
              projetos: { codigo_projeto: 'FETEC-BLOQ', titulo: 'Projeto Bloqueado', estande: 'A-01' },
              usuarios: { nome: 'Prof. Avaliador 1', email: 'aval1@ifms.edu.br', papel: 'AVALIADOR' },
            },
          ],
          count: 7,
          error: null,
        });
      }

      if (tabela === 'view_projetos_quarentena') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'proj-quar-1',
              codigo_projeto: 'FETEC-999',
              titulo: 'Projeto com Divergência Crítica',
              estande: 'C-05',
              corredor: 'C',
              nome_instituicao: 'IFMS',
              nota_minima: 6.0,
              nota_maxima: 9.5,
              diferenca_notas: 3.5,
              tem_flag_quarentena: false,
            },
          ],
          count: 1,
          error: null,
        });
      }

      if (tabela === 'view_projetos_pendentes_avaliacao') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'proj-2',
              codigo_projeto: 'FETEC-002',
              titulo: 'Projeto Inteligência Artificial',
              total_avaliacoes: 1,
            },
          ],
          count: 24,
          error: null,
        });
      }

      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-aval-1',
              is_credenciado: true,
              id_instituicao: 'inst-1',
              instituicoes: { nome_exibicao: 'IFMS Câmpus CG' },
              usuarios: { id_usuario: 'user-aval-1', nome: 'Prof. Carlos IFMS', email: 'carlos@ifms.edu.br', papel: 'AVALIADOR' },
            },
            {
              id_usuario: 'user-aval-2',
              is_credenciado: true,
              id_instituicao: 'inst-99',
              instituicoes: { nome_exibicao: 'Outra Instituição' },
              usuarios: { id_usuario: 'user-aval-2', nome: 'Profa. Denise Outra', email: 'denise@outra.edu.br', papel: 'AVALIADOR' },
            },
          ],
          count: 15,
          error: null,
        });
      }

      if (tabela === 'questionarios') {
        return criarQueryChain({
          data: [{ id_questionario: 'q-1', titulo: 'Questionário Geral' }],
          count: 6,
          error: null,
        });
      }

      if (tabela === 'view_avaliadores_credenciados' || tabela === 'usuarios') {
        return criarQueryChain({
          data: [
            {
              id_usuario: 'user-aval-1',
              nome: 'Prof. Carlos IFMS',
              email: 'carlos@ifms.edu.br',
              papel: 'AVALIADOR',
              is_credenciado: true,
            },
            {
              id_usuario: 'user-aval-2',
              nome: 'Profa. Denise Outra',
              email: 'denise@outra.edu.br',
              papel: 'AVALIADOR',
              is_credenciado: true,
            },
          ],
          count: 2,
          error: null,
        });
      }

      if (tabela === 'avaliacoes') {
        return criarQueryChain({
          data: [
            {
              id_avaliacao: 'av-1',
              id_projeto: 'proj-1',
              id_usuario: 'user-aval-99',
              nota_final: 9.0,
              is_quarentena: false,
            },
          ],
          count: 30,
          error: null,
        });
      }

      return criarQueryChain({ data: [], count: 0, error: null });
    });
  });

  it('1. CARD PROJETOS: deve exibir o card sem contadores internos, remover barra de progresso e exibir badge no modal', async () => {
    render(<TelaAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Projetos')).toBeDefined();
      expect(screen.queryByText('Inscritos na feira')).toBeNull();
      expect(screen.queryByText(/Progresso Geral das Avaliações/i)).toBeNull();
    });

    const cardProjetos = screen.getByRole('button', { name: /^Projetos$/i });
    expect(cardProjetos.textContent).not.toMatch(/\d+/);

    fireEvent.click(cardProjetos);
    expect(await screen.findByText('Gestor de Projetos')).toBeDefined();
    expect(await screen.findByText(/com check-in/i)).toBeDefined();
  });

  it('2. CARD PROJETOS BLOQUEADOS: deve consultar locks válidos (expira_em > now) e renderizar no modal', async () => {
    render(<ProjetosBloqueados aoFechar={vi.fn()} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('locks_ativos');
      expect(screen.getByText('FETEC-BLOQ')).toBeDefined();
      expect(screen.getByText('Prof. Avaliador 1')).toBeDefined();
    });
  });

  it('3. CARD PROJETOS EM QUARENTENA: deve consultar view_projetos_quarentena (divergência > 2.5 pts ou flag)', async () => {
    render(<ProjetosQuarentena aoFechar={vi.fn()} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('view_projetos_quarentena');
      expect(screen.getByText('FETEC-999')).toBeDefined();
      expect(screen.getByText(/3.5 pts/i)).toBeDefined();
    });
  });

  it('4. REALOCAÇÃO DOS CARDS DO BLOCO 1: Atribuir Projeto na pos 4 e Excluir Avaliação na pos 5 acionam seus modais sem exibir contadores numéricos', async () => {
    render(<TelaAdmin />);

    // 1. Valida que o card Atribuir Projeto existe e NÃO possui números de contagem
    const cardAtribuir = await screen.findByRole('button', { name: /Atribuir Projeto/i });
    expect(cardAtribuir).toBeDefined();
    expect(cardAtribuir.textContent).not.toMatch(/\d+/);

    // 2. Valida que o card Excluir uma avaliação existe no Bloco 1 e NÃO possui números de contagem
    const cardExcluir = await screen.findByRole('button', { name: /Excluir uma avaliação/i });
    expect(cardExcluir).toBeDefined();
    expect(cardExcluir.textContent).not.toMatch(/\d+/);

    // 3. Clica em Atribuir Projeto e valida que abre o modal
    fireEvent.click(cardAtribuir);
    expect(await screen.findByText('Atribuição de Projetos')).toBeDefined();

    // Fecha modal
    const btnFecharAtribuicao = screen.getByRole('button', { name: /Fechar/i });
    fireEvent.click(btnFecharAtribuicao);

    // 4. Clica em Excluir Avaliação e valida que abre o modal
    fireEvent.click(cardExcluir);
    expect(await screen.findByRole('dialog', { name: 'Excluir uma avaliação' })).toBeDefined();
  });

  it('5. ATRIBUIÇÃO DE PROJETOS: valida conflito de mesma instituição e grava pela função do banco', async () => {
    render(
      <AtribuicaoForcada
        isOpen={true}
        aoFechar={vi.fn()}
      />
    );

    await waitFor(() => {
      // Projeto FETEC-001 do IFMS Câmpus CG
      expect(screen.getByText('FETEC-001')).toBeDefined();
      // Avaliadores carregados
      expect(screen.getByText('Prof. Carlos IFMS')).toBeDefined();
      expect(screen.getByText('Profa. Denise Outra')).toBeDefined();
    });

    // 1. Seleciona o projeto FETEC-001
    const cardProjeto = screen.getByText('FETEC-001');
    fireEvent.click(cardProjeto);

    // 2. Avaliador da mesma instituição (Prof. Carlos IFMS) deve receber aviso de conflito de mesma instituição
    await waitFor(() => {
      const conflitoTexto = screen.getAllByText(/Conflito: Mesma Instituição/i);
      expect(conflitoTexto.length).toBeGreaterThan(0);
    });

    // 3. Profa. Denise Outra (outra instituição) deve continuar elegível
    const cardDenise = screen.getByText('Profa. Denise Outra');
    fireEvent.click(cardDenise);

    // 4. Executa atribuição
    const btnAtribuir = screen.getByRole('button', { name: /Forçar Atribuição Elegível/i });
    fireEvent.click(btnAtribuir);

    // A validação final e a gravação (tudo ou nada, validade de 2 h) ficam em admin_atribuir_banca
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('admin_atribuir_banca', { p_id_projeto: 'proj-1', p_ids_usuarios: ['user-aval-2'] });
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
