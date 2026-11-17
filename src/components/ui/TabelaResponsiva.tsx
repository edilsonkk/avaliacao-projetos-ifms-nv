import React from 'react';
import { cn } from './cn';
import { CabecalhoOrdenavel } from './CabecalhoOrdenavel';

export interface ColunaTabela<T> {
  /** Identificador da coluna. É também o valor passado a `aoOrdenar`. */
  chave: string;
  /** Cabeçalho na tabela e rótulo do campo no cartão do celular. */
  rotulo: string;
  /** Conteúdo da célula. */
  renderizar: (linha: T) => React.ReactNode;
  /**
   * Coluna de ações. No cartão do celular ela vai para o fim, sem rótulo —
   * "Ações: [Credenciar]" não ajuda ninguém.
   */
  acoes?: boolean;
  /** Cabeçalho vira botão de ordenação. Exige `colunaOrdenacao`, `direcao` e `aoOrdenar`. */
  ordenavel?: boolean;
  /** Classe extra da célula (não do cabeçalho). */
  className?: string;
}

interface PropriedadesTabelaResponsiva<T> {
  /** Resumo para leitor de tela, num `<caption>` visualmente oculto. */
  legenda: string;
  colunas: ColunaTabela<T>[];
  linhas: T[];
  /** Chave estável de cada linha (nunca o índice). */
  chaveLinha: (linha: T) => string;
  /** Coluna ordenada no momento. */
  colunaOrdenacao?: string;
  direcao?: 'asc' | 'desc';
  aoOrdenar?: (chave: string) => void;
  /** Largura mínima da tabela no desktop, quando as colunas não cabem (ex.: `min-w-[760px]`). */
  larguraMinima?: string;
  /**
   * Conteúdo extra de uma linha, quando a tela quiser abri-lo (notas de um projeto, por
   * exemplo). Devolva `null` para a linha que está fechada — quem controla o que está
   * aberto é a tela, não este componente. Em tabela sai como uma linha própria com
   * `colSpan`; no celular, como um bloco logo abaixo do cartão da linha.
   */
  detalhe?: (linha: T) => React.ReactNode;
  className?: string;
}

/**
 * Tabela que vira cartões empilhados no celular.
 *
 * Por que existe: as listas do sistema eram `<table>` escritas à mão com
 * `min-w-[640px]`…`min-w-[900px]`, e a coluna **Ações** ficava na última posição. No
 * celular ela nascia fora da área visível: só aparecia depois de descobrir que aquele
 * trecho rola para o lado. Daí o relato de "botões sumindo".
 *
 * A reflow é feita com **um só DOM** — nada de renderizar tabela e cartões em paralelo,
 * que duplicaria cada botão para o leitor de tela e para os testes. Abaixo de `sm:` os
 * elementos da tabela passam a `display: block`; como o navegador descarta os papéis
 * implícitos de tabela quando isso acontece, cada elemento declara o seu `role`. O
 * cabeçalho some e cada célula mostra o próprio rótulo, marcado `aria-hidden` porque a
 * semântica de tabela já o informa.
 */
export const TabelaResponsiva = <T,>({
  legenda,
  colunas,
  linhas,
  chaveLinha,
  colunaOrdenacao,
  direcao = 'asc',
  aoOrdenar,
  larguraMinima,
  detalhe,
  className,
}: PropriedadesTabelaResponsiva<T>) => (
  <div
    role="region"
    aria-label={legenda}
    tabIndex={0}
    className={cn('sm:overflow-x-auto rounded-cartao border border-borda bg-superficie', className)}
  >
    <table role="table" className={cn('block w-full text-apoio sm:table', larguraMinima)}>
      <caption className="sr-only">{legenda}</caption>
      <thead role="rowgroup" className="hidden bg-superficie-alta text-texto-secundario sm:table-header-group">
        <tr role="row">
          {colunas.map((coluna) =>
            coluna.ordenavel && aoOrdenar ? (
              <CabecalhoOrdenavel
                key={coluna.chave}
                coluna={coluna.chave}
                rotulo={coluna.rotulo}
                ativa={colunaOrdenacao ?? ''}
                direcao={direcao}
                aoOrdenar={aoOrdenar}
              />
            ) : (
              <th
                key={coluna.chave}
                role="columnheader"
                scope="col"
                className="px-3 py-2 text-left text-legenda font-bold uppercase tracking-wide"
              >
                {coluna.acoes ? <span className="sr-only">{coluna.rotulo}</span> : coluna.rotulo}
              </th>
            ),
          )}
        </tr>
      </thead>

      <tbody role="rowgroup" className="block sm:table-row-group sm:divide-y sm:divide-borda">
        {linhas.map((linha) => {
          const extra = detalhe?.(linha);
          return (
          <React.Fragment key={chaveLinha(linha)}>
          <tr
            role="row"
            className="mb-3 block space-y-1 rounded-cartao border border-borda bg-superficie p-3 last:mb-0 sm:mb-0 sm:table-row sm:space-y-0 sm:rounded-none sm:border-0 sm:p-0"
          >
            {colunas.map((coluna) => (
              <td
                key={coluna.chave}
                role="cell"
                /* O rótulo do cartão sai por pseudo-elemento (`data-rotulo` + `content: attr()`),
                   não por um <span> no DOM: assim ele não entra no `textContent` da célula
                   (contaminava asserções de teste e cópia de texto) nem é lido duas vezes pelo
                   leitor de tela, que já sabe a coluna pela semântica da tabela. */
                data-rotulo={coluna.acoes ? undefined : coluna.rotulo}
                className={cn(
                  'block px-0 py-0.5 text-texto sm:table-cell sm:px-3 sm:py-2',
                  coluna.acoes
                    ? 'pt-2 sm:pt-2'
                    : "before:mr-1 before:text-legenda before:font-bold before:uppercase before:tracking-wide before:text-texto-secundario before:content-[attr(data-rotulo)_':'] sm:before:content-none",
                  coluna.className,
                )}
              >
                {coluna.renderizar(linha)}
              </td>
            ))}
          </tr>
          {extra != null && extra !== false && (
            <tr
              role="row"
              className="-mt-2 mb-3 block rounded-cartao border border-borda bg-superficie-alta sm:mt-0 sm:mb-0 sm:table-row sm:rounded-none sm:border-0"
            >
              <td role="cell" colSpan={colunas.length} className="block p-3 sm:table-cell sm:px-6 sm:py-3">
                {extra}
              </td>
            </tr>
          )}
          </React.Fragment>
          );
        })}
      </tbody>
    </table>
  </div>
);
