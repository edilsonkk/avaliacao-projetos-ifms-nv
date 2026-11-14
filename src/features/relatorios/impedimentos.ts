/**
 * Agrupamento dos impedimentos por avaliador, para os relatórios de **ausências**
 * (`historico_impedimentos.tipo = 'ausencia'`) e de **devoluções** (`tipo = 'conflito'`, o botão
 * "Devolver (Conflito de Interesse)" da tela do avaliador).
 *
 * Os dois relatórios têm exatamente a mesma forma — mesma origem no banco, mesmas colunas, mesmo
 * accordion —, então a conta vive aqui, em funções puras testáveis, em vez de duas vezes dentro de
 * `RelatoriosAdmin`.
 */

import { compararNatural } from '@/components/ui/CabecalhoOrdenavel';

/** Uma linha do relatório: o projeto que o avaliador deixou de avaliar. */
export interface ItemImpedimento {
  id_usuario: string;
  avaliador_nome: string;
  avaliador_email: string;
  id_projeto: string;
  codigo_projeto?: string | null;
  projeto_titulo: string;
  projeto_modalidade?: string | null;
  projeto_area?: string | null;
  projeto_instituicao?: string | null;
  /** Quando o impedimento foi registrado. */
  data_registro?: string | null;
  /** Avaliações ativas que o projeto tem hoje, para mostrar se ele seguiu sem nota. */
  total_avaliacoes_atuais: number;
}

/** Os impedimentos de um avaliador, já contados. */
export interface GrupoImpedimento {
  id_usuario: string;
  avaliador_nome: string;
  avaliador_email: string;
  total: number;
  itens: ItemImpedimento[];
}

export type ColunaImpedimento = 'avaliador' | 'total';
export type DirecaoOrdenacao = 'asc' | 'desc';

/** Um grupo por avaliador, com o total já calculado a partir dos itens. */
export const agruparImpedimentosPorAvaliador = (itens: ItemImpedimento[]): GrupoImpedimento[] => {
  const mapa = new Map<string, GrupoImpedimento>();

  itens.forEach((item) => {
    const chave = item.id_usuario || item.avaliador_email || item.avaliador_nome;
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        id_usuario: item.id_usuario || chave,
        avaliador_nome: item.avaliador_nome,
        avaliador_email: item.avaliador_email,
        total: 0,
        itens: [],
      });
    }
    mapa.get(chave)!.itens.push(item);
  });

  return Array.from(mapa.values()).map((grupo) => ({ ...grupo, total: grupo.itens.length }));
};

/**
 * Busca por avaliador ou por projeto: quando o nome ou o e-mail do avaliador bate, o grupo inteiro
 * fica; quando só alguns projetos batem, o grupo fica com esses projetos.
 */
export const filtrarImpedimentos = (grupos: GrupoImpedimento[], termo: string): GrupoImpedimento[] => {
  const t = termo.trim().toLowerCase();
  if (!t) return grupos;

  return grupos
    .map((grupo) => {
      const avaliadorBate =
        grupo.avaliador_nome.toLowerCase().includes(t) || grupo.avaliador_email.toLowerCase().includes(t);
      if (avaliadorBate) return grupo;

      const itensFiltrados = grupo.itens.filter((item) =>
        [item.codigo_projeto, item.projeto_titulo, item.projeto_modalidade, item.projeto_area]
          .some((campo) => (campo || '').toLowerCase().includes(t)),
      );
      return itensFiltrados.length > 0 ? { ...grupo, itens: itensFiltrados } : null;
    })
    .filter((grupo): grupo is GrupoImpedimento => grupo !== null);
};

/** Ordena por nome do avaliador (ordem natural) ou pelo total de impedimentos. */
export const ordenarImpedimentos = (
  grupos: GrupoImpedimento[],
  coluna: ColunaImpedimento,
  direcao: DirecaoOrdenacao,
): GrupoImpedimento[] =>
  [...grupos].sort((a, b) => {
    if (coluna === 'total') {
      return direcao === 'asc' ? a.total - b.total : b.total - a.total;
    }
    const comparacao = compararNatural(a.avaliador_nome, b.avaliador_nome);
    return direcao === 'asc' ? comparacao : -comparacao;
  });
