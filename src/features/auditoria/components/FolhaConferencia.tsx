import React, { useMemo, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { Botao } from '@/components/ui';
import { formatarAjuste, formatarNota, formatarPeso } from '@/lib/formatoNota';
import { dataHoraBr, ROTULO_SEVERIDADE } from '../rotulos';
import type { MemorialProjeto } from '../tipos';
import { MemorialAvaliacao } from './MemorialAvaliacao';

/**
 * Folha de conferência: o documento que a comissão leva para a mesa e que instrui um recurso.
 *
 * Impressa por `window.print()` com uma raiz isolada (`#auditoria-print-root`), como os
 * Relatórios já fazem. Dois interruptores decidem o que sai no papel:
 *   * **Ocultar identidade dos avaliadores** — troca o nome por "Avaliador 1, 2, 3…". É o que
 *     se entrega a participante ou instituição.
 *   * **Incluir ajustes manuais** — a marca de ajuste sai do documento externo por padrão, mas
 *     ligar é um clique: num recurso sobre a nota ajustada, omitir trabalha contra a coordenação.
 */

const CSS_IMPRESSAO = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body > *:not(#auditoria-print-raiz) { display: none !important; }
  #auditoria-print-raiz { position: static !important; inset: auto !important; overflow: visible !important; background: #fff !important; }
  #auditoria-print-raiz .folha-projeto { break-inside: avoid; page-break-inside: avoid; }
  #auditoria-print-raiz .folha-projeto + .folha-projeto { break-before: page; page-break-before: always; }
}
`;

interface PropriedadesFolha {
  /** Uma folha por projeto, ou a consolidada do evento. */
  projeto?: MemorialProjeto;
  projetos?: MemorialProjeto[];
  nomeEvento?: string;
  aoFechar: () => void;
}

export const FolhaConferencia: React.FC<PropriedadesFolha> = ({ projeto, projetos, nomeEvento, aoFechar }) => {
  const [anonimo, setAnonimo] = useState(false);
  const [incluirAjustes, setIncluirAjustes] = useState(true);

  const lista = useMemo(() => projetos ?? (projeto ? [projeto] : []), [projeto, projetos]);
  const emitidaEm = useMemo(() => dataHoraBr(new Date().toISOString()), []);
  const consolidada = Boolean(projetos);

  return (
    <div
      id="auditoria-print-raiz"
      className="fixed inset-0 z-[60] overflow-y-auto bg-superficie p-6 print:p-0"
      role="dialog"
      aria-label={consolidada ? 'Folha de conferência do evento' : 'Folha de conferência do projeto'}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS_IMPRESSAO }} />

      <div className="mx-auto max-w-4xl space-y-5">
        {/* Controles: não saem no papel */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-cartao border border-borda bg-superficie-alta p-4 print:hidden">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-apoio font-semibold text-texto">
              <input type="checkbox" checked={anonimo} onChange={(e) => setAnonimo(e.target.checked)} className="size-4" />
              Ocultar identidade dos avaliadores
            </label>
            <label className="flex items-center gap-2 text-apoio font-semibold text-texto">
              <input
                type="checkbox"
                checked={incluirAjustes}
                onChange={(e) => setIncluirAjustes(e.target.checked)}
                className="size-4"
              />
              Incluir os ajustes manuais no documento
            </label>
          </div>
          <div className="flex gap-2">
            <Botao variante="primario" icone={<Printer className="w-4 h-4" />} onClick={() => window.print()}>
              Imprimir
            </Botao>
            <Botao variante="secundario" icone={<X className="w-4 h-4" />} onClick={aoFechar}>
              Fechar
            </Botao>
          </div>
        </div>

        {lista.length === 0 && (
          <p className="text-apoio text-texto-secundario">Nenhum projeto para conferir.</p>
        )}

        {lista.map((p, indiceProjeto) => (
          <article key={p.id_projeto} className="folha-projeto space-y-4 rounded-cartao border border-borda bg-superficie p-6 print:border-0 print:p-0">
            <header className="space-y-1 border-b border-borda pb-3">
              <p className="text-legenda font-bold uppercase tracking-wide text-texto-secundario">
                {(nomeEvento || 'Evento').toUpperCase()}
              </p>
              <h1 className="text-titulo-3 font-bold text-texto">Folha de conferência de notas</h1>
              <p className="text-apoio text-texto">
                <span className="font-mono font-bold">{p.codigo_projeto || '—'}</span> · {p.titulo}
              </p>
              <p className="text-legenda text-texto-secundario">
                {p.instituicao} · {p.modalidade} · {p.area_tematica} · emitida em {emitidaEm}
                {consolidada && ` · projeto ${indiceProjeto + 1} de ${lista.length}`}
              </p>
            </header>

            {/* A média, aberta */}
            <section aria-label="Resultado do projeto" className="space-y-1 text-apoio text-texto">
              <h2 className="text-corpo font-bold">Resultado</h2>
              <p>
                Avaliações consideradas: <strong className="tabular-nums">{p.total_avaliacoes}</strong> (cota{' '}
                {p.cota})
              </p>
              <p>
                Média das notas: <strong className="tabular-nums">{formatarNota(p.media_geral)}</strong>
                {p.ajuste_media !== 0 && (
                  <>
                    {' '}
                    · ajuste de comissão: <strong className="tabular-nums">{formatarAjuste(p.ajuste_media)}</strong>
                  </>
                )}
                {' · '}
                Média final: <strong className="tabular-nums">{formatarNota(p.media_final)}</strong>
              </p>
              {p.ajuste_media !== 0 && incluirAjustes && (
                <p className="text-texto-secundario">
                  Ajuste aplicado {p.ajuste_media_por?.nome ? `por ${p.ajuste_media_por.nome} ` : ''}
                  {p.ajuste_media_em ? `em ${dataHoraBr(p.ajuste_media_em)}` : ''}. Motivo:{' '}
                  {p.ajuste_media_motivo || 'não informado'}.
                </p>
              )}
              {p.questionario_fixado && (
                <p className="text-texto-secundario">
                  Questionário: {p.questionario_fixado.titulo} (escala{' '}
                  {formatarPeso(p.questionario_fixado.escala_minima)} a{' '}
                  {formatarPeso(p.questionario_fixado.escala_maxima)}). A nota de cada avaliação é a média das notas
                  por critério ponderada pelo peso de cada critério.
                </p>
              )}
            </section>

            {/* Memorial de cada avaliação */}
            <section aria-label="Memorial de cálculo" className="space-y-3">
              <h2 className="text-corpo font-bold text-texto">Como cada nota foi formada</h2>
              {p.avaliacoes_ativas.map((avaliacao, indice) => (
                <MemorialAvaliacao
                  key={avaliacao.id_avaliacao}
                  memorial={avaliacao}
                  anonimo={anonimo}
                  indiceAnonimo={indice + 1}
                  ocultarAjustes={!incluirAjustes}
                />
              ))}
              {p.avaliacoes_ativas.length === 0 && (
                <p className="text-apoio text-texto-secundario">Este projeto não tem avaliação ativa.</p>
              )}
            </section>

            {p.avaliacoes_canceladas.length > 0 && (
              <section aria-label="Avaliações canceladas" className="space-y-2">
                <h2 className="text-corpo font-bold text-texto">Avaliações canceladas (não entram na média)</h2>
                {p.avaliacoes_canceladas.map((avaliacao, indice) => (
                  <MemorialAvaliacao
                    key={avaliacao.id_avaliacao}
                    memorial={avaliacao}
                    anonimo={anonimo}
                    indiceAnonimo={p.avaliacoes_ativas.length + indice + 1}
                    ocultarAjustes={!incluirAjustes}
                  />
                ))}
              </section>
            )}

            {/* Desempate */}
            {p.desempate.por_prioridade.length > 0 && (
              <section aria-label="Desempate" className="space-y-1 text-apoio text-texto">
                <h2 className="text-corpo font-bold">Desempate</h2>
                <p className="text-texto-secundario">
                  Em caso de empate na média final, vence a maior média na pergunta de prioridade 1; persistindo, a 2,
                  e assim por diante.
                </p>
                <ul className="list-disc pl-5">
                  {p.desempate.por_prioridade.map((item) => (
                    <li key={`${item.prioridade}-${item.ordem}`}>
                      Prioridade {formatarPeso(item.prioridade)} — {item.criterio}:{' '}
                      <strong className="tabular-nums">{formatarNota(item.media)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Quarentena */}
            <section aria-label="Divergência entre avaliadores" className="space-y-1 text-apoio text-texto">
              <h2 className="text-corpo font-bold">Divergência entre avaliadores</h2>
              <p>
                Menor nota {formatarNota(p.quarentena.nota_minima)} · maior nota{' '}
                {formatarNota(p.quarentena.nota_maxima)} · diferença{' '}
                <strong className="tabular-nums">{formatarNota(p.quarentena.divergencia)}</strong> (limite de
                quarentena: {formatarNota(p.quarentena.limite)})
              </p>
              {p.quarentena.resolvida_em && (
                <p className="text-texto-secundario">
                  Divergência analisada e aceita em {dataHoraBr(p.quarentena.resolvida_em)}
                  {p.quarentena.resolvida_por?.nome && ` por ${p.quarentena.resolvida_por.nome}`}.
                </p>
              )}
              {p.quarentena.pendente && (
                <p className="font-semibold text-perigo">Divergência pendente de análise na data desta emissão.</p>
              )}
            </section>

            {/* Achados */}
            <section aria-label="Conferência automática" className="space-y-1 text-apoio text-texto">
              <h2 className="text-corpo font-bold">Conferência automática</h2>
              {p.achados.length === 0 ? (
                <p>
                  Nenhuma inconsistência: a nota de cada avaliação é exatamente a média ponderada das suas notas por
                  critério.
                </p>
              ) : (
                <ul className="list-disc pl-5">
                  {p.achados.map((achado, indice) => (
                    <li key={`${achado.codigo}-${indice}`}>
                      [{ROTULO_SEVERIDADE[achado.severidade]}] {achado.titulo}
                      {achado.detalhe && ` — ${achado.detalhe}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Histórico */}
            {incluirAjustes && p.trilha.length > 0 && (
              <section aria-label="Histórico de alterações" className="space-y-1 text-apoio text-texto">
                <h2 className="text-corpo font-bold">Histórico de alterações</h2>
                <ul className="list-disc pl-5">
                  {p.trilha.map((linha) => (
                    <li key={linha.id_log}>
                      {dataHoraBr(linha.quando)} — {linha.acao.replace(/_/g, ' ')}
                      {linha.motivo && `. Motivo: ${linha.motivo}`}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <footer className="border-t border-borda pt-2 text-legenda text-texto-secundario">
              Documento gerado pelo sistema de avaliação a partir das notas gravadas no banco. O histórico de
              alterações registra o que aconteceu a partir de {dataHoraBr(p.trilha_comeca_em)}.
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
};
