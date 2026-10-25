// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parsePlanilhaProjetos,
  normalizarChave,
  formatarValorString,
  formatarBooleano,
} from '@/lib/parsers/planilhaProjetosParser';

describe('Parser de Planilhas de Projetos (Função Pura / Ambiente Node)', () => {
  it('1. Deve realizar o parsing com sucesso de uma planilha Excel bem formatada', () => {
    // Arrange (Preparar)
    const dados = [
      {
        codigo_projeto: 'AGRO-001',
        titulo: 'Automação Sustentável em Hidroponia',
        estande: 'EST-A01',
        corredor: 'Ala Norte',
        instituicao: 'IFMS Campus Campo Grande',
        sigla: 'IFMS-CG',
        area_tematica: 'Ciências Agrárias',
        modalidade: 'Ensino Médio',
        fora_da_competicao: 'Não',
      },
      {
        codigo_projeto: 'ROBOT-002',
        titulo: 'Braço Robótico de Baixo Custo',
        estande: 'EST-B02',
        corredor: 'Ala Sul',
        instituicao: 'Escola Técnica Estadual',
        sigla: 'ETE',
        area_tematica: 'Engenharias',
        modalidade: 'Ensino Técnico',
        fora_da_competicao: 'Sim',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Projetos');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    // Act (Agir)
    const resultado = parsePlanilhaProjetos(buffer);

    // Assert (Verificar)
    expect(resultado.sucesso).toBe(true);
    expect(resultado.projetos).toHaveLength(2);
    expect(resultado.projetos[0].codigo_projeto).toBe('AGRO-001');
    expect(resultado.projetos[0].titulo).toBe('Automação Sustentável em Hidroponia');
    expect(resultado.projetos[0].instituicao).toBe('IFMS Campus Campo Grande');
    expect(resultado.projetos[0].sigla_instituicao).toBe('IFMS-CG');
    expect(resultado.projetos[0].area_tematica).toBe('Ciências Agrárias');
    expect(resultado.projetos[0].modalidade).toBe('Ensino Médio');
    expect(resultado.projetos[0].fora_da_competicao).toBe(false);

    expect(resultado.projetos[1].codigo_projeto).toBe('ROBOT-002');
    expect(resultado.projetos[1].fora_da_competicao).toBe(true);
  });

  it('2. Deve realizar parsing correto a partir de string CSV', () => {
    // Arrange (Preparar)
    const csvContent = [
      'codigo;titulo;estande;corredor;instituicao;fora_da_competicao',
      'EXP-101;Dispositivo IoT de Umidade;E-10;Corredor 1;IFMS;Não',
    ].join('\n');

    // Act (Agir)
    const resultado = parsePlanilhaProjetos(csvContent, true);

    // Assert (Verificar)
    expect(resultado.sucesso).toBe(true);
    expect(resultado.projetos).toHaveLength(1);
    expect(resultado.projetos[0].codigo_projeto).toBe('EXP-101');
    expect(resultado.projetos[0].titulo).toBe('Dispositivo IoT de Umidade');
  });

  it('3. Deve lançar exceção ao receber planilha vazia ou sem linhas', () => {
    // Arrange (Preparar)
    const ws = XLSX.utils.aoa_to_sheet([]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vazia');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    // Act & Assert (Agir e Verificar)
    expect(() => parsePlanilhaProjetos(buffer)).toThrow(
      /A planilha selecionada está vazia/i
    );
  });

  it('4. Deve lançar exceção ao receber conteúdo ausente ou inválido', () => {
    // Arrange (Preparar)
    const conteudoInvalido = '';

    // Act & Assert (Agir e Verificar)
    expect(() => parsePlanilhaProjetos(conteudoInvalido)).toThrow(
      /Conteúdo do arquivo ausente ou inválido/i
    );
  });

  it('5. Deve converter corretamente tipos de dados (números, datas e booleanos)', () => {
    // Arrange (Preparar)
    const dataObj = new Date('2026-10-24T12:00:00Z');

    // Act & Assert (Agir e Verificar)
    expect(formatarValorString(12345)).toBe('12345');
    expect(formatarValorString(dataObj)).toBe('2026-10-24');
    expect(formatarValorString(null)).toBe('');
    expect(formatarValorString(undefined)).toBe('');

    expect(formatarBooleano('Sim')).toBe(true);
    expect(formatarBooleano('sim')).toBe(true);
    expect(formatarBooleano('1')).toBe(true);
    expect(formatarBooleano(1)).toBe(true);
    expect(formatarBooleano(true)).toBe(true);
    expect(formatarBooleano('Não')).toBe(false);
    expect(formatarBooleano('nao')).toBe(false);
    expect(formatarBooleano('0')).toBe(false);
    expect(formatarBooleano(false)).toBe(false);
    expect(formatarBooleano(null)).toBe(false);
  });

  it('6. Deve normalizar chaves e remover diacríticos', () => {
    // Act & Assert (Agir e Verificar)
    expect(normalizarChave('  Código do Projeto  ')).toBe('codigo do projeto');
    expect(normalizarChave('Área Temática')).toBe('area tematica');
    expect(normalizarChave('Instituição')).toBe('instituicao');
  });
});
