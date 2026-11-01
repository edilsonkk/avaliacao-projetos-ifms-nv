import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecaoIdentidadeVisual } from '@/features/admin/components/SecaoIdentidadeVisual';
import { ProvedorIdentidadeVisual } from '@/components/layout/IdentidadeVisual';
import { ProvedorAvisos } from '@/components/ui';
import { supabase } from '@/lib/supabase';

const storage = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), getPublicUrl: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    storage: { from: vi.fn(() => storage) },
  },
  verificar_conexao_configurada: () => true,
}));

vi.mock('@/lib/sessaoAdmin', () => ({ tratarErroEscritaAdmin: vi.fn() }));

const ID_EVENTO = 'e0000000-0000-0000-0000-000000000001';

const arquivo = (nome: string, tipo: string, bytes: number) =>
  new File([new Uint8Array(bytes)], nome, { type: tipo });

const montar = () =>
  render(
    <ProvedorAvisos>
      <ProvedorIdentidadeVisual>
        <SecaoIdentidadeVisual id_evento_ativo={ID_EVENTO} />
      </ProvedorIdentidadeVisual>
    </ProvedorAvisos>,
  );

describe('SecaoIdentidadeVisual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { id_evento: ID_EVENTO, nome_evento: 'FETEC MS 2026', url_icone: null, url_imagem_evento: null },
      error: null,
    } as never);
    const eq = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(supabase.from).mockReturnValue({ update: vi.fn(() => ({ eq })) } as never);
    storage.upload.mockResolvedValue({ error: null });
    storage.getPublicUrl.mockReturnValue({ data: { publicUrl: 'http://local/icone.png' } });
  });

  it('deve ter os dois campos com rótulo e a orientação de tamanho', async () => {
    // Arrange / Act
    montar();

    // Assert
    expect(await screen.findByLabelText('Ícone do evento')).toBeInTheDocument();
    expect(screen.getByLabelText('Imagem do evento')).toBeInTheDocument();
    expect(screen.getByLabelText('Ícone do evento')).toHaveAccessibleDescription(/256px ou mais, até 512 KB/);
  });

  it('deve recusar arquivo grande no próprio campo, sem subir nada', async () => {
    // Arrange
    const user = userEvent.setup();
    montar();
    const campo = await screen.findByLabelText('Ícone do evento');

    // Act
    await user.upload(campo, arquivo('icone.png', 'image/png', 600 * 1024));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/muito grande/i);
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('deve enviar o ícone e confirmar em diálogo', async () => {
    // Arrange
    const user = userEvent.setup();
    montar();
    const campo = await screen.findByLabelText('Ícone do evento');

    // Act
    await user.upload(campo, arquivo('icone.png', 'image/png', 2048));

    // Assert
    await waitFor(() =>
      expect(storage.upload).toHaveBeenCalledWith(
        `eventos/${ID_EVENTO}/icone.png`,
        expect.any(File),
        { upsert: true, contentType: 'image/png' },
      ),
    );
    expect(await screen.findByRole('dialog', { name: 'Ícone atualizado' })).toBeInTheDocument();
  });

  it('deve oferecer remover só quando já existe imagem', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: {
        id_evento: ID_EVENTO,
        nome_evento: 'FETEC MS 2026',
        url_icone: 'http://local/identidade-visual/eventos/e1/icone.png',
        url_imagem_evento: null,
      },
      error: null,
    } as never);
    storage.remove.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    montar();

    // Act
    const remover = await screen.findAllByRole('button', { name: 'Remover' });
    await user.click(remover[0]);

    // Assert
    await waitFor(() => expect(storage.remove).toHaveBeenCalledWith(['eventos/e1/icone.png']));
  });
});
