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
  ShieldCheck,
  Building,
  Ban
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

interface AtribuicaoForcadaProps {
  isOpen: boolean;
  aoFechar: () => void;
  aoSucesso?: () => void;
  id_evento_ativo?: string;
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
  area_tematica?: string | null;
  id_instituicao?: string | null;
  nome_instituicao?: string | null;
  is_check_in_realizado?: boolean;
  is_fora_da_competicao?: boolean;
  total_avaliacoes_feitas?: number;
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
}

export const AtribuicaoForcada: React.FC<AtribuicaoForcadaProps> = ({
  isOpen,
  aoFechar,
  aoSucesso,
  id_evento_ativo
}) => {
  // Dados elegíveis carregados do banco de dados
  const [listaProjetosElegiveis, setListaProjetosElegiveis] = useState<ProjetoItem[]>([]);
  const [listaAvaliadoresElegiveis, setListaAvaliadoresElegiveis] = useState<UsuarioAvaliadorItem[]>([]);
  const [totalProjetosBloqueados, setTotalProjetosBloqueados] = useState<number>(0);
  const [totalAvaliadoresOcupados, setTotalAvaliadoresOcupados] = useState<number>(0);

  // Registro de avaliações já feitas para checar duplicação e conflitos
  const [avaliacoesRealizadas, setAvaliacoesRealizadas] = useState<Array<{ id_projeto: string; id_usuario: string }>>([]);

  const [carregandoDados, setCarregandoDados] = useState<boolean>(true);
  const [submetendo, setSubmetendo] = useState<boolean>(false);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  // Seleções simultâneas de Projeto (coluna esquerda) e Avaliador (coluna direita)
  const [projetoSelecionado, setProjetoSelecionado] = useState<string | null>(null);
  const [avaliadorSelecionado, setAvaliadorSelecionado] = useState<string | null>(null);

  // Filtros de busca
  const [buscaProjeto, setBuscaProjeto] = useState<string>('');
  const [buscaAvaliador, setBuscaAvaliador] = useState<string>('');

  const conexaoConfigurada = verificar_conexao_configurada();

  // Carrega rigorosamente APENAS entidades ELEGÍVEIS respeitando as regras de negócio:
  // 1. Projetos: com check-in presencial confirmado (is_check_in_realizado/is_checkin = true), sem trava ativa em locks_ativos, sem quarentena e sem cota excedida
  // 2. Avaliadores: obrigatoriamente credenciados (is_credenciado = true com amarração no evento) e sem trava ativa em locks_ativos
  const carregarDadosElegiveis = async () => {
    setCarregandoDados(true);
    setMensagemErro(null);

    if (!conexaoConfigurada) {
      setListaProjetosElegiveis([]);
      setListaAvaliadoresElegiveis([]);
      setCarregandoDados(false);
      return;
    }

    try {
      const eventoIdResolvido = id_evento_ativo || localStorage.getItem('evento_ativo_id') || undefined;

      // Consultas paralelas ao Supabase com filtros estritos espelhando o Staff
      let queryAvaliadoresEvento = supabase
        .from('avaliadores_evento')
        .select('id_usuario, id_evento, id_instituicao, is_credenciado, instituicoes(nome_exibicao)')
        .eq('is_credenciado', true);

      if (eventoIdResolvido) {
        queryAvaliadoresEvento = queryAvaliadoresEvento.eq('id_evento', eventoIdResolvido);
      }

      // Query de projetos tentando is_check_in_realizado com fallback
      let resProjetosData: any[] = [];
      const resProj1 = await supabase
        .from('projetos')
        .select('*, instituicoes(nome_exibicao), modalidades(nome_modalidade)')
        .eq('is_check_in_realizado', true)
        .order('codigo_projeto', { ascending: true });

      if (resProj1.error || !resProj1.data) {
        const resProj2 = await supabase
          .from('projetos')
          .select('*, instituicoes(nome_exibicao), modalidades(nome_modalidade)')
          .order('codigo_projeto', { ascending: true });
        resProjetosData = resProj2.data || [];
      } else {
        resProjetosData = resProj1.data || [];
      }

      const [
        resLocksAtivos,
        resAvaliadoresCredenciados,
        resAvaliadoresEvento,
        resAvaliacoes
      ] = await Promise.all([
        supabase
          .from('locks_ativos')
          .select('id_projeto, id_usuario'),
        supabase
          .from('view_avaliadores_credenciados')
          .select('*')
          .eq('is_credenciado', true)
          .order('nome', { ascending: true }),
        queryAvaliadoresEvento,
        supabase
          .from('avaliacoes')
          .select('id_projeto, id_usuario, is_quarentena, quarentena_decisao, status_avaliacao')
      ]);

      // Conjuntos de identificadores bloqueados
      const idsProjetosComLock = new Set<string>();
      const idsUsuariosComLock = new Set<string>();

      (resLocksAtivos.data || []).forEach((lock: any) => {
        if (lock.id_projeto) idsProjetosComLock.add(lock.id_projeto);
        if (lock.id_usuario) idsUsuariosComLock.add(lock.id_usuario);
      });

      setTotalProjetosBloqueados(idsProjetosComLock.size);
      setTotalAvaliadoresOcupados(idsUsuariosComLock.size);

      // Mapa de avaliações por projeto e conjunto de quarentenas ativas
      const contagemAvaliacoes = new Map<string, number>();
      const projetosEmQuarentena = new Set<string>();
      const avaliacoesPares: Array<{ id_projeto: string; id_usuario: string }> = [];

      (resAvaliacoes.data || []).forEach((av: any) => {
        if (av.id_projeto) {
          if (av.is_quarentena && (!av.quarentena_decisao || av.quarentena_decisao === 'pendente')) {
            projetosEmQuarentena.add(av.id_projeto);
          }
          const total = contagemAvaliacoes.get(av.id_projeto) || 0;
          contagemAvaliacoes.set(av.id_projeto, total + 1);

          if (av.id_usuario) {
            avaliacoesPares.push({ id_projeto: av.id_projeto, id_usuario: av.id_usuario });
          }
        }
      });

      setAvaliacoesRealizadas(avaliacoesPares);

      // 1. FILTRAGEM ESTRITA DE PROJETOS ELEGÍVEIS:
      // - Espelha RIGOROSAMENTE a presença do Staff: apenas com check-in confirmado (is_check_in_realizado/is_checkin = true)
      // - Não pode ter trava ativa (locks_ativos)
      // - Não pode estar fora da competição (is_fora_da_competicao)
      // - Não pode estar em quarentena pendente
      // - Não pode ter atingido a cota de 3 avaliações concluídas
      const todosProjetos = resProjetosData || [];
      const projetosFiltrados = todosProjetos.filter((p: any) => {
        const idProj = p.id_projeto || p.id;
        if (!idProj) return false;

        // Regra Estrita: Apenas projetos com Check-in presencial confirmado (Staff)
        const checkinPositivo = p.is_check_in_realizado === true || p.is_checkin === true;
        if (!checkinPositivo) return false;

        // Regra: Bloqueado por trava ativa no momento
        if (idsProjetosComLock.has(idProj)) return false;

        // Regra: Fora da competição / desclassificado
        if (p.is_fora_da_competicao === true) return false;

        // Regra: Quarentena pendente
        if (projetosEmQuarentena.has(idProj)) return false;

        // Regra: Cota de avaliações já preenchida
        const cota = p.cota_avaliacoes_customizada || 3;
        const feitas = contagemAvaliacoes.get(idProj) || 0;
        if (feitas >= cota) return false;

        return true;
      });

      const projetosNormalizados: ProjetoItem[] = projetosFiltrados.map((p: any) => {
        const nomeInst = Array.isArray(p.instituicoes)
          ? p.instituicoes[0]?.nome_exibicao
          : (p.instituicoes as any)?.nome_exibicao || p.nome_instituicao;
        const nomeMod = Array.isArray(p.modalidades)
          ? p.modalidades[0]?.nome_modalidade
          : (p.modalidades as any)?.nome_modalidade || p.modalidade;

        return {
          id_projeto: p.id_projeto || p.id,
          id: p.id_projeto || p.id,
          codigo_projeto: p.codigo_projeto || null,
          titulo: p.titulo || p.titulo_projeto || 'Projeto sem título',
          titulo_projeto: p.titulo || p.titulo_projeto || 'Projeto sem título',
          estande: p.estande || p.estande_numero || 'EST-S/N',
          estande_numero: p.estande || p.estande_numero || 'EST-S/N',
          corredor: p.corredor || 'A',
          modalidade: nomeMod || 'Geral',
          id_instituicao: p.id_instituicao || null,
          nome_instituicao: nomeInst || null,
          is_check_in_realizado: true,
          total_avaliacoes_feitas: contagemAvaliacoes.get(p.id_projeto || p.id) || 0,
        };
      });

      setListaProjetosElegiveis(projetosNormalizados);

      // 2. FILTRAGEM ESTRITA DE AVALIADORES ELEGÍVEIS:
      // - Consulta e amarração real com o evento ativo via avaliadores_evento (is_credenciado = true)
      // - Não pode ter trava ativa no momento (locks_ativos)
      const idsCredenciadosNoEvento = new Set<string>();
      const mapaInstituicaoAvaliador = new Map<string, { id_inst?: string; nome_inst?: string }>();

      (resAvaliadoresEvento.data || []).forEach((ae: any) => {
        if (ae.id_usuario && ae.is_credenciado === true) {
          idsCredenciadosNoEvento.add(ae.id_usuario);
          const nomeInst = Array.isArray(ae.instituicoes)
            ? ae.instituicoes[0]?.nome_exibicao
            : (ae.instituicoes as any)?.nome_exibicao;
          mapaInstituicaoAvaliador.set(ae.id_usuario, {
            id_inst: ae.id_instituicao,
            nome_inst: nomeInst
          });
        }
      });

      const avaliadoresBrutos = resAvaliadoresCredenciados.data || [];
      const avaliadoresElegiveisFiltrados = avaliadoresBrutos.filter((a: any) => {
        const idUsuario = a.id_usuario || a.id;
        if (!idUsuario) return false;

        // Regra: Deve possuir registro ativo com is_credenciado = true
        if (a.is_credenciado !== true) return false;

        // Regra: Amarração real com o evento (deve constar em avaliadores_evento credenciado)
        if (idsCredenciadosNoEvento.size > 0 && !idsCredenciadosNoEvento.has(idUsuario)) {
          return false;
        }

        // Regra: Não pode ter trava ativa (já ocupado em outra avaliação)
        if (idsUsuariosComLock.has(idUsuario)) return false;

        return true;
      });

      const avaliadoresNormalizados: UsuarioAvaliadorItem[] = avaliadoresElegiveisFiltrados.map((a: any) => {
        const idUsuario = a.id_usuario || a.id;
        const instInfo = mapaInstituicaoAvaliador.get(idUsuario);

        return {
          id_usuario: idUsuario,
          id: idUsuario,
          nome: a.nome || 'Avaliador',
          email: a.email || '',
          papel: a.papel || 'AVALIADOR',
          is_credenciado: true,
          id_instituicao: instInfo?.id_inst || null,
          nome_instituicao: instInfo?.nome_inst || null,
        };
      });

      setListaAvaliadoresElegiveis(avaliadoresNormalizados);
    } catch (err: any) {
      console.error('Erro ao carregar entidades elegíveis no Supabase:', err);
      setMensagemErro(`Falha ao sincronizar entidades: ${err.message || err}`);
    } finally {
      setCarregandoDados(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      carregarDadosElegiveis();
    }
  }, [isOpen, conexaoConfigurada]);

  // Objeto do projeto selecionado
  const projetoObj = useMemo(() => {
    return listaProjetosElegiveis.find((p) => (p.id_projeto || p.id) === projetoSelecionado);
  }, [listaProjetosElegiveis, projetoSelecionado]);

  // Avaliadores com checagem dinâmica de elegibilidade contextual (quando um projeto está selecionado)
  const avaliadoresComElegibilidadeContextual = useMemo(() => {
    return listaAvaliadoresElegiveis.map((aval) => {
      let motivoInelegivel: string | null = null;

      if (projetoObj) {
        // Conflito de Interesse: mesma instituição
        if (
          aval.id_instituicao &&
          projetoObj.id_instituicao &&
          aval.id_instituicao === projetoObj.id_instituicao
        ) {
          motivoInelegivel = 'Conflito: Mesma Instituição';
        }

        // Já avaliou este projeto
        const jaAvaliou = avaliacoesRealizadas.some(
          (av) => av.id_projeto === projetoObj.id_projeto && av.id_usuario === aval.id_usuario
        );
        if (jaAvaliou) {
          motivoInelegivel = 'Já avaliou este projeto';
        }
      }

      return {
        ...aval,
        elegivelParaProjeto: !motivoInelegivel,
        motivoInelegivel,
      };
    });
  }, [listaAvaliadoresElegiveis, projetoObj, avaliacoesRealizadas]);

  // Filtros de busca
  const projetosFiltrados = useMemo(() => {
    const t = buscaProjeto.trim().toLowerCase();
    if (!t) return listaProjetosElegiveis;
    return listaProjetosElegiveis.filter((p) => {
      const cod = (p.codigo_projeto || '').toLowerCase();
      const tit = (p.titulo || p.titulo_projeto || '').toLowerCase();
      const est = (p.estande || p.estande_numero || '').toLowerCase();
      const mod = (p.modalidade || '').toLowerCase();
      return cod.includes(t) || tit.includes(t) || est.includes(t) || mod.includes(t);
    });
  }, [listaProjetosElegiveis, buscaProjeto]);

  const avaliadoresFiltrados = useMemo(() => {
    const t = buscaAvaliador.trim().toLowerCase();
    if (!t) return avaliadoresComElegibilidadeContextual;
    return avaliadoresComElegibilidadeContextual.filter((a) => {
      const nome = (a.nome || '').toLowerCase();
      const email = (a.email || '').toLowerCase();
      return nome.includes(t) || email.includes(t);
    });
  }, [avaliadoresComElegibilidadeContextual, buscaAvaliador]);

  const avaliadorObj = useMemo(() => {
    return listaAvaliadoresElegiveis.find((a) => (a.id_usuario || a.id) === avaliadorSelecionado);
  }, [listaAvaliadoresElegiveis, avaliadorSelecionado]);

  // Submissão da atribuição forçada (Gravação na tabela 'locks_ativos' com expira_em)
  const handleForcarAtribuicao = async () => {
    if (!projetoSelecionado) {
      alert('Selecione um projeto elegível na coluna da esquerda.');
      return;
    }
    if (!avaliadorSelecionado) {
      alert('Selecione um avaliador elegível na coluna da direita.');
      return;
    }

    const avalInfo = avaliadoresComElegibilidadeContextual.find(
      (a) => a.id_usuario === avaliadorSelecionado
    );
    if (avalInfo && !avalInfo.elegivelParaProjeto) {
      alert(`Avaliador inelegível para este projeto: ${avalInfo.motivoInelegivel}`);
      return;
    }

    setSubmetendo(true);
    try {
      // Regra obrigatória: expira_em definido para daqui a 2 horas
      const expiracao = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from('locks_ativos').insert([{ 
        id_projeto: projetoSelecionado, 
        id_usuario: avaliadorSelecionado,
        expira_em: expiracao
      }]);

      if (error) {
        console.error('Erro ao inserir lock na tabela locks_ativos:', error);
        const msg = (error.message || '').toLowerCase();
        if (
          error.code === '23505' ||
          msg.includes('duplicate') ||
          msg.includes('unique') ||
          msg.includes('already exists') ||
          msg.includes('chave duplicada')
        ) {
          alert('Atenção: Este projeto ou avaliador acabou de receber uma trava ativa!');
        } else {
          alert(`Erro ao registrar trava de avaliação: ${error.message}`);
        }
        await carregarDadosElegiveis();
        return;
      }

      alert('Atribuição forçada realizada com sucesso! A trava ativa foi criada no banco de dados (validade de 2 horas).');
      limparEstados();
      if (aoSucesso) aoSucesso();
      aoFechar();
    } catch (err: any) {
      console.error('Falha de execução na atribuição forçada:', err);
      alert(`Erro inesperado ao forçar atribuição: ${err?.message || err}`);
    } finally {
      setSubmetendo(false);
    }
  };

  const limparEstados = () => {
    setProjetoSelecionado(null);
    setAvaliadorSelecionado(null);
    setBuscaProjeto('');
    setBuscaAvaliador('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto font-sans">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-6xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* CABEÇALHO DO MODAL */}
        <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  Atribuição Forçada de Projetos
                </h2>
                <span className="text-xs bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold px-2.5 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-700 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Regras de Negócio: Apenas Entidades Elegíveis
                </span>
                <span className="text-[11px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold px-2 py-0.5 rounded-md flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  Validade: 2 Horas
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Exclui automaticamente projetos com travas ativas, fora de competição e avaliadores não credenciados ou ocupados.
              </p>
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

        {/* FEEDBACK DE ERRO SE HOUVER */}
        {mensagemErro && (
          <div className="px-6 py-2.5 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-800 flex items-center gap-2 text-xs font-bold text-red-800 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{mensagemErro}</span>
          </div>
        )}

        {/* CORPO DO MODAL: LAYOUT DE DUAS COLUNAS LADO A LADO */}
        <div className="p-4 sm:p-6 flex-1 overflow-hidden min-h-0 flex flex-col">
          {carregandoDados ? (
            <div className="py-20 text-center space-y-3 my-auto">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-500">
                Carregando e validando entidades elegíveis no Supabase...
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden">
              {/* COLUNA ESQUERDA: LISTA DE PROJETOS ELEGÍVEIS */}
              <div className="flex flex-col min-h-0 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800">
                {/* Cabeçalho da coluna de Projetos */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700 mb-3">
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider block">
                        Projetos Elegíveis ({projetosFiltrados.length})
                      </span>
                      {totalProjetosBloqueados > 0 && (
                        <span className="text-[10px] text-slate-400 font-normal">
                          {totalProjetosBloqueados} com trava ativa foram excluídos
                        </span>
                      )}
                    </div>
                  </div>
                  {projetoSelecionado && (
                    <span className="text-[10px] bg-emerald-600 text-white font-bold px-2 py-0.5 rounded-full">
                      1 Selecionado
                    </span>
                  )}
                </div>

                {/* Campo de Busca de Projetos */}
                <div className="relative mb-3">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={buscaProjeto}
                    onChange={(e) => setBuscaProjeto(e.target.value)}
                    placeholder="Filtrar por estande, código ou título..."
                    className="w-full pl-9 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none placeholder:text-slate-400"
                  />
                  {buscaProjeto && (
                    <button
                      type="button"
                      onClick={() => setBuscaProjeto('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Lista rolável de Projetos Elegíveis */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0">
                  {projetosFiltrados.length === 0 ? (
                    <div className="p-8 text-center text-xs font-semibold text-slate-500 border border-dashed rounded-xl bg-white dark:bg-slate-900 space-y-1">
                      <p>Nenhum projeto elegível encontrado.</p>
                      <p className="text-[10px] text-slate-400 font-normal">
                        Todos os projetos da feira já possuem travas ativas, quarentenas pendentes ou cotas atingidas.
                      </p>
                    </div>
                  ) : (
                    projetosFiltrados.map((proj) => {
                      const id = proj.id_projeto || proj.id || '';
                      const selecionado = projetoSelecionado === id;
                      const titulo = proj.titulo || proj.titulo_projeto || 'Sem Título';
                      const estande = proj.estande || proj.estande_numero || 'EST-S/N';
                      const codigo = proj.codigo_projeto || 'COD-S/N';
                      const modalidade = proj.modalidade || 'Geral';
                      const inst = proj.nome_instituicao;

                      return (
                        <div
                          key={id}
                          onClick={() => {
                            setProjetoSelecionado(id);
                            // Se o avaliador selecionado entrar em conflito com este novo projeto, limpa a seleção
                            if (avaliadorSelecionado) {
                              const aval = listaAvaliadoresElegiveis.find((a) => a.id_usuario === avaliadorSelecionado);
                              if (aval?.id_instituicao && proj.id_instituicao && aval.id_instituicao === proj.id_instituicao) {
                                setAvaliadorSelecionado(null);
                              }
                            }
                          }}
                          className={`p-3 rounded-xl border cursor-pointer transition-all text-left flex flex-col gap-1.5 ${
                            selecionado
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 dark:border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50/80 dark:hover:bg-slate-800/80'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[10px] font-black bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2 py-0.5 rounded-md">
                                {estande}
                              </span>
                              <span className="font-mono text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                                {codigo}
                              </span>
                              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                Elegível
                              </span>
                            </div>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                              selecionado
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}>
                              {selecionado && <CheckCircle2 className="w-3 h-3" />}
                            </div>
                          </div>

                          <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug">
                            {titulo}
                          </h4>

                          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800 flex-wrap gap-1">
                            <span className="truncate max-w-[160px] font-medium">{modalidade}</span>
                            {inst && (
                              <span className="text-[9px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 truncate max-w-[140px]">
                                {inst}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* COLUNA DIREITA: LISTA DE AVALIADORES ELEGÍVEIS */}
              <div className="flex flex-col min-h-0 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800">
                {/* Cabeçalho da coluna de Avaliadores */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700 mb-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider block">
                        Avaliadores Credenciados ({avaliadoresFiltrados.length})
                      </span>
                      {totalAvaliadoresOcupados > 0 && (
                        <span className="text-[10px] text-slate-400 font-normal">
                          {totalAvaliadoresOcupados} ocupados em avaliação foram excluídos
                        </span>
                      )}
                    </div>
                  </div>
                  {avaliadorSelecionado && (
                    <span className="text-[10px] bg-emerald-600 text-white font-bold px-2 py-0.5 rounded-full">
                      1 Selecionado
                    </span>
                  )}
                </div>

                {/* Campo de Busca de Avaliadores */}
                <div className="relative mb-3">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={buscaAvaliador}
                    onChange={(e) => setBuscaAvaliador(e.target.value)}
                    placeholder="Filtrar por nome ou e-mail..."
                    className="w-full pl-9 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none placeholder:text-slate-400"
                  />
                  {buscaAvaliador && (
                    <button
                      type="button"
                      onClick={() => setBuscaAvaliador('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Lista rolável de Avaliadores Elegíveis */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0">
                  {avaliadoresFiltrados.length === 0 ? (
                    <div className="p-8 text-center text-xs font-semibold text-slate-500 border border-dashed rounded-xl bg-white dark:bg-slate-900 space-y-1">
                      <p>Nenhum avaliador credenciado disponível.</p>
                      <p className="text-[10px] text-slate-400 font-normal">
                        Todos os avaliadores estão em avaliação ativa ou não foram credenciados no credenciamento do evento.
                      </p>
                    </div>
                  ) : (
                    avaliadoresFiltrados.map((aval) => {
                      const id = aval.id_usuario || aval.id || '';
                      const selecionado = avaliadorSelecionado === id;
                      const bloqueadoContexto = !aval.elegivelParaProjeto;

                      return (
                        <div
                          key={id}
                          onClick={() => {
                            if (bloqueadoContexto) {
                              alert(`Avaliador bloqueado: ${aval.motivoInelegivel}`);
                              return;
                            }
                            setAvaliadorSelecionado(id);
                          }}
                          className={`p-3 rounded-xl border transition-all text-left flex items-center justify-between gap-2.5 ${
                            bloqueadoContexto
                              ? 'bg-slate-100/70 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-60 cursor-not-allowed'
                              : selecionado
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 dark:border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs cursor-pointer'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50/80 dark:hover:bg-slate-800/80 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                              bloqueadoContexto
                                ? 'bg-slate-200 text-slate-400'
                                : selecionado
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                            }`}>
                              {aval.nome?.charAt(0)?.toUpperCase() || 'A'}
                            </div>

                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                  {aval.nome}
                                </h4>
                                <span className="inline-block text-[9px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.2 rounded border border-emerald-200 dark:border-emerald-800 uppercase tracking-wider">
                                  Credenciado
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {aval.email}
                              </p>
                              {aval.nome_instituicao && (
                                <p className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                                  <Building className="w-3 h-3 shrink-0" />
                                  <span>{aval.nome_instituicao}</span>
                                </p>
                              )}
                              {bloqueadoContexto && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                                  <Ban className="w-3 h-3" />
                                  {aval.motivoInelegivel}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                            bloqueadoContexto
                              ? 'border-slate-300 bg-slate-200'
                              : selecionado
                              ? 'bg-emerald-600 border-emerald-600 text-white'
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
            </div>
          )}
        </div>

        {/* RESUMO FIXO E BOTÕES DE AÇÃO */}
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 space-y-3">
          {/* Cards de Resumo dos Itens Selecionados */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                Projeto Selecionado:
              </span>
              {projetoObj ? (
                <div className="font-bold text-slate-800 dark:text-slate-200 truncate text-xs">
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 mr-1 font-black">
                    [{projetoObj.estande || projetoObj.codigo_projeto}]
                  </span>
                  {projetoObj.titulo || projetoObj.titulo_projeto}
                  {projetoObj.nome_instituicao && (
                    <span className="text-slate-400 font-normal ml-1">
                      ({projetoObj.nome_instituicao})
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-400 italic text-xs">Selecione um projeto elegível na coluna esquerda</span>
              )}
            </div>

            <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                Avaliador Selecionado:
              </span>
              {avaliadorObj ? (
                <div className="font-bold text-slate-800 dark:text-slate-200 truncate text-xs">
                  <span className="text-emerald-600 dark:text-emerald-400 mr-1 font-bold">
                    {avaliadorObj.nome}
                  </span>
                  <span className="text-slate-400 font-normal">({avaliadorObj.email})</span>
                  {avaliadorObj.nome_instituicao && (
                    <span className="text-slate-400 font-normal ml-1">
                      - {avaliadorObj.nome_instituicao}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-400 italic text-xs">Selecione um avaliador credenciado na coluna direita</span>
              )}
            </div>
          </div>

          {/* Barra de Ações */}
          <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>A trava criada expira automaticamente em 2 horas.</span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  limparEstados();
                  aoFechar();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={submetendo || !projetoSelecionado || !avaliadorSelecionado}
                onClick={handleForcarAtribuicao}
                className="px-6 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                {submetendo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                <span>Forçar Atribuição Elegível</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
