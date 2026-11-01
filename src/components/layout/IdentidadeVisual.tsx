import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  IDENTIDADE_VAZIA,
  aplicarIconeDoNavegador,
  lerIdentidadeVisual,
  type IdentidadeVisual,
} from '@/lib/identidadeVisual';

interface ApiIdentidadeVisual {
  identidade: IdentidadeVisual;
  /** Relê do banco. Use depois de enviar ou remover uma imagem nas Configurações. */
  recarregar: () => Promise<void>;
}

const Contexto = createContext<ApiIdentidadeVisual>({ identidade: IDENTIDADE_VAZIA, recarregar: async () => {} });

/** Ícone e imagem do evento ativo, para o cabeçalho e as telas. */
export const useIdentidadeVisual = (): ApiIdentidadeVisual => useContext(Contexto);

/**
 * Lê a identidade visual uma vez ao abrir o app e aplica o ícone na aba do navegador.
 * Sem provedor (em teste de componente isolado), o contexto devolve a identidade vazia
 * e cada tela cai no padrão — ninguém quebra por causa disso.
 */
export const ProvedorIdentidadeVisual: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [identidade, setIdentidade] = useState<IdentidadeVisual>(IDENTIDADE_VAZIA);

  const recarregar = useCallback(async () => {
    try {
      const atual = await lerIdentidadeVisual();
      setIdentidade(atual);
      aplicarIconeDoNavegador(atual.url_icone);
    } catch {
      // Sem rede ou sem evento ativo: segue com o ícone do repositório
      aplicarIconeDoNavegador(null);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const valor = useMemo<ApiIdentidadeVisual>(() => ({ identidade, recarregar }), [identidade, recarregar]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
};

interface PropriedadesImagemEvento {
  /** `baixa` para o topo da tela do avaliador; `media` para login, autocadastro e Telão. */
  altura?: 'baixa' | 'media';
  className?: string;
}

/**
 * Imagem do evento, quando o Admin enviou uma. Fica no fluxo normal da página (não é
 * fixa): no celular do avaliador ela sai de vista quando a pessoa desce para as perguntas.
 */
export const ImagemEvento: React.FC<PropriedadesImagemEvento> = ({ altura = 'media', className }) => {
  const { identidade } = useIdentidadeVisual();
  if (!identidade.url_imagem_evento) return null;

  return (
    <img
      src={identidade.url_imagem_evento}
      alt={identidade.nome_evento ? `Identidade visual de ${identidade.nome_evento}` : 'Identidade visual do evento'}
      className={`w-full object-contain rounded-cartao ${altura === 'baixa' ? 'max-h-24' : 'max-h-36'} ${className ?? ''}`}
    />
  );
};
