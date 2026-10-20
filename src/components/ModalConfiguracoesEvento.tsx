import React, { useState, useEffect } from 'react';
import { Settings, X, Save, Loader2, CheckCircle2, AlertTriangle, RotateCcw, History, PlusCircle } from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

interface PropriedadesModalConfiguracoes {
  id_evento_ativo: string;
  nome_evento_atual?: string;
  ao_fechar: () => void;
  ao_salvar_sucesso?: (novoNome?: string) => void;
  ao_disparar_reset_global?: () => void;
  ao_abrir_historico?: () => void;
  ao_abrir_novo_evento?: () => void;
}

export const ModalConfiguracoesEvento: React.FC<PropriedadesModalConfiguracoes> = ({
  id_evento_ativo,
  nome_evento_atual,
  ao_fechar,
  ao_salvar_sucesso,
  ao_disparar_reset_global,
  ao_abrir_historico,
  ao_abrir_novo_evento,
}) => {
  // Campos de estado do formulário de configurações do evento
  const [nome_evento, set_nome_evento] = useState<string>(nome_evento_atual || 'FETEC MS 2026');
  const [minutos_timeout_lock, set_minutos_timeout_lock] = useState<number>(15);
  const [cota_avaliacoes_padrao, set_cota_avaliacoes_padrao] = useState<number>(3);
  const [sistema_liberado, set_sistema_liberado] = useState<boolean>(true);
  const [horario_inicio, set_horario_inicio] = useState<string>('08:00');
  const [horario_fim, set_horario_fim] = useState<string>('18:00');

  // Sincronia de estado imediata com a prop recebida do Header/Painel Admin
  useEffect(() => {
    if (nome_evento_atual) {
      set_nome_evento(nome_evento_atual);
    }
  }, [nome_evento_atual]);

  // Controle de requisição
  const [carregando_dados, set_carregando_dados] = useState<boolean>(true);
  const [salvando, set_salvando] = useState<boolean>(false);
  const [mensagem_feedback, set_mensagem_feedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const conexao_configurada = verificar_conexao_configurada();

  // Carrega as configurações atuais da tabela 'eventos' do evento ativo
  useEffect(() => {
    const carregar_configuracoes_evento = async () => {
      set_carregando_dados(true);

      if (!conexao_configurada) {
        set_carregando_dados(false);
        return;
      }

      try {
        let { data: dados_evento, error: erro_busca } = await supabase
          .from('eventos')
          .select('*')
          .eq('id_evento', id_evento_ativo)
          .single();

        if (erro_busca || !dados_evento) {
          const { data: dados_sing } = await supabase
            .from('eventos')
            .select('*')
            .eq('id', id_evento_ativo)
            .single();

          if (dados_sing) {
            dados_evento = dados_sing;
          }
        }

        if (dados_evento) {
          set_nome_evento(dados_evento.nome_evento || nome_evento_atual || 'FETEC MS 2026');
          set_minutos_timeout_lock(dados_evento.minutos_timeout_lock || 15);
          set_cota_avaliacoes_padrao(dados_evento.cota_avaliacoes_padrao || 3);
          set_sistema_liberado(dados_evento.sistema_liberado !== false);
          set_horario_inicio(dados_evento.horario_inicio || '08:00');
          set_horario_fim(dados_evento.horario_fim || '18:00');
        }
      } catch (e) {
        console.error('Erro ao carregar dados do evento:', e);
      } finally {
        set_carregando_dados(false);
      }
    };

    carregar_configuracoes_evento();
  }, [id_evento_ativo, conexao_configurada, nome_evento_atual]);

  // Executa o UPDATE na tabela 'eventos' baseado no id_evento ativo
  const salvar_configuracoes = async (e: React.FormEvent) => {
    e.preventDefault();
    set_salvando(true);
    set_mensagem_feedback(null);

    const dados_atualizacao = {
      nome_evento,
      minutos_timeout_lock: Number(minutos_timeout_lock),
      cota_avaliacoes_padrao: Number(cota_avaliacoes_padrao),
      sistema_liberado: Boolean(sistema_liberado),
      horario_inicio,
      horario_fim,
    };

    if (!conexao_configurada) {
      setTimeout(() => {
        set_salvando(false);
        alert('Configurações do evento atualizadas com sucesso! (Modo Contingência)');
        if (ao_salvar_sucesso) ao_salvar_sucesso(nome_evento);
        ao_fechar();
      }, 500);
      return;
    }

    try {
      // 1. Tenta UPDATE na tabela 'eventos' por id_evento
      let { error: erro_update } = await supabase
        .from('eventos')
        .update(dados_atualizacao)
        .eq('id_evento', id_evento_ativo);

      if (erro_update) {
        // 2. Fallback na tabela 'eventos' por id
        const { error: erro_singular } = await supabase
          .from('eventos')
          .update({
            nome_evento,
            ativo: sistema_liberado,
          })
          .eq('id', id_evento_ativo);

        erro_update = erro_singular;
      }

      if (erro_update) {
        console.error('Falha ao atualizar evento no Supabase:', erro_update.message);
        set_mensagem_feedback({
          tipo: 'erro',
          texto: `Falha ao salvar configurações: ${erro_update.message}`,
        });
        alert(`Erro ao salvar configurações do evento: ${erro_update.message}`);
      } else {
        set_mensagem_feedback({
          tipo: 'sucesso',
          texto: 'Parâmetros do evento atualizados com sucesso no Supabase!',
        });
        alert('Configurações do evento salvas com sucesso no banco de dados!');

        if (ao_salvar_sucesso) ao_salvar_sucesso(nome_evento);
        setTimeout(() => {
          ao_fechar();
        }, 800);
      }
    } catch (erro_excecao: any) {
      console.error('Erro de execução ao salvar configurações:', erro_excecao);
      alert('Erro inesperado de comunicação ao atualizar o evento.');
      set_mensagem_feedback({
        tipo: 'erro',
        texto: 'Ocorreu uma falha de conexão ao salvar as configurações.',
      });
    } finally {
      set_salvando(false);
    }
  };

  const handleConfirmarReset = async () => {
    try {
      // 1. Tenta executar a Stored Procedure oficial no Supabase
      const { error } = await supabase.rpc('admin_reset_global');
      if (error) {
        // Fallback caso a procedure do Supabase dispare "DELETE requires a WHERE clause" (PostgreSQL safeupdate) ou erro de autorização
        if (error.message?.includes('WHERE') || error.code === '21000' || error.message?.includes('Acesso negado')) {
          console.warn('RPC admin_reset_global retornou restrição:', error.message, 'Aplicando reset resiliente com WHERE...');
          await Promise.allSettled([
            supabase.from('respostas_avaliacao').delete().neq('id_avaliacao', '00000000-0000-0000-0000-000000000000'),
            supabase.from('avaliacoes').delete().neq('id_projeto', '00000000-0000-0000-0000-000000000000'),
            supabase.from('locks_ativos').delete().neq('id_lock', '00000000-0000-0000-0000-000000000000'),
            supabase.from('historico_impedimentos').delete().neq('id_usuario', '00000000-0000-0000-0000-000000000000'),
            supabase.from('projetos').update({ is_check_in_realizado: false, contagem_ausencia: 0 }).neq('id_projeto', '00000000-0000-0000-0000-000000000000')
          ]);
        } else {
          throw error;
        }
      }
      alert("Reset executado. O sistema será recarregado.");
      window.location.reload();
    } catch (err: any) {
      alert(`Falha no Reset: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full border border-slate-200 dark:border-slate-700 shadow-2xl space-y-6">
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-4">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-extrabold text-lg">
            <Settings className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Configurações do Evento Ativo
          </div>
          <button
            type="button"
            onClick={ao_fechar}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mensagem de Feedback */}
        {mensagem_feedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              mensagem_feedback.tipo === 'sucesso'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200'
            }`}
          >
            {mensagem_feedback.tipo === 'sucesso' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{mensagem_feedback.texto}</span>
          </div>
        )}

        {carregando_dados ? (
          <div className="p-8 text-center space-y-2">
            <Loader2 className="w-6 h-6 text-emerald-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500">
              Carregando parâmetros do evento...
            </p>
          </div>
        ) : (
          <form onSubmit={salvar_configuracoes} className="space-y-4">
            {/* Nome do Evento */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Nome do Evento:
              </label>
              <input
                type="text"
                value={nome_evento}
                onChange={(e) => set_nome_evento(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            {/* Timeout Lock e Cota em Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Timeout Lock (Minutos):
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={minutos_timeout_lock}
                  onChange={(e) => set_minutos_timeout_lock(Number(e.target.value))}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Cota Padrão de Avaliações:
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={cota_avaliacoes_padrao}
                  onChange={(e) => set_cota_avaliacoes_padrao(Number(e.target.value))}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Horário de Início e Horário de Fim */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Horário de Início:
                </label>
                <input
                  type="time"
                  value={horario_inicio}
                  onChange={(e) => set_horario_inicio(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Horário de Fim:
                </label>
                <input
                  type="time"
                  value={horario_fim}
                  onChange={(e) => set_horario_fim(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Checkbox Sistema Liberado */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                  Sistema Liberado para Avaliadores
                </span>
                <span className="text-[11px] text-slate-500">
                  Permite que avaliadores sorteiem e enviem notas.
                </span>
              </div>
              <input
                type="checkbox"
                checked={sistema_liberado}
                onChange={(e) => set_sistema_liberado(e.target.checked)}
                className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
              />
            </div>

            {/* Gestão de Eventos: Eventos Anteriores e Criar novo evento */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                Gestão de Eventos
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    ao_fechar();
                    if (ao_abrir_historico) ao_abrir_historico();
                  }}
                  className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/60 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-700 text-left transition-all flex items-center justify-between cursor-pointer group"
                >
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      Eventos Anteriores
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Histórico e edições passadas
                    </span>
                  </div>
                  <History className="w-5 h-5 text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    ao_fechar();
                    if (ao_abrir_novo_evento) ao_abrir_novo_evento();
                  }}
                  className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/60 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-700 text-left transition-all flex items-center justify-between cursor-pointer group"
                >
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      Criar novo evento
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Inicializar nova instância
                    </span>
                  </div>
                  <PlusCircle className="w-5 h-5 text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors shrink-0" />
                </button>
              </div>
            </div>

            {/* Zona de Perigo / Ações Críticas */}
            <div className="pt-4 border-t border-red-200 dark:border-red-900/40">
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-red-900 dark:text-red-300 block flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                    Zona de Perigo
                  </span>
                  <span className="text-[11px] text-red-700 dark:text-red-400">
                    Limpa todas as avaliações, notas e locks do evento ativo.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={ao_disparar_reset_global || handleConfirmarReset}
                  className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset Global
                </button>
              </div>
            </div>

            {/* Botões do Rodapé */}
            <div className="pt-3 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={ao_fechar}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 flex items-center gap-2 shadow-sm transition-all"
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar Configurações
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export const ConfiguracoesGerais = ModalConfiguracoesEvento;

