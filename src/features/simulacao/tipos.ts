/** Contratos da simulação de evento que a interface e o adaptador compartilham. */

/** Evento ativo no momento, como o pré-voo o encontra. */
export interface EventoAtivo {
  id_evento: string;
  nome_evento: string;
  /** A janela de avaliação do evento real está aberta agora? */
  janelaAberta: boolean;
}

/** Simulação que ficou no banco de uma rodada anterior (a aba foi fechada no meio). */
export interface SimulacaoOrfa {
  id_evento: string;
  nome_evento: string;
  is_ativo: boolean;
  /** Nome do evento que estava ativo antes dela, lido da descrição. */
  nomeEventoAnterior: string | null;
}

/** Retrato do pré-voo: o que existe antes de a simulação começar. */
export interface PreVoo {
  eventoAtivo: EventoAtivo | null;
  orfas: SimulacaoOrfa[];
}

export interface ResumoSemeadura {
  idEvento: string;
  nomeEvento: string;
  projetos: number;
  avaliadores: number;
  staff: number;
  questionarios: number;
}

export interface ResumoLimpeza {
  avaliacoesApagadas: number;
  eventosApagados: number;
  usuariosApagados: number;
  usuariosPreservados: number;
}
