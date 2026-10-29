import React, { useState, useEffect } from 'react';
import { aoRetomarApp } from '@/lib/keepAliveSessao';
import {
  Trophy,
  Activity,
  CheckCircle2,
  FolderGit2,
  Users,
  Flame,
  Award,
  Sparkles,
  RefreshCw,
  PieChart
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';

interface MetricsTelaoState {
  total_projetos: number;
  avaliadores_credenciados: number;
  avaliacoes_em_andamento: number;
  avaliacoes_realizadas: number;
  meta_global: number;
  cota_padrao: number;
  porcentagem_conclusao: number;
  porcentagem_concluidas: number;
  porcentagem_em_andamento: number;
  porcentagem_fila: number;
  porcentagem_quarentena: number;
  tempo_decorrido_horas: number;
  tempo_decorrido_minutos: number;
}

// Estado inicial zerado: o Telão é público e não deve projetar números de exemplo.
const metricas_telao_iniciais_fallback: MetricsTelaoState = {
  total_projetos: 0,
  avaliadores_credenciados: 0,
  avaliacoes_em_andamento: 0,
  avaliacoes_realizadas: 0,
  cota_padrao: 3,
  meta_global: 0,
  porcentagem_conclusao: 0,
  porcentagem_concluidas: 0,
  porcentagem_em_andamento: 0,
  porcentagem_fila: 0,
  porcentagem_quarentena: 0,
  tempo_decorrido_horas: 0,
  tempo_decorrido_minutos: 0,
};

export const TelaoAoVivo: React.FC = () => {
  const [metricas_telao, set_metricas_telao] = useState<MetricsTelaoState>(metricas_telao_iniciais_fallback);
  const [carregando_telao, set_carregando_telao] = useState<boolean>(false);

  const conexao_banco_configurada = verificar_conexao_configurada();

  // 1. Função de busca agregada no Supabase
  const buscar_dados_telao = async () => {
    set_carregando_telao(true);

    if (!conexao_banco_configurada) {
      set_carregando_telao(false);
      return;
    }

    try {
      // A) Total de Projetos cadastrados
      // Só agregados, sem nomes nem notas (fn_telao_resumo): o Telão é público
      const { data: resumo, error: erro_resumo } = await supabase.rpc('fn_telao_resumo', {
        p_id_evento: localStorage.getItem('evento_ativo_id') || null,
      });
      if (erro_resumo) throw erro_resumo;

      const total_proj = Number(resumo?.total_projetos) || 0;
      const aval_cred = Number(resumo?.avaliadores_credenciados) || 0;
      const em_andamento_cnt = Number(resumo?.avaliacoes_em_andamento) || 0;
      const realizadas_cnt = Number(resumo?.avaliacoes_realizadas) || 0;
      const cota_padrao = Number(resumo?.cota_padrao) || 3;

      const meta_global_calculada = (total_proj || 1) * cota_padrao;

      // Cálculos dinâmicos com proteção contra NaN e divisão por zero
      const pct_conclusao_calculado = meta_global_calculada > 0
        ? Math.min(100, Number(((realizadas_cnt / meta_global_calculada) * 100).toFixed(1)))
        : 0;

      const pct_concluidas = meta_global_calculada > 0
        ? Number(((realizadas_cnt / meta_global_calculada) * 100).toFixed(1))
        : 0;

      const pct_em_andamento = meta_global_calculada > 0
        ? Number(((em_andamento_cnt / meta_global_calculada) * 100).toFixed(1))
        : 0;

      const fila_cnt = Math.max(0, meta_global_calculada - realizadas_cnt - em_andamento_cnt);
      const pct_fila = meta_global_calculada > 0
        ? Number(((fila_cnt / meta_global_calculada) * 100).toFixed(1))
        : 0;

      set_metricas_telao((anterior) => ({
        ...anterior,
        total_projetos: total_proj,
        avaliadores_credenciados: aval_cred,
        avaliacoes_em_andamento: em_andamento_cnt,
        avaliacoes_realizadas: realizadas_cnt,
        cota_padrao,
        meta_global: meta_global_calculada,
        porcentagem_conclusao: pct_conclusao_calculado,
        porcentagem_concluidas: pct_concluidas || 0,
        porcentagem_em_andamento: pct_em_andamento || 0,
        porcentagem_fila: pct_fila || 0,
      }));
    } catch (erro_excecao) {
      console.error('Erro ao atualizar dados do telão no Supabase:', erro_excecao);
    } finally {
      set_carregando_telao(false);
    }
  };

  // 2. Polling automático a cada 10 segundos + Cronômetro do evento
  useEffect(() => {
    buscar_dados_telao();

    // Polling a cada 10 segundos no Supabase
    const intervalo_polling = setInterval(() => {
      buscar_dados_telao();
    }, 10000);

    // Telão que ficou em segundo plano ou sem rede: atualiza na hora em que volta
    const parar_retomada = aoRetomarApp(buscar_dados_telao);

    // Cronômetro simples do tempo decorrido
    const intervalo_cronometro = setInterval(() => {
      set_metricas_telao((anterior) => {
        let novos_minutos = anterior.tempo_decorrido_minutos + 1;
        let novas_horas = anterior.tempo_decorrido_horas;

        if (novos_minutos >= 60) {
          novos_minutos = 0;
          novas_horas += 1;
        }

        return {
          ...anterior,
          tempo_decorrido_horas: novas_horas,
          tempo_decorrido_minutos: novos_minutos,
        };
      });
    }, 60000);

    return () => {
      clearInterval(intervalo_polling);
      clearInterval(intervalo_cronometro);
      parar_retomada();
    };
  }, [conexao_banco_configurada]);

  const horas_formatadas = String(metricas_telao.tempo_decorrido_horas || 0).padStart(2, '0');
  const minutos_formatados = String(metricas_telao.tempo_decorrido_minutos || 0).padStart(2, '0');

  return (
    <main className="w-full min-h-[calc(100vh-5rem)] bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-6 lg:p-10 flex flex-col justify-between space-y-8 select-none font-sans">
      {/* CABEÇALHO DIVIDIDO */}
      <header className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-md border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-800 text-white flex items-center justify-center font-extrabold text-2xl shadow-lg shrink-0">
            IF
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                Polling Ativo (10s)
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                IFMS Câmpus Campo Grande
              </span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-black text-slate-900 dark:text-white tracking-tight leading-tight mt-0.5">
              FETEC MS 2026 — Feira de Tecnologias do IFMS
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-slate-100 dark:bg-slate-900/80 px-6 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 shrink-0">
          <div className="text-right">
            <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center justify-end gap-1 uppercase tracking-wider">
              <Trophy className="w-4 h-4" /> 🏆 MONITORAMENTO AO VIVO
            </span>
            <span className="text-sm font-bold text-slate-600 dark:text-slate-300 block">
              Tempo Decorrido: <strong className="font-mono text-slate-900 dark:text-white">{horas_formatadas}h {minutos_formatados}min</strong>
            </span>
          </div>
          <div className="w-3 h-3 rounded-full bg-emerald-500 animate-ping shrink-0"></div>
        </div>
      </header>

      {/* 5 CARDS GRANDES DE KPIS CONECTADOS */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 lg:gap-6">
        {/* Total de Projetos */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Total de Projetos</span>
            <FolderGit2 className="w-6 h-6 text-slate-600 dark:text-slate-300" />
          </div>
          <div className="text-4xl lg:text-5xl font-black text-slate-900 dark:text-white tracking-tight">
            {metricas_telao.total_projetos || 0}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Expositores inscritos</span>
        </div>

        {/* Avaliadores Credenciados */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Avaliadores</span>
            <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-4xl lg:text-5xl font-black text-slate-900 dark:text-white tracking-tight">
            {metricas_telao.avaliadores_credenciados || 0}
          </div>
          <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">Credenciados liberados</span>
        </div>

        {/* Avaliações em Andamento (locks_ativos) */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-3 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
            <span className="text-xs font-bold uppercase tracking-wider">Em Andamento</span>
            <Activity className="w-6 h-6 animate-pulse" />
          </div>
          <div className="text-4xl lg:text-5xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
            {metricas_telao.avaliacoes_em_andamento || 0}
          </div>
          <span className="text-xs text-amber-700 dark:text-amber-300 font-semibold">Travas ativas (locks)</span>
        </div>

        {/* Avaliações Realizadas */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-3 border-l-4 border-l-emerald-600">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-xs font-bold uppercase tracking-wider">Realizadas</span>
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div className="text-4xl lg:text-5xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
            {metricas_telao.avaliacoes_realizadas || 0}
          </div>
          <span className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">Fichas salvas</span>
        </div>

        {/* Meta Global */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-800 text-white rounded-3xl p-6 shadow-md flex flex-col justify-between space-y-3 border border-emerald-500/40">
          <div className="flex items-center justify-between text-emerald-200">
            <span className="text-xs font-bold uppercase tracking-wider">Meta Global</span>
            <Award className="w-6 h-6 text-white" />
          </div>
          <div className="text-4xl lg:text-5xl font-black text-white tracking-tight">
            {metricas_telao.meta_global || 0}
          </div>
          <span className="text-xs text-emerald-100 font-medium">Projetos x {metricas_telao.cota_padrao} avaliações</span>
        </div>
      </section>

      {/* PAINEL CENTRAL: GRÁFICO E DISTRIBUIÇÃO PERCENTUAL DINÂMICA DO STATUS */}
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg lg:text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <PieChart className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Distribuição Percentual do Status da Avaliação
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Cálculo em tempo real baseado no total de metas e travas ativas do Supabase.
            </p>
          </div>

          <button
            type="button"
            onClick={buscar_dados_telao}
            className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-bold border border-emerald-200 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando_telao ? 'animate-spin' : ''}`} />
            Sincronizar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Concluídas */}
          <div className="bg-emerald-50 dark:bg-emerald-950/30 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 text-center space-y-1">
            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 block uppercase">
              Concluídas
            </span>
            <span className="text-3xl font-black text-emerald-900 dark:text-emerald-100">
              {metricas_telao.porcentagem_concluidas || 0}%
            </span>
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block font-semibold">
              {metricas_telao.avaliacoes_realizadas || 0} Avaliações Salvas
            </span>
          </div>

          {/* Em Andamento */}
          <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-2xl border border-amber-200 dark:border-amber-800/60 text-center space-y-1">
            <span className="text-xs font-bold text-amber-800 dark:text-amber-300 block uppercase">
              Em Andamento
            </span>
            <span className="text-3xl font-black text-amber-900 dark:text-amber-100">
              {metricas_telao.porcentagem_em_andamento || 0}%
            </span>
            <span className="text-[11px] text-amber-700 dark:text-amber-400 block font-semibold">
              {metricas_telao.avaliacoes_em_andamento || 0} Locks em Execução
            </span>
          </div>

          {/* Fila / Aguardando */}
          <div className="bg-slate-100 dark:bg-slate-700/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-600 text-center space-y-1">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block uppercase">
              Fila / Aguardando
            </span>
            <span className="text-3xl font-black text-slate-800 dark:text-slate-200">
              {metricas_telao.porcentagem_fila || 0}%
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-semibold">
              Projetos na Fila
            </span>
          </div>

          {/* Quarentena / Análise */}
          <div className="bg-red-50 dark:bg-red-950/30 p-4 rounded-2xl border border-red-200 dark:border-red-800/60 text-center space-y-1">
            <span className="text-xs font-bold text-red-800 dark:text-red-300 block uppercase">
              Quarentena / Análise
            </span>
            <span className="text-3xl font-black text-red-900 dark:text-red-100">
              {metricas_telao.porcentagem_quarentena || 0}%
            </span>
            <span className="text-[11px] text-red-700 dark:text-red-400 block font-semibold">
              Casos para Arbitragem
            </span>
          </div>
        </div>
      </section>

      {/* RODAPÉ: BARRA DE PROGRESSO GIGANTE */}
      <footer className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-md space-y-4">
        <div className="flex items-center justify-between text-slate-900 dark:text-white">
          <span className="text-sm lg:text-base font-black uppercase tracking-wider flex items-center gap-2">
            <Flame className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Progresso Geral da Feira (Meta Global)
          </span>
          <span className="text-2xl lg:text-3xl font-black text-emerald-600 dark:text-emerald-400">
            {metricas_telao.porcentagem_conclusao || 0}% Concluído
          </span>
        </div>

        <div className="w-full bg-slate-100 dark:bg-slate-900 h-8 rounded-2xl p-1 border border-slate-200 dark:border-slate-700 overflow-hidden shadow-inner">
          <div
            className="bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400 h-full rounded-xl transition-all duration-1000 shadow-md relative overflow-hidden"
            style={{ width: `${Math.max(0, Math.min(100, metricas_telao.porcentagem_conclusao || 0))}%` }}
          >
            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
          </div>
        </div>
      </footer>
    </main>
  );
};
