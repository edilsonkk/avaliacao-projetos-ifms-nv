import React from 'react';
import { cn } from './cn';

interface PropriedadesTabela {
  /** Resumo da tabela para leitor de tela. Vai num `<caption>` visualmente oculto. */
  legenda: string;
  /**
   * Cabeçalhos das colunas. Texto simples vira `<th scope="col">`; para coluna ordenável,
   * passe um `<CabecalhoOrdenavel>` já montado.
   */
  colunas: React.ReactNode[];
  /** Largura mínima da tabela (ex.: `min-w-[760px]`), quando as colunas não cabem no celular. */
  larguraMinima?: string;
  /** Linhas do corpo (`<tr>`). */
  children: React.ReactNode;
  className?: string;
}

/**
 * Tabela com o básico que faltava nas telas: `<caption>` para leitor de tela,
 * `scope="col"` nos cabeçalhos e o contêiner de rolagem **focável** — sem isso,
 * quem usa só o teclado não consegue rolar a tabela para o lado (WCAG 2.1.1).
 */
export const Tabela: React.FC<PropriedadesTabela> = ({ legenda, colunas, larguraMinima, children, className }) => (
  <div
    role="region"
    aria-label={legenda}
    tabIndex={0}
    className={cn('overflow-x-auto rounded-cartao border border-borda bg-superficie', className)}
  >
    <table className={cn('w-full text-apoio', larguraMinima)}>
      <caption className="sr-only">{legenda}</caption>
      <thead className="bg-superficie-alta text-texto-secundario">
        <tr>
          {colunas.map((coluna, indice) =>
            typeof coluna === 'string' ? (
              <th key={coluna} scope="col" className="px-3 py-2 text-left text-legenda font-bold uppercase tracking-wide">
                {coluna}
              </th>
            ) : (
              <React.Fragment key={indice}>{coluna}</React.Fragment>
            ),
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-borda text-texto">{children}</tbody>
    </table>
  </div>
);
