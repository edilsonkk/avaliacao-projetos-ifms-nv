/**
 * Tipos da auditoria de notas. Espelham o que as funções do banco devolvem
 * (`fn_auditar_notas`, `fn_memorial_avaliacao`, `fn_memorial_projeto`) — ver
 * docs/regras-de-negocio/auditoria-de-notas.md.
 */

export type Severidade = 'grave' | 'atencao' | 'informativo';

/** Um achado da conferência: o que o sistema não conseguiu fechar. */
export interface Achado {
  severidade: Severidade;
  codigo: string;
  titulo: string;
  id_projeto: string | null;
  codigo_projeto: string | null;
  id_avaliacao: string | null;
  esperado: string | null;
  encontrado: string | null;
  detalhe: string | null;
}

export type TipoAjuste = 'respostas_corrigidas' | 'nota_arbitrada' | 'lancada_pelo_admin';

export interface PessoaResumida {
  id_usuario: string;
  nome: string;
}

export interface MarcaDeAjuste {
  tipo: TipoAjuste;
  em: string | null;
  motivo: string | null;
  por: PessoaResumida | null;
}

/** Uma linha do memorial: o critério, o peso e o produto que entra na soma. */
export interface CriterioDoMemorial {
  id_pergunta: string;
  ordem: number;
  criterio: string;
  ajuda: string | null;
  peso_calculo: number;
  peso_desempate: number;
  nota: number;
  produto: number;
}

/** A conta de uma nota, aberta. */
export interface MemorialAvaliacao {
  id_avaliacao: string;
  codigo_projeto: string | null;
  titulo_projeto: string;
  avaliador: { id_usuario: string; nome: string; email: string } | null;
  status: string;
  enviada_em: string | null;
  presenca_em: string | null;
  criada_em: string | null;
  parecer: string | null;
  is_quarentena: boolean;
  cancelada_em: string | null;
  cancelada_por: PessoaResumida | null;
  questionario: {
    id_questionario: string;
    titulo: string;
    escala_minima: number;
    escala_maxima: number;
  } | null;
  criterios: CriterioDoMemorial[];
  soma_produtos: number | null;
  soma_pesos: number | null;
  nota_bruta: number | null;
  nota_arredondada: number | null;
  nota_gravada: number | null;
  confere: boolean;
  motivo_do_log: string | null;
  ajuste: MarcaDeAjuste | null;
}

export interface MediaPorPrioridade {
  prioridade: number;
  ordem: number;
  criterio: string;
  media: number;
}

export interface LinhaDaTrilha {
  id_log: number;
  quando: string;
  acao: string;
  operacao: string;
  tabela: string;
  origem: string;
  motivo: string | null;
  ator_papel: string | null;
  ator: string | null;
  campos_alterados: string[] | null;
  dados_antes: Record<string, unknown> | null;
  dados_depois: Record<string, unknown> | null;
}

/** O memorial do projeto: como a média dele se formou e o que aconteceu com ela. */
export interface MemorialProjeto {
  id_projeto: string;
  codigo_projeto: string | null;
  titulo: string;
  modalidade: string;
  area_tematica: string;
  instituicao: string;
  estande: string | null;
  check_in: boolean;
  fora_da_competicao: boolean;
  cota: number;
  questionario_fixado: {
    id_questionario: string;
    titulo: string;
    escala_minima: number;
    escala_maxima: number;
  } | null;
  avaliacoes_ativas: MemorialAvaliacao[];
  avaliacoes_canceladas: MemorialAvaliacao[];
  total_avaliacoes: number;
  notas: number[];
  media_geral: number | null;
  ajuste_media: number;
  media_final: number | null;
  ajuste_media_em: string | null;
  ajuste_media_motivo: string | null;
  ajuste_media_por: PessoaResumida | null;
  media_do_ranking: number | null;
  posicao_no_ranking: number | null;
  desempate: {
    chave: number[];
    por_prioridade: MediaPorPrioridade[];
  };
  quarentena: {
    pendente: boolean;
    nota_minima: number | null;
    nota_maxima: number | null;
    divergencia: number | null;
    limite: number;
    resolvida_em: string | null;
    resolvida_por: PessoaResumida | null;
  };
  achados: Omit<Achado, 'id_projeto' | 'codigo_projeto'>[];
  trilha: LinhaDaTrilha[];
  trilha_comeca_em: string | null;
}

/** Uma resposta a enviar numa correção ou num lançamento. */
export interface RespostaParaEnviar {
  id_pergunta: string;
  nota: number;
}
