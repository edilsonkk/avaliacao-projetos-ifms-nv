import React from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { formatarDataHora } from '@/lib/formatoData';
import type { GrupoImpedimento } from '../impedimentos';

/**
 * Aba de impedimentos agrupada por avaliador, usada por **dois** relatórios de forma idêntica:
 * "Avaliadores e Ausências Atribuídas" (`historico_impedimentos.tipo = 'ausencia'`) e
 * "Avaliadores e Devoluções Atribuídas" (`tipo = 'conflito'`, o botão "Devolver (Conflito de
 * Interesse)" da tela do avaliador).
 *
 * Os dois têm a mesma origem, as mesmas colunas e o mesmo accordion; só os rótulos mudam. Por isso
 * existe um componente, com os textos vindo por `rotulos`, em vez de dois blocos iguais dentro de
 * `RelatoriosAdmin` — que já passa de 2,9 mil linhas.
 *
 * Nunca mostra estande nem UUID (regra 6 do AGENTS.md): o projeto aparece pelo `codigo_projeto`.
 */

export interface RotulosImpedimento {
  /** "Total de Avaliadores com Ausências:" */
  totalAvaliadores: string;
  /** "ausência atribuída" / "ausências atribuídas" */
  unidadeSingular: string;
  unidadePlural: string;
  /** "Nenhuma ausência registrada com os filtros informados." */
  vazioComFiltro: string;
  /** "Nenhuma ausência registrada no evento." */
  vazioNoEvento: string;
  /** Cabeçalho da coluna do projeto: "Projeto Marcado como Ausente" */
  colunaProjeto: string;
  /** Cabeçalho da coluna de data: "Data / Hora Ausência" */
  colunaData: string;
  /** Título da lista recuada: "Projetos Marcados como Ausente" */
  tituloLista: string;
  /** Linha do resumo de impressão: "Total de Ausências Atribuídas" */
  totalPorAvaliador: string;
}

interface PropriedadesAbaImpedimentos {
  /** Grupos filtrados e ordenados, para a tela. */
  grupos: GrupoImpedimento[];
  /** Todos os grupos ordenados, para a impressão (100% dos registros do evento). */
  gruposParaImpressao: GrupoImpedimento[];
  expandidos: Set<string>;
  aoAlternar: (idUsuario: string) => void;
  aoAlternarTodos: (expandir: boolean, todosIds: string[]) => void;
  rotulos: RotulosImpedimento;
  /** Ícone do avaliador no cabeçalho do accordion. */
  icone: React.ReactNode;
}

/** Situação atual do projeto: recebeu nota depois do impedimento ou seguiu sem nenhuma. */
const statusDoProjeto = (total: number): string =>
  total > 0 ? `Avaliado (${total} ${total === 1 ? 'avaliação' : 'avaliações'})` : 'Permanece sem avaliação';

export const AbaImpedimentos: React.FC<PropriedadesAbaImpedimentos> = ({
  grupos,
  gruposParaImpressao,
  expandidos,
  aoAlternar,
  aoAlternarTodos,
  rotulos,
  icone,
}) => (
  <>
    <div className="space-y-4 print:hidden">
      {/* Barra de Ações do Accordion */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
          {rotulos.totalAvaliadores} <strong className="text-slate-900 dark:text-white">{grupos.length}</strong>
        </span>
        <div className="flex items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => aoAlternarTodos(true, grupos.map((g) => g.id_usuario))}
            className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Expandir Todos
          </button>
          <button
            type="button"
            onClick={() => aoAlternarTodos(false, [])}
            className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Recolher Todos
          </button>
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="p-12 text-center text-slate-500 font-semibold border border-slate-200 dark:border-slate-700 rounded-2xl">
          {rotulos.vazioComFiltro}
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map((grupo) => {
            const expandido = expandidos.has(grupo.id_usuario);

            return (
              <div
                key={grupo.id_usuario}
                className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-2xs transition-all print:border-0 print:border-b print:border-slate-300 print:rounded-none print:shadow-none print-avoid-break print:pb-3 print:mb-3"
              >
                {/* Linha do Avaliador (Cabeçalho Accordion) */}
                <div
                  onClick={() => aoAlternar(grupo.id_usuario)}
                  className="p-4 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors select-none print:bg-transparent print:p-0 print:border-none print:cursor-default"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 print:hidden">
                      {icone}
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-900 dark:text-white print:text-black print:text-sm">
                        {grupo.avaliador_nome}
                      </h3>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-600">
                        {grupo.avaliador_email}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-semibold print:hidden">
                    <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[11px] font-bold">
                      {grupo.total} {grupo.total === 1 ? rotulos.unidadeSingular : rotulos.unidadePlural}
                    </span>
                    <div className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                      {expandido ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </div>
                  </div>

                  {/* Resumo textual do avaliador exclusivo para impressão em PDF */}
                  <div className="hidden print:block text-right text-xs font-semibold text-slate-800">
                    <span>
                      {grupo.total} {grupo.total === 1 ? rotulos.unidadeSingular : rotulos.unidadePlural}
                    </span>
                  </div>
                </div>

                {/* Projetos do impedimento */}
                <div
                  className={`${expandido ? 'block' : 'hidden'} print:block overflow-x-auto border-t border-slate-200 dark:border-slate-700 print:border-none print:mt-1`}
                >
                  {/* Tabela interativa para tela */}
                  <table className="w-full text-left text-xs bg-white dark:bg-slate-800 print:hidden">
                    <caption className="sr-only">
                      {rotulos.tituloLista} de {grupo.avaliador_nome}
                    </caption>
                    <thead className="bg-slate-100/60 dark:bg-slate-900/40 text-slate-500 uppercase font-extrabold text-[10px]">
                      <tr>
                        <th className="px-4 py-2.5">Código</th>
                        <th className="px-4 py-2.5">{rotulos.colunaProjeto}</th>
                        <th className="px-4 py-2.5">Modalidade / Área</th>
                        <th className="px-4 py-2.5 text-center">{rotulos.colunaData}</th>
                        <th className="px-4 py-2.5 text-center">Status Atual do Projeto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {grupo.itens.map((item, idx) => (
                        <tr
                          key={`${item.id_projeto}_${idx}`}
                          className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                        >
                          <td className="px-4 py-3 font-mono">
                            <span className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-[11px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                              {item.codigo_projeto || 'N/I'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-slate-900 dark:text-white block">{item.projeto_titulo}</span>
                            {item.projeto_instituicao && (
                              <span className="text-[10px] text-slate-500 block truncate">{item.projeto_instituicao}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                              {item.projeto_modalidade || 'Sem modalidade'}
                            </span>
                            <span className="text-[10px] text-slate-500">{item.projeto_area || 'Sem área temática'}</span>
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {formatarDataHora(item.data_registro)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.total_avaliacoes_atuais > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                Avaliado ({item.total_avaliacoes_atuais} aval.)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                                Permanece sem avaliação
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Lista textual recuada exclusiva para impressão em PDF */}
                  <div className="hidden print:block ml-6 pl-3 border-l-2 border-slate-400 space-y-1.5 pt-1 text-xs text-slate-800">
                    <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                      {rotulos.tituloLista} ({grupo.itens.length}):
                    </span>
                    {grupo.itens.map((item, idx) => (
                      <div key={`${item.id_projeto}_${idx}`} className="space-y-0.5">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-bold text-slate-900">
                            • [{item.codigo_projeto || 'N/I'}] {item.projeto_titulo}
                          </span>
                          {(item.projeto_modalidade || item.projeto_area) && (
                            <span className="text-[10px] text-slate-600">
                              ({[item.projeto_modalidade, item.projeto_area].filter(Boolean).join(' • ')})
                            </span>
                          )}
                          {item.projeto_instituicao && (
                            <span className="text-[10px] text-slate-600">— {item.projeto_instituicao}</span>
                          )}
                          <span className="text-[10px] text-slate-600 font-mono">
                            [Registro: {formatarDataHora(item.data_registro)}]
                          </span>
                          <span className="text-[10px] font-semibold text-slate-900">
                            — Status: {statusDoProjeto(item.total_avaliacoes_atuais)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>

    {/* LISTA PURAMENTE TEXTUAL EXCLUSIVA PARA IMPRESSÃO EM PDF (100% DOS DADOS) */}
    <div className="hidden print:block space-y-3">
      {gruposParaImpressao.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-4">{rotulos.vazioNoEvento}</p>
      ) : (
        gruposParaImpressao.map((grupo) => (
          <div key={grupo.id_usuario} className="border-b border-slate-300 pb-2 mb-2 print-avoid-break text-xs">
            <div className="font-bold text-slate-900 text-sm">
              {grupo.avaliador_nome} ({grupo.avaliador_email})
            </div>
            <div className="text-[11px] text-slate-700 font-medium">
              {rotulos.totalPorAvaliador}: {grupo.total}
            </div>
            <div className="ml-6 border-l-2 border-slate-400 pl-3 mt-1.5 space-y-1 text-[10px] text-slate-800">
              <span className="font-bold text-[10px] text-slate-900 uppercase tracking-wider block">
                {rotulos.tituloLista} ({grupo.itens.length}):
              </span>
              {grupo.itens.length === 0 ? (
                <p className="italic text-slate-500">{rotulos.vazioNoEvento}</p>
              ) : (
                grupo.itens.map((item, idx) => (
                  <div key={`${item.id_projeto}_${idx}`} className="space-y-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-bold text-slate-900">
                        • [{item.codigo_projeto || 'N/I'}] {item.projeto_titulo}
                      </span>
                      {(item.projeto_modalidade || item.projeto_area) && (
                        <span className="text-[10px] text-slate-600">
                          ({[item.projeto_modalidade, item.projeto_area].filter(Boolean).join(' • ')})
                        </span>
                      )}
                      {item.projeto_instituicao && (
                        <span className="text-[10px] text-slate-600">— {item.projeto_instituicao}</span>
                      )}
                      <span className="text-[10px] text-slate-600 font-mono">
                        [Registro: {formatarDataHora(item.data_registro)}]
                      </span>
                      <span className="text-[10px] font-semibold text-slate-900">
                        — Status: {statusDoProjeto(item.total_avaliacoes_atuais)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))
      )}
    </div>
  </>
);
