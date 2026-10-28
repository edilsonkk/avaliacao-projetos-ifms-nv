import { supabase } from '@/lib/supabase';

/**
 * Identidade do aparelho (celular do avaliador) no Supabase Auth.
 * O celular tem uma sessão anônima própria; o vínculo com o avaliador é feito
 * pelo Staff (pareamento) ou por código de acesso. Ver docs/arquitetura/seguranca.md.
 */

export type PapelSessao = 'admin' | 'staff' | 'avaliador';
export type MetodoVinculo = 'ambos' | 'pareamento' | 'codigo';

export interface PerfilSessao {
  autenticado: boolean;
  papel: PapelSessao | null;
  id_usuario: string | null;
  nome: string | null;
  email: string | null;
  id_evento: string | null;
  metodos_vinculo: MetodoVinculo;
}

export interface CodigoPareamento {
  codigo: string;
  expira_em: string;
}

const mensagemDe = (erro: unknown, padrao: string): string =>
  (erro as { message?: string } | null)?.message || padrao;

/** Papel e identificação da sessão atual, decididos pelo banco. */
export const obterPerfilSessao = async (): Promise<PerfilSessao> => {
  const { data, error } = await supabase.rpc('fn_meu_perfil');
  if (error) throw new Error(mensagemDe(error, 'Não foi possível consultar a sessão.'));
  return data as PerfilSessao;
};

/** Garante que este aparelho tem uma sessão no Auth (anônima, se ainda não houver). */
export const garantirSessaoAparelho = async (): Promise<void> => {
  const { data } = await supabase.auth.getSession();
  if (data?.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(mensagemDe(error, 'Não foi possível iniciar a sessão do aparelho.'));
};

export const solicitarCodigoPareamento = async (): Promise<CodigoPareamento> => {
  const { data, error } = await supabase.rpc('fn_solicitar_pareamento');
  if (error) throw new Error(mensagemDe(error, 'Não foi possível gerar o código de pareamento.'));
  return data as CodigoPareamento;
};

export const vincularComCodigoAcesso = async (email: string, codigo: string): Promise<{ ok: boolean; erro?: string }> => {
  const { data, error } = await supabase.rpc('fn_vincular_com_codigo', { p_email: email, p_codigo: codigo });
  if (error) return { ok: false, erro: mensagemDe(error, 'Não foi possível validar o código.') };
  return data as { ok: boolean; erro?: string };
};

/** Grava no navegador o perfil confirmado pelo banco (só para exibição; a permissão é do banco). */
export const salvarPerfilLocal = (perfil: PerfilSessao): void => {
  if (!perfil.papel || !perfil.id_usuario) return;
  localStorage.setItem('sessao_id_usuario', perfil.id_usuario);
  localStorage.setItem('sessao_papel', perfil.papel.toUpperCase());
  localStorage.setItem('usuario_id', perfil.id_usuario);
  localStorage.setItem('usuario_perfil', perfil.papel);
  if (perfil.email) {
    localStorage.setItem('sessao_email', perfil.email);
    localStorage.setItem('usuario_email', perfil.email);
  }
  if (perfil.papel === 'avaliador') {
    localStorage.setItem('avaliador_id_usuario', perfil.id_usuario);
    if (perfil.email) localStorage.setItem('avaliador_email', perfil.email);
    if (perfil.nome) localStorage.setItem('avaliador_nome', perfil.nome);
  }
  if (perfil.papel === 'staff') localStorage.setItem('staff_id_usuario', perfil.id_usuario);
};
