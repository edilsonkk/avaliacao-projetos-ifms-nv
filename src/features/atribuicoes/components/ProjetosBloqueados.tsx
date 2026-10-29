import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Lock, Unlock, RefreshCw, X, Loader2, AlertTriangle, CheckCircle2, User, Mail, Clock } from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { aoRetomarApp } from '@/lib/keepAliveSessao';
import { CabecalhoOrdenavel, compararNatural } from '@/components/ui/CabecalhoOrdenavel';

/**
 * Projetos Bloqueados: travas ativas (locks_ativos) do evento ativo.
 * Cada linha é a trava de UM avaliador; um projeto pode ter várias (até a cota).
 * Liberar a trava impede o avaliador de enviar a avaliação em andamento (fn_enviar_avaliacao exige a trava),
 * por isso toda liberação pede confirmação. Ver docs/regras-de-negocio/sorteio-e-atribuicao.md.
 */

export interface TravaAtiva {
  id_lock: string;
  id_projeto: string;
  id_usuario: string;
  codigo_projeto: string | null;
  projeto_titulo: string;
  projeto_estande: string;
  projeto_corredor: string;
  avaliador_nome: string;
  avaliador_email: string;
  bloqueado_em: string | null;
  expira_em: string;
}

interface ProjetosBloqueadosProps {
  aoFechar?: () => void;
  aoAtualizarMetricas?: () => void;
  id_evento_ativo?: string;
}

type Coluna = 'codigo' | 'estande' | 'corredor' | 'titulo' | 'avaliador' | 'restante';

/** Recarrega a lista de tempos em tempos: travas expiram e novas surgem enquanto a tela está aberta. */
export const INTERVALO_ATUALIZACAO_MS = 30_000;

const minutosRestantes = (expiraEm: string, agora: number) => Math.max(0, Math.ceil((new Date(expiraEm).getTime() - agora) / 60_000));

export const ProjetosBloqueados: React.FC<ProjetosBloqueadosProps> = ({ aoFechar, aoAtualizarMetricas, id_evento_ativo }) => {
  const [travas, set_travas] = useState<TravaAtiva[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [liberando, set_liberando] = useState<string | 'todas' | null>(null);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [mensagem_sucesso, set_mensagem_sucesso] = useState<string | null>(null);
  const [agora, set_agora] = useState<number>(() => Date.now());
  const [coluna, set_coluna] = useState<Coluna>('restante');
  const [direcao, set_direcao] = useState<'asc' | 'desc'>('asc');

  const conexao_banco = verificar_conexao_configurada();
  const idEvento = id_evento_ativo || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : null) || null;

  const carregar_travas = useCallback(async () => {
    set_carregando(true);
    set_mensagem_erro(null);
    if (!conexao_banco) {
      set_travas([]);
      set_carregando(false);
      return;
    }
    try {
      let consulta: any = supabase
        .from('locks_ativos')
        .select(`
          id_lock,
          id_projeto,
          id_usuario,
          bloqueado_em,
          expira_em,
          projetos!inner ( codigo_projeto, titulo, estande, corredor, id_evento ),
          usuarios ( nome, email )
        `)
        .gt('expira_em', new Date().toISOString());
      if (idEvento) consulta = consulta.eq('projetos.id_evento', idEvento);

      const { data, error } = await consulta;
      if (error) throw error;

      set_travas(
        (data || []).map((item: any) => {
          const projeto = Array.isArray(item.projetos) ? item.projetos[0] : item.projetos;
          const usuario = Array.isArray(item.usuarios) ? item.usuarios[0] : item.usuarios;
          return {
            id_lock: item.id_lock,
            id_projeto: item.id_projeto,
            id_usuario: item.id_usuario,
            codigo_projeto: projeto?.codigo_projeto || null,
            projeto_titulo: projeto?.titulo || 'Projeto sem título',
            projeto_estande: projeto?.estande || '-',
            projeto_corredor: projeto?.corredor || '-',
            avaliador_nome: usuario?.nome || 'Avaliador não identificado',
            avaliador_email: usuario?.email || '',
            bloqueado_em: item.bloqueado_em || null,
            expira_em: item.expira_em,
          };
        })
      );
      set_agora(Date.now());
    } catch (err: any) {
      console.error('Erro ao buscar travas ativas:', err);
      set_mensagem_erro(`Não foi possível carregar as travas: ${err?.message || err}`);
      set_travas([]);
    } finally {
      set_carregando(false);
    }
  }, [conexao_banco, idEvento]);

  useEffect(() => {
    carregar_travas();
    const intervalo = setInterval(carregar_travas, INTERVALO_ATUALIZACAO_MS);
    const relogio = setInterval(() => set_agora(Date.now()), 15_000);
    const pararRetomada = aoRetomarApp(carregar_travas);
    return () => {
      clearInterval(intervalo);
      clearInterval(relogio);
      pararRetomada();
    };
  }, [carregar_travas]);

  const exibir_sucesso = (msg: string) => {
    set_mensagem_sucesso(msg);
    setTimeout(() => set_mensagem_sucesso(null), 4000);
  };

  // Travas que venceram desde a última consulta somem na hora, sem esperar o próximo ciclo
  const travas_validas = useMemo(() => travas.filter((t) => new Date(t.expira_em).getTime() > agora), [travas, agora]);

  const liberar_trava = async (trava: TravaAtiva) => {
    const codigo = trava.codigo_projeto || trava.projeto_titulo;
    const confirmado = window.confirm(
      `Liberar a trava de ${trava.avaliador_nome} no projeto ${codigo}?\n\n` +
        'Se essa pessoa estiver preenchendo a avaliação, não conseguirá enviá-la e precisará sortear de novo. ' +
        'Os outros avaliadores do projeto não são afetados.'
    );
    if (!confirmado) return;

    set_liberando(trava.id_lock);
    set_mensagem_erro(null);
    try {
      if (conexao_banco) {
        if (!(await garantirSessaoAdmin())) return;
        const { error } = await supabase.rpc('admin_desbloquear_trava', { p_id_lock: trava.id_lock });
        if (error) throw error;
      }
      set_travas((prev) => prev.filter((t) => t.id_lock !== trava.id_lock));
      exibir_sucesso(`Trava de ${trava.avaliador_nome} no projeto ${codigo} liberada.`);
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err) {
      console.error('Erro ao liberar trava:', err);
      set_mensagem_erro(`Erro ao liberar a trava: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      set_liberando(null);
    }
  };

  const liberar_todas = async () => {
    const total = travas_validas.length;
    const confirmado = window.confirm(
      `Liberar as ${total} travas ativas?\n\n` +
        'Todos os avaliadores que estão preenchendo uma avaliação agora não conseguirão enviá-la e precisarão sortear de novo.'
    );
    if (!confirmado) return;

    set_liberando('todas');
    set_mensagem_erro(null);
    try {
      if (conexao_banco) {
        if (!(await garantirSessaoAdmin())) return;
        const { error } = await supabase.rpc('admin_desbloquear_todos');
        if (error) throw error;
      }
      set_travas([]);
      exibir_sucesso('Todas as travas foram liberadas.');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err) {
      console.error('Erro ao liberar todas as travas:', err);
      set_mensagem_erro(`Erro ao liberar as travas: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      set_liberando(null);
    }
  };

  const alternar_ordenacao = (nova: Coluna) => {
    if (nova === coluna) set_direcao((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      set_coluna(nova);
      set_direcao('asc');
    }
  };

  const travas_ordenadas = useMemo(() => {
    const valor = (t: TravaAtiva): string | number => {
      switch (coluna) {
        case 'codigo': return t.codigo_projeto || '';
        case 'estande': return t.projeto_estande;
        case 'corredor': return t.projeto_corredor;
        case 'titulo': return t.projeto_titulo;
        case 'avaliador': return t.avaliador_nome;
        case 'restante': return new Date(t.expira_em).getTime();
      }
    };
    return [...travas_validas].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const comparacao = typeof va === 'number' && typeof vb === 'number' ? va - vb : compararNatural(String(va), String(vb));
      return direcao === 'asc' ? comparacao : -comparacao;
    });
  }, [travas_validas, coluna, direcao]);

  const total = travas_validas.length;
  const projetos_distintos = new Set(travas_validas.map((t) => t.id_projeto)).size;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col w-full h-full max-h-[95vh] font-sans">
      {/* Cabeçalho */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 shadow-xs">
            <Lock aria-hidden="true" className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
              Projetos Bloqueados
              <span role="status" className="text-xs px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                {total} {total === 1 ? 'trava' : 'travas'} em {projetos_distintos} {projetos_distintos === 1 ? 'projeto' : 'projetos'}
              </span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Projetos sorteados e ainda em avaliação. A trava expira sozinha; libere só se o avaliador desistiu ou trocou de aparelho.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={liberar_todas}
            disabled={liberando !== null || total === 0}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-all shadow-xs flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {liberando === 'todas' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Unlock aria-hidden="true" className="w-4 h-4" />}
            <span>Desbloquear Todos</span>
          </button>

          <button
            type="button"
            onClick={carregar_travas}
            disabled={carregando}
            title="Atualizar lista"
            aria-label="Atualizar lista"
            className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <RefreshCw aria-hidden="true" className={`w-4 h-4 ${carregando ? 'animate-spin text-amber-600' : ''}`} />
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

      {/* Tabela de travas */}
      <div className="flex-1 overflow-y-auto p-6">
        {carregando && travas.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Loader2 aria-hidden="true" className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Carregando travas ativas...</p>
          </div>
        ) : travas_ordenadas.length === 0 ? (
          <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
            <CheckCircle2 aria-hidden="true" className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhum projeto bloqueado no momento.</p>
            <p className="text-xs text-slate-400">Nenhum avaliador está com projeto sorteado neste evento.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-x-auto shadow-xs">
            <table className="w-full min-w-[760px] text-left text-xs">
              <caption className="sr-only">Travas ativas do evento</caption>
              <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400">
                <tr>
                  <CabecalhoOrdenavel coluna="codigo" rotulo="Código" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="estande" rotulo="Estande" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="corredor" rotulo="Corredor" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="titulo" rotulo="Projeto" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="avaliador" rotulo="Avaliador" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="restante" rotulo="Expira em" ativa={coluna} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <th scope="col" className="px-4 py-3 text-right uppercase font-black tracking-wider">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {travas_ordenadas.map((trava) => {
                  const restantes = minutosRestantes(trava.expira_em, agora);
                  const codigo = trava.codigo_projeto || 'N/I';
                  return (
                    <tr key={trava.id_lock} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{codigo}</td>
                      <td className="px-4 py-3 font-mono font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">{trava.projeto_estande}</td>
                      <td className="px-4 py-3 font-semibold text-teal-600 dark:text-teal-400 whitespace-nowrap">{trava.projeto_corredor}</td>
                      <td className="px-4 py-3 font-bold min-w-[14rem] max-w-xs">{trava.projeto_titulo}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
                            <User aria-hidden="true" className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-white text-xs">{trava.avaliador_nome}</div>
                            {trava.avaliador_email && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1">
                                <Mail aria-hidden="true" className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">{trava.avaliador_email}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${restantes <= 5 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}
                          title={`Expira às ${new Date(trava.expira_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                        >
                          <Clock aria-hidden="true" className="w-3.5 h-3.5" />
                          {restantes <= 1 ? 'menos de 1 min' : `${restantes} min`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => liberar_trava(trava)}
                          disabled={liberando !== null}
                          aria-label={`Liberar trava de ${trava.avaliador_nome} no projeto ${codigo}`}
                          className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-xs border border-amber-300 dark:border-amber-800 transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {liberando === trava.id_lock ? (
                            <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Unlock aria-hidden="true" className="w-3.5 h-3.5 text-amber-600" />
                          )}
                          <span>Liberar trava</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center gap-3 bg-slate-50/50 dark:bg-slate-900/50">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">Atualiza sozinha a cada 30 segundos.</p>
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
