/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Cabecalho, TipoTelaNavegacao } from '@/components/layout/Cabecalho';
import { TelaAvaliador } from '@/features/avaliacao';
import { TelaStaff } from '@/features/staff';
import { TelaAdmin } from '@/features/admin';
import { TelaLogin, AbaLogin } from '@/features/auth';
import { TelaoAoVivo } from '@/features/relatorios';
import { TelaAutocadastroAvaliador } from '@/features/avaliacao';
import { supabase } from '@/lib/supabase';
import { EVENTO_SESSAO_ADMIN_EXPIRADA, MENSAGEM_SESSAO_EXPIRADA } from '@/lib/sessaoAdmin';

export default function App() {
  // Inicialização com suporte a autocadastro via QR Code e rota raiz apontando para TelaLogin
  const getInitialTela = (): TipoTelaNavegacao | 'login' | 'autocadastro' => {
    const path = window.location.pathname;
    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

    if (searchParams?.get('cadastro') === 'avaliador' || path.includes('/autocadastro')) {
      return 'autocadastro';
    }

    const userPerfil = (localStorage.getItem('sessao_papel') || localStorage.getItem('usuario_perfil') || '').toLowerCase();

    if (path === '/' || path === '/login') {
      return 'login';
    }
    if (path.includes('avaliador')) {
      if (userPerfil === 'admin') return 'admin';
      if (userPerfil === 'staff') return 'staff';
      return 'avaliador';
    }
    if (path.includes('staff')) return 'staff';
    if (path.includes('admin')) return 'admin';
    if (path.includes('telao')) return 'telao';
    return 'login';
  };

  const [tela_atual, set_tela_atual] = useState<TipoTelaNavegacao | 'login' | 'autocadastro'>(getInitialTela);
  const [aba_login, set_aba_login] = useState<AbaLogin>('avaliador');
  const [, set_usuario_logado] = useState<string | null>(() => localStorage.getItem('sessao_id_usuario') || localStorage.getItem('usuario_id') || localStorage.getItem('avaliador_email'));

  // Função central de logout
  const handle_sair = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Erro ao encerrar sessão Supabase Auth:', e);
    }
    localStorage.removeItem('sessao_id_usuario');
    localStorage.removeItem('sessao_papel');
    localStorage.removeItem('sessao_email');
    localStorage.clear();
    set_usuario_logado(null);
    set_tela_atual('login');
    set_aba_login('avaliador');
  };

  // Sessão do Supabase Auth inválida durante escrita administrativa: força novo login Admin
  useEffect(() => {
    const aoExpirarSessaoAdmin = async () => {
      await handle_sair();
      set_aba_login('admin');
      alert(MENSAGEM_SESSAO_EXPIRADA);
    };
    window.addEventListener(EVENTO_SESSAO_ADMIN_EXPIRADA, aoExpirarSessaoAdmin);
    return () => window.removeEventListener(EVENTO_SESSAO_ADMIN_EXPIRADA, aoExpirarSessaoAdmin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handle_mudar_tela = (nova_tela: TipoTelaNavegacao) => {
    const userPerfil = (localStorage.getItem('usuario_perfil') || '').toLowerCase();

    // Guarda de Rota para a tela do avaliador
    if (nova_tela === 'avaliador' && (userPerfil === 'admin' || userPerfil === 'staff')) {
      if (userPerfil === 'admin') {
        set_tela_atual('admin');
      } else {
        set_tela_atual('staff');
      }
      return;
    }

    if (nova_tela === 'admin' || nova_tela === 'staff') {
      if (!userPerfil || (nova_tela === 'admin' && userPerfil !== 'admin') || (nova_tela === 'staff' && userPerfil === 'avaliador')) {
        set_aba_login(nova_tela as AbaLogin);
        set_tela_atual('login');
        return;
      }
    }
    set_tela_atual(nova_tela);
  };

  // Roteador de telas - Single Source of Truth + Guarda de Rota
  const renderizar_conteudo_tela = () => {
    const userPerfil = (localStorage.getItem('usuario_perfil') || '').toLowerCase();

    switch (tela_atual) {
      case 'avaliador':
        if (userPerfil === 'admin') {
          return <TelaAdmin />;
        }
        if (userPerfil === 'staff') {
          return <TelaStaff />;
        }
        return <TelaAvaliador onLogout={handle_sair} />;
      case 'staff':
        return <TelaStaff />;
      case 'admin':
        return <TelaAdmin />;
      case 'telao':
        return <TelaoAoVivo />;
      case 'autocadastro':
        return (
          <TelaAutocadastroAvaliador
            aoConcluir={() => set_tela_atual('login')}
            aoVoltar={() => set_tela_atual('login')}
          />
        );
      case 'login':
      default:
        return (
          <TelaLogin
            abaInicial={aba_login}
            aoAutenticarSucesso={(perfil) => set_tela_atual(perfil as TipoTelaNavegacao)}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200 flex flex-col">
      {/* Cabeçalho do Sistema com Seletor de Tema e Navegação */}
      <Cabecalho
        tela_atual={tela_atual}
        ao_mudar_tela={handle_mudar_tela}
        ao_sair={handle_sair}
        papel={localStorage.getItem('usuario_perfil') || undefined}
      />

      {/* Conteúdo da Tela Selecionada */}
      <div className="flex-1 py-4 sm:py-6">
        {renderizar_conteudo_tela()}
      </div>

      {/* Rodapé Informativo */}
      {tela_atual !== 'telao' && (
        <footer className="border-t border-slate-200 dark:border-slate-800 py-4 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
          Sistema de Avaliação de Projetos IFMS &copy; {new Date().getFullYear()} — Instituto Federal de Mato Grosso do Sul
        </footer>
      )}
    </div>
  );
}
