import React, { useState, useEffect } from 'react';
import { Sun, Moon, Laptop, Shield, UserCheck, Award, Tv, LogOut } from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';

export type TipoTelaNavegacao = 'avaliador' | 'staff' | 'admin' | 'telao';

interface PropriedadesCabecalho {
  tela_atual: TipoTelaNavegacao | string;
  ao_mudar_tela: (nova_tela: TipoTelaNavegacao) => void;
  ao_sair?: () => void;
  papel?: string;
}

export const Cabecalho: React.FC<PropriedadesCabecalho> = ({
  tela_atual,
  ao_mudar_tela,
  ao_sair,
  papel: propPapel,
}) => {
  // Estado rigoroso do tema conforme especificação do seletor
  const [tema, setTema] = useState<string>(
    localStorage.getItem('tema_fecin') || 'sistema'
  );

  const conexao_ativa = verificar_conexao_configurada();
  const papel = (
    propPapel ||
    localStorage.getItem('sessao_papel') ||
    localStorage.getItem('usuario_perfil') ||
    'avaliador'
  ).toLowerCase();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Erro ao realizar signOut no Supabase Auth:', err);
    }
    localStorage.removeItem('sessao_id_usuario');
    localStorage.removeItem('sessao_papel');
    localStorage.removeItem('sessao_email');
    localStorage.clear();
    if (ao_sair) {
      ao_sair();
    }
  };

  // useEffect rigoroso para aplicação do modo escuro no DOM e persistência em localStorage
  useEffect(() => {
    const isDark =
      tema === 'escuro' ||
      (tema === 'sistema' && typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    localStorage.setItem('tema_fecin', tema);
  }, [tema]);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/95 dark:bg-slate-900/95 backdrop-blur border-slate-200 dark:border-slate-800 transition-colors duration-200 shadow-xs">
      <div className={`mx-auto px-4 sm:px-6 lg:px-8 transition-all duration-200 ${tela_atual === 'staff' ? 'max-w-[1800px]' : 'max-w-7xl'}`}>
        <div className="flex items-center justify-between h-16">
          {/* Logo e Título do Sistema */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              IF
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-tight">
                Sistema de Avaliação de Projetos IFMS
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 rounded-full ${conexao_ativa ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                {conexao_ativa ? 'Supabase Conectado' : 'Supabase (Aguardando Chaves)'}
              </p>
            </div>
          </div>

          {/* Navegação e Seletor de Tema */}
          <div className="flex items-center gap-2 sm:gap-4">
            <nav className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto max-w-xs sm:max-w-none">
              {papel === 'avaliador' && (
                <button
                  type="button"
                  onClick={() => ao_mudar_tela('avaliador')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all shrink-0 ${
                    tela_atual === 'avaliador'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Award className="w-4 h-4" />
                  <span>Avaliador</span>
                </button>
              )}

              {(papel === 'staff' || papel === 'admin') && (
                <button
                  type="button"
                  onClick={() => ao_mudar_tela('staff')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all shrink-0 ${
                    tela_atual === 'staff'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <UserCheck className="w-4 h-4" />
                  <span className="hidden md:inline">Staff</span>
                </button>
              )}

              {papel === 'admin' && (
                <button
                  type="button"
                  onClick={() => ao_mudar_tela('admin')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all shrink-0 ${
                    tela_atual === 'admin'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span className="hidden md:inline">Admin</span>
                </button>
              )}

              {/* Botão Telão: visível apenas quando não estiver no Staff e perfil não for Staff */}
              {tela_atual !== 'staff' && papel !== 'staff' && (
                <button
                  type="button"
                  onClick={() => ao_mudar_tela('telao')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all shrink-0 ${
                    tela_atual === 'telao'
                      ? 'bg-emerald-600 text-white dark:bg-emerald-500 font-bold shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Tv className="w-4 h-4" />
                  <span className="hidden md:inline">Telão</span>
                </button>
              )}

              {/* Botão Sair Obrigatório: Limpa estado e localStorage */}
              {ao_sair && (
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Encerrar sessão e limpar dados locais"
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs sm:text-sm font-bold rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              )}
            </nav>

            {/* SELETOR DE TEMA FUNCIONAL: CLARO / ESCURO / SISTEMA */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setTema('claro')}
                title="Tema Claro"
                className={`p-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  tema === 'claro'
                    ? 'bg-white dark:bg-slate-700 text-amber-500 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
                aria-label="Ativar Tema Claro"
              >
                <Sun className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setTema('escuro')}
                title="Tema Escuro"
                className={`p-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  tema === 'escuro'
                    ? 'bg-white dark:bg-slate-700 text-indigo-400 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
                aria-label="Ativar Tema Escuro"
              >
                <Moon className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setTema('sistema')}
                title="Tema do Sistema"
                className={`p-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  tema === 'sistema'
                    ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
                aria-label="Ativar Tema do Sistema"
              >
                <Laptop className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
