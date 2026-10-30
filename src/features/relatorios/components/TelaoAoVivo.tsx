import React, { useState, useEffect, useRef, useCallback } from 'react';
import { aoRetomarApp } from '@/lib/keepAliveSessao';
import {
  Trophy,
  Activity,
  CheckCircle2,
  FolderGit2,
  Users,
  Flame,
  Award,
  RefreshCw,
  PieChart,
  WifiOff
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';

/** Resumo público do evento ativo (fn_telao_resumo): só agregados, sem nomes, títulos ou notas. */
interface ResumoTelao {
  nome_evento: string | null;
  edicao: string | null;
  data_evento: string | null;
  horario_inicio: string | null;
  total_projetos: number;
  projetos_presentes: number;
  avaliadores_credenciados: number;
  avaliacoes_em_andamento: number;
  avaliacoes_realizadas: number;
  meta_global: number;
  avaliacoes_na_meta: number;
  projetos_quarentena: number;
  cota_padrao: number;
}

// Estado inicial zerado: o Telão é público e não deve projetar números de exemplo.
const RESUMO_VAZIO: ResumoTelao = {
  nome_evento: null,
  edicao: null,
  data_evento: null,
  horario_inicio: null,
  total_projetos: 0,
  projetos_presentes: 0,
  avaliadores_credenciados: 0,
  avaliacoes_em_andamento: 0,
  avaliacoes_realizadas: 0,
  meta_global: 0,
  avaliacoes_na_meta: 0,
  projetos_quarentena: 0,
  cota_padrao: 3,
};

const INTERVALO_ATUALIZACAO_MS = 10_000;

const porcentagem = (parte: number, total: number) => (total > 0 ? Math.min(100, Number(((parte / total) * 100).toFixed(1))) : 0);

const horaCurta = (data: Date) => data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Início do evento no horário local do telão (data + horário de início configurados no evento). */
export const inicioDoEvento = (data: string | null, horario: string | null): Date | null => {
  if (!data || !horario) return null;
  const inicio = new Date(`${data}T${horario.slice(0, 5)}:00`);
  return isNaN(inicio.getTime()) ? null : inicio;
};

export const TelaoAoVivo: React.FC = () => {
  const [resumo, set_resumo] = useState<ResumoTelao>(RESUMO_VAZIO);
  const [carregando_telao, set_carregando_telao] = useState<boolean>(false);
  const [ultima_atualizacao, set_ultima_atualizacao] = useState<Date | null>(null);
  const [sem_conexao, set_sem_conexao] = useState<boolean>(false);
  const [agora, set_agora] = useState<Date>(() => new Date());
  const buscando = useRef(false);

  const conexao_banco_configurada = verificar_conexao_configurada();

  const buscar_dados_telao = useCallback(async () => {
    if (!conexao_banco_configurada || buscando.current) return;
    buscando.current = true;
    set_carregando_telao(true);
    try {
      // Sempre o evento ativo do banco (não um id guardado neste navegador, que pode ser de outro evento)
      const { data, error } = await supabase.rpc('fn_telao_resumo', { p_id_evento: null });
      if (error) throw error;
      const r = (data || {}) as Partial<Record<keyof ResumoTelao, unknown>>;
      const numero = (v: unknown) => Number(v) || 0;
      set_resumo({
        nome_evento: (r.nome_evento as string) || null,
        edicao: (r.edicao as string) || null,
        data_evento: (r.data_evento as string) || null,
        horario_inicio: (r.horario_inicio as string) || null,
        total_projetos: numero(r.total_projetos),
        projetos_presentes: numero(r.projetos_presentes),
        avaliadores_credenciados: numero(r.avaliadores_credenciados),
        avaliacoes_em_andamento: numero(r.avaliacoes_em_andamento),
        avaliacoes_realizadas: numero(r.avaliacoes_realizadas),
        meta_global: numero(r.meta_global),
        avaliacoes_na_meta: numero(r.avaliacoes_na_meta),
        projetos_quarentena: numero(r.projetos_quarentena),
        cota_padrao: numero(r.cota_padrao) || 3,
      });
      set_ultima_atualizacao(new Date());
      set_sem_conexao(false);
    } catch (erro_excecao) {
      // Mantém os últimos números e avisa que estão desatualizados
      console.error('Erro ao atualizar dados do telão:', erro_excecao);
      set_sem_conexao(true);
    } finally {
      buscando.current = false;
      set_carregando_telao(false);
    }
  }, [conexao_banco_configurada]);

  useEffect(() => {
    buscar_dados_telao();
    const intervalo_polling = setInterval(buscar_dados_telao, INTERVALO_ATUALIZACAO_MS);
    // Telão que ficou em segundo plano ou sem rede: atualiza na hora em que volta
    const parar_retomada = aoRetomarApp(buscar_dados_telao);
    const intervalo_relogio = setInterval(() => set_agora(new Date()), 30_000);
    return () => {
      clearInterval(intervalo_polling);
      clearInterval(intervalo_relogio);
      parar_retomada();
    };
  }, [buscar_dados_telao]);

  // Distribuição da meta: concluídas (até a cota de cada projeto), em andamento e restantes
  const meta = resumo.meta_global;
  const concluidas = Math.min(resumo.avaliacoes_na_meta, meta);
  const em_andamento = Math.min(resumo.avaliacoes_em_andamento, Math.max(0, meta - concluidas));
  const restantes = Math.max(0, meta - concluidas - em_andamento);
  const pct_conclusao = porcentagem(concluidas, meta);

  const inicio = inicioDoEvento(resumo.data_evento, resumo.horario_inicio);
  const minutos_decorridos = inicio ? Math.floor((agora.getTime() - inicio.getTime()) / 60_000) : null;
  const texto_tempo =
    minutos_decorridos === null
      ? 'Início não configurado'
      : minutos_decorridos < 0
      ? `Começa às ${resumo.horario_inicio?.slice(0, 5)}`
      : `${String(Math.floor(minutos_decorridos / 60)).padStart(2, '0')}h ${String(minutos_decorridos % 60).padStart(2, '0')}min`;

  const titulo_evento = resumo.nome_evento
    ? resumo.edicao && !resumo.nome_evento.toLowerCase().includes(resumo.edicao.toLowerCase())
      ? `${resumo.nome_evento} — ${resumo.edicao}`
      : resumo.nome_evento
    : ultima_atualizacao
    ? 'Nenhum evento ativo'
    : 'Telão ao Vivo';

  return (
    <main className="w-full min-h-[calc(100vh-5rem)] bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-6 lg:p-10 flex flex-col justify-between space-y-8 select-none font-sans">
      {/* CABEÇALHO DIVIDIDO */}
      <header className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-md border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-800 text-white flex items-center justify-center font-extrabold text-2xl shadow-lg shrink-0">
            IF
          </div>
          <div>
            <div role="status" className="flex items-center gap-2">
              {sem_conexao ? (
                <span className="px-3 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 inline-flex items-center gap-1">
                  <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                  Sem conexão{ultima_atualizacao ? ` — dados de ${horaCurta(ultima_atualizacao)}` : ''}
                </span>
              ) : (
                <span className="px-3 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                  Ao vivo{ultima_atualizacao ? ` — atualizado às ${horaCurta(ultima_atualizacao)}` : ''}
                </span>
              )}
            </div>
            <h1 className="text-2xl lg:text-3xl font-black text-slate-900 dark:text-white tracking-tight leading-tight mt-0.5">
              {titulo_evento}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-slate-100 dark:bg-slate-900/80 px-6 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 shrink-0">
          <div className="text-right">
            <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center justify-end gap-1 uppercase tracking-wider">
              <Trophy className="w-4 h-4" aria-hidden="true" /> Monitoramento ao vivo
            </span>
            <span className="text-sm font-bold text-slate-600 dark:text-slate-300 block">
              Tempo decorrido: <strong className="font-mono text-slate-900 dark:text-white">{texto_tempo}</strong>
            </span>
          </div>
          <div aria-hidden="true" className={`w-3 h-3 rounded-full shrink-0 ${sem_conexao ? 'bg-red-500' : 'bg-emerald-500 animate-ping'}`}></div>
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
            {resumo.total_projetos}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{resumo.projetos_presentes} presentes na competição</span>
        </div>

        {/* Avaliadores Credenciados */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Avaliadores</span>
            <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-4xl lg:text-5xl font-black text-slate-900 dark:text-white tracking-tight">
            {resumo.avaliadores_credenciados}
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
            {resumo.avaliacoes_em_andamento}
          </div>
          <span className="text-xs text-amber-700 dark:text-amber-300 font-semibold">Avaliadores nos estandes agora</span>
        </div>

        {/* Avaliações Realizadas */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-3 border-l-4 border-l-emerald-600">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-xs font-bold uppercase tracking-wider">Realizadas</span>
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div className="text-4xl lg:text-5xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
            {resumo.avaliacoes_realizadas}
          </div>
          <span className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">Fichas enviadas</span>
        </div>

        {/* Meta Global */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-800 text-white rounded-3xl p-6 shadow-md flex flex-col justify-between space-y-3 border border-emerald-500/40">
          <div className="flex items-center justify-between text-emerald-200">
            <span className="text-xs font-bold uppercase tracking-wider">Meta Global</span>
            <Award className="w-6 h-6 text-white" />
          </div>
          <div className="text-4xl lg:text-5xl font-black text-white tracking-tight">
            {meta}
          </div>
          <span className="text-xs text-emerald-100 font-medium">Cota de cada projeto presente (padrão {resumo.cota_padrao})</span>
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
              Em relação à meta: cada projeto presente conta até a sua cota.
            </p>
          </div>

          <button
            type="button"
            onClick={buscar_dados_telao}
            disabled={carregando_telao}
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
              {porcentagem(concluidas, meta)}%
            </span>
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block font-semibold">
              {concluidas} de {meta} avaliações
            </span>
          </div>

          {/* Em Andamento */}
          <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-2xl border border-amber-200 dark:border-amber-800/60 text-center space-y-1">
            <span className="text-xs font-bold text-amber-800 dark:text-amber-300 block uppercase">
              Em Andamento
            </span>
            <span className="text-3xl font-black text-amber-900 dark:text-amber-100">
              {porcentagem(em_andamento, meta)}%
            </span>
            <span className="text-[11px] text-amber-700 dark:text-amber-400 block font-semibold">
              {resumo.avaliacoes_em_andamento} em avaliação agora
            </span>
          </div>

          {/* Fila / Aguardando */}
          <div className="bg-slate-100 dark:bg-slate-700/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-600 text-center space-y-1">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block uppercase">
              Restantes
            </span>
            <span className="text-3xl font-black text-slate-800 dark:text-slate-200">
              {porcentagem(restantes, meta)}%
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-semibold">
              {restantes} avaliações a fazer
            </span>
          </div>

          {/* Quarentena / Análise */}
          <div className="bg-red-50 dark:bg-red-950/30 p-4 rounded-2xl border border-red-200 dark:border-red-800/60 text-center space-y-1">
            <span className="text-xs font-bold text-red-800 dark:text-red-300 block uppercase">
              Quarentena / Análise
            </span>
            <span className="text-3xl font-black text-red-900 dark:text-red-100">
              {resumo.projetos_quarentena}
            </span>
            <span className="text-[11px] text-red-700 dark:text-red-400 block font-semibold">
              Projetos com notas divergentes em análise
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
            {pct_conclusao}% concluído
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Progresso geral da feira"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct_conclusao}
          className="w-full bg-slate-100 dark:bg-slate-900 h-8 rounded-2xl p-1 border border-slate-200 dark:border-slate-700 overflow-hidden shadow-inner"
        >
          <div
            className="bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400 h-full rounded-xl transition-all duration-1000 shadow-md relative overflow-hidden"
            style={{ width: `${pct_conclusao}%` }}
          >
            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
          </div>
        </div>
      </footer>
    </main>
  );
};
