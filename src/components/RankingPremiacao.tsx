import React, { useState, useEffect, useMemo } from 'react';
import {
  Trophy,
  Award,
  Medal,
  RefreshCw,
  SlidersHorizontal,
  Loader2,
  Building,
  CheckCircle2,
  FileSpreadsheet
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export interface AvaliacaoNotaRanking {
  nota_final: number;
  nota_desempate: number;
}

export interface ItemProjetoRanking {
  id_projeto: string;
  titulo: string;
  estande: string;
  nome_instituicao: string;
  nome_modalidade: string;
  nome_area: string;
  nota_final_media: number;
  nota_desempate_media: number;
  avaliacoes_count: number;
}

// Dados mock de contingência para o ranking
const dados_contingencia_ranking: ItemProjetoRanking[] = [
  {
    id_projeto: 'proj-001',
    titulo: 'Dispositivo IoT para Monitoramento Agrícola com Energia Solar',
    estande: 'EST-A01',
    nome_instituicao: 'IFMS - Câmpus Campo Grande',
    nome_modalidade: 'Pesquisa Aplicada',
    nome_area: 'Engenharias e Exatas',
    nota_final_media: 9.85,
    nota_desempate_media: 5.0,
    avaliacoes_count: 3,
  },
  {
    id_projeto: 'proj-002',
    titulo: 'Sistema Web de Gestão de Resíduos Orgânicos Escolares',
    estande: 'EST-A02',
    nome_instituicao: 'IFMS - Câmpus Dourados',
    nome_modalidade: 'Pesquisa Aplicada',
    nome_area: 'Engenharias e Exatas',
    nota_final_media: 9.60,
    nota_desempate_media: 4.8,
    avaliacoes_count: 3,
  },
  {
    id_projeto: 'proj-003',
    titulo: 'Análise Fisico-Química de Extratos Botânicos do Pantanal',
    estande: 'EST-B05',
    nome_instituicao: 'IFMS - Câmpus Corumbá',
    nome_modalidade: 'Iniciação Científica',
    nome_area: 'Ciências Biológicas e Saúde',
    nota_final_media: 9.75,
    nota_desempate_media: 4.9,
    avaliacoes_count: 3,
  },
  {
    id_projeto: 'proj-004',
    titulo: 'Desenvolvimento de Bioplástico a partir de Casca de Mandioca',
    estande: 'EST-C12',
    nome_instituicao: 'IFMS - Câmpus Três Lagoas',
    nome_modalidade: 'Iniciação Científica',
    nome_area: 'Ciências Biológicas e Saúde',
    nota_final_media: 9.40,
    nota_desempate_media: 4.7,
    avaliacoes_count: 3,
  },
  {
    id_projeto: 'proj-005',
    titulo: 'Aplicativo de Acessibilidade Libras para Atendimento Público',
    estande: 'EST-D08',
    nome_instituicao: 'IFMS - Câmpus Aquidauana',
    nome_modalidade: 'Inovação Tecnológica',
    nome_area: 'Engenharias e Exatas',
    nota_final_media: 9.90,
    nota_desempate_media: 5.0,
    avaliacoes_count: 3,
  },
];

export const RankingPremiacao: React.FC<{ id_evento_ativo?: string }> = ({
  id_evento_ativo = 'evt-2026-ifms',
}) => {
  const [projetos_ranking, set_projetos_ranking] = useState<ItemProjetoRanking[]>([]);
  const [carregando_ranking, set_carregando_ranking] = useState<boolean>(true);
  const [filtro_modalidade, set_filtro_modalidade] = useState<string>('todas');
  const [filtro_area, set_filtro_area] = useState<string>('todas');

  const conexao_banco_configurada = verificar_conexao_configurada();

  // 1. Busca no Supabase os projetos e avaliações consolidadas
  const buscar_dados_ranking = async () => {
    set_carregando_ranking(true);

    if (!conexao_banco_configurada) {
      set_projetos_ranking(dados_contingencia_ranking);
      set_carregando_ranking(false);
      return;
    }

    try {
      // Query relacional dos projetos com modalidades, áreas e avaliações
      const { data: dados_projetos, error: erro_projetos } = await supabase
        .from('projetos')
        .select(`
          id_projeto,
          id,
          titulo,
          titulo_projeto,
          estande,
          nome_instituicao,
          area_conhecimento,
          modalidade,
          modalidades (nome_modalidade),
          areas_tematicas (nome_area),
          avaliacoes (nota_final, nota_desempate)
        `);

      if (erro_projetos || !dados_projetos || dados_projetos.length === 0) {
        console.warn('Utilizando dados de contingência para o ranking:', erro_projetos?.message);
        set_projetos_ranking(dados_contingencia_ranking);
      } else {
        const ranking_processado: ItemProjetoRanking[] = dados_projetos.map((item: any) => {
          const lista_avaliacoes: any[] = item.avaliacoes || [];
          const qtd_aval = lista_avaliacoes.length;

          let soma_nota_final = 0;
          let soma_nota_desempate = 0;

          lista_avaliacoes.forEach((a) => {
            soma_nota_final += Number(a.nota_final || 0);
            soma_nota_desempate += Number(a.nota_desempate || a.nota_final || 0);
          });

          const media_final = qtd_aval > 0 ? Number((soma_nota_final / qtd_aval).toFixed(2)) : 0;
          const media_desempate = qtd_aval > 0 ? Number((soma_nota_desempate / qtd_aval).toFixed(2)) : 0;

          const modalidade_nome =
            item.modalidades?.nome_modalidade || item.modalidade || 'Pesquisa Geral';

          const area_nome =
            item.areas_tematicas?.nome_area || item.area_conhecimento || 'Multidisciplinar';

          return {
            id_projeto: item.id_projeto || item.id,
            titulo: item.titulo || item.titulo_projeto || 'Projeto IFMS',
            estande: item.estande || 'EST-00',
            nome_instituicao: item.nome_instituicao || 'IFMS',
            nome_modalidade: modalidade_nome,
            nome_area: area_nome,
            nota_final_media: media_final,
            nota_desempate_media: media_desempate,
            avaliacoes_count: qtd_aval,
          };
        });

        set_projetos_ranking(ranking_processado);
      }
    } catch (e) {
      console.error('Erro ao carregar ranking:', e);
      set_projetos_ranking(dados_contingencia_ranking);
    } finally {
      set_carregando_ranking(false);
    }
  };

  useEffect(() => {
    buscar_dados_ranking();
  }, [conexao_banco_configurada]);

  // 2. Agrupamento obrigatório por Modalidade e por Área Temática + Aplicação da Regra de Desempate Estrita
  const grupos_agrupados_classificados = useMemo(() => {
    // Filtro inicial
    const projetos_filtrados = projetos_ranking.filter((item) => {
      const atende_mod = filtro_modalidade === 'todas' || item.nome_modalidade === filtro_modalidade;
      const atende_area = filtro_area === 'todas' || item.nome_area === filtro_area;
      return atende_mod && atende_area;
    });

    // Agrupa por Modalidade -> Área Temática
    const mapa_agrupado: Record<string, Record<string, ItemProjetoRanking[]>> = {};

    projetos_filtrados.forEach((proj) => {
      const mod = proj.nome_modalidade;
      const area = proj.nome_area;

      if (!mapa_agrupado[mod]) {
        mapa_agrupado[mod] = {};
      }
      if (!mapa_agrupado[mod][area]) {
        mapa_agrupado[mod][area] = [];
      }

      mapa_agrupado[mod][area].push(proj);
    });

    // Aplica Regra Estrita de Ordenação/Desempate em cada subgrupo:
    // 1º Critério: Maior nota_final_media
    // 2º Critério: Maior nota_desempate_media
    Object.keys(mapa_agrupado).forEach((mod) => {
      Object.keys(mapa_agrupado[mod]).forEach((area) => {
        mapa_agrupado[mod][area].sort((a, b) => {
          if (b.nota_final_media !== a.nota_final_media) {
            return b.nota_final_media - a.nota_final_media;
          }
          return b.nota_desempate_media - a.nota_desempate_media;
        });
      });
    });

    return mapa_agrupado;
  }, [projetos_ranking, filtro_modalidade, filtro_area]);

  // Lista de modalidades para filtro
  const lista_modalidades_unicas = useMemo(() => {
    return Array.from(new Set(projetos_ranking.map((p) => p.nome_modalidade)));
  }, [projetos_ranking]);

  // Lista de áreas para filtro
  const lista_areas_unicas = useMemo(() => {
    return Array.from(new Set(projetos_ranking.map((p) => p.nome_area)));
  }, [projetos_ranking]);

  // Exportar ranking em CSV
  const exportar_csv_ranking = () => {
    let csv_conteudo = 'Modalidade,Área Temática,Posição,Estande,Título do Projeto,Instituição,Média Ponderada,Nota Desempate\n';

    Object.keys(grupos_agrupados_classificados).forEach((mod) => {
      Object.keys(grupos_agrupados_classificados[mod]).forEach((area) => {
        grupos_agrupados_classificados[mod][area].forEach((item, index) => {
          csv_conteudo += `"${mod}","${area}",${index + 1},"1","${item.estande}","${item.titulo.replace(/"/g, '""')}","${item.nome_instituicao}",${item.nota_final_media},${item.nota_desempate_media}\n`;
        });
      });
    });

    const blob = new Blob([csv_conteudo], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'ranking_oficial_premiacao_ifms.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans">
      {/* Cabeçalho do Ranking */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            Ranking Oficial de Premiação da Feira
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Classificação agrupada por Modalidade e Área Temática com aplicação da Regra de Desempate Estrita.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={buscar_dados_ranking}
            disabled={carregando_ranking}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600"
          >
            <RefreshCw className={`w-4 h-4 ${carregando_ranking ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={exportar_csv_ranking}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Ranking (.CSV)
          </button>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
        <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5 shrink-0 uppercase">
          <SlidersHorizontal className="w-4 h-4" /> Filtros do Pódio:
        </span>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <select
            value={filtro_modalidade}
            onChange={(e) => set_filtro_modalidade(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none"
          >
            <option value="todas">Todas as Modalidades</option>
            {lista_modalidades_unicas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            value={filtro_area}
            onChange={(e) => set_filtro_area(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none"
          >
            <option value="todas">Todas as Áreas Temáticas</option>
            {lista_areas_unicas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Carregamento */}
      {carregando_ranking && (
        <div className="p-12 text-center space-y-2">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">
            Processando algoritmo de desempate e ordenação no Supabase...
          </p>
        </div>
      )}

      {/* RENDERIZAÇÃO DO PÓDIO AGRUPADO */}
      {!carregando_ranking && (
        <div className="space-y-8">
          {Object.keys(grupos_agrupados_classificados).length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">
              Nenhum resultado para os filtros selecionados.
            </div>
          ) : (
            Object.keys(grupos_agrupados_classificados).map((modalidade_nome) => (
              <div key={modalidade_nome} className="space-y-6">
                {/* Título da Modalidade */}
                <div className="flex items-center gap-2 border-b-2 border-emerald-500 pb-2">
                  <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    Modalidade: {modalidade_nome}
                  </h3>
                </div>

                {/* Subgrupos de Áreas Temáticas */}
                {Object.keys(grupos_agrupados_classificados[modalidade_nome]).map((area_nome) => {
                  const lista_ordenada = grupos_agrupados_classificados[modalidade_nome][area_nome];

                  return (
                    <div key={area_nome} className="bg-slate-50 dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-700/80 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                          Área Temática: {area_nome}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {lista_ordenada.length} projetos concorrentes
                        </span>
                      </div>

                      {/* 4. RENDERIZAÇÃO VISUAL DO PÓDIO DESTACADO (🥇🥈🥉) */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {lista_ordenada.slice(0, 3).map((item, index) => {
                          const posicao = index + 1;

                          // Estilos personalizados para 1º, 2º e 3º colocados
                          const is_ouro = posicao === 1;
                          const is_prata = posicao === 2;
                          const is_bronze = posicao === 3;

                          const card_bg = is_ouro
                            ? 'bg-gradient-to-br from-amber-100 via-amber-50 to-amber-100/80 dark:from-amber-950/60 dark:to-amber-900/40 border-amber-300 dark:border-amber-700'
                            : is_prata
                            ? 'bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200/80 dark:from-slate-800 dark:to-slate-800/60 border-slate-300 dark:border-slate-600'
                            : 'bg-gradient-to-br from-orange-100 via-orange-50 to-orange-100/80 dark:from-orange-950/60 dark:to-orange-900/40 border-orange-300 dark:border-orange-800';

                          const medalha_icone = is_ouro ? '🥇' : is_prata ? '🥈' : '🥉';
                          const medalha_titulo = is_ouro ? '1º LUGAR (OURO)' : is_prata ? '2º LUGAR (PRATA)' : '3º LUGAR (BRONZE)';

                          return (
                            <div
                              key={item.id_projeto}
                              className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between space-y-3 relative overflow-hidden ${card_bg}`}
                            >
                              <div className="space-y-2">
                                {/* Posição e Medalha */}
                                <div className="flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-white/80 dark:bg-slate-900/80 shadow-xs border">
                                    <span className="text-base">{medalha_icone}</span>
                                    <span>{medalha_titulo}</span>
                                  </span>

                                  <span className="font-mono text-xs font-extrabold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2 py-0.5 rounded-md">
                                    {item.estande}
                                  </span>
                                </div>

                                {/* Título do Projeto */}
                                <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug pt-1">
                                  {item.titulo}
                                </h4>

                                <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                                  <Building className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                  <span>{item.nome_instituicao}</span>
                                </p>
                              </div>

                              {/* Pontuações com Regra de Desempate */}
                              <div className="pt-3 border-t border-slate-300/60 dark:border-slate-700/60 space-y-1">
                                <div className="flex items-center justify-between text-xs font-extrabold">
                                  <span className="text-slate-700 dark:text-slate-300">1º Critério (Média):</span>
                                  <span className="font-mono text-emerald-700 dark:text-emerald-400 text-sm">
                                    {item.nota_final_media.toFixed(2)} pts
                                  </span>
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                  <span>2º Critério (Desempate):</span>
                                  <span className="font-mono font-bold">{item.nota_desempate_media.toFixed(2)} pts</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
