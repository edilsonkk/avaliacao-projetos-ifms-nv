import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FolderGit2,
  Search,
  Edit2,
  Trash2,
  X,
  Save,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  UploadCloud,
  FileSpreadsheet,
  Terminal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Download,
  Zap,
  Building2,
  Tag,
  Layers
} from 'lucide-react';
import { baixarPlanilhaModelo, validarArquivoPlanilha } from '@/lib/excel/excelUtils';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { parsePlanilhaProjetos } from '@/lib/parsers/planilhaProjetosParser';
import { ModalDeParaMapping, ItemMapeamentoDePara, DecisaoMapeamento } from '@/components/importacao/ModalDeParaMapping';
import { buscarMelhorCorrespondencia, CandidatoMatch } from '@/lib/parsers/fuzzyMatcher';
import { normalizarAreaTematica } from '@/lib/parsers/areasTematicasNormalizer';

export interface ProjetoItem {
  id_projeto: string;
  codigo_projeto?: string | null;
  titulo: string;
  estande: string | null;
  corredor: string | null;
  is_check_in_realizado?: boolean;
  id_evento?: string | null;
  id_instituicao?: string | null;
  id_area?: string | null;
  id_modalidade?: string | null;
  is_fora_da_competicao?: boolean;
  forcar_topo_fila?: boolean;
  instituicoes?: { id_instituicao?: string; nome_exibicao?: string; sigla?: string } | null;
  areas_tematicas?: { id_area?: string; nome_area?: string } | null;
  modalidades?: { id_modalidade?: string; nome_modalidade?: string } | null;
}

export interface InstituicaoRef {
  id_instituicao: string;
  nome_exibicao: string;
  sigla: string;
}

export interface AreaRef {
  id_area: string;
  nome_area: string;
}

export interface ModalidadeRef {
  id_modalidade: string;
  nome_modalidade: string;
}

interface GestorProjetosProps {
  aoFechar?: () => void;
  idProjetoEditarInicial?: string | null;
  aoAtualizarMetricas?: () => void;
  id_evento_ativo?: string;
}

export const GestorProjetos: React.FC<GestorProjetosProps> = ({
  aoFechar,
  idProjetoEditarInicial,
  aoAtualizarMetricas,
  id_evento_ativo
}) => {
  const [projetos, set_projetos] = useState<ProjetoItem[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [mensagem_sucesso, set_mensagem_sucesso] = useState<string | null>(null);
  const [processando_checkin_id, set_processando_checkin_id] = useState<string | null>(null);
  const [processando_topo_fila_id, set_processando_topo_fila_id] = useState<string | null>(null);

  // Tabelas de Referência
  const [lista_instituicoes, set_lista_instituicoes] = useState<InstituicaoRef[]>([]);
  const [lista_areas, set_lista_areas] = useState<AreaRef[]>([]);
  const [lista_modalidades, set_lista_modalidades] = useState<ModalidadeRef[]>([]);

  // Estados para Importação em Massa (Planilha -> Banco)
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [logs_importacao, set_logs_importacao] = useState<{ tipo: 'info' | 'success' | 'error'; mensagem: string }[]>([]);
  const input_arquivo_ref = useRef<HTMLInputElement | null>(null);

  // Estados para Validação e De-Duplicação De-Para
  const [modalDeParaAberto, setModalDeParaAberto] = useState<boolean>(false);
  const [itensDePara, setItensDePara] = useState<ItemMapeamentoDePara[]>([]);
  const [linhasArquivoPendente, setLinhasArquivoPendente] = useState<any[]>([]);

  // Estados para Criação Manual Retrátil de Novo Projeto
  const [mostrar_form_novo, set_mostrar_form_novo] = useState<boolean>(false);
  const [novo_codigo, set_novo_codigo] = useState<string>('');
  const [novo_titulo, set_novo_titulo] = useState<string>('');
  const [novo_estande, set_novo_estande] = useState<string>('');
  const [novo_corredor, set_novo_corredor] = useState<string>('');
  const [novo_instituicao_id, set_novo_instituicao_id] = useState<string>('');
  const [novo_area_id, set_novo_area_id] = useState<string>('');
  const [novo_modalidade_id, set_novo_modalidade_id] = useState<string>('');
  const [novo_fora_competicao, set_novo_fora_competicao] = useState<boolean>(false);
  const [salvando_novo, set_salvando_novo] = useState<boolean>(false);

  // Estado para formulário de edição
  const [projeto_em_edicao, set_projeto_em_edicao] = useState<ProjetoItem | null>(null);
  const [edit_titulo, set_edit_titulo] = useState<string>('');
  const [edit_estande, set_edit_estande] = useState<string>('');
  const [edit_corredor, set_edit_corredor] = useState<string>('');
  const [edit_instituicao_id, set_edit_instituicao_id] = useState<string>('');
  const [edit_area_id, set_edit_area_id] = useState<string>('');
  const [edit_modalidade_id, set_edit_modalidade_id] = useState<string>('');
  const [edit_fora_competicao, set_edit_fora_competicao] = useState<boolean>(false);
  const [salvando, set_salvando] = useState<boolean>(false);

  // Ordenação de colunas
  const [colunaOrdenacao, setColunaOrdenacao] = useState<'codigo' | 'corredor' | 'estande' | 'presenca' | 'titulo' | 'topo'>('codigo');
  const [direcaoOrdenacao, setDirecaoOrdenacao] = useState<'asc' | 'desc'>('asc');

  const conexao_banco = verificar_conexao_configurada();

  const obterEventoAtivoId = (): string | undefined => {
    if (id_evento_ativo) return id_evento_ativo;
    if (typeof window !== 'undefined') {
      const arm = localStorage.getItem('evento_ativo_id');
      if (arm && arm.trim()) return arm.trim();
    }
    return undefined;
  };

  const adicionarLog = (tipo: 'info' | 'success' | 'error', mensagem: string) => {
    set_logs_importacao((prev) => [...prev, { tipo, mensagem }]);
  };

  const exibir_sucesso = (msg: string) => {
    set_mensagem_sucesso(msg);
    setTimeout(() => {
      set_mensagem_sucesso(null);
    }, 4000);
  };

  // Carregar dados de referência (Instituições, Áreas, Modalidades) do evento ativo
  const carregar_dados_referencia = async () => {
    if (!conexao_banco) return;
    try {
      const idEvt = obterEventoAtivoId();

      let qInst: any = supabase.from('instituicoes').select('id_instituicao, nome_exibicao, sigla');
      let qAreas: any = supabase.from('areas_tematicas').select('id_area, nome_area');
      let qMods: any = supabase.from('modalidades').select('id_modalidade, nome_modalidade');

      if (idEvt) {
        if (typeof qInst.eq === 'function') qInst = qInst.eq('id_evento', idEvt);
        if (typeof qAreas.eq === 'function') qAreas = qAreas.eq('id_evento', idEvt);
        if (typeof qMods.eq === 'function') qMods = qMods.eq('id_evento', idEvt);
      }

      if (typeof qInst.order === 'function') qInst = qInst.order('nome_exibicao', { ascending: true });
      if (typeof qAreas.order === 'function') qAreas = qAreas.order('nome_area', { ascending: true });
      if (typeof qMods.order === 'function') qMods = qMods.order('nome_modalidade', { ascending: true });

      const [resInst, resAreas, resMods] = await Promise.all([qInst, qAreas, qMods]);

      if (resInst?.data) set_lista_instituicoes(resInst.data as InstituicaoRef[]);
      if (resAreas?.data) set_lista_areas(resAreas.data as AreaRef[]);
      if (resMods?.data) set_lista_modalidades(resMods.data as ModalidadeRef[]);
    } catch (err) {
      console.warn('Aviso ao carregar dados de referência para projetos:', err);
    }
  };

  // 1. CONSULTA DE PROJETOS COM MIGRAÇÃO RETROATIVA DE id_evento
  const carregar_projetos = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_projetos([]);
      set_carregando(false);
      return;
    }

    const idEvt = obterEventoAtivoId();

    try {
      // Migração retroativa: vincula projetos legados sem evento ao evento ativo atual
      if (idEvt) {
        try {
          const updateQuery: any = supabase.from('projetos').update({ id_evento: idEvt });
          if (typeof updateQuery?.is === 'function') {
            await updateQuery.is('id_evento', null);
          }
        } catch (migErr) {
          console.warn('Aviso na migração retroativa de id_evento:', migErr);
        }
      }

      await carregar_dados_referencia();

      // Consulta enriquecida com relações de FK
      const { data, error } = await supabase
        .from('projetos')
        .select(`
          id_projeto,
          codigo_projeto,
          titulo,
          estande,
          corredor,
          is_check_in_realizado,
          id_evento,
          id_instituicao,
          id_area,
          id_modalidade,
          is_fora_da_competicao,
          forcar_topo_fila,
          instituicoes ( id_instituicao, nome_exibicao, sigla ),
          areas_tematicas ( id_area, nome_area ),
          modalidades ( id_modalidade, nome_modalidade )
        `)
        .order('titulo', { ascending: true });

      if (error) {
        // Fallback de consulta simplificada se join falhar
        const { data: dataSimples, error: erroSimples } = await supabase
          .from('projetos')
          .select('id_projeto, codigo_projeto, titulo, estande, corredor, is_check_in_realizado, id_evento, id_instituicao, id_area, id_modalidade, is_fora_da_competicao, forcar_topo_fila')
          .order('titulo', { ascending: true });

        if (erroSimples) throw error;
        set_projetos((dataSimples as any) || []);
      } else {
        set_projetos((data as any) || []);
      }
    } catch (err: any) {
      console.error('Erro ao buscar projetos:', err);
      set_mensagem_erro(`Erro do Supabase (${err.code || '42703'}): ${err.message || 'Falha ao consultar projetos'}`);
      set_projetos([]);
    } finally {
      set_carregando(false);
    }
  };

  // Alterar check-in do projeto na tabela 'projetos'
  const alternar_check_in_projeto = async (id_projeto: string, status_atual: boolean) => {
    const novo_status_check_in = !status_atual;
    const id_alvo = id_projeto;
    set_processando_checkin_id(id_alvo);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_projetos((lista) =>
        lista.map((p) =>
          p.id_projeto === id_alvo
            ? { ...p, is_check_in_realizado: novo_status_check_in }
            : p
        )
      );
      set_mensagem_sucesso(
        novo_status_check_in
          ? 'Check-in realizado com sucesso! (Modo Contingência)'
          : 'Presença desmarcada com sucesso! (Modo Contingência)'
      );
      setTimeout(() => set_mensagem_sucesso(null), 3000);
      set_processando_checkin_id(null);
      return;
    }

    try {
      let erro_retornado: any = null;
      const { error: erro_projetos } = await supabase
        .from('projetos')
        .update({ is_check_in_realizado: novo_status_check_in })
        .eq('id_projeto', id_alvo);

      if (erro_projetos) {
        const { error: erro_singular } = await supabase
          .from('projeto')
          .update({ is_check_in_realizado: novo_status_check_in })
          .eq('id', id_alvo);

        erro_retornado = erro_singular;
      }

      if (erro_retornado) {
        console.error('Erro no Supabase ao atualizar check-in do projeto:', erro_retornado.message);
        set_mensagem_erro(`Falha ao atualizar check-in no banco: ${erro_retornado.message}`);
        return;
      }

      set_projetos((lista) =>
        lista.map((p) =>
          p.id_projeto === id_alvo
            ? { ...p, is_check_in_realizado: novo_status_check_in }
            : p
        )
      );

      exibir_sucesso(
        novo_status_check_in
          ? 'Check-in registrado no Supabase com sucesso!'
          : 'Presença desmarcada no Supabase com sucesso.'
      );
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (erro_excecao: any) {
      console.error('Falha de execução ao alternar check-in:', erro_excecao);
      set_mensagem_erro('Ocorreu uma falha na atualização de presença. Tente novamente.');
    } finally {
      set_processando_checkin_id(null);
    }
  };

  // Alternar Forçar Topo da Fila (Prioridade Máxima no Sorteio Automático)
  const alternar_forcar_topo_fila = async (id_projeto: string, status_atual: boolean) => {
    const novo_status = !status_atual;
    set_processando_topo_fila_id(id_projeto);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_projetos((lista) =>
        lista.map((p) =>
          p.id_projeto === id_projeto ? { ...p, forcar_topo_fila: novo_status } : p
        )
      );
      exibir_sucesso(
        novo_status
          ? '⚡ Projeto colocado no Topo da Fila! (Contingência)'
          : 'Prioridade removida do projeto. (Contingência)'
      );
      set_processando_topo_fila_id(null);
      return;
    }

    try {
      const { error } = await supabase
        .from('projetos')
        .update({ forcar_topo_fila: novo_status })
        .eq('id_projeto', id_projeto);

      if (error) throw error;

      set_projetos((lista) =>
        lista.map((p) =>
          p.id_projeto === id_projeto ? { ...p, forcar_topo_fila: novo_status } : p
        )
      );

      exibir_sucesso(
        novo_status
          ? '⚡ Projeto colocado no Topo da Fila com prioridade máxima de sorteio!'
          : 'Prioridade desativada. O projeto voltou à ordem natural de sorteio.'
      );
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao alternar topo da fila do projeto:', err);
      set_mensagem_erro(`Falha ao alterar prioridade: ${err?.message || 'Erro no banco'}`);
    } finally {
      set_processando_topo_fila_id(null);
    }
  };

  useEffect(() => {
    carregar_projetos();
  }, [id_evento_ativo]);

  // Abrir edição automaticamente se houver idProjetoEditarInicial
  useEffect(() => {
    if (idProjetoEditarInicial && projetos.length > 0) {
      const proj = projetos.find((p) => p.id_projeto === idProjetoEditarInicial);
      if (proj) {
        abrir_edicao(proj);
      }
    }
  }, [idProjetoEditarInicial, projetos]);

  const limpar_form_novo = () => {
    set_novo_codigo('');
    set_novo_titulo('');
    set_novo_estande('');
    set_novo_corredor('');
    set_novo_instituicao_id('');
    set_novo_area_id('');
    set_novo_modalidade_id('');
    set_novo_fora_competicao(false);
    set_mostrar_form_novo(false);
  };

  // Inclusão Manual de Novo Projeto com persistência de Evento, Instituição, Área, Modalidade e Fora da Competição
  const handle_adicionar_projeto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novo_titulo.trim()) {
      set_mensagem_erro('Informe pelo menos o Título do Projeto.');
      return;
    }

    set_salvando_novo(true);
    set_mensagem_erro(null);

    const idEvt = obterEventoAtivoId() || null;

    const payload: any = {
      codigo_projeto: novo_codigo.trim() || null,
      titulo: novo_titulo.trim(),
      estande: novo_estande.trim() || null,
      corredor: novo_corredor.trim() || null,
      id_evento: idEvt,
      id_instituicao: novo_instituicao_id || null,
      id_area: novo_area_id || null,
      id_modalidade: novo_modalidade_id || null,
      is_fora_da_competicao: novo_fora_competicao,
      forcar_topo_fila: false,
      is_check_in_realizado: false,
    };

    if (!conexao_banco) {
      const instObj = lista_instituicoes.find((i) => i.id_instituicao === novo_instituicao_id);
      const areaObj = lista_areas.find((a) => a.id_area === novo_area_id);
      const modObj = lista_modalidades.find((m) => m.id_modalidade === novo_modalidade_id);

      const novo_item: ProjetoItem = {
        id_projeto: crypto.randomUUID(),
        ...payload,
        instituicoes: instObj ? { id_instituicao: instObj.id_instituicao, nome_exibicao: instObj.nome_exibicao, sigla: instObj.sigla } : null,
        areas_tematicas: areaObj ? { id_area: areaObj.id_area, nome_area: areaObj.nome_area } : null,
        modalidades: modObj ? { id_modalidade: modObj.id_modalidade, nome_modalidade: modObj.nome_modalidade } : null,
      };
      set_projetos((prev) => [novo_item, ...prev]);
      limpar_form_novo();
      set_salvando_novo(false);
      exibir_sucesso('Projeto cadastrado com sucesso (modo contingência)!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    try {
      const { error } = await supabase
        .from('projetos')
        .insert([payload]);

      if (error) throw error;

      exibir_sucesso('Projeto cadastrado com sucesso!');
      limpar_form_novo();
      await carregar_projetos();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao cadastrar projeto:', err);
      set_mensagem_erro(`Falha ao cadastrar projeto: ${err?.message || 'Erro no banco'}`);
    } finally {
      set_salvando_novo(false);
    }
  };

  // Gerar e Baixar Modelo de Planilha (.xlsx) com colunas padrão e exemplos
  const baixar_planilha_exemplo = async () => {
    try {
      const dadosExemplo = [
        {
          codigo_projeto: 'PROJ-001',
          titulo: 'Desenvolvimento de Bioplástico a Partir de Casca de Mandioca',
          estande: 'EST-A01',
          corredor: 'Corredor A',
          instituicao: 'IFMS Campus Campo Grande',
          sigla_instituicao: 'IFMS-CG',
          area_tematica: 'Ciências Agrárias e Meio Ambiente',
          modalidade: 'Ensino Médio Integrado',
          fora_da_competicao: 'Não',
        },
        {
          codigo_projeto: 'PROJ-002',
          titulo: 'Sistema IoT de Monitoramento de Qualidade da Água em Piscicultura',
          estande: 'EST-A02',
          corredor: 'Corredor A',
          instituicao: 'IFMS Campus Aquidauana',
          sigla_instituicao: 'IFMS-AQ',
          area_tematica: 'Ciências Exatas e da Terra',
          modalidade: 'Ensino Técnico Subsequente',
          fora_da_competicao: 'Não',
        },
        {
          codigo_projeto: 'PROJ-003',
          titulo: 'Robô Seguidor de Linha para Demonstração Tecnológica',
          estande: 'EST-B01',
          corredor: 'Corredor B',
          instituicao: 'Escola Estadual Joaquim Murtinho',
          sigla_instituicao: 'EEJM',
          area_tematica: 'Engenharias e Robótica',
          modalidade: 'Ensino Fundamental',
          fora_da_competicao: 'Sim',
        },
      ];

      const colunas = [
        'codigo_projeto',
        'titulo',
        'estande',
        'corredor',
        'instituicao',
        'sigla_instituicao',
        'area_tematica',
        'modalidade',
        'fora_da_competicao',
      ];
      await baixarPlanilhaModelo('modelo_importacao_projetos.xlsx', 'Projetos', colunas, dadosExemplo);
      exibir_sucesso('Planilha modelo (.xlsx) gerada e baixada com sucesso!');
    } catch (err: any) {
      console.error('Erro ao gerar planilha de exemplo:', err);
      set_mensagem_erro('Falha ao baixar modelo de exemplo.');
    }
  };

  // Helper de normalização para casamento inteligente
  const normalizarTexto = (txt: string) =>
    txt
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  // Gravação final de projetos após De-Para ou casamento exato direto
  const executarGravacaoFinalProjetos = async (
    linhasParseadas: any[],
    decisoes: Map<string, DecisaoMapeamento>
  ) => {
    if (conexao_banco && !(await garantirSessaoAdmin())) return;
    set_processando_arquivo(true);
    try {
      const idEvt = obterEventoAtivoId() || null;
      adicionarLog('info', `Gravando projetos vinculados ao Evento Ativo: ${idEvt || 'Nenhum evento ativo selecionado'}`);

      // Caches de casamento inteligente
      const mapaInst = new Map<string, string>();
      lista_instituicoes.forEach((inst) => {
        if (inst.nome_exibicao) mapaInst.set(normalizarTexto(inst.nome_exibicao), inst.id_instituicao);
        if (inst.sigla) mapaInst.set(normalizarTexto(inst.sigla), inst.id_instituicao);
      });

      const mapaAreas = new Map<string, string>();
      lista_areas.forEach((a) => {
        if (a.nome_area) mapaAreas.set(normalizarTexto(a.nome_area), a.id_area);
      });

      const mapaModalidades = new Map<string, string>();
      lista_modalidades.forEach((m) => {
        if (m.nome_modalidade) mapaModalidades.set(normalizarTexto(m.nome_modalidade), m.id_modalidade);
      });

      // Aplica decisões de De-Para (vincular a existente ou cadastrar novo)
      for (const [termo, decisao] of decisoes.entries()) {
        if (decisao.tipo === 'instituicao') {
          if (decisao.acao === 'associar_existente' && decisao.id_destino) {
            mapaInst.set(normalizarTexto(termo), decisao.id_destino);
          } else if (decisao.acao === 'cadastrar_novo' || (decisao.acao as any) === 'criar_novo') {
            const nomeCriar = decisao.novo_nome?.trim() || termo.trim();
            const kCriar = normalizarTexto(nomeCriar);
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

                  // Fallback seguro caso o banco remoto ainda não tenha a coluna id_evento aplicada
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
                    mapaInst.set(normalizarTexto(termo), novaInst.id_instituicao);
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
                mapaInst.set(normalizarTexto(termo), fakeId);
                set_lista_instituicoes((prev) => [...prev, { id_instituicao: fakeId, nome_exibicao: nomeCriar, sigla: nomeCriar.substring(0, 10).toUpperCase(), id_evento: idEvt }]);
              }
            }
          }
        } else if (decisao.tipo === 'modalidade') {
          if (decisao.acao === 'associar_existente' && decisao.id_destino) {
            mapaModalidades.set(normalizarTexto(termo), decisao.id_destino);
          } else if (decisao.acao === 'cadastrar_novo' || (decisao.acao as any) === 'criar_novo') {
            const nomeCriar = decisao.novo_nome?.trim() || termo.trim();
            const kCriar = normalizarTexto(nomeCriar);
            if (!mapaModalidades.has(kCriar)) {
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

                  // Fallback seguro caso o banco remoto ainda não tenha a coluna id_evento aplicada
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
                    mapaModalidades.set(kCriar, novaMod.id_modalidade);
                    mapaModalidades.set(normalizarTexto(termo), novaMod.id_modalidade);
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
                mapaModalidades.set(kCriar, fakeId);
                mapaModalidades.set(normalizarTexto(termo), fakeId);
                set_lista_modalidades((prev) => [...prev, { id_modalidade: fakeId, nome_modalidade: nomeCriar, id_evento: idEvt }]);
              }
            }
          }
        }
      }

      const mapaProjetos = new Map<string, any>();
      const projetosSemCodigo: Array<any> = [];

      for (const linha of linhasParseadas) {
        const numLinha = linha.linha_original;
        const codigo_extraido = linha.codigo_projeto || '';
        const titulo_extraido = linha.titulo;
        const estande_extraido = linha.estande || '';
        const corredor_extraido = linha.corredor || '';
        const instituicao_extraida = linha.instituicao || '';
        const sigla_extraida = linha.sigla_instituicao || '';
        const area_extraida = linha.area_tematica || '';
        const modalidade_extraida = linha.modalidade || '';
        const isFora = linha.fora_da_competicao;

        // 1. Resolução de Instituição (mapa ou auto-cadastro único sem duplicar)
        let id_inst_resolvido: string | null = null;
        if (instituicao_extraida || sigla_extraida) {
          const kNome = normalizarTexto(instituicao_extraida);
          const kSigla = normalizarTexto(sigla_extraida);
          if (kNome && mapaInst.has(kNome)) {
            id_inst_resolvido = mapaInst.get(kNome)!;
          } else if (kSigla && mapaInst.has(kSigla)) {
            id_inst_resolvido = mapaInst.get(kSigla)!;
          } else if (instituicao_extraida.trim()) {
            // Auto-cadastro seguro da instituição: cadastra uma única vez no lote
            const nomeCriar = instituicao_extraida.trim();
            const chaveCriar = normalizarTexto(nomeCriar);
            if (mapaInst.has(chaveCriar)) {
              id_inst_resolvido = mapaInst.get(chaveCriar)!;
            } else if (conexao_banco) {
              try {
                const siglaCriar = sigla_extraida ? sigla_extraida.trim().toUpperCase() : null;
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

                // Fallback caso o banco remoto ainda não tenha a coluna id_evento aplicada
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
                  id_inst_resolvido = novaInst.id_instituicao;
                  mapaInst.set(chaveCriar, novaInst.id_instituicao);
                  if (siglaCriar) mapaInst.set(normalizarTexto(siglaCriar), novaInst.id_instituicao);
                  set_lista_instituicoes((prev) => [...prev, novaInst]);
                  adicionarLog('info', `Linha ${numLinha}: Instituição auto-cadastrada no evento: "${nomeCriar}".`);
                }
              } catch (eInst) {
                console.warn('Erro ao auto-cadastrar instituição:', eInst);
              }
            } else {
              const fakeId = crypto.randomUUID();
              id_inst_resolvido = fakeId;
              mapaInst.set(chaveCriar, fakeId);
              if (sigla_extraida) mapaInst.set(normalizarTexto(sigla_extraida), fakeId);
              set_lista_instituicoes((prev) => [...prev, { id_instituicao: fakeId, nome_exibicao: nomeCriar, sigla: sigla_extraida || null, id_evento: idEvt }]);
            }
          }
        }

        // 2. Resolução de Área Temática com padronização CNPq / Maiúsculo
        let id_area_resolvida: string | null = null;
        if (area_extraida) {
          const nomeAreaPadronizada = normalizarAreaTematica(area_extraida);
          const kArea = normalizarTexto(nomeAreaPadronizada);
          const kAreaOrig = normalizarTexto(area_extraida);

          if (mapaAreas.has(kArea)) {
            id_area_resolvida = mapaAreas.get(kArea)!;
          } else if (mapaAreas.has(kAreaOrig)) {
            id_area_resolvida = mapaAreas.get(kAreaOrig)!;
          } else if (conexao_banco) {
            try {
              const payloadArea: any = { nome_area: nomeAreaPadronizada };
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
                id_area_resolvida = novaArea.id_area;
                mapaAreas.set(kArea, novaArea.id_area);
                mapaAreas.set(kAreaOrig, novaArea.id_area);
                set_lista_areas((prev) => [...prev, novaArea]);
                adicionarLog('info', `Linha ${numLinha}: Área Temática padronizada e cadastrada no evento: "${nomeAreaPadronizada}".`);
              } else if (errArea) {
                console.warn('Erro ao cadastrar área temática:', errArea);
              }
            } catch (eArea) {
              console.warn('Erro ao auto-cadastrar área temática:', eArea);
            }
          } else {
            const fakeId = crypto.randomUUID();
            id_area_resolvida = fakeId;
            mapaAreas.set(kArea, fakeId);
            mapaAreas.set(kAreaOrig, fakeId);
            set_lista_areas((prev) => [...prev, { id_area: fakeId, nome_area: nomeAreaPadronizada, id_evento: idEvt }]);
          }
        }

        // 3. Resolução de Modalidade
        let id_mod_resolvida: string | null = null;
        if (modalidade_extraida) {
          const kMod = normalizarTexto(modalidade_extraida);
          if (mapaModalidades.has(kMod)) {
            id_mod_resolvida = mapaModalidades.get(kMod)!;
          }
        }

        const payload = {
          codigo_projeto: codigo_extraido || null,
          titulo: titulo_extraido || 'Projeto Sem Título',
          estande: estande_extraido || null,
          corredor: corredor_extraido || null,
          id_evento: idEvt,
          id_instituicao: id_inst_resolvido,
          id_area: id_area_resolvida,
          id_modalidade: id_mod_resolvida,
          is_fora_da_competicao: isFora,
          forcar_topo_fila: false,
        };

        if (payload.codigo_projeto) {
          mapaProjetos.set(payload.codigo_projeto, payload);
        } else {
          projetosSemCodigo.push(payload);
        }

        adicionarLog(
          'info',
          `Linha ${numLinha}: "${payload.titulo}" (${payload.codigo_projeto || 'Sem Cód.'}) | Evento: ${idEvt ? 'OK' : 'N/A'} | Inst: ${id_inst_resolvido ? 'OK' : '-'} | Área: ${id_area_resolvida ? 'OK' : '-'} | Mod: ${id_mod_resolvida ? 'OK' : '-'} | Fora: ${isFora ? 'Sim' : 'Não'}`
        );
      }

      const projetosFormatados: any[] = [];
      mapaProjetos.forEach((p) => projetosFormatados.push(p));
      projetosSemCodigo.forEach((p) => projetosFormatados.push(p));

      if (projetosFormatados.length === 0) {
        adicionarLog('error', 'Nenhum projeto válido encontrado para importação.');
        set_mensagem_erro('Nenhum projeto válido encontrado para importação.');
        set_processando_arquivo(false);
        return;
      }

      adicionarLog('info', `Consolidando ${projetosFormatados.length} projetos para envio via UPSERT...`);

      if (conexao_banco) {
        try {
          const { error } = await supabase
            .from('projetos')
            .upsert(projetosFormatados, { onConflict: 'codigo_projeto' });

          if (error) {
            console.error('Erro no upsert de projetos:', error);
            const msgErro = tratarErroEscritaAdmin(error);
            adicionarLog('error', `Erro no banco ao realizar UPSERT: ${msgErro}`);
            set_mensagem_erro(`Erro ao importar projetos: ${msgErro}`);
          } else {
            adicionarLog('success', `UPSERT concluído com sucesso! ${projetosFormatados.length} projetos cadastrados/atualizados com evento e referências.`);
            exibir_sucesso(`Importação concluída: ${projetosFormatados.length} projetos cadastrados/atualizados com sucesso!`);
            await carregar_projetos();
            if (aoAtualizarMetricas) aoAtualizarMetricas();
          }
        } catch (errUpsert: any) {
          console.error('Exceção no upsert de projetos:', errUpsert);
          adicionarLog('error', `Erro inesperado no upsert: ${errUpsert?.message || errUpsert}`);
          set_mensagem_erro(`Erro inesperado: ${errUpsert?.message || errUpsert}`);
        }
      } else {
        const novosItens: ProjetoItem[] = projetosFormatados.map((p) => ({
          id_projeto: crypto.randomUUID(),
          ...p,
          instituicoes: lista_instituicoes.find((i) => i.id_instituicao === p.id_instituicao) || null,
          areas_tematicas: lista_areas.find((a) => a.id_area === p.id_area) || null,
          modalidades: lista_modalidades.find((m) => m.id_modalidade === p.id_modalidade) || null,
        }));

        set_projetos((prev) => {
          const mapa = new Map<string, ProjetoItem>();
          prev.forEach((p) => {
            if (p.codigo_projeto) mapa.set(p.codigo_projeto, p);
            else mapa.set(p.id_projeto, p);
          });
          novosItens.forEach((p) => {
            if (p.codigo_projeto) mapa.set(p.codigo_projeto, p);
            else mapa.set(p.id_projeto, p);
          });
          return Array.from(mapa.values());
        });

        adicionarLog('success', `[Modo Contingência] ${projetosFormatados.length} projetos inseridos/atualizados.`);
        exibir_sucesso(`Importação concluída: ${projetosFormatados.length} projetos processados!`);
        if (aoAtualizarMetricas) aoAtualizarMetricas();
      }
    } catch (errGeral: any) {
      console.error('Erro geral ao gravar projetos:', errGeral);
      set_mensagem_erro('Erro ao gravar projetos no sistema.');
    } finally {
      set_processando_arquivo(false);
    }
  };

  // MAPEAMENTO NA IMPORTAÇÃO EM MASSA (Planilha -> Banco com Auto-cadastro de Referências)
  const handle_upload_planilha_projetos = async (file: File) => {
    set_processando_arquivo(true);
    set_mensagem_erro(null);
    set_logs_importacao([]);

    const validacao = validarArquivoPlanilha(file);
    if (!validacao.valido) {
      adicionarLog('error', validacao.erro || 'Arquivo inválido.');
      set_mensagem_erro(validacao.erro || 'Arquivo inválido.');
      set_processando_arquivo(false);
      return;
    }

    adicionarLog('info', `Iniciando leitura da planilha: ${file.name}`);

    try {
      const isCSV = validacao.isCSV;
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          if (!e.target?.result) {
            adicionarLog('error', 'Falha ao ler o arquivo selecionado.');
            set_processando_arquivo(false);
            return;
          }

          const { projetos: linhasParseadas, total_lido, avisos } = await parsePlanilhaProjetos(
            isCSV ? (e.target.result as string) : (e.target.result as ArrayBuffer),
            isCSV
          );

          avisos.forEach((aviso) => adicionarLog('info', aviso));
          adicionarLog('info', `Planilha lida com sucesso! ${total_lido} linhas para processamento.`);

          const idEvt = obterEventoAtivoId() || null;
          adicionarLog('info', `Vinculando projetos ao Evento Ativo: ${idEvt || 'Nenhum evento ativo selecionado'}`);

          // 1. Prepara candidatos com seus aliases
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

          linhasParseadas.forEach((l) => {
            const instTermo = l.instituicao?.trim() || l.sigla_instituicao?.trim();
            if (instTermo) termosInst.add(instTermo);
            const modTermo = l.modalidade?.trim();
            if (modTermo) termosMod.add(modTermo);
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

          setLinhasArquivoPendente(linhasParseadas);

          if (precisaDePara && itensParaDePara.length > 0) {
            adicionarLog('info', 'Identificados termos novos ou com similaridade. Abrindo tela de validação De-Para...');
            setItensDePara(itensParaDePara);
            setModalDeParaAberto(true);
            set_processando_arquivo(false);
          } else {
            // Todos os termos são 100% exatos ou já mapeados por aliases
            await executarGravacaoFinalProjetos(linhasParseadas, new Map());
          }
        } catch (errProcessamento: any) {
          console.error('Erro ao processar dados da planilha:', errProcessamento);
          adicionarLog('error', `Falha no processamento: ${errProcessamento?.message || errProcessamento}`);
          set_mensagem_erro('Erro ao analisar os dados da planilha.');
          set_processando_arquivo(false);
        }
      };

      if (isCSV) {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    } catch (errUpload: any) {
      console.error('Falha ao abrir arquivo:', errUpload);
      adicionarLog('error', `Falha ao carregar arquivo: ${errUpload?.message || errUpload}`);
      set_mensagem_erro('Falha ao ler arquivo do computador.');
      set_processando_arquivo(false);
    }
  };

  const abrir_edicao = (projeto: ProjetoItem) => {
    set_projeto_em_edicao(projeto);
    set_edit_titulo(projeto.titulo || '');
    set_edit_estande(projeto.estande || '');
    set_edit_corredor(projeto.corredor || '');
    set_edit_instituicao_id(projeto.id_instituicao || '');
    set_edit_area_id(projeto.id_area || '');
    set_edit_modalidade_id(projeto.id_modalidade || '');
    set_edit_fora_competicao(Boolean(projeto.is_fora_da_competicao));
  };

  const fechar_edicao = () => {
    set_projeto_em_edicao(null);
    set_edit_titulo('');
    set_edit_estande('');
    set_edit_corredor('');
    set_edit_instituicao_id('');
    set_edit_area_id('');
    set_edit_modalidade_id('');
    set_edit_fora_competicao(false);
  };

  // 2. SALVAR/EDITAR COM INSTITUIÇÃO, ÁREA, MODALIDADE E FORA DA COMPETIÇÃO
  const salvar_edicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projeto_em_edicao) return;

    set_salvando(true);
    set_mensagem_erro(null);
    set_mensagem_sucesso(null);

    const idProjetoEditado = projeto_em_edicao.id_projeto;

    const dadosAtualizacao: any = {
      titulo: edit_titulo.trim(),
      estande: edit_estande.trim() || null,
      corredor: edit_corredor.trim() || null,
      id_instituicao: edit_instituicao_id || null,
      id_area: edit_area_id || null,
      id_modalidade: edit_modalidade_id || null,
      is_fora_da_competicao: edit_fora_competicao,
    };

    try {
      if (conexao_banco && idProjetoEditado) {
        const { error } = await supabase
          .from('projetos')
          .update(dadosAtualizacao)
          .eq('id_projeto', idProjetoEditado);

        if (error) throw error;
      }

      const instObj = lista_instituicoes.find((i) => i.id_instituicao === edit_instituicao_id);
      const areaObj = lista_areas.find((a) => a.id_area === edit_area_id);
      const modObj = lista_modalidades.find((m) => m.id_modalidade === edit_modalidade_id);

      // Atualização Reativa no State local imediato
      set_projetos((prev) =>
        prev.map((p) => {
          if (p.id_projeto === idProjetoEditado) {
            return {
              ...p,
              ...dadosAtualizacao,
              instituicoes: instObj ? { id_instituicao: instObj.id_instituicao, nome_exibicao: instObj.nome_exibicao, sigla: instObj.sigla } : null,
              areas_tematicas: areaObj ? { id_area: areaObj.id_area, nome_area: areaObj.nome_area } : null,
              modalidades: modObj ? { id_modalidade: modObj.id_modalidade, nome_modalidade: modObj.nome_modalidade } : null,
            };
          }
          return p;
        })
      );

      exibir_sucesso('Projeto atualizado com sucesso no Supabase!');
      fechar_edicao();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao atualizar projeto:', err);
      set_mensagem_erro(`Erro ao salvar alterações: ${err.message || err}`);
    } finally {
      set_salvando(false);
    }
  };

  // 3. EXCLUIR PASSANDO id_projeto COM CONFIRMAÇÃO, TRATAMENTO DE FK E ATUALIZAÇÃO REATIVA
  const excluir_projeto = async (projeto: ProjetoItem) => {
    const idDoProjeto = projeto.id_projeto;
    const nomeExibicao = projeto.titulo || projeto.codigo_projeto || 'Projeto';

    const confirmado = window.confirm(
      `Tem certeza de que deseja excluir o projeto "${nomeExibicao}"?\nEsta ação é irreversível.`
    );
    if (!confirmado) return;

    set_mensagem_erro(null);
    set_mensagem_sucesso(null);

    try {
      if (conexao_banco && idDoProjeto) {
        const { error } = await supabase
          .from('projetos')
          .delete()
          .eq('id_projeto', idDoProjeto);

        if (error) {
          const isFkError =
            error.code === '23503' ||
            error.message?.toLowerCase().includes('foreign key') ||
            error.message?.toLowerCase().includes('violates') ||
            error.message?.toLowerCase().includes('avaliacoes') ||
            error.message?.toLowerCase().includes('locks_ativos');

          if (isFkError) {
            const msgFk = 'Não é possível excluir este projeto pois ele já possui avaliações associadas no banco de dados.';
            alert(msgFk);
            set_mensagem_erro(msgFk);
            return;
          } else {
            const msgErr = `Erro do Supabase ao excluir: ${error.message}`;
            alert(msgErr);
            set_mensagem_erro(msgErr);
            return;
          }
        }
      }

      // Atualização Reativa no State local imediato
      set_projetos((prev) => prev.filter((p) => p.id_projeto !== idDoProjeto));
      exibir_sucesso('Projeto excluído com sucesso do Supabase!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao excluir projeto:', err);
      const msgExc = `Exceção ao excluir projeto: ${err.message || err}`;
      alert(msgExc);
      set_mensagem_erro(msgExc);
    }
  };

  const alternarOrdenacao = (coluna: 'codigo' | 'corredor' | 'estande' | 'presenca' | 'titulo' | 'topo') => {
    if (colunaOrdenacao === coluna) {
      setDirecaoOrdenacao((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setColunaOrdenacao(coluna);
      setDirecaoOrdenacao('asc');
    }
  };

  const projetos_filtrados = projetos.filter((p) => {
    if (!termo_busca.trim()) return true;
    const t = termo_busca.toLowerCase().trim();
    const codigo = (p.codigo_projeto || '').toLowerCase();
    const titulo = (p.titulo || '').toLowerCase();
    const estande = (p.estande || '').toLowerCase();
    const corredor = (p.corredor || '').toLowerCase();
    const instituicao = (p.instituicoes?.nome_exibicao || p.instituicoes?.sigla || '').toLowerCase();
    const area = (p.areas_tematicas?.nome_area || '').toLowerCase();
    const modalidade = (p.modalidades?.nome_modalidade || '').toLowerCase();
    return (
      codigo.includes(t) ||
      titulo.includes(t) ||
      estande.includes(t) ||
      corredor.includes(t) ||
      instituicao.includes(t) ||
      area.includes(t) ||
      modalidade.includes(t)
    );
  });

  const projetos_ordenados = useMemo(() => {
    return [...projetos_filtrados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      if (colunaOrdenacao === 'codigo') {
        valA = a.codigo_projeto || '';
        valB = b.codigo_projeto || '';
      } else if (colunaOrdenacao === 'corredor') {
        valA = a.corredor || '';
        valB = b.corredor || '';
      } else if (colunaOrdenacao === 'estande') {
        valA = a.estande || '';
        valB = b.estande || '';
      } else if (colunaOrdenacao === 'presenca') {
        valA = a.is_check_in_realizado ? 1 : 0;
        valB = b.is_check_in_realizado ? 1 : 0;
      } else if (colunaOrdenacao === 'titulo') {
        valA = a.titulo || '';
        valB = b.titulo || '';
      } else if (colunaOrdenacao === 'topo') {
        valA = a.forcar_topo_fila ? 1 : 0;
        valB = b.forcar_topo_fila ? 1 : 0;
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return direcaoOrdenacao === 'asc' ? valA - valB : valB - valA;
      }
      return direcaoOrdenacao === 'asc'
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }, [projetos_filtrados, colunaOrdenacao, direcaoOrdenacao]);

  const totalProjetosCadastrados = projetos.length;
  const totalProjetosCredenciados = projetos.filter((p) => Boolean(p.is_check_in_realizado)).length;
  const totalTopoFila = projetos.filter((p) => Boolean(p.forcar_topo_fila)).length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans w-full h-full overflow-y-auto">
      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 shadow-xs">
            <FolderGit2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              Gestor de Projetos
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Botão Baixar Modelo (.xlsx) */}
          <button
            type="button"
            onClick={baixar_planilha_exemplo}
            className="px-3.5 py-2 rounded-xl font-bold text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 flex items-center gap-2 shadow-xs cursor-pointer transition-all"
            title="Baixar Modelo de Planilha de Importação (.xlsx)"
          >
            <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Baixar Modelo (.xlsx)</span>
          </button>

          {/* Botão Direto de Importação de Planilha */}
          <input
            ref={input_arquivo_ref}
            type="file"
            accept=".csv, .xlsx"
            className="hidden"
            id="input-planilha-projetos"
            disabled={processando_arquivo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handle_upload_planilha_projetos(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => input_arquivo_ref.current?.click()}
            disabled={processando_arquivo}
            className="px-3.5 py-2 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white flex items-center gap-2 shadow-xs cursor-pointer transition-all disabled:opacity-60"
            title="Importar (.xlsx/.csv)"
          >
            {processando_arquivo ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>{processando_arquivo ? 'Processando Planilha...' : 'Importar (.xlsx/.csv)'}</span>
          </button>

          <button
            type="button"
            onClick={() => set_mostrar_form_novo(!mostrar_form_novo)}
            className="px-3.5 py-2 rounded-xl font-bold text-xs bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 flex items-center gap-2 shadow-xs cursor-pointer transition-all"
            title={mostrar_form_novo ? 'Cancelar Inclusão' : 'Novo Projeto'}
          >
            <Plus className={`w-4 h-4 transition-transform duration-200 ${mostrar_form_novo ? 'rotate-45' : ''}`} />
            <span>Novo Projeto</span>
          </button>

          <button
            type="button"
            onClick={carregar_projetos}
            disabled={carregando}
            title="Recarregar Lista"
            aria-label="Recarregar Lista"
            className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-600 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              title="Fechar Janela"
              aria-label="Fechar Janela"
              className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Console de Logs da Importação Direta (retrátil) */}
      {(logs_importacao.length > 0 || processando_arquivo) && (
        <div className="bg-gray-900 text-green-400 p-4 rounded-xl max-h-48 overflow-y-auto font-mono text-xs space-y-1.5 border border-slate-800 shadow-inner">
          <div className="flex items-center justify-between pb-1 border-b border-gray-800 mb-2">
            <div className="flex items-center gap-2 text-slate-400 font-sans text-[10px] font-bold uppercase tracking-wider">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Console de Logs da Importação</span>
            </div>
            {logs_importacao.length > 0 && !processando_arquivo && (
              <button
                type="button"
                onClick={() => set_logs_importacao([])}
                className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                Limpar Logs
              </button>
            )}
          </div>
          {logs_importacao.map((log, idx) => (
            <div
              key={idx}
              className={`leading-relaxed flex items-start gap-1.5 ${
                log.tipo === 'error'
                  ? 'text-red-400'
                  : log.tipo === 'success'
                  ? 'text-emerald-400'
                  : 'text-cyan-300'
              }`}
            >
              <span className="opacity-50 shrink-0">&gt;</span>
              <span>{log.mensagem}</span>
            </div>
          ))}
        </div>
      )}

      {/* Formulário Retrátil de Novo Projeto com Campos Completos */}
      {mostrar_form_novo && (
        <form
          onSubmit={handle_adicionar_projeto}
          className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-3 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-600" />
            <span>Cadastrar Novo Projeto no Evento Ativo</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="novo_codigo_input" className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                Código do Projeto
              </label>
              <input
                id="novo_codigo_input"
                type="text"
                value={novo_codigo}
                onChange={(e) => set_novo_codigo(e.target.value)}
                placeholder="Ex: FETEC-001"
                className="w-full px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="novo_titulo_input" className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                Título do Projeto *
              </label>
              <input
                id="novo_titulo_input"
                type="text"
                value={novo_titulo}
                onChange={(e) => set_novo_titulo(e.target.value)}
                placeholder="Título completo do projeto *"
                className="w-full px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="novo_estande_input" className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Estande
                </label>
                <input
                  id="novo_estande_input"
                  type="text"
                  value={novo_estande}
                  onChange={(e) => set_novo_estande(e.target.value)}
                  placeholder="Ex: EST-A01"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label htmlFor="novo_corredor_input" className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Corredor
                </label>
                <input
                  id="novo_corredor_input"
                  type="text"
                  value={novo_corredor}
                  onChange={(e) => set_novo_corredor(e.target.value)}
                  placeholder="Ex: A"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Segunda Linha: Instituição, Área, Modalidade e Fora da Competição */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
            <div>
              <label htmlFor="novo_instituicao_select" className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                Instituição
              </label>
              <select
                id="novo_instituicao_select"
                value={novo_instituicao_id}
                onChange={(e) => set_novo_instituicao_id(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">(Selecione a Instituição)</option>
                {lista_instituicoes.map((inst) => (
                  <option key={inst.id_instituicao} value={inst.id_instituicao}>
                    {inst.sigla ? `[${inst.sigla}] ` : ''}{inst.nome_exibicao}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="novo_area_select" className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                Área Temática
              </label>
              <select
                id="novo_area_select"
                value={novo_area_id}
                onChange={(e) => set_novo_area_id(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">(Selecione a Área)</option>
                {lista_areas.map((area) => (
                  <option key={area.id_area} value={area.id_area}>
                    {area.nome_area}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="novo_modalidade_select" className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                Modalidade
              </label>
              <select
                id="novo_modalidade_select"
                value={novo_modalidade_id}
                onChange={(e) => set_novo_modalidade_id(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">(Selecione a Modalidade)</option>
                {lista_modalidades.map((mod) => (
                  <option key={mod.id_modalidade} value={mod.id_modalidade}>
                    {mod.nome_modalidade}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center sm:items-end pb-1">
              <label htmlFor="novo_fora_competicao_check" className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-700 dark:text-slate-300 font-semibold p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <input
                  id="novo_fora_competicao_check"
                  type="checkbox"
                  checked={novo_fora_competicao}
                  onChange={(e) => set_novo_fora_competicao(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-slate-600"
                />
                <span>Fora da Competição</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={limpar_form_novo}
              className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando_novo || !novo_titulo.trim()}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-98 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              {salvando_novo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Cadastrar Projeto</span>
            </button>
          </div>
        </form>
      )}

      {/* Alertas */}
      {mensagem_erro && (
        <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
            <span className="font-semibold">{mensagem_erro}</span>
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

      {mensagem_sucesso && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="font-semibold">{mensagem_sucesso}</span>
        </div>
      )}

      {/* Barra de Busca e Contador */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Buscar por código, título, estande, instituição ou área..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400 self-end sm:self-center">
          {totalTopoFila > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
              <Zap className="w-3 h-3 text-amber-600 fill-amber-600" />
              {totalTopoFila} no Topo da Fila
            </span>
          )}
          <span>
            Total: <strong className="text-slate-800 dark:text-slate-200">{projetos_filtrados.length}</strong> projetos (
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{totalProjetosCredenciados} credenciados</span>)
          </span>
        </div>
      </div>

      {/* Tabela de Projetos: Exibe CÓDIGO (codigo_projeto), Corredor, Estande, Título com Metadados e Ações */}
      <div className="flex-1 overflow-y-auto p-6">
        {carregando ? (
          <div className="p-12 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Carregando projetos do Supabase...
            </p>
          </div>
        ) : projetos_ordenados.length === 0 ? (
          <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
            <FileText className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Nenhum projeto localizado.
            </p>
            <p className="text-[11px] text-slate-400">
              {termo_busca ? 'Tente ajustar os termos de pesquisa.' : 'Nenhum registro encontrado na tabela projetos do banco.'}
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-slate-800 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <th
                    onClick={() => alternarOrdenacao('codigo')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>CÓDIGO</span>
                      {colunaOrdenacao === 'codigo' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => alternarOrdenacao('corredor')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Corredor</span>
                      {colunaOrdenacao === 'corredor' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => alternarOrdenacao('estande')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Estande</span>
                      {colunaOrdenacao === 'estande' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => alternarOrdenacao('presenca')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Presença</span>
                      {colunaOrdenacao === 'presenca' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => alternarOrdenacao('titulo')}
                    className="px-4 py-3 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Título & Metadados</span>
                      {colunaOrdenacao === 'titulo' ? (
                        direcaoOrdenacao === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right">Ações (Check-in, Topo da Fila & CRUD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {projetos_ordenados.map((p) => {
                  const idProj = p.id_projeto;
                  const codigoProj = p.codigo_projeto || 'N/I';
                  const tituloProj = p.titulo;
                  const estandeProj = p.estande || '-';
                  const corredorProj = p.corredor || '-';
                  const isCheckin = Boolean(p.is_check_in_realizado);
                  const isProcessingThis = processando_checkin_id === idProj;
                  const isProcessingTopo = processando_topo_fila_id === idProj;
                  const isTopoFila = Boolean(p.forcar_topo_fila);
                  const isForaComp = Boolean(p.is_fora_da_competicao);

                  const nomeInst = p.instituicoes?.sigla || p.instituicoes?.nome_exibicao;
                  const nomeArea = p.areas_tematicas?.nome_area;
                  const nomeMod = p.modalidades?.nome_modalidade;

                  return (
                    <tr
                      key={idProj}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                        isTopoFila ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
                      }`}
                    >
                      {/* BLINDAGEM VISUAL: Exibe codigo_projeto em vez de UUID */}
                      <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {codigoProj}
                      </td>
                      <td className="px-4 py-3 font-semibold text-teal-600 dark:text-teal-400 whitespace-nowrap">
                        {corredorProj}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {estandeProj}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            isCheckin
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {isCheckin ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Presente
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 text-slate-400" /> Pendente
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <div className="font-bold text-slate-900 dark:text-white leading-snug">
                          {tituloProj}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {nomeInst && (
                            <span
                              title={`Instituição: ${p.instituicoes?.nome_exibicao || nomeInst}`}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700"
                            >
                              <Building2 className="w-2.5 h-2.5 text-blue-500" />
                              {nomeInst}
                            </span>
                          )}
                          {nomeArea && (
                            <span
                              title={`Área Temática: ${nomeArea}`}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800"
                            >
                              <Tag className="w-2.5 h-2.5 text-indigo-500" />
                              {nomeArea}
                            </span>
                          )}
                          {nomeMod && (
                            <span
                              title={`Modalidade: ${nomeMod}`}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800"
                            >
                              <Layers className="w-2.5 h-2.5 text-purple-500" />
                              {nomeMod}
                            </span>
                          )}
                          {isForaComp && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-800">
                              Fora da Competição
                            </span>
                          )}
                          {isTopoFila && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-700 animate-pulse">
                              <Zap className="w-2.5 h-2.5 text-amber-600 fill-amber-600" />
                              Topo da Fila
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                        {/* Botão Check-in / Desmarcar Presença */}
                        <button
                          type="button"
                          onClick={() => alternar_check_in_projeto(idProj, isCheckin)}
                          disabled={isProcessingThis}
                          title={isCheckin ? 'Desmarcar presença do projeto' : 'Confirmar check-in presencial'}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs border transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                            isCheckin
                              ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 shadow-xs'
                          }`}
                        >
                          {isProcessingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isCheckin ? (
                            <XCircle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          )}
                          <span>{isCheckin ? 'Desmarcar Presença' : 'Check-in'}</span>
                        </button>

                        {/* Botão Forçar Topo da Fila (Ao lado de Check-in) */}
                        <button
                          type="button"
                          onClick={() => alternar_forcar_topo_fila(idProj, isTopoFila)}
                          disabled={isProcessingTopo}
                          title={
                            isTopoFila
                              ? 'Remover do Topo da Fila (voltar à fila comum de sorteio)'
                              : 'Forçar este projeto para o Topo da Fila de sorteio dos avaliadores'
                          }
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs border transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                            isTopoFila
                              ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-sm'
                              : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {isProcessingTopo ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Zap className={`w-3.5 h-3.5 ${isTopoFila ? 'text-white fill-white' : 'text-amber-500'}`} />
                          )}
                          <span>{isTopoFila ? 'Topo da Fila' : 'Normal'}</span>
                        </button>

                        {/* Botão Editar (Ícone compacto) */}
                        <button
                          type="button"
                          onClick={() => abrir_edicao(p)}
                          title="Editar Projeto"
                          aria-label="Editar Projeto"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Botão Excluir (Ícone compacto) */}
                        <button
                          type="button"
                          onClick={() => excluir_projeto(p)}
                          title="Excluir Projeto"
                          aria-label="Excluir Projeto"
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal / Formulário de Edição */}
      {projeto_em_edicao && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-blue-600" /> Editar Projeto
              </h3>
              <button
                type="button"
                onClick={fechar_edicao}
                title="Fechar Edição"
                aria-label="Fechar Edição"
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={salvar_edicao} className="space-y-4 text-xs">
              <div>
                <label htmlFor="edit_codigo_input" className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  Código do Projeto
                </label>
                <input
                  id="edit_codigo_input"
                  type="text"
                  disabled
                  value={projeto_em_edicao.codigo_projeto || 'N/I'}
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 font-mono font-bold text-xs"
                />
              </div>

              <div>
                <label htmlFor="edit_titulo_input" className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  Título *
                </label>
                <textarea
                  id="edit_titulo_input"
                  rows={3}
                  required
                  value={edit_titulo}
                  onChange={(e) => set_edit_titulo(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit_estande_input" className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Estande
                  </label>
                  <input
                    id="edit_estande_input"
                    type="text"
                    value={edit_estande}
                    onChange={(e) => set_edit_estande(e.target.value)}
                    placeholder="Ex: EST-A01"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="edit_corredor_input" className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Corredor
                  </label>
                  <input
                    id="edit_corredor_input"
                    type="text"
                    value={edit_corredor}
                    onChange={(e) => set_edit_corredor(e.target.value)}
                    placeholder="Ex: Corredor A"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Relações no Modal de Edição */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="edit_instituicao_select" className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Instituição
                  </label>
                  <select
                    id="edit_instituicao_select"
                    value={edit_instituicao_id}
                    onChange={(e) => set_edit_instituicao_id(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="">(Sem Instituição)</option>
                    {lista_instituicoes.map((inst) => (
                      <option key={inst.id_instituicao} value={inst.id_instituicao}>
                        {inst.sigla ? `[${inst.sigla}] ` : ''}{inst.nome_exibicao}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="edit_area_select" className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Área Temática
                  </label>
                  <select
                    id="edit_area_select"
                    value={edit_area_id}
                    onChange={(e) => set_edit_area_id(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="">(Sem Área)</option>
                    {lista_areas.map((area) => (
                      <option key={area.id_area} value={area.id_area}>
                        {area.nome_area}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="edit_modalidade_select" className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Modalidade
                  </label>
                  <select
                    id="edit_modalidade_select"
                    value={edit_modalidade_id}
                    onChange={(e) => set_edit_modalidade_id(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="">(Sem Modalidade)</option>
                    {lista_modalidades.map((mod) => (
                      <option key={mod.id_modalidade} value={mod.id_modalidade}>
                        {mod.nome_modalidade}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-1">
                <label htmlFor="edit_fora_competicao_check" className="flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300 font-semibold p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <input
                    id="edit_fora_competicao_check"
                    type="checkbox"
                    checked={edit_fora_competicao}
                    onChange={(e) => set_edit_fora_competicao(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-slate-600"
                  />
                  <span>Projeto fora da competição (não participa do sorteio e ranking)</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={fechar_edicao}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-98 disabled:opacity-50 text-white rounded-xl font-bold transition-all flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>Salvar Alterações</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE DE-PARA (DE-DUPLICAÇÃO E VALIDAÇÃO) */}
      {modalDeParaAberto && (
        <ModalDeParaMapping
          itens={itensDePara}
          instituicoesExistentes={lista_instituicoes}
          modalidadesExistentes={lista_modalidades}
          aoFechar={() => {
            setModalDeParaAberto(false);
            set_processando_arquivo(false);
          }}
          aoConfirmar={async (decisoes) => {
            setModalDeParaAberto(false);
            await executarGravacaoFinalProjetos(linhasArquivoPendente, decisoes);
          }}
        />
      )}
    </div>
  );
};
