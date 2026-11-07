import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, FileSearch, History, Printer, RefreshCw, ScrollText, SlidersHorizontal, X } from 'lucide-react';
import { Abas, Botao, Estado, Selo, Tabela, idPainelAba } from '@/components/ui';
import { buscarAchados, buscarFolhaDoEvento } from '../api';
import { ROTULO_SEVERIDADE, TOM_POR_SEVERIDADE, dataHoraBr } from '../rotulos';
import type { Achado, MemorialProjeto, Severidade } from '../tipos';
import { AbaProjeto } from './AbaProjeto';
import { AbaTrilha } from './AbaTrilha';
import { FolhaConferencia } from './FolhaConferencia';

/**
 * Painel de Auditoria de Notas.
 *
 * Responde três perguntas que o sistema não respondia: a nota está certa (conferência), como
 * ela foi formada (memorial do projeto) e quem mexeu nela (trilha). A quarta aba lista os
 * ajustes manuais do evento — a lista que a comissão confere antes de homologar.
 * Ver docs/regras-de-negocio/auditoria-de-notas.md.
 */

type IdAba = 'conferencia' | 'projeto' | 'trilha' | 'ajustes';

const ORDEM_SEVERIDADE: Record<Severidade, number> = { grave: 0, atencao: 1, informativo: 2 };

interface PropriedadesPainelAuditoria {
  id_evento_ativo?: string | null;
  aoFechar?: () => void;
}

export const PainelAuditoria: React.FC<PropriedadesPainelAuditoria> = ({ id_evento_ativo, aoFechar }) => {
  const [aba, setAba] = useState<IdAba>('conferencia');
  const [achados, setAchados] = useState<Achado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [codigoEscolhido, setCodigoEscolhido] = useState<string | null>(null);
  const [folha, setFolha] = useState<MemorialProjeto | null>(null);
  const [folhaDoEvento, setFolhaDoEvento] = useState<MemorialProjeto[] | null>(null);
  const [nomeEvento, setNomeEvento] = useState<string>('');
  const [montandoFolha, setMontandoFolha] = useState(false);

  const idEvento = id_evento_ativo || null;

  const conferir = useCallback(async () => {
    if (!idEvento) {
      setErro('Não há evento ativo: ative um evento para conferir as notas.');
      setAchados([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      setAchados(await buscarAchados(idEvento));
    } catch (e) {
      setErro((e as Error).message);
      setAchados([]);
    } finally {
      setCarregando(false);
    }
  }, [idEvento]);

  useEffect(() => {
    conferir();
  }, [conferir]);

  const problemas = useMemo(
    () =>
      achados
        .filter((achado) => achado.codigo !== 'C12')
        .sort((a, b) => ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade] || a.codigo.localeCompare(b.codigo)),
    [achados],
  );
  const ajustes = useMemo(() => achados.filter((achado) => achado.codigo === 'C12'), [achados]);
  const graves = problemas.filter((achado) => achado.severidade === 'grave').length;

  const abrirFolhaDoEvento = async () => {
    if (!idEvento) return;
    setMontandoFolha(true);
    setErro(null);
    try {
      const folhaCompleta = await buscarFolhaDoEvento(idEvento);
      setNomeEvento(folhaCompleta.evento?.nome || '');
      setFolhaDoEvento(folhaCompleta.projetos);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setMontandoFolha(false);
    }
  };

  const abrirProjeto = (codigo: string | null) => {
    if (!codigo) return;
    setCodigoEscolhido(codigo);
    setAba('projeto');
  };

  const abas = [
    { id: 'conferencia', rotulo: 'Conferência', icone: <ClipboardCheck className="w-4 h-4" /> },
    { id: 'projeto', rotulo: 'Projeto', icone: <FileSearch className="w-4 h-4" /> },
    { id: 'trilha', rotulo: 'Trilha', icone: <History className="w-4 h-4" /> },
    { id: 'ajustes', rotulo: 'Ajustes', icone: <SlidersHorizontal className="w-4 h-4" /> },
  ];

  const listaDeAchados = (lista: Achado[], legenda: string) => (
    <Tabela legenda={legenda} colunas={['Situação', 'Projeto', 'O que', 'Esperado', 'Encontrado']} larguraMinima="min-w-[52rem]">
      {lista.map((achado, indice) => (
        <tr key={`${achado.codigo}-${achado.id_avaliacao ?? achado.id_projeto ?? indice}`}>
          <td className="px-3 py-2">
            <Selo tom={TOM_POR_SEVERIDADE[achado.severidade]}>{ROTULO_SEVERIDADE[achado.severidade]}</Selo>
            <span className="block text-legenda text-texto-secundario">{achado.codigo}</span>
          </td>
          <td className="px-3 py-2 whitespace-nowrap">
            {achado.codigo_projeto ? (
              <button
                type="button"
                onClick={() => abrirProjeto(achado.codigo_projeto)}
                className="font-mono font-bold text-texto underline decoration-dotted"
              >
                {achado.codigo_projeto}
              </button>
            ) : (
              '—'
            )}
          </td>
          <td className="px-3 py-2">
            <span className="font-semibold text-texto">{achado.titulo}</span>
            {achado.detalhe && <span className="block text-legenda text-texto-secundario">{achado.detalhe}</span>}
          </td>
          <td className="px-3 py-2 tabular-nums">{achado.esperado || '—'}</td>
          <td className="px-3 py-2 tabular-nums font-bold">{achado.encontrado || '—'}</td>
        </tr>
      ))}
    </Tabela>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-painel border border-borda bg-superficie shadow-painel">
      <header className="flex items-start justify-between gap-3 border-b border-borda p-5">
        <div>
          <h2 className="flex items-center gap-2 text-titulo-3 font-bold text-texto">
            <ScrollText aria-hidden="true" className="w-5 h-5" />
            Auditoria de Notas
          </h2>
          <p className="text-apoio text-texto-secundario">
            Confere se cada nota fecha com as notas por critério, abre a conta de cada média e mostra quem alterou o quê.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Botao variante="secundario" icone={<RefreshCw className="w-4 h-4" />} onClick={conferir} carregando={carregando}>
            Conferir de novo
          </Botao>
          <Botao
            variante="secundario"
            icone={<Printer className="w-4 h-4" />}
            onClick={abrirFolhaDoEvento}
            carregando={montandoFolha}
          >
            Folha do evento
          </Botao>
          {aoFechar && (
            <Botao variante="fantasma" aria-label="Fechar auditoria" onClick={aoFechar}>
              <X aria-hidden="true" className="w-5 h-5" />
            </Botao>
          )}
        </div>
      </header>

      <div className="border-b border-borda px-5 pt-3">
        <Abas abas={abas} ativa={aba} aoTrocar={(id) => setAba(id as IdAba)} aria-label="Seções da auditoria de notas" />
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {erro && (
          <p role="alert" className="mb-4 rounded-controle border border-perigo bg-superficie-alta p-3 text-apoio font-semibold text-perigo">
            {erro}
          </p>
        )}

        {aba === 'conferencia' && (
          <div id={idPainelAba('conferencia')} role="tabpanel" aria-labelledby="aba-conferencia" className="space-y-4">
            {carregando ? (
              <Estado situacao="carregando" titulo="Recalculando todas as notas do evento…" />
            ) : problemas.length === 0 && !erro ? (
              <div className="rounded-cartao border border-acao bg-superficie-alta p-6 text-center">
                <CheckCircle2 aria-hidden="true" className="mx-auto mb-2 w-8 h-8 text-acao" />
                <p className="text-corpo font-bold text-texto">Todas as notas conferem</p>
                <p className="text-apoio text-texto-secundario">
                  Cada nota final é exatamente a média ponderada das notas por critério, e as médias batem entre a
                  Classificação e os Relatórios.
                </p>
              </div>
            ) : (
              <>
                <p className="text-apoio text-texto">
                  {problemas.length} achado(s)
                  {graves > 0 && (
                    <>
                      {', '}
                      <strong className="text-perigo">{graves} grave(s)</strong>
                    </>
                  )}
                  . Clique no código do projeto para abrir a conta completa.
                </p>
                {listaDeAchados(problemas, 'Achados da conferência de notas')}
              </>
            )}
          </div>
        )}

        {aba === 'projeto' && idEvento && (
          <div id={idPainelAba('projeto')} role="tabpanel" aria-labelledby="aba-projeto">
            <AbaProjeto idEvento={idEvento} codigoInicial={codigoEscolhido} aoImprimir={setFolha} />
          </div>
        )}

        {aba === 'trilha' && idEvento && (
          <div id={idPainelAba('trilha')} role="tabpanel" aria-labelledby="aba-trilha">
            <AbaTrilha idEvento={idEvento} />
          </div>
        )}

        {aba === 'ajustes' && (
          <div id={idPainelAba('ajustes')} role="tabpanel" aria-labelledby="aba-ajustes" className="space-y-4">
            {ajustes.length === 0 ? (
              <Estado
                situacao="vazio"
                titulo="Nenhum ajuste manual neste evento"
                descricao="Todas as notas vieram dos avaliadores, sem correção, arbitragem, lançamento manual ou ajuste de média."
              />
            ) : (
              <>
                <p className="text-apoio text-texto">
                  {ajustes.length} ajuste(s) manual(is) do Admin. Não são erros: é a lista que a comissão confere
                  antes de homologar.
                </p>
                {listaDeAchados(ajustes, 'Ajustes manuais do Admin neste evento')}
              </>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-borda px-5 py-3 text-legenda text-texto-secundario">
        A conferência recalcula as notas no banco, pela mesma fórmula do envio. Última conferência:{' '}
        {dataHoraBr(new Date().toISOString())}.
      </footer>

      {folha && <FolhaConferencia projeto={folha} nomeEvento={nomeEvento} aoFechar={() => setFolha(null)} />}
      {folhaDoEvento && (
        <FolhaConferencia projetos={folhaDoEvento} nomeEvento={nomeEvento} aoFechar={() => setFolhaDoEvento(null)} />
      )}
    </div>
  );
};
