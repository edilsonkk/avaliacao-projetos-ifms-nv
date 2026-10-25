import { describe, it, expect } from 'vitest';
import {
  normalizarAreaTematica,
  simplificarTexto,
  sanitizarMaiusculoSemAcentos,
  GRANDES_AREAS_CNPQ,
} from '../lib/parsers/areasTematicasNormalizer';

describe('Normalizador de Áreas Temáticas (CNPq + Sanitização Maiúsculo)', () => {
  it('1. Deve mapear variações de Ciências Agrárias com acento oficial em MAIÚSCULO', () => {
    expect(normalizarAreaTematica('ciencias agrarias')).toBe('CIÊNCIAS AGRÁRIAS');
    expect(normalizarAreaTematica('CIÊNCIAS AGRÁRIAS')).toBe('CIÊNCIAS AGRÁRIAS');
    expect(normalizarAreaTematica('Agrárias')).toBe('CIÊNCIAS AGRÁRIAS');
    expect(normalizarAreaTematica('  agronomia  ')).toBe('CIÊNCIAS AGRÁRIAS');
    expect(normalizarAreaTematica('agropecuaria')).toBe('CIÊNCIAS AGRÁRIAS');
  });

  it('2. Deve mapear Ciências Exatas e da Terra', () => {
    expect(normalizarAreaTematica('Exatas')).toBe('CIÊNCIAS EXATAS E DA TERRA');
    expect(normalizarAreaTematica('ciencias exatas')).toBe('CIÊNCIAS EXATAS E DA TERRA');
    expect(normalizarAreaTematica('Matemática')).toBe('CIÊNCIAS EXATAS E DA TERRA');
    expect(normalizarAreaTematica('Ciência da Computação')).toBe('CIÊNCIAS EXATAS E DA TERRA');
  });

  it('3. Deve mapear Engenharias', () => {
    expect(normalizarAreaTematica('Engenharia')).toBe('ENGENHARIAS');
    expect(normalizarAreaTematica('Robótica')).toBe('ENGENHARIAS');
    expect(normalizarAreaTematica('Engenharias')).toBe('ENGENHARIAS');
  });

  it('4. Deve mapear Ciências da Saúde, Biológicas e Humanas', () => {
    expect(normalizarAreaTematica('Saúde')).toBe('CIÊNCIAS DA SAÚDE');
    expect(normalizarAreaTematica('Medicina')).toBe('CIÊNCIAS DA SAÚDE');
    expect(normalizarAreaTematica('Biologia')).toBe('CIÊNCIAS BIOLÓGICAS');
    expect(normalizarAreaTematica('História')).toBe('CIÊNCIAS HUMANAS');
    expect(normalizarAreaTematica('Sociologia')).toBe('CIÊNCIAS HUMANAS');
  });

  it('5. Fallback para áreas não mapeadas no CNPq: remove acentos, til, espaços extras e fica em MAIÚSCULO', () => {
    expect(normalizarAreaTematica('  Inovação   &   Empreendedorismo Tecnológico  ')).toBe('INOVACAO & EMPREENDEDORISMO TECNOLOGICO');
    expect(normalizarAreaTematica('Educação Especial e Inclusão')).toBe('CIÊNCIAS HUMANAS'); // mapeia educacao
    expect(normalizarAreaTematica('Sustentabilidade e Clima Global')).toBe('SUSTENTABILIDADE E CLIMA GLOBAL');
    expect(normalizarAreaTematica('Desenvolvimento de Software Moderno')).toBe('DESENVOLVIMENTO DE SOFTWARE MODERNO');
  });

  it('6. Lida com valores nulos, vazios ou indefinidos', () => {
    expect(normalizarAreaTematica(null)).toBe('MULTIDISCIPLINAR');
    expect(normalizarAreaTematica('')).toBe('MULTIDISCIPLINAR');
    expect(normalizarAreaTematica('   ')).toBe('MULTIDISCIPLINAR');
  });
});
