import React, { useState, useEffect, useMemo } from 'react';
import {
  MapPin,
  Search,
  Filter,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  X,
  Info,
  Edit2,
  FileCheck2,
  Award
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

interface ProjetoMapItem {
  id_projeto: string;
  codigo_projeto?: string | null;
  titulo: string;
  estande: string | null;
  corredor: string | null;
  status_cor?: 'laranja' | 'verde' | 'cinza';
  tem_lock?: boolean;
  is_quarentena?: boolean;
  qtd_avaliacoes?: number;
}

interface MapaEstandesProps {
  aoSelecionarProjeto?: (projeto: any) => void;
  aoEditarProjeto?: (idProjeto: string) => void;
  aoFechar?: () => void;
}

interface AvaliacaoAudit {
  nota_final?: number | null;
  usuarios?: { nome?: string } | { nome?: string }[] | null;
}

export const MapaEstandes: React.FC<MapaEstandesProps> = ({
  aoSelecionarProjeto,
  aoEditarProjeto,
  aoFechar
}) => {
  const [projetos_map, set_projetos_map] = useState<ProjetoMapItem[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [termo_busca, set_termo_busca] = useState<string>('');
  const [filtro_status, set_filtro_status] = useState<'todos' | 'verde' | 'laranja' | 'cinza'>('todos');

  // Modal de Auditoria
  const [projeto_selecionado, set_projeto_selecionado] = useState<ProjetoMapItem | null>(null);
  const [avaliacoes_audit, set_avaliacoes_audit] = useState<AvaliacaoAudit[]>([]);
  const [carregando_audit, set_carregando_audit] = useState<boolean>(false);
  const [erro_audit, set_erro_audit] = useState<string | null>(null);

  const conexao_banco = verificar_conexao_configurada();

  // 1. O MAPA DEVE CARREGAR OS ESTANDES CONSULTANDO O BANCO
  const carregar_dados_mapa = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_projetos_map([]);
      set_carregando(false);
      return;
    }

    try {
      // Consulta das colunas reais do banco incluindo codigo_projeto
      const { data: projetosMap, error: erroProjetos } = await supabase
        .from('projetos')
        .select('id_projeto, codigo_projeto, titulo, estande, corredor')
        .order('estande', { ascending: true });

      if (erroProjetos) {
        throw erroProjetos;
      }

      if (!projetosMap || projetosMap.length === 0) {
        set_projetos_map([]);
        set_carregando(false);
        return;
      }

      // Verificação de locks_ativos e quarentenas para status visual
      let locksSet = new Set<string>();
      let quarentenaSet = new Set<string>();
      let avaliacoesContagem = new Map<string, number>();

      try {
        const [locksRes, avaliacoesRes] = await Promise.all([
          supabase.from('locks_ativos').select('id_projeto'),
          supabase.from('avaliacoes').select('id_projeto, is_quarentena')
        ]);

        if (locksRes.data) {
          locksRes.data.forEach((l: any) => {
            if (l.id_projeto) locksSet.add(l.id_projeto);
          });
        }

        if (avaliacoesRes.data) {
          avaliacoesRes.data.forEach((a: any) => {
            if (a.id_projeto) {
              if (a.is_quarentena) quarentenaSet.add(a.id_projeto);
              const atual = avaliacoesContagem.get(a.id_projeto) || 0;
              avaliacoesContagem.set(a.id_projeto, atual + 1);
            }
          });
        }
      } catch (errStatus) {
        console.warn('Aviso: status secundário de locks/quarentena não pôde ser sincronizado:', errStatus);
      }

      const processados: ProjetoMapItem[] = projetosMap.map((p) => {
        const temLock = locksSet.has(p.id_projeto);
        const temQuarentena = quarentenaSet.has(p.id_projeto);
        const qtdAval = avaliacoesContagem.get(p.id_projeto) || 0;

        let status_cor: 'laranja' | 'verde' | 'cinza' = 'cinza';
        if (temLock || temQuarentena) {
          status_cor = 'laranja';
        } else if (qtdAval > 0) {
          status_cor = 'verde';
        }

        const estandeNum = p.estande || 'EST-00';
        const corredorNome = p.corredor || extrair_corredor_pelo_estande(estandeNum);

        return {
          id_projeto: p.id_projeto,
          codigo_projeto: p.codigo_projeto || null,
          titulo: p.titulo,
          estande: estandeNum,
          corredor: corredorNome,
          status_cor,
          tem_lock: temLock,
          is_quarentena: temQuarentena,
          qtd_avaliacoes: qtdAval
        };
      });

      set_projetos_map(processados);
    } catch (err: any) {
      console.error('Erro ao consultar projetos para o mapa:', err);
      set_mensagem_erro(`Erro do Supabase ao carregar mapa: ${err?.message || err}`);
      set_projetos_map([]);
    } finally {
      set_carregando(false);
    }
  };

  const extrair_corredor_pelo_estande = (estandeStr: string): string => {
    if (!estandeStr) return 'Corredor Geral';
    const numLimpo = estandeStr.toUpperCase();
    if (numLimpo.includes('A-') || numLimpo.includes('EST-A') || numLimpo.startsWith('A')) return 'Corredor A';
    if (numLimpo.includes('B-') || numLimpo.includes('EST-B') || numLimpo.startsWith('B')) return 'Corredor B';
    if (numLimpo.includes('C-') || numLimpo.includes('EST-C') || numLimpo.startsWith('C')) return 'Corredor C';
    if (numLimpo.includes('D-') || numLimpo.includes('EST-D') || numLimpo.startsWith('D')) return 'Corredor D';
    return 'Corredor Principal';
  };

  useEffect(() => {
    carregar_dados_mapa();
  }, []);

  // 2. AO CLICAR EM UM ESTANDE: RECEBE id_projeto (UUID REAL) E BUSCA AUDITORIA
  const abrir_auditoria_estande = async (uuidReal: string, projetoItem: ProjetoMapItem) => {
    set_projeto_selecionado(projetoItem);
    if (aoSelecionarProjeto) aoSelecionarProjeto(projetoItem);

    set_carregando_audit(true);
    set_erro_audit(null);
    set_avaliacoes_audit([]);

    try {
      // Query obrigatória especificada pelo usuário com UUID real
      const { data, error } = await supabase
        .from('avaliacoes')
        .select('nota_final, usuarios(nome)')
        .eq('id_projeto', uuidReal);

      if (error) {
        console.error('Erro na auditoria de avaliações:', error);
        set_erro_audit(`Erro ao consultar avaliações: ${error.message}`);
      } else {
        set_avaliacoes_audit(data || []);
      }
    } catch (err: any) {
      console.error('Falha de auditoria no Supabase:', err);
      set_erro_audit(`Falha na consulta de avaliações: ${err?.message || err}`);
    } finally {
      set_carregando_audit(false);
    }
  };

  const lidar_editar_projeto = () => {
    if (!projeto_selecionado) return;
    const uuidReal = projeto_selecionado.id_projeto;
    set_projeto_selecionado(null);
    if (aoEditarProjeto) {
      aoEditarProjeto(uuidReal);
    }
  };

  // Agrupamento dos estandes por corredor
  const corredoresAgrupados = useMemo(() => {
    const mapa = new Map<string, ProjetoMapItem[]>();

    const estandesFiltrados = projetos_map.filter((e) => {
      const atendeBusca =
        !termo_busca.trim() ||
        (e.estande && e.estande.toLowerCase().includes(termo_busca.toLowerCase())) ||
        (e.titulo && e.titulo.toLowerCase().includes(termo_busca.toLowerCase())) ||
        (e.corredor && e.corredor.toLowerCase().includes(termo_busca.toLowerCase())) ||
        (e.codigo_projeto && e.codigo_projeto.toLowerCase().includes(termo_busca.toLowerCase()));

      const atendeStatus =
        filtro_status === 'todos' || e.status_cor === filtro_status;

      return atendeBusca && atendeStatus;
    });

    estandesFiltrados.forEach((est) => {
      const chaveCorredor = est.corredor && est.corredor.trim() !== '' ? est.corredor : 'Outros Corredores';
      if (!mapa.has(chaveCorredor)) {
        mapa.set(chaveCorredor, []);
      }
      mapa.get(chaveCorredor)!.push(est);
    });

    return Array.from(mapa.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [projetos_map, termo_busca, filtro_status]);

  const totalVerdes = projetos_map.filter((e) => e.status_cor === 'verde').length;
  const totalLaranjas = projetos_map.filter((e) => e.status_cor === 'laranja').length;
  const totalCinzas = projetos_map.filter((e) => e.status_cor === 'cinza').length;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6 font-sans max-w-7xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400 font-bold text-xs uppercase tracking-wider mb-1">
            <MapPin className="w-4 h-4" /> Pavilhão do IFMS — Logística Visual do Evento
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            Mapa de Estandes & Auditoria
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Dados carregados em tempo real do banco Supabase (`id_projeto`, `titulo`, `estande`, `corredor`).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={carregar_dados_mapa}
            disabled={carregando}
            title="Sincronizar Pavilhão"
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-teal-600' : ''}`} />
          </button>

          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {mensagem_erro && (
        <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-semibold">{mensagem_erro}</span>
        </div>
      )}

      {/* Legenda de Cores e Filtro */}
      <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1 shrink-0">
            <Filter className="w-3.5 h-3.5" /> Legenda:
          </span>

          <button
            type="button"
            onClick={() => set_filtro_status(filtro_status === 'laranja' ? 'todos' : 'laranja')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              filtro_status === 'laranja' ? 'ring-2 ring-orange-500 shadow-sm' : 'hover:opacity-90'
            } bg-orange-500 text-white`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse"></span>
            <span>Bloqueado / Quarentena ({totalLaranjas})</span>
          </button>

          <button
            type="button"
            onClick={() => set_filtro_status(filtro_status === 'verde' ? 'todos' : 'verde')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              filtro_status === 'verde' ? 'ring-2 ring-green-600 shadow-sm' : 'hover:opacity-90'
            } bg-green-500 text-white`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Avaliado ({totalVerdes})</span>
          </button>

          <button
            type="button"
            onClick={() => set_filtro_status(filtro_status === 'cinza' ? 'todos' : 'cinza')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              filtro_status === 'cinza' ? 'ring-2 ring-slate-400 shadow-sm' : 'hover:opacity-90'
            } bg-gray-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200`}
          >
            <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span>Aguardando ({totalCinzas})</span>
          </button>

          {filtro_status !== 'todos' && (
            <button
              type="button"
              onClick={() => set_filtro_status('todos')}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white underline ml-1 cursor-pointer"
            >
              Limpar Filtro
            </button>
          )}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Buscar estande, título ou UUID..."
            className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Carregamento */}
      {carregando && (
        <div className="p-12 text-center space-y-3">
          <Loader2 className="w-8 h-8 text-teal-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Consultando estandes da tabela `projetos` no Supabase...
          </p>
        </div>
      )}

      {/* RENDERIZAÇÃO DO MAPA ITERANDO SOBRE projetosMap */}
      {!carregando && (
        <div className="space-y-6">
          {corredoresAgrupados.length === 0 ? (
            <div className="p-12 text-center border-2 border-dashed rounded-3xl border-slate-200 dark:border-slate-800 space-y-2">
              <Info className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Nenhum estande encontrado no banco de dados.
              </p>
              <p className="text-xs text-slate-400">
                Certifique-se de que existem projetos cadastrados na tabela `projetos` com estande e corredor definidos.
              </p>
            </div>
          ) : (
            corredoresAgrupados.map(([nomeCorredor, estandesDoCorredor]) => (
              <div
                key={nomeCorredor}
                className="bg-slate-50/70 dark:bg-slate-800/40 rounded-3xl p-5 border border-slate-200 dark:border-slate-700/80 shadow-xs space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-teal-500"></span>
                    <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-wider">
                      {nomeCorredor}
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                      {estandesDoCorredor.length} {estandesDoCorredor.length === 1 ? 'estande' : 'estandes'}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500">Pavilhão Central IFMS</span>
                </div>

                {/* Blocos Clicáveis Iterando sobre projetosMap */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                  {estandesDoCorredor.map((est) => {
                    let bgClasse = 'bg-gray-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200 hover:bg-slate-300 border-slate-300 dark:border-slate-600';
                    if (est.status_cor === 'laranja') {
                      bgClasse = 'bg-orange-500 text-white hover:bg-orange-600 border-orange-600 shadow-xs animate-pulse';
                    } else if (est.status_cor === 'verde') {
                      bgClasse = 'bg-green-500 text-white hover:bg-green-600 border-green-600 shadow-xs';
                    }

                    return (
                      <button
                        key={est.id_projeto}
                        type="button"
                        onClick={() => abrir_auditoria_estande(est.id_projeto, est)}
                        className={`p-3 rounded-2xl border transition-all duration-150 text-left flex flex-col justify-between h-24 group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer ${bgClasse}`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-mono text-xs font-black tracking-wider uppercase">
                            {est.estande}
                          </span>
                          {est.status_cor === 'laranja' && <Lock className="w-3.5 h-3.5 shrink-0 text-white" />}
                          {est.status_cor === 'verde' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-white" />}
                          {est.status_cor === 'cinza' && <Clock className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
                        </div>

                        <div className="text-[10px] font-bold leading-tight line-clamp-2 opacity-90 group-hover:opacity-100">
                          {est.titulo}
                        </div>

                        <div className="text-[9px] font-mono opacity-80 flex items-center justify-between pt-1 border-t border-white/20 dark:border-slate-600/40">
                          <span>{est.qtd_avaliacoes ?? 0} aval.</span>
                          <span className="font-sans font-extrabold underline text-[9px]">Auditar ↗</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* MODAL DE AUDITORIA DO PROJETO SELECIONADO */}
      {projeto_selecionado && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            {/* Header do Modal */}
            <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-mono text-xs font-black rounded-lg">
                    {projeto_selecionado.estande}
                  </span>
                  <span className="text-xs font-bold text-teal-600 dark:text-teal-400">
                    {projeto_selecionado.corredor}
                  </span>
                </div>
                <h3 className="text-base font-black text-slate-900 dark:text-white leading-snug pt-1">
                  {projeto_selecionado.titulo}
                </h3>
                <div className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300">
                  Código: {projeto_selecionado.codigo_projeto || 'N/I'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => set_projeto_selecionado(null)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* SEÇÃO DE AUDITORIA */}
            <div className="space-y-3 text-xs">
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200 tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-emerald-600">
                    <FileCheck2 className="w-4 h-4" /> Avaliações Recebidas
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 font-mono">
                    Status Oficial
                  </span>
                </h4>

                {carregando_audit ? (
                  <div className="p-6 text-center space-y-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                    <Loader2 className="w-5 h-5 text-emerald-600 animate-spin mx-auto" />
                    <p className="text-[11px] text-slate-500">Consultando avaliações no Supabase...</p>
                  </div>
                ) : erro_audit ? (
                  <div className="p-3 rounded-xl bg-amber-50 text-amber-800 text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>{erro_audit}</span>
                  </div>
                ) : avaliacoes_audit.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center space-y-1">
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      Nenhuma avaliação recebida até o momento.
                    </p>
                    <p className="text-[10px] text-slate-400">
                      O projeto está aguardando avaliações oficiais no evento.
                    </p>
                  </div>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {avaliacoes_audit.map((item, idx) => {
                      const userObj = Array.isArray(item.usuarios) ? item.usuarios[0] : item.usuarios;
                      const nomeAvaliador = userObj?.nome || 'Avaliador Oficial';
                      const notaFinal = item.nota_final ?? '-';

                      return (
                        <div key={idx} className="p-3 bg-white dark:bg-slate-800/80 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold">
                              <Award className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 dark:text-white block text-xs">
                                {nomeAvaliador}
                              </span>
                              <span className="text-[10px] text-slate-400">Avaliador Credenciado</span>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block uppercase font-bold">Nota Final</span>
                            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono">
                              {notaFinal}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* RODAPÉ DO MODAL: BOTÃO "Editar Dados do Projeto" */}
            <div className="px-1 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => set_projeto_selecionado(null)}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-all text-xs cursor-pointer"
              >
                Fechar
              </button>

              <button
                type="button"
                onClick={lidar_editar_projeto}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all shadow-xs flex items-center gap-2 cursor-pointer"
              >
                <Edit2 className="w-4 h-4" />
                <span>Editar Dados do Projeto</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
