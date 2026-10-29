import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/** Caminho para onde o e-mail de "Esqueci minha senha" leva (precisa estar nas Redirect URLs do Auth). */
export const CAMINHO_REDEFINIR_SENHA = '/redefinir-senha';

/** Mínimo exigido pela tela; o Supabase Auth pode exigir mais e, nesse caso, a mensagem dele é exibida. */
export const TAMANHO_MINIMO_SENHA = 8;

/** URL completa do link de recuperação, no mesmo endereço em que o app está aberto. */
export const urlRedefinirSenha = () => `${window.location.origin}${CAMINHO_REDEFINIR_SENHA}`;

interface PropriedadesTelaRedefinirSenha {
  aoConcluir: () => void;
}

type Situacao = 'verificando' | 'sem_sessao' | 'formulario' | 'concluido';

/**
 * Tela aberta pelo link do e-mail de recuperação (Admin e Staff).
 * O supabase-js lê o token do link e cria uma sessão temporária; com ela, a pessoa grava a nova senha.
 * Depois a sessão é encerrada, para que o login seguinte passe pela checagem de papel normal.
 */
export const TelaRedefinirSenha: React.FC<PropriedadesTelaRedefinirSenha> = ({ aoConcluir }) => {
  const [situacao, setSituacao] = useState<Situacao>('verificando');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;
    const marcarComSessao = () => ativo && setSituacao((s) => (s === 'concluido' ? s : 'formulario'));

    // O evento chega quando o supabase-js termina de ler o token do link
    const { data } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (evento === 'PASSWORD_RECOVERY' || (sessao && evento === 'SIGNED_IN')) marcarComSessao();
    });

    supabase.auth.getSession().then(({ data: dados }) => {
      if (!ativo) return;
      if (dados.session && !dados.session.user?.is_anonymous) marcarComSessao();
      else setSituacao((s) => (s === 'verificando' ? 'sem_sessao' : s));
    });

    return () => {
      ativo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (senha.length < TAMANHO_MINIMO_SENHA) {
      setErro(`A senha precisa ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
      return;
    }
    if (senha !== confirmacao) {
      setErro('As senhas não conferem.');
      return;
    }
    setSalvando(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) {
        setErro(`Não foi possível alterar a senha: ${error.message}`);
        return;
      }
      await supabase.auth.signOut();
      localStorage.clear();
      setSenha('');
      setConfirmacao('');
      setSituacao('concluido');
    } catch (err) {
      setErro(`Não foi possível alterar a senha: ${(err as Error)?.message || err}`);
    } finally {
      setSalvando(false);
    }
  };

  const irParaLogin = () => {
    window.history.replaceState({}, '', '/');
    aoConcluir();
  };

  const campo =
    'w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500';
  const rotulo = 'block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5';
  const botao =
    'w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-extrabold shadow-md flex items-center justify-center gap-2 disabled:opacity-50';

  return (
    <main className="max-w-md mx-auto px-4">
      <section aria-labelledby="titulo-redefinir-senha" className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 sm:p-8 space-y-5">
        <h1 id="titulo-redefinir-senha" className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-white">
          <KeyRound aria-hidden="true" className="w-5 h-5 text-emerald-600" /> Redefinir senha
        </h1>

        {situacao === 'verificando' && (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Validando o link de recuperação...
          </p>
        )}

        {situacao === 'sem_sessao' && (
          <>
            <div role="alert" className="p-4 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded-2xl text-sm text-amber-900 dark:text-amber-200 flex gap-2.5">
              <AlertTriangle aria-hidden="true" className="w-5 h-5 shrink-0" />
              <span>
                Este link de recuperação é inválido ou expirou. Volte ao login e use <strong>Esqueci minha senha</strong>{' '}
                para receber um novo.
              </span>
            </div>
            <button type="button" onClick={irParaLogin} className={botao}>
              Voltar ao login
            </button>
          </>
        )}

        {situacao === 'formulario' && (
          <form onSubmit={salvar} className="space-y-4" noValidate>
            {erro && (
              <p role="alert" className="p-3 rounded-xl text-sm font-semibold bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                {erro}
              </p>
            )}
            <div>
              <label htmlFor="nova-senha" className={rotulo}>
                Nova senha:
              </label>
              <input
                id="nova-senha"
                type="password"
                autoComplete="new-password"
                required
                minLength={TAMANHO_MINIMO_SENHA}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                aria-describedby="dica-senha"
                className={campo}
              />
              <p id="dica-senha" className="mt-1 text-xs text-slate-500">
                Pelo menos {TAMANHO_MINIMO_SENHA} caracteres.
              </p>
            </div>
            <div>
              <label htmlFor="confirmar-senha" className={rotulo}>
                Repita a nova senha:
              </label>
              <input
                id="confirmar-senha"
                type="password"
                autoComplete="new-password"
                required
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                className={campo}
              />
            </div>
            <button type="submit" disabled={salvando} className={botao}>
              {salvando ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <KeyRound aria-hidden="true" className="w-4 h-4" />}
              Salvar nova senha
            </button>
          </form>
        )}

        {situacao === 'concluido' && (
          <>
            <p role="status" className="p-4 rounded-2xl text-sm font-semibold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 flex gap-2.5">
              <CheckCircle2 aria-hidden="true" className="w-5 h-5 shrink-0" />
              Senha alterada. Entre de novo com a nova senha.
            </p>
            <button type="button" onClick={irParaLogin} className={botao}>
              Ir para o login
            </button>
          </>
        )}
      </section>
    </main>
  );
};
