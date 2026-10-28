import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { PainelAparelhoAvaliador } from '@/features/staff/components/PainelAparelhoAvaliador';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

const avaliador = { id_usuario: 'u-1', nome: 'Maria Souza' };

describe('PainelAparelhoAvaliador', () => {
  it('deve parear o celular com o código mostrado nele', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoAlterarVinculo = vi.fn();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true }, error: null } as never);
    render(<PainelAparelhoAvaliador avaliador={avaliador} aparelhoVinculado={false} aoFechar={vi.fn()} aoAlterarVinculo={aoAlterarVinculo} />);

    // Act
    await user.type(screen.getByLabelText(/código mostrado no celular/i), 'k7q4mp');
    await user.click(screen.getByRole('button', { name: /^parear$/i }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('fn_parear_dispositivo', { p_codigo: 'K7Q4MP', p_id_usuario: 'u-1' });
    expect(await screen.findByRole('status')).toHaveTextContent(/pareado com maria souza/i);
    expect(aoAlterarVinculo).toHaveBeenCalled();
  });

  it('deve mostrar o motivo quando o código do celular não vale mais', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'Código de pareamento inválido ou expirado.' } } as never);
    render(<PainelAparelhoAvaliador avaliador={avaliador} aparelhoVinculado={false} aoFechar={vi.fn()} aoAlterarVinculo={vi.fn()} />);

    // Act
    await user.type(screen.getByLabelText(/código mostrado no celular/i), 'ZZZZZZ');
    await user.click(screen.getByRole('button', { name: /^parear$/i }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/inválido ou expirado/i);
  });

  it('deve gerar um código de acesso e exibi-lo uma única vez', async () => {
    // Arrange
    const user = userEvent.setup();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { codigo: 'R8W2KT', expira_em: new Date(Date.now() + 900_000).toISOString() }, error: null } as never);
    render(<PainelAparelhoAvaliador avaliador={avaliador} aparelhoVinculado={false} aoFechar={vi.fn()} aoAlterarVinculo={vi.fn()} />);

    // Act
    await user.click(screen.getByRole('button', { name: /gerar código de acesso/i }));

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('fn_gerar_codigo_acesso', { p_id_usuario: 'u-1' });
    expect(await screen.findByRole('status', { name: /código de acesso gerado/i })).toHaveTextContent('R8W2KT');
    expect(screen.getByText(/não será exibido de novo/i)).toBeInTheDocument();
  });

  it('deve desvincular o aparelho só quando há um vinculado', async () => {
    // Arrange
    const user = userEvent.setup();
    const aoAlterarVinculo = vi.fn();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true }, error: null } as never);
    const { rerender } = render(
      <PainelAparelhoAvaliador avaliador={avaliador} aparelhoVinculado={false} aoFechar={vi.fn()} aoAlterarVinculo={aoAlterarVinculo} />,
    );
    expect(screen.queryByRole('button', { name: /desvincular aparelho/i })).not.toBeInTheDocument();

    // Act
    rerender(<PainelAparelhoAvaliador avaliador={avaliador} aparelhoVinculado aoFechar={vi.fn()} aoAlterarVinculo={aoAlterarVinculo} />);
    await user.click(screen.getByRole('button', { name: /desvincular aparelho/i }));

    // Assert
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('fn_desvincular_dispositivo', { p_id_usuario: 'u-1' }));
    expect(aoAlterarVinculo).toHaveBeenCalled();
  });
});
