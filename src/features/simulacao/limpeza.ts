import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, traduzirErroEscritaAdmin } from '@/lib/sessaoAdmin';
import type { ResumoLimpeza } from './tipos';

/**
 * Apaga uma simulação do banco, por `admin_apagar_simulacao`.
 *
 * A limpeza inteira vive no banco, e não aqui, por um motivo que só aparece depois de medir:
 * apagando pelo cliente, a cascata de `avaliacoes` e `questionarios` dispara os gatilhos de
 * auditoria de `respostas_avaliacao` e `perguntas_questionario`, que gravam com
 * `origem = 'direto'` e `id_evento` nulo. A regra C10 da conferência de notas ("nota alterada
 * fora do fluxo") inclui `id_evento IS NULL`, então esses registros viram achado **grave** em
 * TODOS os eventos — inclusive na feira real. Numa medição local, apagar uma simulação de 31
 * avaliações deixou 141 achados falsos e permanentes, porque a trilha é append-only.
 *
 * `auditoria_marcar_origem` resolve, mas vale só dentro da transação, e pelo PostgREST cada
 * chamada é uma transação própria — marcar numa requisição e apagar na seguinte não funciona.
 * Daí a função do banco, que também põe as guardas do lado do servidor (regra 3 do AGENTS.md):
 * só Admin, só evento com o prefixo de simulação, nunca o evento ativo.
 *
 * Ver `supabase/migrations/20261124220000_apagar_simulacao.sql` e docs/decisoes/0021.
 */
export const apagarSimulacao = async (idEvento: string): Promise<ResumoLimpeza> => {
  if (!(await garantirSessaoAdmin())) throw new Error('Sessão de administrador expirada.');

  const { data, error } = await supabase.rpc('admin_apagar_simulacao', {
    p_id_evento: idEvento,
  });
  if (error) throw new Error(traduzirErroEscritaAdmin(error));

  const resultado = (data ?? {}) as Record<string, number>;
  return {
    avaliacoesApagadas: Number(resultado.avaliacoes_apagadas ?? 0),
    eventosApagados: Number(resultado.eventos_apagados ?? 0),
    usuariosApagados: Number(resultado.usuarios_apagados ?? 0),
    usuariosPreservados: Number(resultado.usuarios_preservados ?? 0),
  };
};
