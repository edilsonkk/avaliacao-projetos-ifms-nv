import React, { useRef } from 'react';
import { cn } from './cn';

export interface DefinicaoAba {
  id: string;
  rotulo: string;
  /** Ícone à esquerda do rótulo; recebe `aria-hidden`. */
  icone?: React.ReactNode;
}

interface PropriedadesAbas {
  abas: DefinicaoAba[];
  /** Id da aba ativa. */
  ativa: string;
  aoTrocar: (id: string) => void;
  /** Nome da lista de abas para leitor de tela, ex.: "Seções do credenciamento". */
  'aria-label': string;
  className?: string;
}

/** Id do painel de uma aba, para ligar `aria-controls` e `aria-labelledby`. */
export const idPainelAba = (id: string) => `painel-${id}`;
const idBotaoAba = (id: string) => `aba-${id}`;

/**
 * Abas no padrão ARIA: só a aba ativa entra na ordem de tabulação, e as setas
 * andam entre as abas (Home e End vão para a primeira e a última).
 */
export const Abas: React.FC<PropriedadesAbas> = ({ abas, ativa, aoTrocar, 'aria-label': rotulo, className }) => {
  const lista = useRef<HTMLDivElement>(null);

  const aoTeclar = (evento: React.KeyboardEvent<HTMLDivElement>) => {
    const teclas = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!teclas.includes(evento.key)) return;
    evento.preventDefault();

    const atual = abas.findIndex((aba) => aba.id === ativa);
    const ultimo = abas.length - 1;
    const destino =
      evento.key === 'ArrowRight'
        ? (atual + 1) % abas.length
        : evento.key === 'ArrowLeft'
          ? (atual - 1 + abas.length) % abas.length
          : evento.key === 'Home'
            ? 0
            : ultimo;

    aoTrocar(abas[destino].id);
    lista.current?.querySelector<HTMLElement>(`#${idBotaoAba(abas[destino].id)}`)?.focus();
  };

  return (
    <div
      ref={lista}
      role="tablist"
      aria-label={rotulo}
      onKeyDown={aoTeclar}
      className={cn('flex gap-1 p-1 bg-superficie-alta border border-borda rounded-controle', className)}
    >
      {abas.map((aba) => {
        const selecionada = aba.id === ativa;
        return (
          <button
            key={aba.id}
            id={idBotaoAba(aba.id)}
            type="button"
            role="tab"
            aria-selected={selecionada}
            aria-controls={idPainelAba(aba.id)}
            tabIndex={selecionada ? 0 : -1}
            onClick={() => aoTrocar(aba.id)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 min-h-11 px-3 rounded-controle text-apoio font-bold transition-colors',
              selecionada ? 'bg-acao text-white shadow-cartao' : 'text-texto-secundario hover:bg-superficie',
            )}
          >
            {aba.icone && (
              <span aria-hidden="true" className="inline-flex shrink-0">
                {aba.icone}
              </span>
            )}
            {aba.rotulo}
          </button>
        );
      })}
    </div>
  );
};

interface PropriedadesPainelAba {
  /** Id da aba a que este painel pertence. */
  id: string;
  /** Mostra o painel só quando a aba está ativa. */
  ativo: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Conteúdo de uma aba. Focável, para quem chega pelo teclado saber onde está. */
export const PainelAba: React.FC<PropriedadesPainelAba> = ({ id, ativo, children, className }) => {
  if (!ativo) return null;
  return (
    <div id={idPainelAba(id)} role="tabpanel" aria-labelledby={`aba-${id}`} tabIndex={0} className={className}>
      {children}
    </div>
  );
};
