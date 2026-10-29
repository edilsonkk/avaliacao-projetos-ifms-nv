import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Keep-alive da sessão: o app não usa WebSocket (as telas ao vivo consultam o banco de tempos em tempos),
 * então o que "cai" com o aparelho ocioso é a sessão do Auth e o ritmo das consultas. O navegador congela
 * timers em abas ocultas e celulares bloqueados; ao voltar, o token pode ter expirado e a próxima consulta
 * só aconteceria no próximo ciclo. Ver docs/arquitetura/frontend.md#keep-alive-da-sessão.
 *
 * Ao retomar (aba visível de novo, rede de volta ou página restaurada do cache), este módulo:
 * 1. religa a renovação automática do token e renova a sessão se ela expira em menos de `margemRenovacaoMs`;
 * 2. dispara `EVENTO_APP_RETOMADA`, para as telas consultarem o banco na hora em vez de esperar o próximo ciclo.
 */

export const EVENTO_APP_RETOMADA = 'app:retomada';

/** Renova antes de expirar para a primeira consulta depois de acordar não sair com token vencido. */
export const MARGEM_RENOVACAO_MS = 60_000;

/** Eventos seguidos (foco + visibilidade + rede) viram uma única retomada. */
export const INTERVALO_MINIMO_RETOMADA_MS = 2_000;

type AuthKeepAlive = Pick<SupabaseClient['auth'], 'getSession' | 'refreshSession' | 'startAutoRefresh'>;

interface OpcoesKeepAlive {
  auth: AuthKeepAlive;
  alvo?: Window;
  documento?: Document;
  agora?: () => number;
  margemRenovacaoMs?: number;
}

/** Garante uma sessão válida agora. Devolve `true` se renovou o token. */
export const garantirSessaoValida = async (
  auth: AuthKeepAlive,
  agora: () => number = Date.now,
  margemRenovacaoMs: number = MARGEM_RENOVACAO_MS,
): Promise<boolean> => {
  const { data } = await auth.getSession();
  const expiraEm = data.session?.expires_at;
  if (!data.session || !expiraEm) return false;
  if (expiraEm * 1000 - agora() > margemRenovacaoMs) return false;
  const { error } = await auth.refreshSession();
  return !error;
};

/** Registra os ouvintes de retomada. Devolve a função que os remove. */
export const iniciarKeepAliveSessao = ({
  auth,
  alvo = window,
  documento = document,
  agora = Date.now,
  margemRenovacaoMs = MARGEM_RENOVACAO_MS,
}: OpcoesKeepAlive): (() => void) => {
  let ultimaRetomada = -Infinity;

  const retomar = async () => {
    if (documento.visibilityState === 'hidden') return;
    const instante = agora();
    if (instante - ultimaRetomada < INTERVALO_MINIMO_RETOMADA_MS) return;
    ultimaRetomada = instante;
    try {
      await auth.startAutoRefresh();
      await garantirSessaoValida(auth, agora, margemRenovacaoMs);
    } catch {
      // sem rede ainda: o evento 'online' tenta de novo
    }
    alvo.dispatchEvent(new Event(EVENTO_APP_RETOMADA));
  };

  const aoMudarVisibilidade = () => {
    if (documento.visibilityState === 'visible') void retomar();
  };
  const aoVoltarRede = () => void retomar();
  const aoRestaurarPagina = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) void retomar();
  };

  documento.addEventListener('visibilitychange', aoMudarVisibilidade);
  alvo.addEventListener('online', aoVoltarRede);
  alvo.addEventListener('pageshow', aoRestaurarPagina);

  return () => {
    documento.removeEventListener('visibilitychange', aoMudarVisibilidade);
    alvo.removeEventListener('online', aoVoltarRede);
    alvo.removeEventListener('pageshow', aoRestaurarPagina);
  };
};

/** Executa `acao` sempre que o app retomar. Devolve a função que para de ouvir. */
export const aoRetomarApp = (acao: () => void, alvo: Window = window): (() => void) => {
  alvo.addEventListener(EVENTO_APP_RETOMADA, acao);
  return () => alvo.removeEventListener(EVENTO_APP_RETOMADA, acao);
};
