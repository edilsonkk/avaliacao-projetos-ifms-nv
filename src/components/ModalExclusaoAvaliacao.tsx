import React, { useState, useEffect, useRef } from 'react';
import {
  FileX2,
  Trash2,
  Search,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  Undo2,
  Info,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export interface AvaliacaoDetalhada {
  id_avaliacao: string;
  id_projeto: string;
  id_usuario: string;
  nota_final: number | null;
  status?: string;
  status_avaliacao?: string;
  parecer_final?: string | null;
  is_quarentena?: boolean;
  created_at?: string;
  tempo_presenca?: string;
  projetos?: {
    id_projeto?: string;
    codigo_projeto?: string;
    titulo?: string;
    estande?: string;
    corredor?: string;
    nome_instituicao?: string;
    id_evento?: string;
    id_area?: string | null;
    area_conhecimento?: string | null;
    area_tematica?: string | null;
    areas_tematicas?: {
      id_area?: string;
      nome_area?: string;
    } | null;
  };
  usuarios?: {
    id_usuario?: string;
    nome?: string;
    email?: string;
    areas?: string[];
    area_tematica?: string | null;
  };
  respostas_avaliacao?: Array<{
    id_resposta: string;
    id_pergunta: string;
    nota_atribuida: number;
    perguntas_questionario?: {
      texto_pergunta?: string;
      peso_calculo?: number;
    };
  }>;
}

interface ModalExclusaoAvaliacaoProps {
  id_evento_ativo?: string;
  ao_fechar: () => void;
  aoSucesso?: () => void;
}

type ColunaOrdenacao =
  | 'codigo_projeto'
  | 'nome_projeto'
  | 'area_projeto'
  | 'nome_avaliador'
  | 'area_avaliador'
  | 'criterios';

export const ModalExclusaoAvaliacao: React.FC<ModalExclusaoAvaliacaoProps> = ({
  id_evento_ativo,
  ao_fechar,
  aoSucesso,
}) => {
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoDetalhada[]>([]);
  const [carregando, setCarregando] = useState<boolean>(true);
  const [termoBusca, setTermoBusca] = useState<string>('');
  const [filtroStatus, setFiltroStatus] = useState<'todas' | 'concluidas' | 'canceladas'>('todas');
  const [idExpandido, setIdExpandido] = useState<string | null>(null);

  // Mapeamentos de Áreas Temáticas
  const [mapaAreasAvaliadores, setMapaAreasAvaliadores] = useState<Map<string, string[]>>(new Map());
  const [mapaAreasNomes, setMapaAreasNomes] = useState<Map<string, string>>(new Map());

  // Ordenação de colunas
  const [colunaOrdenacao, setColunaOrdenacao] = useState<ColunaOrdenacao>('codigo_projeto');
  const [direcaoOrdenacao, setDirecaoOrdenacao] = useState<'asc' | 'desc'>('asc');

  const alternarOrdenacao = (coluna: ColunaOrdenacao) => {
    if (colunaOrdenacao === coluna) {
      setDirecaoOrdenacao((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setColunaOrdenacao(coluna);
      setDirecaoOrdenacao('asc');
    }
  };

  const renderIconeOrdenacao = (coluna: ColunaOrdenacao) => {
    if (colunaOrdenacao === coluna) {
      return direcaoOrdenacao === 'asc' ? (
        <ArrowUp className="w-3.5 h-3.5 text-rose-600 shrink-0" />
      ) : (
        <ArrowDown className="w-3.5 h-3.5 text-rose-600 shrink-0" />
      );
    }
    return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  };

  // Confirmação de exclusão
  const [avaliacaoParaExcluir, setAvaliacaoParaExcluir] = useState<AvaliacaoDetalhada | null>(null);
  const [processandoAcao, setProcessandoAcao] = useState<boolean>(false);

  // Toast flutuante com opção de Desfazer (Undo)
  const [toastUndo, setToastUndo] = useState<{
    id_avaliacao: string;
    codigo_projeto: string;
    nome_avaliador: string;
    visivel: boolean;
  } | null>(null);

  const timeoutUndoRef = useRef<NodeJS.Timeout | null>(null);
  const conexaoConfigurada = verificar_conexao_configurada();

  // Helpers para extração de Áreas
  const extrairAreaProjeto = (av: AvaliacaoDetalhada): string => {
    const proj = Array.isArray(av.projetos) ? av.projetos[0] : av.projetos;
    if (!proj) return 'Não informada';
    if (proj.id_area && mapaAreasNomes.get(proj.id_area)) return mapaAreasNomes.get(proj.id_area)!;
    if (proj.areas_tematicas?.nome_area) return proj.areas_tematicas.nome_area;
    if (proj.area_tematica) return proj.area_tematica;
    if (proj.area_conhecimento) return proj.area_conhecimento;
    return 'Geral';
  };

  const extrairAreasAvaliador = (av: AvaliacaoDetalhada): string[] => {
    const user = Array.isArray(av.usuarios) ? av.usuarios[0] : av.usuarios;
    if (!user) return [];
    const idUser = user.id_usuario || av.id_usuario;
    const vinculadas = mapaAreasAvaliadores.get(idUser);
    if (vinculadas && vinculadas.length > 0) return vinculadas;
    if (user.areas && Array.isArray(user.areas) && user.areas.length > 0) return user.areas;
    if (user.area_tematica) return [user.area_tematica];
    return [];
  };

  const carregarAvaliacoes = async () => {
    setCarregando(true);
    try {
      if (!conexaoConfigurada) {
        setAvaliacoes([]);
        return;
      }

      // 1. Carrega áreas temáticas cadastradas
      const mapaAreas = new Map<string, string>();
      try {
        let qAreas: any = supabase.from('areas_tematicas').select('id_area, nome_area, id_evento');
        if (id_evento_ativo) qAreas = qAreas.eq('id_evento', id_evento_ativo);
        const { data: areasData } = await qAreas;

        (areasData || []).forEach((a: any) => {
          mapaAreas.set(a.id_area, a.nome_area);
        });
        setMapaAreasNomes(mapaAreas);
      } catch (errAreas) {
        console.warn('Erro ao carregar áreas temáticas:', errAreas);
      }

      // 2. Carrega áreas vinculadas aos avaliadores no evento
      try {
        let qAvAreas: any = supabase.from('avaliador_areas').select('id_usuario, id_area, id_evento');
        if (id_evento_ativo) qAvAreas = qAvAreas.eq('id_evento', id_evento_ativo);
        const { data: avAreasData } = await qAvAreas;

        const mapaUserAreas = new Map<string, string[]>();
        (avAreasData || []).forEach((item: any) => {
          const list = mapaUserAreas.get(item.id_usuario) || [];
          const nomeArea = mapaAreas.get(item.id_area) || item.id_area;
          if (!list.includes(nomeArea)) list.push(nomeArea);
          mapaUserAreas.set(item.id_usuario, list);
        });
        setMapaAreasAvaliadores(mapaUserAreas);
      } catch (errAvAreas) {
        console.warn('Erro ao carregar avaliador_areas:', errAvAreas);
      }

      // 3. Carrega perguntas do questionário para discriminação dos critérios
      const mapaPerguntas = new Map<string, any>();
      try {
        const { data: perguntasData } = await supabase
          .from('perguntas_questionario')
          .select('id_pergunta, texto_pergunta, peso_calculo');
        (perguntasData || []).forEach((p: any) => {
          mapaPerguntas.set(p.id_pergunta, p);
        });
      } catch (errPerg) {
        console.warn('Erro ao carregar perguntas_questionario:', errPerg);
      }

      // 4. Consulta avaliações (estrita às colunas reais do schema.sql)
      let avaliacoesCarregadas: any[] = [];
      const { data, error } = await supabase
        .from('avaliacoes')
        .select(`
          id_avaliacao,
          id_projeto,
          id_usuario,
          nota_final,
          status,
          status_avaliacao,
          parecer_final,
          is_quarentena,
          created_at,
          projetos (
            id_projeto,
            codigo_projeto,
            titulo,
            estande,
            corredor,
            id_evento,
            id_area
          ),
          usuarios (
            id_usuario,
            nome,
            email
          ),
          respostas_avaliacao (
            id_resposta,
            id_pergunta,
            nota_atribuida
          )
        `)
        .order('created_at', { ascending: false })
        .limit(300);

      if (!error && data && data.length > 0) {
        avaliacoesCarregadas = data as any[];
      } else {
        if (error) {
          console.warn('Aviso: JOIN aninhado em avaliacoes falhou, acionando fallback e enriquecimento em lote:', error);
        }
        // Fallback: busca diretamente na tabela avaliacoes
        const { data: dataSimples, error: errSimples } = await supabase
          .from('avaliacoes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(300);

        if (!errSimples && dataSimples) {
          avaliacoesCarregadas = dataSimples as any[];
        }
      }

      // 5. ENRIQUECIMENTO RELACIONAL AUTOMÁTICO EM LOTE
      // Garante que, se os joins retornaram vazio ou parciais, busca projetos e usuários pelos IDs
      const idsProjetosFaltantes = Array.from(
        new Set(
          avaliacoesCarregadas
            .filter((a) => {
              const p = Array.isArray(a.projetos) ? a.projetos[0] : a.projetos;
              return !p || !p.codigo_projeto;
            })
            .map((a) => a.id_projeto)
            .filter(Boolean)
        )
      );

      const idsUsuariosFaltantes = Array.from(
        new Set(
          avaliacoesCarregadas
            .filter((a) => {
              const u = Array.isArray(a.usuarios) ? a.usuarios[0] : a.usuarios;
              return !u || !u.nome;
            })
            .map((a) => a.id_usuario)
            .filter(Boolean)
        )
      );

      const idsAvaliacoesSemRespostas = avaliacoesCarregadas
        .filter((a) => !a.respostas_avaliacao || a.respostas_avaliacao.length === 0)
        .map((a) => a.id_avaliacao);

      const mapaProjetos = new Map<string, any>();
      if (idsProjetosFaltantes.length > 0) {
        try {
          let qProj: any = supabase
            .from('projetos')
            .select('id_projeto, codigo_projeto, titulo, estande, corredor, id_evento, id_area');
          if (typeof qProj.in === 'function') {
            qProj = qProj.in('id_projeto', idsProjetosFaltantes);
          }
          const { data: projsData } = await qProj;
          (projsData || []).forEach((p: any) => mapaProjetos.set(p.id_projeto, p));
        } catch (errProjs) {
          console.warn('Erro ao carregar projetos faltantes:', errProjs);
        }
      }

      const mapaUsuarios = new Map<string, any>();
      if (idsUsuariosFaltantes.length > 0) {
        try {
          let qUser: any = supabase
            .from('usuarios')
            .select('id_usuario, nome, email, papel');
          if (typeof qUser.in === 'function') {
            qUser = qUser.in('id_usuario', idsUsuariosFaltantes);
          }
          const { data: usersData } = await qUser;
          (usersData || []).forEach((u: any) => mapaUsuarios.set(u.id_usuario, u));
        } catch (errUsers) {
          console.warn('Erro ao carregar usuarios faltantes:', errUsers);
        }
      }

      const mapaRespostas = new Map<string, any[]>();
      if (idsAvaliacoesSemRespostas.length > 0) {
        try {
          let qResp: any = supabase
            .from('respostas_avaliacao')
            .select('id_resposta, id_avaliacao, id_pergunta, nota_atribuida');
          if (typeof qResp.in === 'function') {
            qResp = qResp.in('id_avaliacao', idsAvaliacoesSemRespostas);
          }
          const { data: respostasData } = await qResp;
          (respostasData || []).forEach((r: any) => {
            const list = mapaRespostas.get(r.id_avaliacao) || [];
            list.push(r);
            mapaRespostas.set(r.id_avaliacao, list);
          });
        } catch (errResp) {
          console.warn('Erro ao carregar respostas faltantes:', errResp);
        }
      }

      // 6. Mescla final de todos os dados relacionais
      let resultadoFinal: AvaliacaoDetalhada[] = avaliacoesCarregadas.map((av) => {
        const projExistente = Array.isArray(av.projetos) ? av.projetos[0] : av.projetos;
        const projEnriquecido = projExistente?.codigo_projeto
          ? projExistente
          : mapaProjetos.get(av.id_projeto) || projExistente || null;

        const userExistente = Array.isArray(av.usuarios) ? av.usuarios[0] : av.usuarios;
        const userEnriquecido = userExistente?.nome
          ? userExistente
          : mapaUsuarios.get(av.id_usuario) || userExistente || null;

        let respostas =
          av.respostas_avaliacao && av.respostas_avaliacao.length > 0
            ? av.respostas_avaliacao
            : mapaRespostas.get(av.id_avaliacao) || [];

        respostas = respostas.map((r: any) => ({
          ...r,
          perguntas_questionario:
            r.perguntas_questionario || mapaPerguntas.get(r.id_pergunta) || null,
        }));

        return {
          ...av,
          projetos: projEnriquecido,
          usuarios: userEnriquecido,
          respostas_avaliacao: respostas,
        };
      });

      // 7. Filtragem estrita pelo Evento Ativo (oculta avaliações de outros eventos)
      if (id_evento_ativo) {
        resultadoFinal = resultadoFinal.filter((av) => {
          const proj = Array.isArray(av.projetos) ? av.projetos[0] : av.projetos;
          return !proj?.id_evento || proj.id_evento === id_evento_ativo;
        });
      }

      setAvaliacoes(resultadoFinal);
    } catch (e) {
      console.error('Falha geral ao carregar avaliações para exclusão:', e);
      setAvaliacoes([]);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarAvaliacoes();
  }, [id_evento_ativo]);

  // Executa o soft delete com status = 'CANCELADA' via RPC (com fallback resiliente)
  const executarSoftDelete = async (item: AvaliacaoDetalhada) => {
    setProcessandoAcao(true);
    const id = item.id_avaliacao;

    try {
      if (conexaoConfigurada) {
        let rpcSucesso = false;
        try {
          if (typeof (supabase as any).rpc === 'function') {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc('excluir_avaliacao', {
              p_id_avaliacao: id,
            });
            if (!rpcErr && rpcRes && rpcRes.sucesso !== false) {
              rpcSucesso = true;
            }
          }
        } catch (e) {
          rpcSucesso = false;
        }

        // Se RPC falhar ou não estiver criada no banco, realiza fallback direto no Supabase
        if (!rpcSucesso) {
          const { error } = await supabase
            .from('avaliacoes')
            .update({
              status: 'CANCELADA',
              status_avaliacao: 'CANCELADA',
              is_quarentena: false,
            })
            .eq('id_avaliacao', id);

          if (error) {
            console.warn('Erro ao atualizar status da avaliacao no Supabase:', error);
          }
        }
      }

      // Atualização otimista imediata na lista local
      setAvaliacoes((prev) =>
        prev.map((av) =>
          av.id_avaliacao === id
            ? { ...av, status: 'CANCELADA', status_avaliacao: 'CANCELADA', is_quarentena: false }
            : av
        )
      );

      // Fecha o modal de confirmação
      setAvaliacaoParaExcluir(null);

      // Dispara callback para recalcular métricas do dashboard
      if (aoSucesso) aoSucesso();

      // Ativa o Toast flutuante com opção de Desfazer (Undo)
      const proj = Array.isArray(item.projetos) ? item.projetos[0] : item.projetos;
      const user = Array.isArray(item.usuarios) ? item.usuarios[0] : item.usuarios;

      if (timeoutUndoRef.current) clearTimeout(timeoutUndoRef.current);

      setToastUndo({
        id_avaliacao: id,
        codigo_projeto: proj?.codigo_projeto || 'Projeto',
        nome_avaliador: user?.nome || 'Avaliador',
        visivel: true,
      });

      timeoutUndoRef.current = setTimeout(() => {
        setToastUndo(null);
      }, 8000);
    } catch (err: any) {
      console.error('Falha ao excluir avaliação:', err);
      alert(`Erro ao cancelar avaliação: ${err.message || err}`);
    } finally {
      setProcessandoAcao(false);
    }
  };

  // Reverte o soft delete (Desfazer / Undo) via RPC (com fallback resiliente)
  const executarDesfazer = async (id: string) => {
    if (timeoutUndoRef.current) clearTimeout(timeoutUndoRef.current);
    setToastUndo(null);

    try {
      if (conexaoConfigurada) {
        let rpcSucesso = false;
        try {
          if (typeof (supabase as any).rpc === 'function') {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc('restaurar_avaliacao', {
              p_id_avaliacao: id,
            });
            if (!rpcErr && rpcRes && rpcRes.sucesso !== false) {
              rpcSucesso = true;
            }
          }
        } catch (e) {
          rpcSucesso = false;
        }

        if (!rpcSucesso) {
          await supabase
            .from('avaliacoes')
            .update({
              status: 'CONCLUIDA',
              status_avaliacao: 'concluida',
            })
            .eq('id_avaliacao', id);
        }
      }

      // Atualiza localmente
      setAvaliacoes((prev) =>
        prev.map((av) =>
          av.id_avaliacao === id
            ? { ...av, status: 'CONCLUIDA', status_avaliacao: 'concluida' }
            : av
        )
      );

      // Recalcula métricas do painel
      if (aoSucesso) aoSucesso();
    } catch (err) {
      console.error('Erro ao reverter cancelamento da avaliação:', err);
    }
  };

  // Filtragem
  const avaliacoesFiltradas = avaliacoes.filter((item) => {
    const isCancelada =
      item.status?.toUpperCase() === 'CANCELADA' ||
      item.status_avaliacao?.toUpperCase() === 'CANCELADA';

    if (filtroStatus === 'concluidas' && isCancelada) return false;
    if (filtroStatus === 'canceladas' && !isCancelada) return false;

    if (!termoBusca.trim()) return true;
    const termo = termoBusca.toLowerCase().trim();

    const proj = Array.isArray(item.projetos) ? item.projetos[0] : item.projetos;
    const user = Array.isArray(item.usuarios) ? item.usuarios[0] : item.usuarios;

    const cod = proj?.codigo_projeto?.toLowerCase() || '';
    const titulo = proj?.titulo?.toLowerCase() || '';
    const areaProj = extrairAreaProjeto(item).toLowerCase();
    const nomeAval = user?.nome?.toLowerCase() || '';
    const emailAval = user?.email?.toLowerCase() || '';
    const areasAval = extrairAreasAvaliador(item).join(' ').toLowerCase();

    return (
      cod.includes(termo) ||
      titulo.includes(termo) ||
      areaProj.includes(termo) ||
      nomeAval.includes(termo) ||
      emailAval.includes(termo) ||
      areasAval.includes(termo) ||
      item.id_avaliacao.toLowerCase().includes(termo)
    );
  });

  // Ordenação de todas as colunas
  const avaliacoesOrdenadas = [...avaliacoesFiltradas].sort((a, b) => {
    let valA: any = '';
    let valB: any = '';
    const projA = Array.isArray(a.projetos) ? a.projetos[0] : a.projetos;
    const projB = Array.isArray(b.projetos) ? b.projetos[0] : b.projetos;
    const userA = Array.isArray(a.usuarios) ? a.usuarios[0] : a.usuarios;
    const userB = Array.isArray(b.usuarios) ? b.usuarios[0] : b.usuarios;

    if (colunaOrdenacao === 'codigo_projeto') {
      valA = projA?.codigo_projeto || '';
      valB = projB?.codigo_projeto || '';
    } else if (colunaOrdenacao === 'nome_projeto') {
      valA = projA?.titulo || '';
      valB = projB?.titulo || '';
    } else if (colunaOrdenacao === 'area_projeto') {
      valA = extrairAreaProjeto(a);
      valB = extrairAreaProjeto(b);
    } else if (colunaOrdenacao === 'nome_avaliador') {
      valA = userA?.nome || '';
      valB = userB?.nome || '';
    } else if (colunaOrdenacao === 'area_avaliador') {
      const areasA = extrairAreasAvaliador(a);
      const areasB = extrairAreasAvaliador(b);
      valA = areasA.length > 0 ? areasA[0] : '';
      valB = areasB.length > 0 ? areasB[0] : '';
    } else if (colunaOrdenacao === 'criterios') {
      valA = a.nota_final ?? -1;
      valB = b.nota_final ?? -1;
    }

    if (typeof valA === 'number' && typeof valB === 'number') {
      return direcaoOrdenacao === 'asc' ? valA - valB : valB - valA;
    }
    return direcaoOrdenacao === 'asc'
      ? String(valA).localeCompare(String(valB), 'pt-BR', { sensitivity: 'base' })
      : String(valB).localeCompare(String(valA), 'pt-BR', { sensitivity: 'base' });
  });

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-3">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden relative">
        {/* Cabeçalho do Modal */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-rose-50/50 dark:bg-rose-950/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
              <FileX2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                Exclusão de Avaliações
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={ao_fechar}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Filtros e Busca */}
        <div className="p-4 sm:px-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              placeholder="Buscar por código, título do projeto ou avaliador..."
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Filtrar:</span>
            <div className="inline-flex rounded-xl bg-slate-200/60 dark:bg-slate-800 p-0.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setFiltroStatus('todas')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  filtroStatus === 'todas'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Todas ({avaliacoes.length})
              </button>
              <button
                type="button"
                onClick={() => setFiltroStatus('concluidas')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  filtroStatus === 'concluidas'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Concluídas
              </button>
              <button
                type="button"
                onClick={() => setFiltroStatus('canceladas')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  filtroStatus === 'canceladas'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Canceladas
              </button>
            </div>
          </div>
        </div>

        {/* Lista / Tabela de Avaliações */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {carregando ? (
            <div className="p-12 text-center space-y-3">
              <Loader2 className="w-8 h-8 text-rose-600 animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-500">
                Carregando avaliações registradas...
              </p>
            </div>
          ) : avaliacoesOrdenadas.length === 0 ? (
            <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                Nenhuma avaliação encontrada com os filtros informados.
              </p>
              <p className="text-[11px] text-slate-400">
                {termoBusca ? 'Tente ajustar os termos de pesquisa.' : 'Não há avaliações registradas nesta categoria.'}
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-x-auto shadow-xs">
              <table className="w-full text-left text-xs min-w-[900px]">
                <thead className="bg-slate-100 dark:bg-slate-800/80 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                  <tr>
                    {/* 1. Código do Projeto */}
                    <th
                      onClick={() => alternarOrdenacao('codigo_projeto')}
                      className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none w-32"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Código</span>
                        {renderIconeOrdenacao('codigo_projeto')}
                      </div>
                    </th>

                    {/* 2. Nome do Projeto */}
                    <th
                      onClick={() => alternarOrdenacao('nome_projeto')}
                      className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Nome do Projeto</span>
                        {renderIconeOrdenacao('nome_projeto')}
                      </div>
                    </th>

                    {/* 3. Área do Projeto */}
                    <th
                      onClick={() => alternarOrdenacao('area_projeto')}
                      className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none w-44"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Área do Projeto</span>
                        {renderIconeOrdenacao('area_projeto')}
                      </div>
                    </th>

                    {/* 4. Nome do Avaliador */}
                    <th
                      onClick={() => alternarOrdenacao('nome_avaliador')}
                      className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none w-48"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Nome do Avaliador</span>
                        {renderIconeOrdenacao('nome_avaliador')}
                      </div>
                    </th>

                    {/* 5. Área do Avaliador */}
                    <th
                      onClick={() => alternarOrdenacao('area_avaliador')}
                      className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none w-44"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Área do Avaliador</span>
                        {renderIconeOrdenacao('area_avaliador')}
                      </div>
                    </th>

                    {/* 6. Critérios */}
                    <th
                      onClick={() => alternarOrdenacao('criterios')}
                      className="px-4 py-3 text-center cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none w-36"
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span>Critérios</span>
                        {renderIconeOrdenacao('criterios')}
                      </div>
                    </th>

                    {/* 7. Excluir / Ações */}
                    <th className="px-4 py-3 text-center w-24">Excluir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {avaliacoesOrdenadas.map((av) => {
                    const proj = Array.isArray(av.projetos) ? av.projetos[0] : av.projetos;
                    const user = Array.isArray(av.usuarios) ? av.usuarios[0] : av.usuarios;
                    const codProj = proj?.codigo_projeto || 'N/I';
                    const tituloProj = proj?.titulo || 'Título não especificado';
                    const estande = proj?.estande || 'N/A';
                    const nomeAval = user?.nome || 'Avaliador não identificado';
                    const emailAval = user?.email || '-';

                    const areaProj = extrairAreaProjeto(av);
                    const areasAval = extrairAreasAvaliador(av);

                    const isCancelada =
                      av.status?.toUpperCase() === 'CANCELADA' ||
                      av.status_avaliacao?.toUpperCase() === 'CANCELADA';

                    const estaExpandido = idExpandido === av.id_avaliacao;

                    return (
                      <React.Fragment key={av.id_avaliacao}>
                        <tr
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                            isCancelada ? 'bg-slate-50/60 dark:bg-slate-900/60 opacity-60' : ''
                          }`}
                        >
                          {/* 1. Código do Projeto */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-mono font-bold text-xs text-rose-700 dark:text-rose-400 whitespace-nowrap">
                                {codProj}
                              </span>
                              {estande !== 'N/A' && (
                                <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 w-fit">
                                  Estande {estande}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 2. Nome do Projeto */}
                          <td className="px-4 py-3">
                            <div className="text-slate-900 dark:text-white font-semibold text-xs line-clamp-2">
                              {tituloProj}
                            </div>
                          </td>

                          {/* 3. Área do Projeto */}
                          <td className="px-4 py-3">
                            <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800 leading-tight">
                              {areaProj}
                            </span>
                          </td>

                          {/* 4. Nome do Avaliador */}
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900 dark:text-white text-xs">
                              {nomeAval}
                            </div>
                            <div className="font-mono text-[10px] text-slate-400">
                              {emailAval}
                            </div>
                          </td>

                          {/* 5. Área do Avaliador */}
                          <td className="px-4 py-3">
                            {areasAval.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {areasAval.map((area, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 leading-tight"
                                  >
                                    {area}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">
                                Não informada
                              </span>
                            )}
                          </td>

                          {/* 6. Critérios / Nota Final com Accordion */}
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                              <span
                                className={`text-sm font-black ${
                                  isCancelada
                                    ? 'text-slate-400 line-through'
                                    : 'text-slate-900 dark:text-white'
                                }`}
                              >
                                {av.nota_final !== null && av.nota_final !== undefined
                                  ? Number(av.nota_final).toFixed(1)
                                  : '-'}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setIdExpandido(estaExpandido ? null : av.id_avaliacao)
                                }
                                title="Ver critérios avaliados"
                                className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-[10px] transition-all inline-flex items-center gap-1 cursor-pointer"
                              >
                                {estaExpandido ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                                <span>Critérios</span>
                              </button>
                            </div>
                          </td>

                          {/* 7. Excluir (Ícone de lixeira ou Restaurar) */}
                          <td className="px-4 py-3 text-center">
                            {isCancelada ? (
                              <button
                                type="button"
                                onClick={() => executarDesfazer(av.id_avaliacao)}
                                title="Restaurar avaliação cancelada"
                                className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-bold text-[11px] transition-all inline-flex items-center gap-1 cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Restaurar</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setAvaliacaoParaExcluir(av)}
                                title="Excluir Avaliação"
                                className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800 transition-all hover:scale-105 inline-flex items-center justify-center cursor-pointer group"
                              >
                                <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Linha de Detalhes dos Critérios (Accordion) */}
                        {estaExpandido && (
                          <tr className="bg-slate-50/80 dark:bg-slate-900/80">
                            <td colSpan={7} className="px-6 py-4 border-y border-slate-200 dark:border-slate-800">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase flex items-center gap-1.5">
                                    <Info className="w-3.5 h-3.5 text-rose-600" />
                                    Detalhamento dos Critérios Avaliados:
                                  </span>
                                  {av.parecer_final && (
                                    <span className="text-xs text-slate-500 italic max-w-md truncate">
                                      Parecer: "{av.parecer_final}"
                                    </span>
                                  )}
                                </div>

                                {av.respostas_avaliacao && av.respostas_avaliacao.length > 0 ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {av.respostas_avaliacao.map((resp, rIdx) => {
                                      const texto =
                                        resp.perguntas_questionario?.texto_pergunta ||
                                        `Critério #${rIdx + 1}`;
                                      return (
                                        <div
                                          key={resp.id_resposta || rIdx}
                                          className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
                                        >
                                          <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium line-clamp-1">
                                            {texto}
                                          </span>
                                          <span className="px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white">
                                            {Number(resp.nota_atribuida).toFixed(1)}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-400 italic">
                                    Nenhum item discriminado individualmente registrado para esta avaliação.
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Rodapé com Fechamento */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={ao_fechar}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-all shadow-xs cursor-pointer"
          >
            Fechar Janela
          </button>
        </div>

        {/* DIÁLOGO MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
        {avaliacaoParaExcluir && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-60 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg p-6 shadow-2xl border border-rose-200 dark:border-rose-900/60 space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
                <div className="p-3 rounded-2xl bg-rose-100 dark:bg-rose-950/50">
                  <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Confirmar Cancelamento?
                  </h3>
                  <p className="text-xs text-slate-500">
                    Ação reversível via Soft Delete.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 text-xs space-y-2 text-slate-700 dark:text-slate-300">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Código do Projeto:</span>
                    <span className="font-mono text-rose-700 dark:text-rose-400 font-bold text-xs">
                      {(Array.isArray(avaliacaoParaExcluir.projetos)
                        ? avaliacaoParaExcluir.projetos[0]?.codigo_projeto
                        : avaliacaoParaExcluir.projetos?.codigo_projeto) || 'N/I'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Área do Projeto:</span>
                    <span className="font-bold text-slate-900 dark:text-white text-xs">
                      {extrairAreaProjeto(avaliacaoParaExcluir)}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Nome do Projeto:</span>
                  <span className="font-medium text-slate-900 dark:text-white text-xs">
                    {(Array.isArray(avaliacaoParaExcluir.projetos)
                      ? avaliacaoParaExcluir.projetos[0]?.titulo
                      : avaliacaoParaExcluir.projetos?.titulo) || 'Sem título'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-rose-100 dark:border-rose-900/40">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Avaliador:</span>
                    <span className="font-bold text-slate-900 dark:text-white text-xs">
                      {(Array.isArray(avaliacaoParaExcluir.usuarios)
                        ? avaliacaoParaExcluir.usuarios[0]?.nome
                        : avaliacaoParaExcluir.usuarios?.nome) || 'N/I'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Nota Final:</span>
                    <span className="font-black text-rose-700 dark:text-rose-400 text-sm">
                      {avaliacaoParaExcluir.nota_final != null
                        ? Number(avaliacaoParaExcluir.nota_final).toFixed(1)
                        : '-'}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                    Área(s) do Avaliador:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {extrairAreasAvaliador(avaliacaoParaExcluir).length > 0 ? (
                      extrairAreasAvaliador(avaliacaoParaExcluir).map((area, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-rose-200 dark:border-rose-800"
                        >
                          {area}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">
                        Nenhuma área vinculada
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Esta avaliação será desativada do cômputo da premiação, e você terá a opção de desfazimento imediato.
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={processandoAcao}
                  onClick={() => setAvaliacaoParaExcluir(null)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={processandoAcao}
                  onClick={() => executarSoftDelete(avaliacaoParaExcluir)}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {processandoAcao ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  <span>Confirmar Exclusão</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TOAST FLUTUANTE COM OPÇÃO DE DESFAZER (UNDO) */}
        {toastUndo && toastUndo.visivel && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-70 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-4 border border-slate-700 dark:border-slate-300 animate-in fade-in slide-in-from-bottom-5 duration-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
              <span className="text-xs font-medium">
                Avaliação de <strong>{toastUndo.codigo_projeto}</strong> cancelada.
              </span>
            </div>
            <button
              type="button"
              onClick={() => executarDesfazer(toastUndo.id_avaliacao)}
              className="px-3 py-1 rounded-lg bg-white/20 dark:bg-slate-900/20 hover:bg-white/30 dark:hover:bg-slate-900/30 text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer underline"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Desfazer</span>
            </button>
            <button
              type="button"
              onClick={() => setToastUndo(null)}
              className="p-1 rounded-md text-slate-400 hover:text-white dark:hover:text-slate-900"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
