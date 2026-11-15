import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProvedorAvisos } from '@/components/ui';
import { AbaProjeto } from '../components/AbaProjeto';
import { buscarAvaliadoresDoEvento, buscarMemorialPorCodigo } from '../api';
import type { MemorialAvaliacao, MemorialProjeto } from '../tipos';

/**
 * A conferência de um projeto: a média aberta, o memorial de cada nota e os achados.
 *
 * A busca é pelo `codigo_projeto`, nunca por UUID — regra 6 do AGENTS.md, e aqui ela vale duas
 * vezes, porque esta é a tela que a coordenação usa para justificar nota a quem reclama.
 */

vi.mock('../api', () => ({
  buscarMemorialPorCodigo: vi.fn(),
  buscarAvaliadoresDoEvento: vi.fn(),
  buscarMemorialProjeto: vi.fn(),
  corrigirRespostas: vi.fn(),
  arbitrarNotaFinal: vi.fn(),
  lancarAvaliacao: vi.fn(),
  ajustarMediaProjeto: vi.fn(),
}));

const EVENTO = 'e0000000-0000-0000-0000-000000000001';
const ID_PROJETO = 'f0000000-0000-0000-0000-0000000000a9';

const avaliacao = (over: Partial<MemorialAvaliacao> = {}): MemorialAvaliacao => ({
  id_avaliacao: 'av-1',
  codigo_projeto: 'PROJ-007',
  titulo_projeto: 'Horta Vertical',
  avaliador: { id_usuario: 'u-1', nome: 'Ana Souza', email: 'ana@ifms.edu.br' },
  status: 'CONCLUIDA',
  enviada_em: '2026-11-13T09:30:00-04:00',
  presenca_em: '2026-11-13T09:20:00-04:00',
  criada_em: '2026-11-13T09:20:00-04:00',
  parecer: 'Projeto bem apresentado',
  is_quarentena: false,
  cancelada_em: null,
  cancelada_por: null,
  questionario: { id_questionario: 'q-1', titulo: 'Técnico', escala_minima: 1, escala_maxima: 10 },
  criterios: [
    { id_pergunta: 'p-1', ordem: 1, criterio: 'Metodologia', ajuda: null, peso_calculo: 1, peso_desempate: 1, nota: 8, produto: 8 },
  ],
  soma_produtos: 8,
  soma_pesos: 1,
  nota_bruta: 8,
  nota_arredondada: 8,
  nota_gravada: 8,
  confere: true,
  motivo_do_log: null,
  ajuste: null,
  ...over,
});

const memorial = (over: Partial<MemorialProjeto> = {}): MemorialProjeto => ({
  id_projeto: ID_PROJETO,
  codigo_projeto: 'PROJ-007',
  titulo: 'Horta Vertical',
  modalidade: 'Iniciação Científica',
  area_tematica: 'Ciências Agrárias',
  instituicao: 'IFMS Naviraí',
  estande: 'A-12',
  check_in: true,
  fora_da_competicao: false,
  cota: 3,
  questionario_fixado: null,
  avaliacoes_ativas: [avaliacao()],
  avaliacoes_canceladas: [],
  total_avaliacoes: 1,
  notas: [8],
  media_geral: 8,
  ajuste_media: 0,
  media_final: 8,
  ajuste_media_em: null,
  ajuste_media_motivo: null,
  ajuste_media_por: null,
  media_do_ranking: 8,
  posicao_no_ranking: 2,
  desempate: { chave: [8], por_prioridade: [] },
  quarentena: { pendente: false, nota_minima: null, nota_maxima: null, divergencia: null, limite: 2, resolvida_em: null, resolvida_por: null },
  achados: [],
  trilha: [],
  trilha_comeca_em: null,
  ...over,
});

const abrir = (props: Partial<React.ComponentProps<typeof AbaProjeto>> = {}) =>
  render(
    <ProvedorAvisos>
      <AbaProjeto idEvento={EVENTO} {...props} />
    </ProvedorAvisos>,
  );

describe('AbaProjeto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buscarAvaliadoresDoEvento).mockResolvedValue([]);
    vi.mocked(buscarMemorialPorCodigo).mockResolvedValue(memorial());
  });

  it('deve pedir o projeto pelo código, no evento ativo', async () => {
    // Arrange
    abrir();

    // Act
    await userEvent.type(screen.getByLabelText(/código do projeto/i), 'PROJ-007');
    await userEvent.click(screen.getByRole('button', { name: /abrir conferência/i }));

    // Assert
    expect(buscarMemorialPorCodigo).toHaveBeenCalledWith('PROJ-007', EVENTO);
  });

  it('deve mostrar o projeto com a média aberta, e nunca o UUID', async () => {
    // Arrange / Act
    abrir({ codigoInicial: 'PROJ-007' });

    // Assert
    expect(await screen.findByText('PROJ-007')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Horta Vertical' })).toBeInTheDocument();
    expect(screen.getByText(/Média geral do projeto/)).toBeInTheDocument();
    expect(screen.getByText(/\(8,00\) ÷ 1 =/)).toBeInTheDocument();
    expect(screen.queryByText(ID_PROJETO)).not.toBeInTheDocument();
  });

  it('deve listar o que a conferência encontrou neste projeto', async () => {
    // Arrange
    vi.mocked(buscarMemorialPorCodigo).mockResolvedValue(
      memorial({
        achados: [
          {
            severidade: 'grave',
            codigo: 'nota_divergente',
            titulo: 'A nota gravada não fecha com as respostas',
            id_avaliacao: 'av-1',
            esperado: '8,00',
            encontrado: '9,50',
            detalhe: 'Diferença de 1,50 ponto',
          },
        ],
      }),
    );

    // Act
    abrir({ codigoInicial: 'PROJ-007' });

    // Assert
    const secao = await screen.findByRole('region', { name: /achados da conferência deste projeto/i });
    expect(within(secao).getByText(/não fecha com as respostas/)).toBeInTheDocument();
    expect(within(secao).getByText(/Diferença de 1,50 ponto/)).toBeInTheDocument();
  });

  it('deve mostrar como cada nota foi formada', async () => {
    // Arrange / Act
    abrir({ codigoInicial: 'PROJ-007' });

    // Assert
    const secao = await screen.findByRole('region', { name: /memorial de cálculo das avaliações/i });
    expect(within(secao).getByText(/Metodologia/)).toBeInTheDocument();
    expect(within(secao).getByText(/Peso × Nota/)).toBeInTheDocument();
    // O nome da avaliadora aparece no cabeçalho do memorial e na linha da nota
    expect(within(secao).getAllByText(/Ana Souza/).length).toBeGreaterThan(0);
  });

  it('deve avisar quando o projeto não tem nota, em vez de mostrar média vazia', async () => {
    // Arrange
    vi.mocked(buscarMemorialPorCodigo).mockResolvedValue(
      memorial({ avaliacoes_ativas: [], notas: [], media_geral: null, media_final: null, total_avaliacoes: 0 }),
    );

    // Act
    abrir({ codigoInicial: 'PROJ-007' });

    // Assert
    expect(await screen.findByText('Nenhuma avaliação ativa')).toBeInTheDocument();
    expect(screen.getByText(/ainda não tem média/)).toBeInTheDocument();
  });

  it('deve mostrar o erro do banco e não deixar projeto antigo na tela', async () => {
    // Arrange
    vi.mocked(buscarMemorialPorCodigo).mockRejectedValue(new Error('Projeto PROJ-999 não existe neste evento'));

    // Act
    abrir({ codigoInicial: 'PROJ-999' });

    // Assert
    const alerta = await screen.findByRole('alert');
    expect(within(alerta).getByText(/não existe neste evento/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Horta Vertical' })).not.toBeInTheDocument();
  });

  it('deve entregar o projeto carregado para a folha de conferência', async () => {
    // Arrange
    const aoImprimir = vi.fn();
    abrir({ codigoInicial: 'PROJ-007', aoImprimir });

    // Act
    await userEvent.click(await screen.findByRole('button', { name: /folha de conferência/i }));

    // Assert
    expect(aoImprimir).toHaveBeenCalledWith(expect.objectContaining({ codigo_projeto: 'PROJ-007' }));
  });

  it('deve pedir um código antes de conferir qualquer coisa', () => {
    // Arrange / Act
    abrir();

    // Assert
    expect(screen.getByText('Escolha um projeto')).toBeInTheDocument();
    expect(buscarMemorialPorCodigo).not.toHaveBeenCalled();
  });
});
