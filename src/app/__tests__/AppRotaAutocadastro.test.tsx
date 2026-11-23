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
vi.mock('@/features/avaliacao/components/TelaAvaliador', () => ({ TelaAvaliador: () => <p>Tela do Avaliador</p> }));
vi.mock('@/features/avaliacao', () => ({
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
vi.mock('@/features/admin/components/TelaAdmin', () => ({ TelaAdmin: () => <p>Tela do Admin</p> }));
vi.mock('@/features/staff/components/TelaStaff', () => ({ TelaStaff: () => <p>Tela do Staff</p> }));
vi.mock('@/features/relatorios/components/TelaoAoVivo', () => ({ TelaoAoVivo: () => <p>Telão</p> }));
vi.mock('@/features/auth/components/TelaRedefinirSenha', () => ({ TelaRedefinirSenha: () => <p>Tela de Redefinir Senha</p> }));
vi.mock('@/features/auth', () => ({
  TelaLogin: () => <p>Tela de Login</p>,
  CAMINHO_REDEFINIR_SENHA: '/redefinir-senha',
  obterPerfilSessao: vi.fn(),
  lerPoliticaSeguranca: vi.fn(),
  EVENTO_POLITICA_ALTERADA: 'politica-seguranca-alterada',
}));

const CAMINHO_DO_QR = '/?cadastro=avaliador&evento=e-1';

describe('App - rota do autocadastro pelo QR Code', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', CAMINHO_DO_QR);
    vi.mocked(auth.obterPerfilSessao).mockResolvedValue({
      autenticado: false,
      papel: null,
      id_usuario: null,
      nome: null,
      email: null,
      id_evento: null,
      metodos_vinculo: 'pareamento' as const,
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

  // ---------------------------------------------------------------------------
  // Depois que a tela tira a instrução da URL, quem decide a reentrada é a ABA.
  // É a diferença entre perder o formulário no meio e ficar preso nele para sempre.
  // ---------------------------------------------------------------------------

  it('deve voltar ao formulário quando a página é atualizada no meio do cadastro', () => {
    // Arrange: a tela já tirou a instrução da URL e marcou a aba
    sessionStorage.setItem('rota_autocadastro_em_curso', '1');
    window.history.replaceState({}, '', '/');

    // Act
    render(<App />);

    // Assert
    expect(screen.getByText('Autocadastro')).toBeInTheDocument();
  });

  it('não deve levar ao autocadastro quem atualiza a página com a URL limpa', () => {
    // Arrange: avaliador com papel guardado, sem cadastro em curso — o caso do defeito
    localStorage.setItem('sessao_papel', 'avaliador');
    localStorage.setItem('usuario_perfil', 'avaliador');
    window.history.replaceState({}, '', '/');

    // Act
    render(<App />);

    // Assert
    expect(screen.queryByText('Autocadastro')).not.toBeInTheDocument();
    expect(screen.getByText('Tela de Login')).toBeInTheDocument();
  });

  it('deve apagar a marca da aba ao voltar ao login sem cadastrar', async () => {
    // Arrange
    sessionStorage.setItem('rota_autocadastro_em_curso', '1');
    window.history.replaceState({}, '', '/');
    render(<App />);

    // Act
    await userEvent.click(screen.getByRole('button', { name: /voltar ao login/i }));

    // Assert: a próxima atualização não reentra
    expect(sessionStorage.getItem('rota_autocadastro_em_curso')).toBeNull();
    expect(screen.getByText('Tela de Login')).toBeInTheDocument();
  });
});
