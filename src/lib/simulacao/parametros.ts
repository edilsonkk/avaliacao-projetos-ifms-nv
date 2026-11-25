/**
 * Parâmetros da simulação de evento e os limites de cada ambiente.
 *
 * Módulo puro (sem React, sem Supabase): docs/arquitetura/frontend.md, regra 3.
 * Ver docs/operacao/simulacao-de-evento.md.
 */

/** Como as chamadas do avaliador são autenticadas durante a rodada. */
export type ModoSessao = 'admin' | 'por-avaliador';

/** Ambiente do banco em uso, como `src/lib/ambiente.ts` o identifica. */
export type AmbienteSimulacao = 'local' | 'producao';

export interface ParametrosSimulacao {
  /** Quantos projetos fictícios o evento terá. */
  projetos: number;
  /** Quantos avaliadores, somando técnicos e votantes do voto popular. */
  avaliadores: number;
  /** Quantos membros de staff. Só cria as linhas: o check-in da simulação é do Admin. */
  staff: number;
  /** Avaliações técnicas por projeto (`eventos.cota_avaliacoes_padrao`). */
  cota: number;
  /** Quantos questionários técnicos. Com mais de um, a trava do questionário passa a importar. */
  questionariosTecnicos: number;
  /** Tempo de pensar entre as ações de cada avaliador, em ms. 0 desliga a pausa. */
  ritmoMs: number;
  /** Multiplicador de velocidade: divide o ritmo. */
  velocidade: number;
  /** Quantas requisições ficam em voo ao mesmo tempo. */
  concorrencia: number;
  /** Fatia dos avaliadores que entram como votantes do voto popular (0 a 100). */
  porcentoVotoPopular: number;
  /** Fatia dos projetos que recebem check-in durante a rodada (0 a 100). */
  porcentoCheckIn: number;
  /** Fatia dos avaliadores que começam credenciados (0 a 100). */
  porcentoCredenciamento: number;
  /** Espalhamento das notas na escala do questionário (0 a 100). */
  dispersaoNotas: number;
  /** Fatia dos projetos que recebem notas divergentes de propósito (0 a 100). */
  porcentoQuarentena: number;
  /** Modo de autenticação das chamadas do avaliador. */
  modoSessao: ModoSessao;
  /** Semente do sorteio: a mesma semente reproduz a mesma feira. */
  semente: number;
}

export const PARAMETROS_PADRAO: ParametrosSimulacao = {
  projetos: 40,
  avaliadores: 12,
  staff: 2,
  cota: 3,
  questionariosTecnicos: 1,
  ritmoMs: 800,
  velocidade: 1,
  concorrencia: 4,
  porcentoVotoPopular: 15,
  porcentoCheckIn: 85,
  porcentoCredenciamento: 90,
  dispersaoNotas: 40,
  porcentoQuarentena: 10,
  modoSessao: 'admin',
  semente: 2026,
};

export interface LimitesSimulacao {
  projetos: number;
  avaliadores: number;
  staff: number;
  cota: number;
  questionariosTecnicos: number;
  concorrencia: number;
  /** Teto do produto projetos × cota. Em produção, o que limita é o volume gravado. */
  totalAvaliacoes: number;
  /** O modo "sessão por avaliador" é permitido neste ambiente? */
  permiteSessaoPorAvaliador: boolean;
}

/**
 * Em local o banco é descartável: `npx supabase db reset` zera tudo, inclusive `auth.users`.
 */
export const LIMITES_LOCAL: LimitesSimulacao = {
  projetos: 2000,
  avaliadores: 500,
  staff: 50,
  cota: 10,
  questionariosTecnicos: 5,
  concorrencia: 24,
  totalAvaliacoes: 20000,
  permiteSessaoPorAvaliador: true,
};

/**
 * Em produção os limites são conservadores porque o que fica é permanente: cada avaliação
 * grava respostas e duas linhas na trilha append-only, que nenhuma limpeza apaga (ADR 0014).
 *
 * E o modo "sessão por avaliador" é proibido: cada sessão anônima cria uma linha em
 * `auth.users` que só a chave de serviço apaga — e ela, por desenho, não existe no
 * navegador. O lixo seria permanente.
 */
export const LIMITES_PRODUCAO: LimitesSimulacao = {
  projetos: 60,
  avaliadores: 30,
  staff: 10,
  cota: 3,
  questionariosTecnicos: 2,
  concorrencia: 8,
  totalAvaliacoes: 200,
  permiteSessaoPorAvaliador: false,
};

/**
 * Limites do ambiente. Ambiente desconhecido recebe os de produção: o mesmo critério
 * conservador de `identificarAmbienteSupabase`, que trata URL inválida como produção.
 */
export const limitesDoAmbiente = (ambiente: AmbienteSimulacao | null): LimitesSimulacao =>
  ambiente === 'local' ? LIMITES_LOCAL : LIMITES_PRODUCAO;

export interface ResultadoValidacao {
  /** Impedem a rodada de começar. */
  erros: string[];
  /** Não impedem, mas a pessoa precisa saber antes de iniciar. */
  avisos: string[];
}

const inteiroNaFaixa = (
  valor: number,
  minimo: number,
  maximo: number,
  rotulo: string,
  erros: string[],
): void => {
  if (!Number.isFinite(valor) || !Number.isInteger(valor)) {
    erros.push(`${rotulo} precisa ser um número inteiro.`);
    return;
  }
  if (valor < minimo) erros.push(`${rotulo} precisa ser no mínimo ${minimo}.`);
  if (valor > maximo) erros.push(`${rotulo}: o máximo neste ambiente é ${maximo}.`);
};

const porcentagem = (valor: number, rotulo: string, erros: string[]): void => {
  if (!Number.isFinite(valor)) {
    erros.push(`${rotulo} precisa ser um número.`);
    return;
  }
  if (valor < 0 || valor > 100) erros.push(`${rotulo} precisa ficar entre 0 e 100.`);
};

/** Confere os parâmetros contra os limites do ambiente. */
export const validarParametros = (
  parametros: ParametrosSimulacao,
  ambiente: AmbienteSimulacao | null,
): ResultadoValidacao => {
  const limites = limitesDoAmbiente(ambiente);
  const erros: string[] = [];
  const avisos: string[] = [];

  inteiroNaFaixa(parametros.projetos, 1, limites.projetos, 'Projetos', erros);
  inteiroNaFaixa(parametros.avaliadores, 1, limites.avaliadores, 'Avaliadores', erros);
  inteiroNaFaixa(parametros.staff, 0, limites.staff, 'Staff', erros);
  inteiroNaFaixa(parametros.cota, 1, limites.cota, 'Avaliações por projeto', erros);
  inteiroNaFaixa(
    parametros.questionariosTecnicos, 1, limites.questionariosTecnicos,
    'Questionários técnicos', erros,
  );
  inteiroNaFaixa(parametros.concorrencia, 1, limites.concorrencia, 'Concorrência', erros);

  if (!Number.isFinite(parametros.ritmoMs) || parametros.ritmoMs < 0) {
    erros.push('Ritmo precisa ser zero ou mais.');
  }
  if (!Number.isFinite(parametros.velocidade) || parametros.velocidade <= 0) {
    erros.push('Velocidade precisa ser maior que zero.');
  }

  porcentagem(parametros.porcentoVotoPopular, 'Voto popular', erros);
  porcentagem(parametros.porcentoCheckIn, 'Check-in', erros);
  porcentagem(parametros.porcentoCredenciamento, 'Credenciamento', erros);
  porcentagem(parametros.dispersaoNotas, 'Dispersão das notas', erros);
  porcentagem(parametros.porcentoQuarentena, 'Quarentena', erros);

  const total = parametros.projetos * parametros.cota;
  if (total > limites.totalAvaliacoes) {
    erros.push(
      `Esta configuração pede ${total} avaliações, e o máximo neste ambiente é ` +
      `${limites.totalAvaliacoes}. Reduza os projetos ou as avaliações por projeto.`,
    );
  }

  if (parametros.modoSessao === 'por-avaliador' && !limites.permiteSessaoPorAvaliador) {
    erros.push(
      'O modo "sessão por avaliador" só roda no banco local: cada sessão anônima cria uma ' +
      'conta que apenas a chave de serviço apaga, e ela não existe no navegador.',
    );
  }

  // Avisos: não impedem a rodada, mas mudam o que ela mostra.
  const tecnicos = Math.round(
    parametros.avaliadores * (1 - parametros.porcentoVotoPopular / 100),
  );
  if (tecnicos < 1) {
    avisos.push(
      'Nenhum avaliador técnico sobra com essa fatia de voto popular: a feira não vai ' +
      'concluir nenhum projeto.',
    );
  } else if (total > tecnicos * parametros.projetos) {
    avisos.push('Há avaliações de sobra para poucos avaliadores: a rodada vai demorar.');
  }

  // A conferência real é do banco, que recusa o avaliador da mesma instituição do projeto.
  if (parametros.avaliadores < parametros.cota) {
    avisos.push(
      `Com ${parametros.avaliadores} avaliador(es) e cota ${parametros.cota}, nenhum projeto ` +
      'fecha a cota: um avaliador não avalia o mesmo projeto duas vezes.',
    );
  }

  if (parametros.porcentoCheckIn === 0) {
    avisos.push('Sem check-in, nenhum projeto é sorteado: o telão não vai sair do zero.');
  }

  return { erros, avisos };
};
