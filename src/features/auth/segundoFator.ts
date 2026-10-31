import { supabase } from '@/lib/supabase';

/**
 * Segundo fator (MFA) do Admin por aplicativo autenticador (TOTP do Supabase Auth).
 * A exigência vale no banco: com o MFA ligado, is_admin() só reconhece a sessão verificada (aal2).
 * Ver docs/arquitetura/seguranca.md#segundo-fator-do-admin.
 */

export interface PoliticaSeguranca {
  exigir_mfa_admin: boolean;
  minutos_inatividade_sessao: number;
}

export interface CadastroTotp {
  idFator: string;
  qrCode: string;
  segredo: string;
}

/** O que falta depois da senha: nada, digitar o código ou cadastrar o aplicativo. */
export type EtapaSegundoFator = 'nenhuma' | 'verificar' | 'cadastrar';

export const POLITICA_PADRAO: PoliticaSeguranca = { exigir_mfa_admin: false, minutos_inatividade_sessao: 0 };

/** Avisado pelas Configurações quando o Admin muda a política (o App relê o tempo de expiração). */
export const EVENTO_POLITICA_ALTERADA = 'politica-seguranca-alterada';

export const lerPoliticaSeguranca = async (): Promise<PoliticaSeguranca> => {
  const { data, error } = await supabase.rpc('fn_politica_seguranca');
  if (error) throw error;
  const p = (data || {}) as Partial<PoliticaSeguranca>;
  return {
    exigir_mfa_admin: p.exigir_mfa_admin === true,
    minutos_inatividade_sessao: Number(p.minutos_inatividade_sessao) || 0,
  };
};

export const salvarPoliticaSeguranca = async (politica: PoliticaSeguranca): Promise<PoliticaSeguranca> => {
  const { data, error } = await supabase.rpc('admin_salvar_configuracoes_seguranca', {
    p_exigir_mfa_admin: politica.exigir_mfa_admin,
    p_minutos_inatividade: politica.minutos_inatividade_sessao,
  });
  if (error) throw error;
  return data as PoliticaSeguranca;
};

/** Sessão já passou pelo segundo fator? */
export const sessaoVerificada = async (): Promise<boolean> => {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === 'aal2';
};

/** Depois do login com senha: decide se pede o código, o cadastro do aplicativo ou nada. */
export const etapaSegundoFator = async (politica: PoliticaSeguranca): Promise<EtapaSegundoFator> => {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data.currentLevel === 'aal2') return 'nenhuma';
  // Quem já cadastrou o aplicativo sempre confirma o código
  if (data.nextLevel === 'aal2') return 'verificar';
  return politica.exigir_mfa_admin ? 'cadastrar' : 'nenhuma';
};

/** Fator TOTP já confirmado da conta (o primeiro), se houver. */
export const fatorVerificado = async (): Promise<string | null> => {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp.find((f) => f.status === 'verified')?.id ?? null;
};

/** Inicia o cadastro do aplicativo: descarta tentativas anteriores não confirmadas e gera o QR Code. */
export const iniciarCadastroTotp = async (): Promise<CadastroTotp> => {
  const { data: fatores } = await supabase.auth.mfa.listFactors();
  for (const f of fatores?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Aplicativo autenticador ${new Date().toLocaleDateString('pt-BR')}`,
    issuer: 'Avaliação de Projetos IFMS',
  });
  if (error) throw error;
  return { idFator: data.id, qrCode: data.totp.qr_code, segredo: data.totp.secret };
};

/** Confere o código de 6 dígitos; com sucesso, a sessão passa a aal2. */
export const confirmarCodigo = async (idFator: string, codigo: string): Promise<void> => {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: idFator, code: codigo.replace(/\D/g, '') });
  if (error) throw error;
};

/** Remove os aplicativos cadastrados da conta (ao desligar o MFA). Exige sessão verificada. */
export const removerFatores = async (): Promise<void> => {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  for (const f of data.all) {
    if (f.factor_type === 'totp') {
      const { error: erro } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (erro) throw erro;
    }
  }
};
