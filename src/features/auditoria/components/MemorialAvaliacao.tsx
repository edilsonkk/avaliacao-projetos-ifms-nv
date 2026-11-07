import React from 'react';
import { Tabela, Selo, cn } from '@/components/ui';
import {
  formatarNota,
  formatarNotaPrecisa,
  formatarPeso,
  notaPerdeuPrecisao,
} from '@/lib/formatoNota';
import type { MemorialAvaliacao as Memorial, TipoAjuste } from '../tipos';

/**
 * A conta de uma nota, aberta: critério, peso, nota e produto; depois a soma dos produtos,
 * a soma dos pesos, a divisão e o que está gravado no banco.
 *
 * É o que faltava para conferir uma nota: o `peso_calculo` entra na nota final de toda
 * avaliação, mas não aparecia em nenhuma tela do sistema.
 */

const ROTULO_AJUSTE: Record<TipoAjuste, string> = {
  respostas_corrigidas: 'Notas corrigidas pelo Admin',
  nota_arbitrada: 'Nota arbitrada pelo Admin',
  lancada_pelo_admin: 'Lançada pelo Admin',
};

const dataHora = (valor: string | null): string => {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

interface PropriedadesMemorial {
  memorial: Memorial;
  /** Troca o nome do avaliador por "Avaliador N" (documento entregue a terceiros). */
  anonimo?: boolean;
  /** Número do avaliador quando anônimo. */
  indiceAnonimo?: number;
  /** Esconde a marca de ajuste manual (versão externa do documento, quando a comissão pede). */
  ocultarAjustes?: boolean;
  /** Ações do Admin sobre esta avaliação. Omitido no documento impresso. */
  acoes?: React.ReactNode;
  className?: string;
}

export const MemorialAvaliacao: React.FC<PropriedadesMemorial> = ({
  memorial,
  anonimo = false,
  indiceAnonimo,
  ocultarAjustes = false,
  acoes,
  className,
}) => {
  const cancelada = (memorial.status || '').toUpperCase() === 'CANCELADA';
  const arbitrada = memorial.ajuste?.tipo === 'nota_arbitrada';
  const mostrarAjuste = Boolean(memorial.ajuste) && !ocultarAjustes;
  const escala = memorial.questionario
    ? `escala ${formatarPeso(memorial.questionario.escala_minima)} a ${formatarPeso(memorial.questionario.escala_maxima)}`
    : 'sem questionário';

  const nomeAvaliador = anonimo
    ? `Avaliador ${indiceAnonimo ?? 1}`
    : memorial.avaliador?.nome || 'Avaliador não identificado';

  return (
    <section
      className={cn('rounded-cartao border border-borda bg-superficie p-4 space-y-3', className)}
      aria-label={`Memorial de cálculo da avaliação de ${nomeAvaliador}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-corpo font-bold text-texto">{nomeAvaliador}</h4>
          {!anonimo && memorial.avaliador?.email && (
            <p className="text-legenda text-texto-secundario break-words">{memorial.avaliador.email}</p>
          )}
          <p className="text-legenda text-texto-secundario">
            {memorial.questionario?.titulo || 'Questionário não identificado'} · {escala}
            {memorial.enviada_em && ` · enviada em ${dataHora(memorial.enviada_em)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cancelada && <Selo tom="perigo">Cancelada</Selo>}
          {arbitrada && !ocultarAjustes ? (
            <Selo tom="aviso" title="A nota foi definida pelo Admin e não vem das respostas por critério.">
              Nota arbitrada
            </Selo>
          ) : memorial.confere ? (
            <Selo tom="sucesso">Confere</Selo>
          ) : (
            <Selo tom="perigo" title="A nota gravada não é a que as notas por critério produzem.">
              Divergente
            </Selo>
          )}
          {mostrarAjuste && memorial.ajuste?.tipo !== 'nota_arbitrada' && (
            <Selo tom="aviso">{ROTULO_AJUSTE[memorial.ajuste!.tipo]}</Selo>
          )}
          {memorial.is_quarentena && <Selo tom="aviso">Em quarentena</Selo>}
        </div>
      </header>

      {memorial.criterios.length === 0 ? (
        <p role="alert" className="text-apoio font-semibold text-perigo">
          Esta avaliação não tem notas por critério gravadas: não há como refazer a conta.
        </p>
      ) : (
        <>
          <Tabela
            legenda={`Notas por critério da avaliação de ${nomeAvaliador}`}
            colunas={['Critério', 'Peso', 'Nota', 'Peso × Nota']}
            larguraMinima="min-w-[28rem]"
          >
            {memorial.criterios.map((criterio) => (
              <tr key={criterio.id_pergunta}>
                <th scope="row" className="px-3 py-2 text-left font-semibold text-texto">
                  {criterio.criterio}
                </th>
                <td className="px-3 py-2 tabular-nums">{formatarPeso(criterio.peso_calculo)}</td>
                <td className="px-3 py-2 tabular-nums font-bold">{formatarNota(criterio.nota)}</td>
                <td className="px-3 py-2 tabular-nums">{formatarNota(criterio.produto)}</td>
              </tr>
            ))}
            <tr className="bg-superficie-alta font-bold">
              <th scope="row" className="px-3 py-2 text-left">
                Soma
              </th>
              <td className="px-3 py-2 tabular-nums">{formatarPeso(memorial.soma_pesos)}</td>
              <td className="px-3 py-2" aria-hidden="true" />
              <td className="px-3 py-2 tabular-nums">{formatarNota(memorial.soma_produtos)}</td>
            </tr>
          </Tabela>

          <p className="text-apoio text-texto">
            <span className="font-semibold">A conta: </span>
            {formatarNota(memorial.soma_produtos)} ÷ {formatarPeso(memorial.soma_pesos)} ={' '}
            <strong className="tabular-nums">{formatarNota(memorial.nota_arredondada)}</strong>
            {notaPerdeuPrecisao(memorial.nota_bruta) && (
              <span className="text-texto-secundario">
                {' '}
                (sem arredondar: {formatarNotaPrecisa(memorial.nota_bruta)})
              </span>
            )}
            {' · '}
            <span className="font-semibold">gravado: </span>
            <strong className="tabular-nums">{formatarNota(memorial.nota_gravada)}</strong>
          </p>
        </>
      )}

      {mostrarAjuste && memorial.ajuste && (
        <p className="rounded-controle border border-borda bg-superficie-alta p-3 text-apoio text-texto">
          <span className="font-bold">{ROTULO_AJUSTE[memorial.ajuste.tipo]}</span>
          {memorial.ajuste.por?.nome && ` por ${memorial.ajuste.por.nome}`}
          {memorial.ajuste.em && ` em ${dataHora(memorial.ajuste.em)}`}.{' '}
          <span className="font-semibold">Motivo: </span>
          {memorial.ajuste.motivo || 'não informado'}
          {arbitrada && memorial.nota_arredondada !== null && (
            <>
              {' '}
              As notas por critério dariam{' '}
              <strong className="tabular-nums">{formatarNota(memorial.nota_arredondada)}</strong>.
            </>
          )}
        </p>
      )}

      {cancelada && (
        <p className="text-apoio text-texto-secundario">
          Cancelada em {dataHora(memorial.cancelada_em)}
          {memorial.cancelada_por?.nome && ` por ${memorial.cancelada_por.nome}`}
          {memorial.motivo_do_log && `. Motivo: ${memorial.motivo_do_log}`}
        </p>
      )}

      {memorial.parecer && (
        <div className="text-apoio">
          <p className="font-semibold text-texto">Parecer</p>
          <p className="whitespace-pre-wrap text-texto-secundario">{memorial.parecer}</p>
        </div>
      )}

      {acoes && <div className="flex flex-wrap gap-2 pt-1">{acoes}</div>}
    </section>
  );
};
