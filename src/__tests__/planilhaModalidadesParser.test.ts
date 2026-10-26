// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parsePlanilhaModalidades } from '../lib/parsers/planilhaModalidadesParser';
import { gerarBufferPlanilha } from '../lib/excelUtils';

describe('TDD: Parser Puro de Planilha de Modalidades e Níveis', () => {
  it('deve realizar o parsing com sucesso de planilha Excel bem formatada', async () => {
    const colunas = ['Código', 'Modalidade', 'Nível', 'Área Temática', 'Descrição'];
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

    const buffer = await gerarBufferPlanilha('Modalidades', colunas, dados);
    const resultado = await parsePlanilhaModalidades(buffer);

    expect(resultado.sucesso).toBe(true);
    expect(resultado.modalidades.length).toBe(2);
    expect(resultado.modalidades[0].nome_modalidade).toBe('Ensino Médio e Técnico');
    expect(resultado.modalidades[0].codigo).toBe('MOD-EM');
    expect(resultado.modalidades[0].nivel).toBe('Médio');
    expect(resultado.modalidades[0].area_tematica).toBe('Ciências Exatas');
    expect(resultado.modalidades[1].codigo).toBe('MOD-EF');
  });

  it('deve aceitar cabeçalhos com variações (sem acentos / caixa mista)', async () => {
    const colunas = ['codigo', 'nome', 'nivel', 'area', 'observacao'];
    const dados = [
      {
        'codigo': 'MOD-SUP',
        'nome': 'Ensino Superior / Graduação',
        'nivel': 'Superior',
        'area': 'Engenharias',
        'observacao': 'Projetos acadêmicos',
      },
    ];

    const buffer = await gerarBufferPlanilha('Modalidades', colunas, dados);
    const resultado = await parsePlanilhaModalidades(buffer);

    expect(resultado.sucesso).toBe(true);
    expect(resultado.modalidades[0].nome_modalidade).toBe('Ensino Superior / Graduação');
    expect(resultado.modalidades[0].nivel).toBe('Superior');
    expect(resultado.modalidades[0].area_tematica).toBe('Engenharias');
    expect(resultado.modalidades[0].descricao).toBe('Projetos acadêmicos');
  });

  it('deve realizar parsing de arquivo CSV', async () => {
    const csvContent =
      'Código,Modalidade,Nível,Área Temática,Descrição\n' +
      'M1,Robótica Educacional,Médio,Tecnologia,Projetos de automação';

    const resultado = await parsePlanilhaModalidades(csvContent, true);

    expect(resultado.sucesso).toBe(true);
    expect(resultado.modalidades.length).toBe(1);
    expect(resultado.modalidades[0].codigo).toBe('M1');
    expect(resultado.modalidades[0].nome_modalidade).toBe('Robótica Educacional');
  });

  it('deve retornar erro para planilhas sem linhas válidas', async () => {
    const buffer = await gerarBufferPlanilha('Vazia', [], []);
    const resultado = await parsePlanilhaModalidades(buffer);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.modalidades.length).toBe(0);
    expect(resultado.erros.length).toBeGreaterThan(0);
  });

  it('deve sinalizar linha com nome de modalidade ausente', async () => {
    const colunas = ['Código', 'Modalidade', 'Nível'];
    const dados = [
      {
        'Código': 'MOD-SEM-NOME',
        'Modalidade': '',
        'Nível': 'Técnico',
      },
    ];

    const buffer = await gerarBufferPlanilha('Modalidades', colunas, dados);
    const resultado = await parsePlanilhaModalidades(buffer);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erros.some((e) => e.mensagem.includes('Nome da Modalidade é obrigatório'))).toBe(true);
  });

  it('deve rejeitar arquivo legado .xls com mensagem explicativa', async () => {
    const fakeXlsBuffer = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
    const resultado = await parsePlanilhaModalidades(fakeXlsBuffer);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erros.some((e) => e.mensagem.includes('.xls') && e.mensagem.includes('.xlsx'))).toBe(true);
  });

  it('deve tratar buffers inválidos ou corrompidos sem crashar', async () => {
    const bufferInvalido = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const resultado = await parsePlanilhaModalidades(bufferInvalido);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erros.length).toBeGreaterThan(0);
  });
});
