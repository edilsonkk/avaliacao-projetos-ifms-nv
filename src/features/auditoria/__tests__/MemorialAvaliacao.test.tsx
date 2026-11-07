import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemorialAvaliacao } from '@/features/auditoria';
import type { DadosMemorialAvaliacao } from '@/features/auditoria';

/**
 * O memorial é o que responde "esta nota está certa?": precisa mostrar peso, produto e a
 * divisão, e precisa distinguir nota que não fecha de nota arbitrada com motivo.
 */

const memorial = (extra: Partial<DadosMemorialAvaliacao> = {}): DadosMemorialAvaliacao => ({
  id_avaliacao: 'av-1',
  codigo_projeto: 'PROJ-001',
  titulo_projeto: 'Projeto de Teste',
  avaliador: { id_usuario: 'u-1', nome: 'Ana Avaliadora', email: 'ana@ifms.local' },
  status: 'CONCLUIDA',
  enviada_em: '2026-11-06T13:40:00Z',
  presenca_em: null,
  criada_em: '2026-11-06T13:30:00Z',
  parecer: 'Projeto bem conduzido.',
  is_quarentena: false,
  cancelada_em: null,
  cancelada_por: null,
  questionario: { id_questionario: 'q-1', titulo: 'Técnico Protótipo', escala_minima: 1, escala_maxima: 5 },
  criterios: [
    { id_pergunta: 'p-1', ordem: 1, criterio: 'Rigor metodológico', ajuda: null, peso_calculo: 2, peso_desempate: 1, nota: 5, produto: 10 },
    { id_pergunta: 'p-2', ordem: 2, criterio: 'Apresentação', ajuda: null, peso_calculo: 1, peso_desempate: 2, nota: 2, produto: 2 },
  ],
  soma_produtos: 12,
  soma_pesos: 3,
  nota_bruta: 4,
  nota_arredondada: 4,
  nota_gravada: 4,
  confere: true,
  motivo_do_log: null,
  ajuste: null,
  ...extra,
});

describe('MemorialAvaliacao', () => {
  it('deve abrir a conta da nota: peso, produto, soma e divisão', () => {
    // Arrange / Act
    render(<MemorialAvaliacao memorial={memorial()} />);

    // Assert — o peso entra na nota final e precisa estar visível
    const linhaRigor = screen.getByRole('row', { name: /Rigor metodológico/ });
    expect(linhaRigor).toHaveTextContent('2');
    expect(linhaRigor).toHaveTextContent('5,00');
    expect(linhaRigor).toHaveTextContent('10,00');

    const conta = screen.getByText(/A conta:/).closest('p');
    expect(conta).toHaveTextContent('12,00 ÷ 3 = 4,00');
    expect(conta).toHaveTextContent('gravado: 4,00');
  });

  it('deve marcar como Confere quando a nota gravada é a que as respostas produzem', () => {
    // Arrange / Act
    render(<MemorialAvaliacao memorial={memorial()} />);

    // Assert
    expect(screen.getByText('Confere')).toBeInTheDocument();
    expect(screen.queryByText('Divergente')).not.toBeInTheDocument();
  });

  it('deve acusar divergência quando a nota gravada não fecha', () => {
    // Arrange / Act
    render(<MemorialAvaliacao memorial={memorial({ nota_gravada: 5, confere: false })} />);

    // Assert
    expect(screen.getByText('Divergente')).toBeInTheDocument();
  });

  it('deve distinguir nota arbitrada pelo Admin de nota adulterada', () => {
    // Arrange
    const arbitrada = memorial({
      nota_gravada: 4.5,
      confere: false,
      ajuste: { tipo: 'nota_arbitrada', em: '2026-11-06T15:00:00Z', motivo: 'decisão da comissão de recurso', por: { id_usuario: 'adm', nome: 'Coordenação' } },
    });

    // Act
    render(<MemorialAvaliacao memorial={arbitrada} />);

    // Assert — não é "Divergente": é ajuste declarado, com motivo
    expect(screen.getByText('Nota arbitrada')).toBeInTheDocument();
    expect(screen.queryByText('Divergente')).not.toBeInTheDocument();
    expect(screen.getByText(/decisão da comissão de recurso/)).toBeInTheDocument();
    expect(screen.getByText(/As notas por critério dariam/)).toBeInTheDocument();
  });

  it('deve esconder o nome do avaliador no documento anônimo', () => {
    // Arrange / Act
    render(<MemorialAvaliacao memorial={memorial()} anonimo indiceAnonimo={2} />);

    // Assert
    expect(screen.getByRole('heading', { name: 'Avaliador 2' })).toBeInTheDocument();
    expect(screen.queryByText('Ana Avaliadora')).not.toBeInTheDocument();
    expect(screen.queryByText('ana@ifms.local')).not.toBeInTheDocument();
  });

  it('deve omitir a marca de ajuste quando o documento externo pede', () => {
    // Arrange
    const corrigida = memorial({
      ajuste: { tipo: 'respostas_corrigidas', em: '2026-11-06T15:00:00Z', motivo: 'erro de digitação', por: null },
    });

    // Act
    render(<MemorialAvaliacao memorial={corrigida} ocultarAjustes />);

    // Assert
    expect(screen.queryByText(/erro de digitação/)).not.toBeInTheDocument();
    expect(screen.queryByText('Notas corrigidas pelo Admin')).not.toBeInTheDocument();
  });

  it('deve avisar quando não há notas por critério para refazer a conta', () => {
    // Arrange / Act
    render(<MemorialAvaliacao memorial={memorial({ criterios: [], soma_produtos: null, soma_pesos: null, nota_bruta: null, nota_arredondada: null, confere: false })} />);

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('não tem notas por critério gravadas');
  });

  it('deve mostrar quem cancelou a avaliação e quando', () => {
    // Arrange / Act
    render(
      <MemorialAvaliacao
        memorial={memorial({
          status: 'CANCELADA',
          cancelada_em: '2026-11-06T16:20:00Z',
          cancelada_por: { id_usuario: 'adm', nome: 'Coordenação' },
          motivo_do_log: 'nota fora da curva',
        })}
      />,
    );

    // Assert
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
    expect(screen.getByText(/Coordenação/)).toBeInTheDocument();
    expect(screen.getByText(/nota fora da curva/)).toBeInTheDocument();
  });
});
