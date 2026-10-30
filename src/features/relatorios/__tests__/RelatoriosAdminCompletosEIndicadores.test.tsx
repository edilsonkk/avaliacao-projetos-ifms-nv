import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mocks do Supabase com vi.hoisted
const { mockFrom, mockRpc, mockFromCalls } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    mockFromCalls: calls,
    mockFrom: vi.fn(),
    mockRpc: vi.fn(),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

// Mock do window.confirm e window.alert
vi.stubGlobal('alert', vi.fn());
vi.stubGlobal('confirm', vi.fn(() => true));

// Mock do URL.createObjectURL e link click para CSV
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock-csv-url'),
  revokeObjectURL: vi.fn(),
});

import { RelatoriosAdmin } from '@/features/relatorios';

describe('Card de Relatórios: 5 Relatórios Especializados e Painel Gerencial de Indicadores', () => {
  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      ilike: vi.fn(() => chain),
      in: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      update: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      range: vi.fn(() => Promise.resolve(resultado)),
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  const dadosMockProjetos = [
    {
      id_projeto: 'proj-1',
      id_evento: 'evt-2026',
      codigo_projeto: 'FETEC-001',
      titulo: 'Robô Pantaneiro Autônomo',
      estande: 'EST-A01',
      modalidade: 'Iniciação Científica',
      area_conhecimento: 'Engenharias',
      nome_instituicao: 'IFMS Câmpus Campo Grande',
      total_avaliacoes: 2,
      media_geral: 9.5,
      notas: [9.0, 10.0],
      is_check_in_realizado: true,
      is_fora_da_competicao: false,
    },
    {
      id_projeto: 'proj-2',
      id_evento: 'evt-2026',
      codigo_projeto: 'FETEC-002',
      titulo: 'Extratos Botânicos Medicinais',
      estande: 'EST-B02',
      modalidade: 'Pesquisa Aplicada',
      area_conhecimento: 'Biológicas',
      nome_instituicao: 'Escola Estadual Pantanal',
      total_avaliacoes: 0,
      media_geral: 0,
      notas: [],
      is_check_in_realizado: false, // ausente/não credenciado
      is_fora_da_competicao: false,
    },
  ];

  const dadosMockAvaliadores = [
    {
      id_avaliacao: 'aval-1',
      id_usuario: 'usr-1',
      id_projeto: 'proj-1',
      id_evento: 'evt-2026',
      avaliador_nome: 'Dra. Amanda Silva',
      avaliador_email: 'amanda.silva@ifms.edu.br',
      codigo_projeto: 'FETEC-001',
      projeto_titulo: 'Robô Pantaneiro Autônomo',
      projeto_estande: 'EST-A01',
      projeto_modalidade: 'Iniciação Científica',
      projeto_area: 'Engenharias',
      nota_final: 9.0,
      parecer_final: 'Excelente implementação de robótica móvel.',
      parecer_comentario: 'Excelente implementação de robótica móvel.',
      tempo_presenca: '2026-10-25T14:00:00Z',
      tempo_submissao: '2026-10-25T14:15:30Z', // 15m 30s
      data_avaliacao: '2026-10-25T14:15:30Z',
    },
    {
      id_avaliacao: 'aval-2',
      id_usuario: 'usr-2',
      id_projeto: 'proj-1',
      id_evento: 'evt-2026',
      avaliador_nome: 'Prof. Marcos Souza',
      avaliador_email: 'marcos.souza@ufms.br',
      codigo_projeto: 'FETEC-001',
      projeto_titulo: 'Robô Pantaneiro Autônomo',
      projeto_estande: 'EST-A01',
      projeto_modalidade: 'Iniciação Científica',
      projeto_area: 'Engenharias',
      nota_final: 10.0,
      parecer_final: 'Rigor científico exemplar e código limpo.',
      parecer_comentario: 'Rigor científico exemplar e código limpo.',
      tempo_presenca: '2026-10-25T14:30:00Z',
      tempo_submissao: '2026-10-25T14:48:00Z', // 18m
      data_avaliacao: '2026-10-25T14:48:00Z',
    },
  ];

  const dadosMockAusencias = [
    {
      id_usuario: 'usr-3',
      id_projeto: 'proj-2',
      id_evento: 'evt-2026',
      avaliador_nome: 'Dr. Roberto Santos',
      avaliador_email: 'roberto.santos@embrapa.br',
      codigo_projeto: 'FETEC-002',
      projeto_titulo: 'Extratos Botânicos Medicinais',
      projeto_estande: 'EST-B02',
      projeto_modalidade: 'Pesquisa Aplicada',
      projeto_area: 'Biológicas',
      projeto_instituicao: 'Escola Estadual Pantanal',
      data_ausencia: '2026-10-25T15:00:00Z',
      total_avaliacoes_atuais: 0,
    },
  ];

  // Formato devolvido pelas funções fn_relatorio_*_completo (agrupadas por avaliador)
  const agruparPorAvaliador = (itens: any[], campo: string) => {
    const grupos = new Map<string, any>();
    itens.forEach(({ id_usuario, avaliador_nome, avaliador_email, ...resto }) => {
      const g = grupos.get(id_usuario) || { id_usuario, avaliador_nome, avaliador_email, [campo]: [] };
      g[campo].push(resto);
      grupos.set(id_usuario, g);
    });
    return [...grupos.values()];
  };

  const respostasRpc = (): Record<string, any[]> => ({
    fn_relatorio_projetos_completo: dadosMockProjetos.map((p) => ({
      ...p,
      detalhes_avaliacoes: dadosMockAvaliadores
        .filter((a) => a.id_projeto === p.id_projeto)
        .map((a) => ({ id_avaliacao: a.id_avaliacao, id_usuario: a.id_usuario, avaliador_nome: a.avaliador_nome, nota_final: a.nota_final, parecer: a.parecer_comentario, data: a.data_avaliacao })),
    })),
    fn_relatorio_avaliadores_completo: agruparPorAvaliador(
      dadosMockAvaliadores.map((a) => ({
        ...a,
        duracao_segundos: (new Date(a.tempo_submissao).getTime() - new Date(a.tempo_presenca).getTime()) / 1000,
      })),
      'avaliacoes'
    ),
    fn_relatorio_ausencias_completo: agruparPorAvaliador(dadosMockAusencias, 'ausencias'),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFromCalls.length = 0;

    mockRpc.mockImplementation((funcao: string) => criarQueryChain({ data: respostasRpc()[funcao] ?? [], error: null }));

    mockFrom.mockImplementation((tabela: string) => {
      mockFromCalls.push(tabela);

      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: 'evt-2026',
            nome_evento: 'FETEC MS 2026',
            data_evento: '2026-10-25',
            horario_inicio: '08:00:00',
            horario_fim: '18:00:00',
            cota_padrao: 3,
            is_ativo: true,
          },
          error: null,
        });
      }

      if (tabela === 'view_relatorio_projetos') {
        return criarQueryChain({
          data: dadosMockProjetos,
          error: null,
        });
      }

      if (tabela === 'view_relatorio_avaliadores') {
        return criarQueryChain({
          data: dadosMockAvaliadores,
          error: null,
        });
      }

      if (tabela === 'view_relatorio_ausencias') {
        return criarQueryChain({
          data: dadosMockAusencias,
          error: null,
        });
      }

      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            { id_usuario: 'usr-1', is_credenciado: true, usuarios: { papel: 'AVALIADOR' } },
            { id_usuario: 'usr-2', is_credenciado: true, usuarios: { papel: 'AVALIADOR' } },
            { id_usuario: 'usr-3', is_credenciado: true, usuarios: { papel: 'AVALIADOR' } },
            { id_usuario: 'usr-4', is_credenciado: false, usuarios: { papel: 'AVALIADOR' } },
            // Staff credenciado no evento: não entra na conta de avaliadores
            { id_usuario: 'usr-staff', is_credenciado: true, usuarios: { papel: 'STAFF' } },
          ],
          error: null,
        });
      }

      if (tabela === 'view_projetos_quarentena') {
        return criarQueryChain({
          data: [],
          count: 0,
          error: null,
        });
      }

      return criarQueryChain({ data: [], count: 0, error: null });
    });
  });

  it('1. ABA PROJETOS E MÉDIAS: renderiza projetos sem estande (apenas código) e abre accordion com notas detalhadas, avaliador e parecer', async () => {
    render(<RelatoriosAdmin id_evento_ativo="evt-2026" />);

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
      expect(screen.getByText('9.50 pts')).toBeDefined();
      expect(screen.getByText('FETEC-001')).toBeDefined();
      // Não deve exibir número de estande
      expect(screen.queryByText('EST-A01')).toBeNull();
    });

    // Clica no botão/célula da coluna Avaliações para expandir as notas do primeiro projeto
    const btnVerAvaliacoes = screen.getAllByTitle('Clique para ver todas as notas deste projeto')[0];
    fireEvent.click(btnVerAvaliacoes);

    await waitFor(() => {
      // Notas individuais renderizadas (tela + print condensado)
      expect(screen.getAllByText('9.00 pts').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('10.00 pts').length).toBeGreaterThanOrEqual(1);
      // Nomes dos avaliadores exibidos
      expect(screen.getAllByText('Dra. Amanda Silva').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Prof. Marcos Souza').length).toBeGreaterThanOrEqual(1);
      // Pareceres exibidos no accordion
      expect(screen.getAllByText(/Excelente implementação de robótica móvel/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Rigor científico exemplar e código limpo/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('2. ABA AVALIADORES E NOTAS ATRIBUÍDAS: agrupa por avaliador em accordion, exibe contadores e permite expandir para ver notas, horários e duração precisa', async () => {
    render(<RelatoriosAdmin id_evento_ativo="evt-2026" />);

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Alterna para aba Avaliadores e Notas Atribuídas
    const abaAvaliadores = screen.getByText('Avaliadores e Notas Atribuídas');
    fireEvent.click(abaAvaliadores.closest('button') || abaAvaliadores);

    await waitFor(() => {
      // Cabeçalhos dos grupos de avaliadores
      expect(screen.getByText('Dra. Amanda Silva')).toBeDefined();
      expect(screen.getByText('Prof. Marcos Souza')).toBeDefined();
      expect(screen.getByText(/Total de Avaliadores:/i)).toBeDefined();
    });

    // Clica em "Expandir Todos" para abrir os accordions dos avaliadores
    const btnExpandirTodos = screen.getByRole('button', { name: /Expandir Todos/i });
    fireEvent.click(btnExpandirTodos);

    await waitFor(() => {
      expect(screen.getAllByText('9.00 pts').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('10.00 pts').length).toBeGreaterThanOrEqual(1);
      // Validação das durações calculadas (15m 30s e 18m)
      expect(screen.getByText('15m 30s')).toBeDefined();
      expect(screen.getByText('18m 00s')).toBeDefined();
      expect(screen.getByText('Excelente implementação de robótica móvel.')).toBeDefined();
      // Não deve exibir número do estande
      expect(screen.queryByText('EST-A01')).toBeNull();
    });

    // Clica em "Recolher Todos" e valida classe hidden
    const btnRecolherTodos = screen.getByRole('button', { name: /Recolher Todos/i });
    fireEvent.click(btnRecolherTodos);

    await waitFor(() => {
      const detalheNota = screen.getByText('Excelente implementação de robótica móvel.');
      expect(detalheNota.closest('.hidden')).not.toBeNull();
    });
  });

  it('3. ABA AVALIADORES E AUSÊNCIAS ATRIBUÍDAS: agrupa por avaliador em accordion, exibe projetos marcados como ausentes sem estande', async () => {
    render(<RelatoriosAdmin id_evento_ativo="evt-2026" />);

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Alterna para aba Avaliadores e Ausências Atribuídas
    const abaAusencias = screen.getByText('Avaliadores e Ausências Atribuídas');
    fireEvent.click(abaAusencias.closest('button') || abaAusencias);

    await waitFor(() => {
      // Cabeçalho de grupo do avaliador
      expect(screen.getByText('Dr. Roberto Santos')).toBeDefined();
      expect(screen.getByText(/Total de Avaliadores com Ausências:/i)).toBeDefined();
    });

    // Clica em "Expandir Todos"
    const btnExpandirTodos = screen.getByRole('button', { name: /Expandir Todos/i });
    fireEvent.click(btnExpandirTodos);

    await waitFor(() => {
      expect(screen.getByText('Extratos Botânicos Medicinais')).toBeDefined();
      expect(screen.getByText('FETEC-002')).toBeDefined();
      // Não deve ter estande
      expect(screen.queryByText('EST-B02')).toBeNull();
      // Status do projeto: permanece sem avaliação
      expect(screen.getByText('Permanece sem avaliação')).toBeDefined();
    });

    // Clica em "Recolher Todos" e valida classe hidden
    const btnRecolherTodos = screen.getByRole('button', { name: /Recolher Todos/i });
    fireEvent.click(btnRecolherTodos);

    await waitFor(() => {
      const itemAusente = screen.getByText('Extratos Botânicos Medicinais');
      expect(itemAusente.closest('.hidden')).not.toBeNull();
    });
  });

  it('4. ABA INSTITUIÇÕES E PROJETOS SUBMETIDOS: agrupa por escola com contadores e suporta expansão/recolhimento inline e em massa', async () => {
    render(<RelatoriosAdmin id_evento_ativo="evt-2026" />);

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Alterna para aba Instituições e Projetos Submetidos
    const abaInstituicoes = screen.getByText('Instituições e Projetos Submetidos');
    fireEvent.click(abaInstituicoes.closest('button') || abaInstituicoes);

    await waitFor(() => {
      // Cabeçalhos de grupos das escolas
      expect(screen.getByText('IFMS Câmpus Campo Grande')).toBeDefined();
      expect(screen.getByText('Escola Estadual Pantanal')).toBeDefined();
      expect(screen.getByText(/Total de Escolas \/ Instituições:/i)).toBeDefined();
    });

    // Clica em "Expandir Todos"
    const btnExpandirTodos = screen.getByRole('button', { name: /Expandir Todos/i });
    fireEvent.click(btnExpandirTodos);

    await waitFor(() => {
      // Projetos da primeira escola
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
      // Projetos da segunda escola com badge de não credenciado
      expect(screen.getByText('Extratos Botânicos Medicinais')).toBeDefined();
      expect(screen.getByText('Não Credenciado')).toBeDefined();
      // Sem estande
      expect(screen.queryByText('EST-A01')).toBeNull();
    });

    // Clica em "Recolher Todos"
    const btnRecolherTodos = screen.getByRole('button', { name: /Recolher Todos/i });
    fireEvent.click(btnRecolherTodos);

    await waitFor(() => {
      const itemProj = screen.getByText('Extratos Botânicos Medicinais');
      expect(itemProj.closest('.hidden')).not.toBeNull();
    });
  });

  it('5. ABA INDICADORES: exibe título do evento e formato de data DD-MM-YYYY com painel de métricas gerenciais', async () => {
    render(<RelatoriosAdmin id_evento_ativo="evt-2026" />);

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Alterna para aba Indicadores
    const abaIndicadores = screen.getByText('Indicadores');
    fireEvent.click(abaIndicadores.closest('button') || abaIndicadores);

    await waitFor(() => {
      // Título ajustado para "Indicadores do evento: NOME DO EVENTO" (tanto tela quanto cabeçalho oficial de impressão)
      expect(screen.getAllByText('Indicadores do evento: FETEC MS 2026').length).toBeGreaterThanOrEqual(1);
      // Data no padrão DD-MM-YYYY
      expect(screen.getAllByText('25-10-2026').length).toBeGreaterThanOrEqual(1);
      // Janela do Evento formatada
      expect(screen.getByText('08:00')).toBeDefined();
      expect(screen.getByText('18:00')).toBeDefined();
      // Métricas de Projetos: 2 submetidos, 1 credenciado (50%)
      expect(screen.getByText(/50% presença/i)).toBeDefined();
      // Métricas de Avaliadores: 4 cadastrados, 3 credenciados (75%), sem contar o Staff
      expect(screen.getByText(/75% presentes/i)).toBeDefined();
      // % Progresso Global (2 de 3 esperadas de 1 credenciado)
      expect(screen.getByText(/Progresso Global/i)).toBeDefined();
      // Tempo médio formatado de avaliação
      expect(screen.getByText(/16m/i)).toBeDefined();
      // Média geral das notas (9.50 pts)
      expect(screen.getAllByText('9.50 pts').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('6. IMPRESSÃO PDF: disponibiliza botão de impressão e invoca window.print()', async () => {
    const printSpy = vi.fn();
    window.print = printSpy;

    render(<RelatoriosAdmin id_evento_ativo="evt-2026" />);

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    const btnImprimir = screen.getByTitle('Imprimir ou Salvar em PDF');
    expect(btnImprimir).toBeDefined();

    fireEvent.click(btnImprimir);
    expect(printSpy).toHaveBeenCalled();
  });

  it('7. EXPORTAÇÃO CSV: gera download dinâmico estruturado para qualquer uma das abas ativas', async () => {
    const createElementSpy = vi.spyOn(document, 'createElement');

    render(<RelatoriosAdmin id_evento_ativo="evt-2026" />);

    await waitFor(() => {
      expect(screen.getByText('Robô Pantaneiro Autônomo')).toBeDefined();
    });

    // Botão Exportar CSV
    const btnExportar = screen.getByRole('button', { name: /Exportar \(\.CSV\)/i });
    fireEvent.click(btnExportar);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    createElementSpy.mockRestore();
  });

  it('8. IMPRESSÃO PDF TEXTUAL: valida cabeçalho oficial e listas textuais recuadas sem badges/cards para impressão em PDF', async () => {
    render(<RelatoriosAdmin id_evento_ativo="evt-2026" />);

    await waitFor(() => {
      // 1. Cabeçalho oficial de impressão
      expect(screen.getAllByText('FETEC MS 2026').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Relatório de Projetos e Médias')).toBeDefined();
      expect(screen.getByText(/Emissão:/i)).toBeDefined();
    });

    // Aba Projetos e Médias: avaliações recebidas recuadas
    expect(screen.getAllByText(/Avaliações Recebidas/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/• Dra\. Amanda Silva:/i).length).toBeGreaterThanOrEqual(1);

    // Alterna para Avaliadores e Notas
    const abaAvaliadores = screen.getByText('Avaliadores e Notas Atribuídas');
    fireEvent.click(abaAvaliadores.closest('button') || abaAvaliadores);

    await waitFor(() => {
      expect(screen.getByText('Relatório de Avaliadores e Notas Atribuídas')).toBeDefined();
      expect(screen.getAllByText(/Projetos Avaliados/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/• \[FETEC-001\] Robô Pantaneiro Autônomo/i).length).toBeGreaterThanOrEqual(1);
    });

    // Alterna para Avaliadores e Ausências
    const abaAusencias = screen.getByText('Avaliadores e Ausências Atribuídas');
    fireEvent.click(abaAusencias.closest('button') || abaAusencias);

    await waitFor(() => {
      expect(screen.getByText('Relatório de Avaliadores e Ausências Atribuídas')).toBeDefined();
      expect(screen.getAllByText(/Projetos Marcados como Ausente/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/• \[FETEC-002\] Extratos Botânicos Medicinais/i).length).toBeGreaterThanOrEqual(1);
    });

    // Alterna para Instituições e Projetos
    const abaInstituicoes = screen.getByText('Instituições e Projetos Submetidos');
    fireEvent.click(abaInstituicoes.closest('button') || abaInstituicoes);

    await waitFor(() => {
      expect(screen.getByText('Relatório de Instituições e Projetos Submetidos')).toBeDefined();
      expect(screen.getAllByText(/Trabalhos Submetidos/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/• \[FETEC-001\] Robô Pantaneiro Autônomo/i).length).toBeGreaterThanOrEqual(1);
    });
  });
});
