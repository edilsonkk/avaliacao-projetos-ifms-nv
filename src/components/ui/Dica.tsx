import React, { useId, useState } from 'react';
import { Info } from 'lucide-react';

interface PropriedadesDica {
  /** Texto (ou conteúdo curto) explicando o campo. */
  children: React.ReactNode;
  /** Id do texto, para o campo usar em `aria-describedby`. Gerado se omitido. */
  id?: string;
  /** Lado para onde o balão cresce, para não sair da tela perto das bordas. */
  alinhar?: 'inicio' | 'centro' | 'fim';
  /** Abre acima (padrão) ou abaixo do ícone; use 'baixo' perto do topo da tela. */
  lado?: 'cima' | 'baixo';
  /**
   * Nome do botão para leitor de tela. O padrão serve a uma dica solitária; quando a mesma tela
   * repete a dica em vários itens (um por critério, por exemplo), passe algo que diga de qual item
   * ela é — senão o leitor de tela anuncia N botões de nome idêntico.
   */
  rotulo?: string;
  /**
   * Largura do balão.
   *
   * `'bloco'` resolve um problema de tela estreita: o balão é posicionado em relação ao ícone, e um
   * ícone no meio de uma linha de texto não tem, a 360px, espaço para um balão largo nem à direita
   * (`alinhar="inicio"`) nem à esquerda (`alinhar="fim"`) — a posição do ícone depende do tamanho do
   * texto que vem antes dele. Com `'bloco'`, o invólucro deixa de ser o bloco de contenção e o balão
   * passa a ocupar a largura do ancestral posicionado mais próximo, que o chamador marca com
   * `relative`. Aí ele cabe por construção, em qualquer largura de tela.
   */
  largura?: 'padrao' | 'bloco';
}

const LARGURA: Record<NonNullable<PropriedadesDica['largura']>, string> = {
  padrao: 'w-64',
  bloco: 'w-full',
};

const POSICAO: Record<NonNullable<PropriedadesDica['alinhar']>, string> = {
  inicio: 'left-0',
  centro: 'left-1/2 -translate-x-1/2',
  fim: 'right-0',
};

/**
 * Ícone "i" que mostra uma explicação ao passar o mouse, ao focar pelo teclado ou ao tocar (celular).
 * O texto fica sempre no DOM e é ligado ao botão por `aria-describedby`, para leitores de tela.
 */
export const Dica: React.FC<PropriedadesDica> = ({
  children,
  id,
  alinhar = 'centro',
  lado = 'cima',
  rotulo = 'Mais informações',
  largura = 'padrao',
}) => {
  const idGerado = useId();
  const idTexto = id ?? `dica-${idGerado}`;
  const [aberta, setAberta] = useState(false);

  return (
    <span
      className={`${largura === 'bloco' ? '' : 'relative '}inline-flex group align-middle`}
      onMouseLeave={() => setAberta(false)}
    >
      <button
        type="button"
        aria-label={rotulo}
        aria-describedby={idTexto}
        aria-expanded={aberta}
        onClick={() => setAberta((v) => !v)}
        onBlur={() => setAberta(false)}
        onKeyDown={(e) => e.key === 'Escape' && setAberta(false)}
        className="p-0.5 rounded-full text-slate-400 hover:text-emerald-600 focus:text-emerald-600 dark:hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-help"
      >
        <Info aria-hidden="true" className="w-3.5 h-3.5" />
      </button>
      <span
        id={idTexto}
        role="tooltip"
        className={`absolute z-20 ${lado === 'cima' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${LARGURA[largura]} max-w-[80vw] p-2.5 rounded-lg bg-slate-900 dark:bg-slate-700 dark:ring-1 dark:ring-slate-500 text-white text-legenda font-medium normal-case tracking-normal leading-snug shadow-lg pointer-events-none transition-opacity ${POSICAO[alinhar]} ${
          aberta ? 'visible opacity-100' : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'
        }`}
      >
        {children}
      </span>
    </span>
  );
};
