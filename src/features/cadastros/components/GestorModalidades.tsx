import React, { useState, useEffect, useRef } from 'react';
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
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Save,
  Download,
  Terminal,
  FileSpreadsheet,
} from 'lucide-react';
import { baixarPlanilhaModelo, validarArquivoPlanilha } from '@/lib/excel/excelUtils';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { parsePlanilhaModalidades, ModalidadeImportada } from '@/lib/parsers/planilhaModalidadesParser';
import { ModalDeParaMapping, ItemMapeamentoDePara, DecisaoMapeamento } from '@/components/importacao/ModalDeParaMapping';
import { buscarMelhorCorrespondencia, CandidatoMatch, sanitizarTexto } from '@/lib/parsers/fuzzyMatcher';

export interface ModalidadeItem {
  id_modalidade: string;
  codigo?: string | null;
  nome_modalidade: string;
  nivel?: string | null;
  area_tematica?: string | null;
  descricao?: string | null;
  created_at?: string;
}

export interface AreaTematicaRef {
  id_area: string;
  nome_area: string;
}

interface GestorModalidadesProps {
  id_evento_ativo?: string;
  ao_fechar?: () => void;
  aoAtualizarMetricas?: () => void;
}

export const GestorModalidades: React.FC<GestorModalidadesProps> = ({
  id_evento_ativo,
  ao_fechar,
  aoAtualizarMetricas,
}) => {
  const [modalidades, setModalidades] = useState<ModalidadeItem[]>([]);
  const [areasTematicas, setAreasTematicas] = useState<AreaTematicaRef[]>([]);
  const [carregando, setCarregando] = useState<boolean>(true);
  const [termoBusca, setTermoBusca] = useState<string>('');

  // Ordenação de colunas
  const [colunaOrdenacao, setColunaOrdenacao] = useState<'codigo' | 'nome_modalidade' | 'nivel' | 'area_tematica'>('nome_modalidade');
  const [ordemAscendente, setOrdemAscendente] = useState<boolean>(true);

  // Formulário retrátil de nova modalidade
  const [mostrarFormNovo, setMostrarFormNovo] = useState<boolean>(false);
  const [novoCodigo, setNovoCodigo] = useState<string>('');
  const [novoNome, setNovoNome] = useState<string>('');
  const [novoNivel, setNovoNivel] = useState<string>('Médio/Técnico');
  const [novoAreaTematica, setNovoAreaTematica] = useState<string>('');
  const [novoDescricao, setNovoDescricao] = useState<string>('');
  const [salvandoManual, setSalvandoManual] = useState<boolean>(false);

  // Modal de edição
  const [modalEdicaoAberto, setModalEdicaoAberto] = useState<boolean>(false);
  const [modalidadeEmEdicao, setModalidadeEmEdicao] = useState<ModalidadeItem | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState<boolean>(false);

  // Importação e De-Para
  const [processandoArquivo, setProcessandoArquivo] = useState<boolean>(false);
  const [logsImportacao, setLogsImportacao] = useState<Array<{ tipo: 'success' | 'error' | 'info'; mensagem: string }>>([]);
  const [modalDeParaAberto, setModalDeParaAberto] = useState<boolean>(false);
  const [itensDePara, setItensDePara] = useState<ItemMapeamentoDePara[]>([]);
  const [linhasArquivoPendente, setLinhasArquivoPendente] = useState<ModalidadeImportada[]>([]);

  // Feedbacks
  const [mensagemNotificacao, setMensagemNotificacao] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  const inputFileRef = useRef<HTMLInputElement>(null);
  const conexaoBanco = verificar_conexao_configurada();

  const exibirNotificacao = (texto: string) => {
    setMensagemNotificacao(texto);
    setTimeout(() => setMensagemNotificacao(null), 3500);
  };

  const adicionarLog = (tipo: 'success' | 'error' | 'info', mensagem: string) => {
    setLogsImportacao((prev) => [...prev, { tipo, mensagem }]);
  };

  // Carrega modalidades e áreas temáticas
  const carregarModalidades = async () => {
    setCarregando(true);
    setMensagemErro(null);

    if (!conexaoBanco) {
      setCarregando(false);
      return;
    }

    try {
      const idEvt = id_evento_ativo || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || '';
      let qMod: any = supabase.from('modalidades').select('*');
      let qArea: any = supabase.from('areas_tematicas').select('id_area, nome_area');

      if (idEvt) {
        if (typeof qMod.eq === 'function') qMod = qMod.eq('id_evento', idEvt);
        if (typeof qArea.eq === 'function') qArea = qArea.eq('id_evento', idEvt);
      }

      if (typeof qMod.order === 'function') qMod = qMod.order('nome_modalidade', { ascending: true });
      if (typeof qArea.order === 'function') qArea = qArea.order('nome_area', { ascending: true });

      const [resMod, resArea] = await Promise.all([qMod, qArea]);

      if (resArea.data) {
        setAreasTematicas(resArea.data as AreaTematicaRef[]);
      }

      if (resMod.data) {
        setModalidades(resMod.data as ModalidadeItem[]);
      } else {
        setModalidades([]);
      }
    } catch (err: any) {
      console.error('Erro ao carregar modalidades:', err);
      setMensagemErro('Falha ao sincronizar modalidades com o banco.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarModalidades();
  }, [conexaoBanco]);

  // Inclusão Manual
  const handleAdicionarManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoNome.trim()) {
      setMensagemErro('O nome da modalidade é obrigatório.');
      return;
    }

    setSalvandoManual(true);
    setMensagemErro(null);

    const idEvt = id_evento_ativo || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || null;
    const dados: any = {
      codigo: novoCodigo.trim() || null,
      nome_modalidade: novoNome.trim(),
      nivel: novoNivel.trim() || null,
      area_tematica: novoAreaTematica.trim() || null,
      descricao: novoDescricao.trim() || null,
    };
    if (idEvt) dados.id_evento = idEvt;

    if (!conexaoBanco) {
      const nova: ModalidadeItem = {
        id_modalidade: crypto.randomUUID(),
        ...dados,
      };
      setModalidades((prev) => [nova, ...prev]);
      setNovoCodigo('');
      setNovoNome('');
      setNovoNivel('Médio/Técnico');
      setNovoAreaTematica('');
      setNovoDescricao('');
      setMostrarFormNovo(false);
      setSalvandoManual(false);
      exibirNotificacao('Modalidade adicionada com sucesso (modo contingência)!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    try {
      let { data, error } = await supabase.from('modalidades').insert([dados]).select().single();
      if (error && error.message && error.message.includes('id_evento')) {
        delete dados.id_evento;
        const retry = await supabase.from('modalidades').insert([dados]).select().single();
        data = retry.data;
        error = retry.error;
      }
      if (error) throw error;

      exibirNotificacao('Modalidade cadastrada com sucesso!');
      setNovoCodigo('');
      setNovoNome('');
      setNovoNivel('Médio/Técnico');
      setNovoAreaTematica('');
      setNovoDescricao('');
      setMostrarFormNovo(false);
      await carregarModalidades();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao cadastrar modalidade:', err);
      setMensagemErro(`Falha ao cadastrar modalidade: ${err?.message || 'Erro no banco'}`);
    } finally {
      setSalvandoManual(false);
    }
  };

  // Edição
  const handleAbrirEdicao = (m: ModalidadeItem) => {
    setModalidadeEmEdicao({ ...m });
    setModalEdicaoAberto(true);
  };

  const handleSalvarEdicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalidadeEmEdicao || !modalidadeEmEdicao.nome_modalidade.trim()) {
      setMensagemErro('O nome da modalidade não pode ficar vazio.');
      return;
    }

    setSalvandoEdicao(true);
    setMensagemErro(null);

    const dados = {
      codigo: modalidadeEmEdicao.codigo?.trim() || null,
      nome_modalidade: modalidadeEmEdicao.nome_modalidade.trim(),
      nivel: modalidadeEmEdicao.nivel?.trim() || null,
      area_tematica: modalidadeEmEdicao.area_tematica?.trim() || null,
      descricao: modalidadeEmEdicao.descricao?.trim() || null,
    };

    if (!conexaoBanco) {
      setModalidades((prev) =>
        prev.map((item) =>
          item.id_modalidade === modalidadeEmEdicao.id_modalidade ? { ...item, ...dados } : item
        )
      );
      setModalEdicaoAberto(false);
      setModalidadeEmEdicao(null);
      setSalvandoEdicao(false);
      exibirNotificacao('Modalidade atualizada (modo contingência).');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    try {
      const { error } = await supabase
        .from('modalidades')
        .update(dados)
        .eq('id_modalidade', modalidadeEmEdicao.id_modalidade);

      if (error) throw error;

      exibirNotificacao('Modalidade atualizada com sucesso!');
      setModalEdicaoAberto(false);
      setModalidadeEmEdicao(null);
      await carregarModalidades();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao atualizar modalidade:', err);
      setMensagemErro(`Falha ao atualizar: ${err?.message || 'Erro no banco'}`);
    } finally {
      setSalvandoEdicao(false);
    }
  };

  // Exclusão
  const handleExcluirModalidade = async (id: string, nome: string) => {
    if (!window.confirm(`Tem certeza que deseja excluir a modalidade "${nome}"?`)) {
      return;
    }

    if (!conexaoBanco) {
      setModalidades((prev) => prev.filter((m) => m.id_modalidade !== id));
      exibirNotificacao('Modalidade removida (modo contingência).');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    try {
      const { error } = await supabase.from('modalidades').delete().eq('id_modalidade', id);
      if (error) throw error;

      exibirNotificacao('Modalidade excluída com sucesso!');
      await carregarModalidades();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao excluir modalidade:', err);
      setMensagemErro(`Erro ao excluir: ${err.message || 'Pode haver projetos vinculados'}`);
    }
  };

  // Baixar Planilha Modelo (.xlsx)
  const baixarPlanilhaExemplo = async () => {
    try {
      const dadosExemplo = [
        {
          'Código': 'MOD-EM',
          'Modalidade': 'Ensino Médio e Técnico',
          'Nível': 'Médio',
          'Área Temática': 'Ciências Exatas e da Terra',
          'Descrição': 'Projetos de alunos do ensino médio e cursos técnicos integrados',
        },
        {
          'Código': 'MOD-EF',
          'Modalidade': 'Ensino Fundamental II',
          'Nível': 'Fundamental',
          'Área Temática': 'Multidisciplinar',
          'Descrição': 'Estudantes do 6º ao 9º ano do ensino fundamental',
        },
        {
          'Código': 'MOD-SUP',
          'Modalidade': 'Ensino Superior / Graduação',
          'Nível': 'Superior',
          'Área Temática': 'Engenharias e Tecnologias',
          'Descrição': 'Trabalhos acadêmicos de graduação e iniciação científica',
        },
      ];

      const colunas = ['Código', 'Modalidade', 'Nível', 'Área Temática', 'Descrição'];
      await baixarPlanilhaModelo('modelo_importacao_modalidades.xlsx', 'Modalidades', colunas, dadosExemplo);
      exibirNotificacao('Planilha modelo de modalidades (.xlsx) gerada e baixada com sucesso!');
    } catch (err: any) {
      console.error('Erro ao gerar modelo:', err);
      setMensagemErro('Falha ao baixar planilha modelo.');
    }
  };

  // Upload e Validação com De-Para
  const handleUploadArquivo = async (file: File) => {
    setProcessandoArquivo(true);
    setMensagemErro(null);
    setLogsImportacao([]);

    const validacao = validarArquivoPlanilha(file);
    if (!validacao.valido) {
      adicionarLog('error', validacao.erro || 'Arquivo inválido.');
      setMensagemErro(validacao.erro || 'Arquivo inválido.');
      setProcessandoArquivo(false);
      return;
    }

    adicionarLog('info', `Iniciando leitura do arquivo: ${file.name}`);

    try {
      const isCSV = validacao.isCSV;
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          if (!e.target?.result) {
            adicionarLog('error', 'Falha ao carregar conteúdo do arquivo.');
            setProcessandoArquivo(false);
            return;
          }

          const resultado = await parsePlanilhaModalidades(e.target.result as ArrayBuffer | string, isCSV);

          if (!resultado.sucesso || resultado.modalidades.length === 0) {
            adicionarLog('error', 'Nenhuma modalidade válida encontrada na planilha.');
            setMensagemErro('Nenhuma modalidade válida encontrada na planilha.');
            setProcessandoArquivo(false);
            return;
          }

          adicionarLog('info', `Planilha lida! ${resultado.modalidades.length} linhas identificadas.`);

          // 1. Busca candidatos de modalidades existentes e seus aliases
          let candidatosModalidades: CandidatoMatch[] = modalidades.map((m) => ({
            id: m.id_modalidade,
            nome: m.nome_modalidade,
            sigla: m.codigo,
            aliases: [],
          }));

          if (conexaoBanco) {
            try {
              const { data: aliasesData } = await supabase.from('modalidade_aliases').select('id_modalidade, alias');
              if (aliasesData) {
                const aliasMap = new Map<string, string[]>();
                aliasesData.forEach((a: any) => {
                  const list = aliasMap.get(a.id_modalidade) || [];
                  list.push(a.alias);
                  aliasMap.set(a.id_modalidade, list);
                });

                candidatosModalidades = candidatosModalidades.map((c) => ({
                  ...c,
                  aliases: aliasMap.get(c.id) || [],
                }));
              }
            } catch (eAlias) {
              console.warn('Erro ao carregar aliases:', eAlias);
            }
          }

          // 2. Extrai termos únicos da planilha e avalia matches com threshold de 85%
          const termosUnicos = Array.from(new Set(resultado.modalidades.map((m) => m.nome_modalidade.trim())));
          const itensParaDePara: ItemMapeamentoDePara[] = [];
          let precisaDePara = false;

          termosUnicos.forEach((termo) => {
            const matchRes = buscarMelhorCorrespondencia(termo, candidatosModalidades, 0.85);

            if (matchRes.matchTipo !== 'exato') {
              precisaDePara = true;
            }

            itensParaDePara.push({
              id_termo: termo,
              termo_original: termo,
              tipo: 'modalidade',
              sugestao_id: matchRes.candidato?.id || null,
              sugestao_nome: matchRes.candidato?.nome || null,
              confianca_percentual: matchRes.confiancaPercentual,
              match_tipo: matchRes.matchTipo,
            });
          });

          setLinhasArquivoPendente(resultado.modalidades);

          // Se houver termos fuzzy ou não exatos, aciona o Modal de De-Para
          if (precisaDePara && itensParaDePara.length > 0) {
            adicionarLog('info', 'Termos novos ou com correspondência fuzzy identificados. Abrindo tela de De-Para...');
            setItensDePara(itensParaDePara);
            setModalDeParaAberto(true);
            setProcessandoArquivo(false);
          } else {
            // Importação direta caso todos sejam 100% exatos ou já mapeados
            await executarGravacaoEmLote(resultado.modalidades, new Map());
          }
        } catch (errParsing: any) {
          console.error('Erro no processamento da planilha:', errParsing);
          adicionarLog('error', `Erro no parsing: ${errParsing.message}`);
          setMensagemErro(`Erro no processamento: ${errParsing.message}`);
          setProcessandoArquivo(false);
        }
      };

      if (isCSV) {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    } catch (errUpload: any) {
      console.error('Erro no upload:', errUpload);
      setMensagemErro('Falha ao ler o arquivo.');
      setProcessandoArquivo(false);
    }
  };

  // Gravação em lote com decisões de De-Para
  const executarGravacaoEmLote = async (
    linhas: ModalidadeImportada[],
    decisoes: Map<string, DecisaoMapeamento>
  ) => {
    if (conexaoBanco && !(await garantirSessaoAdmin())) return;
    setProcessandoArquivo(true);
    try {
      const idEvt = id_evento_ativo || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || null;
      const modalidadesParaSalvar: any[] = [];

      linhas.forEach((linha) => {
        const decisao = decisoes.get(linha.nome_modalidade);

        // Se o usuário optou por associar a uma existente no De-Para, ignora criação duplicada
        if (decisao && decisao.acao === 'associar_existente') {
          return;
        }

        const objMod: any = {
          codigo: linha.codigo || null,
          nome_modalidade: linha.nome_modalidade,
          nivel: linha.nivel || null,
          area_tematica: linha.area_tematica || null,
          descricao: linha.descricao || null,
        };
        if (idEvt) objMod.id_evento = idEvt;
        modalidadesParaSalvar.push(objMod);
      });

      if (modalidadesParaSalvar.length === 0) {
        adicionarLog('success', 'Todos os termos foram associados a modalidades já existentes. Nenhuma duplicata inserida.');
        exibirNotificacao('Mapeamento concluído com sucesso!');
        setModalDeParaAberto(false);
        setProcessandoArquivo(false);
        return;
      }

      if (conexaoBanco) {
        let { error } = await supabase.from('modalidades').insert(modalidadesParaSalvar);
        if (error && error.message && error.message.includes('id_evento')) {
          const semEvento = modalidadesParaSalvar.map(({ id_evento, ...resto }) => resto);
          const retry = await supabase.from('modalidades').insert(semEvento);
          error = retry.error;
        }
        if (error) throw error;

        adicionarLog('success', `${modalidadesParaSalvar.length} modalidade(s) cadastrada(s) com sucesso no banco.`);
        exibirNotificacao(`${modalidadesParaSalvar.length} modalidade(s) importada(s) com sucesso!`);
        await carregarModalidades();
        if (aoAtualizarMetricas) aoAtualizarMetricas();
      } else {
        modalidadesParaSalvar.forEach((m) => {
          setModalidades((prev) => [
            {
              id_modalidade: crypto.randomUUID(),
              ...m,
            },
            ...prev,
          ]);
        });
        adicionarLog('success', `${modalidadesParaSalvar.length} modalidade(s) inserida(s) em contingência.`);
        exibirNotificacao('Importação concluída (modo contingência)!');
      }

      setModalDeParaAberto(false);
    } catch (err: any) {
      console.error('Erro ao gravar modalidades:', err);
      const msgErro = tratarErroEscritaAdmin(err);
      adicionarLog('error', `Falha ao persistir: ${msgErro}`);
      setMensagemErro(`Erro ao gravar: ${msgErro}`);
    } finally {
      setProcessandoArquivo(false);
    }
  };

  // Alternar ordenação
  const alternarOrdenacao = (coluna: 'codigo' | 'nome_modalidade' | 'nivel' | 'area_tematica') => {
    if (colunaOrdenacao === coluna) {
      setOrdemAscendente(!ordemAscendente);
    } else {
      setColunaOrdenacao(coluna);
      setOrdemAscendente(true);
    }
  };

  const renderIconeOrdenacao = (coluna: 'codigo' | 'nome_modalidade' | 'nivel' | 'area_tematica') => {
    if (colunaOrdenacao !== coluna) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-40 hover:opacity-100 transition-opacity ml-1 inline-block shrink-0" />;
    }
    return ordemAscendente ? (
      <ArrowUp className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 ml-1 inline-block shrink-0" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 ml-1 inline-block shrink-0" />
    );
  };

  // Filtragem e ordenação
  const modalidadesFiltradas = modalidades.filter((m) => {
    if (!termoBusca.trim()) return true;
    const t = termoBusca.toLowerCase();
    return (
      (m.nome_modalidade && m.nome_modalidade.toLowerCase().includes(t)) ||
      (m.codigo && m.codigo.toLowerCase().includes(t)) ||
      (m.nivel && m.nivel.toLowerCase().includes(t)) ||
      (m.area_tematica && m.area_tematica.toLowerCase().includes(t))
    );
  });

  const modalidadesOrdenadas = [...modalidadesFiltradas].sort((a, b) => {
    let valA = a[colunaOrdenacao] || '';
    let valB = b[colunaOrdenacao] || '';
    const comp = String(valA).localeCompare(String(valB), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return ordemAscendente ? comp : -comp;
  });

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans w-full h-full overflow-y-auto">
      {/* Toast Notification */}
      {mensagemNotificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-purple-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagemNotificacao}</span>
        </div>
      )}

      {/* Alerta de erro */}
      {mensagemErro && (
        <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl flex items-center justify-between gap-3 text-xs sm:text-sm text-red-800 dark:text-red-200 font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensagemErro(null)}
            className="text-xs text-red-600 dark:text-red-300 underline font-bold cursor-pointer"
          >
            Dispensar
          </button>
        </div>
      )}

      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-purple-100 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              Gestor de Modalidades e Níveis
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={inputFileRef}
            type="file"
            accept=".csv, .xlsx"
            className="hidden"
            disabled={processandoArquivo}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleUploadArquivo(e.target.files[0]);
              }
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={baixarPlanilhaExemplo}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer"
            title="Baixar Planilha Modelo (.xlsx)"
          >
            <Download className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span>Baixar Modelo (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={() => inputFileRef.current?.click()}
            disabled={processandoArquivo}
            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
            title="Importar (.xlsx/.csv)"
          >
            {processandoArquivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{processandoArquivo ? 'Processando...' : 'Importar (.xlsx/.csv)'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMostrarFormNovo(!mostrarFormNovo)}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nova Modalidade
          </button>

          <button
            type="button"
            onClick={carregarModalidades}
            disabled={carregando}
            title="Recarregar Lista"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-purple-600' : ''}`} />
          </button>

          {ao_fechar && (
            <button
              type="button"
              onClick={ao_fechar}
              className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              title="Fechar Janela"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Console de Logs da Importação */}
      {(logsImportacao.length > 0 || processandoArquivo) && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2 animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-purple-400">
              <Terminal className="w-4 h-4" />
              <span>Console de Importação de Modalidades</span>
            </div>
            {logsImportacao.length > 0 && !processandoArquivo && (
              <button
                type="button"
                onClick={() => setLogsImportacao([])}
                className="text-[11px] text-slate-400 hover:text-slate-200 underline cursor-pointer lowercase"
              >
                fechar console
              </button>
            )}
          </div>
          <div className="text-slate-200 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1">
            {logsImportacao.map((log, idx) => (
              <div
                key={idx}
                className={`leading-relaxed ${
                  log.tipo === 'success' ? 'text-emerald-400' : log.tipo === 'error' ? 'text-red-400' : 'text-slate-300'
                }`}
              >
                {log.tipo === 'success' && '✓ '}
                {log.tipo === 'error' && '✕ '}
                {log.tipo === 'info' && 'ℹ '}
                {log.mensagem}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulário Retrátil de Nova Modalidade */}
      {mostrarFormNovo && (
        <form
          onSubmit={handleAdicionarManual}
          className="bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 p-4 sm:p-5 rounded-2xl space-y-4 animate-in fade-in"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Cadastrar Nova Modalidade / Nível
            </span>
            <button
              type="button"
              onClick={() => setMostrarFormNovo(false)}
              className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              Cancelar
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="text"
              value={novoCodigo}
              onChange={(e) => setNovoCodigo(e.target.value)}
              placeholder="Código (ex: MOD-EM)"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <input
              type="text"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Nome da Modalidade *"
              className="sm:col-span-2 px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
            <select
              value={novoNivel}
              onChange={(e) => setNovoNivel(e.target.value)}
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="Fundamental">Fundamental</option>
              <option value="Médio">Médio</option>
              <option value="Médio/Técnico">Médio/Técnico</option>
              <option value="Técnico">Técnico</option>
              <option value="Superior">Superior</option>
              <option value="Geral">Geral / Livre</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={novoAreaTematica}
              onChange={(e) => setNovoAreaTematica(e.target.value)}
              placeholder="Área Temática (ex: Ciências Exatas)"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <input
              type="text"
              value={novoDescricao}
              onChange={(e) => setNovoDescricao(e.target.value)}
              placeholder="Descrição ou observações (opcional)"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={salvandoManual || !novoNome.trim()}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              {salvandoManual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Cadastrar Modalidade
            </button>
          </div>
        </form>
      )}

      {/* Barra de Busca e Contador */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={termoBusca}
            onChange={(e) => setTermoBusca(e.target.value)}
            placeholder="Pesquisar por código, modalidade, nível ou área..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 self-end sm:self-center">
          Total: <strong className="text-slate-800 dark:text-slate-200">{modalidadesFiltradas.length}</strong> modalidades
        </span>
      </div>

      {/* Listagem */}
      {carregando ? (
        <div className="p-12 text-center space-y-2 border border-slate-200 dark:border-slate-700 rounded-2xl">
          <Loader2 className="w-8 h-8 text-purple-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">Consultando modalidades...</p>
        </div>
      ) : modalidadesFiltradas.length === 0 ? (
        <div className="p-10 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Nenhuma modalidade localizada.</p>
          <p className="text-[11px] text-slate-400">Utilize o botão "Nova Modalidade" ou a importação por planilha acima.</p>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[640px]">
              <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <th
                    onClick={() => alternarOrdenacao('codigo')}
                    className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors w-28"
                  >
                    <div className="flex items-center gap-1">
                      <span>Código</span>
                      {renderIconeOrdenacao('codigo')}
                    </div>
                  </th>
                  <th
                    onClick={() => alternarOrdenacao('nome_modalidade')}
                    className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Modalidade</span>
                      {renderIconeOrdenacao('nome_modalidade')}
                    </div>
                  </th>
                  <th
                    onClick={() => alternarOrdenacao('nivel')}
                    className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Nível</span>
                      {renderIconeOrdenacao('nivel')}
                    </div>
                  </th>
                  <th
                    onClick={() => alternarOrdenacao('area_tematica')}
                    className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Área Temática</span>
                      {renderIconeOrdenacao('area_tematica')}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {modalidadesOrdenadas.map((mod) => (
                  <tr key={mod.id_modalidade} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3.5 font-mono font-bold text-slate-600 dark:text-slate-300">
                      {mod.codigo || '—'}
                    </td>
                    <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">
                      <div>{mod.nome_modalidade}</div>
                      {mod.descricao && (
                        <div className="text-[11px] font-normal text-slate-400 mt-0.5 line-clamp-1">{mod.descricao}</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                        {mod.nivel || 'Geral'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300">
                      {mod.area_tematica || '—'}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleAbrirEdicao(mod)}
                          title="Editar Modalidade"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExcluirModalidade(mod.id_modalidade, mod.nome_modalidade)}
                          title="Excluir Modalidade"
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 transition-colors cursor-pointer"
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

      {/* Modal de Edição */}
      {modalEdicaoAberto && modalidadeEmEdicao && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-purple-600" />
                Editar Modalidade e Nível
              </h3>
              <button
                type="button"
                onClick={() => {
                  setModalEdicaoAberto(false);
                  setModalidadeEmEdicao(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSalvarEdicao} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Código</label>
                  <input
                    type="text"
                    value={modalidadeEmEdicao.codigo || ''}
                    onChange={(e) =>
                      setModalidadeEmEdicao({ ...modalidadeEmEdicao, codigo: e.target.value })
                    }
                    placeholder="MOD-01"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Modalidade *</label>
                  <input
                    type="text"
                    value={modalidadeEmEdicao.nome_modalidade}
                    onChange={(e) =>
                      setModalidadeEmEdicao({ ...modalidadeEmEdicao, nome_modalidade: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Nível de Ensino</label>
                  <select
                    value={modalidadeEmEdicao.nivel || 'Médio/Técnico'}
                    onChange={(e) =>
                      setModalidadeEmEdicao({ ...modalidadeEmEdicao, nivel: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="Fundamental">Fundamental</option>
                    <option value="Médio">Médio</option>
                    <option value="Médio/Técnico">Médio/Técnico</option>
                    <option value="Técnico">Técnico</option>
                    <option value="Superior">Superior</option>
                    <option value="Geral">Geral / Livre</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Área Temática</label>
                  <input
                    type="text"
                    value={modalidadeEmEdicao.area_tematica || ''}
                    onChange={(e) =>
                      setModalidadeEmEdicao({ ...modalidadeEmEdicao, area_tematica: e.target.value })
                    }
                    placeholder="Área temática"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Descrição</label>
                <textarea
                  rows={2}
                  value={modalidadeEmEdicao.descricao || ''}
                  onChange={(e) =>
                    setModalidadeEmEdicao({ ...modalidadeEmEdicao, descricao: e.target.value })
                  }
                  placeholder="Detalhes ou critérios específicos"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalEdicaoAberto(false);
                    setModalidadeEmEdicao(null);
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoEdicao}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-xs"
                >
                  {salvandoEdicao ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>Salvar Alterações</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal De-Para para Resolução de Duplicidades na Importação */}
      {modalDeParaAberto && (
        <ModalDeParaMapping
          isOpen={modalDeParaAberto}
          itensMapeamento={itensDePara}
          candidatosInstituicoes={[]}
          candidatosModalidades={modalidades.map((m) => ({
            id: m.id_modalidade,
            nome: m.nome_modalidade,
            sigla: m.codigo,
          }))}
          aoConfirmar={async (decisoes) => {
            await executarGravacaoEmLote(linhasArquivoPendente, decisoes);
          }}
          aoCancelar={() => {
            setModalDeParaAberto(false);
            setLinhasArquivoPendente([]);
            adicionarLog('info', 'Importação cancelada pelo usuário.');
          }}
        />
      )}

      {/* Fechar Janela no rodapé */}
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
    </div>
  );
};
