import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImagemEvento, ProvedorIdentidadeVisual } from '@/components/layout/IdentidadeVisual';
import { Cabecalho } from '@/components/layout/Cabecalho';
import { ProvedorAvisos } from '@/components/ui';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { signOut: vi.fn() }, storage: { from: vi.fn() } },
  ambiente_supabase: 'local',
  verificar_conexao_configurada: () => true,
}));

const identidade = (url_icone: string | null, url_imagem_evento: string | null) => ({
  data: { id_evento: 'e-1', nome_evento: 'FETEC MS 2026', url_icone, url_imagem_evento },
  error: null,
});

describe('ImagemEvento', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deve mostrar a imagem do evento com texto alternativo quando o Admin enviou uma', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue(identidade(null, 'http://local/banner.png') as never);

    // Act
    render(
      <ProvedorIdentidadeVisual>
        <ImagemEvento />
      </ProvedorIdentidadeVisual>,
    );

    // Assert
    const imagem = await screen.findByRole('img', { name: /identidade visual de FETEC MS 2026/i });
    expect(imagem).toHaveAttribute('src', 'http://local/banner.png');
  });

  it('não deve ocupar espaço quando não há imagem enviada', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue(identidade(null, null) as never);

    // Act
    render(
      <ProvedorIdentidadeVisual>
        <ImagemEvento />
      </ProvedorIdentidadeVisual>,
    );

    // Assert
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('fn_identidade_visual'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('Cabecalho - ícone do evento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const renderizar = () =>
    render(
      <ProvedorAvisos>
        <ProvedorIdentidadeVisual>
          <Cabecalho tela_atual="admin" ao_mudar_tela={vi.fn()} papel="admin" />
        </ProvedorIdentidadeVisual>
      </ProvedorAvisos>,
    );

  it('deve usar o ícone enviado e levá-lo para a aba do navegador', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue(identidade('http://local/icone.png', null) as never);

    // Act
    renderizar();

    // Assert
    await waitFor(() =>
      expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain('icone.png'),
    );
    expect(screen.queryByRole('img', { name: /ícone do evento não enviado/i })).not.toBeInTheDocument();
  });

  it('deve mostrar o marcador de pendência quando nenhum ícone foi enviado', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue(identidade(null, null) as never);

    // Act
    renderizar();

    // Assert
    const pendencia = await screen.findByRole('img', { name: /ícone do evento não enviado — envie nas configurações/i });
    expect(pendencia).toBeVisible();
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain('/icone.svg');
  });
});
