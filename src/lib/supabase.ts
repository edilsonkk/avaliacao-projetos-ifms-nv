import { createClient } from '@supabase/supabase-js';
import type { EsqueMABanco } from '@/types/database';

// Declaração das credenciais do Supabase (lê variáveis de ambiente ou usa valores padrão)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://siyenrhpejugoghlstqw.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpeWVucmhwZWp1Z29naGxzdHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxOTU1ODEsImV4cCI6MjEwNzc3MTU4MX0.pf2SCiJfO4kGt9cKnWslf7dIAPwN74Szg9XZm-qV5NM";

/**
 * Cliente Supabase tipado para operações no banco de dados.
 * Utiliza fallback seguro caso as chaves ainda estejam com o texto placeholder.
 */
const url_conexao_efetiva =
  supabaseUrl && !supabaseUrl.includes("COLE_A_URL")
    ? supabaseUrl
    : "https://exemplo-nao-configurado.supabase.co";

const chave_conexao_efetiva =
  supabaseAnonKey && !supabaseAnonKey.includes("COLE_A_CHAVE")
    ? supabaseAnonKey
    : "chave-anonima-temporaria-placeholder";

export const supabase = createClient<any>(url_conexao_efetiva, chave_conexao_efetiva);

/**
 * Verifica se as credenciais do Supabase foram substituídas pelas chaves reais.
 */
export const verificar_conexao_configurada = (): boolean => {
  const is_url_valida = Boolean(supabaseUrl && !supabaseUrl.includes("COLE_A_URL"));
  const is_chave_valida = Boolean(supabaseAnonKey && !supabaseAnonKey.includes("COLE_A_CHAVE"));
  return is_url_valida && is_chave_valida;
};
