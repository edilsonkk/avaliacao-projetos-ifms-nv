import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Search,
  RefreshCw,
  Loader2,
  FileSpreadsheet,
  Printer,
  Users,
  FolderGit2,
  UserX,
  Building2,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Clock,
  Timer,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Award,
  Layers,
  Sparkles,
  ChevronUp,
  X
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { buscarTodas } from '@/lib/buscarTodas';
import { baixarCsv } from '@/lib/csv';
import { tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { CabecalhoOrdenavel, compararNatural } from '@/components/ui/CabecalhoOrdenavel';

// ==============================================================================
// INTERFACES DOS RELATÓRIOS
// ==============================================================================

export interface DetalheAvaliacaoProjeto {
  id_avaliacao: string;
  id_usuario: string;
  avaliador_nome: string;
  nota_final: number;
  parecer?: string | null;
  data?: string | null;
}

export interface RelatorioProjetoItem {
  id_projeto: string;
  id_evento?: string;
  codigo_projeto?: string | null;
  titulo: string;
  estande: string;
  corredor?: string | null;
  modalidade: string;
  area_conhecimento: string;
  nome_instituicao?: string | null;
  id_instituicao?: string | null;
  total_avaliacoes: number;
  media_geral: number;
  notas: number[];
  is_check_in_realizado?: boolean;
  is_fora_da_competicao?: boolean;
  cota_avaliacoes?: number;
  contagem_ausencia?: number;
  detalhes_avaliacoes?: DetalheAvaliacaoProjeto[];
}

export interface RelatorioAvaliadorItem {
  id_avaliacao: string;
  id_usuario: string;
  avaliador_nome: string;
  avaliador_email: string;
  id_projeto?: string;
  id_evento?: string;
  codigo_projeto?: string | null;
  projeto_titulo: string;
  projeto_estande?: string | null;
  projeto_modalidade?: string | null;
  projeto_area?: string | null;
  nota_final: number;
  parecer_comentario?: string | null;
  tempo_presenca?: string | null;
  tempo_submissao?: string | null;
  data_avaliacao?: string | null;
  duracao_segundos: number;
  duracao_formatada: string;
}

export interface RelatorioAvaliadorGrupoItem {
  id_usuario: string;
  avaliador_nome: string;
  avaliador_email: string;
  total_avaliacoes: number;
  media_notas: number;
  tempo_medio_formatado: string;
  avaliacoes: RelatorioAvaliadorItem[];
}

export interface RelatorioAusenciaItem {
  id_usuario: string;
  avaliador_nome: string;
  avaliador_email: string;
  id_projeto: string;
  id_evento?: string;
  codigo_projeto?: string | null;
  projeto_titulo: string;
  projeto_estande?: string | null;
  projeto_modalidade?: string | null;
  projeto_area?: string | null;
  projeto_instituicao?: string | null;
  data_ausencia?: string | null;
  total_avaliacoes_atuais: number;
}

export interface RelatorioAusenciaGrupoItem {
  id_usuario: string;
  avaliador_nome: string;
  avaliador_email: string;
  total_ausencias: number;
  ausencias: RelatorioAusenciaItem[];
}

export interface RelatorioInstituicaoItem {
  id_instituicao: string;
  nome_instituicao: string;
  total_projetos: number;
  total_credenciados: number;
  total_avaliados: number;
  media_geral_escola: number;
  projetos: RelatorioProjetoItem[];
}

export interface IndicadoresGerenciais {
  nome_evento: string;
  data_evento?: string | null;
  horario_inicio?: string | null;
  horario_fim?: string | null;
  cota_padrao: number;
  // Projetos
  total_projetos: number;
  projetos_credenciados: number;
  projetos_ausentes: number;
  projetos_nao_credenciados: number;
  taxa_presenca_projetos: number;
  // Avaliadores
  total_avaliadores: number;
  avaliadores_credenciados: number;
  avaliadores_ausentes: number;
  taxa_comparecimento_avaliadores: number;
  // Avaliações
  total_avaliacoes_realizadas: number;
  avaliacoes_na_meta: number;
  cota_esperada_total: number;
  porcentagem_conclusao: number;
  tempo_medio_segundos: number;
  tempo_medio_formatado: string;
  media_geral_notas: number;
  // Distribuição de cotas
  projetos_zero_avaliacoes: number;
  projetos_abaixo_cota: number;
  projetos_cota_concluida: number;
  // Alertas
  projetos_quarentena: number;
  // Top Avaliadores
  top_avaliadores: Array<{
    nome: string;
    email: string;
    total: number;
    tempo_medio: string;
  }>;
  // Distribuição por Modalidade
  modalidades_distribuicao: Array<{
    nome: string;
    projetos: number;
    avaliacoes: number;
    media: number;
  }>;
  // Distribuição por Área Temática
  areas_distribuicao: Array<{
    nome: string;
    projetos: number;
    avaliacoes: number;
    media: number;
  }>;
}

// Helpers de formatação de duração e horários
export const formatarDuracao = (inicioStr?: string | null, fimStr?: string | null): string => {
  if (!inicioStr || !fimStr) return '--';
  const ini = new Date(inicioStr).getTime();
  const fim = new Date(fimStr).getTime();
  if (isNaN(ini) || isNaN(fim) || fim < ini) return '--';
  const difSegundos = Math.floor((fim - ini) / 1000);
  return formatarDuracaoEmSegundos(difSegundos);
};

export const formatarDuracaoEmSegundos = (difSegundos: number): string => {
  if (difSegundos <= 0) return '--';
  if (difSegundos < 1) return '< 1s';
  const min = Math.floor(difSegundos / 60);
  const seg = difSegundos % 60;
  if (min === 0) return `${seg}s`;
  if (min < 60) return `${min}m ${seg.toString().padStart(2, '0')}s`;
  const horas = Math.floor(min / 60);
  const minRest = min % 60;
  return `${horas}h ${minRest.toString().padStart(2, '0')}m`;
};

export const formatarHorario = (isoStr?: string | null): string => {
  if (!isoStr) return '--';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoStr;
  }
};

export const formatarDataHora = (isoStr?: string | null): string => {
  if (!isoStr) return '--';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
};

export const formatarDataDDMMYYYY = (dataStr?: string | null): string => {
  if (!dataStr) return '--';
  try {
    const raw = dataStr.split('T')[0];
    const partes = raw.split('-');
    if (partes.length === 3 && partes[0].length === 4) {
      return `${partes[2]}-${partes[1]}-${partes[0]}`;
    }
    const d = new Date(dataStr);
    if (!isNaN(d.getTime())) {
      const dia = d.getDate().toString().padStart(2, '0');
      const mes = (d.getMonth() + 1).toString().padStart(2, '0');
      const ano = d.getFullYear();
      return `${dia}-${mes}-${ano}`;
    }
    return dataStr;
  } catch {
    return dataStr || '--';
  }
};

export const RelatoriosAdmin: React.FC<{
  id_evento_ativo?: string;
  aoFechar?: () => void;
}> = ({ id_evento_ativo, aoFechar }) => {
  const idEvento = id_evento_ativo || '';
  // Navegação das 5 Abas
  const [aba_ativa, set_aba_ativa] = useState<
    'projetos' | 'avaliadores' | 'ausencias' | 'instituicoes' | 'indicadores'
  >('projetos');

  // Estados dos Datasets
  const [dados_projetos, set_dados_projetos] = useState<RelatorioProjetoItem[]>([]);
  const [dados_avaliadores, set_dados_avaliadores] = useState<RelatorioAvaliadorItem[]>([]);
  const [dados_ausencias, set_dados_ausencias] = useState<RelatorioAusenciaItem[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // Accordion de Notas Individuais na Tabela de Projetos (id_projeto expandido)
  const [projetosExpandidos, setProjetosExpandidos] = useState<Set<string>>(new Set());

  // Accordion de Avaliadores e Notas (id_usuario expandido)
  const [avaliadoresNotasExpandidos, setAvaliadoresNotasExpandidos] = useState<Set<string>>(new Set());

  // Accordion de Avaliadores e Ausências (id_usuario expandido)
  const [avaliadoresAusenciasExpandidos, setAvaliadoresAusenciasExpandidos] = useState<Set<string>>(new Set());

  // Accordion de Instituições (id_instituicao expandido)
  const [instituicoesExpandidas, setInstituicoesExpandidas] = useState<Set<string>>(new Set());

  // Ordenação de Projetos
  const [colunaProj, setColunaProj] = useState<'codigo' | 'titulo' | 'modalidade' | 'avaliacoes' | 'media'>('codigo');
  const [direcaoProj, setDirecaoProj] = useState<'asc' | 'desc'>('asc');

  // Ordenação de Avaliadores
  const [colunaAval, setColunaAval] = useState<'avaliador' | 'projeto' | 'nota' | 'inicio' | 'fim' | 'duracao' | 'parecer'>('avaliador');
  const [direcaoAval, setDirecaoAval] = useState<'asc' | 'desc'>('asc');

  // Ordenação de Ausências
  const [colunaAus, setColunaAus] = useState<'avaliador' | 'projeto' | 'data' | 'status'>('data');
  const [direcaoAus, setDirecaoAus] = useState<'asc' | 'desc'>('desc');

  // Ordenação de Instituições
  const [colunaInst, setColunaInst] = useState<'nome' | 'total' | 'credenciados' | 'avaliados' | 'media'>('nome');
  const [direcaoInst, setDirecaoInst] = useState<'asc' | 'desc'>('asc');

  // Indicadores Gerenciais Consolidados
  const [indicadores, setIndicadores] = useState<IndicadoresGerenciais | null>(null);

  const conexao_banco = verificar_conexao_configurada();

  const alternarOrdenacaoProj = (coluna: typeof colunaProj) => {
    if (colunaProj === coluna) {
      setDirecaoProj((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setColunaProj(coluna);
      setDirecaoProj('asc');
    }
  };

  const alternarOrdenacaoAval = (coluna: typeof colunaAval) => {
    if (colunaAval === coluna) {
      setDirecaoAval((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setColunaAval(coluna);
      setDirecaoAval('asc');
    }
  };

  const alternarOrdenacaoAus = (coluna: typeof colunaAus) => {
    if (colunaAus === coluna) {
      setDirecaoAus((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setColunaAus(coluna);
      setDirecaoAus('desc');
    }
  };

  const alternarOrdenacaoInst = (coluna: typeof colunaInst) => {
    if (colunaInst === coluna) {
      setDirecaoInst((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setColunaInst(coluna);
      setDirecaoInst('asc');
    }
  };

  const alternarExpansaoProjeto = (idProjeto: string) => {
    setProjetosExpandidos((prev) => {
      const novo = new Set(prev);
      if (novo.has(idProjeto)) {
        novo.delete(idProjeto);
      } else {
        novo.add(idProjeto);
      }
      return novo;
    });
  };

  const alternarExpansaoAvaliadorNotas = (idUsuario: string) => {
    setAvaliadoresNotasExpandidos((prev) => {
      const novo = new Set(prev);
      if (novo.has(idUsuario)) {
        novo.delete(idUsuario);
      } else {
        novo.add(idUsuario);
      }
      return novo;
    });
  };

  const alternarTodosAvaliadoresNotas = (expandir: boolean, todosIds: string[]) => {
    if (expandir) {
      setAvaliadoresNotasExpandidos(new Set(todosIds));
    } else {
      setAvaliadoresNotasExpandidos(new Set());
    }
  };

  const alternarExpansaoAvaliadorAusencias = (idUsuario: string) => {
    setAvaliadoresAusenciasExpandidos((prev) => {
      const novo = new Set(prev);
      if (novo.has(idUsuario)) {
        novo.delete(idUsuario);
      } else {
        novo.add(idUsuario);
      }
      return novo;
    });
  };

  const alternarTodosAvaliadoresAusencias = (expandir: boolean, todosIds: string[]) => {
    if (expandir) {
      setAvaliadoresAusenciasExpandidos(new Set(todosIds));
    } else {
      setAvaliadoresAusenciasExpandidos(new Set());
    }
  };

  const alternarExpansaoInstituicao = (idInst: string) => {
    setInstituicoesExpandidas((prev) => {
      const novo = new Set(prev);
      if (novo.has(idInst)) {
        novo.delete(idInst);
      } else {
        novo.add(idInst);
      }
      return novo;
    });
  };

  const alternarTodasInstituicoes = (expandir: boolean, todasIds: string[]) => {
    if (expandir) {
      setInstituicoesExpandidas(new Set(todasIds));
    } else {
      setInstituicoesExpandidas(new Set());
    }
  };

  const imprimir_relatorio = () => {
    window.print();
  };

  // Dados só do evento ativo, direto das funções de relatório do banco (sem consultas alternativas)
  const buscar_relatorios = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco || !idEvento) {
      set_dados_projetos([]);
      set_dados_avaliadores([]);
      set_dados_ausencias([]);
      setIndicadores(null);
      set_carregando(false);
      return;
    }

    try {
      // Chamada como método do cliente: rpc usa `this` (passada solta, quebrava com "this.rest")
      const rpc = (funcao: string, args: Record<string, unknown>) => (supabase as any).rpc(funcao, args);
      const { data: infoEvento, error: erroEvento } = await supabase
        .from('eventos')
        .select('nome_evento, data_evento, horario_inicio, horario_fim, cota_avaliacoes_padrao')
        .eq('id_evento', idEvento)
        .maybeSingle();
      if (erroEvento) throw erroEvento;

      const [rpcProjs, rpcAvals, rpcAus, avaliadoresEvento, quarentena] = await Promise.all([
        buscarTodas<any>(() => rpc('fn_relatorio_projetos_completo', { p_id_evento: idEvento }).order('id_projeto')),
        buscarTodas<any>(() => rpc('fn_relatorio_avaliadores_completo', { p_id_evento: idEvento }).order('id_usuario')),
        buscarTodas<any>(() => rpc('fn_relatorio_ausencias_completo', { p_id_evento: idEvento }).order('id_usuario')),
        buscarTodas<{ is_credenciado: boolean | null; usuarios: { papel: string | null } | { papel: string | null }[] | null }>(() =>
          supabase
            .from('avaliadores_evento')
            .select('id_usuario, is_credenciado, usuarios!inner(papel)')
            .eq('id_evento', idEvento)
            .order('id_usuario')
        ),
        supabase.from('view_projetos_quarentena').select('id_projeto', { count: 'exact', head: true }).eq('id_evento', idEvento),
      ]);
      if (quarentena.error) throw quarentena.error;

      const projsCarregados: RelatorioProjetoItem[] = rpcProjs.map((p: any) => ({
        id_projeto: p.id_projeto,
        id_evento: p.id_evento,
        codigo_projeto: p.codigo_projeto || null,
        titulo: p.titulo || 'Projeto sem título',
        estande: p.estande || '',
        corredor: p.corredor || null,
        modalidade: p.modalidade,
        area_conhecimento: p.area_conhecimento,
        nome_instituicao: p.nome_instituicao,
        id_instituicao: p.id_instituicao || null,
        total_avaliacoes: Number(p.total_avaliacoes ?? 0),
        media_geral: Number(p.media_geral ?? 0),
        notas: Array.isArray(p.notas) ? p.notas.map(Number) : [],
        is_check_in_realizado: p.is_check_in_realizado === true,
        is_fora_da_competicao: p.is_fora_da_competicao === true,
        cota_avaliacoes: Number(p.cota_avaliacoes) || undefined,
        detalhes_avaliacoes: (Array.isArray(p.detalhes_avaliacoes) ? p.detalhes_avaliacoes : []).map((d: any) => ({
          ...d,
          nota_final: Number(d.nota_final),
        })),
      }));

      const avalsCarregados: RelatorioAvaliadorItem[] = [];
      rpcAvals.forEach((g: any) => {
        (Array.isArray(g.avaliacoes) ? g.avaliacoes : []).forEach((item: any) => {
          avalsCarregados.push({
            id_avaliacao: item.id_avaliacao,
            id_usuario: g.id_usuario,
            avaliador_nome: g.avaliador_nome || '',
            avaliador_email: g.avaliador_email || '',
            id_projeto: item.id_projeto,
            id_evento: item.id_evento,
            codigo_projeto: item.codigo_projeto || null,
            projeto_titulo: item.projeto_titulo || 'Projeto sem título',
            projeto_estande: item.projeto_estande || null,
            projeto_modalidade: item.projeto_modalidade || null,
            projeto_area: item.projeto_area || null,
            nota_final: Number(item.nota_final ?? 0),
            parecer_comentario: item.parecer_comentario || null,
            tempo_presenca: item.tempo_presenca || null,
            tempo_submissao: item.tempo_submissao || null,
            data_avaliacao: item.data_avaliacao || null,
            duracao_segundos: Number(item.duracao_segundos ?? 0),
            duracao_formatada: formatarDuracao(item.tempo_presenca, item.tempo_submissao),
          });
        });
      });

      const ausenciasCarregadas: RelatorioAusenciaItem[] = [];
      rpcAus.forEach((g: any) => {
        (Array.isArray(g.ausencias) ? g.ausencias : []).forEach((item: any) => {
          ausenciasCarregadas.push({
            id_usuario: g.id_usuario,
            avaliador_nome: g.avaliador_nome || '',
            avaliador_email: g.avaliador_email || '',
            id_projeto: item.id_projeto,
            id_evento: item.id_evento,
            codigo_projeto: item.codigo_projeto || null,
            projeto_titulo: item.projeto_titulo || 'Projeto sem título',
            projeto_estande: item.projeto_estande || null,
            projeto_modalidade: item.projeto_modalidade || null,
            projeto_area: item.projeto_area || null,
            projeto_instituicao: item.projeto_instituicao || null,
            data_ausencia: item.data_ausencia || null,
            total_avaliacoes_atuais: Number(item.total_avaliacoes_atuais ?? 0),
          });
        });
      });

      // avaliadores_evento guarda também o credenciamento do Staff: conta só quem tem papel AVALIADOR
      const soAvaliadores = avaliadoresEvento.filter((a) => {
        const usuario = Array.isArray(a.usuarios) ? a.usuarios[0] : a.usuarios;
        return String(usuario?.papel || '').toUpperCase() === 'AVALIADOR';
      });
      const totalAvalCadastrados = soAvaliadores.length;
      const totalAvalCredenciados = soAvaliadores.filter((a) => a.is_credenciado).length;
      const countQuarentena = quarentena.count ?? 0;

      // ========================================================================
      // CÁLCULO CONSOLIDADO DOS INDICADORES GERENCIAIS
      // ========================================================================
      const totalProjetos = projsCarregados.length;
      const projsCredenciados = projsCarregados.filter((p) => p.is_check_in_realizado).length;

      // Não credenciados: sem check-in. Ausentes: com check-in, marcados ausentes no estande e sem avaliação.
      const idsProjetosComAusencia = new Set(ausenciasCarregadas.map((a) => a.id_projeto));
      const projsNaoCredenciados = totalProjetos - projsCredenciados;
      const projsAusentes = projsCarregados.filter(
        (p) => p.is_check_in_realizado && idsProjetosComAusencia.has(p.id_projeto) && p.total_avaliacoes === 0
      ).length;

      const taxaPresencaProjetos =
        totalProjetos > 0 ? Math.round((projsCredenciados / totalProjetos) * 100) : 0;

      const avalAusentes = Math.max(0, totalAvalCadastrados - totalAvalCredenciados);
      const taxaComparecimentoAval =
        totalAvalCadastrados > 0 ? Math.round((totalAvalCredenciados / totalAvalCadastrados) * 100) : 0;

      // Meta (mesma regra do Telão): cota de cada projeto presente e na competição; cada um conta até a sua cota
      const cotaPadrao = infoEvento?.cota_avaliacoes_padrao || 3;
      const cotaDe = (p: RelatorioProjetoItem) => p.cota_avaliacoes || cotaPadrao;
      const projsNaMeta = projsCarregados.filter((p) => p.is_check_in_realizado && !p.is_fora_da_competicao);
      const cotaEsperadaTotal = projsNaMeta.reduce((soma, p) => soma + cotaDe(p), 0);
      const avaliacoesNaMeta = projsNaMeta.reduce((soma, p) => soma + Math.min(p.total_avaliacoes, cotaDe(p)), 0);
      const totalAvalRealizadas = avalsCarregados.length;
      const pctConclusao = cotaEsperadaTotal > 0 ? Math.round((avaliacoesNaMeta / cotaEsperadaTotal) * 100) : 0;

      // Cálculo de Tempos
      const duracoesSegundos: number[] = [];
      avalsCarregados.forEach((av) => {
        if (av.tempo_presenca && av.tempo_submissao) {
          const ini = new Date(av.tempo_presenca).getTime();
          const fim = new Date(av.tempo_submissao).getTime();
          if (!isNaN(ini) && !isNaN(fim) && fim > ini) {
            duracoesSegundos.push(Math.floor((fim - ini) / 1000));
          }
        }
      });

      const tempoMedioSeg =
        duracoesSegundos.length > 0
          ? Math.round(duracoesSegundos.reduce((a, b) => a + b, 0) / duracoesSegundos.length)
          : 0;

      const formatarSegundos = (segundos: number): string => {
        if (segundos <= 0) return '--';
        const min = Math.floor(segundos / 60);
        const seg = segundos % 60;
        if (min === 0) return `${seg}s`;
        if (min < 60) return `${min}m ${seg.toString().padStart(2, '0')}s`;
        const h = Math.floor(min / 60);
        const m = min % 60;
        return `${h}h ${m.toString().padStart(2, '0')}m`;
      };

      // Média Geral de Notas da Feira
      const todasNotas = avalsCarregados.map((a) => a.nota_final).filter((n) => !isNaN(n));
      const mediaGeralNotas =
        todasNotas.length > 0
          ? Number((todasNotas.reduce((a, b) => a + b, 0) / todasNotas.length).toFixed(2))
          : 0;

      // Distribuição de Cotas por Projeto
      const qZero = projsNaMeta.filter((p) => p.total_avaliacoes === 0).length;
      const qCotaConcluida = projsNaMeta.filter((p) => p.total_avaliacoes >= cotaDe(p)).length;
      const qAbaixoCota = projsNaMeta.length - qZero - qCotaConcluida;

      // Top Avaliadores Mais Produtivos
      const contagemPorAvaliador = new Map<string, { nome: string; email: string; total: number; duracoes: number[] }>();
      avalsCarregados.forEach((av) => {
        const idUsr = av.id_usuario;
        const cur = contagemPorAvaliador.get(idUsr) || {
          nome: av.avaliador_nome,
          email: av.avaliador_email,
          total: 0,
          duracoes: [],
        };
        cur.total += 1;
        if (av.tempo_presenca && av.tempo_submissao) {
          const ini = new Date(av.tempo_presenca).getTime();
          const fim = new Date(av.tempo_submissao).getTime();
          if (!isNaN(ini) && !isNaN(fim) && fim > ini) {
            cur.duracoes.push(Math.floor((fim - ini) / 1000));
          }
        }
        contagemPorAvaliador.set(idUsr, cur);
      });

      const topAvaliadores = Array.from(contagemPorAvaliador.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map((a) => {
          const med = a.duracoes.length > 0 ? Math.round(a.duracoes.reduce((x, y) => x + y, 0) / a.duracoes.length) : 0;
          return {
            nome: a.nome,
            email: a.email,
            total: a.total,
            tempo_medio: formatarSegundos(med),
          };
        });

      // Distribuição por Modalidade
      const mapaModalidades = new Map<string, { projs: number; avals: number; notas: number[] }>();
      projsCarregados.forEach((p) => {
        const mNome = p.modalidade || 'Sem modalidade';
        const cur = mapaModalidades.get(mNome) || { projs: 0, avals: 0, notas: [] };
        cur.projs += 1;
        cur.avals += p.total_avaliacoes;
        if (p.notas && p.notas.length > 0) cur.notas.push(...p.notas);
        mapaModalidades.set(mNome, cur);
      });

      const modalidadesDistribuicao = Array.from(mapaModalidades.entries()).map(([nome, val]) => ({
        nome,
        projetos: val.projs,
        avaliacoes: val.avals,
        media: val.notas.length > 0 ? Number((val.notas.reduce((a, b) => a + b, 0) / val.notas.length).toFixed(2)) : 0,
      }));

      // Distribuição por Área Temática
      const mapaAreas = new Map<string, { projs: number; avals: number; notas: number[] }>();
      projsCarregados.forEach((p) => {
        const aNome = p.area_conhecimento || 'Sem área temática';
        const cur = mapaAreas.get(aNome) || { projs: 0, avals: 0, notas: [] };
        cur.projs += 1;
        cur.avals += p.total_avaliacoes;
        if (p.notas && p.notas.length > 0) cur.notas.push(...p.notas);
        mapaAreas.set(aNome, cur);
      });

      const areasDistribuicao = Array.from(mapaAreas.entries()).map(([nome, val]) => ({
        nome,
        projetos: val.projs,
        avaliacoes: val.avals,
        media: val.notas.length > 0 ? Number((val.notas.reduce((a, b) => a + b, 0) / val.notas.length).toFixed(2)) : 0,
      }));

      setIndicadores({
        nome_evento: infoEvento?.nome_evento || '',
        data_evento: infoEvento?.data_evento || null,
        horario_inicio: infoEvento?.horario_inicio || null,
        horario_fim: infoEvento?.horario_fim || null,
        cota_padrao: cotaPadrao,
        total_projetos: totalProjetos,
        projetos_credenciados: projsCredenciados,
        projetos_ausentes: projsAusentes,
        projetos_nao_credenciados: projsNaoCredenciados,
        taxa_presenca_projetos: taxaPresencaProjetos,
        total_avaliadores: totalAvalCadastrados,
        avaliadores_credenciados: totalAvalCredenciados,
        avaliadores_ausentes: avalAusentes,
        taxa_comparecimento_avaliadores: taxaComparecimentoAval,
        total_avaliacoes_realizadas: totalAvalRealizadas,
        avaliacoes_na_meta: avaliacoesNaMeta,
        cota_esperada_total: cotaEsperadaTotal,
        porcentagem_conclusao: pctConclusao,
        tempo_medio_segundos: tempoMedioSeg,
        tempo_medio_formatado: formatarSegundos(tempoMedioSeg),
        media_geral_notas: mediaGeralNotas,
        projetos_zero_avaliacoes: qZero,
        projetos_abaixo_cota: qAbaixoCota,
        projetos_cota_concluida: qCotaConcluida,
        projetos_quarentena: countQuarentena,
        top_avaliadores: topAvaliadores,
        modalidades_distribuicao: modalidadesDistribuicao,
        areas_distribuicao: areasDistribuicao,
      });

      set_dados_projetos(projsCarregados);
      set_dados_avaliadores(avalsCarregados);
      set_dados_ausencias(ausenciasCarregadas);
    } catch (e) {
      console.error('Erro ao buscar relatórios:', e);
      set_mensagem_erro(`Não foi possível carregar os relatórios: ${tratarErroEscritaAdmin(e)}`);
      set_dados_projetos([]);
      set_dados_avaliadores([]);
      set_dados_ausencias([]);
      setIndicadores(null);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    buscar_relatorios();
  }, [conexao_banco, idEvento]);

  // ============================================================================
  // FILTRAGEM E ORDENAÇÃO POR ABA
  // ============================================================================

  // 1. Projetos e Médias
  const projetos_filtrados = useMemo(() => {
    const t = termo_busca.trim().toLowerCase();
    if (!t) return dados_projetos;
    return dados_projetos.filter((p) => {
      const cod = (p.codigo_projeto || '').toLowerCase();
      const tit = p.titulo.toLowerCase();
      const est = p.estande.toLowerCase();
      const mod = p.modalidade.toLowerCase();
      const area = p.area_conhecimento.toLowerCase();
      const inst = (p.nome_instituicao || '').toLowerCase();
      return (
        cod.includes(t) ||
        tit.includes(t) ||
        est.includes(t) ||
        mod.includes(t) ||
        area.includes(t) ||
        inst.includes(t)
      );
    });
  }, [dados_projetos, termo_busca]);

  const projetos_ordenados = useMemo(() => {
    return [...projetos_filtrados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaProj === 'codigo') {
        valA = a.codigo_projeto || '';
        valB = b.codigo_projeto || '';
      } else if (colunaProj === 'titulo') {
        valA = a.titulo || '';
        valB = b.titulo || '';
      } else if (colunaProj === 'modalidade') {
        valA = a.modalidade || '';
        valB = b.modalidade || '';
      } else if (colunaProj === 'avaliacoes') {
        valA = a.total_avaliacoes;
        valB = b.total_avaliacoes;
      } else if (colunaProj === 'media') {
        valA = a.media_geral;
        valB = b.media_geral;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoProj === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoProj === 'asc' ? comp : -comp;
    });
  }, [projetos_filtrados, colunaProj, direcaoProj]);

  // Lista Completa de Projetos Ordenados (100% dos dados para Impressão em PDF, sem filtro de tela)
  const projetos_todos_ordenados = useMemo(() => {
    return [...dados_projetos].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaProj === 'codigo') {
        valA = a.codigo_projeto || '';
        valB = b.codigo_projeto || '';
      } else if (colunaProj === 'titulo') {
        valA = a.titulo || '';
        valB = b.titulo || '';
      } else if (colunaProj === 'modalidade') {
        valA = a.modalidade || '';
        valB = b.modalidade || '';
      } else if (colunaProj === 'avaliacoes') {
        valA = a.total_avaliacoes;
        valB = b.total_avaliacoes;
      } else if (colunaProj === 'media') {
        valA = a.media_geral;
        valB = b.media_geral;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoProj === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoProj === 'asc' ? comp : -comp;
    });
  }, [dados_projetos, colunaProj, direcaoProj]);

  // 2. Avaliadores e Notas Atribuídas (Agrupamento por Avaliador)
  const avaliadores_filtrados = useMemo(() => {
    const t = termo_busca.trim().toLowerCase();
    if (!t) return dados_avaliadores;
    return dados_avaliadores.filter((a) => {
      const nome = a.avaliador_nome.toLowerCase();
      const email = a.avaliador_email.toLowerCase();
      const cod = (a.codigo_projeto || '').toLowerCase();
      const tit = a.projeto_titulo.toLowerCase();
      const est = (a.projeto_estande || '').toLowerCase();
      const parc = (a.parecer_comentario || '').toLowerCase();
      return (
        nome.includes(t) ||
        email.includes(t) ||
        cod.includes(t) ||
        tit.includes(t) ||
        est.includes(t) ||
        parc.includes(t)
      );
    });
  }, [dados_avaliadores, termo_busca]);

  const avaliadores_ordenados = useMemo(() => {
    return [...avaliadores_filtrados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaAval === 'avaliador') {
        valA = a.avaliador_nome || '';
        valB = b.avaliador_nome || '';
      } else if (colunaAval === 'projeto') {
        valA = a.projeto_titulo || '';
        valB = b.projeto_titulo || '';
      } else if (colunaAval === 'nota') {
        valA = a.nota_final;
        valB = b.nota_final;
      } else if (colunaAval === 'inicio') {
        valA = a.tempo_presenca || '';
        valB = b.tempo_presenca || '';
      } else if (colunaAval === 'fim') {
        valA = a.tempo_submissao || a.data_avaliacao || '';
        valB = b.tempo_submissao || b.data_avaliacao || '';
      } else if (colunaAval === 'duracao') {
        valA = a.duracao_segundos;
        valB = b.duracao_segundos;
      } else if (colunaAval === 'parecer') {
        valA = a.parecer_comentario || '';
        valB = b.parecer_comentario || '';
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoAval === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoAval === 'asc' ? comp : -comp;
    });
  }, [avaliadores_filtrados, colunaAval, direcaoAval]);

  const avaliadoresNotasAgrupados = useMemo(() => {
    const mapa = new Map<string, RelatorioAvaliadorGrupoItem>();

    dados_avaliadores.forEach((item) => {
      const chave = item.id_usuario || item.avaliador_email || item.avaliador_nome;
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          id_usuario: item.id_usuario || chave,
          avaliador_nome: item.avaliador_nome,
          avaliador_email: item.avaliador_email,
          total_avaliacoes: 0,
          media_notas: 0,
          tempo_medio_formatado: '--',
          avaliacoes: [],
        });
      }
      const grupo = mapa.get(chave)!;
      grupo.avaliacoes.push(item);
    });

    return Array.from(mapa.values()).map((g) => {
      const total = g.avaliacoes.length;
      const somaNotas = g.avaliacoes.reduce((acc, a) => acc + a.nota_final, 0);
      const media = total > 0 ? Number((somaNotas / total).toFixed(2)) : 0;

      let totalSegundos = 0;
      let qtdComTempo = 0;
      g.avaliacoes.forEach((av) => {
        if (av.tempo_presenca && av.tempo_submissao) {
          const dIni = new Date(av.tempo_presenca).getTime();
          const dFim = new Date(av.tempo_submissao).getTime();
          if (!isNaN(dIni) && !isNaN(dFim) && dFim >= dIni) {
            totalSegundos += Math.floor((dFim - dIni) / 1000);
            qtdComTempo++;
          }
        }
      });
      const mediaSeg = qtdComTempo > 0 ? Math.floor(totalSegundos / qtdComTempo) : 0;

      return {
        ...g,
        total_avaliacoes: total,
        media_notas: media,
        tempo_medio_formatado: mediaSeg > 0 ? formatarDuracaoEmSegundos(mediaSeg) : '--',
      };
    });
  }, [dados_avaliadores]);

  const avaliadoresNotas_filtrados = useMemo(() => {
    const t = termo_busca.trim().toLowerCase();
    if (!t) return avaliadoresNotasAgrupados;

    return avaliadoresNotasAgrupados
      .map((g) => {
        const nomeBate =
          g.avaliador_nome.toLowerCase().includes(t) ||
          g.avaliador_email.toLowerCase().includes(t);
        const avalsFiltradas = g.avaliacoes.filter((av) => {
          const cod = (av.codigo_projeto || '').toLowerCase();
          const tit = av.projeto_titulo.toLowerCase();
          const parc = (av.parecer_comentario || '').toLowerCase();
          return cod.includes(t) || tit.includes(t) || parc.includes(t);
        });

        if (nomeBate) return g;
        if (avalsFiltradas.length > 0) {
          return {
            ...g,
            avaliacoes: avalsFiltradas,
          };
        }
        return null;
      })
      .filter((g): g is RelatorioAvaliadorGrupoItem => g !== null);
  }, [avaliadoresNotasAgrupados, termo_busca]);

  const avaliadoresNotas_ordenados = useMemo(() => {
    return [...avaliadoresNotas_filtrados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaAval === 'avaliador') {
        valA = a.avaliador_nome;
        valB = b.avaliador_nome;
      } else if (colunaAval === 'nota') {
        valA = a.media_notas;
        valB = b.media_notas;
      } else {
        valA = a.total_avaliacoes;
        valB = b.total_avaliacoes;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoAval === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoAval === 'asc' ? comp : -comp;
    });
  }, [avaliadoresNotas_filtrados, colunaAval, direcaoAval]);

  // Lista Completa de Avaliadores e Notas Ordenados (100% dos dados para Impressão em PDF)
  const avaliadoresNotas_todos_ordenados = useMemo(() => {
    return [...avaliadoresNotasAgrupados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaAval === 'avaliador') {
        valA = a.avaliador_nome;
        valB = b.avaliador_nome;
      } else if (colunaAval === 'nota') {
        valA = a.media_notas;
        valB = b.media_notas;
      } else {
        valA = a.total_avaliacoes;
        valB = b.total_avaliacoes;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoAval === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoAval === 'asc' ? comp : -comp;
    });
  }, [avaliadoresNotasAgrupados, colunaAval, direcaoAval]);

  // 3. Avaliadores e Ausências Atribuídas (Agrupamento por Avaliador)
  const ausencias_filtradas = useMemo(() => {
    const t = termo_busca.trim().toLowerCase();
    if (!t) return dados_ausencias;
    return dados_ausencias.filter((a) => {
      const nome = a.avaliador_nome.toLowerCase();
      const email = a.avaliador_email.toLowerCase();
      const cod = (a.codigo_projeto || '').toLowerCase();
      const tit = a.projeto_titulo.toLowerCase();
      const est = (a.projeto_estande || '').toLowerCase();
      const inst = (a.projeto_instituicao || '').toLowerCase();
      return (
        nome.includes(t) ||
        email.includes(t) ||
        cod.includes(t) ||
        tit.includes(t) ||
        est.includes(t) ||
        inst.includes(t)
      );
    });
  }, [dados_ausencias, termo_busca]);

  const ausencias_ordenadas = useMemo(() => {
    return [...ausencias_filtradas].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaAus === 'avaliador') {
        valA = a.avaliador_nome || '';
        valB = b.avaliador_nome || '';
      } else if (colunaAus === 'projeto') {
        valA = a.projeto_titulo || '';
        valB = b.projeto_titulo || '';
      } else if (colunaAus === 'data') {
        valA = a.data_ausencia || '';
        valB = b.data_ausencia || '';
      } else if (colunaAus === 'status') {
        valA = a.total_avaliacoes_atuais;
        valB = b.total_avaliacoes_atuais;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoAus === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoAus === 'asc' ? comp : -comp;
    });
  }, [ausencias_filtradas, colunaAus, direcaoAus]);

  const avaliadoresAusenciasAgrupados = useMemo(() => {
    const mapa = new Map<string, RelatorioAusenciaGrupoItem>();

    dados_ausencias.forEach((item) => {
      const chave = item.id_usuario || item.avaliador_email || item.avaliador_nome;
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          id_usuario: item.id_usuario || chave,
          avaliador_nome: item.avaliador_nome,
          avaliador_email: item.avaliador_email,
          total_ausencias: 0,
          ausencias: [],
        });
      }
      const grupo = mapa.get(chave)!;
      grupo.ausencias.push(item);
    });

    return Array.from(mapa.values()).map((g) => ({
      ...g,
      total_ausencias: g.ausencias.length,
    }));
  }, [dados_ausencias]);

  const avaliadoresAusencias_filtrados = useMemo(() => {
    const t = termo_busca.trim().toLowerCase();
    if (!t) return avaliadoresAusenciasAgrupados;

    return avaliadoresAusenciasAgrupados
      .map((g) => {
        const nomeBate =
          g.avaliador_nome.toLowerCase().includes(t) ||
          g.avaliador_email.toLowerCase().includes(t);
        const ausFiltradas = g.ausencias.filter((aus) => {
          const cod = (aus.codigo_projeto || '').toLowerCase();
          const tit = aus.projeto_titulo.toLowerCase();
          const mod = (aus.projeto_modalidade || '').toLowerCase();
          const ar = (aus.projeto_area || '').toLowerCase();
          return cod.includes(t) || tit.includes(t) || mod.includes(t) || ar.includes(t);
        });

        if (nomeBate) return g;
        if (ausFiltradas.length > 0) {
          return {
            ...g,
            ausencias: ausFiltradas,
          };
        }
        return null;
      })
      .filter((g): g is RelatorioAusenciaGrupoItem => g !== null);
  }, [avaliadoresAusenciasAgrupados, termo_busca]);

  const avaliadoresAusencias_ordenados = useMemo(() => {
    return [...avaliadoresAusencias_filtrados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaAus === 'avaliador') {
        valA = a.avaliador_nome;
        valB = b.avaliador_nome;
      } else {
        valA = a.total_ausencias;
        valB = b.total_ausencias;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoAus === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoAus === 'asc' ? comp : -comp;
    });
  }, [avaliadoresAusencias_filtrados, colunaAus, direcaoAus]);

  // Lista Completa de Avaliadores e Ausências Ordenadas (100% dos dados para Impressão em PDF)
  const avaliadoresAusencias_todas_ordenadas = useMemo(() => {
    return [...avaliadoresAusenciasAgrupados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaAus === 'avaliador') {
        valA = a.avaliador_nome;
        valB = b.avaliador_nome;
      } else {
        valA = a.total_ausencias;
        valB = b.total_ausencias;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoAus === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoAus === 'asc' ? comp : -comp;
    });
  }, [avaliadoresAusenciasAgrupados, colunaAus, direcaoAus]);

  // 4. Instituições e Projetos Submetidos (Agrupamento Hierárquico)
  const instituicoesAgrupadas = useMemo(() => {
    const mapa = new Map<string, RelatorioInstituicaoItem>();

    dados_projetos.forEach((p) => {
      const nomeEscola = p.nome_instituicao?.trim() || 'Instituição Não Informada';
      const chave = nomeEscola.toLowerCase();

      const cur = mapa.get(chave) || {
        id_instituicao: p.id_instituicao || chave,
        nome_instituicao: nomeEscola,
        total_projetos: 0,
        total_credenciados: 0,
        total_avaliados: 0,
        media_geral_escola: 0,
        projetos: [],
      };

      cur.total_projetos += 1;
      if (p.is_check_in_realizado) cur.total_credenciados += 1;
      if (p.total_avaliacoes > 0) cur.total_avaliados += 1;
      cur.projetos.push(p);

      mapa.set(chave, cur);
    });

    // Calcula média da instituição
    const lista = Array.from(mapa.values()).map((inst) => {
      const projsComMedia = inst.projetos.filter((p) => p.total_avaliacoes > 0 && p.media_geral > 0);
      const media =
        projsComMedia.length > 0
          ? Number((projsComMedia.reduce((acc, curr) => acc + curr.media_geral, 0) / projsComMedia.length).toFixed(2))
          : 0;
      return {
        ...inst,
        media_geral_escola: media,
      };
    });

    return lista;
  }, [dados_projetos]);

  const instituicoes_filtradas = useMemo(() => {
    const t = termo_busca.trim().toLowerCase();
    if (!t) return instituicoesAgrupadas;

    return instituicoesAgrupadas
      .map((inst) => {
        const escolaBate = inst.nome_instituicao.toLowerCase().includes(t);
        const projsFiltrados = inst.projetos.filter((p) => {
          const cod = (p.codigo_projeto || '').toLowerCase();
          const tit = p.titulo.toLowerCase();
          const est = p.estande.toLowerCase();
          const mod = p.modalidade.toLowerCase();
          return cod.includes(t) || tit.includes(t) || est.includes(t) || mod.includes(t);
        });

        if (escolaBate) return inst;
        if (projsFiltrados.length > 0) {
          return {
            ...inst,
            projetos: projsFiltrados,
          };
        }
        return null;
      })
      .filter((inst): inst is RelatorioInstituicaoItem => inst !== null);
  }, [instituicoesAgrupadas, termo_busca]);

  const instituicoes_ordenadas = useMemo(() => {
    return [...instituicoes_filtradas].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaInst === 'nome') {
        valA = a.nome_instituicao;
        valB = b.nome_instituicao;
      } else if (colunaInst === 'total') {
        valA = a.total_projetos;
        valB = b.total_projetos;
      } else if (colunaInst === 'credenciados') {
        valA = a.total_credenciados;
        valB = b.total_credenciados;
      } else if (colunaInst === 'avaliados') {
        valA = a.total_avaliados;
        valB = b.total_avaliados;
      } else if (colunaInst === 'media') {
        valA = a.media_geral_escola;
        valB = b.media_geral_escola;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoInst === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoInst === 'asc' ? comp : -comp;
    });
  }, [instituicoes_filtradas, colunaInst, direcaoInst]);

  // Lista Completa de Instituições Ordenadas (100% dos dados para Impressão em PDF)
  const instituicoes_todas_ordenadas = useMemo(() => {
    return [...instituicoesAgrupadas].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaInst === 'nome') {
        valA = a.nome_instituicao;
        valB = b.nome_instituicao;
      } else if (colunaInst === 'total') {
        valA = a.total_projetos;
        valB = b.total_projetos;
      } else if (colunaInst === 'credenciados') {
        valA = a.total_credenciados;
        valB = b.total_credenciados;
      } else if (colunaInst === 'avaliados') {
        valA = a.total_avaliados;
        valB = b.total_avaliados;
      } else if (colunaInst === 'media') {
        valA = a.media_geral_escola;
        valB = b.media_geral_escola;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoInst === 'asc' ? valA - valB : valB - valA;
      }
      const comp = compararNatural(String(valA), String(valB));
      return direcaoInst === 'asc' ? comp : -comp;
    });
  }, [instituicoesAgrupadas, colunaInst, direcaoInst]);

  // ============================================================================
  // EXPORTAÇÃO CSV MULTI-ABA
  // ============================================================================
  const exportar_csv = () => {
    let linhas: unknown[][] = [];
    let nomeArquivo = '';

    if (aba_ativa === 'projetos') {
      linhas = [['Código do Projeto', 'Título do Projeto', 'Instituição', 'Modalidade', 'Área Temática', 'Avaliações', 'Média Geral', 'Notas Individuais']];
      projetos_ordenados.forEach((p) => {
        linhas.push([
          p.codigo_projeto || '',
          p.titulo,
          p.nome_instituicao || '',
          p.modalidade,
          p.area_conhecimento,
          p.total_avaliacoes,
          p.media_geral.toFixed(2),
          p.notas.map((n) => n.toFixed(2)).join('; '),
        ]);
      });
      nomeArquivo = 'relatorio_projetos_e_medias.csv';
    } else if (aba_ativa === 'avaliadores') {
      linhas = [['Avaliador', 'E-mail', 'Código Projeto', 'Título do Projeto', 'Nota Atribuída', 'Tempo Inicial', 'Tempo Final', 'Duração', 'Parecer']];
      avaliadores_ordenados.forEach((a) => {
        linhas.push([
          a.avaliador_nome,
          a.avaliador_email,
          a.codigo_projeto || '',
          a.projeto_titulo,
          a.nota_final.toFixed(2),
          formatarHorario(a.tempo_presenca),
          formatarHorario(a.tempo_submissao),
          a.duracao_formatada,
          a.parecer_comentario || '',
        ]);
      });
      nomeArquivo = 'relatorio_avaliadores_e_notas.csv';
    } else if (aba_ativa === 'ausencias') {
      linhas = [['Avaliador', 'E-mail', 'Código Projeto', 'Título do Projeto', 'Modalidade', 'Área Temática', 'Instituição', 'Data/Hora Ausência', 'Status Projeto']];
      ausencias_ordenadas.forEach((a) => {
        linhas.push([
          a.avaliador_nome,
          a.avaliador_email,
          a.codigo_projeto || '',
          a.projeto_titulo,
          a.projeto_modalidade || '',
          a.projeto_area || '',
          a.projeto_instituicao || '',
          formatarDataHora(a.data_ausencia),
          a.total_avaliacoes_atuais > 0 ? `Avaliado (${a.total_avaliacoes_atuais} aval.)` : 'Sem avaliação',
        ]);
      });
      nomeArquivo = 'relatorio_avaliadores_e_ausencias.csv';
    } else if (aba_ativa === 'instituicoes') {
      linhas = [['Instituição', 'Código Projeto', 'Título do Projeto', 'Modalidade', 'Área Temática', 'Status/Média']];
      instituicoes_ordenadas.forEach((inst) => {
        inst.projetos.forEach((p) => {
          let statusProj = 'Aguardando Avaliação';
          if (!p.is_check_in_realizado) statusProj = 'Não Credenciado';
          else if (p.total_avaliacoes > 0) statusProj = `${p.media_geral.toFixed(2)} pts (${p.total_avaliacoes} aval.)`;
          linhas.push([inst.nome_instituicao, p.codigo_projeto || '', p.titulo, p.modalidade, p.area_conhecimento, statusProj]);
        });
      });
      nomeArquivo = 'relatorio_instituicoes_e_projetos.csv';
    } else if (aba_ativa === 'indicadores' && indicadores) {
      linhas = [
        ['Indicador', 'Valor'],
        ['Evento', indicadores.nome_evento],
        ['Data do Evento', formatarDataDDMMYYYY(indicadores.data_evento)],
        ['Horário Inicial', indicadores.horario_inicio || 'Não configurado'],
        ['Horário Final', indicadores.horario_fim || 'Não configurado'],
        ['Projetos Submetidos', indicadores.total_projetos],
        ['Projetos Credenciados', indicadores.projetos_credenciados],
        ['Projetos Ausentes', indicadores.projetos_ausentes],
        ['Projetos Não Credenciados', indicadores.projetos_nao_credenciados],
        ['Taxa de Presença Projetos', `${indicadores.taxa_presenca_projetos}%`],
        ['Avaliadores Cadastrados', indicadores.total_avaliadores],
        ['Avaliadores Credenciados', indicadores.avaliadores_credenciados],
        ['Avaliadores Ausentes', indicadores.avaliadores_ausentes],
        ['Taxa de Comparecimento Avaliadores', `${indicadores.taxa_comparecimento_avaliadores}%`],
        ['Avaliações Realizadas', indicadores.total_avaliacoes_realizadas],
        ['Avaliações na Meta', indicadores.avaliacoes_na_meta],
        ['Meta de Avaliações', indicadores.cota_esperada_total],
        ['% Conclusão da Feira', `${indicadores.porcentagem_conclusao}%`],
        ['Tempo Médio de Avaliação', indicadores.tempo_medio_formatado],
        ['Média Geral de Notas', indicadores.media_geral_notas.toFixed(2)],
        ['Projetos em Quarentena', indicadores.projetos_quarentena],
      ];
      nomeArquivo = 'relatorio_indicadores_gerenciais.csv';
    }

    if (linhas.length === 0) return;
    baixarCsv(nomeArquivo, linhas);
  };

  return (
    <div
      id="relatorio-print-root"
      className="bg-white dark:bg-slate-800 rounded-3xl p-4 sm:p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans print:p-0 print:border-none print:shadow-none print:rounded-none print:space-y-4 print:static print:w-full print:bg-white print:m-0 print:overflow-visible"
    >
      {/* ESTILOS CSS EXCLUSIVOS PARA IMPRESSÃO EM PDF */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: ${aba_ativa === 'indicadores' ? 'A4 landscape' : 'A4 portrait'};
                margin: ${aba_ativa === 'indicadores' ? '8mm' : '10mm'};
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                background: white !important;
                color: black !important;
                overflow: visible !important;
                height: auto !important;
                min-height: 100% !important;
              }
              /* Isola completamente o relatório e oculta tudo o mais no documento (janelas modais, barras de rolagem, backdrop) */
              body * {
                visibility: hidden;
              }
              #relatorio-print-root,
              #relatorio-print-root * {
                visibility: visible;
              }
              #relatorio-print-root {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                box-shadow: none !important;
                background: transparent !important;
                border-radius: 0 !important;
                overflow: visible !important;
                height: auto !important;
              }
              body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                background: white !important;
                color: black !important;
              }
              .print\\:hidden {
                display: none !important;
              }
              .print\\:block {
                display: block !important;
              }
              .print\\:table-row {
                display: table-row !important;
              }
              .print\\:p-0 {
                padding: 0 !important;
              }
              .print\\:p-4 {
                padding: 1rem !important;
              }
              .print-avoid-break {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
            }
          `,
        }}
      />

      {/* CABEÇALHO OFICIAL EXCLUSIVO PARA IMPRESSÃO EM PDF */}
      <div className="hidden print:block print:mb-6 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
              {indicadores?.nome_evento || 'Sistema de Avaliação de Projetos - IFMS'}
            </h1>
            <h2 className="text-sm font-bold text-slate-700">
              {aba_ativa === 'projetos' && 'Relatório de Projetos e Médias'}
              {aba_ativa === 'avaliadores' && 'Relatório de Avaliadores e Notas Atribuídas'}
              {aba_ativa === 'ausencias' && 'Relatório de Avaliadores e Ausências Atribuídas'}
              {aba_ativa === 'instituicoes' && 'Relatório de Instituições e Projetos Submetidos'}
              {aba_ativa === 'indicadores' && `Indicadores do evento: ${indicadores?.nome_evento || 'Evento Ativo'}`}
            </h2>
          </div>
          <div className="text-right text-xs font-semibold text-slate-600">
            <p>Emissão: {new Date().toLocaleString('pt-BR')}</p>
            {indicadores?.data_evento && (
              <p>Data do Evento: {formatarDataDDMMYYYY(indicadores.data_evento)}</p>
            )}
            <p className="text-[10px] font-mono text-slate-500 mt-0.5">
              {aba_ativa === 'projetos' && `Total: ${projetos_todos_ordenados.length} projetos`}
              {aba_ativa === 'avaliadores' && `Total: ${avaliadoresNotas_todos_ordenados.length} avaliadores`}
              {aba_ativa === 'ausencias' && `Total: ${avaliadoresAusencias_todas_ordenadas.length} avaliadores`}
              {aba_ativa === 'instituicoes' && `Total: ${instituicoes_todas_ordenadas.length} instituições`}
            </p>
          </div>
        </div>
      </div>

      {/* CABEÇALHO COM TÍTULO E AÇÕES (TELA) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4 print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 shadow-xs">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              Relatórios Administrativos
            </h2>
            {indicadores?.nome_evento && (
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {indicadores.nome_evento}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={buscar_relatorios}
            disabled={carregando || !idEvento}
            aria-label="Atualizar relatórios"
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-all cursor-pointer"
            title="Atualizar Relatórios"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={imprimir_relatorio}
            disabled={carregando}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
            title="Imprimir ou Salvar em PDF"
          >
            <Printer className="w-4 h-4" />
            Imprimir PDF
          </button>

          <button
            type="button"
            onClick={exportar_csv}
            disabled={carregando}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar (.CSV)
          </button>

          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar Relatórios"
              className="p-2.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              title="Fechar Relatórios"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* BARRA DE NAVEGAÇÃO DAS 5 ABAS (OCULTA NO PRINT) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => set_aba_ativa('projetos')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              aba_ativa === 'projetos'
                ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
            <span onClick={() => set_aba_ativa('projetos')}>Projetos e Médias</span>
            <span className="text-[10px] font-extrabold px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 rounded-full">
              {dados_projetos.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => set_aba_ativa('avaliadores')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              aba_ativa === 'avaliadores'
                ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span onClick={() => set_aba_ativa('avaliadores')}>
              Avaliadores e Notas Atribuídas
            </span>
            <span className="text-[10px] font-extrabold px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 rounded-full">
              {avaliadoresNotasAgrupados.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => set_aba_ativa('ausencias')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              aba_ativa === 'ausencias'
                ? 'bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <UserX className="w-3.5 h-3.5 shrink-0" />
            <span onClick={() => set_aba_ativa('ausencias')}>
              Avaliadores e Ausências Atribuídas
            </span>
            <span className="text-[10px] font-extrabold px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 rounded-full">
              {avaliadoresAusenciasAgrupados.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => set_aba_ativa('instituicoes')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              aba_ativa === 'instituicoes'
                ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 shrink-0" />
            <span onClick={() => set_aba_ativa('instituicoes')}>
              Instituições e Projetos Submetidos
            </span>
            <span className="text-[10px] font-extrabold px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 rounded-full">
              {instituicoesAgrupadas.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => set_aba_ativa('indicadores')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              aba_ativa === 'indicadores'
                ? 'bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 shrink-0" />
            <span onClick={() => set_aba_ativa('indicadores')}>
              Indicadores
            </span>
          </button>
        </div>

        {/* Campo de Busca Rápida (ativo nas abas de listagem) */}
        {aba_ativa !== 'indicadores' && (
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={termo_busca}
              onChange={(e) => set_termo_busca(e.target.value)}
              placeholder={
                aba_ativa === 'projetos'
                  ? 'Buscar por código, título, modalidade...'
                  : aba_ativa === 'avaliadores'
                  ? 'Buscar por avaliador, projeto...'
                  : aba_ativa === 'ausencias'
                  ? 'Buscar por avaliador, projeto...'
                  : 'Buscar por escola ou trabalho...'
              }
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none"
            />
          </div>
        )}
      </div>

      {!idEvento && (
        <div role="alert" className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs sm:text-sm text-amber-800 dark:text-amber-200 font-semibold print:hidden">
          Não há evento ativo. Os relatórios são de cada evento: ative um evento para vê-los.
        </div>
      )}

      {mensagem_erro && (
        <div role="alert" className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl flex items-center gap-2 text-xs sm:text-sm text-red-800 dark:text-red-200 font-semibold print:hidden">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          {mensagem_erro}
        </div>
      )}

      {/* CARREGAMENTO */}
      {carregando && (
        <div className="p-12 text-center space-y-2">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">
            Carregando relatórios e indicadores...
          </p>
        </div>
      )}

      {/* ==================================================================== */}
      {/* ABA 1: PROJETOS E MÉDIAS (com Código do Projeto e Notas Individuais) */}
      {/* ==================================================================== */}
      {!carregando && aba_ativa === 'projetos' && (
        <>
          {/* TABELA INTERATIVA PARA TELA */}
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-2xl print:hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 uppercase font-extrabold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <CabecalhoOrdenavel coluna="codigo" rotulo="Código do Projeto" ativa={colunaProj} direcao={direcaoProj} aoOrdenar={alternarOrdenacaoProj} />
                  <CabecalhoOrdenavel coluna="titulo" rotulo="Título do Projeto" ativa={colunaProj} direcao={direcaoProj} aoOrdenar={alternarOrdenacaoProj} />
                  <CabecalhoOrdenavel coluna="modalidade" rotulo="Modalidade / Área" ativa={colunaProj} direcao={direcaoProj} aoOrdenar={alternarOrdenacaoProj} />
                  <CabecalhoOrdenavel coluna="avaliacoes" rotulo="Avaliações" ativa={colunaProj} direcao={direcaoProj} aoOrdenar={alternarOrdenacaoProj} />
                  <CabecalhoOrdenavel coluna="media" rotulo="Média Geral" ativa={colunaProj} direcao={direcaoProj} aoOrdenar={alternarOrdenacaoProj} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {projetos_ordenados.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500 font-semibold">
                      Nenhum projeto encontrado no relatório.
                    </td>
                  </tr>
                ) : (
                  projetos_ordenados.map((item) => {
                    const expandido = projetosExpandidos.has(item.id_projeto);
                    const notas = item.notas || [];
                    const detalhes = item.detalhes_avaliacoes || [];

                    return (
                      <React.Fragment key={item.id_projeto}>
                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="px-4 py-3 font-mono">
                            <span className="font-extrabold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2 py-0.5 rounded text-[11px]">
                              {item.codigo_projeto || 'N/I'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-slate-900 dark:text-white block">
                              {item.titulo}
                            </span>
                            {item.nome_instituicao && (
                              <span className="text-[11px] text-slate-500 block">
                                {item.nome_instituicao}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                              {item.modalidade}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {item.area_conhecimento}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => alternarExpansaoProjeto(item.id_projeto)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/80 transition-all cursor-pointer shadow-2xs"
                              title="Clique para ver todas as notas deste projeto"
                            >
                              <span>
                                {item.total_avaliacoes} {item.total_avaliacoes === 1 ? 'avaliação' : 'avaliações'}
                              </span>
                              {expandido ? (
                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-mono text-base font-black text-emerald-700 dark:text-emerald-400">
                              {item.media_geral.toFixed(2)} pts
                            </span>
                          </td>
                        </tr>

                        {/* ACCORDION EXPANSÍVEL NA TELA: Todas as notas recebidas com avaliador, data e parecer */}
                        {expandido && (
                          <tr className="bg-slate-50/80 dark:bg-slate-900/60 border-t border-b border-emerald-100 dark:border-emerald-900/40">
                            <td colSpan={5} className="px-6 py-4">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                                    Notas e Avaliações Recebidas ({detalhes.length || notas.length})
                                  </h4>
                                  <span className="text-[11px] font-mono font-bold text-slate-500">
                                    Média: {item.media_geral.toFixed(2)} pts
                                  </span>
                                </div>

                                {detalhes.length === 0 && notas.length === 0 ? (
                                  <p className="text-xs text-slate-500 italic">
                                    Nenhuma nota atribuída a este projeto até o momento.
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {detalhes.length > 0
                                      ? detalhes.map((d, idx) => (
                                          <div
                                            key={d.id_avaliacao || idx}
                                            className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5 shadow-xs"
                                          >
                                            <div className="flex items-center justify-between">
                                              <span className="font-bold text-slate-900 dark:text-white text-xs truncate">
                                                {d.avaliador_nome}
                                              </span>
                                              <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                {Number(d.nota_final).toFixed(2)} pts
                                              </span>
                                            </div>
                                            {d.data && (
                                              <span className="text-[10px] text-slate-400 block">
                                                {formatarDataHora(d.data)}
                                              </span>
                                            )}
                                            {d.parecer ? (
                                              <p className="text-[11px] text-slate-600 dark:text-slate-300 italic line-clamp-3 bg-slate-50 dark:bg-slate-900/50 p-2 rounded">
                                                {d.parecer}
                                              </p>
                                            ) : (
                                              <span className="text-[10px] text-slate-400 italic">
                                                Sem parecer registrado
                                              </span>
                                            )}
                                          </div>
                                        ))
                                      : notas.map((nota, idx) => (
                                          <div
                                            key={idx}
                                            className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between"
                                          >
                                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                              Avaliação #{idx + 1}
                                            </span>
                                            <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                                              {Number(nota).toFixed(2)} pts
                                            </span>
                                          </div>
                                        ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* LISTA PURAMENTE TEXTUAL EXCLUSIVA PARA IMPRESSÃO EM PDF (100% DOS DADOS) */}
          <div className="hidden print:block space-y-3">
            {projetos_todos_ordenados.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4">Nenhum projeto registrado no evento.</p>
            ) : (
              projetos_todos_ordenados.map((item) => {
                const detalhes = item.detalhes_avaliacoes || [];

                return (
                  <div key={item.id_projeto} className="border-b border-slate-300 pb-2 mb-2 print-avoid-break text-xs">
                    <div className="font-bold text-slate-900 text-sm">
                      [{item.codigo_projeto || 'N/I'}] {item.titulo}
                    </div>
                    <div className="text-[11px] text-slate-700 font-medium">
                      Modalidade: {item.modalidade} | Área: {item.area_conhecimento}
                      {item.nome_instituicao && ` | Instituição: ${item.nome_instituicao}`}
                      {` | Avaliações: ${item.total_avaliacoes} | Média Geral: ${item.media_geral.toFixed(2)} pts`}
                    </div>
                    {/* Avaliações recebidas recuadas à direita */}
                    <div className="ml-6 border-l-2 border-slate-400 pl-3 mt-1.5 space-y-1 text-[10px] text-slate-800">
                      <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                        Avaliações Recebidas ({detalhes.length}):
                      </span>
                      {detalhes.length === 0 ? (
                        <span className="italic text-slate-500 block">
                          Nenhuma avaliação recebida até o momento.
                        </span>
                      ) : (
                        detalhes.map((d, dIdx) => (
                          <div key={d.id_avaliacao || dIdx} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-bold text-slate-900">• {d.avaliador_nome}:</span>
                            <span className="font-mono font-bold text-slate-900">{Number(d.nota_final).toFixed(2)} pts</span>
                            {d.data && (
                              <span className="text-slate-600 font-mono text-[9px]">
                                ({formatarDataHora(d.data)})
                              </span>
                            )}
                            {d.parecer && <span className="italic text-slate-700">— "{d.parecer}"</span>}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ==================================================================== */}
      {/* ABA 2: AVALIADORES E NOTAS ATRIBUÍDAS (NOVO - Accordion por Avaliador) */}
      {/* ==================================================================== */}
      {!carregando && aba_ativa === 'avaliadores' && (
        <>
          <div className="space-y-4 print:hidden">
          {/* Barra de Ações do Accordion */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Total de Avaliadores:{' '}
              <strong className="text-slate-900 dark:text-white">
                {avaliadoresNotas_ordenados.length}
              </strong>
            </span>
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() =>
                  alternarTodosAvaliadoresNotas(
                    true,
                    avaliadoresNotas_ordenados.map((a) => a.id_usuario)
                  )
                }
                className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Expandir Todos
              </button>
              <button
                type="button"
                onClick={() => alternarTodosAvaliadoresNotas(false, [])}
                className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Recolher Todos
              </button>
            </div>
          </div>

          {avaliadoresNotas_ordenados.length === 0 ? (
            <div className="p-12 text-center text-slate-500 font-semibold border border-slate-200 dark:border-slate-700 rounded-2xl">
              Nenhum avaliador encontrado com os filtros informados.
            </div>
          ) : (
            <div className="space-y-3">
              {avaliadoresNotas_ordenados.map((avalGrupo) => {
                const expandido = avaliadoresNotasExpandidos.has(avalGrupo.id_usuario);

                return (
                  <div
                    key={avalGrupo.id_usuario}
                    className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-2xs transition-all print:border-0 print:border-b print:border-slate-300 print:rounded-none print:shadow-none print-avoid-break print:pb-3 print:mb-3"
                  >
                    {/* Linha do Avaliador (Cabeçalho Accordion) */}
                    <div
                      onClick={() => alternarExpansaoAvaliadorNotas(avalGrupo.id_usuario)}
                      className="p-4 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors select-none print:bg-transparent print:p-0 print:border-none print:cursor-default"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 print:hidden">
                          <Users className="w-4 h-4 shrink-0" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-slate-900 dark:text-white print:text-black print:text-sm">
                            {avalGrupo.avaliador_nome}
                          </h3>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-600">
                            {avalGrupo.avaliador_email}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-xs font-semibold print:hidden">
                        <span className="px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold">
                          {avalGrupo.total_avaliacoes} {avalGrupo.total_avaliacoes === 1 ? 'avaliação' : 'avaliações'}
                        </span>
                        {avalGrupo.media_notas > 0 && (
                          <span className="font-mono text-sm font-black text-emerald-700 dark:text-emerald-400">
                            Média: {avalGrupo.media_notas.toFixed(2)} pts
                          </span>
                        )}
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-mono">
                          Tempo Médio: {avalGrupo.tempo_medio_formatado}
                        </span>
                        <div className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                          {expandido ? (
                            <ChevronDown className="w-5 h-5" />
                          ) : (
                            <ChevronRight className="w-5 h-5" />
                          )}
                        </div>
                      </div>

                      {/* Resumo textual do avaliador exclusivo para impressão em PDF */}
                      <div className="hidden print:block text-right text-xs font-semibold text-slate-800">
                        <span>{avalGrupo.total_avaliacoes} {avalGrupo.total_avaliacoes === 1 ? 'avaliação' : 'avaliações'}</span>
                        {avalGrupo.media_notas > 0 && (
                          <span> • Média: {avalGrupo.media_notas.toFixed(2)} pts</span>
                        )}
                        <span> • Tempo Médio: {avalGrupo.tempo_medio_formatado}</span>
                      </div>
                    </div>

                    {/* Projetos Avaliados pelo Avaliador */}
                    <div className={`${expandido ? 'block' : 'hidden'} print:block overflow-x-auto border-t border-slate-200 dark:border-slate-700 print:border-none print:mt-1`}>
                      {/* Tabela interativa para tela */}
                      <table className="w-full text-left text-xs bg-white dark:bg-slate-800 print:hidden">
                        <thead className="bg-slate-100/60 dark:bg-slate-900/40 text-slate-500 uppercase font-extrabold text-[10px]">
                          <tr>
                            <th className="px-4 py-2.5">Código</th>
                            <th className="px-4 py-2.5">Projeto Avaliado</th>
                            <th className="px-4 py-2.5 text-right">Nota</th>
                            <th className="px-4 py-2.5 text-center">Início</th>
                            <th className="px-4 py-2.5 text-center">Fim</th>
                            <th className="px-4 py-2.5 text-center">Tempo</th>
                            <th className="px-4 py-2.5">Parecer</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                          {avalGrupo.avaliacoes.map((item) => (
                            <tr key={item.id_avaliacao} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                              <td className="px-4 py-3 font-mono">
                                <span className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-[11px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                                  {item.codigo_projeto || 'N/I'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="font-bold text-slate-900 dark:text-white block">
                                  {item.projeto_titulo}
                                </span>
                                {(item.projeto_modalidade || item.projeto_area) && (
                                  <span className="text-[10px] text-slate-500">
                                    {[item.projeto_modalidade, item.projeto_area].filter(Boolean).join(' • ')}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="font-mono text-sm font-black text-emerald-700 dark:text-emerald-400">
                                  {item.nota_final.toFixed(2)} pts
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {formatarHorario(item.tempo_presenca)}
                              </td>
                              <td className="px-4 py-3 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {formatarHorario(item.tempo_submissao || item.data_avaliacao)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="font-mono text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
                                  {item.duracao_formatada}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-slate-600 dark:text-slate-300 text-xs italic line-clamp-2 max-w-sm">
                                  {item.parecer_comentario || '--'}
                                </p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Lista textual recuada exclusiva para impressão em PDF */}
                      <div className="hidden print:block ml-6 pl-3 border-l-2 border-slate-400 space-y-1.5 pt-1 text-xs text-slate-800">
                        <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                          Projetos Avaliados ({avalGrupo.avaliacoes.length}):
                        </span>
                        {avalGrupo.avaliacoes.map((item) => (
                          <div key={item.id_avaliacao} className="space-y-0.5">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-bold text-slate-900">
                                • [{item.codigo_projeto || 'N/I'}] {item.projeto_titulo}
                              </span>
                              {(item.projeto_modalidade || item.projeto_area) && (
                                <span className="text-[10px] text-slate-600">
                                  ({[item.projeto_modalidade, item.projeto_area].filter(Boolean).join(' • ')})
                                </span>
                              )}
                              <span className="font-mono font-bold text-slate-900">
                                — Nota: {item.nota_final.toFixed(2)} pts
                              </span>
                              <span className="text-[10px] text-slate-600 font-mono">
                                [Início: {formatarHorario(item.tempo_presenca)} | Fim: {formatarHorario(item.tempo_submissao || item.data_avaliacao)} | Duração: {item.duracao_formatada}]
                              </span>
                            </div>
                            {item.parecer_comentario && (
                              <p className="ml-3 text-[11px] text-slate-700 italic">
                                Parecer: "{item.parecer_comentario}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* LISTA PURAMENTE TEXTUAL EXCLUSIVA PARA IMPRESSÃO EM PDF (100% DOS DADOS) */}
        <div className="hidden print:block space-y-3">
          {avaliadoresNotas_todos_ordenados.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-4">Nenhum avaliador registrado no evento.</p>
          ) : (
            avaliadoresNotas_todos_ordenados.map((avalGrupo) => (
              <div key={avalGrupo.id_usuario} className="border-b border-slate-300 pb-2 mb-2 print-avoid-break text-xs">
                <div className="font-bold text-slate-900 text-sm">
                  {avalGrupo.avaliador_nome} ({avalGrupo.avaliador_email})
                </div>
                <div className="text-[11px] text-slate-700 font-medium">
                  Total de Avaliações: {avalGrupo.total_avaliacoes}
                  {avalGrupo.media_notas > 0 && ` | Média das Notas: ${avalGrupo.media_notas.toFixed(2)} pts`}
                  {` | Tempo Médio: ${avalGrupo.tempo_medio_formatado}`}
                </div>
                {/* Projetos avaliados recuados à direita */}
                <div className="ml-6 border-l-2 border-slate-400 pl-3 mt-1.5 space-y-1 text-[10px] text-slate-800">
                  <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                    Projetos Avaliados ({avalGrupo.avaliacoes.length}):
                  </span>
                  {avalGrupo.avaliacoes.length === 0 ? (
                    <p className="italic text-slate-500">Nenhuma avaliação registrada.</p>
                  ) : (
                    avalGrupo.avaliacoes.map((item) => (
                      <div key={item.id_avaliacao} className="space-y-0.5">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-bold text-slate-900">
                            • [{item.codigo_projeto || 'N/I'}] {item.projeto_titulo}
                          </span>
                          {(item.projeto_modalidade || item.projeto_area) && (
                            <span className="text-[10px] text-slate-600">
                              ({[item.projeto_modalidade, item.projeto_area].filter(Boolean).join(' • ')})
                            </span>
                          )}
                          <span className="font-mono font-bold text-slate-900">
                            — Nota: {item.nota_final.toFixed(2)} pts
                          </span>
                          <span className="text-[10px] text-slate-600 font-mono">
                            [Início: {formatarHorario(item.tempo_presenca)} | Fim: {formatarHorario(item.tempo_submissao || item.data_avaliacao)} | Duração: {item.duracao_formatada}]
                          </span>
                        </div>
                        {item.parecer_comentario && (
                          <p className="ml-3 text-[10px] text-slate-700 italic">
                            Parecer: "{item.parecer_comentario}"
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </>
    )}

      {/* ==================================================================== */}
      {/* ABA 3: AVALIADORES E AUSÊNCIAS ATRIBUÍDAS (NOVO - Accordion por Avaliador) */}
      {/* ==================================================================== */}
      {!carregando && aba_ativa === 'ausencias' && (
        <>
          <div className="space-y-4 print:hidden">
          {/* Barra de Ações do Accordion */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Total de Avaliadores com Ausências:{' '}
              <strong className="text-slate-900 dark:text-white">
                {avaliadoresAusencias_ordenados.length}
              </strong>
            </span>
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() =>
                  alternarTodosAvaliadoresAusencias(
                    true,
                    avaliadoresAusencias_ordenados.map((a) => a.id_usuario)
                  )
                }
                className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Expandir Todos
              </button>
              <button
                type="button"
                onClick={() => alternarTodosAvaliadoresAusencias(false, [])}
                className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Recolher Todos
              </button>
            </div>
          </div>

          {avaliadoresAusencias_ordenados.length === 0 ? (
            <div className="p-12 text-center text-slate-500 font-semibold border border-slate-200 dark:border-slate-700 rounded-2xl">
              Nenhuma ausência registrada com os filtros informados.
            </div>
          ) : (
            <div className="space-y-3">
              {avaliadoresAusencias_ordenados.map((ausGrupo) => {
                const expandido = avaliadoresAusenciasExpandidos.has(ausGrupo.id_usuario);

                return (
                  <div
                    key={ausGrupo.id_usuario}
                    className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-2xs transition-all print:border-0 print:border-b print:border-slate-300 print:rounded-none print:shadow-none print-avoid-break print:pb-3 print:mb-3"
                  >
                    {/* Linha do Avaliador (Cabeçalho Accordion) */}
                    <div
                      onClick={() => alternarExpansaoAvaliadorAusencias(ausGrupo.id_usuario)}
                      className="p-4 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors select-none print:bg-transparent print:p-0 print:border-none print:cursor-default"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 print:hidden">
                          <UserX className="w-4 h-4 shrink-0" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-slate-900 dark:text-white print:text-black print:text-sm">
                            {ausGrupo.avaliador_nome}
                          </h3>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-600">
                            {ausGrupo.avaliador_email}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-xs font-semibold print:hidden">
                        <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[11px] font-bold">
                          {ausGrupo.total_ausencias} {ausGrupo.total_ausencias === 1 ? 'ausência atribuída' : 'ausências atribuídas'}
                        </span>
                        <div className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                          {expandido ? (
                            <ChevronDown className="w-5 h-5" />
                          ) : (
                            <ChevronRight className="w-5 h-5" />
                          )}
                        </div>
                      </div>

                      {/* Resumo textual do avaliador exclusivo para impressão em PDF */}
                      <div className="hidden print:block text-right text-xs font-semibold text-slate-800">
                        <span>{ausGrupo.total_ausencias} {ausGrupo.total_ausencias === 1 ? 'ausência atribuída' : 'ausências atribuídas'}</span>
                      </div>
                    </div>

                    {/* Projetos Marcados como Ausente */}
                    <div className={`${expandido ? 'block' : 'hidden'} print:block overflow-x-auto border-t border-slate-200 dark:border-slate-700 print:border-none print:mt-1`}>
                      {/* Tabela interativa para tela */}
                      <table className="w-full text-left text-xs bg-white dark:bg-slate-800 print:hidden">
                        <thead className="bg-slate-100/60 dark:bg-slate-900/40 text-slate-500 uppercase font-extrabold text-[10px]">
                          <tr>
                            <th className="px-4 py-2.5">Código</th>
                            <th className="px-4 py-2.5">Projeto Marcado como Ausente</th>
                            <th className="px-4 py-2.5">Modalidade / Área</th>
                            <th className="px-4 py-2.5 text-center">Data / Hora Ausência</th>
                            <th className="px-4 py-2.5 text-center">Status Atual do Projeto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                          {ausGrupo.ausencias.map((item, idx) => (
                            <tr key={`${item.id_projeto}_${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                              <td className="px-4 py-3 font-mono">
                                <span className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-[11px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                                  {item.codigo_projeto || 'N/I'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="font-bold text-slate-900 dark:text-white block">
                                  {item.projeto_titulo}
                                </span>
                                {item.projeto_instituicao && (
                                  <span className="text-[10px] text-slate-500 block truncate">
                                    {item.projeto_instituicao}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                                  {item.projeto_modalidade || 'Sem modalidade'}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  {item.projeto_area || 'Sem área temática'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {formatarDataHora(item.data_ausencia)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {item.total_avaliacoes_atuais > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                    Avaliado ({item.total_avaliacoes_atuais} {item.total_avaliacoes_atuais === 1 ? 'aval.' : 'aval.'})
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                    <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                                    Permanece sem avaliação
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Lista textual recuada exclusiva para impressão em PDF */}
                      <div className="hidden print:block ml-6 pl-3 border-l-2 border-slate-400 space-y-1.5 pt-1 text-xs text-slate-800">
                        <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                          Projetos Marcados como Ausente ({ausGrupo.ausencias.length}):
                        </span>
                        {ausGrupo.ausencias.map((item, idx) => {
                          const statusTexto = item.total_avaliacoes_atuais > 0
                            ? `Avaliado (${item.total_avaliacoes_atuais} ${item.total_avaliacoes_atuais === 1 ? 'avaliação' : 'avaliações'})`
                            : 'Permanece sem avaliação';

                          return (
                            <div key={`${item.id_projeto}_${idx}`} className="space-y-0.5">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-bold text-slate-900">
                                  • [{item.codigo_projeto || 'N/I'}] {item.projeto_titulo}
                                </span>
                                {(item.projeto_modalidade || item.projeto_area) && (
                                  <span className="text-[10px] text-slate-600">
                                    ({[item.projeto_modalidade, item.projeto_area].filter(Boolean).join(' • ')})
                                  </span>
                                )}
                                {item.projeto_instituicao && (
                                  <span className="text-[10px] text-slate-600">
                                    — {item.projeto_instituicao}
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-600 font-mono">
                                  [Registro: {formatarDataHora(item.data_ausencia)}]
                                </span>
                                <span className="text-[10px] font-semibold text-slate-900">
                                  — Status: {statusTexto}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* LISTA PURAMENTE TEXTUAL EXCLUSIVA PARA IMPRESSÃO EM PDF (100% DOS DADOS) */}
        <div className="hidden print:block space-y-3">
          {avaliadoresAusencias_todas_ordenadas.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-4">Nenhuma ausência registrada no evento.</p>
          ) : (
            avaliadoresAusencias_todas_ordenadas.map((ausGrupo) => (
              <div key={ausGrupo.id_usuario} className="border-b border-slate-300 pb-2 mb-2 print-avoid-break text-xs">
                <div className="font-bold text-slate-900 text-sm">
                  {ausGrupo.avaliador_nome} ({ausGrupo.avaliador_email})
                </div>
                <div className="text-[11px] text-slate-700 font-medium">
                  Total de Ausências Atribuídas: {ausGrupo.total_ausencias}
                </div>
                {/* Projetos marcados como ausente recuados à direita */}
                <div className="ml-6 border-l-2 border-slate-400 pl-3 mt-1.5 space-y-1 text-[10px] text-slate-800">
                  <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                    Projetos Marcados como Ausente ({ausGrupo.ausencias.length}):
                  </span>
                  {ausGrupo.ausencias.length === 0 ? (
                    <p className="italic text-slate-500">Nenhuma ausência registrada.</p>
                  ) : (
                    ausGrupo.ausencias.map((item, idx) => {
                      const statusTexto = item.total_avaliacoes_atuais > 0
                        ? `Avaliado (${item.total_avaliacoes_atuais} ${item.total_avaliacoes_atuais === 1 ? 'avaliação' : 'avaliações'})`
                        : 'Permanece sem avaliação';

                      return (
                        <div key={`${item.id_projeto}_${idx}`} className="space-y-0.5">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-bold text-slate-900">
                              • [{item.codigo_projeto || 'N/I'}] {item.projeto_titulo}
                            </span>
                            {(item.projeto_modalidade || item.projeto_area) && (
                              <span className="text-[10px] text-slate-600">
                                ({[item.projeto_modalidade, item.projeto_area].filter(Boolean).join(' • ')})
                              </span>
                            )}
                            {item.projeto_instituicao && (
                              <span className="text-[10px] text-slate-600">
                                — {item.projeto_instituicao}
                              </span>
                            )}
                            <span className="text-[10px] text-slate-600 font-mono">
                              [Registro: {formatarDataHora(item.data_ausencia)}]
                            </span>
                            <span className="text-[10px] font-semibold text-slate-900">
                              — Status: {statusTexto}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </>
    )}

      {/* ==================================================================== */}
      {/* ABA 4: INSTITUIÇÕES E PROJETOS SUBMETIDOS (Accordion por Escola) */}
      {/* ==================================================================== */}
      {!carregando && aba_ativa === 'instituicoes' && (
        <>
          <div className="space-y-4 print:hidden">
          {/* Barra de Ações do Accordion */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Total de Escolas / Instituições:{' '}
              <strong className="text-slate-900 dark:text-white">{instituicoes_ordenadas.length}</strong>
            </span>
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() =>
                  alternarTodasInstituicoes(
                    true,
                    instituicoes_ordenadas.map((i) => i.id_instituicao)
                  )
                }
                className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Expandir Todos
              </button>
              <button
                type="button"
                onClick={() => alternarTodasInstituicoes(false, [])}
                className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Recolher Todos
              </button>
            </div>
          </div>

          {instituicoes_ordenadas.length === 0 ? (
            <div className="p-12 text-center text-slate-500 font-semibold border border-slate-200 dark:border-slate-700 rounded-2xl">
              Nenhuma instituição encontrada com os filtros informados.
            </div>
          ) : (
            <div className="space-y-3">
              {instituicoes_ordenadas.map((inst) => {
                const expandida = instituicoesExpandidas.has(inst.id_instituicao);

                return (
                  <div
                    key={inst.id_instituicao}
                    className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-2xs transition-all print:border-0 print:border-b print:border-slate-300 print:rounded-none print:shadow-none print-avoid-break print:pb-3 print:mb-3"
                  >
                    {/* Linha da Instituição (Card / Cabeçalho Accordion) */}
                    <div
                      onClick={() => alternarExpansaoInstituicao(inst.id_instituicao)}
                      className="p-4 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors select-none print:bg-transparent print:p-0 print:border-none print:cursor-default"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 print:hidden">
                          <Building2 className="w-4 h-4 shrink-0" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-slate-900 dark:text-white print:text-black print:text-sm">
                            {inst.nome_instituicao}
                          </h3>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-600">
                            {inst.total_projetos} {inst.total_projetos === 1 ? 'trabalho submetido' : 'trabalhos submetidos'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-semibold print:hidden">
                        <div className="flex items-center gap-3">
                          <span className="px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px]">
                            {inst.total_credenciados} credenciados
                          </span>
                          <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
                            {inst.total_avaliados} avaliados
                          </span>
                          {inst.media_geral_escola > 0 && (
                            <span className="font-mono text-sm font-black text-indigo-700 dark:text-indigo-400">
                              Média: {inst.media_geral_escola.toFixed(2)} pts
                            </span>
                          )}
                        </div>
                        <div className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                          {expandida ? (
                            <ChevronDown className="w-5 h-5" />
                          ) : (
                            <ChevronRight className="w-5 h-5" />
                          )}
                        </div>
                      </div>

                      {/* Resumo textual da Instituição exclusivo para impressão em PDF */}
                      <div className="hidden print:block text-right text-xs font-semibold text-slate-800">
                        <span>{inst.total_credenciados} credenciados • {inst.total_avaliados} avaliados</span>
                        {inst.media_geral_escola > 0 && (
                          <span> • Média: {inst.media_geral_escola.toFixed(2)} pts</span>
                        )}
                      </div>
                    </div>

                    {/* Trabalhos Submetidos da Escola (Subtabela na tela, Lista textual no print) */}
                    <div className={`${expandida ? 'block' : 'hidden'} print:block overflow-x-auto border-t border-slate-200 dark:border-slate-700 print:border-none print:mt-1`}>
                      {/* Tabela interativa para tela */}
                      <table className="w-full text-left text-xs bg-white dark:bg-slate-800 print:hidden">
                        <thead className="bg-slate-100/60 dark:bg-slate-900/40 text-slate-500 uppercase font-extrabold text-[10px]">
                          <tr>
                            <th className="px-4 py-2.5">Código</th>
                            <th className="px-4 py-2.5">Título do Projeto</th>
                            <th className="px-4 py-2.5">Área Temática</th>
                            <th className="px-4 py-2.5">Modalidade</th>
                            <th className="px-4 py-2.5 text-right">Status / Média Geral</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                          {inst.projetos.map((proj) => {
                            const idsAusentes = new Set(dados_ausencias.map((a) => a.id_projeto));
                            const foiMarcadoAusente = idsAusentes.has(proj.id_projeto);

                            let badgeStatus = null;
                            if (!proj.is_check_in_realizado) {
                              badgeStatus = (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                  Não Credenciado
                                </span>
                              );
                            } else if (proj.total_avaliacoes > 0) {
                              badgeStatus = (
                                <span className="font-mono text-xs font-black text-emerald-700 dark:text-emerald-400">
                                  {proj.media_geral.toFixed(2)} pts ({proj.total_avaliacoes} {proj.total_avaliacoes === 1 ? 'aval.' : 'aval.'})
                                </span>
                              );
                            } else if (foiMarcadoAusente) {
                              badgeStatus = (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                  Marcado como Ausente
                                </span>
                              );
                            } else {
                              badgeStatus = (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  Aguardando Avaliação
                                </span>
                              );
                            }

                            return (
                              <tr key={proj.id_projeto} className="hover:bg-slate-50 dark:hover:bg-slate-700/20">
                                <td className="px-4 py-2.5 font-mono">
                                  <span className="font-extrabold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2 py-0.5 rounded text-[10px]">
                                    {proj.codigo_projeto || 'N/I'}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="font-semibold text-slate-900 dark:text-white block">
                                    {proj.titulo}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                                  {proj.area_conhecimento}
                                </td>
                                <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                                  {proj.modalidade}
                                </td>
                                <td className="px-4 py-2.5 text-right font-medium">
                                  {badgeStatus}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {/* Lista textual recuada exclusiva para impressão em PDF */}
                      <div className="hidden print:block ml-6 pl-3 border-l-2 border-slate-400 space-y-1.5 pt-1 text-xs text-slate-800">
                        <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                          Trabalhos Submetidos ({inst.projetos.length}):
                        </span>
                        {inst.projetos.map((proj) => {
                          const idsAusentes = new Set(dados_ausencias.map((a) => a.id_projeto));
                          const foiMarcadoAusente = idsAusentes.has(proj.id_projeto);

                          let statusTexto = 'Aguardando Avaliação';
                          if (!proj.is_check_in_realizado) {
                            statusTexto = 'Não Credenciado';
                          } else if (proj.total_avaliacoes > 0) {
                            statusTexto = `Avaliado (Média: ${proj.media_geral.toFixed(2)} pts - ${proj.total_avaliacoes} ${proj.total_avaliacoes === 1 ? 'aval.' : 'aval.'})`;
                          } else if (foiMarcadoAusente) {
                            statusTexto = 'Marcado como Ausente';
                          }

                          return (
                            <div key={proj.id_projeto} className="space-y-0.5">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-bold text-slate-900">
                                  • [{proj.codigo_projeto || 'N/I'}] {proj.titulo}
                                </span>
                                {(proj.modalidade || proj.area_conhecimento) && (
                                  <span className="text-[10px] text-slate-600">
                                    ({[proj.modalidade, proj.area_conhecimento].filter(Boolean).join(' • ')})
                                  </span>
                                )}
                                <span className="text-[10px] font-semibold text-slate-900">
                                  — Status: {statusTexto}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* LISTA PURAMENTE TEXTUAL EXCLUSIVA PARA IMPRESSÃO EM PDF (100% DOS DADOS) */}
        <div className="hidden print:block space-y-3">
          {instituicoes_todas_ordenadas.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-4">Nenhuma instituição registrada no evento.</p>
          ) : (
            instituicoes_todas_ordenadas.map((inst) => (
              <div key={inst.id_instituicao} className="border-b border-slate-300 pb-2 mb-2 print-avoid-break text-xs">
                <div className="font-bold text-slate-900 text-sm">
                  Escola / Instituição: {inst.nome_instituicao}
                </div>
                <div className="text-[11px] text-slate-700 font-medium">
                  Total de Trabalhos Submetidos: {inst.total_projetos} | Credenciados: {inst.total_credenciados} | Avaliados: {inst.total_avaliados}
                  {inst.media_geral_escola > 0 && ` | Média Geral da Escola: ${inst.media_geral_escola.toFixed(2)} pts`}
                </div>
                {/* Trabalhos da escola recuados à direita */}
                <div className="ml-6 border-l-2 border-slate-400 pl-3 mt-1.5 space-y-1 text-[10px] text-slate-800">
                  <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                    Trabalhos Submetidos ({inst.projetos.length}):
                  </span>
                  {inst.projetos.length === 0 ? (
                    <p className="italic text-slate-500">Nenhum trabalho submetido.</p>
                  ) : (
                    inst.projetos.map((proj) => {
                      const idsAusentes = new Set(dados_ausencias.map((a) => a.id_projeto));
                      const foiMarcadoAusente = idsAusentes.has(proj.id_projeto);

                      let statusTexto = 'Aguardando Avaliação';
                      if (!proj.is_check_in_realizado) {
                        statusTexto = 'Não Credenciado';
                      } else if (proj.total_avaliacoes > 0) {
                        statusTexto = `Avaliado (Média: ${proj.media_geral.toFixed(2)} pts - ${proj.total_avaliacoes} ${proj.total_avaliacoes === 1 ? 'aval.' : 'aval.'})`;
                      } else if (foiMarcadoAusente) {
                        statusTexto = 'Marcado como Ausente';
                      }

                      return (
                        <div key={proj.id_projeto} className="space-y-0.5">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-bold text-slate-900">
                              • [{proj.codigo_projeto || 'N/I'}] {proj.titulo}
                            </span>
                            {(proj.modalidade || proj.area_conhecimento) && (
                              <span className="text-[10px] text-slate-600">
                                ({[proj.modalidade, proj.area_conhecimento].filter(Boolean).join(' • ')})
                              </span>
                            )}
                            <span className="text-[10px] font-semibold text-slate-900">
                              — Status: {statusTexto}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </>
    )}

      {/* ==================================================================== */}
      {/* ABA 5: INDICADORES GERENCIAIS (DASHBOARD EXECUTIVO) */}
      {/* ==================================================================== */}
      {!carregando && aba_ativa === 'indicadores' && indicadores && (
        <div className="space-y-6">
          {/* Card 1: Indicadores do Evento e Horários */}
          <div className="bg-slate-50 dark:bg-slate-900/60 p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4 print:p-4 print-avoid-break">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 rounded-xl">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg lg:text-xl font-black text-slate-900 dark:text-white">
                  Indicadores do evento: {indicadores.nome_evento || 'Evento Ativo'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 font-semibold">
                  Data do Evento: <strong className="text-slate-800 dark:text-slate-100">{formatarDataDDMMYYYY(indicadores.data_evento)}</strong>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
              <div className="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Horário Inicial</span>
                <span className="font-mono text-sm sm:text-base font-black text-slate-900 dark:text-white">
                  {indicadores.horario_inicio ? (indicadores.horario_inicio.length >= 5 ? indicadores.horario_inicio.substring(0, 5) : indicadores.horario_inicio) : '--:--'}
                </span>
              </div>
              <div className="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Horário Final</span>
                <span className="font-mono text-sm sm:text-base font-black text-slate-900 dark:text-white">
                  {indicadores.horario_fim ? (indicadores.horario_fim.length >= 5 ? indicadores.horario_fim.substring(0, 5) : indicadores.horario_fim) : '--:--'}
                </span>
              </div>
              <div className="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Cota Mínima</span>
                <span className="font-mono text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400">
                  {indicadores.cota_padrao} avaliações / proj.
                </span>
              </div>
            </div>
          </div>

          {/* Grid de KPIs Principais (Fontes Ampliadas para A4 Paisagem) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:grid-cols-4 print-avoid-break">
            {/* KPI 1: Projetos Submetidos / Credenciados */}
            <div className="p-5 sm:p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-2 print:p-4">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-bold uppercase tracking-wider">Projetos</span>
                <FolderGit2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                  {indicadores.projetos_credenciados}{' '}
                  <span className="text-xs sm:text-sm font-normal text-slate-400">/ {indicadores.total_projetos}</span>
                </span>
                <span className="text-xs font-bold text-emerald-600">
                  {indicadores.taxa_presenca_projetos}% presença
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700">
                <span>Ausentes: <strong className="text-rose-600">{indicadores.projetos_ausentes}</strong></span>
                <span>Não credenciados: <strong>{indicadores.projetos_nao_credenciados}</strong></span>
              </div>
            </div>

            {/* KPI 2: Avaliadores Cadastrados / Ativos */}
            <div className="p-5 sm:p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-2 print:p-4">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-bold uppercase tracking-wider">Avaliadores</span>
                <Users className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                  {indicadores.avaliadores_credenciados}{' '}
                  <span className="text-xs sm:text-sm font-normal text-slate-400">/ {indicadores.total_avaliadores}</span>
                </span>
                <span className="text-xs font-bold text-indigo-600">
                  {indicadores.taxa_comparecimento_avaliadores}% presentes
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700">
                <span>Ausentes/Inativos: <strong className="text-amber-600">{indicadores.avaliadores_ausentes}</strong></span>
                <span>Total: <strong>{indicadores.total_avaliadores}</strong></span>
              </div>
            </div>

            {/* KPI 3: Avaliações Realizadas */}
            <div className="p-5 sm:p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-2 print:p-4">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-bold uppercase tracking-wider">Avaliações Concluídas</span>
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
                  {indicadores.avaliacoes_na_meta}{' '}
                  <span className="text-xs sm:text-sm font-normal text-slate-400">/ {indicadores.cota_esperada_total}</span>
                </span>
                <span className="text-xs font-bold text-emerald-600">
                  {indicadores.porcentagem_conclusao}% meta
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700">
                <span>Média das notas: <strong className="text-emerald-700 dark:text-emerald-300 font-mono">{indicadores.media_geral_notas.toFixed(2)} pts</strong></span>
                <span>Enviadas: <strong>{indicadores.total_avaliacoes_realizadas}</strong></span>
              </div>
            </div>

            {/* KPI 4: Tempo Médio de Avaliação */}
            <div className="p-5 sm:p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-2 print:p-4">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-bold uppercase tracking-wider">Tempo Médio / Projeto</span>
                <Timer className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {indicadores.tempo_medio_formatado}
                </span>
                <span className="text-xs font-bold text-purple-600">
                  eficiência
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700">
                <span>Quarentena/Alertas: <strong className={indicadores.projetos_quarentena > 0 ? 'text-amber-600' : 'text-slate-600'}>{indicadores.projetos_quarentena}</strong></span>
              </div>
            </div>
          </div>

          {/* Barra de Progresso Geral da Feira */}
          <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2 print-avoid-break">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-slate-700 dark:text-slate-300">Progresso Global das Avaliações</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                {indicadores.avaliacoes_na_meta} de {indicadores.cota_esperada_total} avaliações ({indicadores.porcentagem_conclusao}%)
              </span>
            </div>
            <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(indicadores.porcentagem_conclusao, 100)}%` }}
              />
            </div>
          </div>

          {/* Grid Intermediário: Distribuição de Cotas e Quarentena */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:grid-cols-3 print-avoid-break">
            {/* Card: Distribuição de Avaliações Recebidas */}
            <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                Cotas por projeto presente na competição
              </h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-xs font-semibold">
                  <span className="text-slate-600 dark:text-slate-300">Sem avaliação</span>
                  <span className="font-mono font-black text-rose-600">{indicadores.projetos_zero_avaliacoes} proj.</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-xs font-semibold">
                  <span className="text-slate-600 dark:text-slate-300">Abaixo da cota</span>
                  <span className="font-mono font-black text-amber-600">{indicadores.projetos_abaixo_cota} proj.</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 text-xs font-semibold border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-emerald-800 dark:text-emerald-300 font-bold">Cota concluída</span>
                  <span className="font-mono font-black text-emerald-700 dark:text-emerald-400">{indicadores.projetos_cota_concluida} proj.</span>
                </div>
              </div>
            </div>

            {/* Card: Top Avaliadores Mais Produtivos */}
            <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                <Award className="w-4 h-4 text-purple-600" />
                Top Avaliadores Mais Produtivos
              </h4>
              {indicadores.top_avaliadores.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4 text-center">Nenhuma avaliação concluída ainda.</p>
              ) : (
                <div className="space-y-2">
                  {indicadores.top_avaliadores.map((av, idx) => (
                    <div
                      key={av.email || idx}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate max-w-[180px]">
                        <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 text-[10px] font-black flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white truncate">
                          {av.nome}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="font-extrabold text-emerald-600">{av.total} aval.</span>
                        <span className="text-[11px] text-slate-400">({av.tempo_medio})</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Card: Distribuição por Modalidade */}
            <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                Projetos por Modalidade
              </h4>
              {indicadores.modalidades_distribuicao.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4 text-center">Nenhuma modalidade registrada.</p>
              ) : (
                <div className="space-y-2">
                  {indicadores.modalidades_distribuicao.map((mod) => (
                    <div
                      key={mod.nome}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-xs"
                    >
                      <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[180px]">
                        {mod.nome}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-400 font-mono">
                          {mod.projetos} proj. / {mod.avaliacoes} aval.
                        </span>
                        {mod.media > 0 && (
                          <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-xs">
                            {mod.media.toFixed(2)} pts
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

