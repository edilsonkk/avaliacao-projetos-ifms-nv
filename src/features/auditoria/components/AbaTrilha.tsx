import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Botao, CampoSelecao, Estado, Selo, Tabela } from '@/components/ui';
import { buscarNomesDeAtores, buscarTrilha, type FiltrosTrilha } from '../api';
import { dataHoraBr, rotuloDaAcao, rotuloDaOperacao, rotuloDaTabela } from '../rotulos';
import type { LinhaDaTrilha } from '../tipos';

/**
 * A trilha de auditoria do evento: quem mexeu, quando, no quê, por onde e com que motivo.
 *
 * `origem = 'direto'` quer dizer que a escrita não passou por nenhuma RPC do sistema — foi feita
 * direto na API do banco. Em credenciamento isso é o fluxo normal da tela do Staff; em nota,
 * é o que a conferência marca como suspeito.
 */

const TABELAS_DE_NOTA = ['avaliacoes', 'respostas_avaliacao', 'perguntas_questionario'];

interface PropriedadesAbaTrilha {
  idEvento: string;
}

export const AbaTrilha: React.FC<PropriedadesAbaTrilha> = ({ idEvento }) => {
  const [linhas, setLinhas] = useState<LinhaDaTrilha[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosTrilha>({});
  const [expandida, setExpandida] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const dados = await buscarTrilha(idEvento, filtros);
      setLinhas(dados);
      setNomes(await buscarNomesDeAtores(dados.map((linha) => linha.ator || '')));
    } catch (e) {
      setErro((e as Error).message);
      setLinhas([]);
    } finally {
      setCarregando(false);
    }
  }, [idEvento, filtros]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const comeca = useMemo(
    () => (linhas.length > 0 ? linhas[linhas.length - 1].quando : null),
    [linhas],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <CampoSelecao
          rotulo="O que aconteceu com"
          className="min-w-[14rem]"
          value={filtros.tabela ?? ''}
          onChange={(evento) => setFiltros((atual) => ({ ...atual, tabela: evento.target.value || undefined }))}
        >
          <option value="">Tudo</option>
          {['avaliacoes', 'respostas_avaliacao', 'perguntas_questionario', 'questionarios', 'projetos', 'avaliadores_evento', 'dispositivos_avaliador', 'usuarios', 'eventos'].map(
            (tabela) => (
              <option key={tabela} value={tabela}>
                {rotuloDaTabela(tabela)}
              </option>
            ),
          )}
        </CampoSelecao>

        <label className="flex items-center gap-2 text-apoio font-semibold text-texto">
          <input
            type="checkbox"
            checked={Boolean(filtros.somenteForaDoFluxo)}
            onChange={(evento) => setFiltros((atual) => ({ ...atual, somenteForaDoFluxo: evento.target.checked || undefined }))}
            className="size-4"
          />
          Só o que foi feito fora do sistema
        </label>

        <Botao variante="secundario" icone={<RefreshCw className="w-4 h-4" />} onClick={carregar} carregando={carregando}>
          Atualizar
        </Botao>
      </div>

      {erro && (
        <p role="alert" className="rounded-controle border border-perigo bg-superficie-alta p-3 text-apoio font-semibold text-perigo">
          {erro}
        </p>
      )}

      {carregando && linhas.length === 0 ? (
        <Estado situacao="carregando" titulo="Carregando a trilha de auditoria…" />
      ) : linhas.length === 0 ? (
        <Estado
          situacao="vazio"
          titulo="Nada registrado ainda"
          descricao="A trilha começa na data em que a auditoria foi instalada: o que aconteceu antes não foi registrado."
        />
      ) : (
        <>
          <Tabela
            legenda="Trilha de auditoria do evento"
            colunas={['Quando', 'Quem', 'O que', 'Onde', 'Origem', 'Motivo']}
            larguraMinima="min-w-[56rem]"
          >
            {linhas.map((linha) => {
              const foraDoFluxo = linha.origem === 'direto';
              const notaMexidaPorFora = foraDoFluxo && TABELAS_DE_NOTA.includes(linha.tabela) && linha.operacao !== 'INSERT';
              const aberta = expandida === linha.id_log;
              return (
                <React.Fragment key={linha.id_log}>
                  <tr className={notaMexidaPorFora ? 'bg-superficie-alta' : undefined}>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{dataHoraBr(linha.quando)}</td>
                    <td className="px-3 py-2">
                      {linha.ator ? nomes[linha.ator] || 'não identificado' : 'não identificado'}
                      {linha.ator_papel && (
                        <span className="block text-legenda text-texto-secundario">{linha.ator_papel}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpandida(aberta ? null : linha.id_log)}
                        aria-expanded={aberta}
                        className="text-left font-semibold text-texto underline decoration-dotted"
                      >
                        {rotuloDaAcao(linha.acao)}
                      </button>
                      <span className="block text-legenda text-texto-secundario">
                        {rotuloDaOperacao(linha.operacao)}
                        {linha.campos_alterados?.length ? ` · ${linha.campos_alterados.join(', ')}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2">{rotuloDaTabela(linha.tabela)}</td>
                    <td className="px-3 py-2">
                      {notaMexidaPorFora ? (
                        <Selo tom="perigo" icone={<AlertTriangle className="w-3 h-3" />} title="Esta alteração de nota não passou por nenhuma função do sistema.">
                          Fora do sistema
                        </Selo>
                      ) : foraDoFluxo ? (
                        <Selo tom="neutro">Tela do sistema</Selo>
                      ) : (
                        <Selo tom="info" title={linha.origem}>
                          {linha.origem}
                        </Selo>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-sm">{linha.motivo || '—'}</td>
                  </tr>
                  {aberta && (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 bg-superficie-alta">
                        <h5 className="text-apoio font-bold text-texto">O que mudou</h5>
                        {linha.campos_alterados?.length ? (
                          <ul className="mt-1 space-y-1 text-apoio">
                            {linha.campos_alterados.map((campo) => (
                              <li key={campo}>
                                <span className="font-semibold">{campo}: </span>
                                <span className="text-texto-secundario">
                                  {String(linha.dados_antes?.[campo] ?? '—')} → {String(linha.dados_depois?.[campo] ?? '—')}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-apoio text-texto-secundario">
                            {linha.operacao === 'INSERT'
                              ? 'Registro criado.'
                              : linha.operacao === 'DELETE'
                                ? 'Registro apagado.'
                                : 'Sem detalhamento de campos.'}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Tabela>
          <p className="text-legenda text-texto-secundario">
            {linhas.length} registro(s). A trilha mais antiga desta lista é de {dataHoraBr(comeca)}; o que aconteceu
            antes da instalação da auditoria não foi registrado.
          </p>
        </>
      )}
    </div>
  );
};
