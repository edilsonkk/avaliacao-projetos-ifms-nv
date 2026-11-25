import { describe, it, expect } from 'vitest';
import {
  itensDaReferencia,
  separarTextoAjuda,
} from '@/lib/parsers/textoAjudaPergunta';

/** Texto literal de "1. Problema e Público-Alvo" no modelo Técnico · Nível 1 Ideia. */
const AJUDA_DO_MODELO =
  'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais';

describe('separarTextoAjuda', () => {
  it('deve separar a orientação das âncoras no texto dos modelos pré-cadastrados', () => {
    // Arrange / Act
    const { orientacao, referencia } = separarTextoAjuda(AJUDA_DO_MODELO);

    // Assert
    expect(orientacao).toBe('Relevância e delimitação do problema e de quem é afetado por ele.');
    expect(referencia).toBe(
      '1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais',
    );
  });

  it('deve devolver o texto inteiro como orientação quando não há marcador', () => {
    // Arrange / Act
    const { orientacao, referencia } = separarTextoAjuda('Clareza na formulação e nos objetivos.');

    // Assert
    expect(orientacao).toBe('Clareza na formulação e nos objetivos.');
    expect(referencia).toBe('');
  });

  it('deve cortar no primeiro marcador quando a palavra reaparece na referência', () => {
    // Arrange
    const texto = 'Mede o rigor. Referência — 1: sem referência bibliográfica · 5: referências completas';

    // Act
    const { orientacao, referencia } = separarTextoAjuda(texto);

    // Assert
    expect(orientacao).toBe('Mede o rigor.');
    expect(referencia).toBe('1: sem referência bibliográfica · 5: referências completas');
  });

  it('deve aparar espaços sobrando nas duas partes', () => {
    // Arrange / Act
    const { orientacao, referencia } = separarTextoAjuda('   Mede o rigor.   Referência — 1: pouco   ');

    // Assert
    expect(orientacao).toBe('Mede o rigor.');
    expect(referencia).toBe('1: pouco');
  });

  it('deve tratar texto vazio, nulo e indefinido sem quebrar', () => {
    // Arrange / Act / Assert
    expect(separarTextoAjuda('')).toEqual({ orientacao: '', referencia: '' });
    expect(separarTextoAjuda(null)).toEqual({ orientacao: '', referencia: '' });
    expect(separarTextoAjuda(undefined)).toEqual({ orientacao: '', referencia: '' });
  });
});

describe('itensDaReferencia', () => {
  it('deve quebrar a referência em uma âncora por item', () => {
    // Arrange / Act
    const itens = itensDaReferencia('1: Problema vago · 3: Problema claro · 5: Problema relevante');

    // Assert
    expect(itens).toEqual(['1: Problema vago', '3: Problema claro', '5: Problema relevante']);
  });

  it('deve devolver um único item quando não há separador', () => {
    // Arrange / Act / Assert
    expect(itensDaReferencia('1: nota mínima')).toEqual(['1: nota mínima']);
  });

  it('deve descartar itens vazios e tratar ausência de referência', () => {
    // Arrange / Act / Assert
    expect(itensDaReferencia('1: pouco ·  · 5: muito')).toEqual(['1: pouco', '5: muito']);
    expect(itensDaReferencia('')).toEqual([]);
    expect(itensDaReferencia(null)).toEqual([]);
  });
});
