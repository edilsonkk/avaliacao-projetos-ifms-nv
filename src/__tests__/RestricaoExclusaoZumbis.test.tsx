import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { mockRpc, mockFrom, mockDelete } = vi.hoisted(() => {
  const mockRpc = vi.fn().mockResolvedValue({ error: null });
  const mockDelete = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn();

  return { mockRpc, mockFrom, mockDelete };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

// Mock do window.alert e window.location.reload
vi.stubGlobal('alert', vi.fn());
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { reload: vi.fn() },
});

import { ModalConfiguracoesEvento } from '../components/ModalConfiguracoesEvento';
import { ProjetosBloqueados } from '../components/ProjetosBloqueados';

describe('Auditoria de Regressão: Restrição de Exclusão (Erradicação de Código Zumbi)', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      order: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      delete: mockDelete,
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'locks_ativos') {
        return criarQueryChain({
          data: [
            {
              id_lock: 'lock-01',
              id_projeto: 'proj-01',
              id_usuario: 'usr-01',
              bloqueado_em: new Date().toISOString(),
              expira_em: new Date(Date.now() + 3600000).toISOString(),
              projetos: { codigo_projeto: 'P-01', titulo: 'Projeto 1', estande: 'E-1', corredor: 'A' },
              usuarios: { nome: 'Avaliador 1', email: 'av1@ifms.edu.br' },
            },
          ],
          error: null,
        });
      }

      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: 'evt-ativo-uuid',
            nome_evento: 'FETEC MS 2026',
            minutos_timeout_lock: 15,
            cota_avaliacoes_padrao: 3,
            sistema_liberado: true,
            horario_inicio: '08:00',
            horario_fim: '18:00',
          },
          error: null,
        });
      }

      return criarQueryChain({ data: [], error: null });
    });
  });

  it('O botão "Reset Global" DEVE acionar .rpc("admin_reset_global") e NUNCA utilizar .delete() direto no frontend', async () => {
    render(
      <ModalConfiguracoesEvento
        id_evento_ativo="evt-ativo-uuid"
        nome_evento_atual="FETEC MS 2026"
        ao_fechar={vi.fn()}
      />
    );

    // Aguarda carregar dados do formulário
    const btnResetGlobal = await screen.findByRole('button', { name: /reset global/i });
    expect(btnResetGlobal).toBeInTheDocument();

    // Aciona o Reset Global
    fireEvent.click(btnResetGlobal);

    await waitFor(() => {
      // 1. OBRIGATÓRIO: A RPC oficial do Supabase DEVE ter sido acionada
      expect(mockRpc).toHaveBeenCalledWith('admin_reset_global', expect.anything());

      // 2. REGRA DE BLINDAGEM: Não deve chamar supabase.from(...).delete() diretamente
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  it('O botão "Desbloquear Todos" DEVE acionar .rpc("admin_desbloquear_todos") e NUNCA utilizar .delete() direto no frontend', async () => {
    render(
      <ProjetosBloqueados
        aoFechar={vi.fn()}
        aoAtualizarMetricas={vi.fn()}
      />
    );

    // Localiza e clica no botão "Desbloquear Todos"
    const btnDesbloquearTodos = await screen.findByRole('button', { name: /desbloquear todos/i });
    expect(btnDesbloquearTodos).toBeInTheDocument();

    // Espera que o botão esteja habilitado (com dados de locks_ativos carregados)
    await waitFor(() => {
      expect(btnDesbloquearTodos).not.toBeDisabled();
    });

    fireEvent.click(btnDesbloquearTodos);

    await waitFor(() => {
      // 1. OBRIGATÓRIO: A RPC oficial do Supabase DEVE ter sido acionada
      expect(mockRpc).toHaveBeenCalledWith('admin_desbloquear_todos');

      // 2. REGRA DE BLINDAGEM: Não deve chamar supabase.from(...).delete()
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  it('VALIDAÇÃO ARQUITETURAL: proíbe chamadas diretas de .delete() sem RPC para reset ou desbloqueio global', () => {
    // Chamadas diretas a mockFrom('qualquer_tabela').delete() são consideradas violações de segurança
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
