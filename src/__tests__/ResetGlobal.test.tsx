import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mocks do ambiente
const mockAlert = vi.fn();
vi.stubGlobal('alert', mockAlert);
vi.stubGlobal('confirm', vi.fn(() => true));

const { mockRpc, mockFrom, mockDelete, mockUpdate, mockInsert } = vi.hoisted(() => {
  const mockRpc = vi.fn().mockResolvedValue({ error: null, data: { sucesso: true } });
  const mockDelete = vi.fn().mockResolvedValue({ error: null });
  const mockUpdate = vi.fn().mockResolvedValue({ error: null });
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn();

  return { mockRpc, mockFrom, mockDelete, mockUpdate, mockInsert };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { TelaAdmin } from '../components/TelaAdmin';

describe('Rotina de Testes de Regressão: Reset Global do Evento Ativo', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      delete: mockDelete,
      update: mockUpdate,
      insert: mockInsert,
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: { id_evento: '11111111-2222-3333-4444-555555555555', nome_evento: 'FETEC MS 2026', is_ativo: true, edicao: '17ª' },
          error: null,
        });
      }
      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [{ id_usuario: 'user-1', is_credenciado: true }],
          count: 5,
          error: null,
        });
      }
      if (tabela === 'usuarios') {
        return criarQueryChain({
          data: [{ id_usuario: 'admin-1', papel: 'SUPERADMIN', nome: 'Admin Chefe' }],
          count: 1,
          error: null,
        });
      }
      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [],
          count: 10,
          error: null,
        });
      }
      if (tabela === 'questionarios') {
        return criarQueryChain({
          data: [],
          count: 2,
          error: null,
        });
      }
      if (tabela === 'avaliacoes') {
        return criarQueryChain({
          data: [],
          count: 8,
          error: null,
        });
      }
      if (tabela === 'locks_ativos') {
        return criarQueryChain({
          data: [],
          count: 0,
          error: null,
        });
      }
      if (tabela === 'view_projetos_quarentena') {
        return criarQueryChain({
          data: [],
          count: 0,
          error: null,
        });
      }
      if (tabela === 'view_projetos_pendentes_avaliacao') {
        return criarQueryChain({
          data: [],
          count: 0,
          error: null,
        });
      }
      return criarQueryChain({ data: [], count: 0, error: null });
    });
  });

  it('1. VALIDAÇÃO DE SEGURANÇA DA ETAPA 1: exige nome exato do evento ativo para habilitar botão de avanço', async () => {
    const { unmount } = render(<TelaAdmin />);

    // 1. Abre configurações
    const btnConfig = await screen.findByTitle('Configurações Gerais');
    fireEvent.click(btnConfig);

    // 2. Aciona o botão de Reset Global dentro das Configurações
    const btnResetGlobal = await screen.findByRole('button', { name: /reset global/i });
    fireEvent.click(btnResetGlobal);

    // 3. Etapa 1 deve ser exibida
    expect(await screen.findByText(/Etapa 1\/2: Reset Global do Evento/i)).toBeInTheDocument();

    const btnAvancar = screen.getByRole('button', { name: /Avançar para Etapa Final/i });
    expect(btnAvancar).toBeDisabled();

    // 4. Digitação incorreta não habilita
    const inputConfirmacao = screen.getByPlaceholderText(/Digite o nome do evento:/i);
    fireEvent.change(inputConfirmacao, { target: { value: 'RESETAR-FETEC-2026' } });
    expect(btnAvancar).toBeDisabled();

    // Digitação case-insensitive não habilita (validação estrita caractere por caractere)
    fireEvent.change(inputConfirmacao, { target: { value: 'fetec ms 2026' } });
    expect(btnAvancar).toBeDisabled();

    // 5. Digitação correta do nome do evento ativo habilita o avanço
    fireEvent.change(inputConfirmacao, { target: { value: 'FETEC MS 2026' } });
    expect(btnAvancar).toBeEnabled();

    // 6. Avança para a Etapa 2
    fireEvent.click(btnAvancar);
    expect(await screen.findByText(/Etapa 2\/2: Confirmação Crítica Final/i)).toBeInTheDocument();

    unmount();
  });

  it('2. EXECUÇÃO ESTRITA DA RPC E BLINDAGEM CONTRA EXCLUSÃO DIRETA: chama admin_reset_global com p_id_evento e nunca .delete()', async () => {
    const { unmount } = render(<TelaAdmin />);

    // Abre configurações e avança até Etapa 2
    fireEvent.click(await screen.findByTitle('Configurações Gerais'));
    fireEvent.click(await screen.findByRole('button', { name: /reset global/i }));

    const inputConfirmacao = await screen.findByPlaceholderText(/Digite o nome do evento:/i);
    fireEvent.change(inputConfirmacao, { target: { value: 'FETEC MS 2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Avançar para Etapa Final/i }));

    // Executa a confirmação final
    const btnConfirmarRPC = await screen.findByRole('button', { name: /Confirmar Execução da RPC no Supabase/i });
    fireEvent.click(btnConfirmarRPC);

    await waitFor(() => {
      // OBRIGATÓRIO: A RPC oficial do Supabase DEVE ter sido acionada com o ID do evento
      expect(mockRpc).toHaveBeenCalledWith('admin_reset_global', {
        p_id_evento: '11111111-2222-3333-4444-555555555555',
      });

      // BLINDAGEM: Nenhum comando de delete direto no cliente
      expect(mockDelete).not.toHaveBeenCalled();
    });

    unmount();
  });

  it('3. ATUALIZAÇÃO IMEDIATA DO PAINEL E FEEDBACK MODERNO: fecha modal, exibe toast e atualiza indicadores', async () => {
    const { unmount } = render(<TelaAdmin />);

    fireEvent.click(await screen.findByTitle('Configurações Gerais'));
    fireEvent.click(await screen.findByRole('button', { name: /reset global/i }));

    const inputConfirmacao = await screen.findByPlaceholderText(/Digite o nome do evento:/i);
    fireEvent.change(inputConfirmacao, { target: { value: 'FETEC MS 2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Avançar para Etapa Final/i }));

    const btnConfirmarRPC = await screen.findByRole('button', { name: /Confirmar Execução da RPC no Supabase/i });
    fireEvent.click(btnConfirmarRPC);

    await waitFor(() => {
      // Toast moderno de sucesso
      expect(screen.getByText(/Reset Global concluído com sucesso/i)).toBeInTheDocument();
      // Modal fechado
      expect(screen.queryByText(/Etapa 2\/2: Confirmação Crítica Final/i)).toBeNull();
    });

    unmount();
  });

  it('4. TRATAMENTO DE ERRO RESILIENTE: captura falha do banco e mantém a integridade da aplicação', async () => {
    // Configura falha na RPC
    mockRpc.mockResolvedValueOnce({ error: { message: 'Falha de conexão com o Supabase' } });

    const { unmount } = render(<TelaAdmin />);

    fireEvent.click(await screen.findByTitle('Configurações Gerais'));
    fireEvent.click(await screen.findByRole('button', { name: /reset global/i }));

    const inputConfirmacao = await screen.findByPlaceholderText(/Digite o nome do evento:/i);
    fireEvent.change(inputConfirmacao, { target: { value: 'FETEC MS 2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Avançar para Etapa Final/i }));

    const btnConfirmarRPC = await screen.findByRole('button', { name: /Confirmar Execução da RPC no Supabase/i });
    fireEvent.click(btnConfirmarRPC);

    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith(expect.stringContaining('Falha no Reset: Falha de conexão com o Supabase'));
      expect(btnConfirmarRPC).toBeEnabled();
    });

    unmount();
  });
});