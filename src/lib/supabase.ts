import { createClient } from '@supabase/supabase-js';
import type { EsqueMABanco } from '@/types/database';
import { lerConfiguracaoSupabase } from '@/lib/ambiente';

/** Configuração lida do ambiente (`.env` local ou secrets do build). Não há valores padrão. */
export const configuracao_supabase = lerConfiguracaoSupabase(import.meta.env);

// Sem configuração, o cliente aponta para um endereço inválido e nunca é usado:
// src/app/main.tsx exibe a tela de configuração ausente em vez de montar a aplicação.
const URL_CONFIGURACAO_AUSENTE = 'http://configuracao-ausente.invalid';

/**
 * Cliente Supabase único da aplicação.
 */
export const supabase = configuracao_supabase.valida
  ? createClient<any>(configuracao_supabase.url, configuracao_supabase.chaveAnonima)
  : createClient<any>(URL_CONFIGURACAO_AUSENTE, 'configuracao-ausente');

/**
 * Indica se as variáveis de ambiente do Supabase estão configuradas.
 */
export const verificar_conexao_configurada = (): boolean => configuracao_supabase.valida;
