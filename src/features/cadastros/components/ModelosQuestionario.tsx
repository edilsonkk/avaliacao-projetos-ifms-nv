import React, { useEffect, useState } from 'react';
import { BookCopy, Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';

export interface ModeloQuestionario {
  id_modelo: string;
  titulo: string;
  descricao: string | null;
  escala_minima: number;
  escala_maxima: number;
  total_perguntas: number;
  is_original: boolean;
}

/** Questionário do evento já ativo, com a origem da cópia (modelo ou questionário de outro evento). */
export interface QuestionarioAtivo {
  id_questionario: string;
  titulo: string;
  id_origem: string | null;
}

type Confirmacao = { tipo: 'excluir'; modelo: ModeloQuestionario } | { tipo: 'restaurar' };

/**
 * Questionários prontos: marcar "Ativo neste evento" copia o modelo para o evento ativo; desmarcar pede confirmação
 * e exclui a cópia (o banco recusa se ela já foi usada em avaliação). O lápis carrega o modelo no formulário abaixo.
 */
export const ModelosQuestionario: React.FC<{
  idEvento: string;
  ativos: QuestionarioAtivo[];
  /** Muda quando o pai grava um modelo, para recarregar a lista. */
  versao?: number;
  idModeloEmEdicao?: string | null;
  aoAtivar: () => Promise<void> | void;
  aoDesativar: (questionario: QuestionarioAtivo) => void;
  aoEditar: (modelo: ModeloQuestionario) => void;
  aoNovo: () => void;
  aoAlterarModelos?: () => void;
  aoAviso: (mensagem: string) => void;
  aoErro: (mensagem: string) => void;
}> = ({ idEvento, ativos, versao = 0, idModeloEmEdicao, aoAtivar, aoDesativar, aoEditar, aoNovo, aoAlterarModelos, aoAviso, aoErro }) => {
  const [modelos, set_modelos] = useState<ModeloQuestionario[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [ativando, set_ativando] = useState<string | null>(null);
  const [confirmacao, set_confirmacao] = useState<Confirmacao | null>(null);
  const [processando, set_processando] = useState<boolean>(false);
  const [recarregar, set_recarregar] = useState<number>(0);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from('modelos_questionario')
        .select('id_modelo, titulo, descricao, escala_minima, escala_maxima, is_original, perguntas_modelo_questionario(count)')
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
            is_original: m.is_original === true,
          }))
        );
      }
      set_carregando(false);
    })();
    return () => {
      cancelado = true;
    };
    // aoErro muda a cada render do pai; a lista só recarrega quando algo foi gravado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao, recarregar]);

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

  const confirmar = async () => {
    const alvo = confirmacao;
    if (!alvo || !(await garantirSessaoAdmin())) return;
    set_processando(true);
    try {
      const { error } =
        alvo.tipo === 'excluir'
          ? await supabase.rpc('admin_excluir_modelo_questionario', { p_id_modelo: alvo.modelo.id_modelo })
          : await supabase.rpc('admin_restaurar_modelos_originais');
      set_confirmacao(null);
      if (error) {
        aoErro(
          alvo.tipo === 'excluir'
            ? `Não foi possível excluir o modelo "${alvo.modelo.titulo}": ${tratarErroEscritaAdmin(error)}`
            : `Não foi possível restaurar os modelos originais: ${tratarErroEscritaAdmin(error)}`
        );
        return;
      }
      aoAviso(alvo.tipo === 'excluir' ? `Modelo "${alvo.modelo.titulo}" excluído.` : 'Modelos originais restaurados.');
      set_recarregar((n) => n + 1);
      aoAlterarModelos?.();
    } finally {
      set_processando(false);
    }
  };

  return (
    <section aria-labelledby="titulo-modelos-questionario" className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3 id="titulo-modelos-questionario" className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <BookCopy className="w-4 h-4 text-violet-500" />
          Questionários prontos
        </h3>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={aoNovo}
            className="px-3 py-1.5 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-lg inline-flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Novo modelo
          </button>
          <button
            type="button"
            onClick={() => set_confirmacao({ tipo: 'restaurar' })}
            className="px-3 py-1.5 text-xs font-bold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg inline-flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Restaurar originais
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Marque os que serão usados neste evento. Cada um vira uma cópia do evento. Editar um modelo ativo atualiza também a
        cópia deste evento, se ela ainda não foi usada em avaliação.
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
            const emEdicao = idModeloEmEdicao === modelo.id_modelo;
            return (
              <li
                key={modelo.id_modelo}
                className={`p-4 rounded-2xl border space-y-2 ${
                  emEdicao
                    ? 'border-violet-400 dark:border-violet-700 ring-2 ring-violet-300 dark:ring-violet-800'
                    : ativo
                      ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h4 className="font-extrabold text-slate-900 dark:text-white leading-snug">{modelo.titulo}</h4>
                    <p className="text-slate-500 text-[11px]">
                      {modelo.total_perguntas} perguntas · escala {modelo.escala_minima}–{modelo.escala_maxima}
                      {modelo.is_original ? ' · original' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => aoEditar(modelo)}
                      aria-label={`Editar modelo ${modelo.titulo}`}
                      title="Editar"
                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50 cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => set_confirmacao({ tipo: 'excluir', modelo })}
                      aria-label={`Excluir modelo ${modelo.titulo}`}
                      title="Excluir"
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={ativo}
                      aria-label={`Ativo neste evento: ${modelo.titulo}`}
                      disabled={!idEvento || ativando !== null}
                      onClick={() => alternar(modelo, copia)}
                      className={`relative ml-1 w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
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
                </div>
                {modelo.descricao && <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{modelo.descricao}</p>}
                {ativo && <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Ativo neste evento</p>}
              </li>
            );
          })}
        </ul>
      )}

      {confirmacao && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titulo-confirmar-modelo"
            aria-describedby="texto-confirmar-modelo"
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4"
          >
            <h3 id="titulo-confirmar-modelo" className="text-base font-bold text-slate-900 dark:text-white">
              {confirmacao.tipo === 'excluir' ? `Excluir o modelo "${confirmacao.modelo.titulo}"?` : 'Restaurar os modelos originais?'}
            </h3>
            <p id="texto-confirmar-modelo" className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {confirmacao.tipo === 'excluir'
                ? 'O modelo e as perguntas dele são apagados. As cópias já ativadas nos eventos continuam existindo.' +
                  (confirmacao.modelo.is_original ? ' Este é um modelo original: dá para recriá-lo em "Restaurar originais".' : '')
                : 'Os 7 modelos originais excluídos são recriados e os editados voltam ao texto original. Os modelos criados por você não mudam, nem as cópias nos eventos.'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => set_confirmacao(null)}
                disabled={processando}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={processando}
                className={`px-4 py-2.5 rounded-xl text-white text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50 ${
                  confirmacao.tipo === 'excluir' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-violet-600 hover:bg-violet-700'
                }`}
              >
                {processando && <Loader2 className="w-4 h-4 animate-spin" />}
                {confirmacao.tipo === 'excluir' ? 'Excluir modelo' : 'Restaurar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
