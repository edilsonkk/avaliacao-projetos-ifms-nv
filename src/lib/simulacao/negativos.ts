/**
 * Recusas que são ACERTO da simulação: a regra de negócio funcionando sob concorrência.
 *
 * Um avaliador que tenta avaliar um projeto com a cota cheia DEVE ser recusado. Contar isso
 * como erro faria a simulação parecer quebrada justamente quando o sistema está correto —
 * e esconderia os erros de verdade no meio do ruído. A ideia e as primeiras expressões vêm
 * de `scripts/simular-feira.mjs`.
 *
 * As expressões casam as mensagens de `fn_enviar_avaliacao` e `sortear_proximo_projeto`
 * (supabase/schema.sql). Toleram variação de acento para não quebrar se a mensagem for
 * reescrita com outra grafia, mas são específicas o bastante para não engolir erro alheio.
 *
 * Módulo puro: docs/arquitetura/frontend.md, regra 3.
 */

/** Uma recusa esperada: o rótulo aparece no painel de progresso. */
export interface NegativoEsperado {
  rotulo: string;
  teste: RegExp;
}

export const NEGATIVOS_ESPERADOS: readonly NegativoEsperado[] = [
  { rotulo: 'cota do projeto cheia', teste: /[Cc]ota de avalia[çc][õo]es do projeto j[áa] atingida/i },
  { rotulo: 'avaliador já avaliou este projeto', teste: /j[áa] possui avalia[çc][ãa]o registrada para este projeto/i },
  { rotulo: 'projeto fixado em outro questionário', teste: /projeto j[áa] [ée] avaliado com outro question/i },
  { rotulo: 'avaliador vinculado a outro questionário', teste: /vinculado a outro question/i },
  { rotulo: 'conflito de interesse (mesma instituição)', teste: /[Cc]onflito de interesse/i },
  { rotulo: 'modalidade bloqueada para o avaliador', teste: /[Mm]odalidade do projeto bloqueada/i },
  { rotulo: 'projeto sem check-in', teste: /[Pp]rojeto sem check-in/i },
  { rotulo: 'projeto fora da competição', teste: /fora da competi[çc][ãa]o/i },
  { rotulo: 'fora da janela de avaliação', teste: /[Ff]ora do hor[áa]rio de avalia[çc][ãa]o/i },
  { rotulo: 'sistema pausado pela coordenação', teste: /[Ss]istema de avalia[çc][ãa]o bloqueado/i },
  { rotulo: 'trava vencida antes do envio', teste: /[Ss]em trava ativa/i },
];

export type TipoDeFalha = 'regra' | 'erro';

export interface FalhaClassificada {
  tipo: TipoDeFalha;
  /** Rótulo da regra, quando for recusa esperada; a mensagem resumida, quando for erro. */
  rotulo: string;
}

/** Quanto da mensagem de erro entra no painel, para não virar parede de texto. */
const LIMITE_RESUMO = 120;

/** Primeira linha da mensagem, cortada. Mensagem vazia não vira rótulo vazio. */
export const resumirMensagem = (mensagem: string): string => {
  const limpa = (mensagem ?? '').split('\n')[0]?.trim() ?? '';
  if (limpa.length === 0) return 'erro sem mensagem';
  return limpa.length > LIMITE_RESUMO ? `${limpa.slice(0, LIMITE_RESUMO)}…` : limpa;
};

/**
 * Decide se a falha é a regra funcionando ou um problema de verdade.
 *
 * O que não casa com nenhuma recusa esperada é erro, de propósito: é melhor a simulação
 * acusar algo que depois se mostra benigno do que calar um defeito novo.
 */
export const classificarFalha = (mensagem: string): FalhaClassificada => {
  const texto = mensagem ?? '';
  for (const negativo of NEGATIVOS_ESPERADOS) {
    if (negativo.teste.test(texto)) return { tipo: 'regra', rotulo: negativo.rotulo };
  }
  return { tipo: 'erro', rotulo: resumirMensagem(texto) };
};
