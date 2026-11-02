import React, { useState, useEffect } from 'react';
import {
  LIMITES_ACESSO,
  METODOS_VINCULO,
  PARAMETROS_ACESSO_PADRAO,
  lerParametrosAcesso,
  validarParametrosAcesso,
  type MetodoVinculo,
  type ParametrosAcesso,
} from '../acessoAvaliadores';
import { Settings, X, Save, Loader2, CheckCircle2, AlertTriangle, RotateCcw, History, PlusCircle, Building2, ShieldCheck } from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { Dica } from '@/components/ui/Dica';
import { SecaoSegurancaContas } from './SecaoSegurancaContas';
import { SecaoIdentidadeVisual } from './SecaoIdentidadeVisual';

const MENSAGEM_SEM_EVENTO_ATIVO =
  'Nenhum evento ativo. Crie um evento ou ative um evento anterior antes de salvar as configurações.';

interface PropriedadesModalConfiguracoes {
  id_evento_ativo: string;
  nome_evento_atual?: string;
  ao_fechar: () => void;
  ao_salvar_sucesso?: (novoNome?: string, novaData?: string) => void;
  ao_disparar_reset_global?: () => void;
  ao_abrir_historico?: () => void;
  ao_abrir_novo_evento?: () => void;
  ao_abrir_instituicoes?: () => void;
  ao_abrir_administradores?: () => void;
}

export const ModalConfiguracoesEvento: React.FC<PropriedadesModalConfiguracoes> = ({
  id_evento_ativo,
  nome_evento_atual,
  ao_fechar,
  ao_salvar_sucesso,
  ao_disparar_reset_global,
  ao_abrir_historico,
  ao_abrir_novo_evento,
  ao_abrir_instituicoes,
  ao_abrir_administradores,
}) => {
  // Campos de estado do formulário de configurações do evento
  const [nome_evento, set_nome_evento] = useState<string>(nome_evento_atual || 'FETEC MS 2026');
  const [data_evento, set_data_evento] = useState<string>(new Date().toISOString().split('T')[0]);
  const [minutos_timeout_lock, set_minutos_timeout_lock] = useState<number>(15);
  const [cota_avaliacoes_padrao, set_cota_avaliacoes_padrao] = useState<number>(3);
  const [sistema_liberado, set_sistema_liberado] = useState<boolean>(true);
  const [horario_inicio, set_horario_inicio] = useState<string>('08:00');
  const [horario_fim, set_horario_fim] = useState<string>('18:00');
  const [parametros_acesso, set_parametros_acesso] = useState<ParametrosAcesso>(PARAMETROS_ACESSO_PADRAO);

  // Sincronia de estado imediata com a prop recebida do Header/Painel Admin
  useEffect(() => {
    if (nome_evento_atual) {
      set_nome_evento(nome_evento_atual);
    }
  }, [nome_evento_atual]);

  // Controle de requisição
  const [carregando_dados, set_carregando_dados] = useState<boolean>(true);
  const [salvando, set_salvando] = useState<boolean>(false);
  const [mensagem_feedback, set_mensagem_feedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const conexao_configurada = verificar_conexao_configurada();
  // Sem evento ativo o id chega vazio; gravar com ele gera o erro "invalid input syntax for type uuid"
  const sem_evento_ativo = conexao_configurada && !id_evento_ativo;

  // Carrega as configurações atuais da tabela 'eventos' do evento ativo
  useEffect(() => {
    const carregar_configuracoes_evento = async () => {
      set_carregando_dados(true);

      if (!conexao_configurada || !id_evento_ativo) {
        set_carregando_dados(false);
        return;
      }

      try {
        const { data: dados_evento } = await supabase
          .from('eventos')
          .select('*')
          .eq('id_evento', id_evento_ativo)
          .single();

        if (dados_evento) {
          set_nome_evento(dados_evento.nome_evento || nome_evento_atual || 'FETEC MS 2026');
          set_data_evento(dados_evento.data_evento || new Date().toISOString().split('T')[0]);
          set_minutos_timeout_lock(dados_evento.minutos_timeout_lock || 15);
          set_cota_avaliacoes_padrao(dados_evento.cota_avaliacoes_padrao || 3);
          set_sistema_liberado(dados_evento.sistema_liberado !== false);
          set_horario_inicio(dados_evento.horario_inicio || '08:00');
          set_horario_fim(dados_evento.horario_fim || '18:00');
          set_parametros_acesso(lerParametrosAcesso(dados_evento));
        }
      } catch (e) {
        console.error('Erro ao carregar dados do evento:', e);
      } finally {
        set_carregando_dados(false);
      }
    };

    carregar_configuracoes_evento();
  }, [id_evento_ativo, conexao_configurada, nome_evento_atual]);

  // Executa o UPDATE na tabela 'eventos' baseado no id_evento ativo
  const salvar_configuracoes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sem_evento_ativo) {
      set_mensagem_feedback({ tipo: 'erro', texto: MENSAGEM_SEM_EVENTO_ATIVO });
      return;
    }
    set_salvando(true);
    set_mensagem_feedback(null);

    const dataFormatada = data_evento || new Date().toISOString().split('T')[0];

    const erros_acesso = validarParametrosAcesso(parametros_acesso);
    if (erros_acesso.length > 0) {
      set_mensagem_feedback({ tipo: 'erro', texto: erros_acesso.join(' ') });
      set_salvando(false);
      return;
    }

    const dados_atualizacao: any = {
      nome_evento,
      data_evento: dataFormatada,
      minutos_timeout_lock: Number(minutos_timeout_lock),
      cota_avaliacoes_padrao: Number(cota_avaliacoes_padrao),
      sistema_liberado: Boolean(sistema_liberado),
      horario_inicio: horario_inicio || '08:00',
      horario_fim: horario_fim || '18:00',
      ...parametros_acesso,
    };

    if (!conexao_configurada) {
      setTimeout(() => {
        set_salvando(false);
        if (typeof window !== 'undefined') {
          localStorage.setItem('evento_ativo_data', dataFormatada);
          localStorage.setItem('evento_ativo_nome', nome_evento);
        }
        alert('Configurações do evento atualizadas com sucesso! (Modo Contingência)');
        if (ao_salvar_sucesso) ao_salvar_sucesso(nome_evento, dataFormatada);
        ao_fechar();
      }, 500);
      return;
    }

    try {
      // 1. UPDATE direto na tabela 'eventos' por id_evento com data_evento oficial
      let { error: erro_update } = await supabase
        .from('eventos')
        .update(dados_atualizacao)
        .eq('id_evento', id_evento_ativo);

      // Fallback resiliente: apenas se a coluna data_evento não existir fisicamente no banco
      if (erro_update && (erro_update.message?.includes('data_evento') || erro_update.code === 'PGRST204')) {
        console.warn('Coluna data_evento ausente no schema do banco, tentando salvar campos base...');
        const {
          data_evento: _de,
          minutos_validade_pareamento: _mp,
          minutos_validade_codigo_acesso: _mc,
          tamanho_codigo: _tc,
          max_tentativas_codigo: _mt,
          metodos_vinculo: _mv,
          ...dadosSemData
        } = dados_atualizacao;
        const resFallback = await supabase
          .from('eventos')
          .update(dadosSemData)
          .eq('id_evento', id_evento_ativo);
        erro_update = resFallback.error;
      }

      if (erro_update) {
        console.error('Falha ao atualizar evento no Supabase:', erro_update.message);
        const texto_erro = erro_update.code === '23514'
          ? 'Algum parâmetro de acesso está fora dos limites permitidos pelo banco.'
          : `Falha ao salvar configurações: ${erro_update.message}`;
        set_mensagem_feedback({
          tipo: 'erro',
          texto: texto_erro,
        });
        alert(`Erro ao salvar configurações do evento: ${erro_update.message}`);
      } else {
        if (typeof window !== 'undefined') {
          localStorage.setItem('evento_ativo_data', dataFormatada);
          localStorage.setItem('evento_ativo_nome', nome_evento);
        }
        set_mensagem_feedback({
          tipo: 'sucesso',
          texto: 'Parâmetros do evento atualizados com sucesso no Supabase!',
        });
        alert('Configurações do evento salvas com sucesso no banco de dados!');

        if (ao_salvar_sucesso) ao_salvar_sucesso(nome_evento, dataFormatada);
        setTimeout(() => {
          ao_fechar();
        }, 800);
      }
    } catch (erro_excecao: any) {
      console.error('Erro de execução ao salvar configurações:', erro_excecao);
      alert('Erro inesperado de comunicação ao atualizar o evento.');
      set_mensagem_feedback({
        tipo: 'erro',
        texto: 'Ocorreu uma falha de conexão ao salvar as configurações.',
      });
    } finally {
      set_salvando(false);
    }
  };

  const handleConfirmarReset = async () => {
    try {
      const isUuidVal = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      const idValido = isUuidVal(id_evento_ativo) ? id_evento_ativo : null;

      // Invocação resiliente da Stored Procedure oficial no Supabase
      let resultado = await supabase.rpc('admin_reset_global', {
        p_id_evento: idValido,
      });

      if (resultado.error && (resultado.error.message?.includes('p_id_evento') || resultado.error.code === 'PGRST202')) {
        resultado = await supabase.rpc('admin_reset_global');
      }

      if (resultado.error) {
        throw resultado.error;
      }
      alert("Reset executado com sucesso.");
      ao_fechar();
    } catch (err: any) {
      alert(`Falha no Reset: ${err.message}`);
    }
  };

  const campo =
    'w-full min-w-0 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none';
  const campoCurto = campo.replace('w-full ', '');
  const secao = 'p-4 bg-slate-50/60 dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3 min-w-0';
  const tituloSecao = 'text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide';
  const botaoGestao =
    'w-full px-3 py-2.5 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900/60 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-700 text-left transition-all flex items-center justify-between gap-2 cursor-pointer group';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-configuracoes-evento"
        className="bg-white dark:bg-slate-800 rounded-3xl p-4 sm:p-6 w-full max-w-6xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden lg:overflow-visible lg:max-h-none border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4"
      >
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
          <h2 id="titulo-configuracoes-evento" className="flex items-center gap-2 text-slate-900 dark:text-white font-extrabold text-lg">
            <Settings aria-hidden="true" className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Configurações do Evento Ativo
          </h2>
          <button
            type="button"
            onClick={ao_fechar}
            aria-label="Fechar configurações"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        {sem_evento_ativo && (
          <div role="alert" className="p-3 rounded-xl border bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100 text-xs font-semibold space-y-2">
            <p className="flex items-center gap-2">
              <AlertTriangle aria-hidden="true" className="w-4 h-4 text-amber-600 shrink-0" />
              {MENSAGEM_SEM_EVENTO_ATIVO}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { ao_fechar(); if (ao_abrir_novo_evento) ao_abrir_novo_evento(); }}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle aria-hidden="true" className="w-4 h-4" />
                Criar um evento agora
              </button>
              <button
                type="button"
                onClick={() => { ao_fechar(); if (ao_abrir_historico) ao_abrir_historico(); }}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-amber-100 dark:bg-slate-900 dark:hover:bg-slate-800 border border-amber-300 dark:border-amber-800 font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <History aria-hidden="true" className="w-4 h-4" />
                Ativar um evento anterior
              </button>
            </div>
          </div>
        )}

        {/* Mensagem de Feedback */}
        {mensagem_feedback && (
          <div
            role={mensagem_feedback.tipo === 'erro' ? 'alert' : 'status'}
            className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              mensagem_feedback.tipo === 'sucesso'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200'
            }`}
          >
            {mensagem_feedback.tipo === 'sucesso' ? (
              <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle aria-hidden="true" className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{mensagem_feedback.texto}</span>
          </div>
        )}

        {carregando_dados ? (
          <div className="p-8 text-center space-y-2">
            <Loader2 aria-hidden="true" className="w-6 h-6 text-emerald-600 animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500">Carregando parâmetros do evento...</p>
          </div>
        ) : (
          <form onSubmit={salvar_configuracoes} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
              {/* Coluna 1: dados e funcionamento do evento */}
              <section aria-labelledby="secao-evento" className={secao}>
                <h3 id="secao-evento" className={tituloSecao}>Evento</h3>
                <div>
                  <Rotulo htmlFor="cfg-nome-evento" dica="Nome exibido no cabeçalho do sistema, nos relatórios e no Telão." alinhar="inicio" lado="baixo">
                    Nome do Evento:
                  </Rotulo>
                  <input id="cfg-nome-evento" type="text" value={nome_evento} onChange={(e) => set_nome_evento(e.target.value)} required className={campo} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0 col-span-2">
                    <Rotulo htmlFor="cfg-data-evento" dica="Dia da feira. Os avaliadores só conseguem avaliar nesta data, entre o horário de início e o de fim." alinhar="inicio">
                      Data:
                    </Rotulo>
                    <input id="cfg-data-evento" type="date" value={data_evento} onChange={(e) => set_data_evento(e.target.value)} required className={`${campo} px-2`} />
                  </div>
                  <div className="min-w-0">
                    <Rotulo htmlFor="cfg-horario-inicio" dica="A partir deste horário os avaliadores podem sortear projetos e enviar notas.">
                      Início:
                    </Rotulo>
                    <input id="cfg-horario-inicio" type="time" value={horario_inicio} onChange={(e) => set_horario_inicio(e.target.value)} required className={`${campo} px-2`} />
                  </div>
                  <div className="min-w-0">
                    <Rotulo htmlFor="cfg-horario-fim" dica="Depois deste horário não é possível sortear novos projetos. Um projeto já reservado ainda pode ser concluído." alinhar="fim">
                      Fim:
                    </Rotulo>
                    <input id="cfg-horario-fim" type="time" value={horario_fim} onChange={(e) => set_horario_fim(e.target.value)} required className={`${campo} px-2`} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0">
                    <Rotulo
                      htmlFor="cfg-timeout-lock"
                      dica="Tempo que o projeto sorteado fica reservado para o avaliador. Se a nota não for enviada nesse prazo, a reserva expira e o projeto volta para o sorteio."
                      alinhar="inicio"
                    >
                      Timeout Lock (min):
                    </Rotulo>
                    <input id="cfg-timeout-lock" type="number" min="1" max="120" value={minutos_timeout_lock} onChange={(e) => set_minutos_timeout_lock(Number(e.target.value))} required className={campo} />
                  </div>
                  <div className="min-w-0">
                    <Rotulo
                      htmlFor="cfg-cota-padrao"
                      dica="Quantas avaliações cada projeto deve receber. Ao atingir a cota, o projeto deixa de ser sorteado."
                      alinhar="fim"
                    >
                      Cota Padrão:
                    </Rotulo>
                    <input id="cfg-cota-padrao" type="number" min="1" max="10" value={cota_avaliacoes_padrao} onChange={(e) => set_cota_avaliacoes_padrao(Number(e.target.value))} required className={campo} />
                  </div>
                </div>

                <div className="p-3 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="flex items-center gap-1 text-xs font-bold text-slate-800 dark:text-slate-200">
                      <label htmlFor="cfg-sistema-liberado" className="cursor-pointer">Sistema liberado para avaliadores</label>
                      <Dica alinhar="inicio">
                        Desligado, nenhum avaliador sorteia projetos nem envia notas novas: use para pausar ou encerrar a feira. Admin e Staff continuam funcionando normalmente.
                      </Dica>
                    </span>
                    <span className="text-[11px] text-slate-500">Permite sortear e enviar notas.</span>
                  </div>
                  <input
                    id="cfg-sistema-liberado"
                    type="checkbox"
                    checked={sistema_liberado}
                    onChange={(e) => set_sistema_liberado(e.target.checked)}
                    className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer shrink-0"
                  />
                </div>
              </section>

              {/* Coluna 2: acesso dos avaliadores (vínculo do celular) */}
              <fieldset className={secao}>
                <legend className={`${tituloSecao} float-left w-full mb-3`}>Acesso dos avaliadores</legend>
                <div className="clear-both">
                  <Rotulo
                    htmlFor="metodos_vinculo"
                    dica={
                      <span className="block space-y-1.5">
                        <span className="block"><strong>Pareamento pelo Staff:</strong> o celular do avaliador mostra um código e o Staff o digita no balcão de credenciamento. Exige a presença do avaliador, por isso é o mais seguro.</span>
                        <span className="block"><strong>Código de acesso:</strong> o Staff gera um código e o entrega ao avaliador, que digita o e-mail e o código no próprio celular. Útil quando ele não pode passar no balcão.</span>
                        <span className="block"><strong>Ambos:</strong> o celular oferece as duas formas.</span>
                      </span>
                    }
                    alinhar="inicio"
                    lado="baixo"
                  >
                    Formas de vincular o celular:
                  </Rotulo>
                  <select
                    id="metodos_vinculo"
                    value={parametros_acesso.metodos_vinculo}
                    onChange={(e) => set_parametros_acesso((anterior) => ({ ...anterior, metodos_vinculo: e.target.value as MetodoVinculo }))}
                    className={campo}
                  >
                    {METODOS_VINCULO.map((m) => (
                      <option key={m.valor} value={m.valor}>{m.rotulo}</option>
                    ))}
                  </select>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-700">
                  {(Object.keys(LIMITES_ACESSO) as (keyof typeof LIMITES_ACESSO)[]).map((campoAcesso) => {
                    const limite = LIMITES_ACESSO[campoAcesso];
                    return (
                      <div key={campoAcesso} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex items-center gap-1">
                          <label htmlFor={campoAcesso} className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase leading-tight">
                            {limite.rotulo}{limite.unidade ? ` (${limite.unidade})` : ''}:
                          </label>
                          <Dica alinhar="inicio">{limite.dica}</Dica>
                        </div>
                        <input
                          id={campoAcesso}
                          type="number"
                          min={limite.min}
                          max={limite.max}
                          step={1}
                          value={parametros_acesso[campoAcesso]}
                          onChange={(e) => set_parametros_acesso((anterior) => ({ ...anterior, [campoAcesso]: Number(e.target.value) }))}
                          required
                          className={`${campoCurto} w-20 shrink-0 text-center`}
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>

              {/* Coluna 3: gestão e zona de perigo */}
              <div className="space-y-4 min-w-0 md:col-span-2 lg:col-span-1">
                <SecaoIdentidadeVisual id_evento_ativo={id_evento_ativo} className={secao} classeTitulo={tituloSecao} />

                <SecaoSegurancaContas />

                <section aria-labelledby="secao-gestao" className={secao}>
                  <h3 id="secao-gestao" className={tituloSecao}>Gestão de Eventos</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                    <button type="button" onClick={() => { ao_fechar(); if (ao_abrir_historico) ao_abrir_historico(); }} className={botaoGestao}>
                      <span className="min-w-0">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Eventos Anteriores</span>
                        <span className="text-[11px] text-slate-500">Histórico e edições passadas</span>
                      </span>
                      <History aria-hidden="true" className="w-5 h-5 text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors shrink-0" />
                    </button>
                    <button type="button" onClick={() => { ao_fechar(); if (ao_abrir_novo_evento) ao_abrir_novo_evento(); }} className={botaoGestao}>
                      <span className="min-w-0">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Criar novo evento</span>
                        <span className="text-[11px] text-slate-500">Inicializar nova instância</span>
                      </span>
                      <PlusCircle aria-hidden="true" className="w-5 h-5 text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors shrink-0" />
                    </button>
                    <button type="button" onClick={() => { ao_fechar(); if (ao_abrir_instituicoes) ao_abrir_instituicoes(); }} className={botaoGestao}>
                      <span className="min-w-0">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Instituições de Ensino / Escolas</span>
                        <span className="text-[11px] text-slate-500">Gerenciar instituições e prevenção de conflitos</span>
                      </span>
                      <Building2 aria-hidden="true" className="w-5 h-5 text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors shrink-0" />
                    </button>
                    <button type="button" onClick={() => { ao_fechar(); if (ao_abrir_administradores) ao_abrir_administradores(); }} className={botaoGestao}>
                      <span className="min-w-0">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Gestão de Administradores</span>
                        <span className="text-[11px] text-slate-500">Cadastrar e gerenciar administradores</span>
                      </span>
                      <ShieldCheck aria-hidden="true" className="w-5 h-5 text-slate-500 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors shrink-0" />
                    </button>
                  </div>
                </section>

                {/* Zona de Perigo / Ações Críticas */}
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 rounded-2xl flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-red-900 dark:text-red-300 flex items-center gap-1.5">
                      <AlertTriangle aria-hidden="true" className="w-4 h-4 text-red-600 shrink-0" />
                      Zona de Perigo
                      <Dica alinhar="inicio">
                        Apaga todas as avaliações, notas e reservas de projetos do evento ativo. Não pode ser desfeito; o sistema pede confirmação em duas etapas antes de executar.
                      </Dica>
                    </span>
                    <span className="text-[11px] text-red-700 dark:text-red-400">Limpa avaliações, notas e locks do evento ativo.</span>
                  </div>
                  <button
                    type="button"
                    onClick={ao_disparar_reset_global || handleConfirmarReset}
                    className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs shrink-0 cursor-pointer"
                  >
                    <RotateCcw aria-hidden="true" className="w-4 h-4" />
                    Reset Global
                  </button>
                </div>
              </div>
            </div>

            {/* Botões do Rodapé */}
            <div className="pt-3 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={ao_fechar}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando || sem_evento_ativo}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 flex items-center gap-2 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {salvando ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Save aria-hidden="true" className="w-4 h-4" />}
                Salvar Configurações
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

/** Rótulo de campo com o ícone de dica ao lado (fora do <label>, para não alterar o nome acessível do campo). */
const Rotulo: React.FC<{
  htmlFor: string;
  dica: React.ReactNode;
  alinhar?: 'inicio' | 'centro' | 'fim';
  lado?: 'cima' | 'baixo';
  children: React.ReactNode;
}> = ({ htmlFor, dica, alinhar, lado, children }) => (
  <div className="flex items-start gap-1 mb-1">
    <label htmlFor={htmlFor} className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase leading-tight">
      {children}
    </label>
    <Dica alinhar={alinhar} lado={lado}>{dica}</Dica>
  </div>
);

export const ConfiguracoesGerais = ModalConfiguracoesEvento;

