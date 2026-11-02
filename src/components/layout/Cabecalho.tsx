import React, { useCallback, useEffect, useState } from 'react';
import { Sun, Moon, Laptop, Shield, UserCheck, Award, Tv, LogOut } from 'lucide-react';
import { ambiente_supabase, supabase } from '@/lib/supabase';
import {
  ROTULOS_ESCALA_TEXTO,
  aplicarEscalaTexto,
  aplicarTema,
  lerEscalaTexto,
  lerTema,
  limparSessaoMantendoPreferencias,
  observarTemaDoSistema,
  type EscalaTexto,
  type Tema,
} from '@/lib/preferenciasVisuais';

export type TipoTelaNavegacao = 'avaliador' | 'staff' | 'admin' | 'telao';

interface PropriedadesCabecalho {
  tela_atual: TipoTelaNavegacao | string;
  ao_mudar_tela: (nova_tela: TipoTelaNavegacao) => void;
  ao_sair?: () => void;
  papel?: string;
}

/** Banco em uso. O texto é curto para caber na faixa; o nome acessível é completo. */
const AMBIENTES = {
  local: { texto: 'local', classeTexto: 'text-info', classePonto: 'bg-info', descricao: 'Banco de dados local' },
  producao: {
    texto: 'produção',
    classeTexto: 'text-acao-texto',
    classePonto: 'bg-acao',
    descricao: 'Banco de dados de produção',
  },
  indefinido: {
    texto: 'não configurado',
    classeTexto: 'text-aviso-texto',
    classePonto: 'bg-aviso',
    descricao: 'Banco de dados não configurado',
  },
} as const;

const TEMAS: { valor: Tema; rotulo: string; Icone: typeof Sun }[] = [
  { valor: 'claro', rotulo: 'Tema claro', Icone: Sun },
  { valor: 'escuro', rotulo: 'Tema escuro', Icone: Moon },
  { valor: 'sistema', rotulo: 'Tema do sistema', Icone: Laptop },
];

const ESCALAS: { valor: EscalaTexto; glifo: string; classe: string }[] = [
  { valor: 'padrao', glifo: 'A', classe: 'text-legenda' },
  { valor: 'grande', glifo: 'A', classe: 'text-apoio' },
  { valor: 'maior', glifo: 'A', classe: 'text-corpo' },
];

const classeBotaoPreferencia = (ativo: boolean) =>
  `inline-flex items-center justify-center min-h-11 min-w-11 rounded-controle font-bold transition-colors ${
    ativo ? 'bg-superficie text-acao-texto shadow-cartao' : 'text-texto-secundario hover:bg-superficie'
  }`;

const classeBotaoNavegacao = (ativo: boolean) =>
  `inline-flex items-center gap-1.5 min-h-11 px-3 rounded-controle text-apoio font-bold transition-colors shrink-0 ${
    ativo ? 'bg-superficie text-acao-texto shadow-cartao' : 'text-texto-secundario hover:bg-superficie'
  }`;

/**
 * Faixa fixa do topo: identidade, banco em uso, navegação por papel e as preferências
 * de tema e de tamanho de texto.
 *
 * No celular a faixa tem duas linhas (identidade e preferências em cima, navegação embaixo).
 * Antes era uma linha só, com o título sem `truncate` e a navegação com largura mínima de
 * 320px: a soma passava da largura da tela e a página inteira deslizava para os lados.
 */
export const Cabecalho: React.FC<PropriedadesCabecalho> = ({ tela_atual, ao_mudar_tela, ao_sair, papel: propPapel }) => {
  const [tema, setTema] = useState<Tema>(lerTema);
  const [escalaTexto, setEscalaTexto] = useState<EscalaTexto>(lerEscalaTexto);

  const papel = (propPapel || localStorage.getItem('sessao_papel') || localStorage.getItem('usuario_perfil') || 'avaliador').toLowerCase();
  const ambiente = AMBIENTES[ambiente_supabase ?? 'indefinido'];

  const escolherTema = useCallback((novo: Tema) => {
    setTema(novo);
    aplicarTema(novo);
  }, []);

  const escolherEscala = useCallback((nova: EscalaTexto) => {
    setEscalaTexto(nova);
    aplicarEscalaTexto(nova);
  }, []);

  useEffect(() => {
    aplicarTema(tema);
    // No modo "sistema", acompanha a troca de tema do aparelho sem recarregar a página
    return observarTemaDoSistema(() => aplicarTema(tema));
  }, [tema]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Erro ao realizar signOut no Supabase Auth:', err);
    }
    limparSessaoMantendoPreferencias();
    if (ao_sair) ao_sair();
  };

  const larguraMaxima = tela_atual === 'staff' ? 'max-w-[1800px]' : 'max-w-7xl';

  return (
    <header className="sticky top-0 z-40 w-full border-b border-borda bg-superficie/95 backdrop-blur shadow-cartao">
      <div className={`mx-auto px-4 sm:px-6 lg:px-8 ${larguraMaxima}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 min-h-16">
          {/* Identidade: encolhe e corta o texto em vez de empurrar a faixa */}
          <div className="order-1 flex items-center gap-3 min-w-0 flex-1">
            <span
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-controle bg-acao text-white flex items-center justify-center font-bold text-corpo shadow-cartao"
            >
              IF
            </span>
            <div className="min-w-0">
              <p className="text-apoio sm:text-corpo font-bold text-texto truncate" title="Sistema de Avaliação de Projetos IFMS">
                <span className="hidden sm:inline">Sistema de Avaliação de Projetos IFMS</span>
                <span className="sm:hidden">Avaliação de Projetos</span>
              </p>
              <p role="status" aria-label={ambiente.descricao} title={ambiente.descricao} className={`flex items-center gap-1.5 text-legenda font-semibold truncate ${ambiente.classeTexto}`}>
                <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full shrink-0 ${ambiente.classePonto}`}></span>
                {ambiente.texto}
              </p>
            </div>
          </div>

          {/* Preferências: ficam à direita na primeira linha, no celular e no desktop */}
          <div className="order-2 sm:order-3 flex items-center gap-2 shrink-0">
            <div role="group" aria-label="Tamanho do texto" className="flex items-center gap-0.5 p-1 bg-superficie-alta border border-borda rounded-controle">
              {ESCALAS.map(({ valor, glifo, classe }) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => escolherEscala(valor)}
                  aria-label={ROTULOS_ESCALA_TEXTO[valor]}
                  aria-pressed={escalaTexto === valor}
                  title={ROTULOS_ESCALA_TEXTO[valor]}
                  className={`${classeBotaoPreferencia(escalaTexto === valor)} ${classe}`}
                >
                  {glifo}
                </button>
              ))}
            </div>

            <div role="group" aria-label="Tema" className="flex items-center gap-0.5 p-1 bg-superficie-alta border border-borda rounded-controle">
              {TEMAS.map(({ valor, rotulo, Icone }) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => escolherTema(valor)}
                  aria-label={rotulo}
                  aria-pressed={tema === valor}
                  title={rotulo}
                  className={classeBotaoPreferencia(tema === valor)}
                >
                  <Icone aria-hidden="true" className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Navegação: segunda linha no celular, meio da faixa no desktop */}
          <nav
            aria-label="Telas do sistema"
            className="order-3 sm:order-2 w-full sm:w-auto min-w-0 flex items-center gap-1 p-1 bg-superficie-alta border border-borda rounded-controle overflow-x-auto"
          >
            {papel === 'avaliador' && (
              <button
                type="button"
                onClick={() => ao_mudar_tela('avaliador')}
                aria-current={tela_atual === 'avaliador' ? 'page' : undefined}
                className={classeBotaoNavegacao(tela_atual === 'avaliador')}
              >
                <Award aria-hidden="true" className="w-4 h-4" />
                Avaliador
              </button>
            )}

            {(papel === 'staff' || papel === 'admin') && (
              <button
                type="button"
                onClick={() => ao_mudar_tela('staff')}
                aria-current={tela_atual === 'staff' ? 'page' : undefined}
                className={classeBotaoNavegacao(tela_atual === 'staff')}
              >
                <UserCheck aria-hidden="true" className="w-4 h-4" />
                Staff
              </button>
            )}

            {papel === 'admin' && (
              <button
                type="button"
                onClick={() => ao_mudar_tela('admin')}
                aria-current={tela_atual === 'admin' ? 'page' : undefined}
                className={classeBotaoNavegacao(tela_atual === 'admin')}
              >
                <Shield aria-hidden="true" className="w-4 h-4" />
                Admin
              </button>
            )}

            {/* Telão: escondido para o Staff e dentro da tela do Staff */}
            {tela_atual !== 'staff' && papel !== 'staff' && (
              <button
                type="button"
                onClick={() => ao_mudar_tela('telao')}
                aria-current={tela_atual === 'telao' ? 'page' : undefined}
                className={classeBotaoNavegacao(tela_atual === 'telao')}
              >
                <Tv aria-hidden="true" className="w-4 h-4" />
                Telão
              </button>
            )}

            {ao_sair && (
              <button
                type="button"
                onClick={handleLogout}
                title="Encerrar sessão e limpar dados locais"
                className="inline-flex items-center gap-1.5 min-h-11 px-3 ml-auto rounded-controle text-apoio font-bold text-perigo hover:bg-superficie transition-colors shrink-0"
              >
                <LogOut aria-hidden="true" className="w-4 h-4" />
                Sair
              </button>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
};
