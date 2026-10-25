import React, { useState, useEffect, useRef } from 'react';
import {
  ClipboardList,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ListOrdered,
  HelpCircle,
  Sparkles,
  ArrowUp,
  ArrowDown,
  UploadCloud,
  FileSpreadsheet,
  Terminal,
  X
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

interface ItemPerguntaForm {
  id_temp: string;
  ordem: number;
  texto_pergunta: string;
  descricao_lembrete?: string;
  peso_calculo: number;
  peso_desempate: number;
}

interface QuestionarioSalvoView {
  id_questionario: string;
  titulo: string;
  escala_minima: number;
  escala_maxima: number;
  total_perguntas?: number;
}

export const GestorQuestionarios: React.FC<{
  id_evento_ativo?: string;
  aoAtualizarMetricas?: () => void;
  aoFechar?: () => void;
}> = ({
  id_evento_ativo = 'evt-2026-ifms',
  aoAtualizarMetricas,
  aoFechar,
}) => {
  // Campos do formulário pai
  const [titulo_questionario, set_titulo_questionario] = useState<string>('');
  const [escala_minima, set_escala_minima] = useState<number>(1);
  const [escala_maxima, set_escala_maxima] = useState<number>(5);

  // Lista dinâmica de perguntas filhas
  const [perguntas_lista, set_perguntas_lista] = useState<ItemPerguntaForm[]>([
    {
      id_temp: 'p-1',
      ordem: 1,
      texto_pergunta: 'Domínio do Método Científico e Rigor na Execução',
      descricao_lembrete: 'Considere o domínio metodológico, hipóteses e rigor científico',
      peso_calculo: 1.0,
      peso_desempate: 1,
    },
    {
      id_temp: 'p-2',
      ordem: 2,
      texto_pergunta: 'Originalidade, Criatividade e Inovação da Solução',
      descricao_lembrete: 'Considere o grau de inovação técnica e impacto social',
      peso_calculo: 1.0,
      peso_desempate: 2,
    },
    {
      id_temp: 'p-3',
      ordem: 3,
      texto_pergunta: 'Qualidade do Banner, Protótipo e Articulação Oral',
      descricao_lembrete: 'Considere a clareza da defesa oral e prototipagem',
      peso_calculo: 1.0,
      peso_desempate: 3,
    },
  ]);

  // Lista de questionários salvos no banco
  const [questionarios_salvos, set_questionarios_salvos] = useState<QuestionarioSalvoView[]>([]);

  // Estado para armazenar id do questionário em edição
  const [idQuestionarioEdicao, setIdQuestionarioEdicao] = useState<string | null>(null);

  // Controle de requisição
  const [salvando, set_salvando] = useState<boolean>(false);
  const [carregando_lista, set_carregando_lista] = useState<boolean>(true);
  const [mensagem_notificacao, set_mensagem_notificacao] = useState<string | null>(null);
  const [erroQuest, setErroQuest] = useState<string | null>(null);
  const [sucessoQuest, setSucessoQuest] = useState<string | null>(null);

  // Estados de Importação por Planilha (.CSV/.XLSX/.XLS)
  const input_file_ref = useRef<HTMLInputElement | null>(null);
  const [processando_arquivo, set_processando_arquivo] = useState<boolean>(false);
  const [logs_importacao, set_logs_importacao] = useState<{ tipo: 'info' | 'success' | 'error'; mensagem: string }[]>([]);

  const adicionarLog = (tipo: 'info' | 'success' | 'error', mensagem: string) => {
    set_logs_importacao((prev) => [...prev, { tipo, mensagem }]);
  };

  const conexao_configurada = verificar_conexao_configurada();

  const exibir_notificacao = (texto: string) => {
    set_mensagem_notificacao(texto);
    setTimeout(() => {
      set_mensagem_notificacao(null);
    }, 3500);
  };

  // 1. IMPORTAÇÃO EM MASSA DE PERGUNTAS/CRITÉRIOS POR PLANILHA
  const handle_upload_questionarios = async (file: File) => {
    set_processando_arquivo(true);
    setErroQuest(null);
    set_logs_importacao([]);
    adicionarLog('info', `Iniciando leitura da planilha de questionário: ${file.name}`);

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
            adicionarLog('error', 'A planilha selecionada está vazia.');
            set_processando_arquivo(false);
            return;
          }

          adicionarLog('info', `Planilha lida! Total de ${dadosBrutos.length} linhas de critérios encontradas.`);

          const perguntasExtraidas: ItemPerguntaForm[] = [];

          for (let index = 0; index < dadosBrutos.length; index++) {
            const linha = dadosBrutos[index];
            const numLinha = index + 2;
            const keys = Object.keys(linha);

            let pergunta = '';
            let lembrete = '';
            let peso = 1.0;

            keys.forEach((k) => {
              const kLower = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
              if (
                kLower.includes('pergunta') ||
                kLower.includes('criterio') ||
                kLower.includes('critério') ||
                kLower.includes('item') ||
                kLower.includes('texto') ||
                kLower === 'titulo'
              ) {
                pergunta = String(linha[k]).trim();
              } else if (
                kLower.includes('lembrete') ||
                kLower.includes('descricao') ||
                kLower.includes('descrição') ||
                kLower.includes('orientacao') ||
                kLower.includes('observacao')
              ) {
                lembrete = String(linha[k]).trim();
              } else if (kLower.includes('peso')) {
                const p = parseFloat(String(linha[k]).replace(',', '.'));
                if (!isNaN(p) && p > 0) peso = p;
              }
            });

            if (!pergunta && keys.length > 0) pergunta = String(linha[keys[0]]).trim();
            if (!lembrete && keys.length > 1) lembrete = String(linha[keys[1]]).trim();
            if (keys.length > 2 && peso === 1.0) {
              const p = parseFloat(String(linha[keys[2]]).replace(',', '.'));
              if (!isNaN(p) && p > 0) peso = p;
            }

            if (!pergunta) {
              adicionarLog('error', `Linha ${numLinha}: Pergunta/Critério não identificado. Linha ignorada.`);
              continue;
            }

            perguntasExtraidas.push({
              id_temp: 'p-import-' + Math.random().toString(36).substring(2, 7),
              ordem: index + 1,
              texto_pergunta: pergunta,
              descricao_lembrete: lembrete || undefined,
              peso_calculo: peso,
              peso_desempate: index + 1,
            });

            adicionarLog('info', `Linha ${numLinha}: Pergunta "${pergunta}" (Peso: ${peso}) formatada.`);
          }

          if (perguntasExtraidas.length === 0) {
            adicionarLog('error', 'Nenhuma pergunta válida encontrada na planilha.');
            set_processando_arquivo(false);
            return;
          }

          // Escolha do usuário: Anexar ao questionário aberto ou Criar Novo
          let anexar = false;
          if (perguntas_lista.length > 0 || titulo_questionario.trim()) {
            anexar = window.confirm(
              `Deseja ANEXAR estas ${perguntasExtraidas.length} perguntas ao questionário atualmente aberto?\n\n- Clique em [OK] para ANEXAR ao questionário atual.\n- Clique em [Cancelar] para CRIAR UM NOVO formulário com as perguntas importadas.`
            );
          }

          if (anexar) {
            const ordemInicial = perguntas_lista.length;
            const ajustadas = perguntasExtraidas.map((p, idx) => ({
              ...p,
              ordem: ordemInicial + idx + 1,
              peso_desempate: ordemInicial + idx + 1,
            }));
            set_perguntas_lista((prev) => [...prev, ...ajustadas]);
            adicionarLog('success', `${ajustadas.length} perguntas anexadas ao questionário aberto com sucesso!`);
            exibir_notificacao(`${ajustadas.length} perguntas anexadas com sucesso!`);
          } else {
            const nomeArquivoLimpo = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
            set_titulo_questionario(nomeArquivoLimpo);
            setIdQuestionarioEdicao(null);
            set_perguntas_lista(perguntasExtraidas);
            adicionarLog('success', `Novo questionário "${nomeArquivoLimpo}" carregado com ${perguntasExtraidas.length} perguntas da planilha!`);
            exibir_notificacao(`Novo questionário preparado com ${perguntasExtraidas.length} perguntas!`);
          }
        } catch (errParsing: any) {
          console.error('Erro ao processar planilha de questionários:', errParsing);
          adicionarLog('error', `Erro ao processar planilha: ${errParsing.message}`);
          setErroQuest(`Erro ao processar planilha: ${errParsing.message}`);
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

  // Função para editar questionário
  const handleEditarQuestionario = async (quest: QuestionarioSalvoView) => {
    setIdQuestionarioEdicao(quest.id_questionario);
    set_titulo_questionario(quest.titulo);
    set_escala_minima(quest.escala_minima);
    set_escala_maxima(quest.escala_maxima);

    if (conexao_configurada && quest.id_questionario) {
      try {
        const { data: pergs } = await supabase
          .from('perguntas_questionario')
          .select('*')
          .eq('id_questionario', quest.id_questionario)
          .order('ordem', { ascending: true });

        if (pergs && pergs.length > 0) {
          set_perguntas_lista(
            pergs.map((p, idx) => ({
              id_temp: p.id_pergunta || p.id || 'p-' + (idx + 1),
              ordem: p.ordem || idx + 1,
              texto_pergunta: p.texto_pergunta || '',
              descricao_lembrete: p.descricao_lembrete || p.lembrete || p.texto_ajuda || '',
              peso_calculo: p.peso_calculo ?? 1.0,
              peso_desempate: p.peso_desempate ?? idx + 1,
            }))
          );
        }
      } catch (err) {
        console.warn('Erro ao carregar perguntas do questionário para edição:', err);
      }
    }
  };

  // Função para excluir questionário no Supabase e atualizar o estado da lista
  const handleExcluirQuestionario = async (id_questionario: string) => {
    if (conexao_configurada) {
      try {
        await supabase.from('perguntas_questionario').delete().eq('id_questionario', id_questionario);
        const { error } = await supabase.from('questionarios').delete().eq('id_questionario', id_questionario);
        if (error) {
          await supabase.from('questionario').delete().eq('id', id_questionario);
        }
      } catch (e: any) {
        console.error('Erro ao excluir do Supabase:', e);
      }
    }

    set_questionarios_salvos((prev) => prev.filter((q) => q.id_questionario !== id_questionario));
    if (idQuestionarioEdicao === id_questionario) {
      setIdQuestionarioEdicao(null);
      set_titulo_questionario('');
    }
    exibir_notificacao('Questionário excluído com sucesso!');
    if (aoAtualizarMetricas) aoAtualizarMetricas();
  };

  // Carrega a lista de questionários existentes no Supabase
  const carregar_questionarios_existentes = async () => {
    set_carregando_lista(true);

    if (!conexao_configurada) {
      set_questionarios_salvos([
        {
          id_questionario: 'quest-001',
          titulo: 'Questionário Geral de Avaliação de Projetos IFMS',
          escala_minima: 1,
          escala_maxima: 5,
          total_perguntas: 3,
        },
      ]);
      set_carregando_lista(false);
      return;
    }

    try {
      let { data: dados_quest, error: erro_quest } = await supabase
        .from('questionarios')
        .select('*');

      if (erro_quest || !dados_quest) {
        const { data: dados_sing } = await supabase.from('questionario').select('*');
        if (dados_sing) {
          dados_quest = dados_sing.map((q) => ({
            id_questionario: q.id,
            titulo: q.titulo_questionario || 'Questionário IFMS',
            escala_minima: 1,
            escala_maxima: 5,
          }));
        }
      }

      if (dados_quest) {
        set_questionarios_salvos(
          dados_quest.map((q) => ({
            id_questionario: q.id_questionario || q.id || 'q-' + Math.random(),
            titulo: q.titulo_questionario || 'Questionário IFMS',
            escala_minima: q.escala_minima || 1,
            escala_maxima: q.escala_maxima || 5,
          }))
        );
      }
    } catch (e: any) {
      console.error('Erro ao buscar questionários:', e);
      alert(`Erro ao buscar questionários: ${e?.message || e}`);
    } finally {
      set_carregando_lista(false);
    }
  };

  useEffect(() => {
    carregar_questionarios_existentes();
  }, [conexao_configurada]);

  // Adiciona nova pergunta à lista dinâmica
  const adicionar_nova_pergunta = () => {
    const nova_ordem = perguntas_lista.length + 1;
    const novo_item: ItemPerguntaForm = {
      id_temp: 'p-' + Date.now(),
      ordem: nova_ordem,
      texto_pergunta: '',
      descricao_lembrete: '',
      peso_calculo: 1.0,
      peso_desempate: nova_ordem,
    };
    set_perguntas_lista([...perguntas_lista, novo_item]);
  };

  // Remove pergunta da lista
  const remover_pergunta = (id_temp: string) => {
    if (perguntas_lista.length <= 1) {
      alert('O questionário deve ter pelo menos uma pergunta.');
      return;
    }
    const lista_filtrada = perguntas_lista.filter((p) => p.id_temp !== id_temp);
    // Reordena
    const lista_reordenada = lista_filtrada.map((p, idx) => ({ ...p, ordem: idx + 1 }));
    set_perguntas_lista(lista_reordenada);
  };

  // Atualiza um campo de uma pergunta
  const atualizar_campo_pergunta = (
    id_temp: string,
    campo: keyof ItemPerguntaForm,
    valor: any
  ) => {
    set_perguntas_lista((anterior) =>
      anterior.map((item) => (item.id_temp === id_temp ? { ...item, [campo]: valor } : item))
    );
  };

  // Mover pergunta para cima ou para baixo
  const mover_pergunta = (index: number, direcao: 'cima' | 'baixo') => {
    if (direcao === 'cima' && index === 0) return;
    if (direcao === 'baixo' && index === perguntas_lista.length - 1) return;

    const nova_lista = [...perguntas_lista];
    const destino = direcao === 'cima' ? index - 1 : index + 1;
    const temp = nova_lista[index];
    nova_lista[index] = nova_lista[destino];
    nova_lista[destino] = temp;

    // Atualiza campo ordem
    set_perguntas_lista(nova_lista.map((p, idx) => ({ ...p, ordem: idx + 1 })));
  };

  // Salvar questionário e perguntas em lote no Supabase
  const salvar_questionario_completo = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!titulo_questionario.trim()) {
      alert('Por favor, informe o título do questionário.');
      return;
    }

    const perguntas_invalidas = perguntas_lista.some((p) => !p.texto_pergunta.trim());
    if (perguntas_invalidas) {
      alert('Preencha o texto de todas as perguntas antes de salvar.');
      return;
    }

    setErroQuest(null);
    setSucessoQuest(null);
    set_salvando(true);

    // Se estiver em modo de edição (idQuestionarioEdicao não nulo), executa o UPDATE
    if (idQuestionarioEdicao) {
      if (!conexao_configurada) {
        setTimeout(() => {
          set_questionarios_salvos((prev) =>
            prev.map((q) =>
              q.id_questionario === idQuestionarioEdicao
                ? { ...q, titulo: titulo_questionario, escala_minima: Number(escala_minima), escala_maxima: Number(escala_maxima) }
                : q
            )
          );
          set_salvando(false);
          setSucessoQuest('Questionário atualizado com sucesso!');
          exibir_notificacao('Questionário atualizado com sucesso!');
          setIdQuestionarioEdicao(null);
          set_titulo_questionario('');
        }, 600);
        return;
      }

      try {
        const { error: errUpdate } = await supabase
          .from('questionarios')
          .update({
            titulo_questionario: titulo_questionario,
            escala_minima: Number(escala_minima),
            escala_maxima: Number(escala_maxima),
          })
          .eq('id_questionario', idQuestionarioEdicao);

        if (errUpdate) {
          await supabase
            .from('questionario')
            .update({
              titulo_questionario: titulo_questionario,
              escala_minima: Number(escala_minima),
              escala_maxima: Number(escala_maxima),
            })
            .eq('id', idQuestionarioEdicao);
        }

        // Atualizar perguntas associadas
        await supabase.from('perguntas_questionario').delete().eq('id_questionario', idQuestionarioEdicao);
        const perguntas_mapeadas = perguntas_lista.map((p) => ({
          id_questionario: idQuestionarioEdicao,
          ordem: p.ordem,
          texto_pergunta: p.texto_pergunta,
          descricao_lembrete: p.descricao_lembrete || null,
          peso_calculo: Number(p.peso_calculo),
          peso_desempate: Number(p.peso_desempate),
        }));
        await supabase.from('perguntas_questionario').insert(perguntas_mapeadas);

        const msgSucesso = `Questionário "${titulo_questionario}" atualizado com sucesso!`;
        setSucessoQuest(msgSucesso);
        alert(msgSucesso);
        exibir_notificacao(msgSucesso);
        setIdQuestionarioEdicao(null);
        set_titulo_questionario('');
        await carregar_questionarios_existentes();
      } catch (erro_excecao: any) {
        console.error('Erro de atualização do questionário:', erro_excecao);
        const msg = `Falha ao atualizar o questionário: ${erro_excecao?.message || erro_excecao}`;
        setErroQuest(msg);
        alert(msg);
      } finally {
        set_salvando(false);
      }
      return;
    }

    if (!conexao_configurada) {
      setTimeout(() => {
        set_salvando(false);
        setSucessoQuest('Questionário salvo com sucesso no modo de contingência!');
        exibir_notificacao('Questionário salvo com sucesso no modo de contingência!');
        set_titulo_questionario('');
        carregar_questionarios_existentes();
      }, 600);
      return;
    }

    try {
      // Obter id_evento válido real (UUID)
      let id_evento_real = id_evento_ativo;
      const isUUID = (str?: string) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
      
      const { data: evt, error: evtErr } = await supabase
        .from('eventos')
        .select('id_evento')
        .eq('is_ativo', true)
        .single();

      if (evt?.id_evento) {
        id_evento_real = evt.id_evento;
      } else if (!isUUID(id_evento_real)) {
        const msg = 'Nenhum evento ativo encontrado para vincular o questionário.';
        setErroQuest(msg);
        alert(msg);
        set_salvando(false);
        return;
      }

      if (!id_evento_real || !isUUID(id_evento_real)) {
        const msg = 'Nenhum evento ativo encontrado para vincular o questionário.';
        setErroQuest(msg);
        alert(msg);
        set_salvando(false);
        return;
      }

      // Etapa 1: Inserir o cabeçalho na tabela questionarios encadeando .select('id_questionario').single() com a chave titulo_questionario
      const { data: quest_criado, error: errQuest } = await supabase
        .from('questionarios')
        .insert({
          titulo_questionario: titulo_questionario,
          escala_minima: Number(escala_minima),
          escala_maxima: Number(escala_maxima),
          id_evento: id_evento_real,
        })
        .select('id_questionario')
        .single();

      if (errQuest) {
        console.error('Falha ao salvar cabeçalho do questionário:', errQuest);
        const msg = `Falha ao salvar questionário: ${errQuest.message}`;
        setErroQuest(msg);
        alert(`Falha ao salvar questionário: ${errQuest.message} | Código: ${errQuest.code}`);
        set_salvando(false);
        return;
      }

      if (!quest_criado || !quest_criado.id_questionario) {
        const msg = 'Erro estrutural: Cabeçalho do questionário foi inserido, mas não retornou o id_questionario.';
        setErroQuest(msg);
        alert(msg);
        set_salvando(false);
        return;
      }

      const id_questionario = quest_criado.id_questionario;

      // Etapa 2: Usar o id_questionario retornado para mapear as perguntas e inserir na tabela perguntas_questionario
      const perguntas_mapeadas = perguntas_lista.map((p) => ({
        id_questionario: id_questionario,
        ordem: p.ordem,
        texto_pergunta: p.texto_pergunta,
        descricao_lembrete: p.descricao_lembrete || null,
        peso_calculo: Number(p.peso_calculo),
        peso_desempate: Number(p.peso_desempate),
      }));

      const { error: errPerg } = await supabase.from('perguntas_questionario').insert(perguntas_mapeadas);

      if (errPerg) {
        console.error('Falha ao salvar perguntas do questionário:', errPerg);
        const msg = `Falha ao salvar perguntas do questionário: ${errPerg.message}`;
        setErroQuest(msg);
        alert(`Falha ao salvar perguntas do questionário: ${errPerg.message} | Código: ${errPerg.code}`);
        set_salvando(false);
        return;
      }

      const msgSucesso = `Questionário "${titulo_questionario}" cadastrado com sucesso com ${perguntas_mapeadas.length} perguntas!`;
      setSucessoQuest(msgSucesso);
      alert(msgSucesso);
      exibir_notificacao(msgSucesso);
      set_titulo_questionario('');
      await carregar_questionarios_existentes();
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (erro_excecao: any) {
      console.error('Erro de gravação do questionário:', erro_excecao);
      const msg = `Falha inesperada ao gravar o questionário: ${erro_excecao?.message || erro_excecao}`;
      setErroQuest(msg);
      alert(msg);
    } finally {
      set_salvando(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 lg:p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-8 font-sans">
      {/* Toast Notificação */}
      {mensagem_notificacao && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white dark:bg-emerald-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 dark:text-white shrink-0" />
          <span>{mensagem_notificacao}</span>
        </div>
      )}

      {/* Cabeçalho do Gestor */}
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
            accept=".csv, .xlsx, .xls"
            className="hidden"
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
            className="px-3.5 py-2.5 bg-violet-600 hover:bg-violet-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-60"
            title="Importar (.xls/.xlsx/.csv)"
          >
            {processando_arquivo ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            <span>{processando_arquivo ? 'Processando Planilha...' : 'Importar (.xls/.xlsx/.csv)'}</span>
          </button>

          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              title="Fechar Janela"
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
            <div className="flex items-center gap-2 text-violet-400">
              <Terminal className="w-4 h-4" />
              <span>Console de Importação de Questionários</span>
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

      {/* Form de Criação de Questionário Pai e Perguntas Filhas */}
      <form onSubmit={salvar_questionario_completo} className="space-y-6">
        {erroQuest && (
          <div className="p-4 mb-4 text-white bg-red-600 rounded-xl font-medium shadow-sm flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{erroQuest}</span>
          </div>
        )}
        {sucessoQuest && (
          <div className="p-4 mb-4 text-white bg-emerald-600 rounded-xl font-medium shadow-sm flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{sucessoQuest}</span>
          </div>
        )}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">
            1. Dados Gerais do Questionário (Tabela questionarios)
          </span>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
              Título do Questionário:
            </label>
            <input
              type="text"
              value={titulo_questionario}
              onChange={(e) => set_titulo_questionario(e.target.value)}
              placeholder="Ex: Formuário de Pesquisa Aplicada - Feiras IFMS"
              required
              className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Escala Mínima:
              </label>
              <input
                type="number"
                min="0"
                max="5"
                value={escala_minima}
                onChange={(e) => set_escala_minima(Number(e.target.value))}
                required
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Escala Máxima:
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={escala_maxima}
                onChange={(e) => set_escala_maxima(Number(e.target.value))}
                required
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* 3. Lista Dinâmica de Perguntas (Tabela perguntas_questionario) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <ListOrdered className="w-4 h-4 text-emerald-600" />
              2. Perguntas e Critérios de Avaliação (Tabela perguntas_questionario)
            </span>

            <button
              type="button"
              onClick={adicionar_nova_pergunta}
              className="px-3.5 py-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 hover:bg-emerald-200 text-emerald-800 dark:text-emerald-300 font-bold text-xs transition-all flex items-center gap-1.5 border border-emerald-300 dark:border-emerald-800"
            >
              <Plus className="w-4 h-4" />
              Adicionar Pergunta
            </button>
          </div>

          <div className="space-y-3">
            {perguntas_lista.map((item_pergunta, index) => (
              <div
                key={item_pergunta.id_temp}
                className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="px-2.5 py-1 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-mono text-xs font-bold rounded-lg shrink-0">
                    Ordem #{item_pergunta.ordem}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => mover_pergunta(index, 'cima')}
                      disabled={index === 0}
                      title="Mover para cima"
                      className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => mover_pergunta(index, 'baixo')}
                      disabled={index === perguntas_lista.length - 1}
                      title="Mover para baixo"
                      className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remover_pergunta(item_pergunta.id_temp)}
                      title="Remover pergunta"
                      className="p-1 text-red-500 hover:text-red-700 dark:hover:text-red-400 ml-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                    Texto da Pergunta / Critério:
                  </label>
                  <input
                    type="text"
                    value={item_pergunta.texto_pergunta}
                    onChange={(e) =>
                      atualizar_campo_pergunta(item_pergunta.id_temp, 'texto_pergunta', e.target.value)
                    }
                    placeholder="Ex: Domínio da metodologia científica e coerência nos resultados"
                    required
                    className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                    LEMBRETE / TEXTO DE AJUDA PARA O AVALIADOR (OPCIONAL)
                  </label>
                  <input
                    type="text"
                    value={item_pergunta.descricao_lembrete || ''}
                    onChange={(e) =>
                      atualizar_campo_pergunta(item_pergunta.id_temp, 'descricao_lembrete', e.target.value)
                    }
                    placeholder="Ex: Considere o domínio das técnicas empregadas e a clareza na exposição dos dados"
                    className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                      Peso para Cálculo Média:
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="10.0"
                      value={item_pergunta.peso_calculo}
                      onChange={(e) =>
                        atualizar_campo_pergunta(
                          item_pergunta.id_temp,
                          'peso_calculo',
                          parseFloat(e.target.value)
                        )
                      }
                      required
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase mb-1">
                      Ordem de Prioridade no Desempate:
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={item_pergunta.peso_desempate}
                      onChange={(e) =>
                        atualizar_campo_pergunta(
                          item_pergunta.id_temp,
                          'peso_desempate',
                          parseInt(e.target.value, 10)
                        )
                      }
                      required
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Botão de Salvar Completo */}
        <div className="pt-2 flex justify-end gap-2">
          {idQuestionarioEdicao && (
            <button
              type="button"
              onClick={() => {
                setIdQuestionarioEdicao(null);
                set_titulo_questionario('');
              }}
              className="px-4 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-bold text-sm rounded-xl transition-all"
            >
              Cancelar Edição
            </button>
          )}
          <button
            type="submit"
            disabled={salvando}
            className="w-full sm:w-auto px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2 active:scale-95"
          >
            {salvando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {idQuestionarioEdicao ? 'Atualizar Questionário no Supabase' : 'Salvar Questionário no Supabase (Lote)'}
          </button>
        </div>
      </form>

      {/* Lista de Questionários já Cadastrados */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-500" />
          Questionários Cadastrados no Banco de Dados
        </h3>

        {carregando_lista ? (
          <div className="p-4 text-center">
            <Loader2 className="w-5 h-5 text-emerald-600 animate-spin mx-auto" />
          </div>
        ) : questionarios_salvos.length === 0 ? (
          <p className="text-xs text-slate-500 italic">Nenhum questionário cadastrado ainda.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {questionarios_salvos.map((quest) => (
              <div
                key={quest.id_questionario}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-xs space-y-1"
              >
                <h4 className="font-extrabold text-slate-900 dark:text-white leading-snug">
                  {quest.titulo}
                </h4>
                <p className="text-slate-500 text-[11px]">
                  Escala: {quest.escala_minima} a {quest.escala_maxima} • ID: <code className="font-mono text-emerald-600">{quest.id_questionario}</code>
                </p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => handleEditarQuestionario(quest)} className="px-3 py-1 text-sm bg-blue-500 text-white rounded">Editar</button>
                  <button onClick={() => handleExcluirQuestionario(quest.id_questionario)} className="px-3 py-1 text-sm bg-red-500 text-white rounded">Excluir</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
