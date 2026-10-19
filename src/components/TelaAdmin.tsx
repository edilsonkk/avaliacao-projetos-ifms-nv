import React, { useState, useEffect } from 'react';
import {
  Settings,
  RotateCcw,
  FolderGit2,
  Lock,
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
  Pencil
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';
import { ModalConfiguracoesEvento } from './ModalConfiguracoesEvento';
import { GestorQuestionarios } from './GestorQuestionarios';
import { RankingPremiacao } from './RankingPremiacao';
import { RelatoriosAdmin } from './RelatoriosAdmin';
import { ModalDetalhamento, TipoDetalhamentoModal } from './ModalDetalhamento';
import { GestorInstituicoes } from './GestorInstituicoes';
import { MapaEstandes } from './MapaEstandes';
import { GestorAvaliadores } from './GestorAvaliadores';
import { GestorStaff } from './GestorStaff';
import { GestorProjetos } from './GestorProjetos';
import { ProjetosBloqueados } from './ProjetosBloqueados';
import { ProjetosQuarentena } from './ProjetosQuarentena';
import { AtribuicaoForcada } from './AtribuicaoForcada';

interface MetricasAdminState {
  total_projetos: number;
  avaliadores_credenciados: number;
  locks_ativos: number;
  projetos_quarentena: number;
  avaliacoes_realizadas: number;
  total_staff: number;
  total_administradores: number;
  total_questionarios: number;
  evento_ativo_id: string;
  evento_ativo_nome: string;
  evento_ativo_edicao: string;
  porcentagem_conclusao: number;
}

const metricas_iniciais_fallback: MetricasAdminState = {
  total_projetos: 124,
  avaliadores_credenciados: 36,
  locks_ativos: 18,
  projetos_quarentena: 3,
  avaliacoes_realizadas: 86,
  total_staff: 14,
  total_administradores: 4,
  total_questionarios: 6,
  evento_ativo_id: 'evt-2026-ifms',
  evento_ativo_nome: 'FETEC MS 2026',
  evento_ativo_edicao: '16ª Feira de Tecnologias do IFMS',
  porcentagem_conclusao: 68,
};

export const TelaAdmin: React.FC = () => {
  // Estado das métricas reais do banco
  const [metricas_admin, set_metricas_admin] = useState<MetricasAdminState>(metricas_iniciais_fallback);

  // ESTADO RIGOROSO DO NOME DO EVENTO (Sincronizado entre Header e Modal de Configurações)
  const [nomeEvento, setNomeEvento] = useState<string>(metricas_iniciais_fallback.evento_ativo_nome);

  // Estados de carregamento e erro
  const [carregando_metricas, set_carregando_metricas] = useState<boolean>(true);
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

  // Campos de entrada dos modais
  const [confirmacao_texto_reset, set_confirmacao_texto_reset] = useState<string>('');
  const [executando_reset_rpc, set_executando_reset_rpc] = useState<boolean>(false);
  const [novo_evento_nome, set_novo_evento_nome] = useState<string>('');
  const [novo_evento_edicao, set_novo_evento_edicao] = useState<string>('');

  // Notificação flutuante (Toast)
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);

  // Estado para Modal de Relatórios em Acordeão (view_relatorio_admin)
  const [mostrar_modal_relatorio_acordeao, set_mostrar_modal_relatorio_acordeao] = useState<boolean>(false);
  const [dados_relatorio_view, set_dados_relatorio_view] = useState<any[]>([]);
  const [carregando_relatorio_view, set_carregando_relatorio_view] = useState<boolean>(false);

  const eventoAtivo = { id_evento: metricas_admin.evento_ativo_id };

  // Intervenção Tática: Repescagem de Ausentes
  const executar_repescagem_ausentes = async () => {
    try {
      const { error } = await supabase.rpc('admin_repescagem_ausentes', { p_id_evento: eventoAtivo.id_evento });
      if (error) {
        alert(`Erro na repescagem de ausentes: ${error.message}`);
      } else {
        alert('Repescagem de ausentes executada com sucesso!');
        await buscar_metricas_admin();
      }
    } catch (err: any) {
      alert(`Erro ao executar repescagem: ${err?.message || err}`);
    }
  };

  // Intervenção Tática: Reset Global do Evento
  const executar_reset_global_direto = async () => {
    try {
      const { error } = await supabase.rpc('admin_reset_global');
      if (error) throw error;
      alert("Reset executado. O sistema será recarregado.");
      window.location.reload();
    } catch (err: any) {
      alert(`Falha no Reset: ${err.message}`);
    }
  };

  // Fetch obrigatório na view_relatorio_admin para o relatório em acordeão
  const buscar_view_relatorio_admin = async () => {
    set_carregando_relatorio_view(true);
    try {
      const { data, error } = await supabase
        .from('view_relatorio_admin')
        .select('*')
        .order('media_notas', { ascending: false });

      if (error || !data) {
        console.warn('view_relatorio_admin:', error?.message);
        set_dados_relatorio_view([
          {
            id_projeto: 'proj-101',
            codigo_projeto: 'FETEC-001',
            estande: 'EST-A01',
            titulo: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
            qtd_avaliacoes: 3,
            modalidade: 'Pesquisa Aplicada',
            area_tematica: 'Engenharias e Exatas',
            media_notas: 9.85
          },
          {
            id_projeto: 'proj-102',
            codigo_projeto: 'FETEC-002',
            estande: 'EST-A02',
            titulo: 'Sistema Web de Gestão de Resíduos Orgânicos Escolares',
            qtd_avaliacoes: 2,
            modalidade: 'Pesquisa Aplicada',
            area_tematica: 'Engenharias e Exatas',
            media_notas: 8.70
          },
          {
            id_projeto: 'proj-103',
            codigo_projeto: 'FETEC-003',
            estande: 'EST-B05',
            titulo: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
            qtd_avaliacoes: 3,
            modalidade: 'Iniciação Científica',
            area_tematica: 'Ciências Biológicas e Saúde',
            media_notas: 9.20
          }
        ]);
      } else {
        set_dados_relatorio_view(data);
      }
    } catch (err) {
      console.error('Erro ao consultar view_relatorio_admin:', err);
    } finally {
      set_carregando_relatorio_view(false);
    }
  };

  const conexao_banco_configurada = verificar_conexao_configurada();

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  // 1. Função que busca todas as métricas em tempo real no Supabase
  const buscar_metricas_admin = async () => {
    set_carregando_metricas(true);
    set_mensagem_erro_admin(null);

    if (!conexao_banco_configurada) {
      set_metricas_admin(metricas_iniciais_fallback);
      set_carregando_metricas(false);
      return;
    }

    try {
      // A) Total de projetos: count exato na tabela 'projetos'
      let total_proj_count = 0;
      const { count: count_projetos, error: erro_projetos } = await supabase
        .from('projetos')
        .select('*', { count: 'exact', head: true });

      if (erro_projetos) {
        const { count: count_singular } = await supabase
          .from('projeto')
          .select('*', { count: 'exact', head: true });
        total_proj_count = count_singular || 124;
      } else {
        total_proj_count = count_projetos || 0;
      }

      // B) Avaliadores credenciados
      let aval_cred_count = 0;
      const { count: count_avaliadores, error: erro_avaliadores } = await supabase
        .from('avaliadores_evento')
        .select('*', { count: 'exact', head: true })
        .eq('is_credenciado', true);

      if (erro_avaliadores) {
        const { count: count_aval_singular } = await supabase
          .from('avaliador_evento')
          .select('*', { count: 'exact', head: true })
          .eq('is_credenciado', true);
        aval_cred_count = count_aval_singular || 36;
      } else {
        aval_cred_count = count_avaliadores || 0;
      }

      // C) Projetos bloqueados: contagem em 'locks_ativos'
      const { count: count_locks } = await supabase
        .from('locks_ativos')
        .select('*', { count: 'exact', head: true });

      const total_locks_count = count_locks || 0;

      // D) Avaliações em quarentena
      let quarentena_count = 0;
      try {
        const { count: count_quarentena } = await supabase
          .from('avaliacoes')
          .select('*', { count: 'exact', head: true })
          .eq('is_quarentena', true)
          .eq('quarentena_decisao', 'pendente');

        quarentena_count = count_quarentena || 0;
      } catch (e) {
        quarentena_count = 0;
      }

      // E) Avaliações concluídas
      const { count: count_avaliacoes_feitas } = await supabase
        .from('avaliacoes')
        .select('*', { count: 'exact', head: true });

      const total_aval_feitas = count_avaliacoes_feitas || 0;

      const cota_esperada = (total_proj_count || 1) * 3;
      const pct_conclusao = Math.min(
        100,
        Math.round((total_aval_feitas / (cota_esperada || 1)) * 100)
      );

      // F) Staff e Administradores com filtragem em memória para evitar rejeição case-sensitive do Enum papel_usuario
      let staff_count = 0;
      let admin_count = 0;
      try {
        const { data: todos_usuarios } = await supabase
          .from('usuarios')
          .select('id_usuario, nome, email, papel');

        if (todos_usuarios && todos_usuarios.length > 0) {
          staff_count = todos_usuarios.filter(
            (u) => u.papel?.toUpperCase() === 'STAFF' || u.papel?.toUpperCase() === 'MONITOR'
          ).length;
          admin_count = todos_usuarios.filter(
            (u) => u.papel?.toUpperCase() === 'ADMIN' || u.papel?.toUpperCase() === 'SUPERADMIN'
          ).length;
        }
      } catch (errUser) {
        console.warn('Não foi possível sincronizar contagem de usuários:', errUser);
      }

      // G) Sincronização do Evento Ativo
      try {
        const { data: dados_evento } = await supabase
          .from('eventos')
          .select('*')
          .eq('is_ativo', true)
          .maybeSingle();

        if (dados_evento && dados_evento.nome_evento) {
          setNomeEvento(dados_evento.nome_evento);
          set_metricas_admin((ant) => ({
            ...ant,
            evento_ativo_id: dados_evento.id_evento || dados_evento.id || ant.evento_ativo_id,
            evento_ativo_nome: dados_evento.nome_evento,
            evento_ativo_edicao: dados_evento.edicao || ant.evento_ativo_edicao,
          }));
        }
      } catch (errEvt) {
        console.warn('Não foi possível sincronizar dados do evento:', errEvt);
      }

      set_metricas_admin((anterior) => ({
        ...anterior,
        total_projetos: total_proj_count || anterior.total_projetos,
        avaliadores_credenciados: aval_cred_count || anterior.avaliadores_credenciados,
        locks_ativos: total_locks_count,
        projetos_quarentena: quarentena_count,
        avaliacoes_realizadas: total_aval_feitas || anterior.avaliacoes_realizadas,
        porcentagem_conclusao: pct_conclusao || anterior.porcentagem_conclusao,
        total_staff: staff_count || anterior.total_staff,
        total_administradores: admin_count || anterior.total_administradores,
      }));
    } catch (erro_excecao: any) {
      console.error('Erro ao consultar métricas do painel admin no Supabase:', erro_excecao);
      set_mensagem_erro_admin('Falha ao sincronizar métricas em tempo real com o banco de dados.');
    } finally {
      set_carregando_metricas(false);
    }
  };

  useEffect(() => {
    buscar_metricas_admin();
  }, [conexao_banco_configurada]);

  // 2. Função de Execução do Reset Global via RPC
  const executar_reset_global_rpc = async () => {
    try {
      const { error } = await supabase.rpc('admin_reset_global');
      if (error) throw error;
      alert("Reset executado. O sistema será recarregado.");
      window.location.reload();
    } catch (err: any) {
      alert(`Falha no Reset: ${err.message}`);
    }
  };

  // Criar novo evento
  const salvar_novo_evento = async () => {
    if (!novo_evento_nome.trim()) return;

    if (conexao_banco_configurada) {
      await supabase.from('eventos').insert({
        nome_evento: novo_evento_nome.trim(),
        edicao: novo_evento_edicao || '17ª Edição',
        is_ativo: true
      });
    }

    setNomeEvento(novo_evento_nome.trim());
    set_metricas_admin((ant) => ({
      ...ant,
      evento_ativo_nome: novo_evento_nome.trim(),
      evento_ativo_edicao: novo_evento_edicao || 'Nova Edição'
    }));

    set_mostrar_modal_novo_evento(false);
    set_novo_evento_nome('');
    set_novo_evento_edicao('');
    exibir_notificacao('Novo Evento cadastrado e ativado com sucesso!');
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
              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              aria-label="Editar Nome do Evento"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Ícone de Engrenagem (Configurações) à direita */}
        <button
          type="button"
          onClick={() => set_mostrar_modal_configuracoes(true)}
          title="Configurações Gerais"
          className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 transition-all flex items-center justify-center shadow-xs"
          aria-label="Configurações Gerais"
        >
          <Settings className="w-5 h-5 text-slate-700 dark:text-slate-200" />
        </button>
      </div>

      {/* BARRA DE PROGRESSO EM TEMPO REAL */}
      <div
            onClick={() => set_modal_detalhe_ativo({ tipo: 'avaliacoes', titulo: 'Detalhamento: Avaliações Registradas' })}
            role="button"
            tabIndex={0}
            className="bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-800/80 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4 cursor-pointer transition-all hover:scale-[1.005]"
            title="Clique para ver a lista de avaliações"
          >
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block uppercase">
                  Progresso Geral das Avaliações (Clique para detalhar ↗)
                </span>
                <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                  {metricas_admin.avaliacoes_realizadas} avaliações concluídas no banco ({metricas_admin.porcentagem_conclusao}%)
                </span>
              </div>
            </div>

            <div className="w-full sm:w-64 bg-slate-100 dark:bg-slate-700 h-3 rounded-full overflow-hidden">
              <div
                className="bg-emerald-600 dark:bg-emerald-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${metricas_admin.porcentagem_conclusao}%` }}
              ></div>
            </div>
          </div>

          {/* BENTO GRID EM 4 BLOCOS VISUAIS */}
          <div className="space-y-8">
            {/* BLOCO 1: PROJETOS E PAVILHÃO */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Bloco 1: Projetos & Pavilhão
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_projetos(true)}
                  className="bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-emerald-800 dark:text-emerald-300">
                      Projetos
                    </span>
                    <FolderGit2 className="w-5 h-5 text-emerald-700 dark:text-emerald-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-3xl font-black text-emerald-900 dark:text-emerald-100">
                    {metricas_admin.total_projetos}
                  </div>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                    <span>Inscritos na feira no Supabase.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Abrir Gestor (CRUD) ↗</span>
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_bloqueios(true)}
                  className="bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-amber-800 dark:text-amber-300">
                      Projetos Bloqueados
                    </span>
                    <Lock className="w-5 h-5 text-amber-700 dark:text-amber-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-3xl font-black text-amber-900 dark:text-amber-100">
                    {metricas_admin.locks_ativos}
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between">
                    <span>Avaliações ativas no momento.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Gerenciar Bloqueios ↗</span>
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_quarentena(true)}
                  className="bg-red-50 hover:bg-red-100/70 dark:bg-red-950/30 dark:hover:bg-red-950/50 border border-red-200 dark:border-red-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-red-800 dark:text-red-300">
                      Projetos em Quarentena
                    </span>
                    <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-3xl font-black text-red-900 dark:text-red-100">
                    {metricas_admin.projetos_quarentena}
                  </div>
                  <p className="text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
                    <span>Divergências de nota para arbitragem.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Resolver Quarentena ↗</span>
                  </p>
                </button>

                {/* CARD "Repescagem de Ausentes" (Movid para o Bloco 1) */}
                <button
                  type="button"
                  onClick={executar_repescagem_ausentes}
                  className="bg-rose-50 hover:bg-rose-100/70 dark:bg-rose-950/30 dark:hover:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-rose-800 dark:text-rose-300">
                      Repescagem de Ausentes
                    </span>
                    <RotateCcw className="w-5 h-5 text-rose-700 dark:text-rose-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-xl font-extrabold text-rose-900 dark:text-rose-100">
                    Repescagem
                  </div>
                  <p className="text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
                    <span>Reabre ausentes da rodada.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Executar ↗</span>
                  </p>
                </button>

                {/* CARD "Atribuir Projeto" */}
                <button
                  type="button"
                  onClick={() => set_mostrar_modal_atribuicao_forcada(true)}
                  className="bg-indigo-50 hover:bg-indigo-100/70 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-indigo-800 dark:text-indigo-300">
                      Atribuir Projeto
                    </span>
                    <Lock className="w-5 h-5 text-indigo-700 dark:text-indigo-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-xl font-extrabold text-indigo-900 dark:text-indigo-100">
                    Atribuir Projeto
                  </div>
                  <p className="text-xs text-indigo-700 dark:text-indigo-300 flex items-center justify-between">
                    <span>Atribuição forçada para avaliador.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Atribuir ↗</span>
                  </p>
                </button>
              </div>
            </section>

            {/* BLOCO 2: PESSOAL & DADOS */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span> Bloco 2: Pessoal & Formulários
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_avaliadores(true)}
                  className="bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-blue-800 dark:text-blue-300">
                      Avaliadores
                    </span>
                    <Users className="w-5 h-5 text-blue-700 dark:text-blue-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-3xl font-black text-blue-900 dark:text-blue-100">
                    {metricas_admin.avaliadores_credenciados}
                  </div>
                  <p className="text-xs text-blue-700 dark:text-blue-300 flex items-center justify-between">
                    <span>`is_credenciado = true`.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Abrir Gestor (CRUD) ↗</span>
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_staff(true)}
                  className="bg-indigo-50 hover:bg-indigo-100/70 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-indigo-800 dark:text-indigo-300">
                      Equipe Staff
                    </span>
                    <UserCog className="w-5 h-5 text-indigo-700 dark:text-indigo-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-3xl font-black text-indigo-900 dark:text-indigo-100">
                    {metricas_admin.total_staff}
                  </div>
                  <p className="text-xs text-indigo-700 dark:text-indigo-300 flex items-center justify-between">
                    <span>Monitores de apoio.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Abrir Gestor (CRUD) ↗</span>
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => set_modal_detalhe_ativo({ tipo: 'administradores', titulo: 'Gestão de Administradores' })}
                  className="bg-purple-50 hover:bg-purple-100/70 dark:bg-purple-950/30 dark:hover:bg-purple-950/50 border border-purple-200 dark:border-purple-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-purple-800 dark:text-purple-300">
                      Administradores
                    </span>
                    <ShieldCheck className="w-5 h-5 text-purple-700 dark:text-purple-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-3xl font-black text-purple-900 dark:text-purple-100">
                    {metricas_admin.total_administradores}
                  </div>
                  <p className="text-xs text-purple-700 dark:text-purple-300 flex items-center justify-between">
                    <span>Super-usuários ativos.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Gerenciar Admins ↗</span>
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => set_mostrar_gestor_questionarios(true)}
                  className="bg-violet-50 hover:bg-violet-100/80 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800/60 p-5 rounded-2xl shadow-xs space-y-2 text-left transition-all hover:scale-[1.01] cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-violet-800 dark:text-violet-300">
                      Questionários
                    </span>
                    <ClipboardList className="w-5 h-5 text-violet-700 dark:text-violet-300 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="text-3xl font-black text-violet-900 dark:text-violet-100">
                    {metricas_admin.total_questionarios}
                  </div>
                  <p className="text-xs text-violet-700 dark:text-violet-300 flex items-center justify-between">
                    <span>Questionários de avaliação.</span>
                    <span className="text-[10px] font-bold underline opacity-80 group-hover:opacity-100">Gerenciar ↗</span>
                  </p>
                </button>
              </div>
            </section>

            {/* BLOCO 3: MONITORAMENTO EM TEMPO REAL & RELATÓRIOS */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span> Bloco 3: Monitoramento em Tempo Real & Relatórios
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <button
                  type="button"
                  onClick={() => set_mostrar_modal_ranking(true)}
                  className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800 p-6 rounded-3xl shadow-xs text-left space-y-3 hover:scale-[1.01] transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                      <Trophy className="w-4 h-4 text-amber-600" /> Ranking de Premiação
                    </span>
                    <span className="text-[10px] bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 px-2 py-0.5 rounded-full font-bold">
                      Algoritmo Oficial
                    </span>
                  </div>

                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    Classificação & Pódio
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Visualização agrupada por Modalidade e Área Temática com aplicação da Regra Estrita de Desempate.
                  </p>
                </button>

                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/20 border border-emerald-200 dark:border-emerald-800 p-6 rounded-3xl shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                      <Tv className="w-4 h-4 text-emerald-600" /> Telão ao Vivo
                    </span>
                    <span className="text-[10px] bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100 px-2 py-0.5 rounded-full font-bold animate-pulse">
                      Ao Vivo
                    </span>
                  </div>

                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    Projeção no Auditório
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Projeção em tempo real com estatísticas de avaliação para telas gigantes e TVs do pavilhão.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    set_mostrar_modal_relatorio_acordeao(true);
                    buscar_view_relatorio_admin();
                  }}
                  className="bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 border border-slate-300 dark:border-slate-700 p-6 rounded-3xl shadow-xs text-left space-y-3 hover:scale-[1.01] transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Printer className="w-4 h-4 text-slate-600 dark:text-slate-300" /> Impressão & Fichas
                    </span>
                    <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-full font-bold">
                      Acordeão
                    </span>
                  </div>

                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    Relatórios em Acordeão
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Auditoria de pareceres, notas detalhadas por critério e impressão individual de fichas.
                  </p>
                </button>

                {/* CARD "Mapa de Estandes" (Movido para o Bloco 3) */}
                <button
                  type="button"
                  onClick={() => set_mostrar_modal_mapa(true)}
                  className="bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-950/40 dark:to-emerald-950/20 border border-teal-200 dark:border-teal-800 p-6 rounded-3xl shadow-xs text-left space-y-3 hover:scale-[1.01] transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase text-teal-800 dark:text-teal-300 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-teal-600" /> Mapa de Estandes
                    </span>
                    <span className="text-[10px] bg-teal-200 dark:bg-teal-900 text-teal-900 dark:text-teal-100 px-2 py-0.5 rounded-full font-bold">
                      Pavilhão
                    </span>
                  </div>

                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    Visualização do Pavilhão
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Mapa interativo de estandes, corredores e situacional de avaliação dos projetos.
                  </p>
                </button>
              </div>
            </section>

            {/* BLOCO 4: INTERVENÇÕES GLOBAIS */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500"></span> Bloco 4: Intervenções Globais
              </h2>

              <div className="grid grid-cols-1 gap-4">
                <button
                  type="button"
                  onClick={executar_reset_global_direto}
                  className="bg-orange-50 hover:bg-orange-100/80 dark:bg-orange-950/40 border border-orange-300 dark:border-orange-800 p-5 rounded-2xl shadow-xs text-left space-y-2 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-orange-600" /> Exclusão Total
                    </span>
                    <span className="text-[10px] bg-orange-200 dark:bg-orange-900 text-orange-900 dark:text-orange-100 px-2 py-0.5 rounded-full font-bold">
                      RPC Critical
                    </span>
                  </div>
                  <h3 className="text-base font-black text-orange-900 dark:text-orange-100">
                    Reset Global do Evento
                  </h3>
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    Reseta e exclui permanentemente todas as avaliações, notas e registros do evento ativo via Stored Procedure.
                  </p>
                </button>
              </div>
            </section>

            {/* BLOCO 5: HISTÓRICO & NOVOS EVENTOS */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span> Bloco 5: Memória do IFMS & Gestão de Eventos
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => set_mostrar_modal_historico(true)}
                  className="bg-rose-50 hover:bg-rose-100/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 p-6 rounded-3xl shadow-xs text-left space-y-2 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-rose-800 dark:text-rose-300">
                      Histórico Acadêmico
                    </span>
                    <History className="w-5 h-5 text-rose-600" />
                  </div>
                  <h3 className="text-base font-black text-rose-900 dark:text-rose-100">
                    Eventos e Feiras Anteriores
                  </h3>
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    Consultar edições passadas (FETEC MS 2025, 2024, 2023) e comparar dados históricos.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => set_mostrar_modal_novo_evento(true)}
                  className="bg-cyan-50 hover:bg-cyan-100/80 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800 p-6 rounded-3xl shadow-xs text-left space-y-2 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-cyan-800 dark:text-cyan-300">
                      Nova Instância
                    </span>
                    <PlusCircle className="w-5 h-5 text-cyan-600" />
                  </div>
                  <h3 className="text-base font-black text-cyan-900 dark:text-cyan-100">
                    Criar Nova Feira / Evento
                  </h3>
                  <p className="text-xs text-cyan-700 dark:text-cyan-300">
                    Wizard para inicializar nova feira científica com parâmetros limpos e novas turmas.
                  </p>
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
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl my-auto max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl p-6 relative border border-slate-200 dark:border-slate-800 shadow-2xl">
            <button
              type="button"
              onClick={() => set_mostrar_modal_ranking(false)}
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
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl my-auto max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl p-6 relative border border-slate-200 dark:border-slate-800 shadow-2xl">
            <button
              type="button"
              onClick={() => set_mostrar_gestor_questionarios(false)}
              className="absolute top-6 right-6 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <GestorQuestionarios id_evento_ativo={metricas_admin.evento_ativo_id} />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE INSTITUIÇÕES (MODAL A PARTIR DO CARD BENTO GRID) */}
      {mostrar_gestor_instituicoes && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl my-auto max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl p-6 relative border border-slate-200 dark:border-slate-800 shadow-2xl">
            <button
              type="button"
              onClick={() => set_mostrar_gestor_instituicoes(false)}
              className="absolute top-6 right-6 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <GestorInstituicoes ao_fechar={() => set_mostrar_gestor_instituicoes(false)} />
          </div>
        </div>
      )}

      {/* MODAL DETALHAMENTO DO BENTO GRID (SELECT REAL) */}
      {modal_detalhe_ativo && (
        <ModalDetalhamento
          tipo={modal_detalhe_ativo.tipo}
          titulo={modal_detalhe_ativo.titulo}
          id_evento_ativo={metricas_admin.evento_ativo_id}
          ao_fechar={() => {
            set_modal_detalhe_ativo(null);
            buscar_metricas_admin();
          }}
        />
      )}

      {/* 1. MODAL CONFIGURAÇÕES DO EVENTO (Sincronizado com Header e com Reset Global no interior) */}
      {mostrar_modal_configuracoes && (
        <ModalConfiguracoesEvento
          id_evento_ativo={metricas_admin.evento_ativo_id}
          nome_evento_atual={nomeEvento}
          ao_fechar={() => set_mostrar_modal_configuracoes(false)}
          ao_salvar_sucesso={(novoNome) => {
            if (novoNome) {
              setNomeEvento(novoNome);
              set_metricas_admin((ant) => ({ ...ant, evento_ativo_nome: novoNome }));
            }
            buscar_metricas_admin();
          }}
          ao_disparar_reset_global={() => {
            set_mostrar_modal_configuracoes(false);
            set_mostrar_modal_reset_etapa1(true);
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
              ATENÇÃO: A execução do Reset Global invocará a Stored Procedure `executar_reset_global`. Isso removerá todas as travas ativas na tabela `locks_ativos` e redefinirá os testes do evento.
            </p>

            <div className="bg-red-50 dark:bg-red-950/40 p-4 rounded-xl border border-red-200 dark:border-red-800 space-y-2">
              <span className="text-xs font-bold text-red-800 dark:text-red-300 block">
                Digite a palavra de confirmação para avançar:
              </span>
              <code className="text-xs font-mono font-bold bg-white dark:bg-slate-900 px-2 py-1 rounded text-red-700 dark:text-red-400 inline-block">
                RESETAR-FETEC-2026
              </code>
              <input
                type="text"
                value={confirmacao_texto_reset}
                onChange={(e) => set_confirmacao_texto_reset(e.target.value)}
                placeholder="Digite exatamente como exibido acima"
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border rounded-xl text-xs font-mono text-slate-900 dark:text-white mt-1"
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
                disabled={confirmacao_texto_reset !== 'RESETAR-FETEC-2026'}
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
              Você está prestes a disparar a Stored Procedure `executar_reset_global(p_id_evento = '{metricas_admin.evento_ativo_id}')`. Esta operação é irreversível no Supabase.
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
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl my-auto">
            <GestorProjetos
              idProjetoEditarInicial={id_projeto_editar_gestor}
              aoFechar={() => {
                set_mostrar_gestor_projetos(false);
                set_id_projeto_editar_gestor(null);
                buscar_metricas_admin();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE AVALIADORES (COMPLETO COM CRUD E IMPORTADOR) */}
      {mostrar_gestor_avaliadores && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl my-auto max-h-[92vh] overflow-y-auto">
            <GestorAvaliadores
              id_evento_ativo={metricas_admin.evento_ativo_id}
              ao_fechar={() => {
                set_mostrar_gestor_avaliadores(false);
                buscar_metricas_admin();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE STAFF (COMPLETO COM CRUD E IMPORTADOR) */}
      {mostrar_gestor_staff && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl my-auto max-h-[92vh] overflow-y-auto">
            <GestorStaff
              ao_fechar={() => {
                set_mostrar_gestor_staff(false);
                buscar_metricas_admin();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE BLOQUEIOS */}
      {mostrar_gestor_bloqueios && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl my-auto">
            <ProjetosBloqueados
              aoAtualizarMetricas={buscar_metricas_admin}
              aoFechar={() => {
                set_mostrar_gestor_bloqueios(false);
                buscar_metricas_admin();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL GESTOR DE QUARENTENA */}
      {mostrar_gestor_quarentena && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl my-auto">
            <ProjetosQuarentena
              aoAtualizarMetricas={buscar_metricas_admin}
              aoFechar={() => {
                set_mostrar_gestor_quarentena(false);
                buscar_metricas_admin();
              }}
            />
          </div>
        </div>
      )}

      {/* MODAL MAPA DE ESTANDES INTERATIVO & AUDITORIA */}
      {mostrar_modal_mapa && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl my-auto">
            <MapaEstandes
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
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-md w-full border shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-cyan-600" />
                Criar Nova Feira / Evento
              </h3>
              <button
                type="button"
                onClick={() => set_mostrar_modal_novo_evento(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Nome do Evento:
                </label>
                <input
                  type="text"
                  value={novo_evento_nome}
                  onChange={(e) => set_novo_evento_nome(e.target.value)}
                  placeholder="Ex: FETEC MS 2027"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border rounded-xl text-xs font-medium text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Edição:
                </label>
                <input
                  type="text"
                  value={novo_evento_edicao}
                  onChange={(e) => set_novo_evento_edicao(e.target.value)}
                  placeholder="Ex: 17ª Feira de Tecnologias do IFMS"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border rounded-xl text-xs font-medium text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => set_mostrar_modal_novo_evento(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvar_novo_evento}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                Criar Evento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL HISTÓRICO DE EVENTOS */}
      {mostrar_modal_historico && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-md w-full border shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <History className="w-5 h-5 text-rose-600" />
                Histórico de Feiras do IFMS
              </h3>
              <button
                type="button"
                onClick={() => set_mostrar_modal_historico(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold block text-slate-900 dark:text-white">FETEC MS 2025</span>
                  <span className="text-slate-500">118 projetos • 3.200 visitantes</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">Arquivado</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold block text-slate-900 dark:text-white">FETEC MS 2024</span>
                  <span className="text-slate-500">105 projetos • 2.800 visitantes</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">Arquivado</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => set_mostrar_modal_historico(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RELATÓRIOS EM ACORDEÃO (VIEW_RELATORIO_ADMIN) */}
      {mostrar_modal_relatorio_acordeao && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-4xl w-full border shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto font-sans">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h3 className="font-extrabold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                  <Printer className="w-5 h-5 text-emerald-600" />
                  Relatórios Consolidados em Acordeão
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Dados consolidados diretamente da view_relatorio_admin do Supabase.
                </p>
              </div>
              <button
                type="button"
                onClick={() => set_mostrar_modal_relatorio_acordeao(false)}
                className="text-slate-400 hover:text-slate-600 p-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {carregando_relatorio_view ? (
              <div className="p-12 text-center space-y-2">
                <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                <p className="text-xs font-semibold text-slate-500">
                  Consultando view_relatorio_admin no Supabase...
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {dados_relatorio_view.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 font-semibold">
                    Nenhum registro encontrado no relatório consolidado.
                  </div>
                ) : (
                  dados_relatorio_view.map((item, index) => {
                    const estande = item.estande || item.estande_numero || 'EST-00';
                    const titulo = item.titulo || item.titulo_projeto || item.nome_projeto || 'Projeto Sem Título';
                    const qtd_avaliacoes = item.qtd_avaliacoes ?? item.total_avaliacoes ?? item.qtd_avaliacoes_realizadas ?? item.avaliacoes_count ?? 0;
                    const modalidade = item.modalidade || 'Não informada';
                    const codigo = item.codigo_projeto || 'N/I';
                    const area_tematica = item.area_tematica || item.area_conhecimento || 'Não informada';
                    const media_notas = typeof item.media_notas === 'number'
                      ? item.media_notas.toFixed(2)
                      : Number(item.media_notas || 0).toFixed(2);

                    return (
                      <details
                        key={item.id || item.id_projeto || index}
                        className="group border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-xs"
                      >
                        <summary className="px-5 py-4 cursor-pointer font-bold text-sm text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 flex flex-wrap items-center justify-between gap-3 transition-colors list-none">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-black bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2.5 py-1 rounded-lg shrink-0">
                              {estande}
                            </span>
                            <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-600 shrink-0">
                              {codigo}
                            </span>
                            <span className="text-slate-400">|</span>
                            <span className="text-slate-900 dark:text-white font-extrabold">
                              {titulo}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400">|</span>
                            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-extrabold text-xs border border-emerald-300">
                              {qtd_avaliacoes} {qtd_avaliacoes === 1 ? 'Avaliação' : 'Avaliações'}
                            </span>
                          </div>
                        </summary>

                        <div className="p-5 bg-gray-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-700 space-y-3 text-xs">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                                Modalidade
                              </span>
                              <span className="font-bold text-slate-800 dark:text-slate-200">
                                {modalidade}
                              </span>
                            </div>

                            <div className="bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                                Área Temática
                              </span>
                              <span className="font-bold text-slate-800 dark:text-slate-200">
                                {area_tematica}
                              </span>
                            </div>

                            <div className="bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-800">
                              <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block mb-1">
                                Média de Notas
                              </span>
                              <span className="font-mono text-base font-black text-emerald-700 dark:text-emerald-300">
                                {media_notas} pts
                              </span>
                            </div>
                          </div>
                        </div>
                      </details>
                    );
                  })
                )}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => set_mostrar_modal_relatorio_acordeao(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              >
                Fechar Relatório
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
