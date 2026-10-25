// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  sanitizarTexto,
  calcularSimilaridade,
  buscarMelhorCorrespondencia,
  CandidatoMatch,
} from '../lib/parsers/fuzzyMatcher';

describe('TDD: Utilitário de Sanitização e Fuzzy Matching', () => {
  describe('sanitizarTexto', () => {
    it('deve remover espaços extras, pontuações, acentos e converter para maiúsculas', () => {
      const entrada = '   I.F.M.S. - Campus Campo Grande, MS!  ';
      const esperado = 'IFMS CAMPUS CAMPO GRANDE MS';
      expect(sanitizarTexto(entrada)).toBe(esperado);
    });

    it('deve remover acentuação e caracteres diacríticos', () => {
      const entrada = 'Ensino Técnico & Médio - Biológicas e Saúde';
      const esperado = 'ENSINO TECNICO MEDIO BIOLOGICAS E SAUDE';
      expect(sanitizarTexto(entrada)).toBe(esperado);
    });

    it('deve tratar entradas nulas ou vazias sem lançar exceções', () => {
      expect(sanitizarTexto('')).toBe('');
      expect(sanitizarTexto(null)).toBe('');
      expect(sanitizarTexto(undefined)).toBe('');
    });
  });

  describe('calcularSimilaridade', () => {
    it('deve retornar 1.0 para strings idênticas após sanitização', () => {
      expect(calcularSimilaridade('IFMS - CG', 'ifms - cg')).toBe(1.0);
      expect(calcularSimilaridade('IFMS... CG!', 'IFMS CG')).toBe(1.0);
    });

    it('deve reconhecer alta similaridade mesmo com inversão de palavras (Token Sort)', () => {
      const score = calcularSimilaridade('Campus Campo Grande IFMS', 'IFMS Campus Campo Grande');
      expect(score).toBe(1.0);
    });

    it('deve retornar score ponderado para pequenas variações de grafia', () => {
      const score = calcularSimilaridade('Universidade Federal MS', 'Universidade Federal de MS');
      expect(score).toBeGreaterThan(0.85);
    });
  });

  describe('buscarMelhorCorrespondencia com threshold de 85%', () => {
    const candidatos: CandidatoMatch[] = [
      {
        id: 'inst-1',
        nome: 'IFMS Campus Campo Grande',
        sigla: 'IFMS-CG',
        aliases: ['INSTITUTO FEDERAL DE MS CG', 'IFMS/CG'],
      },
      {
        id: 'inst-2',
        nome: 'Universidade Federal de Mato Grosso do Sul',
        sigla: 'UFMS',
        aliases: ['UNIV FEDERAL MS'],
      },
      {
        id: 'mod-1',
        nome: 'Ensino Médio e Técnico',
        aliases: ['MEDIO/TECNICO', 'ENSINO TECNICO E MEDIO'],
      },
    ];

    it('deve encontrar match exato via sigla', () => {
      const res = buscarMelhorCorrespondencia('UFMS', candidatos, 0.85);
      expect(res.matchTipo).toBe('exato');
      expect(res.score).toBe(1.0);
      expect(res.candidato?.id).toBe('inst-2');
      expect(res.confiancaPercentual).toBe(100);
    });

    it('deve encontrar match exato via alias catalogado', () => {
      const res = buscarMelhorCorrespondencia('IFMS/CG', candidatos, 0.85);
      expect(res.matchTipo).toBe('exato');
      expect(res.score).toBe(1.0);
      expect(res.candidato?.id).toBe('inst-1');
      expect(res.confiancaPercentual).toBe(100);
    });

    it('deve encontrar match fuzzy quando similaridade for >= 85%', () => {
      // "IFMS Campus de Campo Grande" vs "IFMS Campus Campo Grande"
      const res = buscarMelhorCorrespondencia('IFMS Campus de Campo Grande', candidatos, 0.85);
      expect(res.matchTipo).toBe('fuzzy');
      expect(res.score).toBeGreaterThanOrEqual(0.85);
      expect(res.candidato?.id).toBe('inst-1');
    });

    it('deve classificar como "novo" quando similaridade for < 85%', () => {
      // Instituição totalmente diferente
      const res = buscarMelhorCorrespondencia('Escola Estadual Joaquim Murtinho', candidatos, 0.85);
      expect(res.matchTipo).toBe('novo');
      expect(res.candidato).toBeNull();
      expect(res.score).toBeLessThan(0.85);
    });
  });
});
