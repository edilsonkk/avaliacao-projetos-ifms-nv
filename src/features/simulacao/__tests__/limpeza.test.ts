// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockGetSession } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: mockRpc, auth: { getSession: mockGetSession } },
  ambiente_supabase: 'local',
  configuracao_supabase: { valida: true, url: 'http://127.0.0.1:54321', chaveAnonima: 'anon' },
  verificar_conexao_configurada: () => true,
}));

import { apagarSimulacao } from '@/features/simulacao/limpeza';

beforeEach(() => {
  mockRpc.mockReset();
  mockGetSession.mockReset().mockResolvedValue({
    data: { session: { access_token: 'token' } }, error: null,
  });
});

describe('apagarSimulacao', () => {
  /**
   * A limpeza inteira vive no banco. Apagando pelo cliente, a cascata de `avaliacoes` e
   * `questionarios` grava na trilha com `origem = 'direto'` e `id_evento` nulo, e a regra C10
   * da conferência de notas trata isso como achado GRAVE em todos os eventos — inclusive na
   * feira real. Medido: apagar uma simulação de 31 avaliações deixou 141 achados falsos e
   * permanentes, porque a trilha é append-only.
   */
  it('delega ao banco, que marca a origem na trilha', async () => {
    // Arrange
    mockRpc.mockResolvedValue({
      data: {
        ok: true, nome_evento: 'Simulação de Carga 2026-11-24 10:00:00',
        avaliacoes_apagadas: 31, eventos_apagados: 1,
        usuarios_apagados: 8, usuarios_preservados: 2,
      },
      error: null,
    });

    // Act
    const resumo = await apagarSimulacao('e-sim');

    // Assert
    expect(mockRpc).toHaveBeenCalledWith('admin_apagar_simulacao', { p_id_evento: 'e-sim' });
    expect(resumo).toEqual({
      avaliacoesApagadas: 31,
      eventosApagados: 1,
      usuariosApagados: 8,
      usuariosPreservados: 2,
    });
  });

  it('não chama o banco sem sessão de administrador', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    // Act / Assert
    await expect(apagarSimulacao('e-sim')).rejects.toThrow(/Sessão de administrador/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('repassa a recusa do banco quando o evento não é de simulação', async () => {
    // Arrange — a guarda de prefixo é do servidor, não do cliente
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: '"FETEC-MS 2026" não é um evento de simulação. Nada foi apagado.' },
    });

    // Act / Assert
    await expect(apagarSimulacao('e-real')).rejects.toThrow(/não é um evento de simulação/i);
  });

  it('repassa a recusa do banco quando a simulação ainda é o evento ativo', async () => {
    // Arrange
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Esta simulação ainda é o evento ativo. Encerre-a primeiro. Nada foi apagado.' },
    });

    // Act / Assert
    await expect(apagarSimulacao('e-sim')).rejects.toThrow(/Encerre-a primeiro/i);
  });

  it('traduz erro de permissão do RLS', async () => {
    // Arrange
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });

    // Act / Assert
    await expect(apagarSimulacao('e-sim')).rejects.toThrow(/administrador/i);
  });

  it('aceita resposta sem contagens sem quebrar o resumo', async () => {
    // Arrange
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    // Act
    const resumo = await apagarSimulacao('e-sim');

    // Assert
    expect(resumo.avaliacoesApagadas).toBe(0);
    expect(resumo.usuariosApagados).toBe(0);
  });
});
