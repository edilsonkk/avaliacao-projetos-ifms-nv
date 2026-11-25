import React from 'react';
import { ExternalLink, Gauge, Pause, Play, Square } from 'lucide-react';
import { Botao, Selo } from '@/components/ui';
import type { EstadoSimulacao } from '@/lib/simulacao/motor';

interface Propriedades {
  progresso: EstadoSimulacao;
  /** Quantas avaliações técnicas a configuração pede no total. */
  metaTecnica: number;
  aoPausar: () => void;
  aoRetomar: () => void;
  aoEncerrar: () => void;
  aoAjustarVelocidade: (multiplicador: number) => void;
  velocidade: number;
}

const VELOCIDADES = [0.25, 0.5, 1, 2, 4, 8];

const Contador: React.FC<{ rotulo: string; valor: number | string }> = ({ rotulo, valor }) => (
  <div className="rounded-xl border border-borda bg-superficie p-3">
    <span className="block text-legenda uppercase text-texto-secundario">{rotulo}</span>
    <span className="block text-titulo font-bold text-texto">{valor}</span>
  </div>
);

const segundosDecorridos = (progresso: EstadoSimulacao): number => {
  if (!progresso.iniciadoEm) return 0;
  return Math.max(0, Math.round((progresso.atualizadoEm - progresso.iniciadoEm) / 1000));
};

/** Acompanhamento ao vivo da rodada, com os controles de ritmo. */
export const PainelProgressoSimulacao: React.FC<Propriedades> = ({
  progresso,
  metaTecnica,
  aoPausar,
  aoRetomar,
  aoEncerrar,
  aoAjustarVelocidade,
  velocidade,
}) => {
  const decorridos = segundosDecorridos(progresso);
  const porSegundo = decorridos > 0 ? (progresso.enviadas / decorridos).toFixed(1) : '—';
  const recusas = Object.entries(progresso.recusadasPorRegra);
  const erros = Object.entries(progresso.erros);
  const pausada = progresso.fase === 'pausada';
  const emAndamento = progresso.fase === 'rodando' || pausada;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="text-corpo text-texto">
          {progresso.fase === 'rodando' && 'Simulação em andamento.'}
          {pausada && 'Simulação pausada.'}
          {progresso.fase === 'encerrando' && 'Encerrando: esperando as chamadas em voo.'}
          {progresso.fase === 'encerrada' && `Simulação encerrada: ${progresso.motivoDaParada}.`}
          {' '}
          {progresso.enviadas} de {metaTecnica} avaliações técnicas.
        </p>
        <a
          href="/telao"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-corpo font-bold text-acao hover:underline"
        >
          <ExternalLink aria-hidden="true" className="w-4 h-4" />
          Abrir o telão em outra janela
        </a>
      </div>

      <p className="text-apoio text-texto-secundario">
        Deixe esta janela visível, ao lado do telão: em aba escondida o navegador segura os
        temporizadores e o ritmo se desfaz. Fechar a aba interrompe a simulação.
      </p>

      <div
        role="progressbar"
        aria-label="Avanço da simulação"
        aria-valuemin={0}
        aria-valuemax={metaTecnica}
        aria-valuenow={progresso.enviadas}
        className="h-3 w-full overflow-hidden rounded-full bg-superficie-alta"
      >
        <div
          className="h-full rounded-full bg-acao transition-all"
          style={{ width: `${metaTecnica > 0 ? Math.min(100, (progresso.enviadas / metaTecnica) * 100) : 0}%` }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Contador rotulo="Avaliações" valor={progresso.enviadas} />
        <Contador rotulo="Votos populares" valor={progresso.votosPopulares} />
        <Contador rotulo="Projetos na cota" valor={progresso.projetosConcluidos} />
        <Contador rotulo="Check-ins" valor={progresso.checkInsFeitos} />
        <Contador rotulo="Avaliadores ativos" valor={progresso.avaliadoresAtivos} />
        <Contador rotulo="Em voo" valor={progresso.emVoo} />
        <Contador rotulo="Tempo" valor={`${decorridos}s`} />
        <Contador rotulo="Avaliações/s" valor={porSegundo} />
      </div>

      {recusas.length > 0 && (
        <section aria-labelledby="titulo-recusas" className="space-y-1.5">
          <h4 id="titulo-recusas" className="text-apoio font-bold text-texto">
            Recusas pela regra ({recusas.reduce((soma, [, quantas]) => soma + quantas, 0)})
          </h4>
          <p className="text-legenda text-texto-secundario">
            Não são falhas: é o sistema recusando o que deve recusar.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {recusas.map(([rotulo, quantas]) => (
              <li key={rotulo}>
                <Selo tom="info">{`${rotulo}: ${quantas}`}</Selo>
              </li>
            ))}
          </ul>
        </section>
      )}

      {erros.length > 0 && (
        <section aria-labelledby="titulo-erros" className="space-y-1.5">
          <h4 id="titulo-erros" className="text-apoio font-bold text-perigo">
            Erros ({erros.reduce((soma, [, quantas]) => soma + quantas, 0)})
          </h4>
          <ul className="space-y-1">
            {erros.map(([mensagem, quantas]) => (
              <li key={mensagem} className="text-legenda text-texto">
                {quantas}x {mensagem}
              </li>
            ))}
          </ul>
        </section>
      )}

      {emAndamento && (
        <div className="flex flex-wrap items-end gap-2.5 border-t border-borda pt-3">
          {pausada ? (
            <Botao onClick={aoRetomar} aria-label="Retomar a simulação">
              <Play aria-hidden="true" className="w-4 h-4" /> Retomar
            </Botao>
          ) : (
            <Botao onClick={aoPausar} aria-label="Pausar a simulação">
              <Pause aria-hidden="true" className="w-4 h-4" /> Pausar
            </Botao>
          )}
          <Botao variante="perigo" onClick={aoEncerrar} aria-label="Encerrar a simulação">
            <Square aria-hidden="true" className="w-4 h-4" /> Encerrar
          </Botao>
          <label className="flex items-center gap-1.5 text-apoio text-texto">
            <Gauge aria-hidden="true" className="w-4 h-4" />
            <span>Velocidade</span>
            <select
              aria-label="Velocidade da simulação"
              value={velocidade}
              onChange={(evento) => aoAjustarVelocidade(Number(evento.target.value))}
              className="min-h-11 rounded-controle border border-borda-controle bg-superficie px-2 text-corpo"
            >
              {VELOCIDADES.map((multiplicador) => (
                <option key={multiplicador} value={multiplicador}>{multiplicador}x</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
};
