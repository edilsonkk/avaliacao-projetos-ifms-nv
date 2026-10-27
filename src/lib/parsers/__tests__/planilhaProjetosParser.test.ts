// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  parsePlanilhaProjetos,
  normalizarChave,
  formatarValorString,
  formatarBooleano,
} from '@/lib/parsers/planilhaProjetosParser';
import { gerarBufferPlanilha } from '@/lib/excel/excelUtils';

describe('Parser de Planilhas de Projetos (Função Pura / Ambiente Node)', () => {
  it('1. Deve realizar o parsing com sucesso de uma planilha Excel bem formatada', async () => {
    // Arrange (Preparar)
    const colunas = [
      'codigo_projeto',
      'titulo',
      'estande',
      'corredor',
      'instituicao',
      'sigla',
      'area_tematica',
      'modalidade',
      'fora_da_competicao',
    ];
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

    const buffer = await gerarBufferPlanilha('Projetos', colunas, dados);

    // Act (Agir)
    const resultado = await parsePlanilhaProjetos(buffer);

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

  it('2. Deve realizar parsing correto a partir de string CSV', async () => {
    // Arrange (Preparar)
    const csvContent = [
      'codigo;titulo;estande;corredor;instituicao;fora_da_competicao',
      'EXP-101;Dispositivo IoT de Umidade;E-10;Corredor 1;IFMS;Não',
    ].join('\n');

    // Act (Agir)
    const resultado = await parsePlanilhaProjetos(csvContent, true);

    // Assert (Verificar)
    expect(resultado.sucesso).toBe(true);
    expect(resultado.projetos).toHaveLength(1);
    expect(resultado.projetos[0].codigo_projeto).toBe('EXP-101');
    expect(resultado.projetos[0].titulo).toBe('Dispositivo IoT de Umidade');
  });

  it('3. Deve lançar exceção ao receber planilha vazia ou sem linhas', async () => {
    // Arrange (Preparar)
    const buffer = await gerarBufferPlanilha('Vazia', [], []);

    // Act & Assert (Agir e Verificar)
    await expect(parsePlanilhaProjetos(buffer)).rejects.toThrow(
      /A planilha selecionada está vazia/i
    );
  });

  it('4. Deve lançar exceção ao receber conteúdo ausente ou inválido', async () => {
    // Arrange (Preparar)
    const conteudoInvalido = '';

    // Act & Assert (Agir e Verificar)
    await expect(parsePlanilhaProjetos(conteudoInvalido)).rejects.toThrow(
      /Conteúdo do arquivo ausente ou inválido/i
    );
  });

  it('5. Deve rejeitar arquivos legados .xls com mensagem explicativa', async () => {
    const fakeXlsBuffer = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x01, 0x02]);
    await expect(parsePlanilhaProjetos(fakeXlsBuffer)).rejects.toThrow(
      /O formato legado \.xls \(Excel 97-2003\) não é suportado/i
    );
  });

  it('6. Deve converter corretamente tipos de dados (números, datas e booleanos)', () => {
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

  it('7. Deve normalizar chaves e remover diacríticos', () => {
    // Act & Assert (Agir e Verificar)
    expect(normalizarChave('  Código do Projeto  ')).toBe('codigo do projeto');
    expect(normalizarChave('Área Temática')).toBe('area tematica');
    expect(normalizarChave('Instituição')).toBe('instituicao');
  });
});
