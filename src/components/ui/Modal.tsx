import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';

/** Elementos que recebem foco pelo teclado, para a armadilha de foco. */
const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type TamanhoModal = 'pequeno' | 'medio' | 'grande';

interface PropriedadesModal {
  aberto: boolean;
  /** Fechar pelo X, pelo fundo ou pelo Esc. Em `alertdialog` só o Esc e os botões fecham. */
  aoFechar: () => void;
  titulo: string;
  /** Texto curto ligado ao diálogo por `aria-describedby`. */
  descricao?: string;
  /** `alertdialog` para decisão destrutiva: sem X e sem fechar pelo fundo. */
  papel?: 'dialog' | 'alertdialog';
  /** Rodapé com os botões de ação. */
  acoes?: React.ReactNode;
  tamanho?: TamanhoModal;
  children?: React.ReactNode;
  className?: string;
}

const TAMANHOS: Record<TamanhoModal, string> = {
  pequeno: 'max-w-sm',
  medio: 'max-w-lg',
  grande: 'max-w-3xl',
};

/**
 * Diálogo acessível do sistema: foco inicial dentro do diálogo, foco preso enquanto aberto,
 * `Esc` para fechar, foco devolvido a quem abriu e rolagem do fundo travada.
 * Use `data-foco-inicial` no elemento que deve receber o foco (por padrão, o primeiro focável).
 */
export const Modal: React.FC<PropriedadesModal> = ({
  aberto,
  aoFechar,
  titulo,
  descricao,
  papel = 'dialog',
  acoes,
  tamanho = 'medio',
  children,
  className,
}) => {
  const idTitulo = useId();
  const idDescricao = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;

    focoAnterior.current = document.activeElement as HTMLElement | null;
    const rolagemAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const alvo =
      caixa.current?.querySelector<HTMLElement>('[data-foco-inicial]') ??
      caixa.current?.querySelector<HTMLElement>(SELETOR_FOCAVEL) ??
      caixa.current;
    alvo?.focus();

    return () => {
      document.body.style.overflow = rolagemAnterior;
      focoAnterior.current?.focus?.();
    };
  }, [aberto]);

  if (!aberto) return null;

  const aoTeclar = (evento: React.KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      aoFechar();
      return;
    }
    if (evento.key !== 'Tab') return;

    const focaveis = Array.from(caixa.current?.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL) ?? []);
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];

    if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    } else if (evento.shiftKey && document.activeElement === primeiro) {
      evento.preventDefault();
      ultimo.focus();
    }
  };

  const fechaNoFundo = papel === 'dialog';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70"
      onMouseDown={fechaNoFundo ? (e) => e.target === e.currentTarget && aoFechar() : undefined}
    >
      <div
        ref={caixa}
        role={papel}
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descricao ? idDescricao : undefined}
        tabIndex={-1}
        onKeyDown={aoTeclar}
        className={cn(
          'w-full bg-superficie text-texto rounded-painel shadow-painel border border-borda',
          'max-h-[90dvh] overflow-y-auto p-5 sm:p-6 space-y-4',
          TAMANHOS[tamanho],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={idTitulo} className="text-titulo-3 font-bold text-texto">
            {titulo}
          </h2>
          {fechaNoFundo && (
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="inline-flex items-center justify-center min-h-11 min-w-11 -m-2 rounded-controle text-texto-secundario hover:bg-superficie-alta"
            >
              <X aria-hidden="true" className="w-5 h-5" />
            </button>
          )}
        </div>
        {descricao && (
          <p id={idDescricao} className="text-corpo text-texto-secundario">
            {descricao}
          </p>
        )}
        {children}
        {acoes && <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-1">{acoes}</div>}
      </div>
    </div>,
    document.body,
  );
};
