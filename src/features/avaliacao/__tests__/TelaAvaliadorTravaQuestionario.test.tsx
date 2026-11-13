import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProvedorAvisos } from '@/components/ui';
import { TelaAvaliador } from '@/features/avaliacao';
import { supabase } from '@/lib/supabase';
import { obterPerfilSessao } from '@/features/auth';

/**
 * A trava do questionário no primeiro avaliador é opção do evento
 * (`eventos.fixar_questionario_primeira_avaliacao`, lida por `fn_meu_perfil`).
 *
 * Ligada: o projeto já chega com o questionário imposto e o avaliador não troca.
 * Desligada: o avaliador escolhe, mesmo que o projeto tenha `id_questionario_fixado` gravado de
 * antes — e é o banco que decide, não esta tela.
 */

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
  },
  isSupabaseConfigured: () => true,
  verificar_conexao_configurada: () => true,
}));

vi.mock('@/features/auth', () => ({
  obterPerfilSessao: vi.fn(),
}));

const EVENTO = 'e0000000-0000-0000-0000-000000000001';
const AVALIADOR = 'u0000000-0000-0000-0000-000000000001';
const PROJETO = 'p0000000-0000-0000-0000-000000000077';

const cadeia = (resultado: unknown) => {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    update: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(resultado)),
    single: vi.fn(() => Promise.resolve(resultado)),
    insert: vi.fn(() => Promise.resolve({ error: null })),
    upsert: vi.fn(() => Promise.resolve({ error: null })),
    then: (resolver: (v: unknown) => unknown) => Promise.resolve(resultado).then(resolver),
  };
  return chain;
};

const perfil = (fixar: boolean, vinculado: string | null = null, votoPopular = false) => ({
  autenticado: true,
  papel: 'avaliador' as const,
  id_usuario: AVALIADOR,
  nome: 'Ana',
  email: 'ana@ifms.edu.br',
  id_evento: EVENTO,
  metodos_vinculo: 'pareamento' as const,
  fixar_questionario: fixar,
  id_questionario_vinculado: vinculado,
  voto_popular: votoPopular,
});

describe('TelaAvaliador: trava do questionário conforme o evento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('sessao_id_usuario', AVALIADOR);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
    vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
      if (tabela === 'eventos') {
        return cadeia({
          data: { id_evento: EVENTO, data_evento: '2020-01-01', horario_inicio: '08:00', horario_fim: '18:00', sistema_liberado: true },
          error: null,
        });
      }
      if (tabela === 'locks_ativos') return cadeia({ data: { id_projeto: PROJETO }, error: null });
      if (tabela === 'projetos') {
        // Projeto com questionário já fixado: é o caso em que a opção muda o comportamento
        return cadeia({ data: { id_projeto: PROJETO, titulo: 'Projeto com Fixado', estande: 'EST-7', id_questionario_fixado: 'quest-1' }, error: null });
      }
      if (tabela === 'questionarios') {
        return cadeia({
          data: [
            { id_questionario: 'quest-1', titulo: 'Questionário Técnico', escala_minima: 1, escala_maxima: 5 },
            { id_questionario: 'quest-2', titulo: 'Questionário Alternativo', escala_minima: 1, escala_maxima: 5 },
          ],
          error: null,
        });
      }
      if (tabela === 'perguntas_questionario') {
        return cadeia({ data: [{ id_pergunta: 'p-1', texto_pergunta: 'Primeiro critério', ordem: 1 }], error: null });
      }
      return cadeia({ data: [], error: null });
    }) as never);
  });

  const abrir = async () => {
    render(
      <ProvedorAvisos>
        <TelaAvaliador id_usuario_logado={AVALIADOR} id_evento_ativo={EVENTO} />
      </ProvedorAvisos>,
    );
    expect(await screen.findByText('Projeto com Fixado')).toBeInTheDocument();
    // O questionário só entra em cena depois de confirmar a presença no estande
    fireEvent.click(screen.getByRole('button', { name: /Presente/i }));
  };

  it('com a trava ligada, deve usar o questionário fixado e não oferecer troca', async () => {
    // Arrange
    vi.mocked(obterPerfilSessao).mockResolvedValue(perfil(true) as never);

    // Act
    await abrir();

    // Assert
    expect(await screen.findByText(/questionário oficial vinculado/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trocar questionário/i })).not.toBeInTheDocument();
  });

  it('votante deve abrir direto no questionário vinculado, sem escolher nada', async () => {
    // Arrange: vinculado ao questionário de voto popular
    vi.mocked(obterPerfilSessao).mockResolvedValue(perfil(true, 'quest-2', true) as never);

    // Act
    await abrir();

    // Assert: o rótulo diz que é voto popular e não há troca de questionário
    expect(await screen.findByText(/voto popular/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trocar questionário/i })).not.toBeInTheDocument();
    // Não oferece o questionário técnico do projeto
    expect(screen.queryByText(/questionário oficial vinculado/i)).not.toBeInTheDocument();
  });

  it('com a trava desligada, deve deixar o avaliador escolher o questionário', async () => {
    // Arrange
    vi.mocked(obterPerfilSessao).mockResolvedValue(perfil(false) as never);

    // Act
    await abrir();

    // Assert
    await waitFor(() => expect(screen.queryByText(/questionário oficial vinculado/i)).not.toBeInTheDocument());
    expect(screen.getByText(/questionário alternativo/i)).toBeInTheDocument();
  });
});
