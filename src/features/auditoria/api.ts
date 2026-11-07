import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, traduzirErroEscritaAdmin } from '@/lib/sessaoAdmin';
import type { Achado, LinhaDaTrilha, MemorialProjeto, RespostaParaEnviar } from './tipos';

/**
 * Leituras e escritas da auditoria de notas. Tudo passa pelas funções do banco: a conferência,
 * o memorial e as quatro ações de ajuste manual. Nenhuma conta de nota é feita aqui — se o
 * front calculasse por conta própria, a auditoria estaria conferindo a si mesma.
 */

/** Colunas da trilha que a tela usa (nunca `select('*')`, que a RLS de coluna recusaria). */
const COLUNAS_TRILHA =
  'id_log, criado_em, acao, operacao, tabela, origem, motivo, ator_papel, ator_usuario, id_projeto, id_avaliacao, id_registro, campos_alterados, dados_antes, dados_depois';

const erroDeLeitura = (contexto: string, erro: unknown): Error =>
  new Error(`${contexto}: ${(erro as { message?: string } | null)?.message || String(erro)}`);

/** Conferência de notas do evento: a lista do que não fecha. Vazia significa "tudo confere". */
export const buscarAchados = async (idEvento: string): Promise<Achado[]> => {
  const { data, error } = await supabase.rpc('fn_auditar_notas', { p_id_evento: idEvento });
  if (error) throw erroDeLeitura('Não foi possível rodar a conferência de notas', error);
  return (data || []) as Achado[];
};

/** Memorial do projeto a partir do código (a interface nunca pede UUID à pessoa). */
export const buscarMemorialPorCodigo = async (
  codigoProjeto: string,
  idEvento: string,
): Promise<MemorialProjeto> => {
  const { data, error } = await supabase.rpc('fn_memorial_por_codigo', {
    p_codigo_projeto: codigoProjeto,
    p_id_evento: idEvento,
  });
  if (error) throw erroDeLeitura('Não foi possível abrir o memorial do projeto', error);
  if (!data) throw new Error(`Nenhum projeto com o código ${codigoProjeto} neste evento.`);
  return data as MemorialProjeto;
};

/** Memorial do projeto por id, quando a tela já veio de uma lista. */
export const buscarMemorialProjeto = async (idProjeto: string): Promise<MemorialProjeto> => {
  const { data, error } = await supabase.rpc('fn_memorial_projeto', { p_id_projeto: idProjeto });
  if (error) throw erroDeLeitura('Não foi possível abrir o memorial do projeto', error);
  return data as MemorialProjeto;
};

export interface FiltrosTrilha {
  tabela?: string;
  acao?: string;
  /** Só o que não passou por RPC nenhuma (origem 'direto'). */
  somenteForaDoFluxo?: boolean;
  limite?: number;
}

/** Trilha de auditoria do evento, da mais recente para a mais antiga. */
export const buscarTrilha = async (idEvento: string, filtros: FiltrosTrilha = {}): Promise<LinhaDaTrilha[]> => {
  let consulta = supabase
    .from('log_auditoria')
    .select(COLUNAS_TRILHA)
    .eq('id_evento', idEvento)
    .order('id_log', { ascending: false })
    .limit(filtros.limite ?? 500);

  if (filtros.tabela) consulta = consulta.eq('tabela', filtros.tabela);
  if (filtros.acao) consulta = consulta.eq('acao', filtros.acao);
  if (filtros.somenteForaDoFluxo) consulta = consulta.eq('origem', 'direto');

  const { data, error } = await consulta;
  if (error) throw erroDeLeitura('Não foi possível carregar a trilha de auditoria', error);

  return (data || []).map((linha: Record<string, unknown>) => ({
    id_log: Number(linha.id_log),
    quando: String(linha.criado_em ?? ''),
    acao: String(linha.acao ?? ''),
    operacao: String(linha.operacao ?? ''),
    tabela: String(linha.tabela ?? ''),
    origem: String(linha.origem ?? ''),
    motivo: (linha.motivo as string | null) ?? null,
    ator_papel: (linha.ator_papel as string | null) ?? null,
    ator: (linha.ator_usuario as string | null) ?? null,
    campos_alterados: (linha.campos_alterados as string[] | null) ?? null,
    dados_antes: (linha.dados_antes as Record<string, unknown> | null) ?? null,
    dados_depois: (linha.dados_depois as Record<string, unknown> | null) ?? null,
  }));
};

/** Nome de cada pessoa que aparece na trilha, para não exibir UUID. */
export const buscarNomesDeAtores = async (ids: string[]): Promise<Record<string, string>> => {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (unicos.length === 0) return {};
  const { data, error } = await supabase.from('usuarios').select('id_usuario, nome').in('id_usuario', unicos);
  if (error) return {};
  const mapa: Record<string, string> = {};
  for (const linha of data || []) mapa[String(linha.id_usuario)] = String(linha.nome);
  return mapa;
};

// ----------------------------------------------------------------------------
// Ajuste manual: as quatro ações oficiais do Admin sobre nota
// ----------------------------------------------------------------------------

const executarAcaoAdmin = async <T,>(nomeRpc: string, parametros: Record<string, unknown>): Promise<T> => {
  if (!(await garantirSessaoAdmin())) {
    throw new Error('Sessão de administrador expirada. Entre novamente para ajustar notas.');
  }
  const { data, error } = await supabase.rpc(nomeRpc, parametros);
  if (error) throw new Error(traduzirErroEscritaAdmin(error));
  return data as T;
};

export interface ResultadoCorrecao {
  sucesso: boolean;
  nota_anterior: number | null;
  nota_nova: number;
  projeto_em_quarentena: boolean;
}

/** Corrige as notas por critério; o banco recalcula a nota final pela fórmula oficial. */
export const corrigirRespostas = (
  idAvaliacao: string,
  respostas: RespostaParaEnviar[],
  motivo?: string,
): Promise<ResultadoCorrecao> =>
  executarAcaoAdmin('admin_corrigir_respostas_avaliacao', {
    p_id_avaliacao: idAvaliacao,
    p_respostas: respostas,
    p_motivo: motivo || null,
  });

/** Define a nota final sem mexer nas respostas. A conferência passa a mostrar "nota arbitrada". */
export const arbitrarNotaFinal = (idAvaliacao: string, nota: number, motivo?: string): Promise<ResultadoCorrecao> =>
  executarAcaoAdmin('admin_arbitrar_nota_final', {
    p_id_avaliacao: idAvaliacao,
    p_nota: nota,
    p_motivo: motivo || null,
  });

export interface ResultadoLancamento {
  sucesso: boolean;
  id_avaliacao: string;
  nota_final: number;
  acima_da_cota: boolean;
  projeto_em_quarentena: boolean;
}

/** Lança a avaliação de um avaliador do evento (ficha em papel, celular sem acesso). */
export const lancarAvaliacao = (dados: {
  idProjeto: string;
  idUsuario: string;
  idQuestionario: string;
  respostas: RespostaParaEnviar[];
  parecer?: string;
  motivo?: string;
  confirmarAcimaDaCota?: boolean;
}): Promise<ResultadoLancamento> =>
  executarAcaoAdmin('admin_lancar_avaliacao', {
    p_id_projeto: dados.idProjeto,
    p_id_usuario: dados.idUsuario,
    p_id_questionario: dados.idQuestionario,
    p_respostas: dados.respostas,
    p_parecer: dados.parecer || null,
    p_motivo: dados.motivo || null,
    p_confirmar_acima_da_cota: Boolean(dados.confirmarAcimaDaCota),
  });

/** Bónus ou penalidade de comissão na média do projeto. `delta = 0` remove o ajuste. */
export const ajustarMediaProjeto = (
  idProjeto: string,
  delta: number,
  motivo?: string,
): Promise<{ sucesso: boolean; codigo_projeto: string; ajuste_media: number }> =>
  executarAcaoAdmin('admin_ajustar_media_projeto', {
    p_id_projeto: idProjeto,
    p_delta: delta,
    p_motivo: motivo || null,
  });

/** Avaliadores do evento que podem receber um lançamento manual. */
export const buscarAvaliadoresDoEvento = async (
  idEvento: string,
): Promise<{ id_usuario: string; nome: string; email: string }[]> => {
  const { data, error } = await supabase
    .from('avaliadores_evento')
    .select('id_usuario, usuarios(id_usuario, nome, email, papel)')
    .eq('id_evento', idEvento);
  if (error) throw erroDeLeitura('Não foi possível listar os avaliadores do evento', error);
  return (data || [])
    .map((linha: Record<string, unknown>) => linha.usuarios as { id_usuario: string; nome: string; email: string; papel: string } | null)
    .filter((u): u is { id_usuario: string; nome: string; email: string; papel: string } => Boolean(u) && String(u?.papel).toUpperCase() === 'AVALIADOR')
    .map(({ id_usuario, nome, email }) => ({ id_usuario, nome, email }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
};

export interface FolhaDoEvento {
  evento: { id_evento: string; nome: string; edicao: string | null; data_evento: string | null } | null;
  emitida_em: string;
  trilha_comeca_em: string | null;
  projetos: MemorialProjeto[];
}

/** Folha consolidada: todos os projetos do evento com o memorial de cada avaliação. */
export const buscarFolhaDoEvento = async (idEvento: string): Promise<FolhaDoEvento> => {
  const { data, error } = await supabase.rpc('fn_memorial_evento', { p_id_evento: idEvento });
  if (error) throw erroDeLeitura('Não foi possível montar a folha de conferência do evento', error);
  return data as FolhaDoEvento;
};
