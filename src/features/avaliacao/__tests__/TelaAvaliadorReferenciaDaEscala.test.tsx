import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProvedorAvisos } from '@/components/ui';
import { TelaAvaliador } from '@/features/avaliacao';
import { supabase } from '@/lib/supabase';

/**
 * As âncoras da escala ficam num hint, não no corpo do texto de ajuda.
 *
 * O texto de ajuda dos modelos técnicos carregava duas coisas na mesma string: a orientação do
 * critério e o que vale 1, 3 e 5. Num celular, com dez critérios, isso vira um parágrafo que o
 * avaliador lê uma vez e ignora — justamente quando a âncora seria útil, na hora de dar a nota.
 * Agora a referência vem em `referencia_escala` e aparece num ícone "ⓘ" ao lado do enunciado.
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

const ORIENTACAO = 'Relevância e delimitação do problema e de quem é afetado por ele.';
const REFERENCIA =
  '1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante e bem delimitado';

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

/** @param perguntas as linhas que `perguntas_questionario` devolve. */
const montarSupabase = (perguntas: Record<string, unknown>[]) => {
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
      return cadeia({ data: { id_projeto: PROJETO, titulo: 'Projeto com Referência', estande: 'EST-9', id_questionario_fixado: 'quest-1' }, error: null });
    }
    if (tabela === 'questionarios') {
      return cadeia({ data: [{ id_questionario: 'quest-1', titulo: 'Técnico', escala_minima: 1, escala_maxima: 5 }], error: null });
    }
    if (tabela === 'perguntas_questionario') return cadeia({ data: perguntas, error: null });
    return cadeia({ data: [], error: null });
  }) as never);
};

const abrirFormulario = async () => {
  render(
    <ProvedorAvisos>
      <TelaAvaliador id_usuario_logado={AVALIADOR} id_evento_ativo={EVENTO} />
    </ProvedorAvisos>,
  );
  expect(await screen.findByText('Projeto com Referência')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Presente/i }));
  return screen.findByRole('button', { name: /Salvar Nota e Puxar Próximo/i });
};

describe('TelaAvaliador: referência da escala', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('sessao_id_usuario', AVALIADOR);
  });

  it('deve mostrar a orientação no corpo e as âncoras num hint nomeado pelo critério', async () => {
    // Arrange
    montarSupabase([
      { id_pergunta: 'p-1', texto_pergunta: 'Problema e Público-Alvo', ordem: 1, descricao_lembrete: ORIENTACAO, referencia_escala: REFERENCIA },
    ]);

    // Act
    await abrirFormulario();

    // Assert — a orientação continua visível no corpo do critério
    expect(screen.getByText(ORIENTACAO)).toBeInTheDocument();
    // e as âncoras saem do corpo: ficam no balão, ligado ao botão por aria-describedby
    const dica = screen.getByRole('button', { name: 'Referência de notas de 1. Problema e Público-Alvo' });
    const descricao = document.getElementById(dica.getAttribute('aria-describedby') ?? '');
    expect(descricao).toHaveAttribute('role', 'tooltip');
    expect(descricao?.textContent).toContain('1: Problema vago, sem público definido');
    expect(descricao?.textContent).toContain('5: Problema relevante e bem delimitado');
  });

  it('deve listar uma âncora por item ao abrir o hint, e fechar com Esc', async () => {
    // Arrange
    const user = userEvent.setup();
    montarSupabase([
      { id_pergunta: 'p-1', texto_pergunta: 'Problema e Público-Alvo', ordem: 1, descricao_lembrete: ORIENTACAO, referencia_escala: REFERENCIA },
    ]);
    await abrirFormulario();
    const dica = screen.getByRole('button', { name: /^Referência de notas de 1\./ });

    // Act
    await user.click(dica);

    // Assert
    expect(dica).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1: Problema vago, sem público definido',
      '3: Problema claro e público identificado',
      '5: Problema relevante e bem delimitado',
    ]);

    // Act
    await user.keyboard('{Escape}');

    // Assert
    expect(dica).toHaveAttribute('aria-expanded', 'false');
  });

  it('não deve mostrar hint em critério sem referência, mantendo o texto de ajuda intacto', async () => {
    // Arrange — é o caso dos modelos de voto popular e de feira de ciências
    montarSupabase([
      { id_pergunta: 'p-1', texto_pergunta: 'Problema e Hipótese', ordem: 1, descricao_lembrete: 'Clareza na formulação e nos objetivos.', referencia_escala: null },
    ]);

    // Act
    await abrirFormulario();

    // Assert
    expect(screen.getByText('Clareza na formulação e nos objetivos.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Referência de notas/ })).not.toBeInTheDocument();
  });

  it('deve nomear um hint por critério, para o leitor de tela não anunciar botões idênticos', async () => {
    // Arrange
    montarSupabase([
      { id_pergunta: 'p-1', texto_pergunta: 'Problema e Público-Alvo', ordem: 1, descricao_lembrete: ORIENTACAO, referencia_escala: '1: vago · 5: delimitado' },
      { id_pergunta: 'p-2', texto_pergunta: 'Coerência da Solução', ordem: 2, descricao_lembrete: 'Capacidade da solução.', referencia_escala: '1: não resolve · 5: resolve' },
    ]);

    // Act
    await abrirFormulario();

    // Assert
    expect(screen.getByRole('button', { name: 'Referência de notas de 1. Problema e Público-Alvo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Referência de notas de 2. Coerência da Solução' })).toBeInTheDocument();
  });
});
