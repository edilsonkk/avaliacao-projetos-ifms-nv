// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { gerarPlanoSimulacao, type PlanoSimulacao } from '@/lib/simulacao/plano';
import { PARAMETROS_PADRAO, type ParametrosSimulacao } from '@/lib/simulacao/parametros';
import { PREFIXO_EVENTO_SIMULACAO, DOMINIO_SIMULACAO } from '@/lib/simulacao/dados';

/** Gerador de id previsível, para o plano poder ser comparado campo a campo. */
const idsEmSequencia = () => {
  let n = 0;
  return () => `id-${String((n += 1)).padStart(5, '0')}`;
};

const AGORA = new Date('2026-11-24T12:00:00Z');

const planoCom = (mudancas: Partial<ParametrosSimulacao> = {}): PlanoSimulacao =>
  gerarPlanoSimulacao({
    parametros: { ...PARAMETROS_PADRAO, ...mudancas },
    gerarId: idsEmSequencia(),
    agora: AGORA,
  });

describe('gerarPlanoSimulacao — determinismo', () => {
  it('reproduz o plano inteiro com a mesma semente', () => {
    // Arrange / Act
    const a = planoCom({ semente: 4242 });
    const b = planoCom({ semente: 4242 });

    // Assert — é o que permite repetir uma rodada problemática
    expect(a).toEqual(b);
  });

  it('muda o plano quando a semente muda', () => {
    // Act
    const a = planoCom({ semente: 1 });
    const b = planoCom({ semente: 2 });

    // Assert
    expect(a.projetos.map((p) => p.titulo)).not.toEqual(b.projetos.map((p) => p.titulo));
  });
});

describe('gerarPlanoSimulacao — evento', () => {
  it('nasce inativo, para que uma falha de semeadura não troque o evento ativo', () => {
    // Assert
    expect(planoCom().evento.is_ativo).toBe(false);
  });

  it('usa o prefixo que o script de limpeza reconhece', () => {
    // Assert
    expect(planoCom().evento.nome_evento.startsWith(PREFIXO_EVENTO_SIMULACAO)).toBe(true);
  });

  it('abre a janela o dia inteiro, senão o sorteio recusa tudo', () => {
    // Act
    const { evento } = planoCom();

    // Assert
    expect(evento.horario_inicio).toBe('00:00:00');
    expect(evento.horario_fim).toBe('23:59:59');
    expect(evento.sistema_liberado).toBe(true);
  });

  it('usa a data no fuso do evento, não a do processo', () => {
    // Assert — 24/11 12:00 UTC é 24/11 08:00 em Campo Grande
    expect(planoCom().evento.data_evento).toBe('2026-11-24');
  });

  it('leva a cota escolhida para a coluna do evento', () => {
    // Assert
    expect(planoCom({ cota: 5 }).evento.cota_avaliacoes_padrao).toBe(5);
  });

  it('guarda o NOME do evento anterior na descrição, nunca o UUID', () => {
    // Act
    const plano = gerarPlanoSimulacao({
      parametros: PARAMETROS_PADRAO,
      nomeEventoAnterior: 'FETEC-MS 2026',
      gerarId: idsEmSequencia(),
      agora: AGORA,
    });

    // Assert — UUID não aparece na interface (regra 6)
    expect(plano.evento.descricao).toContain('FETEC-MS 2026');
    expect(plano.nomeEventoAnterior).toBe('FETEC-MS 2026');
    expect(plano.evento.descricao).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe('gerarPlanoSimulacao — escopo por evento', () => {
  it('põe o id_evento em toda linha que tem essa coluna', () => {
    // Arrange — avaliadores suficientes para a fatia de modalidade bloqueada render itens
    const plano = planoCom({ projetos: 6, avaliadores: 30, staff: 1 });
    const id = plano.evento.id_evento;

    // Act
    const grupos: [string, { id_evento: string }[]][] = [
      ['instituicoes', plano.instituicoes],
      ['modalidades', plano.modalidades],
      ['areas', plano.areas],
      ['questionarios', plano.questionarios],
      ['projetos', plano.projetos],
      ['vinculos', plano.vinculos],
      ['avaliadorAreas', plano.avaliadorAreas],
      ['modalidadesBloqueadas', plano.modalidadesBloqueadas],
    ];

    // Assert — regra 5 do AGENTS.md: nenhuma linha do evento sem id_evento
    for (const [nome, grupo] of grupos) {
      expect(grupo.length, `${nome} não deveria estar vazio`).toBeGreaterThan(0);
      expect(grupo.every((linha) => linha.id_evento === id), nome).toBe(true);
    }
  });
});

describe('gerarPlanoSimulacao — projetos', () => {
  it('gera a quantidade pedida com código sequencial e único', () => {
    // Act
    const { projetos } = planoCom({ projetos: 12 });

    // Assert
    expect(projetos).toHaveLength(12);
    expect(projetos[0]?.codigo_projeto).toBe('SIM-0001');
    expect(projetos[11]?.codigo_projeto).toBe('SIM-0012');
    expect(new Set(projetos.map((p) => p.codigo_projeto)).size).toBe(12);
  });

  it('começa sem check-in, porque o check-in é ação do motor', () => {
    // Act
    const { projetos } = planoCom({ projetos: 10 });

    // Assert — é o que faz o telão mostrar o pavilhão enchendo
    expect(projetos.every((p) => p.is_check_in_realizado === false)).toBe(true);
  });

  it('dá estande e corredor a todo projeto', () => {
    // Act
    const { projetos } = planoCom({ projetos: 10 });

    // Assert
    expect(projetos.every((p) => !!p.estande && /^[A-F]$/.test(p.corredor))).toBe(true);
  });
});

describe('gerarPlanoSimulacao — proporções', () => {
  it('respeita a fatia de check-in', () => {
    // Act
    const plano = planoCom({ projetos: 100, porcentoCheckIn: 80 });

    // Assert
    expect(plano.projetosParaCheckIn).toHaveLength(80);
  });

  it('respeita a fatia de credenciamento', () => {
    // Act
    const plano = planoCom({ avaliadores: 100, porcentoCredenciamento: 90 });

    // Assert
    expect(plano.vinculos.filter((v) => v.is_credenciado)).toHaveLength(90);
  });

  it('respeita a fatia de voto popular e fixa o questionário dos votantes', () => {
    // Act
    const plano = planoCom({ avaliadores: 100, porcentoVotoPopular: 20 });
    const votantes = plano.avaliadores.filter((a) => a.ehVotante);

    // Assert
    expect(votantes).toHaveLength(20);
    expect(votantes.every((v) => v.idQuestionarioVinculado === plano.idQuestionarioVotoPopular)).toBe(true);
    expect(
      plano.vinculos.filter((v) => v.id_questionario === plano.idQuestionarioVotoPopular),
    ).toHaveLength(20);
  });

  it('escolhe para divergir só projetos que receberão check-in', () => {
    // Act
    const plano = planoCom({ projetos: 100, porcentoCheckIn: 50, porcentoQuarentena: 20 });

    // Assert — projeto sem check-in não é avaliado, então não poderia divergir
    const comCheckIn = new Set(plano.projetosParaCheckIn);
    expect(plano.projetosDivergentes).toHaveLength(10);
    expect(plano.projetosDivergentes.every((id) => comCheckIn.has(id))).toBe(true);
  });

  it('não escolhe ninguém para divergir quando a quarentena é zero', () => {
    // Assert
    expect(planoCom({ porcentoQuarentena: 0 }).projetosDivergentes).toEqual([]);
  });
});

describe('gerarPlanoSimulacao — pessoas', () => {
  it('usa o domínio reservado em todo e-mail, de avaliador e de staff', () => {
    // Act
    const plano = planoCom({ avaliadores: 5, staff: 3 });

    // Assert
    const sufixo = `@${DOMINIO_SIMULACAO}`;
    expect(plano.usuarios.every((u) => u.email.endsWith(sufixo))).toBe(true);
    expect(plano.staff.every((s) => s.email.endsWith(sufixo))).toBe(true);
  });

  it('gera e-mails únicos, porque usuarios.email é único global', () => {
    // Act
    const plano = planoCom({ avaliadores: 50, staff: 5 });
    const todos = [...plano.usuarios.map((u) => u.email), ...plano.staff.map((s) => s.email)];

    // Assert
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('carimba o e-mail com data e hora, para não colidir entre rodadas', () => {
    // Act
    const agora = planoCom();
    const depois = gerarPlanoSimulacao({
      parametros: PARAMETROS_PADRAO,
      gerarId: idsEmSequencia(),
      agora: new Date('2026-11-24T18:30:00Z'),
    });

    // Assert
    expect(agora.usuarios[0]?.email).not.toBe(depois.usuarios[0]?.email);
  });

  it('dá a cada avaliador uma instituição de origem e ao menos uma área', () => {
    // Act
    const plano = planoCom({ avaliadores: 20 });

    // Assert — a instituição é o que faz a regra de conflito de interesse existir
    expect(plano.avaliadores.every((a) => !!a.id_instituicao)).toBe(true);
    for (const avaliador of plano.avaliadores) {
      const areas = plano.avaliadorAreas.filter((a) => a.id_usuario === avaliador.id_usuario);
      expect(areas.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('dá semente própria a cada avaliador, para os ritmos não entrarem em lockstep', () => {
    // Act
    const plano = planoCom({ avaliadores: 20 });

    // Assert
    expect(new Set(plano.avaliadores.map((a) => a.semente)).size).toBe(20);
  });

  it('bloqueia modalidade para alguns, mas não para a maioria', () => {
    // Act
    const plano = planoCom({ avaliadores: 100 });

    // Assert — exercita a regra sem estrangular o sorteio
    expect(plano.modalidadesBloqueadas.length).toBeGreaterThan(0);
    expect(plano.modalidadesBloqueadas.length).toBeLessThan(50);
  });
});

describe('gerarPlanoSimulacao — questionários', () => {
  it('cria os técnicos pedidos mais um de voto popular', () => {
    // Act
    const plano = planoCom({ questionariosTecnicos: 3 });

    // Assert
    expect(plano.idsQuestionariosTecnicos).toHaveLength(3);
    expect(plano.questionarios).toHaveLength(4);
    expect(plano.questionarios.filter((q) => q.is_voto_popular)).toHaveLength(1);
  });

  it('dá perguntas a todo questionário, com pesos diferentes no técnico', () => {
    // Act
    const plano = planoCom({ questionariosTecnicos: 2 });

    // Assert — a nota final é média ponderada
    for (const questionario of plano.questionarios) {
      const suas = plano.perguntas.filter((p) => p.id_questionario === questionario.id_questionario);
      expect(suas.length).toBeGreaterThan(0);
      expect(suas.map((p) => p.ordem)).toEqual(suas.map((_, i) => i + 1));
    }
    const doTecnico = plano.perguntas.filter(
      (p) => p.id_questionario === plano.idsQuestionariosTecnicos[0],
    );
    expect(new Set(doTecnico.map((p) => p.peso_calculo)).size).toBeGreaterThan(1);
  });

  it('mantém todos os questionários na mesma escala', () => {
    // Act
    const plano = planoCom({ questionariosTecnicos: 3 });

    // Assert
    expect(plano.questionarios.every((q) => q.escala_minima === 0 && q.escala_maxima === 10)).toBe(true);
  });
});
