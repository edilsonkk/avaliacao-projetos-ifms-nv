import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelaoAoVivo } from '@/features/relatorios';
import { inicioDoEvento } from '@/features/relatorios/components/TelaoAoVivo';
import { supabase } from '@/lib/supabase';
import { EVENTO_APP_RETOMADA } from '@/lib/keepAliveSessao';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  verificar_conexao_configurada: () => true,
}));

const RESUMO = {
  nome_evento: 'Feira de Ciências',
  edicao: '12ª edição',
  data_evento: '2026-10-30',
  horario_inicio: '08:00:00',
  total_projetos: 40,
  projetos_presentes: 30,
  avaliadores_credenciados: 12,
  avaliacoes_em_andamento: 5,
  em_andamento_na_meta: 3,
  avaliacoes_realizadas: 57,
  meta_global: 80,
  avaliacoes_na_meta: 40,
  projetos_quarentena: 2,
  cota_padrao: 3,
};

describe('TelaoAoVivo', () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockReset().mockResolvedValue({ data: RESUMO, error: null } as never);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deve exibir só os totais vindos do resumo público, sem ler tabelas', async () => {
    // Arrange / Act
    render(<TelaoAoVivo />);

    // Assert
    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('deve usar sempre o evento ativo do banco, e não um id guardado no navegador', async () => {
    // Arrange
    localStorage.setItem('evento_ativo_id', 'evento-do-ano-passado');

    // Act
    render(<TelaoAoVivo />);

    // Assert
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('fn_telao_resumo', { p_id_evento: null }));
  });

  it('deve mostrar o nome do evento em vez de um título fixo', async () => {
    // Arrange / Act
    render(<TelaoAoVivo />);

    // Assert
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Feira de Ciências — 12ª edição');
    expect(screen.queryByText(/FETEC MS 2026/)).not.toBeInTheDocument();
  });

  it('deve calcular o progresso sobre a meta do banco e mostrar a quarentena real', async () => {
    // Arrange / Act
    render(<TelaoAoVivo />);

    // Assert (40 de 80 = 50%; restantes = 80 - 40 - 3 travas que cabem na meta, não as 5 travas do evento)
    expect(await screen.findByRole('progressbar', { name: 'Progresso geral da feira' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('50% concluído')).toBeInTheDocument();
    expect(screen.getByText('37 avaliações a fazer')).toBeInTheDocument();
    expect(screen.getByText('5 em avaliação agora')).toBeInTheDocument();
    expect(screen.getByText('Projetos com notas divergentes em análise').previousElementSibling).toHaveTextContent('2');
  });

  it('deve contar o tempo a partir do início do evento, não da abertura da página', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T10:25:00'));

    // Act
    render(<TelaoAoVivo />);

    // Assert
    expect(await screen.findByText('02h 25min')).toBeInTheDocument();
  });

  it('deve avisar quando está sem conexão, mantendo os últimos números', async () => {
    // Arrange
    render(<TelaoAoVivo />);
    expect(await screen.findByText('40')).toBeInTheDocument();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'falha' } } as never);

    // Act
    act(() => {
      window.dispatchEvent(new Event(EVENTO_APP_RETOMADA));
    });

    // Assert
    expect(await screen.findByText(/sem conexão/i)).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('não deve projetar números de exemplo quando o resumo falha', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'falha' } } as never);

    // Act
    render(<TelaoAoVivo />);

    // Assert
    expect(await screen.findByText(/sem conexão/i)).toBeInTheDocument();
    expect(screen.queryByText('124')).not.toBeInTheDocument();
  });

  it('deve atualizar na hora quando o app volta de segundo plano, sem esperar o próximo ciclo', async () => {
    // Arrange
    render(<TelaoAoVivo />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
    await screen.findByText('40');

    // Act
    act(() => {
      window.dispatchEvent(new Event(EVENTO_APP_RETOMADA));
    });

    // Assert
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(2));
  });

  it('deve anunciar quando a avaliação foi finalizada', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ...RESUMO, avaliacao_finalizada: true }, error: null } as never);

    // Act
    render(<TelaoAoVivo />);

    // Assert
    expect(await screen.findByRole('heading', { name: /avaliação finalizada/i })).toBeInTheDocument();
  });

  it('não deve anunciar o fim enquanto faltam avaliações', async () => {
    // Arrange / Act
    render(<TelaoAoVivo />);
    await screen.findByText('40');

    // Assert
    expect(screen.queryByRole('heading', { name: /avaliação finalizada/i })).not.toBeInTheDocument();
  });

  it('inicioDoEvento deve ignorar evento sem data ou horário', () => {
    // Arrange / Act / Assert
    expect(inicioDoEvento(null, '08:00:00')).toBeNull();
    expect(inicioDoEvento('2026-10-30', null)).toBeNull();
    expect(inicioDoEvento('2026-10-30', '08:00:00')?.getHours()).toBe(8);
  });
});
