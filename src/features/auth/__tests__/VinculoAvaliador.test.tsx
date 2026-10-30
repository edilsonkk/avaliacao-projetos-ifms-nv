import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VinculoAvaliador } from '@/features/auth/components/VinculoAvaliador';
import * as vinculo from '@/features/auth/vinculoAparelho';
import type { PerfilSessao } from '@/features/auth/vinculoAparelho';
import { EVENTO_APP_RETOMADA } from '@/lib/keepAliveSessao';

vi.mock('@/features/auth/vinculoAparelho', () => ({
  garantirSessaoAparelho: vi.fn(),
  obterPerfilSessao: vi.fn(),
  solicitarCodigoPareamento: vi.fn(),
  vincularComCodigoAcesso: vi.fn(),
}));

const perfil = (papel: PerfilSessao['papel'], metodos: PerfilSessao['metodos_vinculo'] = 'ambos'): PerfilSessao => ({
  autenticado: true,
  papel,
  id_usuario: papel ? 'u-1' : null,
  nome: papel ? 'Maria Souza' : null,
  email: papel ? 'maria@ifms.edu.br' : null,
  id_evento: 'e-1',
  metodos_vinculo: metodos,
});

const daquiA = (minutos: number) => new Date(Date.now() + minutos * 60_000).toISOString();

describe('VinculoAvaliador', () => {
  beforeEach(() => {
    vi.mocked(vinculo.garantirSessaoAparelho).mockResolvedValue();
    vi.mocked(vinculo.solicitarCodigoPareamento).mockResolvedValue({ codigo: 'K7Q4MP', expira_em: daquiA(10) });
  });

  it('deve mostrar o código de pareamento para o Staff', async () => {
    // Arrange
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValue(perfil(null));

    // Act
    render(<VinculoAvaliador aoVincular={vi.fn()} />);

    // Assert
    expect(await screen.findByRole('status', { name: /código de pareamento/i })).toHaveTextContent('K7Q4MP');
    expect(vinculo.garantirSessaoAparelho).toHaveBeenCalled();
  });

  it('deve entrar sozinho quando o Staff confirma o pareamento', async () => {
    // Arrange
    const aoVincular = vi.fn();
    vi.mocked(vinculo.obterPerfilSessao)
      .mockResolvedValueOnce(perfil(null))
      .mockResolvedValue(perfil('avaliador'));

    // Act
    render(<VinculoAvaliador aoVincular={aoVincular} intervaloConsultaMs={10} />);

    // Assert
    await waitFor(() => expect(aoVincular).toHaveBeenCalledWith(expect.objectContaining({ papel: 'avaliador', nome: 'Maria Souza' })));
  });

  it('deve entrar direto quando o aparelho já está vinculado', async () => {
    // Arrange
    const aoVincular = vi.fn();
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValue(perfil('avaliador'));

    // Act
    render(<VinculoAvaliador aoVincular={aoVincular} />);

    // Assert
    await waitFor(() => expect(aoVincular).toHaveBeenCalled());
    expect(vinculo.solicitarCodigoPareamento).not.toHaveBeenCalled();
  });

  it('deve vincular com e-mail e código de acesso', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoVincular = vi.fn();
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValueOnce(perfil(null)).mockResolvedValue(perfil('avaliador'));
    vi.mocked(vinculo.vincularComCodigoAcesso).mockResolvedValue({ ok: true });
    render(<VinculoAvaliador aoVincular={aoVincular} intervaloConsultaMs={60_000} />);

    // Act
    await user.click(await screen.findByRole('button', { name: /tenho um código de acesso/i }));
    await user.type(screen.getByLabelText(/e-mail cadastrado/i), 'maria@ifms.edu.br');
    await user.type(screen.getByRole('textbox', { name: /código de acesso/i }), 'r8w2kt');
    await user.click(screen.getByRole('button', { name: /vincular este celular/i }));

    // Assert
    expect(vinculo.vincularComCodigoAcesso).toHaveBeenCalledWith('maria@ifms.edu.br', 'R8W2KT');
    await waitFor(() => expect(aoVincular).toHaveBeenCalled());
  });

  it('deve mostrar a recusa do código sem entrar', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoVincular = vi.fn();
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValue(perfil(null, 'codigo'));
    vi.mocked(vinculo.vincularComCodigoAcesso).mockResolvedValue({ ok: false, erro: 'E-mail ou código inválido, expirado ou já utilizado.' });
    render(<VinculoAvaliador aoVincular={aoVincular} />);

    // Act
    await user.type(await screen.findByLabelText(/e-mail cadastrado/i), 'maria@ifms.edu.br');
    await user.type(screen.getByRole('textbox', { name: /código de acesso/i }), 'AAAAAA');
    await user.click(screen.getByRole('button', { name: /vincular este celular/i }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/inválido, expirado ou já utilizado/i);
    expect(aoVincular).not.toHaveBeenCalled();
  });

  it('deve esconder o pareamento quando o evento só aceita código de acesso', async () => {
    // Arrange
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValue(perfil(null, 'codigo'));

    // Act
    render(<VinculoAvaliador aoVincular={vi.fn()} />);

    // Assert
    expect(await screen.findByRole('textbox', { name: /código de acesso/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /parear com o staff/i })).not.toBeInTheDocument();
    expect(vinculo.solicitarCodigoPareamento).not.toHaveBeenCalled();
  });

  it('deve entrar assim que o celular é desbloqueado, sem esperar o próximo ciclo de consulta', async () => {
    // Arrange: consulta periódica longa; o Staff pareou enquanto o celular estava bloqueado
    const aoVincular = vi.fn();
    vi.mocked(vinculo.obterPerfilSessao).mockResolvedValueOnce(perfil(null)).mockResolvedValue(perfil('avaliador'));
    render(<VinculoAvaliador aoVincular={aoVincular} intervaloConsultaMs={60_000} />);
    await screen.findByRole('status', { name: /código de pareamento/i });

    // Act + Assert: o ouvinte é ligado num efeito depois da renderização; em máquina lenta (CI) ele pode
    // ainda não existir no primeiro disparo, então o evento é repetido até a tela reagir
    await waitFor(
      () => {
        act(() => {
          window.dispatchEvent(new Event(EVENTO_APP_RETOMADA));
        });
        expect(aoVincular).toHaveBeenCalledWith(expect.objectContaining({ papel: 'avaliador' }));
      },
      { timeout: 4000 }
    );
  });
});
