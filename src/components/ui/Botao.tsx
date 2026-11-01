import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type VarianteBotao = 'primario' | 'secundario' | 'perigo' | 'fantasma';
export type TamanhoBotao = 'medio' | 'grande';

interface BaseBotao extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  /** Mostra o girador, marca `aria-busy` e bloqueia o clique. */
  carregando?: boolean;
  /** Ícone à esquerda do rótulo; recebe `aria-hidden` automaticamente. */
  icone?: React.ReactNode;
  larguraTotal?: boolean;
}

interface BotaoComTexto extends BaseBotao {
  children: React.ReactNode;
}

/** Botão só com ícone: o nome acessível passa a ser obrigatório (o `tsc` cobra). */
interface BotaoSoIcone extends BaseBotao {
  children?: never;
  'aria-label': string;
}

export type PropriedadesBotao = BotaoComTexto | BotaoSoIcone;

const VARIANTES: Record<VarianteBotao, string> = {
  primario: 'bg-acao text-white hover:bg-acao-ativa shadow-cartao',
  secundario: 'bg-superficie text-texto border border-borda-controle hover:bg-superficie-alta',
  perigo: 'bg-perigo text-white hover:bg-perigo-ativa shadow-cartao',
  fantasma: 'text-texto-secundario hover:bg-superficie-alta',
};

/** Altura mínima de 44px (medio) para o alvo de toque recomendado em celular. */
const TAMANHOS: Record<TamanhoBotao, string> = {
  medio: 'min-h-11 px-4 text-apoio',
  grande: 'min-h-13 px-5 text-corpo',
};

/**
 * Botão padrão do sistema. Substitui as variações escritas à mão em cada tela
 * (ver docs/arquitetura/design-e-acessibilidade.md).
 */
export const Botao: React.FC<PropriedadesBotao> = ({
  variante = 'primario',
  tamanho = 'medio',
  carregando = false,
  icone,
  larguraTotal = false,
  className,
  disabled,
  children,
  type = 'button',
  ...resto
}) => (
  <button
    type={type}
    disabled={disabled || carregando}
    aria-busy={carregando || undefined}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-controle font-bold transition-colors',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      VARIANTES[variante],
      TAMANHOS[tamanho],
      larguraTotal && 'w-full',
      className,
    )}
    {...resto}
  >
    {carregando ? (
      <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin shrink-0" />
    ) : icone ? (
      <span aria-hidden="true" className="inline-flex shrink-0">
        {icone}
      </span>
    ) : null}
    {children}
  </button>
);
