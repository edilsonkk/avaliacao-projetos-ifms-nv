import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const estado = vi.hoisted(() => ({ ambiente: 'local' as 'local' | 'producao' | null }));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
  verificar_conexao_configurada: () => estado.ambiente !== null,
  get ambiente_supabase() {
    return estado.ambiente;
  },
}));

import { supabase } from '@/lib/supabase';
import { Cabecalho } from '@/components/layout/Cabecalho';
import { ProvedorAvisos } from '@/components/ui';
import { esperarSemViolacoesDeAcessibilidade } from '@/test/axe';

const renderizar = (props: Partial<React.ComponentProps<typeof Cabecalho>> = {}) =>
  render(
    <ProvedorAvisos>
      <Cabecalho tela_atual="admin" ao_mudar_tela={vi.fn()} papel="admin" {...props} />
    </ProvedorAvisos>,
  );

describe('Cabecalho - indicador de ambiente do Supabase', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('deve indicar quando a aplicação usa o Supabase local', () => {
    // Arrange
    estado.ambiente = 'local';

    // Act
    renderizar();

    // Assert
    expect(screen.getByRole('status', { name: 'Banco de dados local' })).toHaveTextContent('local');
  });

  it('deve destacar quando a aplicação usa o Supabase de produção', () => {
    // Arrange
    estado.ambiente = 'producao';

    // Act
    renderizar();

    // Assert
    expect(screen.getByRole('status', { name: 'Banco de dados de produção' })).toHaveTextContent('produção');
  });

  it('deve informar quando o Supabase não está configurado', () => {
    // Arrange
    estado.ambiente = null;

    // Act
    renderizar();

    // Assert
    expect(screen.getByRole('status', { name: 'Banco de dados não configurado' })).toHaveTextContent('não configurado');
  });
});

describe('Cabecalho - navegação', () => {
  beforeEach(() => {
    localStorage.clear();
    estado.ambiente = 'local';
  });

  it('deve nomear a navegação e marcar a tela em que a pessoa está', () => {
    // Arrange / Act
    renderizar({ tela_atual: 'admin' });

    // Assert
    expect(screen.getByRole('navigation', { name: 'Telas do sistema' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^admin$/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^telão$/i })).not.toHaveAttribute('aria-current');
  });

  it('deve manter o rótulo de cada tela visível, sem depender de ícone', () => {
    // Arrange / Act
    renderizar({ tela_atual: 'admin' });

    // Assert
    expect(screen.getByRole('button', { name: 'Staff' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeVisible();
  });
});

describe('Cabecalho - preferências visuais', () => {
  beforeEach(() => {
    localStorage.clear();
    estado.ambiente = 'local';
    document.documentElement.classList.remove('dark');
    document.documentElement.style.removeProperty('--escala-texto');
  });

  it('deve aumentar o tamanho do texto e guardar a escolha', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();

    // Act
    await user.click(screen.getByRole('button', { name: 'Tamanho de texto grande' }));

    // Assert
    expect(document.documentElement.style.getPropertyValue('--escala-texto')).toBe('112.5%');
    expect(localStorage.getItem('tamanho_texto_fecin')).toBe('grande');
    expect(screen.getByRole('button', { name: 'Tamanho de texto grande' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tamanho de texto padrão' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('deve ligar o tema escuro e guardar a escolha', async () => {
    // Arrange
    const user = userEvent.setup();
    renderizar();

    // Act
    await user.click(screen.getByRole('button', { name: 'Tema escuro' }));

    // Assert
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('tema_fecin')).toBe('escuro');
  });

  it('deve manter tema e tamanho de texto ao sair', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoSair = vi.fn();
    localStorage.setItem('usuario_perfil', 'admin');
    renderizar({ ao_sair: aoSair });
    await user.click(screen.getByRole('button', { name: 'Tamanho de texto maior' }));
    await user.click(screen.getByRole('button', { name: 'Tema escuro' }));

    // Act
    await user.click(screen.getByRole('button', { name: /sair/i }));

    // Assert
    expect(aoSair).toHaveBeenCalled();
    expect(localStorage.getItem('usuario_perfil')).toBeNull();
    expect(localStorage.getItem('tema_fecin')).toBe('escuro');
    expect(localStorage.getItem('tamanho_texto_fecin')).toBe('maior');
  });
});

describe('Cabecalho - sair', () => {
  beforeEach(() => {
    localStorage.clear();
    estado.ambiente = 'local';
    vi.mocked(supabase.auth.signOut).mockResolvedValue(undefined as never);
  });

  it('deve encerrar a sessão de Admin na hora, sem perguntar', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoSair = vi.fn();
    renderizar({ papel: 'admin', ao_sair: aoSair });

    // Act
    await user.click(screen.getByRole('button', { name: 'Sair' }));

    // Assert
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(aoSair).toHaveBeenCalled();
  });

  it('deve avisar o avaliador que sair desvincula o celular, e respeitar a desistência', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoSair = vi.fn();
    renderizar({ papel: 'avaliador', tela_atual: 'avaliador', ao_sair: aoSair });

    // Act
    await user.click(screen.getByRole('button', { name: 'Sair e desvincular' }));

    // Assert
    const dialogo = screen.getByRole('alertdialog', { name: 'Sair e desvincular este celular?' });
    expect(dialogo).toHaveTextContent(/novo código ao Staff/i);
    expect(screen.getByRole('button', { name: 'Continuar avaliando' })).toHaveFocus();

    // Act
    await user.click(screen.getByRole('button', { name: 'Continuar avaliando' }));

    // Assert
    expect(aoSair).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();

    // Act
    await user.click(screen.getByRole('button', { name: 'Sair e desvincular' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sair e desvincular' }));

    // Assert
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(aoSair).toHaveBeenCalled();
  });
});

describe('Cabecalho - auditoria automática', () => {
  beforeEach(() => {
    localStorage.clear();
    estado.ambiente = 'producao';
  });

  it('não deve ter violação de acessibilidade', async () => {
    // Arrange
    const { container } = renderizar({ papel: 'admin', ao_sair: vi.fn() });

    // Act / Assert
    await esperarSemViolacoesDeAcessibilidade(container);
  });
});
