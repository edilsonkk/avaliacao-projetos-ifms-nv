/**
 * Gerador do plano da simulação: a feira fictícia inteira, como dados, antes de qualquer
 * escrita no banco.
 *
 * É uma função PURA. Recebe os parâmetros, uma semente e um gerador de id; devolve as linhas
 * de cada tabela. Nada de rede, nada de relógio além do instante que recebe. Duas razões:
 *
 *  1. a mesma semente reproduz a mesma feira, então uma rodada problemática volta igual;
 *  2. dá para testar o conteúdo do plano sem banco e sem mock — é onde moram as regras de
 *     proporção (check-in, credenciamento, voto popular, quarentena).
 *
 * Os ids saem do cliente, e não das RPCs `admin_salvar_*`, porque o motor precisa saber de
 * antemão quais avaliadores e projetos existem. Todas as tabelas envolvidas têm policy de
 * admin `FOR ALL` e nenhuma tem trigger de auditoria, então o upsert em lote (regra 8) não
 * perde nada em relação à RPC — é o mesmo caminho de `scripts/semear-simulacao.mjs`.
 *
 * Módulo puro: docs/arquitetura/frontend.md, regra 3.
 */
import {
  AREAS,
  CAMPI,
  CONTEXTOS,
  CORREDORES,
  CRITERIOS_TECNICOS,
  CRITERIOS_VOTO_POPULAR,
  DOMINIO_SIMULACAO,
  MODALIDADES,
  NOMES,
  OBJETOS,
  PREFIXO_EVENTO_SIMULACAO,
  SOBRENOMES,
  VERBOS,
  agoraNoFusoDoEvento,
  normalizar,
} from './dados';
import { criarSorteio, inteiroEntre, umDe, type Sorteio } from './aleatorio';
import type { ParametrosSimulacao } from './parametros';

/**
 * Fatia dos avaliadores que recebe uma modalidade bloqueada.
 *
 * Existe para a regra ser exercitada de verdade; fica baixa de propósito, porque bloquear
 * muita gente faria o sorteio devolver vazio e a feira empacar por configuração, não por
 * defeito.
 */
const FRACAO_COM_MODALIDADE_BLOQUEADA = 0.2;

/** Escala de todo questionário da simulação. */
export const ESCALA_SIMULACAO = { minima: 0, maxima: 10 } as const;

export interface LinhaEvento {
  id_evento: string;
  nome_evento: string;
  edicao: string;
  descricao: string | null;
  logo_url: null;
  is_ativo: boolean;
  sistema_liberado: boolean;
  data_evento: string;
  horario_inicio: string;
  horario_fim: string;
  cota_avaliacoes_padrao: number;
  minutos_timeout_lock: number;
  minutos_validade_pareamento: number;
  metodos_vinculo: string;
  limite_corte: number;
  intervalo_pausa_avaliador: number;
  data_inicio: string;
  data_fim: string;
  minutos_validade_codigo_acesso: number;
  tamanho_codigo: number;
  max_tentativas_codigo: number;
  url_icone: null;
  url_imagem_evento: null;
  fixar_questionario_primeira_avaliacao: boolean;
}

export interface LinhaInstituicao {
  id_instituicao: string;
  id_evento: string;
  nome_exibicao: string;
  nome_normalizado: string;
  sigla: string;
  campus: string;
  cidade: string;
  estado: string;
}

export interface LinhaModalidade {
  id_modalidade: string;
  id_evento: string;
  nome_modalidade: string;
  codigo: string;
  nivel: string;
  descricao: string;
}

export interface LinhaArea {
  id_area: string;
  id_evento: string;
  nome_area: string;
}

export interface LinhaQuestionario {
  id_questionario: string;
  id_evento: string;
  titulo: string;
  escala_minima: number;
  escala_maxima: number;
  is_voto_popular: boolean;
}

export interface LinhaPergunta {
  id_pergunta: string;
  id_questionario: string;
  ordem: number;
  texto_pergunta: string;
  peso_calculo: number;
  peso_desempate: number;
  descricao_lembrete: string;
}

export interface LinhaProjeto {
  id_projeto: string;
  id_evento: string;
  codigo_projeto: string;
  id_instituicao: string;
  id_area: string;
  id_modalidade: string;
  titulo: string;
  estande: string;
  corredor: string;
  expositores: string;
  is_check_in_realizado: boolean;
  is_fora_da_competicao: boolean;
  forcar_topo_fila: boolean;
  contagem_ausencia: number;
  ajuste_media: number;
}

export interface LinhaUsuario {
  id_usuario: string;
  nome: string;
  email: string;
  papel: string;
}

export interface LinhaAvaliadorEvento {
  id_usuario: string;
  id_evento: string;
  id_instituicao: string;
  is_credenciado: boolean;
  id_questionario: string | null;
}

export interface LinhaAvaliadorArea {
  id_usuario: string;
  id_evento: string;
  id_area: string;
}

export interface LinhaModalidadeBloqueada {
  id_usuario: string;
  id_evento: string;
  id_modalidade: string;
}

/** Item de `admin_salvar_staff`, que é o caminho do Gestor de Staff. */
export interface ItemStaff {
  nome: string;
  email: string;
  papel: string;
}

/** O que o motor precisa saber de cada avaliador, já resolvido pelo plano. */
export interface AvaliadorDoPlano {
  id_usuario: string;
  nome: string;
  /** Instituição de origem: o banco recusa avaliar projeto da mesma instituição. */
  id_instituicao: string;
  /** Votante do voto popular: fixado no questionário de voto popular. */
  ehVotante: boolean;
  /** Questionário ao qual está preso, quando houver. */
  idQuestionarioVinculado: string | null;
  /** Semente própria, para o ritmo de cada ator divergir. */
  semente: number;
}

export interface PlanoSimulacao {
  evento: LinhaEvento;
  instituicoes: LinhaInstituicao[];
  modalidades: LinhaModalidade[];
  areas: LinhaArea[];
  questionarios: LinhaQuestionario[];
  perguntas: LinhaPergunta[];
  projetos: LinhaProjeto[];
  usuarios: LinhaUsuario[];
  vinculos: LinhaAvaliadorEvento[];
  avaliadorAreas: LinhaAvaliadorArea[];
  modalidadesBloqueadas: LinhaModalidadeBloqueada[];
  staff: ItemStaff[];
  /** Avaliadores prontos para o motor. */
  avaliadores: AvaliadorDoPlano[];
  /** Ids dos questionários técnicos, na ordem. */
  idsQuestionariosTecnicos: string[];
  /** Id do questionário de voto popular. */
  idQuestionarioVotoPopular: string;
  /** Projetos que o motor fará check-in durante a rodada. */
  projetosParaCheckIn: string[];
  /** Projetos escolhidos para receber notas divergentes, e cair em quarentena. */
  projetosDivergentes: string[];
  /** O nome do evento que estava ativo, para restaurar ao encerrar. */
  nomeEventoAnterior: string | null;
}

export interface EntradaDoPlano {
  parametros: ParametrosSimulacao;
  /** Nome do evento ativo antes da simulação, guardado para a restauração. */
  nomeEventoAnterior?: string | null;
  /** Injetável para o teste: por padrão, `crypto.randomUUID`. */
  gerarId?: () => string;
  /** Injetável para o teste: o instante de referência. */
  agora?: Date;
}

/** Quantos itens de uma lista entram, dada uma porcentagem. */
const quantosDe = (total: number, porcento: number): number =>
  Math.round(total * (Math.min(Math.max(porcento, 0), 100) / 100));

const nomeDePessoa = (sorteio: Sorteio): string =>
  `${umDe(sorteio, NOMES)} ${umDe(sorteio, SOBRENOMES)} ${umDe(sorteio, SOBRENOMES)}`;

/**
 * Monta a feira fictícia inteira.
 *
 * `is_check_in_realizado` nasce falso em todos os projetos de propósito: o check-in é ação
 * do motor durante a rodada, e é o que faz o telão mostrar os projetos entrando no pavilhão
 * em vez de já aparecerem todos presentes.
 */
export const gerarPlanoSimulacao = (entrada: EntradaDoPlano): PlanoSimulacao => {
  const { parametros } = entrada;
  const gerarId = entrada.gerarId ?? (() => crypto.randomUUID());
  const sorteio = criarSorteio(parametros.semente);
  const { data, hora } = agoraNoFusoDoEvento(entrada.agora ?? new Date());

  const idEvento = gerarId();
  const evento: LinhaEvento = {
    id_evento: idEvento,
    nome_evento: `${PREFIXO_EVENTO_SIMULACAO} ${data} ${hora}`,
    edicao: 'Simulação',
    // Guarda o NOME, nunca o UUID: UUID não aparece na interface (regra 6).
    descricao: entrada.nomeEventoAnterior
      ? `Simulação criada pelo painel do Admin. Evento ativo anterior: "${entrada.nomeEventoAnterior}".`
      : 'Simulação criada pelo painel do Admin.',
    logo_url: null,
    // Nasce INATIVO: a ativação é o último passo da semeadura, então uma falha no meio
    // não troca o evento ativo da instalação.
    is_ativo: false,
    sistema_liberado: true,
    // A janela cobre o dia inteiro no fuso do evento, senão o sorteio recusa tudo.
    data_evento: data,
    horario_inicio: '00:00:00',
    horario_fim: '23:59:59',
    cota_avaliacoes_padrao: parametros.cota,
    minutos_timeout_lock: 30,
    minutos_validade_pareamento: 10,
    metodos_vinculo: 'pareamento',
    limite_corte: 0,
    intervalo_pausa_avaliador: 0,
    data_inicio: data,
    data_fim: data,
    minutos_validade_codigo_acesso: 15,
    tamanho_codigo: 6,
    max_tentativas_codigo: 5,
    url_icone: null,
    url_imagem_evento: null,
    fixar_questionario_primeira_avaliacao: true,
  };

  const instituicoes: LinhaInstituicao[] = CAMPI.map(([nome, sigla, cidade]) => ({
    id_instituicao: gerarId(),
    id_evento: idEvento,
    nome_exibicao: `IFMS — Campus ${nome}`,
    nome_normalizado: normalizar(`IFMS Campus ${nome}`),
    sigla: `IFMS-${sigla}`,
    campus: nome,
    cidade,
    estado: 'MS',
  }));

  const modalidades: LinhaModalidade[] = MODALIDADES.map(([nome, codigo, nivel]) => ({
    id_modalidade: gerarId(),
    id_evento: idEvento,
    nome_modalidade: nome,
    codigo,
    nivel,
    descricao: `Projetos de ${nome.toLowerCase()}.`,
  }));

  const areas: LinhaArea[] = AREAS.map((nome) => ({
    id_area: gerarId(),
    id_evento: idEvento,
    nome_area: nome,
  }));

  // Todos os técnicos na MESMA escala e com os mesmos critérios: o que importa é a
  // QUANTIDADE, porque é ela que ativa a trava do questionário no primeiro avaliador.
  const idsQuestionariosTecnicos = Array.from(
    { length: Math.max(1, parametros.questionariosTecnicos) },
    () => gerarId(),
  );
  const idQuestionarioVotoPopular = gerarId();

  const questionarios: LinhaQuestionario[] = [
    ...idsQuestionariosTecnicos.map((id, indice) => ({
      id_questionario: id,
      id_evento: idEvento,
      titulo: idsQuestionariosTecnicos.length === 1
        ? 'Avaliação Técnica — Simulação'
        : `Avaliação Técnica ${indice + 1} — Simulação`,
      escala_minima: ESCALA_SIMULACAO.minima,
      escala_maxima: ESCALA_SIMULACAO.maxima,
      is_voto_popular: false,
    })),
    {
      id_questionario: idQuestionarioVotoPopular,
      id_evento: idEvento,
      titulo: 'Voto Popular — Simulação',
      escala_minima: ESCALA_SIMULACAO.minima,
      escala_maxima: ESCALA_SIMULACAO.maxima,
      is_voto_popular: true,
    },
  ];

  const perguntas: LinhaPergunta[] = [
    ...idsQuestionariosTecnicos.flatMap((id) =>
      CRITERIOS_TECNICOS.map(([texto, peso, lembrete], indice) => ({
        id_pergunta: gerarId(),
        id_questionario: id,
        ordem: indice + 1,
        texto_pergunta: texto,
        peso_calculo: peso,
        peso_desempate: peso,
        descricao_lembrete: lembrete,
      })),
    ),
    ...CRITERIOS_VOTO_POPULAR.map(([texto, peso], indice) => ({
      id_pergunta: gerarId(),
      id_questionario: idQuestionarioVotoPopular,
      ordem: indice + 1,
      texto_pergunta: texto,
      peso_calculo: peso,
      peso_desempate: peso,
      descricao_lembrete: 'Nota livre do público visitante.',
    })),
  ];

  const projetos: LinhaProjeto[] = Array.from({ length: parametros.projetos }, (_, indice) => {
    const sequencial = indice + 1;
    return {
      id_projeto: gerarId(),
      id_evento: idEvento,
      codigo_projeto: `SIM-${String(sequencial).padStart(4, '0')}`,
      id_instituicao: umDe(sorteio, instituicoes).id_instituicao,
      id_area: umDe(sorteio, areas).id_area,
      id_modalidade: umDe(sorteio, modalidades).id_modalidade,
      titulo: `${umDe(sorteio, VERBOS)} ${umDe(sorteio, OBJETOS)} ${umDe(sorteio, CONTEXTOS)}`,
      estande: String(sequencial).padStart(3, '0'),
      corredor: CORREDORES[sequencial % CORREDORES.length] as string,
      expositores: Array.from(
        { length: inteiroEntre(sorteio, 1, 3) },
        () => `${umDe(sorteio, NOMES)} ${umDe(sorteio, SOBRENOMES)}`,
      ).join(', '),
      // O check-in é ação do motor, para o telão mostrar o pavilhão enchendo.
      is_check_in_realizado: false,
      is_fora_da_competicao: false,
      forcar_topo_fila: false,
      contagem_ausencia: 0,
      ajuste_media: 0,
    };
  });

  const usuarios: LinhaUsuario[] = [];
  const vinculos: LinhaAvaliadorEvento[] = [];
  const avaliadorAreas: LinhaAvaliadorArea[] = [];
  const modalidadesBloqueadas: LinhaModalidadeBloqueada[] = [];
  const avaliadores: AvaliadorDoPlano[] = [];

  const quantosVotantes = quantosDe(parametros.avaliadores, parametros.porcentoVotoPopular);
  const quantosCredenciados = quantosDe(parametros.avaliadores, parametros.porcentoCredenciamento);
  // Carimbo: `usuarios.email` é único GLOBAL, e o mesmo banco recebe várias rodadas.
  const carimbo = `${data.replace(/-/g, '')}${hora.replace(/:/g, '')}`;

  for (let indice = 0; indice < parametros.avaliadores; indice += 1) {
    const idUsuario = gerarId();
    const nome = nomeDePessoa(sorteio);
    const ehVotante = indice < quantosVotantes;
    const instituicao = umDe(sorteio, instituicoes).id_instituicao;

    usuarios.push({
      id_usuario: idUsuario,
      nome,
      email: `avaliador.${String(indice + 1).padStart(4, '0')}.${carimbo}@${DOMINIO_SIMULACAO}`,
      papel: 'AVALIADOR',
    });

    vinculos.push({
      id_usuario: idUsuario,
      id_evento: idEvento,
      id_instituicao: instituicao,
      is_credenciado: indice < quantosCredenciados,
      id_questionario: ehVotante ? idQuestionarioVotoPopular : null,
    });

    const areasSorteadas = new Set<string>();
    const quantasAreas = inteiroEntre(sorteio, 1, 3);
    while (areasSorteadas.size < quantasAreas) {
      areasSorteadas.add(umDe(sorteio, areas).id_area);
    }
    for (const idArea of areasSorteadas) {
      avaliadorAreas.push({ id_usuario: idUsuario, id_evento: idEvento, id_area: idArea });
    }

    // Uma fatia pequena bloqueia uma modalidade, para exercitar a recusa por modalidade
    // bloqueada sem estrangular a feira: com várias modalidades no catálogo, o avaliador
    // continua achando projeto.
    if (sorteio() < FRACAO_COM_MODALIDADE_BLOQUEADA) {
      modalidadesBloqueadas.push({
        id_usuario: idUsuario,
        id_evento: idEvento,
        id_modalidade: umDe(sorteio, modalidades).id_modalidade,
      });
    }

    avaliadores.push({
      id_usuario: idUsuario,
      nome,
      id_instituicao: instituicao,
      ehVotante,
      idQuestionarioVinculado: ehVotante ? idQuestionarioVotoPopular : null,
      semente: parametros.semente + indice * 7919,
    });
  }

  const staff: ItemStaff[] = Array.from({ length: parametros.staff }, (_, indice) => ({
    nome: nomeDePessoa(sorteio),
    email: `staff.${String(indice + 1).padStart(3, '0')}.${carimbo}@${DOMINIO_SIMULACAO}`,
    papel: 'STAFF',
  }));

  const projetosParaCheckIn = projetos
    .slice(0, quantosDe(projetos.length, parametros.porcentoCheckIn))
    .map((projeto) => projeto.id_projeto);

  // Só projetos que receberão check-in podem divergir: os outros não são avaliados.
  const projetosDivergentes = projetosParaCheckIn.slice(
    0,
    quantosDe(projetosParaCheckIn.length, parametros.porcentoQuarentena),
  );

  return {
    evento,
    instituicoes,
    modalidades,
    areas,
    questionarios,
    perguntas,
    projetos,
    usuarios,
    vinculos,
    avaliadorAreas,
    modalidadesBloqueadas,
    staff,
    avaliadores,
    idsQuestionariosTecnicos,
    idQuestionarioVotoPopular,
    projetosParaCheckIn,
    projetosDivergentes,
    nomeEventoAnterior: entrada.nomeEventoAnterior ?? null,
  };
};
