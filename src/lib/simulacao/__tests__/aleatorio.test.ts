// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  criarSorteio,
  umDe,
  inteiroEntre,
  comJitter,
  notaSorteada,
} from '@/lib/simulacao/aleatorio';

describe('criarSorteio', () => {
  it('reproduz a mesma sequência para a mesma semente', () => {
    // Arrange
    const primeiro = criarSorteio(12345);
    const segundo = criarSorteio(12345);

    // Act
    const sequenciaA = Array.from({ length: 20 }, () => primeiro());
    const sequenciaB = Array.from({ length: 20 }, () => segundo());

    // Assert — é o que permite reproduzir uma rodada problemática
    expect(sequenciaA).toEqual(sequenciaB);
  });

  it('gera sequências diferentes para sementes diferentes', () => {
    // Arrange / Act
    const a = Array.from({ length: 20 }, criarSorteio(1));
    const b = Array.from({ length: 20 }, criarSorteio(2));

    // Assert
    expect(a).not.toEqual(b);
  });

  it('devolve sempre um número em [0, 1)', () => {
    // Arrange
    const sorteio = criarSorteio(99);

    // Act
    const valores = Array.from({ length: 500 }, () => sorteio());

    // Assert
    expect(valores.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('umDe', () => {
  it('escolhe sempre um item da lista', () => {
    // Arrange
    const sorteio = criarSorteio(7);
    const lista = ['a', 'b', 'c'];

    // Act
    const escolhidos = Array.from({ length: 100 }, () => umDe(sorteio, lista));

    // Assert
    expect(escolhidos.every((item) => lista.includes(item))).toBe(true);
  });

  it('recusa lista vazia, que é erro de programação', () => {
    // Arrange / Act / Assert
    expect(() => umDe(criarSorteio(1), [])).toThrow(/lista vazia/i);
  });
});

describe('inteiroEntre', () => {
  it('respeita os dois extremos, incluídos', () => {
    // Arrange
    const sorteio = criarSorteio(42);

    // Act
    const valores = Array.from({ length: 500 }, () => inteiroEntre(sorteio, 3, 6));

    // Assert
    expect(valores.every((v) => v >= 3 && v <= 6 && Number.isInteger(v))).toBe(true);
    expect(new Set(valores)).toEqual(new Set([3, 4, 5, 6]));
  });
});

describe('comJitter', () => {
  it('mantém a espera entre 0,5x e 1,5x da base', () => {
    // Arrange
    const sorteio = criarSorteio(2026);

    // Act
    const esperas = Array.from({ length: 500 }, () => comJitter(sorteio, 1000));

    // Assert — sem a variação os atores entrariam em lockstep
    expect(esperas.every((ms) => ms >= 500 && ms <= 1500)).toBe(true);
    expect(new Set(esperas).size).toBeGreaterThan(50);
  });

  it('devolve zero quando a base é zero, sem pausa nenhuma', () => {
    // Arrange / Act / Assert
    expect(comJitter(criarSorteio(1), 0)).toBe(0);
  });
});

describe('notaSorteada', () => {
  it('fica dentro da escala do questionário lido, não de uma escala fixa', () => {
    // Arrange
    const sorteio = criarSorteio(5);

    // Act — escala 1 a 5, que não é a escala 0 a 10 do caso comum
    const notas = Array.from({ length: 300 }, () => notaSorteada(sorteio, 1, 5, 1));

    // Assert
    expect(notas.every((n) => n >= 1 && n <= 5)).toBe(true);
  });

  it('com dispersão zero, concentra as notas no centro da escala', () => {
    // Arrange
    const sorteio = criarSorteio(11);

    // Act
    const notas = Array.from({ length: 50 }, () => notaSorteada(sorteio, 0, 10, 0));

    // Assert
    expect(new Set(notas)).toEqual(new Set([5]));
  });

  it('separa as tendências o bastante para a quarentena do banco reagir', () => {
    // Arrange — a regra do banco é diferença maior que 2,5 entre as notas do projeto
    const sorteio = criarSorteio(777);

    // Act
    const altas = Array.from({ length: 100 }, () => notaSorteada(sorteio, 0, 10, 1, 'alta'));
    const baixas = Array.from({ length: 100 }, () => notaSorteada(sorteio, 0, 10, 1, 'baixa'));

    // Assert
    const menorAlta = Math.min(...altas);
    const maiorBaixa = Math.max(...baixas);
    expect(menorAlta - maiorBaixa).toBeGreaterThan(2.5);
  });

  it('devolve o mínimo quando a escala não tem amplitude', () => {
    // Arrange / Act / Assert
    expect(notaSorteada(criarSorteio(1), 7, 7, 1)).toBe(7);
  });
});
