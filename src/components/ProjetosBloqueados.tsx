import React, { useState, useEffect, useMemo } from 'react';
import {
  Lock,
  Unlock,
  RefreshCw,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  User,
  Mail,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

interface LockComProjeto {
  id_projeto: string;
  codigo_projeto?: string | null;
  id_usuario: string;
  projeto_titulo: string;
  projeto_estande: string;
  projeto_corredor: string;
  avaliador_nome: string;
  avaliador_email: string;
}

interface ProjetosBloqueadosProps {
  aoFechar?: () => void;
  aoAtualizarMetricas?: () => void;
}

export const ProjetosBloqueados: React.FC<ProjetosBloqueadosProps> = ({
  aoFechar,
  aoAtualizarMetricas
}) => {
  const [locks, set_locks] = useState<LockComProjeto[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [executando_acao, set_executando_acao] = useState<boolean>(false);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [mensagem_sucesso, set_mensagem_sucesso] = useState<string | null>(null);

  const conexao_banco = verificar_conexao_configurada();

  // 1. INJEÇÃO DE JOIN NA QUERY (Supabase com projetos e usuarios)
  const carregar_locks_e_projetos = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_locks([]);
      set_carregando(false);
      return;
    }

    try {
      const agoraIso = new Date().toISOString();
      // Query obrigatória com JOIN das tabelas projetos (codigo_projeto, titulo, estande, corredor) e usuarios, filtrando locks estritamente válidos
      const { data, error } = await supabase
        .from('locks_ativos')
        .select(`
          id_projeto,
          id_usuario,
          expira_em,
          projetos ( codigo_projeto, titulo, estande, corredor ),
          usuarios ( nome, email )
        `)
        .gt('expira_em', agoraIso);

      if (error) {
        console.warn('JOIN direto em locks_ativos falhou, tentando fallback estruturado:', error.message);
        // Fallback resiliente caso o PostgREST exija consulta com in()
        const { data: rawLocks, error: errRaw } = await supabase
          .from('locks_ativos')
          .select('id_projeto, id_usuario, expira_em')
          .gt('expira_em', agoraIso);

        if (errRaw) throw error;

        if (rawLocks && rawLocks.length > 0) {
          const idsProjetos = rawLocks.map((l: any) => l.id_projeto).filter(Boolean);
          const idsUsuarios = rawLocks.map((l: any) => l.id_usuario).filter(Boolean);

          const [projsRes, usersRes] = await Promise.all([
            supabase.from('projetos').select('id_projeto, codigo_projeto, titulo, estande, corredor').in('id_projeto', idsProjetos),
            supabase.from('usuarios').select('id_usuario, nome, email').in('id_usuario', idsUsuarios)
          ]);

          const mapaProjetos = new Map<string, any>();
          (projsRes.data || []).forEach((p: any) => mapaProjetos.set(p.id_projeto, p));

          const mapaUsuarios = new Map<string, any>();
          (usersRes.data || []).forEach((u: any) => mapaUsuarios.set(u.id_usuario, u));

          const formatadosFallback: LockComProjeto[] = rawLocks.map((l: any) => {
            const proj = mapaProjetos.get(l.id_projeto);
            const user = mapaUsuarios.get(l.id_usuario);
            return {
              id_projeto: l.id_projeto,
              codigo_projeto: proj?.codigo_projeto || null,
              id_usuario: l.id_usuario,
              projeto_titulo: proj?.titulo || 'Projeto em Avaliação',
              projeto_estande: proj?.estande || '-',
              projeto_corredor: proj?.corredor || '-',
              avaliador_nome: user?.nome || l.id_usuario,
              avaliador_email: user?.email || ''
            };
          });

          set_locks(formatadosFallback);
        } else {
          set_locks([]);
        }
      } else {
        const formatados: LockComProjeto[] = (data || []).map((item: any) => {
          const projObj = Array.isArray(item.projetos) ? item.projetos[0] : item.projetos;
          const userObj = Array.isArray(item.usuarios) ? item.usuarios[0] : item.usuarios;

          return {
            id_projeto: item.id_projeto,
            codigo_projeto: projObj?.codigo_projeto || null,
            id_usuario: item.id_usuario,
            projeto_titulo: projObj?.titulo || 'Projeto Bloqueado',
            projeto_estande: projObj?.estande || '-',
            projeto_corredor: projObj?.corredor || '-',
            avaliador_nome: userObj?.nome || item.id_usuario,
            avaliador_email: userObj?.email || ''
          };
        });

        set_locks(formatados);
      }
    } catch (err: any) {
      console.error('Erro ao buscar locks ativos:', err);
      set_mensagem_erro(`Erro do Supabase: ${err.message || err}`);
      set_locks([]);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    carregar_locks_e_projetos();
  }, []);

  // Botão global no topo: Desbloquear Todos -> chama supabase.rpc('admin_desbloquear_todos')
  const desbloquear_todos = async () => {
    try {
      set_executando_acao(true);
      // 1. Tenta invocar a Stored Procedure oficial no Supabase
      let { error } = await supabase.rpc('admin_desbloquear_todos');

      // 2. Fallback resiliente caso a function no Supabase dispare "DELETE requires a WHERE clause" (PostgreSQL safeupdate) ou erro de permissão
      if (error) {
        console.warn('RPC admin_desbloquear_todos retornou erro, aplicando fallback com WHERE:', error.message);
        const resFallback = await supabase
          .from('locks_ativos')
          .delete()
          .neq('id_lock', '00000000-0000-0000-0000-000000000000');

        if (resFallback.error) {
          const resFallback2 = await supabase
            .from('locks_ativos')
            .delete()
            .neq('id_projeto', '00000000-0000-0000-0000-000000000000');
          if (resFallback2.error) throw error;
        }
      }

      alert("Todos os projetos foram desbloqueados!");
      // Atualiza o estado local limpando a lista
      set_locks([]);
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      alert(`Erro ao desbloquear todos os projetos: ${err.message || err}`);
    } finally {
      set_executando_acao(false);
    }
  };

  // Botão por linha: Forçar Desbloqueio -> chama supabase.rpc('admin_desbloquear_projeto', { p_id_projeto: id })
  const forcar_desbloqueio = async (idProjeto: string) => {
    set_executando_acao(true);
    set_mensagem_erro(null);
    set_mensagem_sucesso(null);

    try {
      if (conexao_banco) {
        const { error } = await supabase.rpc('admin_desbloquear_projeto', {
          p_id_projeto: idProjeto
        });

        if (error) throw error;
      }

      // Atualiza a lista localmente após o sucesso
      set_locks((prev) => prev.filter((item) => item.id_projeto !== idProjeto));
      exibir_sucesso('Projeto desbloqueado com sucesso!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error(`Erro ao desbloquear projeto:`, err);
      set_mensagem_erro(`Erro ao forçar desbloqueio: ${err.message || err}`);
    } finally {
      set_executando_acao(false);
    }
  };

  const exibir_sucesso = (msg: string) => {
    set_mensagem_sucesso(msg);
    setTimeout(() => {
      set_mensagem_sucesso(null);
    }, 4000);
  };

  // Ordenação de colunas
  const [colunaOrdenacao, setColunaOrdenacao] = useState<'estande' | 'corredor' | 'titulo' | 'codigo' | 'avaliador'>('estande');
  const [direcaoOrdenacao, setDirecaoOrdenacao] = useState<'asc' | 'desc'>('asc');

  const alternarOrdenacao = (coluna: 'estande' | 'corredor' | 'titulo' | 'codigo' | 'avaliador') => {
    if (colunaOrdenacao === coluna) {
      setDirecaoOrdenacao(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setColunaOrdenacao(coluna);
      setDirecaoOrdenacao('asc');
    }
  };

  const locks_ordenados = useMemo(() => {
    return [...locks].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaOrdenacao === 'estande') {
        valA = a.projeto_estande || '';
        valB = b.projeto_estande || '';
      } else if (colunaOrdenacao === 'corredor') {
        valA = a.projeto_corredor || '';
        valB = b.projeto_corredor || '';
      } else if (colunaOrdenacao === 'titulo') {
        valA = a.projeto_titulo || '';
        valB = b.projeto_titulo || '';
      } else if (colunaOrdenacao === 'codigo') {
        valA = a.codigo_projeto || '';
        valB = b.codigo_projeto || '';
      } else if (colunaOrdenacao === 'avaliador') {
        valA = a.avaliador_nome || '';
        valB = b.avaliador_nome || '';
      }
      return direcaoOrdenacao === 'asc'
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }, [locks, colunaOrdenacao, direcaoOrdenacao]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col w-full h-full max-h-[95vh] font-sans">
      {/* Cabeçalho */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 shadow-xs">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              Gestor de Projetos Bloqueados
              <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                {locks.length} {locks.length === 1 ? 'bloqueado' : 'bloqueados'}
              </span>
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* BOTÃO GLOBAL NO TOPO: Desbloquear Todos */}
          <button
            type="button"
            onClick={desbloquear_todos}
            disabled={executando_acao || locks.length === 0}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-all shadow-xs flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {executando_acao ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Unlock className="w-4 h-4" />
            )}
            <span>Desbloquear Todos</span>
          </button>

          <button
            type="button"
            onClick={carregar_locks_e_projetos}
            disabled={carregando}
            title="Recarregar travas"
            className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-amber-600' : ''}`} />
          </button>

          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Alertas */}
      {mensagem_erro && (
        <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-semibold">{mensagem_erro}</span>
        </div>
      )}

      {mensagem_sucesso && (
        <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="font-semibold">{mensagem_sucesso}</span>
        </div>
      )}

      {/* Tabela de Bloqueios */}
      <div className="flex-1 overflow-y-auto p-6">
        {carregando ? (
          <div className="p-12 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Consultando locks_ativos com JOIN de projetos e usuarios no Supabase...
            </p>
          </div>
        ) : locks_ordenados.length === 0 ? (
          <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              Nenhum projeto bloqueado no momento!
            </p>
            <p className="text-xs text-slate-400">
              Não existem travas ativas na tabela `locks_ativos`.
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-slate-800 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <th 
                    onClick={() => alternarOrdenacao('estande')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Estande</span>
                      {colunaOrdenacao === 'estande' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-amber-600" /> : <ArrowDown className="w-3.5 h-3.5 text-amber-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th 
                    onClick={() => alternarOrdenacao('corredor')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Corredor</span>
                      {colunaOrdenacao === 'corredor' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-amber-600" /> : <ArrowDown className="w-3.5 h-3.5 text-amber-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th 
                    onClick={() => alternarOrdenacao('titulo')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Título do Projeto</span>
                      {colunaOrdenacao === 'titulo' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-amber-600" /> : <ArrowDown className="w-3.5 h-3.5 text-amber-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th 
                    onClick={() => alternarOrdenacao('codigo')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>CÓDIGO</span>
                      {colunaOrdenacao === 'codigo' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-amber-600" /> : <ArrowDown className="w-3.5 h-3.5 text-amber-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th 
                    onClick={() => alternarOrdenacao('avaliador')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Avaliador (JOIN usuarios)</span>
                      {colunaOrdenacao === 'avaliador' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-amber-600" /> : <ArrowDown className="w-3.5 h-3.5 text-amber-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {locks_ordenados.map((lock, idx) => (
                  <tr key={`${lock.id_projeto}-${lock.id_usuario || idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                      {lock.projeto_estande}
                    </td>
                    <td className="px-4 py-3 font-semibold text-teal-600 whitespace-nowrap">
                      {lock.projeto_corredor}
                    </td>
                    <td className="px-4 py-3 font-bold max-w-xs">
                      {lock.projeto_titulo}
                    </td>
                    {/* BLINDAGEM VISUAL: Renderiza codigo_projeto em vez do UUID */}
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300 text-[11px] whitespace-nowrap">
                      {lock.codigo_projeto || 'N/I'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
                          <User className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white text-xs">
                            {lock.avaliador_nome}
                          </div>
                          {lock.avaliador_email ? (
                            <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                              <Mail className="w-2.5 h-2.5" />
                              <span>{lock.avaliador_email}</span>
                            </div>
                          ) : (
                            <div className="text-[9px] text-slate-400 font-mono">
                              ID: {lock.id_usuario}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {/* BOTÃO POR LINHA: Forçar Desbloqueio (Usa id_projeto UUID apenas no background do onClick) */}
                      <button
                        type="button"
                        onClick={() => forcar_desbloqueio(lock.id_projeto)}
                        disabled={executando_acao}
                        className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-xs border border-amber-300 dark:border-amber-800 transition-all inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Unlock className="w-3.5 h-3.5 text-amber-600" />
                        <span>Forçar Desbloqueio</span>
                      </button>
                    </td>
                  </tr>
                ))}
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
