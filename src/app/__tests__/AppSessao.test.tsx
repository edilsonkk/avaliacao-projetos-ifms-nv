import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '@/app/App';
import * as auth from '@/features/auth';

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
  ambiente_supabase: 'local',
  verificar_conexao_configurada: () => true,
}));

// Telas substituídas por marcadores: o teste é só do roteamento por sessão
vi.mock('@/features/avaliacao', () => ({
  TelaAvaliador: () => <p>Tela do Avaliador</p>,
  TelaAutocadastroAvaliador: () => <p>Autocadastro</p>,
}));
vi.mock('@/features/admin', () => ({ TelaAdmin: () => <p>Tela do Admin</p> }));
vi.mock('@/features/staff', () => ({ TelaStaff: () => <p>Tela do Staff</p> }));
vi.mock('@/features/relatorios', () => ({ TelaoAoVivo: () => <p>Telão</p> }));
vi.mock('@/features/auth', () => ({
  TelaLogin: () => <p>Tela de Login</p>,
  obterPerfilSessao: vi.fn(),
}));

const perfil = (papel: 'avaliador' | 'staff' | 'admin' | null) => ({
  autenticado: papel !== null, papel, id_usuario: papel ? 'u-1' : null, nome: null, email: null, id_evento: null, metodos_vinculo: 'ambos' as const,
});

describe('App - sessão confirmada pelo banco', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/avaliador');
  });

  it('deve voltar ao login quando o papel do navegador não bate com a sessão real', async () => {
    // Arrange: alguém editou o localStorage para se passar por avaliador
    localStorage.setItem('usuario_perfil', 'avaliador');
    localStorage.setItem('sessao_id_usuario', 'id-de-outra-pessoa');
    vi.mocked(auth.obterPerfilSessao).mockResolvedValue(perfil(null));

    // Act
    render(<App />);

    // Assert
    expect(await screen.findByText('Tela de Login')).toBeInTheDocument();
    expect(localStorage.getItem('sessao_id_usuario')).toBeNull();
  });

  it('deve manter a tela quando a sessão confirma o papel', async () => {
    // Arrange
    localStorage.setItem('usuario_perfil', 'avaliador');
    vi.mocked(auth.obterPerfilSessao).mockResolvedValue(perfil('avaliador'));

    // Act
    render(<App />);

    // Assert
    await waitFor(() => expect(auth.obterPerfilSessao).toHaveBeenCalled());
    expect(screen.getByText('Tela do Avaliador')).toBeInTheDocument();
  });
});
