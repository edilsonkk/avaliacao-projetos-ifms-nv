import type { Severidade } from './tipos';

/**
 * A trilha guarda rótulos estáveis em snake_case (`nota_alterada`); a interface é em português.
 * Traduzir aqui, e não no banco, deixa o log legível por máquina e a tela legível por pessoa.
 */
const ACOES: Record<string, string> = {
  avaliacao_criada: 'Avaliação criada',
  avaliacao_apagada: 'Avaliação apagada',
  avaliacao_cancelada: 'Avaliação cancelada',
  avaliacao_restaurada: 'Avaliação restaurada',
  nota_alterada: 'Nota alterada',
  quarentena_marcada: 'Quarentena marcada',
  quarentena_desmarcada: 'Quarentena desmarcada',
  quarentena_resolvida: 'Divergência aceita pelo Admin',
  resposta_alterada: 'Nota por critério alterada',
  credenciamento_concedido: 'Credenciamento concedido',
  credenciamento_suspenso: 'Credenciamento suspenso',
  check_in_realizado: 'Check-in do projeto',
  check_in_desfeito: 'Check-in desfeito',
  cota_alterada: 'Cota do projeto alterada',
  competicao_alterada: 'Participação na competição alterada',
  questionario_fixado: 'Questionário fixado no projeto',
  peso_calculo_alterado: 'Peso de cálculo alterado',
  peso_desempate_alterado: 'Prioridade de desempate alterada',
  escala_alterada: 'Escala do questionário alterada',
  papel_alterado: 'Papel do usuário alterado',
  dispositivo_vinculado: 'Aparelho vinculado',
  dispositivo_revogado: 'Aparelho desvinculado',
  reset_global: 'Reset global do evento',
  avaliacao: 'Avaliação',
  pergunta: 'Pergunta do questionário',
  questionario: 'Questionário',
  projeto: 'Projeto',
  credenciamento: 'Credenciamento',
  dispositivo: 'Aparelho do avaliador',
  usuario: 'Usuário',
  evento: 'Evento',
};

const OPERACOES: Record<string, string> = {
  INSERT: 'criação',
  UPDATE: 'alteração',
  DELETE: 'exclusão',
  EVENTO: 'registro',
};

export const rotuloDaAcao = (acao: string): string => ACOES[acao] || acao.replace(/_/g, ' ');
export const rotuloDaOperacao = (operacao: string): string => OPERACOES[operacao] || operacao;

/** Nome da tabela como a coordenação chama a coisa. */
export const rotuloDaTabela = (tabela: string): string =>
  ({
    avaliacoes: 'Avaliações',
    respostas_avaliacao: 'Notas por critério',
    perguntas_questionario: 'Perguntas do questionário',
    questionarios: 'Questionários',
    projetos: 'Projetos',
    avaliadores_evento: 'Credenciamento',
    dispositivos_avaliador: 'Aparelhos',
    usuarios: 'Usuários',
    eventos: 'Evento',
  })[tabela] || tabela;

export const TOM_POR_SEVERIDADE: Record<Severidade, 'perigo' | 'aviso' | 'info'> = {
  grave: 'perigo',
  atencao: 'aviso',
  informativo: 'info',
};

export const ROTULO_SEVERIDADE: Record<Severidade, string> = {
  grave: 'Grave',
  atencao: 'Atenção',
  informativo: 'Informativo',
};

/** Data e hora como o resto do sistema mostra. */
export const dataHoraBr = (valor: string | null | undefined): string => {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
