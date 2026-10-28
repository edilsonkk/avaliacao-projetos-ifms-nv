import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/lib/supabase';
import {
  garantirSessaoAparelho,
  obterPerfilSessao,
  salvarPerfilLocal,
  solicitarCodigoPareamento,
  vincularComCodigoAcesso,
  type PerfilSessao,
} from '@/features/auth/vinculoAparelho';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: { getSession: vi.fn(), signInAnonymously: vi.fn() },
  },
}));

const perfilAvaliador = (sobrescrever: Partial<PerfilSessao> = {}): PerfilSessao => ({
  autenticado: true,
  papel: 'avaliador',
  id_usuario: 'u-1',
  nome: 'Maria Souza',
  email: 'maria@ifms.edu.br',
  id_evento: 'e-1',
  metodos_vinculo: 'ambos',
  ...sobrescrever,
});

describe('vinculoAparelho', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('deve criar sessão anônima só quando o aparelho ainda não tem sessão', async () => {
    // Arrange
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: null } as never);
    vi.mocked(supabase.auth.signInAnonymously).mockResolvedValue({ data: {}, error: null } as never);

    // Act
    await garantirSessaoAparelho();

    // Assert
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('não deve criar outra sessão quando já existe uma', async () => {
    // Arrange
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: { access_token: 't' } }, error: null } as never);

    // Act
    await garantirSessaoAparelho();

    // Assert
    expect(supabase.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('deve repassar o erro do login anônimo', async () => {
    // Arrange
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({ data: { session: null }, error: null } as never);
    vi.mocked(supabase.auth.signInAnonymously).mockResolvedValueOnce({ data: {}, error: { message: 'Anonymous sign-ins are disabled' } } as never);

    // Act / Assert
    await expect(garantirSessaoAparelho()).rejects.toThrow('Anonymous sign-ins are disabled');
  });

  it('deve consultar o perfil da sessão no banco', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: perfilAvaliador(), error: null } as never);

    // Act
    const perfil = await obterPerfilSessao();

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('fn_meu_perfil');
    expect(perfil.papel).toBe('avaliador');
  });

  it('deve pedir o código de pareamento ao banco', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { codigo: 'K7Q4MP', expira_em: '2026-10-28T20:10:00Z' }, error: null } as never);

    // Act
    const resultado = await solicitarCodigoPareamento();

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('fn_solicitar_pareamento');
    expect(resultado.codigo).toBe('K7Q4MP');
  });

  it('deve devolver a recusa do código de acesso sem lançar exceção', async () => {
    // Arrange
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { ok: false, erro: 'E-mail ou código inválido.' }, error: null } as never);

    // Act
    const resultado = await vincularComCodigoAcesso('maria@ifms.edu.br', 'AAAAAA');

    // Assert
    expect(supabase.rpc).toHaveBeenCalledWith('fn_vincular_com_codigo', { p_email: 'maria@ifms.edu.br', p_codigo: 'AAAAAA' });
    expect(resultado).toEqual({ ok: false, erro: 'E-mail ou código inválido.' });
  });

  it('deve gravar no navegador o perfil confirmado do avaliador', () => {
    // Act
    salvarPerfilLocal(perfilAvaliador());

    // Assert
    expect(localStorage.getItem('sessao_id_usuario')).toBe('u-1');
    expect(localStorage.getItem('usuario_perfil')).toBe('avaliador');
    expect(localStorage.getItem('avaliador_nome')).toBe('Maria Souza');
  });

  it('não deve gravar nada quando a sessão ainda não tem papel', () => {
    // Act
    salvarPerfilLocal(perfilAvaliador({ papel: null, id_usuario: null }));

    // Assert
    expect(localStorage.length).toBe(0);
  });
});
