import React, { useCallback, useEffect, useState } from 'react';
import { Printer, Scale, Search, SlidersHorizontal, UserPlus } from 'lucide-react';
import { Botao, Campo, Estado, Selo, Tabela } from '@/components/ui';
import { formatarNota, formatarPeso } from '@/lib/formatoNota';
import { buscarAvaliadoresDoEvento, buscarMemorialPorCodigo } from '../api';
import { dataHoraBr, ROTULO_SEVERIDADE, TOM_POR_SEVERIDADE } from '../rotulos';
import type { MemorialAvaliacao as Memorial, MemorialProjeto } from '../tipos';
import { MemorialAvaliacao } from './MemorialAvaliacao';
import { MemorialMediaProjeto } from './MemorialMediaProjeto';
import { ModalAjustarMedia, ModalArbitrarNota, ModalCorrigirNotas, ModalLancarAvaliacao } from './AcoesDeAjuste';

/**
 * Conferência de um projeto: a média aberta, o memorial de cada avaliação, o desempate, a
 * quarentena e as ações de ajuste. A busca é pelo `codigo_projeto` — a interface nunca pede
 * nem mostra UUID (regra 6 do AGENTS.md).
 */

interface PropriedadesAbaProjeto {
  idEvento: string;
  /** Código já escolhido em outra aba (um achado da conferência, por exemplo). */
  codigoInicial?: string | null;
  aoImprimir?: (projeto: MemorialProjeto) => void;
}

export const AbaProjeto: React.FC<PropriedadesAbaProjeto> = ({ idEvento, codigoInicial, aoImprimir }) => {
  const [codigo, setCodigo] = useState(codigoInicial ?? '');
  const [projeto, setProjeto] = useState<MemorialProjeto | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avaliadores, setAvaliadores] = useState<{ id_usuario: string; nome: string; email: string }[]>([]);
  const [corrigindo, setCorrigindo] = useState<Memorial | null>(null);
  const [arbitrando, setArbitrando] = useState<Memorial | null>(null);
  const [lancando, setLancando] = useState(false);
  const [ajustandoMedia, setAjustandoMedia] = useState(false);

  const abrir = useCallback(
    async (codigoBuscado: string) => {
      const limpo = codigoBuscado.trim();
      if (!limpo) return;
      setCarregando(true);
      setErro(null);
      try {
        setProjeto(await buscarMemorialPorCodigo(limpo, idEvento));
      } catch (e) {
        setErro((e as Error).message);
        setProjeto(null);
      } finally {
        setCarregando(false);
      }
    },
    [idEvento],
  );

  useEffect(() => {
    if (codigoInicial) {
      setCodigo(codigoInicial);
      abrir(codigoInicial);
    }
  }, [codigoInicial, abrir]);

  useEffect(() => {
    buscarAvaliadoresDoEvento(idEvento).then(setAvaliadores).catch(() => setAvaliadores([]));
  }, [idEvento]);

  const recarregar = () => {
    setCorrigindo(null);
    setArbitrando(null);
    setLancando(false);
    setAjustandoMedia(false);
    if (projeto?.codigo_projeto) abrir(projeto.codigo_projeto);
  };

  const criteriosDoQuestionario =
    projeto?.avaliacoes_ativas[0]?.criterios ?? projeto?.avaliacoes_canceladas[0]?.criterios ?? [];

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          abrir(codigo);
        }}
      >
        <Campo
          rotulo="Código do projeto"
          descricao="O mesmo código que aparece nos relatórios e no crachá do estande."
          className="min-w-[16rem]"
          value={codigo}
          onChange={(evento) => setCodigo(evento.target.value)}
          placeholder="PROJ-001"
          autoComplete="off"
        />
        <Botao type="submit" icone={<Search className="w-4 h-4" />} carregando={carregando}>
          Abrir conferência
        </Botao>
      </form>

      {erro && (
        <p role="alert" className="rounded-controle border border-perigo bg-superficie-alta p-3 text-apoio font-semibold text-perigo">
          {erro}
        </p>
      )}

      {!projeto && !erro && !carregando && (
        <Estado
          situacao="vazio"
          titulo="Escolha um projeto"
          descricao="Digite o código do projeto para ver a conta de cada nota, a média, o desempate e o histórico de alterações."
        />
      )}

      {projeto && (
        <article className="space-y-5">
          {/* Cabeçalho do projeto, com a média aberta */}
          <header className="rounded-cartao border border-borda bg-superficie p-4 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-titulo-3 font-bold text-texto">{projeto.codigo_projeto || '—'}</p>
                <h3 className="text-corpo font-bold text-texto">{projeto.titulo}</h3>
                <p className="text-apoio text-texto-secundario">
                  {projeto.instituicao} · {projeto.modalidade} · {projeto.area_tematica}
                  {projeto.estande && ` · estande ${projeto.estande}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {projeto.fora_da_competicao && <Selo tom="neutro">Fora da competição</Selo>}
                {!projeto.check_in && <Selo tom="aviso">Sem check-in</Selo>}
                {projeto.quarentena.pendente && <Selo tom="perigo">Quarentena pendente</Selo>}
                {projeto.posicao_no_ranking !== null && <Selo tom="info">{projeto.posicao_no_ranking}º lugar</Selo>}
              </div>
            </div>

            <MemorialMediaProjeto projeto={projeto} />

            <div className="flex flex-wrap gap-2 pt-1">
              <Botao variante="secundario" icone={<UserPlus className="w-4 h-4" />} onClick={() => setLancando(true)}>
                Lançar avaliação
              </Botao>
              <Botao variante="secundario" icone={<SlidersHorizontal className="w-4 h-4" />} onClick={() => setAjustandoMedia(true)}>
                Ajustar média
              </Botao>
              {aoImprimir && (
                <Botao variante="secundario" icone={<Printer className="w-4 h-4" />} onClick={() => aoImprimir(projeto)}>
                  Folha de conferência
                </Botao>
              )}
            </div>
          </header>

          {/* Achados do projeto */}
          {projeto.achados.length > 0 && (
            <section aria-label="Achados da conferência deste projeto" className="space-y-2">
              <h4 className="text-corpo font-bold text-texto">O que a conferência encontrou</h4>
              {projeto.achados.map((achado, indice) => (
                <p
                  key={`${achado.codigo}-${indice}`}
                  className="rounded-controle border border-borda bg-superficie p-3 text-apoio text-texto"
                >
                  <Selo tom={TOM_POR_SEVERIDADE[achado.severidade]}>{ROTULO_SEVERIDADE[achado.severidade]}</Selo>{' '}
                  <span className="font-bold">{achado.titulo}</span>
                  {achado.detalhe && <span className="block text-texto-secundario">{achado.detalhe}</span>}
                </p>
              ))}
            </section>
          )}

          {/* Memorial de cada avaliação */}
          <section aria-label="Memorial de cálculo das avaliações" className="space-y-3">
            <h4 className="text-corpo font-bold text-texto">Como cada nota foi formada</h4>
            {projeto.avaliacoes_ativas.length === 0 ? (
              <Estado situacao="vazio" titulo="Nenhuma avaliação ativa" descricao="Este projeto ainda não tem nota." />
            ) : (
              projeto.avaliacoes_ativas.map((avaliacao) => (
                <MemorialAvaliacao
                  key={avaliacao.id_avaliacao}
                  memorial={avaliacao}
                  acoes={
                    <>
                      <Botao variante="secundario" tamanho="medio" onClick={() => setCorrigindo(avaliacao)}>
                        Corrigir notas
                      </Botao>
                      <Botao variante="secundario" tamanho="medio" onClick={() => setArbitrando(avaliacao)}>
                        Arbitrar nota final
                      </Botao>
                    </>
                  }
                />
              ))
            )}
          </section>

          {projeto.avaliacoes_canceladas.length > 0 && (
            <section aria-label="Avaliações canceladas" className="space-y-3">
              <h4 className="text-corpo font-bold text-texto">
                Avaliações canceladas ({projeto.avaliacoes_canceladas.length})
              </h4>
              <p className="text-apoio text-texto-secundario">
                Não entram na média. Ficam aqui porque o sistema nunca apaga nota: só marca como cancelada.
              </p>
              {projeto.avaliacoes_canceladas.map((avaliacao) => (
                <MemorialAvaliacao key={avaliacao.id_avaliacao} memorial={avaliacao} />
              ))}
            </section>
          )}

          {/* Desempate e quarentena */}
          <section aria-label="Desempate e quarentena" className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-corpo font-bold text-texto">Desempate</h4>
              {projeto.desempate.por_prioridade.length === 0 ? (
                <p className="text-apoio text-texto-secundario">
                  Nenhuma pergunta deste questionário entra no desempate.
                </p>
              ) : (
                <Tabela
                  legenda="Médias por pergunta de desempate"
                  colunas={['Prioridade', 'Critério', 'Média']}
                  larguraMinima="min-w-[22rem]"
                >
                  {projeto.desempate.por_prioridade.map((item) => (
                    <tr key={`${item.prioridade}-${item.ordem}`}>
                      <td className="px-3 py-2 tabular-nums">{formatarPeso(item.prioridade)}</td>
                      <th scope="row" className="px-3 py-2 text-left font-semibold text-texto">
                        {item.criterio}
                      </th>
                      <td className="px-3 py-2 tabular-nums font-bold">{formatarNota(item.media)}</td>
                    </tr>
                  ))}
                </Tabela>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-corpo font-bold text-texto">Quarentena</h4>
              <p className="text-apoio text-texto">
                Menor nota {formatarNota(projeto.quarentena.nota_minima)} · maior nota{' '}
                {formatarNota(projeto.quarentena.nota_maxima)} · divergência{' '}
                <strong className="tabular-nums">{formatarNota(projeto.quarentena.divergencia)}</strong> (limite{' '}
                {formatarNota(projeto.quarentena.limite)})
              </p>
              {projeto.quarentena.resolvida_em ? (
                <p className="text-apoio text-texto-secundario">
                  Divergência aceita em {dataHoraBr(projeto.quarentena.resolvida_em)}
                  {projeto.quarentena.resolvida_por?.nome && ` por ${projeto.quarentena.resolvida_por.nome}`}.
                </p>
              ) : projeto.quarentena.pendente ? (
                <p className="text-apoio font-semibold text-perigo">
                  <Scale aria-hidden="true" className="inline w-4 h-4" /> Pendente: resolva na Quarentena antes de
                  homologar.
                </p>
              ) : (
                <p className="text-apoio text-texto-secundario">Dentro do limite de divergência.</p>
              )}
            </div>
          </section>

          {/* Trilha do projeto */}
          <section aria-label="Histórico de alterações deste projeto" className="space-y-2">
            <h4 className="text-corpo font-bold text-texto">Histórico de alterações</h4>
            {projeto.trilha.length === 0 ? (
              <p className="text-apoio text-texto-secundario">
                Nada registrado para este projeto desde que a trilha de auditoria passou a existir.
              </p>
            ) : (
              <Tabela legenda="Alterações registradas neste projeto" colunas={['Quando', 'O que', 'Origem', 'Motivo']} larguraMinima="min-w-[36rem]">
                {projeto.trilha.map((linha) => (
                  <tr key={linha.id_log}>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{dataHoraBr(linha.quando)}</td>
                    <td className="px-3 py-2">{linha.acao.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2">
                      {linha.origem === 'direto' ? <Selo tom="aviso">fora de RPC</Selo> : linha.origem}
                    </td>
                    <td className="px-3 py-2">{linha.motivo || '—'}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </section>
        </article>
      )}

      {corrigindo && (
        <ModalCorrigirNotas aberto memorial={corrigindo} aoFechar={() => setCorrigindo(null)} aoConcluir={recarregar} />
      )}
      {arbitrando && (
        <ModalArbitrarNota aberto memorial={arbitrando} aoFechar={() => setArbitrando(null)} aoConcluir={recarregar} />
      )}
      {projeto && lancando && (
        <ModalLancarAvaliacao
          aberto
          projeto={projeto}
          avaliadores={avaliadores}
          criterios={criteriosDoQuestionario}
          aoFechar={() => setLancando(false)}
          aoConcluir={recarregar}
        />
      )}
      {projeto && ajustandoMedia && (
        <ModalAjustarMedia aberto projeto={projeto} aoFechar={() => setAjustandoMedia(false)} aoConcluir={recarregar} />
      )}
    </div>
  );
};
