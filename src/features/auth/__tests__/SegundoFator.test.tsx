import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CadastroSegundoFator, VerificacaoSegundoFator } from '@/features/auth';
import { etapaSegundoFator } from '@/features/auth/segundoFator';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      mfa: {
        listFactors: vi.fn(),
        enroll: vi.fn(),
        unenroll: vi.fn(),
        challengeAndVerify: vi.fn(),
        getAuthenticatorAssuranceLevel: vi.fn(),
      },
    },
  },
}));

const mfa = supabase.auth.mfa as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('Segundo fator do Admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
    mfa.enroll.mockResolvedValue({
      data: { id: 'fator-1', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'SEGREDO123', uri: 'otpauth://x' } },
      error: null,
    });
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  });

  describe('etapa depois da senha', () => {
    it('pede o código a quem já cadastrou o aplicativo, mesmo com o MFA desligado', async () => {
      // Arrange
      mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });

      // Act / Assert
      expect(await etapaSegundoFator({ exigir_mfa_admin: false, minutos_inatividade_sessao: 0 })).toBe('verificar');
    });

    it('pede o cadastro quando o MFA é exigido e a conta ainda não tem aplicativo', async () => {
      // Arrange
      mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });

      // Act / Assert
      expect(await etapaSegundoFator({ exigir_mfa_admin: true, minutos_inatividade_sessao: 0 })).toBe('cadastrar');
      expect(await etapaSegundoFator({ exigir_mfa_admin: false, minutos_inatividade_sessao: 0 })).toBe('nenhuma');
    });
  });

  describe('cadastro do aplicativo', () => {
    it('mostra o QR Code e a chave, e conclui com o código correto', async () => {
      // Arrange
      const user = userEvent.setup();
      const aoConcluir = vi.fn();
      render(<CadastroSegundoFator aoConcluir={aoConcluir} aoCancelar={vi.fn()} />);

      // Act
      expect(await screen.findByRole('img', { name: /qr code/i })).toHaveAttribute('src', 'data:image/svg+xml;utf-8,<svg/>');
      expect(screen.getByText('SEGREDO123')).toBeInTheDocument();
      await user.type(screen.getByLabelText(/código de 6 dígitos/i), '123456');
      await user.click(screen.getByRole('button', { name: /confirmar/i }));

      // Assert
      await waitFor(() => expect(aoConcluir).toHaveBeenCalled());
      expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'fator-1', code: '123456' });
    });

    it('descarta um cadastro anterior não confirmado antes de gerar outro', async () => {
      // Arrange
      mfa.listFactors.mockResolvedValue({
        data: { all: [{ id: 'velho', factor_type: 'totp', status: 'unverified' }], totp: [] },
        error: null,
      });

      // Act
      render(<CadastroSegundoFator aoConcluir={vi.fn()} aoCancelar={vi.fn()} />);

      // Assert
      await screen.findByRole('img', { name: /qr code/i });
      expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'velho' });
    });

    it('mostra o erro e não conclui com código errado', async () => {
      // Arrange
      const user = userEvent.setup();
      const aoConcluir = vi.fn();
      mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid TOTP code entered' } });
      render(<CadastroSegundoFator aoConcluir={aoConcluir} aoCancelar={vi.fn()} />);
      await screen.findByRole('img', { name: /qr code/i });

      // Act
      await user.type(screen.getByLabelText(/código de 6 dígitos/i), '000000');
      await user.click(screen.getByRole('button', { name: /confirmar/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent(/código inválido/i);
      expect(aoConcluir).not.toHaveBeenCalled();
    });
  });

  describe('verificação no login', () => {
    it('confere o código do aplicativo já cadastrado', async () => {
      // Arrange
      const user = userEvent.setup();
      const aoConcluir = vi.fn();
      mfa.listFactors.mockResolvedValue({
        data: { all: [{ id: 'fator-ok', factor_type: 'totp', status: 'verified' }], totp: [{ id: 'fator-ok', status: 'verified' }] },
        error: null,
      });
      render(<VerificacaoSegundoFator aoConcluir={aoConcluir} aoCancelar={vi.fn()} />);

      // Act
      await user.type(await screen.findByLabelText(/código de 6 dígitos/i), '654321');
      await user.click(screen.getByRole('button', { name: /confirmar/i }));

      // Assert
      await waitFor(() => expect(aoConcluir).toHaveBeenCalled());
      expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'fator-ok', code: '654321' });
    });

    it('permite cancelar (volta ao login)', async () => {
      // Arrange
      const user = userEvent.setup();
      const aoCancelar = vi.fn();
      render(<VerificacaoSegundoFator aoConcluir={vi.fn()} aoCancelar={aoCancelar} />);

      // Act
      await user.click(await screen.findByRole('button', { name: /cancelar/i }));

      // Assert
      expect(aoCancelar).toHaveBeenCalled();
    });
  });
});
