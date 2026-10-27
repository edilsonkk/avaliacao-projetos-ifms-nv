import React, { useState, useEffect, useRef } from 'react';
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
  School,
  Save,
  UploadCloud,
  FileSpreadsheet,
  Terminal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { lerPlanilhaParaJson, validarArquivoPlanilha } from '@/lib/excelUtils';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '../lib/sessaoAdmin';

interface InstituicaoRegistro {
  id_instituicao: string;
  id?: string;
  nome_exibicao: string;
  nome_normalizado?: string;
  sigla?: string;
  campus?: string | null;
  criado_em?: string;
}

const instituicoes_fallback: InstituicaoRegistro[] = [
  { id_instituicao: 'inst-01', nome_exibicao: 'IFMS - Câmpus Campo Grande', sigla: 'IFMS', nome_normalizado: 'ifmscampuscampogrande' },
  { id_instituicao: 'inst-02', nome_exibicao: 'IFMS - Câmpus Corumbá', sigla: 'IFMS', nome_normalizado: 'ifmscampuscorumba' },
  { id_instituicao: 'inst-03', nome_exibicao: 'IFMS - Câmpus Dourados', sigla: 'IFMS', nome_normalizado: 'ifmscampusdourados' },
  { id_instituicao: 'inst-04', nome_exibicao: 'UFMS - Universidade Federal de Mato Grosso do Sul', sigla: 'UFMS', nome_normalizado: 'ufmsuniversidadefederaldematogrossodosul' },
  { id_instituicao: 'inst-05', nome_exibicao: 'UCDB - Universidade Católica Dom Bosco', sigla: 'UCDB', nome_normalizado: 'ucdbuniversidadecatolicadombosco' },
];

export const GestorInstituicoes: React.FC<{ id_evento_ativo?: string; ao_fechar?: () => void }> = ({ id_evento_ativo, ao_fechar }) => {
  const idEvt = id_evento_ativo || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || '';
  const [instituicoes, set_instituicoes] = useState<InstituicaoRegistro[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // Ordenação de colunas
  const [coluna_ordenacao, set_coluna_ordenacao] = useState<'nome_exibicao' | 'sigla'>('nome_exibicao');
  const [ordem_ascendente, set_ordem_ascendente] = useState<boolean>(true);

  // Formulário de Criação
  const [mostrar_form_novo, set_mostrar_form_novo] = useState<boolean>(false);
  const [novo_nome_exibicao, set_novo_nome_exibicao] = useState<string>('');
  const [nova_sigla, set_nova_sigla] = useState<string>('');
  const [salvando_novo, set_salvando_novo] = useState<boolean>(false);

  // Edição
  const [instituicao_em_edicao, set_instituicao_em_edicao] = useState<InstituicaoRegistro | null>(null);
  const [nome_editado, set_nome_editado] = useState<string>('');
  const [sigla_editada, set_sigla_editada] = useState<string>('');
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  // Exclusão
  const [excluindo_id, set_excluindo_id] = useState<string | null>(null);

  // Estados de Importação (.CSV/.XLSX)
  const input_file_ref = useRef<HTMLInputElement | null>(null);
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [logs_importacao, set_logs_importacao] = useState<{ tipo: 'info' | 'success' | 'error'; mensagem: string }[]>([]);

  const adicionarLog = (tipo: 'info' | 'success' | 'error', mensagem: string) => {
    set_logs_importacao((prev) => [...prev, { tipo, mensagem }]);
  };

  // Feedback Toast
  const [toast_mensagem, set_toast_mensagem] = useState<string | null>(null);

  const conexao_banco = verificar_conexao_configurada();

  const exibir_toast = (texto: string) => {
    set_toast_mensagem(texto);
    setTimeout(() => set_toast_mensagem(null), 3500);
  };

  const normalizar_texto = (texto: string): string => {
    if (!texto) return '';
    return texto
      .toString()
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  };

  // 1.1 IMPORTAÇÃO EM MASSA POR PLANILHA (.CSV/.XLSX)
  const handle_upload_instituicoes = async (file: File) => {
    set_processando_arquivo(true);
    set_mensagem_erro(null);
    set_logs_importacao([]);

    const validacao = validarArquivoPlanilha(file);
    if (!validacao.valido) {
      adicionarLog('error', validacao.erro || 'Arquivo inválido.');
      set_mensagem_erro(validacao.erro || 'Arquivo inválido.');
      set_processando_arquivo(false);
      return;
    }

    adicionarLog('info', `Iniciando leitura da planilha: ${file.name}`);

    try {
      const isCSV = validacao.isCSV;
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          if (!e.target?.result) {
            adicionarLog('error', 'Falha ao ler o arquivo selecionado.');
            set_processando_arquivo(false);
            return;
          }

          const dadosBrutos = await lerPlanilhaParaJson(
            isCSV ? (e.target.result as string) : (e.target.result as ArrayBuffer),
            isCSV
          );

          if (dadosBrutos.length === 0) {
            adicionarLog('error', 'A planilha de instituições está vazia.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Planilha lida! Total de ${dadosBrutos.length} linhas para processamento.`);

          const mapInstituicoes = new Map<string, { nome_exibicao: string; nome_normalizado: string; sigla: string; campus: string | null }>();

          for (let index = 0; index < dadosBrutos.length; index++) {
            const linha = dadosBrutos[index];
            const numLinha = index + 2;
            const keys = Object.keys(linha);

            let nome = '';
            let sigla = '';
            let campus = '';

            keys.forEach((k) => {
              const kLower = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
              if (kLower.includes('nome') || kLower.includes('instituicao') || kLower.includes('instituição') || kLower === 'escola') {
                nome = String(linha[k]).trim();
              } else if (kLower.includes('sigla')) {
                sigla = String(linha[k]).trim().toUpperCase();
              } else if (kLower.includes('campus') || kLower.includes('câmpus') || kLower.includes('unidade') || kLower.includes('cidade')) {
                campus = String(linha[k]).trim();
              }
            });

            if (!nome && keys.length > 0) nome = String(linha[keys[0]]).trim();
            if (!sigla && keys.length > 1) sigla = String(linha[keys[1]]).trim().toUpperCase();
            if (!campus && keys.length > 2) campus = String(linha[keys[2]]).trim();

            if (!nome) {
              adicionarLog('error', `Linha ${numLinha}: Nome da instituição não identificado. Linha ignorada.`);
              continue;
            }

            const nome_norm = normalizar_texto(nome);
            const siglaFinal = sigla || (nome.split(' ').map((w) => w[0]).join('').slice(0, 8).toUpperCase() || 'INST');

            const payloadInst: any = {
              nome_exibicao: nome,
              nome_normalizado: nome_norm,
              sigla: siglaFinal,
              campus: campus || null,
            };
            if (idEvt) payloadInst.id_evento = idEvt;

            mapInstituicoes.set(nome_norm, payloadInst);
            adicionarLog('info', `Linha ${numLinha}: Instituição "${nome}" (Sigla: ${siglaFinal}${campus ? ' - ' + campus : ''}) validada.`);
          }

          const listaInst = Array.from(mapInstituicoes.values());
          if (listaInst.length === 0) {
            adicionarLog('error', 'Nenhuma instituição válida encontrada na planilha.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Consolidando ${listaInst.length} instituições para envio via UPSERT em lote...`);

          if (conexao_banco) {
            if (!(await garantirSessaoAdmin())) {
              set_processando_arquivo(false);
              return;
            }
            let { error: errUpsert } = await supabase
              .from('instituicoes')
              .upsert(listaInst, { onConflict: 'nome_normalizado' });

            if (errUpsert) {
              let { error: errInsert } = await supabase.from('instituicoes').insert(listaInst);
              if (errInsert && errInsert.message && errInsert.message.includes('id_evento')) {
                const semEvento = listaInst.map((inst: any) => {
                  const { id_evento, ...resto } = inst;
                  return resto;
                });
                const retry = await supabase.from('instituicoes').insert(semEvento);
                errInsert = retry.error;
              }
              if (errInsert) {
                const msgErro = tratarErroEscritaAdmin(errInsert);
                adicionarLog('error', `Erro ao gravar no Supabase: ${msgErro}`);
                set_mensagem_erro(`Erro ao importar instituições: ${msgErro}`);
                set_processando_arquivo(false);
                return;
              }
            }

            adicionarLog('success', `Lote processado com sucesso! ${listaInst.length} instituições cadastradas.`);
            exibir_toast(`Importação concluída: ${listaInst.length} instituições cadastradas!`);
            await carregar_instituicoes();
          } else {
            listaInst.forEach((inst) => {
              set_instituicoes((prev) => [
                {
                  id_instituicao: 'inst-' + Math.random().toString(36).substring(2, 7),
                  nome_exibicao: inst.nome_exibicao,
                  nome_normalizado: inst.nome_normalizado,
                  sigla: inst.sigla,
                  campus: inst.campus || undefined,
                },
                ...prev,
              ]);
            });
            adicionarLog('success', `[Modo Contingência] ${listaInst.length} instituições inseridas localmente.`);
            exibir_toast(`Importação concluída: ${listaInst.length} instituições adicionadas!`);
          }
        } catch (errParsing: any) {
          console.error('Erro ao processar planilha de instituições:', errParsing);
          adicionarLog('error', `Erro ao processar planilha: ${errParsing.message}`);
          set_mensagem_erro(`Erro ao processar planilha: ${errParsing.message}`);
        } finally {
          set_processando_arquivo(false);
        }
      };

      if (isCSV) {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    } catch (err: any) {
      adicionarLog('error', `Falha ao iniciar leitura: ${err.message}`);
      set_processando_arquivo(false);
    }
  };

  // 1. SELECT Real de Instituições
  const carregar_instituicoes = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_instituicoes(instituicoes_fallback);
      set_carregando(false);
      return;
    }

    try {
      let q: any = supabase
        .from('instituicoes')
        .select('id_instituicao, nome_exibicao, sigla, nome_normalizado');

      if (idEvt && typeof q.eq === 'function') {
        q = q.eq('id_evento', idEvt);
      }
      if (typeof q.order === 'function') {
        q = q.order('nome_exibicao', { ascending: true });
      }

      const { data, error } = await q;

      if (error) {
        // Tenta fallback com nome de coluna id
        let qAlt: any = supabase
          .from('instituicoes')
          .select('*');

        if (idEvt && typeof qAlt.eq === 'function') {
          qAlt = qAlt.eq('id_evento', idEvt);
        }
        if (typeof qAlt.order === 'function') {
          qAlt = qAlt.order('nome_exibicao', { ascending: true });
        }

        const { data: dataAlt, error: errAlt } = await qAlt;

        if (errAlt) throw error;
        set_instituicoes(
          (dataAlt || []).map((item: any) => ({
            id_instituicao: item.id_instituicao || item.id,
            nome_exibicao: item.nome_exibicao || item.nome || 'Instituição',
            sigla: item.sigla || '',
            nome_normalizado: item.nome_normalizado || normalizar_texto(item.nome_exibicao || ''),
          }))
        );
      } else {
        set_instituicoes(data || []);
      }
    } catch (e: any) {
      console.error('Erro ao carregar instituições:', e);
      set_mensagem_erro(`Erro do Supabase: ${e.message || 'Falha ao buscar instituições'}`);
      set_instituicoes(instituicoes_fallback);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    carregar_instituicoes();
  }, [idEvt]);

  // 2. INSERT: Adicionar Nova Instituição (Nome + Sigla)
  const handle_adicionar_instituicao = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = novo_nome_exibicao.trim();
    const sigla = nova_sigla.trim().toUpperCase();
    if (!nome) return;

    set_salvando_novo(true);
    const nome_norm = normalizar_texto(nome);

    if (!conexao_banco) {
      const nova: InstituicaoRegistro = {
        id_instituicao: 'inst-' + Math.random().toString(36).substring(2, 7),
        nome_exibicao: nome,
        sigla: sigla || undefined,
        nome_normalizado: nome_norm,
      };
      set_instituicoes((prev) => [nova, ...prev]);
      set_novo_nome_exibicao('');
      set_nova_sigla('');
      set_mostrar_form_novo(false);
      set_salvando_novo(false);
      exibir_toast('Instituição adicionada (modo local)!');
      return;
    }

    try {
      const payload: any = {
        nome_exibicao: nome,
        sigla: sigla || nome.substring(0, 10).toUpperCase(),
        nome_normalizado: nome_norm,
      };
      if (idEvt) payload.id_evento = idEvt;

      let { data, error } = await supabase
        .from('instituicoes')
        .insert(payload)
        .select()
        .single();

      if (error && error.message && error.message.includes('id_evento')) {
        delete payload.id_evento;
        const retry = await supabase.from('instituicoes').insert(payload).select().single();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        alert('Erro do Supabase ao cadastrar instituição: ' + error.message);
        return;
      }

      exibir_toast('Instituição cadastrada com sucesso no banco!');
      set_novo_nome_exibicao('');
      set_nova_sigla('');
      set_mostrar_form_novo(false);
      await carregar_instituicoes();
    } catch (e: any) {
      alert('Erro inesperado: ' + e.message);
    } finally {
      set_salvando_novo(false);
    }
  };

  // 3. UPDATE: Editar Instituição (Nome + Sigla)
  const handle_salvar_edicao = async () => {
    if (!instituicao_em_edicao || !nome_editado.trim()) return;

    set_salvando_edicao(true);
    const id_alvo = instituicao_em_edicao.id_instituicao || instituicao_em_edicao.id;
    const novo_nome = nome_editado.trim();
    const nova_sig = sigla_editada.trim().toUpperCase();
    const nome_norm = normalizar_texto(novo_nome);

    if (!conexao_banco) {
      set_instituicoes((prev) =>
        prev.map((inst) =>
          (inst.id_instituicao === id_alvo || inst.id === id_alvo)
            ? { ...inst, nome_exibicao: novo_nome, sigla: nova_sig, nome_normalizado: nome_norm }
            : inst
        )
      );
      set_instituicao_em_edicao(null);
      set_nome_editado('');
      set_sigla_editada('');
      set_salvando_edicao(false);
      exibir_toast('Instituição atualizada (modo local)!');
      return;
    }

    try {
      const { error } = await supabase
        .from('instituicoes')
        .update({
          nome_exibicao: novo_nome,
          sigla: nova_sig,
          nome_normalizado: nome_norm,
        })
        .eq('id_instituicao', id_alvo);

      if (error) {
        // Tenta com coluna id
        const { error: errAlt } = await supabase
          .from('instituicoes')
          .update({
            nome_exibicao: novo_nome,
            sigla: nova_sig,
            nome_normalizado: nome_norm,
          })
          .eq('id', id_alvo);

        if (errAlt) {
          alert('Erro do Supabase ao atualizar instituição: ' + error.message);
          return;
        }
      }

      exibir_toast('Instituição atualizada com sucesso!');
      set_instituicao_em_edicao(null);
      set_nome_editado('');
      set_sigla_editada('');
      await carregar_instituicoes();
    } catch (e: any) {
      alert('Erro ao atualizar instituição: ' + e.message);
    } finally {
      set_salvando_edicao(false);
    }
  };

  // 4. DELETE: Excluir com Tratamento Estrito de Violação de Chave Estrangeira
  const handle_excluir_instituicao = async (id_instituicao: string, nome: string) => {
    const confirmou = window.confirm(
      `Deseja realmente excluir a instituição "${nome}"?\nEsta ação removerá o registro do Supabase.`
    );
    if (!confirmou) return;

    set_excluindo_id(id_instituicao);

    if (!conexao_banco) {
      set_instituicoes((prev) =>
        prev.filter((item) => item.id_instituicao !== id_instituicao && item.id !== id_instituicao)
      );
      set_excluindo_id(null);
      exibir_toast('Instituição removida (modo local)!');
      return;
    }

    try {
      const { error } = await supabase
        .from('instituicoes')
        .delete()
        .eq('id_instituicao', id_instituicao);

      if (error) {
        console.error('Erro ao excluir no Supabase:', error);

        // Identificação estrita de bloqueio por Chave Estrangeira (projetos ou avaliadores vinculados)
        const codigo = error.code;
        const msg = (error.message || '').toLowerCase();
        const detalhe = (error.details || '').toLowerCase();

        const is_violacao_fk =
          codigo === '23503' ||
          msg.includes('foreign key') ||
          msg.includes('violates foreign key constraint') ||
          msg.includes('chave estrangeira') ||
          msg.includes('is still referenced') ||
          msg.includes('restrição') ||
          detalhe.includes('still referenced');

        if (is_violacao_fk) {
          alert(
            'Violação de Restrição: Não é possível excluir esta instituição pois existem projetos ou avaliadores vinculados a ela no banco de dados.'
          );
        } else {
          alert('Erro do Supabase ao excluir: ' + error.message);
        }
        return;
      }

      alert('Instituição excluída com sucesso.');
      exibir_toast('Instituição excluída com sucesso!');
      await carregar_instituicoes();
    } catch (e: any) {
      alert('Erro inesperado ao excluir instituição: ' + e.message);
    } finally {
      set_excluindo_id(null);
    }
  };

  const alternar_ordenacao = (coluna: 'nome_exibicao' | 'sigla') => {
    if (coluna_ordenacao === coluna) {
      set_ordem_ascendente(!ordem_ascendente);
    } else {
      set_coluna_ordenacao(coluna);
      set_ordem_ascendente(true);
    }
  };

  const render_icone_ordenacao = (coluna: 'nome_exibicao' | 'sigla') => {
    if (coluna_ordenacao !== coluna) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 opacity-60" />;
    }
    return ordem_ascendente ? (
      <ArrowUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 font-bold" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 font-bold" />
    );
  };

  const instituicoes_filtradas = instituicoes.filter((inst) => {
    if (!termo_busca.trim()) return true;
    const termo = termo_busca.toLowerCase().trim();
    return (
      (inst.nome_exibicao || '').toLowerCase().includes(termo) ||
      (inst.sigla || '').toLowerCase().includes(termo)
    );
  });

  const instituicoes_ordenadas = [...instituicoes_filtradas].sort((a, b) => {
    const valA = (a[coluna_ordenacao] || '').toString().toLowerCase();
    const valB = (b[coluna_ordenacao] || '').toString().toLowerCase();
    const comp = valA.localeCompare(valB, 'pt-BR');
    return ordem_ascendente ? comp : -comp;
  });

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6 font-sans">
      {/* Toast Flutuante */}
      {toast_mensagem && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{toast_mensagem}</span>
        </div>
      )}

      {/* Cabeçalho do Gestor */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Building className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            Gestor de Instituições de Ensino
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={input_file_ref}
            type="file"
            accept=".csv, .xlsx"
            className="hidden"
            disabled={processando_arquivo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handle_upload_instituicoes(f);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => input_file_ref.current?.click()}
            disabled={processando_arquivo}
            className="px-3.5 py-2.5 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
            title="Importar (.xlsx/.csv)"
          >
            {processando_arquivo ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>{processando_arquivo ? 'Processando Planilha...' : 'Importar (.xlsx/.csv)'}</span>
          </button>

          <button
            type="button"
            onClick={() => set_mostrar_form_novo(!mostrar_form_novo)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nova Instituição
          </button>

          <button
            type="button"
            onClick={carregar_instituicoes}
            disabled={carregando}
            title="Recarregar"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          {ao_fechar && (
            <button
              type="button"
              onClick={ao_fechar}
              className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Console de Logs da Importação Direta (sem subtítulos) */}
      {(logs_importacao.length > 0 || processando_arquivo) && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2 animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-emerald-400">
              <Terminal className="w-4 h-4" />
              <span>Console de Importação de Instituições</span>
            </div>
            {logs_importacao.length > 0 && !processando_arquivo && (
              <button
                type="button"
                onClick={() => set_logs_importacao([])}
                className="text-[11px] text-slate-400 hover:text-slate-200 underline cursor-pointer lowercase"
              >
                fechar console
              </button>
            )}
          </div>
          <div className="text-slate-200 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1">
            {logs_importacao.map((log, idx) => (
              <div
                key={idx}
                className={`leading-relaxed ${
                  log.tipo === 'success'
                    ? 'text-emerald-400'
                    : log.tipo === 'error'
                    ? 'text-red-400'
                    : 'text-slate-300'
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

      {/* Formulário de Criação Rápida */}
      {mostrar_form_novo && (
        <form
          onSubmit={handle_adicionar_instituicao}
          className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 p-4 sm:p-5 rounded-2xl space-y-3 animate-in fade-in"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Cadastrar Nova Instituição
            </span>
            <button
              type="button"
              onClick={() => {
                set_mostrar_form_novo(false);
                set_novo_nome_exibicao('');
                set_nova_sigla('');
              }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancelar
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={novo_nome_exibicao}
              onChange={(e) => set_novo_nome_exibicao(e.target.value)}
              placeholder="Nome da Instituição (ex: Instituto Federal de MS)"
              className="flex-1 px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
            <input
              type="text"
              value={nova_sigla}
              onChange={(e) => set_nova_sigla(e.target.value)}
              placeholder="Sigla (ex: IFMS)"
              className="w-full sm:w-36 px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              disabled={salvando_novo || !novo_nome_exibicao.trim()}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shrink-0 shadow-xs cursor-pointer"
            >
              {salvando_novo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar no Supabase
            </button>
          </div>
        </form>
      )}

      {/* Barra de Busca e Filtro */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Buscar instituição por nome ou sigla..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 self-end sm:self-center">
          Total: <strong className="text-slate-800 dark:text-slate-200">{instituicoes_ordenadas.length}</strong> instituições
        </span>
      </div>

      {/* Alerta de Erro Visual */}
      {mensagem_erro && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>{mensagem_erro}</span>
          </div>
          <button
            type="button"
            onClick={carregar_instituicoes}
            className="text-xs font-bold underline cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Lista / Tabela de Instituições */}
      {carregando ? (
        <div className="p-12 text-center space-y-3">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">
            Consultando instituições cadastradas no Supabase...
          </p>
        </div>
      ) : instituicoes_ordenadas.length === 0 ? (
        <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
          <Building className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Nenhuma instituição encontrada.
          </p>
          <p className="text-[11px] text-slate-400">
            Clique em "Nova Instituição" para adicionar um registro na tabela `instituicoes`.
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
              <tr>
                {/* 1. Nome da Instituição com Ordenação */}
                <th
                  onClick={() => alternar_ordenacao('nome_exibicao')}
                  className="px-5 py-3.5 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  title="Clique para ordenar por Nome da Instituição"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Nome da Instituição</span>
                    {render_icone_ordenacao('nome_exibicao')}
                  </div>
                </th>

                {/* 2. Sigla com Ordenação */}
                <th
                  onClick={() => alternar_ordenacao('sigla')}
                  className="px-5 py-3.5 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors w-36"
                  title="Clique para ordenar por Sigla"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Sigla</span>
                    {render_icone_ordenacao('sigla')}
                  </div>
                </th>

                <th className="px-5 py-3.5 text-right w-28">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {instituicoes_ordenadas.map((inst) => {
                const id_inst = inst.id_instituicao || inst.id || '';
                const em_edicao = instituicao_em_edicao?.id_instituicao === id_inst || instituicao_em_edicao?.id === id_inst;
                const excluindo = excluindo_id === id_inst;

                return (
                  <tr key={id_inst} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    {/* Nome da Instituição */}
                    <td className="px-5 py-3.5 font-medium">
                      {em_edicao ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={nome_editado}
                            onChange={(e) => set_nome_editado(e.target.value)}
                            placeholder="Nome da Instituição"
                            className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-emerald-500 rounded-lg text-xs w-full max-w-md focus:outline-none"
                            autoFocus
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <Building className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span className="font-bold text-slate-900 dark:text-white">{inst.nome_exibicao}</span>
                        </div>
                      )}
                    </td>

                    {/* Sigla */}
                    <td className="px-5 py-3.5 font-medium">
                      {em_edicao ? (
                        <input
                          type="text"
                          value={sigla_editada}
                          onChange={(e) => set_sigla_editada(e.target.value)}
                          placeholder="Sigla"
                          className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-emerald-500 rounded-lg text-xs w-28 uppercase focus:outline-none"
                        />
                      ) : (
                        <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 inline-block">
                          {inst.sigla || '-'}
                        </span>
                      )}
                    </td>

                    {/* Ações */}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      {em_edicao ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handle_salvar_edicao}
                            disabled={salvando_edicao || !nome_editado.trim()}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            {salvando_edicao ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              set_instituicao_em_edicao(null);
                              set_nome_editado('');
                              set_sigla_editada('');
                            }}
                            className="px-2 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-bold cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              set_instituicao_em_edicao(inst);
                              set_nome_editado(inst.nome_exibicao);
                              set_sigla_editada(inst.sigla || '');
                            }}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                            title="Editar Instituição"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handle_excluir_instituicao(id_inst, inst.nome_exibicao)}
                            disabled={excluindo}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 transition-colors cursor-pointer"
                            title="Excluir Instituição"
                          >
                            {excluindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
