import React, { useState, useEffect, useRef } from 'react';
import {
  FolderGit2,
  Search,
  Edit2,
  Trash2,
  X,
  Save,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  UploadCloud,
  FileSpreadsheet,
  Terminal
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export interface ProjetoItem {
  id_projeto: string;
  codigo_projeto?: string | null;
  titulo: string;
  estande: string | null;
  corredor: string | null;
  is_check_in_realizado?: boolean;
}

interface GestorProjetosProps {
  aoFechar?: () => void;
  idProjetoEditarInicial?: string | null;
}

export const GestorProjetos: React.FC<GestorProjetosProps> = ({
  aoFechar,
  idProjetoEditarInicial
}) => {
  const [projetos, set_projetos] = useState<ProjetoItem[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [termo_busca, set_termo_busca] = useState<string>('');
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [mensagem_sucesso, set_mensagem_sucesso] = useState<string | null>(null);
  const [processando_checkin_id, set_processando_checkin_id] = useState<string | null>(null);

  // Estados para Importação em Massa (Planilha -> Banco)
  const [mostrar_painel_importacao, set_mostrar_painel_importacao] = useState<boolean>(false);
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [logs_importacao, set_logs_importacao] = useState<{ tipo: 'info' | 'success' | 'error'; mensagem: string }[]>([]);
  const input_arquivo_ref = useRef<HTMLInputElement | null>(null);

  // Estado para formulário de edição
  const [projeto_em_edicao, set_projeto_em_edicao] = useState<ProjetoItem | null>(null);
  const [edit_titulo, set_edit_titulo] = useState<string>('');
  const [edit_estande, set_edit_estande] = useState<string>('');
  const [edit_corredor, set_edit_corredor] = useState<string>('');
  const [salvando, set_salvando] = useState<boolean>(false);

  const conexao_banco = verificar_conexao_configurada();

  const adicionarLog = (tipo: 'info' | 'success' | 'error', mensagem: string) => {
    set_logs_importacao((prev) => [...prev, { tipo, mensagem }]);
  };

  // 1. CONSULTA DE NÚCLEO: 'id_projeto, codigo_projeto, titulo, estande, corredor, is_check_in_realizado'
  const carregar_projetos = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_projetos([]);
      set_carregando(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('projetos')
        .select('id_projeto, codigo_projeto, titulo, estande, corredor, is_check_in_realizado')
        .order('titulo', { ascending: true });

      if (error) {
        throw error;
      }

      set_projetos(data || []);
    } catch (err: any) {
      console.error('Erro ao buscar projetos:', err);
      set_mensagem_erro(`Erro do Supabase (${err.code || '42703'}): ${err.message || 'Falha ao consultar projetos'}`);
      set_projetos([]);
    } finally {
      set_carregando(false);
    }
  };

  // Alterar check-in do projeto na tabela 'projetos' (replicando exatamente a lógica da tela do Staff)
  const alternar_check_in_projeto = async (id_projeto: string, status_atual: boolean) => {
    const novo_status_check_in = !status_atual;
    const id_alvo = id_projeto;
    set_processando_checkin_id(id_alvo);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_projetos((lista) =>
        lista.map((p) =>
          p.id_projeto === id_alvo
            ? { ...p, is_check_in_realizado: novo_status_check_in }
            : p
        )
      );
      set_mensagem_sucesso(
        novo_status_check_in
          ? 'Check-in realizado com sucesso! (Modo Contingência)'
          : 'Presença desmarcada com sucesso! (Modo Contingência)'
      );
      setTimeout(() => set_mensagem_sucesso(null), 3000);
      set_processando_checkin_id(null);
      return;
    }

    try {
      let erro_retornado: any = null;
      const { error: erro_projetos } = await supabase
        .from('projetos')
        .update({ is_check_in_realizado: novo_status_check_in })
        .eq('id_projeto', id_alvo);

      if (erro_projetos) {
        const { error: erro_singular } = await supabase
          .from('projeto')
          .update({ is_check_in_realizado: novo_status_check_in })
          .eq('id', id_alvo);

        erro_retornado = erro_singular;
      }

      if (erro_retornado) {
        console.error('Erro no Supabase ao atualizar check-in do projeto:', erro_retornado.message);
        set_mensagem_erro(`Falha ao atualizar check-in no banco: ${erro_retornado.message}`);
        return;
      }

      set_projetos((lista) =>
        lista.map((p) =>
          p.id_projeto === id_alvo
            ? { ...p, is_check_in_realizado: novo_status_check_in }
            : p
        )
      );

      set_mensagem_sucesso(
        novo_status_check_in
          ? 'Check-in registrado no Supabase com sucesso!'
          : 'Presença desmarcada no Supabase com sucesso.'
      );
      setTimeout(() => set_mensagem_sucesso(null), 3000);
    } catch (erro_excecao: any) {
      console.error('Falha de execução ao alternar check-in:', erro_excecao);
      set_mensagem_erro('Ocorreu uma falha na atualização de presença. Tente novamente.');
    } finally {
      set_processando_checkin_id(null);
    }
  };

  useEffect(() => {
    carregar_projetos();
  }, []);

  // Abrir edição automaticamente se houver idProjetoEditarInicial
  useEffect(() => {
    if (idProjetoEditarInicial && projetos.length > 0) {
      const proj = projetos.find((p) => p.id_projeto === idProjetoEditarInicial);
      if (proj) {
        abrir_edicao(proj);
      }
    }
  }, [idProjetoEditarInicial, projetos]);

  // MAPEAMENTO NA IMPORTAÇÃO EM MASSA (Planilha -> Banco)
  const handle_upload_planilha_projetos = async (file: File) => {
    set_processando_arquivo(true);
    set_mensagem_erro(null);
    set_logs_importacao([]);

    adicionarLog('info', `Iniciando leitura da planilha: ${file.name}`);

    try {
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          if (!e.target?.result) {
            adicionarLog('error', 'Falha ao ler o arquivo selecionado.');
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
            adicionarLog('error', 'Erro: A planilha selecionada não contém linhas de dados.');
            set_mensagem_erro('A planilha selecionada está vazia.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Planilha lida com sucesso! ${dadosBrutos.length} linhas para processamento.`);

          const projetosFormatados: Array<{
            codigo_projeto: string | null;
            titulo: string;
            estande: string | null;
            corredor: string | null;
          }> = [];

          const mapaProjetos = new Map<string, {
            codigo_projeto: string | null;
            titulo: string;
            estande: string | null;
            corredor: string | null;
          }>();
          const projetosSemCodigo: Array<{
            codigo_projeto: string | null;
            titulo: string;
            estande: string | null;
            corredor: string | null;
          }> = [];

          for (let index = 0; index < dadosBrutos.length; index++) {
            const linha = dadosBrutos[index];
            const numLinha = index + 2;
            const keys = Object.keys(linha);

            let codigo_extraido = '';
            let titulo_extraido = '';
            let estande_extraido = '';
            let corredor_extraido = '';

            keys.forEach((k) => {
              const kLower = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

              // Captura da coluna de ID da planilha (ex: "ID", "ID do projeto", "Código")
              if (
                kLower === 'id' ||
                kLower === 'cod' ||
                kLower === 'codigo' ||
                kLower === 'código' ||
                kLower.includes('id do projeto') ||
                kLower.includes('id_projeto') ||
                kLower.includes('id projeto') ||
                kLower.includes('codigo do projeto') ||
                kLower.includes('código do projeto') ||
                kLower.includes('codigo_projeto') ||
                kLower.includes('chave natural')
              ) {
                codigo_extraido = String(linha[k]).trim();
              } else if (
                kLower.includes('titulo') ||
                kLower.includes('título') ||
                kLower.includes('nome do projeto') ||
                kLower === 'projeto'
              ) {
                titulo_extraido = String(linha[k]).trim();
              } else if (kLower.includes('estande')) {
                estande_extraido = String(linha[k]).trim();
              } else if (kLower.includes('corredor')) {
                corredor_extraido = String(linha[k]).trim();
              }
            });

            // Fallback para título
            if (!titulo_extraido && keys.length > 1) {
              titulo_extraido = String(linha[keys[1]]).trim();
            } else if (!titulo_extraido && keys.length > 0) {
              titulo_extraido = String(linha[keys[0]]).trim();
            }

            // Fallback para código se chave inicial indicar ID
            if (!codigo_extraido && keys.length > 0) {
              const k0 = keys[0].toLowerCase();
              if (k0.includes('id') || k0.includes('cod')) {
                codigo_extraido = String(linha[keys[0]]).trim();
              }
            }

            if (!titulo_extraido && !codigo_extraido) {
              adicionarLog('error', `Linha ${numLinha}: Título ou Código não encontrados. Linha ignorada.`);
              continue;
            }

            const payload = {
              codigo_projeto: codigo_extraido || null,
              titulo: titulo_extraido || 'Projeto Sem Título',
              estande: estande_extraido || null,
              corredor: corredor_extraido || null,
            };

            if (payload.codigo_projeto) {
              mapaProjetos.set(payload.codigo_projeto, payload);
            } else {
              projetosSemCodigo.push(payload);
            }

            adicionarLog('info', `Linha ${numLinha}: Projeto "${payload.titulo}" (Código: ${payload.codigo_projeto || 'N/I'}) formatado.`);
          }

          // Consolidação dos projetos formatados
          mapaProjetos.forEach((p) => projetosFormatados.push(p));
          projetosSemCodigo.forEach((p) => projetosFormatados.push(p));

          if (projetosFormatados.length === 0) {
            adicionarLog('error', 'Nenhum projeto válido encontrado para importação.');
            set_mensagem_erro('Nenhum projeto válido encontrado para importação.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Consolidando ${projetosFormatados.length} projetos para envio via UPSERT...`);

          if (conexao_banco) {
            try {
              const { error } = await supabase.from('projetos').upsert(projetosFormatados, { onConflict: 'codigo_projeto' });

              if (error) {
                console.error('Erro no upsert de projetos:', error);
                adicionarLog('error', `Erro no banco ao realizar UPSERT: ${error.message}`);
                set_mensagem_erro(`Erro ao importar projetos: ${error.message}`);
              } else {
                adicionarLog('success', `UPSERT concluído com sucesso! ${projetosFormatados.length} projetos cadastrados/atualizados.`);
                exibir_sucesso(`Importação concluída: ${projetosFormatados.length} projetos cadastrados/atualizados via upsert com sucesso!`);
                await carregar_projetos();
              }
            } catch (errUpsert: any) {
              console.error('Exceção no upsert de projetos:', errUpsert);
              adicionarLog('error', `Erro inesperado no upsert: ${errUpsert?.message || errUpsert}`);
              set_mensagem_erro(`Erro inesperado: ${errUpsert?.message || errUpsert}`);
            }
          } else {
            // Modo contingência
            const novosItens: ProjetoItem[] = projetosFormatados.map((p) => ({
              id_projeto: crypto.randomUUID(),
              codigo_projeto: p.codigo_projeto,
              titulo: p.titulo,
              estande: p.estande,
              corredor: p.corredor,
            }));

            set_projetos((prev) => {
              const mapa = new Map<string, ProjetoItem>();
              prev.forEach((p) => {
                if (p.codigo_projeto) mapa.set(p.codigo_projeto, p);
                else mapa.set(p.id_projeto, p);
              });
              novosItens.forEach((p) => {
                if (p.codigo_projeto) mapa.set(p.codigo_projeto, p);
                else mapa.set(p.id_projeto, p);
              });
              return Array.from(mapa.values());
            });

            adicionarLog('success', `[Modo Contingência] ${projetosFormatados.length} projetos inseridos/atualizados.`);
            exibir_sucesso(`Importação concluída: ${projetosFormatados.length} projetos processados!`);
          }
        } catch (errParsing: any) {
          console.error('Erro ao processar planilha de projetos:', errParsing);
          adicionarLog('error', `Erro crítico no processamento da planilha: ${errParsing?.message || errParsing}`);
          set_mensagem_erro(`Erro ao processar planilha: ${errParsing.message}`);
        } finally {
          set_processando_arquivo(false);
          if (input_arquivo_ref.current) {
            input_arquivo_ref.current.value = '';
          }
        }
      };

      if (isCSV) {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    } catch (errUpload: any) {
      console.error('Erro no upload de arquivo:', errUpload);
      adicionarLog('error', `Falha ao carregar arquivo: ${errUpload?.message || errUpload}`);
      set_mensagem_erro('Falha ao ler arquivo do computador.');
      set_processando_arquivo(false);
    }
  };

  const abrir_edicao = (projeto: ProjetoItem) => {
    set_projeto_em_edicao(projeto);
    set_edit_titulo(projeto.titulo || '');
    set_edit_estande(projeto.estande || '');
    set_edit_corredor(projeto.corredor || '');
  };

  const fechar_edicao = () => {
    set_projeto_em_edicao(null);
    set_edit_titulo('');
    set_edit_estande('');
    set_edit_corredor('');
  };

  // 2. SALVAR/EDITAR USANDO AS CHAVES EXATAS DO BANCO E ATUALIZAÇÃO REATIVA
  const salvar_edicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projeto_em_edicao) return;

    set_salvando(true);
    set_mensagem_erro(null);
    set_mensagem_sucesso(null);

    const idProjetoEditado = projeto_em_edicao.id_projeto;

    try {
      if (conexao_banco && idProjetoEditado) {
        const { error } = await supabase
          .from('projetos')
          .update({
            titulo: edit_titulo,
            estande: edit_estande,
            corredor: edit_corredor
          })
          .eq('id_projeto', idProjetoEditado);

        if (error) throw error;
      }

      // Atualização Reativa no State local imediato
      set_projetos((prev) =>
        prev.map((p) => {
          if (p.id_projeto === idProjetoEditado) {
            return {
              ...p,
              titulo: edit_titulo,
              estande: edit_estande,
              corredor: edit_corredor
            };
          }
          return p;
        })
      );

      exibir_sucesso('Projeto atualizado com sucesso no Supabase!');
      fechar_edicao();
    } catch (err: any) {
      console.error('Erro ao atualizar projeto:', err);
      set_mensagem_erro(`Erro ao salvar alterações: ${err.message || err}`);
    } finally {
      set_salvando(false);
    }
  };

  // 3. EXCLUIR PASSANDO id_projeto COM CONFIRMAÇÃO, TRATAMENTO DE FK E ATUALIZAÇÃO REATIVA
  const excluir_projeto = async (projeto: ProjetoItem) => {
    const idDoProjeto = projeto.id_projeto;
    const nomeExibicao = projeto.titulo || projeto.codigo_projeto || 'Projeto';

    const confirmado = window.confirm(
      `Tem certeza de que deseja excluir o projeto "${nomeExibicao}"?\nEsta ação é irreversível.`
    );
    if (!confirmado) return;

    set_mensagem_erro(null);
    set_mensagem_sucesso(null);

    try {
      if (conexao_banco && idDoProjeto) {
        const { error } = await supabase
          .from('projetos')
          .delete()
          .eq('id_projeto', idDoProjeto);

        if (error) {
          const isFkError =
            error.code === '23503' ||
            error.message?.toLowerCase().includes('foreign key') ||
            error.message?.toLowerCase().includes('violates') ||
            error.message?.toLowerCase().includes('avaliacoes') ||
            error.message?.toLowerCase().includes('locks_ativos');

          if (isFkError) {
            const msgFk = 'Não é possível excluir este projeto pois ele já possui avaliações associadas no banco de dados.';
            alert(msgFk);
            set_mensagem_erro(msgFk);
            return;
          } else {
            const msgErr = `Erro do Supabase ao excluir: ${error.message}`;
            alert(msgErr);
            set_mensagem_erro(msgErr);
            return;
          }
        }
      }

      // Atualização Reativa no State local imediato
      set_projetos((prev) => prev.filter((p) => p.id_projeto !== idDoProjeto));
      exibir_sucesso('Projeto excluído com sucesso do Supabase!');
    } catch (err: any) {
      console.error('Erro ao excluir projeto:', err);
      const msgExc = `Exceção ao excluir projeto: ${err.message || err}`;
      alert(msgExc);
      set_mensagem_erro(msgExc);
    }
  };

  const exibir_sucesso = (msg: string) => {
    set_mensagem_sucesso(msg);
    setTimeout(() => {
      set_mensagem_sucesso(null);
    }, 4000);
  };

  const projetos_filtrados = projetos.filter((p) => {
    if (!termo_busca.trim()) return true;
    const t = termo_busca.toLowerCase().trim();
    const codigo = (p.codigo_projeto || '').toLowerCase();
    const titulo = (p.titulo || '').toLowerCase();
    const estande = (p.estande || '').toLowerCase();
    const corredor = (p.corredor || '').toLowerCase();
    return codigo.includes(t) || titulo.includes(t) || estande.includes(t) || corredor.includes(t);
  });

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] font-sans">
      {/* Cabeçalho */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 shadow-xs">
            <FolderGit2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              Gestor de Projetos
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                {projetos_filtrados.length} projetos
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Chave Natural (`codigo_projeto`), Título, Estande e Corredor.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Botão de Importação em Massa */}
          <button
            type="button"
            onClick={() => set_mostrar_painel_importacao(!mostrar_painel_importacao)}
            className={`px-3.5 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer border ${
              mostrar_painel_importacao
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Importação em Massa</span>
          </button>

          <button
            type="button"
            onClick={carregar_projetos}
            disabled={carregando}
            title="Recarregar lista"
            className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Painel Retrátil de Importação em Massa (CSV/XLSX) */}
      {mostrar_painel_importacao && (
        <div className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 p-5 space-y-4 animate-in slide-in-from-top-2 duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Importação em Massa (Planilha -&gt; Supabase)
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Mapeamento automático: Colunas de ID/Código capturadas como <code className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">codigo_projeto</code>. O UUID do banco é gerado automaticamente.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                ref={input_arquivo_ref}
                type="file"
                accept=".csv, .xlsx, .xls"
                className="hidden"
                id="input-planilha-projetos"
                disabled={processando_arquivo}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handle_upload_planilha_projetos(f);
                }}
              />
              <label
                htmlFor="input-planilha-projetos"
                className={`px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 shadow-xs cursor-pointer transition-all ${
                  processando_arquivo ? 'opacity-60 pointer-events-none' : ''
                }`}
              >
                {processando_arquivo ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processando Planilha...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    Selecionar Arquivo (.CSV / .XLSX)
                  </>
                )}
              </label>
              {logs_importacao.length > 0 && (
                <button
                  type="button"
                  onClick={() => set_logs_importacao([])}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline cursor-pointer"
                >
                  Limpar Logs
                </button>
              )}
            </div>
          </div>

          {/* Console de Logs da Importação */}
          {logs_importacao.length > 0 && (
            <div className="bg-slate-950 text-slate-200 rounded-2xl p-4 font-mono text-[11px] max-h-48 overflow-y-auto space-y-1 border border-slate-800 shadow-inner">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800 flex items-center gap-1.5 mb-2">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" /> Console de Importação
              </div>
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
          )}
        </div>
      )}

      {/* Alertas */}
      {mensagem_erro && (
        <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-semibold">{mensagem_erro}</span>
        </div>
      )}

      {mensagem_sucesso && (
        <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="font-semibold">{mensagem_sucesso}</span>
        </div>
      )}

      {/* Barra de Pesquisa */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={termo_busca}
            onChange={(e) => set_termo_busca(e.target.value)}
            placeholder="Buscar por código, título, estande ou corredor..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Tabela de Projetos: Exibe CÓDIGO (codigo_projeto), Corredor, Estande, Título */}
      <div className="flex-1 overflow-y-auto p-6">
        {carregando ? (
          <div className="p-12 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Carregando projetos do Supabase...
            </p>
          </div>
        ) : projetos_filtrados.length === 0 ? (
          <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
            <FileText className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Nenhum projeto localizado.
            </p>
            <p className="text-[11px] text-slate-400">
              {termo_busca ? 'Tente ajustar os termos de pesquisa.' : 'Nenhum registro encontrado na tabela projetos do banco.'}
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-slate-800 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <th className="px-4 py-3">CÓDIGO</th>
                  <th className="px-4 py-3">Corredor</th>
                  <th className="px-4 py-3">Estande</th>
                  <th className="px-4 py-3">Presença</th>
                  <th className="px-4 py-3">Título</th>
                  <th className="px-4 py-3 text-right">Ações (CRUD & Credenciamento)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {projetos_filtrados.map((p) => {
                  const idProj = p.id_projeto;
                  const codigoProj = p.codigo_projeto || 'N/I';
                  const tituloProj = p.titulo;
                  const estandeProj = p.estande || '-';
                  const corredorProj = p.corredor || '-';
                  const isCheckin = Boolean(p.is_check_in_realizado);
                  const isProcessingThis = processando_checkin_id === idProj;

                  return (
                    <tr key={idProj} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      {/* BLINDAGEM VISUAL: Exibe codigo_projeto em vez de UUID */}
                      <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {codigoProj}
                      </td>
                      <td className="px-4 py-3 font-semibold text-teal-600 dark:text-teal-400 whitespace-nowrap">
                        {corredorProj}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {estandeProj}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            isCheckin
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {isCheckin ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Presente
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 text-slate-400" /> Pendente
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold max-w-md">
                        {tituloProj}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        {/* Botão Check-in / Desmarcar Presença (Espelhando Staff) */}
                        <button
                          type="button"
                          onClick={() => alternar_check_in_projeto(idProj, isCheckin)}
                          disabled={isProcessingThis}
                          title={isCheckin ? 'Desmarcar presença do projeto' : 'Confirmar check-in presencial'}
                          className={`px-2.5 py-1.5 rounded-lg font-bold text-[11px] border transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                            isCheckin
                              ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 shadow-xs'
                          }`}
                        >
                          {isProcessingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isCheckin ? (
                            <XCircle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          )}
                          <span>{isCheckin ? 'Desmarcar Presença' : 'Check-in'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => abrir_edicao(p)}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-blue-700 dark:text-blue-300 font-bold text-[11px] border border-blue-200 dark:border-blue-800 transition-all inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> Editar
                        </button>

                        <button
                          type="button"
                          onClick={() => excluir_projeto(p)}
                          className="px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/60 hover:bg-red-100 text-red-700 dark:text-red-300 font-bold text-[11px] border border-red-200 dark:border-red-800 transition-all inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Excluir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal / Formulário de Edição */}
      {projeto_em_edicao && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-blue-600" /> Editar Projeto
              </h3>
              <button
                type="button"
                onClick={fechar_edicao}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={salvar_edicao} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  Código do Projeto
                </label>
                <input
                  type="text"
                  disabled
                  value={projeto_em_edicao.codigo_projeto || 'N/I'}
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 font-mono font-bold text-xs"
                />
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  Título
                </label>
                <textarea
                  rows={3}
                  required
                  value={edit_titulo}
                  onChange={(e) => set_edit_titulo(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Estande
                  </label>
                  <input
                    type="text"
                    required
                    value={edit_estande}
                    onChange={(e) => set_edit_estande(e.target.value)}
                    placeholder="Ex: EST-A01"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Corredor
                  </label>
                  <input
                    type="text"
                    required
                    value={edit_corredor}
                    onChange={(e) => set_edit_corredor(e.target.value)}
                    placeholder="Ex: Corredor A"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={fechar_edicao}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  {salvando ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" /> Salvar Alterações
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rodapé do Gestor */}
      <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50/50 dark:bg-slate-900/50">
        {aoFechar && (
          <button
            type="button"
            onClick={aoFechar}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-all shadow-xs cursor-pointer"
          >
            Fechar Janela
          </button>
        )}
      </div>
    </div>
  );
};
