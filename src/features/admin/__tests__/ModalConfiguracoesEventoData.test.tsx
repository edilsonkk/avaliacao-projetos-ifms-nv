import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ModalConfiguracoesEvento } from '@/features/admin';
import { supabase } from '@/lib/supabase';
import { ProvedorAvisos } from '@/components/ui';
import { ProvedorIdentidadeVisual } from '@/components/layout/IdentidadeVisual';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  isSupabaseConfigured: () => true,
  verificar_conexao_configurada: () => true,
}));

describe('Auditoria e Testes de Persistência de data_evento no ModalConfiguracoesEvento', () => {
  const eventoIdTeste = 'e0000000-0000-0000-0000-000000000001';
  let chamadasUpdateEventos: any[] = [];

  const criarQueryChain = (resultadoFinal: any) => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string, val: string) => {
        return {
          ...chain,
          single: vi.fn().mockResolvedValue(resultadoFinal),
          maybeSingle: vi.fn().mockResolvedValue(resultadoFinal),
        };
      }),
      single: vi.fn().mockResolvedValue(resultadoFinal),
      maybeSingle: vi.fn().mockResolvedValue(resultadoFinal),
      update: vi.fn().mockImplementation((payload: any) => {
        chamadasUpdateEventos.push(payload);
        return {
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
      then: (resolve: any) => Promise.resolve(resultadoFinal).then(resolve),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasUpdateEventos = [];
    localStorage.clear();
  });

  it('1. CARREGAMENTO: preenche o campo de data com a data_evento vinda do banco', async () => {
    vi.mocked(supabase.from).mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: eventoIdTeste,
            nome_evento: 'FETEC MS 2026',
            data_evento: '2026-11-15',
            horario_inicio: '08:30',
            horario_fim: '17:30',
            minutos_timeout_lock: 20,
            cota_avaliacoes_padrao: 4,
            sistema_liberado: true,
          },
          error: null,
        });
      }
      return criarQueryChain({ data: [], error: null });
    });

    render(<ProvedorAvisos><ProvedorIdentidadeVisual><ModalConfiguracoesEvento
        id_evento_ativo={eventoIdTeste}
        nome_evento_atual="FETEC MS 2026"
        ao_fechar={vi.fn()}
      /></ProvedorIdentidadeVisual></ProvedorAvisos>);

    const inputData = await screen.findByDisplayValue('2026-11-15');
    expect(inputData).toBeInTheDocument();
    expect((inputData as HTMLInputElement).value).toBe('2026-11-15');
  });

  it('2. SALVAMENTO: ao alterar a data, dispara UPDATE com data_evento limpo sem campos inexistentes', async () => {
    vi.mocked(supabase.from).mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: eventoIdTeste,
            nome_evento: 'FETEC MS 2026',
            data_evento: '2026-10-24',
            horario_inicio: '08:00',
            horario_fim: '18:00',
            minutos_timeout_lock: 15,
            cota_avaliacoes_padrao: 3,
            sistema_liberado: true,
          },
          error: null,
        });
      }
      return criarQueryChain({ data: [], error: null });
    });

    const aoSalvarSucessoMock = vi.fn();
    const aoFecharMock = vi.fn();

    render(<ProvedorAvisos><ProvedorIdentidadeVisual><ModalConfiguracoesEvento
        id_evento_ativo={eventoIdTeste}
        nome_evento_atual="FETEC MS 2026"
        ao_fechar={aoFecharMock}
        ao_salvar_sucesso={aoSalvarSucessoMock}
      /></ProvedorIdentidadeVisual></ProvedorAvisos>);

    // Aguarda carregar dados existentes
    const inputData = await screen.findByDisplayValue('2026-10-24');
    expect(inputData).toBeInTheDocument();

    // Altera a data para 2026-11-20
    fireEvent.change(inputData, { target: { value: '2026-11-20' } });
    expect((inputData as HTMLInputElement).value).toBe('2026-11-20');

    // Clica no botão Salvar Configurações
    const btnSalvar = screen.getByRole('button', { name: /Salvar Configurações/i });
    fireEvent.click(btnSalvar);

    await waitFor(() => {
      expect(chamadasUpdateEventos.length).toBeGreaterThanOrEqual(1);
    });

    const payloadEnviado = chamadasUpdateEventos[0];
    // Valida que data_evento foi enviada com o novo valor
    expect(payloadEnviado.data_evento).toBe('2026-11-20');
    // Valida que NÃO enviou os campos inexistentes que causavam PGRST204
    expect(payloadEnviado.data_inicio).toBeUndefined();
    expect(payloadEnviado.data_fim).toBeUndefined();

    // Valida que salvou no localStorage e chamou callback de sucesso com a nova data
    expect(localStorage.getItem('evento_ativo_data')).toBe('2026-11-20');
    expect(aoSalvarSucessoMock).toHaveBeenCalledWith('FETEC MS 2026', '2026-11-20');
  });

  it('3. RESILIÊNCIA: se o banco der erro de data_evento ausente, retenta salvando campos base sem crashar', async () => {
    let tentativa = 0;
    vi.mocked(supabase.from).mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        const chain: any = criarQueryChain({
          data: { id_evento: eventoIdTeste, nome_evento: 'FETEC MS 2026' },
          error: null,
        });
        chain.update = vi.fn().mockImplementation((payload: any) => {
          chamadasUpdateEventos.push(payload);
          tentativa++;
          if (tentativa === 1) {
            // 1ª tentativa simula erro de coluna data_evento não encontrada no schema cache
            return {
              eq: vi.fn().mockResolvedValue({
                error: { message: "Could not find the 'data_evento' column of 'eventos' in the schema cache", code: 'PGRST204' },
              }),
            };
          }
          // 2ª tentativa (fallback) sucede
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
        });
        return chain;
      }
      return criarQueryChain({ data: [], error: null });
    });

    render(<ProvedorAvisos><ProvedorIdentidadeVisual><ModalConfiguracoesEvento
        id_evento_ativo={eventoIdTeste}
        nome_evento_atual="FETEC MS 2026"
        ao_fechar={vi.fn()}
      /></ProvedorIdentidadeVisual></ProvedorAvisos>);

    const btnSalvar = await screen.findByRole('button', { name: /Salvar Configurações/i });
    fireEvent.click(btnSalvar);

    await waitFor(() => {
      expect(chamadasUpdateEventos.length).toBe(2);
    });

    // 1ª tentativa continha data_evento
    expect(chamadasUpdateEventos[0].data_evento).toBeDefined();
    // 2ª tentativa removeu data_evento para permitir salvar os demais dados com resiliência
    expect(chamadasUpdateEventos[1].data_evento).toBeUndefined();
  });
});
