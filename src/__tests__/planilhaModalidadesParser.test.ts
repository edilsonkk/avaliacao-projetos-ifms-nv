// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parsePlanilhaModalidades } from '../lib/parsers/planilhaModalidadesParser';

describe('TDD: Parser Puro de Planilha de Modalidades e Níveis', () => {
  it('deve realizar o parsing com sucesso de planilha Excel bem formatada', () => {
    const dados = [
      {
        'Código': 'MOD-EM',
        'Modalidade': 'Ensino Médio e Técnico',
        'Nível': 'Médio',
        'Área Temática': 'Ciências Exatas',
        'Descrição': 'Projetos de estudantes do ensino médio regular ou técnico',
      },
      {
        'Código': 'MOD-EF',
        'Modalidade': 'Ensino Fundamental II',
        'Nível': 'Fundamental',
        'Área Temática': 'Multidisciplinar',
        'Descrição': 'Estudantes do 6º ao 9º ano',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Modalidades');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const resultado = parsePlanilhaModalidades(buffer);

    expect(resultado.sucesso).toBe(true);
    expect(resultado.modalidades.length).toBe(2);
    expect(resultado.modalidades[0].nome_modalidade).toBe('Ensino Médio e Técnico');
    expect(resultado.modalidades[0].codigo).toBe('MOD-EM');
    expect(resultado.modalidades[0].nivel).toBe('Médio');
    expect(resultado.modalidades[0].area_tematica).toBe('Ciências Exatas');
    expect(resultado.modalidades[1].codigo).toBe('MOD-EF');
  });

  it('deve aceitar cabeçalhos com variações (sem acentos / caixa mista)', () => {
    const dados = [
      {
        'codigo': 'MOD-SUP',
        'nome': 'Ensino Superior / Graduação',
        'nivel': 'Superior',
        'area': 'Engenharias',
        'observacao': 'Projetos acadêmicos',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Modalidades');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const resultado = parsePlanilhaModalidades(buffer);

    expect(resultado.sucesso).toBe(true);
    expect(resultado.modalidades[0].nome_modalidade).toBe('Ensino Superior / Graduação');
    expect(resultado.modalidades[0].nivel).toBe('Superior');
    expect(resultado.modalidades[0].area_tematica).toBe('Engenharias');
    expect(resultado.modalidades[0].descricao).toBe('Projetos acadêmicos');
  });

  it('deve realizar parsing de arquivo CSV', () => {
    const csvContent =
      'Código,Modalidade,Nível,Área Temática,Descrição\n' +
      'M1,Robótica Educacional,Médio,Tecnologia,Projetos de automação';

    const resultado = parsePlanilhaModalidades(csvContent, true);

    expect(resultado.sucesso).toBe(true);
    expect(resultado.modalidades.length).toBe(1);
    expect(resultado.modalidades[0].codigo).toBe('M1');
    expect(resultado.modalidades[0].nome_modalidade).toBe('Robótica Educacional');
  });

  it('deve retornar erro para planilhas sem linhas válidas', () => {
    const dadosVazio: any[] = [];
    const ws = XLSX.utils.json_to_sheet(dadosVazio);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vazia');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const resultado = parsePlanilhaModalidades(buffer);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.modalidades.length).toBe(0);
    expect(resultado.erros.length).toBeGreaterThan(0);
  });

  it('deve sinalizar linha com nome de modalidade ausente', () => {
    const dados = [
      {
        'Código': 'MOD-SEM-NOME',
        'Modalidade': '',
        'Nível': 'Técnico',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Modalidades');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const resultado = parsePlanilhaModalidades(buffer);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erros.some((e) => e.mensagem.includes('Nome da Modalidade é obrigatório'))).toBe(true);
  });

  it('deve tratar buffers inválidos ou corrompidos sem crashar', () => {
    const bufferInvalido = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const resultado = parsePlanilhaModalidades(bufferInvalido);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erros.length).toBeGreaterThan(0);
  });
});
