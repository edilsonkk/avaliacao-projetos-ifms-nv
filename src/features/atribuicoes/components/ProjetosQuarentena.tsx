import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, X, Loader2, ShieldCheck, ChevronDown, ChevronRight, Flag, Scale } from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { aoRetomarApp } from '@/lib/keepAliveSessao';
import { CabecalhoOrdenavel, compararNatural } from '@/components/ui/CabecalhoOrdenavel';

/**
 * Projetos em Quarentena (view_projetos_quarentena) do evento ativo.
 * Um projeto entra quando a maior e a menor nota ativas diferem mais de 2,5 pontos, ou quando uma avaliação foi
 * marcada pelo sistema. "Aceitar divergência" registra a análise do Admin (projetos.quarentena_resolvida_em):
 * o projeto sai da lista e só volta se chegar uma avaliação nova. Ver docs/regras-de-negocio/avaliacao-e-quarentena.md.
 */

export interface ProjetoQuarentena {
  id_projeto: string;
  codigo_projeto: string | null;
  titulo: string;
  estande: string | null;
  corredor: string | null;
  modalidade: string;
  area_tematica: string;
  nome_instituicao: string;
  total_avaliacoes: number;
  nota_minima: number | null;
  nota_maxima: number | null;
  diferenca_notas: number | null;
  tem_flag_quarentena: boolean;
}

interface AvaliacaoDoProjeto {
  id_avaliacao: string;
  nota_final: number | null;
  created_at: string | null;
  avaliador: string;
}

interface ProjetosQuarentenaProps {
  aoFechar?: () => void;
  aoAtualizarMetricas?: () => void;
  id_evento_ativo?: string;
}

type Coluna = 'codigo' | 'estande' | 'titulo' | 'diferenca' | 'avaliacoes';

/** Limite de divergência da regra de quarentena (mesmo valor da view e de fn_enviar_avaliacao). */
export const LIMITE_DIVERGENCIA = 2.5;

const formatarNota = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

export const ProjetosQuarentena: React.FC<ProjetosQuarentenaProps> = ({ aoFechar, aoAtualizarMetricas, id_evento_ativo }) => {
  const [projetos, set_projetos] = useState<ProjetoQuarentena[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [processando, set_processando] = useState<string | 'todos' | null>(null);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [mensagem_sucesso, set_mensagem_sucesso] = useState<string | null>(null);
  const [aberto, set_aberto] = useState<string | null>(null);
  const [avaliacoes, set_avaliacoes] = useState<Record<string, AvaliacaoDoProjeto[] | 'carregando' | 'erro'>>({});
  const [coluna, set_coluna] = useState<Coluna>('diferenca');
  const [direcao, set_direcao] = useState<'asc' | 'desc'>('desc');

  const conexao_banco = verificar_conexao_configurada();
  // Só o evento ativo recebido do painel (nunca um id guardado neste navegador, que pode ser de outro evento)
  const idEvento = id_evento_ativo || null;

  const carregar_quarentenas = useCallback(async () => {
    set_carregando(true);
    set_mensagem_erro(null);
    if (!conexao_banco) {
      set_projetos([]);
      set_carregando(false);
      return;
    }
    if (!idEvento) {
      set_projetos([]);
      set_mensagem_erro('Não há evento ativo: ative um evento para ver a quarentena.');
      set_carregando(false);
      return;
    }
    try {
      let consulta: any = supabase
        .from('view_projetos_quarentena')
        .select(
          'id_projeto, codigo_projeto, titulo, estande, corredor, modalidade, area_tematica, nome_instituicao, total_avaliacoes, nota_minima, nota_maxima, diferenca_notas, tem_flag_quarentena'
        );
      consulta = consulta.eq('id_evento', idEvento);
      const { data, error } = await consulta;
      if (error) throw error;
      set_projetos((data || []) as ProjetoQuarentena[]);
    } catch (err: any) {
      console.error('Erro ao consultar quarentenas:', err);
      set_mensagem_erro(`Não foi possível carregar a quarentena: ${err?.message || err}`);
      set_projetos([]);
    } finally {
      set_carregando(false);
    }
  }, [conexao_banco, idEvento]);

  useEffect(() => {
    carregar_quarentenas();
    return aoRetomarApp(carregar_quarentenas);
  }, [carregar_quarentenas]);

  const exibir_sucesso = (msg: string) => {
    set_mensagem_sucesso(msg);
    setTimeout(() => set_mensagem_sucesso(null), 4000);
  };

  // Notas de cada avaliador do projeto, para o Admin decidir se aceita a divergência ou cancela uma avaliação
  const alternar_detalhes = async (projeto: ProjetoQuarentena) => {
    if (aberto === projeto.id_projeto) {
      set_aberto(null);
      return;
    }
    set_aberto(projeto.id_projeto);
    if (Array.isArray(avaliacoes[projeto.id_projeto]) || !conexao_banco) return;
    set_avaliacoes((prev) => ({ ...prev, [projeto.id_projeto]: 'carregando' }));
    const { data, error } = await supabase
      .from('avaliacoes')
      .select('id_avaliacao, nota_final, created_at, status, usuarios ( nome )')
      .eq('id_projeto', projeto.id_projeto)
      .or('status.is.null,status.neq.CANCELADA') // mesma regra da view: só avaliações ativas
      .order('nota_final', { ascending: false });
    if (error) {
      console.error('Erro ao carregar avaliações do projeto:', error);
      set_avaliacoes((prev) => ({ ...prev, [projeto.id_projeto]: 'erro' }));
      return;
    }
    set_avaliacoes((prev) => ({
      ...prev,
      [projeto.id_projeto]: (data || []).map((a: any) => {
        const usuario = Array.isArray(a.usuarios) ? a.usuarios[0] : a.usuarios;
        return { id_avaliacao: a.id_avaliacao, nota_final: a.nota_final, created_at: a.created_at, avaliador: usuario?.nome || 'Avaliador não identificado' };
      }),
    }));
  };

  const aceitar_divergencia = async (projeto: ProjetoQuarentena) => {
    const codigo = projeto.codigo_projeto || projeto.titulo;
    const confirmado = window.confirm(
      `Aceitar a divergência de notas do projeto ${codigo}?\n\n` +
        'Ele sai da quarentena com as notas atuais e só volta se chegar uma avaliação nova. ' +
        'Para descartar uma nota fora da curva, use o card "Excluir uma avaliação".'
    );
    if (!confirmado) return;

    set_processando(projeto.id_projeto);
    set_mensagem_erro(null);
    try {
      if (conexao_banco) {
        if (!(await garantirSessaoAdmin())) return;
        const { error } = await supabase.rpc('admin_remover_quarentena', { p_id_projeto: projeto.id_projeto });
        if (error) throw error;
      }
      set_projetos((prev) => prev.filter((p) => p.id_projeto !== projeto.id_projeto));
      exibir_sucesso(`Projeto ${codigo} saiu da quarentena.`);
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err) {
      console.error('Erro ao tirar projeto da quarentena:', err);
      set_mensagem_erro(`Erro ao tirar da quarentena: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      set_processando(null);
    }
  };

  const aceitar_todos = async () => {
    const confirmado = window.confirm(
      `Aceitar a divergência dos ${projetos.length} projetos em quarentena deste evento?\n\n` +
        'Todos saem da quarentena com as notas atuais e só voltam se chegar uma avaliação nova.'
    );
    if (!confirmado) return;

    set_processando('todos');
    set_mensagem_erro(null);
    try {
      if (conexao_banco) {
        if (!(await garantirSessaoAdmin())) return;
        const { error } = await supabase.rpc('admin_remover_quarentena_evento', { p_id_evento: idEvento });
        if (error) throw error;
      }
      set_projetos([]);
      exibir_sucesso('Todos os projetos do evento saíram da quarentena.');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err) {
      console.error('Erro ao resolver quarentenas:', err);
      set_mensagem_erro(`Erro ao resolver a quarentena: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      set_processando(null);
    }
  };

  const alternar_ordenacao = (nova: Coluna) => {
    if (nova === coluna) set_direcao((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      set_coluna(nova);
      set_direcao(nova === 'diferenca' || nova === 'avaliacoes' ? 'desc' : 'asc');
    }
  };

  const projetos_ordenados = useMemo(() => {
    const valor = (p: ProjetoQuarentena): string | number => {
      switch (coluna) {
        case 'codigo': return p.codigo_projeto || '';
        case 'estande': return p.estande || '';
        case 'titulo': return p.titulo || '';
        case 'diferenca': return Number(p.diferenca_notas ?? 0);
        case 'avaliacoes': return Number(p.total_avaliacoes ?? 0);
      }
    };
    return [...projetos].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const comparacao = typeof va === 'number' && typeof vb === 'number' ? va - vb : compararNatural(String(va), String(vb));
      return direcao === 'asc' ? comparacao : -comparacao;
    });
  }, [projetos, coluna, direcao]);

  const total = projetos.length;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col w-full h-full max-h-[95vh] font-sans">
      {/* Cabeçalho */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 shadow-xs">
            <AlertTriangle aria-hidden="true" className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
              Projetos em Quarentena
              <span role="status" className="text-xs px-2.5 py-1 rounded-full font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                {total} {total === 1 ? 'projeto' : 'projetos'}
              </span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Notas que diferem mais de {formatarNota(LIMITE_DIVERGENCIA)} pontos entre avaliadores. Veja as notas, cancele uma avaliação
              fora da curva em "Excluir uma avaliação" ou aceite a divergência.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={aceitar_todos}
            disabled={processando !== null || total === 0 || (conexao_banco && !idEvento)}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-all shadow-xs flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {processando === 'todos' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <ShieldCheck aria-hidden="true" className="w-4 h-4" />}
            <span>Resolver Todos</span>
          </button>
          <button
            type="button"
            onClick={carregar_quarentenas}
            disabled={carregando}
            title="Atualizar lista"
            aria-label="Atualizar lista"
            className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <RefreshCw aria-hidden="true" className={`w-4 h-4 ${carregando ? 'animate-spin text-red-600' : ''}`} />
          </button>
          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              title="Fechar"
              aria-label="Fechar"
              className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer"
            >
              <X aria-hidden="true" className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Alertas */}
      {mensagem_erro && (
        <div role="alert" className="mx-6 mt-4 p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center gap-2">
          <AlertTriangle aria-hidden="true" className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-semibold">{mensagem_erro}</span>
        </div>
      )}
      {mensagem_sucesso && (
        <div role="status" className="mx-6 mt-4 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 aria-hidden="true" className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="font-semibold">{mensagem_sucesso}</span>
        </div>
      )}

      {/* Tabela */}
      <div className="flex-1 overflow-y-auto p-6">
        {carregando && projetos.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Loader2 aria-hidden="true" className="w-8 h-8 text-red-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Carregando projetos em quarentena...</p>
          </div>
        ) : projetos_ordenados.length === 0 ? (
          <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
            <CheckCircle2 aria-hidden="true" className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhum projeto em quarentena.</p>
            <p className="text-xs text-slate-400">As notas dos avaliadores estão dentro da diferença esperada.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-x-auto shadow-xs">
            <table className="w-full min-w-[820px] text-left text-xs">
              <caption className="sr-only">Projetos em quarentena do evento</caption>
              <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400">
                <tr>
                  <CabecalhoOrdenavel coluna="codigo" rotulo="Código" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="estande" rotulo="Estande" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="titulo" rotulo="Projeto" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="diferenca" rotulo="Divergência" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="avaliacoes" rotulo="Avaliações" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <th scope="col" className="px-4 py-3 text-right uppercase font-black tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {projetos_ordenados.map((p) => {
                  const codigo = p.codigo_projeto || 'N/I';
                  const divergente = Number(p.diferenca_notas ?? 0) > LIMITE_DIVERGENCIA;
                  const detalhes = avaliacoes[p.id_projeto];
                  const estaAberto = aberto === p.id_projeto;
                  return (
                    <React.Fragment key={p.id_projeto}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors align-top">
                        <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{codigo}</td>
                        <td className="px-4 py-3 font-mono font-bold text-red-600 dark:text-red-400 whitespace-nowrap">
                          {p.estande || '-'}
                          {p.corredor && <div className="text-[10px] font-sans font-semibold text-teal-600 dark:text-teal-400">{p.corredor}</div>}
                        </td>
                        <td className="px-4 py-3 min-w-[16rem] max-w-md">
                          <div className="font-bold text-slate-900 dark:text-white">{p.titulo}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            {p.nome_instituicao} · {p.modalidade} · {p.area_tematica}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {divergente ? (
                            <span className="inline-flex items-center gap-1 font-extrabold text-red-600 dark:text-red-400">
                              <Scale aria-hidden="true" className="w-3.5 h-3.5" />
                              {formatarNota(p.diferenca_notas)} pts
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-700 dark:text-amber-400">
                              <Flag aria-hidden="true" className="w-3.5 h-3.5" />
                              Marcado pelo sistema
                            </span>
                          )}
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            Menor {formatarNota(p.nota_minima)} · Maior {formatarNota(p.nota_maxima)}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-bold">{p.total_avaliacoes}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            onClick={() => alternar_detalhes(p)}
                            aria-expanded={estaAberto}
                            aria-controls={`notas-${p.id_projeto}`}
                            aria-label={`Ver notas do projeto ${codigo}`}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs border border-slate-300 dark:border-slate-700 transition-all inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            {estaAberto ? <ChevronDown aria-hidden="true" className="w-3.5 h-3.5" /> : <ChevronRight aria-hidden="true" className="w-3.5 h-3.5" />}
                            <span>Ver notas</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => aceitar_divergencia(p)}
                            disabled={processando !== null}
                            aria-label={`Aceitar divergência do projeto ${codigo}`}
                            className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold text-xs border border-emerald-300 dark:border-emerald-800 transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            {processando === p.id_projeto ? (
                              <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600" />
                            )}
                            <span>Aceitar divergência</span>
                          </button>
                        </td>
                      </tr>
                      {estaAberto && (
                        <tr id={`notas-${p.id_projeto}`} className="bg-slate-50/70 dark:bg-slate-800/40">
                          <td colSpan={6} className="px-6 py-3">
                            {detalhes === 'carregando' || detalhes === undefined ? (
                              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                                <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" /> Carregando notas...
                              </p>
                            ) : detalhes === 'erro' ? (
                              <p role="alert" className="text-[11px] font-semibold text-red-600">Não foi possível carregar as notas deste projeto.</p>
                            ) : (
                              <ul aria-label={`Notas do projeto ${codigo}`} className="flex flex-wrap gap-2">
                                {detalhes.map((a) => {
                                  const extremo = a.nota_final === p.nota_maxima || a.nota_final === p.nota_minima;
                                  return (
                                    <li
                                      key={a.id_avaliacao}
                                      className={`px-3 py-1.5 rounded-lg border text-[11px] ${
                                        extremo
                                          ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40'
                                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                                      }`}
                                    >
                                      <span className="font-semibold">{a.avaliador}</span>:{' '}
                                      <strong className="font-mono">{formatarNota(a.nota_final)}</strong>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50/50 dark:bg-slate-900/50">
        {aoFechar && (
          <button
            type="button"
            onClick={aoFechar}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-all shadow-xs cursor-pointer"
          >
            Fechar Janela
          </button>
        )}
      </div>
    </div>
  );
};
