import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelaLogin } from '@/features/auth';
import { supabase } from '@/lib/supabase';
import * as vinculo from '@/features/auth/vinculoAparelho';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: { signInWithPassword: vi.fn(), signOut: vi.fn(), resetPasswordForEmail: vi.fn(), signInWithOAuth: vi.fn() },
  },
}));

vi.mock('@/features/auth/vinculoAparelho', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/vinculoAparelho')>()),
  garantirSessaoAparelho: vi.fn().mockResolvedValue(undefined),
  obterPerfilSessao: vi.fn(),
  solicitarCodigoPareamento: vi.fn().mockResolvedValue({ codigo: 'K7Q4MP', expira_em: new Date(Date.now() + 600_000).toISOString() }),
}));

const perfilStaff = { autenticado: true, papel: 'staff' as const, id_usuario: 's-1', nome: 'Ana Staff', email: 'ana@ifms.edu.br', id_evento: 'e-1', metodos_vinculo: 'ambos' as const };

describe('TelaLogin', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null } as never);
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true }, error: null } as never);
  });

  it('não deve permitir entrar como avaliador só com o e-mail', async () => {
    // Arrange
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValue({ ...perfilStaff, papel: null, id_usuario: null });

    // Act
    render(<TelaLogin abaInicial="avaliador" />);

    // Assert
    expect(await screen.findByRole('status', { name: /código de pareamento/i })).toHaveTextContent('K7Q4MP');
    expect(screen.queryByLabelText(/e-mail de acesso/i)).not.toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalledWith('usuarios');
  });

  it('deve exigir e-mail e senha da equipe Staff', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoAutenticarSucesso = vi.fn();
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValue(perfilStaff);
    render(<TelaLogin abaInicial="staff" aoAutenticarSucesso={aoAutenticarSucesso} />);

    // Act
    await user.type(screen.getByLabelText(/e-mail de acesso/i), '  Ana@IFMS.edu.br ');
    await user.type(screen.getByLabelText(/senha de acesso/i), 'SenhaForte!1');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));

    // Assert
    await waitFor(() => expect(aoAutenticarSucesso).toHaveBeenCalledWith('staff'));
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@ifms.edu.br', password: 'SenhaForte!1' });
    expect(supabase.rpc).toHaveBeenCalledWith('fn_vincular_conta_staff');
    expect(localStorage.getItem('usuario_perfil')).toBe('staff');
  });

  it('deve recusar conta que não é da equipe Staff', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoAutenticarSucesso = vi.fn();
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValue({ ...perfilStaff, papel: null });
    render(<TelaLogin abaInicial="staff" aoAutenticarSucesso={aoAutenticarSucesso} />);

    // Act
    await user.type(screen.getByLabelText(/e-mail de acesso/i), 'qualquer@gmail.com');
    await user.type(screen.getByLabelText(/senha de acesso/i), 'x');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));

    // Assert
    expect(await screen.findByText(/não pertence à equipe staff/i)).toBeInTheDocument();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(aoAutenticarSucesso).not.toHaveBeenCalled();
  });

  it('deve mostrar a falha de senha da equipe Staff', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } } as never);
    render(<TelaLogin abaInicial="staff" />);

    // Act
    await user.type(screen.getByLabelText(/e-mail de acesso/i), 'ana@ifms.edu.br');
    await user.type(screen.getByLabelText(/senha de acesso/i), 'errada');
    await user.click(screen.getByRole('button', { name: /^entrar$/i }));

    // Assert
    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalledWith('fn_vincular_conta_staff');
  });

  it('deve enviar o link de "Esqueci minha senha" para a tela de redefinição', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({ data: {}, error: null } as never);
    render(<TelaLogin abaInicial="staff" />);

    // Act
    await user.type(screen.getByLabelText(/e-mail de acesso/i), 'Staff@IFMS.edu.br');
    await user.click(screen.getByRole('button', { name: /esqueci minha senha/i }));

    // Assert
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('staff@ifms.edu.br', {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    expect(await screen.findByText(/instruções de redefinição/i)).toBeInTheDocument();
  });
});
