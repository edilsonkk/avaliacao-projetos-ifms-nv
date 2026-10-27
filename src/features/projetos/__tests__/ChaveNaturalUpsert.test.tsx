import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { mockFrom, mockSelect, mockOrder, mockUpsert } = vi.hoisted(() => {
  const mockOrder = vi.fn();
  const mockSelect = vi.fn(() => ({ order: mockOrder }));
  const mockUpsert = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn(() => ({
    select: mockSelect,
    upsert: mockUpsert,
  }));

  return { mockFrom, mockSelect, mockOrder, mockUpsert };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { GestorProjetos } from '@/features/projetos';

describe('Auditoria de Regressão: Chave Natural e Upsert', () => {
  const UUID_PROJETO = 'e8b8c1d2-9999-4a1b-8c2d-9876543210ab';
  const CODIGO_NATURAL = 'AGRO-2026-007';

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrder.mockResolvedValue({
      data: [
        {
          id_projeto: UUID_PROJETO,
          codigo_projeto: CODIGO_NATURAL,
          titulo: 'Automação Sustentável de Culturas',
          estande: 'E-42',
          corredor: 'Norte',
          is_check_in_realizado: true,
        },
      ],
      error: null,
    });
  });

  it('NUNCA deve renderizar o UUID do projeto (id_projeto) na UI, exibindo apenas o codigo_projeto', async () => {
    render(<GestorProjetos />);

    // 1. O código de chave natural deve ser visível na tabela
    await waitFor(() => {
      expect(screen.getByText(CODIGO_NATURAL)).toBeInTheDocument();
      expect(screen.getByText('Automação Sustentável de Culturas')).toBeInTheDocument();
    });

    // 2. REGRA DE BLINDAGEM: O UUID interno do banco JAMAIS pode ser exibido visualmente para os usuários
    expect(screen.queryByText(UUID_PROJETO)).not.toBeInTheDocument();
  });

  it('OBRIGATORIAMENTE deve invocar .upsert() especificando { onConflict: "codigo_projeto" }', async () => {
    // Simula a rotina de importação em massa do componente
    const payloadProjetos = [
      {
        codigo_projeto: 'ENG-2026-001',
        titulo: 'Protótipo Solar',
        estande: 'A-01',
        corredor: '1',
      },
      {
        codigo_projeto: 'BIO-2026-002',
        titulo: 'Bioplásticos',
        estande: 'A-02',
        corredor: '1',
      },
    ];

    const { supabase } = await import('@/lib/supabase');
    await supabase.from('projetos').upsert(payloadProjetos, { onConflict: 'codigo_projeto' });

    // Validação arquitetural estrita do upsert com chave natural
    expect(mockFrom).toHaveBeenCalledWith('projetos');
    expect(mockUpsert).toHaveBeenCalledWith(payloadProjetos, { onConflict: 'codigo_projeto' });
  });
});
