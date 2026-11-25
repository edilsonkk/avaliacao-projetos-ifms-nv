/**
 * Corte do texto de ajuda de uma pergunta de questionário, em TypeScript.
 *
 * Espelha `fn_orientacao_da_pergunta`/`fn_referencia_da_escala` do banco (migration
 * `20261125120000_referencia_da_escala_nas_perguntas.sql`). Desde essa migration, orientação e
 * âncoras da escala moram em colunas separadas (`descricao_lembrete` e `referencia_escala`), então
 * este módulo não é mais o caminho normal de leitura: ele existe para a **entrada** de texto que
 * ainda vem colada — planilha antiga de questionário, ou texto que o Admin cole no campo de ajuda.
 *
 * Conforme diretrizes TDD (Regra 2.A): funções puras, sem React nem DOM.
 */

/** Marcador que separa a orientação das âncoras, no formato dos modelos pré-cadastrados. */
export const MARCADOR_REFERENCIA = ' Referência — ';

/** Separador entre as âncoras dentro da referência (ex.: `1: … · 3: … · 5: …`). */
export const SEPARADOR_ANCORA = ' · ';

export interface TextoAjudaSeparado {
  /** O que o critério mede. Vem antes do marcador; é o texto inteiro quando não há marcador. */
  orientacao: string;
  /** As âncoras da escala. Vazio quando o texto não traz o marcador. */
  referencia: string;
}

/**
 * Separa a orientação das âncoras da escala.
 *
 * Sem o marcador, devolve o texto inteiro como orientação e referência vazia — é o caso dos
 * questionários de voto popular e de feira de ciências, que não têm âncoras.
 */
export const separarTextoAjuda = (texto: string | null | undefined): TextoAjudaSeparado => {
  const completo = (texto ?? '').trim();
  const corte = completo.indexOf(MARCADOR_REFERENCIA);
  if (corte === -1) return { orientacao: completo, referencia: '' };
  return {
    orientacao: completo.slice(0, corte).trim(),
    referencia: completo.slice(corte + MARCADOR_REFERENCIA.length).trim(),
  };
};

/** Quebra a referência nas âncoras, para a tela do avaliador listar uma por linha. */
export const itensDaReferencia = (referencia: string | null | undefined): string[] =>
  (referencia ?? '')
    .split(SEPARADOR_ANCORA)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
