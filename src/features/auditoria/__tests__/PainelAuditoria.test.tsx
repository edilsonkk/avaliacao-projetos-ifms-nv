import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PainelAuditoria } from '@/features/auditoria';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getSession: vi.fn() },
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const ID_EVENTO = 'evt-27';

const achadoGrave = {
  severidade: 'grave',
  codigo: 'C1',
  titulo: 'Nota final não confere com as notas por critério',
  id_projeto: 'p-1',
  codigo_projeto: 'PROJ-001',
  id_avaliacao: 'av-1',
  esperado: '4.00',
  encontrado: '5.00',
  detalhe: 'Σ(nota × peso) = 12.00 · Σ(pesos) = 3.00 · 12.00 ÷ 3.00 = 4.00, mas está gravado 5.00',
};

const achadoAjuste = {
  severidade: 'informativo',
  codigo: 'C12',
  titulo: 'Nota final arbitrada pelo Admin',
  id_projeto: 'p-2',
  codigo_projeto: 'PROJ-002',
  id_avaliacao: 'av-2',
  esperado: '—',
  encontrado: '4.50',
  detalhe: 'Em 06-11-2026 15:00, por Coordenação. Motivo: recurso deferido',
};

const responderRpc = (porFuncao: Record<string, unknown>) => {
  vi.mocked(supabase.rpc).mockImplementation(((nome: string) =>
    Promise.resolve({ data: porFuncao[nome] ?? null, error: null })) as never);
};

describe('PainelAuditoria', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.from).mockImplementation((() => {
      const cadeia: Record<string, unknown> = {};
      ['select', 'eq', 'order', 'limit', 'in'].forEach((metodo) => {
        cadeia[metodo] = vi.fn(() => cadeia);
      });
      (cadeia as { then: unknown }).then = (resolver: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolver);
      return cadeia;
    }) as never);
  });

  it('deve dizer que tudo confere quando a conferência não acha nada', async () => {
    // Arrange
    responderRpc({ fn_auditar_notas: [] });

    // Act
    render(<PainelAuditoria id_evento_ativo={ID_EVENTO} />);

    // Assert
    expect(await screen.findByText('Todas as notas conferem')).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith('fn_auditar_notas', { p_id_evento: ID_EVENTO });
  });

  it('deve listar o achado grave com a conta que não fechou', async () => {
    // Arrange
    responderRpc({ fn_auditar_notas: [achadoGrave] });

    // Act
    render(<PainelAuditoria id_evento_ativo={ID_EVENTO} />);

    // Assert
    expect(await screen.findByText('Nota final não confere com as notas por critério')).toBeInTheDocument();
    expect(screen.getByText(/1 grave\(s\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PROJ-001' })).toBeInTheDocument();
  });

  it('deve separar os ajustes manuais dos problemas, numa aba própria', async () => {
    // Arrange
    responderRpc({ fn_auditar_notas: [achadoGrave, achadoAjuste] });
    const user = userEvent.setup();
    render(<PainelAuditoria id_evento_ativo={ID_EVENTO} />);
    await screen.findByText('Nota final não confere com as notas por critério');

    // Assert — o ajuste informativo não polui a lista de problemas
    expect(screen.queryByText('Nota final arbitrada pelo Admin')).not.toBeInTheDocument();

    // Act
    await user.click(screen.getByRole('tab', { name: /Ajustes/ }));

    // Assert
    expect(await screen.findByText('Nota final arbitrada pelo Admin')).toBeInTheDocument();
    expect(screen.getByText(/1 ajuste\(s\) manual\(is\)/)).toBeInTheDocument();
  });

  it('deve avisar quando não há evento ativo, em vez de conferir nada', async () => {
    // Arrange
    responderRpc({ fn_auditar_notas: [] });

    // Act
    render(<PainelAuditoria id_evento_ativo={null} />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Não há evento ativo');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('deve abrir o projeto do achado ao clicar no código', async () => {
    // Arrange
    responderRpc({ fn_auditar_notas: [achadoGrave], fn_memorial_por_codigo: null });
    const user = userEvent.setup();
    render(<PainelAuditoria id_evento_ativo={ID_EVENTO} />);

    // Act
    await user.click(await screen.findByRole('button', { name: 'PROJ-001' }));

    // Assert — a aba do projeto já busca o memorial pelo código, nunca por UUID
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('fn_memorial_por_codigo', {
        p_codigo_projeto: 'PROJ-001',
        p_id_evento: ID_EVENTO,
      }),
    );
  });
});
