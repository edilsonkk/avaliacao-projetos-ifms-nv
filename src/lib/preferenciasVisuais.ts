/**
 * Tema e tamanho de texto escolhidos pela pessoa (cabeçalho).
 * Ficam no `localStorage` e são aplicados no `<html>`: a classe `.dark` liga o tema escuro
 * e `--escala-texto` muda o tamanho da raiz, que toda a escala em `rem` acompanha.
 */

export type Tema = 'claro' | 'escuro' | 'sistema';
export type EscalaTexto = 'padrao' | 'grande' | 'maior';

export const CHAVE_TEMA = 'tema_fecin';
export const CHAVE_ESCALA_TEXTO = 'tamanho_texto_fecin';

/** Tamanho da raiz por escala. 100% respeita o que a pessoa já configurou no navegador. */
export const TAMANHOS_TEXTO: Record<EscalaTexto, string> = {
  padrao: '100%',
  grande: '112.5%',
  maior: '125%',
};

export const ROTULOS_ESCALA_TEXTO: Record<EscalaTexto, string> = {
  padrao: 'Tamanho de texto padrão',
  grande: 'Tamanho de texto grande',
  maior: 'Tamanho de texto maior',
};

const ehTema = (valor: string | null): valor is Tema => valor === 'claro' || valor === 'escuro' || valor === 'sistema';

const ehEscala = (valor: string | null): valor is EscalaTexto =>
  valor === 'padrao' || valor === 'grande' || valor === 'maior';

export const lerTema = (): Tema => {
  const salvo = localStorage.getItem(CHAVE_TEMA);
  return ehTema(salvo) ? salvo : 'sistema';
};

export const lerEscalaTexto = (): EscalaTexto => {
  const salvo = localStorage.getItem(CHAVE_ESCALA_TEXTO);
  return ehEscala(salvo) ? salvo : 'padrao';
};

/** O sistema operacional está no escuro? */
export const sistemaNoEscuro = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export const aplicarTema = (tema: Tema): void => {
  const escuro = tema === 'escuro' || (tema === 'sistema' && sistemaNoEscuro());
  document.documentElement.classList.toggle('dark', escuro);
  localStorage.setItem(CHAVE_TEMA, tema);
};

export const aplicarEscalaTexto = (escala: EscalaTexto): void => {
  document.documentElement.style.setProperty('--escala-texto', TAMANHOS_TEXTO[escala]);
  localStorage.setItem(CHAVE_ESCALA_TEXTO, escala);
};

/**
 * Avisa quando o tema do sistema muda, para o modo "sistema" repintar na hora
 * (antes só mudava ao recarregar a página). Devolve a função que para de ouvir.
 */
export const observarTemaDoSistema = (aoMudar: () => void): (() => void) => {
  if (typeof window.matchMedia !== 'function') return () => {};
  const consulta = window.matchMedia('(prefers-color-scheme: dark)');
  consulta.addEventListener('change', aoMudar);
  return () => consulta.removeEventListener('change', aoMudar);
};

/**
 * Limpa a sessão guardada no navegador **sem** levar as preferências visuais:
 * sair do sistema não é motivo para perder tema e tamanho de texto.
 */
export const limparSessaoMantendoPreferencias = (): void => {
  const tema = localStorage.getItem(CHAVE_TEMA);
  const escala = localStorage.getItem(CHAVE_ESCALA_TEXTO);
  localStorage.clear();
  if (tema) localStorage.setItem(CHAVE_TEMA, tema);
  if (escala) localStorage.setItem(CHAVE_ESCALA_TEXTO, escala);
};

/** Aplica tema e tamanho de texto guardados. Chamado uma vez, ao abrir o app. */
export const aplicarPreferenciasVisuais = (): void => {
  aplicarTema(lerTema());
  aplicarEscalaTexto(lerEscalaTexto());
};
