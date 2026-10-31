import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';

interface QuestionarioAnterior {
  id_questionario: string;
  titulo: string;
  nome_evento: string;
  data_evento: string | null;
  total_perguntas: number;
  total_avaliacoes: number;
  ja_no_evento: boolean;
}

const formatarData = (data: string | null) => (data ? data.split('-').reverse().join('/') : 'sem data');

/** Diálogo que lista os questionários de eventos anteriores e copia o escolhido para o evento ativo. */
export const ReaproveitarQuestionario: React.FC<{
  idEvento: string;
  aoCopiar: () => Promise<void> | void;
  aoFechar: () => void;
}> = ({ idEvento, aoCopiar, aoFechar }) => {
  const [lista, set_lista] = useState<QuestionarioAnterior[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [copiando, set_copiando] = useState<string | null>(null);
  const [erro, set_erro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase.rpc('admin_listar_questionarios_reaproveitaveis', { p_id_evento: idEvento });
      if (cancelado) return;
      if (error) set_erro(`Não foi possível carregar os questionários anteriores: ${tratarErroEscritaAdmin(error)}`);
      else set_lista((data as QuestionarioAnterior[]) || []);
      set_carregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [idEvento]);

  const copiar = async (quest: QuestionarioAnterior) => {
    if (!(await garantirSessaoAdmin())) return;
    set_erro(null);
    set_copiando(quest.id_questionario);
    try {
      const { error } = await supabase.rpc('admin_copiar_questionario', { p_id_origem: quest.id_questionario, p_id_evento: idEvento });
      if (error) {
        set_erro(`Não foi possível copiar "${quest.titulo}": ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      set_lista((prev) => prev.map((q) => (q.id_questionario === quest.id_questionario ? { ...q, ja_no_evento: true } : q)));
      await aoCopiar();
    } finally {
      set_copiando(null);
    }
  };

  // Agrupa por evento, mantendo a ordem do banco (eventos mais recentes primeiro)
  const grupos = lista.reduce<{ chave: string; itens: QuestionarioAnterior[] }[]>((acc, q) => {
    const chave = `${q.nome_evento} (${formatarData(q.data_evento)})`;
    const grupo = acc.find((g) => g.chave === chave);
    if (grupo) grupo.itens.push(q);
    else acc.push({ chave, itens: [q] });
    return acc;
  }, []);

  return (
    <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-reaproveitar-questionario"
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id="titulo-reaproveitar-questionario" className="text-base font-bold text-slate-900 dark:text-white">
            Reaproveitar questionário de evento anterior
          </h3>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar reaproveitamento"
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          A cópia fica neste evento com as mesmas perguntas, textos de ajuda e pesos. O questionário original não muda.
        </p>

        {erro && (
          <div role="alert" className="p-3 text-xs text-white bg-red-600 rounded-xl font-medium">
            {erro}
          </div>
        )}

        {carregando ? (
          <div className="p-4 text-center">
            <Loader2 className="w-5 h-5 text-violet-600 animate-spin mx-auto" />
          </div>
        ) : lista.length === 0 && !erro ? (
          <p className="text-xs text-slate-500 italic">Nenhum questionário em eventos anteriores.</p>
        ) : (
          grupos.map((grupo) => (
            <section key={grupo.chave} aria-label={grupo.chave} className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{grupo.chave}</h4>
              <ul className="space-y-2">
                {grupo.itens.map((q) => (
                  <li
                    key={q.id_questionario}
                    className="p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-bold text-sm text-slate-900 dark:text-white">{q.titulo}</p>
                      <p className="text-[11px] text-slate-500">
                        {q.total_perguntas} pergunta(s) · usado em {q.total_avaliacoes} avaliação(ões)
                      </p>
                    </div>
                    {q.ja_no_evento ? (
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1 shrink-0">
                        <CheckCircle2 className="w-4 h-4" /> Já está neste evento
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => copiar(q)}
                        disabled={copiando !== null}
                        aria-label={`Copiar ${q.titulo} para este evento`}
                        className="px-3 py-1.5 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-lg inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-60"
                      >
                        {copiando === q.id_questionario ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                        Copiar para este evento
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
};
