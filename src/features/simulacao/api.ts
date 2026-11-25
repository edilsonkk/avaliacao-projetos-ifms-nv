import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, traduzirErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { buscarTodas } from '@/lib/buscarTodas';
import { PREFIXO_EVENTO_SIMULACAO } from '@/lib/simulacao/dados';
import type { PlanoSimulacao } from '@/lib/simulacao/plano';
import type { PonteSimulacao, QuestionarioResolvido } from '@/lib/simulacao/motor';
import type { EventoAtivo, PreVoo, ResumoSemeadura, SimulacaoOrfa } from './tipos';

/**
 * Acesso ao banco da simulação de evento.
 *
 * Único arquivo da feature que fala com o Supabase. Tudo aqui roda com a sessão do Admin já
 * autenticado: `sortear_proximo_projeto` e `fn_enviar_avaliacao` isentam quem passa em
 * `is_admin()` da conferência de `avaliador_atual()`, e é isso que permite exercitar o
 * caminho real de avaliação sem a chave de serviço e sem migration nova.
 *
 * Ver docs/operacao/simulacao-de-evento.md e docs/decisoes/0021-*.
 */

/** Linhas por requisição nas escritas em lote. Um lote por tabela (regra 8 do AGENTS.md). */
const TAMANHO_LOTE = 500;

const erroDeEscrita = (contexto: string, erro: unknown): Error =>
  new Error(`${contexto}: ${traduzirErroEscritaAdmin(erro)}`);

const emPedacos = <T>(itens: T[], tamanho = TAMANHO_LOTE): T[][] => {
  const pedacos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) pedacos.push(itens.slice(i, i + tamanho));
  return pedacos;
};

/** Grava uma tabela em lote, fatiando só pelo tamanho do payload. */
const gravarEmLote = async (
  tabela: string,
  linhas: object[],
  conflito: string,
  contexto: string,
): Promise<void> => {
  for (const pedaco of emPedacos(linhas)) {
    const { error } = await supabase.from(tabela).upsert(pedaco, { onConflict: conflito });
    if (error) throw erroDeEscrita(contexto, error);
  }
};

/** Lê a descrição do evento de simulação para achar o nome do evento anterior. */
const nomeAnteriorDaDescricao = (descricao: string | null): string | null => {
  const achado = /Evento ativo anterior: "([^"]+)"/.exec(descricao ?? '');
  return achado?.[1] ?? null;
};

// ------------------------------------------------------------------------- pré-voo

/** O que existe antes de começar: o evento ativo e eventuais simulações esquecidas. */
export const lerPreVoo = async (): Promise<PreVoo> => {
  const { data: ativos, error } = await supabase
    .from('eventos')
    .select('id_evento, nome_evento')
    .eq('is_ativo', true)
    .limit(1);
  if (error) throw erroDeEscrita('Não foi possível ler o evento ativo', error);

  const ativo = ativos?.[0] ?? null;
  let eventoAtivo: EventoAtivo | null = null;
  if (ativo) {
    // A janela é resolvida pelo BANCO, no fuso do evento: o relógio de quem abriu o painel
    // pode estar em outro fuso, e esse aviso não pode depender disso.
    const { data: janela } = await supabase.rpc('fn_janela_avaliacao_aberta', {
      p_id_evento: ativo.id_evento,
    });
    eventoAtivo = {
      id_evento: ativo.id_evento,
      nome_evento: ativo.nome_evento,
      janelaAberta: janela === true,
    };
  }

  const { data: simulacoes, error: erroOrfas } = await supabase
    .from('eventos')
    .select('id_evento, nome_evento, is_ativo, descricao')
    .like('nome_evento', `${PREFIXO_EVENTO_SIMULACAO}%`)
    .order('created_at', { ascending: false });
  if (erroOrfas) throw erroDeEscrita('Não foi possível listar as simulações', erroOrfas);

  const orfas: SimulacaoOrfa[] = (simulacoes ?? []).map((linha) => ({
    id_evento: linha.id_evento,
    nome_evento: linha.nome_evento,
    is_ativo: linha.is_ativo === true,
    nomeEventoAnterior: nomeAnteriorDaDescricao(linha.descricao ?? null),
  }));

  return { eventoAtivo, orfas };
};

// ----------------------------------------------------------------------- semeadura

/**
 * Troca o evento ativo num único upsert.
 *
 * Não usa o par `insert(is_ativo: true)` + `update(is_ativo: false)`: esse caminho abre uma
 * janela com dois eventos ativos, e `evento_ativo_id()` resolve com `LIMIT 1` — o telão
 * poderia mostrar o evento errado. Aqui não existe instante com dois ativos nem com nenhum,
 * e uma falha não muda nada.
 */
export const trocarEventoAtivo = async (idEvento: string): Promise<void> => {
  if (!(await garantirSessaoAdmin())) throw new Error('Sessão de administrador expirada.');
  const { data: eventos, error } = await supabase.from('eventos').select('*');
  if (error) throw erroDeEscrita('Não foi possível ler os eventos', error);

  const linhas = (eventos ?? []).map((evento) => ({
    ...evento,
    is_ativo: evento.id_evento === idEvento,
  }));
  const { error: erroGravar } = await supabase
    .from('eventos')
    .upsert(linhas, { onConflict: 'id_evento' });
  if (erroGravar) throw erroDeEscrita('Não foi possível trocar o evento ativo', erroGravar);
};

/**
 * Grava a feira fictícia inteira, na ordem em que as dependências exigem.
 *
 * O evento nasce INATIVO e só é ativado no fim: se a semeadura falhar no meio, o evento ativo
 * da instalação continua o que era.
 */
export const semear = async (plano: PlanoSimulacao): Promise<ResumoSemeadura> => {
  if (!(await garantirSessaoAdmin())) throw new Error('Sessão de administrador expirada.');

  const { error: erroEvento } = await supabase.from('eventos').insert(plano.evento);
  if (erroEvento) throw erroDeEscrita('Não foi possível criar o evento de simulação', erroEvento);

  await gravarEmLote('instituicoes', plano.instituicoes, 'id_instituicao', 'Falha ao gravar instituições');
  await gravarEmLote('modalidades', plano.modalidades, 'id_modalidade', 'Falha ao gravar modalidades');
  await gravarEmLote('areas_tematicas', plano.areas, 'id_area', 'Falha ao gravar áreas');
  await gravarEmLote('questionarios', plano.questionarios, 'id_questionario', 'Falha ao gravar questionários');
  await gravarEmLote('perguntas_questionario', plano.perguntas, 'id_pergunta', 'Falha ao gravar as perguntas');
  await gravarEmLote('projetos', plano.projetos, 'id_evento,codigo_projeto', 'Falha ao gravar projetos');
  await gravarEmLote('usuarios', plano.usuarios, 'email', 'Falha ao gravar avaliadores');
  await gravarEmLote('avaliadores_evento', plano.vinculos, 'id_usuario,id_evento', 'Falha ao inscrever avaliadores');
  await gravarEmLote('avaliador_areas', plano.avaliadorAreas, 'id_usuario,id_evento,id_area', 'Falha ao gravar as áreas dos avaliadores');
  if (plano.modalidadesBloqueadas.length > 0) {
    await gravarEmLote(
      'avaliador_modalidades_bloqueadas', plano.modalidadesBloqueadas,
      'id_usuario,id_evento,id_modalidade', 'Falha ao gravar modalidades bloqueadas',
    );
  }

  // Staff pelo caminho oficial do Gestor de Staff: aqui não precisamos dos ids de volta.
  if (plano.staff.length > 0) {
    const { error } = await supabase.rpc('admin_salvar_staff', {
      p_id_evento: plano.evento.id_evento,
      p_itens: plano.staff,
    });
    if (error) throw erroDeEscrita('Não foi possível cadastrar o staff', error);
  }

  await trocarEventoAtivo(plano.evento.id_evento);

  return {
    idEvento: plano.evento.id_evento,
    nomeEvento: plano.evento.nome_evento,
    projetos: plano.projetos.length,
    avaliadores: plano.usuarios.length,
    staff: plano.staff.length,
    questionarios: plano.questionarios.length,
  };
};

// --------------------------------------------------------------------------- ponte

/**
 * Ponte pela sessão do Admin: um só cliente, uma só sessão, para toda a rodada.
 *
 * É o modo que roda nos dois ambientes. Ele exercita as regras de negócio sob concorrência,
 * mas não o caminho de autenticação do avaliador — para isso existe o modo
 * "sessão por avaliador", em `apiSessaoPorAvaliador.ts`, restrito ao banco local.
 */
export const criarPontePelaSessaoDoAdmin = (): PonteSimulacao => ({
  checkIn: async (idProjeto) => {
    const { error } = await supabase.rpc('fn_check_in_projeto', {
      p_id_projeto: idProjeto,
      p_check_in: true,
    });
    if (error) throw new Error(traduzirErroEscritaAdmin(error));
  },

  sortear: async (idUsuario, idEvento) => {
    const { data, error } = await supabase.rpc('sortear_proximo_projeto', {
      p_id_usuario: idUsuario,
      p_id_evento: idEvento,
    });
    if (error) throw new Error(error.message);
    // A RPC devolve o uuid direto; algumas versões do PostgREST embrulham em objeto.
    if (data && typeof data === 'object') {
      const primeiro = Object.values(data as Record<string, unknown>)[0];
      return (primeiro as string) ?? null;
    }
    return (data as string | null) ?? null;
  },

  lerProjeto: async (idProjeto) => {
    const { data, error } = await supabase
      .from('projetos')
      .select('id_questionario_fixado')
      .eq('id_projeto', idProjeto)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { idQuestionarioFixado: data?.id_questionario_fixado ?? null };
  },

  lerQuestionario: async (idQuestionario): Promise<QuestionarioResolvido> => {
    const { data, error } = await supabase
      .from('questionarios')
      .select('id_questionario, escala_minima, escala_maxima, is_voto_popular')
      .eq('id_questionario', idQuestionario)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Questionário não encontrado.');

    const perguntas = await buscarTodas<{ id_pergunta: string }>(() =>
      supabase
        .from('perguntas_questionario')
        .select('id_pergunta')
        .eq('id_questionario', idQuestionario)
        .order('ordem', { ascending: true }),
    );

    // A escala e as perguntas vêm do BANCO, nunca de constante: é o questionário efetivo
    // que define o que `fn_enviar_avaliacao` vai aceitar.
    return {
      id_questionario: data.id_questionario,
      escala_minima: Number(data.escala_minima),
      escala_maxima: Number(data.escala_maxima),
      is_voto_popular: data.is_voto_popular === true,
      idsPerguntas: perguntas.map((pergunta) => pergunta.id_pergunta),
    };
  },

  enviar: async (entrada) => {
    const { error } = await supabase.rpc('fn_enviar_avaliacao', {
      p_id_usuario: entrada.idUsuario,
      p_id_projeto: entrada.idProjeto,
      p_id_questionario: entrada.idQuestionario,
      p_respostas: entrada.respostas,
      p_parecer: entrada.parecer,
      p_tempo_presenca: null,
    });
    if (error) throw new Error(error.message);
  },
});

// ----------------------------------------------------------------------- encerrar

/**
 * Encerra a simulação: devolve as travas e volta o evento ativo para o que era antes.
 *
 * `admin_finalizar_evento` recebe o id EXPLÍCITO de propósito: o padrão dela resolve por
 * `evento_ativo_id()`, e num banco com dois eventos isso encerraria a feira errada.
 */
export const encerrarSimulacao = async (
  idSimulacao: string,
  nomeEventoAnterior: string | null,
): Promise<void> => {
  if (!(await garantirSessaoAdmin())) throw new Error('Sessão de administrador expirada.');

  const { error } = await supabase.rpc('admin_finalizar_evento', { p_id_evento: idSimulacao });
  if (error) throw erroDeEscrita('Não foi possível finalizar a simulação', error);

  const idAnterior = await acharEventoPorNome(nomeEventoAnterior);
  if (idAnterior) await trocarEventoAtivo(idAnterior);
};

/** Acha o evento pelo NOME guardado na descrição da simulação (nunca por UUID na interface). */
const acharEventoPorNome = async (nome: string | null): Promise<string | null> => {
  if (!nome) return null;
  const { data } = await supabase
    .from('eventos')
    .select('id_evento')
    .eq('nome_evento', nome)
    .limit(1);
  return data?.[0]?.id_evento ?? null;
};
