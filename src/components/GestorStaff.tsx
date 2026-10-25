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
  Info,
  Pencil,
  X,
  Terminal,
  UserCheck,
  UserX,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Save
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

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

export const GestorStaff: React.FC<{
  ao_fechar?: () => void;
  id_evento_ativo?: string;
  aoAtualizarMetricas?: () => void;
}> = ({
  ao_fechar,
  id_evento_ativo,
  aoAtualizarMetricas,
}) => {
  const [equipe_staff, set_equipe_staff] = useState<UsuarioStaff[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');
  const [eventoAtivoId, setEventoAtivoId] = useState<string>(id_evento_ativo || '');
  const [processando_credenciamento_id, set_processando_credenciamento_id] = useState<string | null>(null);

  // Ordenação de colunas
  const [colunaOrdenacao, setColunaOrdenacao] = useState<'is_credenciado' | 'nome' | 'email' | 'papel'>('nome');
  const [ordemAscendente, setOrdemAscendente] = useState<boolean>(true);

  // State OBRIGATÓRIO de Logs da Importação
  const [logsImportacao, setLogsImportacao] = useState<LogImportacaoItem[]>([]);

  // Formulário Retrátil de Novo Membro Staff
  const [mostrar_form_novo, set_mostrar_form_novo] = useState<boolean>(false);
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

  // Resolver ID do Evento Ativo
  useEffect(() => {
    const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

    if (id_evento_ativo && isUuid(id_evento_ativo)) {
      setEventoAtivoId(id_evento_ativo);
      return;
    }

    const savedId = typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : null;
    if (savedId && isUuid(savedId)) {
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
          if (typeof window !== 'undefined') localStorage.setItem('evento_ativo_id', evData.id_evento);
        }
      } catch (err) {
        console.error('Erro ao buscar evento ativo:', err);
      }
    };

    resolverEventoAtivo();
  }, [id_evento_ativo, conexao_banco]);

  // Carregar usuários Staff
  const carregar_staff = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    const overridesLocais = typeof window !== 'undefined'
      ? JSON.parse(localStorage.getItem('staff_credenciados_local') || '{}')
      : {};

    if (!conexao_banco) {
      set_equipe_staff((prev) =>
        prev.map((s) => ({
          ...s,
          is_credenciado: overridesLocais[s.id_usuario] !== undefined
            ? overridesLocais[s.id_usuario]
            : Boolean(s.is_credenciado),
        }))
      );
      set_carregando(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id_usuario, nome, email, papel')
        .order('nome', { ascending: true });

      if (error) {
        console.error('Erro ao buscar equipe Staff no Supabase:', error.message);
        set_mensagem_erro(`Erro ao carregar equipe Staff: ${error.message}`);
        set_equipe_staff([]);
      } else {
        const apenas_staff = (data || []).filter(
          (u) => u.papel?.toUpperCase() === 'STAFF' || u.papel?.toUpperCase() === 'MONITOR'
        );

        // Busca credenciamento em avaliadores_evento
        const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        const idEvt = eventoAtivoId || (isUuid(id_evento_ativo) ? id_evento_ativo : '') || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || '';

        let aeMap = new Map<string, boolean>();
        if (idEvt && isUuid(idEvt)) {
          const { data: aeData } = await supabase
            .from('avaliadores_evento')
            .select('id_usuario, is_credenciado')
            .eq('id_evento', idEvt);
          (aeData || []).forEach((row: any) => aeMap.set(row.id_usuario, Boolean(row.is_credenciado)));
        }

        const listaFinal: UsuarioStaff[] = apenas_staff.map((u) => {
          const statusCred = overridesLocais[u.id_usuario] !== undefined
            ? overridesLocais[u.id_usuario]
            : (aeMap.has(u.id_usuario) ? aeMap.get(u.id_usuario)! : false);
          return {
            id_usuario: u.id_usuario,
            nome: u.nome,
            email: u.email,
            papel: u.papel,
            is_credenciado: statusCred,
          };
        });

        set_equipe_staff(listaFinal);
      }
    } catch (err: any) {
      console.error('Falha ao carregar Staff:', err);
      set_equipe_staff([]);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    carregar_staff();
  }, [conexao_banco, eventoAtivoId]);

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
      set_mostrar_form_novo(false);
      set_salvando_manual(false);
      exibir_notificacao('Membro do Staff adicionado com sucesso (modo contingência)!');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    try {
      let userIdFinal: string | undefined;
      const { data: userCriado, error } = await supabase
        .from('usuarios')
        .insert([{
          nome: nome_limpo,
          email: email_limpo,
          papel: 'STAFF',
        }])
        .select('id_usuario')
        .maybeSingle();

      if (userCriado?.id_usuario) {
        userIdFinal = userCriado.id_usuario;
      }

      if (error) {
        if (error.code === '23505') {
          // E-mail existente: atualiza papel para STAFF
          const { data: userAtualizado, error: errUpdate } = await supabase
            .from('usuarios')
            .update({ nome: nome_limpo, papel: 'STAFF' })
            .eq('email', email_limpo)
            .select('id_usuario')
            .maybeSingle();

          if (errUpdate) throw errUpdate;
          if (userAtualizado?.id_usuario) {
            userIdFinal = userAtualizado.id_usuario;
          }
        } else {
          throw error;
        }
      }

      const eventoId = id_evento_ativo || localStorage.getItem('evento_ativo_id');
      if (eventoId && userIdFinal) {
        await supabase
          .from('avaliadores_evento')
          .upsert({
            id_usuario: userIdFinal,
            id_evento: eventoId,
            is_credenciado: false,
          }, { onConflict: 'id_usuario, id_evento' });
      }

      exibir_notificacao('Membro do Staff pré-aprovado no Supabase com sucesso!');
      set_novo_nome('');
      set_novo_email('');
      set_mostrar_form_novo(false);
      await carregar_staff();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
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

          const usuariosMap = new Map<string, { nome: string; email: string; papel: string }>();

          // Processamento ultrarrápido em memória
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
            usuariosMap.set(email, {
              nome: nomeFinal,
              email: email,
              papel: 'STAFF',
            });
            adicionarLog('info', `Linha ${numLinha}: Staff "${nomeFinal}" (${email}) validado.`);
          }

          const listaStaff = Array.from(usuariosMap.values());

          if (listaStaff.length === 0) {
            adicionarLog('error', 'Nenhum membro do Staff válido encontrado para importação.');
            set_mensagem_erro('Nenhum membro do Staff válido encontrado.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Consolidando ${listaStaff.length} membros do Staff para envio via UPSERT em lote...`);

          if (conexao_banco) {
            try {
              const { data: usuariosUpsert, error: errUpsert } = await supabase
                .from('usuarios')
                .upsert(listaStaff, { onConflict: 'email' })
                .select('id_usuario, email');

              if (errUpsert) {
                adicionarLog('error', `Falha no banco ao realizar UPSERT em lote: ${errUpsert.message}`);
                set_mensagem_erro(`Erro ao importar equipe Staff: ${errUpsert.message}`);
              } else {
                const eventoId = id_evento_ativo || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : null);
                if (eventoId && usuariosUpsert && usuariosUpsert.length > 0) {
                  const linksEvento = usuariosUpsert.map((u: any) => ({
                    id_usuario: u.id_usuario,
                    id_evento: eventoId,
                    is_credenciado: false,
                  }));
                  await supabase
                    .from('avaliadores_evento')
                    .upsert(linksEvento, { onConflict: 'id_usuario, id_evento' });
                }
                sucessosCount = listaStaff.length;
                adicionarLog('success', `Lote processado com sucesso! ${listaStaff.length} membros do Staff cadastrados/atualizados via upsert.`);
                exibir_notificacao(`Importação concluída: ${listaStaff.length} membros do Staff cadastrados com sucesso!`);
                await carregar_staff();
                if (aoAtualizarMetricas) aoAtualizarMetricas();
              }
            } catch (errLinha: any) {
              adicionarLog('error', `Erro inesperado no upsert: ${errLinha?.message || errLinha}`);
              set_mensagem_erro(`Erro inesperado: ${errLinha?.message || errLinha}`);
            }
          } else {
            // Modo contingência
            listaStaff.forEach((s) => {
              sucessosCount++;
              const novoItem: UsuarioStaff = {
                id_usuario: crypto.randomUUID(),
                nome: s.nome,
                email: s.email,
                papel: 'STAFF',
              };
              set_equipe_staff((prev) => [novoItem, ...prev]);
            });
            adicionarLog('success', `[Modo Contingência] ${listaStaff.length} membros do Staff inseridos.`);
            exibir_notificacao(`Importação concluída: ${listaStaff.length} membros do Staff inseridos!`);
          }
          if (aoAtualizarMetricas) aoAtualizarMetricas();
          if (aoAtualizarMetricas) aoAtualizarMetricas();
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
        if (aoAtualizarMetricas) aoAtualizarMetricas();
      }
    } catch (err: any) {
      console.error('Exceção ao atualizar Staff:', err);
      set_mensagem_erro('Falha ao atualizar dados do Staff.');
    } finally {
      set_salvando_edicao(false);
    }
  };

  // Alterar credenciamento do membro da equipe Staff com persistência resiliente
  const handle_toggle_credenciamento = async (usuario: UsuarioStaff) => {
    const novoStatusCredenciamento = !usuario.is_credenciado;
    const id_alvo = usuario.id_usuario;
    set_processando_credenciamento_id(id_alvo);
    set_mensagem_erro(null);

    // 1. Salva no localStorage imediatamente
    if (typeof window !== 'undefined') {
      const overridesLocais = JSON.parse(localStorage.getItem('staff_credenciados_local') || '{}');
      overridesLocais[id_alvo] = novoStatusCredenciamento;
      localStorage.setItem('staff_credenciados_local', JSON.stringify(overridesLocais));
    }

    // 2. Atualiza state local imediatamente
    set_equipe_staff((prev) =>
      prev.map((s) =>
        s.id_usuario === id_alvo ? { ...s, is_credenciado: novoStatusCredenciamento } : s
      )
    );

    if (conexao_banco) {
      try {
        const isUuid = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        let idEvt = eventoAtivoId || (isUuid(id_evento_ativo) ? id_evento_ativo : '') || (typeof window !== 'undefined' ? localStorage.getItem('evento_ativo_id') : '') || '';

        if (!isUuid(idEvt)) {
          const { data: evData } = await supabase
            .from('eventos')
            .select('id_evento')
            .eq('is_ativo', true)
            .limit(1)
            .maybeSingle();

          if (evData?.id_evento && isUuid(evData.id_evento)) {
            idEvt = evData.id_evento;
            setEventoAtivoId(idEvt);
            localStorage.setItem('evento_ativo_id', idEvt);
          }
        }

        if (isUuid(idEvt)) {
          const { error: erro_upsert } = await supabase
            .from('avaliadores_evento')
            .upsert({ 
              id_usuario: id_alvo, 
              id_evento: idEvt, 
              is_credenciado: novoStatusCredenciamento
            }, { onConflict: 'id_usuario, id_evento' });

          if (erro_upsert) {
            await supabase
              .from('avaliadores_evento')
              .update({ is_credenciado: novoStatusCredenciamento })
              .eq('id_usuario', id_alvo)
              .eq('id_evento', idEvt);
          }
        } else {
          await supabase
            .from('avaliadores_evento')
            .update({ is_credenciado: novoStatusCredenciamento })
            .eq('id_usuario', id_alvo);
        }
      } catch (errDb: any) {
        console.warn('Erro ao persistir credenciamento do staff no Supabase:', errDb);
      }
    }

    exibir_notificacao(
      novoStatusCredenciamento
        ? 'Membro da equipe Staff credenciado com sucesso!'
        : 'Credenciamento da equipe Staff removido com sucesso!'
    );
    set_processando_credenciamento_id(null);
    if (aoAtualizarMetricas) aoAtualizarMetricas();
  };

  // LIGAÇÃO FUNCIONAL DO BOTÃO EXCLUIR (Staff) - Exclusão definitiva sem converter para Avaliador
  const handleExcluir = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir permanentemente este membro da equipe Staff?')) {
      return;
    }

    if (!conexao_banco) {
      set_equipe_staff((prev) => prev.filter((u) => u.id_usuario !== id));
      if (typeof window !== 'undefined') {
        const overridesLocais = JSON.parse(localStorage.getItem('staff_credenciados_local') || '{}');
        delete overridesLocais[id];
        localStorage.setItem('staff_credenciados_local', JSON.stringify(overridesLocais));
      }
      exibir_notificacao('Membro do Staff excluído (modo contingência).');
      if (aoAtualizarMetricas) aoAtualizarMetricas();
      return;
    }

    try {
      // 1. Remove qualquer vínculo do evento em avaliadores_evento para evitar conflito de Foreign Key
      await supabase.from('avaliadores_evento').delete().eq('id_usuario', id);

      // 2. Exclui o usuário definitivamente
      const { error } = await supabase.from('usuarios').delete().eq('id_usuario', id);
      if (error) {
        alert(`Erro ao excluir membro do Staff: ${error.message}`);
      } else {
        set_equipe_staff((prev) => prev.filter((u) => u.id_usuario !== id));
        if (typeof window !== 'undefined') {
          const overridesLocais = JSON.parse(localStorage.getItem('staff_credenciados_local') || '{}');
          delete overridesLocais[id];
          localStorage.setItem('staff_credenciados_local', JSON.stringify(overridesLocais));
        }
        exibir_notificacao('Membro da equipe Staff excluído definitivamente!');
        if (aoAtualizarMetricas) aoAtualizarMetricas();
      }
    } catch (e: any) {
      alert(`Falha ao excluir usuário: ${e.message || e}`);
    }
  };

  // Alternar ordenação
  const alternarOrdenacao = (coluna: 'is_credenciado' | 'nome' | 'email' | 'papel') => {
    if (colunaOrdenacao === coluna) {
      setOrdemAscendente(!ordemAscendente);
    } else {
      setColunaOrdenacao(coluna);
      setOrdemAscendente(true);
    }
  };

  const renderIconeOrdenacao = (coluna: 'is_credenciado' | 'nome' | 'email' | 'papel') => {
    if (colunaOrdenacao !== coluna) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-40 hover:opacity-100 transition-opacity ml-1 inline-block shrink-0" />;
    }
    return ordemAscendente
      ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 ml-1 inline-block shrink-0" />
      : <ArrowDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 ml-1 inline-block shrink-0" />;
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

  // Lista Ordenada
  const staff_ordenados = [...staff_filtrados].sort((a, b) => {
    let valA: any = a[colunaOrdenacao];
    let valB: any = b[colunaOrdenacao];
    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';
    if (typeof valA === 'boolean') {
      const numA = valA ? 1 : 0;
      const numB = valB ? 1 : 0;
      return ordemAscendente ? numA - numB : numB - numA;
    }
    const comp = String(valA).localeCompare(String(valB), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return ordemAscendente ? comp : -comp;
  });

  const totalStaffCadastrados = equipe_staff.length;
  const totalStaffCredenciados = equipe_staff.filter((s) => Boolean(s.is_credenciado)).length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6 font-sans w-full h-full overflow-y-auto">
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
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-100 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 shadow-xs">
            <UserCog className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            Gestor da Equipe Staff
          </h2>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <input
            ref={input_file_ref}
            type="file"
            accept=".csv, .xlsx, .xls"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handle_upload_arquivo(e.target.files[0]);
              }
              e.target.value = '';
            }}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => input_file_ref.current?.click()}
            disabled={processando_arquivo}
            className="px-3.5 py-2 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white flex items-center gap-2 shadow-xs cursor-pointer transition-all disabled:opacity-60"
            title="Importar (.xls/.xlsx/.csv)"
          >
            {processando_arquivo ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>{processando_arquivo ? 'Processando Planilha...' : 'Importar (.xls/.xlsx/.csv)'}</span>
          </button>

          <button
            type="button"
            onClick={() => set_mostrar_form_novo(!mostrar_form_novo)}
            className="px-3.5 py-2 rounded-xl font-bold text-xs bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 flex items-center gap-2 shadow-xs cursor-pointer transition-all"
            title={mostrar_form_novo ? 'Cancelar Inclusão' : 'Novo Membro Staff'}
          >
            <Plus className={`w-4 h-4 transition-transform duration-200 ${mostrar_form_novo ? 'rotate-45' : ''}`} />
            <span>Novo Membro Staff</span>
          </button>

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

      {/* CONSOLE DE LOGS DA IMPORTAÇÃO RETRÁTIL */}
      {(logsImportacao.length > 0 || processando_arquivo) && (
        <div className="bg-gray-900 text-green-400 p-4 rounded-xl max-h-48 overflow-y-auto font-mono text-xs space-y-1.5 border border-slate-800 shadow-inner">
          <div className="flex items-center justify-between pb-1 border-b border-gray-800 mb-2">
            <div className="flex items-center gap-2 text-slate-400 font-sans text-[10px] font-bold uppercase tracking-wider">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span>Console de Logs da Importação</span>
            </div>
            {logsImportacao.length > 0 && !processando_arquivo && (
              <button
                type="button"
                onClick={() => setLogsImportacao([])}
                className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                Limpar Logs
              </button>
            )}
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

      {/* FORMULÁRIO RETRÁTIL DE NOVO MEMBRO STAFF */}
      {mostrar_form_novo && (
        <form
          onSubmit={handle_adicionar_manual}
          className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-3 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={novo_nome}
              onChange={(e) => set_novo_nome(e.target.value)}
              placeholder="Nome do Membro do Staff"
              className="flex-1 px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
            <input
              type="email"
              value={novo_email}
              onChange={(e) => set_novo_email(e.target.value)}
              placeholder="E-mail do Membro do Staff"
              className="flex-1 px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
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

      {/* Barra de Busca e Contador */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Pesquisar por nome ou e-mail..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 self-end sm:self-center">
          Total: <strong className="text-slate-800 dark:text-slate-200">{staff_filtrados.length}</strong> membros (<span className="text-indigo-600 dark:text-indigo-400 font-bold">{totalStaffCredenciados} credenciados</span>)
        </span>
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
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                  <tr>
                    <th
                      onClick={() => alternarOrdenacao('is_credenciado')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por Credenciamento"
                    >
                      <div className="flex items-center gap-1">
                        <span>Credenciamento</span>
                        {renderIconeOrdenacao('is_credenciado')}
                      </div>
                    </th>
                    <th
                      onClick={() => alternarOrdenacao('nome')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por Nome"
                    >
                      <div className="flex items-center gap-1">
                        <span>Nome</span>
                        {renderIconeOrdenacao('nome')}
                      </div>
                    </th>
                    <th
                      onClick={() => alternarOrdenacao('email')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por E-mail"
                    >
                      <div className="flex items-center gap-1">
                        <span>E-mail</span>
                        {renderIconeOrdenacao('email')}
                      </div>
                    </th>
                    <th
                      onClick={() => alternarOrdenacao('papel')}
                      className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                      title="Clique para ordenar por Papel"
                    >
                      <div className="flex items-center gap-1">
                        <span>Papel</span>
                        {renderIconeOrdenacao('papel')}
                      </div>
                    </th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {staff_ordenados.map((usuario) => {
                    const isProcessingThis = processando_credenciamento_id === usuario.id_usuario;

                    return (
                      <tr key={usuario.id_usuario} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        {/* Status de Credenciamento */}
                        <td className="px-4 py-3.5">
                          {usuario.is_credenciado === true ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-300 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
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
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            {usuario.papel || 'STAFF'}
                          </span>
                        </td>

                        {/* Coluna Ações (Credenciar/Descredenciar, Editar, Excluir) */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Botão Credenciar / Remover Credenciamento */}
                            <button
                              type="button"
                              onClick={() => handle_toggle_credenciamento(usuario)}
                              disabled={isProcessingThis}
                              title={usuario.is_credenciado ? 'Remover credenciamento do membro do Staff' : 'Credenciar membro do Staff no evento'}
                              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all inline-flex items-center gap-1.5 ${
                                usuario.is_credenciado
                                  ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-600'
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
                              title="Editar Membro Staff"
                              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            {/* Botão Excluir */}
                            <button
                              type="button"
                              onClick={() => handleExcluir(usuario.id_usuario)}
                              title="Excluir Membro Staff"
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
