/**
 * Expiração da sessão de Admin e Staff por inatividade (ASVS 7.3), com o tempo definido pelo Admin na engrenagem.
 * Feita no navegador: o plano gratuito do Supabase não limita a duração da sessão no servidor.
 * O último uso fica no localStorage para valer entre abas e ao reabrir o site.
 */

export const CHAVE_ULTIMA_ATIVIDADE = 'ultima_atividade_sessao';

const EVENTOS_DE_USO = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
const INTERVALO_CONFERENCIA_MS = 15_000;
// Gravar a cada evento seria excessivo (scroll dispara dezenas por segundo)
const INTERVALO_GRAVACAO_MS = 5_000;

const lerUltimaAtividade = (): number => {
  try {
    return Number(localStorage.getItem(CHAVE_ULTIMA_ATIVIDADE)) || 0;
  } catch {
    return 0;
  }
};

const gravarUltimaAtividade = (momento: number) => {
  try {
    localStorage.setItem(CHAVE_ULTIMA_ATIVIDADE, String(momento));
  } catch {
    // navegador sem armazenamento: a conferência usa a memória desta aba
  }
};

/** Começa a vigiar o uso; chama aoExpirar uma vez depois de `minutos` sem uso. Devolve a função que para. */
export const iniciarExpiracaoPorInatividade = (minutos: number, aoExpirar: () => void): (() => void) => {
  if (!minutos || minutos <= 0) return () => {};

  const limiteMs = minutos * 60_000;
  let ultimaLocal = lerUltimaAtividade() || Date.now();
  let ultimaGravacao = 0;
  let expirou = false;

  const conferir = () => {
    if (expirou) return;
    const ultima = Math.max(ultimaLocal, lerUltimaAtividade());
    if (Date.now() - ultima >= limiteMs) {
      expirou = true;
      aoExpirar();
    }
  };

  const registrarUso = () => {
    if (expirou) return;
    const agora = Date.now();
    ultimaLocal = agora;
    if (agora - ultimaGravacao >= INTERVALO_GRAVACAO_MS) {
      ultimaGravacao = agora;
      gravarUltimaAtividade(agora);
    }
  };

  const aoVoltarParaAba = () => {
    if (document.visibilityState === 'visible') conferir();
  };

  // Reabrir o site depois do prazo encerra na hora; senão, o prazo conta a partir de agora
  conferir();
  if (!expirou && !lerUltimaAtividade()) gravarUltimaAtividade(ultimaLocal);

  EVENTOS_DE_USO.forEach((evento) => window.addEventListener(evento, registrarUso, { passive: true }));
  document.addEventListener('visibilitychange', aoVoltarParaAba);
  const intervalo = window.setInterval(conferir, INTERVALO_CONFERENCIA_MS);

  return () => {
    EVENTOS_DE_USO.forEach((evento) => window.removeEventListener(evento, registrarUso));
    document.removeEventListener('visibilitychange', aoVoltarParaAba);
    window.clearInterval(intervalo);
  };
};
