import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AbaTrilha } from '../components/AbaTrilha';
import { buscarNomesDeAtores, buscarTrilha } from '../api';
import type { LinhaDaTrilha } from '../tipos';

/**
 * A trilha responde "quem mexeu, quando e por onde". O que ela existe para marcar é a escrita que
 * **não passou por nenhuma função do sistema** (`origem = 'direto'`): em credenciamento isso é o
 * fluxo normal da tela do Staff, mas em nota é exatamente o que a conferência precisa acusar.
 *
 * Também vale como regressão da regra de nunca exibir UUID na interface: a coluna "Quem" mostra
 * nome, e o id do ator só serve para buscar esse nome.
 */

vi.mock('../api', () => ({
  buscarTrilha: vi.fn(),
  buscarNomesDeAtores: vi.fn(),
}));

const EVENTO = 'e0000000-0000-0000-0000-000000000001';
const ATOR = 'a0000000-0000-0000-0000-00000000ad01';

const linha = (over: Partial<LinhaDaTrilha> = {}): LinhaDaTrilha => ({
  id_log: 1,
  quando: '2026-11-14T10:00:00-04:00',
  acao: 'ajuste_media',
  operacao: 'UPDATE',
  tabela: 'projetos',
  origem: 'admin_ajustar_media_projeto',
  motivo: 'Recurso deferido',
  ator_papel: 'ADMIN',
  ator: ATOR,
  campos_alterados: ['ajuste_media'],
  dados_antes: { ajuste_media: 0 },
  dados_depois: { ajuste_media: 0.25 },
  ...over,
});

describe('AbaTrilha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buscarNomesDeAtores).mockResolvedValue({ [ATOR]: 'Coordenação' });
  });

  it('deve mostrar o nome de quem mexeu, e nunca o UUID', async () => {
    // Arrange
    vi.mocked(buscarTrilha).mockResolvedValue([linha()]);

    // Act
    render(<AbaTrilha idEvento={EVENTO} />);

    // Assert
    expect(await screen.findByText('Coordenação')).toBeInTheDocument();
    expect(screen.queryByText(ATOR)).not.toBeInTheDocument();
    expect(screen.getByText('Recurso deferido')).toBeInTheDocument();
  });

  it('deve acusar alteração de nota feita fora do sistema', async () => {
    // Arrange: UPDATE direto em `avaliacoes`, sem passar por RPC — o caso suspeito
    vi.mocked(buscarTrilha).mockResolvedValue([
      linha({ id_log: 2, tabela: 'avaliacoes', operacao: 'UPDATE', origem: 'direto', acao: 'nota_alterada' }),
    ]);

    // Act
    render(<AbaTrilha idEvento={EVENTO} />);

    // Assert
    expect(await screen.findByText('Fora do sistema')).toBeInTheDocument();
  });

  it('não deve acusar a escrita direta da tela do Staff, que é o fluxo normal', async () => {
    // Arrange: credenciamento gravado direto pela tela não é desvio
    vi.mocked(buscarTrilha).mockResolvedValue([
      linha({ id_log: 3, tabela: 'avaliadores_evento', operacao: 'UPDATE', origem: 'direto', acao: 'credenciamento' }),
    ]);

    // Act
    render(<AbaTrilha idEvento={EVENTO} />);

    // Assert
    expect(await screen.findByText('Tela do sistema')).toBeInTheDocument();
    expect(screen.queryByText('Fora do sistema')).not.toBeInTheDocument();
  });

  it('não deve acusar a criação de nota, só a alteração', async () => {
    // Arrange: INSERT em `avaliacoes` é a nota sendo registrada, não mexida
    vi.mocked(buscarTrilha).mockResolvedValue([
      linha({ id_log: 4, tabela: 'avaliacoes', operacao: 'INSERT', origem: 'direto', campos_alterados: null }),
    ]);

    // Act
    render(<AbaTrilha idEvento={EVENTO} />);

    // Assert
    expect(await screen.findByText('Tela do sistema')).toBeInTheDocument();
    expect(screen.queryByText('Fora do sistema')).not.toBeInTheDocument();
  });

  it('deve abrir o antes e o depois do campo alterado', async () => {
    // Arrange
    vi.mocked(buscarTrilha).mockResolvedValue([linha()]);
    render(<AbaTrilha idEvento={EVENTO} />);
    const botao = await screen.findByRole('button', { expanded: false });

    // Act
    await userEvent.click(botao);

    // Assert
    expect(screen.getByRole('heading', { name: /o que mudou/i })).toBeInTheDocument();
    expect(screen.getByText(/0 → 0.25/)).toBeInTheDocument();
  });

  it('deve pedir ao banco só o que foi feito fora do sistema quando o filtro é marcado', async () => {
    // Arrange
    vi.mocked(buscarTrilha).mockResolvedValue([linha()]);
    render(<AbaTrilha idEvento={EVENTO} />);
    await screen.findByText('Coordenação');

    // Act
    await userEvent.click(screen.getByRole('checkbox', { name: /fora do sistema/i }));

    // Assert: o filtro vai para a consulta, não é aplicado no navegador
    expect(buscarTrilha).toHaveBeenLastCalledWith(EVENTO, { somenteForaDoFluxo: true });
  });

  it('deve avisar que a trilha começa na instalação, em vez de sugerir que nada aconteceu', async () => {
    // Arrange
    vi.mocked(buscarTrilha).mockResolvedValue([]);

    // Act
    render(<AbaTrilha idEvento={EVENTO} />);

    // Assert
    expect(await screen.findByText('Nada registrado ainda')).toBeInTheDocument();
    expect(screen.getByText(/não foi registrado/)).toBeInTheDocument();
  });

  it('deve mostrar o erro do banco em vez de uma tabela vazia', async () => {
    // Arrange
    vi.mocked(buscarTrilha).mockRejectedValue(new Error('permissão negada para log_auditoria'));

    // Act
    render(<AbaTrilha idEvento={EVENTO} />);

    // Assert
    const alerta = await screen.findByRole('alert');
    expect(within(alerta).getByText(/permissão negada/)).toBeInTheDocument();
  });
});
