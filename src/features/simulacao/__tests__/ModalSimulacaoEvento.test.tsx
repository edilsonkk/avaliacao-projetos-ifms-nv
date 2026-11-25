import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const { mockFrom, mockRpc, mockGetSession, ambiente } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockGetSession: vi.fn(),
  ambiente: { atual: 'local' as 'local' | 'producao' },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc, auth: { getSession: mockGetSession } },
  get ambiente_supabase() { return ambiente.atual; },
  configuracao_supabase: { valida: true, url: 'http://127.0.0.1:54321', chaveAnonima: 'anon' },
  verificar_conexao_configurada: () => true,
}));

/** O motor não roda na prova da interface: o laço tem teste próprio, sem jsdom. */
const { mockExecutar, mockPausar, mockRetomar, mockEncerrar, mockVelocidade } = vi.hoisted(() => ({
  mockExecutar: vi.fn(),
  mockPausar: vi.fn(),
  mockRetomar: vi.fn(),
  mockEncerrar: vi.fn(),
  mockVelocidade: vi.fn(),
}));

vi.mock('@/lib/simulacao/motor', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  criarMotorSimulacao: vi.fn(() => ({
    executar: mockExecutar,
    pausar: mockPausar,
    retomar: mockRetomar,
    encerrar: mockEncerrar,
    ajustarVelocidade: mockVelocidade,
    estado: () => ({ fase: 'rodando' }),
  })),
}));

import { ModalSimulacaoEvento } from '@/features/simulacao';
import { ProvedorAvisos } from '@/components/ui';
import { PREFIXO_EVENTO_SIMULACAO } from '@/lib/simulacao/dados';

const NOME_EVENTO_ATIVO = 'FETEC-MS 2026';

const cadeia = (dados: unknown[]) => {
  const chain: Record<string, unknown> = {};
  for (const metodo of ['select', 'eq', 'order', 'like', 'in', 'limit', 'delete', 'insert', 'upsert', 'update']) {
    chain[metodo] = vi.fn(() => chain);
  }
  chain['maybeSingle'] = vi.fn(() => Promise.resolve({ data: dados[0] ?? null, error: null }));
  chain['then'] = (ok: (v: unknown) => unknown, naoOk?: (e: unknown) => unknown) =>
    Promise.resolve({ data: dados, error: null }).then(ok, naoOk);
  chain['range'] = vi.fn(() => Promise.resolve({ data: dados, error: null }));
  return chain;
};

const montar = () => render(
  <ProvedorAvisos>
    <ModalSimulacaoEvento aberto aoFechar={() => {}} />
  </ProvedorAvisos>,
);

/** Espera o pré-voo terminar: o formulário só aparece depois dele. */
const esperarFormulario = async () => {
  await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Projetos' })).toBeInTheDocument());
};

beforeEach(() => {
  ambiente.atual = 'local';
  mockFrom.mockReset().mockImplementation((tabela: string) => {
    if (tabela === 'eventos') {
      return cadeia([{
        id_evento: 'e-real',
        nome_evento: NOME_EVENTO_ATIVO,
        is_ativo: true,
        descricao: null,
      }]);
    }
    return cadeia([]);
  });
  mockRpc.mockReset().mockResolvedValue({ data: false, error: null });
  mockGetSession.mockReset().mockResolvedValue({
    data: { session: { access_token: 'token' } }, error: null,
  });
  mockExecutar.mockReset().mockResolvedValue({
    fase: 'encerrada', enviadas: 0, votosPopulares: 0, checkInsFeitos: 0,
    projetosConcluidos: 0, recusadasPorRegra: {}, erros: {}, avaliadoresAtivos: 0,
    emVoo: 0, iniciadoEm: 1, atualizadoEm: 2, motivoDaParada: 'teste',
  });
  [mockPausar, mockRetomar, mockEncerrar, mockVelocidade].forEach((m) => m.mockReset());
});

describe('ModalSimulacaoEvento — configuração', () => {
  it('mostra os campos da simulação com rótulos acessíveis', async () => {
    // Arrange / Act
    montar();
    await esperarFormulario();

    // Assert
    for (const rotulo of [
      'Projetos', 'Avaliadores', 'Staff', 'Avaliações por projeto', 'Questionários técnicos',
      'Semente do sorteio', 'Tempo entre avaliações (ms)', 'Requisições simultâneas',
      'Voto popular (%)', 'Check-in (%)', 'Credenciamento (%)', 'Dispersão das notas (%)',
      'Projetos divergentes (%)',
    ]) {
      expect(screen.getByRole('spinbutton', { name: rotulo }), rotulo).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'Modo de sessão' })).toBeInTheDocument();
  });

  it('informa quantas avaliações a configuração pede', async () => {
    // Arrange / Act
    montar();
    await esperarFormulario();

    // Assert — 40 projetos x cota 3
    expect(screen.getByText(/pede 120 avaliações técnicas/i)).toBeInTheDocument();
  });

  it('em local, habilita iniciar sem exigir o nome do evento', async () => {
    // Arrange / Act
    montar();
    await esperarFormulario();

    // Assert
    expect(screen.getByRole('button', { name: /iniciar simulação/i })).toBeEnabled();
  });

  it('em local, oferece o modo de sessão por avaliador', async () => {
    // Arrange / Act
    montar();
    await esperarFormulario();

    // Assert
    const opcao = screen.getByRole('option', { name: /uma sessão por avaliador/i });
    expect(opcao).toBeEnabled();
  });
});

describe('ModalSimulacaoEvento — guardas de produção', () => {
  beforeEach(() => { ambiente.atual = 'producao'; });

  it('avisa que o evento ativo será trocado', async () => {
    // Arrange / Act
    montar();
    await esperarFormulario();

    // Assert
    expect(screen.getByText(/este é o banco de produção/i)).toBeInTheDocument();
    expect(screen.getByText(/deixam de mostrar|passam a mostrar a feira fictícia/i)).toBeInTheDocument();
  });

  it('só habilita iniciar depois do nome exato do evento ativo', async () => {
    // Arrange
    const usuario = userEvent.setup();
    montar();
    await esperarFormulario();
    const iniciar = screen.getByRole('button', { name: /iniciar simulação/i });

    // Assert — bloqueado antes de digitar
    expect(iniciar).toBeDisabled();

    // Act — nome errado
    const campo = screen.getByRole('textbox', { name: new RegExp(NOME_EVENTO_ATIVO, 'i') });
    await usuario.type(campo, 'outro evento');

    // Assert
    expect(screen.getByText(/o nome não confere/i)).toBeInTheDocument();
    expect(iniciar).toBeDisabled();

    // Act — nome certo
    await usuario.clear(campo);
    await usuario.type(campo, NOME_EVENTO_ATIVO);

    // Assert
    await waitFor(() => expect(iniciar).toBeEnabled());
  });

  it('recusa o modo de sessão por avaliador, com a razão na tela', async () => {
    // Arrange / Act
    montar();
    await esperarFormulario();

    // Assert — a conta anônima ficaria para sempre em produção
    expect(screen.getByRole('option', { name: /só no banco local/i })).toBeDisabled();
  });

  it('alerta quando a janela de avaliação do evento real está aberta', async () => {
    // Arrange — fn_janela_avaliacao_aberta devolve true
    mockRpc.mockResolvedValue({ data: true, error: null });

    // Act
    montar();
    await esperarFormulario();

    // Assert
    expect(screen.getByText(/há feira em andamento/i)).toBeInTheDocument();
  });

  it('bloqueia volume acima do limite do ambiente e explica', async () => {
    // Arrange
    const usuario = userEvent.setup();
    montar();
    await esperarFormulario();

    // Act — 500 projetos passa do teto de produção
    const projetos = screen.getByRole('spinbutton', { name: 'Projetos' });
    await usuario.clear(projetos);
    await usuario.type(projetos, '500');

    // Assert
    await waitFor(() => expect(screen.getByText(/ajuste a configuração/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /iniciar simulação/i })).toBeDisabled();
  });
});

describe('ModalSimulacaoEvento — simulações já no banco', () => {
  it('oferece encerrar a simulação que ficou ativa de uma rodada anterior', async () => {
    // Arrange — a aba foi fechada no meio e a simulação continuou ativa
    mockFrom.mockImplementation((tabela: string) => {
      if (tabela !== 'eventos') return cadeia([]);
      return cadeia([{
        id_evento: 'e-sim',
        nome_evento: `${PREFIXO_EVENTO_SIMULACAO} 2026-11-23 10:00:00`,
        is_ativo: true,
        descricao: `Simulação criada pelo painel do Admin. Evento ativo anterior: "${NOME_EVENTO_ATIVO}".`,
      }]);
    });

    // Act
    montar();

    // Assert
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /encerrar e restaurar/i })).toBeInTheDocument());
  });
});
