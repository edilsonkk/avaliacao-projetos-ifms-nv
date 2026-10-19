import React, { useState, useEffect, useRef } from 'react';
import {
  UserCog,
  UploadCloud,
  UserPlus,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Mail,
  User,
  ShieldOff,
  Info,
  Pencil,
  X,
  Terminal
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export interface UsuarioStaff {
  id_usuario: string;
  nome: string;
  email: string;
  papel: string;
}

export interface LogImportacaoItem {
  tipo: 'success' | 'error' | 'info';
  mensagem: string;
}

const staff_contingencia_fallback: UsuarioStaff[] = [
  { id_usuario: '00000000-0000-0000-0000-000000000201', nome: 'Monitor Lucas Silva', email: 'lucas.staff@ifms.edu.br', papel: 'STAFF' },
  { id_usuario: '00000000-0000-0000-0000-000000000202', nome: 'Monitora Fernanda Lima', email: 'fernanda.staff@ifms.edu.br', papel: 'STAFF' },
  { id_usuario: '00000000-0000-0000-0000-000000000203', nome: 'Apoio Gabriel Costa', email: 'gabriel.costa@ifms.edu.br', papel: 'STAFF' },
];

export const GestorStaff: React.FC<{ ao_fechar?: () => void }> = ({ ao_fechar }) => {
  const [equipe_staff, set_equipe_staff] = useState<UsuarioStaff[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // State OBRIGATÓRIO de Logs da Importação
  const [logsImportacao, setLogsImportacao] = useState<LogImportacaoItem[]>([]);

  // Formulário Inline
  const [novo_nome, set_novo_nome] = useState<string>('');
  const [novo_email, set_novo_email] = useState<string>('');
  const [salvando_manual, set_salvando_manual] = useState<boolean>(false);

  // Estado Modal de Edição (CRUD - Editar)
  const [modal_edicao_aberto, set_modal_edicao_aberto] = useState<boolean>(false);
  const [usuario_em_edicao, set_usuario_em_edicao] = useState<{ id_usuario: string; nome: string; email: string } | null>(null);
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  // Importação
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);

  const input_file_ref = useRef<HTMLInputElement>(null);
  const conexao_banco = verificar_conexao_configurada();

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  const adicionarLog = (tipo: 'success' | 'error' | 'info', mensagem: string) => {
    setLogsImportacao((prev) => [...prev, { tipo, mensagem }]);
  };

  // Carregar usuários Staff
  const carregar_staff = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_equipe_staff((prev) => (prev.length > 0 ? prev : staff_contingencia_fallback));
      set_carregando(false);
      return;
    }

    try {
      // OBRIGATORIAMENTE sem criado_em e ordenando por nome
      const { data, error } = await supabase
        .from('usuarios')
        .select('id_usuario, nome, email, papel')
        .order('nome', { ascending: true });

      if (error) {
        console.error('Erro ao buscar equipe Staff no Supabase:', error.message);
        set_mensagem_erro(`Erro ao carregar equipe Staff: ${error.message}`);
        set_equipe_staff(staff_contingencia_fallback);
      } else {
        const apenas_staff = (data || []).filter(
          (u) => u.papel?.toUpperCase() === 'STAFF' || u.papel?.toUpperCase() === 'MONITOR'
        );
        set_equipe_staff(apenas_staff.length > 0 ? apenas_staff : staff_contingencia_fallback);
      }
    } catch (err: any) {
      console.error('Falha ao carregar Staff:', err);
      set_equipe_staff(staff_contingencia_fallback);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    carregar_staff();
  }, [conexao_banco]);

  // Inclusão Manual: Mini-formulário inline (Nome, E-mail) -> papel = 'STAFF'
  const handle_adicionar_manual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novo_nome.trim() || !novo_email.trim()) {
      set_mensagem_erro('Preencha o Nome e o E-mail do membro do Staff.');
      return;
    }

    set_salvando_manual(true);
    set_mensagem_erro(null);

    const email_limpo = novo_email.toLowerCase().trim();
    const nome_limpo = novo_nome.trim();

    if (!conexao_banco) {
      const novo_obj: UsuarioStaff = {
        id_usuario: crypto.randomUUID(),
        nome: nome_limpo,
        email: email_limpo,
        papel: 'STAFF',
      };
      set_equipe_staff((prev) => [novo_obj, ...prev]);
      set_novo_nome('');
      set_novo_email('');
      set_salvando_manual(false);
      exibir_notificacao('Membro do Staff adicionado com sucesso (modo contingência)!');
      return;
    }

    try {
      const { error } = await supabase
        .from('usuarios')
        .insert([{
          nome: nome_limpo,
          email: email_limpo,
          papel: 'STAFF',
        }]);

      if (error) {
        if (error.code === '23505') {
          // E-mail existente: atualiza papel para STAFF
          const { error: errUpdate } = await supabase
            .from('usuarios')
            .update({ nome: nome_limpo, papel: 'STAFF' })
            .eq('email', email_limpo);

          if (errUpdate) throw errUpdate;
        } else {
          throw error;
        }
      }

      exibir_notificacao('Membro do Staff pré-aprovado no Supabase com sucesso!');
      set_novo_nome('');
      set_novo_email('');
      await carregar_staff();
    } catch (err: any) {
      console.error('Erro ao adicionar membro do Staff:', err);
      set_mensagem_erro(`Falha ao adicionar Staff: ${err?.message || 'Erro no banco'}`);
    } finally {
      set_salvando_manual(false);
    }
  };

  // RESTAURAÇÃO DO PAINEL DE LOGS DA IMPORTAÇÃO ROBUSTO (.CSV / .XLSX) PARA STAFF
  const handle_upload_arquivo = async (file: File) => {
    set_processando_arquivo(true);
    set_mensagem_erro(null);
    setLogsImportacao([]); // Limpa logs anteriores

    adicionarLog('info', `Iniciando leitura do arquivo de Staff: ${file.name}`);

    try {
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          if (!e.target?.result) {
            adicionarLog('error', 'Falha ao carregar conteúdo do arquivo.');
            set_processando_arquivo(false);
            return;
          }

          let workbook: XLSX.WorkBook;
          if (isCSV) {
            const text = e.target.result as string;
            workbook = XLSX.read(text, { type: 'string', raw: true });
          } else {
            const data = new Uint8Array(e.target.result as ArrayBuffer);
            workbook = XLSX.read(data, { type: 'array', cellDates: true });
          }

          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const dadosBrutos: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (dadosBrutos.length === 0) {
            adicionarLog('error', 'Erro: O arquivo selecionado não contém dados.');
            set_mensagem_erro('O arquivo selecionado não contém dados.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Planilha de Staff lida com sucesso! Total de ${dadosBrutos.length} linhas para processar.`);

          let sucessosCount = 0;
          let errosCount = 0;

          for (let index = 0; index < dadosBrutos.length; index++) {
            const linha = dadosBrutos[index];
            const numLinha = index + 2;
            const keys = Object.keys(linha);

            let nome = '';
            let email = '';

            keys.forEach((k) => {
              const kLower = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              if (kLower.includes('nome') || kLower.includes('staff') || kLower.includes('monitor')) {
                nome = String(linha[k]).trim();
              } else if (kLower.includes('email') || kLower.includes('mail') || kLower.includes('contato')) {
                email = String(linha[k]).trim().toLowerCase();
              }
            });

            if (!nome && keys.length > 0) nome = String(linha[keys[0]]).trim();
            if (!email && keys.length > 1) email = String(linha[keys[1]]).trim().toLowerCase();

            if (!email || !email.includes('@')) {
              errosCount++;
              adicionarLog('error', `Linha ${numLinha}: E-mail inválido ou ausente ("${email || 'vazio'}") - Ignorada.`);
              continue;
            }

            const nomeFinal = nome || 'Membro do Staff';

            if (conexao_banco) {
              try {
                const { error: errUpsert } = await supabase
                  .from('usuarios')
                  .upsert({
                    nome: nomeFinal,
                    email: email,
                    papel: 'STAFF',
                  }, { onConflict: 'email' });

                if (errUpsert) {
                  errosCount++;
                  adicionarLog('error', `Linha ${numLinha}: Falha no banco - ${errUpsert.message}`);
                } else {
                  sucessosCount++;
                  adicionarLog('success', `Linha ${numLinha}: Staff ${email} (${nomeFinal}) pré-aprovado com sucesso.`);
                }
              } catch (errLinha: any) {
                errosCount++;
                adicionarLog('error', `Linha ${numLinha}: Erro inesperado - ${errLinha?.message || 'Falha na inserção'}`);
              }
            } else {
              sucessosCount++;
              const novoItem: UsuarioStaff = {
                id_usuario: crypto.randomUUID(),
                nome: nomeFinal,
                email: email,
                papel: 'STAFF',
              };
              set_equipe_staff((prev) => [novoItem, ...prev]);
              adicionarLog('success', `Linha ${numLinha}: [Modo Contingência] ${email} (${nomeFinal}) inserido na equipe.`);
            }
          }

          adicionarLog('info', `Importação finalizada. Sucessos: ${sucessosCount} | Erros: ${errosCount}`);
          exibir_notificacao(`Importação concluída: ${sucessosCount} membros do Staff pré-aprovados!`);

          if (conexao_banco) {
            await carregar_staff();
          }
        } catch (errParsing: any) {
          console.error('Erro ao processar planilha de Staff:', errParsing);
          adicionarLog('error', `Erro crítico ao processar planilha: ${errParsing.message}`);
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
    } catch (errUpload: any) {
      console.error('Erro no upload de arquivo Staff:', errUpload);
      adicionarLog('error', `Erro no upload: ${errUpload.message || 'Falha ao ler arquivo'}`);
      set_mensagem_erro('Falha ao ler arquivo do computador.');
      set_processando_arquivo(false);
    }
  };

  // CRUD - A. EDIÇÃO: Abrir modal
  const handle_abrir_edicao = (item: UsuarioStaff) => {
    set_usuario_em_edicao({
      id_usuario: item.id_usuario,
      nome: item.nome,
      email: item.email,
    });
    set_modal_edicao_aberto(true);
  };

  // CRUD - A. EDIÇÃO: Disparar update no Supabase
  const handle_salvar_edicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario_em_edicao) return;

    if (!usuario_em_edicao.nome.trim() || !usuario_em_edicao.email.trim()) {
      set_mensagem_erro('Nome e E-mail não podem ficar vazios.');
      return;
    }

    set_salvando_edicao(true);
    set_mensagem_erro(null);

    const nome_atualizado = usuario_em_edicao.nome.trim();
    const email_atualizado = usuario_em_edicao.email.toLowerCase().trim();

    if (!conexao_banco) {
      set_equipe_staff((prev) =>
        prev.map((s) =>
          s.id_usuario === usuario_em_edicao.id_usuario
            ? { ...s, nome: nome_atualizado, email: email_atualizado }
            : s
        )
      );
      set_modal_edicao_aberto(false);
      set_usuario_em_edicao(null);
      set_salvando_edicao(false);
      exibir_notificacao('Dados do Staff atualizados com sucesso (modo contingência).');
      return;
    }

    try {
      const { error } = await supabase
        .from('usuarios')
        .update({
          nome: nome_atualizado,
          email: email_atualizado,
        })
        .eq('id_usuario', usuario_em_edicao.id_usuario);

      if (error) {
        set_mensagem_erro(`Erro ao atualizar membro do Staff: ${error.message}`);
      } else {
        // Atualiza o state local imediatamente
        set_equipe_staff((prev) =>
          prev.map((s) =>
            s.id_usuario === usuario_em_edicao.id_usuario
              ? { ...s, nome: nome_atualizado, email: email_atualizado }
              : s
          )
        );
        exibir_notificacao('Membro do Staff atualizado com sucesso!');
        set_modal_edicao_aberto(false);
        set_usuario_em_edicao(null);
      }
    } catch (err: any) {
      console.error('Exceção ao atualizar Staff:', err);
      set_mensagem_erro('Falha ao atualizar dados do Staff.');
    } finally {
      set_salvando_edicao(false);
    }
  };

  // LIGAÇÃO FUNCIONAL DO REMOVER PRIVILÉGIO (Staff)
  const handleRemoverPrivilegio = async (id: string) => {
    if (!conexao_banco) {
      set_equipe_staff((prev) => prev.filter((u) => u.id_usuario !== id));
      exibir_notificacao('Privilégio de Staff removido (modo contingência).');
      return;
    }

    const { error } = await supabase.from('usuarios').update({ papel: 'AVALIADOR' }).eq('id_usuario', id);
    if (error) {
      alert(`Erro ao rebaixar privilégio: ${error.message}`);
    } else {
      // Remove o usuário da lista visual do Staff instantaneamente
      set_equipe_staff((prev) => prev.filter((u) => u.id_usuario !== id));
      exibir_notificacao('Privilégio alterado para AVALIADOR com sucesso!');
    }
  };

  // LIGAÇÃO FUNCIONAL DO BOTÃO EXCLUIR (Staff)
  const handleExcluir = async (id: string) => {
    if (!conexao_banco) {
      set_equipe_staff((prev) => prev.filter((u) => u.id_usuario !== id));
      exibir_notificacao('Membro do Staff excluído (modo contingência).');
      return;
    }

    const { error } = await supabase.from('usuarios').delete().eq('id_usuario', id);
    if (error) {
      alert(`Erro ao excluir: ${error.message} (Pode haver conflito de chave estrangeira)`);
    } else {
      set_equipe_staff((prev) => prev.filter((u) => u.id_usuario !== id));
      exibir_notificacao('Membro do Staff excluído com sucesso!');
    }
  };

  // Filtro
  const staff_filtrados = equipe_staff.filter((s) => {
    if (!termo_busca.trim()) return true;
    const t = termo_busca.toLowerCase();
    return (
      (s.nome && s.nome.toLowerCase().includes(t)) ||
      (s.email && s.email.toLowerCase().includes(t))
    );
  });

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans">
      {/* Toast Notification */}
      {mensagem_notificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-indigo-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-indigo-300 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Alerta de erro */}
      {mensagem_erro && (
        <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl flex items-center justify-between gap-3 text-xs sm:text-sm text-red-800 dark:text-red-200 font-semibold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{mensagem_erro}</span>
          </div>
          <button
            type="button"
            onClick={() => set_mensagem_erro(null)}
            className="text-xs text-red-600 dark:text-red-300 underline font-bold"
          >
            Dispensar
          </button>
        </div>
      )}

      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <UserCog className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Gestão Dedicada da Equipe Staff
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Painel exclusivo para pré-aprovação, cadastro, edição e gerenciamento dos membros da Equipe de Apoio (`papel = STAFF`).
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={carregar_staff}
            disabled={carregando}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-all cursor-pointer"
            title="Recarregar Lista"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
          {ao_fechar && (
            <button
              type="button"
              onClick={ao_fechar}
              className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer"
              title="Fechar Janela"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* BLOCO DE ENTRADA: IMPORTAÇÃO COM LOGS + INCLUSÃO MANUAL */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* A. Área de Importação (.CSV / .XLSX) Exclusiva para pré-aprovar equipe Staff com TERMINAL DE LOGS */}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 font-extrabold text-xs uppercase tracking-wider">
              <FileSpreadsheet className="w-4 h-4" />
              <span>A. Importação da Equipe Staff em Massa</span>
            </div>
            {logsImportacao.length > 0 && (
              <button
                type="button"
                onClick={() => setLogsImportacao([])}
                className="text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline font-semibold"
              >
                Limpar Logs
              </button>
            )}
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300">
            Selecione uma planilha (.CSV ou .XLSX) para pré-aprovar a lista de e-mails da equipe Staff.
          </p>

          <input
            ref={input_file_ref}
            type="file"
            accept=".csv, .xlsx, .xls"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handle_upload_arquivo(e.target.files[0]);
              }
            }}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => input_file_ref.current?.click()}
            disabled={processando_arquivo}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl font-bold text-xs transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {processando_arquivo ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>{processando_arquivo ? 'Processando Planilha...' : 'Upload de Planilha Staff (.CSV / .XLSX)'}</span>
          </button>

          {/* PAINEL DE LOGS DA IMPORTAÇÃO ROBUSTO (REQUISITO 3) */}
          {logsImportacao.length > 0 && (
            <div className="bg-gray-900 text-green-400 p-4 rounded-xl h-48 overflow-y-auto font-mono text-xs space-y-1.5 border border-slate-800 shadow-inner">
              <div className="flex items-center gap-2 text-slate-400 font-sans text-[10px] font-bold uppercase tracking-wider pb-1 border-b border-gray-800 mb-2">
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                <span>Console de Logs da Importação</span>
              </div>
              {logsImportacao.map((log, idx) => (
                <div
                  key={idx}
                  className={`leading-relaxed flex items-start gap-1.5 ${
                    log.tipo === 'error'
                      ? 'text-red-400'
                      : log.tipo === 'success'
                      ? 'text-emerald-400'
                      : 'text-cyan-300'
                  }`}
                >
                  <span className="opacity-50 shrink-0">&gt;</span>
                  <span>{log.mensagem}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* B. Inclusão Manual: Mini-formulário inline (Nome, E-mail) com ALERTA DE FLUXO */}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 font-extrabold text-xs uppercase tracking-wider">
            <UserPlus className="w-4 h-4" />
            <span>B. Inclusão Manual Inline de Staff</span>
          </div>

          <form onSubmit={handle_adicionar_manual} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={novo_nome}
                  onChange={(e) => set_novo_nome(e.target.value)}
                  placeholder="Nome do Membro do Staff"
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  value={novo_email}
                  onChange={(e) => set_novo_email(e.target.value)}
                  placeholder="E-mail do Membro do Staff"
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* ALERTA DE FLUXO NO STAFF */}
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 rounded-xl flex items-start gap-2 text-indigo-900 dark:text-indigo-200">
              <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <span className="text-[11px] leading-tight font-medium">
                <strong>Aviso:</strong> A inclusão aqui pré-aprova o e-mail. O membro do Staff ainda precisará criar sua senha na tela de Login.
              </span>
            </div>

            <button
              type="submit"
              disabled={salvando_manual}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white font-extrabold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {salvando_manual ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              <span>Pré-aprovar Membro do Staff</span>
            </button>
          </form>
        </div>
      </div>

      {/* C. CRUD (Tabela) - Lista APENAS onde papel === 'STAFF' */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <span>C. Lista da Equipe Staff Pré-aprovada</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-300">
              {staff_filtrados.length} membros
            </span>
          </h3>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={termo_busca}
              onChange={(e) => set_termo_busca(e.target.value)}
              placeholder="Pesquisar por nome ou e-mail..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {carregando ? (
          <div className="p-12 text-center space-y-2 border border-slate-200 dark:border-slate-700 rounded-2xl">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500">Consultando equipe Staff na base de dados...</p>
          </div>
        ) : staff_filtrados.length === 0 ? (
          <div className="p-10 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Nenhum membro do Staff localizado.</p>
            <p className="text-[11px] text-slate-400">Utilize a inclusão manual ou a importação por planilha acima.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[600px]">
                <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">E-mail</th>
                    <th className="px-4 py-3">Papel</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {staff_filtrados.map((usuario) => (
                    <tr key={usuario.id_usuario} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">
                        {usuario.nome}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-300">
                        {usuario.email}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-300">
                          {usuario.papel || 'STAFF'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Botão A. Editar */}
                          <button
                            type="button"
                            onClick={() => handle_abrir_edicao(usuario)}
                            title="Editar nome e e-mail"
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600 font-bold text-xs transition-all inline-flex items-center gap-1.5"
                          >
                            <Pencil className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                            <span>Editar</span>
                          </button>

                          {/* Botão Remover Privilégio */}
                          <button
                            type="button"
                            onClick={() => handleRemoverPrivilegio(usuario.id_usuario)}
                            title="Voltar papel para AVALIADOR"
                            className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold text-xs transition-all inline-flex items-center gap-1.5"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            <span>Remover Privilégio</span>
                          </button>

                          {/* Botão B. Excluir */}
                          <button
                            type="button"
                            onClick={() => handleExcluir(usuario.id_usuario)}
                            title="Excluir do sistema"
                            className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 font-bold text-xs transition-all inline-flex items-center gap-1.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Excluir</span>
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
      </div>

      {/* MODAL DE EDIÇÃO DE STAFF */}
      {modal_edicao_aberto && usuario_em_edicao && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-indigo-600" />
                Editar Membro do Staff
              </h3>
              <button
                type="button"
                onClick={() => {
                  set_modal_edicao_aberto(false);
                  set_usuario_em_edicao(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handle_salvar_edicao} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nome Completo
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    value={usuario_em_edicao.nome}
                    onChange={(e) =>
                      set_usuario_em_edicao({ ...usuario_em_edicao, nome: e.target.value })
                    }
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Nome do membro do staff"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Endereço de E-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="email"
                    value={usuario_em_edicao.email}
                    onChange={(e) =>
                      set_usuario_em_edicao({ ...usuario_em_edicao, email: e.target.value })
                    }
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="email@exemplo.com"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    set_modal_edicao_aberto(false);
                    set_usuario_em_edicao(null);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={salvando_edicao}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
                >
                  {salvando_edicao ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Salvar Alterações</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Rodapé com Fechamento se dentro de modal */}
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
