import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TelaStaff } from '@/features/staff';
import { TelaAutocadastroAvaliador } from '@/features/avaliacao';
import { Cabecalho } from '@/components/layout/Cabecalho';

// Mock do módulo Supabase
vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    verificar_conexao_configurada: vi.fn(() => false), // Contingência para testes isolados
    supabase: {
      from: vi.fn(),
      rpc: vi.fn(),
      auth: {
        signOut: vi.fn(),
      },
    },
  };
});

describe('Validação da TelaStaff e Autocadastro de Avaliador', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('1. Padrão Visual, Expansão da Janela e Limpeza de Subtítulos', () => {
    it('deve exibir títulos limpos sem referências técnicas ou textos entre parênteses', () => {
      render(<TelaStaff />);

      // Verifica cabeçalho limpo
      expect(screen.getByText('Módulo de Recepção & Credenciamento')).toBeInTheDocument();
      expect(screen.getByText('Painel da Equipe de Apoio')).toBeInTheDocument();

      // REGRA: Textos entre parênteses como (3FN Join Real), (3FN) ou (Staff) foram removidos
      expect(screen.queryByText(/3FN Join Real/i)).toBeNull();
      expect(screen.queryByText(/\(3FN\)/i)).toBeNull();
      expect(screen.queryByText(/Painel da Equipe de Apoio \(Staff\)/i)).toBeNull();

      // REGRA: Subtítulo longo removido
      expect(screen.queryByText('Gerenciamento presencial de entrada de expositores e credenciamento de avaliadores.')).toBeNull();

      // Botões de abas limpos
      expect(screen.getByRole('button', { name: /Credenciar Expositores/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Credenciar Avaliadores/i })).toBeInTheDocument();
      expect(screen.queryByText('Credenciar Avaliadores (3FN)')).toBeNull();
    });

    it('deve expandir a largura da janela para max-w-[1800px] e aumentar a fonte das abas', () => {
      const { container } = render(<TelaStaff />);

      // Verifica classe de largura expandida
      const mainElement = container.querySelector('main');
      expect(mainElement).toHaveClass('max-w-[1800px]');

      // Verifica tamanho da fonte aumentado nas abas
      const tabExpositores = screen.getByRole('button', { name: /Credenciar Expositores/i });
      const tabAvaliadores = screen.getByRole('button', { name: /Credenciar Avaliadores/i });

      expect(tabExpositores.className).toContain('text-base');
      expect(tabExpositores.className).toContain('lg:text-xl');
      expect(tabAvaliadores.className).toContain('text-base');
      expect(tabAvaliadores.className).toContain('lg:text-xl');
    });

    it('deve ocultar o botão de Telão no Cabecalho quando o perfil ou tela for Staff', () => {
      const aoMudarTelaMock = vi.fn();

      // Cenário 1: Na tela do Staff com perfil staff
      const { unmount } = render(
        <Cabecalho tela_atual="staff" papel="staff" ao_mudar_tela={aoMudarTelaMock} />
      );
      expect(screen.queryByRole('button', { name: /Telão/i })).toBeNull();
      unmount();

      // Cenário 2: Admin logado acessando o painel de admin
      render(
        <Cabecalho tela_atual="admin" papel="admin" ao_mudar_tela={aoMudarTelaMock} />
      );
      expect(screen.getByRole('button', { name: /Telão/i })).toBeInTheDocument();
    });
  });

  describe('2. Layout de Expositores: Tabela com Corredor, Estande, Expositores e Ordenamento', () => {
    it('deve renderizar a listagem de expositores em formato de tabela com todas as colunas solicitadas', () => {
      render(<TelaStaff />);

      // Verifica cabeçalhos da tabela
      expect(screen.getByRole('columnheader', { name: /Corredor/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Estande/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Projeto/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Instituição/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Expositores/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Check-in \/ Status/i })).toBeInTheDocument();

      // Verifica dados nos registros de contingência
      expect(screen.getAllByText('Corredor A').length).toBeGreaterThan(0);
      expect(screen.getByText('E-01')).toBeInTheDocument();
      expect(screen.getByText('Dispositivo IoT para Monitoramento Agrícola')).toBeInTheDocument();
      expect(screen.getByText('Lucas Silva, Beatriz Santos')).toBeInTheDocument();
      expect(screen.getByText('IFMS - Campus Corumbá')).toBeInTheDocument();
    });

    it('deve alternar ordenação ao clicar nos cabeçalhos das colunas de expositores', async () => {
      render(<TelaStaff />);

      const user = userEvent.setup();
      const colEstande = screen.getByRole('columnheader', { name: /Estande/i });
      const colCorredor = screen.getByRole('columnheader', { name: /Corredor/i });

      // Clica para ordenar por corredor
      await user.click(colCorredor);
      expect(colCorredor).toHaveAttribute('title', 'Clique para ordenar por Corredor');

      // Clica novamente para inverter a ordem
      await user.click(colCorredor);

      // Clica para ordenar por estande
      await user.click(colEstande);
    });

    it('deve alternar status de check-in presencial ao clicar no botão de ação', async () => {
      render(<TelaStaff />);

      const user = userEvent.setup();

      // Projetos pendentes têm o botão "Confirmar Check-in"
      const botoesConfirmar = screen.getAllByRole('button', { name: /Confirmar Check-in/i });
      expect(botoesConfirmar.length).toBeGreaterThan(0);
      await user.click(botoesConfirmar[0]);

      // Deve exibir toast de notificação limpo sem "(Modo Contingência)"
      await waitFor(() => {
        expect(screen.getByText('Check-in confirmado com sucesso!')).toBeInTheDocument();
      });
      expect(screen.queryByText(/Modo Contingência/i)).toBeNull();
    });
  });

  describe('3. Layout de Avaliadores: Padrão Gestor do Admin (Sem Botão de Lixeira)', () => {
    it('deve exibir tabela de avaliadores semelhante ao Gestor com botões de modalidades e SEM ícone de lixeira', async () => {
      render(<TelaStaff />);

      const user = userEvent.setup();
      const tabAvaliadores = screen.getByRole('button', { name: /Credenciar Avaliadores/i });
      await user.click(tabAvaliadores);

      // Cabeçalhos da tabela no padrão Admin
      expect(screen.getByRole('columnheader', { name: /Credenciamento/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Nome/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Instituição/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /E-mail/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Modalidades/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Áreas/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Ações/i })).toBeInTheDocument();

      // Avaliadores cadastrados
      expect(screen.getByText('Prof. Carlos Eduardo')).toBeInTheDocument();
      expect(screen.getByText('Dra. Ana Paula Ferreira')).toBeInTheDocument();

      // REGRA EXPRESSA DO USUÁRIO: Excluir apenas o botão de lixeira (exclusão)
      // Botão de editar (lápis) DEVE existir
      const botoesEditar = screen.getAllByTitle('Editar Avaliador');
      expect(botoesEditar.length).toBeGreaterThan(0);

      // Botão de excluir (lixeira) NÃO DEVE existir
      expect(screen.queryByTitle(/Excluir Avaliador/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /Excluir/i })).toBeNull();
    });

    it('deve permitir bloquear e liberar modalidades diretamente na linha da tabela', async () => {
      render(<TelaStaff />);

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Credenciar Avaliadores/i }));

      // Botão de modalidade "Ensino Médio"
      const botaoModalidade = screen.getAllByRole('button', { name: /Ensino Médio/i })[0];
      await user.click(botaoModalidade);

      // Deve notificar a alteração (bloqueada ou liberada)
      await waitFor(() => {
        expect(screen.getByText(/Modalidade "Ensino Médio" (bloqueada|liberada)\./i)).toBeInTheDocument();
      });
    });

    it('deve abrir modal de edição ao clicar no lápis e salvar alterações sem conter lixeira', async () => {
      render(<TelaStaff />);

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Credenciar Avaliadores/i }));

      const botaoEditar = screen.getAllByTitle('Editar Avaliador')[0];
      await user.click(botaoEditar);

      // Modal aberto
      expect(screen.getByText('Editar Avaliador')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Salvar Alterações/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancelar/i })).toBeInTheDocument();

      // Confirma que não há botão de lixeira no modal
      expect(screen.queryByRole('button', { name: /Excluir/i })).toBeNull();

      // Salva edição
      await user.click(screen.getByRole('button', { name: /Salvar Alterações/i }));

      await waitFor(() => {
        expect(screen.getByText('Avaliador atualizado com sucesso.')).toBeInTheDocument();
      });
    });
  });

  describe('4. QR Code Dinâmico e Tela de Autocadastro de Avaliadores', () => {
    it('deve exibir card de QR Code com link dinâmico e botão para copiar', async () => {
      render(<TelaStaff />);

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Credenciar Avaliadores/i }));

      const cardTitulo = screen.getByText('Autocadastro de Avaliadores no Celular');
      expect(cardTitulo).toBeInTheDocument();

      // REGRA: Padrão de cores com fundo branco (sem degradê escuro)
      const containerCard = cardTitulo.closest('div.bg-white') || cardTitulo.closest('div[class*="bg-white"]');
      expect(containerCard).not.toBeNull();
      expect(containerCard?.className).not.toContain('from-emerald-900');

      expect(screen.getByText('Copiar Link de Autocadastro')).toBeInTheDocument();
      expect(screen.getByText('Abrir Tela de Cadastro')).toBeInTheDocument();

      // Clicar em copiar link
      await user.click(screen.getByText('Copiar Link de Autocadastro'));
      await waitFor(() => {
        expect(screen.getByText('Link copiado para a área de transferência.')).toBeInTheDocument();
      });
    });

    it('deve permitir que o avaliador preencha o autocadastro e exiba tela de sucesso com instruções para o Staff', async () => {
      const aoConcluirMock = vi.fn();
      render(<TelaAutocadastroAvaliador aoConcluir={aoConcluirMock} />);

      expect(screen.getByText('Autocadastro de Avaliador')).toBeInTheDocument();

      // Preenche dados
      fireEvent.change(screen.getByPlaceholderText(/Prof\. Dr\. Carlos Silva/i), {
        target: { value: 'Prof. Roberto Mendes' },
      });
      fireEvent.change(screen.getByPlaceholderText(/seu\.email@exemplo\.com/i), {
        target: { value: 'roberto.mendes@escola.br' },
      });

      // Seleciona instituição
      const selectInst = screen.getByRole('combobox');
      fireEvent.change(selectInst, { target: { value: 'inst-1' } });

      // Seleciona área
      const btnArea = screen.getByRole('button', { name: /Ciências Exatas e da Terra/i });
      fireEvent.click(btnArea);

      // Submete formulário
      const btnSubmit = screen.getByRole('button', { name: /Concluir Cadastro/i });
      fireEvent.click(btnSubmit);

      // Aguarda tela de sucesso
      await waitFor(() => {
        expect(screen.getByText('Cadastro Concluído!')).toBeInTheDocument();
      });

      expect(
        screen.getByText(/apresente-se à recepção \(equipe Staff\)/i)
      ).toBeInTheDocument();

      // Clica em ir para tela de acesso
      fireEvent.click(screen.getByRole('button', { name: /Ir para a Tela de Acesso/i }));
      expect(aoConcluirMock).toHaveBeenCalled();
    });
  });
});
