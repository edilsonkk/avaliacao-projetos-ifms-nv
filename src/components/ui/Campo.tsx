import React, { useId } from 'react';
import { cn } from './cn';

interface BaseCampo {
  /** Rótulo visível, sempre ligado ao controle por `htmlFor` (regra do TESTES_TDD.md). */
  rotulo: string;
  /** Texto de apoio permanente, lido junto do campo. */
  descricao?: string;
  /** Mensagem de erro: liga `aria-invalid` e entra em `aria-describedby`. */
  erro?: string | null;
  /** Classe do bloco (rótulo + controle + mensagens). */
  className?: string;
}

const CLASSE_CONTROLE =
  'w-full min-h-11 px-3.5 py-2 rounded-controle bg-superficie text-texto text-corpo border border-borda-controle ' +
  'placeholder:text-texto-secundario disabled:opacity-50 aria-invalid:border-perigo';

/** Ids do rótulo, da descrição e do erro, e o `aria-describedby` já montado. */
const usarIdsCampo = (descricao?: string, erro?: string | null) => {
  const base = useId();
  const idDescricao = descricao ? `${base}-descricao` : undefined;
  const idErro = erro ? `${base}-erro` : undefined;
  return {
    id: base,
    idDescricao,
    idErro,
    descritores: [idDescricao, idErro].filter(Boolean).join(' ') || undefined,
  };
};

interface PropriedadesEnvelope extends BaseCampo {
  id: string;
  idDescricao?: string;
  idErro?: string;
  children: React.ReactNode;
}

const Envelope: React.FC<PropriedadesEnvelope> = ({ id, rotulo, descricao, erro, idDescricao, idErro, className, children }) => (
  <div className={cn('space-y-1.5', className)}>
    <label htmlFor={id} className="block text-apoio font-bold text-texto">
      {rotulo}
    </label>
    {children}
    {descricao && (
      <p id={idDescricao} className="text-apoio text-texto-secundario">
        {descricao}
      </p>
    )}
    {erro && (
      <p id={idErro} role="alert" className="text-apoio font-semibold text-perigo">
        {erro}
      </p>
    )}
  </div>
);

export interface PropriedadesCampo extends BaseCampo, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Classe do próprio `input` (o `className` estiliza o bloco). */
  classeControle?: string;
}

/** Campo de uma linha (texto, e-mail, data, número, arquivo...). */
export const Campo: React.FC<PropriedadesCampo> = ({ rotulo, descricao, erro, className, classeControle, ...resto }) => {
  const { id, idDescricao, idErro, descritores } = usarIdsCampo(descricao, erro);
  return (
    <Envelope id={id} rotulo={rotulo} descricao={descricao} erro={erro} idDescricao={idDescricao} idErro={idErro} className={className}>
      <input
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritores}
        className={cn(CLASSE_CONTROLE, classeControle)}
        {...resto}
      />
    </Envelope>
  );
};

export interface PropriedadesCampoArea extends BaseCampo, Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  classeControle?: string;
}

/** Campo de texto longo (parecer, observações). */
export const CampoArea: React.FC<PropriedadesCampoArea> = ({ rotulo, descricao, erro, className, classeControle, rows = 4, ...resto }) => {
  const { id, idDescricao, idErro, descritores } = usarIdsCampo(descricao, erro);
  return (
    <Envelope id={id} rotulo={rotulo} descricao={descricao} erro={erro} idDescricao={idDescricao} idErro={idErro} className={className}>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritores}
        className={cn(CLASSE_CONTROLE, 'py-2.5', classeControle)}
        {...resto}
      />
    </Envelope>
  );
};

export interface PropriedadesCampoSelecao extends BaseCampo, Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  classeControle?: string;
  children: React.ReactNode;
}

/** Campo de escolha; as `<option>` vêm por `children`. */
export const CampoSelecao: React.FC<PropriedadesCampoSelecao> = ({ rotulo, descricao, erro, className, classeControle, children, ...resto }) => {
  const { id, idDescricao, idErro, descritores } = usarIdsCampo(descricao, erro);
  return (
    <Envelope id={id} rotulo={rotulo} descricao={descricao} erro={erro} idDescricao={idDescricao} idErro={idErro} className={className}>
      <select
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritores}
        className={cn(CLASSE_CONTROLE, classeControle)}
        {...resto}
      >
        {children}
      </select>
    </Envelope>
  );
};
