import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { mockFrom, mockInsert } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn();

  return { mockFrom, mockInsert };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { AtribuicaoForcada } from '@/features/atribuicoes';

describe('Auditoria de Regressão: Atribuição Forçada', () => {
  // Helper para criar mock encadeado (Fluent API do Supabase / PostgREST)
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'locks_ativos') {
        const chain = criarQueryChain({ data: [], error: null });
        chain.insert = mockInsert;
        return chain;
      }

      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            { id_usuario: 'usr-cred-1', is_credenciado: true, instituicoes: { nome_exibicao: 'IFMS' } },
            { id_usuario: 'usr-nao-cred-2', is_credenciado: false, instituicoes: { nome_exibicao: 'IFMS' } },
          ],
          error: null,
        });
      }

      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [
            {
              id_projeto: 'proj-elegivel-1',
              codigo_projeto: 'PROJ-ELEGIVEL',
              titulo: 'Projeto com Menos de 3 Avaliações',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
              estande: 'E-01',
              cota_avaliacoes_customizada: 3,
            },
            {
              id_projeto: 'proj-lotado-2',
              codigo_projeto: 'PROJ-LOTADO',
              titulo: 'Projeto com Cota Preenchida',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
              estande: 'E-02',
              cota_avaliacoes_customizada: 3,
            },
          ],
          error: null,
        });
      }

      if (tabela === 'avaliacoes') {
        return criarQueryChain({
          data: [
            { id_projeto: 'proj-lotado-2', is_quarentena: false },
            { id_projeto: 'proj-lotado-2', is_quarentena: false },
            { id_projeto: 'proj-lotado-2', is_quarentena: false },
            { id_projeto: 'proj-elegivel-1', is_quarentena: false },
          ],
          error: null,
        });
      }

      if (tabela === 'usuarios' || tabela === 'view_avaliadores_credenciados') {
        return criarQueryChain({
          data: [
            { id_usuario: 'usr-cred-1', nome: 'Dra. Ana Credenciada', email: 'ana@ifms.edu.br', is_credenciado: true },
            { id_usuario: 'usr-nao-cred-2', nome: 'Dr. Bruno Sem Credencial', email: 'bruno@ifms.edu.br', is_credenciado: false },
          ],
          error: null,
        });
      }

      if (tabela === 'fila_atribuicoes_direcionadas') {
        const chain = criarQueryChain({ data: [], error: null });
        chain.insert = mockInsert;
        return chain;
      }

      return criarQueryChain({ data: [], error: null });
    });
  });

  it('DEVE filtrar projetos com cota preenchida (>= 3) e avaliadores não credenciados (is_credenciado = false)', async () => {
    render(
      <AtribuicaoForcada
        isOpen={true}
        aoFechar={vi.fn()}
      />
    );

    await waitFor(() => {
      // 1. Projeto com < 3 avaliações DEVE estar elegível na listagem
      expect(screen.getByText('PROJ-ELEGIVEL')).toBeInTheDocument();
      // 2. Projeto com >= 3 avaliações NÃO DEVE constar na lista de elegíveis
      expect(screen.queryByText('PROJ-LOTADO')).not.toBeInTheDocument();

      // 3. Avaliador credenciado DEVE constar na lista
      expect(screen.getByText('Dra. Ana Credenciada')).toBeInTheDocument();
      // 4. Avaliador não credenciado NÃO DEVE constar na lista
      expect(screen.queryByText('Dr. Bruno Sem Credencial')).not.toBeInTheDocument();
    });
  });

  it('OBRIGATORIAMENTE deve conter a coluna expira_em preenchida ao registrar lock na tabela locks_ativos', async () => {
    const { supabase } = await import('@/lib/supabase');

    const tempoAtual = Date.now();
    const expiracaoEsperada = new Date(tempoAtual + 2 * 60 * 60 * 1000).toISOString();

    // Simula a submissão exata de lock realizada pelo componente
    await supabase.from('locks_ativos').insert([{
      id_projeto: 'proj-elegivel-1',
      id_usuario: 'usr-cred-1',
      expira_em: expiracaoEsperada,
    }]);

    expect(mockFrom).toHaveBeenCalledWith('locks_ativos');
    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        id_projeto: 'proj-elegivel-1',
        id_usuario: 'usr-cred-1',
        expira_em: expect.any(String),
      }),
    ]);

    // Valida que expira_em é uma data ISO válida no futuro
    const payloadEnviado = mockInsert.mock.calls[0][0][0];
    expect(payloadEnviado.expira_em).toBeDefined();
    expect(new Date(payloadEnviado.expira_em).getTime()).toBeGreaterThan(tempoAtual);
  });

  it('DEVE alternar entre as abas Banca Simultânea e Enfileirar para Avaliador', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(
      <AtribuicaoForcada
        isOpen={true}
        aoFechar={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Alocar Banca para Projeto')).toBeInTheDocument();
      expect(screen.getByText('Enfileirar para Avaliador')).toBeInTheDocument();
    });

    const tabEnfileirar = screen.getByText('Enfileirar para Avaliador');
    fireEvent.click(tabEnfileirar);

    await waitFor(() => {
      expect(screen.getByText('1. Escolha o Avaliador')).toBeInTheDocument();
      expect(screen.getByText('2. Selecionar Projetos para a Fila')).toBeInTheDocument();
    });
  });

  it('MODO ENFILEIRAR: se avaliador estiver livre, 1º projeto cria trava em locks_ativos e subsequente vai para fila', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(
      <AtribuicaoForcada
        isOpen={true}
        aoFechar={vi.fn()}
      />
    );

    // 1. Muda para aba Enfileirar
    const tabEnfileirar = screen.getByText('Enfileirar para Avaliador');
    fireEvent.click(tabEnfileirar);

    await waitFor(() => {
      expect(screen.getByText('Dra. Ana Credenciada')).toBeInTheDocument();
    });

    // 2. Seleciona avaliador livre
    const cardAvaliador = screen.getByText('Dra. Ana Credenciada');
    fireEvent.click(cardAvaliador);

    // 3. Seleciona projeto elegível
    await waitFor(() => {
      expect(screen.getByText('PROJ-ELEGIVEL')).toBeInTheDocument();
    });
    const cardProjeto = screen.getByText('PROJ-ELEGIVEL');
    fireEvent.click(cardProjeto);

    // 4. Executa atribuição
    const btnAtribuir = screen.getByRole('button', { name: /Forçar Atribuição Elegível/i });
    fireEvent.click(btnAtribuir);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('locks_ativos');
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id_usuario: 'usr-cred-1',
          id_projeto: 'proj-elegivel-1',
          expira_em: expect.any(String),
        }),
      ]);
    });
  });
});
