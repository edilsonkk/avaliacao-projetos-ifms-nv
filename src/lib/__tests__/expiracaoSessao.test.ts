import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CHAVE_ULTIMA_ATIVIDADE, iniciarExpiracaoPorInatividade } from '@/lib/expiracaoSessao';

describe('expiração da sessão por inatividade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T10:00:00'));
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('encerra a sessão depois do tempo configurado sem uso', () => {
    // Arrange
    const aoExpirar = vi.fn();
    const parar = iniciarExpiracaoPorInatividade(30, aoExpirar);

    // Act
    vi.advanceTimersByTime(29 * 60_000);
    const antes = aoExpirar.mock.calls.length;
    vi.advanceTimersByTime(2 * 60_000);

    // Assert
    expect(antes).toBe(0);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
    parar();
  });

  it('qualquer uso (tecla, clique, toque) renova o prazo', () => {
    // Arrange
    const aoExpirar = vi.fn();
    const parar = iniciarExpiracaoPorInatividade(30, aoExpirar);

    // Act
    vi.advanceTimersByTime(25 * 60_000);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    vi.advanceTimersByTime(25 * 60_000);

    // Assert
    expect(aoExpirar).not.toHaveBeenCalled();
    parar();
  });

  it('vale entre abas: o uso em outra aba (registrado no navegador) também renova', () => {
    // Arrange
    const aoExpirar = vi.fn();
    const parar = iniciarExpiracaoPorInatividade(30, aoExpirar);

    // Act
    vi.advanceTimersByTime(25 * 60_000);
    localStorage.setItem(CHAVE_ULTIMA_ATIVIDADE, String(Date.now()));
    vi.advanceTimersByTime(25 * 60_000);

    // Assert
    expect(aoExpirar).not.toHaveBeenCalled();
    parar();
  });

  it('ao reabrir o site depois do prazo, encerra na hora', () => {
    // Arrange
    localStorage.setItem(CHAVE_ULTIMA_ATIVIDADE, String(Date.now() - 2 * 60 * 60_000));
    const aoExpirar = vi.fn();

    // Act
    const parar = iniciarExpiracaoPorInatividade(30, aoExpirar);

    // Assert
    expect(aoExpirar).toHaveBeenCalledTimes(1);
    parar();
  });

  it('com 0 minutos não expira', () => {
    // Arrange
    const aoExpirar = vi.fn();
    const parar = iniciarExpiracaoPorInatividade(0, aoExpirar);

    // Act
    vi.advanceTimersByTime(24 * 60 * 60_000);

    // Assert
    expect(aoExpirar).not.toHaveBeenCalled();
    parar();
  });
});
