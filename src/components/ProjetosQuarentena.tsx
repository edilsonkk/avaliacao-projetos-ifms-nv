import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  X,
  Loader2,
  ShieldCheck,
  User,
  FileText
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

interface ItemQuarentena {
  id_avaliacao?: string;
  id_projeto: string;
  codigo_projeto?: string | null;
  id_usuario?: string;
  nota_final?: number | null;
  parecer_final?: string | null;
  projeto_titulo?: string;
  projeto_estande?: string;
  projeto_corredor?: string;
  projeto_instituicao?: string;
  avaliador_nome?: string;
}

interface ProjetosQuarentenaProps {
  aoFechar?: () => void;
  aoAtualizarMetricas?: () => void;
}

export const ProjetosQuarentena: React.FC<ProjetosQuarentenaProps> = ({
  aoFechar,
  aoAtualizarMetricas
}) => {
  const [quarentenas, set_quarentenas] = useState<ItemQuarentena[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [executando_acao, set_executando_acao] = useState<boolean>(false);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [mensagem_sucesso, set_mensagem_sucesso] = useState<string | null>(null);

  const conexao_banco = verificar_conexao_configurada();

  const carregar_quarentenas = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_quarentenas([]);
      set_carregando(false);
      return;
    }

    try {
      // 2. INJEÇÃO DA NOVA COLUNA NAS CONSULTAS: codigo_projeto no .select()
      const { data, error } = await supabase
        .from('avaliacoes')
        .select(`
          id_avaliacao,
          id_projeto,
          id_usuario,
          nota_final,
          parecer_final,
          is_quarentena,
          projetos (
            id_projeto,
            codigo_projeto,
            titulo,
            estande,
            corredor,
            nome_instituicao,
            instituicoes (nome_exibicao)
          ),
          usuarios (nome)
        `)
        .eq('is_quarentena', true);

      if (error) {
        // Tenta buscar diretamente em avaliacoes sem join se falhar
        const { data: rawAval, error: errRaw } = await supabase
          .from('avaliacoes')
          .select('*')
          .eq('is_quarentena', true);

        if (errRaw) throw error;

        if (rawAval && rawAval.length > 0) {
          const idsProjetos = rawAval.map((a) => a.id_projeto).filter(Boolean);
          const { data: projsData } = await supabase
            .from('projetos')
            .select('id_projeto, codigo_projeto, titulo, estande, corredor, nome_instituicao')
            .in('id_projeto', idsProjetos);

          const mapaProjetos = new Map<string, any>();
          (projsData || []).forEach((p) => mapaProjetos.set(p.id_projeto, p));

          const formatados: ItemQuarentena[] = rawAval.map((a) => {
            const proj = mapaProjetos.get(a.id_projeto);
            return {
              id_avaliacao: a.id_avaliacao,
              id_projeto: a.id_projeto,
              codigo_projeto: proj?.codigo_projeto || null,
              id_usuario: a.id_usuario,
              nota_final: a.nota_final,
              parecer_final: a.parecer_final,
              projeto_titulo: proj?.titulo || 'Projeto em Quarentena',
              projeto_estande: proj?.estande || 'EST-00',
              projeto_corredor: proj?.corredor || 'S/ Corredor',
              projeto_instituicao: proj?.nome_instituicao || 'IFMS'
            };
          });

          set_quarentenas(formatados);
        } else {
          set_quarentenas([]);
        }
      } else {
        const formatados: ItemQuarentena[] = (data || []).map((item: any) => {
          const projObj = Array.isArray(item.projetos) ? item.projetos[0] : item.projetos;
          const instObj = Array.isArray(projObj?.instituicoes) ? projObj?.instituicoes[0] : projObj?.instituicoes;
          const userObj = Array.isArray(item.usuarios) ? item.usuarios[0] : item.usuarios;

          return {
            id_avaliacao: item.id_avaliacao,
            id_projeto: item.id_projeto,
            codigo_projeto: projObj?.codigo_projeto || null,
            id_usuario: item.id_usuario,
            nota_final: item.nota_final,
            parecer_final: item.parecer_final,
            projeto_titulo: projObj?.titulo || 'Projeto em Quarentena',
            projeto_estande: projObj?.estande || 'EST-00',
            projeto_corredor: projObj?.corredor || 'S/ Corredor',
            projeto_instituicao: instObj?.nome_exibicao || projObj?.nome_instituicao || 'IFMS',
            avaliador_nome: userObj?.nome || item.id_usuario
          };
        });

        set_quarentenas(formatados);
      }
    } catch (err: any) {
      console.error('Erro ao consultar quarentenas:', err);
      set_mensagem_erro(`Erro do Supabase: ${err.message || err}`);
      set_quarentenas([]);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    carregar_quarentenas();
  }, []);

  // Botão global no topo: "Resolver Todos" (chama supabase.rpc('admin_remover_quarentena_todos'))
  const resolver_todos = async () => {
    const confirmado = window.confirm(
      'Tem certeza de que deseja RESOLVER TODAS as quarentenas ativas?\nEsta ação removerá o status de quarentena de todas as avaliações.'
    );
    if (!confirmado) return;

    set_executando_acao(true);
    set_mensagem_erro(null);
    set_mensagem_sucesso(null);

    try {
      if (conexao_banco) {
        const { error } = await supabase.rpc('admin_remover_quarentena_todos');

        if (error) {
          console.warn('RPC admin_remover_quarentena_todos falhou, executando atualização direta:', error.message);
          const { error: updateErr } = await supabase
            .from('avaliacoes')
            .update({ is_quarentena: false })
            .eq('is_quarentena', true);

          if (updateErr) throw error;
        }
      }

      set_quarentenas([]);
      exibir_sucesso('Todas as quarentenas foram resolvidas com sucesso!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao resolver quarentenas:', err);
      set_mensagem_erro(`Erro ao resolver todas as quarentenas: ${err.message || err}`);
    } finally {
      set_executando_acao(false);
    }
  };

  // Botão em cada linha: "Tirar de Quarentena" (chama supabase.rpc('admin_remover_quarentena', { p_id_projeto: id }))
  const tirar_de_quarentena = async (idProjeto: string) => {
    set_executando_acao(true);
    set_mensagem_erro(null);
    set_mensagem_sucesso(null);

    try {
      if (conexao_banco) {
        const { error } = await supabase.rpc('admin_remover_quarentena', {
          p_id_projeto: idProjeto
        });

        if (error) {
          console.warn('RPC admin_remover_quarentena falhou, executando atualização direta:', error.message);
          const { error: updateErr } = await supabase
            .from('avaliacoes')
            .update({ is_quarentena: false })
            .eq('id_projeto', idProjeto);

          if (updateErr) throw error;
        }
      }

      set_quarentenas((prev) => prev.filter((item) => item.id_projeto !== idProjeto));
      exibir_sucesso('Projeto removido da quarentena com sucesso!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error(`Erro ao remover projeto da quarentena:`, err);
      set_mensagem_erro(`Erro ao tirar de quarentena: ${err.message || err}`);
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

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] font-sans">
      {/* Cabeçalho */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 shadow-xs">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              Gestor de Quarentena (`is_quarentena = true`)
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                {quarentenas.length} pendentes
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Projetos com avaliações sob discrepância, auditoria ou intervenção do comitê.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* BOTÃO GLOBAL NO TOPO: Resolver Todos */}
          <button
            type="button"
            onClick={resolver_todos}
            disabled={executando_acao || quarentenas.length === 0}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-all shadow-xs flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {executando_acao ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            <span>Resolver Todos</span>
          </button>

          <button
            type="button"
            onClick={carregar_quarentenas}
            disabled={carregando}
            title="Recarregar quarentenas"
            className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-red-600' : ''}`} />
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

      {/* Tabela de Quarentena */}
      <div className="flex-1 overflow-y-auto p-6">
        {carregando ? (
          <div className="p-12 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-red-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Consultando projetos em quarentena no Supabase...
            </p>
          </div>
        ) : quarentenas.length === 0 ? (
          <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              Nenhum projeto em quarentena!
            </p>
            <p className="text-xs text-slate-400">
              Todos os pareceres e notas estão dentro da conformidade esperada.
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-slate-800 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <th className="px-4 py-3">Estande</th>
                  {/* BLINDAGEM VISUAL: Cabeçalho CÓDIGO */}
                  <th className="px-4 py-3">CÓDIGO</th>
                  <th className="px-4 py-3">Título do Projeto</th>
                  <th className="px-4 py-3">Avaliador / Nota</th>
                  <th className="px-4 py-3">Parecer de Quarentena</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {quarentenas.map((q, idx) => (
                  <tr key={q.id_avaliacao || q.id_projeto || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-red-600 dark:text-red-400 whitespace-nowrap">
                      {q.projeto_estande}
                    </td>
                    {/* BLINDAGEM VISUAL: Renderiza codigo_projeto em vez de id_projeto UUID */}
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {q.codigo_projeto || 'N/I'}
                    </td>
                    <td className="px-4 py-3 font-bold max-w-xs">
                      {q.projeto_titulo}
                      <div className="text-[10px] font-normal text-slate-400">{q.projeto_instituicao}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{q.avaliador_nome}</div>
                      <div className="font-extrabold text-red-600 dark:text-red-400">
                        Nota: {q.nota_final ?? '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-xs italic text-[11px]">
                      {q.parecer_final || 'Divergência técnica pendente de validação.'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {/* BOTÃO POR LINHA: Tirar de Quarentena (UUID usado apenas no background do React) */}
                      <button
                        type="button"
                        onClick={() => tirar_de_quarentena(q.id_projeto)}
                        disabled={executando_acao}
                        className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold text-xs border border-emerald-300 dark:border-emerald-800 transition-all inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Tirar de Quarentena</span>
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
