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
  Clock,
  Calendar,
} from 'lucide-react';
import type { Projeto } from '@/types/database';
import { Botao, CampoArea, Dica, Modal, useAvisos } from '@/components/ui';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { TelaLogin } from '@/features/auth';

export type StatusJanelaAvaliacao =
  | 'liberado'
  | 'antes_do_inicio'
  | 'apos_o_fim'
  | 'horario_nao_configurado'
  | 'sistema_bloqueado';

export interface InfoJanelaEvento {
  id_evento?: string;
  nome_evento?: string;
  data_evento?: string | null;
  horario_inicio?: string | null;
  horario_fim?: string | null;
  sistema_liberado?: boolean | null;
}

export interface ResultadoValidacaoJanela {
  status: StatusJanelaAvaliacao;
  mensagem: string;
  dataEventoFormatada?: string;
  horarioInicioFormatado?: string;
  horarioFimFormatado?: string;
  dataInicioReal?: Date;
  dataFimReal?: Date;
}

export const formatarDataBr = (dataYmd?: string | null): string => {
  if (!dataYmd) return '';
  const apenasData = dataYmd.split('T')[0];
  const partes = apenasData.split('-');
  if (partes.length === 3) {
    const [ano, mes, dia] = partes;
    return `${dia.padStart(2, '0')}/${mes.padStart(2, '0')}/${ano}`;
  }
  return dataYmd;
};

export const formatarHorarioBr = (horario?: string | null): string => {
  if (!horario) return '';
  const partes = horario.split(':');
  if (partes.length >= 2) {
    return `${partes[0].padStart(2, '0')}:${partes[1].padStart(2, '0')}`;
  }
  return horario;
};

export const validarJanelaAvaliacao = (
  info?: InfoJanelaEvento | null,
  dataHoraReferencia: Date = new Date()
): ResultadoValidacaoJanela => {
  if (!info || !info.data_evento || !info.horario_inicio || !info.horario_fim) {
    return {
      status: 'horario_nao_configurado',
      mensagem: 'Os horários de início e término das avaliações ainda estão sendo configurados pela coordenação.',
      dataEventoFormatada: formatarDataBr(info?.data_evento),
      horarioInicioFormatado: formatarHorarioBr(info?.horario_inicio),
      horarioFimFormatado: formatarHorarioBr(info?.horario_fim),
    };
  }

  if (info.sistema_liberado === false) {
    return {
      status: 'sistema_bloqueado',
      mensagem: 'O sistema de avaliação está temporariamente pausado pela coordenação do evento.',
      dataEventoFormatada: formatarDataBr(info.data_evento),
      horarioInicioFormatado: formatarHorarioBr(info.horario_inicio),
      horarioFimFormatado: formatarHorarioBr(info.horario_fim),
    };
  }

  const apenasData = info.data_evento.split('T')[0];
  const partesData = apenasData.split('-');
  const partesHoraIni = info.horario_inicio.split(':');
  const partesHoraFim = info.horario_fim.split(':');

  if (partesData.length !== 3 || partesHoraIni.length < 2 || partesHoraFim.length < 2) {
    return {
      status: 'horario_nao_configurado',
      mensagem: 'Formato de data ou horário do evento inválido no sistema.',
    };
  }

  const ano = parseInt(partesData[0], 10);
  const mes = parseInt(partesData[1], 10) - 1;
  const dia = parseInt(partesData[2], 10);

  const horaIni = parseInt(partesHoraIni[0], 10);
  const minIni = parseInt(partesHoraIni[1], 10);

  const horaFim = parseInt(partesHoraFim[0], 10);
  const minFim = parseInt(partesHoraFim[1], 10);

  if (isNaN(ano) || isNaN(mes) || isNaN(dia) || isNaN(horaIni) || isNaN(minIni) || isNaN(horaFim) || isNaN(minFim)) {
    return {
      status: 'horario_nao_configurado',
      mensagem: 'Formato de data ou horário do evento inválido no sistema.',
    };
  }

  const dataInicioReal = new Date(ano, mes, dia, horaIni, minIni, 0, 0);
  const dataFimReal = new Date(ano, mes, dia, horaFim, minFim, 0, 0);
  const agoraMs = dataHoraReferencia.getTime();

  const dataFormatada = `${String(dia).padStart(2, '0')}/${String(mes + 1).padStart(2, '0')}/${ano}`;
  const horaIniFormatada = `${String(horaIni).padStart(2, '0')}:${String(minIni).padStart(2, '0')}`;
  const horaFimFormatada = `${String(horaFim).padStart(2, '0')}:${String(minFim).padStart(2, '0')}`;

  if (agoraMs < dataInicioReal.getTime()) {
    return {
      status: 'antes_do_inicio',
      mensagem: `As avaliações ainda não começaram. Início previsto: ${dataFormatada} às ${horaIniFormatada}.`,
      dataEventoFormatada: dataFormatada,
      horarioInicioFormatado: horaIniFormatada,
      horarioFimFormatado: horaFimFormatada,
      dataInicioReal,
      dataFimReal,
    };
  }

  if (agoraMs > dataFimReal.getTime()) {
    return {
      status: 'apos_o_fim',
      mensagem: `As avaliações deste evento foram encerradas em ${dataFormatada} às ${horaFimFormatada}.`,
      dataEventoFormatada: dataFormatada,
      horarioInicioFormatado: horaIniFormatada,
      horarioFimFormatado: horaFimFormatada,
      dataInicioReal,
      dataFimReal,
    };
  }

  return {
    status: 'liberado',
    mensagem: 'Janela de avaliação liberada.',
    dataEventoFormatada: dataFormatada,
    horarioInicioFormatado: horaIniFormatada,
    horarioFimFormatado: horaFimFormatada,
    dataInicioReal,
    dataFimReal,
  };
};

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

// Contingência vazia para projetos do avaliador
const projetos_mock_fallback: Projeto[] = [];

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

  const { avisar, confirmar } = useAvisos();

  // PROTEÇÃO DE CONCORRÊNCIA: Previne múltiplos cliques simultâneos
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Projeto atualmente sorteado para o avaliador
  const [projeto_atual, set_projeto_atual] = useState<Projeto | null>(null);

  // Estados do formulário de avaliação - null por padrão para exigir confirmação de presença
  const [status_presenca, set_status_presenca] = useState<'presente' | 'ausente' | null>(null);
  const [horario_inicio_avaliacao, set_horario_inicio_avaliacao] = useState<string | null>(null);
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

  // 1.1 ESTADOS DE JANELA DE HORÁRIOS DO EVENTO (Configurações Admin)
  const [status_janela, set_status_janela] = useState<StatusJanelaAvaliacao | null>(null);
  const [info_evento_ativo, set_info_evento_ativo] = useState<InfoJanelaEvento | null>(null);

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
      // Só os questionários do evento: os de eventos anteriores seriam recusados no envio
      const id_evt = await obter_id_evento_ativo();
      const { data: dados, error } = await supabase
        .from('questionarios')
        .select('id_questionario, titulo, escala_minima, escala_maxima')
        .eq('id_evento', id_evt)
        .order('titulo', { ascending: true });
      if (error) throw error;

      const formatados: QuestionarioItem[] = (dados || []).map((q: any) => ({
        id_questionario: q.id_questionario,
        titulo: q.titulo || 'Questionário IFMS',
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
        await avisar({ tipo: 'erro', titulo: 'Não foi possível carregar as perguntas', mensagem: pergsErr.message });
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

  /**
   * Sair apaga a sessão anônima deste aparelho, que é a credencial do vínculo: o
   * `auth_uid` muda na próxima abertura e o código de acesso antigo é de uso único.
   * Ou seja, sair custa uma volta ao Staff — por isso pergunta antes, com o caminho
   * seguro como padrão. As chamadas automáticas de `logout_avaliador` (quando a chave
   * do navegador desaparece) seguem diretas, porque não são ação da pessoa.
   */
  const confirmar_e_sair = async () => {
    const confirmado = await confirmar({
      titulo: 'Sair e desvincular este celular?',
      mensagem:
        'Ao sair, este celular deixa de ficar vinculado a você. Para avaliar de novo, será preciso pedir um novo código ao Staff.',
      rotuloConfirmar: 'Sair e desvincular',
      rotuloCancelar: 'Continuar avaliando',
    });
    if (confirmado) await logout_avaliador();
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

  // Busca os dados da janela de horário do evento ativo na tabela 'eventos'
  const carregar_dados_janela_evento = async (idEvtParam?: string): Promise<InfoJanelaEvento | null> => {
    let id_evt = idEvtParam || prop_id_evento_ativo || id_evento;
    if (isUUID(id_evt)) {
      const { data } = await supabase
        .from('eventos')
        .select('id_evento, nome_evento, data_evento, horario_inicio, horario_fim, sistema_liberado')
        .eq('id_evento', id_evt)
        .maybeSingle();
      if (data) return data;
    }

    const { data: evtAtivo } = await supabase
      .from('eventos')
      .select('id_evento, nome_evento, data_evento, horario_inicio, horario_fim, sistema_liberado')
      .eq('is_ativo', true)
      .maybeSingle();

    if (evtAtivo) return evtAtivo;

    const { data: anyEvt } = await supabase
      .from('eventos')
      .select('id_evento, nome_evento, data_evento, horario_inicio, horario_fim, sistema_liberado')
      .limit(1)
      .maybeSingle();

    return anyEvt || null;
  };

  // Verificação manual e reativa do horário disparada pelo avaliador
  const verificar_horario_evento = async () => {
    set_carregando_sorteio(true);
    try {
      const id_evt = await obter_id_evento_ativo();
      const infoEvento = await carregar_dados_janela_evento(id_evt);
      set_info_evento_ativo(infoEvento);
      const validacao = validarJanelaAvaliacao(infoEvento);
      set_status_janela(validacao.status);

      if (validacao.status === 'liberado') {
        exibir_notificacao('Horário liberado! Iniciando sorteio de projetos...');
        await acionarSorteio(id_evt);
      } else if (validacao.status === 'antes_do_inicio') {
        exibir_notificacao(`Avaliações iniciam às ${validacao.horarioInicioFormatado || 'breve'}. Seu login está OK!`);
      } else if (validacao.status === 'apos_o_fim') {
        exibir_notificacao('Período de avaliações encerrado para este evento.');
      } else if (validacao.status === 'sistema_bloqueado') {
        exibir_notificacao('O sistema continua temporariamente pausado pela coordenação.');
      } else {
        exibir_notificacao('Horários em configuração pela coordenação. Login OK!');
      }
    } catch (e: any) {
      console.error('Erro ao verificar horário do evento:', e);
      set_mensagem_erro('Falha ao verificar os horários do evento. Tente novamente.');
    } finally {
      set_carregando_sorteio(false);
    }
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
        set_projeto_atual(null);
        set_mensagem_erro('Banco de dados não configurado ou desconectado.');
        set_carregando_sorteio(false);
      }, 500);
      return;
    }

    try {
      let id_evento_ativo = id_evento_param;
      if (!id_evento_ativo) {
        id_evento_ativo = await obter_id_evento_ativo();
      }

      // Validação estrita da janela temporal de avaliação do evento
      const infoEvento = await carregar_dados_janela_evento(id_evento_ativo);
      const validacao = validarJanelaAvaliacao(infoEvento);
      set_info_evento_ativo(infoEvento);
      set_status_janela(validacao.status);

      if (validacao.status !== 'liberado') {
        set_projeto_atual(null);
        set_carregando_sorteio(false);
        return;
      }

      // Projeto atribuído pela coordenação (atribuição forçada): retoma em vez de sortear outro.
      // Quem precisa descartar a trava (envio, ausência, conflito) já a apagou antes de chamar o sorteio.
      try {
        const { data: travaAtribuida } = await supabase
          .from('locks_ativos')
          .select('id_projeto, atribuido_por')
          .eq('id_usuario', avaliadorId)
          .gt('expira_em', new Date().toISOString())
          .not('atribuido_por', 'is', null)
          .maybeSingle();

        if (travaAtribuida?.id_projeto) {
          const { data: projAtribuido } = await supabase
            .from('projetos')
            .select('*, modalidades(nome_modalidade), instituicoes(nome_exibicao)')
            .eq('id_projeto', travaAtribuida.id_projeto)
            .maybeSingle();
          if (projAtribuido) {
            setProjetoAtual(projAtribuido);
            exibir_notificacao('Projeto atribuído pela coordenação carregado para avaliação.');
            return;
          }
        }
      } catch (_errAtribuida) {
        // Falha momentânea: segue para a fila e o sorteio normais
      }

      // 1. Fila direcionada pelo Admin: o banco descarta a trava anterior, valida elegibilidade e cota
      //    de cada item pendente e grava a trava do primeiro que puder ser avaliado
      let idProjetoAtribuido: string | null = null;
      const { data: idDaFila, error: erroFila } = await supabase.rpc('fn_assumir_item_fila');
      if (erroFila) console.error('Erro ao consultar a fila direcionada:', erroFila.message);
      else if (idDaFila) idProjetoAtribuido = idDaFila as string;

      let idSorteado: any = idProjetoAtribuido;

      if (!idSorteado) {
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
          await avisar({ tipo: 'erro', titulo: 'Não foi possível sortear', mensagem: errSorteio.message });
          set_mensagem_erro(`Erro RPC: ${errSorteio.message}`);
          return;
        }

        // Extração defensiva do UUID (trata tanto escalar quanto objeto)
        idSorteado = typeof ret === 'object' && ret !== null ? Object.values(ret)[0] : ret;
      }

      if (!idSorteado) {
        // Verifica se todos os projetos ativos já atingiram a cota padrão do evento
        let feiraFinalizada = false;
        try {
          if (id_evento_ativo) {
            // Calculado no banco: considera cota customizada e projetos fora da competição
            const { data: concluida } = await supabase.rpc('fn_feira_concluida', { p_id_evento: id_evento_ativo });
            feiraFinalizada = concluida === true;
          }
        } catch (_errFeira) {
          // Fallback silencioso
        }

        if (feiraFinalizada) {
          setMensagemFila("Avaliações da Feira Concluídas! Todos os projetos atingiram a cota necessária.");
        } else {
          setMensagemFila("Todos os projetos disponíveis já foram avaliados ou bloqueados por conflito institucional/modalidade.");
        }
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
        await avisar({
          tipo: 'erro',
          titulo: 'Projeto sorteado sem detalhes',
          mensagem: `O projeto ${idSorteado} foi sorteado, mas os dados dele não foram encontrados. Procure o Staff.`,
        });
        setProjetoAtual(null);
        return;
      }

      setProjetoAtual(proj);
      exibir_notificacao('Novo projeto sorteado e carregado para avaliação!');
    } catch (err: any) {
      console.error("Falha ao sortear próximo projeto:", err);
      await avisar({ tipo: 'erro', titulo: 'Falha ao sortear o próximo projeto', mensagem: String(err?.message || err) });
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
            await avisar({
              tipo: 'atencao',
              titulo: 'Nenhum evento ativo',
              mensagem: 'Não há evento ativo para vincular a avaliação. Procure o Staff.',
            });
            set_verificando_lock(false);
            return;
          }
          id_evento_ativo = evt.id_evento;
        }

        const infoEvento = await carregar_dados_janela_evento(id_evento_ativo);
        const validacao = validarJanelaAvaliacao(infoEvento);
        set_info_evento_ativo(infoEvento);
        set_status_janela(validacao.status);

        const { data: lockAtivo, error: errLock } = await supabase
          .from('locks_ativos')
          .select('id_projeto')
          .eq('id_usuario', avaliadorId)
          .maybeSingle();

        if (errLock) {
          console.error('Erro ao consultar lock ativo na inicialização:', errLock.message);
        }

        if (lockAtivo?.id_projeto) {
          const [resProj, resBloq, resAvalJaFeita] = await Promise.all([
            supabase
              .from('projetos')
              .select('*, modalidades(nome_modalidade), instituicoes(nome_exibicao)')
              .eq('id_projeto', lockAtivo.id_projeto)
              .maybeSingle(),
            supabase
              .from('avaliador_modalidades_bloqueadas')
              .select('id_modalidade')
              .eq('id_usuario', avaliadorId),
            supabase
              .from('avaliacoes')
              .select('id_avaliacao')
              .eq('id_projeto', lockAtivo.id_projeto)
              .eq('id_usuario', avaliadorId)
              .maybeSingle(),
          ]);

          const proj = resProj.data;
          const modsBloqueadas = new Set((resBloq.data || []).map((b: any) => b.id_modalidade));
          const isModBloqueada = proj?.id_modalidade && modsBloqueadas.has(proj.id_modalidade);
          const jaPossuiAvaliacao = !!resAvalJaFeita?.data?.id_avaliacao;

          if (proj && !isModBloqueada && !jaPossuiAvaliacao) {
            setProjetoAtual(proj);
            setMensagemFila(null);
            exibir_notificacao('Avaliação em andamento retomada do banco de dados.');
          } else {
            if (isModBloqueada) {
              console.warn('Trava ativa anterior pertencia a modalidade bloqueada. Removendo trava e sorteando...');
            } else if (jaPossuiAvaliacao) {
              console.warn('Trava ativa para projeto que já possui registro de avaliação (ou cancelada). Removendo trava e sorteando...');
            } else {
              console.warn('Lock ativo para projeto não encontrado. Removendo trava e sorteando...');
            }
            await supabase.from('locks_ativos').delete().eq('id_usuario', avaliadorId);
            if (validacao.status === 'liberado') {
              await acionarSorteio(id_evento_ativo);
            } else {
              set_projeto_atual(null);
            }
          }
        } else {
          if (validacao.status === 'liberado') {
            await acionarSorteio(id_evento_ativo);
          } else {
            set_projeto_atual(null);
          }
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
      // O banco grava o impedimento só no projeto em que o avaliador está (com trava) e libera a trava
      const { error: erro_impedimento } = await supabase.rpc('fn_registrar_impedimento', {
        p_id_projeto: id_projeto,
        p_tipo: 'conflito',
      });

      if (erro_impedimento) {
        console.error('Erro ao registrar conflito em historico_impedimentos:', erro_impedimento.message);
        await avisar({ tipo: 'atencao', titulo: 'Conflito registrado com aviso', mensagem: erro_impedimento.message });
      }

      set_projeto_atual(null);
      exibir_notificacao('Conflito registrado. Trava liberada e buscando próximo projeto...');
      await acionarSorteio();
    } catch (erro_excecao: any) {
      console.error('Falha ao registrar conflito:', erro_excecao);
      await avisar({
        tipo: 'erro',
        titulo: 'Falha ao registrar o conflito',
        mensagem: String(erro_excecao?.message || erro_excecao),
      });
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
      // O banco grava o impedimento só no projeto em que o avaliador está (com trava) e libera a trava
      const { error: erro_impedimento } = await supabase.rpc('fn_registrar_impedimento', {
        p_id_projeto: id_projeto,
        p_tipo: 'ausencia',
      });

      if (erro_impedimento) {
        console.error('Erro ao registrar ausência em historico_impedimentos:', erro_impedimento.message);
        await avisar({ tipo: 'atencao', titulo: 'Ausência registrada com aviso', mensagem: erro_impedimento.message });
      }

      set_projeto_atual(null);
      exibir_notificacao('Ausência registrada. Liberando trava e buscando próximo projeto...');

      await acionarSorteio();
    } catch (erro_excecao: any) {
      console.error('Falha ao registrar ausência no Supabase:', erro_excecao);
      await avisar({
        tipo: 'erro',
        titulo: 'Falha ao registrar a ausência',
        mensagem: String(erro_excecao?.message || erro_excecao),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 1. FLUXO DE SELEÇÃO E FIXAÇÃO DE QUESTIONÁRIO:
  const marcar_presenca = async (status: 'presente' | 'ausente') => {
    if (status === 'presente') {
      set_status_presenca('presente');
      set_horario_inicio_avaliacao(new Date().toISOString());

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

    const timestampSubmissao = new Date().toISOString();
    const timestampInicio = horario_inicio_avaliacao || timestampSubmissao;

    // Sem internet a nota não é guardada no navegador: antes ia para uma fila que nenhum código enviava depois
    // (a avaliação se perdia e o avaliador achava que tinha sido registrada). As notas ficam na tela para reenviar.
    if (!navigator.onLine || !conexao_banco_configurada) {
      exibir_notificacao('Sem conexão: a avaliação não foi enviada. As notas continuam na tela; envie de novo quando a internet voltar.');
      setIsProcessing(false);
      return;
    }

    try {
      const projetoAtual = projeto_atual;
      const idQuestionarioEscolhido = id_questionario_selecionado;

      // Respostas no formato esperado pelo RPC: [{ id_pergunta, nota }, ...]
      const respostasRpc = Object.entries(notas_criterios).map(([id_crit, nota_val]) => ({
        id_pergunta: id_crit,
        nota: nota_val,
      }));

      // Caminho seguro: toda a gravação (avaliação + respostas + fixar questionário
      // + liberar trava + concluir fila + quarentena) acontece no banco, com
      // validação server-side (posse de trava, conflito, cota, janela, escala).
      // A nota_final é calculada no servidor; o cliente não a envia.
      const { error: erro_rpc } = await supabase.rpc('fn_enviar_avaliacao', {
        p_id_usuario: avaliadorId,
        p_id_projeto: id_projeto_alvo,
        p_id_questionario: idQuestionarioEscolhido || projetoAtual.id_questionario_fixado || null,
        p_respostas: respostasRpc,
        p_parecer: parecer_avaliador,
        p_tempo_presenca: timestampInicio,
      });

      if (erro_rpc) {
        // Fallback resiliente: só enquanto a migration do RPC ainda não foi
        // aplicada no banco (função inexistente). Nesse caso, grava pelo caminho
        // legado para não travar a feira. Após aplicar a migration, o RPC existe
        // e o INSERT anônimo direto deixa de ser permitido pela RLS.
        const rpcAusente =
          erro_rpc.code === 'PGRST202' ||
          erro_rpc.code === '42883' ||
          /function .*fn_enviar_avaliacao.* does not exist|could not find the function/i.test(
            erro_rpc.message || ''
          );

        if (!rpcAusente) {
          console.error('Erro ao gravar avaliação (RPC):', erro_rpc.message);
          await avisar({ tipo: 'erro', titulo: 'Falha ao salvar a avaliação', mensagem: erro_rpc.message });
          set_mensagem_erro(`Falha no salvamento: ${erro_rpc.message}`);
          setIsProcessing(false);
          return;
        }

        console.warn('RPC fn_enviar_avaliacao indisponível; usando gravação legada.');
        const { data: avaliacao_gerada, error: erro_avaliacao } = await supabase
          .from('avaliacoes')
          .insert({
            id_projeto: id_projeto_alvo,
            id_usuario: avaliadorId,
            nota_final: nota_final,
            parecer_final: parecer_avaliador,
            tempo_presenca: timestampInicio,
            tempo_submissao: timestampSubmissao,
          })
          .select('id_avaliacao')
          .single();

        if (erro_avaliacao) {
          console.error('Erro ao gravar avaliação:', erro_avaliacao.message);
          await avisar({ tipo: 'erro', titulo: 'Falha ao salvar a avaliação', mensagem: erro_avaliacao.message });
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
          await avisar({ tipo: 'atencao', titulo: 'Respostas gravadas com aviso', mensagem: erro_respostas.message });
        }

        if (!projetoAtual.id_questionario_fixado && idQuestionarioEscolhido) {
          await supabase.rpc('fn_fixar_questionario', {
            p_id_projeto: projetoAtual.id_projeto || projetoAtual.id,
            p_id_questionario: idQuestionarioEscolhido,
          });
        }
        // fn_enviar_avaliacao já liberou a trava e concluiu o item da fila
        await supabase.from('locks_ativos').delete().eq('id_usuario', avaliadorId);
      }

      set_projeto_atual(null);
      set_horario_inicio_avaliacao(null);
      await avisar({
        tipo: 'sucesso',
        titulo: 'Avaliação enviada',
        mensagem: 'A nota foi gravada e a trava do projeto foi liberada.',
      });
      await acionarSorteio();
    } catch (erro_excecao: any) {
      console.error('Falha no envio da avaliação:', erro_excecao);
      await avisar({
        tipo: 'erro',
        titulo: 'Erro inesperado ao enviar a avaliação',
        mensagem: String(erro_excecao?.message || erro_excecao),
      });
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
    <main className="max-w-md mx-auto px-4 py-4 space-y-5 pb-24 font-sans">
      {/* Título único da tela: os cartões abaixo usam h2 (o cabeçalho não tem mais h1) */}
      <h1 className="sr-only">Avaliação de projetos</h1>
      {/* Barra Informativa do Avaliador Logado com Botão Sair */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-2.5 border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center text-xs shrink-0">
            {(nome_avaliador_salvo || email_avaliador_salvo || 'A').charAt(0).toUpperCase()}
          </div>
          <div className="truncate">
            <p className="font-bold text-texto truncate text-apoio">
              {nome_avaliador_salvo || email_avaliador_salvo}
            </p>
            <p className="text-legenda text-texto-secundario truncate">
              {email_avaliador_salvo}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 ml-2 shrink-0">
          <Botao
            variante="fantasma"
            onClick={confirmar_e_sair}
            icone={<LogOut aria-hidden="true" className="w-4 h-4" />}
            className="text-perigo hover:bg-superficie-alta"
          >
            Sair e desvincular
          </Botao>
          <Dica alinhar="fim" lado="baixo">
            Sair desvincula este celular; para avaliar de novo, o Staff precisa vincular outra vez.
          </Dica>
        </div>
      </div>

      {/* Notificação Flutuante */}
      {mensagem_notificacao && (
        <div className="fixed top-4 left-4 right-4 z-50 bg-emerald-600 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold text-center justify-center animate-bounce">
          <CheckCircle2 aria-hidden="true" className="w-5 h-5 shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Alerta Visual de Rede Offline */}
      {is_dispositivo_offline && (
        <div className="bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 p-3 rounded-xl flex items-center gap-2.5 text-amber-800 dark:text-amber-200 text-xs font-semibold">
          <WifiOff aria-hidden="true" className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Rede Indisponível. As notas serão armazenadas no localStorage.</span>
        </div>
      )}

      {/* Alerta Visual de Erro */}
      {mensagem_erro && (
        <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 p-3.5 rounded-xl flex items-center gap-2.5 text-red-800 dark:text-red-200 text-xs font-semibold">
          <AlertTriangle aria-hidden="true" className="w-4 h-4 text-red-600 shrink-0" />
          <span>{mensagem_erro}</span>
        </div>
      )}

      {/* Indicador de carregamento e sorteio automático */}
      {(verificando_lock || carregando_sorteio) && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 border border-slate-200 dark:border-slate-700 shadow-sm text-center space-y-3">
          <Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {verificando_lock ? 'Identificando avaliações pendentes...' : 'Sorteando próximo projeto para avaliação...'}
          </p>
        </div>
      )}

      {/* ESTADO TEMPORAL 1: ANTES DO INÍCIO DAS AVALIAÇÕES */}
      {!verificando_lock && !carregando_sorteio && !projeto_atual && status_janela === 'antes_do_inicio' && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 shadow-md text-center space-y-5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full text-xs font-bold mx-auto">
            <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Login Conectado com Sucesso</span>
          </div>

          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <Clock aria-hidden="true" className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">
              As avaliações ainda não começaram
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
              Seu acesso de avaliador está confirmado e ativo. O sorteio e o envio de avaliações serão liberados no horário programado.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/70 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 text-xs text-left space-y-2">
            <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
              <span className="font-semibold flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <Calendar aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600" />
                Data do Evento:
              </span>
              <span className="font-bold text-slate-900 dark:text-white">
                {formatarDataBr(info_evento_ativo?.data_evento) || 'A definir'}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 pt-1.5 border-t border-slate-200/60 dark:border-slate-800">
              <span className="font-semibold flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <Clock aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600" />
                Início Previsto:
              </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatarHorarioBr(info_evento_ativo?.horario_inicio) || '--:--'}
                {info_evento_ativo?.horario_fim ? ` (até ${formatarHorarioBr(info_evento_ativo.horario_fim)})` : ''}
              </span>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={verificar_horario_evento}
              disabled={isProcessing}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RotateCcw aria-hidden="true" className="w-4 h-4" />
              Atualizar / Verificar Horário
            </button>
            <Botao
              variante="fantasma"
              larguraTotal
              onClick={confirmar_e_sair}
              icone={<LogOut aria-hidden="true" className="w-4 h-4" />}
              className="text-perigo hover:bg-superficie-alta"
            >
              Sair e desvincular
            </Botao>
          </div>
        </div>
      )}

      {/* ESTADO TEMPORAL 2: APÓS O ENCERRAMENTO DAS AVALIAÇÕES */}
      {!verificando_lock && !carregando_sorteio && !projeto_atual && status_janela === 'apos_o_fim' && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 shadow-md text-center space-y-4">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 rounded-2xl flex items-center justify-center mx-auto">
            <Clock aria-hidden="true" className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">
              Avaliações Encerradas
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
              O período de avaliação deste evento terminou. Agradecemos imensamente pela sua colaboração e dedicação!
            </p>
            {info_evento_ativo?.horario_fim && (
              <p className="text-legenda font-semibold text-texto-secundario pt-1">
                Encerrado em {formatarDataBr(info_evento_ativo.data_evento)} às {formatarHorarioBr(info_evento_ativo.horario_fim)}
              </p>
            )}
          </div>

          <div className="pt-2">
            <Botao
              variante="secundario"
              larguraTotal
              onClick={confirmar_e_sair}
              icone={<LogOut aria-hidden="true" className="w-4 h-4" />}
            >
              Sair e desvincular
            </Botao>
          </div>
        </div>
      )}

      {/* ESTADO TEMPORAL 3: HORÁRIOS NÃO CONFIGURADOS PELA COORDENAÇÃO */}
      {!verificando_lock && !carregando_sorteio && !projeto_atual && status_janela === 'horario_nao_configurado' && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 shadow-md text-center space-y-5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full text-xs font-bold mx-auto">
            <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Login Conectado com Sucesso</span>
          </div>

          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle aria-hidden="true" className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">
              Horários em Configuração
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
              Seu login está confirmado e ativo, mas os horários de início e término das avaliações ainda estão sendo configurados pela coordenação do evento.
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={verificar_horario_evento}
              disabled={isProcessing}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RotateCcw aria-hidden="true" className="w-4 h-4" />
              Atualizar / Verificar Horário
            </button>
            <Botao
              variante="fantasma"
              larguraTotal
              onClick={confirmar_e_sair}
              icone={<LogOut aria-hidden="true" className="w-4 h-4" />}
              className="text-perigo hover:bg-superficie-alta"
            >
              Sair e desvincular
            </Botao>
          </div>
        </div>
      )}

      {/* ESTADO TEMPORAL 4: SISTEMA TEMPORARIAMENTE PAUSADO */}
      {!verificando_lock && !carregando_sorteio && !projeto_atual && status_janela === 'sistema_bloqueado' && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 shadow-md text-center space-y-5">
          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
            <Lock aria-hidden="true" className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">
              Avaliações Pausadas
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
              O sistema de avaliação foi temporariamente pausado pela coordenação do evento. Aguarde a reabertura para novas avaliações.
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={verificar_horario_evento}
              disabled={isProcessing}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RotateCcw aria-hidden="true" className="w-4 h-4" />
              Atualizar / Verificar Horário
            </button>
            <Botao
              variante="fantasma"
              larguraTotal
              onClick={confirmar_e_sair}
              icone={<LogOut aria-hidden="true" className="w-4 h-4" />}
              className="text-perigo hover:bg-superficie-alta"
            >
              Sair e desvincular
            </Botao>
          </div>
        </div>
      )}

      {/* ESTADO 1: FILA VAZIA OU COTA ATINGIDA (Sem o subtítulo longo) */}
      {!verificando_lock && !carregando_sorteio && !projeto_atual && (status_janela === 'liberado' || !status_janela) && mensagem_fila_vazia && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 border border-slate-200 dark:border-slate-700 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800">
            <Inbox aria-hidden="true" className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
            {mensagem_fila_vazia}
          </h2>
          <button
            type="button"
            onClick={() => acionarSorteio()}
            disabled={isProcessing}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <RotateCcw aria-hidden="true" className="w-4 h-4" />}
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
                  <MapPin aria-hidden="true" className="w-6 h-6 text-white" />
                </span>
                <div>
                  <span className="text-legenda uppercase font-extrabold tracking-wider text-emerald-100 block">
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
                className="px-2.5 py-1.5 bg-white/20 rounded-controle text-white text-legenda font-bold flex items-center gap-1.5 shrink-0"
              >
                <Lock aria-hidden="true" className="w-3.5 h-3.5" />
                <span>Em Andamento</span>
              </div>
            </div>
          </div>

          {/* Cartão de Detalhes do Projeto */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 shadow-xs space-y-3">
            <div>
              <span className="text-legenda font-bold uppercase tracking-wider text-acao-texto">
                NOME DO PROJETO
              </span>
              <h2 className="text-corpo font-extrabold text-texto leading-snug mt-0.5">
                {projeto_atual.titulo_projeto || projeto_atual.titulo}
              </h2>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1 border-t border-slate-100 dark:border-slate-700">
              <p className="flex items-center gap-1.5 font-medium">
                <Building aria-hidden="true" className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{projeto_atual.nome_instituicao || 'Sem Instituição'}</span>
              </p>
              <p className="flex items-center gap-1.5">
                <GraduationCap aria-hidden="true" className="w-3.5 h-3.5 text-slate-400 shrink-0" />
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
                className={`py-3 px-4 rounded-xl text-xs sm:text-sm font-extrabold border transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${status_presenca === 'presente'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-500/30'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500'
                  }`}
              >
                <CheckCircle2 aria-hidden="true" className="w-4 h-4" />
                Presente
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={registrar_ausencia}
                className={`py-3 px-4 rounded-xl text-xs sm:text-sm font-extrabold border transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${status_presenca === 'ausente'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-amber-500/30'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-500'
                  }`}
              >
                {isProcessing && status_presenca === 'ausente' ? (
                  <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle aria-hidden="true" className="w-4 h-4" />
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
              <p className="text-apoio text-texto-secundario max-w-xs mx-auto">
                Clique em <strong>Presente</strong> para liberar as perguntas do questionário de avaliação ou em <strong>Ausente</strong> para registrar impedimento e passar para o próximo.
              </p>
            </div>
          )}

          {/* Formulário de Avaliação e Questionário: APENAS exiba após marcar "Presente" */}
          {status_presenca === 'presente' && (
            <>
              {carregando_perguntas ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border border-slate-200 dark:border-slate-700 shadow-xs text-center space-y-3">
                  <Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Carregando perguntas do questionário...
                  </p>
                </div>
              ) : !id_questionario_selecionado ? (
                /* 1. SELEÇÃO DE QUESTIONÁRIO: Se NÃO existir fixado, listar em botões para o avaliador escolher. Só exiba as perguntas após a escolha. */
                carregando_lista_questionarios ? (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
                    <div className="py-8 text-center space-y-2">
                      <Loader2 aria-hidden="true" className="w-6 h-6 animate-spin text-emerald-600 mx-auto" />
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
                            <h3 className="text-apoio font-bold text-texto group-hover:text-acao-texto">
                              {quest.titulo}
                            </h3>
                            <span className="text-legenda text-texto-secundario">
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
                      <span className="text-legenda font-bold uppercase tracking-wider text-acao-texto block">
                        {projeto_atual.id_questionario_fixado ? 'Questionário Oficial Vinculado' : 'Questionário Escolhido'}
                      </span>
                      <h3 className="text-apoio font-extrabold text-texto truncate">
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
                        className="px-3 min-h-11 rounded-controle text-apoio font-bold bg-superficie-alta hover:bg-superficie text-texto border border-borda-controle transition-colors shrink-0 flex items-center gap-1.5"
                      >
                        <RotateCcw aria-hidden="true" className="w-3.5 h-3.5" />
                        <span>Trocar Questionário</span>
                      </button>
                    )}
                  </div>

                  {lista_criterios.map((criterio) => {
                    const nota_atual = notas_criterios[criterio.id_criterio] || 0;

                    return (
                      <fieldset
                        key={criterio.id_criterio}
                        className="bg-superficie p-4 rounded-cartao border border-borda shadow-cartao space-y-3"
                      >
                        <legend className="text-apoio font-extrabold text-texto">
                          {criterio.titulo_criterio}
                        </legend>
                        {criterio.descricao_lembrete && (
                          <p className="mb-4 text-apoio text-texto-secundario">{criterio.descricao_lembrete}</p>
                        )}

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
                                    <label key={valor_escala} className="block">
                                      <input
                                        type="radio"
                                        name={`nota-${criterio.id_criterio}`}
                                        value={valor_escala}
                                        checked={is_selecionado}
                                        onChange={() => selecionar_nota_criterio(criterio.id_criterio, valor_escala)}
                                        aria-label={`Nota ${valor_escala} de ${escala_maxima}`}
                                        className="peer sr-only"
                                      />
                                      <span
                                        className={`flex items-center justify-center min-h-11 rounded-controle border text-corpo font-black cursor-pointer transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-acao ${
                                          is_selecionado
                                            ? 'bg-acao text-white border-acao shadow-cartao'
                                            : 'bg-superficie-alta text-texto border-borda-controle hover:border-acao'
                                        }`}
                                      >
                                        {valor_escala}
                                      </span>
                                    </label>
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
                      </fieldset>
                    );
                  })}

                  {/* Parecer do Avaliador */}
                  <div className="bg-superficie p-4 rounded-cartao border border-borda shadow-cartao">
                    <CampoArea
                      rotulo="Parecer final (opcional)"
                      rows={3}
                      value={parecer_avaliador}
                      onChange={(e) => set_parecer_avaliador(e.target.value)}
                      placeholder="Considerações ou comentários..."
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
                          <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" />
                          Gravando e sorteando...
                        </>
                      ) : (
                        <>
                          <Save aria-hidden="true" className="w-5 h-5" />
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
                      <AlertTriangle aria-hidden="true" className="w-4 h-4 text-amber-500" />
                      Devolver (Conflito de Interesse)
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Conflito de interesse: decisão que devolve o projeto à fila, então é alertdialog */}
      <Modal
        aberto={mostrar_modal_conflito}
        aoFechar={() => set_mostrar_modal_conflito(false)}
        titulo="Confirmar conflito de interesse?"
        descricao="Este projeto será devolvido à fila de trabalhos e um novo projeto será sorteado para sua avaliação."
        papel="alertdialog"
        tamanho="pequeno"
        acoes={
          <>
            <Botao data-foco-inicial disabled={isProcessing} onClick={() => set_mostrar_modal_conflito(false)}>
              Cancelar
            </Botao>
            <Botao variante="perigo" carregando={isProcessing} onClick={registrar_conflito}>
              Sim, devolver à fila
            </Botao>
          </>
        }
      >
        <AlertTriangle aria-hidden="true" className="w-8 h-8 text-aviso mx-auto" />
      </Modal>
    </main>
  );
};
