import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  UploadCloud,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Mail,
  User,
  Pencil,
  UserCheck,
  UserX,
  X,
  Clock,
  Terminal,
  Shield,
  ShieldOff,
  Building2,
  Database,
  Plus,
  Save,
  Download,
} from 'lucide-react';
import { baixarPlanilhaModelo, validarArquivoPlanilha } from '@/lib/excel/excelUtils';
import { supabase } from '@/lib/supabase';
import { buscarTodas } from '@/lib/buscarTodas';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { parsePlanilhaAvaliadores, normalizarChave, AvaliadorLinhaPlanilha } from '@/lib/parsers/planilhaAvaliadoresParser';
import { ModalDeParaMapping, ItemMapeamentoDePara, DecisaoMapeamento } from '@/components/importacao/ModalDeParaMapping';
import { buscarMelhorCorrespondencia, CandidatoMatch } from '@/lib/parsers/fuzzyMatcher';
import { CabecalhoOrdenavel, compararNatural } from '@/components/ui/CabecalhoOrdenavel';

export interface UsuarioAvaliador {
  id_usuario: string;
  nome: string;
  email: string;
  papel: string;
  is_credenciado?: boolean;
  id_instituicao?: string | null;
  nome_instituicao?: string | null;
  modalidades_bloqueadas?: string[];
  nomes_modalidades_bloqueadas?: string[];
  areas?: string[];
  nomes_areas?: string[];
}

export interface InstituicaoRef {
  id_instituicao: string;
  nome_exibicao: string;
  sigla?: string | null;
}

export interface ModalidadeRef {
  id_modalidade: string;
  nome_modalidade: string;
}

export interface AreaRef {
  id_area: string;
  nome_area: string;
}

export interface LogImportacaoItem {
  tipo: 'success' | 'error' | 'info';
  mensagem: string;
}

/** Item enviado para admin_salvar_avaliadores. */
interface ItemAvaliadorRpc {
  nome: string;
  email: string;
  id_instituicao: string | null;
  ids_modalidades_bloqueadas: string[];
  ids_areas: string[];
}

interface ResultadoSalvarAvaliadores {
  cadastrados: number;
  atualizados: number;
  ignorados: { email: string; motivo: string }[];
}

type ColunaOrdenacaoAvaliador = 'is_credenciado' | 'nome' | 'nome_instituicao' | 'email' | 'modalidades_bloqueadas' | 'areas';

const textoColuna = (a: UsuarioAvaliador, coluna: ColunaOrdenacaoAvaliador): string => {
  if (coluna === 'modalidades_bloqueadas') return (a.nomes_modalidades_bloqueadas || []).join(', ');
  if (coluna === 'areas') return (a.nomes_areas || []).join(', ');
  if (coluna === 'nome_instituicao') return a.nome_instituicao || '';
  if (coluna === 'is_credenciado') return a.is_credenciado ? '1' : '0';
  return String(a[coluna] || '');
};

export const GestorAvaliadores: React.FC<{
  id_evento_ativo?: string;
  ao_fechar?: () => void;
  aoAtualizarMetricas?: () => void;
}> = ({ id_evento_ativo, ao_fechar, aoAtualizarMetricas }) => {
  const idEvento = id_evento_ativo || '';

  const [avaliadores, setListaAvaliadores] = useState<UsuarioAvaliador[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // Tabelas de referência do evento
  const [lista_instituicoes, set_lista_instituicoes] = useState<InstituicaoRef[]>([]);
  const [lista_modalidades, set_lista_modalidades] = useState<ModalidadeRef[]>([]);
  const [lista_areas, set_lista_areas] = useState<AreaRef[]>([]);

  // Ordenação de colunas
  const [colunaOrdenacao, setColunaOrdenacao] = useState<ColunaOrdenacaoAvaliador>('nome');
  const [ordemAscendente, setOrdemAscendente] = useState<boolean>(true);
  const [processando_modalidade_id, set_processando_modalidade_id] = useState<string | null>(null);

  // Logs da importação
  const [logsImportacao, setLogsImportacao] = useState<LogImportacaoItem[]>([]);

  // Formulário de inclusão manual
  const [mostrar_form_novo, set_mostrar_form_novo] = useState<boolean>(false);
  const [novo_nome, set_novo_nome] = useState<string>('');
  const [novo_email, set_novo_email] = useState<string>('');
  const [novo_instituicao_id, set_novo_instituicao_id] = useState<string>('');
  const [novo_modalidades_bloqueadas, set_novo_modalidades_bloqueadas] = useState<string[]>([]);
  const [novo_areas, set_novo_areas] = useState<string[]>([]);
  const [salvando_manual, set_salvando_manual] = useState<boolean>(false);

  // Modal de edição
  const [usuario_em_edicao, set_usuario_em_edicao] = useState<{ id_usuario: string; nome: string; email: string } | null>(null);
  const [edit_instituicao_id, set_edit_instituicao_id] = useState<string>('');
  const [edit_modalidades_bloqueadas, set_edit_modalidades_bloqueadas] = useState<string[]>([]);
  const [edit_areas, set_edit_areas] = useState<string[]>([]);
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  // Remoção do evento
  const [avaliador_para_remover, set_avaliador_para_remover] = useState<UsuarioAvaliador | null>(null);
  const [removendo, set_removendo] = useState<boolean>(false);

  const [processando_credenciamento_id, set_processando_credenciamento_id] = useState<string | null>(null);

  // Importação por arquivo
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);

  // De-Para
  const [modalDeParaAberto, setModalDeParaAberto] = useState<boolean>(false);
  const [itensDePara, setItensDePara] = useState<ItemMapeamentoDePara[]>([]);
  const [linhasArquivoPendente, setLinhasArquivoPendente] = useState<AvaliadorLinhaPlanilha[]>([]);

  const input_file_ref = useRef<HTMLInputElement>(null);

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => set_mensagem_notificacao(null), 3500);
  };

  const adicionarLog = (tipo: LogImportacaoItem['tipo'], mensagem: string) => {
    setLogsImportacao((prev) => [...prev, { tipo, mensagem }]);
  };

  // Versões antigas guardavam o credenciamento no navegador e ele se sobrepunha ao banco.
  useEffect(() => {
    try {
      localStorage.removeItem('avaliadores_credenciados_local');
    } catch {
      // armazenamento indisponível: nada a limpar
    }
  }, []);

  // Avaliadores inscritos no evento ativo, com instituição, modalidades bloqueadas e áreas
  const carregar_avaliadores = useCallback(async () => {
    if (!idEvento) {
      setListaAvaliadores([]);
      set_carregando(false);
      return;
    }
    set_carregando(true);
    try {
      const [resInst, resMods, resAreas] = await Promise.all([
        supabase.from('instituicoes').select('id_instituicao, nome_exibicao, sigla').eq('id_evento', idEvento).order('nome_exibicao', { ascending: true }),
        supabase.from('modalidades').select('id_modalidade, nome_modalidade').eq('id_evento', idEvento).order('nome_modalidade', { ascending: true }),
        supabase.from('areas_tematicas').select('id_area, nome_area').eq('id_evento', idEvento).order('nome_area', { ascending: true }),
      ]);
      for (const res of [resInst, resMods, resAreas]) {
        if (res.error) throw res.error;
      }
      const instituicoes = (resInst.data || []) as InstituicaoRef[];
      const modalidades = (resMods.data || []) as ModalidadeRef[];
      const areas = (resAreas.data || []) as AreaRef[];
      set_lista_instituicoes(instituicoes);
      set_lista_modalidades(modalidades);
      set_lista_areas(areas);

      const [vinculos, bloqueios, areasAvaliadores] = await Promise.all([
        buscarTodas<any>(() =>
          supabase
            .from('avaliadores_evento')
            .select('id_usuario, is_credenciado, id_instituicao, usuarios!inner(nome, email, papel)')
            .eq('id_evento', idEvento)
            .order('id_usuario', { ascending: true })
        ),
        buscarTodas<any>(() =>
          supabase
            .from('avaliador_modalidades_bloqueadas')
            .select('id_usuario, id_modalidade')
            .eq('id_evento', idEvento)
            .order('id_usuario', { ascending: true })
            .order('id_modalidade', { ascending: true })
        ),
        buscarTodas<any>(() =>
          supabase
            .from('avaliador_areas')
            .select('id_usuario, id_area')
            .eq('id_evento', idEvento)
            .order('id_usuario', { ascending: true })
            .order('id_area', { ascending: true })
        ),
      ]);

      const nomeInstituicao = new Map(instituicoes.map((i) => [i.id_instituicao, i.sigla ? `${i.nome_exibicao} (${i.sigla})` : i.nome_exibicao]));
      const nomeModalidade = new Map(modalidades.map((m) => [m.id_modalidade, m.nome_modalidade]));
      const nomeArea = new Map(areas.map((a) => [a.id_area, a.nome_area]));

      const agrupar = (linhas: any[], campo: string, nomes: Map<string, string>) => {
        const mapa = new Map<string, string[]>();
        linhas.forEach((l) => {
          if (!nomes.has(l[campo])) return; // ignora registros órfãos de outro evento
          mapa.set(l.id_usuario, [...(mapa.get(l.id_usuario) || []), l[campo]]);
        });
        return mapa;
      };
      const bloqueiosPorUsuario = agrupar(bloqueios, 'id_modalidade', nomeModalidade);
      const areasPorUsuario = agrupar(areasAvaliadores, 'id_area', nomeArea);

      const lista: UsuarioAvaliador[] = vinculos
        .map((v) => ({ ...v, usuario: Array.isArray(v.usuarios) ? v.usuarios[0] : v.usuarios }))
        .filter((v) => v.usuario && String(v.usuario.papel || '').toUpperCase() === 'AVALIADOR')
        .map((v) => {
          const modIds = bloqueiosPorUsuario.get(v.id_usuario) || [];
          const areaIds = areasPorUsuario.get(v.id_usuario) || [];
          return {
            id_usuario: v.id_usuario,
            nome: v.usuario.nome,
            email: v.usuario.email,
            papel: v.usuario.papel,
            is_credenciado: Boolean(v.is_credenciado),
            id_instituicao: v.id_instituicao || null,
            nome_instituicao: (v.id_instituicao && nomeInstituicao.get(v.id_instituicao)) || null,
            modalidades_bloqueadas: modIds,
            nomes_modalidades_bloqueadas: modIds.map((id) => nomeModalidade.get(id) as string),
            areas: areaIds,
            nomes_areas: areaIds.map((id) => nomeArea.get(id) as string),
          };
        });
      setListaAvaliadores(lista);
    } catch (err) {
      console.error('Falha ao carregar avaliadores:', err);
      set_mensagem_erro(`Não foi possível carregar os avaliadores: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      set_carregando(false);
    }
  }, [idEvento]);

  useEffect(() => {
    carregar_avaliadores();
  }, [carregar_avaliadores]);

  /** Grava avaliadores pela função do banco (uma transação). Retorna null em caso de erro. */
  const salvarAvaliadores = async (itens: ItemAvaliadorRpc[]): Promise<ResultadoSalvarAvaliadores | null> => {
    const { data, error } = await supabase.rpc('admin_salvar_avaliadores', { p_id_evento: idEvento, p_itens: itens });
    if (error) {
      set_mensagem_erro(`Erro ao gravar avaliadores: ${tratarErroEscritaAdmin(error)}`);
      return null;
    }
    const r = (data || {}) as Partial<ResultadoSalvarAvaliadores>;
    return { cadastrados: r.cadastrados ?? 0, atualizados: r.atualizados ?? 0, ignorados: r.ignorados ?? [] };
  };

  const limpar_form_novo = () => {
    set_novo_nome('');
    set_novo_email('');
    set_novo_instituicao_id('');
    set_novo_modalidades_bloqueadas([]);
    set_novo_areas([]);
  };

  // Inclusão manual
  const handle_adicionar_manual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novo_nome.trim() || !novo_email.trim()) {
      set_mensagem_erro('Preencha o nome e o e-mail do avaliador.');
      return;
    }
    if (!idEvento) {
      set_mensagem_erro('Não há evento ativo. Ative um evento antes de cadastrar avaliadores.');
      return;
    }
    if (!(await garantirSessaoAdmin())) return;

    set_salvando_manual(true);
    set_mensagem_erro(null);
    try {
      const resultado = await salvarAvaliadores([
        {
          nome: novo_nome.trim(),
          email: novo_email.trim().toLowerCase(),
          id_instituicao: novo_instituicao_id || null,
          ids_modalidades_bloqueadas: novo_modalidades_bloqueadas,
          ids_areas: novo_areas,
        },
      ]);
      if (!resultado) return;
      if (resultado.ignorados.length > 0) {
        set_mensagem_erro(`Avaliador não cadastrado: ${resultado.ignorados[0].motivo}`);
        return;
      }
      exibir_notificacao(
        resultado.atualizados > 0
          ? 'Este e-mail já tinha cadastro: o avaliador foi incluído neste evento.'
          : 'Avaliador cadastrado com sucesso!'
      );
      limpar_form_novo();
      set_mostrar_form_novo(false);
      await carregar_avaliadores();
      aoAtualizarMetricas?.();
    } finally {
      set_salvando_manual(false);
    }
  };

  // Modelo de planilha (.xlsx)
  const baixar_planilha_exemplo = async () => {
    try {
      const dadosExemplo = [
        {
          nome: 'Prof. Carlos Eduardo Santos',
          email: 'carlos.santos@ifms.edu.br',
          instituicao: 'IFMS Campus Campo Grande',
          sigla_instituicao: 'IFMS-CG',
          modalidades_bloqueadas: 'Ensino Médio, Nível Fundamental',
          areas: 'CIÊNCIAS EXATAS E DA TERRA, ENGENHARIAS',
        },
        {
          nome: 'Dra. Mariana Silva Lima',
          email: 'mariana.lima@ufms.br',
          instituicao: 'Universidade Federal de MS',
          sigla_instituicao: 'UFMS',
          modalidades_bloqueadas: 'Ensino Técnico',
          areas: 'CIÊNCIAS BIOLÓGICAS, CIÊNCIAS DA SAÚDE',
        },
        {
          nome: 'Me. Roberto Alves Ferreira',
          email: 'roberto.ferreira@gmail.com',
          instituicao: 'Escola Estadual Joaquim Murtinho',
          sigla_instituicao: 'EEJM',
          modalidades_bloqueadas: '',
          areas: 'CIÊNCIAS HUMANAS / CIÊNCIAS SOCIAIS APLICADAS',
        },
      ];

      const colunas = ['nome', 'email', 'instituicao', 'sigla_instituicao', 'modalidades_bloqueadas', 'areas'];
      await baixarPlanilhaModelo('modelo_importacao_avaliadores.xlsx', 'Avaliadores', colunas, dadosExemplo);
      exibir_notificacao('Planilha modelo de avaliadores (.xlsx) baixada.');
    } catch (err) {
      console.error('Erro ao gerar planilha modelo de avaliadores:', err);
      set_mensagem_erro('Falha ao baixar o modelo de planilha.');
    }
  };

  /** Cadastra instituição, modalidade ou área nova vinda da planilha. Retorna o id ou null. */
  const cadastrarAuxiliar = async (
    tipo: 'instituicao' | 'modalidade' | 'area',
    nome: string,
    sigla?: string | null
  ): Promise<string | null> => {
    const config = {
      instituicao: {
        tabela: 'instituicoes',
        payload: { nome_exibicao: nome, nome_normalizado: normalizarChave(nome), sigla: sigla || null, id_evento: idEvento },
        id: 'id_instituicao',
        rotulo: 'Instituição',
      },
      modalidade: { tabela: 'modalidades', payload: { nome_modalidade: nome, id_evento: idEvento }, id: 'id_modalidade', rotulo: 'Modalidade' },
      area: { tabela: 'areas_tematicas', payload: { nome_area: nome, id_evento: idEvento }, id: 'id_area', rotulo: 'Área temática' },
    }[tipo];

    const { data, error } = await supabase.from(config.tabela).insert([config.payload]).select('*').single();
    if (error || !data) {
      adicionarLog('error', `${config.rotulo} "${nome}" não foi cadastrada: ${tratarErroEscritaAdmin(error)}`);
      return null;
    }
    adicionarLog('info', `${config.rotulo} cadastrada: "${nome}".`);
    if (tipo === 'instituicao') set_lista_instituicoes((prev) => [...prev, data as InstituicaoRef]);
    if (tipo === 'modalidade') set_lista_modalidades((prev) => [...prev, data as ModalidadeRef]);
    if (tipo === 'area') set_lista_areas((prev) => [...prev, data as AreaRef]);
    return (data as Record<string, string>)[config.id];
  };

  // Gravação final da importação (após o De-Para ou direto, se tudo casou)
  const executarGravacaoFinalAvaliadores = async (
    avaliadoresImportados: AvaliadorLinhaPlanilha[],
    decisoes: Map<string, DecisaoMapeamento>
  ) => {
    if (!idEvento) {
      set_mensagem_erro('Não há evento ativo. Ative um evento antes de importar avaliadores.');
      return;
    }
    if (!(await garantirSessaoAdmin())) return;
    set_processando_arquivo(true);
    try {
      const mapaInst = new Map<string, string>();
      lista_instituicoes.forEach((i) => {
        mapaInst.set(normalizarChave(i.nome_exibicao), i.id_instituicao);
        if (i.sigla) mapaInst.set(normalizarChave(i.sigla), i.id_instituicao);
      });
      const mapaMods = new Map(lista_modalidades.map((m) => [normalizarChave(m.nome_modalidade), m.id_modalidade]));
      const mapaAreas = new Map(lista_areas.map((a) => [normalizarChave(a.nome_area), a.id_area]));
      const mapaPorTipo = { instituicao: mapaInst, modalidade: mapaMods, area: mapaAreas };

      // Decisões do De-Para: associar a um cadastro existente ou criar um novo
      for (const [termo, decisao] of decisoes.entries()) {
        const mapa = mapaPorTipo[decisao.tipo];
        if (decisao.acao === 'associar_existente' && decisao.id_destino) {
          mapa.set(normalizarChave(termo), decisao.id_destino);
        } else if (decisao.acao === 'cadastrar_novo' || decisao.acao === 'criar_novo') {
          const nomeCriar = decisao.novo_nome?.trim() || termo.trim();
          const chave = normalizarChave(nomeCriar);
          const existente = mapa.get(chave);
          const id = existente || (await cadastrarAuxiliar(decisao.tipo, nomeCriar));
          if (id) {
            mapa.set(chave, id);
            mapa.set(normalizarChave(termo), id);
          }
        }
      }

      const itens: ItemAvaliadorRpc[] = [];
      for (const av of avaliadoresImportados) {
        let idInst: string | null = null;
        const kNome = av.instituicao ? normalizarChave(av.instituicao) : '';
        const kSigla = av.sigla_instituicao ? normalizarChave(av.sigla_instituicao) : '';
        if (kNome && mapaInst.has(kNome)) idInst = mapaInst.get(kNome)!;
        else if (kSigla && mapaInst.has(kSigla)) idInst = mapaInst.get(kSigla)!;
        else if (av.instituicao?.trim()) {
          idInst = await cadastrarAuxiliar('instituicao', av.instituicao.trim(), av.sigla_instituicao?.trim().toUpperCase());
          if (idInst) {
            mapaInst.set(kNome, idInst);
            if (kSigla) mapaInst.set(kSigla, idInst);
          }
        }

        const resolver = (nomes: string[] | undefined, mapa: Map<string, string>) =>
          Array.from(new Set((nomes || []).map((n) => mapa.get(normalizarChave(n))).filter((id): id is string => Boolean(id))));

        itens.push({
          nome: av.nome,
          email: av.email.trim().toLowerCase(),
          id_instituicao: idInst,
          ids_modalidades_bloqueadas: resolver(av.modalidades_bloqueadas, mapaMods),
          ids_areas: resolver(av.areas, mapaAreas),
        });
      }

      const resultado = await salvarAvaliadores(itens);
      if (!resultado) {
        adicionarLog('error', 'A importação foi recusada pelo banco; nenhum avaliador foi gravado.');
        return;
      }
      resultado.ignorados.forEach((i) => adicionarLog('error', `${i.email}: ${i.motivo}`));
      const resumo = `${resultado.cadastrados} cadastrado(s), ${resultado.atualizados} já existente(s) atualizado(s)` +
        (resultado.ignorados.length ? `, ${resultado.ignorados.length} ignorado(s)` : '');
      adicionarLog('success', `Importação concluída: ${resumo}.`);
      exibir_notificacao(`Importação concluída: ${resumo}.`);
      await carregar_avaliadores();
      aoAtualizarMetricas?.();
    } catch (err) {
      console.error('Erro ao salvar avaliadores:', err);
      set_mensagem_erro(`Erro ao gravar avaliadores: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      set_processando_arquivo(false);
    }
  };

  // Leitura da planilha (.csv/.xlsx) e montagem do De-Para
  const handle_upload_arquivo = async (file: File) => {
    set_mensagem_erro(null);
    setLogsImportacao([]);

    const validacao = validarArquivoPlanilha(file);
    if (!validacao.valido) {
      adicionarLog('error', validacao.erro || 'Arquivo inválido.');
      set_mensagem_erro(validacao.erro || 'Arquivo inválido.');
      return;
    }

    set_processando_arquivo(true);
    adicionarLog('info', `Lendo o arquivo ${file.name}...`);

    const reader = new FileReader();
    reader.onerror = () => {
      adicionarLog('error', 'Não foi possível ler o arquivo.');
      set_mensagem_erro('Não foi possível ler o arquivo.');
      set_processando_arquivo(false);
    };
    reader.onload = async (e) => {
      try {
        if (!e.target?.result) {
          adicionarLog('error', 'Arquivo vazio.');
          return;
        }

        const resultado = await parsePlanilhaAvaliadores(e.target.result as ArrayBuffer | string, validacao.isCSV);
        resultado.erros.forEach((err) => adicionarLog('error', err.mensagem));
        if (!resultado.sucesso || resultado.avaliadores.length === 0) {
          adicionarLog('error', 'Nenhum avaliador válido encontrado.');
          set_mensagem_erro('Nenhum avaliador válido encontrado na planilha.');
          return;
        }
        adicionarLog('info', `${resultado.avaliadores.length} avaliador(es) válido(s) na planilha.`);

        let candidatosInst: CandidatoMatch[] = lista_instituicoes.map((i) => ({ id: i.id_instituicao, nome: i.nome_exibicao, sigla: i.sigla, aliases: [] }));
        let candidatosMods: CandidatoMatch[] = lista_modalidades.map((m) => ({ id: m.id_modalidade, nome: m.nome_modalidade, sigla: null, aliases: [] }));
        const candidatosAreas: CandidatoMatch[] = lista_areas.map((a) => ({ id: a.id_area, nome: a.nome_area, sigla: null, aliases: [] }));

        const [{ data: aliasesInst }, { data: aliasesMod }] = await Promise.all([
          supabase.from('instituicao_aliases').select('id_instituicao, alias'),
          supabase.from('modalidade_aliases').select('id_modalidade, alias'),
        ]);
        const agruparAliases = (linhas: any[] | null, campo: string) => {
          const mapa = new Map<string, string[]>();
          (linhas || []).forEach((a) => mapa.set(a[campo], [...(mapa.get(a[campo]) || []), a.alias]));
          return mapa;
        };
        const mapaAliasInst = agruparAliases(aliasesInst, 'id_instituicao');
        const mapaAliasMod = agruparAliases(aliasesMod, 'id_modalidade');
        candidatosInst = candidatosInst.map((c) => ({ ...c, aliases: mapaAliasInst.get(c.id) || [] }));
        candidatosMods = candidatosMods.map((c) => ({ ...c, aliases: mapaAliasMod.get(c.id) || [] }));

        const termosInst = new Set<string>();
        const termosMod = new Set<string>();
        const termosArea = new Set<string>();
        resultado.avaliadores.forEach((av) => {
          const instTermo = av.instituicao?.trim() || av.sigla_instituicao?.trim();
          if (instTermo) termosInst.add(instTermo);
          av.modalidades_bloqueadas.forEach((mb) => mb?.trim() && termosMod.add(mb.trim()));
          (av.areas || []).forEach((ar) => ar?.trim() && termosArea.add(ar.trim()));
        });

        const itensParaDePara: ItemMapeamentoDePara[] = [];
        const avaliarTermos = (termos: Set<string>, candidatos: CandidatoMatch[], tipo: ItemMapeamentoDePara['tipo'], prefixo: string) => {
          termos.forEach((termo) => {
            const match = buscarMelhorCorrespondencia(termo, candidatos, 0.85);
            itensParaDePara.push({
              id_termo: `${prefixo}_${termo}`,
              termo_original: termo,
              tipo,
              sugestao_id: match.candidato?.id || null,
              sugestao_nome: match.candidato?.nome || null,
              confianca_percentual: match.confiancaPercentual,
              match_tipo: match.matchTipo,
            });
          });
        };
        avaliarTermos(termosInst, candidatosInst, 'instituicao', 'inst');
        avaliarTermos(termosMod, candidatosMods, 'modalidade', 'mod');
        avaliarTermos(termosArea, candidatosAreas, 'area', 'area');

        setLinhasArquivoPendente(resultado.avaliadores);
        if (itensParaDePara.some((i) => i.match_tipo !== 'exato')) {
          adicionarLog('info', 'Há nomes novos ou parecidos com os cadastrados. Confira na tela de correspondência.');
          setItensDePara(itensParaDePara);
          setModalDeParaAberto(true);
        } else {
          await executarGravacaoFinalAvaliadores(resultado.avaliadores, new Map());
        }
      } catch (errParsing) {
        console.error('Erro ao processar planilha de avaliadores:', errParsing);
        const msg = errParsing instanceof Error ? errParsing.message : String(errParsing);
        adicionarLog('error', `Erro ao ler a planilha: ${msg}`);
        set_mensagem_erro(`Erro ao processar a planilha: ${msg}`);
      } finally {
        set_processando_arquivo(false);
      }
    };

    if (validacao.isCSV) reader.readAsText(file, 'UTF-8');
    else reader.readAsArrayBuffer(file);
  };

  // Credenciar / descredenciar no evento ativo
  const handle_toggle_credenciamento = async (usuario: UsuarioAvaliador) => {
    if (!(await garantirSessaoAdmin())) return;
    const novoStatus = !usuario.is_credenciado;
    set_processando_credenciamento_id(usuario.id_usuario);
    set_mensagem_erro(null);
    try {
      const { error } = await supabase
        .from('avaliadores_evento')
        .update({ is_credenciado: novoStatus })
        .eq('id_usuario', usuario.id_usuario)
        .eq('id_evento', idEvento);
      if (error) {
        set_mensagem_erro(`Erro ao ${novoStatus ? 'credenciar' : 'descredenciar'} ${usuario.nome}: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      setListaAvaliadores((prev) => prev.map((a) => (a.id_usuario === usuario.id_usuario ? { ...a, is_credenciado: novoStatus } : a)));
      exibir_notificacao(novoStatus ? `${usuario.nome} foi credenciado.` : `Credenciamento de ${usuario.nome} suspenso.`);
      aoAtualizarMetricas?.();
    } finally {
      set_processando_credenciamento_id(null);
    }
  };

  // Chip de modalidade: bloquear/liberar na hora
  const handle_toggle_modalidade_bloqueio = async (usuario: UsuarioAvaliador, modalidade: ModalidadeRef) => {
    if (!(await garantirSessaoAdmin())) return;
    const chaveAcao = `${usuario.id_usuario}_${modalidade.id_modalidade}`;
    const jaBloqueada = (usuario.modalidades_bloqueadas || []).includes(modalidade.id_modalidade);
    set_processando_modalidade_id(chaveAcao);
    set_mensagem_erro(null);
    try {
      const { error } = await supabase.rpc('admin_bloquear_modalidade_avaliador', {
        p_id_usuario: usuario.id_usuario,
        p_id_evento: idEvento,
        p_id_modalidade: modalidade.id_modalidade,
        p_bloquear: !jaBloqueada,
      });
      if (error) {
        set_mensagem_erro(`Erro ao atualizar o bloqueio: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      const novas = jaBloqueada
        ? (usuario.modalidades_bloqueadas || []).filter((id) => id !== modalidade.id_modalidade)
        : [...(usuario.modalidades_bloqueadas || []), modalidade.id_modalidade];
      const nomes = novas.map((id) => lista_modalidades.find((m) => m.id_modalidade === id)?.nome_modalidade || '');
      setListaAvaliadores((prev) =>
        prev.map((a) => (a.id_usuario === usuario.id_usuario ? { ...a, modalidades_bloqueadas: novas, nomes_modalidades_bloqueadas: nomes } : a))
      );
      exibir_notificacao(
        jaBloqueada
          ? `Modalidade "${modalidade.nome_modalidade}" liberada para ${usuario.nome}.`
          : `Modalidade "${modalidade.nome_modalidade}" bloqueada para ${usuario.nome}.`
      );
      aoAtualizarMetricas?.();
    } finally {
      set_processando_modalidade_id(null);
    }
  };

  const handle_abrir_edicao = (item: UsuarioAvaliador) => {
    set_usuario_em_edicao({ id_usuario: item.id_usuario, nome: item.nome, email: item.email });
    set_edit_instituicao_id(item.id_instituicao || '');
    set_edit_modalidades_bloqueadas(item.modalidades_bloqueadas || []);
    set_edit_areas(item.areas || []);
  };

  const fechar_edicao = () => set_usuario_em_edicao(null);

  const handle_salvar_edicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario_em_edicao) return;
    if (!usuario_em_edicao.nome.trim() || !usuario_em_edicao.email.trim()) {
      set_mensagem_erro('Nome e e-mail não podem ficar vazios.');
      return;
    }
    if (!(await garantirSessaoAdmin())) return;

    set_salvando_edicao(true);
    set_mensagem_erro(null);
    try {
      const { error } = await supabase.rpc('admin_atualizar_avaliador', {
        p_id_usuario: usuario_em_edicao.id_usuario,
        p_id_evento: idEvento,
        p_nome: usuario_em_edicao.nome.trim(),
        p_email: usuario_em_edicao.email.trim().toLowerCase(),
        p_id_instituicao: edit_instituicao_id || null,
        p_ids_modalidades_bloqueadas: edit_modalidades_bloqueadas,
        p_ids_areas: edit_areas,
      });
      if (error) {
        set_mensagem_erro(`Erro ao salvar o avaliador: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      exibir_notificacao('Avaliador atualizado.');
      fechar_edicao();
      await carregar_avaliadores();
      aoAtualizarMetricas?.();
    } finally {
      set_salvando_edicao(false);
    }
  };

  // Remover do evento (as notas nunca são apagadas)
  const confirmar_remocao = async () => {
    const alvo = avaliador_para_remover;
    if (!alvo) return;
    if (!(await garantirSessaoAdmin())) return;
    set_removendo(true);
    set_mensagem_erro(null);
    try {
      const { data, error } = await supabase.rpc('admin_remover_avaliador_evento', {
        p_id_usuario: alvo.id_usuario,
        p_id_evento: idEvento,
      });
      set_avaliador_para_remover(null);
      if (error) {
        set_mensagem_erro(`Não foi possível remover ${alvo.nome}: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      setListaAvaliadores((prev) => prev.filter((u) => u.id_usuario !== alvo.id_usuario));
      exibir_notificacao(
        (data as { cadastro_apagado?: boolean } | null)?.cadastro_apagado
          ? `${alvo.nome} foi removido do evento e o cadastro foi apagado.`
          : `${alvo.nome} foi removido deste evento.`
      );
      aoAtualizarMetricas?.();
    } finally {
      set_removendo(false);
    }
  };

  const alternarOrdenacao = (coluna: ColunaOrdenacaoAvaliador) => {
    if (colunaOrdenacao === coluna) {
      setOrdemAscendente(!ordemAscendente);
    } else {
      setColunaOrdenacao(coluna);
      setOrdemAscendente(true);
    }
  };

  const avaliadores_filtrados = useMemo(() => {
    const t = termo_busca.trim().toLowerCase();
    if (!t) return avaliadores;
    return avaliadores.filter(
      (a) =>
        a.nome?.toLowerCase().includes(t) ||
        a.email?.toLowerCase().includes(t) ||
        a.nome_instituicao?.toLowerCase().includes(t)
    );
  }, [avaliadores, termo_busca]);

  const avaliadores_ordenados = useMemo(
    () =>
      [...avaliadores_filtrados].sort((a, b) => {
        const valA = textoColuna(a, colunaOrdenacao);
        const valB = textoColuna(b, colunaOrdenacao);
        // Vazios (sem instituição, sem bloqueio, sem área) ficam sempre no fim
        if (!valA && !valB) return 0;
        if (!valA) return 1;
        if (!valB) return -1;
        const comp = compararNatural(valA, valB);
        return ordemAscendente ? comp : -comp;
      }),
    [avaliadores_filtrados, colunaOrdenacao, ordemAscendente]
  );

  const totalAvaliadoresCredenciados = avaliadores.filter((a) => a.is_credenciado).length;
  const direcao = ordemAscendente ? 'asc' : 'desc';

  const listaCheckboxes = (
    itens: { id: string; nome: string }[],
    selecionados: string[],
    aoMudar: (ids: string[]) => void,
    cor: 'red' | 'emerald',
    rotuloGrupo: string
  ) => (
    <div role="group" aria-label={rotuloGrupo} className="flex flex-wrap gap-2">
      {itens.map((item) => {
        const checked = selecionados.includes(item.id);
        return (
          <label
            key={item.id}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
              checked
                ? cor === 'red'
                  ? 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800'
                  : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => aoMudar(e.target.checked ? [...selecionados, item.id] : selecionados.filter((id) => id !== item.id))}
              className={`rounded w-3.5 h-3.5 ${cor === 'red' ? 'text-red-600 focus:ring-red-500' : 'text-emerald-600 focus:ring-emerald-500'}`}
            />
            {item.nome}
          </label>
        );
      })}
    </div>
  );

  const opcoesModalidades = lista_modalidades.map((m) => ({ id: m.id_modalidade, nome: m.nome_modalidade }));
  const opcoesAreas = lista_areas.map((a) => ({ id: a.id_area, nome: a.nome_area }));

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans w-full h-full overflow-y-auto">
      {mensagem_notificacao && (
        <div role="status" className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {mensagem_erro && (
        <div role="alert" className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl flex items-center justify-between gap-3 text-xs sm:text-sm text-red-800 dark:text-red-200 font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{mensagem_erro}</span>
          </div>
          <button type="button" onClick={() => set_mensagem_erro(null)} className="text-xs text-red-600 dark:text-red-300 underline font-bold">
            Dispensar
          </button>
        </div>
      )}

      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-blue-100 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 shadow-xs">
            <Users className="w-5 h-5" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">Gestor de Avaliadores</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={input_file_ref}
            type="file"
            accept=".csv, .xlsx"
            className="hidden"
            aria-label="Arquivo de avaliadores (.xlsx ou .csv)"
            disabled={processando_arquivo || !idEvento}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) handle_upload_arquivo(e.target.files[0]);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={baixar_planilha_exemplo}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Baixar Modelo (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={() => input_file_ref.current?.click()}
            disabled={processando_arquivo || !idEvento}
            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
          >
            {processando_arquivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{processando_arquivo ? 'Processando planilha...' : 'Importar (.xlsx/.csv)'}</span>
          </button>

          <button
            type="button"
            onClick={() => set_mostrar_form_novo(!mostrar_form_novo)}
            disabled={!idEvento}
            aria-expanded={mostrar_form_novo}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            Novo Avaliador
          </button>

          <button
            type="button"
            onClick={carregar_avaliadores}
            disabled={carregando}
            aria-label="Recarregar lista"
            title="Recarregar lista"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          {ao_fechar && (
            <button
              type="button"
              onClick={ao_fechar}
              aria-label="Fechar"
              title="Fechar"
              className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {!idEvento && (
        <div role="alert" className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs sm:text-sm text-amber-800 dark:text-amber-200 font-semibold">
          Não há evento ativo. Os avaliadores são cadastrados por evento: ative um evento para gerenciá-los.
        </div>
      )}

      {/* Console de logs da importação */}
      {(logsImportacao.length > 0 || processando_arquivo) && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-emerald-400">
              <Terminal className="w-4 h-4" />
              <span>Resultado da importação</span>
            </div>
            {logsImportacao.length > 0 && !processando_arquivo && (
              <button type="button" onClick={() => setLogsImportacao([])} className="text-[11px] text-slate-400 hover:text-slate-200 underline cursor-pointer lowercase">
                fechar
              </button>
            )}
          </div>
          <ul aria-label="Resultado da importação" className="text-slate-200 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1">
            {logsImportacao.map((log, idx) => (
              <li
                key={idx}
                className={`leading-relaxed ${log.tipo === 'success' ? 'text-emerald-400' : log.tipo === 'error' ? 'text-red-400' : 'text-slate-300'}`}
              >
                {log.tipo === 'success' && '✓ '}
                {log.tipo === 'error' && '✕ '}
                {log.tipo === 'info' && 'ℹ '}
                {log.mensagem}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Formulário de novo avaliador */}
      {mostrar_form_novo && (
        <form
          onSubmit={handle_adicionar_manual}
          aria-label="Cadastrar novo avaliador"
          className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/60 p-4 sm:p-5 rounded-2xl space-y-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Cadastrar novo avaliador
            </span>
            <button
              type="button"
              onClick={() => {
                set_mostrar_form_novo(false);
                limpar_form_novo();
              }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancelar
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              value={novo_nome}
              onChange={(e) => set_novo_nome(e.target.value)}
              placeholder="Nome do avaliador"
              aria-label="Nome do avaliador"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <input
              type="email"
              value={novo_email}
              onChange={(e) => set_novo_email(e.target.value)}
              placeholder="E-mail do avaliador"
              aria-label="E-mail do avaliador"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <select
              value={novo_instituicao_id}
              onChange={(e) => set_novo_instituicao_id(e.target.value)}
              aria-label="Instituição de origem"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Instituição de origem (opcional)</option>
              {lista_instituicoes.map((inst) => (
                <option key={inst.id_instituicao} value={inst.id_instituicao}>
                  {inst.nome_exibicao} {inst.sigla ? `(${inst.sigla})` : ''}
                </option>
              ))}
            </select>
          </div>

          {lista_modalidades.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-blue-200/60 dark:border-blue-900/40">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <ShieldOff className="w-3.5 h-3.5 text-amber-500" />
                Modalidades bloqueadas (o avaliador não recebe projetos destas modalidades):
              </span>
              {listaCheckboxes(opcoesModalidades, novo_modalidades_bloqueadas, set_novo_modalidades_bloqueadas, 'red', 'Modalidades bloqueadas')}
            </div>
          )}

          {lista_areas.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-blue-200/60 dark:border-blue-900/40">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Áreas de avaliação (projetos destas áreas têm prioridade no sorteio):
              </span>
              {listaCheckboxes(opcoesAreas, novo_areas, set_novo_areas, 'emerald', 'Áreas de avaliação')}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={salvando_manual || !novo_nome.trim() || !novo_email.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shrink-0 shadow-xs cursor-pointer"
            >
              {salvando_manual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Cadastrar Avaliador
            </button>
          </div>
        </form>
      )}

      {/* Busca e contador */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Pesquisar por nome, e-mail ou instituição..."
            aria-label="Pesquisar avaliadores"
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 self-end sm:self-center">
          {avaliadores_filtrados.length !== avaliadores.length ? (
            <>
              Mostrando <strong className="text-slate-800 dark:text-slate-200">{avaliadores_filtrados.length}</strong> de{' '}
            </>
          ) : (
            'Total: '
          )}
          <strong className="text-slate-800 dark:text-slate-200">{avaliadores.length}</strong> avaliadores no evento (
          <span className="text-emerald-600 dark:text-emerald-400 font-bold">{totalAvaliadoresCredenciados} credenciados</span>)
        </span>
      </div>

      {carregando ? (
        <div className="p-12 text-center space-y-2 border border-slate-200 dark:border-slate-700 rounded-2xl">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">Carregando avaliadores...</p>
        </div>
      ) : avaliadores_filtrados.length === 0 ? (
        <div className="p-10 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {avaliadores.length === 0 ? 'Nenhum avaliador inscrito neste evento.' : 'Nenhum avaliador encontrado para esta pesquisa.'}
          </p>
          {avaliadores.length === 0 && (
            <p className="text-[11px] text-slate-400">Cadastre um avaliador, importe uma planilha ou peça o autocadastro pelo QR Code do Staff.</p>
          )}
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[640px]">
              <caption className="sr-only">Avaliadores do evento</caption>
              <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <CabecalhoOrdenavel coluna="is_credenciado" rotulo="Credenciamento" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="nome" rotulo="Nome" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="nome_instituicao" rotulo="Instituição" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="email" rotulo="E-mail" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="modalidades_bloqueadas" rotulo="Modalidades" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="areas" rotulo="Áreas" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <th scope="col" className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {avaliadores_ordenados.map((usuario) => {
                  const processandoCredenciamento = processando_credenciamento_id === usuario.id_usuario;
                  return (
                    <tr key={usuario.id_usuario} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3.5">
                        {usuario.is_credenciado ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            Credenciado
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            Pendente
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900 dark:text-white">{usuario.nome}</div>
                      </td>

                      <td className="px-4 py-3.5">
                        {usuario.nome_instituicao ? (
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                            <span>{usuario.nome_instituicao}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">Não informada</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-300">{usuario.email}</td>

                      <td className="px-4 py-3.5">
                        {lista_modalidades.length === 0 ? (
                          <span className="text-[11px] text-slate-400 italic">Nenhuma modalidade</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-w-sm">
                            {lista_modalidades.map((m) => {
                              const estaBloqueada = (usuario.modalidades_bloqueadas || []).includes(m.id_modalidade);
                              const processando = processando_modalidade_id === `${usuario.id_usuario}_${m.id_modalidade}`;
                              return (
                                <button
                                  key={m.id_modalidade}
                                  type="button"
                                  onClick={() => handle_toggle_modalidade_bloqueio(usuario, m)}
                                  disabled={processando}
                                  aria-pressed={estaBloqueada}
                                  aria-label={`${estaBloqueada ? 'Liberar' : 'Bloquear'} ${m.nome_modalidade} para ${usuario.nome}`}
                                  title={estaBloqueada ? `Bloqueada. Clique para liberar.` : `Liberada. Clique para bloquear.`}
                                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 select-none shadow-2xs ${
                                    estaBloqueada
                                      ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-300 dark:bg-red-950/60 dark:hover:bg-red-900/60 dark:text-red-300 dark:border-red-800'
                                      : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700'
                                  }`}
                                >
                                  {processando ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : estaBloqueada ? (
                                    <ShieldOff className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0" />
                                  ) : (
                                    <Shield className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
                                  )}
                                  <span>{estaBloqueada ? `Bloq: ${m.nome_modalidade}` : m.nome_modalidade}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        {usuario.nomes_areas && usuario.nomes_areas.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {usuario.nomes_areas.map((nomeArea) => (
                              <span
                                key={nomeArea}
                                className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-md inline-flex items-center gap-1 shadow-2xs"
                              >
                                <Database className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                                {nomeArea}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 italic">Geral (todas as áreas)</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handle_toggle_credenciamento(usuario)}
                            disabled={processandoCredenciamento}
                            aria-label={`${usuario.is_credenciado ? 'Descredenciar' : 'Credenciar'} ${usuario.nome}`}
                            className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all inline-flex items-center gap-1.5 ${
                              usuario.is_credenciado
                                ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600'
                            } disabled:opacity-50`}
                          >
                            {processandoCredenciamento ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : usuario.is_credenciado ? (
                              <UserX className="w-3.5 h-3.5" />
                            ) : (
                              <UserCheck className="w-3.5 h-3.5" />
                            )}
                            <span>{usuario.is_credenciado ? 'Descredenciar' : 'Credenciar'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handle_abrir_edicao(usuario)}
                            aria-label={`Editar ${usuario.nome}`}
                            title="Editar"
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => set_avaliador_para_remover(usuario)}
                            aria-label={`Remover ${usuario.nome} do evento`}
                            title="Remover do evento"
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CONFIRMAÇÃO DE REMOÇÃO */}
      {avaliador_para_remover && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titulo-remover-avaliador"
            aria-describedby="texto-remover-avaliador"
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl border border-rose-200 dark:border-rose-900/60 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-rose-100 dark:bg-rose-950/50">
                <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
              </div>
              <h3 id="titulo-remover-avaliador" className="text-base font-bold text-slate-900 dark:text-white">
                Remover {avaliador_para_remover.nome} deste evento?
              </h3>
            </div>
            <p id="texto-remover-avaliador" className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Ele sai da lista do evento e perde as travas e a fila de projetos. Se ele já avaliou algum projeto, a remoção é
              recusada: nesse caso use <strong>Descredenciar</strong>, e as notas continuam valendo.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => set_avaliador_para_remover(null)}
                disabled={removendo}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar_remocao}
                disabled={removendo}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50"
              >
                {removendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Remover do evento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO */}
      {usuario_em_edicao && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-editar-avaliador"
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 id="titulo-editar-avaliador" className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-emerald-600" />
                Editar Avaliador
              </h3>
              <button type="button" onClick={fechar_edicao} aria-label="Fechar edição" className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handle_salvar_edicao} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="edit-nome-avaliador" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nome completo
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    id="edit-nome-avaliador"
                    type="text"
                    value={usuario_em_edicao.nome}
                    onChange={(e) => set_usuario_em_edicao({ ...usuario_em_edicao, nome: e.target.value })}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="edit-email-avaliador" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    id="edit-email-avaliador"
                    type="email"
                    value={usuario_em_edicao.email}
                    onChange={(e) => set_usuario_em_edicao({ ...usuario_em_edicao, email: e.target.value })}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="edit-instituicao-avaliador" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Instituição de origem
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <select
                    id="edit-instituicao-avaliador"
                    value={edit_instituicao_id}
                    onChange={(e) => set_edit_instituicao_id(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Não informada</option>
                    {lista_instituicoes.map((inst) => (
                      <option key={inst.id_instituicao} value={inst.id_instituicao}>
                        {inst.nome_exibicao} {inst.sigla ? `(${inst.sigla})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {lista_modalidades.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <ShieldOff className="w-3.5 h-3.5 text-amber-500" />
                    Modalidades bloqueadas
                  </span>
                  <div className="max-h-36 overflow-y-auto p-1 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900">
                    {listaCheckboxes(opcoesModalidades, edit_modalidades_bloqueadas, set_edit_modalidades_bloqueadas, 'red', 'Modalidades bloqueadas')}
                  </div>
                </div>
              )}

              {lista_areas.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Áreas de avaliação
                  </span>
                  <div className="max-h-36 overflow-y-auto p-1 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900">
                    {listaCheckboxes(opcoesAreas, edit_areas, set_edit_areas, 'emerald', 'Áreas de avaliação')}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={fechar_edicao}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando_edicao}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
                >
                  {salvando_edicao ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Salvar Alterações</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {ao_fechar && (
        <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-end">
          <button
            type="button"
            onClick={ao_fechar}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-all shadow-xs cursor-pointer"
          >
            Fechar Janela
          </button>
        </div>
      )}

      {modalDeParaAberto && (
        <ModalDeParaMapping
          itens={itensDePara}
          instituicoesExistentes={lista_instituicoes}
          modalidadesExistentes={lista_modalidades}
          areasExistentes={lista_areas}
          aoFechar={() => {
            setModalDeParaAberto(false);
            adicionarLog('info', 'Importação cancelada.');
          }}
          aoConfirmar={async (decisoes) => {
            setModalDeParaAberto(false);
            await executarGravacaoFinalAvaliadores(linhasArquivoPendente, decisoes);
          }}
        />
      )}
    </div>
  );
};
