import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalAjustarMedia, ModalArbitrarNota, ModalCorrigirNotas } from '@/features/auditoria/components/AcoesDeAjuste';
import type { MemorialAvaliacao, MemorialProjeto } from '@/features/auditoria/tipos';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const avaliacao: MemorialAvaliacao = {
  id_avaliacao: 'av-1',
  codigo_projeto: 'PROJ-001',
  titulo_projeto: 'Projeto',
  avaliador: { id_usuario: 'u-1', nome: 'Ana Avaliadora', email: 'ana@ifms.local' },
  status: 'CONCLUIDA',
  enviada_em: null,
  presenca_em: null,
  criada_em: null,
  parecer: null,
  is_quarentena: false,
  cancelada_em: null,
  cancelada_por: null,
  questionario: { id_questionario: 'q-1', titulo: 'Quest', escala_minima: 1, escala_maxima: 5 },
  criterios: [
    { id_pergunta: 'p-1', ordem: 1, criterio: 'Critério pesado', ajuda: null, peso_calculo: 2, peso_desempate: 1, nota: 5, produto: 10 },
    { id_pergunta: 'p-2', ordem: 2, criterio: 'Critério leve', ajuda: null, peso_calculo: 1, peso_desempate: 2, nota: 2, produto: 2 },
  ],
  soma_produtos: 12,
  soma_pesos: 3,
  nota_bruta: 4,
  nota_arredondada: 4,
  nota_gravada: 4,
  confere: true,
  motivo_do_log: null,
  ajuste: null,
};

const projeto = {
  id_projeto: 'p-1',
  codigo_projeto: 'PROJ-001',
  titulo: 'Projeto',
  media_geral: 3,
  ajuste_media: 0,
  ajuste_media_motivo: null,
  total_avaliacoes: 2,
  cota: 3,
} as unknown as MemorialProjeto;

describe('Ações de ajuste manual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null } as never);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { sucesso: true }, error: null } as never);
  });

  it('deve mostrar a prévia da nota ponderada ao corrigir um critério', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<ModalCorrigirNotas aberto memorial={avaliacao} aoFechar={vi.fn()} aoConcluir={vi.fn()} />);

    // Act — 4 no critério de peso 2 e 1 no de peso 1: (4×2 + 1×1) / 3 = 3,00
    const pesado = screen.getByRole('spinbutton', { name: /Critério pesado \(peso 2\)/ });
    await user.clear(pesado);
    await user.type(pesado, '4');
    const leve = screen.getByRole('spinbutton', { name: /Critério leve \(peso 1\)/ });
    await user.clear(leve);
    await user.type(leve, '1');

    // Assert
    expect(screen.getByText(/Prévia da nota final:/).closest('p')).toHaveTextContent('3,00');
  });

  it('deve enviar a correção com as notas e o motivo', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoConcluir = vi.fn();
    render(<ModalCorrigirNotas aberto memorial={avaliacao} aoFechar={vi.fn()} aoConcluir={aoConcluir} />);

    // Act
    await user.type(screen.getByRole('textbox', { name: /Motivo/ }), 'erro de digitação');
    await user.click(screen.getByRole('button', { name: /Corrigir e recalcular/ }));

    // Assert
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('admin_corrigir_respostas_avaliacao', {
        p_id_avaliacao: 'av-1',
        p_respostas: [
          { id_pergunta: 'p-1', nota: 5 },
          { id_pergunta: 'p-2', nota: 2 },
        ],
        p_motivo: 'erro de digitação',
      }),
    );
    expect(aoConcluir).toHaveBeenCalled();
  });

  it('deve mostrar na arbitragem o que as respostas produzem, antes de substituir', async () => {
    // Arrange / Act
    render(<ModalArbitrarNota aberto memorial={avaliacao} aoFechar={vi.fn()} aoConcluir={vi.fn()} />);

    // Assert
    expect(screen.getByText(/As notas por critério produzem/)).toHaveTextContent('4,00');
    expect(screen.getByRole('spinbutton', { name: /Nota final/ })).toHaveValue(4);
  });

  it('deve abrir a conta do ajuste de média antes de aplicar', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<ModalAjustarMedia aberto projeto={projeto} aoFechar={vi.fn()} aoConcluir={vi.fn()} />);

    // Act
    const campo = screen.getByRole('spinbutton', { name: /Ajuste em pontos/ });
    await user.clear(campo);
    await user.type(campo, '1.5');

    // Assert — 3,00 +1,50 = 4,50
    const resumo = screen.getByText(/Média final:/).closest('p');
    expect(resumo).toHaveTextContent('3,00');
    expect(resumo).toHaveTextContent('+1,50');
    expect(resumo).toHaveTextContent('4,50');
  });

  it('deve mostrar o erro do banco sem fechar o diálogo', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'A nota precisa estar entre 1 e 5, a escala do questionário.' } } as never);
    const user = userEvent.setup();
    const aoConcluir = vi.fn();
    render(<ModalArbitrarNota aberto memorial={avaliacao} aoFechar={vi.fn()} aoConcluir={aoConcluir} />);

    // Act
    await user.click(screen.getByRole('button', { name: /Arbitrar nota/ }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('A nota precisa estar entre 1 e 5');
    expect(aoConcluir).not.toHaveBeenCalled();
  });
});
