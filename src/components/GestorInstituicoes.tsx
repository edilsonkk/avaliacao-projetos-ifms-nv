import React, { useState, useEffect } from 'react';
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
  Save
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

interface InstituicaoRegistro {
  id_instituicao: string;
  id?: string;
  nome_exibicao: string;
  nome_normalizado?: string;
  criado_em?: string;
}

const instituicoes_fallback: InstituicaoRegistro[] = [
  { id_instituicao: 'inst-01', nome_exibicao: 'IFMS - Câmpus Campo Grande', nome_normalizado: 'ifmscampuscampogrande' },
  { id_instituicao: 'inst-02', nome_exibicao: 'IFMS - Câmpus Corumbá', nome_normalizado: 'ifmscampuscorumba' },
  { id_instituicao: 'inst-03', nome_exibicao: 'IFMS - Câmpus Dourados', nome_normalizado: 'ifmscampusdourados' },
  { id_instituicao: 'inst-04', nome_exibicao: 'UFMS - Universidade Federal de Mato Grosso do Sul', nome_normalizado: 'ufmsuniversidadefederaldematogrossodosul' },
  { id_instituicao: 'inst-05', nome_exibicao: 'UCDB - Universidade Católica Dom Bosco', nome_normalizado: 'ucdbuniversidadecatolicadombosco' },
];

export const GestorInstituicoes: React.FC<{ ao_fechar?: () => void }> = ({ ao_fechar }) => {
  const [instituicoes, set_instituicoes] = useState<InstituicaoRegistro[]>([]);
  const [carregando, set_carregando] = useState<boolean>(true);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // Formulário de Criação
  const [mostrar_form_novo, set_mostrar_form_novo] = useState<boolean>(false);
  const [novo_nome_exibicao, set_novo_nome_exibicao] = useState<string>('');
  const [salvando_novo, set_salvando_novo] = useState<boolean>(false);

  // Edição
  const [instituicao_em_edicao, set_instituicao_em_edicao] = useState<InstituicaoRegistro | null>(null);
  const [nome_editado, set_nome_editado] = useState<string>('');
  const [salvando_edicao, set_salvando_edicao] = useState<boolean>(false);

  // Exclusão
  const [excluindo_id, set_excluindo_id] = useState<string | null>(null);

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
      const { data, error } = await supabase
        .from('instituicoes')
        .select('id_instituicao, nome_exibicao, nome_normalizado')
        .order('nome_exibicao', { ascending: true });

      if (error) {
        // Tenta fallback com nome de coluna id
        const { data: dataAlt, error: errAlt } = await supabase
          .from('instituicoes')
          .select('*')
          .order('nome_exibicao', { ascending: true });

        if (errAlt) throw error;
        set_instituicoes(
          (dataAlt || []).map((item: any) => ({
            id_instituicao: item.id_instituicao || item.id,
            nome_exibicao: item.nome_exibicao || item.nome || 'Instituição',
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
  }, []);

  // 2. INSERT: Adicionar Nova Instituição
  const handle_adicionar_instituicao = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = novo_nome_exibicao.trim();
    if (!nome) return;

    set_salvando_novo(true);
    const nome_norm = normalizar_texto(nome);

    if (!conexao_banco) {
      const nova: InstituicaoRegistro = {
        id_instituicao: 'inst-' + Math.random().toString(36).substring(2, 7),
        nome_exibicao: nome,
        nome_normalizado: nome_norm,
      };
      set_instituicoes((prev) => [nova, ...prev]);
      set_novo_nome_exibicao('');
      set_mostrar_form_novo(false);
      set_salvando_novo(false);
      exibir_toast('Instituição adicionada (modo local)!');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('instituicoes')
        .insert({
          nome_exibicao: nome,
          nome_normalizado: nome_norm,
        })
        .select()
        .single();

      if (error) {
        alert('Erro do Supabase ao cadastrar instituição: ' + error.message);
        return;
      }

      exibir_toast('Instituição cadastrada com sucesso no banco!');
      set_novo_nome_exibicao('');
      set_mostrar_form_novo(false);
      await carregar_instituicoes();
    } catch (e: any) {
      alert('Erro inesperado: ' + e.message);
    } finally {
      set_salvando_novo(false);
    }
  };

  // 3. UPDATE: Editar Instituição
  const handle_salvar_edicao = async () => {
    if (!instituicao_em_edicao || !nome_editado.trim()) return;

    set_salvando_edicao(true);
    const id_alvo = instituicao_em_edicao.id_instituicao || instituicao_em_edicao.id;
    const novo_nome = nome_editado.trim();
    const nome_norm = normalizar_texto(novo_nome);

    if (!conexao_banco) {
      set_instituicoes((prev) =>
        prev.map((inst) =>
          (inst.id_instituicao === id_alvo || inst.id === id_alvo)
            ? { ...inst, nome_exibicao: novo_nome, nome_normalizado: nome_norm }
            : inst
        )
      );
      set_instituicao_em_edicao(null);
      set_nome_editado('');
      set_salvando_edicao(false);
      exibir_toast('Instituição atualizada (modo local)!');
      return;
    }

    try {
      const { error } = await supabase
        .from('instituicoes')
        .update({
          nome_exibicao: novo_nome,
          nome_normalizado: nome_norm,
        })
        .eq('id_instituicao', id_alvo);

      if (error) {
        // Tenta com coluna id
        const { error: errAlt } = await supabase
          .from('instituicoes')
          .update({
            nome_exibicao: novo_nome,
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

  const instituicoes_filtradas = instituicoes.filter((inst) => {
    if (!termo_busca.trim()) return true;
    const termo = termo_busca.toLowerCase().trim();
    return (
      (inst.nome_exibicao || '').toLowerCase().includes(termo) ||
      (inst.nome_normalizado || '').toLowerCase().includes(termo)
    );
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
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs tracking-wider uppercase mb-1">
            <School className="w-4 h-4" /> Módulo Relacional (Tabela `instituicoes`)
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Building className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            Gestor de Instituições de Ensino
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Controle de cadastro, atualização do nome de exibição e exclusão com tratamento de chave estrangeira (FK).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={carregar_instituicoes}
            disabled={carregando}
            title="Recarregar"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => set_mostrar_form_novo(!mostrar_form_novo)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            Nova Instituição
          </button>

          {ao_fechar && (
            <button
              type="button"
              onClick={ao_fechar}
              className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

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
              onClick={() => set_mostrar_form_novo(false)}
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
              placeholder="Nome de exibição (ex: UFMS - Câmpus Pantanal)"
              className="flex-1 px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
            <button
              type="submit"
              disabled={salvando_novo || !novo_nome_exibicao.trim()}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shrink-0 shadow-xs"
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
            placeholder="Buscar instituição por nome..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 self-end sm:self-center">
          Total: <strong className="text-slate-800 dark:text-slate-200">{instituicoes_filtradas.length}</strong> instituições
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
            className="text-xs font-bold underline"
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
      ) : instituicoes_filtradas.length === 0 ? (
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
                <th className="px-5 py-3.5">Nome de Exibição</th>
                <th className="px-5 py-3.5 hidden sm:table-cell">Nome Normalizado (Slug)</th>
                <th className="px-5 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {instituicoes_filtradas.map((inst) => {
                const id_inst = inst.id_instituicao || inst.id || '';
                const em_edicao = instituicao_em_edicao?.id_instituicao === id_inst || instituicao_em_edicao?.id === id_inst;
                const excluindo = excluindo_id === id_inst;

                return (
                  <tr key={id_inst} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-3.5 font-medium">
                      {em_edicao ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={nome_editado}
                            onChange={(e) => set_nome_editado(e.target.value)}
                            className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-emerald-500 rounded-lg text-xs w-full max-w-md focus:outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={handle_salvar_edicao}
                            disabled={salvando_edicao || !nome_editado.trim()}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shrink-0"
                          >
                            {salvando_edicao ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              set_instituicao_em_edicao(null);
                              set_nome_editado('');
                            }}
                            className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-bold"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <Building className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span className="font-bold text-slate-900 dark:text-white">{inst.nome_exibicao}</span>
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-3.5 hidden sm:table-cell font-mono text-[11px] text-slate-500">
                      {inst.nome_normalizado || '-'}
                    </td>

                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      {!em_edicao && (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              set_instituicao_em_edicao(inst);
                              set_nome_editado(inst.nome_exibicao);
                            }}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                            title="Editar Nome de Exibição"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handle_excluir_instituicao(id_inst, inst.nome_exibicao)}
                            disabled={excluindo}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 transition-colors"
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
