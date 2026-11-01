import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TelaAvaliador } from '@/features/avaliacao';
import { ProvedorAvisos } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { esperarSemViolacoesDeAcessibilidade } from '@/test/axe';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
  },
  isSupabaseConfigured: () => true,
  verificar_conexao_configurada: () => true,
}));

/**
 * Sair apaga a sessão anônima do aparelho, que é a credencial do vínculo: para avaliar de
 * novo é preciso um código novo com o Staff. Estes testes garantem que a pessoa é avisada
 * antes, e que desistir não custa nada.
 */
describe('TelaAvaliador - aviso antes de sair e desvincular', () => {
  const EVENTO = 'e0000000-0000-0000-0000-000000000001';
  const AVALIADOR = 'u0000000-0000-0000-0000-000000000001';

  const criarQueryChain = (resultado: unknown) => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(resultado),
      single: vi.fn().mockResolvedValue(resultado),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      then: (resolve: (valor: unknown) => unknown) => Promise.resolve(resultado).then(resolve),
    };
    return chain;
  };

  /** Evento bem no futuro: a tela abre no cartão "as avaliações ainda não começaram". */
  const montarTela = () => {
    vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: EVENTO,
            nome_evento: 'FETEC MS 2026',
            data_evento: '2099-12-31',
            horario_inicio: '08:00',
            horario_fim: '18:00',
            sistema_liberado: true,
            is_ativo: true,
          },
          error: null,
        });
      }
      if (tabela === 'locks_ativos') return criarQueryChain({ data: null, error: null });
      return criarQueryChain({ data: [], error: null });
    }) as never);

    return render(
      <ProvedorAvisos>
        <TelaAvaliador id_usuario_logado={AVALIADOR} id_evento_ativo={EVENTO} />
      </ProvedorAvisos>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('sessao_id_usuario', AVALIADOR);
    localStorage.setItem('avaliador_nome', 'Prof. Avaliador IFMS');
    localStorage.setItem('avaliador_email', 'avaliador@ifms.edu.br');
  });

  it('deve explicar a perda do vínculo e oferecer continuar avaliando', async () => {
    // Arrange
    const user = userEvent.setup();
    montarTela();
    const botoesSair = await screen.findAllByRole('button', { name: /sair e desvincular/i });

    // Act
    await user.click(botoesSair[0]);

    // Assert
    const dialogo = screen.getByRole('alertdialog', { name: 'Sair e desvincular este celular?' });
    expect(dialogo).toHaveTextContent(/deixa de ficar vinculado a você/i);
    expect(dialogo).toHaveTextContent(/pedir um novo código ao Staff/i);
    expect(within(dialogo).getByRole('button', { name: 'Continuar avaliando' })).toHaveFocus();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('não deve encerrar nada quando a pessoa desiste', async () => {
    // Arrange
    const user = userEvent.setup();
    montarTela();
    const botoesSair = await screen.findAllByRole('button', { name: /sair e desvincular/i });
    await user.click(botoesSair[0]);

    // Act
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Continuar avaliando' }));

    // Assert
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('sessao_id_usuario')).toBe(AVALIADOR);
    expect(screen.getByText('As avaliações ainda não começaram')).toBeInTheDocument();
  });

  it('deve encerrar a sessão do aparelho só depois da confirmação', async () => {
    // Arrange
    const user = userEvent.setup();
    montarTela();
    const botoesSair = await screen.findAllByRole('button', { name: /sair e desvincular/i });
    await user.click(botoesSair[0]);

    // Act
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sair e desvincular' }));

    // Assert
    await waitFor(() => expect(supabase.auth.signOut).toHaveBeenCalled());
    expect(localStorage.getItem('sessao_id_usuario')).toBeNull();
  });

  it('deve trazer a dica explicando o que o botão faz, sem depender do mouse', async () => {
    // Arrange
    const user = userEvent.setup();
    montarTela();
    await screen.findAllByRole('button', { name: /sair e desvincular/i });

    // Act
    await user.click(screen.getAllByRole('button', { name: /mais informações/i })[0]);

    // Assert
    expect(screen.getAllByRole('tooltip')[0]).toHaveTextContent(/Sair desvincula este celular/i);
  });

  it('não deve ter violação de acessibilidade na tela', async () => {
    // Arrange
    const { container } = montarTela();
    await screen.findAllByRole('button', { name: /sair e desvincular/i });

    // Act / Assert
    await esperarSemViolacoesDeAcessibilidade(container);
  });
});
