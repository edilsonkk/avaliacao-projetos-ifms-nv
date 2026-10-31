import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecaoSegurancaContas } from '@/features/admin/components/SecaoSegurancaContas';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(),
        listFactors: vi.fn(),
        enroll: vi.fn(),
        unenroll: vi.fn(),
        challengeAndVerify: vi.fn(),
      },
    },
  },
}));

const mfa = () => supabase.auth.mfa as unknown as Record<string, ReturnType<typeof vi.fn>>;
let politica = { exigir_mfa_admin: false, minutos_inatividade_sessao: 0 };

describe('SecaoSegurancaContas (engrenagem do Admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    politica = { exigir_mfa_admin: false, minutos_inatividade_sessao: 0 };
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
    vi.mocked(supabase.rpc).mockImplementation(((nome: string, args: any) => {
      if (nome === 'admin_salvar_configuracoes_seguranca') {
        politica = { exigir_mfa_admin: args.p_exigir_mfa_admin, minutos_inatividade_sessao: args.p_minutos_inatividade };
      }
      return Promise.resolve({ data: politica, error: null });
    }) as never);
    mfa().getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
    mfa().listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
    mfa().enroll.mockResolvedValue({ data: { id: 'f-novo', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'S', uri: 'u' } }, error: null });
    mfa().challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    mfa().unenroll.mockResolvedValue({ data: {}, error: null });
  });

  it('deve mostrar a política atual do banco', async () => {
    // Arrange
    politica = { exigir_mfa_admin: true, minutos_inatividade_sessao: 45 };

    // Act
    render(<SecaoSegurancaContas />);

    // Assert
    expect(await screen.findByRole('checkbox', { name: /exigir segundo fator/i })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: /encerrar sessão/i })).toHaveValue(45);
  });

  it('deve gravar o tempo de expiração e avisar o app', async () => {
    // Arrange
    const user = userEvent.setup();
    const aviso = vi.fn();
    window.addEventListener('politica-seguranca-alterada', aviso);
    render(<SecaoSegurancaContas />);
    const campo = await screen.findByRole('spinbutton', { name: /encerrar sessão/i });

    // Act
    await user.clear(campo);
    await user.type(campo, '30');
    await user.click(screen.getByRole('button', { name: /salvar segurança/i }));

    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent(/salv/i);
    expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_configuracoes_seguranca', { p_exigir_mfa_admin: false, p_minutos_inatividade: 30 });
    expect(aviso).toHaveBeenCalled();
    window.removeEventListener('politica-seguranca-alterada', aviso);
  });

  it('deve recusar tempo fora da faixa sem chamar o banco', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<SecaoSegurancaContas />);
    const campo = await screen.findByRole('spinbutton', { name: /encerrar sessão/i });

    // Act
    await user.clear(campo);
    await user.type(campo, '3');
    await user.click(screen.getByRole('button', { name: /salvar segurança/i }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/0.*5 a 720/);
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_salvar_configuracoes_seguranca', expect.anything());
  });

  it('ligar o MFA abre o cadastro do aplicativo e só grava depois do código confirmado', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<SecaoSegurancaContas />);
    await user.click(await screen.findByRole('checkbox', { name: /exigir segundo fator/i }));

    // Act
    await user.click(screen.getByRole('button', { name: /salvar segurança/i }));
    expect(await screen.findByRole('heading', { name: /cadastrar o aplicativo autenticador/i })).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_salvar_configuracoes_seguranca', expect.anything());
    await user.type(screen.getByLabelText(/código de 6 dígitos/i), '123456');
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    // Assert
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_configuracoes_seguranca', { p_exigir_mfa_admin: true, p_minutos_inatividade: 0 })
    );
    expect(mfa().challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-novo', code: '123456' });
  });

  it('cancelar o cadastro não liga o MFA', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<SecaoSegurancaContas />);
    await user.click(await screen.findByRole('checkbox', { name: /exigir segundo fator/i }));
    await user.click(screen.getByRole('button', { name: /salvar segurança/i }));

    // Act
    await user.click(await screen.findByRole('button', { name: /cancelar/i }));

    // Assert
    expect(await screen.findByRole('checkbox', { name: /exigir segundo fator/i })).not.toBeChecked();
    expect(supabase.rpc).not.toHaveBeenCalledWith('admin_salvar_configuracoes_seguranca', expect.anything());
  });

  it('desligar o MFA grava e remove o aplicativo cadastrado da conta', async () => {
    // Arrange
    const user = userEvent.setup();
    politica = { exigir_mfa_admin: true, minutos_inatividade_sessao: 0 };
    mfa().getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    mfa().listFactors.mockResolvedValue({ data: { all: [{ id: 'f-1', factor_type: 'totp', status: 'verified' }], totp: [{ id: 'f-1', status: 'verified' }] }, error: null });
    render(<SecaoSegurancaContas />);
    await user.click(await screen.findByRole('checkbox', { name: /exigir segundo fator/i }));

    // Act
    await user.click(screen.getByRole('button', { name: /salvar segurança/i }));

    // Assert
    await waitFor(() => expect(mfa().unenroll).toHaveBeenCalledWith({ factorId: 'f-1' }));
    expect(supabase.rpc).toHaveBeenCalledWith('admin_salvar_configuracoes_seguranca', { p_exigir_mfa_admin: false, p_minutos_inatividade: 0 });
  });
});
