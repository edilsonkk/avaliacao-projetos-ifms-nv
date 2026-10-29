import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  INTERVALO_MINIMO_RETOMADA_MS,
  aoRetomarApp,
  garantirSessaoValida,
  iniciarKeepAliveSessao,
} from '@/lib/keepAliveSessao';

const AGORA = 1_800_000_000_000;

const criarAuth = (expiraEmSegundos: number | null) => ({
  getSession: vi.fn().mockResolvedValue({
    data: { session: expiraEmSegundos === null ? null : { expires_at: expiraEmSegundos } },
    error: null,
  }),
  refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
  startAutoRefresh: vi.fn().mockResolvedValue(undefined),
});

const mudarVisibilidade = (estado: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: estado, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

/** Espera as promessas da retomada (getSession/refresh) terminarem. */
const esperarRetomada = () => new Promise((r) => setTimeout(r, 0));

describe('garantirSessaoValida', () => {
  it('deve renovar o token quando ele expira dentro da margem', async () => {
    // Arrange: token vence em 30 s
    const auth = criarAuth(AGORA / 1000 + 30);

    // Act
    const renovou = await garantirSessaoValida(auth as never, () => AGORA);

    // Assert
    expect(renovou).toBe(true);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('não deve renovar um token que ainda está longe de expirar', async () => {
    // Arrange: token vence em 30 min
    const auth = criarAuth(AGORA / 1000 + 1800);

    // Act
    const renovou = await garantirSessaoValida(auth as never, () => AGORA);

    // Assert
    expect(renovou).toBe(false);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('não deve criar sessão quando não há ninguém logado', async () => {
    // Arrange
    const auth = criarAuth(null);

    // Act
    const renovou = await garantirSessaoValida(auth as never, () => AGORA);

    // Assert
    expect(renovou).toBe(false);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
});

describe('iniciarKeepAliveSessao', () => {
  let instante = AGORA;
  let parar: () => void = () => {};
  const retomadas = vi.fn();
  let pararOuvir: () => void = () => {};

  beforeEach(() => {
    instante = AGORA;
    retomadas.mockClear();
    pararOuvir = aoRetomarApp(retomadas);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    parar();
    pararOuvir();
  });

  it('deve renovar a sessão vencida e avisar as telas quando a aba volta a ficar visível', async () => {
    // Arrange: celular ficou bloqueado e o token venceu
    const auth = criarAuth(AGORA / 1000 - 10);
    parar = iniciarKeepAliveSessao({ auth: auth as never, agora: () => instante });
    mudarVisibilidade('hidden');

    // Act
    mudarVisibilidade('visible');
    await esperarRetomada();

    // Assert
    expect(auth.startAutoRefresh).toHaveBeenCalled();
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(retomadas).toHaveBeenCalledTimes(1);
  });

  it('não deve fazer nada enquanto a aba está oculta', async () => {
    // Arrange
    const auth = criarAuth(AGORA / 1000 + 1800);
    parar = iniciarKeepAliveSessao({ auth: auth as never, agora: () => instante });

    // Act
    mudarVisibilidade('hidden');
    window.dispatchEvent(new Event('online'));
    await esperarRetomada();

    // Assert
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(retomadas).not.toHaveBeenCalled();
  });

  it('deve retomar quando a rede volta', async () => {
    // Arrange
    const auth = criarAuth(AGORA / 1000 + 1800);
    parar = iniciarKeepAliveSessao({ auth: auth as never, agora: () => instante });

    // Act
    window.dispatchEvent(new Event('online'));
    await esperarRetomada();

    // Assert
    expect(retomadas).toHaveBeenCalledTimes(1);
  });

  it('deve retomar quando a página é restaurada do cache do navegador', async () => {
    // Arrange
    const auth = criarAuth(AGORA / 1000 + 1800);
    parar = iniciarKeepAliveSessao({ auth: auth as never, agora: () => instante });
    const restaurada = Object.assign(new Event('pageshow'), { persisted: true });

    // Act
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(restaurada);
    await esperarRetomada();

    // Assert: só a restauração do cache conta, não o carregamento normal
    expect(retomadas).toHaveBeenCalledTimes(1);
  });

  it('deve juntar eventos seguidos numa única retomada', async () => {
    // Arrange
    const auth = criarAuth(AGORA / 1000 + 1800);
    parar = iniciarKeepAliveSessao({ auth: auth as never, agora: () => instante });

    // Act: visibilidade e rede chegam juntas; depois, nova retomada fora da janela
    mudarVisibilidade('visible');
    window.dispatchEvent(new Event('online'));
    await esperarRetomada();
    instante += INTERVALO_MINIMO_RETOMADA_MS + 1;
    window.dispatchEvent(new Event('online'));
    await esperarRetomada();

    // Assert
    expect(retomadas).toHaveBeenCalledTimes(2);
  });

  it('deve avisar as telas mesmo se a renovação falhar por falta de rede', async () => {
    // Arrange
    const auth = criarAuth(AGORA / 1000 - 10);
    auth.refreshSession.mockRejectedValue(new Error('Failed to fetch'));
    parar = iniciarKeepAliveSessao({ auth: auth as never, agora: () => instante });

    // Act
    mudarVisibilidade('visible');
    await esperarRetomada();

    // Assert
    expect(retomadas).toHaveBeenCalledTimes(1);
  });

  it('deve parar de ouvir depois de encerrado', async () => {
    // Arrange
    const auth = criarAuth(AGORA / 1000 + 1800);
    parar = iniciarKeepAliveSessao({ auth: auth as never, agora: () => instante });

    // Act
    parar();
    window.dispatchEvent(new Event('online'));
    mudarVisibilidade('visible');
    await esperarRetomada();

    // Assert
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(retomadas).not.toHaveBeenCalled();
  });
});
