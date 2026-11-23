import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelaAutocadastroAvaliador } from '@/features/avaliacao';
import { supabase } from '@/lib/supabase';
import { autocadastroEmCurso } from '@/lib/rotaAutocadastro';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  verificar_conexao_configurada: () => true,
}));

const ID_EVENTO = 'e0000000-0000-0000-0000-000000000001';

const tabelas: Record<string, unknown> = {
  eventos: { id_evento: ID_EVENTO, nome_evento: 'FETEC MS 2026' },
  instituicoes: [{ id_instituicao: 'inst-1', nome_exibicao: 'IFMS Campo Grande' }],
  areas_tematicas: [{ id_area: 'area-1', nome_area: 'CIÊNCIAS EXATAS E DA TERRA' }],
};

const mockarCatalogos = () => {
  vi.mocked(supabase.from).mockImplementation((tabela: string) => {
    const dados = tabelas[tabela];
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: dados, error: null }),
      single: vi.fn().mockResolvedValue({ data: dados, error: null }),
      then: (resolve: any) => Promise.resolve({ data: dados, error: null }).then(resolve),
    };
    return chain;
  });
};

const preencherFormulario = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByPlaceholderText(/Prof\. Dr\. Carlos Silva/i), 'Roberto Mendes');
  await user.type(screen.getByPlaceholderText(/seu\.email@exemplo\.com/i), 'Roberto@Escola.br');
  await user.selectOptions(screen.getByRole('combobox'), 'inst-1');
  await user.click(screen.getByRole('button', { name: /Ciências Exatas e da Terra/i }));
  await user.click(screen.getByRole('button', { name: /Concluir Cadastro/i }));
};

describe('TelaAutocadastroAvaliador', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', `/?cadastro=avaliador&evento=${ID_EVENTO}`);
    mockarCatalogos();
  });

  it('deve cadastrar pelo RPC seguro, sem gravar direto nas tabelas', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true, situacao: 'cadastrado' }, error: null } as never);
    render(<TelaAutocadastroAvaliador aoConcluir={vi.fn()} />);

    // Act
    await preencherFormulario(user);

    // Assert
    expect(await screen.findByText('Cadastro Concluído!')).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith('fn_autocadastro_avaliador', {
      p_id_evento: ID_EVENTO,
      p_nome: 'Roberto Mendes',
      p_email: 'roberto@escola.br',
      p_id_instituicao: 'inst-1',
      p_nome_instituicao_nova: null,
      p_ids_areas: ['area-1'],
    });
    const tabelasLidas = vi.mocked(supabase.from).mock.calls.map(([t]) => t);
    expect(tabelasLidas).not.toContain('usuarios');
    expect(tabelasLidas).not.toContain('avaliadores_evento');
  });

  it('deve mostrar a recusa do banco sem exibir sucesso', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'E-mail inválido.' } } as never);
    render(<TelaAutocadastroAvaliador aoConcluir={vi.fn()} />);

    // Act
    await preencherFormulario(user);

    // Assert
    await waitFor(() => expect(screen.getByText('E-mail inválido.')).toBeInTheDocument());
    expect(screen.queryByText('Cadastro Concluído!')).not.toBeInTheDocument();
  });

  it('sem evento no link deve usar o evento ativo do banco, e não um evento guardado no navegador', async () => {
    // Arrange
    window.history.replaceState({}, '', '/?cadastro=avaliador');
    localStorage.setItem('evento_ativo_id', 'evento-do-ano-passado');
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true }, error: null } as never);
    render(<TelaAutocadastroAvaliador />);

    // Act
    await preencherFormulario(user);

    // Assert
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('fn_autocadastro_avaliador', expect.objectContaining({ p_id_evento: ID_EVENTO }))
    );
  });

  it('sem evento ativo deve avisar em vez de mostrar instituições de todos os eventos', async () => {
    // Arrange
    window.history.replaceState({}, '', '/?cadastro=avaliador');
    const eventoAtivo = tabelas.eventos;
    tabelas.eventos = null;

    // Act
    render(<TelaAutocadastroAvaliador />);

    // Assert
    expect(await screen.findByText(/não há evento ativo/i)).toBeInTheDocument();
    expect(vi.mocked(supabase.from).mock.calls.map((c) => c[0])).not.toContain('instituicoes');
    tabelas.eventos = eventoAtivo;
  });

  // ---------------------------------------------------------------------------
  // A instrução do QR Code é de uma vez: enquanto morava só na URL, toda atualização
  // de página reentrava aqui — inclusive a de quem já estava logado.
  // ---------------------------------------------------------------------------

  it('deve tirar a instrução do QR Code da URL assim que a tela abre', async () => {
    // Arrange: a URL do QR está na barra de endereço (ver beforeEach)
    expect(window.location.search).toContain('cadastro=avaliador');

    // Act
    render(<TelaAutocadastroAvaliador aoConcluir={vi.fn()} />);
    await screen.findByPlaceholderText(/Prof\. Dr\. Carlos Silva/i);

    // Assert: a URL fica limpa, e a intenção passa a viver na aba
    expect(window.location.search).toBe('');
    expect(autocadastroEmCurso()).toBe(true);
  });

  it('deve manter a intenção na aba enquanto o formulário está em preenchimento', async () => {
    // Arrange
    render(<TelaAutocadastroAvaliador aoConcluir={vi.fn()} />);
    await screen.findByPlaceholderText(/Prof\. Dr\. Carlos Silva/i);

    // Act: é o F5 de quem está digitando em rede ruim — a URL já está limpa
    window.history.replaceState({}, '', '/');

    // Assert: quem recarregar volta ao formulário, não ao login
    expect(autocadastroEmCurso()).toBe(true);
  });

  it('deve encerrar a intenção no sucesso do cadastro, antes de qualquer clique', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true, situacao: 'cadastrado' }, error: null } as never);
    render(<TelaAutocadastroAvaliador aoConcluir={vi.fn()} />);

    // Act: cadastra e NÃO clica no botão de concluir da tela de sucesso
    await preencherFormulario(user);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());

    // Assert: atualizar a página agora cai no login, e não num formulário já enviado
    await waitFor(() => expect(autocadastroEmCurso()).toBe(false));
    expect(window.location.search).toBe('');
  });

  it('não deve quebrar quando a aba recusa armazenamento (aba privada)', async () => {
    // Arrange: sessionStorage que lança em toda operação
    const original = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => { throw new Error('acesso negado ao armazenamento'); },
    });

    try {
      // Act + Assert: a tela abre, e a leitura da intenção não propaga erro
      render(<TelaAutocadastroAvaliador aoConcluir={vi.fn()} />);
      await screen.findByPlaceholderText(/Prof\. Dr\. Carlos Silva/i);
      expect(() => autocadastroEmCurso()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: original });
    }
  });
});
