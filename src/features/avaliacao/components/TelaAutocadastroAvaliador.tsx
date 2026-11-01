import React, { useState, useEffect } from 'react';
import {
  Award,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Building,
  Mail,
  User,
  BookOpen,
  ArrowLeft,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { ImagemEvento } from '@/components/layout/IdentidadeVisual';

interface InstituicaoItem {
  id_instituicao: string;
  nome_exibicao: string;
}

interface AreaItem {
  id_area: string;
  nome_area: string;
}

interface TelaAutocadastroAvaliadorProps {
  aoConcluir?: () => void;
  aoVoltar?: () => void;
}

export const TelaAutocadastroAvaliador: React.FC<TelaAutocadastroAvaliadorProps> = ({
  aoConcluir,
  aoVoltar,
}) => {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [instituicaoSelecionadaId, setInstituicaoSelecionadaId] = useState('');
  const [outraInstituicao, setOutraInstituicao] = useState('');
  const [areasSelecionadas, setAreasSelecionadas] = useState<string[]>([]);

  const [listaInstituicoes, setListaInstituicoes] = useState<InstituicaoItem[]>([]);
  const [listaAreas, setListaAreas] = useState<AreaItem[]>([]);
  const [nomeEvento, setNomeEvento] = useState('Feira de Ciência e Tecnologia');
  const [idEventoAtivo, setIdEventoAtivo] = useState<string>('');

  const [carregandoDados, setCarregandoDados] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [cadastroSucesso, setCadastroSucesso] = useState(false);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  const conexaoConfigurada = verificar_conexao_configurada();

  useEffect(() => {
    const carregarInformacoesEvento = async () => {
      setCarregandoDados(true);
      setMensagemErro(null);

      try {
        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        // Evento do link de cadastro; sem ele, o ativo do banco (nunca um id guardado neste navegador)
        let idEvento = params?.get('evento') || '';

        if (!conexaoConfigurada) {
          setIdEventoAtivo(idEvento || 'evento-contingencia');
          setListaInstituicoes([
            { id_instituicao: 'inst-1', nome_exibicao: 'IFMS - Campus Corumbá' },
            { id_instituicao: 'inst-2', nome_exibicao: 'UFMS' },
            { id_instituicao: 'inst-3', nome_exibicao: 'Escola Estadual Maria Leite' },
          ]);
          setListaAreas([
            { id_area: 'area-1', nome_area: 'Ciências Exatas e da Terra' },
            { id_area: 'area-2', nome_area: 'Ciências Biológicas e da Saúde' },
            { id_area: 'area-3', nome_area: 'Engenharias e Tecnologias' },
            { id_area: 'area-4', nome_area: 'Ciências Humanas e Sociais' },
          ]);
          setCarregandoDados(false);
          return;
        }

        // Se idEvento não foi passado pela URL, busca o evento ativo no banco
        if (!idEvento) {
          const { data: eventoDb } = await supabase
            .from('eventos')
            .select('id_evento, nome_evento')
            .eq('is_ativo', true)
            .limit(1)
            .maybeSingle();

          if (eventoDb) {
            idEvento = eventoDb.id_evento;
            if (eventoDb.nome_evento) setNomeEvento(eventoDb.nome_evento);
          }
        } else {
          // Busca o nome do evento com base no ID
          const { data: eventoDb } = await supabase
            .from('eventos')
            .select('id_evento, nome_evento')
            .eq('id_evento', idEvento)
            .maybeSingle();

          if (eventoDb?.nome_evento) {
            setNomeEvento(eventoDb.nome_evento);
          }
        }

        setIdEventoAtivo(idEvento);
        if (!idEvento) {
          setMensagemErro('Não há evento ativo: o cadastro abre quando o evento estiver ativo.');
          return;
        }

        // Busca instituições e áreas do evento
        let queryInst: any = supabase.from('instituicoes').select('id_instituicao, nome_exibicao').order('nome_exibicao');
        let queryAreas: any = supabase.from('areas_tematicas').select('id_area, nome_area').order('nome_area');

        queryInst = queryInst.eq('id_evento', idEvento);
        queryAreas = queryAreas.eq('id_evento', idEvento);

        const [resInst, resAreas] = await Promise.all([queryInst, queryAreas]);

        if (resInst?.data) setListaInstituicoes(resInst.data);
        if (resAreas?.data) setListaAreas(resAreas.data);
      } catch (err: any) {
        console.error('Erro ao carregar dados do evento:', err);
      } finally {
        setCarregandoDados(false);
      }
    };

    carregarInformacoesEvento();
  }, [conexaoConfigurada]);

  const alternarArea = (idArea: string) => {
    setAreasSelecionadas((prev) =>
      prev.includes(idArea) ? prev.filter((id) => id !== idArea) : [...prev, idArea]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagemErro(null);

    const nomeLimpo = nome.trim();
    const emailLimpo = email.toLowerCase().trim();

    if (!nomeLimpo || !emailLimpo) {
      setMensagemErro('Por favor, informe seu nome completo e e-mail.');
      return;
    }

    if (!instituicaoSelecionadaId && !outraInstituicao.trim()) {
      setMensagemErro('Por favor, selecione ou informe sua instituição de origem.');
      return;
    }

    setSalvando(true);

    if (!conexaoConfigurada) {
      setTimeout(() => {
        setSalvando(false);
        setCadastroSucesso(true);
      }, 600);
      return;
    }

    try {
      // Tudo no banco (fn_autocadastro_avaliador): cria só cadastros novos e nunca
      // altera nome, áreas ou credenciamento de quem já existe.
      const instituicaoExistente = instituicaoSelecionadaId && instituicaoSelecionadaId !== 'outra' ? instituicaoSelecionadaId : null;
      const { error: errCadastro } = await supabase.rpc('fn_autocadastro_avaliador', {
        p_id_evento: idEventoAtivo || null,
        p_nome: nomeLimpo,
        p_email: emailLimpo,
        p_id_instituicao: instituicaoExistente,
        p_nome_instituicao_nova: instituicaoSelecionadaId === 'outra' ? outraInstituicao.trim() : null,
        p_ids_areas: areasSelecionadas.length > 0 ? areasSelecionadas : null,
      });
      if (errCadastro) {
        throw new Error(errCadastro.message);
      }

      setCadastroSucesso(true);
    } catch (err: any) {
      console.error('Erro no autocadastro:', err);
      setMensagemErro(err?.message || 'Ocorreu um erro ao concluir seu cadastro. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-900 py-8 px-4 sm:px-6 flex items-center justify-center font-sans">
      <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 shadow-xl space-y-6">
        <ImagemEvento />

        {/* Cabeçalho */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Recepção & Credenciamento</span>
          </div>

          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Autocadastro de Avaliador
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            {nomeEvento}
          </p>
        </div>

        {carregandoDados ? (
          <div className="py-12 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Preparando formulário do evento...</p>
          </div>
        ) : cadastroSucesso ? (
          <div className="space-y-6 text-center py-4 animate-in fade-in zoom-in duration-200">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700 rounded-2xl flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                Cadastro Concluído!
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto leading-relaxed">
                Seus dados foram registrados com sucesso. Por favor, <strong>apresente-se à recepção (equipe Staff)</strong> para validar e liberar seu credenciamento presencial no evento.
              </p>
            </div>

            <div className="bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl p-4 text-xs text-emerald-800 dark:text-emerald-300 text-left space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Próximos Passos:</span>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-slate-700 dark:text-slate-300">
                <li>Informe seu nome à equipe do Staff na bancada de entrada.</li>
                <li>Assim que o Staff confirmar seu credenciamento, você poderá fazer login no sistema usando seu e-mail cadastrado.</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => {
                if (aoConcluir) {
                  aoConcluir();
                } else {
                  window.location.href = window.location.pathname;
                }
              }}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>Ir para a Tela de Acesso</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mensagemErro && (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-800 dark:text-rose-200 font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{mensagemErro}</span>
              </div>
            )}

            {/* Nome Completo */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Nome Completo:
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Prof. Dr. Carlos Silva"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            {/* E-mail */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                E-mail para Acesso:
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.email@exemplo.com"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            {/* Instituição de Origem */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Instituição de Origem:
              </label>
              <div className="relative">
                <select
                  value={instituicaoSelecionadaId}
                  onChange={(e) => setInstituicaoSelecionadaId(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Selecione sua Instituição...</option>
                  {listaInstituicoes.map((inst) => (
                    <option key={inst.id_instituicao} value={inst.id_instituicao}>
                      {inst.nome_exibicao}
                    </option>
                  ))}
                  <option value="outra">+ Outra Instituição (Digitar)</option>
                </select>
                <Building className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
              </div>

              {instituicaoSelecionadaId === 'outra' && (
                <div className="mt-2 animate-in fade-in duration-150">
                  <input
                    type="text"
                    required
                    value={outraInstituicao}
                    onChange={(e) => setOutraInstituicao(e.target.value)}
                    placeholder="Digite o nome completo da Instituição"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              )}
            </div>

            {/* Áreas Temáticas */}
            {listaAreas.length > 0 && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Áreas de Interesse para Avaliação (opcional):</span>
                </label>
                <p className="text-legenda text-slate-500 dark:text-slate-400 mb-2">
                  Selecione uma ou mais áreas que correspondam à sua especialidade:
                </p>

                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1">
                  {listaAreas.map((area) => {
                    const estaSelecionada = areasSelecionadas.includes(area.id_area);
                    return (
                      <button
                        key={area.id_area}
                        type="button"
                        onClick={() => alternarArea(area.id_area)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all text-left flex items-center gap-1.5 cursor-pointer ${
                          estaSelecionada
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <CheckCircle2
                          className={`w-3.5 h-3.5 ${
                            estaSelecionada ? 'text-white' : 'text-slate-400'
                          }`}
                        />
                        <span>{area.nome_area}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={salvando}
              className="w-full mt-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-extrabold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {salvando ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Registrando Avaliador...</span>
                </>
              ) : (
                <>
                  <Award className="w-4 h-4" />
                  <span>Concluir Cadastro</span>
                </>
              )}
            </button>

            {aoVoltar && (
              <button
                type="button"
                onClick={aoVoltar}
                className="w-full py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar para tela de acesso</span>
              </button>
            )}
          </form>
        )}
      </div>
    </main>
  );
};
