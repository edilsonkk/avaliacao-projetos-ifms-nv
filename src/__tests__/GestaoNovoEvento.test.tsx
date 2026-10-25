import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mocks do ambiente
const mockAlert = vi.fn();
vi.stubGlobal('alert', mockAlert);
vi.stubGlobal('confirm', vi.fn(() => true));

const { mockRpc, mockFrom, mockDelete, mockUpdate, mockInsert } = vi.hoisted(() => {
  const mockRpc = vi.fn().mockResolvedValue({ error: null, data: { sucesso: true } });
  const mockDelete = vi.fn().mockResolvedValue({ error: null });
  const mockUpdate = vi.fn().mockResolvedValue({ error: null });
  const mockInsert = vi.fn().mockResolvedValue({ error: null, data: { id_evento: 'novo-evento-uuid-123' } });
  const mockFrom = vi.fn();

  return { mockRpc, mockFrom, mockDelete, mockUpdate, mockInsert };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

import { TelaAdmin } from '../components/TelaAdmin';

describe('Rotina de Testes de Regressão: Gestão e Criação de Novo Evento', () => {
  let eventosRegistrados: any[] = [];
  let simularErroSchemaCacheDataEvento = false;

  const criarQueryChain = (resultado: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resultado)),
      maybeSingle: vi.fn(() => Promise.resolve(resultado)),
      delete: mockDelete,
      update: mockUpdate,
      insert: mockInsert,
      then: (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    simularErroSchemaCacheDataEvento = false;

    eventosRegistrados = [
      {
        id_evento: '11111111-2222-3333-4444-555555555555',
        nome_evento: 'FETEC MS 2026',
        edicao: '17ª Edição',
        data_evento: '2026-10-22',
        horario_inicio: '08:00:00',
        horario_fim: '18:00:00',
        is_ativo: true,
        cota_avaliacoes_padrao: 3,
        minutos_timeout_lock: 30,
        limite_corte: '2026-10-22T23:59:59+00:00',
      },
      {
        id_evento: '99999999-8888-7777-6666-555555555555',
        nome_evento: 'FETEC MS 2025',
        edicao: '16ª Edição',
        data_evento: '2025-10-20',
        horario_inicio: '08:00:00',
        horario_fim: '17:30:00',
        is_ativo: false,
        cota_avaliacoes_padrao: 3,
        minutos_timeout_lock: 30,
        limite_corte: '2025-10-20T23:59:59+00:00',
      },
    ];

    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        return {
          select: vi.fn((colunas?: string) => {
            const chain: any = {
              eq: vi.fn((campo: string, valor: any) => {
                const encontrado = eventosRegistrados.find((e: any) => e[campo] === valor);
                return {
                  single: vi.fn(() => Promise.resolve({ data: encontrado || null, error: null })),
                  maybeSingle: vi.fn(() => Promise.resolve({ data: encontrado || null, error: null })),
                  order: vi.fn(() => Promise.resolve({ data: [...eventosRegistrados], error: null })),
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(() => Promise.resolve({ data: encontrado || null, error: null })),
                  })),
                };
              }),
              order: vi.fn(() => Promise.resolve({ data: [...eventosRegistrados], error: null })),
              single: vi.fn(() => Promise.resolve({ data: eventosRegistrados.find(e => e.is_ativo) || eventosRegistrados[0], error: null })),
              limit: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: eventosRegistrados.find(e => e.is_ativo) || eventosRegistrados[0], error: null })),
              })),
            };
            return chain;
          }),
          update: vi.fn((campos: any) => {
            mockUpdate(campos);
            return {
              neq: vi.fn((campo: string, valor: any) => {
                eventosRegistrados.forEach((evt) => {
                  if (evt[campo] !== valor) {
                    Object.assign(evt, campos);
                  }
                });
                return Promise.resolve({ error: null });
              }),
              eq: vi.fn((campo: string, valor: any) => {
                eventosRegistrados.forEach((evt) => {
                  if (evt[campo] === valor) {
                    Object.assign(evt, campos);
                  }
                });
                return Promise.resolve({ error: null });
              }),
            };
          }),
          insert: vi.fn((payload: any) => {
            mockInsert(payload);

            // Simula o erro real de PostgREST quando a coluna data_evento não está no schema cache do Supabase
            if (simularErroSchemaCacheDataEvento && 'data_evento' in payload) {
              return {
                select: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({
                    data: null,
                    error: {
                      code: 'PGRST204',
                      message: "Could not find the 'data_evento' column of 'eventos' in the schema cache",
                    },
                  })),
                })),
              };
            }

            const novoObj = {
              id_evento: 'novo-evento-uuid-123',
              ...payload,
            };
            eventosRegistrados.unshift(novoObj);
            return {
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: { id_evento: 'novo-evento-uuid-123' }, error: null })),
              })),
            };
          }),
        };
      }

      // Outras tabelas retornam listas vazias padrão para os contadores
      return criarQueryChain({ data: [], count: 0, error: null });
    });
  });

  it('1. BOTÃO NOVO EVENTO: deve existir no Header e abrir o modal de cadastro', async () => {
    render(<TelaAdmin />);

    const botaoNovoEvento = await screen.findByRole('button', { name: /novo evento/i });
    expect(botaoNovoEvento).toBeInTheDocument();

    fireEvent.click(botaoNovoEvento);

    expect(await screen.findByText('Cadastrar Novo Evento / Edição')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ex: FETEC MS 2027')).toBeInTheDocument();
  });

  it('2. VALIDAÇÃO: o botão de submissão do modal deve ficar desabilitado se o nome estiver vazio', async () => {
    render(<TelaAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: /novo evento/i }));

    const inputNome = screen.getByPlaceholderText('Ex: FETEC MS 2027') as HTMLInputElement;
    expect(inputNome.value).toBe('');

    const botaoCadastrar = screen.getByRole('button', { name: /cadastrar evento/i });
    expect(botaoCadastrar).toBeDisabled();

    // Digita um nome e verifica que habilita
    fireEvent.change(inputNome, { target: { value: 'FECINTEC 2026' } });
    expect(botaoCadastrar).not.toBeDisabled();
  });

  it('3. CADASTRO COM ATIVAÇÃO IMEDIATA: inclui data do evento, horários e ativa imediatamente no painel', async () => {
    render(<TelaAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: /novo evento/i }));

    const inputNome = screen.getByPlaceholderText('Ex: FETEC MS 2027');
    const inputEdicao = screen.getByPlaceholderText('Ex: 18ª Edição');

    // Preenche os campos do evento
    fireEvent.change(inputNome, { target: { value: 'FETEC MS 2027' } });
    fireEvent.change(inputEdicao, { target: { value: '18ª Edição' } });

    // Localiza e altera os inputs de data e horário
    const inputsData = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    if (inputsData.length > 0) {
      fireEvent.change(inputsData[0], { target: { value: '2027-10-25' } });
    }

    const inputInicio = screen.getByDisplayValue('08:00');
    fireEvent.change(inputInicio, { target: { value: '08:30' } });

    const inputFim = screen.getByDisplayValue('18:00');
    fireEvent.change(inputFim, { target: { value: '19:00' } });

    // Verifica que o checkbox de ativação imediata está marcado por padrão
    const chkAtivo = screen.getByLabelText(/tornar este evento ativo agora/i) as HTMLInputElement;
    expect(chkAtivo.checked).toBe(true);

    const botaoCadastrar = screen.getByRole('button', { name: /cadastrar evento/i });
    fireEvent.click(botaoCadastrar);

    await waitFor(() => {
      // 1. Deve desativar os outros eventos
      expect(mockUpdate).toHaveBeenCalledWith({ is_ativo: false });
      // 2. Deve inserir o novo evento com data_evento, horários, limite_corte e is_ativo: true
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          nome_evento: 'FETEC MS 2027',
          edicao: '18ª Edição',
          data_evento: '2027-10-25',
          limite_corte: '2027-10-25T23:59:59+00:00',
          horario_inicio: '08:30',
          horario_fim: '19:00',
          is_ativo: true,
        })
      );
    });

    // 3. O cabeçalho deve atualizar o nome do evento para o novo
    await waitFor(() => {
      expect(screen.getByText('FETEC MS 2027')).toBeInTheDocument();
    });
  });

  it('4. RESILIÊNCIA A DIVERGÊNCIA DE SCHEMA CACHE: trata erro de data_evento ausente com fallback seguro sem exibir alerta de erro', async () => {
    // ATIVA A SIMULAÇÃO DO ERRO EXATO QUE OCORREU NO SUPABASE EM PRODUÇÃO
    simularErroSchemaCacheDataEvento = true;

    render(<TelaAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: /novo evento/i }));

    const inputNome = screen.getByPlaceholderText('Ex: FETEC MS 2027');
    fireEvent.change(inputNome, { target: { value: 'FETEC MS 2028 RESILIENTE' } });

    const inputsData = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    if (inputsData.length > 0) {
      fireEvent.change(inputsData[0], { target: { value: '2028-11-10' } });
    }

    const botaoCadastrar = screen.getByRole('button', { name: /cadastrar evento/i });
    fireEvent.click(botaoCadastrar);

    // O fallback deve ser acionado:
    // 1º tentativa com data_evento falhou (simulado PGRST204)
    // 2º tentativa sem data_evento, mas COM limite_corte contendo a data do evento
    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(2);
      expect(mockInsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          nome_evento: 'FETEC MS 2028 RESILIENTE',
          limite_corte: '2028-11-10T23:59:59+00:00',
          is_ativo: true,
        })
      );
    });

    // Não deve disparar alert de erro para o usuário
    expect(mockAlert).not.toHaveBeenCalledWith(
      expect.stringContaining("Could not find the 'data_evento' column")
    );

    // Painel deve ser ativado com sucesso
    await waitFor(() => {
      expect(screen.getByText('FETEC MS 2028 RESILIENTE')).toBeInTheDocument();
    });
  });

  it('5. CADASTRO INATIVO: ao desmarcar a ativação imediata, salva com is_ativo: false sem alterar o evento ativo', async () => {
    render(<TelaAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: /novo evento/i }));

    const inputNome = screen.getByPlaceholderText('Ex: FETEC MS 2027');
    fireEvent.change(inputNome, { target: { value: 'Evento Futuro 2028' } });

    const chkAtivo = screen.getByLabelText(/tornar este evento ativo agora/i);
    fireEvent.click(chkAtivo); // desmarca

    const botaoCadastrar = screen.getByRole('button', { name: /cadastrar evento/i });
    fireEvent.click(botaoCadastrar);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          nome_evento: 'Evento Futuro 2028',
          is_ativo: false,
        })
      );
    });

    // Não deve ter desativado os outros eventos
    expect(mockUpdate).not.toHaveBeenCalledWith({ is_ativo: false });
  });

  it('6. HISTÓRICO DE EVENTOS: exibe edições anteriores e permite alternar o evento ativo', async () => {
    render(<TelaAdmin />);

    // Abre configurações
    fireEvent.click(await screen.findByTitle('Configurações Gerais'));

    // Clica em "Eventos Anteriores"
    const botaoHistorico = await screen.findByText('Eventos Anteriores');
    fireEvent.click(botaoHistorico);

    // Modal de histórico abre
    expect(await screen.findByText('Histórico de Eventos & Edições')).toBeInTheDocument();
    expect(await screen.findByText('FETEC MS 2025')).toBeInTheDocument();
    expect(screen.getByText('ATIVO AGORA')).toBeInTheDocument();

    // Clica em "Ativar Este Evento" para a edição de 2025
    const botaoAtivar = screen.getByRole('button', { name: /ativar este evento/i });
    fireEvent.click(botaoAtivar);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ is_ativo: false });
      expect(mockUpdate).toHaveBeenCalledWith({ is_ativo: true });
    });
  });
});
