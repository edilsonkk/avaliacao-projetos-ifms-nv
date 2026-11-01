import React from 'react';
import { cn } from './cn';

export type TomSelo = 'neutro' | 'sucesso' | 'aviso' | 'perigo' | 'info';

interface PropriedadesSelo {
  tom?: TomSelo;
  /** Ícone à esquerda; recebe `aria-hidden`. */
  icone?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
  role?: string;
}

const TONS: Record<TomSelo, string> = {
  neutro: 'bg-superficie-alta text-texto border border-borda',
  sucesso: 'bg-acao text-white',
  aviso: 'bg-aviso text-white',
  perigo: 'bg-perigo text-white',
  info: 'bg-info text-white',
};

/** Etiqueta curta de situação. Fica no piso de 12px da escala e nunca quebra em duas linhas. */
export const Selo: React.FC<PropriedadesSelo> = ({ tom = 'neutro', icone, children, className, ...resto }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-legenda font-bold whitespace-nowrap',
      TONS[tom],
      className,
    )}
    {...resto}
  >
    {icone && (
      <span aria-hidden="true" className="inline-flex shrink-0">
        {icone}
      </span>
    )}
    {children}
  </span>
);
