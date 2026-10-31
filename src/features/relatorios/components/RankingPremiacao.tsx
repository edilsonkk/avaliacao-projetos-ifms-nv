import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Trophy,
  Award,
  RefreshCw,
  SlidersHorizontal,
  Loader2,
  Building,
  FileSpreadsheet,
  AlertTriangle,
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { buscarTodas } from '@/lib/buscarTodas';
import { tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { compararNatural } from '@/components/ui/CabecalhoOrdenavel';
import { baixarCsv } from '@/lib/csv';

export interface ItemRankingTop3 {
  id_projeto: string;
  codigo_projeto: string | null;
  titulo: string;
  estande: string | null;
  nome_instituicao: string | null;
  modalidade: string;
  area_tematica: string;
  notas: number[];
  media_geral: number;
  total_avaliacoes: number;
  /** Posição dentro da modalidade e área, calculada no banco (empate divide a posição). */
  posicao: number;
  /** Notas divergentes ainda não auditadas na Quarentena. */
  em_quarentena: boolean;
  /** Médias por pergunta, na ordem de prioridade de desempate definida no questionário. */
  chave_desempate: number[];
}

const COLUNAS_RANKING =
  'id_projeto, codigo_projeto, titulo, estande, nome_instituicao, modalidade, area_tematica, notas, media_geral, total_avaliacoes, posicao, em_quarentena, chave_desempate';

const lerNotas = (valor: unknown): number[] => {
  if (Array.isArray(valor)) return valor.map(Number);
  if (typeof valor === 'string') {
    try {
      const lista = JSON.parse(valor);
      return Array.isArray(lista) ? lista.map(Number) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const MEDALHAS: Record<number, { icone: string; classe: string }> = {
  1: {
    icone: '🥇',
    classe: 'bg-gradient-to-br from-amber-100 via-amber-50 to-amber-100/80 dark:from-amber-950/60 dark:to-amber-900/40 border-amber-300 dark:border-amber-700',
  },
  2: {
    icone: '🥈',
    classe: 'bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200/80 dark:from-slate-800 dark:to-slate-800/60 border-slate-300 dark:border-slate-600',
  },
  3: {
    icone: '🥉',
    classe: 'bg-gradient-to-br from-orange-100 via-orange-50 to-orange-100/80 dark:from-orange-950/60 dark:to-orange-900/40 border-orange-300 dark:border-orange-800',
  },
};

export const RankingPremiacao: React.FC<{ id_evento_ativo?: string }> = ({ id_evento_ativo }) => {
  const idEvento = id_evento_ativo || '';
  const [projetos_ranking, set_projetos_ranking] = useState<ItemRankingTop3[]>([]);
  const [carregando_ranking, set_carregando_ranking] = useState<boolean>(true);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [filtro_modalidade, set_filtro_modalidade] = useState<string>('todas');
  const [filtro_area, set_filtro_area] = useState<string>('todas');

  const conexao_banco_configurada = verificar_conexao_configurada();

  const buscar_dados_ranking = useCallback(async () => {
    if (!conexao_banco_configurada || !idEvento) {
      set_projetos_ranking([]);
      set_carregando_ranking(false);
      return;
    }
    set_carregando_ranking(true);
    set_mensagem_erro(null);
    try {
      const linhas = await buscarTodas<Record<string, unknown>>(() =>
        supabase.from('view_ranking_top3').select(COLUNAS_RANKING).eq('id_evento', idEvento).order('id_projeto', { ascending: true })
      );
      // Médias e posições vêm do banco; o front só agrupa e exibe
      set_projetos_ranking(
        linhas.map((item) => ({
          id_projeto: String(item.id_projeto),
          codigo_projeto: (item.codigo_projeto as string) || null,
          titulo: (item.titulo as string) || 'Projeto sem título',
          estande: (item.estande as string) || null,
          nome_instituicao: (item.nome_instituicao as string) || null,
          modalidade: (item.modalidade as string) || 'Sem modalidade',
          area_tematica: (item.area_tematica as string) || 'Sem área temática',
          notas: lerNotas(item.notas),
          media_geral: Number(item.media_geral ?? 0),
          total_avaliacoes: Number(item.total_avaliacoes ?? 0),
          posicao: Number(item.posicao ?? 0),
          em_quarentena: item.em_quarentena === true,
          chave_desempate: lerNotas(item.chave_desempate),
        }))
      );
    } catch (e) {
      console.error('Erro ao consultar view_ranking_top3:', e);
      set_projetos_ranking([]);
      set_mensagem_erro(`Não foi possível carregar a classificação: ${tratarErroEscritaAdmin(e)}`);
    } finally {
      set_carregando_ranking(false);
    }
  }, [conexao_banco_configurada, idEvento]);

  useEffect(() => {
    buscar_dados_ranking();
  }, [buscar_dados_ranking]);

  // Agrupamento por modalidade e área, na ordem da posição calculada no banco
  const grupos_agrupados_classificados = useMemo(() => {
    const mapa: Record<string, Record<string, ItemRankingTop3[]>> = {};
    projetos_ranking
      .filter(
        (item) =>
          (filtro_modalidade === 'todas' || item.modalidade === filtro_modalidade) &&
          (filtro_area === 'todas' || item.area_tematica === filtro_area)
      )
      .forEach((proj) => {
        mapa[proj.modalidade] ??= {};
        (mapa[proj.modalidade][proj.area_tematica] ??= []).push(proj);
      });
    Object.values(mapa).forEach((areas) =>
      Object.values(areas).forEach((lista) =>
        lista.sort((a, b) => a.posicao - b.posicao || compararNatural(a.codigo_projeto || '', b.codigo_projeto || ''))
      )
    );
    return mapa;
  }, [projetos_ranking, filtro_modalidade, filtro_area]);

  const modalidades_ordenadas = useMemo(
    () => Object.keys(grupos_agrupados_classificados).sort(compararNatural),
    [grupos_agrupados_classificados]
  );

  const lista_modalidades_unicas = useMemo(
    () => Array.from(new Set(projetos_ranking.map((p) => p.modalidade))).sort(compararNatural),
    [projetos_ranking]
  );

  const lista_areas_unicas = useMemo(
    () => Array.from(new Set(projetos_ranking.map((p) => p.area_tematica))).sort(compararNatural),
    [projetos_ranking]
  );

  const exportar_csv_ranking = () => {
    const linhas = [
      ['Modalidade', 'Área Temática', 'Posição', 'Código', 'Estande', 'Título do Projeto', 'Instituição', 'Notas', 'Média Geral', 'Em quarentena'],
    ];
    modalidades_ordenadas.forEach((mod) => {
      Object.keys(grupos_agrupados_classificados[mod])
        .sort(compararNatural)
        .forEach((area) => {
          grupos_agrupados_classificados[mod][area].forEach((item) => {
            linhas.push([
              mod,
              area,
              String(item.posicao),
              item.codigo_projeto || '',
              item.estande || '',
              item.titulo,
              item.nome_instituicao || '',
              item.notas.map((n) => n.toFixed(2)).join('; '),
              item.media_geral.toFixed(2),
              item.em_quarentena ? 'Sim' : 'Não',
            ]);
          });
        });
    });
    baixarCsv('classificacao_premiacao.csv', linhas);
  };

  const total_em_quarentena = projetos_ranking.filter((p) => p.em_quarentena && p.posicao <= 3).length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans">
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
            disabled={carregando_ranking || !idEvento}
            aria-label="Atualizar classificação"
            title="Atualizar classificação"
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-all cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${carregando_ranking ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={exportar_csv_ranking}
            disabled={projetos_ranking.length === 0}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Ranking (.CSV)
          </button>
        </div>
      </div>

      {!idEvento && (
        <div role="alert" className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs sm:text-sm text-amber-800 dark:text-amber-200 font-semibold">
          Não há evento ativo. A classificação é de cada evento: ative um evento para vê-la.
        </div>
      )}

      {mensagem_erro && (
        <div role="alert" className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl flex items-center gap-2 text-xs sm:text-sm text-red-800 dark:text-red-200 font-semibold">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          {mensagem_erro}
        </div>
      )}

      {total_em_quarentena > 0 && (
        <div role="alert" className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs sm:text-sm text-amber-800 dark:text-amber-200 font-semibold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {total_em_quarentena} projeto(s) do pódio estão em quarentena (notas divergentes). Resolva a quarentena antes de
          homologar.
        </div>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Projetos fora da competição não entram. Empate na média é desfeito pelas perguntas na ordem de prioridade de
        desempate definida no questionário; se tudo empatar, a posição é dividida e a comissão decide.
      </p>

      <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
        <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5 shrink-0 uppercase">
          <SlidersHorizontal className="w-4 h-4" /> Filtros:
        </span>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <select
            value={filtro_modalidade}
            onChange={(e) => set_filtro_modalidade(e.target.value)}
            aria-label="Filtrar por modalidade"
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            aria-label="Filtrar por área temática"
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
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

      {carregando_ranking && (
        <div className="p-12 text-center space-y-2">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">Carregando a classificação...</p>
        </div>
      )}

      {!carregando_ranking && idEvento && !mensagem_erro && (
        <div className="space-y-8">
          {modalidades_ordenadas.length === 0 ? (
            <div className="p-8 text-center text-xs font-semibold text-slate-500">
              {projetos_ranking.length === 0
                ? 'Nenhum projeto avaliado neste evento ainda.'
                : 'Nenhum projeto encontrado para os filtros selecionados.'}
            </div>
          ) : (
            modalidades_ordenadas.map((modalidade_nome) => (
              <section key={modalidade_nome} aria-label={modalidade_nome} className="space-y-6">
                <div className="flex items-center gap-2 border-b-2 border-emerald-500 pb-2">
                  <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {modalidade_nome}
                  </h3>
                </div>

                {Object.keys(grupos_agrupados_classificados[modalidade_nome])
                  .sort(compararNatural)
                  .map((area_nome) => {
                    const lista_ordenada = grupos_agrupados_classificados[modalidade_nome][area_nome];
                    // Pódio: todos com posição até 3 (um empate pode colocar mais de três)
                    const podio = lista_ordenada.filter((item) => item.posicao <= 3);

                    return (
                      <div key={area_nome} className="bg-slate-50 dark:bg-slate-900/40 p-5 rounded-3xl border border-slate-200 dark:border-slate-700/80 space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                            {area_nome}
                          </h4>
                          <span className="text-[11px] text-slate-500 font-mono">{lista_ordenada.length} projetos avaliados</span>
                        </div>

                        <ol className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {podio.map((item) => {
                            const medalha = MEDALHAS[item.posicao] ?? MEDALHAS[3];
                            const empatado = lista_ordenada.some((o) => o !== item && o.posicao === item.posicao);
                            const desempatado = lista_ordenada.some(
                              (o) => o !== item && o.media_geral === item.media_geral && o.posicao !== item.posicao
                            );
                            return (
                              <li
                                key={item.id_projeto}
                                aria-label={`${item.posicao}º lugar: ${item.titulo}`}
                                className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between space-y-3 relative overflow-hidden ${medalha.classe}`}
                              >
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-white/80 dark:bg-slate-900/80 shadow-xs border">
                                      <span className="text-base" aria-hidden="true">{medalha.icone}</span>
                                      <span>{item.posicao}º Lugar{empatado ? ' (empate)' : ''}</span>
                                    </span>
                                    {desempatado && (
                                      <span
                                        title={`Médias por pergunta, na ordem de prioridade: ${item.chave_desempate.map((n) => n.toFixed(2)).join(' · ')}`}
                                        className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800"
                                      >
                                        Desempate
                                      </span>
                                    )}

                                    <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
                                      {item.codigo_projeto && (
                                        <span className="bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-md">
                                          {item.codigo_projeto}
                                        </span>
                                      )}
                                      {item.estande && (
                                        <span className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-2 py-0.5 rounded-md">
                                          {item.estande}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {item.em_quarentena && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
                                      <AlertTriangle className="w-3 h-3" /> Em quarentena
                                    </span>
                                  )}

                                  <p className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug pt-1">{item.titulo}</p>

                                  {item.nome_instituicao && (
                                    <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                                      <Building className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                      <span>{item.nome_instituicao}</span>
                                    </p>
                                  )}
                                </div>

                                <div className="pt-3 border-t border-slate-300/60 dark:border-slate-700/60 space-y-2">
                                  {item.notas.length > 0 && (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[10px] font-bold uppercase text-slate-500">Notas:</span>
                                      {item.notas.map((n, i) => (
                                        <span
                                          key={i}
                                          className="px-1.5 py-0.5 rounded bg-white/90 dark:bg-slate-800 text-[10px] font-mono font-bold border border-slate-300 dark:border-slate-600"
                                        >
                                          {n.toFixed(2)}
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
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    );
                  })}
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
};
