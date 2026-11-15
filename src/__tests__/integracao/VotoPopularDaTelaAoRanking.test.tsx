import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProvedorAvisos } from '@/components/ui';
import { TelaAvaliador } from '@/features/avaliacao';
import { RankingPremiacao } from '@/features/relatorios';
import { supabase } from '@/lib/supabase';
import { obterPerfilSessao } from '@/features/auth';

/**
 * Voto popular atravessando duas features, com o mesmo projeto: o votante envia o voto na tela do
 * avaliador e o resultado aparece no ranking, em lista própria.
 *
 * Cada parte disso já tem teste de unidade. O que nenhum deles cobre é a travessia e,
 * principalmente, **o contrato com o banco**: no Vitest o Supabase é falso e nos testes pgTAP não
 * existe interface, então um `rpc()` com nome ou parâmetro errado passava pelos dois lados. Aqui as
 * chaves do payload são conferidas uma por uma contra a assinatura real de `fn_enviar_avaliacao`,
 * que `supabase/tests/36_contrato_rpcs_do_front_test.sql` prende do outro lado.
 *
 * O segundo caso é a regressão do L23: contagem de nota não volta para o navegador. A separação
 * entre voto popular e nota técnica é regra do banco ([ADR 0016]); a tela só pode exibir o que as
 * duas fontes devolvem, e não tocar em `avaliacoes` para recalcular nada.
 */

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }), getSession: vi.fn() },
  },
  isSupabaseConfigured: () => true,
  verificar_conexao_configurada: () => true,
}));

vi.mock('@/features/auth', () => ({
  obterPerfilSessao: vi.fn(),
}));

const EVENTO = 'e0000000-0000-0000-0000-000000000001';
const VOTANTE = 'u0000000-0000-0000-0000-0000000000v1';
const PROJETO = 'p0000000-0000-0000-0000-0000000000vp';
const QUESTIONARIO_VOTO = 'quest-voto-popular';
const QUESTIONARIO_TECNICO = 'quest-tecnico';

/** Parâmetros de `fn_enviar_avaliacao`, na ordem da assinatura do banco. */
const PARAMETROS_ENVIO = [
  'p_id_usuario',
  'p_id_projeto',
  'p_id_questionario',
  'p_respostas',
  'p_parecer',
  'p_tempo_presenca',
];

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
    range: vi.fn(() => Promise.resolve(resultado)),
    then: (resolver: (v: unknown) => unknown) => Promise.resolve(resultado).then(resolver),
  };
  return chain;
};

const perfilVotante = () => ({
  autenticado: true,
  papel: 'avaliador' as const,
  id_usuario: VOTANTE,
  nome: 'Visitante da Feira',
  email: 'visitante@ifms.edu.br',
  id_evento: EVENTO,
  metodos_vinculo: 'pareamento' as const,
  fixar_questionario: true,
  id_questionario_vinculado: QUESTIONARIO_VOTO,
  voto_popular: true,
});

/** O mesmo projeto do voto, como o banco o devolve já classificado e separado. */
const VOTO_POPULAR_NO_RANKING = [
  {
    id_projeto: PROJETO,
    codigo_projeto: 'VP-1',
    titulo: 'Horta Vertical',
    modalidade: 'Iniciação Científica',
    area_tematica: 'Ciências Agrárias',
    nome_instituicao: 'IFMS',
    total_votos: 12,
    media_simples: 9.5,
    media_bayesiana: 9.1,
    media_evento: 8.4,
    peso_ancora: 5,
    posicao: 1,
  },
];

describe('Voto popular: da tela do votante até o ranking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('sessao_id_usuario', VOTANTE);
    vi.mocked(obterPerfilSessao).mockResolvedValue(perfilVotante() as never);
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
        // O projeto tem questionário técnico fixado: o votante não pode receber esse
        return cadeia({
          data: { id_projeto: PROJETO, titulo: 'Horta Vertical', estande: 'EST-1', id_questionario_fixado: QUESTIONARIO_TECNICO },
          error: null,
        });
      }
      if (tabela === 'questionarios') {
        return cadeia({
          data: [
            { id_questionario: QUESTIONARIO_TECNICO, titulo: 'Avaliação Técnica', escala_minima: 1, escala_maxima: 5 },
            { id_questionario: QUESTIONARIO_VOTO, titulo: 'Voto Popular', escala_minima: 1, escala_maxima: 5 },
          ],
          error: null,
        });
      }
      if (tabela === 'perguntas_questionario') {
        return cadeia({ data: [{ id_pergunta: 'p-voto', texto_pergunta: 'Quanto você gostou?', ordem: 1 }], error: null });
      }
      return cadeia({ data: [], error: null });
    }) as never);
  });

  it('deve enviar o voto pela mesma RPC, com o questionário do voto popular e o payload que o banco espera', async () => {
    // Arrange
    render(
      <ProvedorAvisos>
        <TelaAvaliador id_usuario_logado={VOTANTE} id_evento_ativo={EVENTO} />
      </ProvedorAvisos>,
    );
    expect(await screen.findByText('Horta Vertical')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Presente/i }));
    const salvar = await screen.findByRole('button', { name: /Salvar Nota e Puxar Próximo/i });

    // Act
    fireEvent.click(screen.getAllByRole('radio', { name: /^Nota 5 de 5$/ })[0]);
    fireEvent.click(salvar);

    // Assert: nota do votante entra pelo mesmo caminho da nota técnica, nunca por INSERT direto
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('fn_enviar_avaliacao', expect.anything()));
    const chamada = vi.mocked(supabase.rpc).mock.calls.find((c) => c[0] === 'fn_enviar_avaliacao');
    const payload = chamada?.[1] as Record<string, unknown>;

    // O contrato: exatamente os parâmetros da assinatura do banco, sem sobra nem falta
    expect(Object.keys(payload).sort()).toEqual([...PARAMETROS_ENVIO].sort());

    // A regra do voto popular: o questionário é o vinculado ao votante, não o técnico do projeto
    expect(payload.p_id_questionario).toBe(QUESTIONARIO_VOTO);
    expect(payload.p_id_questionario).not.toBe(QUESTIONARIO_TECNICO);
    expect(payload.p_id_usuario).toBe(VOTANTE);
    expect(payload.p_id_projeto).toBe(PROJETO);
    expect(payload.p_respostas).toEqual([{ id_pergunta: 'p-voto', nota: 5 }]);

    // A nota final não vai do cliente: quem calcula é o banco
    expect(payload).not.toHaveProperty('nota_final');
  });

  it('deve mostrar o voto popular em lista própria no ranking, sem recontar nota no navegador', async () => {
    // Arrange: o ranking técnico vem da view e o voto popular da RPC própria
    const tabelasLidas: string[] = [];
    vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
      tabelasLidas.push(tabela);
      return cadeia({ data: [], error: null });
    }) as never);
    // A classificação técnica vem da view, já calculada pelo banco
    vi.mocked(supabase.rpc).mockImplementation(((nome: string) =>
      Promise.resolve(
        nome === 'fn_relatorio_voto_popular_completo'
          ? { data: VOTO_POPULAR_NO_RANKING, error: null }
          : { data: null, error: null },
      )) as never);

    // Act
    render(<RankingPremiacao id_evento_ativo={EVENTO} />);

    // Assert: o voto popular tem seção própria, com os números que o banco calculou
    expect(await screen.findByRole('heading', { name: /^voto popular$/i })).toBeInTheDocument();
    expect(screen.getByText(/9,10 pts/)).toBeInTheDocument();
    expect(screen.getByText(/média dos votos 9,50 · 12 votos/)).toBeInTheDocument();

    // O voto popular é pedido ao banco já separado, para o evento ativo
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fn_relatorio_voto_popular_completo',
      expect.objectContaining({ p_id_evento: EVENTO }),
    );

    // Regressão do L23: nenhuma leitura de `avaliacoes` crua para recalcular média na tela
    expect(tabelasLidas).not.toContain('avaliacoes');
    expect(tabelasLidas).not.toContain('respostas_avaliacao');
  });
});
