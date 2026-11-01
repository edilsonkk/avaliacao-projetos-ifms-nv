import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Botao } from './Botao';
import { Modal } from './Modal';

export type TipoAviso = 'sucesso' | 'atencao' | 'erro';

interface PropriedadesAviso {
  aberto: boolean;
  tipo?: TipoAviso;
  titulo: string;
  mensagem?: string;
  rotuloFechar?: string;
  aoFechar: () => void;
}

const ICONES: Record<TipoAviso, React.ReactNode> = {
  sucesso: <CheckCircle2 aria-hidden="true" className="w-6 h-6 text-acao shrink-0" />,
  atencao: <AlertTriangle aria-hidden="true" className="w-6 h-6 text-aviso shrink-0" />,
  erro: <AlertTriangle aria-hidden="true" className="w-6 h-6 text-perigo shrink-0" />,
};

/**
 * Substitui o `alert()` do navegador: mesma tipografia, cores e botões da tela,
 * e acompanha o tema e o tamanho de texto escolhidos pela pessoa.
 */
export const Aviso: React.FC<PropriedadesAviso> = ({
  aberto,
  tipo = 'atencao',
  titulo,
  mensagem,
  rotuloFechar = 'Entendi',
  aoFechar,
}) => (
  <Modal aberto={aberto} aoFechar={aoFechar} titulo={titulo} tamanho="pequeno">
    <div className="flex items-start gap-3">
      {ICONES[tipo]}
      {mensagem && <p className="text-corpo text-texto">{mensagem}</p>}
    </div>
    <div className="flex justify-end">
      <Botao data-foco-inicial onClick={aoFechar}>
        {rotuloFechar}
      </Botao>
    </div>
  </Modal>
);
