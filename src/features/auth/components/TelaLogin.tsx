import React, { useState } from 'react';
import { Award, UserCheck, Shield, Mail, Lock, Loader2, AlertTriangle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { VinculoAvaliador } from './VinculoAvaliador';
import { urlRedefinirSenha } from './TelaRedefinirSenha';
import { obterPerfilSessao, salvarPerfilLocal, type PerfilSessao } from '../vinculoAparelho';
import { CadastroSegundoFator, VerificacaoSegundoFator } from './SegundoFator';
import { ImagemEvento } from '@/components/layout/IdentidadeVisual';
import { POLITICA_PADRAO, etapaSegundoFator, lerPoliticaSeguranca, type EtapaSegundoFator } from '../segundoFator';

export type AbaLogin = 'avaliador' | 'staff' | 'admin';

interface PropriedadesTelaLogin {
  abaInicial?: AbaLogin;
  aoAutenticarSucesso?: (perfilRedirecionado: 'avaliador' | 'staff' | 'admin') => void;
}

export const TelaLogin: React.FC<PropriedadesTelaLogin> = ({
  abaInicial = 'avaliador',
  aoAutenticarSucesso,
}) => {
  const [abaAtiva, setAbaAtiva] = useState<AbaLogin>(abaInicial);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [mostrarSenha, setMostrarSenha] = useState<boolean>(false);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  // Admin que passou pela senha e ainda precisa do segundo fator (cadastro ou código)
  const [etapaMfa, setEtapaMfa] = useState<Exclude<EtapaSegundoFator, 'nenhuma'> | null>(null);
  const [adminPendente, setAdminPendente] = useState<{ id_usuario: string; papel: string } | null>(null);

  const mudarAba = (novaAba: AbaLogin) => {
    // Sair no meio do segundo fator não deixa a sessão só de senha aberta
    if (etapaMfa) {
      supabase.auth.signOut().catch(() => {});
      setEtapaMfa(null);
      setAdminPendente(null);
    }
    setAbaAtiva(novaAba);
    setMensagemErro(null);
    setMensagemSucesso(null);
  };

  // Avaliador: o celular foi vinculado (pareamento pelo Staff ou código de acesso)
  const aoVincularAvaliador = (perfil: PerfilSessao) => {
    salvarPerfilLocal(perfil);
    if (aoAutenticarSucesso) aoAutenticarSucesso('avaliador');
  };

  // Staff: e-mail e senha no Supabase Auth; o papel é confirmado pelo banco
  const fazerLoginStaff = async () => {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (authError) {
      setMensagemErro('Falha no login: ' + authError.message);
      return;
    }
    // Primeiro login: liga a conta do Auth ao perfil STAFF (idempotente)
    await supabase.rpc('fn_vincular_conta_staff');
    const perfil = await obterPerfilSessao();
    if (perfil.papel !== 'staff') {
      await supabase.auth.signOut().catch(() => {});
      setMensagemErro('Acesso negado: esta conta não pertence à equipe Staff.');
      return;
    }
    salvarPerfilLocal(perfil);
    if (aoAutenticarSucesso) aoAutenticarSucesso('staff');
  };

  // Grava a sessão do Admin no navegador e abre o painel (depois da senha e, se houver, do segundo fator).
  // O e-mail não é guardado: nenhuma tela do Admin o lê, e dado pessoal não fica em texto no navegador.
  const concluirLoginAdmin = (admin: { id_usuario: string; papel: string }) => {
    localStorage.setItem('sessao_id_usuario', admin.id_usuario);
    localStorage.setItem('sessao_papel', admin.papel);
    localStorage.setItem('usuario_id', admin.id_usuario);
    localStorage.setItem('avaliador_id_usuario', admin.id_usuario);
    localStorage.setItem('usuario_perfil', 'admin');

    if (aoAutenticarSucesso) {
      aoAutenticarSucesso('admin');
    }
  };

  const cancelarSegundoFator = async () => {
    await supabase.auth.signOut().catch(() => {});
    setEtapaMfa(null);
    setAdminPendente(null);
    setPassword('');
  };

  // Submissão principal do formulário (Login)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagemErro(null);
    setMensagemSucesso(null);

    const emailLogado = email;
    if (!emailLogado.trim()) {
      setMensagemErro('Por favor, informe o e-mail.');
      return;
    }

    setCarregando(true);

    try {
      if (!password) {
        setMensagemErro('Por favor, informe a senha de acesso.');
        setCarregando(false);
        return;
      }
      if (abaAtiva === 'staff') {
        await fazerLoginStaff();
      } else {

        // 1. Tenta logar no motor de Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
          email: email.trim().toLowerCase(), 
          password 
        });

        if (authError) {
          setMensagemErro("Falha no login: " + authError.message);
          setCarregando(false);
          return;
        }

        if (!authData?.user?.id) {
          setMensagemErro("Falha no login: Conta autenticada sem ID do usuário.");
          setCarregando(false);
          return;
        }

        // 2. Busca o papel do usuário logado cruzando o ID (Seguro)
        const { data: usuarioDb, error: errUsuario } = await supabase
          .from('usuarios')
          .select('id_usuario, papel')
          .eq('id_usuario', authData.user.id)
          .single();

        if (errUsuario || !usuarioDb) {
          await supabase.auth.signOut().catch(() => {});
          localStorage.removeItem('sessao_id_usuario');
          localStorage.removeItem('sessao_papel');
          localStorage.removeItem('sessao_email');
          setMensagemErro("Erro de Integridade: Conta autenticada, mas o perfil não existe na tabela pública 'usuarios'.");
          setCarregando(false);
          return;
        }

        const papelUsuario = (usuarioDb.papel || 'admin').toLowerCase();

        if (papelUsuario !== 'admin') {
          await supabase.auth.signOut().catch(() => {});
          localStorage.removeItem('sessao_id_usuario');
          localStorage.removeItem('sessao_papel');
          localStorage.removeItem('sessao_email');
          setMensagemErro("Acesso Negado: Papel incompatível com o portal Admin");
          setCarregando(false);
          return;
        }

        const dadosAdmin = { id_usuario: usuarioDb.id_usuario, papel: usuarioDb.papel || 'admin' };

        // Segundo fator: quem cadastrou o aplicativo confirma o código; com o MFA exigido, quem não cadastrou cadastra
        const politica = await lerPoliticaSeguranca().catch(() => POLITICA_PADRAO);
        const etapa = await etapaSegundoFator(politica);
        if (etapa !== 'nenhuma') {
          setAdminPendente(dadosAdmin);
          setEtapaMfa(etapa);
          return;
        }
        concluirLoginAdmin(dadosAdmin);
      }
    } catch (err: any) {
      console.error('Erro inesperado na autenticação:', err);
      setMensagemErro(err?.message || 'Ocorreu um erro ao processar a autenticação.');
    } finally {
      setCarregando(false);
    }
  };

  const handleEsqueciSenha = async () => {
    setMensagemErro(null);
    setMensagemSucesso(null);

    const emailLimpo = email.trim().toLowerCase();
    if (!emailLimpo) {
      setMensagemErro('Por favor, informe o e-mail para recuperar a senha.');
      return;
    }

    setCarregando(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailLimpo, { redirectTo: urlRedefinirSenha() });
      if (error) {
        setMensagemErro(`Erro ao solicitar recuperação: ${error.message}`);
      } else {
        setMensagemSucesso('Instruções de redefinição de senha enviadas para o e-mail informado!');
      }
    } catch (err: any) {
      setMensagemErro(`Erro ao solicitar recuperação: ${err?.message || err}`);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <main className="max-w-md mx-auto py-8 px-4 font-sans">
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700 shadow-xl space-y-6">
        
        <ImagemEvento />

        {/* INTERFACE COM 3 ABAS (TABS) */}
        <div className="flex bg-slate-100 dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => mudarAba('avaliador')}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              abaAtiva === 'avaliador'
                ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-md ring-1 ring-slate-200 dark:ring-slate-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Avaliador</span>
          </button>

          <button
            type="button"
            onClick={() => mudarAba('staff')}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              abaAtiva === 'staff'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-md ring-1 ring-slate-200 dark:ring-slate-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Staff</span>
          </button>

          <button
            type="button"
            onClick={() => mudarAba('admin')}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              abaAtiva === 'admin'
                ? 'bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 shadow-md ring-1 ring-slate-200 dark:ring-slate-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Admin</span>
          </button>
        </div>

        {/* Informações do Portal Atual */}
        <div className="text-center">
          <h1 className="text-lg font-black text-slate-900 dark:text-white">
            {abaAtiva === 'avaliador' && 'Portal do Avaliador'}
            {abaAtiva === 'staff' && 'Portal da Equipe Staff'}
            {abaAtiva === 'admin' && 'Portal do Administrador'}
          </h1>
        </div>

        {/* Alerta de Erro */}
        {mensagemErro && (
          <div role="alert" className="p-4 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-cartao text-apoio text-rose-800 dark:text-rose-200 font-bold flex items-center gap-2.5">
            <AlertTriangle aria-hidden="true" className="w-5 h-5 shrink-0 text-rose-600" />
            <span>{mensagemErro}</span>
          </div>
        )}

        {/* Alerta de Sucesso */}
        {mensagemSucesso && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 rounded-2xl text-xs text-emerald-800 dark:text-emerald-200 font-bold flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{mensagemSucesso}</span>
          </div>
        )}

        {/* Admin: segundo fator depois da senha */}
        {etapaMfa && adminPendente && (
          etapaMfa === 'verificar' ? (
            <VerificacaoSegundoFator aoConcluir={() => concluirLoginAdmin(adminPendente)} aoCancelar={cancelarSegundoFator} />
          ) : (
            <CadastroSegundoFator aoConcluir={() => concluirLoginAdmin(adminPendente)} aoCancelar={cancelarSegundoFator} />
          )
        )}

        {/* Avaliador: vínculo do celular, sem senha */}
        {abaAtiva === 'avaliador' && <VinculoAvaliador aoVincular={aoVincularAvaliador} />}

        {/* Staff e Admin: e-mail e senha */}
        {abaAtiva !== 'avaliador' && !etapaMfa && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email-login" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              E-mail de Acesso:
            </label>
            <div className="relative">
              <input
                id="email-login"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@ifms.edu.br"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
          </div>

          {/* Staff e Admin exibem a senha */}
          {(
            <div>
              <label htmlFor="senha-login" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Senha de Acesso:
              </label>
              <div className="relative">
                <input
                  id="senha-login"
                  type={mostrarSenha ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <button
                  type="button"
                  onClick={() => setMostrarSenha(!mostrarSenha)}
                  className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none p-0.5 rounded-lg"
                  title={mostrarSenha ? "Ocultar senha" : "Exibir senha"}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Exibir senha"}
                >
                  {mostrarSenha ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={carregando}
            className={`w-full py-3.5 text-white rounded-xl text-sm font-extrabold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 ${
              abaAtiva === 'staff' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {carregando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processando...
              </>
            ) : (
              <span>
                {abaAtiva === 'staff' && 'Entrar'}
                {abaAtiva === 'admin' && 'Entrar no Painel Admin'}
              </span>
            )}
          </button>
        </form>
        )}

        {/* Recuperação de senha (Staff e Admin) */}
        {abaAtiva !== 'avaliador' && !etapaMfa && (
          <div className="text-center">
            <button
              type="button"
              onClick={handleEsqueciSenha}
              disabled={carregando}
              className="text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 text-xs font-semibold underline underline-offset-2 transition-colors disabled:opacity-50"
            >
              Esqueci minha senha
            </button>
          </div>
        )}
      </div>
    </main>
  );
};
