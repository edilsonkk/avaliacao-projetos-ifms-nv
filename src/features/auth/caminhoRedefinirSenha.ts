/**
 * Rota e regras do link de "Esqueci minha senha", separadas da tela.
 *
 * O app e a tela de login precisam destas constantes para montar a rota e o link do e-mail; a tela
 * em si só é usada por quem clica no link. Com elas aqui, `TelaRedefinirSenha` fica fora do bundle
 * inicial (ver `docs/operacao/auditoria.md`).
 */

/** Caminho para onde o e-mail de "Esqueci minha senha" leva (precisa estar nas Redirect URLs do Auth). */
export const CAMINHO_REDEFINIR_SENHA = '/redefinir-senha';

/**
 * Mínimo exigido pela tela, igual ao minimum_password_length do Supabase Auth (sem regras de
 * composição). Se o Auth recusar por outro motivo, a mensagem dele é exibida.
 */
export const TAMANHO_MINIMO_SENHA = 8;

/** URL completa do link de recuperação, no mesmo endereço em que o app está aberto. */
export const urlRedefinirSenha = () => `${window.location.origin}${CAMINHO_REDEFINIR_SENHA}`;
