import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { aoRetomarApp } from '@/lib/keepAliveSessao';
import {
  garantirSessaoAparelho,
  obterPerfilSessao,
  solicitarCodigoPareamento,
  vincularComCodigoAcesso,
  type CodigoPareamento,
  type MetodoVinculo,
  type PerfilSessao,
} from '../vinculoAparelho';

interface PropriedadesVinculoAvaliador {
  aoVincular: (perfil: PerfilSessao) => void;
  /** Intervalo da consulta ao banco enquanto espera o Staff parear (ms). */
  intervaloConsultaMs?: number;
}

type Modo = 'pareamento' | 'codigo';

const formatarHora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Aba "Avaliador" do login: vincula este celular ao avaliador sem senha.
 * Pareamento: o celular mostra um código e o Staff o confirma no balcão.
 * Código de acesso: o avaliador digita o e-mail e o código gerado pelo Staff.
 */
export const VinculoAvaliador: React.FC<PropriedadesVinculoAvaliador> = ({ aoVincular, intervaloConsultaMs = 3000 }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [metodos, setMetodos] = useState<MetodoVinculo>('ambos');
  const [modo, setModo] = useState<Modo>('pareamento');
  const [pareamento, setPareamento] = useState<CodigoPareamento | null>(null);
  const [expirado, setExpirado] = useState(false);
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [validando, setValidando] = useState(false);

  const gerarCodigo = useCallback(async () => {
    setErro(null);
    setExpirado(false);
    try {
      setPareamento(await solicitarCodigoPareamento());
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  // Inicia a sessão do aparelho e descobre se ele já está vinculado
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        await garantirSessaoAparelho();
        const perfil = await obterPerfilSessao();
        if (!ativo) return;
        if (perfil.papel === 'avaliador') {
          aoVincular(perfil);
          return;
        }
        setMetodos(perfil.metodos_vinculo);
        const modoInicial: Modo = perfil.metodos_vinculo === 'codigo' ? 'codigo' : 'pareamento';
        setModo(modoInicial);
        if (modoInicial === 'pareamento') await gerarCodigo();
      } catch (e) {
        if (ativo) setErro((e as Error).message);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [aoVincular, gerarCodigo]);

  // Enquanto mostra o código, consulta o banco até o Staff confirmar o pareamento
  useEffect(() => {
    if (modo !== 'pareamento' || !pareamento || expirado) return;
    const consultar = async () => {
      if (new Date(pareamento.expira_em).getTime() <= Date.now()) {
        setExpirado(true);
        return;
      }
      try {
        const perfil = await obterPerfilSessao();
        if (perfil.papel === 'avaliador') aoVincular(perfil);
      } catch {
        // falha momentânea de rede: tenta de novo no próximo ciclo
      }
    };
    const intervalo = setInterval(consultar, intervaloConsultaMs);
    // Celular desbloqueado depois de o Staff parear: entra na hora, sem esperar o próximo ciclo
    const pararRetomada = aoRetomarApp(consultar);
    return () => {
      clearInterval(intervalo);
      pararRetomada();
    };
  }, [modo, pareamento, expirado, aoVincular, intervaloConsultaMs]);

  const mudarModo = async (novo: Modo) => {
    setErro(null);
    setModo(novo);
    if (novo === 'pareamento' && !pareamento) await gerarCodigo();
  };

  const enviarCodigoAcesso = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setValidando(true);
    try {
      const resultado = await vincularComCodigoAcesso(email.trim(), codigo.trim());
      if (!resultado.ok) {
        setErro(resultado.erro || 'Não foi possível validar o código.');
        return;
      }
      const perfil = await obterPerfilSessao();
      if (perfil.papel === 'avaliador') aoVincular(perfil);
      else setErro('Código aceito, mas o vínculo não foi confirmado. Procure o Staff.');
    } catch (e2) {
      setErro((e2 as Error).message);
    } finally {
      setValidando(false);
    }
  };

  const campo =
    'w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500';

  if (carregando) {
    return (
      <p role="status" className="flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Preparando este aparelho...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {erro && (
        <div role="alert" className="p-4 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-2xl text-xs text-rose-800 dark:text-rose-200 font-bold flex items-center gap-2.5">
          <AlertTriangle aria-hidden="true" className="w-5 h-5 shrink-0 text-rose-600" />
          <span>{erro}</span>
        </div>
      )}

      {modo === 'pareamento' && (
        <section aria-labelledby="titulo-pareamento" className="text-center space-y-3">
          <h2 id="titulo-pareamento" className="flex items-center justify-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            <Smartphone aria-hidden="true" className="w-4 h-4" /> Mostre este código ao Staff no credenciamento
          </h2>
          {pareamento && !expirado && (
            <>
              <p
                role="status"
                aria-label="Código de pareamento"
                className="font-mono text-4xl font-black tracking-[0.3em] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl py-5"
              >
                {pareamento.codigo}
              </p>
              <p className="text-xs text-slate-500">
                Válido até {formatarHora(pareamento.expira_em)}. Esta tela abre sozinha quando o Staff confirmar.
              </p>
            </>
          )}
          {expirado && <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">O código expirou.</p>}
          <button
            type="button"
            onClick={gerarCodigo}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 underline underline-offset-2"
          >
            <RefreshCw aria-hidden="true" className="w-3.5 h-3.5" /> Gerar novo código
          </button>
        </section>
      )}

      {modo === 'codigo' && (
        <form onSubmit={enviarCodigoAcesso} className="space-y-4" aria-label="Entrar com código de acesso">
          <div>
            <label htmlFor="email-avaliador" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              E-mail cadastrado:
            </label>
            <input id="email-avaliador" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} />
          </div>
          <div>
            <label htmlFor="codigo-acesso" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Código de acesso (fornecido pelo Staff):
            </label>
            <input
              id="codigo-acesso"
              type="text"
              required
              autoComplete="one-time-code"
              autoCapitalize="characters"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              className={`${campo} font-mono tracking-widest uppercase`}
            />
          </div>
          <button
            type="submit"
            disabled={validando}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-extrabold shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {validando ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <KeyRound aria-hidden="true" className="w-4 h-4" />}
            Vincular este celular
          </button>
        </form>
      )}

      {metodos === 'ambos' && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => mudarModo(modo === 'pareamento' ? 'codigo' : 'pareamento')}
            className="text-xs font-semibold text-slate-600 dark:text-slate-300 underline underline-offset-2"
          >
            {modo === 'pareamento' ? 'Tenho um código de acesso' : 'Prefiro parear com o Staff'}
          </button>
        </div>
      )}
    </div>
  );
};
