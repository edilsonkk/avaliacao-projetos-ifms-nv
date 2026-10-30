/**
 * Definições de Tipos TypeScript para o Banco de Dados do
 * Sistema de Avaliação de Projetos IFMS.
 *
 * Todas as propriedades utilizam a convenção snake_case em português.
 */

export interface Instituicao {
  id: string;
  nome_instituicao: string;
  sigla: string;
  campus?: string | null;
  cidade?: string | null;
  estado?: string | null;
  criado_em: string;
  atualizado_em?: string | null;
}

export interface Evento {
  id: string;
  nome_evento: string;
  descricao?: string | null;
  edicao?: string | null;
  data_inicio: string;
  data_fim: string;
  id_instituicao: string;
  ativo: boolean;
  criado_em: string;
  atualizado_em?: string | null;
}

export interface CriterioAvaliacao {
  id_criterio: string;
  nome_criterio: string;
  descricao_criterio: string;
  peso: number;
  nota_maxima: number;
}

export interface Questionario {
  id: string;
  titulo_questionario: string;
  descricao?: string | null;
  criterios: CriterioAvaliacao[];
  id_evento: string;
  criado_em: string;
  atualizado_em?: string | null;
}

export interface Projeto {
  id: string;
  id_projeto?: string;
  codigo_projeto?: string | null;
  titulo_projeto: string;
  titulo?: string;
  resumo?: string | null;
  area_conhecimento?: string;
  id_area_tematica?: string | null;
  id_modalidade?: string | null;
  orientador_nome?: string;
  coorientador_nome?: string | null;
  estudantes_nomes?: string[];
  modalidade?: string | null;
  estande?: string | null;
  estande_numero?: string | null;
  corredor?: string | null;
  expositores?: string | null;
  id_questionario_fixado?: string | null;
  id_evento?: string;
  id_instituicao?: string;
  nome_instituicao?: string | null;
  instituicoes?: InstituicaoRelacional | null;
  modalidades?: { nome_modalidade?: string } | null;
  is_check_in_realizado: boolean;
  criado_em?: string;
  atualizado_em?: string | null;
}

export interface UsuarioRelacional {
  nome?: string;
  email?: string;
  cpf?: string;
  celular?: string;
}

export interface InstituicaoRelacional {
  nome_exibicao?: string;
}

export interface AvaliadorEvento {
  id: string;
  id_usuario?: string;
  id_avaliador?: string;
  id_evento?: string;
  nome_avaliador: string;
  nome?: string;
  email_avaliador: string;
  email?: string;
  cpf_avaliador?: string | null;
  area_atuacao?: string | null;
  status_convite?: 'pendente' | 'aceito' | 'recusado';
  instituicao_origem?: string | null;
  is_credenciado: boolean;
  criado_em?: string;
  atualizado_em?: string | null;
  usuarios?: UsuarioRelacional | null;
  instituicoes?: InstituicaoRelacional | null;
}

export interface ItemNotaCriterio {
  id_criterio: string;
  nota_atribuida: number;
  comentario_criterio?: string | null;
}

export interface Avaliacao {
  id: string;
  id_projeto: string;
  id_avaliador: string;
  id_questionario: string;
  notas_criterios: ItemNotaCriterio[];
  nota_final: number;
  parecer_final?: string | null;
  status_avaliacao: 'em_andamento' | 'concluida' | 'cancelada';
  tempo_presenca?: string | null;
  criado_em: string;
  atualizado_em?: string | null;
}

export interface HistoricoImpedimento {
  id?: string;
  id_usuario: string;
  id_projeto: string;
  tipo: 'AUSENCIA' | 'CONFLITO' | 'ausente' | 'conflito' | 'ausencia' | string;
  criado_em?: string;
}

export interface LockAtivo {
  id?: string;
  id_usuario: string;
  id_projeto: string;
  expira_em?: string;
  criado_em?: string;
}

export interface RespostaAvaliacao {
  id?: string;
  id_avaliacao?: string;
  id_pergunta?: string;
  id_criterio?: string;
  nota?: number;
  nota_atribuida?: number;
  comentario_criterio?: string | null;
}

export interface QuestionarioDinamico {
  id_questionario?: string;
  id?: string;
  titulo: string;
  escala_minima: number;
  escala_maxima: number;
  id_evento?: string;
  criado_em?: string;
}

export interface PerguntaQuestionario {
  id_pergunta?: string;
  id?: string;
  id_questionario?: string;
  ordem: number;
  texto_pergunta: string;
  descricao_lembrete?: string | null;
  peso_calculo: number;
  peso_desempate: number;
}

/**
 * Esquema do Banco de Dados para tipagem do cliente Supabase.
 */
export interface EsqueMABanco {
  public: {
    Tables: {
      instituicao: {
        Row: Instituicao;
        Insert: Omit<Instituicao, 'id' | 'criado_em'> & { id?: string; criado_em?: string };
        Update: Partial<Instituicao>;
      };
      evento: {
        Row: Evento;
        Insert: Omit<Evento, 'id' | 'criado_em'> & { id?: string; criado_em?: string };
        Update: Partial<Evento>;
      };
      questionario: {
        Row: Questionario;
        Insert: Omit<Questionario, 'id' | 'criado_em'> & { id?: string; criado_em?: string };
        Update: Partial<Questionario>;
      };
      questionarios: {
        Row: QuestionarioDinamico;
        Insert: Partial<QuestionarioDinamico>;
        Update: Partial<QuestionarioDinamico>;
      };
      perguntas_questionario: {
        Row: PerguntaQuestionario;
        Insert: Partial<PerguntaQuestionario>;
        Update: Partial<PerguntaQuestionario>;
      };
      projeto: {
        Row: Projeto;
        Insert: Omit<Projeto, 'id' | 'criado_em'> & { id?: string; criado_em?: string };
        Update: Partial<Projeto>;
      };
      projetos: {
        Row: Projeto;
        Insert: Partial<Projeto>;
        Update: Partial<Projeto>;
      };
      avaliador_evento: {
        Row: AvaliadorEvento;
        Insert: Omit<AvaliadorEvento, 'id' | 'criado_em'> & { id?: string; criado_em?: string };
        Update: Partial<AvaliadorEvento>;
      };
      avaliadores_evento: {
        Row: AvaliadorEvento;
        Insert: Partial<AvaliadorEvento>;
        Update: Partial<AvaliadorEvento>;
      };
      avaliacao: {
        Row: Avaliacao;
        Insert: Omit<Avaliacao, 'id' | 'criado_em'> & { id?: string; criado_em?: string };
        Update: Partial<Avaliacao>;
      };
      avaliacoes: {
        Row: Partial<Avaliacao>;
        Insert: Record<string, any>;
        Update: Record<string, any>;
      };
      historico_impedimentos: {
        Row: HistoricoImpedimento;
        Insert: HistoricoImpedimento;
        Update: Partial<HistoricoImpedimento>;
      };
      locks_ativos: {
        Row: LockAtivo;
        Insert: LockAtivo;
        Update: Partial<LockAtivo>;
      };
      respostas_avaliacao: {
        Row: RespostaAvaliacao;
        Insert: RespostaAvaliacao;
        Update: Partial<RespostaAvaliacao>;
      };
    };
  };
}
