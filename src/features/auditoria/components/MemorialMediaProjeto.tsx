import React from 'react';
import { formatarAjuste, formatarNota, formatarNotaPrecisa, notaPerdeuPrecisao } from '@/lib/formatoNota';
import { dataHoraBr } from '../rotulos';
import type { MemorialProjeto } from '../tipos';

/**
 * A conta da média do projeto, aberta: a soma das notas, o divisor, o resultado, o ajuste de
 * comissão e a média final.
 *
 * Existe porque o memorial de cálculo abria a conta de **cada avaliação** (critério, peso e
 * produto) mas não a do projeto: quem conferia via a média pronta e tinha de refazer a soma à mão
 * para saber de onde ela veio. É usada na Auditoria de Notas e no relatório de Projetos e Médias,
 * para o mesmo número aparecer com a mesma conta nas duas telas.
 */

/**
 * Só o que entra na conta. `MemorialProjeto` satisfaz a interface inteira; a linha do relatório de
 * Projetos e Médias traz as quatro primeiras, que é o bastante para a variante `resumo` — e já vem
 * na consulta do relatório, então a conta aparece sem nenhuma chamada a mais.
 */
export interface DadosMediaProjeto {
  notas: number[];
  media_geral: number | null;
  ajuste_media?: number;
  media_final?: number | null;
  total_avaliacoes?: number;
  cota?: number;
  ajuste_media_em?: string | null;
  ajuste_media_motivo?: string | null;
  ajuste_media_por?: MemorialProjeto['ajuste_media_por'];
}

interface PropriedadesMemorialMediaProjeto {
  projeto: DadosMediaProjeto;
  /** `resumo` mostra só a conta (accordion do relatório); `completo` traz o quadro de números. */
  variante?: 'completo' | 'resumo';
}

export const MemorialMediaProjeto: React.FC<PropriedadesMemorialMediaProjeto> = ({ projeto, variante = 'completo' }) => {
  const notas = Array.isArray(projeto.notas) ? projeto.notas.map(Number).filter((n) => Number.isFinite(n)) : [];
  const soma = notas.reduce((acumulado, nota) => acumulado + nota, 0);
  const divisor = notas.length;
  const bruta = divisor > 0 ? soma / divisor : null;
  const temAjuste = Number(projeto.ajuste_media ?? 0) !== 0;

  return (
    <div className="rounded-cartao border border-borda bg-superficie p-3 space-y-2">
      <h4 className="text-apoio font-bold text-texto">Média geral do projeto</h4>

      {divisor === 0 ? (
        <p className="text-apoio text-texto-secundario">Nenhuma nota lançada até agora, então o projeto ainda não tem média.</p>
      ) : (
        <>
          <p className="text-apoio text-texto tabular-nums">
            ({notas.map((nota) => formatarNota(nota)).join(' + ')}) ÷ {divisor} ={' '}
            <strong>{formatarNota(projeto.media_geral)}</strong>
            {notaPerdeuPrecisao(bruta) && (
              <span className="text-texto-secundario"> (conta exata: {formatarNotaPrecisa(bruta)}, arredondada para duas casas)</span>
            )}
          </p>

          <p className="text-apoio text-texto tabular-nums">
            <span className="text-texto-secundario">ajuste da comissão: </span>
            <strong>{formatarAjuste(projeto.ajuste_media)}</strong>
          </p>

          <p className="text-apoio text-texto tabular-nums">
            <span className="text-texto-secundario">média final: </span>
            <strong>{formatarNota(projeto.media_final)} pts</strong>
          </p>
        </>
      )}

      {variante === 'completo' && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-apoio pt-1">
          <div>
            <dt className="text-texto-secundario">Avaliações</dt>
            <dd className="font-bold text-texto tabular-nums">
              {projeto.total_avaliacoes} de {projeto.cota}
            </dd>
          </div>
          <div>
            <dt className="text-texto-secundario">Média das notas</dt>
            <dd className="font-bold text-texto tabular-nums">{formatarNota(projeto.media_geral)}</dd>
          </div>
          <div>
            <dt className="text-texto-secundario">Ajuste de comissão</dt>
            <dd className="font-bold text-texto tabular-nums">{formatarAjuste(projeto.ajuste_media)}</dd>
          </div>
          <div>
            <dt className="text-texto-secundario">Média final</dt>
            <dd className="font-bold text-texto tabular-nums">{formatarNota(projeto.media_final)}</dd>
          </div>
        </dl>
      )}

      {temAjuste && (
        <p className="text-apoio text-texto">
          <span className="font-semibold">Ajuste aplicado </span>
          {projeto.ajuste_media_por?.nome && `por ${projeto.ajuste_media_por.nome} `}
          {projeto.ajuste_media_em && `em ${dataHoraBr(projeto.ajuste_media_em)}`}. Motivo:{' '}
          {projeto.ajuste_media_motivo || 'não informado'}
        </p>
      )}
    </div>
  );
};
