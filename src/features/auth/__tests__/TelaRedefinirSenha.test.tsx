import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelaRedefinirSenha } from '@/features/auth';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const sessaoRecuperacao = { user: { id: 'auth-1', email: 'staff@ifms.edu.br', is_anonymous: false } };

const prepararSessao = (sessao: unknown) => {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: sessao }, error: null } as never);
  vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } } as never);
};

const preencher = async (user: ReturnType<typeof userEvent.setup>, senha: string, confirmacao: string) => {
  await user.type(await screen.findByLabelText(/^nova senha/i), senha);
  await user.type(screen.getByLabelText(/repita a nova senha/i), confirmacao);
  await user.click(screen.getByRole('button', { name: /salvar nova senha/i }));
};

describe('TelaRedefinirSenha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);
  });

  it('deve gravar a nova senha, encerrar a sessão do link e levar ao login', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoConcluir = vi.fn();
    prepararSessao(sessaoRecuperacao);
    localStorage.setItem('usuario_perfil', 'staff');
    render(<TelaRedefinirSenha aoConcluir={aoConcluir} />);

    // Act
    await preencher(user, 'NovaSenha-2026', 'NovaSenha-2026');

    // Assert
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'NovaSenha-2026' });
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(/senha alterada/i);
    expect(localStorage.getItem('usuario_perfil')).toBeNull();
    await user.click(screen.getByRole('button', { name: /ir para o login/i }));
    expect(aoConcluir).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });

  it('deve recusar senhas diferentes sem chamar o Auth', async () => {
    // Arrange
    const user = userEvent.setup();
    prepararSessao(sessaoRecuperacao);
    render(<TelaRedefinirSenha aoConcluir={vi.fn()} />);

    // Act
    await preencher(user, 'NovaSenha-2026', 'OutraSenha-2026');

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent(/não conferem/i);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it('deve recusar senha curta demais', async () => {
    // Arrange
    const user = userEvent.setup();
    prepararSessao(sessaoRecuperacao);
    render(<TelaRedefinirSenha aoConcluir={vi.fn()} />);

    // Act
    await preencher(user, 'sete-ch', 'sete-ch'); // 7 caracteres: um a menos que o mínimo

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 8 caracteres/i);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it('deve mostrar o motivo quando o Auth recusa a senha e manter a sessão', async () => {
    // Arrange
    const user = userEvent.setup();
    prepararSessao(sessaoRecuperacao);
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: {}, error: { message: 'Password is known to be weak' } } as never);
    render(<TelaRedefinirSenha aoConcluir={vi.fn()} />);

    // Act
    await preencher(user, 'SenhaComum123', 'SenhaComum123');

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/weak/i);
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('deve avisar que o link expirou quando não há sessão de recuperação', async () => {
    // Arrange
    prepararSessao(null);

    // Act
    render(<TelaRedefinirSenha aoConcluir={vi.fn()} />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/inválido ou expirou/i);
    expect(screen.queryByLabelText(/^nova senha/i)).not.toBeInTheDocument();
  });

  it('não deve aceitar a sessão anônima do celular como link de recuperação', async () => {
    // Arrange
    prepararSessao({ user: { id: 'anon-1', is_anonymous: true } });

    // Act
    render(<TelaRedefinirSenha aoConcluir={vi.fn()} />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/inválido ou expirou/i);
  });

  it('deve liberar o formulário quando o Auth avisa PASSWORD_RECOVERY depois de abrir', async () => {
    // Arrange
    let avisar: (evento: string, sessao: unknown) => void = () => {};
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null } as never);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(((cb: typeof avisar) => {
      avisar = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }) as never);
    render(<TelaRedefinirSenha aoConcluir={vi.fn()} />);
    await screen.findByRole('alert');

    // Act
    avisar('PASSWORD_RECOVERY', sessaoRecuperacao);

    // Assert
    await waitFor(() => expect(screen.getByLabelText(/^nova senha/i)).toBeInTheDocument());
  });
});
