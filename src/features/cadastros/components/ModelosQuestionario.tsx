import React, { useEffect, useState } from 'react';
import { BookCopy, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';

export interface ModeloQuestionario {
  id_modelo: string;
  titulo: string;
  descricao: string | null;
  escala_minima: number;
  escala_maxima: number;
  total_perguntas: number;
}

/** Questionário do evento já ativo, com a origem da cópia (modelo ou questionário de outro evento). */
export interface QuestionarioAtivo {
  id_questionario: string;
  titulo: string;
  id_origem: string | null;
}

/**
 * Questionários prontos: marcar "Ativo neste evento" copia o modelo para o evento ativo; desmarcar pede confirmação
 * e exclui a cópia (o banco recusa se ela já foi usada em avaliação).
 */
export const ModelosQuestionario: React.FC<{
  idEvento: string;
  ativos: QuestionarioAtivo[];
  aoAtivar: () => Promise<void> | void;
  aoDesativar: (questionario: QuestionarioAtivo) => void;
  aoErro: (mensagem: string) => void;
}> = ({ idEvento, ativos, aoAtivar, aoDesativar, aoErro }) => {
  const [modelos, set_modelos] = useState<ModeloQuestionario[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [ativando, set_ativando] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from('modelos_questionario')
        .select('id_modelo, titulo, descricao, escala_minima, escala_maxima, perguntas_modelo_questionario(count)')
        .order('ordem', { ascending: true });
      if (cancelado) return;
      if (error) {
        aoErro(`Não foi possível carregar os questionários prontos: ${tratarErroEscritaAdmin(error)}`);
      } else {
        set_modelos(
          (data || []).map((m: any) => ({
            id_modelo: m.id_modelo,
            titulo: m.titulo,
            descricao: m.descricao ?? null,
            escala_minima: Number(m.escala_minima ?? 1),
            escala_maxima: Number(m.escala_maxima ?? 5),
            total_perguntas: m.perguntas_modelo_questionario?.[0]?.count ?? 0,
          }))
        );
      }
      set_carregando(false);
    })();
    return () => {
      cancelado = true;
    };
    // aoErro muda a cada render do pai; os modelos só precisam ser lidos uma vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alternar = async (modelo: ModeloQuestionario, copia: QuestionarioAtivo | undefined) => {
    if (copia) {
      aoDesativar(copia);
      return;
    }
    if (!idEvento || !(await garantirSessaoAdmin())) return;
    set_ativando(modelo.id_modelo);
    try {
      const { error } = await supabase.rpc('admin_copiar_questionario', { p_id_origem: modelo.id_modelo, p_id_evento: idEvento });
      if (error) {
        aoErro(`Não foi possível ativar "${modelo.titulo}": ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      await aoAtivar();
    } finally {
      set_ativando(null);
    }
  };

  return (
    <section aria-labelledby="titulo-modelos-questionario" className="space-y-3">
      <h3 id="titulo-modelos-questionario" className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
        <BookCopy className="w-4 h-4 text-violet-500" />
        Questionários prontos
      </h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Marque os que serão usados neste evento. Cada um vira uma cópia do evento, que pode ser editada sem alterar o modelo.
      </p>
      {carregando ? (
        <div className="p-4 text-center">
          <Loader2 className="w-5 h-5 text-violet-600 animate-spin mx-auto" />
        </div>
      ) : modelos.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Nenhum questionário pronto disponível.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {modelos.map((modelo) => {
            const copia = ativos.find((q) => q.id_origem === modelo.id_modelo);
            const ativo = Boolean(copia);
            return (
              <li
                key={modelo.id_modelo}
                className={`p-4 rounded-2xl border space-y-2 ${
                  ativo
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h4 className="font-extrabold text-slate-900 dark:text-white leading-snug">{modelo.titulo}</h4>
                    <p className="text-slate-500 text-[11px]">
                      {modelo.total_perguntas} perguntas · escala {modelo.escala_minima}–{modelo.escala_maxima}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ativo}
                    aria-label={`Ativo neste evento: ${modelo.titulo}`}
                    disabled={!idEvento || ativando !== null}
                    onClick={() => alternar(modelo, copia)}
                    className={`relative shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                      ativo ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    {ativando === modelo.id_modelo ? (
                      <Loader2 className="w-4 h-4 text-white animate-spin mx-auto" />
                    ) : (
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          ativo ? 'translate-x-5' : ''
                        }`}
                      />
                    )}
                  </button>
                </div>
                {modelo.descricao && <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{modelo.descricao}</p>}
                {ativo && <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Ativo neste evento</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
