// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  parsePlanilhaAvaliadores,
  extrairModalidadesBloqueadas,
  extrairAreas,
} from '@/lib/parsers/planilhaAvaliadoresParser';
import { gerarBufferPlanilha } from '@/lib/excel/excelUtils';

describe('Suíte de Testes Unitários: Parser Puro de Planilha de Avaliadores', () => {
  it('1. SUCESSO: realiza parsing de planilha Excel (.xlsx) com Instituição e Modalidades Bloqueadas', async () => {
    // Arrange (Preparar)
    const colunas = ['Nome', 'E-mail', 'Instituição', 'Modalidades Bloqueadas'];
    const dadosMock = [
      {
        Nome: 'Prof. Carlos Santos',
        'E-mail': 'carlos.santos@ifms.edu.br',
        'Instituição': 'IFMS - Campus Campo Grande',
        'Modalidades Bloqueadas': 'Ensino Médio, Nível Fundamental',
      },
      {
        Nome: 'Dra. Mariana Lima',
        'E-mail': 'mariana.lima@ufms.br',
        'Instituição': 'Universidade Federal de MS',
        'Modalidades Bloqueadas': 'Ensino Técnico; Superior',
      },
      {
        Nome: 'João Avaliador',
        'E-mail': 'joao.avaliador@gmail.com',
        'Instituição': '',
        'Modalidades Bloqueadas': '',
      },
    ];

    const buffer = await gerarBufferPlanilha('Avaliadores', colunas, dadosMock);

    // Act (Agir)
    const resultado = await parsePlanilhaAvaliadores(buffer, false);

    // Assert (Verificar)
    expect(resultado.sucesso).toBe(true);
    expect(resultado.avaliadores).toHaveLength(3);

    // Avaliador 1
    expect(resultado.avaliadores[0].nome).toBe('Prof. Carlos Santos');
    expect(resultado.avaliadores[0].email).toBe('carlos.santos@ifms.edu.br');
    expect(resultado.avaliadores[0].instituicao).toBe('IFMS - Campus Campo Grande');
    expect(resultado.avaliadores[0].modalidades_bloqueadas).toEqual([
      'Ensino Médio',
      'Nível Fundamental',
    ]);

    // Avaliador 2
    expect(resultado.avaliadores[1].nome).toBe('Dra. Mariana Lima');
    expect(resultado.avaliadores[1].email).toBe('mariana.lima@ufms.br');
    expect(resultado.avaliadores[1].modalidades_bloqueadas).toEqual(['Ensino Técnico', 'Superior']);

    // Avaliador 3 (sem bloqueios)
    expect(resultado.avaliadores[2].modalidades_bloqueadas).toEqual([]);
  });

  it('2. SUCESSO CSV: realiza parsing de arquivo texto CSV com separador de modalidades', async () => {
    // Arrange
    const csvContent =
      'Nome,Email,Instituicao,Bloqueio Modalidade\n' +
      'Ana Costa,ana.costa@ifms.edu.br,IFMS,Ensino Médio\n' +
      'Bruno Dias,bruno.dias@usp.br,USP,"Ensino Médio, Nível Fundamental"\n';

    // Act
    const resultado = await parsePlanilhaAvaliadores(csvContent, true);

    // Assert
    expect(resultado.sucesso).toBe(true);
    expect(resultado.avaliadores).toHaveLength(2);
    expect(resultado.avaliadores[0].email).toBe('ana.costa@ifms.edu.br');
    expect(resultado.avaliadores[0].modalidades_bloqueadas).toEqual(['Ensino Médio']);
    expect(resultado.avaliadores[1].modalidades_bloqueadas).toEqual([
      'Ensino Médio',
      'Nível Fundamental',
    ]);
  });

  it('3. TRATAMENTO DE EXCEÇÃO: lança erro descritivo para arquivo vazio ou sem linhas', async () => {
    // Arrange
    const bufferVazio = await gerarBufferPlanilha('Avaliadores', [], []);

    // Act & Assert
    await expect(parsePlanilhaAvaliadores(bufferVazio, false)).rejects.toThrowError(
      /A planilha selecionada está vazia ou não contém linhas de dados/i
    );

    await expect(parsePlanilhaAvaliadores('', false)).rejects.toThrowError(
      /Conteúdo do arquivo ausente ou inválido/i
    );
  });

  it('4. RESILIÊNCIA: ignora linhas com e-mails inválidos e registra no array de erros', async () => {
    // Arrange
    const colunas = ['Nome', 'E-mail', 'Instituição'];
    const dadosComErro = [
      { Nome: 'Avaliador Sem Email', 'E-mail': '', 'Instituição': 'IFMS' },
      { Nome: 'Avaliador Email Invalido', 'E-mail': 'email-sem-arroba', 'Instituição': 'IFMS' },
      { Nome: 'Avaliador Válido', 'E-mail': 'valido@ifms.edu.br', 'Instituição': 'IFMS' },
    ];

    const buffer = await gerarBufferPlanilha('Avaliadores', colunas, dadosComErro);

    // Act
    const resultado = await parsePlanilhaAvaliadores(buffer, false);

    // Assert
    expect(resultado.sucesso).toBe(true);
    expect(resultado.avaliadores).toHaveLength(1);
    expect(resultado.avaliadores[0].email).toBe('valido@ifms.edu.br');
    expect(resultado.erros).toHaveLength(2);
    expect(resultado.erros[0].linha).toBe(2);
    expect(resultado.erros[1].linha).toBe(3);
  });

  it('5. FUNÇÃO PURA: extrairModalidadesBloqueadas lida com vírgula, ponto-e-vírgula e espaços em branco', () => {
    // Act & Assert
    expect(extrairModalidadesBloqueadas('Ensino Médio, Técnico ; Superior , ')).toEqual([
      'Ensino Médio',
      'Técnico',
      'Superior',
    ]);
    expect(extrairModalidadesBloqueadas('')).toEqual([]);
    expect(extrairModalidadesBloqueadas(null)).toEqual([]);
    expect(extrairModalidadesBloqueadas(undefined)).toEqual([]);
  });

  it('6. FUNÇÃO PURA: extrairAreas lida com vírgula, barra, traço, ponto-e-vírgula e pipes', () => {
    expect(extrairAreas('Ciências Exatas, Biológicas / Engenharias - Ciências da Saúde ; Humanas | Agrárias')).toEqual([
      'Ciências Exatas',
      'Biológicas',
      'Engenharias',
      'Ciências da Saúde',
      'Humanas',
      'Agrárias',
    ]);
    expect(extrairAreas('')).toEqual([]);
    expect(extrairAreas(null)).toEqual([]);
    expect(extrairAreas(undefined)).toEqual([]);
  });

  it('7. SUCESSO: realiza parsing de planilha com coluna Áreas de Avaliação', async () => {
    const colunas = ['Nome', 'E-mail', 'Instituicao', 'Areas'];
    const dadosMock = [
      {
        Nome: 'Dr. Roberto Mendes',
        'E-mail': 'roberto@ifms.edu.br',
        Instituicao: 'IFMS',
        Areas: 'Exatas / Engenharias - Computação',
      },
    ];

    const buffer = await gerarBufferPlanilha('Avaliadores', colunas, dadosMock);

    const resultado = await parsePlanilhaAvaliadores(buffer, false);
    expect(resultado.sucesso).toBe(true);
    expect(resultado.avaliadores[0].areas).toEqual(['Exatas', 'Engenharias', 'Computação']);
  });

  it('8. Deve rejeitar arquivos legados .xls com mensagem clara', async () => {
    const fakeXlsBuffer = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x55, 0x66]);
    await expect(parsePlanilhaAvaliadores(fakeXlsBuffer, false)).rejects.toThrow(
      /O formato legado \.xls \(Excel 97-2003\) não é suportado/i
    );
  });
});
