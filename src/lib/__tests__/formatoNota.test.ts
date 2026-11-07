// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  formatarNota,
  formatarMedia,
  formatarPontos,
  formatarPeso,
  formatarNotaPrecisa,
  notaPerdeuPrecisao,
  formatarAjuste,
} from '@/lib/formatoNota';

describe('formatarNota', () => {
  it('deve usar vírgula decimal e sempre duas casas', () => {
    // Arrange / Act / Assert
    expect(formatarNota(8.75)).toBe('8,75');
    expect(formatarNota(4)).toBe('4,00');
    expect(formatarNota('3.5')).toBe('3,50');
    expect(formatarMedia(10)).toBe('10,00');
  });

  it('deve mostrar travessão para valor ausente, nunca zero', () => {
    // Arrange / Act / Assert
    expect(formatarNota(null)).toBe('—');
    expect(formatarNota(undefined)).toBe('—');
    expect(formatarNota('')).toBe('—');
    expect(formatarNota('abc')).toBe('—');
  });

  it('deve acrescentar a unidade quando o texto é lido solto', () => {
    // Arrange / Act / Assert
    expect(formatarPontos(8.75)).toBe('8,75 pts');
    expect(formatarPontos(null)).toBe('—');
  });
});

describe('formatarPeso', () => {
  it('deve omitir casas decimais desnecessárias', () => {
    // Arrange / Act / Assert
    expect(formatarPeso(2)).toBe('2');
    expect(formatarPeso('1.00')).toBe('1');
    expect(formatarPeso(1.5)).toBe('1,5');
    expect(formatarPeso(null)).toBe('—');
  });
});

describe('formatarNotaPrecisa', () => {
  it('deve mostrar o valor sem arredondar, até quatro casas', () => {
    // Arrange / Act / Assert
    expect(formatarNotaPrecisa(10 / 3)).toBe('3,3333');
    expect(formatarNotaPrecisa(4)).toBe('4');
  });

  it('deve dizer quando o arredondamento para duas casas muda o valor', () => {
    // Arrange / Act / Assert
    expect(notaPerdeuPrecisao(10 / 3)).toBe(true);
    expect(notaPerdeuPrecisao(4)).toBe(false);
    expect(notaPerdeuPrecisao(4.25)).toBe(false);
    expect(notaPerdeuPrecisao(null)).toBe(false);
  });
});

describe('formatarAjuste', () => {
  it('deve deixar o sinal do ajuste explícito', () => {
    // Arrange / Act / Assert
    expect(formatarAjuste(1.5)).toBe('+1,50');
    expect(formatarAjuste(-0.5)).toBe('−0,50');
    expect(formatarAjuste(0)).toBe('0,00');
    expect(formatarAjuste(null)).toBe('—');
  });
});
