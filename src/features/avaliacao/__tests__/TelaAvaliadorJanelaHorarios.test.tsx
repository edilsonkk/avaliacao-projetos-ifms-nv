import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProvedorAvisos } from '@/components/ui';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import {
  TelaAvaliador,
  validarJanelaAvaliacao,
  formatarDataBr,
  formatarHorarioBr,
  InfoJanelaEvento,
} from '@/features/avaliacao';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
  isSupabaseConfigured: () => true,
  verificar_conexao_configurada: () => true,
}));

describe('Auditoria e Testes da Janela Temporal de Avaliação e Fila Vazia na TelaAvaliador', () => {
  const eventoIdTeste = 'e0000000-0000-0000-0000-000000000001';
  const usuarioAvaliadorId = 'u0000000-0000-0000-0000-000000000001';

  const criarQueryChain = (resultadoFinal: any) => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(resultadoFinal),
      single: vi.fn().mockResolvedValue(resultadoFinal),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resultadoFinal).then(resolve),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('sessao_id_usuario', usuarioAvaliadorId);
    localStorage.setItem('avaliador_nome', 'Prof. Avaliador IFMS');
    localStorage.setItem('avaliador_email', 'avaliador@ifms.edu.br');
  });

  describe('1. Função Pura validarJanelaAvaliacao', () => {
    it('deve retornar horario_nao_configurado se dados do evento ou horários forem nulos/indefinidos', () => {
      const res1 = validarJanelaAvaliacao(null);
      expect(res1.status).toBe('horario_nao_configurado');

      const res2 = validarJanelaAvaliacao({
        id_evento: 'evt-1',
        data_evento: '2026-10-24',
        horario_inicio: null,
        horario_fim: '18:00',
      });
      expect(res2.status).toBe('horario_nao_configurado');
    });

    it('deve retornar sistema_bloqueado se sistema_liberado for false', () => {
      const info: InfoJanelaEvento = {
        id_evento: 'evt-1',
        data_evento: '2026-10-24',
        horario_inicio: '08:00',
        horario_fim: '18:00',
        sistema_liberado: false,
      };
      const res = validarJanelaAvaliacao(info, new Date(2026, 9, 24, 10, 0, 0));
      expect(res.status).toBe('sistema_bloqueado');
    });

    it('deve retornar antes_do_inicio quando o horário atual for anterior ao início previsto', () => {
      const info: InfoJanelaEvento = {
        id_evento: 'evt-1',
        data_evento: '2026-10-24',
        horario_inicio: '08:00',
        horario_fim: '18:00',
        sistema_liberado: true,
      };
      // Referência: 24/10/2026 às 07:45:00
      const agoraAntes = new Date(2026, 9, 24, 7, 45, 0);
      const res = validarJanelaAvaliacao(info, agoraAntes);

      expect(res.status).toBe('antes_do_inicio');
      expect(res.dataEventoFormatada).toBe('24/10/2026');
      expect(res.horarioInicioFormatado).toBe('08:00');
    });

    it('deve retornar liberado quando o horário atual estiver dentro da janela do evento', () => {
      const info: InfoJanelaEvento = {
        id_evento: 'evt-1',
        data_evento: '2026-10-24',
        horario_inicio: '08:00',
        horario_fim: '18:00',
        sistema_liberado: true,
      };
      // Referência: 24/10/2026 às 14:30:00
      const agoraDurante = new Date(2026, 9, 24, 14, 30, 0);
      const res = validarJanelaAvaliacao(info, agoraDurante);

      expect(res.status).toBe('liberado');
    });

    it('deve retornar apos_o_fim quando o horário atual for posterior ao término previsto', () => {
      const info: InfoJanelaEvento = {
        id_evento: 'evt-1',
        data_evento: '2026-10-24',
        horario_inicio: '08:00',
        horario_fim: '18:00',
        sistema_liberado: true,
      };
      // Referência: 24/10/2026 às 18:05:00
      const agoraDepois = new Date(2026, 9, 24, 18, 5, 0);
      const res = validarJanelaAvaliacao(info, agoraDepois);

      expect(res.status).toBe('apos_o_fim');
      expect(res.horarioFimFormatado).toBe('18:00');
    });

    it('formatadores auxiliares de data e horário', () => {
      expect(formatarDataBr('2026-10-24')).toBe('24/10/2026');
      expect(formatarDataBr('2026-10-24T00:00:00')).toBe('24/10/2026');
      expect(formatarHorarioBr('08:00:00')).toBe('08:00');
      expect(formatarHorarioBr('18:30')).toBe('18:30');
    });
  });

  describe('2. Renderização da Tela do Avaliador com Controle de Horário', () => {
    it('deve renderizar card informando que as avaliações não começaram com login OK antes do horário', async () => {
      vi.mocked(supabase.from).mockImplementation((tabela: string) => {
        if (tabela === 'eventos') {
          return criarQueryChain({
            data: {
              id_evento: eventoIdTeste,
              nome_evento: 'FETEC MS 2026',
              data_evento: '2099-12-31', // Data bem no futuro
              horario_inicio: '08:00',
              horario_fim: '18:00',
              sistema_liberado: true,
              is_ativo: true,
            },
            error: null,
          });
        }
        if (tabela === 'locks_ativos') {
          return criarQueryChain({ data: null, error: null });
        }
        return criarQueryChain({ data: [], error: null });
      });

      render(<ProvedorAvisos><TelaAvaliador
          id_usuario_logado={usuarioAvaliadorId}
          id_evento_ativo={eventoIdTeste}
        /></ProvedorAvisos>);

      // Deve exibir o badge de confirmação de login
      expect(await screen.findByText('Login Conectado com Sucesso')).toBeInTheDocument();
      // Título do estado antes do início
      expect(screen.getByText('As avaliações ainda não começaram')).toBeInTheDocument();
      // Detalhes da previsão
      expect(screen.getByText(/31\/12\/2099/)).toBeInTheDocument();
      expect(screen.getByText(/08:00/)).toBeInTheDocument();
      // Botões disponíveis
      expect(screen.getByRole('button', { name: /Atualizar \/ Verificar Horário/i })).toBeInTheDocument();
      // Dois caminhos de saída na tela (barra de identificação e cartão), com o mesmo rótulo
      expect(screen.getAllByRole('button', { name: /Sair e desvincular/i })).toHaveLength(2);
    });

    it('deve renderizar card de avaliações encerradas quando o horário final já expirou', async () => {
      vi.mocked(supabase.from).mockImplementation((tabela: string) => {
        if (tabela === 'eventos') {
          return criarQueryChain({
            data: {
              id_evento: eventoIdTeste,
              nome_evento: 'FETEC MS 2026',
              data_evento: '2020-01-01', // Data no passado
              horario_inicio: '08:00',
              horario_fim: '18:00',
              sistema_liberado: true,
              is_ativo: true,
            },
            error: null,
          });
        }
        if (tabela === 'locks_ativos') {
          return criarQueryChain({ data: null, error: null });
        }
        return criarQueryChain({ data: [], error: null });
      });

      render(<ProvedorAvisos><TelaAvaliador
          id_usuario_logado={usuarioAvaliadorId}
          id_evento_ativo={eventoIdTeste}
        /></ProvedorAvisos>);

      expect(await screen.findByText('Avaliações Encerradas')).toBeInTheDocument();
      expect(screen.getByText(/O período de avaliação deste evento terminou/i)).toBeInTheDocument();
      // Dois caminhos de saída na tela (barra de identificação e cartão), com o mesmo rótulo
      expect(screen.getAllByRole('button', { name: /Sair e desvincular/i })).toHaveLength(2);
    });

    it('deve renderizar card de aviso quando os horários não estiverem configurados na tabela do evento', async () => {
      vi.mocked(supabase.from).mockImplementation((tabela: string) => {
        if (tabela === 'eventos') {
          return criarQueryChain({
            data: {
              id_evento: eventoIdTeste,
              nome_evento: 'FETEC MS 2026',
              data_evento: null,
              horario_inicio: null,
              horario_fim: null,
              is_ativo: true,
            },
            error: null,
          });
        }
        if (tabela === 'locks_ativos') {
          return criarQueryChain({ data: null, error: null });
        }
        return criarQueryChain({ data: [], error: null });
      });

      render(<ProvedorAvisos><TelaAvaliador
          id_usuario_logado={usuarioAvaliadorId}
          id_evento_ativo={eventoIdTeste}
        /></ProvedorAvisos>);

      expect(await screen.findByText('Login Conectado com Sucesso')).toBeInTheDocument();
      expect(screen.getByText('Horários em Configuração')).toBeInTheDocument();
      expect(screen.getByText(/ainda estão sendo configurados pela coordenação/i)).toBeInTheDocument();
    });

    it('deve remover o subtítulo longo na mensagem de fila vazia', async () => {
      // Mock do evento liberado e sem novos projetos (fila vazia na RPC)
      vi.mocked(supabase.from).mockImplementation((tabela: string) => {
        if (tabela === 'eventos') {
          return criarQueryChain({
            data: {
              id_evento: eventoIdTeste,
              nome_evento: 'FETEC MS 2026',
              data_evento: (() => {
                const h = new Date();
                return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
              })(),
              horario_inicio: '00:00',
              horario_fim: '23:59',
              sistema_liberado: true,
              is_ativo: true,
            },
            error: null,
          });
        }
        if (tabela === 'locks_ativos' || tabela === 'fila_atribuicoes_direcionadas') {
          return criarQueryChain({ data: null, error: null });
        }
        return criarQueryChain({ data: [], error: null });
      });

      vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as any);

      render(<ProvedorAvisos><TelaAvaliador
          id_usuario_logado={usuarioAvaliadorId}
          id_evento_ativo={eventoIdTeste}
        /></ProvedorAvisos>);

      // Aguarda a mensagem de fila vazia aparecer
      expect(await screen.findByText(/Todos os projetos disponíveis já foram avaliados ou bloqueados/i)).toBeInTheDocument();

      // REGRA: O subtítulo longo DEVE TER SIDO REMOVIDO!
      const subtituloLongo = screen.queryByText('Todos os projetos disponíveis já foram avaliados ou não há novas atribuições pendentes no momento.');
      expect(subtituloLongo).toBeNull();

      // Botão Consultar Novamente deve estar presente
      expect(screen.getByRole('button', { name: /Consultar Novamente/i })).toBeInTheDocument();
    });

    it('deve permitir concluir e enviar avaliação em andamento mesmo se o horário final expirou', async () => {
      const idProjetoEmAndamento = 'p0000000-0000-0000-0000-000000000099';

      // O envio agora passa pela RPC server-side fn_enviar_avaliacao (gravação
      // segura: trava, cota, janela, escala e nota_final calculados no banco).
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { sucesso: true, id_avaliacao: 'aval-123', nota_final: 4.5 },
        error: null,
      } as any);

      vi.mocked(supabase.from).mockImplementation((tabela: string) => {
        if (tabela === 'eventos') {
          return criarQueryChain({
            data: {
              id_evento: eventoIdTeste,
              nome_evento: 'FETEC MS 2026',
              data_evento: '2020-01-01', // Data já encerrada
              horario_inicio: '08:00',
              horario_fim: '18:00',
              sistema_liberado: true,
              is_ativo: true,
            },
            error: null,
          });
        }
        if (tabela === 'locks_ativos') {
          // Possui projeto em andamento
          return criarQueryChain({ data: { id_projeto: idProjetoEmAndamento }, error: null });
        }
        if (tabela === 'avaliador_modalidades_bloqueadas') {
          return criarQueryChain({ data: [], error: null });
        }
        if (tabela === 'projetos') {
          return criarQueryChain({
            data: {
              id_projeto: idProjetoEmAndamento,
              titulo: 'Projeto Iniciado Antes do Término',
              estande: 'EST-10',
              corredor: 'C',
              nome_instituicao: 'IFMS Teste',
              id_questionario_fixado: 'quest-1',
            },
            error: null,
          });
        }
        if (tabela === 'questionarios' || tabela === 'questionario') {
          return criarQueryChain({
            data: [
              {
                id_questionario: 'quest-1',
                titulo: 'Critérios Gerais IFMS',
                escala_minima: 1,
                escala_maxima: 5,
              },
            ],
            error: null,
          });
        }
        if (tabela === 'perguntas_questionario') {
          return criarQueryChain({
            data: [
              {
                id_pergunta: 'p-1',
                titulo_criterio: 'Critério 1',
                descricao_criterio: 'Descrição do critério',
                ordem: 1,
              },
            ],
            error: null,
          });
        }
        if (tabela === 'avaliacoes') {
          return criarQueryChain({ data: null, error: null });
        }
        if (tabela === 'respostas_avaliacao') {
          return criarQueryChain({ error: null });
        }
        return criarQueryChain({ data: [], error: null });
      });

      render(<ProvedorAvisos><TelaAvaliador
          id_usuario_logado={usuarioAvaliadorId}
          id_evento_ativo={eventoIdTeste}
        /></ProvedorAvisos>);

      // Deve exibir o projeto em andamento na tela normalmente
      expect(await screen.findByText('Projeto Iniciado Antes do Término')).toBeInTheDocument();
      expect(screen.getByText(/EST-10/)).toBeInTheDocument();

      // Confirma presença
      const btnPresente = screen.getByRole('button', { name: /Presente/i });
      fireEvent.click(btnPresente);

      // Botão de salvar avaliação fica habilitado
      const btnSalvar = await screen.findByRole('button', { name: /Salvar Nota e Puxar Próximo/i });
      expect(btnSalvar).toBeInTheDocument();

      // Ao enviar a avaliação:
      fireEvent.click(btnSalvar);

      await waitFor(() => {
        expect(supabase.rpc).toHaveBeenCalledWith(
          'fn_enviar_avaliacao',
          expect.objectContaining({ p_id_projeto: idProjetoEmAndamento })
        );
      });
    });

    it('sem internet, avisa que a avaliação NÃO foi enviada, mantém o projeto e não guarda notas no navegador', async () => {
      // Arrange
      const idProjeto = 'p0000000-0000-0000-0000-000000000077';
      localStorage.clear();
      vi.mocked(supabase.rpc).mockReset().mockResolvedValue({ data: null, error: null } as any);
      vi.mocked(supabase.from).mockImplementation((tabela: string) => {
        if (tabela === 'eventos') {
          return criarQueryChain({ data: { id_evento: eventoIdTeste, data_evento: '2020-01-01', horario_inicio: '08:00', horario_fim: '18:00', sistema_liberado: true }, error: null });
        }
        if (tabela === 'locks_ativos') return criarQueryChain({ data: { id_projeto: idProjeto }, error: null });
        if (tabela === 'projetos') {
          return criarQueryChain({ data: { id_projeto: idProjeto, titulo: 'Projeto Sem Rede', estande: 'EST-7', id_questionario_fixado: 'quest-1' }, error: null });
        }
        if (tabela === 'questionarios') {
          return criarQueryChain({ data: [{ id_questionario: 'quest-1', titulo: 'Q', escala_minima: 1, escala_maxima: 5 }], error: null });
        }
        if (tabela === 'perguntas_questionario') {
          return criarQueryChain({ data: [{ id_pergunta: 'p-1', titulo_criterio: 'Critério 1', ordem: 1 }], error: null });
        }
        return criarQueryChain({ data: [], error: null });
      });
      render(<ProvedorAvisos><TelaAvaliador id_usuario_logado={usuarioAvaliadorId} id_evento_ativo={eventoIdTeste} /></ProvedorAvisos>);
      expect(await screen.findByText('Projeto Sem Rede')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Presente/i }));
      const btnSalvar = await screen.findByRole('button', { name: /Salvar Nota e Puxar Próximo/i });
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      // Act
      fireEvent.click(btnSalvar);

      // Assert
      expect(await screen.findByText(/não foi enviada/i)).toBeInTheDocument();
      expect(screen.getByText('Projeto Sem Rede')).toBeInTheDocument();
      expect(supabase.rpc).not.toHaveBeenCalledWith('fn_enviar_avaliacao', expect.anything());
      expect(localStorage.getItem('avaliacoes_offline_pendentes')).toBeNull();
      online.mockRestore();
    });
    it('lista só os questionários do evento ativo (os de eventos anteriores seriam recusados no envio)', async () => {
      // Arrange
      const idProjeto = 'p0000000-0000-0000-0000-000000000088';
      localStorage.clear();
      vi.mocked(supabase.rpc).mockReset().mockResolvedValue({ data: null, error: null } as any);
      const consultaQuestionarios = criarQueryChain({
        data: [
          { id_questionario: 'quest-1', titulo: 'Técnico · Nível 1 Ideia', escala_minima: 1, escala_maxima: 5 },
          { id_questionario: 'quest-2', titulo: 'Técnico · Nível 2 Protótipo', escala_minima: 1, escala_maxima: 5 },
        ],
        error: null,
      });
      vi.mocked(supabase.from).mockImplementation((tabela: string) => {
        if (tabela === 'eventos') {
          return criarQueryChain({ data: { id_evento: eventoIdTeste, data_evento: '2020-01-01', horario_inicio: '08:00', horario_fim: '18:00', sistema_liberado: true }, error: null });
        }
        if (tabela === 'locks_ativos') return criarQueryChain({ data: { id_projeto: idProjeto }, error: null });
        if (tabela === 'projetos') {
          return criarQueryChain({ data: { id_projeto: idProjeto, titulo: 'Projeto Sem Questionário', estande: 'EST-8', id_questionario_fixado: null }, error: null });
        }
        if (tabela === 'questionarios') return consultaQuestionarios;
        return criarQueryChain({ data: [], error: null });
      });

      // Act
      render(<ProvedorAvisos><TelaAvaliador id_usuario_logado={usuarioAvaliadorId} id_evento_ativo={eventoIdTeste} /></ProvedorAvisos>);
      expect(await screen.findByText('Projeto Sem Questionário')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Presente/i }));

      // Assert
      expect(await screen.findByText('Técnico · Nível 2 Protótipo')).toBeInTheDocument();
      expect(consultaQuestionarios.eq).toHaveBeenCalledWith('id_evento', eventoIdTeste);
    });
  });
});
