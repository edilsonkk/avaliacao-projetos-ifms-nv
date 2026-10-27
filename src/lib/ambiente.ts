/**
 * Leitura e validação das variáveis de ambiente da aplicação.
 * Não há valores padrão: sem configuração, a aplicação exibe a tela de configuração ausente
 * em vez de se conectar silenciosamente a outro banco. Ver docs/arquitetura/configuracao.md.
 */

type VariaveisAmbiente = Record<string, string | boolean | undefined>;

export type ConfiguracaoSupabase =
  | { valida: true; url: string; chaveAnonima: string }
  | { valida: false; problemas: string[] };

const lerTexto = (env: VariaveisAmbiente, nome: string): string => {
  const valor = env[nome];
  return typeof valor === 'string' ? valor.trim() : '';
};

const isUrlHttp = (valor: string): boolean => {
  try {
    const { protocol } = new URL(valor);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

export const lerConfiguracaoSupabase = (env: VariaveisAmbiente): ConfiguracaoSupabase => {
  const url = lerTexto(env, 'VITE_SUPABASE_URL').replace(/\/+$/, '');
  const chaveAnonima = lerTexto(env, 'VITE_SUPABASE_ANON_KEY');
  const problemas: string[] = [];

  if (!url) problemas.push('VITE_SUPABASE_URL não está definida');
  else if (!isUrlHttp(url)) problemas.push('VITE_SUPABASE_URL deve ser uma URL http(s) válida');
  if (!chaveAnonima) problemas.push('VITE_SUPABASE_ANON_KEY não está definida');

  return problemas.length > 0 ? { valida: false, problemas } : { valida: true, url, chaveAnonima };
};
