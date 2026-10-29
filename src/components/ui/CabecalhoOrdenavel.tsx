import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface PropriedadesCabecalhoOrdenavel<C extends string> {
  coluna: C;
  rotulo: string;
  ativa: C;
  direcao: 'asc' | 'desc';
  aoOrdenar: (coluna: C) => void;
}

/** Cabeçalho de coluna clicável e acessível por teclado, com o estado de ordenação anunciado (aria-sort). */
export const CabecalhoOrdenavel = <C extends string>({ coluna, rotulo, ativa, direcao, aoOrdenar }: PropriedadesCabecalhoOrdenavel<C>) => {
  const ordenada = ativa === coluna;
  const Icone = !ordenada ? ArrowUpDown : direcao === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={ordenada ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none'} className="p-0">
      <button
        type="button"
        onClick={() => aoOrdenar(coluna)}
        className="w-full px-4 py-3 flex items-center gap-1.5 uppercase font-black tracking-wider hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
      >
        <span>{rotulo}</span>
        <Icone aria-hidden="true" className={`w-3.5 h-3.5 ${ordenada ? 'text-emerald-600' : 'text-slate-400'}`} />
      </button>
    </th>
  );
};

/** Compara textos em ordem natural (PROJ-2 antes de PROJ-10), sem diferenciar caixa e acentos. */
export const compararNatural = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
