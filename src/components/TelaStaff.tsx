import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  XCircle,
  QrCode,
  Copy,
  UserCheck,
  Building,
  Sparkles,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import type { Projeto, AvaliadorEvento } from '../types/database';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

// Dados iniciais de contingência (fallback)
const dados_contingencia_projetos: Projeto[] = [
  {
    id: 'proj-001',
    id_projeto: 'proj-001',
    titulo_projeto: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
    titulo: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
    resumo: 'Protótipo de baixo custo para medição de umidade do solo em pequenas propriedades.',
    area_conhecimento: 'Engenharias e Ciências Agrárias',
    orientador_nome: 'Prof. Dr. Ricardo Silva',
    estudantes_nomes: ['Gabriel Lima', 'Beatriz Santos'],
    modalidade: 'Pesquisa Aplicada',
    estande_numero: 'EST-A01',
    estande: 'EST-A01',
    id_evento: 'evt-2026-ifms',
    id_instituicao: 'inst-01',
    nome_instituicao: 'IFMS - Câmpus Campo Grande',
    is_check_in_realizado: true,
  },
  {
    id: 'proj-002',
    id_projeto: 'proj-002',
    titulo_projeto: 'Sistema Web de Gestão de Resíduos Orgânicos Escolares',
    titulo: 'Sistema Web de Gestão de Resíduos Orgânicos Escolares',
    resumo: 'Plataforma para gerenciamento de compostagem em escolas públicas.',
    area_conhecimento: 'Ciências da Computação',
    orientador_nome: 'Prof. Me. Carlos Eduardo',
    estudantes_nomes: ['Lucas Oliveira', 'Mariana Costa'],
    modalidade: 'Extensão Tecnológica',
    estande_numero: 'EST-A02',
    estande: 'EST-A02',
    id_evento: 'evt-2026-ifms',
    id_instituicao: 'inst-01',
    nome_instituicao: 'IFMS - Câmpus Dourados',
    is_check_in_realizado: false,
  },
  {
    id: 'proj-003',
    id_projeto: 'proj-003',
    titulo_projeto: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
    titulo: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
    resumo: 'Estudo das propriedades bioativas de plantas nativas da região.',
    area_conhecimento: 'Ciências Biológicas e da Saúde',
    orientador_nome: 'Profa. Dra. Juliana Mendes',
    estudantes_nomes: ['Enzo Gabriel', 'Camila Rocha'],
    modalidade: 'Iniciação Científica',
    estande_numero: 'EST-B05',
    estande: 'EST-B05',
    id_evento: 'evt-2026-ifms',
    id_instituicao: 'inst-02',
    nome_instituicao: 'IFMS - Câmpus Corumbá',
    is_check_in_realizado: true,
  },
];

const dados_contingencia_avaliadores: AvaliadorEvento[] = [
  {
    id: 'aval-001',
    id_usuario: 'aval-001',
    id_avaliador: 'usr-101',
    id_evento: 'evt-2026-ifms',
    nome_avaliador: 'Dr. Roberto Magalhães',
    nome: 'Dr. Roberto Magalhães',
    email_avaliador: 'roberto.magalhaes@ufms.br',
    email: 'roberto.magalhaes@ufms.br',
    cpf_avaliador: '***.458.912-**',
    area_atuacao: 'Engenharias / Robótica',
    status_convite: 'aceito',
    instituicao_origem: 'UFMS - Universidade Federal de MS',
    is_credenciado: true,
    usuarios: {
      nome: 'Dr. Roberto Magalhães',
      email: 'roberto.magalhaes@ufms.br',
      cpf: '***.458.912-**',
      celular: '(67) 99999-0001',
    },
    instituicoes: {
      nome_exibicao: 'UFMS - Universidade Federal de MS',
    },
  },
  {
    id: 'aval-002',
    id_usuario: 'aval-002',
    id_avaliador: 'usr-102',
    id_evento: 'evt-2026-ifms',
    nome_avaliador: 'Dra. Patricia Alencar',
    nome: 'Dra. Patricia Alencar',
    email_avaliador: 'patricia.alencar@ucdb.br',
    email: 'patricia.alencar@ucdb.br',
    cpf_avaliador: '***.312.809-**',
    area_atuacao: 'Ciências Biológicas e Saúde',
    status_convite: 'aceito',
    instituicao_origem: 'UCDB - Universidade Católica Dom Bosco',
    is_credenciado: false,
    usuarios: {
      nome: 'Dra. Patricia Alencar',
      email: 'patricia.alencar@ucdb.br',
      cpf: '***.312.809-**',
      celular: '(67) 99999-0002',
    },
    instituicoes: {
      nome_exibicao: 'UCDB - Universidade Católica Dom Bosco',
    },
  },
];

export const TelaStaff: React.FC = () => {
  // Controle de abas principais
  const [aba_ativa, set_aba_ativa] = useState<'expositores' | 'avaliadores'>('expositores');

  // Estados reais da aplicação
  const [projetos_lista, set_projetos_lista] = useState<Projeto[]>([]);
  const [avaliadores_lista, set_avaliadores_lista] = useState<AvaliadorEvento[]>([]);

  // Estados de carregamento e erros do banco de dados
  const [carregando_dados, set_carregando_dados] = useState<boolean>(true);
  const [mensagem_erro_banco, set_mensagem_erro_banco] = useState<string | null>(null);

  // Termos de busca
  const [termo_busca_expositores, set_termo_busca_expositores] = useState<string>('');
  const [termo_busca_avaliadores, set_termo_busca_avaliadores] = useState<string>('');

  // Filtros de status
  const [filtro_status_expositores, set_filtro_status_expositores] = useState<'todos' | 'checkin' | 'pendente'>('todos');
  const [filtro_status_avaliadores, set_filtro_status_avaliadores] = useState<'todos' | 'credenciado' | 'pendente'>('todos');

  // Notificações visuais
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [qr_copiado, set_qr_copiado] = useState<boolean>(false);

  const conexao_banco_configurada = verificar_conexao_configurada();

  const exibir_notificacao = (texto_notificacao: string) => {
    set_mensagem_notificacao(texto_notificacao);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  // 1. CORREÇÃO DA BUSCA RELACIONAL (3FN) NA TELA DE STAFF
  const buscar_dados_iniciais = async () => {
    set_carregando_dados(true);
    set_mensagem_erro_banco(null);

    if (!conexao_banco_configurada) {
      console.info('Supabase não configurado. Utilizando dados de contingência.');
      set_projetos_lista(dados_contingencia_projetos);
      set_avaliadores_lista(dados_contingencia_avaliadores);
      set_carregando_dados(false);
      return;
    }

    try {
      // A) Busca simultânea na tabela 'projetos'
      let projetos_resposta: Projeto[] = [];
      const { data: dados_projetos, error: erro_projetos } = await supabase
        .from('projetos')
        .select('id_projeto, titulo, estande, is_check_in_realizado, id_instituicao, instituicoes(nome_exibicao)');

      if (erro_projetos) {
        const { data: dados_projeto_singular, error: erro_singular } = await supabase
          .from('projeto')
          .select('*');

        if (erro_singular) {
          console.error('Erro ao buscar projetos no Supabase:', erro_projetos.message);
          set_mensagem_erro_banco(`Erro de conexão ao buscar projetos: ${erro_projetos.message}`);
          projetos_resposta = dados_contingencia_projetos;
        } else if (dados_projeto_singular && dados_projeto_singular.length > 0) {
          projetos_resposta = dados_projeto_singular.map((item) => ({
            id: item.id || item.id_projeto,
            id_projeto: item.id_projeto || item.id,
            titulo_projeto: item.titulo_projeto || item.titulo || 'Projeto sem título',
            titulo: item.titulo || item.titulo_projeto,
            estande: item.estande || 'SEM ESTANDE',
            nome_instituicao: item.nome_instituicao || (item.instituicoes?.nome_exibicao) || 'Sem Instituição',
            orientador_nome: item.orientador_nome || 'Orientador',
            estudantes_nomes: item.estudantes_nomes || ['Estudante Expositores'],
            is_check_in_realizado: Boolean(item.is_check_in_realizado),
          }));
        } else {
          projetos_resposta = dados_contingencia_projetos;
        }
      } else if (dados_projetos && dados_projetos.length > 0) {
        projetos_resposta = dados_projetos.map((item: any) => {
          const dados_inst = Array.isArray(item.instituicoes) ? item.instituicoes[0] : item.instituicoes;
          return {
            id: item.id_projeto,
            id_projeto: item.id_projeto,
            titulo_projeto: item.titulo,
            titulo: item.titulo,
            estande: item.estande,
            nome_instituicao: dados_inst?.nome_exibicao || 'Sem Instituição',
            instituicoes: dados_inst,
            orientador_nome: 'Orientador',
            estudantes_nomes: ['Estudantes do Projeto'],
            is_check_in_realizado: Boolean(item.is_check_in_realizado),
          };
        });
      } else {
        projetos_resposta = dados_contingencia_projetos;
      }

      // B) CONSULTA NA VIEW SQL view_avaliadores_credenciados
      let avaliadores_resposta: AvaliadorEvento[] = [];
      const { data: dados_avaliadores, error: erro_avaliadores } = await supabase
        .from('view_avaliadores_credenciados')
        .select('*')
        .order('nome', { ascending: true });

      if (erro_avaliadores) {
        console.error('Erro ao buscar view_avaliadores_credenciados:', erro_avaliadores.message);
        set_mensagem_erro_banco(`Erro ao buscar avaliadores no Supabase: ${erro_avaliadores.message}`);
        avaliadores_resposta = dados_contingencia_avaliadores;
      } else if (dados_avaliadores && dados_avaliadores.length > 0) {
        avaliadores_resposta = dados_avaliadores as any;
      } else {
        avaliadores_resposta = dados_contingencia_avaliadores;
      }

      set_projetos_lista(projetos_resposta);
      set_avaliadores_lista(avaliadores_resposta);
    } catch (erro_excecao: any) {
      console.error('Falha ao carregar dados do Supabase:', erro_excecao);
      set_mensagem_erro_banco(`Erro de rede ou permissão ao carregar dados.`);
      set_projetos_lista(dados_contingencia_projetos);
      set_avaliadores_lista(dados_contingencia_avaliadores);
    } finally {
      set_carregando_dados(false);
    }
  };

  useEffect(() => {
    buscar_dados_iniciais();
  }, [conexao_banco_configurada]);

  // Alterar check-in do projeto na tabela 'projetos'
  const alternar_check_in_projeto = async (id_projeto: string, status_atual: boolean) => {
    const novo_status_check_in = !status_atual;
    const id_alvo = id_projeto;

    if (!conexao_banco_configurada) {
      set_projetos_lista((lista) =>
        lista.map((p) =>
          (p.id === id_alvo || p.id_projeto === id_alvo)
            ? { ...p, is_check_in_realizado: novo_status_check_in }
            : p
        )
      );
      exibir_notificacao(
        novo_status_check_in
          ? 'Check-in realizado com sucesso! (Modo Contingência)'
          : 'Check-in cancelado. (Modo Contingência)'
      );
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
        set_mensagem_erro_banco(`Falha ao atualizar check-in no banco: ${erro_retornado.message}`);
        exibir_notificacao('Não foi possível salvar o check-in no servidor.');
        return;
      }

      set_projetos_lista((lista) =>
        lista.map((p) =>
          (p.id === id_alvo || p.id_projeto === id_alvo)
            ? { ...p, is_check_in_realizado: novo_status_check_in }
            : p
        )
      );

      exibir_notificacao(
        novo_status_check_in ? 'Check-in registrado no Supabase!' : 'Check-in removido no Supabase.'
      );
    } catch (erro_excecao: any) {
      console.error('Falha de execução ao alternar check-in:', erro_excecao);
      set_mensagem_erro_banco('Ocorreu uma falha na atualização. Tente novamente.');
    }
  };

  // Alterar credenciamento do avaliador na tabela 'avaliadores_evento'
  const alternar_credenciamento_avaliador = async (id_usuario: string, status_atual: boolean) => {
    const novo_status_credenciado = !status_atual;
    const id_alvo = id_usuario;

    if (!conexao_banco_configurada) {
      set_avaliadores_lista((lista) =>
        lista.map((a) =>
          (a.id === id_alvo || a.id_usuario === id_alvo)
            ? { ...a, is_credenciado: novo_status_credenciado }
            : a
        )
      );
      exibir_notificacao(
        novo_status_credenciado
          ? 'Avaliador liberado! (Modo Contingência)'
          : 'Credenciamento suspenso. (Modo Contingência)'
      );
      return;
    }

    try {
      let erro_retornado: any = null;
      const { error: erro_avaliadores } = await supabase
        .from('avaliadores_evento')
        .update({ is_credenciado: novo_status_credenciado })
        .eq('id_usuario', id_alvo);

      if (erro_avaliadores) {
        const { error: erro_singular } = await supabase
          .from('avaliador_evento')
          .update({ is_credenciado: novo_status_credenciado })
          .eq('id', id_alvo);

        erro_retornado = erro_singular;
      }

      if (erro_retornado) {
        console.error('Erro no Supabase ao atualizar credenciamento:', erro_retornado.message);
        set_mensagem_erro_banco(`Falha ao atualizar credenciamento: ${erro_retornado.message}`);
        exibir_notificacao('Não foi possível salvar o credenciamento no servidor.');
        return;
      }

      set_avaliadores_lista((lista) =>
        lista.map((a) =>
          (a.id === id_alvo || a.id_usuario === id_alvo)
            ? { ...a, is_credenciado: novo_status_credenciado }
            : a
        )
      );

      exibir_notificacao(
        novo_status_credenciado
          ? 'Avaliador liberado e sincronizado no Supabase!'
          : 'Acesso do avaliador revogado no Supabase.'
      );
    } catch (erro_excecao: any) {
      console.error('Falha de execução ao credenciar avaliador:', erro_excecao);
      set_mensagem_erro_banco('Erro de comunicação ao atualizar avaliador.');
    }
  };

  const copiar_link_autocadastro = () => {
    const url_credenciamento = 'https://ifms.edu.br/avaliadores/credenciamento?evento=2026-ifms';
    navigator.clipboard.writeText(url_credenciamento);
    set_qr_copiado(true);
    exibir_notificacao('Link de autocadastro copiado para a área de transferência!');
    setTimeout(() => set_qr_copiado(false), 2500);
  };

  // Filtros em memória lendo das estruturas relacionais 3FN
  const projetos_filtrados = useMemo(() => {
    const termo = termo_busca_expositores.toLowerCase().trim();
    return projetos_lista.filter((item) => {
      const titulo_texto = item.titulo || item.titulo_projeto || '';
      const estande_texto = item.estande || '';
      const inst_texto = item.nome_instituicao || '';

      const atende_busca =
        !termo ||
        titulo_texto.toLowerCase().includes(termo) ||
        estande_texto.toLowerCase().includes(termo) ||
        inst_texto.toLowerCase().includes(termo);

      const atende_status =
        filtro_status_expositores === 'todos' ||
        (filtro_status_expositores === 'checkin' && item.is_check_in_realizado) ||
        (filtro_status_expositores === 'pendente' && !item.is_check_in_realizado);

      return atende_busca && atende_status;
    });
  }, [projetos_lista, termo_busca_expositores, filtro_status_expositores]);

  const avaliadores_filtrados = useMemo(() => {
    const termo = termo_busca_avaliadores.toLowerCase().trim();
    return avaliadores_lista.filter((item) => {
      const nome_texto = item.usuarios?.nome || item.nome || item.nome_avaliador || '';
      const email_texto = item.usuarios?.email || item.email || item.email_avaliador || '';

      const atende_busca =
        !termo ||
        nome_texto.toLowerCase().includes(termo) ||
        email_texto.toLowerCase().includes(termo);

      const atende_status =
        filtro_status_avaliadores === 'todos' ||
        (filtro_status_avaliadores === 'credenciado' && item.is_credenciado) ||
        (filtro_status_avaliadores === 'pendente' && !item.is_credenciado);

      return atende_busca && atende_status;
    });
  }, [avaliadores_lista, termo_busca_avaliadores, filtro_status_avaliadores]);

  const total_projetos = projetos_lista.length;
  const total_checkins_expositores = projetos_lista.filter((p) => p.is_check_in_realizado).length;

  const total_avaliadores = avaliadores_lista.length;
  const total_avaliadores_credenciados = avaliadores_lista.filter((a) => a.is_credenciado).length;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 pb-16 font-sans">
      {/* Toast Notificação Flutuante */}
      {mensagem_notificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Alerta de Erro Visual do Supabase */}
      {mensagem_erro_banco && (
        <div className="bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-800 p-4 rounded-2xl flex items-center justify-between gap-3 text-red-800 dark:text-red-200 text-xs sm:text-sm font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <span>{mensagem_erro_banco}</span>
          </div>
          <button
            type="button"
            onClick={buscar_dados_iniciais}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tentar Novamente
          </button>
        </div>
      )}

      {/* Cabeçalho da Tela de Staff */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs tracking-wider uppercase mb-1">
            <UserCheck className="w-4 h-4" /> Módulo de Recepção & Credenciamento (3FN Join Real)
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Painel da Equipe de Apoio (Staff)
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Sincronização em tempo real de entrada de expositores e validação presencial de avaliadores.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={buscar_dados_iniciais}
            disabled={carregando_dados}
            title="Recarregar Dados do Supabase"
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

      {/* Abas de Navegação */}
      <div className="flex flex-col sm:flex-row gap-2 border-b border-slate-200 dark:border-slate-800 pb-1">
        <button
          type="button"
          onClick={() => set_aba_ativa('expositores')}
          className={`flex items-center justify-center gap-2 py-3.5 px-6 font-bold text-sm sm:text-base rounded-t-xl transition-all border-b-2 ${
            aba_ativa === 'expositores'
              ? 'border-emerald-600 dark:border-emerald-500 bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-xs'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <span>🎪</span>
          <span>Credenciar Expositores</span>
        </button>

        <button
          type="button"
          onClick={() => set_aba_ativa('avaliadores')}
          className={`flex items-center justify-center gap-2 py-3.5 px-6 font-bold text-sm sm:text-base rounded-t-xl transition-all border-b-2 ${
            aba_ativa === 'avaliadores'
              ? 'border-emerald-600 dark:border-emerald-500 bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-xs'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <span>🧑‍🏫</span>
          <span>Credenciar Avaliadores (3FN)</span>
        </button>
      </div>

      {carregando_dados && (
        <div className="p-12 text-center space-y-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Consultando registros no banco de dados do Supabase via 3FN...
          </p>
        </div>
      )}

      {/* CONTEÚDO DA ABA 1: EXPOSITORES */}
      {!carregando_dados && aba_ativa === 'expositores' && (
        <section className="space-y-6">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-96">
              <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={termo_busca_expositores}
                onChange={(e) => set_termo_busca_expositores(e.target.value)}
                placeholder="Buscar por título ou estande..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
              <span className="text-xs font-semibold text-slate-500 shrink-0">Filtrar:</span>
              <button
                type="button"
                onClick={() => set_filtro_status_expositores('todos')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
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
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
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
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  filtro_status_expositores === 'pendente'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Pendentes ({total_projetos - total_checkins_expositores})
              </button>
            </div>
          </div>

          {projetos_filtrados.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 p-10 rounded-2xl border text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Nenhum projeto localizado com os filtros aplicados.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projetos_filtrados.map((item_projeto) => {
                const id_projeto_chave = item_projeto.id_projeto || item_projeto.id;
                const titulo_exibido = item_projeto.titulo || item_projeto.titulo_projeto;
                const estande_exibido = item_projeto.estande || item_projeto.estande_numero;
                const is_presente = item_projeto.is_check_in_realizado;

                return (
                  <div
                    key={id_projeto_chave}
                    className={`bg-white dark:bg-slate-800 rounded-2xl p-5 border shadow-xs flex flex-col justify-between ${
                      is_presente
                        ? 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/20'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="px-3 py-1 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-mono text-xs font-bold rounded-lg tracking-wider">
                          {estande_exibido || 'ESTANDE'}
                        </span>

                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                            is_presente
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {is_presente ? 'Check-in Realizado' : 'Pendente'}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                        {titulo_exibido}
                      </h3>

                      <div className="text-xs text-slate-500 space-y-1">
                        <p className="flex items-center gap-1">
                          <Building className="w-3.5 h-3.5" />
                          <span>{item_projeto.nome_instituicao || (item_projeto.instituicoes?.nome_exibicao) || 'Sem Instituição'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-700/60 flex justify-end">
                      <button
                        type="button"
                        onClick={() => alternar_check_in_projeto(id_projeto_chave, is_presente)}
                        className={`w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-95 ${
                          is_presente
                            ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 border border-slate-300'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        }`}
                      >
                        {is_presente ? (
                          <>
                            <XCircle className="w-4 h-4 text-slate-500" />
                            Cancelar Check-in
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-white" />
                            Confirmar Check-in Presencial
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* CONTEÚDO DA ABA 2: AVALIADORES (LEITURA 3FN) */}
      {!carregando_dados && aba_ativa === 'avaliadores' && (
        <section className="space-y-6">
          <div className="bg-gradient-to-br from-emerald-900 via-slate-900 to-slate-950 text-white rounded-3xl p-6 sm:p-8 shadow-lg border border-emerald-800/40">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
              <div className="space-y-2 text-center lg:text-left">
                <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold inline-block">
                  <Sparkles className="w-3.5 h-3.5 inline mr-1" /> Autocadastro de Avaliadores
                </span>
                <h2 className="text-2xl font-black text-white">
                  Credenciamento Expresso na Recepção
                </h2>
                <p className="text-xs text-slate-300 max-w-lg">
                  QR Code para avaliadores preencherem o cadastro diretamente do celular.
                </p>

                <div className="pt-2 flex flex-wrap gap-2 justify-center lg:justify-start">
                  <button
                    type="button"
                    onClick={copiar_link_autocadastro}
                    className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold border border-white/20 flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {qr_copiado ? 'Link Copiado!' : 'Copiar Link'}
                  </button>
                </div>
              </div>

              <div className="bg-white p-3 rounded-2xl shrink-0 text-center">
                <div className="w-32 h-32 bg-slate-950 p-2 rounded-xl flex items-center justify-center">
                  <QrCode className="w-20 h-20 text-emerald-400" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-96">
              <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={termo_busca_avaliadores}
                onChange={(e) => set_termo_busca_avaliadores(e.target.value)}
                placeholder="Buscar avaliador por nome ou e-mail..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
              <span className="text-xs font-semibold text-slate-500 shrink-0">Filtrar:</span>
              <button
                type="button"
                onClick={() => set_filtro_status_avaliadores('todos')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
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
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
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
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  filtro_status_avaliadores === 'pendente'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Aguardando ({total_avaliadores - total_avaliadores_credenciados})
              </button>
            </div>
          </div>

          {/* Grid de Avaliadores Lendo das Relações 3FN (avaliador.usuarios.nome e avaliador.usuarios.email) */}
          {avaliadores_filtrados.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 p-10 rounded-2xl border text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Nenhum avaliador encontrado.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {avaliadores_filtrados.map((item_avaliador) => {
                const id_usuario_chave = item_avaliador.id_usuario || item_avaliador.id;
                const nome_exibido = item_avaliador.usuarios?.nome || item_avaliador.nome || item_avaliador.nome_avaliador;
                const email_exibido = item_avaliador.usuarios?.email || item_avaliador.email || item_avaliador.email_avaliador;
                const instituicao_exibida = item_avaliador.instituicoes?.nome_exibicao || item_avaliador.instituicao_origem || 'Sem Instituição';
                const is_liberado = item_avaliador.is_credenciado;

                return (
                  <div
                    key={id_usuario_chave}
                    className={`bg-white dark:bg-slate-800 rounded-2xl p-5 border shadow-xs flex flex-col justify-between ${
                      is_liberado
                        ? 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/20'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                            {nome_exibido}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {email_exibido}
                          </p>
                        </div>

                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shrink-0 ${
                            is_liberado
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-300'
                              : 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200'
                          }`}
                        >
                          {is_liberado ? 'Acesso Liberado' : 'Aguardando'}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 space-y-1">
                        <p className="flex items-center gap-1">
                          <Building className="w-3.5 h-3.5" />
                          <span>{instituicao_exibida}</span>
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-700/60 flex justify-end">
                      <button
                        type="button"
                        onClick={() => alternar_credenciamento_avaliador(id_usuario_chave, is_liberado)}
                        className={`w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-95 ${
                          is_liberado
                            ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 border border-slate-300'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        }`}
                      >
                        {is_liberado ? (
                          <>
                            <XCircle className="w-4 h-4 text-slate-500" />
                            Bloquear Acesso
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-4 h-4 text-white" />
                            Credenciar e Liberar Acesso
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
};
