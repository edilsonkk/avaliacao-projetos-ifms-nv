import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// Telas substituídas por marcadores: o teste é só do roteamento pela URL do QR Code.
// O autocadastro expõe os dois caminhos de saída para o teste poder acioná-los.
vi.mock('@/features/avaliacao', () => ({
  TelaAvaliador: () => <p>Tela do Avaliador</p>,
  TelaAutocadastroAvaliador: ({ aoConcluir, aoVoltar }: { aoConcluir: () => void; aoVoltar: () => void }) => (
    <div>
      <p>Autocadastro</p>
      <button type="button" onClick={aoConcluir}>
        Concluir cadastro
      </button>
      <button type="button" onClick={aoVoltar}>
        Voltar ao login
      </button>
    </div>
  ),
}));
vi.mock('@/features/admin', () => ({ TelaAdmin: () => <p>Tela do Admin</p> }));
vi.mock('@/features/staff', () => ({ TelaStaff: () => <p>Tela do Staff</p> }));
vi.mock('@/features/relatorios', () => ({ TelaoAoVivo: () => <p>Telão</p> }));
vi.mock('@/features/auth', () => ({
  TelaLogin: () => <p>Tela de Login</p>,
  TelaRedefinirSenha: () => <p>Tela de Redefinir Senha</p>,
  CAMINHO_REDEFINIR_SENHA: '/redefinir-senha',
  obterPerfilSessao: vi.fn(),
  lerPoliticaSeguranca: vi.fn(),
  EVENTO_POLITICA_ALTERADA: 'politica-seguranca-alterada',
}));

const CAMINHO_DO_QR = '/?cadastro=avaliador&evento=e-1';

describe('App - rota do autocadastro pelo QR Code', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', CAMINHO_DO_QR);
    vi.mocked(auth.obterPerfilSessao).mockResolvedValue({
      autenticado: false,
      papel: null,
      id_usuario: null,
      nome: null,
      email: null,
      id_evento: null,
      metodos_vinculo: 'ambos' as const,
    });
  });

  it('deve abrir o autocadastro quando a pessoa chega pelo link do QR Code', () => {
    // Arrange: a URL do QR Code já está na barra de endereço (ver beforeEach)

    // Act
    render(<App />);

    // Assert
    expect(screen.getByText('Autocadastro')).toBeInTheDocument();
  });

  it('deve limpar a URL ao concluir o cadastro, para a atualização da página cair no login', async () => {
    // Arrange
    render(<App />);

    // Act
    await userEvent.click(screen.getByRole('button', { name: /concluir cadastro/i }));

    // Assert
    expect(screen.getByText('Tela de Login')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('deve limpar a URL ao voltar do autocadastro sem cadastrar', async () => {
    // Arrange
    render(<App />);

    // Act
    await userEvent.click(screen.getByRole('button', { name: /voltar ao login/i }));

    // Assert
    expect(screen.getByText('Tela de Login')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('deve seguir no login quando a página é atualizada depois do cadastro', async () => {
    // Arrange: conclui o cadastro e desmonta, como num F5
    const primeira = render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /concluir cadastro/i }));
    primeira.unmount();

    // Act
    render(<App />);

    // Assert
    expect(screen.getByText('Tela de Login')).toBeInTheDocument();
    expect(screen.queryByText('Autocadastro')).not.toBeInTheDocument();
  });
});
