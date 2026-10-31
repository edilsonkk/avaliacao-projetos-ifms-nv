import React, { useEffect, useState } from 'react';
import { Loader2, LockKeyhole, Save } from 'lucide-react';
import {
  CadastroSegundoFator,
  EVENTO_POLITICA_ALTERADA,
  POLITICA_PADRAO,
  VerificacaoSegundoFator,
  fatorVerificado,
  lerPoliticaSeguranca,
  removerFatores,
  salvarPoliticaSeguranca,
  sessaoVerificada,
  type PoliticaSeguranca,
} from '@/features/auth';
import { garantirSessaoAdmin, tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { Dica } from '@/components/ui/Dica';

const MINUTOS_MINIMO = 5;
const MINUTOS_MAXIMO = 720;

/**
 * Engrenagem do Admin: segundo fator (MFA) no login do Admin e expiração da sessão de Admin e Staff por inatividade.
 * Ligar ou desligar o MFA exige o código do aplicativo nesta sessão (o banco confere: aal2).
 */
export const SecaoSegurancaContas: React.FC = () => {
  const [politica, setPolitica] = useState<PoliticaSeguranca>(POLITICA_PADRAO);
  const [salva, setSalva] = useState<PoliticaSeguranca>(POLITICA_PADRAO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [confirmacao, setConfirmacao] = useState<'cadastrar' | 'verificar' | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    lerPoliticaSeguranca()
      .then((p) => {
        if (!ativo) return;
        setPolitica(p);
        setSalva(p);
      })
      .catch((err) => ativo && setMensagem({ tipo: 'erro', texto: `Não foi possível ler a política de segurança: ${tratarErroEscritaAdmin(err)}` }))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, []);

  const gravar = async (nova: PoliticaSeguranca) => {
    setSalvando(true);
    try {
      const gravada = await salvarPoliticaSeguranca(nova);
      // Desligar o MFA tira o aplicativo da conta: o login deixa de pedir o código
      if (salva.exigir_mfa_admin && !nova.exigir_mfa_admin) await removerFatores();
      setPolitica(gravada);
      setSalva(gravada);
      window.dispatchEvent(new Event(EVENTO_POLITICA_ALTERADA));
      setMensagem({ tipo: 'sucesso', texto: 'Configurações de segurança salvas.' });
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível salvar: ${tratarErroEscritaAdmin(err)}` });
    } finally {
      setSalvando(false);
    }
  };

  const salvar = async () => {
    setMensagem(null);
    const minutos = politica.minutos_inatividade_sessao;
    if (!Number.isInteger(minutos) || (minutos !== 0 && (minutos < MINUTOS_MINIMO || minutos > MINUTOS_MAXIMO))) {
      setMensagem({ tipo: 'erro', texto: `Tempo sem uso: use 0 (não encerra) ou de ${MINUTOS_MINIMO} a ${MINUTOS_MAXIMO} minutos.` });
      return;
    }
    if (!(await garantirSessaoAdmin())) return;

    // Mudar a exigência do MFA exige confirmar o código nesta sessão (cadastra o aplicativo se ainda não houver)
    if (politica.exigir_mfa_admin !== salva.exigir_mfa_admin && !(await sessaoVerificada())) {
      setConfirmacao((await fatorVerificado()) ? 'verificar' : 'cadastrar');
      return;
    }
    await gravar(politica);
  };

  const aoConfirmarCodigo = async () => {
    setConfirmacao(null);
    await gravar(politica);
  };

  const aoCancelarCodigo = () => {
    setConfirmacao(null);
    setPolitica((p) => ({ ...p, exigir_mfa_admin: salva.exigir_mfa_admin }));
  };

  const campo =
    'w-20 px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-center text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <section aria-labelledby="secao-seguranca-contas" className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
      <h3 id="secao-seguranca-contas" className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
        <LockKeyhole aria-hidden="true" className="w-4 h-4" />
        Segurança das contas
      </h3>

      {mensagem && (
        <p
          role={mensagem.tipo === 'erro' ? 'alert' : 'status'}
          className={`text-xs font-semibold ${mensagem.tipo === 'erro' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}
        >
          {mensagem.texto}
        </p>
      )}

      {carregando ? (
        <Loader2 aria-hidden="true" className="w-5 h-5 text-emerald-600 animate-spin" />
      ) : confirmacao === 'cadastrar' ? (
        <CadastroSegundoFator aoConcluir={aoConfirmarCodigo} aoCancelar={aoCancelarCodigo} />
      ) : confirmacao === 'verificar' ? (
        <VerificacaoSegundoFator aoConcluir={aoConfirmarCodigo} aoCancelar={aoCancelarCodigo} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1 text-xs font-bold text-slate-800 dark:text-slate-200 min-w-0">
              <label htmlFor="cfg-exigir-mfa" className="cursor-pointer">Exigir segundo fator no login do Admin</label>
              <Dica alinhar="inicio">
                Além da senha, o Admin digita o código de 6 dígitos de um aplicativo autenticador (Google Authenticator, Microsoft
                Authenticator ou similar). Ao ligar e salvar, o sistema abre o cadastro do aplicativo. Se o celular se perder, o responsável
                pelo projeto remove o segundo fator da conta no painel do Supabase (Authentication → Users).
              </Dica>
            </span>
            <input
              id="cfg-exigir-mfa"
              type="checkbox"
              checked={politica.exigir_mfa_admin}
              onChange={(e) => setPolitica((p) => ({ ...p, exigir_mfa_admin: e.target.checked }))}
              className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer shrink-0"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1 min-w-0">
              <label htmlFor="cfg-minutos-inatividade" className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase leading-tight">
                Encerrar sessão de Admin e Staff após (min sem uso):
              </label>
              <Dica alinhar="inicio">
                Depois desse tempo sem tocar no sistema, a sessão de Admin e Staff é encerrada e é preciso entrar de novo. Use 0 para não
                encerrar. Para projetar o Telão, use o endereço /telao (não precisa de login).
              </Dica>
            </span>
            <input
              id="cfg-minutos-inatividade"
              type="number"
              min={0}
              max={MINUTOS_MAXIMO}
              step={1}
              value={politica.minutos_inatividade_sessao}
              onChange={(e) => setPolitica((p) => ({ ...p, minutos_inatividade_sessao: Number(e.target.value) }))}
              className={campo}
            />
          </div>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="w-full py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {salvando ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Save aria-hidden="true" className="w-4 h-4" />}
            Salvar segurança
          </button>
        </>
      )}
    </section>
  );
};
