import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '@/app/App';
import * as auth from '@/features/auth';

/**
 * A tela que não termina de baixar: com as telas divididas em pedaços, isto passou a ser possível
 * e é justamente o que acontece na rede do ginásio. O que não pode acontecer é a página ficar
 * branca — foi o risco que a divisão do bundle introduziu, e este teste é a prova de que o
 * anteparo pega.
 */

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

// O pedaço da tela do Admin não chega: é o que o navegador faz quando a busca do arquivo falha
vi.mock('@/features/admin/components/TelaAdmin', () =>
  Promise.reject(new Error('Failed to fetch dynamically imported module')),
);
vi.mock('@/features/avaliacao/components/TelaAvaliador', () => ({ TelaAvaliador: () => <p>Tela do Avaliador</p> }));
vi.mock('@/features/staff/components/TelaStaff', () => ({ TelaStaff: () => <p>Tela do Staff</p> }));
vi.mock('@/features/relatorios/components/TelaoAoVivo', () => ({ TelaoAoVivo: () => <p>Telão</p> }));
vi.mock('@/features/auth/components/TelaRedefinirSenha', () => ({ TelaRedefinirSenha: () => <p>Nova senha</p> }));
vi.mock('@/features/avaliacao', () => ({ TelaAutocadastroAvaliador: () => <p>Autocadastro</p> }));
vi.mock('@/features/auth', () => ({
  TelaLogin: () => <p>Tela de Login</p>,
  CAMINHO_REDEFINIR_SENHA: '/redefinir-senha',
  obterPerfilSessao: vi.fn(),
  lerPoliticaSeguranca: vi.fn(),
  EVENTO_POLITICA_ALTERADA: 'politica-seguranca-alterada',
}));

describe('App: tela que não termina de baixar', () => {
  beforeEach(() => {
    localStorage.clear();
    // O React escreve o erro no console de propósito
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(auth.obterPerfilSessao).mockResolvedValue({
      autenticado: true,
      papel: 'admin',
      id_usuario: 'u-1',
      nome: null,
      email: null,
      id_evento: null,
      metodos_vinculo: 'pareamento' as const,
    } as never);
    vi.mocked(auth.lerPoliticaSeguranca).mockResolvedValue({
      exigir_mfa_admin: false,
      minutos_inatividade_sessao: 30,
    } as never);
    window.history.replaceState({}, '', '/admin');
    localStorage.setItem('usuario_perfil', 'admin');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve explicar a falha e oferecer recarregar, em vez de deixar a página branca', async () => {
    // Arrange / Act
    render(<App />);

    // Assert: a espera é maior que o padrão porque `carregarTela` insiste duas vezes, com recuo
    // crescente, antes de desistir — são ~1,2 s em que a tela mostra "Carregando a tela..."
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      /não foi possível abrir esta tela/i,
    );
    expect(screen.getByRole('button', { name: /recarregar a página/i })).toBeInTheDocument();
  });

  it('deve manter o cabeçalho e o rodapé no lugar, para a pessoa saber onde está', async () => {
    // Arrange / Act
    render(<App />);
    await screen.findByRole('alert', {}, { timeout: 5000 });

    // Assert: a casca do sistema continua de pé, não é uma página de erro do navegador
    expect(screen.getByRole('link', { name: /pular para o conteúdo/i })).toBeInTheDocument();
    expect(screen.getByText(/Instituto Federal de Mato Grosso do Sul/)).toBeInTheDocument();
  });
});
