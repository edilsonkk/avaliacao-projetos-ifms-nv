import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  UploadCloud,
  UserPlus,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Mail,
  User,
  Pencil,
  UserCheck,
  UserX,
  X,
  Clock,
  Terminal,
  Shield,
  ShieldOff,
  Building2,
  Database,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Save,
  Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';
import { parsePlanilhaAvaliadores, normalizarChave } from '../lib/parsers/planilhaAvaliadoresParser';
import { ModalDeParaMapping, ItemMapeamentoDePara, DecisaoMapeamento } from './ModalDeParaMapping';
import { buscarMelhorCorrespondencia, CandidatoMatch } from '@/lib/parsers/fuzzyMatcher';

export interface UsuarioAvaliador {
  id_usuario: string;
  nome: string;
  email: string;
  papel: string;
  is_credenciado?: boolean;
  id_instituicao?: string | null;
  nome_instituicao?: string | null;
  modalidades_bloqueadas?: string[];
  nomes_modalidades_bloqueadas?: string[];
  areas?: string[];
  nomes_areas?: string[];
  avaliadores_evento?: { id_evento: string; is_credenciado: boolean; id_instituicao?: string | null }[];
}

export interface InstituicaoRef {
  id_instituicao: string;
  nome_exibicao: string;
  sigla?: string | null;
}

export interface ModalidadeRef {
  id_modalidade: string;
  nome_modalidade: string;
}

export interface AreaRef {
  id_area: string;
  nome_area: string;
}

export interface LogImportacaoItem {
  tipo: 'success' | 'error' | 'info';
  mensagem: string;
}

export const GestorAvaliadores: React.FC<{
  id_evento_ativo?: string;
  ao_fechar?: () => void;
  aoAtualizarMetricas?: () => void;
}> = ({ id_evento_ativo, ao_fechar, aoAtualizarMetricas }) => {
  const [avaliadores, setListaAvaliadores] = useState<UsuarioAvaliador[]>([]);
  const set_avaliadores = setListaAvaliadores;
  const [carregando, set_carregando] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // Tabelas de referência
  const [lista_instituicoes, set_lista_instituicoes] = useState<InstituicaoRef[]>([]);
  const [lista_modalidades, set_lista_modalidades] = useState<ModalidadeRef[]>([]);
  const [lista_areas, set_lista_areas] = useState<AreaRef[]>([]);

  // Ordenação de colunas
  type ColunaOrdenacaoAvaliador = 'is_credenciado' | 'nome' | 'nome_instituicao' | 'email' | 'modalidades_bloqueadas' | 'areas';
  const [colunaOrdenacao, setColunaOrdenacao] = useState<ColunaOrdenacaoAvaliador>('nome');
  const [ordemAscendente, setOrdemAscendente] = useState<boolean>(true);
  const [processando_modalidade_id, set_processando_modalidade_id] = useState<string | null>(null);

  // ID do Evento Ativo
  const [eventoAtivoId, setEventoAtivoId] = useState<string>(
    id_evento_ativo || localStorage.getItem('evento_ativo_id') || ''
  );

  // State OBRIGATÓRIO de Logs da Importação
  const [logsImportacao, setLogsImportacao] = useState<LogImportacaoItem[]>([]);

  // Formulário Retrátil de Inclusão Manual
  const [mostrar_form_novo, set_mostrar_form_novo] = useState<boolean>(false);
  const [novo_nome, set_novo_nome] = useState<string>('');
  const [novo_email, set_novo_email] = useState<string>('');
  const [novo_instituicao_id, set_novo_instituicao_id] = useState<string>('');
  const [novo_modalidades_bloqueadas, set_novo_modalidades_bloqueadas] = useState<string[]>([]);
  const [novo_areas, set_novo_areas] = useState<string[]>([]);
  const [salvando_manual, set_salvando_manual] = useState<boolean>(false);

  // Estado Modal de Edição (CRUD - Editar)
  const [modal_edicao_aberto, set_modal_edicao_aberto] = useState<boolean>(false);
  const [usuario_em_edicao, set_usuario_em_edicao] = useState<{ id_usuario: string; nome: string; email: string } | null>(null);
  const [edit_instituicao_id, set_edit_instituicao_id] = useState<string>('');
  const [edit_modalidades_bloqueadas, set_edit_modalidades_bloqueadas] = useState<string[]>([]);
  const [edit_areas, set_edit_areas] = useState<string[]>([]);
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  // Estado Toggle Credenciamento em andamento
  const [processando_credenciamento_id, set_processando_credenciamento_id] = useState<string | null>(null);

  // Estado de Importação por Arquivo
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);

  // Estados para Validação e De-Duplicação De-Para
  const [modalDeParaAberto, setModalDeParaAberto] = useState<boolean>(false);
  const [itensDePara, setItensDePara] = useState<ItemMapeamentoDePara[]>([]);
  const [linhasArquivoPendente, setLinhasArquivoPendente] = useState<any[]>([]);

  const input_file_ref = useRef<HTMLInputElement>(null);
  const conexao_banco = verificar_conexao_configurada();

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  const adicionarLog = (tipo: 'success' | 'error' | 'info', mensagem: string) => {
    setLogsImportacao((prev) => [...prev, { tipo, mensagem }]);
  };

  // 1. ORDEM DE EXECUÇÃO ASSÍNCRONA: Resolver ID do Evento Ativo
  useEffect(() => {
    const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

    if (id_evento_ativo && isUuid(id_evento_ativo)) {
      setEventoAtivoId(id_evento_ativo);
      return;
    }

    const savedId = localStorage.getItem('evento_ativo_id');
    if (savedId && isUuid(savedId)) {
      setEventoAtivoId(savedId);
      return;
    }

    if (!conexao_banco) return;

    const resolverEventoAtivo = async () => {
      try {
        const { data: evData } = await supabase
          .from('eventos')
          .select('id_evento')
          .eq('is_ativo', true)
          .limit(1)
          .maybeSingle();

        if (evData?.id_evento) {
          setEventoAtivoId(evData.id_evento);
          localStorage.setItem('evento_ativo_id', evData.id_evento);
        }
      } catch (err) {
        console.error('Erro ao buscar evento ativo:', err);
      }
    };

    resolverEventoAtivo();
  }, [id_evento_ativo, conexao_banco]);

  // Buscar lista de avaliadores de forma abrangente com status de credenciamento, instituição e modalidades bloqueadas
  const carregar_avaliadores = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    const overridesLocais = typeof window !== 'undefined'
      ? JSON.parse(localStorage.getItem('avaliadores_credenciados_local') || '{}')
      : {};

    if (!conexao_banco) {
      setListaAvaliadores((prev) =>
        prev.map((a) => ({
          ...a,
          is_credenciado: overridesLocais[a.id_usuario] !== undefined
            ? overridesLocais[a.id_usuario]
            : Boolean(a.is_credenciado),
        }))
      );
      set_carregando(false);
      return;
    }

    try {
      const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      const idEvt = eventoAtivoId || (isUuid(id_evento_ativo) ? id_evento_ativo : '') || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || '';

      // 1. Busca tabelas de referência (Instituições, Modalidades e Áreas) do evento ativo
      let qInst: any = supabase.from('instituicoes').select('id_instituicao, nome_exibicao, sigla');
      let qMods: any = supabase.from('modalidades').select('id_modalidade, nome_modalidade');
      let qAreas: any = supabase.from('areas_tematicas').select('id_area, nome_area');

      if (idEvt && isUuid(idEvt)) {
        if (typeof qInst.eq === 'function') qInst = qInst.eq('id_evento', idEvt);
        if (typeof qMods.eq === 'function') qMods = qMods.eq('id_evento', idEvt);
        if (typeof qAreas.eq === 'function') qAreas = qAreas.eq('id_evento', idEvt);
      }

      if (typeof qInst.order === 'function') qInst = qInst.order('nome_exibicao', { ascending: true });
      if (typeof qMods.order === 'function') qMods = qMods.order('nome_modalidade', { ascending: true });
      if (typeof qAreas.order === 'function') qAreas = qAreas.order('nome_area', { ascending: true });

      const [resInst, resMods, resAreas] = await Promise.all([qInst, qMods, qAreas]);
      if (resInst?.data) set_lista_instituicoes(resInst.data as InstituicaoRef[]);
      if (resMods?.data) set_lista_modalidades(resMods.data as ModalidadeRef[]);
      if (resAreas?.data) set_lista_areas(resAreas.data as AreaRef[]);

      const mapaModalidadesNomes = new Map<string, string>();
      (resMods.data || []).forEach((m: any) => {
        mapaModalidadesNomes.set(m.id_modalidade, m.nome_modalidade);
      });

      const mapaAreasNomes = new Map<string, string>();
      (resAreas.data || []).forEach((a: any) => {
        mapaAreasNomes.set(a.id_area, a.nome_area);
      });

      // 2. Busca todos os usuários com papel AVALIADOR
      const { data: usersData, error: usersError } = await supabase
        .from('usuarios')
        .select('id_usuario, nome, email, papel')
        .order('nome', { ascending: true });

      if (usersError) throw usersError;

      const apenasAvaliadores = (usersData || []).filter(
        (u) => u.papel?.toUpperCase() === 'AVALIADOR'
      );

      // 3. Busca vínculo de credenciamento e instituição na tabela avaliadores_evento do evento ativo
      
      let queryAe = supabase.from('avaliadores_evento').select('id_usuario, is_credenciado, id_evento, id_instituicao, instituicoes(nome_exibicao)');
      if (idEvt && isUuid(idEvt)) {
        queryAe = queryAe.eq('id_evento', idEvt);
      }
      const { data: aeData } = await queryAe;

      const aeMap = new Map<string, { is_credenciado: boolean; id_instituicao: string | null; nome_instituicao: string | null }>();
      (aeData || []).forEach((row: any) => {
        const nomeInst = Array.isArray(row.instituicoes)
          ? row.instituicoes[0]?.nome_exibicao
          : (row.instituicoes as any)?.nome_exibicao || null;
        aeMap.set(row.id_usuario, {
          is_credenciado: Boolean(row.is_credenciado),
          id_instituicao: row.id_instituicao || null,
          nome_instituicao: nomeInst,
        });
      });

      // 4. Busca modalidades bloqueadas por avaliador no evento ativo
      let queryBloqueios = supabase.from('avaliador_modalidades_bloqueadas').select('id_usuario, id_evento, id_modalidade');
      if (idEvt && isUuid(idEvt)) {
        queryBloqueios = queryBloqueios.eq('id_evento', idEvt);
      }
      const { data: bloqueiosData } = await queryBloqueios;

      const bloqueiosMap = new Map<string, string[]>();
      (bloqueiosData || []).forEach((b: any) => {
        const list = bloqueiosMap.get(b.id_usuario) || [];
        list.push(b.id_modalidade);
        bloqueiosMap.set(b.id_usuario, list);
      });

      // 5. Busca áreas temáticas vinculadas aos avaliadores no evento ativo
      let queryAvaliadorAreas = supabase.from('avaliador_areas').select('id_usuario, id_evento, id_area');
      if (idEvt && isUuid(idEvt)) {
        queryAvaliadorAreas = queryAvaliadorAreas.eq('id_evento', idEvt);
      }
      const { data: avAreasData } = await queryAvaliadorAreas;

      const areasMap = new Map<string, string[]>();
      (avAreasData || []).forEach((a: any) => {
        const list = areasMap.get(a.id_usuario) || [];
        list.push(a.id_area);
        areasMap.set(a.id_usuario, list);
      });

      const listaFinal: UsuarioAvaliador[] = apenasAvaliadores.map((u) => {
        const infoAe = aeMap.get(u.id_usuario);
        const statusCred = overridesLocais[u.id_usuario] !== undefined
          ? overridesLocais[u.id_usuario]
          : (infoAe ? infoAe.is_credenciado : false);

        const modIds = bloqueiosMap.get(u.id_usuario) || [];
        const modNomes = modIds.map((id) => mapaModalidadesNomes.get(id) || 'Modalidade');

        const areaIds = areasMap.get(u.id_usuario) || [];
        const areaNomes = areaIds.map((id) => mapaAreasNomes.get(id) || 'Área');

        return {
          id_usuario: u.id_usuario,
          nome: u.nome,
          email: u.email,
          papel: u.papel,
          is_credenciado: statusCred,
          id_instituicao: infoAe?.id_instituicao || null,
          nome_instituicao: infoAe?.nome_instituicao || null,
          modalidades_bloqueadas: modIds,
          nomes_modalidades_bloqueadas: modNomes,
          areas: areaIds,
          nomes_areas: areaNomes,
        };
      });
      setListaAvaliadores(listaFinal);
    } catch (err: any) {
      console.error('Falha ao carregar avaliadores:', err);
      setListaAvaliadores([]);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    carregar_avaliadores();
  }, [conexao_banco, eventoAtivoId]);

  // Inclusão Manual: Mini-formulário inline (Nome, E-mail, Instituição e Bloqueio de Modalidades)
  const handle_adicionar_manual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novo_nome.trim() || !novo_email.trim()) {
      set_mensagem_erro('Preencha o Nome e o E-mail do avaliador.');
      return;
    }

    set_salvando_manual(true);
    set_mensagem_erro(null);

    const email_limpo = novo_email.toLowerCase().trim();
    const nome_limpo = novo_nome.trim();

    if (!conexao_banco) {
      const instObj = lista_instituicoes.find((i) => i.id_instituicao === novo_instituicao_id);
      const modNomes = novo_modalidades_bloqueadas.map((id) => {
        const m = lista_modalidades.find((mod) => mod.id_modalidade === id);
        return m?.nome_modalidade || 'Modalidade';
      });
      const areaNomes = novo_areas.map((id) => {
        const a = lista_areas.find((area) => area.id_area === id);
        return a?.nome_area || 'Área';
      });

      const novo_obj: UsuarioAvaliador = {
        id_usuario: crypto.randomUUID(),
        nome: nome_limpo,
        email: email_limpo,
        papel: 'AVALIADOR',
        is_credenciado: false,
        id_instituicao: novo_instituicao_id || null,
        nome_instituicao: instObj?.nome_exibicao || null,
        modalidades_bloqueadas: novo_modalidades_bloqueadas,
        nomes_modalidades_bloqueadas: modNomes,
        areas: novo_areas,
        nomes_areas: areaNomes,
      };
      set_avaliadores((prev) => [novo_obj, ...prev]);
      set_novo_nome('');
      set_novo_email('');
      set_novo_instituicao_id('');
      set_novo_modalidades_bloqueadas([]);
      set_novo_areas([]);
      set_mostrar_form_novo(false);
      set_salvando_manual(false);
      exibir_notificacao('Avaliador adicionado com sucesso (modo contingência)!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    try {
      let idUsuarioCriado: string | null = null;
      const { data: usuarioSalvo, error } = await supabase
        .from('usuarios')
        .insert([{
          nome: nome_limpo,
          email: email_limpo,
          papel: 'AVALIADOR',
        }])
        .select('id_usuario')
        .single();

      if (error) {
        if (error.code === '23505') {
          const { data: usuarioAtualizado, error: errUpdate } = await supabase
            .from('usuarios')
            .update({ nome: nome_limpo, papel: 'AVALIADOR' })
            .eq('email', email_limpo)
            .select('id_usuario')
            .single();

          if (errUpdate) throw errUpdate;
          idUsuarioCriado = usuarioAtualizado?.id_usuario || null;
        } else {
          throw error;
        }
      } else {
        idUsuarioCriado = usuarioSalvo?.id_usuario || null;
      }

      // Vincula ao evento ativo e salva id_instituicao na tabela avaliadores_evento
      const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      const idEvtManual = (eventoAtivoId && isUuid(eventoAtivoId))
        ? eventoAtivoId
        : (isUuid(id_evento_ativo) ? id_evento_ativo! : '') || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') || '' : '');

      if (idUsuarioCriado && idEvtManual) {
        await supabase
          .from('avaliadores_evento')
          .upsert([{
            id_usuario: idUsuarioCriado,
            id_evento: idEvtManual,
            id_instituicao: novo_instituicao_id || null,
          }], { onConflict: 'id_usuario,id_evento' });

        // Salva modalidades bloqueadas em avaliador_modalidades_bloqueadas
        if (novo_modalidades_bloqueadas.length > 0) {
          const registrosBloqueio = novo_modalidades_bloqueadas.map((id_mod) => ({
            id_usuario: idUsuarioCriado!,
            id_evento: idEvtManual,
            id_modalidade: id_mod,
          }));
          await supabase
            .from('avaliador_modalidades_bloqueadas')
            .upsert(registrosBloqueio, { onConflict: 'id_usuario,id_evento,id_modalidade' });
        }

        // Salva áreas de avaliação em avaliador_areas
        if (novo_areas.length > 0) {
          const registrosAreas = novo_areas.map((id_area) => ({
            id_usuario: idUsuarioCriado!,
            id_evento: idEvtManual,
            id_area: id_area,
          }));
          await supabase
            .from('avaliador_areas')
            .upsert(registrosAreas, { onConflict: 'id_usuario,id_evento,id_area' });
        }
      }

      exibir_notificacao('Avaliador cadastrado no Supabase com sucesso!');
      set_novo_nome('');
      set_novo_email('');
      set_novo_instituicao_id('');
      set_novo_modalidades_bloqueadas([]);
      set_novo_areas([]);
      set_mostrar_form_novo(false);
      await carregar_avaliadores();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao adicionar avaliador:', err);
      set_mensagem_erro(`Falha ao adicionar avaliador: ${err?.message || 'Erro no banco'}`);
    } finally {
      set_salvando_manual(false);
    }
  };

  // Gerar e Baixar Modelo de Planilha (.xlsx) com colunas padrão de avaliadores
  const baixar_planilha_exemplo = () => {
    try {
      const dadosExemplo = [
        {
          nome: 'Prof. Carlos Eduardo Santos',
          email: 'carlos.santos@ifms.edu.br',
          instituicao: 'IFMS Campus Campo Grande',
          sigla_instituicao: 'IFMS-CG',
          modalidades_bloqueadas: 'Ensino Médio, Nível Fundamental',
          areas: 'CIÊNCIAS EXATAS E DA TERRA, ENGENHARIAS',
        },
        {
          nome: 'Dra. Mariana Silva Lima',
          email: 'mariana.lima@ufms.br',
          instituicao: 'Universidade Federal de MS',
          sigla_instituicao: 'UFMS',
          modalidades_bloqueadas: 'Ensino Técnico',
          areas: 'CIÊNCIAS BIOLÓGICAS, CIÊNCIAS DA SAÚDE',
        },
        {
          nome: 'Me. Roberto Alves Ferreira',
          email: 'roberto.ferreira@gmail.com',
          instituicao: 'Escola Estadual Joaquim Murtinho',
          sigla_instituicao: 'EEJM',
          modalidades_bloqueadas: '',
          areas: 'CIÊNCIAS HUMANAS / CIÊNCIAS SOCIAIS APLICADAS',
        },
      ];

      const ws = XLSX.utils.json_to_sheet(dadosExemplo);
      ws['!cols'] = [
        { wch: 32 }, // nome
        { wch: 35 }, // email
        { wch: 32 }, // instituicao
        { wch: 18 }, // sigla_instituicao
        { wch: 45 }, // modalidades_bloqueadas
        { wch: 50 }, // areas
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Modelo Avaliadores');
      XLSX.writeFile(wb, 'modelo_importacao_avaliadores.xlsx');
      exibir_notificacao('Planilha modelo de avaliadores (.xlsx) gerada e baixada com sucesso!');
    } catch (err: any) {
      console.error('Erro ao gerar planilha modelo de avaliadores:', err);
      set_mensagem_erro('Falha ao baixar modelo de exemplo.');
    }
  };

  // Gravação final de avaliadores após De-Para ou casamento exato direto
  const executarGravacaoFinalAvaliadores = async (
    avaliadoresImportados: any[],
    decisoes: Map<string, DecisaoMapeamento>
  ) => {
    set_processando_arquivo(true);
    try {
      const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      const idEvt = eventoAtivoId || (isUuid(id_evento_ativo) ? id_evento_ativo : '') || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || null;

      // 1. Mapeamento de Instituições, Modalidades e Áreas Temáticas
      const mapaInst = new Map<string, string>();
      lista_instituicoes.forEach((i) => {
        mapaInst.set(normalizarChave(i.nome_exibicao), i.id_instituicao);
        if (i.sigla) mapaInst.set(normalizarChave(i.sigla), i.id_instituicao);
      });

      const mapaMods = new Map<string, string>();
      lista_modalidades.forEach((m) => {
        mapaMods.set(normalizarChave(m.nome_modalidade), m.id_modalidade);
      });

      const mapaAreas = new Map<string, string>();
      lista_areas.forEach((a) => {
        mapaAreas.set(normalizarChave(a.nome_area), a.id_area);
      });

      // Aplica decisões tomadas no De-Para
      for (const [termo, decisao] of decisoes.entries()) {
        if (decisao.tipo === 'instituicao') {
          if (decisao.acao === 'associar_existente' && decisao.id_destino) {
            mapaInst.set(normalizarChave(termo), decisao.id_destino);
          } else if (decisao.acao === 'cadastrar_novo' || (decisao.acao as any) === 'criar_novo') {
            const nomeCriar = decisao.novo_nome?.trim() || termo.trim();
            const kCriar = normalizarChave(nomeCriar);
            if (!mapaInst.has(kCriar)) {
              if (conexao_banco) {
                try {
                  const siglaCriar = nomeCriar.length <= 10 ? nomeCriar.toUpperCase() : null;
                  const payloadInst: any = {
                    nome_exibicao: nomeCriar,
                    nome_normalizado: kCriar,
                    sigla: siglaCriar,
                  };
                  if (idEvt) payloadInst.id_evento = idEvt;

                  let { data: novaInst, error: errInst } = await supabase
                    .from('instituicoes')
                    .insert([payloadInst])
                    .select('id_instituicao, nome_exibicao, sigla')
                    .single();

                  if (errInst && errInst.message && errInst.message.includes('id_evento')) {
                    delete payloadInst.id_evento;
                    const retry = await supabase
                      .from('instituicoes')
                      .insert([payloadInst])
                      .select('id_instituicao, nome_exibicao, sigla')
                      .single();
                    novaInst = retry.data;
                    errInst = retry.error;
                  }

                  if (!errInst && novaInst) {
                    mapaInst.set(kCriar, novaInst.id_instituicao);
                    mapaInst.set(normalizarChave(termo), novaInst.id_instituicao);
                    set_lista_instituicoes((prev) => [...prev, novaInst]);
                    adicionarLog('info', `Instituição cadastrada via De-Para: "${nomeCriar}".`);
                  } else if (errInst) {
                    console.error('Falha ao cadastrar instituição via De-Para no banco:', errInst);
                  }
                } catch (eInst) {
                  console.warn('Erro ao criar instituição via De-Para:', eInst);
                }
              } else {
                const fakeId = crypto.randomUUID();
                mapaInst.set(kCriar, fakeId);
                mapaInst.set(normalizarChave(termo), fakeId);
                set_lista_instituicoes((prev) => [...prev, { id_instituicao: fakeId, nome_exibicao: nomeCriar, sigla: nomeCriar.substring(0, 10).toUpperCase(), id_evento: idEvt }]);
              }
            }
          }
        } else if (decisao.tipo === 'modalidade') {
          if (decisao.acao === 'associar_existente' && decisao.id_destino) {
            mapaMods.set(normalizarChave(termo), decisao.id_destino);
          } else if (decisao.acao === 'cadastrar_novo' || (decisao.acao as any) === 'criar_novo') {
            const nomeCriar = decisao.novo_nome?.trim() || termo.trim();
            const kCriar = normalizarChave(nomeCriar);
            if (!mapaMods.has(kCriar)) {
              if (conexao_banco) {
                try {
                  const payloadMod: any = { 
                    nome_modalidade: nomeCriar,
                  };
                  if (idEvt) payloadMod.id_evento = idEvt;

                  let { data: novaMod, error: errMod } = await supabase
                    .from('modalidades')
                    .insert([payloadMod])
                    .select('id_modalidade, nome_modalidade')
                    .single();

                  if (errMod && errMod.message && errMod.message.includes('id_evento')) {
                    delete payloadMod.id_evento;
                    const retry = await supabase
                      .from('modalidades')
                      .insert([payloadMod])
                      .select('id_modalidade, nome_modalidade')
                      .single();
                    novaMod = retry.data;
                    errMod = retry.error;
                  }

                  if (!errMod && novaMod) {
                    mapaMods.set(kCriar, novaMod.id_modalidade);
                    mapaMods.set(normalizarChave(termo), novaMod.id_modalidade);
                    set_lista_modalidades((prev) => [...prev, novaMod]);
                    adicionarLog('info', `Modalidade cadastrada via De-Para: "${nomeCriar}".`);
                  } else if (errMod) {
                    console.error('Falha ao cadastrar modalidade via De-Para no banco:', errMod);
                  }
                } catch (eMod) {
                  console.warn('Erro ao criar modalidade via De-Para:', eMod);
                }
              } else {
                const fakeId = crypto.randomUUID();
                mapaMods.set(kCriar, fakeId);
                mapaMods.set(normalizarChave(termo), fakeId);
                set_lista_modalidades((prev) => [...prev, { id_modalidade: fakeId, nome_modalidade: nomeCriar, id_evento: idEvt }]);
              }
            }
          }
        } else if (decisao.tipo === 'area') {
          if (decisao.acao === 'associar_existente' && decisao.id_destino) {
            mapaAreas.set(normalizarChave(termo), decisao.id_destino);
          } else if (decisao.acao === 'cadastrar_novo' || (decisao.acao as any) === 'criar_novo') {
            const nomeCriar = decisao.novo_nome?.trim() || termo.trim();
            const kCriar = normalizarChave(nomeCriar);
            if (!mapaAreas.has(kCriar)) {
              if (conexao_banco) {
                try {
                  const payloadArea: any = {
                    nome_area: nomeCriar,
                  };
                  if (idEvt) payloadArea.id_evento = idEvt;

                  let { data: novaArea, error: errArea } = await supabase
                    .from('areas_tematicas')
                    .insert([payloadArea])
                    .select('id_area, nome_area')
                    .single();

                  if (errArea && errArea.message && errArea.message.includes('id_evento')) {
                    delete payloadArea.id_evento;
                    const retry = await supabase
                      .from('areas_tematicas')
                      .insert([payloadArea])
                      .select('id_area, nome_area')
                      .single();
                    novaArea = retry.data;
                    errArea = retry.error;
                  }

                  if (!errArea && novaArea) {
                    mapaAreas.set(kCriar, novaArea.id_area);
                    mapaAreas.set(normalizarChave(termo), novaArea.id_area);
                    set_lista_areas((prev) => [...prev, novaArea]);
                    adicionarLog('info', `Área Temática cadastrada via De-Para: "${nomeCriar}".`);
                  } else if (errArea) {
                    console.error('Falha ao cadastrar área via De-Para no banco:', errArea);
                  }
                } catch (eArea) {
                  console.warn('Erro ao criar área temática via De-Para:', eArea);
                }
              } else {
                const fakeId = crypto.randomUUID();
                mapaAreas.set(kCriar, fakeId);
                mapaAreas.set(normalizarChave(termo), fakeId);
                set_lista_areas((prev) => [...prev, { id_area: fakeId, nome_area: nomeCriar, id_evento: idEvt }]);
              }
            }
          }
        }
      }

      // Prepara dados dos avaliadores para salvar
      const dadosParaSalvar: Array<{
        nome: string;
        email: string;
        papel: string;
        id_instituicao: string | null;
        modalidades_bloqueadas_ids: string[];
        areas_ids: string[];
      }> = [];

      for (const av of avaliadoresImportados) {
        let idInstResolvido: string | null = null;
        if (av.instituicao || av.sigla_instituicao) {
          const kNome = av.instituicao ? normalizarChave(av.instituicao) : '';
          const kSigla = av.sigla_instituicao ? normalizarChave(av.sigla_instituicao) : '';
          if (kNome && mapaInst.has(kNome)) {
            idInstResolvido = mapaInst.get(kNome)!;
          } else if (kSigla && mapaInst.has(kSigla)) {
            idInstResolvido = mapaInst.get(kSigla)!;
          } else if (av.instituicao?.trim()) {
            // Auto-cadastro seguro da instituição do avaliador
            const nomeCriar = av.instituicao.trim();
            const chaveCriar = normalizarChave(nomeCriar);
            if (mapaInst.has(chaveCriar)) {
              idInstResolvido = mapaInst.get(chaveCriar)!;
            } else if (conexao_banco) {
              try {
                const siglaCriar = av.sigla_instituicao ? av.sigla_instituicao.trim().toUpperCase() : null;
                const payloadInst: any = {
                  nome_exibicao: nomeCriar,
                  nome_normalizado: chaveCriar,
                  sigla: siglaCriar,
                };
                if (idEvt) payloadInst.id_evento = idEvt;

                let { data: novaInst, error: errInst } = await supabase
                  .from('instituicoes')
                  .insert([payloadInst])
                  .select('id_instituicao, nome_exibicao, sigla')
                  .single();

                if (errInst && errInst.message && errInst.message.includes('id_evento')) {
                  delete payloadInst.id_evento;
                  const retry = await supabase
                    .from('instituicoes')
                    .insert([payloadInst])
                    .select('id_instituicao, nome_exibicao, sigla')
                    .single();
                  novaInst = retry.data;
                  errInst = retry.error;
                }

                if (!errInst && novaInst) {
                  idInstResolvido = novaInst.id_instituicao;
                  mapaInst.set(chaveCriar, novaInst.id_instituicao);
                  if (siglaCriar) mapaInst.set(normalizarChave(siglaCriar), novaInst.id_instituicao);
                  set_lista_instituicoes((prev) => [...prev, novaInst]);
                  adicionarLog('info', `Instituição auto-cadastrada no evento: "${nomeCriar}".`);
                }
              } catch (eInst) {
                console.warn('Erro ao auto-cadastrar instituição do avaliador:', eInst);
              }
            } else {
              const fakeId = crypto.randomUUID();
              idInstResolvido = fakeId;
              mapaInst.set(chaveCriar, fakeId);
              if (av.sigla_instituicao) mapaInst.set(normalizarChave(av.sigla_instituicao), fakeId);
              set_lista_instituicoes((prev) => [...prev, { id_instituicao: fakeId, nome_exibicao: nomeCriar, sigla: av.sigla_instituicao || null, id_evento: idEvt }]);
            }
          }
        }

        // Resolução de Modalidades Bloqueadas
        const modIds: string[] = [];
        av.modalidades_bloqueadas.forEach((nomeMod: string) => {
          const kMod = normalizarChave(nomeMod);
          if (mapaMods.has(kMod)) {
            modIds.push(mapaMods.get(kMod)!);
          }
        });

        // Resolução de Áreas Temáticas (afinidade do avaliador)
        const areaIds: string[] = [];
        if (Array.isArray(av.areas)) {
          av.areas.forEach((nomeArea: string) => {
            const kArea = normalizarChave(nomeArea);
            if (mapaAreas.has(kArea)) {
              const idA = mapaAreas.get(kArea)!;
              if (!areaIds.includes(idA)) {
                areaIds.push(idA);
              }
            }
          });
        }

        dadosParaSalvar.push({
          nome: av.nome,
          email: av.email,
          papel: 'AVALIADOR',
          id_instituicao: idInstResolvido,
          modalidades_bloqueadas_ids: modIds,
          areas_ids: areaIds,
        });
      }

      if (conexao_banco) {
        // Upsert em lote de usuarios
        const usuariosUpsert = dadosParaSalvar.map((d) => ({
          nome: d.nome,
          email: d.email,
          papel: 'AVALIADOR',
        }));

        const { error: errBatch } = await supabase
          .from('usuarios')
          .upsert(usuariosUpsert, { onConflict: 'email' });

        if (errBatch) {
          adicionarLog('error', `Falha no banco ao realizar UPSERT em lote: ${errBatch.message}`);
          set_mensagem_erro(`Erro ao importar avaliadores: ${errBatch.message}`);
          set_processando_arquivo(false);
          return;
        }

        // Busca IDs criados/atualizados
        const emails = dadosParaSalvar.map((d) => d.email);
        const { data: usuariosSalvos } = await supabase
          .from('usuarios')
          .select('id_usuario, email')
          .in('email', emails);

        const emailToId = new Map<string, string>();
        (usuariosSalvos || []).forEach((u: any) => {
          emailToId.set(u.email.toLowerCase(), u.id_usuario);
        });

        // Vinculação a avaliadores_evento, avaliador_modalidades_bloqueadas e avaliador_areas
        if (eventoAtivoId) {
          const registrosEvento: any[] = [];
          const registrosBloqueios: any[] = [];
          const registrosAreas: any[] = [];

          dadosParaSalvar.forEach((d) => {
            const idUsuario = emailToId.get(d.email.toLowerCase());
            if (idUsuario) {
              registrosEvento.push({
                id_usuario: idUsuario,
                id_evento: eventoAtivoId,
                id_instituicao: d.id_instituicao,
              });

              d.modalidades_bloqueadas_ids.forEach((idMod) => {
                registrosBloqueios.push({
                  id_usuario: idUsuario,
                  id_evento: eventoAtivoId,
                  id_modalidade: idMod,
                });
              });

              d.areas_ids.forEach((idArea) => {
                registrosAreas.push({
                  id_usuario: idUsuario,
                  id_evento: eventoAtivoId,
                  id_area: idArea,
                });
              });
            }
          });

          if (registrosEvento.length > 0) {
            await supabase
              .from('avaliadores_evento')
              .upsert(registrosEvento, { onConflict: 'id_usuario,id_evento' });
          }

          if (registrosBloqueios.length > 0) {
            await supabase
              .from('avaliador_modalidades_bloqueadas')
              .upsert(registrosBloqueios, { onConflict: 'id_usuario,id_evento,id_modalidade' });
          }

          if (registrosAreas.length > 0) {
            await supabase
              .from('avaliador_areas')
              .upsert(registrosAreas, { onConflict: 'id_usuario,id_evento,id_area' });
          }
        }

        adicionarLog('success', `Lote processado com sucesso! ${dadosParaSalvar.length} avaliadores cadastrados/atualizados via upsert.`);
        exibir_notificacao(`Importação concluída: ${dadosParaSalvar.length} avaliadores cadastrados com sucesso!`);
        await carregar_avaliadores();
        if (aoAtualizarMetricas) aoAtualizarMetricas();
      } else {
        dadosParaSalvar.forEach((d) => {
          const areaNomes = d.areas_ids.map((idA) => {
            const ar = lista_areas.find((x) => x.id_area === idA);
            return ar?.nome_area || 'Área';
          });
          set_avaliadores((prev) => [
            {
              id_usuario: crypto.randomUUID(),
              nome: d.nome,
              email: d.email,
              papel: 'AVALIADOR',
              is_credenciado: false,
              id_instituicao: d.id_instituicao,
              modalidades_bloqueadas: d.modalidades_bloqueadas_ids,
              areas: d.areas_ids,
              nomes_areas: areaNomes,
            },
            ...prev,
          ]);
        });
        adicionarLog('success', `[Modo Contingência] ${dadosParaSalvar.length} avaliadores inseridos.`);
        exibir_notificacao(`Importação concluída: ${dadosParaSalvar.length} avaliadores inseridos!`);
      }
    } catch (err: any) {
      console.error('Erro ao salvar avaliadores:', err);
      set_mensagem_erro('Erro ao gravar avaliadores.');
    } finally {
      set_processando_arquivo(false);
    }
  };

  // RESTAURAÇÃO DO PAINEL DE LOGS DA IMPORTAÇÃO ROBUSTO (.CSV/.XLSX)
  const handle_upload_arquivo = async (file: File) => {
    set_processando_arquivo(true);
    set_mensagem_erro(null);
    setLogsImportacao([]); // Limpa logs anteriores

    adicionarLog('info', `Iniciando leitura do arquivo: ${file.name}`);

    try {
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          if (!e.target?.result) {
            adicionarLog('error', 'Falha ao carregar conteúdo do arquivo.');
            set_processando_arquivo(false);
            return;
          }

          const resultado = parsePlanilhaAvaliadores(e.target.result as ArrayBuffer | string, isCSV);

          if (!resultado.sucesso || resultado.avaliadores.length === 0) {
            adicionarLog('error', 'Nenhum avaliador válido encontrado para importação.');
            set_mensagem_erro('Nenhum avaliador válido encontrado para importação.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Planilha lida com sucesso! ${resultado.avaliadores.length} avaliadores válidos identificados.`);

          // Log de linhas com erro (se houver)
          resultado.erros.forEach((err) => {
            adicionarLog('error', err.mensagem);
          });

          // 1. Prepara candidatos com aliases
          let candidatosInst: CandidatoMatch[] = lista_instituicoes.map((i) => ({
            id: i.id_instituicao,
            nome: i.nome_exibicao,
            sigla: i.sigla,
            aliases: [],
          }));

          let candidatosMods: CandidatoMatch[] = lista_modalidades.map((m) => ({
            id: m.id_modalidade,
            nome: m.nome_modalidade,
            sigla: null,
            aliases: [],
          }));

          let candidatosAreas: CandidatoMatch[] = lista_areas.map((a) => ({
            id: a.id_area,
            nome: a.nome_area,
            sigla: null,
            aliases: [],
          }));

          if (conexao_banco) {
            try {
              const [{ data: aliasesInst }, { data: aliasesMod }] = await Promise.all([
                supabase.from('instituicao_aliases').select('id_instituicao, alias'),
                supabase.from('modalidade_aliases').select('id_modalidade, alias')
              ]);

              if (aliasesInst) {
                const mapA = new Map<string, string[]>();
                aliasesInst.forEach((a: any) => {
                  const arr = mapA.get(a.id_instituicao) || [];
                  arr.push(a.alias);
                  mapA.set(a.id_instituicao, arr);
                });
                candidatosInst = candidatosInst.map((c) => ({
                  ...c,
                  aliases: mapA.get(c.id) || [],
                }));
              }

              if (aliasesMod) {
                const mapM = new Map<string, string[]>();
                aliasesMod.forEach((a: any) => {
                  const arr = mapM.get(a.id_modalidade) || [];
                  arr.push(a.alias);
                  mapM.set(a.id_modalidade, arr);
                });
                candidatosMods = candidatosMods.map((c) => ({
                  ...c,
                  aliases: mapM.get(c.id) || [],
                }));
              }
            } catch (eAlias) {
              console.warn('Erro ao carregar aliases:', eAlias);
            }
          }

          // 2. Extrai termos únicos e avalia correspondências com threshold >= 85% (0.85)
          const termosInst = new Set<string>();
          const termosMod = new Set<string>();
          const termosArea = new Set<string>();

          resultado.avaliadores.forEach((av) => {
            const instTermo = av.instituicao?.trim() || av.sigla_instituicao?.trim();
            if (instTermo) termosInst.add(instTermo);
            av.modalidades_bloqueadas.forEach((mb) => {
              if (mb && mb.trim()) termosMod.add(mb.trim());
            });
            if (Array.isArray(av.areas)) {
              av.areas.forEach((ar) => {
                if (ar && ar.trim()) termosArea.add(ar.trim());
              });
            }
          });

          const itensParaDePara: ItemMapeamentoDePara[] = [];
          let precisaDePara = false;

          termosInst.forEach((termo) => {
            const matchRes = buscarMelhorCorrespondencia(termo, candidatosInst, 0.85);
            if (matchRes.matchTipo !== 'exato') {
              precisaDePara = true;
            }
            itensParaDePara.push({
              id_termo: `inst_${termo}`,
              termo_original: termo,
              tipo: 'instituicao',
              sugestao_id: matchRes.candidato?.id || null,
              sugestao_nome: matchRes.candidato?.nome || null,
              confianca_percentual: matchRes.confiancaPercentual,
              match_tipo: matchRes.matchTipo,
            });
          });

          termosMod.forEach((termo) => {
            const matchRes = buscarMelhorCorrespondencia(termo, candidatosMods, 0.85);
            if (matchRes.matchTipo !== 'exato') {
              precisaDePara = true;
            }
            itensParaDePara.push({
              id_termo: `mod_${termo}`,
              termo_original: termo,
              tipo: 'modalidade',
              sugestao_id: matchRes.candidato?.id || null,
              sugestao_nome: matchRes.candidato?.nome || null,
              confianca_percentual: matchRes.confiancaPercentual,
              match_tipo: matchRes.matchTipo,
            });
          });

          termosArea.forEach((termo) => {
            const matchRes = buscarMelhorCorrespondencia(termo, candidatosAreas, 0.85);
            if (matchRes.matchTipo !== 'exato') {
              precisaDePara = true;
            }
            itensParaDePara.push({
              id_termo: `area_${termo}`,
              termo_original: termo,
              tipo: 'area',
              sugestao_id: matchRes.candidato?.id || null,
              sugestao_nome: matchRes.candidato?.nome || null,
              confianca_percentual: matchRes.confiancaPercentual,
              match_tipo: matchRes.matchTipo,
            });
          });

          setLinhasArquivoPendente(resultado.avaliadores);

          if (precisaDePara && itensParaDePara.length > 0) {
            adicionarLog('info', 'Identificados termos novos ou com similaridade. Abrindo tela de validação De-Para...');
            setItensDePara(itensParaDePara);
            setModalDeParaAberto(true);
            set_processando_arquivo(false);
          } else {
            // Todos os termos são 100% exatos ou já mapeados por aliases
            await executarGravacaoFinalAvaliadores(resultado.avaliadores, new Map());
          }
        } catch (errParsing: any) {
          console.error('Erro ao processar planilha de avaliadores:', errParsing);
          adicionarLog('error', `Erro no parsing da planilha: ${errParsing.message}`);
          set_mensagem_erro(`Erro ao processar planilha: ${errParsing.message}`);
        } finally {
          set_processando_arquivo(false);
        }
      };

      if (isCSV) {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    } catch (errUpload: any) {
      console.error('Erro no upload de arquivo:', errUpload);
      adicionarLog('error', `Erro no upload: ${errUpload.message || 'Falha ao ler arquivo'}`);
      set_mensagem_erro('Falha ao ler arquivo do computador.');
      set_processando_arquivo(false);
    }
  };

  // Alterar credenciamento do avaliador com persistência resiliente
  const handle_toggle_credenciamento = async (usuario: UsuarioAvaliador) => {
    const novoStatusCredenciamento = !usuario.is_credenciado;
    const id_alvo = usuario.id_usuario;
    set_processando_credenciamento_id(id_alvo);
    set_mensagem_erro(null);

    // 1. Salva no localStorage imediatamente para garantir persistência mesmo em contingência ou reabertura do modal
    if (typeof window !== 'undefined') {
      const overridesLocais = JSON.parse(localStorage.getItem('avaliadores_credenciados_local') || '{}');
      overridesLocais[id_alvo] = novoStatusCredenciamento;
      localStorage.setItem('avaliadores_credenciados_local', JSON.stringify(overridesLocais));
    }

    // 2. Atualiza state local imediatamente
    setListaAvaliadores((prev) =>
      prev.map((a) =>
        a.id_usuario === id_alvo ? { ...a, is_credenciado: novoStatusCredenciamento } : a
      )
    );

    if (conexao_banco) {
      try {
        const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        let idEvt = eventoAtivoId || (isUuid(id_evento_ativo) ? id_evento_ativo : '') || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || '';

        if (!isUuid(idEvt)) {
          const { data: evData } = await supabase
            .from('eventos')
            .select('id_evento')
            .eq('is_ativo', true)
            .limit(1)
            .maybeSingle();

          if (evData?.id_evento && isUuid(evData.id_evento)) {
            idEvt = evData.id_evento;
            setEventoAtivoId(idEvt);
            localStorage.setItem('evento_ativo_id', idEvt);
          }
        }

        if (isUuid(idEvt)) {
          // Tenta UPSERT composto em avaliadores_evento (garante que a linha existe mesmo se o avaliador for novo)
          const { error: erro_upsert } = await supabase
            .from('avaliadores_evento')
            .upsert({ 
              id_usuario: id_alvo, 
              id_evento: idEvt, 
              is_credenciado: novoStatusCredenciamento
            }, { onConflict: 'id_usuario, id_evento' });

          if (erro_upsert) {
            // Fallback update direto
            await supabase
              .from('avaliadores_evento')
              .update({ is_credenciado: novoStatusCredenciamento })
              .eq('id_usuario', id_alvo)
              .eq('id_evento', idEvt);
          }
        } else {
          await supabase
            .from('avaliadores_evento')
            .update({ is_credenciado: novoStatusCredenciamento })
            .eq('id_usuario', id_alvo);
        }
      } catch (errDb: any) {
        console.warn('Erro ao persistir credenciamento no Supabase:', errDb);
      }
    }

    exibir_notificacao(
      novoStatusCredenciamento
        ? 'Avaliador credenciado com sucesso!'
        : 'Credenciamento suspenso com sucesso.'
    );

    if (aoAtualizarMetricas) aoAtualizarMetricas();
    set_processando_credenciamento_id(null);
  };

  // Bloquear ou desbloquear modalidade específica para o avaliador com persistência imediata
  const handle_toggle_modalidade_bloqueio = async (usuario: UsuarioAvaliador, modalidade: ModalidadeRef) => {
    const chaveAcao = `${usuario.id_usuario}_${modalidade.id_modalidade}`;
    set_processando_modalidade_id(chaveAcao);

    const jaBloqueada = (usuario.modalidades_bloqueadas || []).includes(modalidade.id_modalidade);
    const novasModalidadesBloqueadas = jaBloqueada
      ? (usuario.modalidades_bloqueadas || []).filter((id) => id !== modalidade.id_modalidade)
      : [...(usuario.modalidades_bloqueadas || []), modalidade.id_modalidade];

    const novosNomesModalidades = novasModalidadesBloqueadas.map((id) => {
      const m = lista_modalidades.find((mod) => mod.id_modalidade === id);
      return m?.nome_modalidade || 'Modalidade';
    });

    // 1. Atualização otimista no estado local
    setListaAvaliadores((prev) =>
      prev.map((a) =>
        a.id_usuario === usuario.id_usuario
          ? {
              ...a,
              modalidades_bloqueadas: novasModalidadesBloqueadas,
              nomes_modalidades_bloqueadas: novosNomesModalidades,
            }
          : a
      )
    );

    // 2. Persistência no Supabase
    if (conexao_banco) {
      try {
        let idEvt = eventoAtivoId || id_evento_ativo || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || '';

        if (!idEvt) {
          const { data: evData } = await supabase
            .from('eventos')
            .select('id_evento')
            .eq('is_ativo', true)
            .limit(1)
            .maybeSingle();

          if (evData?.id_evento) {
            idEvt = evData.id_evento;
            setEventoAtivoId(idEvt);
            localStorage.setItem('evento_ativo_id', idEvt);
          }
        }

        if (idEvt) {
          if (jaBloqueada) {
            // Desbloquear: remover da tabela
            const { error: errDel } = await supabase
              .from('avaliador_modalidades_bloqueadas')
              .delete()
              .eq('id_usuario', usuario.id_usuario)
              .eq('id_evento', idEvt)
              .eq('id_modalidade', modalidade.id_modalidade);

            if (errDel) throw errDel;

            exibir_notificacao(`Modalidade "${modalidade.nome_modalidade}" liberada para ${usuario.nome}.`);
          } else {
            // Bloquear: inserir na tabela
            const { error: errIns } = await supabase
              .from('avaliador_modalidades_bloqueadas')
              .upsert([{
                id_usuario: usuario.id_usuario,
                id_evento: idEvt,
                id_modalidade: modalidade.id_modalidade,
              }], { onConflict: 'id_usuario,id_evento,id_modalidade' });

            if (errIns) throw errIns;

            // Expurgar locks ativos e fila direcionada para projetos dessa modalidade
            try {
              const { data: projsBloqueados } = await supabase
                .from('projetos')
                .select('id_projeto')
                .eq('id_modalidade', modalidade.id_modalidade);

              if (projsBloqueados && projsBloqueados.length > 0) {
                const idsProjetosBloqueados = projsBloqueados.map((p: any) => p.id_projeto);

                await supabase
                  .from('locks_ativos')
                  .delete()
                  .eq('id_usuario', usuario.id_usuario)
                  .in('id_projeto', idsProjetosBloqueados);

                await supabase
                  .from('fila_atribuicoes_direcionadas')
                  .delete()
                  .eq('id_usuario', usuario.id_usuario)
                  .in('id_projeto', idsProjetosBloqueados);
              }
            } catch (errExpurgo) {
              console.warn('Aviso ao expurgar locks de modalidade bloqueada:', errExpurgo);
            }

            exibir_notificacao(`Modalidade "${modalidade.nome_modalidade}" bloqueada para ${usuario.nome}.`);
          }
        }
      } catch (errDb: any) {
        console.error('Erro ao alternar bloqueio de modalidade no Supabase:', errDb);
        set_mensagem_erro(`Erro ao atualizar bloqueio: ${errDb?.message || 'Falha no banco'}`);
        await carregar_avaliadores();
      }
    } else {
      exibir_notificacao(
        jaBloqueada
          ? `Modalidade "${modalidade.nome_modalidade}" liberada (modo contingência).`
          : `Modalidade "${modalidade.nome_modalidade}" bloqueada (modo contingência).`
      );
    }

    if (aoAtualizarMetricas) aoAtualizarMetricas();
    set_processando_modalidade_id(null);
  };

  // CRUD - A. EDIÇÃO: Abrir modal
  const handle_abrir_edicao = (item: UsuarioAvaliador) => {
    set_usuario_em_edicao({
      id_usuario: item.id_usuario,
      nome: item.nome,
      email: item.email,
    });
    set_edit_instituicao_id(item.id_instituicao || '');
    set_edit_modalidades_bloqueadas(item.modalidades_bloqueadas || []);
    set_edit_areas(item.areas || []);
    set_modal_edicao_aberto(true);
  };

  // CRUD - A. EDIÇÃO: Disparar update no Supabase
  const handle_salvar_edicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario_em_edicao) return;

    if (!usuario_em_edicao.nome.trim() || !usuario_em_edicao.email.trim()) {
      set_mensagem_erro('Nome e E-mail não podem ficar vazios.');
      return;
    }

    set_salvando_edicao(true);
    set_mensagem_erro(null);

    const nome_atualizado = usuario_em_edicao.nome.trim();
    const email_atualizado = usuario_em_edicao.email.toLowerCase().trim();

    if (!conexao_banco) {
      const instObj = lista_instituicoes.find((i) => i.id_instituicao === edit_instituicao_id);
      const modNomes = edit_modalidades_bloqueadas.map((id) => {
        const m = lista_modalidades.find((mod) => mod.id_modalidade === id);
        return m?.nome_modalidade || 'Modalidade';
      });
      const areaNomes = edit_areas.map((id) => {
        const a = lista_areas.find((ar) => ar.id_area === id);
        return a?.nome_area || 'Área';
      });

      set_avaliadores((prev) =>
        prev.map((a) =>
          a.id_usuario === usuario_em_edicao.id_usuario
            ? {
                ...a,
                nome: nome_atualizado,
                email: email_atualizado,
                id_instituicao: edit_instituicao_id || null,
                nome_instituicao: instObj?.nome_exibicao || null,
                modalidades_bloqueadas: edit_modalidades_bloqueadas,
                nomes_modalidades_bloqueadas: modNomes,
                areas: edit_areas,
                nomes_areas: areaNomes,
              }
            : a
        )
      );
      set_modal_edicao_aberto(false);
      set_usuario_em_edicao(null);
      set_salvando_edicao(false);
      exibir_notificacao('Dados atualizados com sucesso (modo contingência).');
      return;
    }

    try {
      const { error } = await supabase
        .from('usuarios')
        .update({
          nome: nome_atualizado,
          email: email_atualizado,
        })
        .eq('id_usuario', usuario_em_edicao.id_usuario);

      if (error) {
        set_mensagem_erro(`Erro ao atualizar usuário no Supabase: ${error.message}`);
        return;
      }

      // Resolução resiliente do evento ativo
      const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      let idEvt = (eventoAtivoId && isUuid(eventoAtivoId))
        ? eventoAtivoId
        : (isUuid(id_evento_ativo) ? id_evento_ativo! : '');

      if (!idEvt && typeof window !== 'undefined') {
        const savedId = localStorage.getItem('evento_ativo_id');
        if (savedId && isUuid(savedId)) idEvt = savedId;
      }

      if (!idEvt) {
        try {
          const { data: evData } = await supabase
            .from('eventos')
            .select('id_evento')
            .eq('is_ativo', true)
            .limit(1)
            .maybeSingle();
          if (evData?.id_evento) {
            idEvt = evData.id_evento;
            setEventoAtivoId(idEvt);
            if (typeof window !== 'undefined') localStorage.setItem('evento_ativo_id', idEvt);
          }
        } catch (_errEvt) {}
      }

      // Persistir vínculo de instituição, modalidades bloqueadas e áreas no evento ativo
      if (idEvt) {
        // Atualiza instituicao em avaliadores_evento
        const { error: errAe } = await supabase
          .from('avaliadores_evento')
          .upsert([{
            id_usuario: usuario_em_edicao.id_usuario,
            id_evento: idEvt,
            id_instituicao: edit_instituicao_id || null,
          }], { onConflict: 'id_usuario,id_evento' });

        if (errAe) {
          console.warn('Aviso ao atualizar avaliadores_evento:', errAe.message);
        }

        // Sincroniza modalidades bloqueadas
        const { error: errDelBloq } = await supabase
          .from('avaliador_modalidades_bloqueadas')
          .delete()
          .eq('id_usuario', usuario_em_edicao.id_usuario)
          .eq('id_evento', idEvt);

        if (errDelBloq) {
          console.warn('Aviso ao limpar modalidades bloqueadas anteriores:', errDelBloq.message);
        }

        if (edit_modalidades_bloqueadas.length > 0) {
          const registros = edit_modalidades_bloqueadas.map((idMod) => ({
            id_usuario: usuario_em_edicao.id_usuario,
            id_evento: idEvt,
            id_modalidade: idMod,
          }));
          const { error: errInsBloq } = await supabase
            .from('avaliador_modalidades_bloqueadas')
            .insert(registros);

          if (errInsBloq) {
            console.error('Erro ao persistir modalidades bloqueadas:', errInsBloq);
          }

          // CANCELAMENTO IMEDIATO DE TRAVAS E ITENS NA FILA DAS MODALIDADES RECÉM-BLOQUEADAS
          try {
            const { data: projsBloqueados } = await supabase
              .from('projetos')
              .select('id_projeto')
              .in('id_modalidade', edit_modalidades_bloqueadas);

            if (projsBloqueados && projsBloqueados.length > 0) {
              const idsProjetosBloqueados = projsBloqueados.map((p: any) => p.id_projeto);

              // 1. Remove travas ativas do avaliador para projetos dessas modalidades
              await supabase
                .from('locks_ativos')
                .delete()
                .eq('id_usuario', usuario_em_edicao.id_usuario)
                .in('id_projeto', idsProjetosBloqueados);

              // 2. Remove da fila direcionada do avaliador
              await supabase
                .from('fila_atribuicoes_direcionadas')
                .delete()
                .eq('id_usuario', usuario_em_edicao.id_usuario)
                .in('id_projeto', idsProjetosBloqueados);
            }
          } catch (errExpurgo) {
            console.warn('Aviso ao expurgar locks de modalidade bloqueada:', errExpurgo);
          }
        }

        // Sincroniza áreas vinculadas (avaliador_areas)
        const { error: errDelAreas } = await supabase
          .from('avaliador_areas')
          .delete()
          .eq('id_usuario', usuario_em_edicao.id_usuario)
          .eq('id_evento', idEvt);

        if (errDelAreas) {
          console.warn('Aviso ao limpar áreas anteriores do avaliador:', errDelAreas.message);
        }

        if (edit_areas.length > 0) {
          const registrosAreas = edit_areas.map((idArea) => ({
            id_usuario: usuario_em_edicao.id_usuario,
            id_evento: idEvt,
            id_area: idArea,
          }));
          const { error: errInsAreas } = await supabase
            .from('avaliador_areas')
            .insert(registrosAreas);

          if (errInsAreas) {
            console.error('Erro ao persistir áreas do avaliador:', errInsAreas);
          }
        }
      }

      exibir_notificacao('Avaliador atualizado com sucesso!');
      set_modal_edicao_aberto(false);
      set_usuario_em_edicao(null);
      await carregar_avaliadores();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Exceção ao atualizar avaliador:', err);
      set_mensagem_erro('Falha ao atualizar dados do avaliador.');
    } finally {
      set_salvando_edicao(false);
    }
  };

  // LIGAÇÃO FUNCIONAL DO BOTÃO EXCLUIR
  const handleExcluir = async (id: string) => {
    if (!conexao_banco) {
      set_avaliadores((prev) => prev.filter((u) => u.id_usuario !== id));
      exibir_notificacao('Avaliador removido da lista (modo contingência).');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    const { error } = await supabase.from('usuarios').delete().eq('id_usuario', id);
    if (error) {
      alert(`Erro ao excluir: ${error.message} (Pode haver conflito de chave estrangeira)`);
    } else {
      set_avaliadores((prev) => prev.filter((u) => u.id_usuario !== id));
      exibir_notificacao('Avaliador excluído com sucesso!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    }
  };

  const handle_excluir_avaliador = (item: UsuarioAvaliador) => {
    if (window.confirm(`Tem certeza que deseja excluir o avaliador "${item.nome}" do sistema?`)) {
      handleExcluir(item.id_usuario);
    }
  };

  // Função para alterar papel de Avaliador se necessário
  const handle_remover_privilegio = async (id_usuario: string) => {
    if (!window.confirm('Deseja remover o privilégio e alterar este usuário?')) {
      return;
    }

    if (!conexao_banco) {
      set_avaliadores((prev) => prev.filter((a) => a.id_usuario !== id_usuario));
      exibir_notificacao('Papel alterado (modo contingência).');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    try {
      const { error } = await supabase
        .from('usuarios')
        .update({ papel: 'AVALIADOR' })
        .eq('id_usuario', id_usuario);

      if (error) {
        set_mensagem_erro(`Erro ao atualizar papel no banco: ${error.message}`);
      } else {
        exibir_notificacao('Papel atualizado com sucesso!');
        await carregar_avaliadores();
        if (aoAtualizarMetricas) aoAtualizarMetricas();
      }
    } catch (e: any) {
      console.error('Exceção ao remover privilégio:', e);
      set_mensagem_erro('Falha ao alterar papel do usuário.');
    }
  };

  // Alternar ordenação
  const alternarOrdenacao = (coluna: ColunaOrdenacaoAvaliador) => {
    if (colunaOrdenacao === coluna) {
      setOrdemAscendente(!ordemAscendente);
    } else {
      setColunaOrdenacao(coluna);
      setOrdemAscendente(true);
    }
  };

  const renderIconeOrdenacao = (coluna: ColunaOrdenacaoAvaliador) => {
    if (colunaOrdenacao !== coluna) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-40 hover:opacity-100 transition-opacity ml-1 inline-block shrink-0" />;
    }
    return ordemAscendente
      ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ml-1 inline-block shrink-0" />
      : <ArrowDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ml-1 inline-block shrink-0" />;
  };

  // Filtro na tabela
  const avaliadores_filtrados = avaliadores.filter((a) => {
    if (!termo_busca.trim()) return true;
    const t = termo_busca.toLowerCase();
    return (
      (a.nome && a.nome.toLowerCase().includes(t)) ||
      (a.email && a.email.toLowerCase().includes(t)) ||
      (a.nome_instituicao && a.nome_instituicao.toLowerCase().includes(t))
    );
  });

  // Lista Ordenada
  const avaliadores_ordenados = [...avaliadores_filtrados].sort((a, b) => {
    if (colunaOrdenacao === 'modalidades_bloqueadas') {
      const nomesA = (a.nomes_modalidades_bloqueadas || []).join(', ');
      const nomesB = (b.nomes_modalidades_bloqueadas || []).join(', ');
      if (!nomesA && !nomesB) return 0;
      if (!nomesA) return 1; // sem bloqueios agrupa no final
      if (!nomesB) return -1;
      const comp = nomesA.localeCompare(nomesB, 'pt-BR', { sensitivity: 'base' });
      return ordemAscendente ? comp : -comp;
    }

    if (colunaOrdenacao === 'nome_instituicao') {
      const instA = a.nome_instituicao || '';
      const instB = b.nome_instituicao || '';
      if (!instA && !instB) return 0;
      if (!instA) return 1;
      if (!instB) return -1;
      const comp = instA.localeCompare(instB, 'pt-BR', { sensitivity: 'base' });
      return ordemAscendente ? comp : -comp;
    }

    if (colunaOrdenacao === 'areas') {
      const areasA = (a.nomes_areas || []).join(', ');
      const areasB = (b.nomes_areas || []).join(', ');
      if (!areasA && !areasB) return 0;
      if (!areasA) return 1;
      if (!areasB) return -1;
      const comp = areasA.localeCompare(areasB, 'pt-BR', { sensitivity: 'base' });
      return ordemAscendente ? comp : -comp;
    }

    let valA: any = a[colunaOrdenacao as keyof UsuarioAvaliador];
    let valB: any = b[colunaOrdenacao as keyof UsuarioAvaliador];
    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';
    if (typeof valA === 'boolean') {
      const numA = valA ? 1 : 0;
      const numB = valB ? 1 : 0;
      return ordemAscendente ? numA - numB : numB - numA;
    }
    const comp = String(valA).localeCompare(String(valB), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return ordemAscendente ? comp : -comp;
  });

  const totalAvaliadoresCadastrados = avaliadores.length;
  const totalAvaliadoresCredenciados = avaliadores.filter((a) => Boolean(a.is_credenciado)).length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans w-full h-full overflow-y-auto">
      {/* Toast Notification */}
      {mensagem_notificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Alerta de erro */}
      {mensagem_erro && (
        <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl flex items-center justify-between gap-3 text-xs sm:text-sm text-red-800 dark:text-red-200 font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{mensagem_erro}</span>
          </div>
          <button
            type="button"
            onClick={() => set_mensagem_erro(null)}
            className="text-xs text-red-600 dark:text-red-300 underline font-bold"
          >
            Dispensar
          </button>
        </div>
      )}

      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-blue-100 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 shadow-xs">
            <Users className="w-5 h-5" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            Gestor de Avaliadores
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={input_file_ref}
            type="file"
            accept=".csv, .xlsx, .xls"
            className="hidden"
            disabled={processando_arquivo}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handle_upload_arquivo(e.target.files[0]);
              }
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={baixar_planilha_exemplo}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer"
            title="Baixar Planilha Modelo (.xlsx)"
          >
            <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Baixar Modelo (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={() => input_file_ref.current?.click()}
            disabled={processando_arquivo}
            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
            title="Importar (.xls/.xlsx/.csv)"
          >
            {processando_arquivo ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>{processando_arquivo ? 'Processando Planilha...' : 'Importar (.xls/.xlsx/.csv)'}</span>
          </button>

          <button
            type="button"
            onClick={() => set_mostrar_form_novo(!mostrar_form_novo)}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Novo Avaliador
          </button>

          <button
            type="button"
            onClick={carregar_avaliadores}
            disabled={carregando}
            title="Recarregar Lista"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          {ao_fechar && (
            <button
              type="button"
              onClick={ao_fechar}
              className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              title="Fechar Janela"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Console de Logs da Importação Direta (sem subtítulos) */}
      {(logsImportacao.length > 0 || processando_arquivo) && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2 animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-emerald-400">
              <Terminal className="w-4 h-4" />
              <span>Console de Logs da Importação</span>
            </div>
            {logsImportacao.length > 0 && !processando_arquivo && (
              <button
                type="button"
                onClick={() => setLogsImportacao([])}
                className="text-[11px] text-slate-400 hover:text-slate-200 underline cursor-pointer lowercase"
              >
                fechar console
              </button>
            )}
          </div>
          <div className="text-slate-200 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1">
            {logsImportacao.map((log, idx) => (
              <div
                key={idx}
                className={`leading-relaxed ${
                  log.tipo === 'success'
                    ? 'text-emerald-400'
                    : log.tipo === 'error'
                    ? 'text-red-400'
                    : 'text-slate-300'
                }`}
              >
                {log.tipo === 'success' && '✓ '}
                {log.tipo === 'error' && '✕ '}
                {log.tipo === 'info' && 'ℹ '}
                {log.mensagem}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulário Retrátil de Novo Avaliador */}
      {mostrar_form_novo && (
        <form
          onSubmit={handle_adicionar_manual}
          className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/60 p-4 sm:p-5 rounded-2xl space-y-4 animate-in fade-in"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Cadastrar Novo Avaliador
            </span>
            <button
              type="button"
              onClick={() => {
                set_mostrar_form_novo(false);
                set_novo_nome('');
                set_novo_email('');
                set_novo_instituicao_id('');
                set_novo_modalidades_bloqueadas([]);
                set_novo_areas([]);
              }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancelar
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              value={novo_nome}
              onChange={(e) => set_novo_nome(e.target.value)}
              placeholder="Nome do Avaliador"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <input
              type="email"
              value={novo_email}
              onChange={(e) => set_novo_email(e.target.value)}
              placeholder="E-mail do Avaliador"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <select
              value={novo_instituicao_id}
              onChange={(e) => set_novo_instituicao_id(e.target.value)}
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Instituição de Origem (Opcional)</option>
              {lista_instituicoes.map((inst) => (
                <option key={inst.id_instituicao} value={inst.id_instituicao}>
                  {inst.nome_exibicao} {inst.sigla ? `(${inst.sigla})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Bloqueio por Modalidade */}
          {lista_modalidades.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-blue-200/60 dark:border-blue-900/40">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <ShieldOff className="w-3.5 h-3.5 text-amber-500" />
                Bloqueio por Modalidade (este avaliador não avaliará projetos nestas modalidades):
              </span>
              <div className="flex flex-wrap gap-2">
                {lista_modalidades.map((m) => {
                  const checked = novo_modalidades_bloqueadas.includes(m.id_modalidade);
                  return (
                    <label
                      key={m.id_modalidade}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                        checked
                          ? 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            set_novo_modalidades_bloqueadas([...novo_modalidades_bloqueadas, m.id_modalidade]);
                          } else {
                            set_novo_modalidades_bloqueadas(novo_modalidades_bloqueadas.filter((id) => id !== m.id_modalidade));
                          }
                        }}
                        className="rounded text-red-600 focus:ring-red-500 w-3.5 h-3.5"
                      />
                      {m.nome_modalidade}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Áreas de Avaliação (Afinidade Temática) */}
          {lista_areas.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-blue-200/60 dark:border-blue-900/40">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Áreas de Avaliação (Afinidade temática - selecione as áreas de atuação do avaliador):
              </span>
              <div className="flex flex-wrap gap-2">
                {lista_areas.map((a) => {
                  const checked = novo_areas.includes(a.id_area);
                  return (
                    <label
                      key={a.id_area}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                        checked
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            set_novo_areas([...novo_areas, a.id_area]);
                          } else {
                            set_novo_areas(novo_areas.filter((id) => id !== a.id_area));
                          }
                        }}
                        className="rounded text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
                      />
                      {a.nome_area}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={salvando_manual || !novo_nome.trim() || !novo_email.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shrink-0 shadow-xs cursor-pointer"
            >
              {salvando_manual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Cadastrar Avaliador
            </button>
          </div>
        </form>
      )}

      {/* Barra de Busca e Contador */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Pesquisar por nome ou e-mail..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 self-end sm:self-center">
          Total: <strong className="text-slate-800 dark:text-slate-200">{avaliadores_filtrados.length}</strong> avaliadores (<span className="text-emerald-600 dark:text-emerald-400 font-bold">{totalAvaliadoresCredenciados} credenciados</span>)
        </span>
      </div>

        {carregando ? (
          <div className="p-12 text-center space-y-2 border border-slate-200 dark:border-slate-700 rounded-2xl">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500">Consultando avaliadores na base de dados...</p>
          </div>
        ) : avaliadores_filtrados.length === 0 ? (
          <div className="p-10 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Nenhum avaliador cadastrado localizado.</p>
            <p className="text-[11px] text-slate-400">Utilize o formulário de inclusão manual ou a importação por planilha acima.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                  <tr>
                    <th
                      onClick={() => alternarOrdenacao('is_credenciado')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por Credenciamento"
                    >
                      <div className="flex items-center gap-1">
                        <span>Credenciamento</span>
                        {renderIconeOrdenacao('is_credenciado')}
                      </div>
                    </th>
                    <th
                      onClick={() => alternarOrdenacao('nome')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por Nome"
                    >
                      <div className="flex items-center gap-1">
                        <span>Nome</span>
                        {renderIconeOrdenacao('nome')}
                      </div>
                    </th>
                    <th
                      onClick={() => alternarOrdenacao('nome_instituicao')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por Instituição"
                    >
                      <div className="flex items-center gap-1">
                        <span>Instituição</span>
                        {renderIconeOrdenacao('nome_instituicao')}
                      </div>
                    </th>
                    <th
                      onClick={() => alternarOrdenacao('email')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por E-mail"
                    >
                      <div className="flex items-center gap-1">
                        <span>E-mail</span>
                        {renderIconeOrdenacao('email')}
                      </div>
                    </th>
                    <th
                      onClick={() => alternarOrdenacao('modalidades_bloqueadas')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por Modalidades Bloqueadas"
                    >
                      <div className="flex items-center gap-1">
                        <span>Modalidades</span>
                        {renderIconeOrdenacao('modalidades_bloqueadas')}
                      </div>
                    </th>
                    <th
                      onClick={() => alternarOrdenacao('areas')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por Áreas"
                    >
                      <div className="flex items-center gap-1">
                        <span>Áreas</span>
                        {renderIconeOrdenacao('areas')}
                      </div>
                    </th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {avaliadores_ordenados.map((usuario) => {
                    const isProcessingThis = processando_credenciamento_id === usuario.id_usuario;

                    return (
                      <tr key={usuario.id_usuario} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        {/* Status de Credenciamento */}
                        <td className="px-4 py-3.5">
                          {usuario.is_credenciado === true ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              Credenciado
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              Pendente
                            </span>
                          )}
                        </td>

                        {/* Nome */}
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {usuario.nome}
                          </div>
                        </td>

                        {/* Instituição */}
                        <td className="px-4 py-3.5">
                          {usuario.nome_instituicao ? (
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                              <span>{usuario.nome_instituicao}</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                              Não informada
                            </span>
                          )}
                        </td>

                        {/* E-mail */}
                        <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-300">
                          {usuario.email}
                        </td>

                        {/* Modalidades (com botões de Bloquear/Liberar instantâneo) */}
                        <td className="px-4 py-3.5">
                          {lista_modalidades.length === 0 ? (
                            <span className="text-[11px] text-slate-400 italic">Nenhuma modalidade</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-w-sm">
                              {lista_modalidades.map((m) => {
                                const estaBloqueada = (usuario.modalidades_bloqueadas || []).includes(m.id_modalidade);
                                const chaveProc = `${usuario.id_usuario}_${m.id_modalidade}`;
                                const isProc = processando_modalidade_id === chaveProc;

                                return (
                                  <button
                                    key={m.id_modalidade}
                                    type="button"
                                    onClick={() => handle_toggle_modalidade_bloqueio(usuario, m)}
                                    disabled={isProc}
                                    title={
                                      estaBloqueada
                                        ? `Modalidade "${m.nome_modalidade}" está BLOQUEADA para este avaliador. Clique para LIBERAR.`
                                        : `Modalidade "${m.nome_modalidade}" está LIBERADA. Clique para BLOQUEAR para este avaliador.`
                                    }
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 select-none shadow-2xs ${
                                      estaBloqueada
                                        ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-300 dark:bg-red-950/60 dark:hover:bg-red-900/60 dark:text-red-300 dark:border-red-800'
                                        : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700'
                                    }`}
                                  >
                                    {isProc ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : estaBloqueada ? (
                                      <ShieldOff className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0" />
                                    ) : (
                                      <Shield className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
                                    )}
                                    <span>{estaBloqueada ? `Bloq: ${m.nome_modalidade}` : m.nome_modalidade}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </td>

                        {/* Áreas de Avaliação */}
                        <td className="px-4 py-3.5">
                          {usuario.nomes_areas && usuario.nomes_areas.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {usuario.nomes_areas.map((nomeArea, idx) => (
                                <span
                                  key={idx}
                                  className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-md inline-flex items-center gap-1 shadow-2xs"
                                >
                                  <Database className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                                  {nomeArea}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 italic">
                              Geral (todas as áreas)
                            </span>
                          )}
                        </td>

                        {/* Coluna Ações (Credenciar, Editar, Excluir) */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Botão Credenciar / Remover Credenciamento */}
                            <button
                              type="button"
                              onClick={() => handle_toggle_credenciamento(usuario)}
                              disabled={isProcessingThis}
                              title={usuario.is_credenciado ? 'Remover credenciamento do avaliador' : 'Credenciar avaliador no evento'}
                              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all inline-flex items-center gap-1.5 ${
                                usuario.is_credenciado
                                  ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600'
                              } disabled:opacity-50`}
                            >
                              {isProcessingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : usuario.is_credenciado ? (
                                <UserX className="w-3.5 h-3.5" />
                              ) : (
                                <UserCheck className="w-3.5 h-3.5" />
                              )}
                              <span>{usuario.is_credenciado ? 'Descredenciar' : 'Credenciar'}</span>
                            </button>

                            {/* Botão Editar */}
                            <button
                              type="button"
                              onClick={() => handle_abrir_edicao(usuario)}
                              title="Editar Avaliador"
                              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            {/* Botão Excluir */}
                            <button
                              type="button"
                              onClick={() => handleExcluir(usuario.id_usuario)}
                              title="Excluir Avaliador"
                              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* MODAL DE EDIÇÃO DE AVALIADOR */}
      {modal_edicao_aberto && usuario_em_edicao && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-emerald-600" />
                Editar Avaliador
              </h3>
              <button
                type="button"
                onClick={() => {
                  set_modal_edicao_aberto(false);
                  set_usuario_em_edicao(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handle_salvar_edicao} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nome Completo
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    value={usuario_em_edicao.nome}
                    onChange={(e) =>
                      set_usuario_em_edicao({ ...usuario_em_edicao, nome: e.target.value })
                    }
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Nome do avaliador"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Endereço de E-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="email"
                    value={usuario_em_edicao.email}
                    onChange={(e) =>
                      set_usuario_em_edicao({ ...usuario_em_edicao, email: e.target.value })
                    }
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="email@exemplo.com"
                    required
                  />
                </div>
              </div>

              {/* Instituição de Origem */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Instituição de Origem
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <select
                    value={edit_instituicao_id}
                    onChange={(e) => set_edit_instituicao_id(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione ou deixe em branco</option>
                    {lista_instituicoes.map((inst) => (
                      <option key={inst.id_instituicao} value={inst.id_instituicao}>
                        {inst.nome_exibicao} {inst.sigla ? `(${inst.sigla})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Modalidades Bloqueadas */}
              {lista_modalidades.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <ShieldOff className="w-3.5 h-3.5 text-amber-500" />
                    Modalidades Bloqueadas
                  </span>
                  <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900">
                    {lista_modalidades.map((m) => {
                      const checked = edit_modalidades_bloqueadas.includes(m.id_modalidade);
                      return (
                        <label
                          key={m.id_modalidade}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                            checked
                              ? 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                set_edit_modalidades_bloqueadas([...edit_modalidades_bloqueadas, m.id_modalidade]);
                              } else {
                                set_edit_modalidades_bloqueadas(edit_modalidades_bloqueadas.filter((id) => id !== m.id_modalidade));
                              }
                            }}
                            className="rounded text-red-600 focus:ring-red-500 w-3.5 h-3.5"
                          />
                          {m.nome_modalidade}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Áreas de Avaliação (Afinidade Temática) */}
              {lista_areas.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Áreas de Avaliação (Afinidade Temática)
                  </span>
                  <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900">
                    {lista_areas.map((a) => {
                      const checked = edit_areas.includes(a.id_area);
                      return (
                        <label
                          key={a.id_area}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                            checked
                              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                set_edit_areas([...edit_areas, a.id_area]);
                              } else {
                                set_edit_areas(edit_areas.filter((id) => id !== a.id_area));
                              }
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
                          />
                          {a.nome_area}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    set_modal_edicao_aberto(false);
                    set_usuario_em_edicao(null);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={salvando_edicao}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
                >
                  {salvando_edicao ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Salvar Alterações</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Rodapé com Fechamento se dentro de modal */}
      {ao_fechar && (
        <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-end">
          <button
            type="button"
            onClick={ao_fechar}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-all shadow-xs cursor-pointer"
          >
            Fechar Janela
          </button>
        </div>
      )}

      {/* MODAL DE DE-PARA (DE-DUPLICAÇÃO E VALIDAÇÃO) */}
      {modalDeParaAberto && (
        <ModalDeParaMapping
          itens={itensDePara}
          instituicoesExistentes={lista_instituicoes}
          modalidadesExistentes={lista_modalidades}
          areasExistentes={lista_areas}
          aoFechar={() => {
            setModalDeParaAberto(false);
            set_processando_arquivo(false);
          }}
          aoConfirmar={async (decisoes) => {
            setModalDeParaAberto(false);
            await executarGravacaoFinalAvaliadores(linhasArquivoPendente, decisoes);
          }}
        />
      )}
    </div>
  );
};
