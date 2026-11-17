import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalConfiguracoesEvento } from '@/features/admin';
import { supabase } from '@/lib/supabase';
import { ProvedorAvisos } from '@/components/ui';
import { ProvedorIdentidadeVisual } from '@/components/layout/IdentidadeVisual';

vi.mock('@/lib/supabase', () => ({
  // `auth.getSession`: finalizar o evento é escrita de Admin e passa por garantirSessaoAdmin()
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null }) },
  },
  verificar_conexao_configurada: () => true,
}));

const ID_EVENTO = 'e0000000-0000-0000-0000-000000000001';

const eventoGravado = {
  id_evento: ID_EVENTO,
  nome_evento: 'FETEC MS 2026',
  data_evento: '2026-11-15',
  horario_inicio: '08:00',
  horario_fim: '18:00',
  minutos_timeout_lock: 30,
  cota_avaliacoes_padrao: 3,
  sistema_liberado: true,
  minutos_validade_pareamento: 8,
  minutos_validade_codigo_acesso: 20,
  tamanho_codigo: 7,
  max_tentativas_codigo: 4,
  metodos_vinculo: 'pareamento',
  fixar_questionario_primeira_avaliacao: false,
  edicao: 'Nova Edição',
};

let updates: Record<string, unknown>[] = [];

const mockarEventos = (erroUpdate: { code: string; message: string } | null = null) => {
  vi.mocked(supabase.from).mockImplementation(() => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn().mockResolvedValue({ data: eventoGravado, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: eventoGravado, error: null }),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: vi.fn().mockResolvedValue({ error: erroUpdate }) };
      }),
      then: (resolve: any) => Promise.resolve({ data: [eventoGravado], error: null }).then(resolve),
    };
    return chain;
  });
};

const renderizar = () =>
  render(<ProvedorAvisos><ProvedorIdentidadeVisual><ModalConfiguracoesEvento id_evento_ativo={ID_EVENTO} nome_evento_atual="FETEC MS 2026" ao_fechar={vi.fn()} /></ProvedorIdentidadeVisual></ProvedorAvisos>);

describe('ModalConfiguracoesEvento - acesso dos avaliadores', () => {
  beforeEach(() => {
    updates = [];
    localStorage.clear();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockarEventos();
  });

  it('deve carregar os parâmetros de acesso gravados no evento', async () => {
    // Act
    renderizar();

    // Assert
    expect(await screen.findByLabelText(/tamanho dos códigos/i)).toHaveValue(7);
    expect(screen.getByLabelText(/validade do código de pareamento/i)).toHaveValue(8);
    expect(screen.getByLabelText(/validade do código de acesso/i)).toHaveValue(20);
    expect(screen.getByLabelText(/tentativas por código de acesso/i)).toHaveValue(4);
    expect(screen.getByLabelText(/formas de vincular o celular/i)).toHaveValue('pareamento');
  });

  it('deve impedir salvar com valor fora dos limites', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    const tamanho = await screen.findByLabelText(/tamanho dos códigos/i);

    // Act
    await user.clear(tamanho);
    await user.type(tamanho, '4');
    await user.click(screen.getByRole('button', { name: /salvar configurações/i }));

    // Assert
    expect(tamanho).toBeInvalid();
    expect(updates).toHaveLength(0);
  });

  it('deve explicar quando o banco recusa um parâmetro fora dos limites', async () => {
    // Arrange
    const user = userEvent.setup();
    mockarEventos({ code: '23514', message: 'violates check constraint "ck_eventos_tamanho_codigo"' });
    renderizar();
    await screen.findByLabelText(/tamanho dos códigos/i);

    // Act
    await user.click(screen.getByRole('button', { name: /salvar configurações/i }));

    // Assert
    expect(await screen.findByText(/parâmetro de acesso está fora dos limites permitidos/i)).toBeInTheDocument();
  });

  it('deve gravar os parâmetros de acesso junto com as configurações do evento', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    const tamanho = await screen.findByLabelText(/tamanho dos códigos/i);

    // Act
    await user.clear(tamanho);
    await user.type(tamanho, '8');
    await user.selectOptions(screen.getByLabelText(/formas de vincular o celular/i), 'codigo');
    await user.click(screen.getByRole('button', { name: /salvar configurações/i }));

    // Assert
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      tamanho_codigo: 8,
      metodos_vinculo: 'codigo',
      minutos_validade_pareamento: 8,
      minutos_validade_codigo_acesso: 20,
      max_tentativas_codigo: 4,
    });
  });

  it('deve explicar cada forma de vincular o celular na dica do campo', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    const select = await screen.findByLabelText(/formas de vincular o celular/i);
    const dica = select.parentElement!.querySelector('button[aria-label="Mais informações"]') as HTMLElement;

    // Act
    await user.hover(dica);

    // Assert
    expect(dica).toHaveAccessibleDescription(/pareamento pelo staff.*código de acesso/i);
  });

  it('deve ler e gravar a trava do questionário no primeiro avaliador', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();
    const trava = await screen.findByRole('checkbox', { name: /travar o questionário no primeiro avaliador/i });

    // Assert: o evento está com a trava desligada no banco
    expect(trava).not.toBeChecked();

    // Act
    await user.click(trava);
    await user.click(screen.getByRole('button', { name: /salvar configurações/i }));

    // Assert
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({ fixar_questionario_primeira_avaliacao: true });
  });

  it('deve oferecer uma forma por evento: só pareamento ou só código, sem "ambos"', async () => {
    // Arrange / Act
    renderizar();
    const select = await screen.findByLabelText(/formas de vincular o celular/i);

    // Assert
    const opcoes = Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(opcoes).toEqual(['pareamento', 'codigo']);
  });

  it('deve ter dica em todos os campos da configuração', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { exigir_mfa_admin: false, minutos_inatividade_sessao: 0 }, error: null } as never);

    // Act: espera também a seção de segurança, que carrega a política à parte
    renderizar();
    await screen.findByLabelText(/tamanho dos códigos/i);
    await screen.findByRole('checkbox', { name: /exigir segundo fator/i });

    // Assert: 9 campos do evento (inclui a trava do questionário e a edição) + 5 de acesso
    // + 2 de segurança das contas + finalizar evento + zona de perigo
    const dicas = screen.getAllByRole('button', { name: /mais informações/i });
    expect(dicas).toHaveLength(18);
    dicas.forEach((d) => expect(d).toHaveAccessibleDescription(/.{30,}/));
  });

  /**
   * O cadastro de evento gravava "Nova Edição" quando o campo ficava vazio, e não havia
   * campo nenhum nas Configurações para corrigir depois — o texto de preenchimento ia
   * para a parede no Telão. Agora o campo existe e vazio grava nulo.
   */
  it('deve carregar a edição gravada e permitir limpá-la', async () => {
    // Arrange
    renderizar();
    const campo = await screen.findByLabelText(/edição/i);
    expect(campo).toHaveValue('Nova Edição');

    // Act
    await userEvent.clear(campo);
    await userEvent.click(screen.getByRole('button', { name: /salvar configurações/i }));

    // Assert
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(updates[0]).toMatchObject({ edicao: null });
  });

  /**
   * Encerrar a feira era desmarcar "Sistema liberado para avaliadores" — o mesmo campo
   * usado para pausar. Pausar não pode soltar os avaliadores (o celular deles só volta
   * pelo Staff), então encerrar ganhou ação própria, com confirmação que diz quantas
   * avaliações estão em andamento naquele instante.
   */
  describe('finalizar evento', () => {
    it('deve avisar quantos estão em andamento e só finalizar após confirmação', async () => {
      // Arrange
      vi.mocked(supabase.rpc).mockImplementation(((funcao: string) => {
        if (funcao === 'fn_telao_resumo') {
          return Promise.resolve({ data: { avaliacoes_em_andamento: 2 }, error: null });
        }
        return Promise.resolve({ data: { ok: true, travas_liberadas: 2, aparelhos_desvinculados: 5 }, error: null });
      }) as never);
      renderizar();

      // Act
      await userEvent.click(await screen.findByRole('button', { name: /finalizar evento/i }));

      // Assert: nada acontece antes da confirmação
      const dialogo = await screen.findByRole('alertdialog', { name: /finalizar o evento/i });
      expect(dialogo).toHaveTextContent(/2 avaliaç/i);
      expect(dialogo).toHaveTextContent(/parear/i);
      expect(vi.mocked(supabase.rpc).mock.calls.filter((c) => c[0] === 'admin_finalizar_evento')).toHaveLength(0);

      // Act
      await userEvent.click(within(dialogo).getByRole('button', { name: /finalizar evento/i }));

      // Assert
      await waitFor(() =>
        expect(supabase.rpc).toHaveBeenCalledWith('admin_finalizar_evento', { p_id_evento: ID_EVENTO }),
      );
    });

    it('não deve finalizar se a confirmação for recusada', async () => {
      // Arrange
      renderizar();
      await userEvent.click(await screen.findByRole('button', { name: /finalizar evento/i }));
      const dialogo = await screen.findByRole('alertdialog', { name: /finalizar o evento/i });

      // Act
      await userEvent.click(within(dialogo).getByRole('button', { name: /continuar/i }));

      // Assert
      expect(vi.mocked(supabase.rpc).mock.calls.filter((c) => c[0] === 'admin_finalizar_evento')).toHaveLength(0);
    });
  });

  it('deve abrir como diálogo nomeado e fechar pelo botão', async () => {
    // Arrange
    const user = userEvent.setup();
    const ao_fechar = vi.fn();
    render(<ProvedorAvisos><ProvedorIdentidadeVisual><ModalConfiguracoesEvento id_evento_ativo={ID_EVENTO} nome_evento_atual="FETEC MS 2026" ao_fechar={ao_fechar} /></ProvedorIdentidadeVisual></ProvedorAvisos>);

    // Act
    await user.click(await screen.findByRole('button', { name: /fechar configurações/i }));

    // Assert
    expect(screen.getByRole('dialog', { name: /configurações do evento ativo/i })).toBeInTheDocument();
    expect(ao_fechar).toHaveBeenCalled();
  });
});
