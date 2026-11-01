import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Aviso, type TipoAviso } from './Aviso';
import { ConfirmacaoPerigo } from './ConfirmacaoPerigo';

interface PedidoAviso {
  tipo?: TipoAviso;
  titulo: string;
  mensagem?: string;
  rotuloFechar?: string;
}

interface PedidoConfirmacao {
  titulo: string;
  mensagem?: string;
  rotuloConfirmar?: string;
  rotuloCancelar?: string;
}

export type TipoNotificacao = 'sucesso' | 'erro' | 'info';

export interface ApiAvisos {
  /** Diálogo que interrompe e espera ciência. Substitui o `alert()` do navegador. */
  avisar: (pedido: PedidoAviso) => Promise<void>;
  /** Decisão destrutiva. Substitui o `window.confirm()`; resolve `true` só na confirmação. */
  confirmar: (pedido: PedidoConfirmacao) => Promise<boolean>;
  /** Mensagem passageira, anunciada por leitor de tela, sem interromper o que a pessoa faz. */
  notificar: (texto: string, tipo?: TipoNotificacao) => void;
}

const ContextoAvisos = createContext<ApiAvisos | null>(null);

/** API de avisos do sistema. Exige o `ProvedorAvisos` no topo da aplicação. */
export const useAvisos = (): ApiAvisos => {
  const api = useContext(ContextoAvisos);
  if (!api) throw new Error('useAvisos precisa do <ProvedorAvisos> em volta da aplicação.');
  return api;
};

const TONS_NOTIFICACAO: Record<TipoNotificacao, string> = {
  sucesso: 'bg-acao text-white',
  erro: 'bg-perigo text-white',
  info: 'bg-info text-white',
};

/** Tempo que a mensagem passageira fica na tela. */
const DURACAO_NOTIFICACAO_MS = 4000;

/**
 * Centraliza os avisos da aplicação: diálogo de aviso, confirmação destrutiva e
 * uma única região viva (`aria-live`) para as mensagens passageiras — que antes
 * apareciam em caixas flutuantes sem papel nenhum, invisíveis para leitor de tela.
 */
export const ProvedorAvisos: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [aviso, setAviso] = useState<PedidoAviso | null>(null);
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null);
  const [notificacao, setNotificacao] = useState<{ texto: string; tipo: TipoNotificacao } | null>(null);
  const resolverAviso = useRef<(() => void) | null>(null);
  const resolverConfirmacao = useRef<((valor: boolean) => void) | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback(
    (pedido: PedidoAviso) =>
      new Promise<void>((resolve) => {
        resolverAviso.current = resolve;
        setAviso(pedido);
      }),
    [],
  );

  const confirmar = useCallback(
    (pedido: PedidoConfirmacao) =>
      new Promise<boolean>((resolve) => {
        resolverConfirmacao.current = resolve;
        setConfirmacao(pedido);
      }),
    [],
  );

  const notificar = useCallback((texto: string, tipo: TipoNotificacao = 'info') => {
    if (temporizador.current) clearTimeout(temporizador.current);
    setNotificacao({ texto, tipo });
    temporizador.current = setTimeout(() => setNotificacao(null), DURACAO_NOTIFICACAO_MS);
  }, []);

  const api = useMemo<ApiAvisos>(() => ({ avisar, confirmar, notificar }), [avisar, confirmar, notificar]);

  const fecharAviso = () => {
    setAviso(null);
    resolverAviso.current?.();
    resolverAviso.current = null;
  };

  const responderConfirmacao = (valor: boolean) => {
    setConfirmacao(null);
    resolverConfirmacao.current?.(valor);
    resolverConfirmacao.current = null;
  };

  return (
    <ContextoAvisos.Provider value={api}>
      {children}

      {/* Região viva única: o texto entra aqui e é anunciado sem roubar o foco */}
      <div
        role="status"
        aria-live={notificacao?.tipo === 'erro' ? 'assertive' : 'polite'}
        aria-atomic="true"
        className="fixed inset-x-4 top-4 z-40 flex justify-center pointer-events-none"
      >
        {notificacao && (
          <p
            className={`max-w-md px-4 py-3 rounded-cartao shadow-flutuante text-corpo font-bold ${TONS_NOTIFICACAO[notificacao.tipo]}`}
          >
            {notificacao.texto}
          </p>
        )}
      </div>

      <Aviso
        aberto={aviso !== null}
        tipo={aviso?.tipo}
        titulo={aviso?.titulo ?? ''}
        mensagem={aviso?.mensagem}
        rotuloFechar={aviso?.rotuloFechar}
        aoFechar={fecharAviso}
      />

      <ConfirmacaoPerigo
        aberto={confirmacao !== null}
        titulo={confirmacao?.titulo ?? ''}
        mensagem={confirmacao?.mensagem}
        rotuloConfirmar={confirmacao?.rotuloConfirmar}
        rotuloCancelar={confirmacao?.rotuloCancelar}
        aoConfirmar={() => responderConfirmacao(true)}
        aoCancelar={() => responderConfirmacao(false)}
      />
    </ContextoAvisos.Provider>
  );
};
