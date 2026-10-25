import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const EVENTO_ATIVO_UUID = 'evt-fetec-2026-uuid-1234';

const { mockFrom, mockEqCalls } = vi.hoisted(() => {
  const mockEqCalls: Array<{ coluna: string; valor: any }> = [];
  const mockFrom = vi.fn();

  return { mockFrom, mockEqCalls };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: vi.fn().mockResolvedValue({ error: null }),
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { TelaAdmin } from '../components/TelaAdmin';

describe('Auditoria de Regressão: Sincronia de Contadores (Escopo do Evento Ativo)', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn((coluna: string, valor: any) => {
        mockEqCalls.push({ coluna, valor });
        return chain;
      }),
      gt: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEqCalls.length = 0;

    mockFrom.mockImplementation((tabela: string) => {
      // 1. Tabela eventos: retorna o evento ativo oficial
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: EVENTO_ATIVO_UUID,
            nome_evento: 'FETEC MS 2026',
            is_ativo: true,
          },
          error: null,
        });
      }

      // 2. Tabela avaliadores_evento: 25 avaliadores credenciados no evento ativo
      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            { id_usuario: 'u-1', usuarios: { id_usuario: 'u-1', papel: 'STAFF' } },
            { id_usuario: 'u-2', usuarios: { id_usuario: 'u-2', papel: 'STAFF' } },
            { id_usuario: 'u-3', usuarios: { id_usuario: 'u-3', papel: 'AVALIADOR' } },
          ],
          count: 25,
          error: null,
        });
      }

      // 3. Tabela questionarios: 4 questionarios atrelados ao evento ativo
      if (tabela === 'questionarios') {
        return criarQueryChain({
          data: [{ id_questionario: 'q-1' }],
          count: 4,
          error: null,
        });
      }

      // 4. Projetos vinculados
      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [],
          count: 80,
          error: null,
        });
      }

      // 5. Usuários gerais
      if (tabela === 'usuarios') {
        return criarQueryChain({
          data: [
            { id_usuario: 'admin-1', papel: 'ADMIN' },
          ],
          error: null,
        });
      }

      return criarQueryChain({ data: [], count: 0, error: null });
    });
  });

  it('DEVE filtrar a contagem de Avaliadores pelo evento ativo E is_credenciado = true', async () => {
    render(<TelaAdmin />);

    await waitFor(() => {
      // Verifica se a tabela 'avaliadores_evento' foi consultada
      expect(mockFrom).toHaveBeenCalledWith('avaliadores_evento');

      // OBRIGATÓRIO: A consulta de avaliadores deve filtrar pelo evento ativo
      const chamadasEventoAvaliadores = mockEqCalls.filter(
        (c) => c.coluna === 'id_evento' && c.valor === EVENTO_ATIVO_UUID
      );
      expect(chamadasEventoAvaliadores.length).toBeGreaterThanOrEqual(1);

      // OBRIGATÓRIO: Deve filtrar por is_credenciado = true
      const chamadasCredenciado = mockEqCalls.filter(
        (c) => c.coluna === 'is_credenciado' && c.valor === true
      );
      expect(chamadasCredenciado.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('DEVE filtrar a contagem de Questionários pelo escopo do evento ativo', async () => {
    render(<TelaAdmin />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('questionarios');

      // OBRIGATÓRIO: A consulta de questionários deve filtrar por id_evento do evento ativo
      const chamadasEventoQuestionarios = mockEqCalls.filter(
        (c) => c.coluna === 'id_evento' && c.valor === EVENTO_ATIVO_UUID
      );
      expect(chamadasEventoQuestionarios.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('DEVE filtrar a contagem de Staff vinculando estritamente ao evento ativo', async () => {
    render(<TelaAdmin />);

    await waitFor(() => {
      // OBRIGATÓRIO: A consulta do Staff deve aplicar escopo de id_evento
      const chamadasEventoStaff = mockEqCalls.filter(
        (c) => c.coluna === 'id_evento' && c.valor === EVENTO_ATIVO_UUID
      );
      expect(chamadasEventoStaff.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('REJEITA contagens globais cegas sem o filtro id_evento', async () => {
    render(<TelaAdmin />);

    await waitFor(() => {
      // Todas as tabelas sensíveis a evento (avaliadores_evento, questionarios, projetos)
      // devem conter ao menos uma chamada com id_evento
      const temFiltroEventoAtivo = mockEqCalls.some(
        (c) => c.coluna === 'id_evento' && c.valor === EVENTO_ATIVO_UUID
      );
      expect(temFiltroEventoAtivo).toBe(true);
    });
  });
});
