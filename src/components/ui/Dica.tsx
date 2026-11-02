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
}

const POSICAO: Record<NonNullable<PropriedadesDica['alinhar']>, string> = {
  inicio: 'left-0',
  centro: 'left-1/2 -translate-x-1/2',
  fim: 'right-0',
};

/**
 * Ícone "i" que mostra uma explicação ao passar o mouse, ao focar pelo teclado ou ao tocar (celular).
 * O texto fica sempre no DOM e é ligado ao botão por `aria-describedby`, para leitores de tela.
 */
export const Dica: React.FC<PropriedadesDica> = ({ children, id, alinhar = 'centro', lado = 'cima' }) => {
  const idGerado = useId();
  const idTexto = id ?? `dica-${idGerado}`;
  const [aberta, setAberta] = useState(false);

  return (
    <span className="relative inline-flex group align-middle" onMouseLeave={() => setAberta(false)}>
      <button
        type="button"
        aria-label="Mais informações"
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
        className={`absolute z-20 ${lado === 'cima' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} w-64 max-w-[80vw] p-2.5 rounded-lg bg-slate-900 dark:bg-slate-700 dark:ring-1 dark:ring-slate-500 text-white text-legenda font-medium normal-case tracking-normal leading-snug shadow-lg pointer-events-none transition-opacity ${POSICAO[alinhar]} ${
          aberta ? 'visible opacity-100' : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'
        }`}
      >
        {children}
      </span>
    </span>
  );
};
