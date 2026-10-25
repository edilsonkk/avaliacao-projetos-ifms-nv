import React, { useState, useEffect, useMemo } from 'react';
import {
  Trophy,
  Award,
  RefreshCw,
  SlidersHorizontal,
  Loader2,
  Building,
  FileSpreadsheet
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export interface ItemRankingTop3 {
  id_projeto: string;
  codigo_projeto?: string | null;
  titulo: string;
  estande: string;
  nome_instituicao?: string | null;
  modalidade: string;
  area_tematica: string;
  notas: number[];
  media_geral: number;
  total_avaliacoes?: number;
}

// Contingência vazia para view_ranking_top3
const dados_contingencia_ranking: ItemRankingTop3[] = [];

export const RankingPremiacao: React.FC<{ id_evento_ativo?: string }> = () => {
  const [projetos_ranking, set_projetos_ranking] = useState<ItemRankingTop3[]>([]);
  const [carregando_ranking, set_carregando_ranking] = useState<boolean>(true);
  const [filtro_modalidade, set_filtro_modalidade] = useState<string>('todas');
  const [filtro_area, set_filtro_area] = useState<string>('todas');

  const conexao_banco_configurada = verificar_conexao_configurada();

  // 1. Regra Obrigatória: Consome EXCLUSIVAMENTE a view view_ranking_top3 do Supabase
  const buscar_dados_ranking = async () => {
    set_carregando_ranking(true);

    if (!conexao_banco_configurada) {
      set_projetos_ranking([]);
      set_carregando_ranking(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('view_ranking_top3')
        .select('*');

      if (error || !data || data.length === 0) {
        console.warn('Consulta à view_ranking_top3:', error?.message);
        set_projetos_ranking([]);
      } else {
        const formatados: ItemRankingTop3[] = data.map((item: any) => {
          let notasArray: number[] = [];
          if (Array.isArray(item.notas)) {
            notasArray = item.notas.map((n: any) => Number(n));
          } else if (typeof item.notas === 'string') {
            try {
              const parsed = JSON.parse(item.notas);
              if (Array.isArray(parsed)) notasArray = parsed.map(Number);
            } catch {
              notasArray = [];
            }
          }

          return {
            id_projeto: item.id_projeto || item.id || crypto.randomUUID(),
            codigo_projeto: item.codigo_projeto || null,
            titulo: item.titulo || item.titulo_projeto || 'Projeto Sem Título',
            estande: item.estande || 'EST-00',
            nome_instituicao: item.nome_instituicao || 'IFMS',
            modalidade: item.modalidade || item.nome_modalidade || 'Geral',
            area_tematica: item.area_tematica || item.area_conhecimento || 'Multidisciplinar',
            notas: notasArray,
            // A média geral vem EXCLUSIVAMENTE do banco de dados (PROIBIDO calcular no JS)
            media_geral: Number(item.media_geral ?? item.media_final ?? item.media_notas ?? 0),
            total_avaliacoes: item.total_avaliacoes ?? notasArray.length,
          };
        });

        set_projetos_ranking(formatados);
      }
    } catch (e) {
      console.error('Erro ao consultar view_ranking_top3:', e);
      set_projetos_ranking([]);
    } finally {
      set_carregando_ranking(false);
    }
  };

  useEffect(() => {
    buscar_dados_ranking();
  }, [conexao_banco_configurada]);

  // Agrupamento por Modalidade e Área Temática
  const grupos_agrupados_classificados = useMemo(() => {
    const filtrados = projetos_ranking.filter((item) => {
      const atende_mod = filtro_modalidade === 'todas' || item.modalidade === filtro_modalidade;
      const atende_area = filtro_area === 'todas' || item.area_tematica === filtro_area;
      return atende_mod && atende_area;
    });

    const mapa: Record<string, Record<string, ItemRankingTop3[]>> = {};

    filtrados.forEach((proj) => {
      const mod = proj.modalidade;
      const area = proj.area_tematica;
      if (!mapa[mod]) mapa[mod] = {};
      if (!mapa[mod][area]) mapa[mod][area] = [];
      mapa[mod][area].push(proj);
    });

    // Ordenação estrita pela média geral já provida pela view
    Object.keys(mapa).forEach((mod) => {
      Object.keys(mapa[mod]).forEach((area) => {
        mapa[mod][area].sort((a, b) => b.media_geral - a.media_geral);
      });
    });

    return mapa;
  }, [projetos_ranking, filtro_modalidade, filtro_area]);

  const lista_modalidades_unicas = useMemo(() => {
    return Array.from(new Set(projetos_ranking.map((p) => p.modalidade)));
  }, [projetos_ranking]);

  const lista_areas_unicas = useMemo(() => {
    return Array.from(new Set(projetos_ranking.map((p) => p.area_tematica)));
  }, [projetos_ranking]);

  const exportar_csv_ranking = () => {
    let csv_conteudo = 'Modalidade,Área Temática,Posição,Código,Estande,Título do Projeto,Instituição,Notas,Média Geral\n';

    Object.keys(grupos_agrupados_classificados).forEach((mod) => {
      Object.keys(grupos_agrupados_classificados[mod]).forEach((area) => {
        grupos_agrupados_classificados[mod][area].forEach((item, index) => {
          const notasStr = item.notas.join('; ');
          csv_conteudo += `"${mod}","${area}",${index + 1},"${item.codigo_projeto || 'N/I'}","${item.estande}","${item.titulo.replace(/"/g, '""')}","${item.nome_instituicao || ''}","${notasStr}",${item.media_geral}\n`;
        });
      });
    });

    const blob = new Blob([csv_conteudo], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'ranking_top3_oficial_ifms.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans">
      {/* 3. LIMPEZA VISUAL DO CABEÇALHO: Sem subtítulos explicativos, apenas Título e Ações */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 shadow-xs">
            <Trophy className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            Ranking de Premiação
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={buscar_dados_ranking}
            disabled={carregando_ranking}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-all cursor-pointer"
            title="Atualizar Ranking"
          >
            <RefreshCw className={`w-4 h-4 ${carregando_ranking ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={exportar_csv_ranking}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Ranking (.CSV)
          </button>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
        <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5 shrink-0 uppercase">
          <SlidersHorizontal className="w-4 h-4" /> Filtros:
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
            Consultando view_ranking_top3 no Supabase...
          </p>
        </div>
      )}

      {/* Tabela e Pódio com view_ranking_top3 */}
      {!carregando_ranking && (
        <div className="space-y-8">
          {Object.keys(grupos_agrupados_classificados).length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">
              Nenhum projeto encontrado para os filtros selecionados.
            </div>
          ) : (
            Object.keys(grupos_agrupados_classificados).map((modalidade_nome) => (
              <div key={modalidade_nome} className="space-y-6">
                <div className="flex items-center gap-2 border-b-2 border-emerald-500 pb-2">
                  <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {modalidade_nome}
                  </h3>
                </div>

                {Object.keys(grupos_agrupados_classificados[modalidade_nome]).map((area_nome) => {
                  const lista_ordenada = grupos_agrupados_classificados[modalidade_nome][area_nome];

                  return (
                    <div key={area_nome} className="bg-slate-50 dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-700/80 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                          {area_nome}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {lista_ordenada.length} projetos
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {lista_ordenada.slice(0, 3).map((item, index) => {
                          const posicao = index + 1;
                          const is_ouro = posicao === 1;
                          const is_prata = posicao === 2;

                          const card_bg = is_ouro
                            ? 'bg-gradient-to-br from-amber-100 via-amber-50 to-amber-100/80 dark:from-amber-950/60 dark:to-amber-900/40 border-amber-300 dark:border-amber-700'
                            : is_prata
                            ? 'bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200/80 dark:from-slate-800 dark:to-slate-800/60 border-slate-300 dark:border-slate-600'
                            : 'bg-gradient-to-br from-orange-100 via-orange-50 to-orange-100/80 dark:from-orange-950/60 dark:to-orange-900/40 border-orange-300 dark:border-orange-800';

                          const medalha_icone = is_ouro ? '🥇' : is_prata ? '🥈' : '🥉';
                          const medalha_titulo = is_ouro ? '1º Lugar' : is_prata ? '2º Lugar' : '3º Lugar';

                          return (
                            <div
                              key={item.id_projeto}
                              className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between space-y-3 relative overflow-hidden ${card_bg}`}
                            >
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-white/80 dark:bg-slate-900/80 shadow-xs border">
                                    <span className="text-base">{medalha_icone}</span>
                                    <span>{medalha_titulo}</span>
                                  </span>

                                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
                                    {item.codigo_projeto && (
                                      <span className="bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-md">
                                        {item.codigo_projeto}
                                      </span>
                                    )}
                                    <span className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2 py-0.5 rounded-md">
                                      {item.estande}
                                    </span>
                                  </div>
                                </div>

                                <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug pt-1">
                                  {item.titulo}
                                </h4>

                                {item.nome_instituicao && (
                                  <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                                    <Building className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                    <span>{item.nome_instituicao}</span>
                                  </p>
                                )}
                              </div>

                              {/* Notas e Média Geral fornecidas diretamente pela view_ranking_top3 */}
                              <div className="pt-3 border-t border-slate-300/60 dark:border-slate-700/60 space-y-2">
                                {item.notas && item.notas.length > 0 && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] font-bold uppercase text-slate-500">Notas:</span>
                                    {item.notas.map((n, i) => (
                                      <span
                                        key={i}
                                        className="px-1.5 py-0.5 rounded bg-white/90 dark:bg-slate-800 text-[10px] font-mono font-bold border border-slate-300 dark:border-slate-600"
                                      >
                                        {Number(n).toFixed(2)}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                <div className="flex items-center justify-between text-xs font-extrabold pt-1">
                                  <span className="text-slate-700 dark:text-slate-300">Média Geral:</span>
                                  <span className="font-mono text-emerald-700 dark:text-emerald-400 text-base font-black">
                                    {item.media_geral.toFixed(2)} pts
                                  </span>
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
