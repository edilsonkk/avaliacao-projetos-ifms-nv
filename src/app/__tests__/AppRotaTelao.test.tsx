import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '@/app/App';
import * as auth from '@/features/auth';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  ambiente_supabase: 'local',
  verificar_conexao_configurada: () => true,
}));

vi.mock('@/features/avaliacao/components/TelaAvaliador', () => ({ TelaAvaliador: () => <p>Tela do Avaliador</p> }));
vi.mock('@/features/avaliacao', () => ({ TelaAutocadastroAvaliador: () => <p>Autocadastro</p> }));
vi.mock('@/features/admin/components/TelaAdmin', () => ({ TelaAdmin: () => <p>Tela do Admin</p> }));
vi.mock('@/features/staff/components/TelaStaff', () => ({ TelaStaff: () => <p>Tela do Staff</p> }));
vi.mock('@/features/relatorios/components/TelaoAoVivo', () => ({ TelaoAoVivo: () => <p>Telão ao Vivo</p> }));
vi.mock('@/features/auth/components/TelaRedefinirSenha', () => ({ TelaRedefinirSenha: () => <p>Tela de Redefinir Senha</p> }));
vi.mock('@/features/auth', () => ({
  TelaLogin: () => <p>Tela de Login</p>,
  CAMINHO_REDEFINIR_SENHA: '/redefinir-senha',
  obterPerfilSessao: vi.fn(),
  lerPoliticaSeguranca: vi.fn(),
  EVENTO_POLITICA_ALTERADA: 'politica-seguranca-alterada',
}));

/**
 * O Telão é projeção pública: quem olha de longe não opera o sistema. A faixa do topo
 * não deve ir para a parede — nem a navegação (que aparecia porque o papel vem do
 * `localStorage`, e o Telão abre em aba nova no mesmo navegador do Admin), nem os
 * controles de tema e de tamanho de texto, que apareciam para qualquer papel.
 */
describe('App - rota do Telão', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/telao');
    // Cenário real do defeito: o Admin está logado e abre o Telão em outra aba do mesmo navegador.
    vi.mocked(auth.obterPerfilSessao).mockResolvedValue({
      autenticado: true,
      papel: 'admin',
      id_usuario: 'u-1',
      nome: 'Coordenação',
      email: 'coordenacao@exemplo.br',
      id_evento: 'e-1',
      metodos_vinculo: 'pareamento' as const,
    });
  });

  it('não deve mostrar a faixa do topo no Telão', async () => {
    // Arrange: o navegador está na rota /telao, com uma sessão de Admin guardada
    localStorage.setItem('usuario_perfil', 'admin');
    localStorage.setItem('sessao_papel', 'admin');

    // Act
    render(<App />);

    // Assert
    expect(await screen.findByText('Telão ao Vivo')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Telas do sistema' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tema' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tamanho do texto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Staff' })).not.toBeInTheDocument();
  });

  it('deve manter a faixa do topo nas demais telas', async () => {
    // Arrange: mesma sessão de Admin, mas numa rota normal
    localStorage.setItem('usuario_perfil', 'admin');
    localStorage.setItem('sessao_papel', 'admin');
    window.history.replaceState({}, '', '/');

    // Act
    render(<App />);

    // Assert
    expect(await screen.findByRole('navigation', { name: 'Telas do sistema' })).toBeInTheDocument();
  });
});
