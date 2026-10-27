import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => getSessionMock(...args) } },
}));

import {
  EVENTO_SESSAO_ADMIN_EXPIRADA,
  MENSAGEM_SESSAO_EXPIRADA,
  garantirSessaoAdmin,
  isErroPermissaoRls,
  traduzirErroEscritaAdmin,
  tratarErroEscritaAdmin,
} from '../lib/sessaoAdmin';

describe('sessaoAdmin', () => {
  let ouvinte: ReturnType<typeof vi.fn> & EventListener;

  beforeEach(() => {
    getSessionMock.mockReset();
    ouvinte = vi.fn() as ReturnType<typeof vi.fn> & EventListener;
    window.addEventListener(EVENTO_SESSAO_ADMIN_EXPIRADA, ouvinte);
    return () => window.removeEventListener(EVENTO_SESSAO_ADMIN_EXPIRADA, ouvinte);
  });

  it('detecta erro de RLS por código 42501 e por mensagem', () => {
    expect(isErroPermissaoRls({ code: '42501', message: 'x' })).toBe(true);
    expect(
      isErroPermissaoRls({ message: 'new row violates row-level security policy for table "projetos"' })
    ).toBe(true);
    expect(isErroPermissaoRls({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isErroPermissaoRls(null)).toBe(false);
  });

  it('traduz erro de RLS e preserva demais mensagens', () => {
    expect(traduzirErroEscritaAdmin({ code: '42501' })).toBe(MENSAGEM_SESSAO_EXPIRADA);
    expect(traduzirErroEscritaAdmin({ message: 'duplicate key' })).toBe('duplicate key');
  });

  it('permite prosseguir quando há sessão válida', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null });
    await expect(garantirSessaoAdmin()).resolves.toBe(true);
    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('bloqueia e dispara evento quando não há sessão', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    await expect(garantirSessaoAdmin()).resolves.toBe(false);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it('bloqueia e dispara evento quando getSession lança exceção', async () => {
    getSessionMock.mockRejectedValue(new Error('rede'));
    await expect(garantirSessaoAdmin()).resolves.toBe(false);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it('tratarErroEscritaAdmin dispara evento apenas para erro de RLS', () => {
    expect(tratarErroEscritaAdmin({ message: 'duplicate key' })).toBe('duplicate key');
    expect(ouvinte).not.toHaveBeenCalled();
    expect(tratarErroEscritaAdmin({ code: '42501' })).toBe(MENSAGEM_SESSAO_EXPIRADA);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
});
