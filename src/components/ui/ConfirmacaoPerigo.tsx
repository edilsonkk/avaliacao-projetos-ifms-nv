import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Botao } from './Botao';
import { Modal } from './Modal';

interface PropriedadesConfirmacaoPerigo {
  aberto: boolean;
  titulo: string;
  mensagem?: string;
  /** Rótulo da ação destrutiva (botão vermelho, secundário na hierarquia). */
  rotuloConfirmar?: string;
  /** Rótulo da saída segura (botão primário, com o foco inicial). */
  rotuloCancelar?: string;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

/**
 * Confirmação de ação destrutiva, no padrão de duas etapas de docs/arquitetura/padroes.md.
 * O caminho seguro é o padrão: ele é o primário, recebe o foco e responde ao `Esc`.
 */
export const ConfirmacaoPerigo: React.FC<PropriedadesConfirmacaoPerigo> = ({
  aberto,
  titulo,
  mensagem,
  rotuloConfirmar = 'Confirmar',
  rotuloCancelar = 'Cancelar',
  aoConfirmar,
  aoCancelar,
}) => (
  <Modal
    aberto={aberto}
    aoFechar={aoCancelar}
    titulo={titulo}
    descricao={mensagem}
    papel="alertdialog"
    tamanho="pequeno"
    acoes={
      <>
        <Botao data-foco-inicial onClick={aoCancelar}>
          {rotuloCancelar}
        </Botao>
        <Botao variante="perigo" onClick={aoConfirmar}>
          {rotuloConfirmar}
        </Botao>
      </>
    }
  >
    <AlertTriangle aria-hidden="true" className="w-6 h-6 text-perigo" />
  </Modal>
);
