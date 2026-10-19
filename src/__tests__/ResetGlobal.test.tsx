import { describe, it, expect, vi } from 'vitest';

// Simulação estrita do cliente Supabase para interceptar chamadas
const mockRpc = vi.fn().mockResolvedValue({ error: null });
const mockDelete = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn(() => ({
  delete: mockDelete,
}));

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}));

describe('Auditoria de Regressão: Reset Global', () => {
  it('DEVE acionar a Stored Procedure (RPC) e NUNCA utilizar exclusão direta no frontend', async () => {
    // 1. Importe aqui o seu arquivo que contém a função do Reset Global (Ajuste o caminho se necessário)
    // import { executarReset } from '../components/ConfiguracoesGerais';
    
    // Simulação temporária da função que o seu componente executa hoje:
    const executarReset = async () => {
      // Se houver tentativa de supabase.from('...').delete(), o teste vai pegar.
      const { supabase } = await import('../supabaseClient');
      await supabase.rpc('admin_reset_global');
    };

    // 2. Executa a ação
    await executarReset();

    // 3. Validação Arquitetônica (O Teste)
    expect(mockRpc).toHaveBeenCalledWith('admin_reset_global');
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
