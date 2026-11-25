/**
 * Dados fictícios da simulação de evento: catálogos, nomes e critérios.
 *
 * Fonte única, compartilhada entre a interface (`src/features/simulacao/`) e os scripts de
 * linha de comando (`scripts/semear-simulacao.mjs` e `scripts/simular-feira.mjs`), que
 * importam este arquivo pelo type-stripping nativo do Node (o projeto exige node >= 24.15).
 *
 * Por isso, duas restrições valem aqui e em `aleatorio.ts`, e só aqui: nenhum import com o
 * alias `@/` (o Node não resolve o alias do Vite) e nada que o type-stripping não apague
 * (`enum`, `namespace`, parameter property). Só `export const` e `export type`.
 *
 * Nada neste arquivo é segredo nem dado de pessoa real: todo nome é inventado e todo e-mail
 * cai no domínio reservado `@simulacao.invalid`, que por definição não existe.
 */

/**
 * Prefixo do nome do evento de simulação. É o mesmo de `scripts/semear-simulacao.mjs`, de
 * propósito: o `--limpar` do script reconhece pelo prefixo, então ele também limpa o que a
 * interface criou.
 */
export const PREFIXO_EVENTO_SIMULACAO = 'Simulação de Carga';

/** Domínio reservado (RFC 6761) dos e-mails fictícios. Nunca entrega mensagem a ninguém. */
export const DOMINIO_SIMULACAO = 'simulacao.invalid';

/** Fuso do evento. `fn_janela_avaliacao_aberta` compara a janela neste fuso, não no do navegador. */
export const FUSO_EVENTO = 'America/Campo_Grande';

/** Campi do IFMS: [nome de exibição, sigla, cidade]. */
export const CAMPI: readonly (readonly [string, string, string])[] = [
  ['Campo Grande', 'CG', 'Campo Grande'],
  ['Três Lagoas', 'TL', 'Três Lagoas'],
  ['Dourados', 'DR', 'Dourados'],
  ['Corumbá', 'CB', 'Corumbá'],
  ['Aquidauana', 'AQ', 'Aquidauana'],
  ['Nova Andradina', 'NA', 'Nova Andradina'],
  ['Ponta Porã', 'PP', 'Ponta Porã'],
  ['Coxim', 'CX', 'Coxim'],
];

/** Modalidades: [nome, código, nível]. O nível é coluna de `modalidades`. */
export const MODALIDADES: readonly (readonly [string, string, string])[] = [
  ['Ensino Fundamental', 'EF', 'Fundamental'],
  ['Ensino Médio', 'EM', 'Médio'],
  ['Ensino Técnico Integrado', 'ETI', 'Médio'],
  ['Ensino Técnico Subsequente', 'ETS', 'Técnico'],
  ['Ensino Superior', 'ES', 'Superior'],
  ['Pós-Graduação', 'PG', 'Pós-Graduação'],
];

/** Grandes áreas do CNPq. */
export const AREAS: readonly string[] = [
  'Ciências Agrárias', 'Ciências Biológicas', 'Ciências da Saúde',
  'Ciências Exatas e da Terra', 'Ciências Humanas', 'Ciências Sociais Aplicadas',
  'Engenharias', 'Linguística, Letras e Artes', 'Meio Ambiente',
  'Tecnologia da Informação',
];

/** Critérios do questionário técnico: [texto, peso de cálculo, lembrete]. */
export const CRITERIOS_TECNICOS: readonly (readonly [string, number, string])[] = [
  ['Relevância e originalidade do tema', 2.5, 'O problema é pertinente e a abordagem traz algo novo?'],
  ['Metodologia científica', 2.5, 'Os métodos são adequados, descritos e reprodutíveis?'],
  ['Resultados e conclusões', 2.0, 'Os resultados sustentam as conclusões apresentadas?'],
  ['Apresentação oral e domínio do conteúdo', 1.5, 'A equipe explica com clareza e responde às perguntas?'],
  ['Qualidade do material e do estande', 1.5, 'Banner, protótipo e organização do estande.'],
];

/** Critérios do questionário de voto popular: [texto, peso de cálculo]. */
export const CRITERIOS_VOTO_POPULAR: readonly (readonly [string, number])[] = [
  ['O projeto despertou seu interesse', 1.0],
  ['A explicação ficou clara para o público', 1.0],
  ['Você indicaria este projeto a outras pessoas', 1.0],
];

export const VERBOS: readonly string[] = [
  'Desenvolvimento de', 'Avaliação de', 'Análise de', 'Monitoramento de',
  'Automação de', 'Estudo de', 'Prototipagem de', 'Mapeamento de',
];

export const OBJETOS: readonly string[] = [
  'um sistema de irrigação', 'biossensores de baixo custo', 'resíduos sólidos urbanos',
  'energia solar fotovoltaica', 'qualidade da água do Pantanal', 'um aplicativo de acessibilidade',
  'compostagem escolar', 'drones para agricultura familiar', 'cerâmica de resíduo de construção',
  'hortas hidropônicas', 'bioplástico de amido', 'rede de sensores IoT',
];

export const CONTEXTOS: readonly string[] = [
  'no Pantanal sul-mato-grossense', 'em comunidades ribeirinhas', 'na agricultura familiar',
  'em escolas públicas', 'no Cerrado', 'em assentamentos rurais', 'na indústria local',
  'em áreas urbanas periféricas',
];

export const NOMES: readonly string[] = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique',
  'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nelson', 'Olívia', 'Paulo',
  'Queila', 'Rafael', 'Sabrina', 'Thiago', 'Úrsula', 'Vinícius', 'Wagner', 'Yara',
];

export const SOBRENOMES: readonly string[] = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Almeida', 'Costa',
  'Gomes', 'Martins', 'Araújo', 'Barbosa', 'Ribeiro', 'Carvalho', 'Lima', 'Nogueira',
  'Pereira', 'Cavalcante',
];

/** Corredores do pavilhão, para o mapa de estandes. */
export const CORREDORES: readonly string[] = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Sem acento e em caixa alta, como a coluna `nome_normalizado` dos catálogos. */
export const normalizar = (texto: string): string =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/**
 * Data e hora de agora NO FUSO DO EVENTO, como `YYYY-MM-DD` e `HH:MM:SS`.
 *
 * O relógio do navegador pode estar em outro fuso, e `fn_janela_avaliacao_aberta` compara
 * `data_evento + horario_inicio/fim` em `America/Campo_Grande`: tomar a data local deixaria
 * a janela fechada (ou aberta) na hora errada, e a simulação não sortearia nada.
 */
export const agoraNoFusoDoEvento = (
  referencia: Date = new Date(),
): { data: string; hora: string } => {
  const formatador = new Intl.DateTimeFormat('sv-SE', {
    timeZone: FUSO_EVENTO,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  // 'sv-SE' formata como "2026-11-21 14:03:09"
  const [data = '', hora = ''] = formatador.format(referencia).split(' ');
  return { data, hora };
};
