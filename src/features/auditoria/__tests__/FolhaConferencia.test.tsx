import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolhaConferencia } from '@/features/auditoria';
import type { MemorialAvaliacao, MemorialProjeto } from '../tipos';

/**
 * A folha de conferência é o documento que sai do sistema para a mesa da comissão e para instruir
 * recurso. Dois interruptores decidem o que vai no papel, e os dois têm consequência real:
 *
 *  * **Ocultar identidade** — o que se entrega a participante ou instituição não pode trazer o
 *    nome de quem avaliou.
 *  * **Incluir ajustes manuais** — num recurso sobre nota ajustada, omitir o ajuste trabalha
 *    contra a própria coordenação.
 */

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
  id_projeto: 'f0000000-0000-0000-0000-0000000000a9',
  codigo_projeto: 'PROJ-007',
  titulo: 'Horta Vertical',
  modalidade: 'Iniciação Científica',
  area_tematica: 'Ciências Agrárias',
  instituicao: 'IFMS Naviraí',
  estande: 'A-12',
  check_in: true,
  fora_da_competicao: false,
  cota: 3,
  questionario_fixado: { id_questionario: 'q-1', titulo: 'Técnico', escala_minima: 1, escala_maxima: 10 },
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

const comAjuste = () =>
  memorial({
    ajuste_media: 0.5,
    media_final: 8.5,
    ajuste_media_em: '2026-11-14T13:45:00-04:00',
    ajuste_media_motivo: 'Recurso deferido pela comissão',
    ajuste_media_por: { id_usuario: 'u-9', nome: 'Coordenação' },
  });

describe('FolhaConferencia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve identificar o evento, o projeto e a média final no papel', () => {
    // Arrange / Act
    render(<FolhaConferencia projeto={memorial()} nomeEvento="Feira de Software 2026" aoFechar={vi.fn()} />);

    // Assert
    expect(screen.getByText('FEIRA DE SOFTWARE 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /folha de conferência de notas/i })).toBeInTheDocument();
    expect(screen.getByText('PROJ-007')).toBeInTheDocument();
    const resultado = screen.getByRole('region', { name: /resultado do projeto/i });
    expect(within(resultado).getByText(/Média das notas:/)).toBeInTheDocument();
    expect(within(resultado).getAllByText('8,00').length).toBeGreaterThan(0);
  });

  it('deve trazer o ajuste da comissão com motivo e autor, por padrão', () => {
    // Arrange / Act
    render(<FolhaConferencia projeto={comAjuste()} aoFechar={vi.fn()} />);

    // Assert
    expect(screen.getByText(/ajuste de comissão:/)).toBeInTheDocument();
    expect(screen.getByText(/Recurso deferido pela comissão/)).toBeInTheDocument();
    expect(screen.getByText(/por Coordenação/)).toBeInTheDocument();
  });

  it('deve tirar o ajuste do documento quando a coordenação desliga a opção', async () => {
    // Arrange
    render(<FolhaConferencia projeto={comAjuste()} aoFechar={vi.fn()} />);

    // Act
    await userEvent.click(screen.getByRole('checkbox', { name: /incluir os ajustes manuais/i }));

    // Assert: o número continua (a média final é 8,50), mas o motivo e o autor saem
    expect(screen.getByText(/ajuste de comissão:/)).toBeInTheDocument();
    expect(screen.queryByText(/Recurso deferido pela comissão/)).not.toBeInTheDocument();
    expect(screen.queryByText(/por Coordenação/)).not.toBeInTheDocument();
  });

  it('deve esconder o nome de quem avaliou no documento anônimo', async () => {
    // Arrange
    render(<FolhaConferencia projeto={memorial()} aoFechar={vi.fn()} />);
    expect(screen.getAllByText(/Ana Souza/).length).toBeGreaterThan(0);

    // Act
    await userEvent.click(screen.getByRole('checkbox', { name: /ocultar identidade/i }));

    // Assert
    expect(screen.queryByText(/Ana Souza/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ana@ifms.edu.br/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Avaliador 1/).length).toBeGreaterThan(0);
  });

  it('deve emitir uma folha por projeto na versão consolidada do evento', () => {
    // Arrange / Act
    render(
      <FolhaConferencia
        projetos={[memorial(), memorial({ id_projeto: 'f-2', codigo_projeto: 'PROJ-008', titulo: 'Braço Robótico' })]}
        nomeEvento="Feira de Software 2026"
        aoFechar={vi.fn()}
      />,
    );

    // Assert
    expect(screen.getByRole('dialog', { name: /folha de conferência do evento/i })).toBeInTheDocument();
    expect(screen.getByText(/projeto 1 de 2/)).toBeInTheDocument();
    expect(screen.getByText(/projeto 2 de 2/)).toBeInTheDocument();
    expect(screen.getByText('PROJ-008')).toBeInTheDocument();
  });

  it('deve mandar imprimir e fechar sem imprimir', async () => {
    // Arrange
    const aoFechar = vi.fn();
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<FolhaConferencia projeto={memorial()} aoFechar={aoFechar} />);

    // Act
    await userEvent.click(screen.getByRole('button', { name: /imprimir/i }));
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));

    // Assert
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    imprimir.mockRestore();
  });

  it('deve dizer que não há nada para conferir em vez de emitir folha vazia', () => {
    // Arrange / Act
    render(<FolhaConferencia projetos={[]} aoFechar={vi.fn()} />);

    // Assert
    expect(screen.getByText('Nenhum projeto para conferir.')).toBeInTheDocument();
  });
});
