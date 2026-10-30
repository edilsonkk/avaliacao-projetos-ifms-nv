import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building,
  Plus,
  Edit2,
  Trash2,
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  X,
  Save,
  UploadCloud,
  Terminal,
  Download,
} from 'lucide-react';
import { baixarPlanilhaModelo, lerPlanilhaParaJson, validarArquivoPlanilha } from '@/lib/excel/excelUtils';
import { supabase } from '@/lib/supabase';
import { buscarTodas } from '@/lib/buscarTodas';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { normalizarChave } from '@/lib/parsers/planilhaAvaliadoresParser';
import { CabecalhoOrdenavel, compararNatural } from '@/components/ui/CabecalhoOrdenavel';

interface InstituicaoRegistro {
  id_instituicao: string;
  nome_exibicao: string;
  sigla: string | null;
  campus: string | null;
}

interface ItemInstituicaoRpc {
  nome: string;
  sigla: string;
  campus: string;
}

interface ResultadoSalvarInstituicoes {
  cadastradas: number;
  atualizadas: number;
  ignoradas: { nome: string; motivo: string }[];
}

type ColunaOrdenacao = 'nome_exibicao' | 'sigla' | 'campus';

/** Lê nome, sigla e câmpus de uma linha da planilha, aceitando variações no nome das colunas. */
export const extrairLinhaInstituicao = (linha: Record<string, unknown>): ItemInstituicaoRpc => {
  const item: ItemInstituicaoRpc = { nome: '', sigla: '', campus: '' };
  Object.keys(linha).forEach((coluna) => {
    const chave = normalizarChave(coluna);
    const valor = String(linha[coluna] ?? '').trim();
    if (chave.includes('sigla')) item.sigla = valor.toUpperCase();
    else if (chave.includes('campus') || chave.includes('unidade')) item.campus = valor;
    else if (chave.includes('nome') || chave.includes('instituicao') || chave === 'escola') item.nome = valor;
  });
  return item;
};

/** Traduz a violação do índice único (mesma instituição no evento) para uma mensagem clara. */
const mensagemErro = (erro: unknown) =>
  (erro as { code?: string } | null)?.code === '23505'
    ? 'Já existe uma instituição com esse nome neste evento.'
    : tratarErroEscritaAdmin(erro);

export const GestorInstituicoes: React.FC<{ id_evento_ativo?: string; ao_fechar?: () => void }> = ({ id_evento_ativo, ao_fechar }) => {
  const idEvento = id_evento_ativo || '';
  const [instituicoes, set_instituicoes] = useState<InstituicaoRegistro[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [termo_busca, set_termo_busca] = useState<string>('');

  const [coluna_ordenacao, set_coluna_ordenacao] = useState<ColunaOrdenacao>('nome_exibicao');
  const [ordem_ascendente, set_ordem_ascendente] = useState<boolean>(true);

  const [mostrar_form_novo, set_mostrar_form_novo] = useState<boolean>(false);
  const [novo_nome, set_novo_nome] = useState<string>('');
  const [nova_sigla, set_nova_sigla] = useState<string>('');
  const [novo_campus, set_novo_campus] = useState<string>('');
  const [salvando_novo, set_salvando_novo] = useState<boolean>(false);

  const [instituicao_em_edicao, set_instituicao_em_edicao] = useState<InstituicaoRegistro | null>(null);
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  const [instituicao_para_excluir, set_instituicao_para_excluir] = useState<InstituicaoRegistro | null>(null);
  const [excluindo, set_excluindo] = useState<boolean>(false);

  const input_file_ref = useRef<HTMLInputElement | null>(null);
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [logs_importacao, set_logs_importacao] = useState<{ tipo: 'info' | 'success' | 'error'; mensagem: string }[]>([]);
  const [toast_mensagem, set_toast_mensagem] = useState<string | null>(null);

  const adicionarLog = (tipo: 'info' | 'success' | 'error', mensagem: string) => {
    set_logs_importacao((prev) => [...prev, { tipo, mensagem }]);
  };

  const exibir_toast = (texto: string) => {
    set_toast_mensagem(texto);
    setTimeout(() => set_toast_mensagem(null), 3500);
  };

  const carregar_instituicoes = useCallback(async () => {
    if (!idEvento) {
      set_instituicoes([]);
      set_carregando(false);
      return;
    }
    set_carregando(true);
    try {
      const lista = await buscarTodas<InstituicaoRegistro>(() =>
        supabase
          .from('instituicoes')
          .select('id_instituicao, nome_exibicao, sigla, campus')
          .eq('id_evento', idEvento)
          .order('nome_exibicao', { ascending: true })
          .order('id_instituicao', { ascending: true })
      );
      set_instituicoes(lista);
    } catch (e) {
      console.error('Erro ao carregar instituições:', e);
      set_mensagem_erro(`Não foi possível carregar as instituições: ${tratarErroEscritaAdmin(e)}`);
    } finally {
      set_carregando(false);
    }
  }, [idEvento]);

  useEffect(() => {
    carregar_instituicoes();
  }, [carregar_instituicoes]);

  const salvarInstituicoes = async (itens: ItemInstituicaoRpc[]): Promise<ResultadoSalvarInstituicoes | null> => {
    const { data, error } = await supabase.rpc('admin_salvar_instituicoes', { p_id_evento: idEvento, p_itens: itens });
    if (error) {
      set_mensagem_erro(`Erro ao gravar instituições: ${mensagemErro(error)}`);
      return null;
    }
    const r = (data || {}) as Partial<ResultadoSalvarInstituicoes>;
    return { cadastradas: r.cadastradas ?? 0, atualizadas: r.atualizadas ?? 0, ignoradas: r.ignoradas ?? [] };
  };

  const handle_adicionar_instituicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novo_nome.trim()) return;
    if (!(await garantirSessaoAdmin())) return;
    set_salvando_novo(true);
    set_mensagem_erro(null);
    try {
      const resultado = await salvarInstituicoes([{ nome: novo_nome.trim(), sigla: nova_sigla.trim(), campus: novo_campus.trim() }]);
      if (!resultado) return;
      if (resultado.ignoradas.length > 0) {
        set_mensagem_erro(`Instituição não cadastrada: ${resultado.ignoradas[0].motivo}`);
        return;
      }
      exibir_toast(
        resultado.atualizadas > 0
          ? `"${novo_nome.trim()}" já existia neste evento; sigla e câmpus foram atualizados.`
          : `Instituição "${novo_nome.trim()}" cadastrada.`
      );
      set_novo_nome('');
      set_nova_sigla('');
      set_novo_campus('');
      set_mostrar_form_novo(false);
      await carregar_instituicoes();
    } finally {
      set_salvando_novo(false);
    }
  };

  const handle_salvar_edicao = async (e: React.FormEvent) => {
    e.preventDefault();
    const alvo = instituicao_em_edicao;
    if (!alvo || !alvo.nome_exibicao.trim()) return;
    if (!(await garantirSessaoAdmin())) return;
    set_salvando_edicao(true);
    set_mensagem_erro(null);
    try {
      // nome_normalizado e a caixa da sigla são calculados por trigger no banco
      const { error } = await supabase
        .from('instituicoes')
        .update({ nome_exibicao: alvo.nome_exibicao.trim(), sigla: alvo.sigla?.trim() || null, campus: alvo.campus?.trim() || null })
        .eq('id_instituicao', alvo.id_instituicao);
      if (error) {
        set_mensagem_erro(`Erro ao salvar a instituição: ${mensagemErro(error)}`);
        return;
      }
      exibir_toast('Instituição atualizada.');
      set_instituicao_em_edicao(null);
      await carregar_instituicoes();
    } finally {
      set_salvando_edicao(false);
    }
  };

  const confirmar_exclusao = async () => {
    const alvo = instituicao_para_excluir;
    if (!alvo) return;
    if (!(await garantirSessaoAdmin())) return;
    set_excluindo(true);
    set_mensagem_erro(null);
    try {
      const { error } = await supabase.rpc('admin_excluir_instituicao', { p_id_instituicao: alvo.id_instituicao });
      set_instituicao_para_excluir(null);
      if (error) {
        set_mensagem_erro(`Não foi possível excluir "${alvo.nome_exibicao}": ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      set_instituicoes((prev) => prev.filter((i) => i.id_instituicao !== alvo.id_instituicao));
      exibir_toast(`Instituição "${alvo.nome_exibicao}" excluída.`);
    } finally {
      set_excluindo(false);
    }
  };

  const baixar_planilha_exemplo = async () => {
    try {
      await baixarPlanilhaModelo('modelo_importacao_instituicoes.xlsx', 'Instituições', ['nome', 'sigla', 'campus'], [
        { nome: 'Instituto Federal de Mato Grosso do Sul', sigla: 'IFMS', campus: 'Campo Grande' },
        { nome: 'Escola Estadual Joaquim Murtinho', sigla: 'EEJM', campus: '' },
      ]);
      exibir_toast('Planilha modelo de instituições (.xlsx) baixada.');
    } catch (err) {
      console.error('Erro ao gerar modelo de instituições:', err);
      set_mensagem_erro('Falha ao baixar o modelo de planilha.');
    }
  };

  const handle_upload_instituicoes = async (file: File) => {
    set_mensagem_erro(null);
    set_logs_importacao([]);

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
        const porNome = new Map<string, ItemInstituicaoRpc>();
        linhas.forEach((linha: Record<string, unknown>, indice: number) => {
          const item = extrairLinhaInstituicao(linha);
          if (!item.nome) {
            adicionarLog('error', `Linha ${indice + 2}: nome da instituição não encontrado, ignorada.`);
            return;
          }
          porNome.set(normalizarChave(item.nome), item);
        });
        const itens = Array.from(porNome.values());
        if (itens.length === 0) {
          set_mensagem_erro('Nenhuma instituição válida na planilha. Use as colunas "nome", "sigla" e "campus".');
          return;
        }
        if (!(await garantirSessaoAdmin())) return;
        const resultado = await salvarInstituicoes(itens);
        if (!resultado) {
          adicionarLog('error', 'A importação foi recusada pelo banco; nada foi gravado.');
          return;
        }
        resultado.ignoradas.forEach((i) => adicionarLog('error', `${i.nome || '(sem nome)'}: ${i.motivo}`));
        const resumo = `${resultado.cadastradas} cadastrada(s), ${resultado.atualizadas} já existente(s) atualizada(s)` +
          (resultado.ignoradas.length ? `, ${resultado.ignoradas.length} ignorada(s)` : '');
        adicionarLog('success', `Importação concluída: ${resumo}.`);
        exibir_toast(`Importação concluída: ${resumo}.`);
        await carregar_instituicoes();
      } catch (errParsing) {
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

  const alternar_ordenacao = (coluna: ColunaOrdenacao) => {
    if (coluna_ordenacao === coluna) {
      set_ordem_ascendente(!ordem_ascendente);
    } else {
      set_coluna_ordenacao(coluna);
      set_ordem_ascendente(true);
    }
  };

  const instituicoes_filtradas = useMemo(() => {
    const termo = normalizarChave(termo_busca);
    if (!termo) return instituicoes;
    return instituicoes.filter((inst) =>
      [inst.nome_exibicao, inst.sigla, inst.campus].some((v) => normalizarChave(v || '').includes(termo))
    );
  }, [instituicoes, termo_busca]);

  const instituicoes_ordenadas = useMemo(
    () =>
      [...instituicoes_filtradas].sort((a, b) => {
        const valA = a[coluna_ordenacao] || '';
        const valB = b[coluna_ordenacao] || '';
        if (!valA && !valB) return 0;
        if (!valA) return 1;
        if (!valB) return -1;
        const comp = compararNatural(valA, valB);
        return ordem_ascendente ? comp : -comp;
      }),
    [instituicoes_filtradas, coluna_ordenacao, ordem_ascendente]
  );

  const direcao = ordem_ascendente ? 'asc' : 'desc';
  const classeCampo =
    'px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6 font-sans">
      {toast_mensagem && (
        <div role="status" className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{toast_mensagem}</span>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
          <Building className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          Gestor de Instituições de Ensino
        </h2>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={input_file_ref}
            type="file"
            accept=".csv, .xlsx"
            className="hidden"
            aria-label="Arquivo de instituições (.xlsx ou .csv)"
            disabled={processando_arquivo || !idEvento}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handle_upload_instituicoes(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={baixar_planilha_exemplo}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs shrink-0"
          >
            <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Baixar Modelo (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() => input_file_ref.current?.click()}
            disabled={processando_arquivo || !idEvento}
            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs shrink-0 disabled:opacity-60"
          >
            {processando_arquivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{processando_arquivo ? 'Processando planilha...' : 'Importar (.xlsx/.csv)'}</span>
          </button>
          <button
            type="button"
            onClick={() => set_mostrar_form_novo(!mostrar_form_novo)}
            disabled={!idEvento}
            aria-expanded={mostrar_form_novo}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs shrink-0 disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            Nova Instituição
          </button>
          <button
            type="button"
            onClick={carregar_instituicoes}
            disabled={carregando}
            aria-label="Recarregar lista"
            title="Recarregar lista"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
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
          Não há evento ativo. As instituições são de cada evento: ative um evento para gerenciá-las.
        </div>
      )}

      {mensagem_erro && (
        <div role="alert" className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl flex items-center justify-between gap-3 text-xs sm:text-sm text-red-800 dark:text-red-200 font-semibold">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            {mensagem_erro}
          </span>
          <button type="button" onClick={() => set_mensagem_erro(null)} className="text-xs underline font-bold">
            Dispensar
          </button>
        </div>
      )}

      {(logs_importacao.length > 0 || processando_arquivo) && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-emerald-400">
              <Terminal className="w-4 h-4" />
              <span>Resultado da importação</span>
            </div>
            {logs_importacao.length > 0 && !processando_arquivo && (
              <button type="button" onClick={() => set_logs_importacao([])} className="text-[11px] text-slate-400 hover:text-slate-200 underline lowercase">
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

      {mostrar_form_novo && (
        <form
          onSubmit={handle_adicionar_instituicao}
          aria-label="Cadastrar instituição"
          className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 p-4 rounded-2xl space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Cadastrar instituição
            </span>
            <button type="button" onClick={() => set_mostrar_form_novo(false)} className="text-xs text-slate-400 hover:text-slate-600">
              Cancelar
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={novo_nome}
              onChange={(e) => set_novo_nome(e.target.value)}
              placeholder="Nome (ex: Instituto Federal de MS)"
              aria-label="Nome da instituição"
              className={`${classeCampo} flex-1`}
              required
            />
            <input
              type="text"
              value={nova_sigla}
              onChange={(e) => set_nova_sigla(e.target.value)}
              placeholder="Sigla (opcional)"
              aria-label="Sigla"
              maxLength={50}
              className={`${classeCampo} sm:w-40`}
            />
            <input
              type="text"
              value={novo_campus}
              onChange={(e) => set_novo_campus(e.target.value)}
              placeholder="Câmpus (opcional)"
              aria-label="Câmpus"
              maxLength={150}
              className={`${classeCampo} sm:w-48`}
            />
            <button
              type="submit"
              disabled={salvando_novo || !novo_nome.trim()}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shrink-0"
            >
              {salvando_novo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Cadastrar
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Pesquisar por nome, sigla ou câmpus..."
            aria-label="Pesquisar instituições"
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          Total: <strong className="text-slate-800 dark:text-slate-200">{instituicoes.length}</strong> instituições no evento
        </span>
      </div>

      {carregando ? (
        <div className="p-12 text-center border border-slate-200 dark:border-slate-700 rounded-2xl">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500 mt-2">Carregando instituições...</p>
        </div>
      ) : instituicoes_filtradas.length === 0 ? (
        <div className="p-10 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {instituicoes.length === 0 ? 'Nenhuma instituição cadastrada neste evento.' : 'Nenhuma instituição encontrada para esta pesquisa.'}
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[520px]">
              <caption className="sr-only">Instituições do evento</caption>
              <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <CabecalhoOrdenavel coluna="nome_exibicao" rotulo="Instituição" ativa={coluna_ordenacao} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="sigla" rotulo="Sigla" ativa={coluna_ordenacao} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <CabecalhoOrdenavel coluna="campus" rotulo="Câmpus" ativa={coluna_ordenacao} direcao={direcao} aoOrdenar={alternar_ordenacao} />
                  <th scope="col" className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {instituicoes_ordenadas.map((inst) => (
                  <tr key={inst.id_instituicao} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{inst.nome_exibicao}</td>
                    <td className="px-4 py-3">
                      {inst.sigla ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {inst.sigla}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">Sem sigla</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{inst.campus || <span className="text-[11px] text-slate-400 italic">Não informado</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => set_instituicao_em_edicao({ ...inst })}
                          aria-label={`Editar ${inst.nome_exibicao}`}
                          title="Editar"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => set_instituicao_para_excluir(inst)}
                          aria-label={`Excluir ${inst.nome_exibicao}`}
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

      {instituicao_em_edicao && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="titulo-editar-instituicao" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 id="titulo-editar-instituicao" className="text-base font-extrabold text-slate-900 dark:text-white">
                Editar Instituição
              </h3>
              <button type="button" onClick={() => set_instituicao_em_edicao(null)} aria-label="Fechar edição" className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handle_salvar_edicao} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="edit-inst-nome" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nome
                </label>
                <input
                  id="edit-inst-nome"
                  type="text"
                  value={instituicao_em_edicao.nome_exibicao}
                  onChange={(e) => set_instituicao_em_edicao({ ...instituicao_em_edicao, nome_exibicao: e.target.value })}
                  className={`${classeCampo} w-full`}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="edit-inst-sigla" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Sigla
                  </label>
                  <input
                    id="edit-inst-sigla"
                    type="text"
                    maxLength={50}
                    value={instituicao_em_edicao.sigla || ''}
                    onChange={(e) => set_instituicao_em_edicao({ ...instituicao_em_edicao, sigla: e.target.value })}
                    className={`${classeCampo} w-full`}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="edit-inst-campus" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Câmpus
                  </label>
                  <input
                    id="edit-inst-campus"
                    type="text"
                    maxLength={150}
                    value={instituicao_em_edicao.campus || ''}
                    onChange={(e) => set_instituicao_em_edicao({ ...instituicao_em_edicao, campus: e.target.value })}
                    className={`${classeCampo} w-full`}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => set_instituicao_em_edicao(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando_edicao}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-2 disabled:opacity-50"
                >
                  {salvando_edicao ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {instituicao_para_excluir && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titulo-excluir-instituicao"
            aria-describedby="texto-excluir-instituicao"
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl border border-rose-200 dark:border-rose-900/60 space-y-4"
          >
            <h3 id="titulo-excluir-instituicao" className="text-base font-bold text-slate-900 dark:text-white">
              Excluir "{instituicao_para_excluir.nome_exibicao}"?
            </h3>
            <p id="texto-excluir-instituicao" className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Se houver projeto ou avaliador desta instituição, a exclusão é recusada: sem a instituição, a regra que impede o
              avaliador de julgar a própria escola deixaria de valer para eles.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => set_instituicao_para_excluir(null)} disabled={excluindo} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
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
    </div>
  );
};
