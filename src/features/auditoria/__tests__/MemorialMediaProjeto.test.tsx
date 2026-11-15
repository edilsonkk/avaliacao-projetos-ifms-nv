import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemorialMediaProjeto, type DadosMediaProjeto } from '@/features/auditoria';

/**
 * A conta da média do projeto, aberta na tela: soma, divisor, resultado, ajuste e média final.
 *
 * O ponto destes testes é que o número exibido continua sendo o do banco. O componente só mostra
 * a conta; se ele passar a calcular a média por conta própria, a tela de conferência deixa de
 * conferir coisa alguma e passa a confirmar a si mesma ([ADR 0001]).
 */

const projeto = (over: Partial<DadosMediaProjeto> = {}): DadosMediaProjeto => ({
  notas: [8, 9],
  media_geral: 8.5,
  ajuste_media: 0,
  media_final: 8.5,
  total_avaliacoes: 2,
  cota: 3,
  ...over,
});

describe('MemorialMediaProjeto', () => {
  it('deve abrir a conta da média: soma, divisor e resultado', () => {
    // Arrange / Act
    render(<MemorialMediaProjeto projeto={projeto()} />);

    // Assert
    expect(screen.getByText(/\(8,00 \+ 9,00\) ÷ 2 =/)).toBeInTheDocument();
    // Sem ajuste, o mesmo 8,50 aparece três vezes: no fim da conta, em "Média das notas" e em
    // "Média final" — é o mesmo número, e não três contas diferentes
    expect(screen.getAllByText('8,50')).toHaveLength(3);
  });

  it('deve exibir a média que veio do banco, mesmo quando difere da conta das notas', () => {
    // Arrange: o banco considera uma avaliação que não está na lista de notas exibida
    // (cancelada, voto popular, ajuste). Quem manda é o banco.
    render(<MemorialMediaProjeto projeto={projeto({ notas: [8, 9], media_geral: 7.2, media_final: 7.2 })} />);

    // Assert: a conta mostra o divisor real e o resultado do banco, sem "corrigir" para 8,50
    expect(screen.getByText(/\(8,00 \+ 9,00\) ÷ 2 =/)).toBeInTheDocument();
    expect(screen.getAllByText('7,20').length).toBeGreaterThan(0);
    expect(screen.queryByText('8,50')).not.toBeInTheDocument();
  });

  it('deve mostrar o ajuste da comissão e a média final separados da média das notas', () => {
    // Arrange / Act
    render(<MemorialMediaProjeto projeto={projeto({ ajuste_media: -0.5, media_final: 8 })} />);

    // Assert
    expect(screen.getByText(/ajuste da comissão:/)).toBeInTheDocument();
    expect(screen.getAllByText('\u22120,50').length).toBeGreaterThan(0);
    expect(screen.getByText('8,00 pts')).toBeInTheDocument();
  });

  it('deve dizer quem ajustou, quando e por quê', () => {
    // Arrange / Act
    render(
      <MemorialMediaProjeto
        projeto={projeto({
          ajuste_media: 0.25,
          media_final: 8.75,
          ajuste_media_em: '2026-11-14T13:45:00-04:00',
          ajuste_media_motivo: 'Recurso da comissão deferido',
          ajuste_media_por: { nome: 'Coordenação' } as DadosMediaProjeto['ajuste_media_por'],
        })}
      />,
    );

    // Assert
    expect(screen.getByText(/por Coordenação/)).toBeInTheDocument();
    expect(screen.getByText(/Recurso da comissão deferido/)).toBeInTheDocument();
  });

  it('não deve inventar média quando nenhuma nota foi lançada', () => {
    // Arrange / Act
    render(<MemorialMediaProjeto projeto={projeto({ notas: [], media_geral: null, media_final: null, total_avaliacoes: 0 })} />);

    // Assert
    expect(screen.getByText(/ainda não tem média/)).toBeInTheDocument();
    expect(screen.queryByText(/÷/)).not.toBeInTheDocument();
  });

  it('deve avisar quando a média exata foi arredondada, com o valor sem corte', () => {
    // Arrange: 8 + 9 + 9 dá 8,666..., que não cabe em duas casas
    render(<MemorialMediaProjeto projeto={projeto({ notas: [8, 9, 9], media_geral: 8.67, media_final: 8.67, total_avaliacoes: 3 })} />);

    // Assert
    expect(screen.getByText(/conta exata/)).toBeInTheDocument();
    expect(screen.getByText(/arredondada para duas casas/)).toBeInTheDocument();
  });

  it('na variante resumo, deve mostrar só a conta, sem o quadro de números', () => {
    // Arrange / Act
    render(<MemorialMediaProjeto projeto={projeto()} variante="resumo" />);

    // Assert
    expect(screen.getByText(/\(8,00 \+ 9,00\) ÷ 2 =/)).toBeInTheDocument();
    expect(screen.queryByText('Avaliações')).not.toBeInTheDocument();
    expect(screen.queryByText('Média final')).not.toBeInTheDocument();
  });
});
