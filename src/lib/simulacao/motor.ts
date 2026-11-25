/**
 * Motor da simulação: o laço concorrente que faz a feira fictícia acontecer.
 *
 * O caminho é o REAL — `sortear_proximo_projeto` cria a trava e `fn_enviar_avaliacao`
 * calcula a nota no servidor —, então janela de horário, conflito institucional, modalidade
 * bloqueada, cota, trava, fixação de questionário e quarentena são exercitados de verdade.
 *
 * O acesso ao banco entra por `PonteSimulacao`, nunca direto: é o que permite testar o laço
 * com um dublê em memória, sem rede e sem mock de Supabase, e é também o que faz os dois
 * modos de sessão (pela sessão do Admin, ou uma sessão por avaliador) caberem sem duplicar
 * o motor.
 *
 * Módulo puro: docs/arquitetura/frontend.md, regra 3.
 */
import { comJitter, criarSorteio, notaSorteada, umDe, type TendenciaNota } from './aleatorio';
import { classificarFalha } from './negativos';
import type { AvaliadorDoPlano, PlanoSimulacao } from './plano';
import type { ParametrosSimulacao } from './parametros';

/** Questionário como o banco o devolve: a escala e as perguntas vêm de lá, nunca de constante. */
export interface QuestionarioResolvido {
  id_questionario: string;
  escala_minima: number;
  escala_maxima: number;
  is_voto_popular: boolean;
  idsPerguntas: string[];
}

export interface EntradaEnvio {
  idUsuario: string;
  idProjeto: string;
  idQuestionario: string;
  respostas: { id_pergunta: string; nota: number }[];
  parecer: string | null;
}

/** Tudo que o motor precisa do banco. Implementada em `src/features/simulacao/`. */
export interface PonteSimulacao {
  /** Modo "sessão por avaliador": abre a sessão e pareia o aparelho antes do primeiro ciclo. */
  prepararAvaliador?: (avaliador: AvaliadorDoPlano) => Promise<void>;
  checkIn: (idProjeto: string) => Promise<void>;
  sortear: (idUsuario: string, idEvento: string) => Promise<string | null>;
  lerProjeto: (idProjeto: string) => Promise<{ idQuestionarioFixado: string | null }>;
  lerQuestionario: (idQuestionario: string) => Promise<QuestionarioResolvido>;
  enviar: (entrada: EntradaEnvio) => Promise<void>;
}

export type FaseSimulacao = 'parada' | 'rodando' | 'pausada' | 'encerrando' | 'encerrada';

export interface EstadoSimulacao {
  fase: FaseSimulacao;
  /** Avaliações técnicas enviadas com sucesso. */
  enviadas: number;
  /** Votos populares enviados com sucesso. */
  votosPopulares: number;
  checkInsFeitos: number;
  /** Projetos que fecharam a cota técnica. */
  projetosConcluidos: number;
  /** Recusas que são a regra funcionando: rótulo → quantas vezes. */
  recusadasPorRegra: Record<string, number>;
  /** Falhas que não casam com nenhuma regra conhecida: mensagem → quantas vezes. */
  erros: Record<string, number>;
  /** Avaliadores que ainda têm o que fazer. */
  avaliadoresAtivos: number;
  /** Requisições em voo neste instante. */
  emVoo: number;
  iniciadoEm: number;
  atualizadoEm: number;
  /** Por que a rodada parou, quando parou. */
  motivoDaParada: string | null;
}

export interface MotorSimulacao {
  executar: () => Promise<EstadoSimulacao>;
  pausar: () => void;
  retomar: () => void;
  encerrar: () => void;
  ajustarVelocidade: (multiplicador: number) => void;
  estado: () => EstadoSimulacao;
}

export interface ArgumentosMotor {
  plano: PlanoSimulacao;
  parametros: ParametrosSimulacao;
  ponte: PonteSimulacao;
  aoAtualizar?: (estado: EstadoSimulacao) => void;
  /** Injetável para o teste: por padrão, um `setTimeout`. */
  dormir?: (ms: number) => Promise<void>;
  /** Injetável para o teste: por padrão, `Date.now`. */
  agora?: () => number;
  /** Teto de tempo da rodada, em ms. */
  tetoMs?: number;
}

/** Quantas vezes um avaliador aceita "nenhum projeto elegível" antes de desistir. */
const VAZIOS_ATE_DESISTIR = 3;

/** Teto de ciclos por avaliador: rede de segurança contra laço infinito. */
const TETO_CICLOS_POR_AVALIADOR = 2000;

/**
 * Espera curta de COORDENAÇÃO: sorteio vazio com check-in a caminho, ou todos os atores já
 * com um trabalhador. Não é o ritmo do avaliador — com `ritmoMs: 0` ela continua existindo,
 * porque é o que evita girar em falso consumindo CPU.
 */
export const ESPERA_COORDENACAO_MS = 150;

const TETO_MS_PADRAO = 900_000;

const dormirComTimeout = (ms: number): Promise<void> =>
  new Promise((resolver) => { setTimeout(resolver, ms); });

/**
 * Pausa como promessa, não como polling: quem está pausado espera sem acordar a cada tique.
 */
const criarBarreira = () => {
  let liberada = true;
  let aguardando: (() => void)[] = [];
  return {
    get pausada() { return !liberada; },
    fechar() { liberada = false; },
    abrir() {
      liberada = true;
      const pendentes = aguardando;
      aguardando = [];
      for (const resolver of pendentes) resolver();
    },
    esperar(): Promise<void> {
      if (liberada) return Promise.resolve();
      return new Promise((resolver) => { aguardando.push(resolver); });
    },
  };
};

interface AtorAvaliador {
  avaliador: AvaliadorDoPlano;
  sorteio: () => number;
  ciclos: number;
  vazios: number;
  enviadas: number;
  preparado: boolean;
  exaurido: boolean;
  /**
   * Já há um trabalhador neste avaliador.
   *
   * Sem isso, dois trabalhadores pegariam o mesmo ator ao mesmo tempo — e como
   * `sortear_proximo_projeto` APAGA a trava anterior do avaliador antes de sortear de novo,
   * o segundo sorteio derrubaria a trava do primeiro e o envio voltaria com "Sem trava
   * ativa". Uma pessoa não avalia dois estandes ao mesmo tempo; o ator também não.
   */
  ocupado: boolean;
}

export const criarMotorSimulacao = (argumentos: ArgumentosMotor): MotorSimulacao => {
  const { plano, parametros, ponte } = argumentos;
  const dormir = argumentos.dormir ?? dormirComTimeout;
  const agora = argumentos.agora ?? (() => Date.now());
  const tetoMs = argumentos.tetoMs ?? TETO_MS_PADRAO;
  const aoAtualizar = argumentos.aoAtualizar ?? (() => {});

  const controle = { velocidade: Math.max(parametros.velocidade, 0.01) };
  const barreira = criarBarreira();
  let encerrado = false;
  let fase: FaseSimulacao = 'parada';
  let motivoDaParada: string | null = null;

  const estado: EstadoSimulacao = {
    fase,
    enviadas: 0,
    votosPopulares: 0,
    checkInsFeitos: 0,
    projetosConcluidos: 0,
    recusadasPorRegra: {},
    erros: {},
    avaliadoresAtivos: plano.avaliadores.length,
    emVoo: 0,
    iniciadoEm: 0,
    atualizadoEm: 0,
    motivoDaParada: null,
  };

  /** Notas técnicas que o motor já conseguiu gravar em cada projeto. */
  const tecnicasPorProjeto = new Map<string, number>();
  /** Alterna a tendência das notas nos projetos escolhidos para divergir. */
  const divergentes = new Set(plano.projetosDivergentes);
  const questionariosLidos = new Map<string, QuestionarioResolvido>();
  const comCheckIn = new Set<string>();

  const publicar = (): void => {
    estado.fase = fase;
    estado.motivoDaParada = motivoDaParada;
    estado.atualizadoEm = agora();
    aoAtualizar({ ...estado, recusadasPorRegra: { ...estado.recusadasPorRegra }, erros: { ...estado.erros } });
  };

  const somar = (mapa: Record<string, number>, chave: string): void => {
    mapa[chave] = (mapa[chave] ?? 0) + 1;
  };

  /** Toda chamada ao banco passa por aqui, para `emVoo` refletir a concorrência real. */
  const comMedida = async <T>(executar: () => Promise<T>): Promise<T> => {
    estado.emVoo += 1;
    try {
      return await executar();
    } finally {
      estado.emVoo -= 1;
    }
  };

  const registrarFalha = (erro: unknown): void => {
    const mensagem = (erro as { message?: string })?.message ?? String(erro);
    const falha = classificarFalha(mensagem);
    if (falha.tipo === 'regra') somar(estado.recusadasPorRegra, falha.rotulo);
    else somar(estado.erros, falha.rotulo);
  };

  const pensar = async (sorteio: () => number, baseMs: number): Promise<void> => {
    if (baseMs <= 0) return; // ritmo 0: nenhum await, o laço é dirigido pela rede
    const espera = comJitter(sorteio, baseMs / controle.velocidade);
    if (espera > 0) await dormir(espera);
  };

  const lerQuestionario = async (id: string): Promise<QuestionarioResolvido> => {
    const guardado = questionariosLidos.get(id);
    if (guardado) return guardado;
    const lido = await comMedida(() => ponte.lerQuestionario(id));
    questionariosLidos.set(id, lido);
    return lido;
  };

  /** Vinculado > fixado no projeto > sorteado entre os técnicos. */
  const resolverQuestionario = async (
    ator: AtorAvaliador,
    idProjeto: string,
  ): Promise<string> => {
    if (ator.avaliador.idQuestionarioVinculado) return ator.avaliador.idQuestionarioVinculado;
    const projeto = await comMedida(() => ponte.lerProjeto(idProjeto));
    if (projeto.idQuestionarioFixado) return projeto.idQuestionarioFixado;
    return umDe(ator.sorteio, plano.idsQuestionariosTecnicos);
  };

  const tendenciaDoProjeto = (idProjeto: string): TendenciaNota => {
    if (!divergentes.has(idProjeto)) return 'centro';
    // Alterna pelas notas já gravadas: a primeira vai para o alto, a segunda para o baixo,
    // e é essa diferença que a regra de quarentena do banco enxerga.
    return (tecnicasPorProjeto.get(idProjeto) ?? 0) % 2 === 0 ? 'alta' : 'baixa';
  };

  const montarRespostas = (
    questionario: QuestionarioResolvido,
    sorteio: () => number,
    tendencia: TendenciaNota,
  ): { id_pergunta: string; nota: number }[] =>
    questionario.idsPerguntas.map((idPergunta) => ({
      id_pergunta: idPergunta,
      nota: notaSorteada(
        sorteio,
        questionario.escala_minima,
        questionario.escala_maxima,
        parametros.dispersaoNotas / 100,
        tendencia,
      ),
    }));

  /** Todo projeto com check-in fechou a cota: a feira acabou. */
  const feiraConcluida = (): boolean => {
    if (comCheckIn.size === 0) return false;
    if (comCheckIn.size < plano.projetosParaCheckIn.length) return false;
    for (const idProjeto of comCheckIn) {
      if ((tecnicasPorProjeto.get(idProjeto) ?? 0) < parametros.cota) return false;
    }
    return true;
  };

  const deveParar = (inicio: number): boolean =>
    encerrado || agora() - inicio >= tetoMs || feiraConcluida();

  // ---------------------------------------------------------------- ator de check-in

  const filaCheckIn = [...plano.projetosParaCheckIn];

  const cicloCheckIn = async (sorteio: () => number): Promise<boolean> => {
    const idProjeto = filaCheckIn.shift();
    if (idProjeto === undefined) return false;
    try {
      await comMedida(() => ponte.checkIn(idProjeto));
      comCheckIn.add(idProjeto);
      estado.checkInsFeitos += 1;
    } catch (erro) {
      registrarFalha(erro);
    }
    publicar();
    await pensar(sorteio, parametros.ritmoMs);
    return true;
  };

  // --------------------------------------------------------------- ator avaliador

  const cicloAvaliador = async (ator: AtorAvaliador): Promise<void> => {
    if (ponte.prepararAvaliador && !ator.preparado) {
      try {
        await comMedida(() => ponte.prepararAvaliador!(ator.avaliador));
        ator.preparado = true;
      } catch (erro) {
        registrarFalha(erro);
        ator.exaurido = true;
        return;
      }
    }

    ator.ciclos += 1;

    let idProjeto: string | null;
    try {
      idProjeto = await comMedida(() => ponte.sortear(ator.avaliador.id_usuario, plano.evento.id_evento));
    } catch (erro) {
      registrarFalha(erro);
      ator.exaurido = true;
      return;
    }

    if (!idProjeto) {
      ator.vazios += 1;
      // Insiste enquanto o staff ainda libera check-in: o projeto elegível pode estar a
      // caminho, ou travado por outro avaliador neste instante.
      if (filaCheckIn.length > 0 || ator.vazios < VAZIOS_ATE_DESISTIR) {
        await dormir(ESPERA_COORDENACAO_MS);
        return;
      }
      ator.exaurido = true;
      return;
    }

    try {
      const idQuestionario = await resolverQuestionario(ator, idProjeto);
      const questionario = await lerQuestionario(idQuestionario);
      const tendencia = tendenciaDoProjeto(idProjeto);
      await pensar(ator.sorteio, parametros.ritmoMs);
      await comMedida(() => ponte.enviar({
        idUsuario: ator.avaliador.id_usuario,
        idProjeto: idProjeto as string,
        idQuestionario,
        respostas: montarRespostas(questionario, ator.sorteio, tendencia),
        parecer: null,
      }));

      ator.enviadas += 1;
      ator.vazios = 0;
      if (questionario.is_voto_popular) {
        estado.votosPopulares += 1;
      } else {
        estado.enviadas += 1;
        const antes = tecnicasPorProjeto.get(idProjeto) ?? 0;
        tecnicasPorProjeto.set(idProjeto, antes + 1);
        if (antes + 1 >= parametros.cota) estado.projetosConcluidos += 1;
      }
    } catch (erro) {
      registrarFalha(erro);
    }

    publicar();
  };

  // ------------------------------------------------------------------------ laço

  const executar = async (): Promise<EstadoSimulacao> => {
    const inicio = agora();
    estado.iniciadoEm = inicio;
    fase = 'rodando';
    publicar();

    const atores: AtorAvaliador[] = plano.avaliadores.map((avaliador) => ({
      avaliador,
      sorteio: criarSorteio(avaliador.semente),
      ciclos: 0,
      vazios: 0,
      enviadas: 0,
      preparado: false,
      exaurido: false,
      ocupado: false,
    }));

    const sorteioCheckIn = criarSorteio(parametros.semente + 1);
    let proximo = 0;

    /**
     * Um trabalhador pega o próximo ator com trabalho e roda UM ciclo dele. Com
     * `concorrencia` trabalhadores, nunca há mais que `concorrencia` requisições em voo.
     */
    const trabalhador = async (): Promise<void> => {
      while (true) {
        // A pausa só é conferida AQUI, no topo do ciclo. Pausar entre o sorteio e o envio
        // deixaria uma trava real pendurada, e uma pausa maior que o timeout da trava faria
        // o envio voltar com "Sem trava ativa".
        if (barreira.pausada) await barreira.esperar();
        if (deveParar(inicio)) return;

        // Check-in e avaliação correm juntos de propósito: é assim que o telão mostra o
        // pavilhão enchendo enquanto as notas sobem.
        if (filaCheckIn.length > 0 && await cicloCheckIn(sorteioCheckIn)) continue;

        const ativos = atores.filter((ator) =>
          !ator.exaurido && ator.ciclos < TETO_CICLOS_POR_AVALIADOR);
        estado.avaliadoresAtivos = ativos.length;
        if (ativos.length === 0) return;

        const livres = ativos.filter((ator) => !ator.ocupado);
        if (livres.length === 0) {
          // Todos os atores vivos já estão com outro trabalhador: espera um instante em vez
          // de girar em falso consumindo CPU.
          await dormir(ESPERA_COORDENACAO_MS);
          continue;
        }

        const ator = livres[proximo % livres.length] as AtorAvaliador;
        proximo += 1;
        ator.ocupado = true;
        try {
          await cicloAvaliador(ator);
        } finally {
          ator.ocupado = false;
        }
      }
    };

    const quantos = Math.max(1, Math.min(parametros.concorrencia, atores.length + 1));
    await Promise.all(Array.from({ length: quantos }, trabalhador));

    motivoDaParada =
      encerrado ? 'encerrada pela coordenação'
      : feiraConcluida() ? 'todos os projetos presentes fecharam a cota'
      : agora() - inicio >= tetoMs ? 'teto de tempo da rodada'
      : 'nenhum avaliador conseguiu avançar';
    fase = 'encerrada';
    estado.emVoo = 0;
    publicar();
    return { ...estado };
  };

  return {
    executar,
    pausar: () => {
      if (fase !== 'rodando') return;
      barreira.fechar();
      fase = 'pausada';
      publicar();
    },
    retomar: () => {
      if (fase !== 'pausada') return;
      fase = 'rodando';
      barreira.abrir();
      publicar();
    },
    encerrar: () => {
      encerrado = true;
      if (fase === 'pausada') barreira.abrir();
      if (fase !== 'encerrada') fase = 'encerrando';
      publicar();
    },
    ajustarVelocidade: (multiplicador: number) => {
      controle.velocidade = Math.max(multiplicador, 0.01);
    },
    estado: () => ({ ...estado }),
  };
};
