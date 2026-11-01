import React from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { cn } from './cn';

export type SituacaoEstado = 'carregando' | 'vazio' | 'erro';

interface PropriedadesEstado {
  situacao: SituacaoEstado;
  /** Frase principal, ex.: "Carregando avaliadores..." ou "Nenhum projeto importado". */
  titulo: string;
  descricao?: string;
  /** Botão de saída, ex.: "Tentar de novo". */
  acao?: React.ReactNode;
  className?: string;
}

/**
 * Carregando, vazio e erro com a mesma aparência e já anunciados por leitor de tela
 * (`role="status"` enquanto carrega, `role="alert"` no erro).
 */
export const Estado: React.FC<PropriedadesEstado> = ({ situacao, titulo, descricao, acao, className }) => {
  const papel = situacao === 'carregando' ? 'status' : situacao === 'erro' ? 'alert' : undefined;

  return (
    <div
      role={papel}
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center p-8 rounded-cartao',
        situacao === 'vazio' ? 'border border-dashed border-borda' : 'border border-borda bg-superficie',
        situacao === 'erro' && 'border-perigo',
        className,
      )}
    >
      {situacao === 'carregando' && <Loader2 aria-hidden="true" className="w-6 h-6 animate-spin text-acao" />}
      {situacao === 'vazio' && <Inbox aria-hidden="true" className="w-6 h-6 text-texto-secundario" />}
      {situacao === 'erro' && <AlertTriangle aria-hidden="true" className="w-6 h-6 text-perigo" />}
      <p className="text-corpo font-bold text-texto">{titulo}</p>
      {descricao && <p className="text-apoio text-texto-secundario max-w-prose">{descricao}</p>}
      {acao}
    </div>
  );
};
