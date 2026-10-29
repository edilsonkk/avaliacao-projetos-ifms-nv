import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FolderGit2,
  Users,
  Clock,
  Building,
  Layers,
  ArrowRight,
  ShieldAlert,
  Info
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';

interface AtribuicaoForcadaProps {
  isOpen: boolean;
  aoFechar: () => void;
  aoSucesso?: () => void;
  id_evento_ativo?: string;
  cota_padrao_evento?: number;
}

export interface ProjetoItem {
  id_projeto: string;
  id?: string;
  codigo_projeto?: string | null;
  titulo?: string;
  titulo_projeto?: string;
  estande?: string | null;
  estande_numero?: string | null;
  corredor?: string | null;
  modalidade?: string | null;
  id_modalidade?: string | null;
  area_tematica?: string | null;
  id_instituicao?: string | null;
  nome_instituicao?: string | null;
  is_check_in_realizado?: boolean;
  is_fora_da_competicao?: boolean;
  total_avaliacoes_feitas?: number;
  locks_ativos_count?: number;
  cota_avaliacoes_customizada?: number;
}

export interface UsuarioAvaliadorItem {
  id_usuario: string;
  id?: string;
  nome: string;
  email: string;
  papel: string;
  is_credenciado: boolean;
  id_instituicao?: string | null;
  nome_instituicao?: string | null;
  modalidades_bloqueadas?: string[];
  is_ocupado?: boolean;
}

/** Enter ou espaço acionam itens de lista selecionáveis (role=radio/checkbox), como num clique. */
const aoTeclarSelecionar = (acao: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    acao();
  }
};

export const AtribuicaoForcada: React.FC<AtribuicaoForcadaProps> = ({
  isOpen,
  aoFechar,
  aoSucesso,
  id_evento_ativo,
  cota_padrao_evento
}) => {
  // Modo de Operação:
  // 'banca' -> 1 Projeto (esquerda) para Múltiplos Avaliadores simultâneos (direita)
  // 'enfileirar' -> 1 Avaliador (esquerda) para Múltiplos Projetos em fila (direita)
  const [modo, setModo] = useState<'banca' | 'enfileirar'>('banca');

  // Dados carregados do Supabase
  const [listaProjetosElegiveis, setListaProjetosElegiveis] = useState<ProjetoItem[]>([]);
  const [listaAvaliadoresElegiveis, setListaAvaliadoresElegiveis] = useState<UsuarioAvaliadorItem[]>([]);
  const [totalProjetosBloqueados, setTotalProjetosBloqueados] = useState<number>(0);
  const [totalAvaliadoresOcupados, setTotalAvaliadoresOcupados] = useState<number>(0);

  // Cota padrão configurada no evento ativo
  const [cotaEventoResolvida, setCotaEventoResolvida] = useState<number>(cota_padrao_evento || 3);

  // Histórico de avaliações concluídas para cálculo de conflito e duplicidade
  const [avaliacoesRealizadas, setAvaliacoesRealizadas] = useState<Array<{ id_projeto: string; id_usuario: string }>>([]);
  // Pares projeto:avaliador em que o próprio avaliador declarou conflito de interesse
  const [conflitosDeclarados, setConflitosDeclarados] = useState<Set<string>>(new Set());

  const [carregandoDados, setCarregandoDados] = useState<boolean>(true);
  const [submetendo, setSubmetendo] = useState<boolean>(false);

  // Sistema de Feedback Moderno (substitui window.alert)
  const [toast, setToast] = useState<{ tipo: 'sucesso' | 'erro' | 'info'; mensagem: string } | null>(null);

  // Estados de Seleção:
  // Modo 'banca': 1 projeto (id string) e N avaliadores (Set de ids)
  const [projetoBancaSelecionado, setProjetoBancaSelecionado] = useState<string | null>(null);
  const [avaliadoresBancaSelecionados, setAvaliadoresBancaSelecionados] = useState<string[]>([]);

  // Modo 'enfileirar': 1 avaliador (id string) e N projetos (Array ordenado de ids)
  const [avaliadorFilaSelecionado, setAvaliadorFilaSelecionado] = useState<string | null>(null);
  const [projetosFilaSelecionados, setProjetosFilaSelecionados] = useState<string[]>([]);

  // Filtros de busca
  const [buscaEsquerda, setBuscaEsquerda] = useState<string>('');
  const [buscaDireita, setBuscaDireita] = useState<string>('');

  const conexaoConfigurada = verificar_conexao_configurada();

  const exibirFeedback = (tipo: 'sucesso' | 'erro' | 'info', mensagem: string) => {
    setToast({ tipo, mensagem });
  };

  const limparEstados = () => {
    setProjetoBancaSelecionado(null);
    setAvaliadoresBancaSelecionados([]);
    setAvaliadorFilaSelecionado(null);
    setProjetosFilaSelecionados([]);
    setBuscaEsquerda('');
    setBuscaDireita('');
    setToast(null);
  };

  // Carrega entidades elegíveis respeitando regras estritas de presença e credenciamento
  // manterAviso: recarrega depois de uma recusa do banco sem apagar a mensagem que explica o motivo
  const carregarDadosElegiveis = async (manterAviso = false) => {
    setCarregandoDados(true);
    if (!manterAviso) setToast(null);

    if (!conexaoConfigurada) {
      setListaProjetosElegiveis([]);
      setListaAvaliadoresElegiveis([]);
      setCarregandoDados(false);
      return;
    }

    try {
      const eventoIdResolvido = id_evento_ativo || localStorage.getItem('evento_ativo_id') || undefined;

      // Resolução dinâmica da cota de avaliações do evento ativo
      let cotaCalculada = cota_padrao_evento || 3;
      if (!cota_padrao_evento && eventoIdResolvido) {
        try {
          const { data: evData } = await supabase
            .from('eventos')
            .select('cota_avaliacoes_padrao')
            .eq('id_evento', eventoIdResolvido)
            .maybeSingle();
          if (evData?.cota_avaliacoes_padrao) {
            cotaCalculada = evData.cota_avaliacoes_padrao;
            setCotaEventoResolvida(cotaCalculada);
          }
        } catch (_eEvt) {
          // Mantém fallback padrão de 3
        }
      }

      let queryAvaliadoresEvento = supabase
        .from('avaliadores_evento')
        .select('id_usuario, id_evento, id_instituicao, is_credenciado, instituicoes(nome_exibicao), usuarios(nome, email, papel)')
        .eq('is_credenciado', true);

      if (eventoIdResolvido) {
        queryAvaliadoresEvento = queryAvaliadoresEvento.eq('id_evento', eventoIdResolvido);
      }

      let resProjetosData: any[] = [];
      let qProj1: any = supabase
        .from('projetos')
        .select('*, instituicoes(nome_exibicao), modalidades(nome_modalidade)')
        .eq('is_check_in_realizado', true);

      if (eventoIdResolvido) {
        if (typeof qProj1.eq === 'function') qProj1 = qProj1.eq('id_evento', eventoIdResolvido);
      }
      if (typeof qProj1.order === 'function') qProj1 = qProj1.order('codigo_projeto', { ascending: true });

      const resProj1 = await qProj1;

      if (resProj1.error || !resProj1.data) {
        let qProj2: any = supabase
          .from('projetos')
          .select('*, instituicoes(nome_exibicao), modalidades(nome_modalidade)');
        if (eventoIdResolvido) {
          if (typeof qProj2.eq === 'function') qProj2 = qProj2.eq('id_evento', eventoIdResolvido);
        }
        if (typeof qProj2.order === 'function') qProj2 = qProj2.order('codigo_projeto', { ascending: true });

        const resProj2 = await qProj2;
        resProjetosData = resProj2.data || [];
      } else {
        resProjetosData = resProj1.data || [];
      }

      let queryBloqueios: any = supabase
        .from('avaliador_modalidades_bloqueadas')
        .select('id_usuario, id_modalidade');
      if (eventoIdResolvido) {
        if (typeof queryBloqueios.eq === 'function') queryBloqueios = queryBloqueios.eq('id_evento', eventoIdResolvido);
      }

      // Só dados de projetos do evento ativo (projetos!inner + filtro pelo evento)
      const doEvento = (q: any) => (eventoIdResolvido ? q.eq('projetos.id_evento', eventoIdResolvido) : q);
      const [
        resLocksAtivos,
        resAvaliadoresEvento,
        resAvaliacoes,
        resBloqueiosModalidade,
        resConflitosDeclarados,
      ] = await Promise.all([
        // Travas vencidas não ocupam vaga nem deixam o avaliador ocupado
        doEvento(supabase.from('locks_ativos').select('id_projeto, id_usuario, projetos!inner(id_evento)').gt('expira_em', new Date().toISOString())),
        queryAvaliadoresEvento,
        doEvento(supabase.from('avaliacoes').select('id_projeto, id_usuario, status, projetos!inner(id_evento)')),
        queryBloqueios,
        doEvento(supabase.from('historico_impedimentos').select('id_projeto, id_usuario, projetos!inner(id_evento)').eq('tipo', 'conflito')),
      ]);
      const primeiroErro = [resLocksAtivos, resAvaliadoresEvento, resAvaliacoes, resBloqueiosModalidade, resConflitosDeclarados].find((r: any) => r?.error)?.error;
      if (primeiroErro) throw primeiroErro;

      const conflitosDeclarados = new Set<string>(
        (resConflitosDeclarados.data || []).map((c: any) => `${c.id_projeto}:${c.id_usuario}`)
      );
      setConflitosDeclarados(conflitosDeclarados);

      // Mapeamento de modalidades bloqueadas por avaliador
      const bloqueiosPorAvaliador = new Map<string, string[]>();
      (resBloqueiosModalidade.data || []).forEach((b: any) => {
        if (b.id_usuario && b.id_modalidade) {
          const list = bloqueiosPorAvaliador.get(b.id_usuario) || [];
          list.push(b.id_modalidade);
          bloqueiosPorAvaliador.set(b.id_usuario, list);
        }
      });

      // Mapeamento de travas ativas
      const locksPorProjeto = new Map<string, number>();
      const idsUsuariosComLock = new Set<string>();

      (resLocksAtivos.data || []).forEach((lock: any) => {
        if (lock.id_projeto) {
          const c = locksPorProjeto.get(lock.id_projeto) || 0;
          locksPorProjeto.set(lock.id_projeto, c + 1);
        }
        if (lock.id_usuario) {
          idsUsuariosComLock.add(lock.id_usuario);
        }
      });

      setTotalAvaliadoresOcupados(idsUsuariosComLock.size);

      // Contagem de avaliações ativas por projeto
      const contagemAvaliacoes = new Map<string, number>();
      const avaliacoesPares: Array<{ id_projeto: string; id_usuario: string }> = [];

      (resAvaliacoes.data || []).forEach((av: any) => {
        if (av.id_projeto) {
          const isCancelada = av.status === 'CANCELADA';

          // Apenas avaliações válidas contam para a cota do projeto
          if (!isCancelada) {
            const total = contagemAvaliacoes.get(av.id_projeto) || 0;
            contagemAvaliacoes.set(av.id_projeto, total + 1);
          }

          // Mas QUALQUER avaliação (inclusive cancelada) impede o mesmo avaliador
          if (av.id_usuario) {
            avaliacoesPares.push({ id_projeto: av.id_projeto, id_usuario: av.id_usuario });
          }
        }
      });

      setAvaliacoesRealizadas(avaliacoesPares);

      // FILTRAGEM DE PROJETOS ELEGÍVEIS:
      // - Check-in presencial confirmado
      // - Não pode estar fora da competição
      // - Cota de avaliações (feitas + travas ativas < cota estrita)
      let countProjetosBloqueados = 0;
      const todosProjetos = resProjetosData || [];
      const projetosFiltrados = todosProjetos.filter((p: any) => {
        const idProj = p.id_projeto || p.id;
        if (!idProj) return false;

        const checkinPositivo = p.is_check_in_realizado === true || p.is_checkin === true;
        if (!checkinPositivo) return false;

        if (p.is_fora_da_competicao === true) return false;

        const cota = p.cota_avaliacoes_customizada || cotaCalculada;
        const feitas = contagemAvaliacoes.get(idProj) || 0;
        const locks = locksPorProjeto.get(idProj) || 0;

        // Se a cota já foi atingida em avaliações concluídas ou por travas ativas em andamento
        if ((feitas + locks) >= cota) {
          countProjetosBloqueados++;
          return false;
        }

        return true;
      });

      setTotalProjetosBloqueados(countProjetosBloqueados);

      const projetosNormalizados: ProjetoItem[] = projetosFiltrados.map((p: any) => {
        const nomeInst = Array.isArray(p.instituicoes)
          ? p.instituicoes[0]?.nome_exibicao
          : (p.instituicoes as any)?.nome_exibicao || p.nome_instituicao;
        const nomeMod = Array.isArray(p.modalidades)
          ? p.modalidades[0]?.nome_modalidade
          : (p.modalidades as any)?.nome_modalidade || p.modalidade;

        const idProj = p.id_projeto || p.id;
        const feitas = contagemAvaliacoes.get(idProj) || 0;
        const locks = locksPorProjeto.get(idProj) || 0;

        return {
          id_projeto: idProj,
          id: idProj,
          codigo_projeto: p.codigo_projeto || null,
          titulo: p.titulo || p.titulo_projeto || 'Projeto sem título',
          titulo_projeto: p.titulo || p.titulo_projeto || 'Projeto sem título',
          estande: p.estande || p.estande_numero || null,
          estande_numero: p.estande || p.estande_numero || null,
          corredor: p.corredor || null,
          modalidade: nomeMod || null,
          id_modalidade: p.id_modalidade || null,
          id_instituicao: p.id_instituicao || null,
          nome_instituicao: nomeInst || null,
          is_check_in_realizado: true,
          total_avaliacoes_feitas: feitas,
          locks_ativos_count: locks,
          cota_avaliacoes_customizada: p.cota_avaliacoes_customizada || cotaCalculada,
        };
      });

      setListaProjetosElegiveis(projetosNormalizados);

      // FILTRAGEM DE AVALIADORES ELEGÍVEIS:
      // - is_credenciado = true no evento
      const mapaInstituicaoAvaliador = new Map<string, { id_inst?: string; nome_inst?: string }>();

      (resAvaliadoresEvento.data || []).forEach((ae: any) => {
        if (ae.id_usuario && ae.is_credenciado === true) {
          const nomeInst = Array.isArray(ae.instituicoes)
            ? ae.instituicoes[0]?.nome_exibicao
            : (ae.instituicoes as any)?.nome_exibicao;
          mapaInstituicaoAvaliador.set(ae.id_usuario, {
            id_inst: ae.id_instituicao,
            nome_inst: nomeInst
          });
        }
      });

      const avaliadoresNormalizados: UsuarioAvaliadorItem[] = (resAvaliadoresEvento.data || [])
        .filter((ae: any) => ae.id_usuario && ae.is_credenciado === true)
        .map((ae: any) => {
          const usuario = Array.isArray(ae.usuarios) ? ae.usuarios[0] : ae.usuarios;
          const instInfo = mapaInstituicaoAvaliador.get(ae.id_usuario);
          return {
            id_usuario: ae.id_usuario,
            id: ae.id_usuario,
            nome: usuario?.nome || 'Avaliador não identificado',
            email: usuario?.email || '',
            papel: usuario?.papel || 'AVALIADOR',
            is_credenciado: true,
            id_instituicao: instInfo?.id_inst || null,
            nome_instituicao: instInfo?.nome_inst || null,
            modalidades_bloqueadas: bloqueiosPorAvaliador.get(ae.id_usuario) || [],
            is_ocupado: idsUsuariosComLock.has(ae.id_usuario),
          };
        })
        .sort((a: UsuarioAvaliadorItem, b: UsuarioAvaliadorItem) => a.nome.localeCompare(b.nome, 'pt-BR'));

      setListaAvaliadoresElegiveis(avaliadoresNormalizados);
    } catch (err: any) {
      console.error('Erro ao carregar entidades elegíveis no Supabase:', err);
      exibirFeedback('erro', `Falha ao sincronizar entidades: ${err.message || err}`);
    } finally {
      setCarregandoDados(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      carregarDadosElegiveis();
    }
  }, [isOpen, conexaoConfigurada]);

  // ============================================================================
  // CÁLCULOS DO MODO BANCA (1 Projeto -> Múltiplos Avaliadores)
  // ============================================================================
  const projetoBancaObj = useMemo(() => {
    return listaProjetosElegiveis.find((p) => (p.id_projeto || p.id) === projetoBancaSelecionado);
  }, [listaProjetosElegiveis, projetoBancaSelecionado]);

  // Vagas restantes estritas para o projeto selecionado
  const vagasRestantesBanca = useMemo(() => {
    if (!projetoBancaObj) return 0;
    const cota = projetoBancaObj.cota_avaliacoes_customizada || cotaEventoResolvida || 3;
    const concluidas = projetoBancaObj.total_avaliacoes_feitas || 0;
    const locks = projetoBancaObj.locks_ativos_count || 0;
    return Math.max(0, cota - (concluidas + locks));
  }, [projetoBancaObj, cotaEventoResolvida]);

  // Avaliadores com checagem contextual para o projeto da banca
  const avaliadoresBancaContextualizados = useMemo(() => {
    return listaAvaliadoresElegiveis.map((aval) => {
      let motivoInelegivel: string | null = null;

      // Ocupado em outra avaliação ativa
      if (aval.is_ocupado) {
        motivoInelegivel = 'Ocupado em outra avaliação';
      }

      if (projetoBancaObj) {
        // Conflito de Interesse: mesma instituição
        const mesmoId = aval.id_instituicao && projetoBancaObj.id_instituicao && aval.id_instituicao === projetoBancaObj.id_instituicao;
        const mesmoNome = aval.nome_instituicao && projetoBancaObj.nome_instituicao && 
          aval.nome_instituicao.trim().toLowerCase() === projetoBancaObj.nome_instituicao.trim().toLowerCase();

        if (mesmoId || mesmoNome) {
          motivoInelegivel = 'Conflito: Mesma Instituição';
        }

        // Bloqueio por Modalidade
        if (projetoBancaObj.id_modalidade && aval.modalidades_bloqueadas?.includes(projetoBancaObj.id_modalidade)) {
          motivoInelegivel = 'Bloqueio: Modalidade do Projeto';
        }

        // Já avaliou este projeto
        const jaAvaliou = avaliacoesRealizadas.some(
          (av) => av.id_projeto === projetoBancaObj.id_projeto && av.id_usuario === aval.id_usuario
        );
        if (jaAvaliou) {
          motivoInelegivel = 'Já avaliou este projeto';
        } else if (conflitosDeclarados.has(`${projetoBancaObj.id_projeto}:${aval.id_usuario}`)) {
          motivoInelegivel = 'Declarou conflito com este projeto';
        }
      }

      return {
        ...aval,
        elegivelParaBanca: !motivoInelegivel,
        motivoInelegivel,
      };
    });
  }, [listaAvaliadoresElegiveis, projetoBancaObj, avaliacoesRealizadas, conflitosDeclarados]);

  const toggleAvaliadorBanca = (idUsuario: string) => {
    const jaSelecionado = avaliadoresBancaSelecionados.includes(idUsuario);
    if (jaSelecionado) {
      setAvaliadoresBancaSelecionados((prev) => prev.filter((id) => id !== idUsuario));
    } else {
      if (avaliadoresBancaSelecionados.length >= vagasRestantesBanca) {
        exibirFeedback(
          'info',
          `Limite de vagas atingido! Este projeto só pode receber mais ${vagasRestantesBanca} avaliador(es).`
        );
        return;
      }
      setAvaliadoresBancaSelecionados((prev) => [...prev, idUsuario]);
    }
  };

  // ============================================================================
  // CÁLCULOS DO MODO ENFILEIRAR (1 Avaliador -> Múltiplos Projetos)
  // ============================================================================
  const avaliadorFilaObj = useMemo(() => {
    return listaAvaliadoresElegiveis.find((a) => (a.id_usuario || a.id) === avaliadorFilaSelecionado);
  }, [listaAvaliadoresElegiveis, avaliadorFilaSelecionado]);

  // Projetos com checagem contextual para o avaliador da fila
  const projetosFilaContextualizados = useMemo(() => {
    return listaProjetosElegiveis.map((proj) => {
      let motivoInelegivel: string | null = null;

      if (avaliadorFilaObj) {
        // Conflito de Interesse: mesma instituição
        const mesmoId = proj.id_instituicao && avaliadorFilaObj.id_instituicao && proj.id_instituicao === avaliadorFilaObj.id_instituicao;
        const mesmoNome = proj.nome_instituicao && avaliadorFilaObj.nome_instituicao &&
          proj.nome_instituicao.trim().toLowerCase() === avaliadorFilaObj.nome_instituicao.trim().toLowerCase();

        if (mesmoId || mesmoNome) {
          motivoInelegivel = 'Conflito: Mesma Instituição';
        }

        // Bloqueio por Modalidade
        if (proj.id_modalidade && avaliadorFilaObj.modalidades_bloqueadas?.includes(proj.id_modalidade)) {
          motivoInelegivel = 'Bloqueio: Modalidade do Projeto';
        }

        // Já avaliado por este avaliador
        const jaAvaliou = avaliacoesRealizadas.some(
          (av) => av.id_projeto === proj.id_projeto && av.id_usuario === avaliadorFilaObj.id_usuario
        );
        if (jaAvaliou) {
          motivoInelegivel = 'Já avaliado por este avaliador';
        } else if (conflitosDeclarados.has(`${proj.id_projeto}:${avaliadorFilaObj.id_usuario}`)) {
          motivoInelegivel = 'Avaliador declarou conflito';
        }

        // Sem vaga: avaliações ativas + travas já ocupam a cota
        const vagasProjeto = (proj.cota_avaliacoes_customizada || cotaEventoResolvida || 3) - ((proj.total_avaliacoes_feitas || 0) + (proj.locks_ativos_count || 0));
        if (!motivoInelegivel && vagasProjeto <= 0) {
          motivoInelegivel = 'Cota atingida';
        }
      }

      return {
        ...proj,
        elegivelParaFila: !motivoInelegivel,
        motivoInelegivel,
      };
    });
  }, [listaProjetosElegiveis, avaliadorFilaObj, avaliacoesRealizadas, conflitosDeclarados, cotaEventoResolvida]);

  const toggleProjetoFila = (idProjeto: string) => {
    setProjetosFilaSelecionados((prev) =>
      prev.includes(idProjeto) ? prev.filter((id) => id !== idProjeto) : [...prev, idProjeto]
    );
  };

  // ============================================================================
  // FILTRAGEM DE BUSCA
  // ============================================================================
  const listaEsquerdaFiltrada = useMemo(() => {
    const termo = buscaEsquerda.trim().toLowerCase();
    if (modo === 'banca') {
      // Esquerda: Projetos
      if (!termo) return listaProjetosElegiveis;
      return listaProjetosElegiveis.filter((p) => {
        const cod = (p.codigo_projeto || '').toLowerCase();
        const tit = (p.titulo || p.titulo_projeto || '').toLowerCase();
        const est = (p.estande || p.estande_numero || '').toLowerCase();
        return cod.includes(termo) || tit.includes(termo) || est.includes(termo);
      });
    } else {
      // Esquerda: Avaliadores
      if (!termo) return listaAvaliadoresElegiveis;
      return listaAvaliadoresElegiveis.filter((a) => {
        const nome = (a.nome || '').toLowerCase();
        const email = (a.email || '').toLowerCase();
        return nome.includes(termo) || email.includes(termo);
      });
    }
  }, [modo, buscaEsquerda, listaProjetosElegiveis, listaAvaliadoresElegiveis]);

  const listaDireitaFiltrada = useMemo(() => {
    const termo = buscaDireita.trim().toLowerCase();
    if (modo === 'banca') {
      // Direita: Avaliadores contextualizados com badges de conflito e bloqueio
      if (!termo) return avaliadoresBancaContextualizados;
      return avaliadoresBancaContextualizados.filter((a) => {
        const nome = (a.nome || '').toLowerCase();
        const email = (a.email || '').toLowerCase();
        return nome.includes(termo) || email.includes(termo);
      });
    } else {
      // Direita: Projetos contextualizados com badges de conflito e bloqueio
      if (!termo) return projetosFilaContextualizados;
      return projetosFilaContextualizados.filter((p) => {
        const cod = (p.codigo_projeto || '').toLowerCase();
        const tit = (p.titulo || p.titulo_projeto || '').toLowerCase();
        const est = (p.estande || p.estande_numero || '').toLowerCase();
        return cod.includes(termo) || tit.includes(termo) || est.includes(termo);
      });
    }
  }, [modo, buscaDireita, avaliadoresBancaContextualizados, projetosFilaContextualizados]);

  // ============================================================================
  // SUBMISSÃO DA ATRIBUIÇÃO
  // ============================================================================
  const handleExecutarAtribuicao = async () => {
    setSubmetendo(true);
    setToast(null);

    try {
      if (modo === 'banca') {
        if (!projetoBancaSelecionado) {
          exibirFeedback('erro', 'Por favor, selecione um projeto elegível na coluna da esquerda.');
          setSubmetendo(false);
          return;
        }
        if (avaliadoresBancaSelecionados.length === 0) {
          exibirFeedback('erro', 'Selecione pelo menos um avaliador elegível na coluna da direita.');
          setSubmetendo(false);
          return;
        }

        if (avaliadoresBancaSelecionados.length > vagasRestantesBanca) {
          exibirFeedback(
            'erro',
            `Limite de vagas excedido! O projeto possui apenas ${vagasRestantesBanca} vaga(s) restante(s).`
          );
          setSubmetendo(false);
          return;
        }

        // Validação estrita contra conflito de interesse
        for (const avalId of avaliadoresBancaSelecionados) {
          const info = avaliadoresBancaContextualizados.find((a) => a.id_usuario === avalId);
          if (info && !info.elegivelParaBanca) {
            exibirFeedback('erro', `Avaliador ${info.nome} não é elegível: ${info.motivoInelegivel}`);
            setSubmetendo(false);
            return;
          }
        }

        // O banco valida tudo de novo (cota sob lock do projeto, conflitos, ocupação) e grava tudo ou nada
        if (!(await garantirSessaoAdmin())) {
          setSubmetendo(false);
          return;
        }
        const { error } = await supabase.rpc('admin_atribuir_banca', {
          p_id_projeto: projetoBancaSelecionado,
          p_ids_usuarios: avaliadoresBancaSelecionados,
        });

        if (error) {
          console.error('Erro ao atribuir banca:', error);
          exibirFeedback('erro', tratarErroEscritaAdmin(error));
          await carregarDadosElegiveis(true);
          setSubmetendo(false);
          return;
        }

        exibirFeedback(
          'sucesso',
          `Projeto atribuído a ${avaliadoresBancaSelecionados.length} avaliador(es). Aparece no celular deles na hora (validade de 2 horas).`
        );

        setTimeout(() => {
          limparEstados();
          if (aoSucesso) aoSucesso();
          aoFechar();
        }, 1500);

      } else {
        // MODO ENFILEIRAR (1 Avaliador -> Múltiplos Projetos)
        if (!avaliadorFilaSelecionado || !avaliadorFilaObj) {
          exibirFeedback('erro', 'Por favor, selecione um avaliador credenciado na coluna da esquerda.');
          setSubmetendo(false);
          return;
        }
        if (projetosFilaSelecionados.length === 0) {
          exibirFeedback('erro', 'Selecione ao menos um projeto para enfileirar na coluna da direita.');
          setSubmetendo(false);
          return;
        }

        // Validação de conflitos
        for (const projId of projetosFilaSelecionados) {
          const info = projetosFilaContextualizados.find((p) => p.id_projeto === projId);
          if (info && !info.elegivelParaFila) {
            exibirFeedback('erro', `Projeto [${info.codigo_projeto}] não é elegível: ${info.motivoInelegivel}`);
            setSubmetendo(false);
            return;
          }
        }

        if (!(await garantirSessaoAdmin())) {
          setSubmetendo(false);
          return;
        }
        const { data: resultado, error } = await supabase.rpc('admin_enfileirar_projetos', {
          p_id_usuario: avaliadorFilaSelecionado,
          p_ids_projetos: projetosFilaSelecionados,
        });

        if (error) {
          console.error('Erro ao enfileirar projetos:', error);
          exibirFeedback('erro', tratarErroEscritaAdmin(error));
          await carregarDadosElegiveis(true);
          setSubmetendo(false);
          return;
        }

        const { ativado, enfileirados } = (resultado || {}) as { ativado: string | null; enfileirados: number };
        const msgSucesso = ativado
          ? `1º projeto já está com ${avaliadorFilaObj.nome}${enfileirados > 0 ? ` e ${enfileirados} entraram na fila` : ''}.`
          : `${enfileirados} projeto(s) na fila de ${avaliadorFilaObj.nome}; entram quando ele terminar o atual.`;

        exibirFeedback('sucesso', msgSucesso);

        setTimeout(() => {
          limparEstados();
          if (aoSucesso) aoSucesso();
          aoFechar();
        }, 1500);
      }
    } catch (err: any) {
      console.error('Falha de execução na atribuição:', err);
      exibirFeedback('erro', `Erro inesperado: ${err?.message || err}`);
    } finally {
      setSubmetendo(false);
    }
  };

  if (!isOpen) return null;

  const totalSelecionadosDireita = modo === 'banca'
    ? avaliadoresBancaSelecionados.length
    : projetosFilaSelecionados.length;

  const podeSubmeter = modo === 'banca'
    ? !!projetoBancaSelecionado && avaliadoresBancaSelecionados.length > 0
    : !!avaliadorFilaSelecionado && projetosFilaSelecionados.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-3 overflow-y-auto font-sans">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        
        {/* CABEÇALHO DO MODAL COM ABAS INTEGRADAS */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white leading-tight">
                  Atribuição de Projetos
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                limparEstados();
                aoFechar();
              }}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Fechar Modal"
              aria-label="Fechar Modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* SELETOR DE ABAS */}
          <div className="flex items-center gap-2 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-2xl w-full sm:w-fit">
            <button
              type="button"
              aria-pressed={modo === 'banca'}
              onClick={() => {
                setModo('banca');
                setToast(null);
              }}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                modo === 'banca'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Alocar Banca para Projeto</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 font-semibold">
                Simultâneo
              </span>
            </button>

            <button
              type="button"
              aria-pressed={modo === 'enfileirar'}
              onClick={() => {
                setModo('enfileirar');
                setToast(null);
              }}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                modo === 'enfileirar'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Enfileirar para Avaliador</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 font-semibold">
                Em Fila
              </span>
            </button>
          </div>
        </div>

        {/* FEEDBACK INTEGRADO / TOAST ELEGANTE (SEM WINDOW.ALERT) */}
        {toast && (
          <div
            role={toast.tipo === 'erro' ? 'alert' : 'status'}
            className={`px-5 py-3 border-b flex items-center justify-between text-xs font-semibold animate-in fade-in slide-in-from-top-1 ${
              toast.tipo === 'sucesso'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : toast.tipo === 'erro'
                ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                : 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {toast.tipo === 'sucesso' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
              {toast.tipo === 'erro' && <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
              {toast.tipo === 'info' && <Info className="w-4 h-4 text-indigo-600 shrink-0" />}
              <span>{toast.mensagem}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="p-1 hover:opacity-75 transition-opacity"
              aria-label="Dispensar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* CORPO DO MODAL: LAYOUT DE DUAS COLUNAS LADO A LADO */}
        <div className="p-4 sm:p-5 flex-1 overflow-hidden min-h-0 flex flex-col">
          {carregandoDados ? (
            <div className="py-20 text-center space-y-3 my-auto">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-500">
                Sincronizando projetos, credenciamentos e travas do banco...
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden">
              
              {/* =============================================================== */}
              {/* COLUNA ESQUERDA (Entidade Âncora 1-para-N)                       */}
              {/* Banca: 1 Projeto Selecionado | Enfileirar: 1 Avaliador          */}
              {/* =============================================================== */}
              <div className="flex flex-col min-h-0 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800">
                
                {/* Cabeçalho da Coluna Esquerda */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700 mb-3">
                  <div className="flex items-center gap-2">
                    {modo === 'banca' ? (
                      <FolderGit2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    ) : (
                      <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    )}
                    <div>
                      <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider block">
                        {modo === 'banca' ? '1. Escolha o Projeto' : '1. Escolha o Avaliador'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {modo === 'banca'
                          ? `${listaEsquerdaFiltrada.length} projetos elegíveis${totalProjetosBloqueados > 0 ? ` • ${totalProjetosBloqueados} com cota atingida` : ''}`
                          : `${listaEsquerdaFiltrada.length} avaliadores credenciados`}
                      </span>
                    </div>
                  </div>

                  {(modo === 'banca' ? projetoBancaSelecionado : avaliadorFilaSelecionado) && (
                    <span className="text-[10px] bg-indigo-600 text-white font-bold px-2.5 py-0.5 rounded-full">
                      Selecionado
                    </span>
                  )}
                </div>

                {/* Campo de Busca Esquerda */}
                <div className="relative mb-3">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    aria-label={modo === 'banca' ? 'Buscar projeto' : 'Buscar avaliador'}
                    value={buscaEsquerda}
                    onChange={(e) => setBuscaEsquerda(e.target.value)}
                    placeholder={modo === 'banca' ? "Buscar por código, título ou estande..." : "Buscar por nome ou e-mail..."}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 dark:text-slate-100"
                  />
                </div>

                {/* Lista da Coluna Esquerda */}
                <div role="radiogroup" aria-label={modo === 'banca' ? 'Projetos elegíveis' : 'Avaliadores credenciados'} className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 p-0.5">
                  {modo === 'banca' ? (
                    // RENDERIZAÇÃO: PROJETOS (para Banca)
                    listaEsquerdaFiltrada.map((item: any) => {
                      const p = item as ProjetoItem;
                      const idProj = p.id_projeto || p.id!;
                      const selecionado = projetoBancaSelecionado === idProj;
                      const cota = p.cota_avaliacoes_customizada || 3;
                      const concluidas = p.total_avaliacoes_feitas || 0;
                      const locks = p.locks_ativos_count || 0;
                      const vagas = Math.max(0, cota - (concluidas + locks));

                      return (
                        <div
                          key={idProj}
                          role="radio"
                          aria-checked={selecionado}
                          aria-label={`Projeto ${p.codigo_projeto || p.titulo}, ${vagas} vaga(s)`}
                          tabIndex={0}
                          onKeyDown={aoTeclarSelecionar(() => {
                            setProjetoBancaSelecionado(idProj);
                            setAvaliadoresBancaSelecionados([]);
                            setToast(null);
                          })}
                          onClick={() => {
                            setProjetoBancaSelecionado(idProj);
                            setAvaliadoresBancaSelecionados([]); // Limpa para recalcular vagas
                            setToast(null);
                          }}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                            selecionado
                              ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-mono text-[11px] font-black text-indigo-600 dark:text-indigo-400">
                                {p.codigo_projeto || 'N/I'}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                                Estande: {p.estande || p.estande_numero || '-'}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold">
                                {vagas} vaga(s) restante(s)
                              </span>
                            </div>
                            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                              {p.titulo || p.titulo_projeto}
                            </h3>
                            {p.nome_instituicao && (
                              <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                <Building className="w-3 h-3" />
                                <span className="truncate">{p.nome_instituicao}</span>
                              </p>
                            )}
                          </div>

                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                            selecionado
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}>
                            {selecionado && <CheckCircle2 className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    // RENDERIZAÇÃO: AVALIADORES (para Enfileirar)
                    listaEsquerdaFiltrada.map((item: any) => {
                      const a = item as UsuarioAvaliadorItem;
                      const idUsr = a.id_usuario || a.id!;
                      const selecionado = avaliadorFilaSelecionado === idUsr;

                      return (
                        <div
                          key={idUsr}
                          role="radio"
                          aria-checked={selecionado}
                          aria-label={`Avaliador ${a.nome}, ${a.is_ocupado ? 'em avaliação' : 'livre'}`}
                          tabIndex={0}
                          onKeyDown={aoTeclarSelecionar(() => {
                            setAvaliadorFilaSelecionado(idUsr);
                            setProjetosFilaSelecionados([]);
                            setToast(null);
                          })}
                          onClick={() => {
                            setAvaliadorFilaSelecionado(idUsr);
                            setProjetosFilaSelecionados([]);
                            setToast(null);
                          }}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                            selecionado
                              ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                {a.nome}
                              </span>
                              {a.is_ocupado ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 font-bold shrink-0">
                                  Em Avaliação
                                </span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-bold shrink-0">
                                  Livre
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 truncate">{a.email}</p>
                            {a.nome_instituicao && (
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                                <Building className="w-3 h-3" />
                                <span className="truncate">{a.nome_instituicao}</span>
                              </p>
                            )}
                          </div>

                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                            selecionado
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}>
                            {selecionado && <CheckCircle2 className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* =============================================================== */}
              {/* COLUNA DIREITA (Seleção Múltipla N Itens)                       */}
              {/* Banca: N Avaliadores | Enfileirar: N Projetos em Fila          */}
              {/* =============================================================== */}
              <div className="flex flex-col min-h-0 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800">
                
                {/* Cabeçalho da Coluna Direita */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700 mb-3">
                  <div className="flex items-center gap-2">
                    {modo === 'banca' ? (
                      <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    ) : (
                      <FolderGit2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    )}
                    <div>
                      <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider block">
                        {modo === 'banca' ? '2. Alocar Avaliadores para a Banca' : '2. Selecionar Projetos para a Fila'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {modo === 'banca'
                          ? projetoBancaObj
                            ? `Máximo permitido: ${vagasRestantesBanca} vaga(s)`
                            : 'Selecione um projeto à esquerda primeiro'
                          : avaliadorFilaObj
                          ? `Projetos serão atendidos em ordem`
                          : 'Selecione um avaliador à esquerda primeiro'}
                      </span>
                    </div>
                  </div>

                  {totalSelecionadosDireita > 0 && (
                    <span className="text-[10px] bg-indigo-600 text-white font-bold px-2 py-0.5 rounded-full">
                      {totalSelecionadosDireita} Selecionado(s)
                    </span>
                  )}
                </div>

                {/* Campo de Busca Direita */}
                <div className="relative mb-3">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    aria-label={modo === 'banca' ? 'Filtrar avaliadores' : 'Filtrar projetos'}
                    value={buscaDireita}
                    onChange={(e) => setBuscaDireita(e.target.value)}
                    placeholder={modo === 'banca' ? "Filtrar avaliadores disponíveis..." : "Filtrar projetos da fila..."}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 dark:text-slate-100"
                  />
                </div>

                {/* Lista da Coluna Direita */}
                <div role="group" aria-label={modo === 'banca' ? 'Avaliadores para a banca' : 'Projetos para a fila'} className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 p-0.5">
                  {modo === 'banca' ? (
                    // MODO BANCA: RENDERIZA AVALIADORES COM CHECKBOX
                    listaDireitaFiltrada.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-xs italic">
                        Nenhum avaliador credenciado encontrado para este filtro.
                      </div>
                    ) : (
                      listaDireitaFiltrada.map((item: any) => {
                        const a = item;
                        const idUsr = a.id_usuario || a.id!;
                        const selecionado = avaliadoresBancaSelecionados.includes(idUsr);
                        const bloqueado = !a.elegivelParaBanca;

                        return (
                          <div
                            key={idUsr}
                            role="checkbox"
                            aria-checked={selecionado}
                            aria-disabled={bloqueado}
                            aria-label={`Avaliador ${a.nome}${bloqueado ? `: ${a.motivoInelegivel}` : ''}`}
                            tabIndex={bloqueado ? -1 : 0}
                            onKeyDown={aoTeclarSelecionar(() => {
                              if (!bloqueado) toggleAvaliadorBanca(idUsr);
                            })}
                            onClick={() => {
                              if (!bloqueado) toggleAvaliadorBanca(idUsr);
                            }}
                            className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                              bloqueado
                                ? 'opacity-60 bg-slate-100/60 dark:bg-slate-800/20 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                                : selecionado
                                ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20 cursor-pointer'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                  {a.nome}
                                </span>
                                {bloqueado && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-bold flex items-center gap-1">
                                    <ShieldAlert className="w-2.5 h-2.5" />
                                    {a.motivoInelegivel}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 truncate">{a.email}</p>
                              {a.nome_instituicao && (
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                                  <Building className="w-3 h-3" />
                                  <span className="truncate">{a.nome_instituicao}</span>
                                </p>
                              )}
                            </div>

                            <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                              bloqueado
                                ? 'border-slate-300 bg-slate-200 dark:bg-slate-700 text-transparent'
                                : selecionado
                                ? 'bg-indigo-600 border-indigo-600 text-white'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}>
                              {selecionado && <CheckCircle2 className="w-3.5 h-3.5" />}
                            </div>
                          </div>
                        );
                      })
                    )
                  ) : (
                    // MODO ENFILEIRAR: RENDERIZA PROJETOS COM CHECKBOX
                    listaDireitaFiltrada.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-xs italic">
                        Nenhum projeto elegível encontrado para este filtro.
                      </div>
                    ) : (
                      listaDireitaFiltrada.map((item: any) => {
                        const p = item;
                        const idProj = p.id_projeto || p.id!;
                        const selecionado = projetosFilaSelecionados.includes(idProj);
                        const ordemNaSelecao = projetosFilaSelecionados.indexOf(idProj) + 1;
                        const bloqueado = !p.elegivelParaFila;

                        return (
                          <div
                            key={idProj}
                            role="checkbox"
                            aria-checked={selecionado}
                            aria-disabled={bloqueado}
                            aria-label={`Projeto ${p.codigo_projeto || p.titulo}${bloqueado ? `: ${p.motivoInelegivel}` : selecionado ? `, ${ordemNaSelecao}º na fila` : ''}`}
                            tabIndex={bloqueado ? -1 : 0}
                            onKeyDown={aoTeclarSelecionar(() => {
                              if (!bloqueado) toggleProjetoFila(idProj);
                            })}
                            onClick={() => {
                              if (!bloqueado) toggleProjetoFila(idProj);
                            }}
                            className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                              bloqueado
                                ? 'opacity-60 bg-slate-100/60 dark:bg-slate-800/20 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                                : selecionado
                                ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20 cursor-pointer'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-mono text-[11px] font-black text-indigo-600 dark:text-indigo-400">
                                  {p.codigo_projeto || 'N/I'}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                                  Estande: {p.estande || p.estande_numero || '-'}
                                </span>
                                {bloqueado && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-bold flex items-center gap-1">
                                    <ShieldAlert className="w-2.5 h-2.5" />
                                    {p.motivoInelegivel}
                                  </span>
                                )}
                              </div>
                              <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                {p.titulo || p.titulo_projeto}
                              </h3>
                              {p.nome_instituicao && (
                                <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                  <Building className="w-3 h-3" />
                                  <span className="truncate">{p.nome_instituicao}</span>
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {selecionado && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                                  {ordemNaSelecao}º
                                </span>
                              )}
                              <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                                bloqueado
                                  ? 'border-slate-300 bg-slate-200 dark:bg-slate-700 text-transparent'
                                  : selecionado
                                  ? 'bg-indigo-600 border-indigo-600 text-white'
                                  : 'border-slate-300 dark:border-slate-600'
                              }`}>
                                {selecionado && <CheckCircle2 className="w-3.5 h-3.5" />}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )
                  )}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* RESUMO FIXO E BOTÕES DE AÇÃO */}
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 space-y-3">
          
          {/* Card de Resumo Pré-Confirmação */}
          <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs">
            {modo === 'banca' ? (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                    Resumo da Banca Simultânea:
                  </span>
                  {projetoBancaObj ? (
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      <span className="font-mono text-indigo-600 dark:text-indigo-400 mr-1.5 font-black">
                        [{projetoBancaObj.codigo_projeto || 'N/I'}]
                      </span>
                      {projetoBancaObj.titulo || projetoBancaObj.titulo_projeto}
                      <span className="text-slate-400 font-normal ml-2">
                        ({avaliadoresBancaSelecionados.length} de {vagasRestantesBanca} vaga(s) alocadas)
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-400 italic">Selecione 1 projeto e avaliadores para a banca</span>
                  )}
                </div>
                {avaliadoresBancaSelecionados.length > 0 && (
                  <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-xl">
                    {avaliadoresBancaSelecionados.length} trava(s) de 2h serão criadas
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                    Resumo do Enfileiramento:
                  </span>
                  {avaliadorFilaObj ? (
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      <span className="text-indigo-600 dark:text-indigo-400 mr-1.5 font-bold">
                        {avaliadorFilaObj.nome}
                      </span>
                      <span className="text-slate-400 font-normal">
                        ({projetosFilaSelecionados.length} projeto(s) na sequência)
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-400 italic">Selecione 1 avaliador e projetos para enfileirar</span>
                  )}
                </div>
                {projetosFilaSelecionados.length > 0 && (
                  <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-xl">
                    {!avaliadorFilaObj?.is_ocupado
                      ? '1º projeto imediato (2h) + demais em fila'
                      : 'Todos entrarão em fila ordenada'}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Barra de Ações */}
          <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              <span>Travas ativas têm validade de 2 horas. Filas persistem até a avaliação.</span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  limparEstados();
                  aoFechar();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={submetendo || !podeSubmeter}
                onClick={handleExecutarAtribuicao}
                className="px-6 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                {submetendo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                <span>
                  {modo === 'banca'
                    ? `Forçar Atribuição Elegível (Banca ${avaliadoresBancaSelecionados.length})`
                    : `Forçar Atribuição Elegível (Fila ${projetosFilaSelecionados.length})`}
                </span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
