import React, { useState } from 'react';
import { KeyRound, Link2, Loader2, Smartphone, Unlink, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface PropriedadesPainelAparelho {
  avaliador: { id_usuario: string; nome: string };
  aparelhoVinculado: boolean;
  aoFechar: () => void;
  /** Chamado depois de parear ou desvincular, para a tela recarregar a situação. */
  aoAlterarVinculo: () => void;
}

const formatarHora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Balcão do Staff: vincula o celular do avaliador (pareamento ou código de acesso)
 * ou desvincula um aparelho perdido/trocado. Tudo pelas RPCs com checagem is_staff().
 */
export const PainelAparelhoAvaliador: React.FC<PropriedadesPainelAparelho> = ({
  avaliador,
  aparelhoVinculado,
  aoFechar,
  aoAlterarVinculo,
}) => {
  const [codigoCelular, setCodigoCelular] = useState('');
  const [codigoGerado, setCodigoGerado] = useState<{ codigo: string; expira_em: string } | null>(null);
  const [processando, setProcessando] = useState<'parear' | 'gerar' | 'desvincular' | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const executar = async (acao: 'parear' | 'gerar' | 'desvincular') => {
    setMensagem(null);
    setProcessando(acao);
    try {
      if (acao === 'parear') {
        const { error } = await supabase.rpc('fn_parear_dispositivo', { p_codigo: codigoCelular, p_id_usuario: avaliador.id_usuario });
        if (error) throw error;
        setCodigoCelular('');
        setMensagem({ tipo: 'sucesso', texto: `Celular pareado com ${avaliador.nome}. O avaliador já pode começar.` });
        aoAlterarVinculo();
      } else if (acao === 'gerar') {
        const { data, error } = await supabase.rpc('fn_gerar_codigo_acesso', { p_id_usuario: avaliador.id_usuario });
        if (error) throw error;
        setCodigoGerado(data as { codigo: string; expira_em: string });
      } else {
        const { error } = await supabase.rpc('fn_desvincular_dispositivo', { p_id_usuario: avaliador.id_usuario });
        if (error) throw error;
        setCodigoGerado(null);
        setMensagem({ tipo: 'sucesso', texto: 'Aparelho desvinculado. O avaliador precisa parear de novo.' });
        aoAlterarVinculo();
      }
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: (e as { message?: string }).message || 'Não foi possível concluir a operação.' });
    } finally {
      setProcessando(null);
    }
  };

  const botao = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="titulo-aparelho" className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id="titulo-aparelho" className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white">
            <Smartphone aria-hidden="true" className="w-5 h-5 text-emerald-600" /> Aparelho de {avaliador.nome}
          </h2>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300">
          Situação: <strong>{aparelhoVinculado ? 'celular vinculado' : 'sem celular vinculado'}</strong>
        </p>

        {mensagem && (
          <p
            role={mensagem.tipo === 'erro' ? 'alert' : 'status'}
            className={`p-3 rounded-xl text-sm font-semibold ${
              mensagem.tipo === 'erro' ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
            }`}
          >
            {mensagem.texto}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            executar('parear');
          }}
          className="space-y-2"
        >
          <label htmlFor="codigo-celular" className="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300">
            Código mostrado no celular do avaliador:
          </label>
          <div className="flex gap-2">
            <input
              id="codigo-celular"
              required
              value={codigoCelular}
              onChange={(e) => setCodigoCelular(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono tracking-widest uppercase"
            />
            <button type="submit" disabled={processando !== null} className={`${botao} bg-emerald-600 hover:bg-emerald-700 text-white`}>
              {processando === 'parear' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Link2 aria-hidden="true" className="w-4 h-4" />}
              Parear
            </button>
          </div>
        </form>

        <div className="space-y-2 border-t border-slate-100 dark:border-slate-700 pt-4">
          <p className="text-xs text-slate-500">Sem câmera ou fora do balcão? Gere um código para o avaliador digitar no celular.</p>
          {codigoGerado ? (
            <div className="text-center space-y-1">
              <p role="status" aria-label="Código de acesso gerado" className="font-mono text-3xl font-black tracking-[0.3em] text-slate-900 dark:text-white">
                {codigoGerado.codigo}
              </p>
              <p className="text-xs text-slate-500">
                Válido até {formatarHora(codigoGerado.expira_em)}, uso único. Ele não será exibido de novo.
              </p>
            </div>
          ) : (
            <button type="button" onClick={() => executar('gerar')} disabled={processando !== null} className={`${botao} w-full border border-slate-300 dark:border-slate-600`}>
              {processando === 'gerar' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <KeyRound aria-hidden="true" className="w-4 h-4" />}
              Gerar código de acesso
            </button>
          )}
        </div>

        {aparelhoVinculado && (
          <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
            <button
              type="button"
              onClick={() => executar('desvincular')}
              disabled={processando !== null}
              className={`${botao} w-full text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800`}
            >
              {processando === 'desvincular' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Unlink aria-hidden="true" className="w-4 h-4" />}
              Desvincular aparelho
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
