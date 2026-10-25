/**
 * Utilitário puro de Sanitização e Fuzzy Matching para De-duplicação e Dicionário de Aliases
 * Conforme diretrizes TDD: sem dependências de DOM / React, 100% puramente determinístico.
 */

export interface CandidatoMatch {
  id: string;
  nome: string;
  sigla?: string | null;
  aliases?: string[];
}

export interface ResultadoMatch {
  matchTipo: 'exato' | 'fuzzy' | 'novo';
  score: number;
  candidato: CandidatoMatch | null;
  confiancaPercentual: number;
}

/**
 * Sanitiza uma string para comparação homogênea:
 * - Remove espaços extras nas pontas e colapsa espaços internos
 * - Remove pontuações (pontos, vírgulas, barras, hifens, parênteses, aspas)
 * - Remove acentos
 * - Converte estritamente para MAIÚSCULAS
 */
export function sanitizarTexto(texto: string | null | undefined): string {
  if (!texto) return '';

  return texto
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos/acentos
    .replace(/\./g, '') // remove pontos diretamente (ex: I.F.M.S. -> IFMS)
    .replace(/[\/#!$%\^&\*;:{}=\-_`~()\[\]"',?]/g, ' ') // remove outros caracteres de pontuação substituindo por espaço
    .replace(/\s+/g, ' ') // colapsa múltiplos espaços em um único
    .trim()
    .toUpperCase();
}

/**
 * Calcula a distância de Levenshtein entre duas strings
 */
export function distanciaLevenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substituição
          matrix[i][j - 1] + 1,     // inserção
          matrix[i - 1][j] + 1      // deleção
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calcula a similaridade de Levenshtein normalizada (0.0 a 1.0)
 */
export function similaridadeLevenshtein(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = distanciaLevenshtein(a, b);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Token Sort Ratio: compara strings ordenando os tokens alfabeticamente
 * Ex: "IFMS CAMPUS CG" e "CAMPUS CG IFMS" -> similaridade 1.0
 */
export function tokenSortRatio(a: string, b: string): number {
  const tokensA = a.split(' ').filter(Boolean).sort().join(' ');
  const tokensB = b.split(' ').filter(Boolean).sort().join(' ');
  return similaridadeLevenshtein(tokensA, tokensB);
}

/**
 * Calcula o score composto de similaridade (0.0 a 1.0) entre duas strings sanitizadas
 */
export function calcularSimilaridade(str1: string, str2: string): number {
  const s1 = sanitizarTexto(str1);
  const s2 = sanitizarTexto(str2);

  if (!s1 && !s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  if (s1 === s2) return 1.0;

  const scoreDireto = similaridadeLevenshtein(s1, s2);
  const scoreToken = tokenSortRatio(s1, s2);

  return Math.max(scoreDireto, scoreToken);
}

/**
 * Busca a melhor correspondência para um termo frente a uma lista de candidatos conhecidos
 * @param termoOrigem Termo extraído da planilha
 * @param candidatos Lista de instituições ou modalidades cadastradas
 * @param threshold Limiar mínimo de similaridade para considerar match (padrão: 0.85 = 85%)
 */
export function buscarMelhorCorrespondencia(
  termoOrigem: string,
  candidatos: CandidatoMatch[],
  threshold: number = 0.85
): ResultadoMatch {
  const termoSanitizado = sanitizarTexto(termoOrigem);

  if (!termoSanitizado) {
    return { matchTipo: 'novo', score: 0, candidato: null, confiancaPercentual: 0 };
  }

  // 1. CHECAGEM DE MATCH EXATO (Nome, Sigla ou Aliases já catalogados)
  for (const c of candidatos) {
    const nomeSanit = sanitizarTexto(c.nome);
    const siglaSanit = c.sigla ? sanitizarTexto(c.sigla) : '';

    if (termoSanitizado === nomeSanit || (siglaSanit && termoSanitizado === siglaSanit)) {
      return {
        matchTipo: 'exato',
        score: 1.0,
        candidato: c,
        confiancaPercentual: 100,
      };
    }

    if (c.aliases && c.aliases.length > 0) {
      for (const alias of c.aliases) {
        if (termoSanitizado === sanitizarTexto(alias)) {
          return {
            matchTipo: 'exato',
            score: 1.0,
            candidato: c,
            confiancaPercentual: 100,
          };
        }
      }
    }
  }

  // 2. CHECAGEM FUZZY (Similaridade >= threshold de 85%)
  let melhorScore = 0;
  let melhorCandidato: CandidatoMatch | null = null;

  for (const c of candidatos) {
    const scoreNome = calcularSimilaridade(termoSanitizado, c.nome);
    let scoreMaxCandidato = scoreNome;

    if (c.sigla) {
      const scoreSigla = calcularSimilaridade(termoSanitizado, c.sigla);
      if (scoreSigla > scoreMaxCandidato) scoreMaxCandidato = scoreSigla;
    }

    if (c.aliases && c.aliases.length > 0) {
      for (const al of c.aliases) {
        const scoreAl = calcularSimilaridade(termoSanitizado, al);
        if (scoreAl > scoreMaxCandidato) scoreMaxCandidato = scoreAl;
      }
    }

    if (scoreMaxCandidato > melhorScore) {
      melhorScore = scoreMaxCandidato;
      melhorCandidato = c;
    }
  }

  if (melhorScore >= threshold && melhorCandidato) {
    return {
      matchTipo: 'fuzzy',
      score: melhorScore,
      candidato: melhorCandidato,
      confiancaPercentual: Math.round(melhorScore * 100),
    };
  }

  // 3. SEM CORRESPONDÊNCIA SUFICIENTE -> NOVO REGISTRO
  return {
    matchTipo: 'novo',
    score: melhorScore,
    candidato: null,
    confiancaPercentual: Math.round(melhorScore * 100),
  };
}
