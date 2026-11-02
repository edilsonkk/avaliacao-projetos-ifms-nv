import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ICONE_PADRAO,
  aplicarIconeDoNavegador,
  enviarImagemIdentidade,
  lerIdentidadeVisual,
  removerImagemIdentidade,
  validarImagem,
} from '@/lib/identidadeVisual';
import { supabase } from '@/lib/supabase';

const storage = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    storage: { from: vi.fn(() => storage) },
  },
}));

const ID_EVENTO = 'e0000000-0000-0000-0000-000000000001';

const arquivo = (nome: string, tipo: string, bytes: number) =>
  new File([new Uint8Array(bytes)], nome, { type: tipo });

const cadeiaUpdate = (resultado: { error: unknown } = { error: null }) => {
  const eq = vi.fn().mockResolvedValue(resultado);
  const update = vi.fn(() => ({ eq }));
  vi.mocked(supabase.from).mockReturnValue({ update } as never);
  return { update, eq };
};

describe('validarImagem', () => {
  it('deve recusar formato que não é imagem aceita', () => {
    // Arrange / Act
    const problema = validarImagem('icone', arquivo('planilha.pdf', 'application/pdf', 10));

    // Assert
    expect(problema).toMatch(/PNG, JPG, WEBP ou SVG/);
  });

  it('deve recusar ícone acima do limite', () => {
    // Arrange / Act
    const problema = validarImagem('icone', arquivo('icone.png', 'image/png', 600 * 1024));

    // Assert
    expect(problema).toMatch(/muito grande/);
  });

  it('deve aceitar imagem do evento dentro do limite', () => {
    // Arrange / Act
    const problema = validarImagem('imagem', arquivo('banner.png', 'image/png', 1024 * 1024));

    // Assert
    expect(problema).toBeNull();
  });
});

describe('enviarImagemIdentidade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.upload.mockResolvedValue({ error: null });
    storage.getPublicUrl.mockReturnValue({
      data: { publicUrl: `http://local/storage/identidade-visual/eventos/${ID_EVENTO}/icone.png` },
    });
  });

  it('deve subir no caminho do evento, substituindo o arquivo anterior, e gravar a URL', async () => {
    // Arrange
    const { update, eq } = cadeiaUpdate();

    // Act
    const url = await enviarImagemIdentidade('icone', ID_EVENTO, arquivo('icone.png', 'image/png', 1024));

    // Assert
    expect(storage.upload).toHaveBeenCalledWith(
      `eventos/${ID_EVENTO}/icone.png`,
      expect.any(File),
      { upsert: true, contentType: 'image/png' },
    );
    expect(update).toHaveBeenCalledWith({ url_icone: url });
    expect(eq).toHaveBeenCalledWith('id_evento', ID_EVENTO);
    expect(url).toMatch(/\?v=\d+$/); // cache busting, senão o navegador mostra a imagem antiga
  });

  it('não deve subir arquivo que a validação recusa', async () => {
    // Arrange / Act / Assert
    await expect(enviarImagemIdentidade('icone', ID_EVENTO, arquivo('icone.pdf', 'application/pdf', 10))).rejects.toThrow(
      /PNG, JPG, WEBP ou SVG/,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('deve avisar quando o banco recusa a gravação', async () => {
    // Arrange
    cadeiaUpdate({ error: { message: 'new row violates row-level security policy' } });

    // Act / Assert
    await expect(enviarImagemIdentidade('imagem', ID_EVENTO, arquivo('banner.png', 'image/png', 2048))).rejects.toThrow(
      /row-level security/,
    );
  });
});

describe('removerImagemIdentidade', () => {
  it('deve limpar a coluna do evento e apagar o arquivo do bucket', async () => {
    // Arrange
    vi.clearAllMocks();
    storage.remove.mockResolvedValue({ error: null });
    const { update } = cadeiaUpdate();

    // Act
    await removerImagemIdentidade('imagem', ID_EVENTO, `http://local/identidade-visual/eventos/${ID_EVENTO}/imagem.png?v=1`);

    // Assert
    expect(update).toHaveBeenCalledWith({ url_imagem_evento: null });
    expect(storage.remove).toHaveBeenCalledWith([`eventos/${ID_EVENTO}/imagem.png`]);
  });
});

describe('lerIdentidadeVisual', () => {
  it('deve devolver campos vazios quando não há evento ativo', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);

    // Act
    const identidade = await lerIdentidadeVisual();

    // Assert
    expect(identidade).toEqual({ id_evento: null, nome_evento: null, url_icone: null, url_imagem_evento: null });
  });
});

describe('aplicarIconeDoNavegador', () => {
  it('deve apontar o ícone da aba e do atalho para o do evento, e voltar ao padrão sem ele', () => {
    // Act
    aplicarIconeDoNavegador('http://local/icone-do-evento.png');

    // Assert
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain('icone-do-evento.png');
    expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href).toContain('icone-do-evento.png');

    // Act
    aplicarIconeDoNavegador(null);

    // Assert
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain(ICONE_PADRAO);
  });
});
