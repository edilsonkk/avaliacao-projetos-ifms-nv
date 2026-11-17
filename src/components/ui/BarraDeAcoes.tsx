import React from 'react';
import { cn } from './cn';

export type AlinhamentoBarra = 'inicio' | 'fim' | 'entre';

interface PropriedadesBarraDeAcoes {
  /** Para onde os botões vão quando sobra espaço. Padrão: `fim`. */
  alinhar?: AlinhamentoBarra;
  /**
   * Empilha os botões em largura cheia no celular e só os deita a partir de `sm:`.
   * É o rodapé de modal (o mesmo comportamento do `Modal`). Fora de modal, deixe
   * desligado: numa linha de tabela o botão não deve ocupar a largura toda.
   */
  empilhar?: boolean;
  /** Rótulo acessível, quando a barra for um agrupamento com sentido próprio. */
  rotulo?: string;
  children: React.ReactNode;
  className?: string;
}

const ALINHAMENTOS: Record<AlinhamentoBarra, string> = {
  inicio: 'justify-start',
  fim: 'justify-end',
  entre: 'justify-between',
};

/**
 * Barra de botões que nunca empurra nada para fora da tela.
 *
 * Por que existe: as barras de ação do sistema eram `flex … justify-end` **sem**
 * `flex-wrap`. Num celular a soma dos botões passava da largura disponível e, como a
 * camada base aplica `overflow-x: clip` no `<html>` (guarda contra rolagem lateral), o
 * que sobrava era **cortado sem rolagem** — o botão simplesmente desaparecia, que foi o
 * defeito relatado. Com `flex-wrap` ele desce de linha e continua alcançável.
 */
export const BarraDeAcoes: React.FC<PropriedadesBarraDeAcoes> = ({
  alinhar = 'fim',
  empilhar = false,
  rotulo,
  children,
  className,
}) => (
  <div
    role={rotulo ? 'group' : undefined}
    aria-label={rotulo}
    className={cn(
      'flex flex-wrap items-center gap-2',
      empilhar ? 'flex-col sm:flex-row [&>*]:w-full sm:[&>*]:w-auto' : null,
      ALINHAMENTOS[alinhar],
      className,
    )}
  >
    {children}
  </div>
);
