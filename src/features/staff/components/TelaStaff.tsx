import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  XCircle,
  QrCode,
  Copy,
  UserCheck,
  UserX,
  Building,
  Building2,
  Sparkles,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Pencil,
  Smartphone,
  Shield,
  ShieldOff,
  Database,
  Clock,
  ExternalLink,
  X,
  Save
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { PainelAparelhoAvaliador } from './PainelAparelhoAvaliador';

export interface ProjetoStaff {
  id: string;
  id_projeto: string;
  codigo_projeto?: string | null;
  titulo: string;
  estande?: string | null;
  corredor?: string | null;
  expositores?: string | null;
  nome_instituicao?: string | null;
  id_instituicao?: string | null;
  is_check_in_realizado: boolean;
}

export interface AvaliadorStaff {
  id_usuario: string;
  nome: string;
  email: string;
  papel: string;
  is_credenciado: boolean;
  id_instituicao?: string | null;
  nome_instituicao?: string | null;
  modalidades_bloqueadas?: string[];
  nomes_modalidades_bloqueadas?: string[];
  areas?: string[];
  nomes_areas?: string[];
}

export interface InstituicaoRef {
  id_instituicao: string;
  nome_exibicao: string;
}

export interface ModalidadeRef {
  id_modalidade: string;
  nome_modalidade: string;
}

export interface AreaRef {
  id_area: string;
  nome_area: string;
}

type ColunaOrdenacaoExpositor =
  | 'corredor'
  | 'estande'
  | 'titulo'
  | 'nome_instituicao'
  | 'expositores'
  | 'is_check_in_realizado';

type ColunaOrdenacaoAvaliador =
  | 'is_credenciado'
  | 'nome'
  | 'nome_instituicao'
  | 'email'
  | 'modalidades_bloqueadas'
  | 'areas';

const dados_contingencia_projetos: ProjetoStaff[] = [
  {
    id: 'proj-1',
    id_projeto: 'proj-1',
    codigo_projeto: 'EXP-101',
    titulo: 'Dispositivo IoT para Monitoramento Agrícola',
    estande: 'E-01',
    corredor: 'Corredor A',
    expositores: 'Lucas Silva, Beatriz Santos',
    nome_instituicao: 'IFMS - Campus Corumbá',
    is_check_in_realizado: true,
  },
  {
    id: 'proj-2',
    id_projeto: 'proj-2',
    codigo_projeto: 'EXP-102',
    titulo: 'Automação Sustentável de Irrigação Solar',
    estande: 'E-02',
    corredor: 'Corredor A',
    expositores: 'Mariana Oliveira',
    nome_instituicao: 'UFMS',
    is_check_in_realizado: false,
  },
  {
    id: 'proj-3',
    id_projeto: 'proj-3',
    codigo_projeto: 'EXP-201',
    titulo: 'Aplicativo Educativo para Ensino de Matemática',
    estande: 'E-15',
    corredor: 'Corredor B',
    expositores: 'Gabriel Souza, Amanda Costa',
    nome_instituicao: 'Escola Estadual Maria Leite',
    is_check_in_realizado: false,
  },
];

const dados_contingencia_avaliadores: AvaliadorStaff[] = [
  {
    id_usuario: 'av-1',
    nome: 'Prof. Carlos Eduardo',
    email: 'carlos.eduardo@ifms.edu.br',
    papel: 'AVALIADOR',
    is_credenciado: true,
    id_instituicao: 'inst-1',
    nome_instituicao: 'IFMS - Campus Corumbá',
    modalidades_bloqueadas: [],
    nomes_modalidades_bloqueadas: [],
    areas: ['area-1', 'area-3'],
    nomes_areas: ['Ciências Exatas', 'Engenharias'],
  },
  {
    id_usuario: 'av-2',
    nome: 'Dra. Ana Paula Ferreira',
    email: 'ana.ferreira@ufms.br',
    papel: 'AVALIADOR',
    is_credenciado: false,
    id_instituicao: 'inst-2',
    nome_instituicao: 'UFMS',
    modalidades_bloqueadas: ['mod-1'],
    nomes_modalidades_bloqueadas: ['Ensino Médio'],
    areas: ['area-2'],
    nomes_areas: ['Biológicas e Saúde'],
  },
];

export const TelaStaff: React.FC = () => {
  // Controle de abas principais
  const [aba_ativa, set_aba_ativa] = useState<'expositores' | 'avaliadores'>('expositores');

  // Estados de dados
  const [projetos_lista, set_projetos_lista] = useState<ProjetoStaff[]>([]);
  const [avaliadores_lista, set_avaliadores_lista] = useState<AvaliadorStaff[]>([]);

  // Tabelas de referência
  const [lista_instituicoes, set_lista_instituicoes] = useState<InstituicaoRef[]>([]);
  const [lista_modalidades, set_lista_modalidades] = useState<ModalidadeRef[]>([]);
  const [lista_areas, set_lista_areas] = useState<AreaRef[]>([]);
  const [evento_ativo_id, set_evento_ativo_id] = useState<string>('');

  // Estados de carregamento e erros
  const [carregando_dados, set_carregando_dados] = useState<boolean>(true);
  const [mensagem_erro_banco, set_mensagem_erro_banco] = useState<string | null>(null);

  // Termos de busca
  const [termo_busca_expositores, set_termo_busca_expositores] = useState<string>('');
  const [termo_busca_avaliadores, set_termo_busca_avaliadores] = useState<string>('');

  // Filtros de status
  const [filtro_status_expositores, set_filtro_status_expositores] = useState<'todos' | 'checkin' | 'pendente'>('todos');
  const [filtro_status_avaliadores, set_filtro_status_avaliadores] = useState<'todos' | 'credenciado' | 'pendente'>('todos');

  // Ordenação de Expositores
  const [coluna_ordenacao_exp, set_coluna_ordenacao_exp] = useState<ColunaOrdenacaoExpositor>('estande');
  const [ordem_asc_exp, set_ordem_asc_exp] = useState<boolean>(true);

  // Ordenação de Avaliadores
  const [coluna_ordenacao_av, set_coluna_ordenacao_av] = useState<ColunaOrdenacaoAvaliador>('nome');
  const [ordem_asc_av, set_ordem_asc_av] = useState<boolean>(true);

  // Processamento individual
  const [processando_checkin_id, set_processando_checkin_id] = useState<string | null>(null);
  const [processando_credenciamento_id, set_processando_credenciamento_id] = useState<string | null>(null);
  const [processando_modalidade_id, set_processando_modalidade_id] = useState<string | null>(null);

  // Modal de Edição de Avaliador
  const [modal_edicao_aberto, set_modal_edicao_aberto] = useState<boolean>(false);
  const [usuario_em_edicao, set_usuario_em_edicao] = useState<{ id_usuario: string; nome: string; email: string } | null>(null);
  const [edit_instituicao_id, set_edit_instituicao_id] = useState<string>('');
  const [edit_modalidades_bloqueadas, set_edit_modalidades_bloqueadas] = useState<string[]>([]);
  const [edit_areas, set_edit_areas] = useState<string[]>([]);
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  // Notificações visuais
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [qr_copiado, set_qr_copiado] = useState<boolean>(false);

  const conexao_banco_configurada = verificar_conexao_configurada();

  // Vínculo do celular de cada avaliador (pareamento / código de acesso)
  const [aparelhos_vinculados, set_aparelhos_vinculados] = useState<Record<string, boolean>>({});
  const [avaliador_aparelho, set_avaliador_aparelho] = useState<{ id_usuario: string; nome: string } | null>(null);

  const carregar_situacao_aparelhos = async (id_evento: string) => {
    if (!conexao_banco_configurada || !id_evento) return;
    const { data, error } = await supabase.rpc('fn_situacao_vinculos', { p_id_evento: id_evento });
    if (error || !Array.isArray(data)) return;
    set_aparelhos_vinculados(
      Object.fromEntries(data.map((linha: { id_usuario: string; aparelho_vinculado: boolean }) => [linha.id_usuario, linha.aparelho_vinculado])),
    );
  };

  useEffect(() => {
    carregar_situacao_aparelhos(evento_ativo_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evento_ativo_id]);

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  // 1. Resolução do Evento Ativo e Carga Inicial
  const carregar_dados = async () => {
    set_carregando_dados(true);
    set_mensagem_erro_banco(null);

    if (!conexao_banco_configurada) {
      set_projetos_lista(dados_contingencia_projetos);
      set_avaliadores_lista(dados_contingencia_avaliadores);
      set_lista_instituicoes([
        { id_instituicao: 'inst-1', nome_exibicao: 'IFMS - Campus Corumbá' },
        { id_instituicao: 'inst-2', nome_exibicao: 'UFMS' },
        { id_instituicao: 'inst-3', nome_exibicao: 'Escola Estadual Maria Leite' },
      ]);
      set_lista_modalidades([
        { id_modalidade: 'mod-1', nome_modalidade: 'Ensino Médio' },
        { id_modalidade: 'mod-2', nome_modalidade: 'Ensino Superior' },
      ]);
      set_lista_areas([
        { id_area: 'area-1', nome_area: 'Ciências Exatas' },
        { id_area: 'area-2', nome_area: 'Biológicas e Saúde' },
        { id_area: 'area-3', nome_area: 'Engenharias' },
      ]);
      set_carregando_dados(false);
      return;
    }

    try {
      // 1. Identificar Evento Ativo: sempre o do banco (um id guardado neste navegador pode ser de outro evento)
      const { data: eventoDb, error: erroEvento } = await supabase
        .from('eventos')
        .select('id_evento')
        .eq('is_ativo', true)
        .limit(1)
        .maybeSingle();
      if (erroEvento) throw erroEvento;

      const idEvt: string = eventoDb?.id_evento || '';
      set_evento_ativo_id(idEvt);
      if (!idEvt) {
        set_projetos_lista([]);
        set_avaliadores_lista([]);
        set_mensagem_erro_banco('Não há evento ativo: peça ao Admin para ativar o evento.');
        set_carregando_dados(false);
        return;
      }
      localStorage.setItem('evento_ativo_id', idEvt);

      // 2. Buscar Tabelas de Referência
      let qInst: any = supabase.from('instituicoes').select('id_instituicao, nome_exibicao');
      let qMods: any = supabase.from('modalidades').select('id_modalidade, nome_modalidade');
      let qAreas: any = supabase.from('areas_tematicas').select('id_area, nome_area');

      if (idEvt) {
        qInst = qInst.eq('id_evento', idEvt);
        qMods = qMods.eq('id_evento', idEvt);
        qAreas = qAreas.eq('id_evento', idEvt);
      }

      const [resInst, resMods, resAreas] = await Promise.all([
        qInst.order('nome_exibicao', { ascending: true }),
        qMods.order('nome_modalidade', { ascending: true }),
        qAreas.order('nome_area', { ascending: true }),
      ]);

      const listaInst = (resInst.data as InstituicaoRef[]) || [];
      const listaMods = (resMods.data as ModalidadeRef[]) || [];
      const listaAr = (resAreas.data as AreaRef[]) || [];

      set_lista_instituicoes(listaInst);
      set_lista_modalidades(listaMods);
      set_lista_areas(listaAr);

      const mapaModalidades = new Map<string, string>();
      listaMods.forEach((m) => mapaModalidades.set(m.id_modalidade, m.nome_modalidade));

      const mapaAreas = new Map<string, string>();
      listaAr.forEach((a) => mapaAreas.set(a.id_area, a.nome_area));

      // 3. Buscar Projetos (com corredor, estande e expositores)
      let queryProjetos = supabase
        .from('projetos')
        .select('id_projeto, codigo_projeto, titulo, estande, corredor, expositores, is_check_in_realizado, id_instituicao, instituicoes(nome_exibicao)');

      if (idEvt) {
        queryProjetos = queryProjetos.eq('id_evento', idEvt);
      }

      const { data: dadosProjetos, error: erroProjetos } = await queryProjetos;

      if (erroProjetos) {
        console.error('Erro ao buscar projetos:', erroProjetos.message);
        set_mensagem_erro_banco(`Erro ao buscar projetos: ${erroProjetos.message}`);
      } else if (dadosProjetos) {
        const mapeados = dadosProjetos.map((p: any) => {
          const instObj = Array.isArray(p.instituicoes) ? p.instituicoes[0] : p.instituicoes;
          return {
            id: p.id_projeto,
            id_projeto: p.id_projeto,
            codigo_projeto: p.codigo_projeto || null,
            titulo: p.titulo || 'Projeto sem título',
            estande: p.estande || '-',
            corredor: p.corredor || '-',
            expositores: p.expositores || null,
            nome_instituicao: instObj?.nome_exibicao || null,
            id_instituicao: p.id_instituicao || null,
            is_check_in_realizado: Boolean(p.is_check_in_realizado),
          };
        });
        set_projetos_lista(mapeados);
      }

      // 4. Buscar Avaliadores (Usuários, Credenciamento, Bloqueios e Áreas)
      const { data: usersData, error: errUsers } = await supabase
        .from('usuarios')
        .select('id_usuario, nome, email, papel')
        .order('nome', { ascending: true });

      if (errUsers) throw errUsers;

      const avaliadoresUsers = (usersData || []).filter(
        (u) => (u.papel || '').toUpperCase() === 'AVALIADOR'
      );

      // Consulta avaliadores_evento
      let qAe = supabase
        .from('avaliadores_evento')
        .select('id_usuario, is_credenciado, id_evento, id_instituicao, instituicoes(nome_exibicao)');
      if (idEvt) qAe = qAe.eq('id_evento', idEvt);
      const { data: aeData } = await qAe;

      const aeMap = new Map<string, { is_credenciado: boolean; id_instituicao: string | null; nome_instituicao: string | null }>();
      (aeData || []).forEach((row: any) => {
        const instNome = Array.isArray(row.instituicoes)
          ? row.instituicoes[0]?.nome_exibicao
          : (row.instituicoes as any)?.nome_exibicao || null;
        aeMap.set(row.id_usuario, {
          is_credenciado: Boolean(row.is_credenciado),
          id_instituicao: row.id_instituicao || null,
          nome_instituicao: instNome,
        });
      });

      // Consulta modalidades bloqueadas
      let qBloq = supabase.from('avaliador_modalidades_bloqueadas').select('id_usuario, id_evento, id_modalidade');
      if (idEvt) qBloq = qBloq.eq('id_evento', idEvt);
      const { data: bloqData } = await qBloq;

      const bloqMap = new Map<string, string[]>();
      (bloqData || []).forEach((b: any) => {
        const arr = bloqMap.get(b.id_usuario) || [];
        arr.push(b.id_modalidade);
        bloqMap.set(b.id_usuario, arr);
      });

      // Consulta áreas temáticas
      let qAvAreas = supabase.from('avaliador_areas').select('id_usuario, id_evento, id_area');
      if (idEvt) qAvAreas = qAvAreas.eq('id_evento', idEvt);
      const { data: avAreasData } = await qAvAreas;

      const areasMap = new Map<string, string[]>();
      (avAreasData || []).forEach((a: any) => {
        const arr = areasMap.get(a.id_usuario) || [];
        arr.push(a.id_area);
        areasMap.set(a.id_usuario, arr);
      });

      // Unificação da lista de avaliadores
      const avaliadoresMapeados: AvaliadorStaff[] = avaliadoresUsers.map((u) => {
        const infoAe = aeMap.get(u.id_usuario);
        const modsIds = bloqMap.get(u.id_usuario) || [];
        const areasIds = areasMap.get(u.id_usuario) || [];

        return {
          id_usuario: u.id_usuario,
          nome: u.nome,
          email: u.email,
          papel: u.papel,
          is_credenciado: Boolean(infoAe?.is_credenciado),
          id_instituicao: infoAe?.id_instituicao || null,
          nome_instituicao: infoAe?.nome_instituicao || null,
          modalidades_bloqueadas: modsIds,
          nomes_modalidades_bloqueadas: modsIds.map((id) => mapaModalidades.get(id) || 'Modalidade'),
          areas: areasIds,
          nomes_areas: areasIds.map((id) => mapaAreas.get(id) || 'Área'),
        };
      });

      set_avaliadores_lista(avaliadoresMapeados);
    } catch (errGeral: any) {
      console.error('Falha ao sincronizar dados da feira:', errGeral);
      set_mensagem_erro_banco('Não foi possível carregar os dados em tempo real.');
    } finally {
      set_carregando_dados(false);
    }
  };

  useEffect(() => {
    carregar_dados();
  }, [conexao_banco_configurada]);

  // Alternar Check-in de Projeto (Expositores)
  const alternar_check_in_projeto = async (id_projeto: string, status_atual: boolean) => {
    const novo_status = !status_atual;
    set_processando_checkin_id(id_projeto);

    if (!conexao_banco_configurada) {
      set_projetos_lista((prev) =>
        prev.map((p) => (p.id_projeto === id_projeto ? { ...p, is_check_in_realizado: novo_status } : p))
      );
      exibir_notificacao(
        novo_status ? 'Check-in confirmado com sucesso!' : 'Check-in cancelado.'
      );
      set_processando_checkin_id(null);
      return;
    }

    try {
      // Check-in pelo RPC: a RLS não permite ao Staff alterar outras colunas de projetos
      const { error } = await supabase.rpc('fn_check_in_projeto', {
        p_id_projeto: id_projeto,
        p_check_in: novo_status,
      });

      if (error) {
        throw error;
      }

      set_projetos_lista((prev) =>
        prev.map((p) => (p.id_projeto === id_projeto ? { ...p, is_check_in_realizado: novo_status } : p))
      );

      exibir_notificacao(
        novo_status ? 'Check-in registrado com sucesso!' : 'Check-in cancelado.'
      );
    } catch (err: any) {
      console.error('Erro ao atualizar check-in:', err);
      exibir_notificacao('Não foi possível registrar o check-in.');
    } finally {
      set_processando_checkin_id(null);
    }
  };

  // Alternar Credenciamento do Avaliador
  const alternar_credenciamento_avaliador = async (id_usuario: string, status_atual: boolean) => {
    const novo_status = !status_atual;
    set_processando_credenciamento_id(id_usuario);

    if (!conexao_banco_configurada) {
      set_avaliadores_lista((prev) =>
        prev.map((a) => (a.id_usuario === id_usuario ? { ...a, is_credenciado: novo_status } : a))
      );
      exibir_notificacao(
        novo_status ? 'Avaliador credenciado e liberado!' : 'Credenciamento suspenso.'
      );
      set_processando_credenciamento_id(null);
      return;
    }

    try {
      const idEvt = evento_ativo_id;
      if (!idEvt) throw new Error('Evento ativo não selecionado.');

      const { error } = await supabase
        .from('avaliadores_evento')
        .upsert(
          {
            id_usuario,
            id_evento: idEvt,
            is_credenciado: novo_status,
          },
          { onConflict: 'id_usuario,id_evento' }
        );

      if (error) throw error;

      set_avaliadores_lista((prev) =>
        prev.map((a) => (a.id_usuario === id_usuario ? { ...a, is_credenciado: novo_status } : a))
      );

      exibir_notificacao(
        novo_status ? 'Avaliador credenciado e liberado!' : 'Credenciamento suspenso.'
      );
    } catch (err: any) {
      console.error('Erro ao atualizar credenciamento:', err);
      exibir_notificacao('Não foi possível atualizar o credenciamento.');
    } finally {
      set_processando_credenciamento_id(null);
    }
  };

  // Alternar Bloqueio de Modalidade
  const handle_toggle_modalidade_bloqueio = async (usuario: AvaliadorStaff, modalidade: ModalidadeRef) => {
    const chaveProc = `${usuario.id_usuario}_${modalidade.id_modalidade}`;
    set_processando_modalidade_id(chaveProc);

    const modalidadesAtuais = usuario.modalidades_bloqueadas || [];
    const estaBloqueada = modalidadesAtuais.includes(modalidade.id_modalidade);

    const novasModalidades = estaBloqueada
      ? modalidadesAtuais.filter((id) => id !== modalidade.id_modalidade)
      : [...modalidadesAtuais, modalidade.id_modalidade];

    const novosNomes = novasModalidades.map((id) => {
      const m = lista_modalidades.find((item) => item.id_modalidade === id);
      return m?.nome_modalidade || 'Modalidade';
    });

    // Atualização otimista
    set_avaliadores_lista((prev) =>
      prev.map((a) =>
        a.id_usuario === usuario.id_usuario
          ? {
              ...a,
              modalidades_bloqueadas: novasModalidades,
              nomes_modalidades_bloqueadas: novosNomes,
            }
          : a
      )
    );

    if (conexao_banco_configurada) {
      try {
        const idEvt = evento_ativo_id;
        if (!idEvt) throw new Error('Evento ativo não definido.');

        if (estaBloqueada) {
          // Desbloquear
          const { error } = await supabase
            .from('avaliador_modalidades_bloqueadas')
            .delete()
            .eq('id_usuario', usuario.id_usuario)
            .eq('id_evento', idEvt)
            .eq('id_modalidade', modalidade.id_modalidade);

          if (error) throw error;
          exibir_notificacao(`Modalidade "${modalidade.nome_modalidade}" liberada.`);
        } else {
          // Bloquear
          const { error } = await supabase
            .from('avaliador_modalidades_bloqueadas')
            .upsert(
              {
                id_usuario: usuario.id_usuario,
                id_evento: idEvt,
                id_modalidade: modalidade.id_modalidade,
              },
              { onConflict: 'id_usuario,id_evento,id_modalidade' }
            );

          if (error) throw error;

          // Expurgo de locks de avaliações pendentes
          try {
            const { data: projetosBloqueados } = await supabase
              .from('projetos')
              .select('id_projeto')
              .eq('id_modalidade', modalidade.id_modalidade);

            const idsProjetosBloqueados = (projetosBloqueados || []).map((p: any) => p.id_projeto);

            if (idsProjetosBloqueados.length > 0) {
              await supabase
                .from('avaliacoes')
                .delete()
                .eq('id_usuario', usuario.id_usuario)
                .is('nota_final', null)
                .in('id_projeto', idsProjetosBloqueados);

              await supabase
                .from('fila_atribuicoes_direcionadas')
                .delete()
                .eq('id_usuario', usuario.id_usuario)
                .in('id_projeto', idsProjetosBloqueados);
            }
          } catch (errExpurgo) {
            console.warn('Aviso no expurgo de locks:', errExpurgo);
          }

          exibir_notificacao(`Modalidade "${modalidade.nome_modalidade}" bloqueada.`);
        }
      } catch (errDb: any) {
        console.error('Erro ao alternar bloqueio de modalidade:', errDb);
        exibir_notificacao('Falha ao salvar bloqueio de modalidade.');
        await carregar_dados();
      }
    } else {
      exibir_notificacao(
        estaBloqueada
          ? `Modalidade "${modalidade.nome_modalidade}" liberada.`
          : `Modalidade "${modalidade.nome_modalidade}" bloqueada.`
      );
    }

    set_processando_modalidade_id(null);
  };

  // Abrir Modal de Edição (Apenas Lápis, sem lixeira)
  const handle_abrir_edicao = (item: AvaliadorStaff) => {
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

  // Salvar Edição de Avaliador
  const handle_salvar_edicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario_em_edicao) return;

    if (!usuario_em_edicao.nome.trim() || !usuario_em_edicao.email.trim()) {
      exibir_notificacao('Nome e E-mail não podem ficar vazios.');
      return;
    }

    set_salvando_edicao(true);
    const nomeAtualizado = usuario_em_edicao.nome.trim();
    const emailAtualizado = usuario_em_edicao.email.toLowerCase().trim();

    if (!conexao_banco_configurada) {
      const instObj = lista_instituicoes.find((i) => i.id_instituicao === edit_instituicao_id);
      const modNomes = edit_modalidades_bloqueadas.map((id) => {
        const m = lista_modalidades.find((mod) => mod.id_modalidade === id);
        return m?.nome_modalidade || 'Modalidade';
      });
      const areaNomes = edit_areas.map((id) => {
        const a = lista_areas.find((ar) => ar.id_area === id);
        return a?.nome_area || 'Área';
      });

      set_avaliadores_lista((prev) =>
        prev.map((a) =>
          a.id_usuario === usuario_em_edicao.id_usuario
            ? {
                ...a,
                nome: nomeAtualizado,
                email: emailAtualizado,
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
      exibir_notificacao('Avaliador atualizado com sucesso.');
      return;
    }

    try {
      const idEvt = evento_ativo_id;

      // 1. Atualizar usuários
      const { error: errUser } = await supabase
        .from('usuarios')
        .update({
          nome: nomeAtualizado,
          email: emailAtualizado,
        })
        .eq('id_usuario', usuario_em_edicao.id_usuario);

      if (errUser) throw errUser;

      // 2. Atualizar vínculo institucional
      if (idEvt) {
        await supabase
          .from('avaliadores_evento')
          .upsert(
            {
              id_usuario: usuario_em_edicao.id_usuario,
              id_evento: idEvt,
              id_instituicao: edit_instituicao_id || null,
            },
            { onConflict: 'id_usuario,id_evento' }
          );

        // 3. Atualizar modalidades bloqueadas
        await supabase
          .from('avaliador_modalidades_bloqueadas')
          .delete()
          .eq('id_usuario', usuario_em_edicao.id_usuario)
          .eq('id_evento', idEvt);

        if (edit_modalidades_bloqueadas.length > 0) {
          const registrosMods = edit_modalidades_bloqueadas.map((idMod) => ({
            id_usuario: usuario_em_edicao.id_usuario,
            id_evento: idEvt,
            id_modalidade: idMod,
          }));
          await supabase.from('avaliador_modalidades_bloqueadas').insert(registrosMods);
        }

        // 4. Atualizar áreas
        await supabase
          .from('avaliador_areas')
          .delete()
          .eq('id_usuario', usuario_em_edicao.id_usuario)
          .eq('id_evento', idEvt);

        if (edit_areas.length > 0) {
          const registrosAreas = edit_areas.map((idArea) => ({
            id_usuario: usuario_em_edicao.id_usuario,
            id_evento: idEvt,
            id_area: idArea,
          }));
          await supabase.from('avaliador_areas').insert(registrosAreas);
        }
      }

      await carregar_dados();
      set_modal_edicao_aberto(false);
      set_usuario_em_edicao(null);
      exibir_notificacao('Avaliador atualizado com sucesso.');
    } catch (err: any) {
      console.error('Erro ao atualizar avaliador:', err);
      exibir_notificacao('Não foi possível salvar as alterações.');
    } finally {
      set_salvando_edicao(false);
    }
  };

  // Link do QR Code Dinâmico
  const url_autocadastro = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const base = window.location.origin;
    const evtParam = evento_ativo_id ? `&evento=${evento_ativo_id}` : '';
    return `${base}/?cadastro=avaliador${evtParam}`;
  }, [evento_ativo_id]);

  const copiar_link_autocadastro = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(url_autocadastro);
    }
    set_qr_copiado(true);
    exibir_notificacao('Link copiado para a área de transferência.');
    setTimeout(() => set_qr_copiado(false), 2500);
  };

  // Alternância de Ordenação - Expositores
  const alternar_ordenacao_exp = (coluna: ColunaOrdenacaoExpositor) => {
    if (coluna_ordenacao_exp === coluna) {
      set_ordem_asc_exp(!ordem_asc_exp);
    } else {
      set_coluna_ordenacao_exp(coluna);
      set_ordem_asc_exp(true);
    }
  };

  // Alternância de Ordenação - Avaliadores
  const alternar_ordenacao_av = (coluna: ColunaOrdenacaoAvaliador) => {
    if (coluna_ordenacao_av === coluna) {
      set_ordem_asc_av(!ordem_asc_av);
    } else {
      set_coluna_ordenacao_av(coluna);
      set_ordem_asc_av(true);
    }
  };

  // Filtro e Ordenação de Expositores
  const projetos_processados = useMemo(() => {
    const termo = termo_busca_expositores.toLowerCase().trim();

    const filtrados = projetos_lista.filter((item) => {
      const atendeBusca =
        !termo ||
        (item.titulo || '').toLowerCase().includes(termo) ||
        (item.estande || '').toLowerCase().includes(termo) ||
        (item.corredor || '').toLowerCase().includes(termo) ||
        (item.nome_instituicao || '').toLowerCase().includes(termo) ||
        (item.expositores || '').toLowerCase().includes(termo);

      const atendeStatus =
        filtro_status_expositores === 'todos' ||
        (filtro_status_expositores === 'checkin' && item.is_check_in_realizado) ||
        (filtro_status_expositores === 'pendente' && !item.is_check_in_realizado);

      return atendeBusca && atendeStatus;
    });

    return [...filtrados].sort((a, b) => {
      let valA: string | number | boolean = '';
      let valB: string | number | boolean = '';

      switch (coluna_ordenacao_exp) {
        case 'corredor':
          valA = a.corredor || '';
          valB = b.corredor || '';
          break;
        case 'estande':
          valA = a.estande || '';
          valB = b.estande || '';
          break;
        case 'titulo':
          valA = a.titulo || '';
          valB = b.titulo || '';
          break;
        case 'nome_instituicao':
          valA = a.nome_instituicao || '';
          valB = b.nome_instituicao || '';
          break;
        case 'expositores':
          valA = a.expositores || '';
          valB = b.expositores || '';
          break;
        case 'is_check_in_realizado':
          valA = a.is_check_in_realizado ? 1 : 0;
          valB = b.is_check_in_realizado ? 1 : 0;
          break;
      }

      if (typeof valA === 'boolean' || typeof valA === 'number') {
        const diff = Number(valA) - Number(valB);
        return ordem_asc_exp ? diff : -diff;
      }

      const comp = String(valA).localeCompare(String(valB), 'pt-BR', { numeric: true });
      return ordem_asc_exp ? comp : -comp;
    });
  }, [projetos_lista, termo_busca_expositores, filtro_status_expositores, coluna_ordenacao_exp, ordem_asc_exp]);

  // Filtro e Ordenação de Avaliadores
  const avaliadores_processados = useMemo(() => {
    const termo = termo_busca_avaliadores.toLowerCase().trim();

    const filtrados = avaliadores_lista.filter((item) => {
      const atendeBusca =
        !termo ||
        item.nome.toLowerCase().includes(termo) ||
        item.email.toLowerCase().includes(termo) ||
        (item.nome_instituicao || '').toLowerCase().includes(termo) ||
        (item.nomes_areas || []).some((area) => area.toLowerCase().includes(termo));

      const atendeStatus =
        filtro_status_avaliadores === 'todos' ||
        (filtro_status_avaliadores === 'credenciado' && item.is_credenciado) ||
        (filtro_status_avaliadores === 'pendente' && !item.is_credenciado);

      return atendeBusca && atendeStatus;
    });

    return [...filtrados].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';

      switch (coluna_ordenacao_av) {
        case 'is_credenciado':
          valA = a.is_credenciado ? 1 : 0;
          valB = b.is_credenciado ? 1 : 0;
          break;
        case 'nome':
          valA = a.nome;
          valB = b.nome;
          break;
        case 'nome_instituicao':
          valA = a.nome_instituicao || '';
          valB = b.nome_instituicao || '';
          break;
        case 'email':
          valA = a.email;
          valB = b.email;
          break;
        case 'modalidades_bloqueadas':
          valA = (a.modalidades_bloqueadas || []).length;
          valB = (b.modalidades_bloqueadas || []).length;
          break;
        case 'areas':
          valA = (a.nomes_areas || []).join(', ');
          valB = (b.nomes_areas || []).join(', ');
          break;
      }

      if (typeof valA === 'number') {
        const diff = Number(valA) - Number(valB);
        return ordem_asc_av ? diff : -diff;
      }

      const comp = String(valA).localeCompare(String(valB), 'pt-BR', { numeric: true });
      return ordem_asc_av ? comp : -comp;
    });
  }, [avaliadores_lista, termo_busca_avaliadores, filtro_status_avaliadores, coluna_ordenacao_av, ordem_asc_av]);

  const total_projetos = projetos_lista.length;
  const total_checkins_expositores = projetos_lista.filter((p) => p.is_check_in_realizado).length;

  const total_avaliadores = avaliadores_lista.length;
  const total_avaliadores_credenciados = avaliadores_lista.filter((a) => a.is_credenciado).length;

  const renderIconeOrdenacaoExp = (coluna: ColunaOrdenacaoExpositor) => {
    if (coluna_ordenacao_exp !== coluna) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 opacity-60" />;
    }
    return ordem_asc_exp ? (
      <ArrowUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
    );
  };

  const renderIconeOrdenacaoAv = (coluna: ColunaOrdenacaoAvaliador) => {
    if (coluna_ordenacao_av !== coluna) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 opacity-60" />;
    }
    return ordem_asc_av ? (
      <ArrowUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
    );
  };

  return (
    <main className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 space-y-6 pb-16 font-sans">
      {/* Toast Notificação Flutuante */}
      {mensagem_notificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Alerta de Erro Visual */}
      {mensagem_erro_banco && (
        <div role="alert" className="bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-800 p-4 rounded-2xl flex items-center justify-between gap-3 text-red-800 dark:text-red-200 text-xs sm:text-sm font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <span>{mensagem_erro_banco}</span>
          </div>
          <button
            type="button"
            onClick={carregar_dados}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tentar Novamente
          </button>
        </div>
      )}

      {/* Cabeçalho da Tela de Staff - Padrão Limpo Semelhante ao Admin */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs tracking-wider uppercase mb-1">
            <UserCheck className="w-4 h-4" /> Módulo de Recepção & Credenciamento
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Painel da Equipe de Apoio
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={carregar_dados}
            disabled={carregando_dados}
            title="Recarregar Dados"
            className="p-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl transition-all border border-slate-200 dark:border-slate-600 shrink-0"
          >
            <RefreshCw className={`w-5 h-5 ${carregando_dados ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          <div className="grid grid-cols-2 gap-3 shrink-0">
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 p-3 rounded-xl text-center">
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 block">
                Expositores Presentes
              </span>
              <span className="text-xl font-bold text-emerald-800 dark:text-emerald-200">
                {total_checkins_expositores} <span className="text-xs text-slate-500 font-normal">/ {total_projetos}</span>
              </span>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 p-3 rounded-xl text-center">
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300 block">
                Avaliadores Liberados
              </span>
              <span className="text-xl font-bold text-blue-800 dark:text-blue-200">
                {total_avaliadores_credenciados} <span className="text-xs text-slate-500 font-normal">/ {total_avaliadores}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Abas de Navegação com Fonte Aumentada para Facilitar o Clique */}
      <div className="flex flex-col sm:flex-row gap-3 border-b border-slate-200 dark:border-slate-800 pb-1">
        <button
          type="button"
          onClick={() => set_aba_ativa('expositores')}
          className={`flex items-center justify-center gap-3 py-4 px-6 sm:px-8 font-extrabold text-base sm:text-lg lg:text-xl rounded-t-2xl transition-all border-b-4 cursor-pointer select-none ${
            aba_ativa === 'expositores'
              ? 'border-emerald-600 dark:border-emerald-500 bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/60'
          }`}
        >
          <span className="text-xl sm:text-2xl">🎪</span>
          <span>Credenciar Expositores</span>
        </button>

        <button
          type="button"
          onClick={() => set_aba_ativa('avaliadores')}
          className={`flex items-center justify-center gap-3 py-4 px-6 sm:px-8 font-extrabold text-base sm:text-lg lg:text-xl rounded-t-2xl transition-all border-b-4 cursor-pointer select-none ${
            aba_ativa === 'avaliadores'
              ? 'border-emerald-600 dark:border-emerald-500 bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/60'
          }`}
        >
          <span className="text-xl sm:text-2xl">🧑‍🏫</span>
          <span>Credenciar Avaliadores</span>
        </button>
      </div>

      {carregando_dados && (
        <div className="p-12 text-center space-y-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Carregando registros...
          </p>
        </div>
      )}

      {/* ABA 1: EXPOSITORES (TABELA COMPLETA COM CORREDOR, ESTANDE, EXPOSITORES E ORDENAÇÃO) */}
      {!carregando_dados && aba_ativa === 'expositores' && (
        <section className="space-y-4">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-96">
              <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={termo_busca_expositores}
                onChange={(e) => set_termo_busca_expositores(e.target.value)}
                placeholder="Buscar por corredor, estande, projeto ou expositor..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
              <span className="text-xs font-semibold text-slate-500 shrink-0">Filtrar:</span>
              <button
                type="button"
                onClick={() => set_filtro_status_expositores('todos')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filtro_status_expositores === 'todos'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-bold'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Todos ({total_projetos})
              </button>
              <button
                type="button"
                onClick={() => set_filtro_status_expositores('checkin')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filtro_status_expositores === 'checkin'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Presentes ({total_checkins_expositores})
              </button>
              <button
                type="button"
                onClick={() => set_filtro_status_expositores('pendente')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filtro_status_expositores === 'pendente'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Pendentes ({total_projetos - total_checkins_expositores})
              </button>
            </div>
          </div>

          {projetos_processados.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 p-10 rounded-2xl border text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Nenhum projeto localizado com os filtros aplicados.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[760px]">
                  <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider select-none">
                    <tr>
                      <th
                        onClick={() => alternar_ordenacao_exp('corredor')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Corredor"
                      >
                        <div className="flex items-center gap-1">
                          <span>Corredor</span>
                          {renderIconeOrdenacaoExp('corredor')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_exp('estande')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Estande"
                      >
                        <div className="flex items-center gap-1">
                          <span>Estande</span>
                          {renderIconeOrdenacaoExp('estande')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_exp('titulo')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Projeto"
                      >
                        <div className="flex items-center gap-1">
                          <span>Projeto</span>
                          {renderIconeOrdenacaoExp('titulo')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_exp('nome_instituicao')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Instituição"
                      >
                        <div className="flex items-center gap-1">
                          <span>Instituição</span>
                          {renderIconeOrdenacaoExp('nome_instituicao')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_exp('expositores')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Expositores"
                      >
                        <div className="flex items-center gap-1">
                          <span>Expositores</span>
                          {renderIconeOrdenacaoExp('expositores')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_exp('is_check_in_realizado')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-right"
                        title="Clique para ordenar por Check-in"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Check-in / Status</span>
                          {renderIconeOrdenacaoExp('is_check_in_realizado')}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                    {projetos_processados.map((item) => {
                      const isProc = processando_checkin_id === item.id_projeto;

                      return (
                        <tr
                          key={item.id_projeto}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${
                            item.is_check_in_realizado
                              ? 'bg-emerald-50/20 dark:bg-emerald-950/10'
                              : ''
                          }`}
                        >
                          {/* Corredor */}
                          <td className="px-4 py-3.5">
                            <span className="font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1">
                              {item.corredor || '-'}
                            </span>
                          </td>

                          {/* Estande */}
                          <td className="px-4 py-3.5">
                            <span className="px-2.5 py-1 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-mono text-xs font-bold rounded-lg tracking-wider">
                              {item.estande || '-'}
                            </span>
                          </td>

                          {/* Título do Projeto */}
                          <td className="px-4 py-3.5 max-w-xs sm:max-w-md">
                            <div className="font-bold text-slate-900 dark:text-white leading-snug">
                              {item.titulo}
                            </div>
                            {item.codigo_projeto && (
                              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                                {item.codigo_projeto}
                              </span>
                            )}
                          </td>

                          {/* Instituição */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                              <Building className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                              <span>{item.nome_instituicao || '-'}</span>
                            </div>
                          </td>

                          {/* Expositores */}
                          <td className="px-4 py-3.5 max-w-xs">
                            {item.expositores ? (
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {item.expositores}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">-</span>
                            )}
                          </td>

                          {/* Ação de Check-in */}
                          <td className="px-4 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => alternar_check_in_projeto(item.id_projeto, item.is_check_in_realizado)}
                              disabled={isProc}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                                item.is_check_in_realizado
                                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 border border-slate-300 dark:border-slate-600'
                                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                              }`}
                            >
                              {isProc ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : item.is_check_in_realizado ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span>Presente (Cancelar)</span>
                                </>
                              ) : (
                                <>
                                  <Clock className="w-3.5 h-3.5 text-white" />
                                  <span>Confirmar Check-in</span>
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ABA 2: AVALIADORES (SEMELHANTE AO GESTOR DE AVALIADORES DO ADMIN, SEM LIXEIRA) */}
      {!carregando_dados && aba_ativa === 'avaliadores' && (
        <section className="space-y-6">
          {/* Card do QR Code Dinâmico para Recepção - Padrão Fundo Branco */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 shadow-sm text-slate-900 dark:text-white">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
              <div className="space-y-3 text-center lg:text-left">
                <span className="px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold inline-block">
                  <Sparkles className="w-3.5 h-3.5 inline mr-1" /> Recepção & Credenciamento
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                  Autocadastro de Avaliadores no Celular
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
                  Apresente este QR Code para os avaliadores preencherem Nome, Instituição e Áreas de interesse diretamente do smartphone. Ao concluírem, eles aparecerão instantaneamente na lista abaixo para liberação presencial.
                </p>

                <div className="pt-2 flex flex-wrap gap-2.5 justify-center lg:justify-start">
                  <button
                    type="button"
                    onClick={copiar_link_autocadastro}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl text-xs sm:text-sm font-bold border border-slate-300 dark:border-slate-600 flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{qr_copiado ? 'Link Copiado!' : 'Copiar Link de Autocadastro'}</span>
                  </button>

                  <a
                    href={url_autocadastro}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all shadow-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Abrir Tela de Cadastro</span>
                  </a>
                </div>
              </div>

              {/* Renderizador de QR Code Real Escaneável com Moldura Harmonizada */}
              <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl shrink-0 text-center border border-slate-200 dark:border-slate-700 shadow-xs">
                {url_autocadastro ? (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url_autocadastro)}`}
                    alt="QR Code para Autocadastro de Avaliadores"
                    className="w-40 h-40 object-contain mx-auto rounded-xl bg-white p-2 shadow-2xs"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-40 h-40 bg-white dark:bg-slate-800 p-2 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700">
                    <QrCode className="w-20 h-20 text-emerald-600 dark:text-emerald-400" />
                  </div>
                )}
                <span className="text-[10px] text-slate-500 font-bold mt-2.5 block">
                  Aponte a câmera do celular
                </span>
              </div>
            </div>
          </div>

          {/* Barra de Filtros e Busca */}
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-96">
              <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={termo_busca_avaliadores}
                onChange={(e) => set_termo_busca_avaliadores(e.target.value)}
                placeholder="Buscar avaliador por nome, e-mail, instituição ou área..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
              <span className="text-xs font-semibold text-slate-500 shrink-0">Filtrar:</span>
              <button
                type="button"
                onClick={() => set_filtro_status_avaliadores('todos')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filtro_status_avaliadores === 'todos'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-bold'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Todos ({total_avaliadores})
              </button>
              <button
                type="button"
                onClick={() => set_filtro_status_avaliadores('credenciado')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filtro_status_avaliadores === 'credenciado'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Liberados ({total_avaliadores_credenciados})
              </button>
              <button
                type="button"
                onClick={() => set_filtro_status_avaliadores('pendente')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  filtro_status_avaliadores === 'pendente'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Aguardando ({total_avaliadores - total_avaliadores_credenciados})
              </button>
            </div>
          </div>

          {/* Tabela de Avaliadores no Padrão do Gestor do Admin (Sem Botão de Lixeira) */}
          {avaliadores_processados.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 p-10 rounded-2xl border text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Nenhum avaliador encontrado com os filtros aplicados.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[760px]">
                  <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider select-none">
                    <tr>
                      <th
                        onClick={() => alternar_ordenacao_av('is_credenciado')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Credenciamento"
                      >
                        <div className="flex items-center gap-1">
                          <span>Credenciamento</span>
                          {renderIconeOrdenacaoAv('is_credenciado')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_av('nome')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Nome"
                      >
                        <div className="flex items-center gap-1">
                          <span>Nome</span>
                          {renderIconeOrdenacaoAv('nome')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_av('nome_instituicao')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Instituição"
                      >
                        <div className="flex items-center gap-1">
                          <span>Instituição</span>
                          {renderIconeOrdenacaoAv('nome_instituicao')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_av('email')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por E-mail"
                      >
                        <div className="flex items-center gap-1">
                          <span>E-mail</span>
                          {renderIconeOrdenacaoAv('email')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_av('modalidades_bloqueadas')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Modalidades Bloqueadas"
                      >
                        <div className="flex items-center gap-1">
                          <span>Modalidades</span>
                          {renderIconeOrdenacaoAv('modalidades_bloqueadas')}
                        </div>
                      </th>

                      <th
                        onClick={() => alternar_ordenacao_av('areas')}
                        className="px-4 py-3.5 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clique para ordenar por Áreas"
                      >
                        <div className="flex items-center gap-1">
                          <span>Áreas</span>
                          {renderIconeOrdenacaoAv('areas')}
                        </div>
                      </th>

                      <th className="px-4 py-3.5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                    {avaliadores_processados.map((usuario) => {
                      const isProcCred = processando_credenciamento_id === usuario.id_usuario;

                      return (
                        <tr
                          key={usuario.id_usuario}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          {/* Status de Credenciamento */}
                          <td className="px-4 py-3.5">
                            {usuario.is_credenciado ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                Liberado
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800 inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-amber-500" />
                                Aguardando
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
                              <span className="text-[11px] text-slate-400 italic">
                                Não informada
                              </span>
                            )}
                          </td>

                          {/* E-mail */}
                          <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-300">
                            {usuario.email}
                          </td>

                          {/* Modalidades (com botões de Bloquear/Liberar) */}
                          <td className="px-4 py-3.5">
                            {lista_modalidades.length === 0 ? (
                              <span className="text-[11px] text-slate-400 italic">
                                Nenhuma modalidade
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 max-w-sm">
                                {lista_modalidades.map((m) => {
                                  const estaBloqueada = (usuario.modalidades_bloqueadas || []).includes(m.id_modalidade);
                                  const chaveProc = `${usuario.id_usuario}_${m.id_modalidade}`;
                                  const isProcMod = processando_modalidade_id === chaveProc;

                                  return (
                                    <button
                                      key={m.id_modalidade}
                                      type="button"
                                      onClick={() => handle_toggle_modalidade_bloqueio(usuario, m)}
                                      disabled={isProcMod}
                                      title={
                                        estaBloqueada
                                          ? `Modalidade "${m.nome_modalidade}" está BLOQUEADA. Clique para LIBERAR.`
                                          : `Modalidade "${m.nome_modalidade}" está LIBERADA. Clique para BLOQUEAR.`
                                      }
                                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 select-none shadow-2xs ${
                                        estaBloqueada
                                          ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-300 dark:bg-red-950/60 dark:hover:bg-red-900/60 dark:text-red-300 dark:border-red-800'
                                          : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700'
                                      }`}
                                    >
                                      {isProcMod ? (
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

                          {/* Ações (Credenciar e Editar - Sem Botão de Excluir / Lixeira) */}
                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* Botão Credenciar / Descredenciar */}
                              <button
                                type="button"
                                onClick={() => alternar_credenciamento_avaliador(usuario.id_usuario, usuario.is_credenciado)}
                                disabled={isProcCred}
                                title={usuario.is_credenciado ? 'Suspender credenciamento' : 'Credenciar e liberar acesso'}
                                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                                  usuario.is_credenciado
                                    ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                    : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 shadow-xs'
                                }`}
                              >
                                {isProcCred ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : usuario.is_credenciado ? (
                                  <UserX className="w-3.5 h-3.5" />
                                ) : (
                                  <UserCheck className="w-3.5 h-3.5" />
                                )}
                                <span>{usuario.is_credenciado ? 'Bloquear' : 'Credenciar'}</span>
                              </button>

                              {/* Botão Aparelho (pareamento / código de acesso) */}
                              <button
                                type="button"
                                onClick={() => set_avaliador_aparelho({ id_usuario: usuario.id_usuario, nome: usuario.nome })}
                                aria-label={`Aparelho de ${usuario.nome}`}
                                title={aparelhos_vinculados[usuario.id_usuario] ? 'Celular vinculado' : 'Parear celular'}
                                className={`px-2.5 py-1.5 rounded-lg font-bold text-xs inline-flex items-center gap-1 border cursor-pointer ${
                                  aparelhos_vinculados[usuario.id_usuario]
                                    ? 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800'
                                    : 'bg-white text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600'
                                }`}
                              >
                                <Smartphone aria-hidden="true" className="w-3.5 h-3.5" />
                                <span>{aparelhos_vinculados[usuario.id_usuario] ? 'Vinculado' : 'Parear'}</span>
                              </button>

                              {/* Botão Editar (Modal) */}
                              <button
                                type="button"
                                onClick={() => handle_abrir_edicao(usuario)}
                                aria-label={`Editar ${usuario.nome}`}
                                title="Editar Avaliador"
                                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
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
        </section>
      )}

      {/* MODAL DE EDIÇÃO DE AVALIADOR (SEM BOTÃO DE EXCLUSÃO) */}
      {avaliador_aparelho && (
        <PainelAparelhoAvaliador
          avaliador={avaliador_aparelho}
          aparelhoVinculado={Boolean(aparelhos_vinculados[avaliador_aparelho.id_usuario])}
          aoFechar={() => set_avaliador_aparelho(null)}
          aoAlterarVinculo={() => carregar_situacao_aparelhos(evento_ativo_id)}
        />
      )}

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
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handle_salvar_edicao} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nome Completo:
                </label>
                <input
                  type="text"
                  required
                  value={usuario_em_edicao.nome}
                  onChange={(e) =>
                    set_usuario_em_edicao({ ...usuario_em_edicao, nome: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  E-mail:
                </label>
                <input
                  type="email"
                  required
                  value={usuario_em_edicao.email}
                  onChange={(e) =>
                    set_usuario_em_edicao({ ...usuario_em_edicao, email: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Instituição:
                </label>
                <select
                  value={edit_instituicao_id}
                  onChange={(e) => set_edit_instituicao_id(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Não informada / Nenhuma</option>
                  {lista_instituicoes.map((inst) => (
                    <option key={inst.id_instituicao} value={inst.id_instituicao}>
                      {inst.nome_exibicao}
                    </option>
                  ))}
                </select>
              </div>

              {/* Modalidades Bloqueadas */}
              {lista_modalidades.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Modalidades Bloqueadas:
                  </label>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700">
                    {lista_modalidades.map((m) => {
                      const estaBloqueada = edit_modalidades_bloqueadas.includes(m.id_modalidade);
                      return (
                        <label
                          key={m.id_modalidade}
                          className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={estaBloqueada}
                            onChange={(e) => {
                              if (e.target.checked) {
                                set_edit_modalidades_bloqueadas([...edit_modalidades_bloqueadas, m.id_modalidade]);
                              } else {
                                set_edit_modalidades_bloqueadas(
                                  edit_modalidades_bloqueadas.filter((id) => id !== m.id_modalidade)
                                );
                              }
                            }}
                            className="rounded text-red-600 focus:ring-red-500"
                          />
                          <span className={estaBloqueada ? 'font-bold text-red-600 dark:text-red-400' : ''}>
                            {m.nome_modalidade}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Áreas Temáticas */}
              {lista_areas.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Áreas de Avaliação:
                  </label>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700">
                    {lista_areas.map((a) => {
                      const estaVinculada = edit_areas.includes(a.id_area);
                      return (
                        <label
                          key={a.id_area}
                          className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={estaVinculada}
                            onChange={(e) => {
                              if (e.target.checked) {
                                set_edit_areas([...edit_areas, a.id_area]);
                              } else {
                                set_edit_areas(edit_areas.filter((id) => id !== a.id_area));
                              }
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className={estaVinculada ? 'font-bold text-emerald-700 dark:text-emerald-400' : ''}>
                            {a.nome_area}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => {
                    set_modal_edicao_aberto(false);
                    set_usuario_em_edicao(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando_edicao}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {salvando_edicao ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Salvar Alterações</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};
