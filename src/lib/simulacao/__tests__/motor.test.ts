// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  criarMotorSimulacao,
  ESPERA_COORDENACAO_MS,
  type PonteSimulacao,
  type QuestionarioResolvido,
} from '@/lib/simulacao/motor';
import { gerarPlanoSimulacao, type PlanoSimulacao } from '@/lib/simulacao/plano';
import { PARAMETROS_PADRAO, type ParametrosSimulacao } from '@/lib/simulacao/parametros';

const idsEmSequencia = () => {
  let n = 0;
  return () => `id-${String((n += 1)).padStart(5, '0')}`;
};

const montarPlano = (mudancas: Partial<ParametrosSimulacao> = {}): PlanoSimulacao =>
  gerarPlanoSimulacao({
    parametros: { ...PARAMETROS_PADRAO, ...mudancas },
    gerarId: idsEmSequencia(),
    agora: new Date('2026-11-24T12:00:00Z'),
  });

/**
 * Dublê do banco, em memória. Não há mock de Supabase nem rede: o motor conversa só com a
 * PonteSimulacao, e é isso que torna o laço concorrente testável.
 */
const criarPonte = (plano: PlanoSimulacao, opcoes: {
  cota?: number;
  falharEnvio?: (idProjeto: string, idUsuario: string) => string | null;
} = {}) => {
  const cota = opcoes.cota ?? PARAMETROS_PADRAO.cota;
  const comCheckIn = new Set<string>();
  const tecnicasPorProjeto = new Map<string, number>();
  const jaAvaliou = new Set<string>();
  const enviados: { idProjeto: string; idUsuario: string; notas: number[] }[] = [];

  let emVoo = 0;
  let picoEmVoo = 0;
  const registrar = async <T>(resultado: () => T): Promise<T> => {
    emVoo += 1;
    picoEmVoo = Math.max(picoEmVoo, emVoo);
    // Cede o laço de eventos, para a concorrência ser observável de verdade
    await Promise.resolve();
    try { return resultado(); } finally { emVoo -= 1; }
  };

  const porProjeto = new Map(plano.projetos.map((p) => [p.id_projeto, p]));
  const porQuestionario = new Map(plano.questionarios.map((q) => [q.id_questionario, q]));

  const ponte: PonteSimulacao = {
    checkIn: (idProjeto) => registrar(() => { comCheckIn.add(idProjeto); }),
    sortear: (idUsuario) => registrar(() => {
      const candidato = plano.projetos.find((projeto) => {
        if (!comCheckIn.has(projeto.id_projeto)) return false;
        if (jaAvaliou.has(`${idUsuario}:${projeto.id_projeto}`)) return false;
        return (tecnicasPorProjeto.get(projeto.id_projeto) ?? 0) < cota;
      });
      return candidato?.id_projeto ?? null;
    }),
    lerProjeto: (idProjeto) => registrar(() => ({
      idQuestionarioFixado: porProjeto.get(idProjeto)?.id_instituicao ? null : null,
    })),
    lerQuestionario: (idQuestionario) => registrar((): QuestionarioResolvido => {
      const questionario = porQuestionario.get(idQuestionario);
      if (!questionario) throw new Error('Questionário de outro evento.');
      return {
        id_questionario: idQuestionario,
        escala_minima: questionario.escala_minima,
        escala_maxima: questionario.escala_maxima,
        is_voto_popular: questionario.is_voto_popular,
        idsPerguntas: plano.perguntas
          .filter((p) => p.id_questionario === idQuestionario)
          .map((p) => p.id_pergunta),
      };
    }),
    enviar: (entrada) => registrar(() => {
      const chaveRecusa = `${entrada.idUsuario}:${entrada.idProjeto}`;
      const recusa = opcoes.falharEnvio?.(entrada.idProjeto, entrada.idUsuario);
      if (recusa) {
        // Marca o par antes de recusar: no banco, quem bate na cota não volta a receber o
        // mesmo projeto no sorteio. Sem isso o dublê ofereceria o mesmo projeto para sempre
        // e a feira não andaria — o que mediria o dublê, não o motor.
        jaAvaliou.add(chaveRecusa);
        throw new Error(recusa);
      }
      const chave = `${entrada.idUsuario}:${entrada.idProjeto}`;
      if (jaAvaliou.has(chave)) {
        throw new Error('Este avaliador já possui avaliação registrada para este projeto.');
      }
      const questionario = porQuestionario.get(entrada.idQuestionario);
      if (!questionario?.is_voto_popular) {
        const atual = tecnicasPorProjeto.get(entrada.idProjeto) ?? 0;
        if (atual >= cota) throw new Error('Cota de avaliações do projeto já atingida.');
        tecnicasPorProjeto.set(entrada.idProjeto, atual + 1);
      }
      jaAvaliou.add(chave);
      enviados.push({
        idProjeto: entrada.idProjeto,
        idUsuario: entrada.idUsuario,
        notas: entrada.respostas.map((r) => r.nota),
      });
    }),
  };

  return { ponte, enviados, get picoEmVoo() { return picoEmVoo; }, tecnicasPorProjeto };
};

describe('criarMotorSimulacao — caminho completo', () => {
  it('faz check-in e preenche a cota de todos os projetos presentes', async () => {
    // Arrange
    const plano = montarPlano({ projetos: 4, avaliadores: 6, cota: 2, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 });
    const { ponte, enviados } = criarPonte(plano, { cota: 2 });
    const motor = criarMotorSimulacao({ plano, parametros: { ...PARAMETROS_PADRAO, projetos: 4, avaliadores: 6, cota: 2, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 }, ponte });

    // Act
    const final = await motor.executar();

    // Assert
    expect(final.checkInsFeitos).toBe(4);
    expect(final.enviadas).toBe(8);
    expect(final.projetosConcluidos).toBe(4);
    expect(enviados).toHaveLength(8);
    expect(final.motivoDaParada).toMatch(/fecharam a cota/);
  });

  it('tira as notas da escala lida do banco, nunca de constante', async () => {
    // Arrange
    const plano = montarPlano({ projetos: 2, avaliadores: 3, cota: 1, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 });
    const { ponte, enviados } = criarPonte(plano, { cota: 1 });
    const motor = criarMotorSimulacao({ plano, parametros: { ...PARAMETROS_PADRAO, projetos: 2, avaliadores: 3, cota: 1, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 }, ponte });

    // Act
    await motor.executar();

    // Assert — a escala do plano é 0 a 10
    const todasAsNotas = enviados.flatMap((e) => e.notas);
    expect(todasAsNotas.length).toBeGreaterThan(0);
    expect(todasAsNotas.every((n) => n >= 0 && n <= 10)).toBe(true);
  });

  it('manda uma resposta para cada pergunta do questionário', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 1, avaliadores: 1, cota: 1, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte, enviados } = criarPonte(plano, { cota: 1 });

    // Act
    await criarMotorSimulacao({ plano, parametros, ponte }).executar();

    // Assert — fn_enviar_avaliacao exige todas, uma vez cada
    const esperadas = plano.perguntas.filter(
      (p) => p.id_questionario === plano.idsQuestionariosTecnicos[0],
    ).length;
    expect(enviados[0]?.notas).toHaveLength(esperadas);
  });

  it('conta voto popular à parte da nota técnica', async () => {
    // Arrange — metade votantes
    const parametros = { ...PARAMETROS_PADRAO, projetos: 2, avaliadores: 4, cota: 1, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 50 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 1 });

    // Act
    const final = await criarMotorSimulacao({ plano, parametros, ponte }).executar();

    // Assert
    expect(final.votosPopulares).toBeGreaterThan(0);
    expect(final.enviadas).toBeGreaterThan(0);
  });
});

describe('criarMotorSimulacao — concorrência', () => {
  it('nunca passa do limite de requisições em voo', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 20, avaliadores: 12, cota: 3, ritmoMs: 0, concorrencia: 3, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const medidor = criarPonte(plano, { cota: 3 });

    // Act
    await criarMotorSimulacao({ plano, parametros, ponte: medidor.ponte }).executar();

    // Assert
    expect(medidor.picoEmVoo).toBeGreaterThan(1);
    expect(medidor.picoEmVoo).toBeLessThanOrEqual(3);
  });

  it('com concorrência 1, faz uma requisição por vez', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 6, avaliadores: 4, cota: 2, ritmoMs: 0, concorrencia: 1, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const medidor = criarPonte(plano, { cota: 2 });

    // Act
    await criarMotorSimulacao({ plano, parametros, ponte: medidor.ponte }).executar();

    // Assert
    expect(medidor.picoEmVoo).toBe(1);
  });
});

describe('criarMotorSimulacao — ritmo e velocidade', () => {
  it('não gera nenhuma espera de ritmo quando o ritmo é zero', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 2, avaliadores: 2, cota: 1, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 1 });
    const esperas: number[] = [];

    // Act
    await criarMotorSimulacao({
      plano, parametros, ponte, dormir: async (ms) => { esperas.push(ms); },
    }).executar();

    // Assert — com ritmo 0 o laço é dirigido pela rede, e a medição fica limpa: o que
    // sobra são só as esperas de coordenação entre trabalhadores
    expect(esperas.every((ms) => ms === ESPERA_COORDENACAO_MS)).toBe(true);
  });

  it('a velocidade divide a espera pedida', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 2, avaliadores: 2, cota: 1, ritmoMs: 1000, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 1 });

    const esperasNormais: number[] = [];
    const motorNormal = criarMotorSimulacao({
      plano, parametros, ponte,
      dormir: async (ms) => { esperasNormais.push(ms); },
    });
    await motorNormal.executar();

    const plano2 = montarPlano(parametros);
    const ponte2 = criarPonte(plano2, { cota: 1 });
    const esperasRapidas: number[] = [];
    const motorRapido = criarMotorSimulacao({
      plano: plano2, parametros, ponte: ponte2.ponte,
      dormir: async (ms) => { esperasRapidas.push(ms); },
    });
    motorRapido.ajustarVelocidade(4);

    // Act
    await motorRapido.executar();

    // Assert — jitter mantém a faixa, então comparamos o teto
    expect(Math.max(...esperasNormais)).toBeGreaterThan(Math.max(...esperasRapidas) * 2);
  });

  it('aplica jitter, para os atores não entrarem em lockstep', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 8, avaliadores: 6, cota: 2, ritmoMs: 500, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 2 });
    const esperas: number[] = [];

    // Act
    await criarMotorSimulacao({
      plano, parametros, ponte, dormir: async (ms) => { esperas.push(ms); },
    }).executar();

    // Assert
    const doRitmo = esperas.filter((ms) => ms >= 250 && ms <= 750);
    expect(new Set(doRitmo).size).toBeGreaterThan(3);
  });
});

describe('criarMotorSimulacao — controles', () => {
  it('pausa no topo do ciclo e não deixa trava pendurada entre sortear e enviar', async () => {
    // Arrange
    // ritmo > 0 de propósito: com o dublê em memória e ritmo 0 a rodada acabaria antes de
    // dar tempo de pausar, e o teste mediria a velocidade do dublê em vez da pausa.
    const parametros = { ...PARAMETROS_PADRAO, projetos: 30, avaliadores: 10, cota: 3, ritmoMs: 40, concorrencia: 2, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const medidor = criarPonte(plano, { cota: 3 });
    let sorteios = 0;
    const ponteContada: PonteSimulacao = {
      ...medidor.ponte,
      sortear: async (u, e) => { sorteios += 1; return medidor.ponte.sortear(u, e); },
    };
    const motor = criarMotorSimulacao({ plano, parametros, ponte: ponteContada });

    // Act
    const rodada = motor.executar();
    await new Promise((r) => { setTimeout(r, 5); });
    motor.pausar();
    const sorteiosNaPausa = sorteios;
    await new Promise((r) => { setTimeout(r, 20); });

    // Assert — pausado, nenhum sorteio novo sai
    expect(sorteios).toBe(sorteiosNaPausa);
    expect(motor.estado().fase).toBe('pausada');

    // Act — retomar volta a emitir e a rodada termina
    motor.retomar();
    const final = await rodada;

    // Assert
    expect(sorteios).toBeGreaterThan(sorteiosNaPausa);
    expect(final.fase).toBe('encerrada');
  });

  it('encerrar para a rodada e diz o motivo', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 200, avaliadores: 20, cota: 3, ritmoMs: 40, concorrencia: 2, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 3 });
    const motor = criarMotorSimulacao({ plano, parametros, ponte });

    // Act
    const rodada = motor.executar();
    await new Promise((r) => { setTimeout(r, 5); });
    motor.encerrar();
    const final = await rodada;

    // Assert
    expect(final.fase).toBe('encerrada');
    expect(final.motivoDaParada).toMatch(/encerrada pela coordenação/);
    expect(final.emVoo).toBe(0);
  });

  it('para no teto de tempo', async () => {
    // Arrange — relógio controlado: cada leitura avança 100 ms
    const parametros = { ...PARAMETROS_PADRAO, projetos: 500, avaliadores: 30, cota: 3, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 3 });
    let relogio = 0;

    // Act
    const final = await criarMotorSimulacao({
      plano, parametros, ponte, tetoMs: 1000, agora: () => (relogio += 100),
    }).executar();

    // Assert
    expect(final.motivoDaParada).toMatch(/teto de tempo/);
  });
});

describe('criarMotorSimulacao — classificação de falhas', () => {
  it('conta recusa de cota como regra e segue avaliando', async () => {
    // Arrange — o dublê recusa um projeto específico por cota cheia
    const parametros = { ...PARAMETROS_PADRAO, projetos: 4, avaliadores: 6, cota: 2, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const alvo = plano.projetos[0]?.id_projeto as string;
    const { ponte } = criarPonte(plano, {
      cota: 2,
      falharEnvio: (idProjeto) =>
        idProjeto === alvo ? 'Cota de avaliações do projeto já atingida.' : null,
    });

    // Act
    const final = await criarMotorSimulacao({ plano, parametros, ponte }).executar();

    // Assert — recusa de regra não é erro, e não interrompe a feira
    expect(final.recusadasPorRegra['cota do projeto cheia']).toBeGreaterThan(0);
    expect(final.erros).toEqual({});
    expect(final.enviadas).toBeGreaterThan(0);
  });

  it('conta mensagem desconhecida como erro, sem calar o defeito', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 2, avaliadores: 3, cota: 1, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, {
      cota: 1,
      falharEnvio: () => 'column p.modalidade does not exist',
    });

    // Act
    const final = await criarMotorSimulacao({ plano, parametros, ponte }).executar();

    // Assert
    expect(final.erros['column p.modalidade does not exist']).toBeGreaterThan(0);
    expect(final.recusadasPorRegra).toEqual({});
  });
});

describe('criarMotorSimulacao — progresso', () => {
  it('avisa o acompanhante a cada avanço, com cópia do estado', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 3, avaliadores: 3, cota: 1, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 1 });
    const avisos: number[] = [];

    // Act
    await criarMotorSimulacao({
      plano, parametros, ponte, aoAtualizar: (estado) => avisos.push(estado.enviadas),
    }).executar();

    // Assert — o painel precisa de avanço monotônico, não de um retrato final só
    expect(avisos.length).toBeGreaterThan(3);
    expect(avisos[avisos.length - 1]).toBe(3);
  });
});

describe('criarMotorSimulacao — modo sessão por avaliador', () => {
  it('prepara a sessão de cada avaliador uma única vez', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 4, avaliadores: 3, cota: 2, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 2 });
    const preparados: string[] = [];

    // Act
    await criarMotorSimulacao({
      plano, parametros,
      ponte: { ...ponte, prepararAvaliador: async (a) => { preparados.push(a.id_usuario); } },
    }).executar();

    // Assert — pareamento é uma vez por aparelho, não por ciclo
    expect(preparados).toHaveLength(3);
    expect(new Set(preparados).size).toBe(3);
  });

  it('desiste do avaliador cujo pareamento falha, sem derrubar a rodada', async () => {
    // Arrange
    const parametros = { ...PARAMETROS_PADRAO, projetos: 4, avaliadores: 3, cota: 2, ritmoMs: 0, porcentoCheckIn: 100, porcentoVotoPopular: 0 };
    const plano = montarPlano(parametros);
    const { ponte } = criarPonte(plano, { cota: 2 });
    const primeiro = plano.avaliadores[0]?.id_usuario;

    // Act
    const final = await criarMotorSimulacao({
      plano, parametros,
      ponte: {
        ...ponte,
        prepararAvaliador: async (a) => {
          if (a.id_usuario === primeiro) throw new Error('Falha ao parear o aparelho.');
        },
      },
    }).executar();

    // Assert
    expect(final.erros['Falha ao parear o aparelho.']).toBe(1);
    expect(final.enviadas).toBeGreaterThan(0);
  });
});
