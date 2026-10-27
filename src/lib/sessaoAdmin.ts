import { supabase } from '@/lib/supabase';

/** Evento global disparado quando a sessão do Admin no Supabase Auth não é válida. */
export const EVENTO_SESSAO_ADMIN_EXPIRADA = 'sessao-admin-expirada';

export const MENSAGEM_SESSAO_EXPIRADA =
  'Sessão de administrador expirada ou inválida. Faça login novamente na aba Admin para continuar.';

/** Detecta erros de permissão do Postgres/RLS (código 42501 ou mensagem de row-level security). */
export const isErroPermissaoRls = (erro: unknown): boolean => {
  if (!erro || typeof erro !== 'object') return false;
  const { code, message } = erro as { code?: string; message?: string };
  if (code === '42501') return true;
  const msg = (message || '').toLowerCase();
  return msg.includes('row-level security') || msg.includes('permission denied');
};

/** Converte erros de RLS em mensagem amigável; demais erros mantêm a mensagem original. */
export const traduzirErroEscritaAdmin = (erro: unknown): string => {
  if (isErroPermissaoRls(erro)) return MENSAGEM_SESSAO_EXPIRADA;
  const msg = (erro as { message?: string } | null)?.message;
  return msg || String(erro);
};

const notificarSessaoExpirada = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_ADMIN_EXPIRADA));
  }
};

/**
 * Garante que existe uma sessão válida do Supabase Auth antes de uma escrita administrativa.
 * Sem sessão, a requisição sairia como `anon` e seria barrada pelo RLS.
 * Retorna true se pode prosseguir; caso contrário dispara o evento de sessão expirada.
 */
export const garantirSessaoAdmin = async (): Promise<boolean> => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.access_token) return true;
  } catch (e) {
    console.warn('Falha ao verificar sessão do Supabase Auth:', e);
  }
  notificarSessaoExpirada();
  return false;
};

/** Se o erro for de RLS, dispara o fluxo de sessão expirada. Retorna a mensagem traduzida. */
export const tratarErroEscritaAdmin = (erro: unknown): string => {
  if (isErroPermissaoRls(erro)) notificarSessaoExpirada();
  return traduzirErroEscritaAdmin(erro);
};
