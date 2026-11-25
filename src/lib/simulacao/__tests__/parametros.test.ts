// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  PARAMETROS_PADRAO,
  LIMITES_LOCAL,
  LIMITES_PRODUCAO,
  limitesDoAmbiente,
  validarParametros,
  type ParametrosSimulacao,
} from '@/lib/simulacao/parametros';

const com = (mudancas: Partial<ParametrosSimulacao>): ParametrosSimulacao => ({
  ...PARAMETROS_PADRAO,
  ...mudancas,
});

describe('limitesDoAmbiente', () => {
  it('dá limites mais apertados em produção que em local', () => {
    // Assert
    expect(LIMITES_PRODUCAO.projetos).toBeLessThan(LIMITES_LOCAL.projetos);
    expect(LIMITES_PRODUCAO.avaliadores).toBeLessThan(LIMITES_LOCAL.avaliadores);
    expect(LIMITES_PRODUCAO.concorrencia).toBeLessThan(LIMITES_LOCAL.concorrencia);
    expect(LIMITES_PRODUCAO.totalAvaliacoes).toBeLessThan(LIMITES_LOCAL.totalAvaliacoes);
  });

  it('trata ambiente desconhecido como produção, nunca como local', () => {
    // Assert — mesmo critério conservador de identificarAmbienteSupabase
    expect(limitesDoAmbiente(null)).toEqual(LIMITES_PRODUCAO);
    expect(limitesDoAmbiente('producao')).toEqual(LIMITES_PRODUCAO);
    expect(limitesDoAmbiente('local')).toEqual(LIMITES_LOCAL);
  });

  it('permite sessão por avaliador só em local', () => {
    // Assert — em produção a sessão anônima deixaria conta que o navegador não apaga
    expect(LIMITES_LOCAL.permiteSessaoPorAvaliador).toBe(true);
    expect(LIMITES_PRODUCAO.permiteSessaoPorAvaliador).toBe(false);
  });
});

describe('validarParametros', () => {
  it('aceita os padrões nos dois ambientes', () => {
    // Act
    const local = validarParametros(PARAMETROS_PADRAO, 'local');
    const producao = validarParametros(PARAMETROS_PADRAO, 'producao');

    // Assert
    expect(local.erros).toEqual([]);
    expect(producao.erros).toEqual([]);
  });

  it('recusa em produção um volume que local aceita', () => {
    // Arrange — 300 projetos com cota 3 são 900 avaliações
    const parametros = com({ projetos: 300, cota: 3, avaliadores: 20 });

    // Act
    const local = validarParametros(parametros, 'local');
    const producao = validarParametros(parametros, 'producao');

    // Assert
    expect(local.erros).toEqual([]);
    expect(producao.erros.join(' ')).toMatch(/900 avalia/);
  });

  it('informa o máximo do ambiente na mensagem de erro', () => {
    // Act
    const { erros } = validarParametros(com({ projetos: 5000 }), 'local');

    // Assert
    expect(erros.join(' ')).toContain(String(LIMITES_LOCAL.projetos));
  });

  it('recusa valores não inteiros e fora da faixa', () => {
    // Act
    const { erros } = validarParametros(
      com({ projetos: 1.5, avaliadores: 0, cota: 0, concorrencia: 0 }),
      'local',
    );

    // Assert
    expect(erros.length).toBeGreaterThanOrEqual(4);
    expect(erros.join(' ')).toMatch(/inteiro/i);
  });

  it('recusa porcentagem fora de 0 a 100', () => {
    // Act
    const { erros } = validarParametros(
      com({ porcentoVotoPopular: 120, porcentoCheckIn: -1 }),
      'local',
    );

    // Assert
    expect(erros.join(' ')).toMatch(/entre 0 e 100/);
  });

  it('aceita ritmo zero, que é o modo de medição', () => {
    // Act
    const { erros } = validarParametros(com({ ritmoMs: 0 }), 'local');

    // Assert
    expect(erros).toEqual([]);
  });

  it('recusa velocidade zero, que travaria o laço', () => {
    // Act
    const { erros } = validarParametros(com({ velocidade: 0 }), 'local');

    // Assert
    expect(erros.join(' ')).toMatch(/[Vv]elocidade/);
  });

  it('recusa sessão por avaliador em produção, com a razão na mensagem', () => {
    // Act
    const { erros } = validarParametros(com({ modoSessao: 'por-avaliador' }), 'producao');

    // Assert
    expect(erros.join(' ')).toMatch(/banco local/);
    expect(erros.join(' ')).toMatch(/chave de servi/i);
  });

  it('aceita sessão por avaliador em local', () => {
    // Act
    const { erros } = validarParametros(com({ modoSessao: 'por-avaliador' }), 'local');

    // Assert
    expect(erros).toEqual([]);
  });

  it('avisa, sem bloquear, quando a cota não fecha por falta de avaliadores', () => {
    // Arrange — um avaliador não avalia o mesmo projeto duas vezes
    const parametros = com({ avaliadores: 2, cota: 5, projetos: 10 });

    // Act
    const { erros, avisos } = validarParametros(parametros, 'local');

    // Assert
    expect(erros).toEqual([]);
    expect(avisos.join(' ')).toMatch(/nenhum projeto fecha a cota/i);
  });

  it('avisa quando o voto popular consome todos os avaliadores técnicos', () => {
    // Act
    const { erros, avisos } = validarParametros(com({ porcentoVotoPopular: 100 }), 'local');

    // Assert
    expect(erros).toEqual([]);
    expect(avisos.join(' ')).toMatch(/avaliador técnico/i);
  });

  it('avisa que sem check-in o telão não sai do zero', () => {
    // Act
    const { avisos } = validarParametros(com({ porcentoCheckIn: 0 }), 'local');

    // Assert
    expect(avisos.join(' ')).toMatch(/telão/i);
  });
});
