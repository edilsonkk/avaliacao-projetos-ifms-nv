import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProvedorAvisos } from '@/components/ui';
import { TelaAvaliador } from '@/features/avaliacao';
import { supabase } from '@/lib/supabase';

/**
 * O formulário começa em branco e o envio exige nota em todos os critérios.
 * Antes, as notas vinham pré-marcadas com o MÁXIMO da escala: quem apertasse "Salvar" sem
 * olhar dava nota cheia, e nada na avaliação distinguia isso de uma decisão do avaliador.
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

const EVENTO = 'e0000000-0000-0000-0000-000000000001';
const AVALIADOR = 'u0000000-0000-0000-0000-000000000001';
const PROJETO = 'p0000000-0000-0000-0000-000000000099';

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

describe('TelaAvaliador: formulário sem nota pré-marcada', () => {
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
        return cadeia({ data: { id_projeto: PROJETO, titulo: 'Projeto em Branco', estande: 'EST-9', id_questionario_fixado: 'quest-1' }, error: null });
      }
      if (tabela === 'questionarios') {
        return cadeia({ data: [{ id_questionario: 'quest-1', titulo: 'Q', escala_minima: 1, escala_maxima: 5 }], error: null });
      }
      if (tabela === 'perguntas_questionario') {
        return cadeia({
          data: [
            { id_pergunta: 'p-1', texto_pergunta: 'Primeiro critério', ordem: 1 },
            { id_pergunta: 'p-2', texto_pergunta: 'Segundo critério', ordem: 2 },
          ],
          error: null,
        });
      }
      return cadeia({ data: [], error: null });
    }) as never);
  });

  const abrirFormulario = async () => {
    render(
      <ProvedorAvisos>
        <TelaAvaliador id_usuario_logado={AVALIADOR} id_evento_ativo={EVENTO} />
      </ProvedorAvisos>,
    );
    expect(await screen.findByText('Projeto em Branco')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Presente/i }));
    return screen.findByRole('button', { name: /Salvar Nota e Puxar Próximo/i });
  };

  it('deve começar sem nenhuma nota marcada', async () => {
    // Arrange / Act
    await abrirFormulario();

    // Assert — nenhuma das escalas vem preenchida
    const marcados = screen.getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked);
    expect(marcados).toHaveLength(0);
  });

  it('deve bloquear o envio e dizer quantos critérios faltam', async () => {
    // Arrange / Act
    const salvar = await abrirFormulario();

    // Assert
    expect(salvar).toBeDisabled();
    expect(screen.getByText(/Falta dar nota em 2 de 2 critério\(s\)/)).toBeInTheDocument();

    // Act — uma nota só não basta
    fireEvent.click(screen.getAllByRole('radio', { name: /^Nota 4 de 5$/ })[0]);

    // Assert
    expect(salvar).toBeDisabled();
    expect(screen.getByText(/Falta dar nota em 1 de 2 critério\(s\)/)).toBeInTheDocument();
  });

  it('deve liberar o envio quando todos os critérios têm nota, e enviar pela RPC', async () => {
    // Arrange
    const salvar = await abrirFormulario();

    // Act
    fireEvent.click(screen.getAllByRole('radio', { name: /^Nota 4 de 5$/ })[0]);
    fireEvent.click(screen.getAllByRole('radio', { name: /^Nota 2 de 5$/ })[1]);

    // Assert
    expect(salvar).toBeEnabled();
    expect(screen.queryByText(/Falta dar nota em/)).not.toBeInTheDocument();

    // Act
    fireEvent.click(salvar);

    // Assert — a nota final não vai do cliente: quem calcula é fn_enviar_avaliacao
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith(
        'fn_enviar_avaliacao',
        expect.objectContaining({
          p_id_projeto: PROJETO,
          p_respostas: [
            { id_pergunta: 'p-1', nota: 4 },
            { id_pergunta: 'p-2', nota: 2 },
          ],
        }),
      ),
    );
    const chamada = vi.mocked(supabase.rpc).mock.calls.find((c) => c[0] === 'fn_enviar_avaliacao');
    expect(chamada?.[1]).not.toHaveProperty('p_nota_final');
  });
});
