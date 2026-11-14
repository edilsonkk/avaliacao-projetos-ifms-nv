import { describe, it, expect } from 'vitest';
import {
  agruparImpedimentosPorAvaliador,
  filtrarImpedimentos,
  ordenarImpedimentos,
  type ItemImpedimento,
} from '@/features/relatorios';

/**
 * Agrupamento compartilhado pelos relatórios de Ausências (`tipo = 'ausencia'`) e de Devoluções
 * (`tipo = 'conflito'`, o botão "Devolver (Conflito de Interesse)").
 */

const item = (sobrescreve: Partial<ItemImpedimento> = {}): ItemImpedimento => ({
  id_usuario: 'usr-1',
  avaliador_nome: 'Ana Souza',
  avaliador_email: 'ana@ifms.edu.br',
  id_projeto: 'proj-1',
  codigo_projeto: 'FETEC-1',
  projeto_titulo: 'Robô Pantaneiro',
  projeto_modalidade: 'Iniciação Científica',
  projeto_area: 'Engenharias',
  projeto_instituicao: 'IFMS',
  data_registro: '2026-11-10T09:00:00Z',
  total_avaliacoes_atuais: 0,
  ...sobrescreve,
});

describe('impedimentos: agrupamento por avaliador', () => {
  it('deve juntar os projetos do mesmo avaliador e contar o total', () => {
    // Arrange
    const itens = [
      item({ id_projeto: 'proj-1', codigo_projeto: 'FETEC-1' }),
      item({ id_projeto: 'proj-2', codigo_projeto: 'FETEC-2' }),
      item({ id_usuario: 'usr-2', avaliador_nome: 'Bia Lima', avaliador_email: 'bia@ifms.edu.br' }),
    ];

    // Act
    const grupos = agruparImpedimentosPorAvaliador(itens);

    // Assert
    expect(grupos).toHaveLength(2);
    expect(grupos[0].total).toBe(2);
    expect(grupos[0].itens.map((i) => i.codigo_projeto)).toEqual(['FETEC-1', 'FETEC-2']);
    expect(grupos[1].total).toBe(1);
  });

  it('deve agrupar pelo e-mail quando o id do avaliador vem vazio', () => {
    // Arrange
    const itens = [item({ id_usuario: '' }), item({ id_usuario: '', id_projeto: 'proj-2' })];

    // Act
    const grupos = agruparImpedimentosPorAvaliador(itens);

    // Assert
    expect(grupos).toHaveLength(1);
    expect(grupos[0].id_usuario).toBe('ana@ifms.edu.br');
    expect(grupos[0].total).toBe(2);
  });

  it('deve devolver lista vazia sem nenhum impedimento', () => {
    // Arrange / Act / Assert
    expect(agruparImpedimentosPorAvaliador([])).toEqual([]);
  });
});

describe('impedimentos: busca', () => {
  const grupos = agruparImpedimentosPorAvaliador([
    item({ id_projeto: 'proj-1', codigo_projeto: 'FETEC-1', projeto_titulo: 'Robô Pantaneiro' }),
    item({ id_projeto: 'proj-2', codigo_projeto: 'FETEC-2', projeto_titulo: 'Extratos Botânicos' }),
    item({ id_usuario: 'usr-2', avaliador_nome: 'Bia Lima', avaliador_email: 'bia@ifms.edu.br', projeto_titulo: 'Sensor de Água' }),
  ]);

  it('deve manter o grupo inteiro quando o avaliador bate', () => {
    // Arrange / Act
    const resultado = filtrarImpedimentos(grupos, 'ana');

    // Assert
    expect(resultado).toHaveLength(1);
    expect(resultado[0].itens).toHaveLength(2);
  });

  it('deve manter só os projetos que batem quando a busca é por projeto', () => {
    // Arrange / Act
    const resultado = filtrarImpedimentos(grupos, 'extratos');

    // Assert
    expect(resultado).toHaveLength(1);
    expect(resultado[0].itens.map((i) => i.codigo_projeto)).toEqual(['FETEC-2']);
  });

  it('deve achar pelo código do projeto, pela modalidade e pela área', () => {
    // Arrange / Act / Assert
    expect(filtrarImpedimentos(grupos, 'FETEC-1')[0].itens).toHaveLength(1);
    expect(filtrarImpedimentos(grupos, 'engenharias').length).toBeGreaterThan(0);
    expect(filtrarImpedimentos(grupos, 'iniciação')).not.toHaveLength(0);
  });

  it('deve devolver tudo com busca vazia e nada quando nada bate', () => {
    // Arrange / Act / Assert
    expect(filtrarImpedimentos(grupos, '   ')).toHaveLength(2);
    expect(filtrarImpedimentos(grupos, 'inexistente')).toHaveLength(0);
  });
});

describe('impedimentos: ordenação', () => {
  const grupos = agruparImpedimentosPorAvaliador([
    item({ id_usuario: 'usr-1', avaliador_nome: 'Ana Souza', id_projeto: 'proj-1' }),
    item({ id_usuario: 'usr-2', avaliador_nome: 'Bia Lima', avaliador_email: 'bia@ifms.edu.br', id_projeto: 'proj-2' }),
    item({ id_usuario: 'usr-2', avaliador_nome: 'Bia Lima', avaliador_email: 'bia@ifms.edu.br', id_projeto: 'proj-3' }),
  ]);

  it('deve ordenar por total de impedimentos, do maior para o menor', () => {
    // Arrange / Act
    const resultado = ordenarImpedimentos(grupos, 'total', 'desc');

    // Assert
    expect(resultado.map((g) => g.avaliador_nome)).toEqual(['Bia Lima', 'Ana Souza']);
  });

  it('deve ordenar pelo nome do avaliador nas duas direções', () => {
    // Arrange / Act / Assert
    expect(ordenarImpedimentos(grupos, 'avaliador', 'asc').map((g) => g.avaliador_nome)).toEqual(['Ana Souza', 'Bia Lima']);
    expect(ordenarImpedimentos(grupos, 'avaliador', 'desc').map((g) => g.avaliador_nome)).toEqual(['Bia Lima', 'Ana Souza']);
  });

  it('não deve alterar a lista recebida', () => {
    // Arrange
    const antes = grupos.map((g) => g.avaliador_nome);

    // Act
    ordenarImpedimentos(grupos, 'total', 'desc');

    // Assert
    expect(grupos.map((g) => g.avaliador_nome)).toEqual(antes);
  });
});
