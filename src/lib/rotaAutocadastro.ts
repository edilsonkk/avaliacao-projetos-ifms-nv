/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A rota do autocadastro (`/?cadastro=avaliador`, o link do QR Code do Staff) é uma
 * instrução DE UMA VEZ, não um endereço para se ficar.
 *
 * Enquanto ela mora só na barra de endereço, toda atualização de página reentra no
 * formulário — inclusive de quem já está logado, porque a tela é escolhida pela URL antes
 * de qualquer leitura de sessão. Reproduzido: avaliador logado, URL com
 * `?cadastro=avaliador`, F5 cai no Autocadastro.
 *
 * Aqui a intenção sai da URL e passa a viver na ABA (`sessionStorage`):
 *   - a URL é limpa assim que a tela lê o link, então F5 não depende mais dela;
 *   - a intenção sobrevive ao F5 DA MESMA ABA, para quem está preenchendo o formulário em
 *     rede ruim não perder o que digitou;
 *   - ela é encerrada no SUCESSO do cadastro (não no clique do botão), então quem terminou
 *     não volta ao formulário;
 *   - e morre com a aba, ao contrário da URL, que um favorito ou uma sessão restaurada
 *     carregam para sempre.
 *
 * O id do evento NÃO entra aqui de propósito: ele vem do link ou do evento ativo do banco,
 * nunca de um valor guardado neste navegador (mesma regra de TelaAutocadastroAvaliador).
 */

const CHAVE_INTENCAO = 'rota_autocadastro_em_curso';

/** `sessionStorage` lança em aba privada e com dados de site bloqueados. */
function comAba<T>(acao: (aba: Storage) => T, padrao: T): T {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return padrao;
    return acao(window.sessionStorage);
  } catch {
    return padrao;
  }
}

/** A pessoa chegou pelo link do QR Code, ou está no meio do cadastro nesta aba. */
export function autocadastroEmCurso(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('cadastro') === 'avaliador') return true;
  if (window.location.pathname.includes('/autocadastro')) return true;
  return comAba((aba) => aba.getItem(CHAVE_INTENCAO) === '1', false);
}

/**
 * Tira a instrução da URL e passa a guardá-la na aba. Chamado pela tela do autocadastro
 * depois de ler o `evento` do link — ali a ordem é determinística, sem depender de qual
 * efeito do React roda primeiro.
 */
export function fixarAutocadastroNaAba(): void {
  comAba((aba) => aba.setItem(CHAVE_INTENCAO, '1'), undefined);
  if (typeof window === 'undefined') return;
  if (window.location.search === '' && !window.location.pathname.includes('/autocadastro')) return;
  window.history.replaceState({}, '', '/');
}

/** Cadastro concluído, ou a pessoa voltou ao login: a intenção acaba aqui. */
export function encerrarAutocadastro(): void {
  comAba((aba) => aba.removeItem(CHAVE_INTENCAO), undefined);
}
