import React, { useState } from 'react';
import {
  CheckCircle2,
  X,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Building2,
  Layers,
  Database,
  Loader2,
  Save,
} from 'lucide-react';
import { CandidatoMatch, sanitizarTexto } from '@/lib/parsers/fuzzyMatcher';
import { supabase } from '@/lib/supabase';

export interface ItemMapeamentoDePara {
  id_termo: string;
  termo_original: string;
  tipo: 'instituicao' | 'modalidade' | 'area';
  sugestao_id: string | null; // ID da entidade sugerida ou null se novo
  sugestao_nome: string | null;
  confianca_percentual: number;
  match_tipo: 'exato' | 'fuzzy' | 'novo';
}

export interface DecisaoMapeamento {
  termo_original: string;
  tipo: 'instituicao' | 'modalidade' | 'area';
  acao: 'associar_existente' | 'criar_novo' | 'cadastrar_novo';
  id_destino?: string | null;
  nome_destino?: string | null;
  novo_nome?: string | null;
}

export interface ModalDeParaMappingProps {
  isOpen?: boolean;
  itensMapeamento?: ItemMapeamentoDePara[];
  itens?: ItemMapeamentoDePara[];
  candidatosInstituicoes?: CandidatoMatch[];
  instituicoesExistentes?: any[];
  candidatosModalidades?: CandidatoMatch[];
  modalidadesExistentes?: any[];
  candidatosAreas?: CandidatoMatch[];
  areasExistentes?: any[];
  aoConfirmar: (decisoes: Map<string, DecisaoMapeamento>) => Promise<void> | void;
  aoCancelar?: () => void;
  aoFechar?: () => void;
}

export const ModalDeParaMapping: React.FC<ModalDeParaMappingProps> = ({
  isOpen = true,
  itensMapeamento,
  itens,
  candidatosInstituicoes,
  instituicoesExistentes,
  candidatosModalidades,
  modalidadesExistentes,
  candidatosAreas,
  areasExistentes,
  aoConfirmar,
  aoCancelar,
  aoFechar,
}) => {
  const listaItens = itensMapeamento || itens || [];
  const callbackFechar = aoCancelar || aoFechar || (() => {});

  // Normalização de candidatos para seleção
  const listaInst = candidatosInstituicoes || (instituicoesExistentes || []).map((i: any) => ({
    id: i.id_instituicao || i.id,
    nome: i.nome_exibicao || i.nome,
    sigla: i.sigla,
  }));

  const listaMods = candidatosModalidades || (modalidadesExistentes || []).map((m: any) => ({
    id: m.id_modalidade || m.id,
    nome: m.nome_modalidade || m.nome,
    sigla: m.codigo,
  }));

  const listaAreas = candidatosAreas || (areasExistentes || []).map((a: any) => ({
    id: a.id_area || a.id,
    nome: a.nome_area || a.nome,
    sigla: '',
  }));

  if (!isOpen || listaItens.length === 0) return null;

  // Mapa de seleções do usuário: id_termo -> valor selecionado ('NOVO' ou id_existente)
  const [selecoes, setSelecoes] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    listaItens.forEach((item) => {
      if (item.sugestao_id && item.confianca_percentual >= 85) {
        inicial[item.id_termo] = item.sugestao_id;
      } else {
        inicial[item.id_termo] = 'NOVO';
      }
    });
    return inicial;
  });

  const [salvando, setSalvando] = useState<boolean>(false);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  const handleMudarSelecao = (id_termo: string, novoValor: string) => {
    setSelecoes((prev) => ({
      ...prev,
      [id_termo]: novoValor,
    }));
  };

  const handleSubmeter = async () => {
    setSalvando(true);
    setMensagemErro(null);

    try {
      const mapaDecisoes = new Map<string, DecisaoMapeamento>();
      const novosAliasesParaSalvarInstituicao: Array<{ id_instituicao: string; alias: string; alias_normalizado: string }> = [];
      const novosAliasesParaSalvarModalidade: Array<{ id_modalidade: string; alias: string; alias_normalizado: string }> = [];

      listaItens.forEach((item) => {
        const escolha = selecoes[item.id_termo] || 'NOVO';
        const listaCandidatos = item.tipo === 'instituicao' ? listaInst : item.tipo === 'modalidade' ? listaMods : listaAreas;
        const candidatoEscolhido = listaCandidatos.find((c) => c.id === escolha);

        if (escolha === 'NOVO' || !candidatoEscolhido) {
          mapaDecisoes.set(item.termo_original, {
            termo_original: item.termo_original,
            tipo: item.tipo,
            acao: 'cadastrar_novo',
            novo_nome: item.termo_original.trim(),
          });
        } else {
          mapaDecisoes.set(item.termo_original, {
            termo_original: item.termo_original,
            tipo: item.tipo,
            acao: 'associar_existente',
            id_destino: candidatoEscolhido.id,
            nome_destino: candidatoEscolhido.nome,
          });

          // Se o termo original for diferente do nome oficial, adiciona ao dicionário de aliases
          const aliasNorm = sanitizarTexto(item.termo_original);
          const nomeNorm = sanitizarTexto(candidatoEscolhido.nome);
          const siglaNorm = candidatoEscolhido.sigla ? sanitizarTexto(candidatoEscolhido.sigla) : '';

          if (aliasNorm !== nomeNorm && aliasNorm !== siglaNorm) {
            if (item.tipo === 'instituicao') {
              novosAliasesParaSalvarInstituicao.push({
                id_instituicao: candidatoEscolhido.id,
                alias: item.termo_original.trim(),
                alias_normalizado: aliasNorm,
              });
            } else if (item.tipo === 'modalidade') {
              novosAliasesParaSalvarModalidade.push({
                id_modalidade: candidatoEscolhido.id,
                alias: item.termo_original.trim(),
                alias_normalizado: aliasNorm,
              });
            }
          }
        }
      });

      // 1. Salva automaticamente novos aliases no Supabase (Dicionário de Aprendizado)
      if (novosAliasesParaSalvarInstituicao.length > 0) {
        try {
          await supabase
            .from('instituicao_aliases')
            .upsert(novosAliasesParaSalvarInstituicao, { onConflict: 'id_instituicao,alias_normalizado' });
        } catch (eAlias) {
          console.warn('Aviso ao persistir novos aliases de instituições:', eAlias);
        }
      }

      if (novosAliasesParaSalvarModalidade.length > 0) {
        try {
          await supabase
            .from('modalidade_aliases')
            .upsert(novosAliasesParaSalvarModalidade, { onConflict: 'id_modalidade,alias_normalizado' });
        } catch (eAlias) {
          console.warn('Aviso ao persistir novos aliases de modalidades:', eAlias);
        }
      }

      // 2. Transmite as decisões mapeadas para a rotina de importação
      await aoConfirmar(mapaDecisoes);
    } catch (err: any) {
      console.error('Erro ao processar confirmação de De-Para:', err);
      setMensagemErro(`Falha ao confirmar importação: ${err?.message || 'Erro inesperado'}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl w-full max-w-4xl max-h-[90vh] shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        {/* Cabeçalho */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                Validação e De-Para de Dados (Mapping)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Revise os termos encontrados na planilha para evitar duplicações. Os mapeamentos confirmados serão aprendidos no Dicionário de Aliases.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={callbackFechar}
            disabled={salvando}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerta de erro */}
        {mensagemErro && (
          <div className="mx-6 mt-4 p-3.5 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-2.5 text-xs text-red-700 dark:text-red-300 font-bold shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
        )}

        {/* Tabela de Mapeamento De-Para */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                <tr>
                  <th className="px-4 py-3">Termo da Planilha</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Sugestão de Similaridade</th>
                  <th className="px-4 py-3">Mapear Para (De-Para)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {listaItens.map((item) => {
                  const valorAtual = selecoes[item.id_termo] || 'NOVO';
                  const listaCandidatos = item.tipo === 'instituicao' ? listaInst : item.tipo === 'modalidade' ? listaMods : listaAreas;

                  return (
                    <tr key={item.id_termo} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      {/* Termo da Planilha */}
                      <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <span>{item.termo_original}</span>
                        </div>
                      </td>

                      {/* Tipo */}
                      <td className="px-4 py-3.5">
                        {item.tipo === 'instituicao' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            <Building2 className="w-3 h-3" />
                            Instituição
                          </span>
                        ) : item.tipo === 'modalidade' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            <Layers className="w-3 h-3" />
                            Modalidade
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <Database className="w-3 h-3" />
                            Área
                          </span>
                        )}
                      </td>

                      {/* Sugestão de Similaridade */}
                      <td className="px-4 py-3.5">
                        {item.sugestao_nome && item.confianca_percentual >= 85 ? (
                          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-semibold text-xs">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>{item.sugestao_nome}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 text-emerald-800 dark:text-emerald-300">
                              {item.confianca_percentual}% match
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 italic text-[11px] flex items-center gap-1">
                            Sem correspondência ≥ 85%
                          </span>
                        )}
                      </td>

                      {/* Select de De-Para */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <select
                            value={valorAtual}
                            onChange={(e) => handleMudarSelecao(item.id_termo, e.target.value)}
                            className={`w-full max-w-xs px-3 py-2 rounded-xl text-xs font-semibold border transition-all focus:outline-none focus:ring-2 ${
                              valorAtual === 'NOVO'
                                ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 focus:ring-amber-500'
                                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-emerald-500'
                            }`}
                          >
                            <option value="NOVO">
                              + Cadastrar como Novo ({item.tipo === 'instituicao' ? 'Instituição' : item.tipo === 'modalidade' ? 'Modalidade' : 'Área Temática'})
                            </option>
                            <optgroup label="Registros Existentes no Sistema">
                              {listaCandidatos.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nome} {c.sigla ? `(${c.sigla})` : ''}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rodapé de Ações */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Database className="w-4 h-4 text-emerald-600" />
            <span>
              Total a validar: <strong className="text-slate-800 dark:text-slate-200">{listaItens.length}</strong> termo(s) único(s)
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={callbackFechar}
              disabled={salvando}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSubmeter}
              disabled={salvando}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black transition-all flex items-center gap-2 shadow-xs cursor-pointer"
            >
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Confirmar e Prosseguir com a Importação</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
