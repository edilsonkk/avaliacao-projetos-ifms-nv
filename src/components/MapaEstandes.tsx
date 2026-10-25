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
  Award,
  Maximize2,
  Minimize2,
  LayoutGrid,
  Grid,
  Layers,
  Building2,
  Check
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export type StatusProjetoMapa = 'nao_credenciado' | 'credenciado' | 'faltando' | 'avaliado';

export interface ProjetoMapItem {
  id_projeto: string;
  id_evento?: string | null;
  codigo_projeto?: string | null;
  titulo: string;
  estande: string | null;
  corredor: string | null;
  modalidade?: string | null;
  area_conhecimento?: string | null;
  nome_instituicao?: string | null;
  is_check_in_realizado: boolean;
  tem_lock: boolean;
  is_quarentena: boolean;
  qtd_avaliacoes: number;
  media_geral: number | null;
  notas: number[];
  status_mapa: StatusProjetoMapa;
}

export interface MapaEstandesProps {
  id_evento_ativo?: string | null;
  cota_padrao_evento?: number;
  aoSelecionarProjeto?: (projeto: ProjetoMapItem) => void;
  aoEditarProjeto?: (idProjeto: string) => void;
  aoFechar?: () => void;
}

interface AvaliacaoAudit {
  id_avaliacao?: string;
  nota_final?: number | null;
  parecer_final?: string | null;
  created_at?: string;
  usuarios?: { nome?: string; email?: string } | { nome?: string; email?: string }[] | null;
}

export const MapaEstandes: React.FC<MapaEstandesProps> = ({
  id_evento_ativo,
  cota_padrao_evento = 3,
  aoSelecionarProjeto,
  aoEditarProjeto,
  aoFechar
}) => {
  const [projetos_map, set_projetos_map] = useState<ProjetoMapItem[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [termo_busca, set_termo_busca] = useState<string>('');
  const [filtro_status, set_filtro_status] = useState<'todos' | StatusProjetoMapa>('todos');
  const [densidade_zoom, set_densidade_zoom] = useState<'grandes' | 'compactos'>('grandes');
  const [modo_fullscreen, set_modo_fullscreen] = useState<boolean>(false);
  const [cota_efetiva, set_cota_efetiva] = useState<number>(cota_padrao_evento);

  // Modal de Auditoria
  const [projeto_selecionado, set_projeto_selecionado] = useState<ProjetoMapItem | null>(null);
  const [avaliacoes_audit, set_avaliacoes_audit] = useState<AvaliacaoAudit[]>([]);
  const [carregando_audit, set_carregando_audit] = useState<boolean>(false);
  const [erro_audit, set_erro_audit] = useState<string | null>(null);

  const conexao_banco = verificar_conexao_configurada();

  // 1. CARREGAR DADOS DO BANCO
  const carregar_dados_mapa = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_projetos_map([]);
      set_carregando(false);
      return;
    }

    try {
      // 1.1 Identificar cota configurada no evento se id_evento_ativo for conhecido
      let cotaLocal = cota_padrao_evento || 3;
      if (id_evento_ativo) {
        try {
          const { data: evData } = await supabase
            .from('eventos')
            .select('cota_avaliacoes_padrao')
            .eq('id_evento', id_evento_ativo)
            .single();
          if (evData?.cota_avaliacoes_padrao) {
            cotaLocal = evData.cota_avaliacoes_padrao;
          }
        } catch {
          // Mantém cota_padrao_evento
        }
      }
      set_cota_efetiva(cotaLocal);

      // 1.2 Consultar projetos do evento com chaves estrangeiras
      let queryProj = supabase
        .from('projetos')
        .select(`
          id_projeto,
          id_evento,
          codigo_projeto,
          titulo,
          estande,
          corredor,
          is_check_in_realizado,
          modalidades ( id_modalidade, nome_modalidade ),
          areas_tematicas ( id_area, nome_area ),
          instituicoes ( id_instituicao, nome_exibicao, sigla )
        `);

      if (id_evento_ativo) {
        queryProj = queryProj.eq('id_evento', id_evento_ativo);
      }

      let { data: projetosData, error: erroProjetos } = await queryProj.order('estande', { ascending: true });

      // Fallback resiliente: se der erro na consulta relacional, busca as colunas base da tabela projetos
      if (erroProjetos) {
        console.warn('Aviso: tentando consulta simplificada direta de projetos:', erroProjetos.message);
        let queryBase = supabase
          .from('projetos')
          .select('id_projeto, id_evento, codigo_projeto, titulo, estande, corredor, is_check_in_realizado');
        if (id_evento_ativo) {
          queryBase = queryBase.eq('id_evento', id_evento_ativo);
        }
        const fallbackRes = await queryBase.order('estande', { ascending: true });
        if (fallbackRes.error) {
          throw fallbackRes.error;
        }
        projetosData = fallbackRes.data as any;
      }

      if (!projetosData || projetosData.length === 0) {
        set_projetos_map([]);
        set_carregando(false);
        return;
      }

      // 1.3 Consultar locks_ativos e avaliações com notas
      let locksSet = new Set<string>();
      let quarentenaSet = new Set<string>();
      // Mapear id_projeto -> lista de notas válidas
      const mapaNotas = new Map<string, number[]>();

      try {
        const [locksRes, avaliacoesRes] = await Promise.all([
          supabase.from('locks_ativos').select('id_projeto'),
          supabase.from('avaliacoes').select('id_projeto, nota_final, is_quarentena, status')
        ]);

        if (locksRes.data) {
          locksRes.data.forEach((l: any) => {
            if (l.id_projeto) locksSet.add(l.id_projeto);
          });
        }

        if (avaliacoesRes.data) {
          avaliacoesRes.data.forEach((a: any) => {
            if (!a.id_projeto) return;
            if (a.status === 'CANCELADA') return;

            if (a.is_quarentena) {
              quarentenaSet.add(a.id_projeto);
            }

            if (a.nota_final !== null && a.nota_final !== undefined) {
              const numNota = Number(a.nota_final);
              if (!isNaN(numNota)) {
                const arr = mapaNotas.get(a.id_projeto) || [];
                arr.push(numNota);
                mapaNotas.set(a.id_projeto, arr);
              }
            } else {
              // Avaliação registrada mesmo sem nota_final preenchida ainda
              const arr = mapaNotas.get(a.id_projeto) || [];
              mapaNotas.set(a.id_projeto, arr);
            }
          });
        }
      } catch (errSecundario) {
        console.warn('Aviso: status secundário de locks/avaliações:', errSecundario);
      }

      // 1.4 Processar cada projeto e determinar seus 4 estados de cor
      const processados: ProjetoMapItem[] = projetosData.map((p) => {
        const temLock = locksSet.has(p.id_projeto);
        const temQuarentena = quarentenaSet.has(p.id_projeto);
        const notasDoProjeto = mapaNotas.get(p.id_projeto) || [];
        const qtdAval = notasDoProjeto.length;

        let mediaCalculada: number | null = null;
        if (qtdAval > 0) {
          const soma = notasDoProjeto.reduce((acc, curr) => acc + curr, 0);
          mediaCalculada = Math.round((soma / qtdAval) * 100) / 100;
        }

        const isCredenciado = p.is_check_in_realizado !== false; // default true se null

        // 4 Estados de Cores:
        // 1. não credenciado (cinza)
        // 2. credenciado (0 avaliações) (azul)
        // 3. faltando avaliações (1 a cota-1) (amarelo)
        // 4. avaliado (>= cota) (verde)
        let status_mapa: StatusProjetoMapa = 'nao_credenciado';
        if (!isCredenciado) {
          status_mapa = 'nao_credenciado';
        } else if (qtdAval === 0) {
          status_mapa = 'credenciado';
        } else if (qtdAval < cotaLocal) {
          status_mapa = 'faltando';
        } else {
          status_mapa = 'avaliado';
        }

        const estandeNum = p.estande && p.estande.trim() !== '' ? p.estande.trim() : null;
        const corredorNome = p.corredor && p.corredor.trim() !== ''
          ? p.corredor.trim()
          : extrair_corredor_pelo_estande(estandeNum);

        // Extrai nomes das relações com segurança
        const modObj: any = (p as any).modalidades;
        const areaObj: any = (p as any).areas_tematicas;
        const instObj: any = (p as any).instituicoes;

        const modNome = Array.isArray(modObj)
          ? modObj[0]?.nome_modalidade
          : modObj?.nome_modalidade || (p as any).modalidade || null;

        const areaNome = Array.isArray(areaObj)
          ? areaObj[0]?.nome_area
          : areaObj?.nome_area || (p as any).area_conhecimento || null;

        const instNome = Array.isArray(instObj)
          ? instObj[0]?.nome_exibicao
          : instObj?.nome_exibicao || (p as any).nome_instituicao || null;

        return {
          id_projeto: p.id_projeto,
          id_evento: p.id_evento,
          codigo_projeto: p.codigo_projeto || null,
          titulo: p.titulo,
          estande: estandeNum,
          corredor: corredorNome,
          modalidade: modNome,
          area_conhecimento: areaNome,
          nome_instituicao: instNome,
          is_check_in_realizado: isCredenciado,
          tem_lock: temLock,
          is_quarentena: temQuarentena,
          qtd_avaliacoes: qtdAval,
          media_geral: mediaCalculada,
          notas: notasDoProjeto,
          status_mapa
        };
      });

      set_projetos_map(processados);
    } catch (err: any) {
      console.error('Erro ao consultar dados para o mapa de estandes:', err);
      set_mensagem_erro(`Erro ao carregar mapa de estandes: ${err?.message || err}`);
      set_projetos_map([]);
    } finally {
      set_carregando(false);
    }
  };

  const extrair_corredor_pelo_estande = (estandeStr: string | null): string => {
    if (!estandeStr || estandeStr.trim() === '' || estandeStr.toUpperCase() === 'SEM-ESTANDE') {
      return 'Sem Estande Atribuído';
    }
    const numLimpo = estandeStr.toUpperCase().trim();
    if (numLimpo.includes('A-') || numLimpo.includes('EST-A') || numLimpo.startsWith('A')) return 'Corredor A';
    if (numLimpo.includes('B-') || numLimpo.includes('EST-B') || numLimpo.startsWith('B')) return 'Corredor B';
    if (numLimpo.includes('C-') || numLimpo.includes('EST-C') || numLimpo.startsWith('C')) return 'Corredor C';
    if (numLimpo.includes('D-') || numLimpo.includes('EST-D') || numLimpo.startsWith('D')) return 'Corredor D';
    if (numLimpo.includes('E-') || numLimpo.includes('EST-E') || numLimpo.startsWith('E')) return 'Corredor E';
    if (numLimpo.includes('F-') || numLimpo.includes('EST-F') || numLimpo.startsWith('F')) return 'Corredor F';
    return 'Corredor Principal';
  };

  useEffect(() => {
    carregar_dados_mapa();
  }, [id_evento_ativo, cota_padrao_evento]);

  // 2. ABRIR AUDITORIA DO PROJETO AO CLICAR NO CARD
  const abrir_auditoria_estande = async (projetoItem: ProjetoMapItem) => {
    set_projeto_selecionado(projetoItem);
    if (aoSelecionarProjeto) aoSelecionarProjeto(projetoItem);

    set_carregando_audit(true);
    set_erro_audit(null);
    set_avaliacoes_audit([]);

    try {
      let { data, error } = await supabase
        .from('avaliacoes')
        .select(`
          id_avaliacao,
          nota_final,
          parecer_final,
          created_at,
          usuarios ( nome, email )
        `)
        .eq('id_projeto', projetoItem.id_projeto)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Tentando fallback de consulta de avaliações sem join:', error.message);
        const { data: dataSimples, error: erroSimples } = await supabase
          .from('avaliacoes')
          .select('id_avaliacao, nota_final, parecer_final, created_at, id_usuario')
          .eq('id_projeto', projetoItem.id_projeto)
          .order('created_at', { ascending: false });

        if (erroSimples) {
          throw error;
        }
        data = dataSimples as any;
      }

      set_avaliacoes_audit(data || []);
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

  // 3. AGRUPAMENTO E ORDENAÇÃO DOS ESTANDES POR CORREDOR
  const corredoresAgrupados = useMemo(() => {
    const mapa = new Map<string, ProjetoMapItem[]>();

    const estandesFiltrados = projetos_map.filter((e) => {
      const t = termo_busca.trim().toLowerCase();
      const atendeBusca =
        !t ||
        (e.estande && e.estande.toLowerCase().includes(t)) ||
        (e.titulo && e.titulo.toLowerCase().includes(t)) ||
        (e.corredor && e.corredor.toLowerCase().includes(t)) ||
        (e.codigo_projeto && e.codigo_projeto.toLowerCase().includes(t)) ||
        (e.nome_instituicao && e.nome_instituicao.toLowerCase().includes(t));

      const atendeStatus =
        filtro_status === 'todos' || e.status_mapa === filtro_status;

      return atendeBusca && atendeStatus;
    });

    estandesFiltrados.forEach((est) => {
      const chaveCorredor =
        !est.estande || est.estande.trim() === '' || est.estande.toUpperCase() === 'SEM-ESTANDE'
          ? 'Sem Estande Atribuído'
          : est.corredor && est.corredor.trim() !== ''
          ? est.corredor
          : extrair_corredor_pelo_estande(est.estande);

      if (!mapa.has(chaveCorredor)) {
        mapa.set(chaveCorredor, []);
      }
      mapa.get(chaveCorredor)!.push(est);
    });

    // Ordenação natural de estandes (A1, A2, ..., A10)
    mapa.forEach((listaProjetos) => {
      listaProjetos.sort((a, b) => {
        const estA = a.estande || '';
        const estB = b.estande || '';
        return estA.localeCompare(estB, undefined, { numeric: true, sensitivity: 'base' });
      });
    });

    // Ordenação dos corredores: Alfabética, com 'Sem Estande Atribuído' ao final
    return Array.from(mapa.entries()).sort((a, b) => {
      if (a[0] === 'Sem Estande Atribuído') return 1;
      if (b[0] === 'Sem Estande Atribuído') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [projetos_map, termo_busca, filtro_status]);

  // Contadores para as legendas
  const totalNaoCredenciados = useMemo(() => projetos_map.filter((e) => e.status_mapa === 'nao_credenciado').length, [projetos_map]);
  const totalCredenciados = useMemo(() => projetos_map.filter((e) => e.status_mapa === 'credenciado').length, [projetos_map]);
  const totalFaltando = useMemo(() => projetos_map.filter((e) => e.status_mapa === 'faltando').length, [projetos_map]);
  const totalAvaliados = useMemo(() => projetos_map.filter((e) => e.status_mapa === 'avaliado').length, [projetos_map]);

  const containerClasses = modo_fullscreen
    ? 'fixed inset-0 z-[60] w-screen h-screen rounded-none p-4 sm:p-6 bg-white dark:bg-slate-900 overflow-hidden flex flex-col font-sans'
    : 'bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-2xl font-sans w-full h-full flex flex-col overflow-hidden';

  const gridClasses =
    densidade_zoom === 'grandes'
      ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4'
      : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3';

  return (
    <div className={containerClasses}>
      {/* ==================================================================== */}
      {/* 1. CABEÇALHO DO MAPA */}
      {/* ==================================================================== */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-600 dark:text-teal-400 shadow-xs">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
              Mapa de Estandes & Pavilhão
            </h2>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Distribuição física, corredores, status em tempo real e cota ({cota_efetiva} avaliações/projeto)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Densidade / Zoom */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => set_densidade_zoom('grandes')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                densidade_zoom === 'grandes'
                  ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Cards Grandes e Detalhados"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cards Grandes</span>
            </button>
            <button
              type="button"
              onClick={() => set_densidade_zoom('compactos')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                densidade_zoom === 'compactos'
                  ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Cards Compactos (Mais por Linha)"
            >
              <Grid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Compacto</span>
            </button>
          </div>

          {/* Botão de Tela Cheia */}
          <button
            type="button"
            onClick={() => set_modo_fullscreen(!modo_fullscreen)}
            title={modo_fullscreen ? 'Sair da Tela Cheia' : 'Modo Tela Cheia (Expandir Janela)'}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 cursor-pointer transition-all"
          >
            {modo_fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Sincronizar */}
          <button
            type="button"
            onClick={carregar_dados_mapa}
            disabled={carregando}
            title="Sincronizar Pavilhão e Avaliações"
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 cursor-pointer transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-teal-600' : ''}`} />
          </button>

          {/* Fechar */}
          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              title="Fechar Mapa"
              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400 text-slate-500 cursor-pointer transition-all border border-slate-200 dark:border-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {mensagem_erro && (
        <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center gap-2 mt-4 shrink-0">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-semibold">{mensagem_erro}</span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. BARRA DE FILTROS E LEGENDA COM AS 4 CORES */}
      {/* ==================================================================== */}
      <div className="bg-slate-50 dark:bg-slate-800/60 p-3 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row items-center justify-between gap-4 mt-4 shrink-0">
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 shrink-0 mr-1">
            <Filter className="w-3.5 h-3.5" /> Filtrar Status:
          </span>

          {/* TODOS */}
          <button
            type="button"
            onClick={() => set_filtro_status('todos')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              filtro_status === 'todos'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            Todos ({projetos_map.length})
          </button>

          {/* 1. NÃO CREDENCIADO (Cinza / Ardósia) */}
          <button
            type="button"
            onClick={() => set_filtro_status(filtro_status === 'nao_credenciado' ? 'todos' : 'nao_credenciado')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer border ${
              filtro_status === 'nao_credenciado'
                ? 'ring-2 ring-slate-500 shadow-sm bg-slate-600 text-white border-slate-600'
                : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:opacity-90'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span>Não Credenciado ({totalNaoCredenciados})</span>
          </button>

          {/* 2. CREDENCIADO (0 Avaliações - Azul) */}
          <button
            type="button"
            onClick={() => set_filtro_status(filtro_status === 'credenciado' ? 'todos' : 'credenciado')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer border ${
              filtro_status === 'credenciado'
                ? 'ring-2 ring-blue-500 shadow-sm bg-blue-600 text-white border-blue-600'
                : 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:opacity-90'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
            <span>Credenciado ({totalCredenciados})</span>
          </button>

          {/* 3. FALTANDO AVALIAÇÕES (1 a cota-1 - Amarelo/Âmbar) */}
          <button
            type="button"
            onClick={() => set_filtro_status(filtro_status === 'faltando' ? 'todos' : 'faltando')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer border ${
              filtro_status === 'faltando'
                ? 'ring-2 ring-amber-500 shadow-sm bg-amber-500 text-white border-amber-500'
                : 'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200 border-amber-200 dark:border-amber-800 hover:opacity-90'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Faltando Avaliações ({totalFaltando})</span>
          </button>

          {/* 4. AVALIADO (Cota Atingida - Verde) */}
          <button
            type="button"
            onClick={() => set_filtro_status(filtro_status === 'avaliado' ? 'todos' : 'avaliado')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer border ${
              filtro_status === 'avaliado'
                ? 'ring-2 ring-emerald-600 shadow-sm bg-emerald-600 text-white border-emerald-600'
                : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800 hover:opacity-90'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Avaliado ({totalAvaliados})</span>
          </button>
        </div>

        {/* Campo de Busca Rápida */}
        <div className="relative w-full lg:w-72 shrink-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Buscar por estande, código, título..."
            className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. CORPO PRINCIPAL COM ROLAGEM INDEPENDENTE */}
      {/* ==================================================================== */}
      <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-6">
        {carregando ? (
          <div className="p-16 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-teal-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Consultando estandes e notas consolidadas no banco de dados...
            </p>
          </div>
        ) : corredoresAgrupados.length === 0 ? (
          <div className="p-16 text-center border-2 border-dashed rounded-3xl border-slate-200 dark:border-slate-800 space-y-3 my-8">
            <Info className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              Nenhum projeto ou estande encontrado para os filtros selecionados.
            </p>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Verifique se há projetos vinculados ao evento ou tente limpar o filtro de busca no topo.
            </p>
            {filtro_status !== 'todos' && (
              <button
                type="button"
                onClick={() => set_filtro_status('todos')}
                className="mt-2 px-4 py-2 bg-teal-600 text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-teal-700"
              >
                Limpar Filtros
              </button>
            )}
          </div>
        ) : (
          corredoresAgrupados.map(([nomeCorredor, estandesDoCorredor]) => (
            <div
              key={nomeCorredor}
              className="bg-slate-50/70 dark:bg-slate-800/40 rounded-3xl p-4 sm:p-5 border border-slate-200 dark:border-slate-700/80 shadow-xs space-y-4"
            >
              {/* Cabeçalho do Corredor */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className={`w-3 h-3 rounded-full ${
                    nomeCorredor === 'Sem Estande Atribuído' ? 'bg-slate-400' : 'bg-teal-500'
                  }`}></span>
                  <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white uppercase tracking-wider">
                    {nomeCorredor}
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                    {estandesDoCorredor.length} {estandesDoCorredor.length === 1 ? 'projeto' : 'projetos'}
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">Pavilhão Central IFMS</span>
              </div>

              {/* Grid Responsivo de Blocos de Projetos */}
              <div className={gridClasses}>
                {estandesDoCorredor.map((proj) => {
                  // Estilos por Status de Cor
                  let cardBorderBg = 'bg-slate-100 hover:bg-slate-200/90 dark:bg-slate-800/70 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200';
                  let statusTagBg = 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
                  let statusTexto = 'Não Credenciado';

                  if (proj.status_mapa === 'credenciado') {
                    cardBorderBg = 'bg-blue-50/90 hover:bg-blue-100/90 dark:bg-blue-950/40 dark:hover:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-950 dark:text-blue-100';
                    statusTagBg = 'bg-blue-200/80 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200';
                    statusTexto = 'Credenciado';
                  } else if (proj.status_mapa === 'faltando') {
                    cardBorderBg = 'bg-amber-50/90 hover:bg-amber-100/90 dark:bg-amber-950/40 dark:hover:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-100';
                    statusTagBg = 'bg-amber-200/90 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200';
                    const faltam = Math.max(1, cota_efetiva - proj.qtd_avaliacoes);
                    statusTexto = `Faltam ${faltam} aval.`;
                  } else if (proj.status_mapa === 'avaliado') {
                    cardBorderBg = 'bg-emerald-50/90 hover:bg-emerald-100/90 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100';
                    statusTagBg = 'bg-emerald-200/90 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200';
                    statusTexto = `Avaliado (${proj.qtd_avaliacoes}/${cota_efetiva})`;
                  }

                  const estandeFormatado = proj.estande || 'SEM ESTANDE';

                  if (densidade_zoom === 'compactos') {
                    // MODO COMPACTO
                    return (
                      <button
                        key={proj.id_projeto}
                        type="button"
                        onClick={() => abrir_auditoria_estande(proj)}
                        className={`p-3 rounded-2xl border-2 transition-all duration-150 text-left flex flex-col justify-between h-36 group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer shadow-2xs hover:shadow-md ${cardBorderBg}`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-mono text-xs font-black tracking-wider uppercase px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10">
                            {estandeFormatado}
                          </span>
                          <div className="flex items-center gap-1">
                            {proj.tem_lock && (
                              <span title="Avaliador avaliando no estande" className="p-0.5 rounded bg-amber-500 text-white">
                                <Lock className="w-3 h-3 animate-pulse" />
                              </span>
                            )}
                            {proj.is_quarentena && (
                              <span title="Divergência / Quarentena" className="p-0.5 rounded bg-rose-500 text-white">
                                <AlertTriangle className="w-3 h-3" />
                              </span>
                            )}
                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${statusTagBg}`}>
                              {proj.qtd_avaliacoes}/{cota_efetiva}
                            </span>
                          </div>
                        </div>

                        <div className="text-[11px] font-bold leading-tight line-clamp-2 my-1">
                          {proj.titulo}
                        </div>

                        <div className="space-y-1 pt-1 border-t border-black/10 dark:border-white/10 w-full">
                          <div className="flex items-baseline justify-between text-[10px] font-mono">
                            <span className="font-semibold opacity-75">Média:</span>
                            <span className="font-black font-mono text-xs">
                              {proj.media_geral !== null ? `${proj.media_geral.toFixed(2)}` : '-'}
                            </span>
                          </div>
                          {/* Badges de notas pequenas */}
                          {proj.notas.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {proj.notas.map((n, idx) => (
                                <span
                                  key={idx}
                                  className="px-1 rounded font-mono text-[9px] font-bold bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-100 border border-black/10"
                                >
                                  {n.toFixed(1)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[9px] italic opacity-60">Sem notas</div>
                          )}
                        </div>
                      </button>
                    );
                  }

                  // MODO EXPANDIDO (CARDS GRANDES E DETALHADOS)
                  return (
                    <button
                      key={proj.id_projeto}
                      type="button"
                      onClick={() => abrir_auditoria_estande(proj)}
                      className={`p-4 sm:p-5 rounded-2xl border-2 transition-all duration-150 text-left flex flex-col justify-between min-h-[220px] group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer shadow-xs hover:shadow-lg hover:scale-[1.01] ${cardBorderBg}`}
                    >
                      {/* Topo do Card: Estande, Código e Status */}
                      <div className="space-y-2 w-full">
                        <div className="flex items-center justify-between w-full gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-black tracking-wider uppercase px-2 py-0.5 rounded-lg bg-black/10 dark:bg-white/15">
                              {estandeFormatado}
                            </span>
                            {proj.codigo_projeto && (
                              <span className="font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                                {proj.codigo_projeto}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {proj.tem_lock && (
                              <span title="Avaliador no estande neste instante" className="p-1 rounded-md bg-amber-500 text-white shadow-2xs">
                                <Lock className="w-3.5 h-3.5 animate-pulse" />
                              </span>
                            )}
                            {proj.is_quarentena && (
                              <span title="Projeto em Quarentena / Divergência" className="p-1 rounded-md bg-rose-500 text-white shadow-2xs">
                                <AlertTriangle className="w-3.5 h-3.5" />
                              </span>
                            )}
                            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${statusTagBg}`}>
                              {statusTexto}
                            </span>
                          </div>
                        </div>

                        {/* Título do Projeto Completo */}
                        <h4 className="text-xs sm:text-sm font-bold leading-snug line-clamp-3 text-slate-900 dark:text-white pt-1">
                          {proj.titulo}
                        </h4>

                        {/* Metadados: Modalidade e Área */}
                        {(proj.modalidade || proj.area_conhecimento) && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium line-clamp-1">
                            {[proj.modalidade, proj.area_conhecimento].filter(Boolean).join(' • ')}
                          </div>
                        )}
                      </div>

                      {/* Rodapé do Card: Média e Badges de Notas */}
                      <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2 mt-3 w-full">
                        <div className="flex items-baseline justify-between">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Média Geral:
                            </span>
                            <span className="text-base font-black font-mono text-slate-900 dark:text-white">
                              {proj.media_geral !== null ? `${proj.media_geral.toFixed(2)} pts` : '-'}
                            </span>
                          </div>

                          <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">
                            {proj.qtd_avaliacoes}/{cota_efetiva} aval.
                          </span>
                        </div>

                        {/* Linha de Badges de Notas Recebidas */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block">
                            Notas Recebidas:
                          </span>
                          {proj.notas.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {proj.notas.map((nota, nIdx) => (
                                <span
                                  key={nIdx}
                                  className="px-2 py-0.5 rounded-md font-mono text-[11px] font-bold bg-white/95 dark:bg-slate-900/90 text-slate-900 dark:text-slate-100 border border-slate-300/80 dark:border-slate-700 shadow-2xs"
                                >
                                  {nota.toFixed(1)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[10px] italic text-slate-400 dark:text-slate-500">
                              Nenhuma nota atribuída ainda
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ==================================================================== */}
      {/* 4. MODAL DE AUDITORIA DETALHADA DO PROJETO SELECIONADO */}
      {/* ==================================================================== */}
      {projeto_selecionado && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
            {/* Header da Auditoria */}
            <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4 shrink-0">
              <div className="space-y-1.5 pr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-3 py-1 bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-mono text-xs font-black rounded-lg">
                    {projeto_selecionado.estande || 'SEM ESTANDE'}
                  </span>
                  <span className="text-xs font-bold text-teal-600 dark:text-teal-400">
                    {projeto_selecionado.corredor || 'Corredor Geral'}
                  </span>
                  {projeto_selecionado.codigo_projeto && (
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-xs font-bold rounded">
                      {projeto_selecionado.codigo_projeto}
                    </span>
                  )}
                </div>

                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white leading-snug pt-1">
                  {projeto_selecionado.titulo}
                </h3>

                {projeto_selecionado.nome_instituicao && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-semibold flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" />
                    {projeto_selecionado.nome_instituicao}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => set_projeto_selecionado(null)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resumo do Status e Média */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 shrink-0 text-center">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Status</span>
                <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                  {projeto_selecionado.status_mapa === 'nao_credenciado' && 'Não Credenciado'}
                  {projeto_selecionado.status_mapa === 'credenciado' && 'Credenciado'}
                  {projeto_selecionado.status_mapa === 'faltando' && 'Faltando Avaliações'}
                  {projeto_selecionado.status_mapa === 'avaliado' && 'Avaliado (Completo)'}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Média Geral</span>
                <span className="text-sm font-black font-mono text-emerald-600 dark:text-emerald-400">
                  {projeto_selecionado.media_geral !== null ? `${projeto_selecionado.media_geral.toFixed(2)} pts` : '-'}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Progresso</span>
                <span className="text-xs font-black font-mono text-slate-800 dark:text-slate-200">
                  {projeto_selecionado.qtd_avaliacoes} / {cota_efetiva} cota
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Quarentena</span>
                <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                  {projeto_selecionado.is_quarentena ? 'SIM (Em Análise)' : 'Não'}
                </span>
              </div>
            </div>

            {/* Lista Detalhada de Avaliações */}
            <div className="space-y-3 flex-1 overflow-y-auto pr-1 text-xs">
              <h4 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200 tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-teal-600 dark:text-teal-400">
                  <FileCheck2 className="w-4 h-4" /> Avaliações Registradas ({avaliacoes_audit.length})
                </span>
                <span className="text-[10px] font-bold text-slate-400 font-mono">
                  Histórico Oficial
                </span>
              </h4>

              {carregando_audit ? (
                <div className="p-8 text-center space-y-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                  <Loader2 className="w-6 h-6 text-teal-600 animate-spin mx-auto" />
                  <p className="text-[11px] text-slate-500">Consultando avaliações no Supabase...</p>
                </div>
              ) : erro_audit ? (
                <div className="p-3.5 rounded-xl bg-amber-50 text-amber-800 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>{erro_audit}</span>
                </div>
              ) : avaliacoes_audit.length === 0 ? (
                <div className="p-6 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-center space-y-1">
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Nenhuma avaliação homologada para este projeto até o momento.
                  </p>
                  <p className="text-[11px] text-slate-400">
                    O projeto está apto para receber avaliadores credenciados.
                  </p>
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                  {avaliacoes_audit.map((item, idx) => {
                    const userObj = Array.isArray(item.usuarios) ? item.usuarios[0] : item.usuarios;
                    const nomeAvaliador = userObj?.nome || 'Avaliador Oficial';
                    const emailAvaliador = userObj?.email || '';
                    const notaFinal = item.nota_final !== null && item.nota_final !== undefined
                      ? Number(item.nota_final).toFixed(2)
                      : '-';

                    return (
                      <div key={item.id_avaliacao || idx} className="p-3.5 bg-white dark:bg-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-bold">
                              <Award className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 dark:text-white block text-xs">
                                {nomeAvaliador}
                              </span>
                              {emailAvaliador && (
                                <span className="text-[10px] text-slate-400 block font-mono">
                                  {emailAvaliador}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block uppercase font-bold">Nota Final</span>
                            <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
                              {notaFinal} pts
                            </span>
                          </div>
                        </div>

                        {item.parecer_final && item.parecer_final.trim() !== '' && (
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-700/60 italic">
                            "{item.parecer_final}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rodapé da Auditoria: Botões de Ação */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => set_projeto_selecionado(null)}
                className="px-4 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-all text-xs cursor-pointer"
              >
                Fechar
              </button>

              <button
                type="button"
                onClick={lidar_editar_projeto}
                className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition-all shadow-xs flex items-center gap-2 cursor-pointer"
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
export default MapaEstandes;
