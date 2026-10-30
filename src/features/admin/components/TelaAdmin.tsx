import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  RotateCcw,
  FolderGit2,
  Lock,
  Unlock,
  AlertTriangle,
  MapPin,
  Users,
  UserCog,
  ShieldCheck,
  ClipboardList,
  Trophy,
  Tv,
  Printer,
  History,
  PlusCircle,
  TrendingUp,
  X,
  CheckCircle2,
  FileSpreadsheet,
  Award,
  RefreshCw,
  Loader2,
  ShieldAlert,
  UploadCloud,
  FileQuestion,
  LayoutDashboard,
  FileText,
  Building,
  ExternalLink,
  Pencil,
  FileX2,
  Layers
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { ModalConfiguracoesEvento } from './ModalConfiguracoesEvento';
import { GestorQuestionarios } from '@/features/cadastros';
import { RankingPremiacao } from '@/features/relatorios';
import { RelatoriosAdmin } from '@/features/relatorios';
import { ModalDetalhamento, TipoDetalhamentoModal } from './ModalDetalhamento';
import { GestorInstituicoes } from '@/features/cadastros';
import { GestorModalidades } from '@/features/cadastros';
import { MapaEstandes } from '@/features/projetos';
import { GestorAvaliadores } from '@/features/avaliadores';
import { GestorStaff } from '@/features/staff';
import { GestorProjetos } from '@/features/projetos';
import { ProjetosBloqueados } from '@/features/atribuicoes';
import { ProjetosQuarentena } from '@/features/atribuicoes';
import { AtribuicaoForcada } from '@/features/atribuicoes';
import { TelaoAoVivo } from '@/features/relatorios';
import { ModalExclusaoAvaliacao } from '@/features/atribuicoes';

// O Painel não exibe contadores (os números ficam no Telão, nos Relatórios e em cada gestor):
// guarda só o evento ativo, que as telas abertas daqui recebem por props.
interface MetricasAdminState {
  evento_ativo_id: string;
  evento_ativo_nome: string;
  evento_ativo_edicao: string;
  cota_avaliacoes_padrao: number;
}

const metricas_iniciais_zeradas: MetricasAdminState = {
  evento_ativo_id: '',
  evento_ativo_nome: '',
  evento_ativo_edicao: '',
  cota_avaliacoes_padrao: 3,
};

export const TelaAdmin: React.FC = () => {
  // Estado das métricas reais do banco
  const [metricas_admin, set_metricas_admin] = useState<MetricasAdminState>(metricas_iniciais_zeradas);

  // ESTADO RIGOROSO DO NOME DO EVENTO (Sincronizado entre Header e Modal de Configurações)
  // Vem do evento ativo do banco (o nome guardado no navegador pode ser de outro evento)
  const [nomeEvento, setNomeEvento] = useState<string>('');

  // Estado de erro
  const [mensagem_erro_admin, set_mensagem_erro_admin] = useState<string | null>(null);

  // Controle dos Modais
  const [mostrar_modal_configuracoes, set_mostrar_modal_configuracoes] = useState<boolean>(false);
  const [mostrar_modal_reset_etapa1, set_mostrar_modal_reset_etapa1] = useState<boolean>(false);
  const [mostrar_modal_reset_etapa2, set_mostrar_modal_reset_etapa2] = useState<boolean>(false);
  const [mostrar_modal_mapa, set_mostrar_modal_mapa] = useState<boolean>(false);
  const [mostrar_gestor_projetos, set_mostrar_gestor_projetos] = useState<boolean>(false);
  const [mostrar_gestor_avaliadores, set_mostrar_gestor_avaliadores] = useState<boolean>(false);
  const [mostrar_gestor_staff, set_mostrar_gestor_staff] = useState<boolean>(false);
  const [mostrar_gestor_bloqueios, set_mostrar_gestor_bloqueios] = useState<boolean>(false);
  const [mostrar_gestor_quarentena, set_mostrar_gestor_quarentena] = useState<boolean>(false);
  const [id_projeto_editar_gestor, set_id_projeto_editar_gestor] = useState<string | null>(null);
  const [mostrar_modal_novo_evento, set_mostrar_modal_novo_evento] = useState<boolean>(false);
  const [mostrar_modal_historico, set_mostrar_modal_historico] = useState<boolean>(false);
  const [modal_detalhe_ativo, set_modal_detalhe_ativo] = useState<{ tipo: TipoDetalhamentoModal; titulo: string } | null>(null);

  // Novos Modais (Substituindo navegação por abas para manter estritamente Bento Grid + Modais)
  const [mostrar_modal_atribuicao_forcada, set_mostrar_modal_atribuicao_forcada] = useState<boolean>(false);
  const [mostrar_modal_editar_nome_evento, set_mostrar_modal_editar_nome_evento] = useState<boolean>(false);
  const [novo_nome_evento_input, set_novo_nome_evento_input] = useState<string>('');
  const [salvando_nome_evento, set_salvando_nome_evento] = useState<boolean>(false);
  const [mostrar_modal_ranking, set_mostrar_modal_ranking] = useState<boolean>(false);
  const [mostrar_gestor_questionarios, set_mostrar_gestor_questionarios] = useState<boolean>(false);
  const [mostrar_gestor_instituicoes, set_mostrar_gestor_instituicoes] = useState<boolean>(false);
  const [mostrar_gestor_modalidades, set_mostrar_gestor_modalidades] = useState<boolean>(false);
  const [mostrar_modal_telao, set_mostrar_modal_telao] = useState<boolean>(false);
  const [mostrar_modal_exclusao_avaliacao, set_mostrar_modal_exclusao_avaliacao] = useState<boolean>(false);

  // Campos de entrada dos modais
  const [confirmacao_texto_reset, set_confirmacao_texto_reset] = useState<string>('');
  const [executando_reset_rpc, set_executando_reset_rpc] = useState<boolean>(false);
  
  // Campos de entrada do modal Novo Evento
  const [novo_evento_nome, set_novo_evento_nome] = useState<string>('');
  const [novo_evento_edicao, set_novo_evento_edicao] = useState<string>('');
  const [novo_evento_data, set_novo_evento_data] = useState<string>(new Date().toISOString().split('T')[0]);
  const [novo_evento_horario_inicio, set_novo_evento_horario_inicio] = useState<string>('08:00');
  const [novo_evento_horario_fim, set_novo_evento_horario_fim] = useState<string>('18:00');
  const [novo_evento_descricao, set_novo_evento_descricao] = useState<string>('');
  const [novo_evento_cota_padrao, set_novo_evento_cota_padrao] = useState<number>(3);
  const [novo_evento_timeout_lock, set_novo_evento_timeout_lock] = useState<number>(30);
  const [novo_evento_is_ativo, set_novo_evento_is_ativo] = useState<boolean>(true);
  const [salvando_novo_evento, set_salvando_novo_evento] = useState<boolean>(false);

  // Histórico de Feiras / Eventos Reais
  const [lista_eventos_historico, set_lista_eventos_historico] = useState<any[]>([]);
  const [carregando_historico_eventos, set_carregando_historico_eventos] = useState<boolean>(false);

  const limpar_form_novo_evento = () => {
    set_novo_evento_nome('');
    set_novo_evento_edicao('');
    set_novo_evento_data(new Date().toISOString().split('T')[0]);
    set_novo_evento_horario_inicio('08:00');
    set_novo_evento_horario_fim('18:00');
    set_novo_evento_descricao('');
    set_novo_evento_cota_padrao(3);
    set_novo_evento_timeout_lock(30);
    set_novo_evento_is_ativo(true);
  };

  const carregar_historico_eventos = async () => {
    if (!conexao_banco_configurada) return;
    set_carregando_historico_eventos(true);
    try {
      const { data, error } = await supabase
        .from('eventos')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        set_lista_eventos_historico(data);
      }
    } catch (e) {
      console.warn('Erro ao carregar histórico de eventos:', e);
    } finally {
      set_carregando_historico_eventos(false);
    }
  };

  const ativar_evento_historico = async (eventoAlvo: any) => {
    try {
      if (conexao_banco_configurada) {
        // Ativa o alvo antes de desativar os outros, para nunca ficar sem evento ativo se algo falhar
        const { error: erroAtivar } = await supabase
          .from('eventos')
          .update({ is_ativo: true })
          .eq('id_evento', eventoAlvo.id_evento);
        if (erroAtivar) throw erroAtivar;

        const { error: erroDesativar } = await supabase
          .from('eventos')
          .update({ is_ativo: false })
          .neq('id_evento', eventoAlvo.id_evento);
        if (erroDesativar) throw erroDesativar;
      }

      setNomeEvento(eventoAlvo.nome_evento);
      if (typeof window !== 'undefined') {
        localStorage.setItem('evento_ativo_nome', eventoAlvo.nome_evento);
        localStorage.setItem('evento_ativo_id', eventoAlvo.id_evento);
      }

      set_metricas_admin((ant) => ({
        ...metricas_iniciais_zeradas,
        evento_ativo_id: eventoAlvo.id_evento,
        evento_ativo_nome: eventoAlvo.nome_evento,
        evento_ativo_edicao: eventoAlvo.edicao || '',
      }));

      exibir_notificacao(`Evento "${eventoAlvo.nome_evento}" agora é o evento ativo.`);
      set_mostrar_modal_historico(false);
      await fetchDashboardData();
    } catch (err: any) {
      alert(`Erro ao ativar evento: ${err?.message || err}`);
    }
  };

  // Nome exato do evento ativo para confirmação estrita da Etapa 1 do Reset Global
  const nome_evento_confirmacao = (metricas_admin.evento_ativo_nome || nomeEvento || 'EVENTO').trim();
  const token_confirmacao_reset = nome_evento_confirmacao;

  // Notificação flutuante (Toast)
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);

  // Modal de Relatórios
  const [mostrar_modal_relatorio_acordeao, set_mostrar_modal_relatorio_acordeao] = useState<boolean>(false);

  const eventoAtivo = { id_evento: metricas_admin.evento_ativo_id };

  const conexao_banco_configurada = verificar_conexao_configurada();

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  // 1. Sincroniza o evento ativo do banco
  const fetchDashboardData = useCallback(async () => {
    set_mensagem_erro_admin(null);
    if (!conexao_banco_configurada) return;

    try {
      const { data: dados_evento, error } = await supabase
        .from('eventos')
        .select('id_evento, nome_evento, edicao, cota_avaliacoes_padrao')
        .eq('is_ativo', true)
        .maybeSingle();
      if (error) throw error;

      setNomeEvento(dados_evento?.nome_evento || 'Nenhum evento ativo');
      set_metricas_admin({
        evento_ativo_id: dados_evento?.id_evento || '',
        evento_ativo_nome: dados_evento?.nome_evento || '',
        evento_ativo_edicao: dados_evento?.edicao || '',
        cota_avaliacoes_padrao: dados_evento?.cota_avaliacoes_padrao || 3,
      });
    } catch (erro_excecao: any) {
      console.error('Erro ao sincronizar o evento ativo:', erro_excecao);
      set_mensagem_erro_admin('Falha ao sincronizar o evento ativo com o banco de dados.');
    }
  }, [conexao_banco_configurada]);

  const buscar_metricas_admin = fetchDashboardData;

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // 2. Função de Execução do Reset Global via RPC
  const executar_reset_global_rpc = async () => {
    try {
      set_executando_reset_rpc(true);
      const isUuidVal = (id?: string | null) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      const idValido = isUuidVal(metricas_admin.evento_ativo_id) ? metricas_admin.evento_ativo_id : null;

      // Invocação resiliente da Stored Procedure oficial no Supabase para o evento ativo
      let resultadoRpc = await supabase.rpc('admin_reset_global', {
        p_id_evento: idValido,
      });

      // Fallback caso o banco possua a assinatura legada sem argumentos
      if (resultadoRpc.error && (resultadoRpc.error.message?.includes('p_id_evento') || resultadoRpc.error.code === 'PGRST202')) {
        resultadoRpc = await supabase.rpc('admin_reset_global');
      }

      if (resultadoRpc.error) {
        throw resultadoRpc.error;
      }

      set_mostrar_modal_reset_etapa2(false);
      set_confirmacao_texto_reset('');
      set_mensagem_notificacao("Reset Global concluído com sucesso. Todos os dados do evento foram reiniciados.");
      setTimeout(() => set_mensagem_notificacao(null), 5000);

      // Atualização imediata dos dados do painel sem reload brusco
      await fetchDashboardData();
    } catch (err: any) {
      alert(`Falha no Reset: ${err.message}`);
    } finally {
      set_executando_reset_rpc(false);
    }
  };

  // Criar novo evento completo
  const salvar_novo_evento = async () => {
    const nomeLimpo = novo_evento_nome.trim();
    if (!nomeLimpo) {
      alert('Por favor, informe o nome do evento.');
      return;
    }

    try {
      set_salvando_novo_evento(true);

      let idCriado = null;
      if (conexao_banco_configurada) {
        const dataFormatada = novo_evento_data || new Date().toISOString().split('T')[0];

        const payloadCompleto: any = {
          nome_evento: nomeLimpo,
          edicao: novo_evento_edicao.trim() || 'Nova Edição',
          data_evento: dataFormatada,
          horario_inicio: novo_evento_horario_inicio || '08:00',
          horario_fim: novo_evento_horario_fim || '18:00',
          descricao: novo_evento_descricao.trim() || null,
          cota_avaliacoes_padrao: Number(novo_evento_cota_padrao) || 3,
          minutos_timeout_lock: Number(novo_evento_timeout_lock) || 30,
          is_ativo: novo_evento_is_ativo,
          sistema_liberado: true,
          intervalo_pausa_avaliador: 0,
        };

        let resInsert = await supabase
          .from('eventos')
          .insert(payloadCompleto)
          .select('id_evento')
          .single();

        // Fallback resiliente: se der erro de coluna ausente no schema cache (ex: data_evento), retenta com colunas base
        if (resInsert.error && (resInsert.error.message?.includes('schema cache') || resInsert.error.code === 'PGRST204')) {
          console.warn('Detectada divergência de colunas no schema cache do Supabase. Executando fallback seguro com campos base...');
          const { data_evento, edicao, descricao, ...payloadCompativel } = payloadCompleto;
          
          resInsert = await supabase
            .from('eventos')
            .insert(payloadCompativel)
            .select('id_evento')
            .single();
        }

        if (resInsert.error) {
          throw resInsert.error;
        }
        idCriado = resInsert.data?.id_evento;

        // Só depois de gravar o novo evento desativa os outros: se o cadastro falhar, o evento ativo continua
        if (novo_evento_is_ativo && idCriado) {
          const { error: erroDesativar } = await supabase
            .from('eventos')
            .update({ is_ativo: false })
            .neq('id_evento', idCriado);
          if (erroDesativar) throw erroDesativar;
        }
      }

      if (novo_evento_is_ativo) {
        setNomeEvento(nomeLimpo);
        if (typeof window !== 'undefined') {
          localStorage.setItem('evento_ativo_nome', nomeLimpo);
          if (idCriado) localStorage.setItem('evento_ativo_id', idCriado);
        }
        set_metricas_admin((ant) => ({
          ...metricas_iniciais_zeradas,
          evento_ativo_id: idCriado || '',
          evento_ativo_nome: nomeLimpo,
          evento_ativo_edicao: novo_evento_edicao.trim() || 'Nova Edição',
        }));
        exibir_notificacao(`Evento "${nomeLimpo}" criado e ativado com sucesso!`);
        await fetchDashboardData();
      } else {
        exibir_notificacao(`Evento "${nomeLimpo}" cadastrado com sucesso!`);
      }

      set_mostrar_modal_novo_evento(false);
      limpar_form_novo_evento();
    } catch (err: any) {
      alert(`Erro ao cadastrar novo evento: ${err?.message || err}`);
    } finally {
      set_salvando_novo_evento(false);
    }
  };

  // 1. SINCRONIA DE ESTADO: Função que salva o novo nome do evento (acionada pelo ícone de Lápis)
  const salvar_edicao_nome_evento = async (novoNome: string) => {
    const nomeLimpo = novoNome.trim();
    if (!nomeLimpo) return;
    set_salvando_nome_evento(true);

    try {
      if (conexao_banco_configurada) {
        // Gravação direta e corrigida na tabela 'eventos'
        let { error } = await supabase
          .from('eventos')
          .update({ nome_evento: nomeLimpo })
          .eq('id_evento', metricas_admin.evento_ativo_id);

        if (error) {
          const resId = await supabase
            .from('eventos')
            .update({ nome_evento: nomeLimpo })
            .eq('id', metricas_admin.evento_ativo_id);
          error = resId.error;
        }

        if (error) {
          // Atualiza registro de evento ativo se ID não corresponder
          const resAtivo = await supabase
            .from('eventos')
            .update({ nome_evento: nomeLimpo })
            .eq('is_ativo', true);
          if (resAtivo.error) {
            console.warn('Atualização em eventos:', resAtivo.error.message);
          }
        }
      }

      // REGRA OBRIGATÓRIA: Imediatamente após o sucesso do .update() no Supabase,
      // OBRIGATORIAMENTE atualize a variável de estado que guarda o nome do evento (setNomeEvento)
      setNomeEvento(nomeLimpo);
      set_metricas_admin((ant) => ({
        ...ant,
        evento_ativo_nome: nomeLimpo
      }));
      set_mostrar_modal_editar_nome_evento(false);
      exibir_notificacao('Nome do evento atualizado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao atualizar tabela eventos:', err);
      alert(`Erro ao atualizar nome do evento: ${err?.message || err}`);
    } finally {
      set_salvando_nome_evento(false);
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 pb-20 font-sans">
      {/* Toast Notificação */}
      {mensagem_notificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Alerta de Erro Visual */}
      {mensagem_erro_admin && (
        <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 p-4 rounded-2xl flex items-center justify-between gap-3 text-red-800 dark:text-red-200 text-xs sm:text-sm font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{mensagem_erro_admin}</span>
          </div>
          <button
            type="button"
            onClick={buscar_metricas_admin}
            className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-bold shrink-0 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>
      )}

      {/* 1. CABEÇALHO DO PAINEL DE CONTROLE ADMIN: Mantém APENAS Título, Nome do Evento (com Lápis) e Engrenagem à direita */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            Painel de Controle
          </h1>
          <span className="text-slate-300 dark:text-slate-600 text-xl font-light">|</span>
          <div className="flex items-center gap-2">
            <span className="text-lg sm:text-xl font-bold text-emerald-700 dark:text-emerald-400">
              {nomeEvento}
            </span>
            <button
              type="button"
              onClick={() => {
                set_novo_nome_evento_input(nomeEvento);
                set_mostrar_modal_editar_nome_evento(true);
              }}
              title="Editar Nome do Evento"
              disabled={!metricas_admin.evento_ativo_id}
              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Editar Nome do Evento"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Ações do Header: Novo Evento, Monitoramento e Configurações */}
        <div className="flex items-center gap-2">
          {/* Botão Novo Evento */}
          <button
            type="button"
            onClick={() => {
              limpar_form_novo_evento();
              set_mostrar_modal_novo_evento(true);
            }}
            title="Cadastrar Novo Evento"
            className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-xs transition-all hover:scale-[1.02] cursor-pointer"
            aria-label="Novo Evento"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Novo Evento</span>
          </button>

          {/* Botão de Monitoramento posicionado imediatamente à esquerda da Engrenagem */}
          <button
            type="button"
            onClick={() => set_mostrar_modal_telao(true)}
            title="Monitoramento em Tempo Real"
            className="px-3.5 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700/80 transition-all flex items-center gap-2 shadow-xs cursor-pointer font-bold text-xs sm:text-sm"
            aria-label="Monitoramento"
          >
            <Tv className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span>Monitoramento</span>
          </button>

          {/* Ícone de Engrenagem (Configurações) à direita */}
          <button
            type="button"
            onClick={() => set_mostrar_modal_configuracoes(true)}
            title="Configurações Gerais"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 transition-all flex items-center justify-center shadow-xs cursor-pointer"
            aria-label="Configurações Gerais"
          >
            <Settings className="w-5 h-5 text-slate-700 dark:text-slate-200" />
          </button>
        </div>
      </div>

          {/* BENTO GRID EM 4 BLOCOS VISUAIS */}
          <div className="space-y-8">
            {/* BLOCO 1: PROJETOS E PAVILHÃO */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Bloco 1: Projetos & Pavilhão
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
                {/* 1. Projetos */}
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_projetos(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <FolderGit2 className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    Projetos
                  </span>
                </button>

                {/* 2. Projetos Bloqueados */}
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_bloqueios(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    Projetos Bloqueados
                  </span>
                </button>

                {/* 3. Projetos em Quarentena */}
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_quarentena(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                    Projetos em Quarentena
                  </span>
                </button>

                {/* 4. Atribuir Projeto */}
                <button
                  type="button"
                  onClick={() => set_mostrar_modal_atribuicao_forcada(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    Atribuir Projeto
                  </span>
                </button>

                {/* 5. Excluir uma avaliação */}
                <button
                  type="button"
                  onClick={() => set_mostrar_modal_exclusao_avaliacao(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <FileX2 className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                    Excluir uma avaliação
                  </span>
                </button>
              </div>
            </section>

            {/* BLOCO 2: PESSOAL & DADOS */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span> Bloco 2: Pessoal & Formulários
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
                {/* 1. Avaliadores */}
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_avaliadores(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    Avaliadores
                  </span>
                </button>

                {/* 2. Equipe Staff */}
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_staff(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-cyan-50 dark:bg-cyan-950/50 text-cyan-600 dark:text-cyan-400 border border-cyan-100 dark:border-cyan-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <UserCog className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                    Equipe Staff
                  </span>
                </button>

                {/* 3. Questionários */}
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_questionarios(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <ClipboardList className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                    Questionários
                  </span>
                </button>

                {/* 4. Instituições */}
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_instituicoes(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 group-hover:scale-105 transition-transform shrink-0">
                    <Building className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                    Instituições
                  </span>
                </button>

                {/* 5. Modalidades e Níveis */}
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_modalidades(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <Layers className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                    Modalidades e Níveis
                  </span>
                </button>
              </div>
            </section>

            {/* BLOCO 3: MONITORAMENTO EM TEMPO REAL & RELATÓRIOS */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span> Bloco 3: Monitoramento em Tempo Real & Relatórios
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <button
                  type="button"
                  onClick={() => set_mostrar_modal_ranking(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    Classificação
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => set_mostrar_modal_relatorio_acordeao(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 group-hover:scale-105 transition-transform shrink-0">
                    <Printer className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                    Relatórios
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => set_mostrar_modal_mapa(true)}
                  className="bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 p-3.5 sm:p-4 rounded-2xl shadow-xs hover:shadow-md flex items-center gap-3 transition-all hover:scale-[1.01] cursor-pointer group text-left w-full"
                >
                  <div className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-800/60 group-hover:scale-105 transition-transform shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                    Mapa de Estandes
                  </span>
                </button>
              </div>
            </section>
          </div>

      {/* 4. MODAL DE ATRIBUIÇÃO FORÇADA DE PROJETOS */}
      {mostrar_modal_atribuicao_forcada && (
        <AtribuicaoForcada
          isOpen={mostrar_modal_atribuicao_forcada}
          aoFechar={() => set_mostrar_modal_atribuicao_forcada(false)}
          aoSucesso={buscar_metricas_admin}
          id_evento_ativo={metricas_admin.evento_ativo_id}
          cota_padrao_evento={metricas_admin.cota_avaliacoes_padrao || 3}
        />
      )}



      {/* 2. MODAL PARA EDIÇÃO DO NOME DO EVENTO (TABELA EVENTOS) */}
      {mostrar_modal_editar_nome_evento && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-emerald-600" />
                Editar Nome do Evento
              </h3>
              <button
                type="button"
                onClick={() => set_mostrar_modal_editar_nome_evento(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Nome do Evento:
              </label>
              <input
                type="text"
                value={novo_nome_evento_input}
                onChange={(e) => set_novo_nome_evento_input(e.target.value)}
                placeholder="Ex: FETEC MS 2026"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    salvar_edicao_nome_evento(novo_nome_evento_input);
                  }
                }}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => set_mostrar_modal_editar_nome_evento(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando_nome_evento || !novo_nome_evento_input.trim()}
                onClick={() => salvar_edicao_nome_evento(novo_nome_evento_input)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center gap-1.5 shadow-sm"
              >
                {salvando_nome_evento && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RANKING DE PREMIAÇÃO (MODAL A PARTIR DO CARD BENTO GRID) */}
      {mostrar_modal_ranking && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl p-6 relative border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <button
              type="button"
              onClick={() => set_mostrar_modal_ranking(false)}
              aria-label="Fechar Classificação"
              title="Fechar Classificação"
              className="absolute top-6 right-6 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <RankingPremiacao id_evento_ativo={metricas_admin.evento_ativo_id} />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE QUESTIONÁRIOS (MODAL A PARTIR DO CARD BENTO GRID) */}
      {mostrar_gestor_questionarios && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl p-6 relative border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <button
              type="button"
              onClick={() => {
                set_mostrar_gestor_questionarios(false);
                fetchDashboardData();
              }}
              className="absolute top-6 right-6 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <GestorQuestionarios
              id_evento_ativo={metricas_admin.evento_ativo_id}
              aoAtualizarMetricas={fetchDashboardData}
              aoFechar={() => {
                set_mostrar_gestor_questionarios(false);
                fetchDashboardData();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE INSTITUIÇÕES (MODAL A PARTIR DO CARD BENTO GRID) */}
      {mostrar_gestor_instituicoes && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl p-6 relative border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <button
              type="button"
              onClick={() => set_mostrar_gestor_instituicoes(false)}
              className="absolute top-6 right-6 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <GestorInstituicoes id_evento_ativo={metricas_admin.evento_ativo_id} ao_fechar={() => set_mostrar_gestor_instituicoes(false)} />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE MODALIDADES E NÍVEIS (MODAL A PARTIR DO CARD BENTO GRID) */}
      {mostrar_gestor_modalidades && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl p-6 relative border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <button
              type="button"
              onClick={() => set_mostrar_gestor_modalidades(false)}
              className="absolute top-6 right-6 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <GestorModalidades
              id_evento_ativo={metricas_admin.evento_ativo_id}
              ao_fechar={() => set_mostrar_gestor_modalidades(false)}
              aoAtualizarMetricas={buscar_metricas_admin}
            />
          </div>
        </div>
      )}

      {/* MODAL DETALHAMENTO DO BENTO GRID (SELECT REAL) */}
      {modal_detalhe_ativo && (
        <ModalDetalhamento
          tipo={modal_detalhe_ativo.tipo}
          titulo={modal_detalhe_ativo.titulo}
          id_evento_ativo={metricas_admin.evento_ativo_id}
          aoAtualizarMetricas={fetchDashboardData}
          ao_fechar={() => {
            set_modal_detalhe_ativo(null);
            buscar_metricas_admin();
          }}
        />
      )}

      {/* MODAL DE EXCLUSÃO DE AVALIAÇÃO (SOFT DELETE COM UNDO) */}
      {mostrar_modal_exclusao_avaliacao && (
        <ModalExclusaoAvaliacao
          id_evento_ativo={metricas_admin.evento_ativo_id}
          ao_fechar={() => set_mostrar_modal_exclusao_avaliacao(false)}
          aoSucesso={buscar_metricas_admin}
        />
      )}

      {/* 1. MODAL CONFIGURAÇÕES DO EVENTO (Sincronizado com Header e com Reset Global no interior) */}
      {mostrar_modal_configuracoes && (
        <ModalConfiguracoesEvento
          id_evento_ativo={metricas_admin.evento_ativo_id}
          nome_evento_atual={nomeEvento}
          ao_fechar={() => set_mostrar_modal_configuracoes(false)}
          ao_salvar_sucesso={(novoNome, novaData) => {
            if (novoNome) {
              setNomeEvento(novoNome);
              set_metricas_admin((ant) => ({ ...ant, evento_ativo_nome: novoNome }));
            }
            if (novaData) {
              set_metricas_admin((ant) => ({ ...ant, evento_ativo_data: novaData }));
              if (typeof window !== 'undefined') {
                localStorage.setItem('evento_ativo_data', novaData);
              }
            }
            buscar_metricas_admin();
          }}
          ao_disparar_reset_global={() => {
            set_mostrar_modal_configuracoes(false);
            set_mostrar_modal_reset_etapa1(true);
          }}
          ao_abrir_historico={() => {
            set_mostrar_modal_configuracoes(false);
            carregar_historico_eventos();
            set_mostrar_modal_historico(true);
          }}
          ao_abrir_novo_evento={() => {
            set_mostrar_modal_configuracoes(false);
            limpar_form_novo_evento();
            set_mostrar_modal_novo_evento(true);
          }}
          ao_abrir_instituicoes={() => {
            set_mostrar_modal_configuracoes(false);
            set_mostrar_gestor_instituicoes(true);
          }}
          ao_abrir_administradores={() => {
            set_mostrar_modal_configuracoes(false);
            set_modal_detalhe_ativo({ tipo: 'administradores', titulo: 'Gestão de Administradores' });
          }}
        />
      )}

      {/* DUPLO MODAL DE CONFIRMAÇÃO DO RESET GLOBAL */}
      {mostrar_modal_reset_etapa1 && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-lg w-full border border-red-300 dark:border-red-900 shadow-2xl space-y-6">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400 font-extrabold text-lg border-b pb-4">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              Etapa 1/2: Reset Global do Evento
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              ATENÇÃO: A execução do Reset Global invocará a Stored Procedure oficial <code className="font-mono bg-slate-100 dark:bg-slate-900 px-1 py-0.5 rounded text-red-600">admin_reset_global</code>. Isso removerá todo o ciclo avaliativo, respostas, notas, travas, projetos, questionários e credenciais temporárias do evento, preservando estritamente os Administradores e Superadmins.
            </p>

            <div className="bg-red-50 dark:bg-red-950/40 p-4 rounded-xl border border-red-200 dark:border-red-800 space-y-2">
              <span className="text-xs font-bold text-red-800 dark:text-red-300 block">
                Digite exatamente o nome do evento ativo para avançar:
              </span>
              <code className="text-xs font-bold bg-white dark:bg-slate-900 px-2 py-1 rounded text-red-700 dark:text-red-400 inline-block">
                {token_confirmacao_reset}
              </code>
              <input
                type="text"
                value={confirmacao_texto_reset}
                onChange={(e) => set_confirmacao_texto_reset(e.target.value)}
                placeholder={`Digite o nome do evento: ${token_confirmacao_reset}`}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border rounded-xl text-xs font-medium text-slate-900 dark:text-white mt-1"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  set_mostrar_modal_reset_etapa1(false);
                  set_confirmacao_texto_reset('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirmacao_texto_reset.trim() !== token_confirmacao_reset}
                onClick={() => {
                  set_mostrar_modal_reset_etapa1(false);
                  set_mostrar_modal_reset_etapa2(true);
                }}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white"
              >
                Avançar para Etapa Final →
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrar_modal_reset_etapa2 && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-lg w-full border-2 border-red-600 shadow-2xl space-y-6">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400 font-extrabold text-lg border-b pb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              Etapa 2/2: Confirmação Crítica Final
            </div>

            <div className="p-4 bg-red-100 dark:bg-red-950/80 text-red-900 dark:text-red-200 rounded-xl text-xs font-bold leading-relaxed">
              Você está prestes a disparar a Stored Procedure <code className="font-mono bg-white/60 dark:bg-black/30 px-1 py-0.5 rounded">admin_reset_global(p_id_evento = '{metricas_admin.evento_ativo_id}')</code>. Esta operação é atômica e irreversível no Supabase.
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  set_mostrar_modal_reset_etapa2(false);
                  set_confirmacao_texto_reset('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                Cancelar Operação
              </button>
              <button
                type="button"
                onClick={executar_reset_global_rpc}
                disabled={executando_reset_rpc}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-red-700 hover:bg-red-800 text-white flex items-center gap-2"
              >
                {executando_reset_rpc && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar Execução da RPC no Supabase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE PROJETOS (CRUD) */}
      {mostrar_gestor_projetos && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto flex flex-col">
            <GestorProjetos
              id_evento_ativo={metricas_admin.evento_ativo_id}
              idProjetoEditarInicial={id_projeto_editar_gestor}
              aoAtualizarMetricas={fetchDashboardData}
              aoFechar={() => {
                set_mostrar_gestor_projetos(false);
                set_id_projeto_editar_gestor(null);
                fetchDashboardData();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE AVALIADORES (COMPLETO COM CRUD E IMPORTADOR) */}
      {mostrar_gestor_avaliadores && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto flex flex-col">
            <GestorAvaliadores
              id_evento_ativo={metricas_admin.evento_ativo_id}
              aoAtualizarMetricas={fetchDashboardData}
              ao_fechar={() => {
                set_mostrar_gestor_avaliadores(false);
                fetchDashboardData();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE STAFF (COMPLETO COM CRUD E IMPORTADOR) */}
      {mostrar_gestor_staff && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto flex flex-col">
            <GestorStaff
              id_evento_ativo={metricas_admin.evento_ativo_id}
              aoAtualizarMetricas={fetchDashboardData}
              ao_fechar={() => {
                set_mostrar_gestor_staff(false);
                fetchDashboardData();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL MONITORAMENTO (TELÃO AO VIVO) */}
      {mostrar_modal_telao && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col p-4 sm:p-6 overflow-y-auto">
          <div className="flex items-center justify-between pb-3 max-w-7xl mx-auto w-full border-b border-slate-800 mb-4">
            <div className="flex items-center gap-2 text-white font-extrabold text-lg">
              <Tv className="w-6 h-6 text-emerald-400" />
              Monitoramento em Tempo Real
            </div>
            <button
              type="button"
              onClick={() => set_mostrar_modal_telao(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center gap-2 border border-slate-700 transition-colors cursor-pointer text-sm"
            >
              <X className="w-4 h-4" /> Fechar Monitoramento
            </button>
          </div>
          <div className="max-w-7xl mx-auto w-full flex-1">
            <TelaoAoVivo />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE BLOQUEIOS */}
      {mostrar_gestor_bloqueios && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto flex flex-col">
            <ProjetosBloqueados
              id_evento_ativo={metricas_admin.evento_ativo_id}
              aoAtualizarMetricas={fetchDashboardData}
              aoFechar={() => {
                set_mostrar_gestor_bloqueios(false);
                fetchDashboardData();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE QUARENTENA */}
      {mostrar_gestor_quarentena && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto flex flex-col">
            <ProjetosQuarentena
              id_evento_ativo={metricas_admin.evento_ativo_id}
              aoAtualizarMetricas={fetchDashboardData}
              aoFechar={() => {
                set_mostrar_gestor_quarentena(false);
                fetchDashboardData();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL MAPA DE ESTANDES INTERATIVO & AUDITORIA */}
      {mostrar_modal_mapa && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-1 sm:p-2 overflow-hidden">
          <div className="w-[99vw] max-w-[99vw] h-[98vh] max-h-[98vh] my-auto flex flex-col">
            <MapaEstandes
              id_evento_ativo={metricas_admin.evento_ativo_id}
              cota_padrao_evento={metricas_admin.cota_avaliacoes_padrao || 3}
              aoFechar={() => set_mostrar_modal_mapa(false)}
              aoEditarProjeto={(idProj) => {
                set_mostrar_modal_mapa(false);
                set_id_projeto_editar_gestor(idProj);
                set_mostrar_gestor_projetos(true);
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL CRIAR NOVO EVENTO */}
      {mostrar_modal_novo_evento && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 max-w-2xl w-full border border-slate-200 dark:border-slate-700 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                  <PlusCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900 dark:text-white">
                    Cadastrar Novo Evento / Edição
                  </h3>
                  <p className="text-xs text-slate-500">
                    Defina os parâmetros operacionais da nova feira
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => set_mostrar_modal_novo_evento(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); salvar_novo_evento(); }} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Nome do Evento */}
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                    Nome do Evento <span className="text-red-500">*</span>:
                  </label>
                  <input
                    type="text"
                    required
                    value={novo_evento_nome}
                    onChange={(e) => set_novo_evento_nome(e.target.value)}
                    placeholder="Ex: FETEC MS 2027"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Edição */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                    Edição:
                  </label>
                  <input
                    type="text"
                    value={novo_evento_edicao}
                    onChange={(e) => set_novo_evento_edicao(e.target.value)}
                    placeholder="Ex: 18ª Edição"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Data do Evento */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                    Data do Evento <span className="text-red-500">*</span>:
                  </label>
                  <input
                    type="date"
                    required
                    value={novo_evento_data}
                    onChange={(e) => set_novo_evento_data(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Horário Início */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                    Horário de Início:
                  </label>
                  <input
                    type="time"
                    value={novo_evento_horario_inicio}
                    onChange={(e) => set_novo_evento_horario_inicio(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Horário Fim */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                    Horário de Término:
                  </label>
                  <input
                    type="time"
                    value={novo_evento_horario_fim}
                    onChange={(e) => set_novo_evento_horario_fim(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Cota Padrão de Avaliações */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                    Cota de Avaliações por Projeto:
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={novo_evento_cota_padrao}
                    onChange={(e) => set_novo_evento_cota_padrao(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Timeout de Trava (minutos) */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                    Timeout de Trava (minutos):
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    value={novo_evento_timeout_lock}
                    onChange={(e) => set_novo_evento_timeout_lock(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {/* Descrição Detalhada */}
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                    Descrição do Evento (Opcional):
                  </label>
                  <textarea
                    rows={3}
                    value={novo_evento_descricao}
                    onChange={(e) => set_novo_evento_descricao(e.target.value)}
                    placeholder="Informações adicionais sobre o pavilhão, regras gerais ou cronograma..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                </div>
              </div>

              {/* Checkbox de ativação */}
              <div className="p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 flex items-center gap-3">
                <input
                  type="checkbox"
                  id="chk_novo_evento_ativo"
                  checked={novo_evento_is_ativo}
                  onChange={(e) => set_novo_evento_is_ativo(e.target.checked)}
                  className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="chk_novo_evento_ativo" className="text-xs font-bold text-blue-900 dark:text-blue-200 cursor-pointer select-none">
                  Tornar este evento ativo agora (o painel alternará imediatamente para esta nova edição)
                </label>
              </div>

              {/* Ações */}
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => set_mostrar_modal_novo_evento(false)}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando_novo_evento || !novo_evento_nome.trim()}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  {salvando_novo_evento && <Loader2 className="w-4 h-4 animate-spin" />}
                  Cadastrar Evento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL HISTÓRICO DE EVENTOS */}
      {mostrar_modal_historico && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 max-w-2xl w-full border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400">
                  <History className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900 dark:text-white">
                    Histórico de Eventos & Edições
                  </h3>
                  <p className="text-xs text-slate-500">
                    Selecione uma edição para ativá-la no painel
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => set_mostrar_modal_historico(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {carregando_historico_eventos ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                <span className="text-xs">Consultando eventos no banco...</span>
              </div>
            ) : lista_eventos_historico.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Nenhum evento registrado no banco de dados.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
                {lista_eventos_historico.map((evt) => {
                  const isEsteAtivo = evt.id_evento === metricas_admin.evento_ativo_id || evt.is_ativo;
                  return (
                    <div
                      key={evt.id_evento}
                      className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isEsteAtivo
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700/80 shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">
                            {evt.nome_evento}
                          </span>
                          {isEsteAtivo && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> ATIVO AGORA
                            </span>
                          )}
                          {!isEsteAtivo && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                              Arquivado
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3 flex-wrap">
                          {evt.edicao && <span>{evt.edicao}</span>}
                          {(evt.data_evento || evt.data_inicio) && (
                            <span>• Data: {evt.data_evento || evt.data_inicio}</span>
                          )}
                          {evt.horario_inicio && <span>• {evt.horario_inicio.slice(0, 5)} às {evt.horario_fim ? evt.horario_fim.slice(0, 5) : '18:00'}</span>}
                        </div>
                      </div>

                      <div>
                        {isEsteAtivo ? (
                          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                            Edição em Uso
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => ativar_evento_historico(evt)}
                            className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            Ativar Este Evento
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  set_mostrar_modal_historico(false);
                  limpar_form_novo_evento();
                  set_mostrar_modal_novo_evento(true);
                }}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" /> Cadastrar Outro Evento
              </button>

              <button
                type="button"
                onClick={() => set_mostrar_modal_historico(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RELATÓRIOS (VIEW_RELATORIO_PROJETOS & VIEW_RELATORIO_AVALIADORES) */}
      {mostrar_modal_relatorio_acordeao && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto print:static print:inset-auto print:z-auto print:bg-transparent print:backdrop-blur-none print:p-0 print:m-0 print:overflow-visible print:block print:w-full print:h-auto">
          <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl p-6 relative border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col print:w-full print:max-w-none print:h-auto print:max-h-none print:overflow-visible print:border-none print:shadow-none print:rounded-none print:p-0 print:m-0 print:bg-white print:static print:block">
            <RelatoriosAdmin
              id_evento_ativo={metricas_admin.evento_ativo_id}
              aoFechar={() => set_mostrar_modal_relatorio_acordeao(false)}
            />
          </div>
        </div>
      )}
    </main>
  );
};
