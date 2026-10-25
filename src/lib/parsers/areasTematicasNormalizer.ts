/**
 * Normalizador e Padronizador de Áreas Temáticas.
 * Mapeia termos livres para as Grandes Áreas do CNPq com acentuação oficial em MAIÚSCULO.
 * Caso não corresponda a uma grande área oficial, aplica fallback:
 * remoção de acentos/til, colapso de espaços múltiplos e conversão para MAIÚSCULO.
 */

export const GRANDES_AREAS_CNPQ = [
  'CIÊNCIAS EXATAS E DA TERRA',
  'CIÊNCIAS BIOLÓGICAS',
  'ENGENHARIAS',
  'CIÊNCIAS DA SAÚDE',
  'CIÊNCIAS AGRÁRIAS',
  'CIÊNCIAS SOCIAIS APLICADAS',
  'CIÊNCIAS HUMANAS',
  'LINGUÍSTICA, LETRAS E ARTES',
  'MULTIDISCIPLINAR',
] as const;

export type GrandeAreaCNPq = typeof GRANDES_AREAS_CNPQ[number];

/**
 * Helper para simplificar texto (remove acentos, espaços extras, minúsculas)
 */
export function simplificarTexto(txt: string): string {
  return txt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sanitiza texto genérico para MAIÚSCULO sem acentos e com espaçamento único.
 */
export function sanitizarMaiusculoSemAcentos(txt: string): string {
  return txt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

interface RegraMapeamento {
  areaOficial: GrandeAreaCNPq;
  palavrasChave: string[];
}

const REGRAS_CNPQ: RegraMapeamento[] = [
  {
    areaOficial: 'CIÊNCIAS EXATAS E DA TERRA',
    palavrasChave: [
      'exatas',
      'ciencias exatas',
      'exatas e da terra',
      'matematica',
      'fisica',
      'quimica',
      'computacao',
      'ciencia da computacao',
      'geociencias',
      'astronomia',
      'estatistica',
    ],
  },
  {
    areaOficial: 'CIÊNCIAS BIOLÓGICAS',
    palavrasChave: [
      'biologicas',
      'ciencias biologicas',
      'biologia',
      'bioquimica',
      'biofisica',
      'genetica',
      'botanica',
      'zoologia',
      'ecologia',
      'morfologia',
      'microbiologia',
      'parasitologia',
      'farmacologia',
      'imunologia',
    ],
  },
  {
    areaOficial: 'ENGENHARIAS',
    palavrasChave: [
      'engenharia',
      'engenharias',
      'robotica',
      'mecanica',
      'eletrica',
      'eletronica',
      'civil',
      'automacao',
      'producao',
      'quimica e ambiental',
      'materiais',
      'telecomunicacoes',
      'aeroespacial',
      'mecatronica',
    ],
  },
  {
    areaOficial: 'CIÊNCIAS DA SAÚDE',
    palavrasChave: [
      'saude',
      'ciencias da saude',
      'medicina',
      'enfermagem',
      'odontologia',
      'farmacia',
      'nutricao',
      'saude coletiva',
      'fonoaudiologia',
      'fisioterapia',
      'educacao fisica',
      'biomedicina',
    ],
  },
  {
    areaOficial: 'CIÊNCIAS AGRÁRIAS',
    palavrasChave: [
      'agrarias',
      'ciencias agrarias',
      'agronomia',
      'agropecuaria',
      'zootecnia',
      'recursos florestais',
      'engenharia agricola',
      'medicina veterinaria',
      'pesca',
      'ciencia e tecnologia de alimentos',
    ],
  },
  {
    areaOficial: 'CIÊNCIAS SOCIAIS APLICADAS',
    palavrasChave: [
      'sociais aplicadas',
      'ciencias sociais aplicadas',
      'administracao',
      'contabilidade',
      'ciencias contabeis',
      'economia',
      'arquitetura',
      'urbanismo',
      'direito',
      'comunicacao',
      'jornalismo',
      'publicidade',
      'design',
      'servico social',
      'turismo',
    ],
  },
  {
    areaOficial: 'CIÊNCIAS HUMANAS',
    palavrasChave: [
      'humanas',
      'ciencias humanas',
      'historia',
      'geografia',
      'filosofia',
      'sociologia',
      'antropologia',
      'arqueologia',
      'psicologia',
      'educacao',
      'pedagogia',
      'teologia',
      'ciencia politica',
    ],
  },
  {
    areaOficial: 'LINGUÍSTICA, LETRAS E ARTES',
    palavrasChave: [
      'linguistica',
      'letras',
      'linguagens',
      'linguistica letras e artes',
      'artes',
      'musica',
      'teatro',
      'cinema',
      'danca',
      'literatura',
    ],
  },
  {
    areaOficial: 'MULTIDISCIPLINAR',
    palavrasChave: [
      'multidisciplinar',
      'interdisciplinar',
      'ensino',
      'ciencias ambientais',
      'biotecnologia',
    ],
  },
];

/**
 * Normaliza o nome de uma área temática:
 * 1. Verifica correspondência direta com as grandes áreas do CNPq.
 * 2. Se reconhecida, retorna a área oficial oficial acentuada em MAIÚSCULO.
 * 3. Se não reconhecida, retorna o texto sanitizado (espaçamento único, sem acentos, em MAIÚSCULO).
 */
export function normalizarAreaTematica(nomeOriginal?: string | null): string {
  if (!nomeOriginal || !nomeOriginal.trim()) {
    return 'MULTIDISCIPLINAR';
  }

  const simplificado = simplificarTexto(nomeOriginal);

  // 1. Verifica igualdade exata com alguma grande área do CNPq
  for (const area of GRANDES_AREAS_CNPQ) {
    if (simplificado === simplificarTexto(area)) {
      return area;
    }
  }

  // 2. Verifica palavras-chave mapeadas
  for (const regra of REGRAS_CNPQ) {
    for (const kw of regra.palavrasChave) {
      if (
        simplificado === kw ||
        simplificado.startsWith(`${kw} `) ||
        simplificado.endsWith(` ${kw}`) ||
        simplificado.includes(` ${kw} `)
      ) {
        return regra.areaOficial;
      }
    }
  }

  // 3. Fallback: Limpa acentuação, colapsa espaços e põe em MAIÚSCULO
  return sanitizarMaiusculoSemAcentos(nomeOriginal);
}
