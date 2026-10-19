import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Search,
  ChevronDown,
  ChevronUp,
  Printer,
  FileSpreadsheet,
  AlertTriangle,
  Lock,
  Unlock,
  CheckCircle2,
  Clock,
  User,
  Building,
  RefreshCw,
  Loader2,
  MessageSquare,
  ShieldAlert,
  SlidersHorizontal
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export interface AvaliadorFichaRelatorio {
  id_usuario: string;
  nome: string;
  email: string;
  notas_criterios: Record<string, number>;
  nota_final: number;
  parecer_comentario?: string;
}

export interface ItemProjetoRelatorio {
  id_projeto: string;
  codigo_projeto?: string | null;
  estande: string;
  titulo: string;
  instituicao: string;
  area_conhecimento: string;
  modalidade: string;
  media_final: number;
  status: 'Avaliando' | 'Concluído' | 'Em Quarentena';
  em_quarentena: boolean;
  tem_lock_ativo: boolean;
  avaliadores: AvaliadorFichaRelatorio[];
}

// Dados de contingência/offline
const dados_contingencia_relatorios: ItemProjetoRelatorio[] = [
  {
    id_projeto: 'proj-101',
    codigo_projeto: 'FETEC-001',
    estande: 'EST-A01',
    titulo: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
    instituicao: 'IFMS - Câmpus Campo Grande',
    area_conhecimento: 'Engenharias e Exatas',
    modalidade: 'Pesquisa Aplicada',
    media_final: 9.85,
    status: 'Concluído',
    em_quarentena: false,
    tem_lock_ativo: false,
    avaliadores: [
      {
        id_usuario: 'usr-01',
        nome: 'Dra. Maria Silva',
        email: 'maria.silva@ifms.edu.br',
        notas_criterios: { Metodologia: 5, Originalidade: 5, Viabilidade: 5, Apresentacao: 4.8 },
        nota_final: 9.9,
        parecer_comentario: 'Excelente protótipo funcional com prototipagem solar testada no campo.'
      },
      {
        id_usuario: 'usr-02',
        nome: 'Prof. Carlos Eduardo',
        email: 'carlos.eduardo@ufms.br',
        notas_criterios: { Metodologia: 5, Originalidade: 4.8, Viabilidade: 4.9, Apresentacao: 4.8 },
        nota_final: 9.8,
        parecer_comentario: 'Domínio técnico impecável demonstrado pelos estudantes durante a arguição.'
      }
    ]
  },
  {
    id_projeto: 'proj-102',
    codigo_projeto: 'FETEC-002',
    estande: 'EST-A02',
    titulo: 'Sistema Web de Gestão de Resíduos Orgânicos Escolares',
    instituicao: 'IFMS - Câmpus Dourados',
    area_conhecimento: 'Engenharias e Exatas',
    modalidade: 'Pesquisa Aplicada',
    media_final: 8.70,
    status: 'Em Quarentena',
    em_quarentena: true,
    tem_lock_ativo: true,
    avaliadores: [
      {
        id_usuario: 'usr-03',
        nome: 'Dr. Roberto Santos',
        email: 'roberto.santos@embrapa.br',
        notas_criterios: { Metodologia: 3.5, Originalidade: 4.0, Viabilidade: 4.5, Apresentacao: 4.0 },
        nota_final: 7.9,
        parecer_comentario: 'Falta detalhamento no algoritmo de rotociclagem de resíduos.'
      },
      {
        id_usuario: 'usr-04',
        nome: 'Dra. Ana Paula',
        email: 'ana.paula@ifms.edu.br',
        notas_criterios: { Metodologia: 5, Originalidade: 4.8, Viabilidade: 4.7, Apresentacao: 5 },
        nota_final: 9.5,
        parecer_comentario: 'Apresentação perfeita e impacto social evidente na comunidade escolar.'
      }
    ]
  },
  {
    id_projeto: 'proj-103',
    codigo_projeto: 'FETEC-003',
    estande: 'EST-B05',
    titulo: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
    instituicao: 'IFMS - Câmpus Corumbá',
    area_conhecimento: 'Ciências Biológicas e Saúde',
    modalidade: 'Iniciação Científica',
    media_final: 9.20,
    status: 'Avaliando',
    em_quarentena: false,
    tem_lock_ativo: true,
    avaliadores: [
      {
        id_usuario: 'usr-05',
        nome: 'Prof. Lucas Mendes',
        email: 'lucas.mendes@uems.br',
        notas_criterios: { Metodologia: 4.5, Originalidade: 4.5, Viabilidade: 4.8, Apresentacao: 4.6 },
        nota_final: 9.2,
        parecer_comentario: 'Pesquisa com elevado rigor científico sobre a flora pantaneira.'
      }
    ]
  }
];

export const RelatoriosAdmin: React.FC<{ id_evento_ativo?: string }> = ({
  id_evento_ativo = 'evt-2026-ifms'
}) => {
  const [projetos_relatorio, set_projetos_relatorio] = useState<ItemProjetoRelatorio[]>([]);
  const [carregando_dados, set_carregando_dados] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');
  const [filtro_status, set_filtro_status] = useState<string>('todos');
  const [projeto_expandido_id, set_projeto_expandido_id] = useState<string | null>(null);
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);

  const conexao_banco_configurada = verificar_conexao_configurada();

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  // Carregar dados de relatórios no Supabase
  const [relatorio_view_data, set_relatorio_view_data] = useState<any[]>([]);

  const buscar_relatorios_projetos = async () => {
    set_carregando_dados(true);

    if (!conexao_banco_configurada) {
      set_projetos_relatorio(dados_contingencia_relatorios);
      set_relatorio_view_data([
        {
          id_projeto: 'proj-101',
          codigo_projeto: 'FETEC-001',
          estande: 'EST-A01',
          titulo: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
          qtd_avaliacoes: 3,
          modalidade: 'Pesquisa Aplicada',
          area_tematica: 'Engenharias e Exatas',
          media_notas: 9.85
        },
        {
          id_projeto: 'proj-102',
          codigo_projeto: 'FETEC-002',
          estande: 'EST-A02',
          titulo: 'Sistema Web de Gestão de Resíduos Orgânicos Escolares',
          qtd_avaliacoes: 2,
          modalidade: 'Pesquisa Aplicada',
          area_tematica: 'Engenharias e Exatas',
          media_notas: 8.70
        },
        {
          id_projeto: 'proj-103',
          codigo_projeto: 'FETEC-003',
          estande: 'EST-B05',
          titulo: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
          qtd_avaliacoes: 3,
          modalidade: 'Iniciação Científica',
          area_tematica: 'Ciências Biológicas e Saúde',
          media_notas: 9.20
        }
      ]);
      set_carregando_dados(false);
      return;
    }

    try {
      // 2. Fetch dos dados consolidados da view_relatorio_admin (A view já entrega codigo_projeto)
      const { data: dataView, error: errorView } = await supabase
        .from('view_relatorio_admin')
        .select('*')
        .order('media_notas', { ascending: false });

      if (!errorView && dataView) {
        set_relatorio_view_data(dataView);
      } else {
        console.warn('Consulta à view_relatorio_admin retornou aviso:', errorView?.message);
        set_relatorio_view_data([
          {
            id_projeto: 'proj-101',
            codigo_projeto: 'FETEC-001',
            estande: 'EST-A01',
            titulo: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
            qtd_avaliacoes: 3,
            modalidade: 'Pesquisa Aplicada',
            area_tematica: 'Engenharias e Exatas',
            media_notas: 9.85
          },
          {
            id_projeto: 'proj-102',
            codigo_projeto: 'FETEC-002',
            estande: 'EST-A02',
            titulo: 'Sistema Web de Gestão de Resíduos Orgânicos Escolares',
            qtd_avaliacoes: 2,
            modalidade: 'Pesquisa Aplicada',
            area_tematica: 'Engenharias e Exatas',
            media_notas: 8.70
          },
          {
            id_projeto: 'proj-103',
            codigo_projeto: 'FETEC-003',
            estande: 'EST-B05',
            titulo: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
            qtd_avaliacoes: 3,
            modalidade: 'Iniciação Científica',
            area_tematica: 'Ciências Biológicas e Saúde',
            media_notas: 9.20
          }
        ]);
      }

      // Busca complementar para gerenciamento detalhado de projetos e locks
      const { data: dados_proj, error: erro_proj } = await supabase
        .from('projetos')
        .select(`
          id,
          id_projeto,
          codigo_projeto,
          estande,
          titulo,
          titulo_projeto,
          nome_instituicao,
          area_conhecimento,
          modalidade,
          avaliacoes (
            id,
            id_usuario,
            nota_final,
            is_quarentena,
            parecer_comentario,
            notas_criterios,
            usuarios (nome, email)
          )
        `);

      const { data: locks_data } = await supabase.from('locks_ativos').select('id_projeto');

      const set_ids_locks = new Set((locks_data || []).map((l: any) => l.id_projeto));

      if (erro_proj || !dados_proj) {
        set_projetos_relatorio(dados_contingencia_relatorios);
      } else {
        const lista_formatada: ItemProjetoRelatorio[] = dados_proj.map((p: any) => {
          const id_proj = p.id_projeto || p.id;
          const avaliacoes_lista: any[] = p.avaliacoes || [];
          
          let soma_notas = 0;
          let em_quarentena_flag = false;

          const avaliadores_mapeados: AvaliadorFichaRelatorio[] = avaliacoes_lista.map((a) => {
            const nota = Number(a.nota_final || 0);
            soma_notas += nota;
            if (a.is_quarentena) em_quarentena_flag = true;

            return {
              id_usuario: a.id_usuario,
              nome: a.usuarios?.nome || 'Avaliador Credenciado',
              email: a.usuarios?.email || 'avaliador@ifms.edu.br',
              notas_criterios: a.notas_criterios || { Metodologia: nota / 2, Apresentacao: nota / 2 },
              nota_final: nota,
              parecer_comentario: a.parecer_comentario || 'Sem parecer registrado.'
            };
          });

          const qtd_aval = avaliadores_mapeados.length;
          const media = qtd_aval > 0 ? Number((soma_notas / qtd_aval).toFixed(2)) : 0;
          const tem_lock = set_ids_locks.has(id_proj);

          let status_final: 'Avaliando' | 'Concluído' | 'Em Quarentena' = 'Avaliando';
          if (em_quarentena_flag) {
            status_final = 'Em Quarentena';
          } else if (qtd_aval >= 3) {
            status_final = 'Concluído';
          }

          return {
            id_projeto: id_proj,
            codigo_projeto: p.codigo_projeto || null,
            estande: p.estande || 'EST-00',
            titulo: p.titulo || p.titulo_projeto || 'Projeto IFMS',
            instituicao: p.nome_instituicao || 'IFMS',
            area_conhecimento: p.area_conhecimento || 'Geral',
            modalidade: p.modalidade || 'Pesquisa',
            media_final: media,
            status: status_final,
            em_quarentena: em_quarentena_flag,
            tem_lock_ativo: tem_lock,
            avaliadores: avaliadores_mapeados
          };
        });

        set_projetos_relatorio(lista_formatada);
      }
    } catch (e) {
      console.error('Erro ao buscar relatorios:', e);
      set_projetos_relatorio(dados_contingencia_relatorios);
    } finally {
      set_carregando_dados(false);
    }
  };

  useEffect(() => {
    buscar_relatorios_projetos();
  }, [conexao_banco_configurada]);

  // Alternar quarentena de um projeto
  const alternar_quarentena_projeto = async (id_projeto: string, status_atual: boolean) => {
    const novo_status = !status_atual;

    if (conexao_banco_configurada) {
      await supabase
        .from('avaliacoes')
        .update({ is_quarentena: novo_status, quarentena_decisao: novo_status ? 'pendente' : 'resolvido' })
        .eq('id_projeto', id_projeto);
    }

    set_projetos_relatorio((lista) =>
      lista.map((p) =>
        p.id_projeto === id_projeto
          ? {
              ...p,
              em_quarentena: novo_status,
              status: novo_status ? 'Em Quarentena' : p.avaliadores.length >= 3 ? 'Concluído' : 'Avaliando'
            }
          : p
      )
    );

    exibir_notificacao(
      novo_status
        ? 'Projeto enviado para a Fila de Quarentena com sucesso.'
        : 'Projeto removido da quarentena.'
    );
  };

  // Liberar lock de um projeto
  const liberar_lock_projeto = async (id_projeto: string) => {
    if (conexao_banco_configurada) {
      await supabase.from('locks_ativos').delete().eq('id_projeto', id_projeto);
    }

    set_projetos_relatorio((lista) =>
      lista.map((p) => (p.id_projeto === id_projeto ? { ...p, tem_lock_ativo: false } : p))
    );

    exibir_notificacao('Lock de avaliação liberado para o projeto.');
  };

  // Imprimir Ficha / PDF
  const imprimir_ficha_projeto = (id_projeto: string) => {
    set_projeto_expandido_id(id_projeto);
    setTimeout(() => {
      window.print();
    }, 300);
  };

  // Exportar Relatório Global CSV
  const exportar_csv_relatorio = () => {
    let csv = 'Código,Estande,Título do Projeto,Instituição,Área Temática,Modalidade,Média Final,Status,Qtd Avaliadores\n';

    projetos_relatorio.forEach((p) => {
      csv += `"${p.codigo_projeto || 'N/I'}","${p.estande}","${p.titulo.replace(/"/g, '""')}","${p.instituicao}","${p.area_conhecimento}","${p.modalidade}",${p.media_final},"${p.status}",${p.avaliadores.length}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_consolidado_projetos_ifms.csv`;
    a.click();
  };

  // Filtragem dos projetos
  const projetos_filtrados = useMemo(() => {
    return projetos_relatorio.filter((p) => {
      const codigo = (p.codigo_projeto || '').toLowerCase();
      const atende_termo =
        p.titulo.toLowerCase().includes(termo_busca.toLowerCase()) ||
        p.estande.toLowerCase().includes(termo_busca.toLowerCase()) ||
        p.instituicao.toLowerCase().includes(termo_busca.toLowerCase()) ||
        codigo.includes(termo_busca.toLowerCase());

      const atende_status =
        filtro_status === 'todos' ||
        (filtro_status === 'quarentena' && p.em_quarentena) ||
        (filtro_status === 'concluido' && p.status === 'Concluído') ||
        (filtro_status === 'avaliando' && p.status === 'Avaliando');

      return atende_termo && atende_status;
    });
  }, [projetos_relatorio, termo_busca, filtro_status]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans">
      {/* Toast Notificação */}
      {mensagem_notificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            Relatórios e Impressão de Fichas de Avaliação
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Consultas em formato acordeão com código natural, auditoria de notas por critério, pareceres e ações administrativas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={buscar_relatorios_projetos}
            disabled={carregando_dados}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando_dados ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={exportar_csv_relatorio}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar CSV Global
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir Relatório (PDF)
          </button>
        </div>
      </div>

      {/* Barra de Busca e Filtros */}
      <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Buscar por Código, Título, Estande..."
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1 shrink-0">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Status:
          </span>
          <select
            value={filtro_status}
            onChange={(e) => set_filtro_status(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none cursor-pointer"
          >
            <option value="todos">Todos os Projetos</option>
            <option value="concluido">Concluídos (3+ Avaliações)</option>
            <option value="avaliando">Em Avaliação</option>
            <option value="quarentena">Em Quarentena</option>
          </select>
        </div>
      </div>

      {/* Carregando */}
      {carregando_dados && (
        <div className="p-12 text-center space-y-2">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">
            Carregando relatórios consolidados e fichas do Supabase...
          </p>
        </div>
      )}

      {/* SEÇÃO PRINCIPAL: RELATÓRIOS EM ACORDEÃO (view_relatorio_admin) */}
      {!carregando_dados && relatorio_view_data.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-600" /> Relatório Consolidado em Acordeão (view_relatorio_admin)
          </h3>

          <div className="space-y-3">
            {relatorio_view_data.map((item: any, index: number) => {
              const estande = item.estande || item.estande_numero || 'EST-00';
              const codigo = item.codigo_projeto || 'N/I';
              const titulo = item.titulo || item.titulo_projeto || item.nome_projeto || 'Projeto Sem Título';
              const qtd_avaliacoes = item.qtd_avaliacoes ?? item.total_avaliacoes ?? item.qtd_avaliacoes_realizadas ?? item.avaliacoes_count ?? 0;
              const modalidade = item.modalidade || 'Não informada';
              const area_tematica = item.area_tematica || item.area_conhecimento || 'Não informada';
              const media_notas = typeof item.media_notas === 'number'
                ? item.media_notas.toFixed(2)
                : Number(item.media_notas || 0).toFixed(2);

              return (
                <details
                  key={item.id_projeto || item.id || index}
                  className="group border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-xs"
                >
                  <summary className="px-5 py-4 cursor-pointer font-bold text-sm text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 flex flex-wrap items-center justify-between gap-3 transition-colors list-none">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-black bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2.5 py-1 rounded-lg shrink-0">
                        {estande}
                      </span>
                      <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-600 shrink-0">
                        {codigo}
                      </span>
                      <span className="text-slate-400">|</span>
                      <span className="text-slate-900 dark:text-white font-extrabold">
                        {titulo}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">|</span>
                      <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-extrabold text-xs border border-emerald-300">
                        {qtd_avaliacoes} {qtd_avaliacoes === 1 ? 'Avaliação' : 'Avaliações'}
                      </span>
                    </div>
                  </summary>

                  <div className="p-5 bg-gray-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-700 space-y-3 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                          Modalidade
                        </span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {modalidade}
                        </span>
                      </div>

                      <div className="bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                          Área Temática
                        </span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {area_tematica}
                        </span>
                      </div>

                      <div className="bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-800">
                        <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block mb-1">
                          Média das Notas
                        </span>
                        <span className="font-mono text-base font-black text-emerald-700 dark:text-emerald-300">
                          {media_notas} pts
                        </span>
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {/* PAINEL DE FICHAS INDIVIDUAIS E AÇÕES ADMINISTRATIVAS */}
      {!carregando_dados && (
        <div className="space-y-3">
          {projetos_filtrados.length === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500">
              Nenhum projeto localizado para os critérios informados.
            </div>
          ) : (
            projetos_filtrados.map((projeto) => {
              const is_expandido = projeto_expandido_id === projeto.id_projeto;

              return (
                <div
                  key={projeto.id_projeto}
                  className={`border rounded-2xl transition-all duration-200 overflow-hidden ${
                    is_expandido
                      ? 'bg-white dark:bg-slate-800 border-emerald-500 shadow-md'
                      : 'bg-slate-50/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  {/* ESTADO RETRAÍDO (CABEÇALHO DO ACORDEÃO) */}
                  <div
                    onClick={() =>
                      set_projeto_expandido_id(is_expandido ? null : projeto.id_projeto)
                    }
                    className="p-4 sm:p-5 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 w-full sm:w-auto">
                      <span className="font-mono text-xs font-black bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2.5 py-1 rounded-lg shrink-0">
                        {projeto.estande}
                      </span>

                      {/* Exibição do codigo_projeto em vez do UUID */}
                      <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-200/70 dark:bg-slate-700 px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-600 shrink-0">
                        {projeto.codigo_projeto || 'N/I'}
                      </span>

                      <div className="space-y-1">
                        <h3 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                          {projeto.titulo}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                          <span className="flex items-center gap-1">
                            <Building className="w-3.5 h-3.5" />
                            {projeto.instituicao}
                          </span>
                          <span>•</span>
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            {projeto.area_conhecimento}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-200 dark:border-slate-700">
                      {/* Média Final */}
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">
                          Média Final
                        </span>
                        <span className="font-mono text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                          {projeto.media_final.toFixed(2)} pts
                        </span>
                      </div>

                      {/* Status Badge */}
                      <div>
                        {projeto.em_quarentena ? (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Quarentena
                          </span>
                        ) : projeto.status === 'Concluído' ? (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Concluído
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Avaliando
                          </span>
                        )}
                      </div>

                      {/* Ícone de Expansão */}
                      <div className="p-1.5 rounded-lg bg-slate-200/60 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {is_expandido ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ESTADO EXPANDIDO (DETALHES COMPLETO) */}
                  {is_expandido && (
                    <div className="p-5 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 space-y-6">
                      {/* BOTÕES DE AÇÃO ADMINISTRATIVA DA FICHA */}
                      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                            Ações Administrativas:
                          </span>
                          {projeto.tem_lock_ativo && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 flex items-center gap-1">
                              <Lock className="w-3 h-3" /> Lock Ativo no Servidor
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              alternar_quarentena_projeto(projeto.id_projeto, projeto.em_quarentena)
                            }
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                              projeto.em_quarentena
                                ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                                : 'bg-red-50 hover:bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200'
                            }`}
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            {projeto.em_quarentena
                              ? 'Remover da Quarentena'
                              : 'Enviar para Quarentena'}
                          </button>

                          {projeto.tem_lock_ativo && (
                            <button
                              type="button"
                              onClick={() => liberar_lock_projeto(projeto.id_projeto)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 flex items-center gap-1.5 cursor-pointer"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              Liberar Lock de Avaliação
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => imprimir_ficha_projeto(projeto.id_projeto)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 flex items-center gap-1.5 cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Imprimir Ficha Individual
                          </button>
                        </div>
                      </div>

                      {/* LISTA DE AVALIADORES E NOTAS POR CRITÉRIO */}
                      <div className="space-y-4">
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                          <User className="w-4 h-4 text-emerald-600" />
                          Avaliadores Alocados ({projeto.avaliadores.length})
                        </h4>

                        {projeto.avaliadores.length === 0 ? (
                          <div className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl text-xs font-medium text-slate-500 text-center">
                            Nenhuma avaliação cadastrada até o momento para este projeto.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {projeto.avaliadores.map((aval, idx) => (
                              <div
                                key={idx}
                                className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3"
                              >
                                <div className="flex items-center justify-between border-b pb-2 border-slate-200 dark:border-slate-700">
                                  <div>
                                    <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                                      {aval.nome}
                                    </div>
                                    <div className="text-[11px] text-slate-500">{aval.email}</div>
                                  </div>

                                  <div className="text-right">
                                    <span className="text-[10px] uppercase text-slate-400 font-bold block">
                                      Nota
                                    </span>
                                    <span className="font-mono text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                                      {aval.nota_final.toFixed(2)} pts
                                    </span>
                                  </div>
                                </div>

                                {/* Notas por Critério */}
                                <div className="space-y-1.5 pt-1">
                                  <span className="text-[10px] uppercase font-extrabold text-slate-400 block">
                                    Desdobramento por Critério:
                                  </span>
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    {Object.entries(aval.notas_criterios).map(([crit, val]) => (
                                      <div
                                        key={crit}
                                        className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between"
                                      >
                                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                                          {crit}:
                                        </span>
                                        <span className="font-mono font-bold text-slate-900 dark:text-white">
                                          {val} pts
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Parecer / Comentários */}
                                {aval.parecer_comentario && (
                                  <div className="bg-amber-50/80 dark:bg-amber-950/30 p-2.5 rounded-xl border border-amber-200/80 dark:border-amber-800/50 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                                    <div className="font-bold flex items-center gap-1 text-[11px]">
                                      <MessageSquare className="w-3 h-3 text-amber-700" /> Parecer
                                      Técnico:
                                    </div>
                                    <p className="italic text-[11px] leading-relaxed">
                                      "{aval.parecer_comentario}"
                                    </p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
