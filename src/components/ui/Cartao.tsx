import React, { useId } from 'react';
import { cn } from './cn';

interface PropriedadesCartao {
  /** Título do cartão; vira um título de verdade, no nível indicado. */
  titulo?: string;
  /** Nível do título, para não quebrar a hierarquia da tela (a tela já tem o `h1`). */
  nivelTitulo?: 2 | 3 | 4;
  /** Conteúdo à direita do título (botão, selo). */
  acao?: React.ReactNode;
  /** Elemento raiz: use `section` quando o cartão for uma região da tela. */
  como?: 'div' | 'section' | 'article';
  children: React.ReactNode;
  className?: string;
}

/** Superfície padrão do sistema: fundo, borda, raio e sombra vindos dos tokens. */
export const Cartao: React.FC<PropriedadesCartao> = ({
  titulo,
  nivelTitulo = 3,
  acao,
  como: Raiz = 'div',
  children,
  className,
}) => {
  const idTitulo = useId();
  const Titulo = `h${nivelTitulo}` as 'h2' | 'h3' | 'h4';

  return (
    <Raiz
      aria-labelledby={titulo ? idTitulo : undefined}
      className={cn('bg-superficie border border-borda rounded-cartao shadow-cartao p-4 sm:p-5 space-y-3', className)}
    >
      {(titulo || acao) && (
        <div className="flex items-start justify-between gap-3">
          {titulo && (
            <Titulo id={idTitulo} className="text-titulo-3 font-bold text-texto">
              {titulo}
            </Titulo>
          )}
          {acao}
        </div>
      )}
      {children}
    </Raiz>
  );
};
