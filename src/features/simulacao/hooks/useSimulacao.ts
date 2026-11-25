import { useCallback, useEffect, useRef, useState } from 'react';
import { ambiente_supabase } from '@/lib/supabase';
import { gerarPlanoSimulacao } from '@/lib/simulacao/plano';
import { criarMotorSimulacao, type EstadoSimulacao, type MotorSimulacao } from '@/lib/simulacao/motor';
import { validarParametros, type ParametrosSimulacao } from '@/lib/simulacao/parametros';
import {
  criarPontePelaSessaoDoAdmin,
  encerrarSimulacao,
  lerPreVoo,
  semear,
} from '../api';
import { criarPonteSessaoPorAvaliador } from '../apiSessaoPorAvaliador';
import { apagarSimulacao } from '../limpeza';
import type { PreVoo, ResumoLimpeza, ResumoSemeadura } from '../tipos';

/**
 * Orquestra a simulação para a interface: pré-voo, semeadura, motor, encerramento e limpeza.
 *
 * O motor avisa a cada ação, mas o estado React só é promovido a cada
 * INTERVALO_PROGRESSO_MS: milhares de `setState` por minuto roubariam o processador do
 * próprio laço, e o painel não precisa de mais que isso para parecer ao vivo.
 */

/** De quanto em quanto tempo o progresso do motor chega à tela. */
const INTERVALO_PROGRESSO_MS = 500;

/** Marca da rodada em curso, para a aba reaberta saber que havia uma simulação. */
export const CHAVE_SIMULACAO_EM_ANDAMENTO = 'simulacao_em_andamento';

export type PassoSimulacao =
  | 'configurando'
  | 'semeando'
  | 'rodando'
  | 'encerrando'
  | 'concluida'
  | 'falhou';

interface RodadaEmCurso {
  idEvento: string;
  nomeEvento: string;
  nomeEventoAnterior: string | null;
}

export const useSimulacao = () => {
  const [preVoo, setPreVoo] = useState<PreVoo | null>(null);
  const [carregandoPreVoo, setCarregandoPreVoo] = useState(true);
  const [passo, setPasso] = useState<PassoSimulacao>('configurando');
  const [progresso, setProgresso] = useState<EstadoSimulacao | null>(null);
  const [resumo, setResumo] = useState<ResumoSemeadura | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const motor = useRef<MotorSimulacao | null>(null);
  const rodada = useRef<RodadaEmCurso | null>(null);
  const ultimaPublicacao = useRef(0);
  const pendente = useRef<EstadoSimulacao | null>(null);
  const montado = useRef(true);

  useEffect(() => () => { montado.current = false; }, []);

  const recarregarPreVoo = useCallback(async () => {
    setCarregandoPreVoo(true);
    try {
      const lido = await lerPreVoo();
      if (montado.current) setPreVoo(lido);
    } catch (e) {
      if (montado.current) setErro((e as Error).message);
    } finally {
      if (montado.current) setCarregandoPreVoo(false);
    }
  }, []);

  useEffect(() => { void recarregarPreVoo(); }, [recarregarPreVoo]);

  /** Avisa antes de sair com a rodada em curso: fechar a aba interrompe a simulação. */
  useEffect(() => {
    if (passo !== 'rodando' && passo !== 'semeando') return;
    const aoSair = (evento: BeforeUnloadEvent) => { evento.preventDefault(); };
    window.addEventListener('beforeunload', aoSair);
    return () => { window.removeEventListener('beforeunload', aoSair); };
  }, [passo]);

  const publicarProgresso = useCallback((estado: EstadoSimulacao) => {
    pendente.current = estado;
    const agora = Date.now();
    if (agora - ultimaPublicacao.current < INTERVALO_PROGRESSO_MS) return;
    ultimaPublicacao.current = agora;
    if (montado.current) setProgresso(estado);
  }, []);

  const iniciar = useCallback(async (parametros: ParametrosSimulacao) => {
    setErro(null);
    const validacao = validarParametros(parametros, ambiente_supabase);
    if (validacao.erros.length > 0) {
      setErro(validacao.erros.join(' '));
      return;
    }

    setPasso('semeando');
    let ponteFiel: ReturnType<typeof criarPonteSessaoPorAvaliador> | null = null;
    try {
      const nomeAnterior = preVoo?.eventoAtivo?.nome_evento ?? null;
      const plano = gerarPlanoSimulacao({ parametros, nomeEventoAnterior: nomeAnterior });

      const semeado = await semear(plano);
      if (!montado.current) return;
      setResumo(semeado);
      rodada.current = {
        idEvento: semeado.idEvento,
        nomeEvento: semeado.nomeEvento,
        nomeEventoAnterior: nomeAnterior,
      };
      localStorage.setItem(CHAVE_SIMULACAO_EM_ANDAMENTO, semeado.nomeEvento);

      if (parametros.modoSessao === 'por-avaliador') {
        ponteFiel = criarPonteSessaoPorAvaliador();
      }
      const ponte = ponteFiel ?? criarPontePelaSessaoDoAdmin();

      const criado = criarMotorSimulacao({
        plano,
        parametros,
        ponte,
        aoAtualizar: publicarProgresso,
      });
      motor.current = criado;
      setPasso('rodando');

      const final = await criado.executar();
      if (montado.current) {
        setProgresso(final);
        setPasso('concluida');
      }
    } catch (e) {
      if (montado.current) {
        setErro((e as Error).message);
        setPasso('falhou');
      }
    } finally {
      await ponteFiel?.encerrarSessoes();
    }
  }, [preVoo, publicarProgresso]);

  const pausar = useCallback(() => {
    motor.current?.pausar();
    if (pendente.current) setProgresso({ ...pendente.current, fase: 'pausada' });
  }, []);

  const retomar = useCallback(() => {
    motor.current?.retomar();
    if (pendente.current) setProgresso({ ...pendente.current, fase: 'rodando' });
  }, []);

  const encerrar = useCallback(() => {
    motor.current?.encerrar();
    setPasso('encerrando');
  }, []);

  const ajustarVelocidade = useCallback((multiplicador: number) => {
    motor.current?.ajustarVelocidade(multiplicador);
  }, []);

  /** Devolve o evento anterior ao posto de ativo e solta as travas da simulação. */
  const encerrarERestaurar = useCallback(async (
    idEvento?: string,
    nomeEventoAnterior?: string | null,
  ) => {
    const alvo = idEvento ?? rodada.current?.idEvento;
    const anterior = nomeEventoAnterior ?? rodada.current?.nomeEventoAnterior ?? null;
    if (!alvo) return;
    setErro(null);
    try {
      motor.current?.encerrar();
      await encerrarSimulacao(alvo, anterior);
      localStorage.removeItem(CHAVE_SIMULACAO_EM_ANDAMENTO);
      if (montado.current) setPasso('concluida');
      await recarregarPreVoo();
    } catch (e) {
      if (montado.current) setErro((e as Error).message);
    }
  }, [recarregarPreVoo]);

  const apagar = useCallback(async (idEvento?: string): Promise<ResumoLimpeza | null> => {
    const alvo = idEvento ?? rodada.current?.idEvento;
    if (!alvo) return null;
    setErro(null);
    try {
      const limpeza = await apagarSimulacao(alvo);
      localStorage.removeItem(CHAVE_SIMULACAO_EM_ANDAMENTO);
      rodada.current = null;
      await recarregarPreVoo();
      return limpeza;
    } catch (e) {
      if (montado.current) setErro((e as Error).message);
      return null;
    }
  }, [recarregarPreVoo]);

  return {
    ambiente: ambiente_supabase,
    preVoo,
    carregandoPreVoo,
    recarregarPreVoo,
    passo,
    progresso,
    resumo,
    erro,
    setErro,
    iniciar,
    pausar,
    retomar,
    encerrar,
    ajustarVelocidade,
    encerrarERestaurar,
    apagar,
  };
};
