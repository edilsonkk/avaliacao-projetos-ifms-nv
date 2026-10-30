import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UserCog,
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
  X,
  Terminal,
  UserCheck,
  UserX,
  Clock,
  Plus,
  Save,
  Download,
} from 'lucide-react';
import { baixarPlanilhaModelo, lerPlanilhaParaJson, validarArquivoPlanilha } from '@/lib/excel/excelUtils';
import { supabase } from '@/lib/supabase';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { normalizarChave } from '@/lib/parsers/planilhaAvaliadoresParser';
import { CabecalhoOrdenavel, compararNatural } from '@/components/ui/CabecalhoOrdenavel';

export interface UsuarioStaff {
  id_usuario: string;
  nome: string;
  email: string;
  papel: string;
  is_credenciado?: boolean;
}

export interface LogImportacaoItem {
  tipo: 'success' | 'error' | 'info';
  mensagem: string;
}

interface ItemStaffRpc {
  nome: string;
  email: string;
  papel: string;
}

interface ResultadoSalvarStaff {
  cadastrados: number;
  atualizados: number;
  ignorados: { email: string; motivo: string }[];
}

type ColunaOrdenacaoStaff = 'is_credenciado' | 'nome' | 'email' | 'papel';

/** Lê nome, e-mail e papel de uma linha da planilha, aceitando variações no nome das colunas. */
export const extrairLinhaStaff = (linha: Record<string, unknown>): ItemStaffRpc => {
  const item: ItemStaffRpc = { nome: '', email: '', papel: '' };
  Object.keys(linha).forEach((coluna) => {
    const chave = normalizarChave(coluna);
    const valor = String(linha[coluna] ?? '').trim();
    if (chave.includes('mail')) item.email = valor.toLowerCase();
    else if (chave.includes('papel') || chave.includes('funcao')) item.papel = valor.toUpperCase();
    else if (chave.includes('nome')) item.nome = valor;
  });
  return item;
};

export const GestorStaff: React.FC<{
  ao_fechar?: () => void;
  id_evento_ativo?: string;
  aoAtualizarMetricas?: () => void;
}> = ({ ao_fechar, id_evento_ativo, aoAtualizarMetricas }) => {
  const idEvento = id_evento_ativo || '';

  const [equipe_staff, set_equipe_staff] = useState<UsuarioStaff[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');
  const [processando_credenciamento_id, set_processando_credenciamento_id] = useState<string | null>(null);

  const [colunaOrdenacao, setColunaOrdenacao] = useState<ColunaOrdenacaoStaff>('nome');
  const [ordemAscendente, setOrdemAscendente] = useState<boolean>(true);

  const [logsImportacao, setLogsImportacao] = useState<LogImportacaoItem[]>([]);

  const [mostrar_form_novo, set_mostrar_form_novo] = useState<boolean>(false);
  const [novo_nome, set_novo_nome] = useState<string>('');
  const [novo_email, set_novo_email] = useState<string>('');
  const [novo_papel, set_novo_papel] = useState<string>('STAFF');
  const [salvando_manual, set_salvando_manual] = useState<boolean>(false);

  const [usuario_em_edicao, set_usuario_em_edicao] = useState<{ id_usuario: string; nome: string; email: string } | null>(null);
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  const [staff_para_excluir, set_staff_para_excluir] = useState<UsuarioStaff | null>(null);
  const [excluindo, set_excluindo] = useState<boolean>(false);

  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);

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
      localStorage.removeItem('staff_credenciados_local');
    } catch {
      // armazenamento indisponível: nada a limpar
    }
  }, []);

  // A equipe é global (contas de login); o credenciamento é por evento.
  const carregar_staff = useCallback(async () => {
    set_carregando(true);
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id_usuario, nome, email, papel')
        .or('papel.ilike.staff,papel.ilike.monitor')
        .order('nome', { ascending: true });
      if (error) throw error;
      const membros = (data || []) as UsuarioStaff[];

      const credenciados = new Set<string>();
      if (idEvento && membros.length > 0) {
        const { data: vinculos, error: erroVinculos } = await supabase
          .from('avaliadores_evento')
          .select('id_usuario, is_credenciado')
          .eq('id_evento', idEvento)
          .in('id_usuario', membros.map((m) => m.id_usuario));
        if (erroVinculos) throw erroVinculos;
        (vinculos || []).forEach((v: { id_usuario: string; is_credenciado: boolean }) => v.is_credenciado && credenciados.add(v.id_usuario));
      }

      set_equipe_staff(membros.map((m) => ({ ...m, is_credenciado: credenciados.has(m.id_usuario) })));
    } catch (err) {
      console.error('Falha ao carregar Staff:', err);
      set_mensagem_erro(`Não foi possível carregar a equipe Staff: ${tratarErroEscritaAdmin(err)}`);
    } finally {
      set_carregando(false);
    }
  }, [idEvento]);

  useEffect(() => {
    carregar_staff();
  }, [carregar_staff]);

  /** Grava pela função do banco (uma transação). Retorna null em caso de erro. */
  const salvarStaff = async (itens: ItemStaffRpc[]): Promise<ResultadoSalvarStaff | null> => {
    const { data, error } = await supabase.rpc('admin_salvar_staff', { p_id_evento: idEvento || null, p_itens: itens });
    if (error) {
      set_mensagem_erro(`Erro ao gravar a equipe Staff: ${tratarErroEscritaAdmin(error)}`);
      return null;
    }
    const r = (data || {}) as Partial<ResultadoSalvarStaff>;
    return { cadastrados: r.cadastrados ?? 0, atualizados: r.atualizados ?? 0, ignorados: r.ignorados ?? [] };
  };

  const handle_adicionar_manual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novo_nome.trim() || !novo_email.trim()) {
      set_mensagem_erro('Preencha o nome e o e-mail do membro do Staff.');
      return;
    }
    if (!(await garantirSessaoAdmin())) return;

    set_salvando_manual(true);
    set_mensagem_erro(null);
    try {
      const resultado = await salvarStaff([{ nome: novo_nome.trim(), email: novo_email.trim().toLowerCase(), papel: novo_papel }]);
      if (!resultado) return;
      if (resultado.ignorados.length > 0) {
        set_mensagem_erro(`Membro não cadastrado: ${resultado.ignorados[0].motivo}`);
        return;
      }
      exibir_notificacao(resultado.atualizados > 0 ? 'Este e-mail já era da equipe: dados atualizados.' : 'Membro do Staff cadastrado.');
      set_novo_nome('');
      set_novo_email('');
      set_novo_papel('STAFF');
      set_mostrar_form_novo(false);
      await carregar_staff();
      aoAtualizarMetricas?.();
    } finally {
      set_salvando_manual(false);
    }
  };

  const baixar_planilha_exemplo = async () => {
    try {
      await baixarPlanilhaModelo('modelo_importacao_staff.xlsx', 'Staff', ['nome', 'email', 'papel'], [
        { nome: 'Lucas Pereira', email: 'lucas.pereira@ifms.edu.br', papel: 'STAFF' },
        { nome: 'Joana Martins', email: 'joana.martins@ifms.edu.br', papel: 'MONITOR' },
      ]);
      exibir_notificacao('Planilha modelo da equipe Staff (.xlsx) baixada.');
    } catch (err) {
      console.error('Erro ao gerar planilha modelo de Staff:', err);
      set_mensagem_erro('Falha ao baixar o modelo de planilha.');
    }
  };

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
        const conteudo = e.target?.result;
        if (!conteudo) {
          adicionarLog('error', 'Arquivo vazio.');
          return;
        }
        const linhas = await lerPlanilhaParaJson(conteudo as string | ArrayBuffer, validacao.isCSV);
        if (linhas.length === 0) {
          adicionarLog('error', 'A planilha não tem dados.');
          set_mensagem_erro('A planilha não tem dados.');
          return;
        }

        const porEmail = new Map<string, ItemStaffRpc>();
        linhas.forEach((linha: Record<string, unknown>, indice: number) => {
          const item = extrairLinhaStaff(linha);
          if (!item.email.includes('@')) {
            adicionarLog('error', `Linha ${indice + 2}: e-mail inválido ou ausente ("${item.email || 'vazio'}"), ignorada.`);
            return;
          }
          porEmail.set(item.email, item);
        });
        const itens = Array.from(porEmail.values());
        if (itens.length === 0) {
          set_mensagem_erro('Nenhum membro do Staff válido na planilha.');
          return;
        }

        if (!(await garantirSessaoAdmin())) return;
        const resultado = await salvarStaff(itens);
        if (!resultado) {
          adicionarLog('error', 'A importação foi recusada pelo banco; ninguém foi gravado.');
          return;
        }
        resultado.ignorados.forEach((i) => adicionarLog('error', `${i.email}: ${i.motivo}`));
        const resumo = `${resultado.cadastrados} cadastrado(s), ${resultado.atualizados} já existente(s) atualizado(s)` +
          (resultado.ignorados.length ? `, ${resultado.ignorados.length} ignorado(s)` : '');
        adicionarLog('success', `Importação concluída: ${resumo}.`);
        exibir_notificacao(`Importação concluída: ${resumo}.`);
        await carregar_staff();
        aoAtualizarMetricas?.();
      } catch (errParsing) {
        console.error('Erro ao processar planilha de Staff:', errParsing);
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
      const nome = usuario_em_edicao.nome.trim();
      const email = usuario_em_edicao.email.trim().toLowerCase();
      const { error } = await supabase.rpc('admin_atualizar_staff', { p_id_usuario: usuario_em_edicao.id_usuario, p_nome: nome, p_email: email });
      if (error) {
        set_mensagem_erro(`Erro ao salvar o membro do Staff: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      set_equipe_staff((prev) => prev.map((s) => (s.id_usuario === usuario_em_edicao.id_usuario ? { ...s, nome, email } : s)));
      exibir_notificacao('Membro do Staff atualizado.');
      set_usuario_em_edicao(null);
      aoAtualizarMetricas?.();
    } finally {
      set_salvando_edicao(false);
    }
  };

  const handle_toggle_credenciamento = async (usuario: UsuarioStaff) => {
    if (!idEvento) {
      set_mensagem_erro('Não há evento ativo: o credenciamento é feito por evento.');
      return;
    }
    if (!(await garantirSessaoAdmin())) return;
    const novoStatus = !usuario.is_credenciado;
    set_processando_credenciamento_id(usuario.id_usuario);
    set_mensagem_erro(null);
    try {
      const { error } = await supabase
        .from('avaliadores_evento')
        .upsert({ id_usuario: usuario.id_usuario, id_evento: idEvento, is_credenciado: novoStatus }, { onConflict: 'id_usuario,id_evento' });
      if (error) {
        set_mensagem_erro(`Erro ao ${novoStatus ? 'credenciar' : 'descredenciar'} ${usuario.nome}: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      set_equipe_staff((prev) => prev.map((s) => (s.id_usuario === usuario.id_usuario ? { ...s, is_credenciado: novoStatus } : s)));
      exibir_notificacao(novoStatus ? `${usuario.nome} foi credenciado.` : `Credenciamento de ${usuario.nome} removido.`);
      aoAtualizarMetricas?.();
    } finally {
      set_processando_credenciamento_id(null);
    }
  };

  const confirmar_exclusao = async () => {
    const alvo = staff_para_excluir;
    if (!alvo) return;
    if (!(await garantirSessaoAdmin())) return;
    set_excluindo(true);
    set_mensagem_erro(null);
    try {
      const { error } = await supabase.rpc('admin_excluir_staff', { p_id_usuario: alvo.id_usuario });
      set_staff_para_excluir(null);
      if (error) {
        set_mensagem_erro(`Não foi possível excluir ${alvo.nome}: ${tratarErroEscritaAdmin(error)}`);
        return;
      }
      set_equipe_staff((prev) => prev.filter((u) => u.id_usuario !== alvo.id_usuario));
      exibir_notificacao(`${alvo.nome} foi excluído da equipe Staff.`);
      aoAtualizarMetricas?.();
    } finally {
      set_excluindo(false);
    }
  };

  const alternarOrdenacao = (coluna: ColunaOrdenacaoStaff) => {
    if (colunaOrdenacao === coluna) {
      setOrdemAscendente(!ordemAscendente);
    } else {
      setColunaOrdenacao(coluna);
      setOrdemAscendente(true);
    }
  };

  const staff_filtrados = useMemo(() => {
    const t = termo_busca.trim().toLowerCase();
    if (!t) return equipe_staff;
    return equipe_staff.filter((s) => s.nome?.toLowerCase().includes(t) || s.email?.toLowerCase().includes(t));
  }, [equipe_staff, termo_busca]);

  const staff_ordenados = useMemo(
    () =>
      [...staff_filtrados].sort((a, b) => {
        const valA = colunaOrdenacao === 'is_credenciado' ? (a.is_credenciado ? '1' : '0') : String(a[colunaOrdenacao] || '');
        const valB = colunaOrdenacao === 'is_credenciado' ? (b.is_credenciado ? '1' : '0') : String(b[colunaOrdenacao] || '');
        const comp = compararNatural(valA, valB);
        return ordemAscendente ? comp : -comp;
      }),
    [staff_filtrados, colunaOrdenacao, ordemAscendente]
  );

  const totalStaffCredenciados = equipe_staff.filter((s) => s.is_credenciado).length;
  const direcao = ordemAscendente ? 'asc' : 'desc';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans w-full h-full overflow-y-auto">
      {mensagem_notificacao && (
        <div role="status" className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-indigo-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium">
          <CheckCircle2 className="w-5 h-5 text-indigo-300 dark:text-white shrink-0" />
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-100 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 shadow-xs">
            <UserCog className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">Gestor da Equipe Staff</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
          <input
            ref={input_file_ref}
            type="file"
            accept=".csv, .xlsx"
            className="hidden"
            aria-label="Arquivo da equipe Staff (.xlsx ou .csv)"
            disabled={processando_arquivo}
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
            <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Baixar Modelo (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={() => input_file_ref.current?.click()}
            disabled={processando_arquivo}
            className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
          >
            {processando_arquivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{processando_arquivo ? 'Processando planilha...' : 'Importar (.xlsx/.csv)'}</span>
          </button>

          <button
            type="button"
            onClick={() => set_mostrar_form_novo(!mostrar_form_novo)}
            aria-expanded={mostrar_form_novo}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Membro Staff</span>
          </button>

          <button
            type="button"
            onClick={carregar_staff}
            disabled={carregando}
            aria-label="Recarregar lista"
            title="Recarregar lista"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-indigo-600' : ''}`} />
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

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        A equipe vale para todos os eventos; o credenciamento é do evento ativo. Para entrar no sistema, o membro também
        precisa de uma conta de login com <strong>o mesmo e-mail</strong> (Supabase › Authentication).
      </p>

      {(logsImportacao.length > 0 || processando_arquivo) && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-indigo-400">
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
          onSubmit={handle_adicionar_manual}
          aria-label="Cadastrar membro do Staff"
          className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/60 p-4 sm:p-5 rounded-2xl space-y-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Cadastrar membro do Staff
            </span>
            <button type="button" onClick={() => set_mostrar_form_novo(false)} className="text-xs text-slate-400 hover:text-slate-600">
              Cancelar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-3">
            <input
              type="text"
              value={novo_nome}
              onChange={(e) => set_novo_nome(e.target.value)}
              placeholder="Nome"
              aria-label="Nome do membro do Staff"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
            <input
              type="email"
              value={novo_email}
              onChange={(e) => set_novo_email(e.target.value)}
              placeholder="E-mail (o mesmo da conta de login)"
              aria-label="E-mail do membro do Staff"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
            <select
              value={novo_papel}
              onChange={(e) => set_novo_papel(e.target.value)}
              aria-label="Papel"
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="STAFF">STAFF</option>
              <option value="MONITOR">MONITOR</option>
            </select>
            <button
              type="submit"
              disabled={salvando_manual || !novo_nome.trim() || !novo_email.trim()}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shrink-0 shadow-xs cursor-pointer"
            >
              {salvando_manual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Cadastrar Membro
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
            placeholder="Pesquisar por nome ou e-mail..."
            aria-label="Pesquisar equipe Staff"
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 self-end sm:self-center">
          Total: <strong className="text-slate-800 dark:text-slate-200">{equipe_staff.length}</strong> membros (
          <span className="text-indigo-600 dark:text-indigo-400 font-bold">{totalStaffCredenciados} credenciados no evento</span>)
        </span>
      </div>

      {carregando ? (
        <div className="p-12 text-center space-y-2 border border-slate-200 dark:border-slate-700 rounded-2xl">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">Carregando equipe Staff...</p>
        </div>
      ) : staff_filtrados.length === 0 ? (
        <div className="p-10 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {equipe_staff.length === 0 ? 'Nenhum membro do Staff cadastrado.' : 'Nenhum membro encontrado para esta pesquisa.'}
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[560px]">
              <caption className="sr-only">Equipe Staff</caption>
              <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <CabecalhoOrdenavel coluna="is_credenciado" rotulo="Credenciamento" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="nome" rotulo="Nome" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="email" rotulo="E-mail" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <CabecalhoOrdenavel coluna="papel" rotulo="Papel" ativa={colunaOrdenacao} direcao={direcao} aoOrdenar={alternarOrdenacao} />
                  <th scope="col" className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {staff_ordenados.map((usuario) => {
                  const processando = processando_credenciamento_id === usuario.id_usuario;
                  return (
                    <tr key={usuario.id_usuario} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3.5">
                        {usuario.is_credenciado ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Credenciado
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Pendente
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">{usuario.nome}</td>
                      <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-300">{usuario.email}</td>
                      <td className="px-4 py-3.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          {(usuario.papel || '').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handle_toggle_credenciamento(usuario)}
                            disabled={processando || !idEvento}
                            aria-label={`${usuario.is_credenciado ? 'Descredenciar' : 'Credenciar'} ${usuario.nome}`}
                            className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all inline-flex items-center gap-1.5 ${
                              usuario.is_credenciado
                                ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600'
                            } disabled:opacity-50`}
                          >
                            {processando ? (
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
                            onClick={() => set_usuario_em_edicao({ id_usuario: usuario.id_usuario, nome: usuario.nome, email: usuario.email })}
                            aria-label={`Editar ${usuario.nome}`}
                            title="Editar"
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => set_staff_para_excluir(usuario)}
                            aria-label={`Excluir ${usuario.nome}`}
                            title="Excluir"
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

      {staff_para_excluir && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titulo-excluir-staff"
            aria-describedby="texto-excluir-staff"
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl border border-rose-200 dark:border-rose-900/60 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-rose-100 dark:bg-rose-950/50">
                <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
              </div>
              <h3 id="titulo-excluir-staff" className="text-base font-bold text-slate-900 dark:text-white">
                Excluir {staff_para_excluir.nome} da equipe?
              </h3>
            </div>
            <p id="texto-excluir-staff" className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Ele perde o acesso ao painel do Staff em todos os eventos. A conta de login continua no Supabase, mas sem
              permissão; para apagá-la, use o painel do Supabase (Authentication).
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => set_staff_para_excluir(null)}
                disabled={excluindo}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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

      {usuario_em_edicao && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-editar-staff"
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 id="titulo-editar-staff" className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-indigo-600" />
                Editar Membro do Staff
              </h3>
              <button type="button" onClick={() => set_usuario_em_edicao(null)} aria-label="Fechar edição" className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handle_salvar_edicao} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="edit-nome-staff" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nome completo
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    id="edit-nome-staff"
                    type="text"
                    value={usuario_em_edicao.nome}
                    onChange={(e) => set_usuario_em_edicao({ ...usuario_em_edicao, nome: e.target.value })}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="edit-email-staff" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    id="edit-email-staff"
                    type="email"
                    value={usuario_em_edicao.email}
                    onChange={(e) => set_usuario_em_edicao({ ...usuario_em_edicao, email: e.target.value })}
                    aria-describedby="dica-email-staff"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
                <p id="dica-email-staff" className="text-[11px] text-slate-500">
                  Mudar o e-mail aqui não muda o login. No primeiro acesso, o e-mail da conta de login precisa ser este.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => set_usuario_em_edicao(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando_edicao}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
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
    </div>
  );
};
