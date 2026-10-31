import React, { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { confirmarCodigo, fatorVerificado, iniciarCadastroTotp, type CadastroTotp } from '../segundoFator';

interface PropriedadesSegundoFator {
  aoConcluir: () => void;
  aoCancelar: () => void;
}

const campo =
  'w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-lg text-center font-mono tracking-[0.5em] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500';

const mensagemDoErro = (erro: unknown) => {
  const texto = (erro as { message?: string })?.message || '';
  return /invalid|expired|code/i.test(texto)
    ? 'Código inválido ou expirado. Confira a hora do celular e digite o código atual do aplicativo.'
    : `Não foi possível conferir o código: ${texto || 'tente novamente.'}`;
};

/** Campo do código de 6 dígitos com Confirmar e Cancelar (comum ao cadastro e à verificação). */
const FormularioCodigo: React.FC<PropriedadesSegundoFator & { idFator: string | null }> = ({ idFator, aoConcluir, aoCancelar }) => {
  const [codigo, setCodigo] = useState('');
  const [conferindo, setConferindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Sem <form>: este campo também aparece dentro do formulário da engrenagem (form aninhado é inválido)
  const enviar = async () => {
    if (!idFator || codigo.length !== 6 || conferindo) return;
    setConferindo(true);
    setErro(null);
    try {
      await confirmarCodigo(idFator, codigo);
      aoConcluir();
    } catch (err) {
      setErro(mensagemDoErro(err));
      setCodigo('');
    } finally {
      setConferindo(false);
    }
  };

  return (
    <div role="group" className="space-y-3" aria-label="Código do aplicativo autenticador">
      <label htmlFor="codigo-segundo-fator" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
        Código de 6 dígitos do aplicativo:
      </label>
      <input
        id="codigo-segundo-fator"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            enviar();
          }
        }}
        className={campo}
      />
      {erro && (
        <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">
          {erro}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={aoCancelar}
          className="w-1/3 py-3 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={enviar}
          disabled={conferindo || !idFator || codigo.length !== 6}
          className="w-2/3 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-extrabold shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {conferindo ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <ShieldCheck aria-hidden="true" className="w-4 h-4" />}
          Confirmar
        </button>
      </div>
    </div>
  );
};

/** Cadastro do aplicativo autenticador (Google Authenticator, Microsoft Authenticator etc.). */
export const CadastroSegundoFator: React.FC<PropriedadesSegundoFator> = ({ aoConcluir, aoCancelar }) => {
  const [cadastro, setCadastro] = useState<CadastroTotp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    iniciarCadastroTotp()
      .then((c) => ativo && setCadastro(c))
      .catch((err) => ativo && setErro(`Não foi possível iniciar o cadastro do aplicativo: ${err?.message || err}`));
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <section aria-labelledby="titulo-cadastro-mfa" className="space-y-4">
      <div>
        <h2 id="titulo-cadastro-mfa" className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <Smartphone aria-hidden="true" className="w-5 h-5 text-emerald-600" />
          Cadastrar o aplicativo autenticador
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          Abra o aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator ou similar), leia o QR Code
          e digite o código de 6 dígitos que aparecer. A partir daí, o login do Admin pede esse código.
        </p>
      </div>
      {erro && (
        <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">
          {erro}
        </p>
      )}
      {!cadastro && !erro && (
        <div className="py-6 flex justify-center">
          <Loader2 aria-hidden="true" className="w-6 h-6 text-emerald-600 animate-spin" />
        </div>
      )}
      {cadastro && (
        <div className="flex flex-col items-center gap-2">
          <img src={cadastro.qrCode} alt="QR Code para o aplicativo autenticador" className="w-44 h-44 bg-white p-2 rounded-xl border border-slate-200" />
          <p className="text-[11px] text-slate-500 text-center">
            Sem câmera? Digite esta chave no aplicativo:
            <code className="block mt-1 font-mono text-xs text-slate-800 dark:text-slate-200 break-all select-all">{cadastro.segredo}</code>
          </p>
        </div>
      )}
      <FormularioCodigo idFator={cadastro?.idFator ?? null} aoConcluir={aoConcluir} aoCancelar={aoCancelar} />
    </section>
  );
};

/** Verificação no login: código do aplicativo já cadastrado. */
export const VerificacaoSegundoFator: React.FC<PropriedadesSegundoFator> = ({ aoConcluir, aoCancelar }) => {
  const [idFator, setIdFator] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    fatorVerificado()
      .then((id) => ativo && setIdFator(id))
      .catch((err) => ativo && setErro(`Não foi possível consultar o aplicativo cadastrado: ${err?.message || err}`));
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <section aria-labelledby="titulo-verificacao-mfa" className="space-y-4">
      <div>
        <h2 id="titulo-verificacao-mfa" className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="w-5 h-5 text-emerald-600" />
          Verificação em duas etapas
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Digite o código que aparece agora no aplicativo autenticador.</p>
      </div>
      {erro && (
        <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">
          {erro}
        </p>
      )}
      <FormularioCodigo idFator={idFator} aoConcluir={aoConcluir} aoCancelar={aoCancelar} />
    </section>
  );
};
