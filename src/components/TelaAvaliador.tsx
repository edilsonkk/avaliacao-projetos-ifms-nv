import React, { useState, useEffect } from 'react';
import {
  MapPin,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Save,
  Building,
  GraduationCap,
  Sparkles,
  RotateCcw,
  WifiOff,
  Loader2,
  Inbox,
  UserCheck,
  LogOut,
  Mail,
  Lock,
} from 'lucide-react';
import type { Projeto } from '../types/database';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';
import { TelaLogin } from './TelaLogin';

interface CriterioLikert {
  id_criterio: string;
  titulo_criterio: string;
  descricao_criterio: string;
  descricao_lembrete?: string;
}

export interface QuestionarioItem {
  id_questionario: string;
  titulo: string;
  escala_minima?: number;
  escala_maxima?: number;
}

// Rótulos visuais descritivos para a escala Likert (1 a 5)
export const LABELS_LIKERT: Record<number, string> = {
  1: 'Péssimo',
  2: 'Ruim',
  3: 'Regular',
  4: 'Bom',
  5: 'Excelente',
};

interface PropriedadesTelaAvaliador {
  id_usuario?: string;
  id_evento?: string;
  id_usuario_logado?: string;
  id_evento_ativo?: string;
  onLogout?: () => void;
}

const criterios_avaliacao_likert: CriterioLikert[] = [
  {
    id_criterio: 'crit-1',
    titulo_criterio: '1. Metodologia Científica e Rigor',
    descricao_criterio: 'Domínio do método científico, clareza nos objetivos e coerência entre hipótese e resultados.',
  },
  {
    id_criterio: 'crit-2',
    titulo_criterio: '2. Originalidade e Inovação',
    descricao_criterio: 'Grau de criatividade na solução do problema e relevância social ou tecnológica.',
  },
  {
    id_criterio: 'crit-3',
    titulo_criterio: '3. Viabilidade Técnica e Apresentação',
    descricao_criterio: 'Qualidade do protótipo/banner e capacidade de articulação e defesa oral dos estudantes.',
  },
];

// Dados mock de fallback para quando a Stored Procedure do Supabase estiver vazia ou em teste offline
const projetos_mock_fallback: Projeto[] = [
  {
    id: 'proj-001',
    id_projeto: 'proj-001',
    titulo_projeto: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
    titulo: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
    area_conhecimento: 'Engenharias e Ciências Agrárias',
    nome_instituicao: 'IFMS - Câmpus Campo Grande',
    estudantes_nomes: ['Gabriel Lima', 'Beatriz Santos'],
    expositores: 'Gabriel Lima, Beatriz Santos',
    corredor: 'A',
    estande_numero: 'EST-A12',
    estande: 'EST-A12',
    is_check_in_realizado: true,
  },
  {
    id: 'proj-002',
    id_projeto: 'proj-002',
    titulo_projeto: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
    titulo: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
    area_conhecimento: 'Ciências Biológicas e da Saúde',
    nome_instituicao: 'IFMS - Câmpus Corumbá',
    estudantes_nomes: ['Enzo Gabriel', 'Camila Rocha'],
    expositores: 'Enzo Gabriel, Camila Rocha',
    corredor: 'B',
    estande_numero: 'EST-B05',
    estande: 'EST-B05',
    is_check_in_realizado: true,
  },
];

// Utilitário de validação UUID v4 para integridade com PostgreSQL
const isUUID = (str?: string): boolean =>
  !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

export const TelaAvaliador: React.FC<PropriedadesTelaAvaliador> = ({
  id_evento = 'evt-2026-ifms',
  id_usuario_logado: prop_id_usuario_logado,
  id_evento_ativo: prop_id_evento_ativo,
  onLogout,
}) => {
  // 1. SIMULADOR DE LOGIN: Estado do usuário avaliador conectado
  const [id_usuario_logado, set_id_usuario_logado] = useState<string | null>(() => {
    return prop_id_usuario_logado || localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario') || null;
  });
  const [email_avaliador_salvo, set_email_avaliador_salvo] = useState<string>(() => {
    return localStorage.getItem('sessao_email') || localStorage.getItem('avaliador_email') || '';
  });
  const [nome_avaliador_salvo, set_nome_avaliador_salvo] = useState<string>(() => {
    return localStorage.getItem('avaliador_nome') || '';
  });

  // PROTEÇÃO DE CONCORRÊNCIA: Previne múltiplos cliques simultâneos
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Projeto atualmente sorteado para o avaliador
  const [projeto_atual, set_projeto_atual] = useState<Projeto | null>(null);

  // Estados do formulário de avaliação - null por padrão para exigir confirmação de presença
  const [status_presenca, set_status_presenca] = useState<'presente' | 'ausente' | null>(null);
  const [lista_criterios, set_lista_criterios] = useState<CriterioLikert[]>([]);
  const [notas_criterios, set_notas_criterios] = useState<Record<string, number>>({});
  const [parecer_avaliador, set_parecer_avaliador] = useState<string>('');

  // 1. FLUXO DE SELEÇÃO E FIXAÇÃO DE QUESTIONÁRIO: Estados
  const [questionarios_disponiveis, set_questionarios_disponiveis] = useState<QuestionarioItem[]>([]);
  const [carregando_lista_questionarios, set_carregando_lista_questionarios] = useState<boolean>(false);
  const [id_questionario_selecionado, set_id_questionario_selecionado] = useState<string | null>(null);
  const [carregando_perguntas, set_carregando_perguntas] = useState<boolean>(false);

  // Controle de requisição e estado de conexões
  const [carregando_sorteio, set_carregando_sorteio] = useState<boolean>(false);
  const [mensagem_fila_vazia, set_mensagem_fila_vazia] = useState<string | null>(null);
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [mostrar_modal_conflito, set_mostrar_modal_conflito] = useState<boolean>(false);
  const [is_dispositivo_offline, set_is_dispositivo_offline] = useState<boolean>(!navigator.onLine);
  const [verificando_lock, set_verificando_lock] = useState<boolean>(() => !!(prop_id_usuario_logado || localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario')));

  const conexao_banco_configurada = verificar_conexao_configurada();

  // Monitora alterações de conectividade da rede
  useEffect(() => {
    const escutar_online = () => set_is_dispositivo_offline(false);
    const escutar_offline = () => set_is_dispositivo_offline(true);

    window.addEventListener('online', escutar_online);
    window.addEventListener('offline', escutar_offline);

    return () => {
      window.removeEventListener('online', escutar_online);
      window.removeEventListener('offline', escutar_offline);
    };
  }, []);

  // Sincroniza estado caso o localStorage seja limpo globalmente (pelo botão Sair)
  useEffect(() => {
    const escutarStorage = () => {
      const storedId = localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario');
      if (!storedId) {
        set_id_usuario_logado(null);
        set_email_avaliador_salvo('');
        set_nome_avaliador_salvo('');
        set_projeto_atual(null);
        set_status_presenca(null);
        set_verificando_lock(false);
      }
    };
    window.addEventListener('storage', escutarStorage);
    return () => window.removeEventListener('storage', escutarStorage);
  }, []);

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  // Carrega perguntas dinâmicas do questionário se cadastradas
  // 1. FLUXO DE SELEÇÃO E FIXAÇÃO DE QUESTIONÁRIO:
  // Carrega lista de questionários disponíveis no evento / sistema
  const carregar_questionarios_disponiveis = async (): Promise<QuestionarioItem[]> => {
    set_carregando_lista_questionarios(true);
    try {
      let { data: dados, error } = await supabase
        .from('questionarios')
        .select('*');

      if (error || !dados || dados.length === 0) {
        const { data: dadosSing } = await supabase.from('questionario').select('*');
        if (dadosSing && dadosSing.length > 0) {
          dados = dadosSing;
        }
      }

      const formatados: QuestionarioItem[] = (dados || []).map((q: any) => ({
        id_questionario: q.id_questionario || q.id || 'quest-default',
        titulo: q.titulo_questionario || q.titulo || 'Questionário IFMS',
        escala_minima: q.escala_minima || 1,
        escala_maxima: q.escala_maxima || 5,
      }));

      set_questionarios_disponiveis(formatados);

      // Regra de Auto-Seleção Zero-Fricção
      if (formatados && formatados.length === 1) {
        const questUnico = formatados[0];
        set_id_questionario_selecionado(questUnico.id_questionario);

        // É obrigatório buscar as perguntas imediatamente, senão a tela quebra
        carregarPerguntasQuestionario(questUnico.id_questionario);
      }

      return formatados;
    } catch (err: any) {
      console.warn('Aviso ao carregar questionários disponíveis:', err?.message || err);
      set_questionarios_disponiveis([]);
      return [];
    } finally {
      set_carregando_lista_questionarios(false);
    }
  };

  // Carrega perguntas estritamente vinculadas ao questionário especificado (.eq('id_questionario', id_questionario))
  // EVITA DUPLICAÇÃO E GARANTE QUE A TELA SEJA HIDRATADA
  const carregarPerguntasQuestionario = async (id_questionario: string) => {
    set_carregando_perguntas(true);
    set_id_questionario_selecionado(id_questionario);

    try {
      const { data: pergs, error: pergsErr } = await supabase
        .from('perguntas_questionario')
        .select('*')
        .eq('id_questionario', id_questionario)
        .order('ordem', { ascending: true });

      if (pergsErr) {
        console.error('Erro ao carregar perguntas do questionário:', pergsErr.message);
        alert('Erro ao carregar perguntas: ' + pergsErr.message);
        set_carregando_perguntas(false);
        return;
      }

      if (pergs && pergs.length > 0) {
        // Blindagem contra duplicação de perguntas
        const idsVistos = new Set<string>();
        const perguntasUnicas = pergs.filter((p) => {
          const id = p.id_pergunta || p.id;
          if (!id || idsVistos.has(id)) return false;
          idsVistos.add(id);
          return true;
        });

        const formatadas: CriterioLikert[] = perguntasUnicas.map((p) => ({
          id_criterio: p.id_pergunta || p.id || 'p-' + p.ordem,
          titulo_criterio: `${p.ordem}. ${p.texto_pergunta}`,
          descricao_criterio: p.texto_pergunta,
          descricao_lembrete: p.descricao_lembrete || p.lembrete || p.texto_ajuda || undefined,
        }));

        set_lista_criterios(formatadas);

        const questObj = questionarios_disponiveis.find((q) => q.id_questionario === id_questionario);
        const notaPadrao = questObj?.escala_maxima || 5;

        const notasInit: Record<string, number> = {};
        formatadas.forEach((f) => {
          notasInit[f.id_criterio] = notaPadrao;
        });
        set_notas_criterios(notasInit);
      } else {
        // Fallback caso o questionário não possua perguntas criadas ainda no banco
        set_lista_criterios(criterios_avaliacao_likert);
        const notasInit: Record<string, number> = {};
        criterios_avaliacao_likert.forEach((f) => {
          notasInit[f.id_criterio] = 5;
        });
        set_notas_criterios(notasInit);
      }
    } catch (e: any) {
      console.warn('Erro ao carregar perguntas do questionário:', e?.message || e);
      set_lista_criterios(criterios_avaliacao_likert);
    } finally {
      set_carregando_perguntas(false);
    }
  };

  // Avaliador escolhe um questionário da lista
  const selecionar_questionario = async (questOuId: QuestionarioItem | string) => {
    const id_quest = typeof questOuId === 'string' ? questOuId : questOuId.id_questionario;
    await carregarPerguntasQuestionario(id_quest);
  };
  const handleSelecionarQuestionario = selecionar_questionario;

  // Botão "Trocar Questionário" (visível apenas se não houver questionário fixado no banco)
  const trocar_questionario = () => {
    if (projeto_atual?.id_questionario_fixado) {
      console.warn('Não é permitido trocar questionário já fixado no banco.');
      return;
    }
    set_id_questionario_selecionado(null);
    set_lista_criterios([]);
    set_notas_criterios({});
  };

  // Pré-carrega os questionários disponíveis no início
  useEffect(() => {
    carregar_questionarios_disponiveis();
  }, []);

  // 3. LOGOUT (Limpeza Absoluta):
  // Limpa o estado de autenticação e executa a remoção completa do cache local
  const logout_avaliador = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Erro ao encerrar sessão no Supabase Auth:', e);
    }
    localStorage.removeItem('sessao_id_usuario');
    localStorage.removeItem('sessao_papel');
    localStorage.removeItem('sessao_email');
    localStorage.clear();
    set_id_usuario_logado(null);
    set_email_avaliador_salvo('');
    set_nome_avaliador_salvo('');
    set_projeto_atual(null);
    set_status_presenca(null);
    set_verificando_lock(false);
    if (onLogout) {
      onLogout();
    }
  };

  // Obter id_evento ativo real (UUID)
  const obter_id_evento_ativo = async (): Promise<string> => {
    let id_evt = prop_id_evento_ativo || id_evento;
    if (!isUUID(id_evt)) {
      const { data: evt, error: evtErr } = await supabase
        .from('eventos')
        .select('id_evento')
        .eq('is_ativo', true)
        .single();

      if (evt?.id_evento) {
        id_evt = evt.id_evento;
      } else if (evtErr) {
        console.error('Erro ao buscar evento ativo:', evtErr);
      }
    }
    return id_evt;
  };

  // Helpers para padronização de hidratação de projeto e mensagens
  const setProjetoAtual = (proj: any) => {
    if (!proj) {
      set_projeto_atual(null);
      set_status_presenca(null);
      set_id_questionario_selecionado(null);
      set_lista_criterios([]);
      set_notas_criterios({});
      return;
    }
    const instNome = Array.isArray(proj.instituicoes)
      ? proj.instituicoes[0]?.nome_exibicao
      : (proj.instituicoes as any)?.nome_exibicao || proj.nome_instituicao;
    const modalidadeNome = Array.isArray(proj.modalidades)
      ? proj.modalidades[0]?.nome_modalidade
      : (proj.modalidades as any)?.nome_modalidade || proj.modalidade;
    const areaNome = Array.isArray(proj.areas_conhecimento)
      ? proj.areas_conhecimento[0]?.nome
      : (proj.areas_conhecimento as any)?.nome || proj.area_conhecimento;

    const projetoMapeado: Projeto = {
      ...proj,
      id: proj.id_projeto || proj.id,
      id_projeto: proj.id_projeto || proj.id,
      titulo_projeto: proj.titulo || proj.titulo_projeto || 'Projeto sem título',
      titulo: proj.titulo || proj.titulo_projeto || 'Projeto sem título',
      estande_numero: proj.estande || proj.estande_numero || 'EST-A01',
      estande: proj.estande || proj.estande_numero || 'EST-A01',
      corredor: proj.corredor || 'A',
      expositores: proj.expositores || (Array.isArray(proj.estudantes_nomes) ? proj.estudantes_nomes.join(', ') : proj.estudantes_nomes) || null,
      nome_instituicao: instNome || 'Sem Instituição',
      modalidade: modalidadeNome || null,
      area_conhecimento: areaNome || 'Área Geral',
      estudantes_nomes: proj.estudantes_nomes || ['Estudantes Expositores'],
      is_check_in_realizado: proj.is_check_in_realizado ?? true,
      id_questionario_fixado: proj.id_questionario_fixado || null,
    };
    set_projeto_atual(projetoMapeado);
    set_status_presenca(null);
    set_id_questionario_selecionado(null);
    set_lista_criterios([]);
    set_notas_criterios({});
  };

  const setMensagemFila = (msg: string | null) => {
    set_mensagem_fila_vazia(msg);
  };

  // 2. TRATAMENTO ROBUSTO DA RPC E HIDRATAÇÃO (Consumo Seguro do Cache Local):
  const acionarSorteio = async (id_evento_param?: string) => {
    const avaliadorId = localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario') || id_usuario_logado;
    if (!avaliadorId) {
      logout_avaliador();
      return;
    }

    set_carregando_sorteio(true);
    setMensagemFila(null);
    set_mensagem_erro(null);
    set_status_presenca(null);
    set_id_questionario_selecionado(null);
    set_lista_criterios([]);
    set_notas_criterios({});
    set_parecer_avaliador('');

    if (!conexao_banco_configurada) {
      setTimeout(() => {
        set_projeto_atual((anterior) => {
          if (!anterior) return projetos_mock_fallback[0];
          return anterior.id === 'proj-001' ? projetos_mock_fallback[1] : projetos_mock_fallback[0];
        });
        set_carregando_sorteio(false);
      }, 500);
      return;
    }

    try {
      let id_evento_ativo = id_evento_param;
      if (!id_evento_ativo) {
        id_evento_ativo = await obter_id_evento_ativo();
      }

      // Exclusão explícita de trava anterior usando a chave primária real obtida do cache
      await supabase.from('locks_ativos').delete().eq('id_usuario', avaliadorId);

      // Chamada RPC com o ID vindo obrigatoriamente do cache local
      let { data: ret, error: errSorteio } = await supabase.rpc('sortear_proximo_projeto', { 
        p_id_usuario: avaliadorId, 
        p_id_evento: id_evento_ativo 
      });

      // Suporte a alias de RPC (sortear_projeto / sortear_proximo_projeto)
      if (errSorteio && (errSorteio.message.includes('function') || errSorteio.code === 'PGRST202')) {
        const { data: retAlt, error: errAlt } = await supabase.rpc('sortear_projeto', {
          p_id_usuario: avaliadorId,
          p_id_evento: id_evento_ativo
        });
        if (!errAlt) {
          ret = retAlt;
          errSorteio = null;
        }
      }

      if (errSorteio) {
        console.error("Erro na RPC:", errSorteio);
        alert("Erro no motor de sorteio: " + errSorteio.message);
        set_mensagem_erro(`Erro RPC: ${errSorteio.message}`);
        return;
      }

      // Extração defensiva do UUID (trata tanto escalar quanto objeto)
      const idSorteado = typeof ret === 'object' && ret !== null ? Object.values(ret)[0] : ret;

      if (!idSorteado) {
        setMensagemFila("Todos os projetos disponíveis já foram avaliados ou bloqueados.");
        setProjetoAtual(null);
        return;
      }

      // Hidratação (Fetch Completo)
      const { data: proj, error: errProj } = await supabase
        .from('projetos')
        .select('*, modalidades(nome_modalidade), instituicoes(nome_exibicao)')
        .eq('id_projeto', idSorteado)
        .single();

      if (errProj || !proj) {
        alert("Erro grave: O projeto " + idSorteado + " foi sorteado, mas os detalhes não foram encontrados.");
        setProjetoAtual(null);
        return;
      }

      setProjetoAtual(proj);
      exibir_notificacao('Novo projeto sorteado e carregado para avaliação!');
    } catch (err: any) {
      console.error("Falha ao sortear próximo projeto:", err);
      alert("Falha ao Sortear Próximo Projeto: " + (err?.message || err));
      set_mensagem_erro("Falha ao sortear próximo projeto.");
    } finally {
      set_carregando_sorteio(false);
    }
  };

  // Alias para compatibilidade
  const puxar_novo_projeto = async (_forcar?: boolean) => {
    await acionarSorteio();
  };

  // 1. FLUXO AUTOMÁTICO (Zero-Fricção):
  useEffect(() => {
    const avaliadorId = localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario') || id_usuario_logado;
    if (!avaliadorId) {
      set_verificando_lock(false);
      return;
    }

    const inicializarFluxoAvaliador = async () => {
      set_verificando_lock(true);
      set_mensagem_erro(null);

      try {
        let id_evento_ativo = prop_id_evento_ativo;
        if (!id_evento_ativo || !isUUID(id_evento_ativo)) {
          const { data: evt, error: evtErr } = await supabase
            .from('eventos')
            .select('id_evento')
            .eq('is_ativo', true)
            .single();

          if (evtErr || !evt?.id_evento) {
            console.error('Nenhum evento ativo encontrado:', evtErr);
            alert('Aviso: Nenhum evento ativo encontrado para vincular a avaliação.');
            set_verificando_lock(false);
            return;
          }
          id_evento_ativo = evt.id_evento;
        }

        const { data: lockAtivo, error: errLock } = await supabase
          .from('locks_ativos')
          .select('id_projeto')
          .eq('id_usuario', avaliadorId)
          .maybeSingle();

        if (errLock) {
          console.error('Erro ao consultar lock ativo na inicialização:', errLock.message);
        }

        if (lockAtivo?.id_projeto) {
          const { data: proj } = await supabase
            .from('projetos')
            .select('*, modalidades(nome_modalidade), instituicoes(nome_exibicao)')
            .eq('id_projeto', lockAtivo.id_projeto)
            .single();

          if (proj) {
            setProjetoAtual(proj);
            setMensagemFila(null);
            exibir_notificacao('Avaliação em andamento retomada do banco de dados.');
          } else {
            console.warn('Lock ativo para projeto não encontrado. Removendo trava e sorteando...');
            await supabase.from('locks_ativos').delete().eq('id_usuario', avaliadorId);
            await acionarSorteio(id_evento_ativo);
          }
        } else {
          await acionarSorteio(id_evento_ativo);
        }
      } catch (err: any) {
        console.error('Falha no fluxo automático do avaliador:', err);
      } finally {
        set_verificando_lock(false);
      }
    };

    inicializarFluxoAvaliador();
  }, [id_usuario_logado, prop_id_evento_ativo]);

  // Função: registrar_conflito
  const registrar_conflito = async () => {
    if (isProcessing) return;
    const avaliadorId = localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario') || id_usuario_logado;
    if (!projeto_atual || !avaliadorId) {
      if (!avaliadorId) logout_avaliador();
      return;
    }

    setIsProcessing(true);
    const id_projeto = projeto_atual.id_projeto || projeto_atual.id;
    set_mostrar_modal_conflito(false);

    try {
      const { error: erro_impedimento } = await supabase
        .from('historico_impedimentos')
        .insert({
          id_usuario: avaliadorId,
          id_projeto: id_projeto,
          tipo: 'conflito',
        });

      if (erro_impedimento) {
        console.error('Erro ao registrar conflito em historico_impedimentos:', erro_impedimento.message);
        alert(`Aviso ao registrar conflito: ${erro_impedimento.message}`);
      }

      await supabase.from('locks_ativos').delete().eq('id_usuario', avaliadorId);

      set_projeto_atual(null);
      exibir_notificacao('Conflito registrado. Trava liberada e buscando próximo projeto...');
      await acionarSorteio();
    } catch (erro_excecao: any) {
      console.error('Falha ao registrar conflito:', erro_excecao);
      alert(`Falha ao registrar conflito: ${erro_excecao?.message || erro_excecao}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. TRANSAÇÃO DO BOTÃO AUSENTE:
  const registrar_ausencia = async () => {
    if (isProcessing) return;
    const avaliadorId = localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario') || id_usuario_logado;
    if (!projeto_atual || !avaliadorId) {
      if (!avaliadorId) logout_avaliador();
      return;
    }

    setIsProcessing(true);
    set_status_presenca('ausente');
    const id_projeto = projeto_atual.id_projeto || projeto_atual.id;

    try {
      const { error: erro_impedimento } = await supabase
        .from('historico_impedimentos')
        .insert({
          id_usuario: avaliadorId,
          id_projeto: id_projeto,
          tipo: 'ausencia',
        });

      if (erro_impedimento) {
        console.error('Erro ao registrar ausência em historico_impedimentos:', erro_impedimento.message);
        alert(`Aviso ao registrar ausência: ${erro_impedimento.message}`);
      }

      await supabase
        .from('locks_ativos')
        .delete()
        .eq('id_usuario', avaliadorId);

      set_projeto_atual(null);
      exibir_notificacao('Ausência registrada. Liberando trava e buscando próximo projeto...');

      await acionarSorteio();
    } catch (erro_excecao: any) {
      console.error('Falha ao registrar ausência no Supabase:', erro_excecao);
      alert(`Falha ao registrar ausência: ${erro_excecao?.message || erro_excecao}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 1. FLUXO DE SELEÇÃO E FIXAÇÃO DE QUESTIONÁRIO:
  const marcar_presenca = async (status: 'presente' | 'ausente') => {
    if (status === 'presente') {
      set_status_presenca('presente');

      if (!projeto_atual) return;

      const id_fixado = projeto_atual.id_questionario_fixado;
      if (id_fixado) {
        await carregarPerguntasQuestionario(id_fixado);
      } else {
        if (questionarios_disponiveis.length === 0) {
          const questList = await carregar_questionarios_disponiveis();
          if (questList.length === 1) {
            await carregarPerguntasQuestionario(questList[0].id_questionario);
          }
        } else if (questionarios_disponiveis.length === 1) {
          await carregarPerguntasQuestionario(questionarios_disponiveis[0].id_questionario);
        }
      }
      return;
    }
    await registrar_ausencia();
  };

  // Função: enviar_avaliacao (salvarAvaliacao)
  const enviar_avaliacao = async () => {
    if (isProcessing) return;
    const avaliadorId = localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario') || id_usuario_logado;
    if (!projeto_atual || !avaliadorId) {
      if (!avaliadorId) logout_avaliador();
      return;
    }

    setIsProcessing(true);
    const id_projeto_alvo = projeto_atual.id_projeto || projeto_atual.id;

    const valores_notas = Object.values(notas_criterios);
    const soma_notas = valores_notas.reduce((acc, curr) => acc + curr, 0);
    const nota_final = Number((soma_notas / (valores_notas.length || 1)).toFixed(2));

    if (!navigator.onLine || !conexao_banco_configurada) {
      const desconexao_timestamp = new Date().toISOString();

      const avaliacao_offline = {
        id_usuario: avaliadorId,
        id_projeto: id_projeto_alvo,
        status_presenca,
        notas_criterios,
        nota_final,
        parecer_final: parecer_avaliador,
        desconexao_timestamp,
      };

      try {
        const fila_offline_existente = JSON.parse(
          localStorage.getItem('avaliacoes_offline_pendentes') || '[]'
        );
        localStorage.setItem(
          'avaliacoes_offline_pendentes',
          JSON.stringify([...fila_offline_existente, avaliacao_offline])
        );
      } catch (e: any) {
        console.error('Erro ao gravar no localStorage:', e);
        alert(`Erro offline ao gravar no localStorage: ${e?.message || e}`);
      }

      exibir_notificacao('Dispositivo Offline! Avaliação salva localmente para futura sincronização.');
      await puxar_novo_projeto();
      setIsProcessing(false);
      return;
    }

    try {
      const { data: avaliacao_gerada, error: erro_avaliacao } = await supabase
        .from('avaliacoes')
        .insert({
          id_projeto: id_projeto_alvo,
          id_usuario: avaliadorId,
          nota_final: nota_final,
          parecer_final: parecer_avaliador,
          tempo_presenca: new Date().toISOString(),
        })
        .select('id_avaliacao')
        .single();

      if (erro_avaliacao) {
        console.error('Erro ao gravar avaliação:', erro_avaliacao.message);
        alert(`Falha no salvamento da avaliação: ${erro_avaliacao.message}`);
        set_mensagem_erro(`Falha no salvamento: ${erro_avaliacao.message}`);
        setIsProcessing(false);
        return;
      }

      const id_avaliacao_retornado = avaliacao_gerada?.id_avaliacao || 'aval-' + Date.now();

      const respostasMapeadas = Object.entries(notas_criterios).map(([id_crit, nota_val]) => ({
        id_avaliacao: id_avaliacao_retornado,
        id_pergunta: id_crit,
        nota_atribuida: nota_val,
      }));

      const { error: erro_respostas } = await supabase
        .from('respostas_avaliacao')
        .insert(respostasMapeadas);

      if (erro_respostas) {
        console.warn('Erro ao inserir respostas em lote:', erro_respostas.message);
        alert(`Aviso ao gravar respostas: ${erro_respostas.message}`);
      }

      const projetoAtual = projeto_atual;
      const idQuestionarioEscolhido = id_questionario_selecionado;

      if (!projetoAtual.id_questionario_fixado && idQuestionarioEscolhido) {
        await supabase
          .from('projetos')
          .update({ id_questionario_fixado: idQuestionarioEscolhido })
          .eq('id_projeto', projetoAtual.id_projeto || projetoAtual.id);
      }

      await supabase.from('locks_ativos').delete().eq('id_usuario', avaliadorId);

      set_projeto_atual(null);
      alert('Avaliação gravada com sucesso e trava liberada!');
      exibir_notificacao('Avaliação gravada no Supabase e trava liberada com sucesso!');
      await acionarSorteio();
    } catch (erro_excecao: any) {
      console.error('Falha no envio da avaliação:', erro_excecao);
      alert(`Erro inesperado ao enviar avaliação: ${erro_excecao?.message || erro_excecao}`);
      set_mensagem_erro('Erro ao enviar avaliação. Tente novamente.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Alias para garantir compatibilidade com salvarAvaliacao
  const salvarAvaliacao = enviar_avaliacao;

  // Handler de seleção de nota na escala Likert 1-5
  const selecionar_nota_criterio = (id_criterio: string, valor_nota: number) => {
    set_notas_criterios((prev) => ({ ...prev, [id_criterio]: valor_nota }));
  };

  // TELA INICIAL: SIMULADOR DE LOGIN DO AVALIADOR
  if (!id_usuario_logado) {
    return (
      <TelaLogin
        abaInicial="avaliador"
        aoAutenticarSucesso={() => {
          const storedId = localStorage.getItem('sessao_id_usuario') || localStorage.getItem('avaliador_id_usuario') || localStorage.getItem('usuario_id');
          const storedEmail = localStorage.getItem('sessao_email') || localStorage.getItem('avaliador_email') || localStorage.getItem('usuario_email') || '';
          if (storedId) {
            set_id_usuario_logado(storedId);
            set_email_avaliador_salvo(storedEmail);
          }
        }}
      />
    );
  }

  // TELA PRINCIPAL DE AVALIAÇÃO: Apenas exibida com id_usuario_logado confirmado
  return (
    <main className="max-w-md mx-auto px-4 py-4 space-y-5 pb-24 font-sans select-none">
      {/* Barra Informativa do Avaliador Logado com Botão Sair */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-2.5 border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center text-xs shrink-0">
            {(nome_avaliador_salvo || email_avaliador_salvo || 'A').charAt(0).toUpperCase()}
          </div>
          <div className="truncate">
            <p className="font-bold text-slate-800 dark:text-slate-100 truncate text-[11px]">
              {nome_avaliador_salvo || email_avaliador_salvo}
            </p>
            <p className="text-[10px] text-slate-400 truncate">
              {email_avaliador_salvo}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout_avaliador}
          title="Encerrar sessão e limpar dados locais"
          className="flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700 transition-colors ml-2 shrink-0 py-1 px-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sair</span>
        </button>
      </div>

      {/* Notificação Flutuante */}
      {mensagem_notificacao && (
        <div className="fixed top-4 left-4 right-4 z-50 bg-emerald-600 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold text-center justify-center animate-bounce">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Alerta Visual de Rede Offline */}
      {is_dispositivo_offline && (
        <div className="bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 p-3 rounded-xl flex items-center gap-2.5 text-amber-800 dark:text-amber-200 text-xs font-semibold">
          <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Rede Indisponível. As notas serão armazenadas no localStorage.</span>
        </div>
      )}

      {/* Alerta Visual de Erro */}
      {mensagem_erro && (
        <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 p-3.5 rounded-xl flex items-center gap-2.5 text-red-800 dark:text-red-200 text-xs font-semibold">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{mensagem_erro}</span>
        </div>
      )}

      {/* Indicador de carregamento e sorteio automático */}
      {(verificando_lock || carregando_sorteio) && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 border border-slate-200 dark:border-slate-700 shadow-sm text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {verificando_lock ? 'Identificando avaliações pendentes...' : 'Sorteando próximo projeto para avaliação...'}
          </p>
        </div>
      )}

      {/* ESTADO 1: FILA VAZIA OU COTA ATINGIDA */}
      {!verificando_lock && !carregando_sorteio && mensagem_fila_vazia && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 border border-slate-200 dark:border-slate-700 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800">
            <Inbox className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
            {mensagem_fila_vazia}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
            Todos os projetos disponíveis já foram avaliados ou não há novas atribuições pendentes no momento.
          </p>
          <button
            type="button"
            onClick={() => acionarSorteio()}
            disabled={isProcessing || carregando_sorteio}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {carregando_sorteio || isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Consultar Novamente
          </button>
        </div>
      )}

      {/* ESTADO 2: PROJETO DISPONÍVEL */}
      {!verificando_lock && !mensagem_fila_vazia && projeto_atual && (
        <>
          {/* Card Superior de Localização */}
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-2xl p-4 shadow-lg border border-emerald-500/40">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-white/20 rounded-xl">
                  <MapPin className="w-6 h-6 text-white" />
                </span>
                <div>
                  <span className="text-[10px] uppercase font-extrabold tracking-wider text-emerald-200 block">
                    Localização no Pavilhão
                  </span>
                  <h2 className="text-lg sm:text-xl font-black text-white leading-tight">
                    Dirija-se ao Corredor: {projeto_atual.corredor} Estande: {projeto_atual.estande}
                  </h2>
                </div>
              </div>

              {/* BLINDAGEM DO BOTÃO DE SORTEIO: Oculto/Desabilitado quando projeto_atual existe */}
              <div
                title="Projeto com trava ativa em avaliação"
                className="px-2.5 py-1.5 bg-white/20 rounded-xl text-white text-[11px] font-bold flex items-center gap-1.5 shrink-0"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Em Andamento</span>
              </div>
            </div>
          </div>

          {/* Cartão de Detalhes do Projeto */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 shadow-xs space-y-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                NOME DO PROJETO
              </span>
              <h1 className="text-base font-extrabold text-slate-900 dark:text-white leading-snug mt-0.5">
                {projeto_atual.titulo_projeto || projeto_atual.titulo}
              </h1>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1 border-t border-slate-100 dark:border-slate-700">
              <p className="flex items-center gap-1.5 font-medium">
                <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{projeto_atual.nome_instituicao || 'Sem Instituição'}</span>
              </p>
              <p className="flex items-center gap-1.5">
                <GraduationCap className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Expositores: <strong>{projeto_atual.expositores || (Array.isArray(projeto_atual.estudantes_nomes) ? projeto_atual.estudantes_nomes.join(', ') : projeto_atual.estudantes_nomes) || 'Equipe'}</strong></span>
              </p>
            </div>
          </div>

          {/* Seleção de Presença */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 shadow-xs space-y-3">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider block">
              Confirmação de Presença no Estande:
            </span>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => marcar_presenca('presente')}
                className={`py-3 px-4 rounded-xl text-xs sm:text-sm font-extrabold border transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                  status_presenca === 'presente'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-500/30'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                Presente
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={registrar_ausencia}
                className={`py-3 px-4 rounded-xl text-xs sm:text-sm font-extrabold border transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                  status_presenca === 'ausente'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-amber-500/30'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-500'
                }`}
              >
                {isProcessing && status_presenca === 'ausente' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                Ausente
              </button>
            </div>
          </div>

          {/* Estado de espera antes de marcar presença */}
          {status_presenca === null && (
            <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-center space-y-1.5">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Aguardando confirmação de presença no estande
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                Clique em <strong>Presente</strong> para liberar as perguntas do questionário de avaliação ou em <strong>Ausente</strong> para registrar impedimento e passar para o próximo.
              </p>
            </div>
          )}

          {/* Formulário de Avaliação e Questionário: APENAS exiba após marcar "Presente" */}
          {status_presenca === 'presente' && (
            <>
              {carregando_perguntas ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border border-slate-200 dark:border-slate-700 shadow-xs text-center space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Carregando perguntas do questionário...
                  </p>
                </div>
              ) : !id_questionario_selecionado ? (
                /* 1. SELEÇÃO DE QUESTIONÁRIO: Se NÃO existir fixado, listar em botões para o avaliador escolher. Só exiba as perguntas após a escolha. */
                carregando_lista_questionarios ? (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
                    <div className="py-8 text-center space-y-2">
                      <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mx-auto" />
                      <p className="text-xs text-slate-500">Buscando questionários cadastrados...</p>
                    </div>
                  </div>
                ) : questionarios_disponiveis.length === 0 ? (
                  <div className="p-4 mb-4 text-orange-800 bg-orange-100 border border-orange-300 rounded">
                    <p className="font-bold">Atenção: Nenhum questionário cadastrado.</p>
                    <p className="text-sm">A coordenação ainda não vinculou os critérios de avaliação a este evento. Aguarde ou entre em contato com a equipe de Staff.</p>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
                    <div>
                      <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        SELEÇÃO DE QUESTIONÁRIO
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {questionarios_disponiveis.map((quest) => (
                        <button
                          key={quest.id_questionario}
                          type="button"
                          onClick={() => selecionar_questionario(quest.id_questionario)}
                          className="w-full text-left p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-all flex items-center justify-between group"
                        >
                          <div className="pr-3">
                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                              {quest.titulo}
                            </h4>
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                              Escala Likert: {quest.escala_minima || 1} a {quest.escala_maxima || 5}
                            </span>
                          </div>
                          <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 shrink-0">
                            Selecionar →
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              ) : (
                /* Perguntas exibidas apenas após a escolha */
                <div className="space-y-4">
                  {/* Cabeçalho do Questionário Ativo */}
                  <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between gap-3">
                    <div className="truncate">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">
                        {projeto_atual.id_questionario_fixado ? 'Questionário Oficial Vinculado' : 'Questionário Escolhido'}
                      </span>
                      <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white truncate">
                        {questionarios_disponiveis.find((q) => q.id_questionario === id_questionario_selecionado)?.titulo ||
                          'Questionário de Avaliação'}
                      </h3>
                    </div>

                    {/* Botão Trocar Questionário (visível apenas se não houver questionário fixado no banco) */}
                    {!projeto_atual.id_questionario_fixado && (
                      <button
                        type="button"
                        onClick={trocar_questionario}
                        disabled={isProcessing}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-colors shrink-0 flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Trocar Questionário</span>
                      </button>
                    )}
                  </div>

                  {lista_criterios.map((criterio) => {
                    const nota_atual = notas_criterios[criterio.id_criterio] || 0;

                    return (
                      <div
                        key={criterio.id_criterio}
                        className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-3"
                      >
                        <div>
                          <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">
                            {criterio.titulo_criterio}
                          </h4>
                          {criterio.descricao_lembrete && (
                            <p className="mb-4 text-sm text-gray-500">{criterio.descricao_lembrete}</p>
                          )}
                        </div>

                        {/* Escala Likert Gerada Dinamicamente */}
                        {(() => {
                          const questionarioSelecionado = questionarios_disponiveis.find((q) => q.id_questionario === id_questionario_selecionado);
                          const max = questionarioSelecionado?.escala_maxima || 5;
                          const min = questionarioSelecionado?.escala_minima || 1;
                          const posicoesEscala = Array.from({ length: (max - min) + 1 }, (_, i) => i + min);

                          const escala_minima = min;
                          const escala_maxima = max;
                          const rotulo_minimo = LABELS_LIKERT[min];
                          const rotulo_maximo = LABELS_LIKERT[max];

                          return (
                            <>
                              <div
                                className="grid gap-1.5 pt-1"
                                style={{
                                  gridTemplateColumns: `repeat(${posicoesEscala.length}, minmax(0, 1fr))`,
                                }}
                              >
                                {posicoesEscala.map((valor_escala) => {
                                  const is_selecionado = nota_atual === valor_escala;

                                  return (
                                    <button
                                      key={valor_escala}
                                      type="button"
                                      onClick={() => selecionar_nota_criterio(criterio.id_criterio, valor_escala)}
                                      className={`py-2.5 px-1 rounded-xl text-center transition-all flex items-center justify-center border ${
                                        is_selecionado
                                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-400/50 scale-[1.02]'
                                          : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500'
                                      }`}
                                    >
                                      <span className="text-base font-black leading-tight">{valor_escala}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="flex justify-between w-full mt-2 text-xs font-medium text-gray-500">
                                <span>{escala_minima} = {rotulo_minimo || 'Péssimo'}</span>
                                <span>Regular / Neutro</span>
                                <span>{escala_maxima} = {rotulo_maximo || 'Excelente'}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    );
                  })}

                  {/* Parecer do Avaliador */}
                  <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-2">
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase">
                      Parecer Final (Opcional):
                    </label>
                    <textarea
                      rows={2}
                      value={parecer_avaliador}
                      onChange={(e) => set_parecer_avaliador(e.target.value)}
                      placeholder="Considerações ou comentários..."
                      className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Botões de Ação Empilhados protegidos contra concorrência e duplo clique */}
                  <div className="pt-2 space-y-2.5">
                    <button
                      type="button"
                      onClick={enviar_avaliacao}
                      disabled={isProcessing}
                      className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-base transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Gravando e sorteando...
                        </>
                      ) : (
                        <>
                          <Save className="w-5 h-5" />
                          Salvar Nota e Puxar Próximo
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => set_mostrar_modal_conflito(true)}
                      disabled={isProcessing}
                      className="w-full py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs transition-all border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Devolver (Conflito de Interesse)
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Modal de Conflito de Interesse */}
      {mostrar_modal_conflito && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-sm w-full border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              Confirmar Conflito de Interesse?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Este projeto será devolvido à fila de trabalhos e um novo projeto será sorteado para sua avaliação.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => set_mostrar_modal_conflito(false)}
                className="w-1/2 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={registrar_conflito}
                className="w-1/2 py-2.5 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Sim, Devolver</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
