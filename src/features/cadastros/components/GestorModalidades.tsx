import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers,
  UploadCloud,
  Plus,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  X,
  Save,
  Download,
  Terminal,
} from 'lucide-react';
import { baixarPlanilhaModelo, validarArquivoPlanilha } from '@/lib/excel/excelUtils';
import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { parsePlanilhaModalidades, ModalidadeImportada } from '@/lib/parsers/planilhaModalidadesParser';
import { normalizarChave } from '@/lib/parsers/planilhaAvaliadoresParser';
import { ModalDeParaMapping, ItemMapeamentoDePara, DecisaoMapeamento } from '@/components/importacao/ModalDeParaMapping';
import { buscarMelhorCorrespondencia, CandidatoMatch } from '@/lib/parsers/fuzzyMatcher';
import { CabecalhoOrdenavel, compararNatural } from '@/components/ui/CabecalhoOrdenavel';

export interface ModalidadeItem {
  id_modalidade: string;
  codigo?: string | null;
  nome_modalidade: string;
  nivel?: string | null;
  area_tematica?: string | null;
  descricao?: string | null;
}

export interface AreaTematicaRef {
  id_area: string;
  nome_area: string;
}

interface ItemModalidadeRpc {
  nome: string;
  codigo?: string | null;
  nivel?: string | null;
  area_tematica?: string | null;
  descricao?: string | null;
  id_existente?: string;
}

interface ResultadoSalvarModalidades {
  cadastradas: number;
  atualizadas: number;
  associadas: number;
  ignoradas: { nome: string; motivo: string }[];
}

interface GestorModalidadesProps {
  id_evento_ativo?: string;
  ao_fechar?: () => void;
  aoAtualizarMetricas?: () => void;
}

type ColunaOrdenacao = 'codigo' | 'nome_modalidade' | 'nivel' | 'area_tematica';

const NIVEIS = ['Fundamental', 'Médio', 'Médio/Técnico', 'Técnico', 'Superior', 'Geral'];

/** Monta os itens da RPC a partir das linhas da planilha e das decisões do De-Para. */
export const montarItensModalidades = (linhas: ModalidadeImportada[], decisoes: Map<string, DecisaoMapeamento>): ItemModalidadeRpc[] =>
  linhas.map((linha) => {
    const decisao = decisoes.get(linha.nome_modalidade.trim());
    if (decisao?.acao === 'associar_existente' && decisao.id_destino) {
      return { nome: linha.nome_modalidade.trim(), id_existente: decisao.id_destino };
    }
    return {
      nome: (decisao?.novo_nome || linha.nome_modalidade).trim(),
      codigo: linha.codigo || null,
      nivel: linha.nivel || null,
      area_tematica: linha.area_tematica || null,
      descricao: linha.descricao || null,
    };
  });

const mensagemErro = (erro: unknown) =>
  (erro as { code?: string } | null)?.code === '23505'
    ? 'Já existe uma modalidade com esse nome neste evento.'
    : tratarErroEscritaAdmin(erro);

export const GestorModalidades: React.FC<GestorModalidadesProps> = ({ id_evento_ativo, ao_fechar, aoAtualizarMetricas }) => {
  const idEvento = id_evento_ativo || '';
  const [modalidades, setModalidades] = useState<ModalidadeItem[]>([]);
  const [areasTematicas, setAreasTematicas] = useState<AreaTematicaRef[]>([]);
  const [carregando, setCarregando] = useState<boolean>(true);
  const [termoBusca, setTermoBusca] = useState<string>('');

  const [colunaOrdenacao, setColunaOrdenacao] = useState<ColunaOrdenacao>('nome_modalidade');
  const [ordemAscendente, setOrdemAscendente] = useState<boolean>(true);

  const [mostrarFormNovo, setMostrarFormNovo] = useState<boolean>(false);
  const [novoCodigo, setNovoCodigo] = useState<string>('');
  const [novoNome, setNovoNome] = useState<string>('');
  const [novoNivel, setNovoNivel] = useState<string>('Médio/Técnico');
  const [novoAreaTematica, setNovoAreaTematica] = useState<string>('');
  const [novoDescricao, setNovoDescricao] = useState<string>('');
  const [salvandoManual, setSalvandoManual] = useState<boolean>(false);

  const [modalidadeEmEdicao, setModalidadeEmEdicao] = useState<ModalidadeItem | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState<boolean>(false);

  const [modalidadeParaExcluir, setModalidadeParaExcluir] = useState<ModalidadeItem | null>(null);
  const [excluindo, setExcluindo] = useState<boolean>(false);

  const [processandoArquivo, setProcessandoArquivo] = useState<boolean>(false);
  const [logsImportacao, setLogsImportacao] = useState<Array<{ tipo: 'success' | 'error' | 'info'; mensagem: string }>>([]);
  const [modalDeParaAberto, setModalDeParaAberto] = useState<boolean>(false);
  const [itensDePara, setItensDePara] = useState<ItemMapeamentoDePara[]>([]);
  const [linhasArquivoPendente, setLinhasArquivoPendente] = useState<ModalidadeImportada[]>([]);

  const [mensagemNotificacao, setMensagemNotificacao] = useState<string | null>(null);
  const [mensagemErroTela, setMensagemErro] = useState<string | null>(null);

  const inputFileRef = useRef<HTMLInputElement>(null);

  const exibirNotificacao = (texto: string) => {
    setMensagemNotificacao(texto);
    setTimeout(() => setMensagemNotificacao(null), 3500);
  };

  const adicionarLog = (tipo: 'success' | 'error' | 'info', mensagem: string) => {
    setLogsImportacao((prev) => [...prev, { tipo, mensagem }]);
  };

  const carregarModalidades = useCallback(async () => {
    if (!idEvento) {
      setModalidades([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    try {
      const [resMod, resArea] = await Promise.all([
        supabase
          .from('modalidades')
          .select('id_modalidade, codigo, nome_modalidade, nivel, area_tematica, descricao')
          .eq('id_evento', idEvento)
          .order('nome_modalidade', { ascending: true }),
        supabase.from('areas_tematicas').select('id_area, nome_area').eq('id_evento', idEvento).order('nome_area', { ascending: true }),
      ]);
      if (resMod.error) throw resMod.error;
      if (resArea.error) throw resArea.error;
      setModalidades((resMod.data || []) as ModalidadeItem[]);
      setAreasTematicas((resArea.data || []) as AreaTematicaRef[]);
    } catch (err) {
      console.error('Erro ao carregar modalidades:', err);
      setMensagemErro(`Não foi possível carregar as modalidades: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      setCarregando(false);
    }
  }, [idEvento]);

  useEffect(() => {
    carregarModalidades();
  }, [carregarModalidades]);

  const salvarModalidades = async (itens: ItemModalidadeRpc[]): Promise<ResultadoSalvarModalidades | null> => {
    const { data, error } = await supabase.rpc('admin_salvar_modalidades', { p_id_evento: idEvento, p_itens: itens });
    if (error) {
      setMensagemErro(`Erro ao gravar modalidades: ${mensagemErro(error)}`);
      return null;
    }
    const r = (data || {}) as Partial<ResultadoSalvarModalidades>;
    return { cadastradas: r.cadastradas ?? 0, atualizadas: r.atualizadas ?? 0, associadas: r.associadas ?? 0, ignoradas: r.ignoradas ?? [] };
  };

  const limparFormNovo = () => {
    setNovoCodigo('');
    setNovoNome('');
    setNovoNivel('Médio/Técnico');
    setNovoAreaTematica('');
    setNovoDescricao('');
  };

  const handleAdicionarManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoNome.trim()) {
      setMensagemErro('O nome da modalidade é obrigatório.');
      return;
    }
    if (!(await garantirSessaoAdmin())) return;
    setSalvandoManual(true);
    setMensagemErro(null);
    try {
      const resultado = await salvarModalidades([
        {
          nome: novoNome.trim(),
          codigo: novoCodigo.trim() || null,
          nivel: novoNivel || null,
          area_tematica: novoAreaTematica.trim() || null,
          descricao: novoDescricao.trim() || null,
        },
      ]);
      if (!resultado) return;
      if (resultado.ignoradas.length > 0) {
        setMensagemErro(`Modalidade não cadastrada: ${resultado.ignoradas[0].motivo}`);
        return;
      }
      exibirNotificacao(
        resultado.atualizadas > 0
          ? `"${novoNome.trim()}" já existia neste evento; os dados informados foram atualizados.`
          : `Modalidade "${novoNome.trim()}" cadastrada.`
      );
      limparFormNovo();
      setMostrarFormNovo(false);
      await carregarModalidades();
      aoAtualizarMetricas?.();
    } finally {
      setSalvandoManual(false);
    }
  };

  const handleSalvarEdicao = async (e: React.FormEvent) => {
    e.preventDefault();
    const alvo = modalidadeEmEdicao;
    if (!alvo || !alvo.nome_modalidade.trim()) {
      setMensagemErro('O nome da modalidade não pode ficar vazio.');
      return;
    }
    if (!(await garantirSessaoAdmin())) return;
    setSalvandoEdicao(true);
    setMensagemErro(null);
    try {
      const { error } = await supabase
        .from('modalidades')
        .update({
          codigo: alvo.codigo?.trim() || null,
          nome_modalidade: alvo.nome_modalidade.trim(),
          nivel: alvo.nivel?.trim() || null,
          area_tematica: alvo.area_tematica?.trim() || null,
          descricao: alvo.descricao?.trim() || null,
        })
        .eq('id_modalidade', alvo.id_modalidade);
      if (error) {
        setMensagemErro(`Erro ao salvar a modalidade: ${mensagemErro(error)}`);
        return;
      }
      exibirNotificacao('Modalidade atualizada.');
      setModalidadeEmEdicao(null);
      await carregarModalidades();
      aoAtualizarMetricas?.();
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const confirmarExclusao = async () => {
    const alvo = modalidadeParaExcluir;
    if (!alvo) return;
    if (!(await garantirSessaoAdmin())) return;
    setExcluindo(true);
    setMensagemErro(null);
    try {
      const { error } = await supabase.rpc('admin_excluir_modalidade', { p_id_modalidade: alvo.id_modalidade });
      setModalidadeParaExcluir(null);
      if (error) {
        setMensagemErro(`Não foi possível excluir "${alvo.nome_modalidade}": ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      setModalidades((prev) => prev.filter((m) => m.id_modalidade !== alvo.id_modalidade));
      exibirNotificacao(`Modalidade "${alvo.nome_modalidade}" excluída.`);
      aoAtualizarMetricas?.();
    } finally {
      setExcluindo(false);
    }
  };

  const baixarPlanilhaExemplo = async () => {
    try {
      const colunas = ['Código', 'Modalidade', 'Nível', 'Área Temática', 'Descrição'];
      await baixarPlanilhaModelo('modelo_importacao_modalidades.xlsx', 'Modalidades', colunas, [
        { 'Código': 'MOD-EM', 'Modalidade': 'Ensino Médio e Técnico', 'Nível': 'Médio', 'Área Temática': 'Ciências Exatas e da Terra', 'Descrição': 'Alunos do ensino médio e técnico integrado' },
        { 'Código': 'MOD-EF', 'Modalidade': 'Ensino Fundamental II', 'Nível': 'Fundamental', 'Área Temática': 'Multidisciplinar', 'Descrição': 'Estudantes do 6º ao 9º ano' },
        { 'Código': 'MOD-SUP', 'Modalidade': 'Ensino Superior / Graduação', 'Nível': 'Superior', 'Área Temática': 'Engenharias', 'Descrição': 'Graduação e iniciação científica' },
      ]);
      exibirNotificacao('Planilha modelo de modalidades (.xlsx) baixada.');
    } catch (err) {
      console.error('Erro ao gerar modelo:', err);
      setMensagemErro('Falha ao baixar o modelo de planilha.');
    }
  };

  const executarGravacaoEmLote = async (linhas: ModalidadeImportada[], decisoes: Map<string, DecisaoMapeamento>) => {
    if (!(await garantirSessaoAdmin())) return;
    setProcessandoArquivo(true);
    try {
      const resultado = await salvarModalidades(montarItensModalidades(linhas, decisoes));
      if (!resultado) {
        adicionarLog('error', 'A importação foi recusada pelo banco; nada foi gravado.');
        return;
      }
      resultado.ignoradas.forEach((i) => adicionarLog('error', `${i.nome || '(sem nome)'}: ${i.motivo}`));
      const resumo =
        `${resultado.cadastradas} cadastrada(s), ${resultado.atualizadas} já existente(s) atualizada(s)` +
        (resultado.associadas ? `, ${resultado.associadas} associada(s) a uma existente` : '') +
        (resultado.ignoradas.length ? `, ${resultado.ignoradas.length} ignorada(s)` : '');
      adicionarLog('success', `Importação concluída: ${resumo}.`);
      exibirNotificacao(`Importação concluída: ${resumo}.`);
      await carregarModalidades();
      aoAtualizarMetricas?.();
    } finally {
      setProcessandoArquivo(false);
    }
  };

  const handleUploadArquivo = async (file: File) => {
    setMensagemErro(null);
    setLogsImportacao([]);

    const validacao = validarArquivoPlanilha(file);
    if (!validacao.valido) {
      adicionarLog('error', validacao.erro || 'Arquivo inválido.');
      setMensagemErro(validacao.erro || 'Arquivo inválido.');
      return;
    }

    setProcessandoArquivo(true);
    adicionarLog('info', `Lendo o arquivo ${file.name}...`);

    const reader = new FileReader();
    reader.onerror = () => {
      adicionarLog('error', 'Não foi possível ler o arquivo.');
      setProcessandoArquivo(false);
    };
    reader.onload = async (e) => {
      try {
        if (!e.target?.result) {
          adicionarLog('error', 'Arquivo vazio.');
          return;
        }
        const resultado = await parsePlanilhaModalidades(e.target.result as ArrayBuffer | string, validacao.isCSV);
        resultado.erros.forEach((err) => adicionarLog('error', `Linha ${err.linha}: ${err.mensagem}`));
        if (!resultado.sucesso || resultado.modalidades.length === 0) {
          adicionarLog('error', 'Nenhuma modalidade válida na planilha.');
          setMensagemErro('Nenhuma modalidade válida na planilha.');
          return;
        }
        adicionarLog('info', `${resultado.modalidades.length} modalidade(s) na planilha.`);

        const { data: aliasesData } = await supabase.from('modalidade_aliases').select('id_modalidade, alias');
        const aliasMap = new Map<string, string[]>();
        (aliasesData || []).forEach((a: { id_modalidade: string; alias: string }) =>
          aliasMap.set(a.id_modalidade, [...(aliasMap.get(a.id_modalidade) || []), a.alias])
        );
        const candidatos: CandidatoMatch[] = modalidades.map((m) => ({
          id: m.id_modalidade,
          nome: m.nome_modalidade,
          sigla: m.codigo,
          aliases: aliasMap.get(m.id_modalidade) || [],
        }));

        const termos = Array.from(new Set(resultado.modalidades.map((m) => m.nome_modalidade.trim())));
        const itens: ItemMapeamentoDePara[] = termos.map((termo) => {
          const match = buscarMelhorCorrespondencia(termo, candidatos, 0.85);
          return {
            id_termo: termo,
            termo_original: termo,
            tipo: 'modalidade',
            sugestao_id: match.candidato?.id || null,
            sugestao_nome: match.candidato?.nome || null,
            confianca_percentual: match.confiancaPercentual,
            match_tipo: match.matchTipo,
          };
        });

        setLinhasArquivoPendente(resultado.modalidades);
        if (itens.some((i) => i.match_tipo !== 'exato')) {
          adicionarLog('info', 'Há nomes novos ou parecidos com os cadastrados. Confira na tela de correspondência.');
          setItensDePara(itens);
          setModalDeParaAberto(true);
        } else {
          await executarGravacaoEmLote(resultado.modalidades, new Map());
        }
      } catch (errParsing) {
        const msg = errParsing instanceof Error ? errParsing.message : String(errParsing);
        adicionarLog('error', `Erro ao ler a planilha: ${msg}`);
        setMensagemErro(`Erro ao processar a planilha: ${msg}`);
      } finally {
        setProcessandoArquivo(false);
      }
    };
    if (validacao.isCSV) reader.readAsText(file, 'UTF-8');
    else reader.readAsArrayBuffer(file);
  };

  const alternarOrdenacao = (coluna: ColunaOrdenacao) => {
    if (colunaOrdenacao === coluna) {
      setOrdemAscendente(!ordemAscendente);
    } else {
      setColunaOrdenacao(coluna);
      setOrdemAscendente(true);
    }
  };

  const modalidadesFiltradas = useMemo(() => {
    const termo = normalizarChave(termoBusca);
    if (!termo) return modalidades;
    return modalidades.filter((m) =>
      [m.nome_modalidade, m.codigo, m.nivel, m.area_tematica].some((v) => normalizarChave(v || '').includes(termo))
    );
  }, [modalidades, termoBusca]);

  const modalidadesOrdenadas = useMemo(
    () =>
      [...modalidadesFiltradas].sort((a, b) => {
        const valA = a[colunaOrdenacao] || '';
        const valB = b[colunaOrdenacao] || '';
        if (!valA && !valB) return 0;
        if (!valA) return 1;
        if (!valB) return -1;
        const comp = compararNatural(valA, valB);
        return ordemAscendente ? comp : -comp;
      }),
    [modalidadesFiltradas, colunaOrdenacao, ordemAscendente]
  );

  const direcao = ordemAscendente ? 'asc' : 'desc';
  const classeCampo =
    'w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans w-full h-full overflow-y-auto">
      {mensagemNotificacao && (
        <div role="status" className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-purple-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 text-purple-300 dark:text-white shrink-0" />
          <span>{mensagemNotificacao}</span>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-purple-100 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">Gestor de Modalidades e Níveis</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={inputFileRef}
            type="file"
            accept=".csv, .xlsx"
            className="hidden"
            aria-label="Arquivo de modalidades (.xlsx ou .csv)"
            disabled={processandoArquivo || !idEvento}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) handleUploadArquivo(e.target.files[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={baixarPlanilhaExemplo}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs shrink-0"
          >
            <Download className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span>Baixar Modelo (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() => inputFileRef.current?.click()}
            disabled={processandoArquivo || !idEvento}
            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs shrink-0 disabled:opacity-60"
          >
            {processandoArquivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{processandoArquivo ? 'Processando planilha...' : 'Importar (.xlsx/.csv)'}</span>
          </button>
          <button
            type="button"
            onClick={() => setMostrarFormNovo(!mostrarFormNovo)}
            disabled={!idEvento}
            aria-expanded={mostrarFormNovo}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs shrink-0 disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            Nova Modalidade
          </button>
          <button
            type="button"
            onClick={carregarModalidades}
            disabled={carregando}
            aria-label="Recarregar lista"
            title="Recarregar lista"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-purple-600' : ''}`} />
          </button>
          {ao_fechar && (
            <button
              type="button"
              onClick={ao_fechar}
              aria-label="Fechar"
              title="Fechar"
              className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {!idEvento && (
        <div role="alert" className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs sm:text-sm text-amber-800 dark:text-amber-200 font-semibold">
          Não há evento ativo. As modalidades são de cada evento: ative um evento para gerenciá-las.
        </div>
      )}

      {mensagemErroTela && (
        <div role="alert" className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl flex items-center justify-between gap-3 text-xs sm:text-sm text-red-800 dark:text-red-200 font-semibold">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            {mensagemErroTela}
          </span>
          <button type="button" onClick={() => setMensagemErro(null)} className="text-xs underline font-bold">
            Dispensar
          </button>
        </div>
      )}

      {(logsImportacao.length > 0 || processandoArquivo) && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-purple-400">
              <Terminal className="w-4 h-4" />
              <span>Resultado da importação</span>
            </div>
            {logsImportacao.length > 0 && !processandoArquivo && (
              <button type="button" onClick={() => setLogsImportacao([])} className="text-[11px] text-slate-400 hover:text-slate-200 underline lowercase">
                fechar
              </button>
            )}
          </div>
          <ul aria-label="Resultado da importação" className="text-slate-200 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1">
            {logsImportacao.map((log, idx) => (
              <li key={idx} className={log.tipo === 'success' ? 'text-emerald-400' : log.tipo === 'error' ? 'text-red-400' : 'text-slate-300'}>
                {log.tipo === 'success' && '✓ '}
                {log.tipo === 'error' && '✕ '}
                {log.tipo === 'info' && 'ℹ '}
                {log.mensagem}
              </li>
            ))}
          </ul>
        </div>
      )}

      <datalist id="areas-tematicas-evento">
        {areasTematicas.map((a) => (
          <option key={a.id_area} value={a.nome_area} />
        ))}
      </datalist>

      {mostrarFormNovo && (
        <form
          onSubmit={handleAdicionarManual}
          aria-label="Cadastrar modalidade"
          className="bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 p-4 sm:p-5 rounded-2xl space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Cadastrar modalidade
            </span>
            <button
              type="button"
              onClick={() => {
                setMostrarFormNovo(false);
                limparFormNovo();
              }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancelar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input type="text" value={novoCodigo} onChange={(e) => setNovoCodigo(e.target.value)} placeholder="Código (ex: MOD-EM)" aria-label="Código" maxLength={50} className={classeCampo} />
            <input type="text" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome da modalidade *" aria-label="Nome da modalidade" maxLength={150} className={classeCampo} required />
            <select value={novoNivel} onChange={(e) => setNovoNivel(e.target.value)} aria-label="Nível de ensino" className={classeCampo}>
              {NIVEIS.map((n) => (
                <option key={n} value={n}>
                  {n === 'Geral' ? 'Geral / Livre' : n}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={novoAreaTematica}
              onChange={(e) => setNovoAreaTematica(e.target.value)}
              placeholder="Área temática (opcional)"
              aria-label="Área temática"
              list="areas-tematicas-evento"
              maxLength={150}
              className={classeCampo}
            />
          </div>
          <textarea
            value={novoDescricao}
            onChange={(e) => setNovoDescricao(e.target.value)}
            placeholder="Descrição ou observações (opcional)"
            aria-label="Descrição"
            rows={2}
            className={classeCampo}
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={salvandoManual || !novoNome.trim()}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2"
            >
              {salvandoManual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Cadastrar Modalidade
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={termoBusca}
            onChange={(e) => setTermoBusca(e.target.value)}
            placeholder="Pesquisar por código, modalidade, nível ou área..."
            aria-label="Pesquisar modalidades"
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          Total: <strong className="text-slate-800 dark:text-slate-200">{modalidades.length}</strong> modalidades no evento
        </span>
      </div>

      {carregando ? (
        <div className="p-12 text-center border border-slate-200 dark:border-slate-700 rounded-2xl">
          <Loader2 className="w-8 h-8 text-purple-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500 mt-2">Carregando modalidades...</p>
        </div>
      ) : modalidadesFiltradas.length === 0 ? (
        <div className="p-10 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {modalidades.length === 0 ? 'Nenhuma modalidade cadastrada neste evento.' : 'Nenhuma modalidade encontrada para esta pesquisa.'}
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[640px]">
              <caption className="sr-only">Modalidades do evento</caption>
              <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <CabecalhoOrdenavel coluna="codigo" rotulo="Código" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="nome_modalidade" rotulo="Modalidade" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="nivel" rotulo="Nível" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="area_tematica" rotulo="Área Temática" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <th scope="col" className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {modalidadesOrdenadas.map((mod) => (
                  <tr key={mod.id_modalidade} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-mono font-bold text-purple-700 dark:text-purple-300">{mod.codigo || <span className="text-slate-400 italic font-sans font-normal">Sem código</span>}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 dark:text-white">{mod.nome_modalidade}</div>
                      {mod.descricao && <div className="text-[11px] text-slate-500 mt-0.5">{mod.descricao}</div>}
                    </td>
                    <td className="px-4 py-3">{mod.nivel || <span className="text-slate-400 italic">Não informado</span>}</td>
                    <td className="px-4 py-3">{mod.area_tematica || <span className="text-slate-400 italic">Não informada</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setModalidadeEmEdicao({ ...mod })}
                          aria-label={`Editar ${mod.nome_modalidade}`}
                          title="Editar"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setModalidadeParaExcluir(mod)}
                          aria-label={`Excluir ${mod.nome_modalidade}`}
                          title="Excluir"
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalidadeEmEdicao && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="titulo-editar-modalidade" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 id="titulo-editar-modalidade" className="text-base font-extrabold text-slate-900 dark:text-white">
                Editar Modalidade
              </h3>
              <button type="button" onClick={() => setModalidadeEmEdicao(null)} aria-label="Fechar edição" className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSalvarEdicao} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="edit-mod-codigo" className="text-xs font-bold text-slate-700 dark:text-slate-300">Código</label>
                  <input id="edit-mod-codigo" type="text" maxLength={50} value={modalidadeEmEdicao.codigo || ''} onChange={(e) => setModalidadeEmEdicao({ ...modalidadeEmEdicao, codigo: e.target.value })} className={classeCampo} />
                </div>
                <div className="space-y-1">
                  <label htmlFor="edit-mod-nome" className="text-xs font-bold text-slate-700 dark:text-slate-300">Modalidade</label>
                  <input id="edit-mod-nome" type="text" maxLength={150} value={modalidadeEmEdicao.nome_modalidade} onChange={(e) => setModalidadeEmEdicao({ ...modalidadeEmEdicao, nome_modalidade: e.target.value })} className={classeCampo} required />
                </div>
                <div className="space-y-1">
                  <label htmlFor="edit-mod-nivel" className="text-xs font-bold text-slate-700 dark:text-slate-300">Nível de ensino</label>
                  <select id="edit-mod-nivel" value={modalidadeEmEdicao.nivel || ''} onChange={(e) => setModalidadeEmEdicao({ ...modalidadeEmEdicao, nivel: e.target.value })} className={classeCampo}>
                    <option value="">Não informado</option>
                    {NIVEIS.map((n) => (
                      <option key={n} value={n}>
                        {n === 'Geral' ? 'Geral / Livre' : n}
                      </option>
                    ))}
                    {modalidadeEmEdicao.nivel && !NIVEIS.includes(modalidadeEmEdicao.nivel) && <option value={modalidadeEmEdicao.nivel}>{modalidadeEmEdicao.nivel}</option>}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="edit-mod-area" className="text-xs font-bold text-slate-700 dark:text-slate-300">Área temática</label>
                  <input id="edit-mod-area" type="text" maxLength={150} list="areas-tematicas-evento" value={modalidadeEmEdicao.area_tematica || ''} onChange={(e) => setModalidadeEmEdicao({ ...modalidadeEmEdicao, area_tematica: e.target.value })} className={classeCampo} />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="edit-mod-descricao" className="text-xs font-bold text-slate-700 dark:text-slate-300">Descrição</label>
                <textarea id="edit-mod-descricao" rows={3} value={modalidadeEmEdicao.descricao || ''} onChange={(e) => setModalidadeEmEdicao({ ...modalidadeEmEdicao, descricao: e.target.value })} className={classeCampo} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModalidadeEmEdicao(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                  Cancelar
                </button>
                <button type="submit" disabled={salvandoEdicao} className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-extrabold flex items-center gap-2 disabled:opacity-50">
                  {salvandoEdicao ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalidadeParaExcluir && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titulo-excluir-modalidade"
            aria-describedby="texto-excluir-modalidade"
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl border border-rose-200 dark:border-rose-900/60 space-y-4"
          >
            <h3 id="titulo-excluir-modalidade" className="text-base font-bold text-slate-900 dark:text-white">
              Excluir "{modalidadeParaExcluir.nome_modalidade}"?
            </h3>
            <p id="texto-excluir-modalidade" className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Se houver projeto desta modalidade ou avaliador com ela bloqueada, a exclusão é recusada: os projetos ficariam sem
              modalidade e os bloqueios dos avaliadores seriam apagados.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setModalidadeParaExcluir(null)} disabled={excluindo} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarExclusao}
                disabled={excluindo}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50"
              >
                {excluindo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {ao_fechar && (
        <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-end">
          <button
            type="button"
            onClick={ao_fechar}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white shadow-xs"
          >
            Fechar Janela
          </button>
        </div>
      )}

      {modalDeParaAberto && (
        <ModalDeParaMapping
          itens={itensDePara}
          modalidadesExistentes={modalidades}
          aoFechar={() => {
            setModalDeParaAberto(false);
            adicionarLog('info', 'Importação cancelada.');
          }}
          aoConfirmar={async (decisoes) => {
            setModalDeParaAberto(false);
            await executarGravacaoEmLote(linhasArquivoPendente, decisoes);
          }}
        />
      )}
    </div>
  );
};
