import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardList,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ListOrdered,
  Sparkles,
  ArrowUp,
  ArrowDown,
  UploadCloud,
  Terminal,
  X,
  Pencil,
  Lock,
  History,
  BookCopy,
} from 'lucide-react';
import { lerPlanilhaParaJson, validarArquivoPlanilha } from '@/lib/excel/excelUtils';
import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { normalizarChave } from '@/lib/parsers/planilhaAvaliadoresParser';
import { ModelosQuestionario, type ModeloQuestionario } from './ModelosQuestionario';
import { ReaproveitarQuestionario } from './ReaproveitarQuestionario';

interface ItemPerguntaForm {
  id_temp: string;
  id_pergunta?: string;
  texto_pergunta: string;
  descricao_lembrete: string;
  peso_calculo: number;
  peso_desempate: number;
}

interface QuestionarioSalvo {
  id_questionario: string;
  titulo: string;
  escala_minima: number;
  escala_maxima: number;
  total_perguntas: number;
  id_origem: string | null;
}

let contadorTemp = 0;
const novaPergunta = (parcial: Partial<ItemPerguntaForm> = {}): ItemPerguntaForm => ({
  id_temp: `p-${Date.now()}-${contadorTemp++}`,
  texto_pergunta: '',
  descricao_lembrete: '',
  peso_calculo: 1,
  peso_desempate: 1,
  ...parcial,
});

/** Lê pergunta, lembrete e peso de uma linha da planilha, aceitando variações no nome das colunas. */
export const extrairLinhaPergunta = (linha: Record<string, unknown>): { texto_pergunta: string; descricao_lembrete: string; peso_calculo: number } => {
  let texto = '';
  let lembrete = '';
  let peso = 1;
  Object.keys(linha).forEach((coluna) => {
    const chave = normalizarChave(coluna);
    const valor = String(linha[coluna] ?? '').trim();
    if (chave.includes('lembrete') || chave.includes('descricao') || chave.includes('orientacao') || chave.includes('ajuda')) {
      lembrete = valor;
    } else if (chave.includes('peso')) {
      const p = parseFloat(valor.replace(',', '.'));
      if (!isNaN(p) && p > 0) peso = p;
    } else if (chave.includes('pergunta') || chave.includes('criterio') || chave.includes('texto') || chave === 'item' || chave === 'titulo') {
      texto = valor;
    }
  });
  return { texto_pergunta: texto, descricao_lembrete: lembrete, peso_calculo: peso };
};

export const GestorQuestionarios: React.FC<{
  id_evento_ativo?: string;
  aoAtualizarMetricas?: () => void;
  aoFechar?: () => void;
}> = ({ id_evento_ativo, aoAtualizarMetricas, aoFechar }) => {
  const idEvento = id_evento_ativo || '';

  const [titulo_questionario, set_titulo_questionario] = useState<string>('');
  const [escala_minima, set_escala_minima] = useState<number>(0);
  const [escala_maxima, set_escala_maxima] = useState<number>(10);
  const [perguntas_lista, set_perguntas_lista] = useState<ItemPerguntaForm[]>([novaPergunta()]);
  const [idQuestionarioEdicao, setIdQuestionarioEdicao] = useState<string | null>(null);
  const [usos_em_edicao, set_usos_em_edicao] = useState<number>(0);

  const [questionarios_salvos, set_questionarios_salvos] = useState<QuestionarioSalvo[]>([]);
  const [carregando_lista, set_carregando_lista] = useState<boolean>(true);
  const [salvando, set_salvando] = useState<boolean>(false);
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [erroQuest, setErroQuest] = useState<string | null>(null);

  const [questionario_para_excluir, set_questionario_para_excluir] = useState<QuestionarioSalvo | null>(null);
  const [excluindo, set_excluindo] = useState<boolean>(false);
  const [mostrar_reaproveitar, set_mostrar_reaproveitar] = useState<boolean>(false);
  // Formulário no modo modelo: null = questionário do evento; id_modelo null = modelo novo
  const [modelo_edicao, set_modelo_edicao] = useState<{ id_modelo: string | null; titulo: string } | null>(null);
  const [descricao_modelo, set_descricao_modelo] = useState<string>('');
  const [versao_modelos, set_versao_modelos] = useState<number>(0);
  const form_ref = useRef<HTMLFormElement | null>(null);

  const input_file_ref = useRef<HTMLInputElement | null>(null);
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [logs_importacao, set_logs_importacao] = useState<{ tipo: 'info' | 'success' | 'error'; mensagem: string }[]>([]);
  const [importacao_pendente, set_importacao_pendente] = useState<{ perguntas: ItemPerguntaForm[]; titulo: string } | null>(null);

  const somenteTitulo = Boolean(idQuestionarioEdicao) && usos_em_edicao > 0;

  const adicionarLog = (tipo: 'info' | 'success' | 'error', mensagem: string) => {
    set_logs_importacao((prev) => [...prev, { tipo, mensagem }]);
  };

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => set_mensagem_notificacao(null), 3500);
  };

  const limpar_formulario = () => {
    set_modelo_edicao(null);
    set_descricao_modelo('');
    setIdQuestionarioEdicao(null);
    set_usos_em_edicao(0);
    set_titulo_questionario('');
    set_escala_minima(0);
    set_escala_maxima(10);
    set_perguntas_lista([novaPergunta()]);
  };

  const carregar_questionarios_existentes = useCallback(async () => {
    if (!idEvento) {
      set_questionarios_salvos([]);
      set_carregando_lista(false);
      return;
    }
    set_carregando_lista(true);
    try {
      const { data, error } = await supabase
        .from('questionarios')
        .select('id_questionario, titulo, escala_minima, escala_maxima, id_origem, perguntas_questionario(count)')
        .eq('id_evento', idEvento)
        .order('titulo', { ascending: true });
      if (error) throw error;
      set_questionarios_salvos(
        (data || []).map((q: any) => ({
          id_questionario: q.id_questionario,
          titulo: q.titulo,
          escala_minima: Number(q.escala_minima ?? 0),
          escala_maxima: Number(q.escala_maxima ?? 10),
          total_perguntas: q.perguntas_questionario?.[0]?.count ?? 0,
          id_origem: q.id_origem ?? null,
        }))
      );
    } catch (err) {
      console.error('Erro ao buscar questionários:', err);
      setErroQuest(`Não foi possível carregar os questionários: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      set_carregando_lista(false);
    }
  }, [idEvento]);

  useEffect(() => {
    carregar_questionarios_existentes();
  }, [carregar_questionarios_existentes]);

  const rolar_ate_formulario = () => form_ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  const handleNovoModelo = () => {
    limpar_formulario();
    set_modelo_edicao({ id_modelo: null, titulo: '' });
    set_escala_minima(1);
    set_escala_maxima(5);
    setErroQuest(null);
    rolar_ate_formulario();
  };

  const handleEditarModelo = async (modelo: ModeloQuestionario) => {
    setErroQuest(null);
    const { data: pergs, error } = await supabase
      .from('perguntas_modelo_questionario')
      .select('ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate')
      .eq('id_modelo', modelo.id_modelo)
      .order('ordem', { ascending: true });
    if (error) {
      setErroQuest(`Não foi possível abrir o modelo: ${tratarErroEscritaAdmin(error)}`);
      return;
    }
    limpar_formulario();
    set_modelo_edicao({ id_modelo: modelo.id_modelo, titulo: modelo.titulo });
    set_descricao_modelo(modelo.descricao || '');
    set_titulo_questionario(modelo.titulo);
    set_escala_minima(modelo.escala_minima);
    set_escala_maxima(modelo.escala_maxima);
    set_perguntas_lista(
      (pergs || []).length > 0
        ? (pergs || []).map((p: any) =>
            novaPergunta({
              texto_pergunta: p.texto_pergunta || '',
              descricao_lembrete: p.descricao_lembrete || '',
              peso_calculo: Number(p.peso_calculo ?? 1),
              peso_desempate: Number(p.peso_desempate ?? 1),
            })
          )
        : [novaPergunta()]
    );
    rolar_ate_formulario();
  };

  const salvar_como_modelo = async (quest: QuestionarioSalvo) => {
    if (!(await garantirSessaoAdmin())) return;
    setErroQuest(null);
    const { error } = await supabase.rpc('admin_salvar_questionario_como_modelo', { p_id_questionario: quest.id_questionario });
    if (error) {
      setErroQuest(`Não foi possível salvar "${quest.titulo}" como modelo: ${tratarErroEscritaAdmin(error)}`);
      return;
    }
    exibir_notificacao(`"${quest.titulo}" agora também é um questionário pronto.`);
    set_versao_modelos((v) => v + 1);
    await carregar_questionarios_existentes();
  };

  const salvar_modelo = async () => {
    if (!modelo_edicao || !(await garantirSessaoAdmin())) return;
    set_salvando(true);
    try {
      const { data, error } = await supabase.rpc('admin_salvar_modelo_questionario', {
        p_id_modelo: modelo_edicao.id_modelo,
        p_titulo: titulo_questionario.trim(),
        p_descricao: descricao_modelo.trim(),
        p_escala_minima: Number(escala_minima),
        p_escala_maxima: Number(escala_maxima),
        p_perguntas: perguntas_lista.map((p) => ({
          texto_pergunta: p.texto_pergunta.trim(),
          descricao_lembrete: p.descricao_lembrete.trim(),
          peso_calculo: Number(p.peso_calculo),
          peso_desempate: Number(p.peso_desempate),
        })),
      });
      if (error) {
        setErroQuest(`Não foi possível salvar o modelo: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      const resultado = (data || {}) as { copia?: string; usos?: number };
      const titulo = titulo_questionario.trim();
      exibir_notificacao(
        resultado.copia === 'atualizada'
          ? `Modelo "${titulo}" salvo. A cópia ativa neste evento também foi atualizada.`
          : resultado.copia === 'em_uso'
            ? `Modelo "${titulo}" salvo. A cópia deste evento já foi usada em ${resultado.usos} avaliação(ões) e não foi alterada.`
            : modelo_edicao.id_modelo
              ? `Modelo "${titulo}" salvo.`
              : `Modelo "${titulo}" criado com ${perguntas_lista.length} pergunta(s).`
      );
      limpar_formulario();
      set_versao_modelos((v) => v + 1);
      await carregar_questionarios_existentes();
      aoAtualizarMetricas?.();
    } finally {
      set_salvando(false);
    }
  };

  const handleEditarQuestionario = async (quest: QuestionarioSalvo) => {
    setErroQuest(null);
    set_modelo_edicao(null);
    set_descricao_modelo('');
    const [{ data: pergs, error }, { data: usos }] = await Promise.all([
      supabase
        .from('perguntas_questionario')
        .select('id_pergunta, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate')
        .eq('id_questionario', quest.id_questionario)
        .order('ordem', { ascending: true }),
      supabase.rpc('fn_avaliacoes_do_questionario', { p_id_questionario: quest.id_questionario }),
    ]);
    if (error) {
      setErroQuest(`Não foi possível abrir o questionário: ${tratarErroEscritaAdmin(error)}`);
      return;
    }
    setIdQuestionarioEdicao(quest.id_questionario);
    set_usos_em_edicao(Number(usos) || 0);
    rolar_ate_formulario();
    set_titulo_questionario(quest.titulo);
    set_escala_minima(quest.escala_minima);
    set_escala_maxima(quest.escala_maxima);
    set_perguntas_lista(
      (pergs || []).length > 0
        ? (pergs || []).map((p: any) =>
            novaPergunta({
              id_pergunta: p.id_pergunta,
              texto_pergunta: p.texto_pergunta || '',
              descricao_lembrete: p.descricao_lembrete || '',
              peso_calculo: Number(p.peso_calculo ?? 1),
              peso_desempate: Number(p.peso_desempate ?? 1),
            })
          )
        : [novaPergunta()]
    );
  };

  const confirmar_exclusao = async () => {
    const alvo = questionario_para_excluir;
    if (!alvo) return;
    if (!(await garantirSessaoAdmin())) return;
    set_excluindo(true);
    setErroQuest(null);
    try {
      const { error } = await supabase.rpc('admin_excluir_questionario', { p_id_questionario: alvo.id_questionario });
      set_questionario_para_excluir(null);
      if (error) {
        setErroQuest(`Não foi possível excluir "${alvo.titulo}": ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      set_questionarios_salvos((prev) => prev.filter((q) => q.id_questionario !== alvo.id_questionario));
      if (idQuestionarioEdicao === alvo.id_questionario) limpar_formulario();
      exibir_notificacao(`Questionário "${alvo.titulo}" excluído.`);
      aoAtualizarMetricas?.();
    } finally {
      set_excluindo(false);
    }
  };

  const remover_pergunta = (id_temp: string) => {
    if (perguntas_lista.length <= 1) {
      setErroQuest('O questionário precisa de pelo menos uma pergunta.');
      return;
    }
    set_perguntas_lista((lista) => lista.filter((p) => p.id_temp !== id_temp));
  };

  const atualizar_campo_pergunta = (id_temp: string, campo: keyof ItemPerguntaForm, valor: string | number) => {
    set_perguntas_lista((anterior) => anterior.map((item) => (item.id_temp === id_temp ? { ...item, [campo]: valor } : item)));
  };

  const mover_pergunta = (index: number, direcao: 'cima' | 'baixo') => {
    const destino = direcao === 'cima' ? index - 1 : index + 1;
    if (destino < 0 || destino >= perguntas_lista.length) return;
    const nova_lista = [...perguntas_lista];
    [nova_lista[index], nova_lista[destino]] = [nova_lista[destino], nova_lista[index]];
    set_perguntas_lista(nova_lista);
  };

  const salvar_questionario_completo = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroQuest(null);
    if (!titulo_questionario.trim()) {
      setErroQuest('Informe o título do questionário.');
      return;
    }
    if (perguntas_lista.some((p) => !p.texto_pergunta.trim())) {
      setErroQuest('Preencha o texto de todas as perguntas.');
      return;
    }
    if (!(Number(escala_minima) < Number(escala_maxima))) {
      setErroQuest('A escala mínima precisa ser menor que a máxima.');
      return;
    }
    if (modelo_edicao) {
      await salvar_modelo();
      return;
    }
    if (!idQuestionarioEdicao && !idEvento) {
      setErroQuest('Não há evento ativo para vincular o questionário.');
      return;
    }
    if (!(await garantirSessaoAdmin())) return;

    set_salvando(true);
    try {
      const { error } = await supabase.rpc('admin_salvar_questionario', {
        p_id_questionario: idQuestionarioEdicao,
        p_id_evento: idEvento || null,
        p_titulo: titulo_questionario.trim(),
        p_escala_minima: Number(escala_minima),
        p_escala_maxima: Number(escala_maxima),
        p_perguntas: perguntas_lista.map((p) => ({
          id_pergunta: p.id_pergunta ?? null,
          texto_pergunta: p.texto_pergunta.trim(),
          descricao_lembrete: p.descricao_lembrete.trim(),
          peso_calculo: Number(p.peso_calculo),
          peso_desempate: Number(p.peso_desempate),
        })),
      });
      if (error) {
        setErroQuest(`Não foi possível salvar o questionário: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      exibir_notificacao(
        idQuestionarioEdicao
          ? `Questionário "${titulo_questionario.trim()}" atualizado.`
          : `Questionário "${titulo_questionario.trim()}" cadastrado com ${perguntas_lista.length} pergunta(s).`
      );
      limpar_formulario();
      await carregar_questionarios_existentes();
      aoAtualizarMetricas?.();
    } finally {
      set_salvando(false);
    }
  };

  // Importação: lê as perguntas e deixa o Admin escolher entre anexar ou começar um novo questionário
  const handle_upload_questionarios = async (file: File) => {
    setErroQuest(null);
    set_logs_importacao([]);

    const validacao = validarArquivoPlanilha(file);
    if (!validacao.valido) {
      adicionarLog('error', validacao.erro || 'Arquivo inválido.');
      setErroQuest(validacao.erro || 'Arquivo inválido.');
      return;
    }

    set_processando_arquivo(true);
    adicionarLog('info', `Lendo o arquivo ${file.name}...`);

    const reader = new FileReader();
    reader.onerror = () => {
      adicionarLog('error', 'Não foi possível ler o arquivo.');
      set_processando_arquivo(false);
    };
    reader.onload = async (e) => {
      try {
        const conteudo = e.target?.result;
        if (!conteudo) {
          adicionarLog('error', 'Arquivo vazio.');
          return;
        }
        const linhas = await lerPlanilhaParaJson(conteudo as string | ArrayBuffer, validacao.isCSV);
        const perguntas: ItemPerguntaForm[] = [];
        linhas.forEach((linha: Record<string, unknown>, indice: number) => {
          const item = extrairLinhaPergunta(linha);
          if (!item.texto_pergunta) {
            adicionarLog('error', `Linha ${indice + 2}: pergunta não encontrada, ignorada.`);
            return;
          }
          perguntas.push(novaPergunta({ ...item, peso_desempate: perguntas.length + 1 }));
        });
        if (perguntas.length === 0) {
          adicionarLog('error', 'Nenhuma pergunta válida na planilha.');
          setErroQuest('Nenhuma pergunta válida na planilha. Use uma coluna "pergunta" (e, se quiser, "lembrete" e "peso").');
          return;
        }
        adicionarLog('info', `${perguntas.length} pergunta(s) lida(s).`);
        const titulo = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
        const formularioVazio = !titulo_questionario.trim() && perguntas_lista.every((p) => !p.texto_pergunta.trim());
        if (formularioVazio || somenteTitulo) {
          aplicar_importacao({ perguntas, titulo }, 'novo');
        } else {
          set_importacao_pendente({ perguntas, titulo });
        }
      } catch (errParsing) {
        const msg = errParsing instanceof Error ? errParsing.message : String(errParsing);
        adicionarLog('error', `Erro ao ler a planilha: ${msg}`);
        setErroQuest(`Erro ao processar a planilha: ${msg}`);
      } finally {
        set_processando_arquivo(false);
      }
    };
    if (validacao.isCSV) reader.readAsText(file, 'UTF-8');
    else reader.readAsArrayBuffer(file);
  };

  const aplicar_importacao = (importacao: { perguntas: ItemPerguntaForm[]; titulo: string }, modo: 'anexar' | 'novo') => {
    set_importacao_pendente(null);
    if (modo === 'anexar') {
      set_perguntas_lista((prev) => [...prev.filter((p) => p.texto_pergunta.trim()), ...importacao.perguntas]);
      adicionarLog('success', `${importacao.perguntas.length} pergunta(s) anexada(s). Confira e clique em salvar.`);
    } else {
      limpar_formulario();
      set_titulo_questionario(importacao.titulo);
      set_perguntas_lista(importacao.perguntas);
      adicionarLog('success', `Novo questionário "${importacao.titulo}" preparado. Confira e clique em salvar.`);
    }
  };

  const classeCampo =
    'w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-8 font-sans">
      {mensagem_notificacao && (
        <div role="status" className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 shadow-xs">
            <ClipboardList className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            Gestor de Questionários
            <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
              {questionarios_salvos.length} {questionarios_salvos.length === 1 ? 'questionário' : 'questionários'}
            </span>
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={input_file_ref}
            type="file"
            accept=".csv, .xlsx"
            className="hidden"
            aria-label="Arquivo de perguntas (.xlsx ou .csv)"
            disabled={processando_arquivo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handle_upload_questionarios(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => input_file_ref.current?.click()}
            disabled={processando_arquivo}
            className="px-3.5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
          >
            {processando_arquivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{processando_arquivo ? 'Processando planilha...' : 'Importar (.xlsx/.csv)'}</span>
          </button>
          <button
            type="button"
            onClick={() => set_mostrar_reaproveitar(true)}
            disabled={!idEvento}
            className="px-3.5 py-2.5 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
          >
            <History className="w-4 h-4" />
            <span>Reaproveitar de eventos anteriores</span>
          </button>
          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              title="Fechar"
              className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {!idEvento && (
        <div role="alert" className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs sm:text-sm text-amber-800 dark:text-amber-200 font-semibold">
          Não há evento ativo. Os questionários são de cada evento: ative um evento para gerenciá-los.
        </div>
      )}

      {(logs_importacao.length > 0 || processando_arquivo) && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-violet-400">
              <Terminal className="w-4 h-4" />
              <span>Resultado da importação</span>
            </div>
            {logs_importacao.length > 0 && !processando_arquivo && (
              <button type="button" onClick={() => set_logs_importacao([])} className="text-[11px] text-slate-400 hover:text-slate-200 underline cursor-pointer lowercase">
                fechar
              </button>
            )}
          </div>
          <ul aria-label="Resultado da importação" className="text-slate-200 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1">
            {logs_importacao.map((log, idx) => (
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

      {idEvento && (
        <ModelosQuestionario
          idEvento={idEvento}
          ativos={questionarios_salvos}
          versao={versao_modelos}
          idModeloEmEdicao={modelo_edicao?.id_modelo ?? null}
          aoEditar={handleEditarModelo}
          aoNovo={handleNovoModelo}
          aoAlterarModelos={carregar_questionarios_existentes}
          aoAviso={exibir_notificacao}
          aoAtivar={async () => {
            await carregar_questionarios_existentes();
            aoAtualizarMetricas?.();
          }}
          aoDesativar={(copia) => {
            const alvo = questionarios_salvos.find((q) => q.id_questionario === copia.id_questionario);
            if (alvo) set_questionario_para_excluir(alvo);
          }}
          aoErro={setErroQuest}
        />
      )}

      <form
        ref={form_ref}
        onSubmit={salvar_questionario_completo}
        aria-label={
          modelo_edicao
            ? modelo_edicao.id_modelo
              ? 'Editar modelo'
              : 'Novo modelo'
            : idQuestionarioEdicao
              ? 'Editar questionário'
              : 'Novo questionário'
        }
        className="space-y-6 scroll-mt-4"
      >
        {modelo_edicao && (
          <div className="p-4 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-xs text-violet-900 dark:text-violet-200 flex items-start gap-2">
            <BookCopy className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {modelo_edicao.id_modelo
                ? `Editando o modelo "${modelo_edicao.titulo}". Se ele estiver ativo neste evento e a cópia ainda não tiver sido usada em avaliação, a cópia também será atualizada.`
                : 'Novo questionário pronto (modelo). Depois de salvo, ative-o no evento pelo interruptor.'}
            </span>
          </div>
        )}

        {erroQuest && (
          <div role="alert" className="p-4 text-white bg-red-600 rounded-xl font-medium shadow-sm flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              {erroQuest}
            </span>
            <button type="button" onClick={() => setErroQuest(null)} className="text-xs underline font-bold">
              Dispensar
            </button>
          </div>
        )}

        {somenteTitulo && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Este questionário já foi usado em {usos_em_edicao} avaliação(ões). Só o título pode ser alterado; para mudar
              perguntas, pesos ou escala, crie um questionário novo.
            </span>
          </div>
        )}

        <fieldset className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
          <legend className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 px-1">
            {modelo_edicao ? '1. Dados do modelo' : idQuestionarioEdicao ? '1. Dados do questionário (editando)' : '1. Dados do questionário'}
          </legend>
          <div>
            <label htmlFor="quest-titulo" className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
              Título
            </label>
            <input
              id="quest-titulo"
              type="text"
              value={titulo_questionario}
              onChange={(e) => set_titulo_questionario(e.target.value)}
              placeholder="Ex: Formulário de Pesquisa Aplicada"
              className={classeCampo}
              required
            />
          </div>
          {modelo_edicao && (
            <div>
              <label htmlFor="modelo-descricao" className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Descrição do modelo (opcional)
              </label>
              <textarea
                id="modelo-descricao"
                value={descricao_modelo}
                onChange={(e) => set_descricao_modelo(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Para que tipo de projeto este questionário serve"
                className={classeCampo}
              />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="quest-escala-min" className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Nota mínima
              </label>
              <input
                id="quest-escala-min"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={escala_minima}
                disabled={somenteTitulo}
                onChange={(e) => set_escala_minima(Number(e.target.value))}
                className={classeCampo}
                required
              />
            </div>
            <div>
              <label htmlFor="quest-escala-max" className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Nota máxima
              </label>
              <input
                id="quest-escala-max"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={escala_maxima}
                disabled={somenteTitulo}
                onChange={(e) => set_escala_maxima(Number(e.target.value))}
                className={classeCampo}
                required
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <div className="flex items-center justify-between">
            <legend className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <ListOrdered className="w-4 h-4 text-emerald-600" />
              2. Perguntas (critérios de avaliação)
            </legend>
            <button
              type="button"
              onClick={() => set_perguntas_lista((lista) => [...lista, novaPergunta({ peso_desempate: lista.length + 1 })])}
              disabled={somenteTitulo}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Adicionar Pergunta
            </button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            A nota final de cada avaliação é a média das notas ponderada pelo peso de cada pergunta. No ranking, um empate na
            média é desfeito pela pergunta de prioridade 1, depois a 2, e assim por diante (prioridade 0 fica fora do desempate).
          </p>

          <ol className="space-y-3">
            {perguntas_lista.map((item, index) => {
              const n = index + 1;
              return (
                <li key={item.id_temp} aria-label={`Pergunta ${n}`} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="px-2.5 py-1 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-mono text-xs font-bold rounded-lg shrink-0">
                      Pergunta {n}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => mover_pergunta(index, 'cima')}
                        disabled={index === 0 || somenteTitulo}
                        aria-label={`Mover pergunta ${n} para cima`}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => mover_pergunta(index, 'baixo')}
                        disabled={index === perguntas_lista.length - 1 || somenteTitulo}
                        aria-label={`Mover pergunta ${n} para baixo`}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remover_pergunta(item.id_temp)}
                        disabled={somenteTitulo}
                        aria-label={`Remover pergunta ${n}`}
                        className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor={`${item.id_temp}-texto`} className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                      Texto da pergunta {n}
                    </label>
                    <input
                      id={`${item.id_temp}-texto`}
                      type="text"
                      value={item.texto_pergunta}
                      disabled={somenteTitulo}
                      onChange={(e) => atualizar_campo_pergunta(item.id_temp, 'texto_pergunta', e.target.value)}
                      placeholder="Ex: Domínio da metodologia científica"
                      className={classeCampo}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor={`${item.id_temp}-lembrete`} className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                      Texto de ajuda da pergunta {n} (opcional)
                    </label>
                    <input
                      id={`${item.id_temp}-lembrete`}
                      type="text"
                      value={item.descricao_lembrete}
                      disabled={somenteTitulo}
                      onChange={(e) => atualizar_campo_pergunta(item.id_temp, 'descricao_lembrete', e.target.value)}
                      placeholder="Aparece para o avaliador abaixo da pergunta"
                      className={classeCampo}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`${item.id_temp}-peso`} className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                        Peso da pergunta {n}
                      </label>
                      <input
                        id={`${item.id_temp}-peso`}
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="10"
                        value={item.peso_calculo}
                        disabled={somenteTitulo}
                        onChange={(e) => atualizar_campo_pergunta(item.id_temp, 'peso_calculo', parseFloat(e.target.value))}
                        className={classeCampo}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor={`${item.id_temp}-desempate`} className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                        Prioridade no desempate da pergunta {n}
                      </label>
                      <input
                        id={`${item.id_temp}-desempate`}
                        type="number"
                        min="0"
                        max="50"
                        value={item.peso_desempate}
                        disabled={somenteTitulo}
                        onChange={(e) => atualizar_campo_pergunta(item.id_temp, 'peso_desempate', parseInt(e.target.value, 10))}
                        className={classeCampo}
                        required
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </fieldset>

        <div className="pt-2 flex justify-end gap-2">
          {(idQuestionarioEdicao || modelo_edicao) && (
            <button
              type="button"
              onClick={limpar_formulario}
              className="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Cancelar Edição
            </button>
          )}
          <button
            type="submit"
            disabled={salvando || (!modelo_edicao && !idQuestionarioEdicao && !idEvento)}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center gap-2 shadow-xs"
          >
            {salvando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {modelo_edicao ? 'Salvar Modelo' : idQuestionarioEdicao ? 'Salvar Alterações' : 'Salvar Questionário'}
          </button>
        </div>
      </form>

      <section aria-labelledby="titulo-lista-questionarios" className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-3">
        <h3 id="titulo-lista-questionarios" className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-500" />
          Questionários do evento
        </h3>

        {carregando_lista ? (
          <div className="p-4 text-center">
            <Loader2 className="w-5 h-5 text-emerald-600 animate-spin mx-auto" />
          </div>
        ) : questionarios_salvos.length === 0 ? (
          <p className="text-xs text-slate-500 italic">Nenhum questionário cadastrado neste evento.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {questionarios_salvos.map((quest) => (
              <li key={quest.id_questionario} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-1">
                <h4 className="font-extrabold text-slate-900 dark:text-white leading-snug">{quest.titulo}</h4>
                <p className="text-slate-500 text-[11px]">
                  Notas de {quest.escala_minima} a {quest.escala_maxima} · {quest.total_perguntas} pergunta(s)
                </p>
                <div className="flex gap-2 pt-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleEditarQuestionario(quest)}
                    aria-label={`Editar ${quest.titulo}`}
                    className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => salvar_como_modelo(quest)}
                    aria-label={`Salvar ${quest.titulo} como modelo`}
                    className="px-3 py-1.5 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-lg inline-flex items-center gap-1"
                  >
                    <BookCopy className="w-3.5 h-3.5" /> Salvar como modelo
                  </button>
                  <button
                    type="button"
                    onClick={() => set_questionario_para_excluir(quest)}
                    aria-label={`Excluir ${quest.titulo}`}
                    className="px-3 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {questionario_para_excluir && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titulo-excluir-questionario"
            aria-describedby="texto-excluir-questionario"
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl border border-rose-200 dark:border-rose-900/60 space-y-4"
          >
            <h3 id="titulo-excluir-questionario" className="text-base font-bold text-slate-900 dark:text-white">
              Excluir o questionário "{questionario_para_excluir.titulo}"?
            </h3>
            <p id="texto-excluir-questionario" className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              As perguntas dele também são apagadas. Se ele já foi usado em alguma avaliação, a exclusão é recusada para não
              apagar as notas por critério.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => set_questionario_para_excluir(null)}
                disabled={excluindo}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar_exclusao}
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

      {mostrar_reaproveitar && idEvento && (
        <ReaproveitarQuestionario
          idEvento={idEvento}
          aoCopiar={async () => {
            await carregar_questionarios_existentes();
            aoAtualizarMetricas?.();
          }}
          aoFechar={() => set_mostrar_reaproveitar(false)}
        />
      )}

      {importacao_pendente && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="titulo-importacao-questionario" className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 id="titulo-importacao-questionario" className="text-base font-bold text-slate-900 dark:text-white">
              {importacao_pendente.perguntas.length} pergunta(s) lida(s). O que fazer com elas?
            </h3>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => aplicar_importacao(importacao_pendente, 'anexar')}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
              >
                Anexar ao questionário aberto
              </button>
              <button
                type="button"
                onClick={() => aplicar_importacao(importacao_pendente, 'novo')}
                className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold"
              >
                Começar um questionário novo
              </button>
              <button
                type="button"
                onClick={() => {
                  set_importacao_pendente(null);
                  adicionarLog('info', 'Importação cancelada.');
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
