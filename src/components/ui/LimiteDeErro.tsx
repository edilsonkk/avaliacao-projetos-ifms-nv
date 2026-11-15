import React from 'react';
import { Botao } from './Botao';
import { Estado } from './Estado';

/**
 * Último anteparo da interface: erro que escapa de uma tela não pode apagar a página.
 *
 * Sem isto, qualquer exceção durante a renderização desmonta a árvore inteira e a pessoa fica
 * olhando uma tela branca, sem saber se o sistema caiu ou se a internet voltou. O caso mais
 * provável é o pedaço de uma tela que não terminou de baixar (ver `src/lib/carregarTela.ts`).
 *
 * Recarregar é oferecido em vez de "tentar de novo" porque o `React.lazy` guarda a falha do
 * `import()`: repetir a renderização reaproveita a mesma rejeição, e só uma carga nova da página
 * busca o arquivo outra vez.
 */

interface PropriedadesLimiteDeErro {
  children: React.ReactNode;
  titulo?: string;
  descricao?: string;
  /** Substituível no teste; por padrão recarrega a página. */
  aoRecarregar?: () => void;
}

interface EstadoLimiteDeErro {
  erro: Error | null;
}

export class LimiteDeErro extends React.Component<PropriedadesLimiteDeErro, EstadoLimiteDeErro> {
  override state: EstadoLimiteDeErro = { erro: null };

  static getDerivedStateFromError(erro: Error): EstadoLimiteDeErro {
    return { erro };
  }

  override componentDidCatch(erro: Error, informacao: React.ErrorInfo) {
    // O console é a única trilha que temos no navegador da pessoa; sem isto, o relato chega como
    // "a tela ficou branca" e não há como saber o que falhou.
    console.error('Erro não tratado na interface:', erro, informacao.componentStack);
  }

  private recarregar = () => {
    if (this.props.aoRecarregar) {
      this.props.aoRecarregar();
      return;
    }
    window.location.reload();
  };

  override render() {
    if (!this.state.erro) return this.props.children;

    return (
      <div className="mx-4 my-6 sm:mx-6">
        <Estado
          situacao="erro"
          titulo={this.props.titulo ?? 'Não foi possível abrir esta tela'}
          descricao={
            this.props.descricao ??
            'A tela não terminou de carregar, normalmente por queda de internet. Recarregue a página; o que você já enviou está salvo.'
          }
          acao={<Botao onClick={this.recarregar}>Recarregar a página</Botao>}
        />
      </div>
    );
  }
}
