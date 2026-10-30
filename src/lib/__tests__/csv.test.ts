import { describe, it, expect } from 'vitest';
import { campoCsv } from '@/lib/csv';

describe('campoCsv', () => {
  it('deve pôr o campo entre aspas e duplicar aspas internas', () => {
    // Arrange / Act / Assert
    expect(campoCsv('Projeto "Sol"')).toBe('"Projeto ""Sol"""');
    expect(campoCsv(null)).toBe('""');
    expect(campoCsv(9.5)).toBe('"9.5"');
  });

  it('deve neutralizar texto que o Excel executaria como fórmula', () => {
    // Arrange / Act / Assert
    expect(campoCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(campoCsv('+55 67')).toBe('"\'+55 67"');
    expect(campoCsv('@soma')).toBe('"\'@soma"');
  });
});
