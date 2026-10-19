import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
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
  Pencil,
  UserCheck,
  UserX,
  X,
  Clock,
  Terminal,
  ShieldOff
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export interface UsuarioAvaliador {
  id_usuario: string;
  nome: string;
  email: string;
  papel: string;
  is_credenciado?: boolean;
  avaliadores_evento?: { id_evento: string; is_credenciado: boolean }[];
}

export interface LogImportacaoItem {
  tipo: 'success' | 'error' | 'info';
  mensagem: string;
}

const avaliadores_contingencia_fallback: UsuarioAvaliador[] = [
  { id_usuario: '00000000-0000-0000-0000-000000000101', nome: 'Dr. Roberto Magalhães', email: 'roberto.magalhaes@ufms.br', papel: 'AVALIADOR', is_credenciado: true },
  { id_usuario: '00000000-0000-0000-0000-000000000102', nome: 'Dra. Patricia Alencar', email: 'patricia.alencar@ucdb.br', papel: 'AVALIADOR', is_credenciado: false },
  { id_usuario: '00000000-0000-0000-0000-000000000103', nome: 'Prof. Marcos Vinicius', email: 'marcos.vinicius@ifms.edu.br', papel: 'AVALIADOR', is_credenciado: false },
];

export const GestorAvaliadores: React.FC<{ id_evento_ativo?: string; ao_fechar?: () => void }> = ({ id_evento_ativo, ao_fechar }) => {
  const [avaliadores, setListaAvaliadores] = useState<UsuarioAvaliador[]>([]);
  const set_avaliadores = setListaAvaliadores;
  const [carregando, set_carregando] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // ID do Evento Ativo
  const [eventoAtivoId, setEventoAtivoId] = useState<string>(
    id_evento_ativo || localStorage.getItem('evento_ativo_id') || ''
  );

  // State OBRIGATÓRIO de Logs da Importação
  const [logsImportacao, setLogsImportacao] = useState<LogImportacaoItem[]>([]);

  // Formulário Inline de Inclusão Manual
  const [novo_nome, set_novo_nome] = useState<string>('');
  const [novo_email, set_novo_email] = useState<string>('');
  const [salvando_manual, set_salvando_manual] = useState<boolean>(false);

  // Estado Modal de Edição (CRUD - Editar)
  const [modal_edicao_aberto, set_modal_edicao_aberto] = useState<boolean>(false);
  const [usuario_em_edicao, set_usuario_em_edicao] = useState<{ id_usuario: string; nome: string; email: string } | null>(null);
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  // Estado Toggle Credenciamento em andamento
  const [processando_credenciamento_id, set_processando_credenciamento_id] = useState<string | null>(null);

  // Estado de Importação por Arquivo
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

  // 1. ORDEM DE EXECUÇÃO ASSÍNCRONA: Resolver ID do Evento Ativo
  useEffect(() => {
    if (id_evento_ativo) {
      setEventoAtivoId(id_evento_ativo);
      return;
    }

    const savedId = localStorage.getItem('evento_ativo_id');
    if (savedId) {
      setEventoAtivoId(savedId);
      return;
    }

    if (!conexao_banco) return;

    const resolverEventoAtivo = async () => {
      try {
        const { data: evData } = await supabase
          .from('eventos')
          .select('id_evento')
          .eq('is_ativo', true)
          .limit(1)
          .maybeSingle();

        if (evData?.id_evento) {
          setEventoAtivoId(evData.id_evento);
          localStorage.setItem('evento_ativo_id', evData.id_evento);
        }
      } catch (err) {
        console.error('Erro ao buscar evento ativo:', err);
      }
    };

    resolverEventoAtivo();
  }, [id_evento_ativo, conexao_banco]);

  // Buscar lista de avaliadores via View SQL (view_avaliadores_credenciados)
  const carregar_avaliadores = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      setListaAvaliadores((prev) => (prev.length > 0 ? prev : avaliadores_contingencia_fallback));
      set_carregando(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('view_avaliadores_credenciados')
        .select('*')
        .order('nome', { ascending: true });

      if (error) {
        console.error('Erro ao buscar avaliadores no Supabase:', error.message);
        set_mensagem_erro(`Erro ao carregar avaliadores: ${error.message}`);
        setListaAvaliadores(avaliadores_contingencia_fallback);
        return;
      }

      setListaAvaliadores(data && data.length > 0 ? (data as UsuarioAvaliador[]) : avaliadores_contingencia_fallback);
    } catch (err: any) {
      console.error('Falha ao carregar avaliadores:', err);
      setListaAvaliadores(avaliadores_contingencia_fallback);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    carregar_avaliadores();
  }, [conexao_banco]);

  // Inclusão Manual: Mini-formulário inline (Nome, E-mail) -> papel = 'AVALIADOR'
  const handle_adicionar_manual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novo_nome.trim() || !novo_email.trim()) {
      set_mensagem_erro('Preencha o Nome e o E-mail do avaliador.');
      return;
    }

    set_salvando_manual(true);
    set_mensagem_erro(null);

    const email_limpo = novo_email.toLowerCase().trim();
    const nome_limpo = novo_nome.trim();

    if (!conexao_banco) {
      const novo_obj: UsuarioAvaliador = {
        id_usuario: crypto.randomUUID(),
        nome: nome_limpo,
        email: email_limpo,
        papel: 'AVALIADOR',
        is_credenciado: false,
      };
      set_avaliadores((prev) => [novo_obj, ...prev]);
      set_novo_nome('');
      set_novo_email('');
      set_salvando_manual(false);
      exibir_notificacao('Avaliador adicionado com sucesso (modo contingência)!');
      return;
    }

    try {
      const { error } = await supabase
        .from('usuarios')
        .insert([{
          nome: nome_limpo,
          email: email_limpo,
          papel: 'AVALIADOR',
        }]);

      if (error) {
        if (error.code === '23505') {
          const { error: errUpdate } = await supabase
            .from('usuarios')
            .update({ nome: nome_limpo, papel: 'AVALIADOR' })
            .eq('email', email_limpo);

          if (errUpdate) throw errUpdate;
        } else {
          throw error;
        }
      }

      exibir_notificacao('Avaliador cadastrado no Supabase com sucesso!');
      set_novo_nome('');
      set_novo_email('');
      await carregar_avaliadores();
    } catch (err: any) {
      console.error('Erro ao adicionar avaliador:', err);
      set_mensagem_erro(`Falha ao adicionar avaliador: ${err?.message || 'Erro no banco'}`);
    } finally {
      set_salvando_manual(false);
    }
  };

  // RESTAURAÇÃO DO PAINEL DE LOGS DA IMPORTAÇÃO ROBUSTO (.CSV/.XLSX)
  const handle_upload_arquivo = async (file: File) => {
    set_processando_arquivo(true);
    set_mensagem_erro(null);
    setLogsImportacao([]); // Limpa logs anteriores

    adicionarLog('info', `Iniciando leitura do arquivo: ${file.name}`);

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
            adicionarLog('error', 'Erro: O arquivo selecionado está vazio.');
            set_mensagem_erro('O arquivo selecionado não contém dados.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Planilha lida com sucesso! Total de ${dadosBrutos.length} linhas para processar.`);

          let sucessosCount = 0;
          let errosCount = 0;

          // Laço de importação linha a linha detalhado nos logs
          for (let index = 0; index < dadosBrutos.length; index++) {
            const linha = dadosBrutos[index];
            const numLinha = index + 2; // Linha 1 é o cabeçalho
            const keys = Object.keys(linha);

            let nome = '';
            let email = '';

            keys.forEach((k) => {
              const kLower = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              if (kLower.includes('nome') || kLower.includes('avaliador')) {
                nome = String(linha[k]).trim();
              } else if (kLower.includes('email') || kLower.includes('mail') || kLower.includes('contato')) {
                email = String(linha[k]).trim().toLowerCase();
              }
            });

            if (!nome && keys.length > 0) nome = String(linha[keys[0]]).trim();
            if (!email && keys.length > 1) email = String(linha[keys[1]]).trim().toLowerCase();

            if (!email || !email.includes('@')) {
              errosCount++;
              adicionarLog('error', `Linha ${numLinha}: E-mail inválido ou ausente ("${email || 'vazio'}") - Linha ignorada.`);
              continue;
            }

            const nomeFinal = nome || 'Avaliador Convidado';

            if (conexao_banco) {
              try {
                const { error: errInsert } = await supabase
                  .from('usuarios')
                  .upsert({
                    nome: nomeFinal,
                    email: email,
                    papel: 'AVALIADOR',
                  }, { onConflict: 'email' });

                if (errInsert) {
                  errosCount++;
                  adicionarLog('error', `Linha ${numLinha}: Falha no banco - ${errInsert.message}`);
                } else {
                  sucessosCount++;
                  adicionarLog('success', `Linha ${numLinha}: E-mail ${email} (${nomeFinal}) adicionado/atualizado com sucesso.`);
                }
              } catch (errLinha: any) {
                errosCount++;
                adicionarLog('error', `Linha ${numLinha}: Erro inesperado - ${errLinha?.message || 'Falha na inserção'}`);
              }
            } else {
              sucessosCount++;
              const novoItem: UsuarioAvaliador = {
                id_usuario: crypto.randomUUID(),
                nome: nomeFinal,
                email: email,
                papel: 'AVALIADOR',
                is_credenciado: false,
              };
              set_avaliadores((prev) => [novoItem, ...prev]);
              adicionarLog('success', `Linha ${numLinha}: [Modo Contingência] ${email} (${nomeFinal}) inserido na lista.`);
            }
          }

          adicionarLog('info', `Importação finalizada. Sucessos: ${sucessosCount} | Erros: ${errosCount}`);
          exibir_notificacao(`Importação concluída: ${sucessosCount} avaliadores processados com sucesso!`);

          if (conexao_banco) {
            await carregar_avaliadores();
          }
        } catch (errParsing: any) {
          console.error('Erro ao processar planilha de avaliadores:', errParsing);
          adicionarLog('error', `Erro crítico no parsing do arquivo: ${errParsing.message}`);
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
      console.error('Erro no upload de arquivo:', errUpload);
      adicionarLog('error', `Erro no upload: ${errUpload.message || 'Falha ao ler arquivo'}`);
      set_mensagem_erro('Falha ao ler arquivo do computador.');
      set_processando_arquivo(false);
    }
  };

  // Alterar credenciamento do avaliador replicando EXATAMENTE a lógica da tela do Staff
  const handle_toggle_credenciamento = async (usuario: UsuarioAvaliador) => {
    const novoStatusCredenciamento = !usuario.is_credenciado;
    const id_alvo = usuario.id_usuario;
    set_processando_credenciamento_id(id_alvo);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      setListaAvaliadores((prev) =>
        prev.map((a) =>
          a.id_usuario === id_alvo ? { ...a, is_credenciado: novoStatusCredenciamento } : a
        )
      );
      exibir_notificacao(
        novoStatusCredenciamento ? 'Avaliador liberado! (Modo Contingência)' : 'Credenciamento suspenso. (Modo Contingência)'
      );
      set_processando_credenciamento_id(null);
      return;
    }

    try {
      let erro_retornado: any = null;
      const { error: erro_avaliadores } = await supabase
        .from('avaliadores_evento')
        .update({ is_credenciado: novoStatusCredenciamento })
        .eq('id_usuario', id_alvo);

      if (erro_avaliadores) {
        const { error: erro_singular } = await supabase
          .from('avaliador_evento')
          .update({ is_credenciado: novoStatusCredenciamento })
          .eq('id', id_alvo);

        erro_retornado = erro_singular;
      }

      // Se falhar o update por inexistência de vínculo no evento, tenta upsert de amarração
      if (erro_retornado) {
        const idEvt = eventoAtivoId || 'evt-2026-ifms';
        const { error: erro_upsert } = await supabase
          .from('avaliadores_evento')
          .upsert({ 
            id_usuario: id_alvo, 
            id_evento: idEvt, 
            is_credenciado: novoStatusCredenciamento
          }, { onConflict: 'id_usuario, id_evento' });

        if (!erro_upsert) {
          erro_retornado = null;
        }
      }

      if (erro_retornado) {
        console.error('Erro no Supabase ao atualizar credenciamento do avaliador:', erro_retornado.message);
        set_mensagem_erro(`Falha ao atualizar credenciamento: ${erro_retornado.message}`);
        exibir_notificacao('Não foi possível salvar o credenciamento no servidor.');
        return;
      }

      // Atualiza o state local imediatamente após o sucesso da chamada ao Supabase
      setListaAvaliadores((prev) =>
        prev.map((a) =>
          a.id_usuario === id_alvo ? { ...a, is_credenciado: novoStatusCredenciamento } : a
        )
      );

      exibir_notificacao(
        novoStatusCredenciamento
          ? 'Avaliador liberado e sincronizado no Supabase!'
          : 'Acesso do avaliador revogado no Supabase.'
      );
    } catch (err: any) {
      console.error('Falha de execução ao credenciar avaliador:', err);
      set_mensagem_erro(`Erro ao atualizar credenciamento: ${err?.message || 'Falha de comunicação'}`);
    } finally {
      set_processando_credenciamento_id(null);
    }
  };

  // CRUD - A. EDIÇÃO: Abrir modal
  const handle_abrir_edicao = (item: UsuarioAvaliador) => {
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
      set_avaliadores((prev) =>
        prev.map((a) =>
          a.id_usuario === usuario_em_edicao.id_usuario
            ? { ...a, nome: nome_atualizado, email: email_atualizado }
            : a
        )
      );
      set_modal_edicao_aberto(false);
      set_usuario_em_edicao(null);
      set_salvando_edicao(false);
      exibir_notificacao('Dados atualizados com sucesso (modo contingência).');
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
        set_mensagem_erro(`Erro ao atualizar usuário no Supabase: ${error.message}`);
      } else {
        // Atualiza o state local imediatamente
        set_avaliadores((prev) =>
          prev.map((a) =>
            a.id_usuario === usuario_em_edicao.id_usuario
              ? { ...a, nome: nome_atualizado, email: email_atualizado }
              : a
          )
        );
        exibir_notificacao('Avaliador atualizado com sucesso!');
        set_modal_edicao_aberto(false);
        set_usuario_em_edicao(null);
      }
    } catch (err: any) {
      console.error('Exceção ao atualizar avaliador:', err);
      set_mensagem_erro('Falha ao atualizar dados do avaliador.');
    } finally {
      set_salvando_edicao(false);
    }
  };

  // LIGAÇÃO FUNCIONAL DO BOTÃO EXCLUIR
  const handleExcluir = async (id: string) => {
    if (!conexao_banco) {
      set_avaliadores((prev) => prev.filter((u) => u.id_usuario !== id));
      exibir_notificacao('Avaliador removido da lista (modo contingência).');
      return;
    }

    const { error } = await supabase.from('usuarios').delete().eq('id_usuario', id);
    if (error) {
      alert(`Erro ao excluir: ${error.message} (Pode haver conflito de chave estrangeira)`);
    } else {
      set_avaliadores((prev) => prev.filter((u) => u.id_usuario !== id));
      exibir_notificacao('Avaliador excluído com sucesso!');
    }
  };

  const handle_excluir_avaliador = (item: UsuarioAvaliador) => {
    if (window.confirm(`Tem certeza que deseja excluir o avaliador "${item.nome}" do sistema?`)) {
      handleExcluir(item.id_usuario);
    }
  };

  // Função para alterar papel de Avaliador se necessário
  const handle_remover_privilegio = async (id_usuario: string) => {
    if (!window.confirm('Deseja remover o privilégio e alterar este usuário?')) {
      return;
    }

    if (!conexao_banco) {
      set_avaliadores((prev) => prev.filter((a) => a.id_usuario !== id_usuario));
      exibir_notificacao('Papel alterado (modo contingência).');
      return;
    }

    try {
      const { error } = await supabase
        .from('usuarios')
        .update({ papel: 'AVALIADOR' })
        .eq('id_usuario', id_usuario);

      if (error) {
        set_mensagem_erro(`Erro ao atualizar papel no banco: ${error.message}`);
      } else {
        exibir_notificacao('Papel atualizado com sucesso!');
        await carregar_avaliadores();
      }
    } catch (e: any) {
      console.error('Exceção ao remover privilégio:', e);
      set_mensagem_erro('Falha ao alterar papel do usuário.');
    }
  };

  // Filtro na tabela
  const avaliadores_filtrados = avaliadores.filter((a) => {
    if (!termo_busca.trim()) return true;
    const t = termo_busca.toLowerCase();
    return (
      (a.nome && a.nome.toLowerCase().includes(t)) ||
      (a.email && a.email.toLowerCase().includes(t))
    );
  });

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans">
      {/* Toast Notification */}
      {mensagem_notificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
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
            <Users className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            Gestão Dedicada de Avaliadores
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Painel exclusivo para gerenciamento, credenciamento em tempo real, upload em massa com terminal de logs e CRUD de Avaliadores (`papel = AVALIADOR`).
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={carregar_avaliadores}
            disabled={carregando}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-all cursor-pointer"
            title="Recarregar Lista"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
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
        {/* A. Área de Importação ROBUSTA (.CSV / .XLSX) com TERMINAL DE LOGS */}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-extrabold text-xs uppercase tracking-wider">
              <FileSpreadsheet className="w-4 h-4" />
              <span>A. Importação de Avaliadores em Massa</span>
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
            Selecione uma planilha (.CSV ou .XLSX) contendo as colunas de <strong>Nome</strong> e <strong>E-mail</strong> para cadastrar os avaliadores no banco de dados.
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
            className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl font-bold text-xs transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {processando_arquivo ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>{processando_arquivo ? 'Processando Planilha...' : 'Upload de Planilha (.CSV / .XLSX)'}</span>
          </button>

          {/* PAINEL DE LOGS DA IMPORTAÇÃO ROBUSTO (REQUISITO 3) */}
          {logsImportacao.length > 0 && (
            <div className="bg-gray-900 text-green-400 p-4 rounded-xl h-48 overflow-y-auto font-mono text-xs space-y-1.5 border border-slate-800 shadow-inner">
              <div className="flex items-center gap-2 text-slate-400 font-sans text-[10px] font-bold uppercase tracking-wider pb-1 border-b border-gray-800 mb-2">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
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

        {/* B. Inclusão Manual: Mini-formulário inline (Nome, E-mail) */}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-extrabold text-xs uppercase tracking-wider">
            <UserPlus className="w-4 h-4" />
            <span>B. Inclusão Manual Inline</span>
          </div>

          <form onSubmit={handle_adicionar_manual} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={novo_nome}
                  onChange={(e) => set_novo_nome(e.target.value)}
                  placeholder="Nome do Avaliador"
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  value={novo_email}
                  onChange={(e) => set_novo_email(e.target.value)}
                  placeholder="E-mail do Avaliador"
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
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
              <span>Cadastrar Avaliador</span>
            </button>
          </form>
        </div>
      </div>

      {/* C. LISTA DE AVALIADORES (TABELA COM CREDENCIAMENTO E AÇÕES CRUD INLINE) */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <span>C. Lista de Avaliadores Registrados</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
              {avaliadores_filtrados.length} avaliadores
            </span>
          </h3>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={termo_busca}
              onChange={(e) => set_termo_busca(e.target.value)}
              placeholder="Pesquisar por nome ou e-mail..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {carregando ? (
          <div className="p-12 text-center space-y-2 border border-slate-200 dark:border-slate-700 rounded-2xl">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500">Consultando avaliadores na base de dados...</p>
          </div>
        ) : avaliadores_filtrados.length === 0 ? (
          <div className="p-10 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Nenhum avaliador cadastrado localizado.</p>
            <p className="text-[11px] text-slate-400">Utilize o formulário de inclusão manual ou a importação por planilha acima.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Credenciamento</th>
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">E-mail</th>
                    <th className="px-4 py-3">Papel</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {avaliadores_filtrados.map((usuario) => {
                    const isProcessingThis = processando_credenciamento_id === usuario.id_usuario;

                    return (
                      <tr key={usuario.id_usuario} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        {/* Status de Credenciamento */}
                        <td className="px-4 py-3.5">
                          {usuario.is_credenciado === true ? (
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

                        {/* Nome */}
                        <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">
                          {usuario.nome}
                        </td>

                        {/* E-mail */}
                        <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-300">
                          {usuario.email}
                        </td>

                        {/* Papel */}
                        <td className="px-4 py-3.5">
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            AVALIADOR
                          </span>
                        </td>

                        {/* Coluna Ações (Credenciar, Editar, Excluir) */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Botão Credenciar / Remover Credenciamento */}
                            <button
                              type="button"
                              onClick={() => handle_toggle_credenciamento(usuario)}
                              disabled={isProcessingThis}
                              title={usuario.is_credenciado ? 'Remover credenciamento do avaliador' : 'Credenciar avaliador no evento'}
                              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all inline-flex items-center gap-1.5 ${
                                usuario.is_credenciado
                                  ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600'
                              } disabled:opacity-50`}
                            >
                              {isProcessingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : usuario.is_credenciado ? (
                                <UserX className="w-3.5 h-3.5" />
                              ) : (
                                <UserCheck className="w-3.5 h-3.5" />
                              )}
                              <span>{usuario.is_credenciado ? 'Descredenciar' : 'Credenciar'}</span>
                            </button>

                            {/* Botão Editar */}
                            <button
                              type="button"
                              onClick={() => handle_abrir_edicao(usuario)}
                              title="Editar nome e e-mail"
                              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600 font-bold text-xs transition-all inline-flex items-center gap-1.5"
                            >
                              <Pencil className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                              <span>Editar</span>
                            </button>

                            {/* Botão Excluir */}
                            <button
                              type="button"
                              onClick={() => handleExcluir(usuario.id_usuario)}
                              title="Excluir avaliador do sistema"
                              className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 font-bold text-xs transition-all inline-flex items-center gap-1.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Excluir</span>
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
      </div>

      {/* MODAL DE EDIÇÃO DE AVALIADOR */}
      {modal_edicao_aberto && usuario_em_edicao && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-emerald-600" />
                Editar Avaliador
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
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Nome do avaliador"
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
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
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
