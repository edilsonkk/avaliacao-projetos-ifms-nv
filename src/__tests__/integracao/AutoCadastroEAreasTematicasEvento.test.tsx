import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { gerarBufferPlanilha } from '@/lib/excel/excelUtils';
import { GestorProjetos } from '@/features/projetos';
import { GestorAvaliadores } from '@/features/avaliadores';
import { supabase } from '@/lib/supabase';
import { normalizarAreaTematica } from '@/lib/parsers/areasTematicasNormalizer';

// Mock do Supabase
vi.mock('@/lib/supabase', () => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  return {
    supabase: {
      from: mockFrom,
      rpc: mockRpc,
      auth: {
        getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-admin' } }, error: null })),
      },
    },
    verificar_conexao_configurada: () => true,
  };
});

describe('Rotinas 3 e 4: Auto-Cadastro de Instituições, Modalidades e Áreas Temáticas com id_evento', () => {
  let mockFrom: any;
  const EVENTO_ID = 'evt-fetec-2026';

  const criarQueryChain = (resposta: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      upsert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resposta)),
      maybeSingle: vi.fn(() => Promise.resolve(resposta)),
      then: (resolve: any) => Promise.resolve(resposta).then(resolve),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('evento_ativo_id', EVENTO_ID);
    mockFrom = supabase.from;
  });

  it('1. ÁREAS TEMÁTICAS: mapeia variações para grandes áreas do CNPq em MAIÚSCULO com acento e aplica fallback sem acentos', () => {
    // Validações CNPq com acento
    expect(normalizarAreaTematica('ciencias agrarias')).toBe('CIÊNCIAS AGRÁRIAS');
    expect(normalizarAreaTematica('agronomia')).toBe('CIÊNCIAS AGRÁRIAS');
    expect(normalizarAreaTematica('agropecuária')).toBe('CIÊNCIAS AGRÁRIAS');
    expect(normalizarAreaTematica('Exatas')).toBe('CIÊNCIAS EXATAS E DA TERRA');
    expect(normalizarAreaTematica('Engenharia Mecânica')).toBe('ENGENHARIAS');
    expect(normalizarAreaTematica('Saúde Pública')).toBe('CIÊNCIAS DA SAÚDE');
    expect(normalizarAreaTematica('Biologia Celular')).toBe('CIÊNCIAS BIOLÓGICAS');
    expect(normalizarAreaTematica('Ciências Sociais Aplicadas')).toBe('CIÊNCIAS SOCIAIS APLICADAS');
    expect(normalizarAreaTematica('Letras e Linguística')).toBe('LINGUÍSTICA, LETRAS E ARTES');

    // Validação de fallback: colapsa espaços, remove acentos e fica em MAIÚSCULO
    expect(normalizarAreaTematica('   Sustentabilidade   &   Inovação   ')).toBe('SUSTENTABILIDADE & INOVACAO');
  });

  it('2. CONSULTAS DE REFERÊNCIA: Gestor de Projetos filtra instituicoes, modalidades e areas_tematicas por id_evento', async () => {
    const chamadasEq: Array<{ campo: string; valor: any }> = [];

    mockFrom.mockImplementation((tabela: string) => {
      const chain: any = {
        select: vi.fn(() => chain),
        insert: vi.fn(() => chain),
        upsert: vi.fn(() => chain),
        order: vi.fn(() => chain),
        eq: vi.fn((campo: string, valor: any) => {
          chamadasEq.push({ campo, valor });
          return chain;
        }),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    });

    render(<GestorProjetos id_evento_ativo={EVENTO_ID} aoFechar={vi.fn()} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('instituicoes');
      expect(mockFrom).toHaveBeenCalledWith('modalidades');
      expect(mockFrom).toHaveBeenCalledWith('areas_tematicas');
    });

    // Confirma que foram aplicados os filtros por id_evento
    const filtrosEvento = chamadasEq.filter((c) => c.campo === 'id_evento' && c.valor === EVENTO_ID);
    expect(filtrosEvento.length).toBeGreaterThanOrEqual(3);
  });

  it('3. ROTINA 3 (AUTO-CADASTRO NA IMPORTAÇÃO DE PROJETOS): cadastra instituição no evento com id_evento e idempotência', async () => {
    const chamadasInsertInst: any[] = [];
    const chamadasInsertAreas: any[] = [];

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'instituicoes') {
        const chain: any = {
          select: vi.fn(() => chain),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          eq: vi.fn(() => chain),
          insert: vi.fn((payload) => {
            chamadasInsertInst.push(...payload);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id_instituicao: 'inst-auto-1',
                    nome_exibicao: payload[0]?.nome_exibicao,
                    sigla: payload[0]?.sigla,
                  },
                  error: null,
                }),
              }),
            };
          }),
        };
        return chain;
      }

      if (tabela === 'areas_tematicas') {
        const chain: any = {
          select: vi.fn(() => chain),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          eq: vi.fn(() => chain),
          insert: vi.fn((payload) => {
            chamadasInsertAreas.push(...payload);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id_area: 'area-cnpq-1',
                    nome_area: payload[0]?.nome_area,
                  },
                  error: null,
                }),
              }),
            };
          }),
        };
        return chain;
      }

      if (tabela === 'modalidades') {
        const chain: any = {
          select: vi.fn(() => chain),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          eq: vi.fn(() => chain),
        };
        return chain;
      }

      if (tabela === 'projetos') {
        const chain: any = {
          select: vi.fn(() => chain),
          order: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return chain;
      }

      return criarQueryChain({ data: [], error: null });
    });

    render(<GestorProjetos id_evento_ativo={EVENTO_ID} aoFechar={vi.fn()} />);

    // Cria planilha de teste contendo 2 projetos da mesma instituição e com área de Ciências Agrárias
    const linhasPlanilha = [
      {
        codigo_projeto: 'PRJ-01',
        titulo: 'Pesquisa Agro 1',
        instituicao: 'Colégio Agrícola Regional',
        sigla: 'CAR',
        area_tematica: 'ciencias agrarias', // Deve normalizar para CIÊNCIAS AGRÁRIAS
        modalidade: 'Ensino Médio',
      },
      {
        codigo_projeto: 'PRJ-02',
        titulo: 'Pesquisa Agro 2',
        instituicao: 'Colégio Agrícola Regional', // Mesma instituição (idempotência no lote)
        sigla: 'CAR',
        area_tematica: 'Agronomia', // Também normaliza para CIÊNCIAS AGRÁRIAS
        modalidade: 'Ensino Médio',
      },
    ];

    const colunasPrj = ['codigo_projeto', 'titulo', 'instituicao', 'sigla', 'area_tematica', 'modalidade'];
    const buf = await gerarBufferPlanilha('Projetos', colunasPrj, linhasPlanilha);
    const file = new File([buf as Uint8Array<ArrayBuffer>], 'projetos.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Simula upload do arquivo
    const inputEl = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(inputEl).toBeDefined();

    fireEvent.change(inputEl, { target: { files: [file] } });

    // Se abrir o modal De-Para, clica em "Confirmar e Prosseguir com a Importação"
    const btnConfirmar = await screen.findByRole('button', { name: /Confirmar e Prosseguir/i });
    expect(btnConfirmar).toBeInTheDocument();
    fireEvent.click(btnConfirmar);

    // Aguarda processamento
    await waitFor(() => {
      // Instituição deve ter sido inserida com id_evento
      expect(chamadasInsertInst.length).toBe(1); // Exatamente 1 insert (idempotente)
      expect(chamadasInsertInst[0].id_evento).toBe(EVENTO_ID);
      expect(chamadasInsertInst[0].nome_exibicao).toBe('Colégio Agrícola Regional');

      // Área Temática deve ter sido inserida com id_evento e acento em MAIÚSCULO
      expect(chamadasInsertAreas.length).toBe(1); // Exatamente 1 insert (reaproveitada no lote)
      expect(chamadasInsertAreas[0].id_evento).toBe(EVENTO_ID);
      expect(chamadasInsertAreas[0].nome_area).toBe('CIÊNCIAS AGRÁRIAS');
    });
  });

  it('4. ROTINA 4 (DE-PARA NO GESTOR DE AVALIADORES): ao confirmar cadastrar novo, salva com id_evento ativo', async () => {
    let payloadInsertInst: any = null;

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'instituicoes') {
        const chain: any = {
          select: vi.fn(() => chain),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          eq: vi.fn(() => chain),
          insert: vi.fn((payload) => {
            payloadInsertInst = payload[0];
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id_instituicao: 'inst-avaliador-nova',
                    nome_exibicao: payload[0]?.nome_exibicao,
                    sigla: payload[0]?.sigla,
                  },
                  error: null,
                }),
              }),
            };
          }),
        };
        return chain;
      }
      if (tabela === 'modalidades') {
        const chain: any = {
          select: vi.fn(() => chain),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          eq: vi.fn(() => chain),
        };
        return chain;
      }
      if (tabela === 'usuarios' || tabela === 'avaliadores_evento' || tabela === 'avaliador_modalidades_bloqueadas') {
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          eq: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return criarQueryChain({ data: [], error: null });
    });

    render(<GestorAvaliadores id_evento_ativo={EVENTO_ID} ao_fechar={vi.fn()} />);

    // Cria planilha de avaliadores com nova instituição
    const linhasAv = [
      {
        nome: 'Dra. Avaliadora Nova',
        email: 'avaliadora@novainst.edu.br',
        instituicao: 'Universidade Estadual Pantanal',
        sigla_instituicao: 'UEP',
        modalidades_bloqueadas: '',
      },
    ];

    const colunasAv = ['nome', 'email', 'instituicao', 'sigla_instituicao', 'modalidades_bloqueadas'];
    const buf = await gerarBufferPlanilha('Avaliadores', colunasAv, linhasAv);
    const file = new File([buf as Uint8Array<ArrayBuffer>], 'avaliadores.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const inputEl = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(inputEl).toBeDefined();

    fireEvent.change(inputEl, { target: { files: [file] } });

    // Se abrir o modal de De-Para, clica em confirmar
    const btnConfirmar = await screen.findByRole('button', { name: /Confirmar e Prosseguir/i });
    expect(btnConfirmar).toBeInTheDocument();
    fireEvent.click(btnConfirmar);

    // Aguarda o processamento
    await waitFor(() => {
      expect(payloadInsertInst).not.toBeNull();
      expect(payloadInsertInst.id_evento).toBe(EVENTO_ID);
      expect(payloadInsertInst.nome_exibicao).toBe('Universidade Estadual Pantanal');
    });
  });
});
