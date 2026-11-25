import React, { useMemo, useState } from 'react';
import { AlertTriangle, FlaskConical, Loader2, Play, Trash2 } from 'lucide-react';
import { Botao, Campo, Estado, Modal, Selo, useAvisos } from '@/components/ui';
import { PARAMETROS_PADRAO, validarParametros, type ParametrosSimulacao } from '@/lib/simulacao/parametros';
import { FormularioParametrosSimulacao } from './FormularioParametrosSimulacao';
import { PainelProgressoSimulacao } from './PainelProgressoSimulacao';
import { useSimulacao } from '../hooks/useSimulacao';

interface Propriedades {
  aberto: boolean;
  aoFechar: () => void;
  /** Recarrega os indicadores do painel do Admin depois que a simulação muda o banco. */
  aoAtualizarMetricas?: () => void;
}

/**
 * Simulação de evento: cria uma feira fictícia, roda avaliadores e staff pelo caminho real e
 * deixa acompanhar pelo telão.
 *
 * Em produção a confirmação é em duas etapas, com o nome do evento ativo digitado à mão, pelo
 * mesmo motivo do Reset Global: a simulação TROCA o evento ativo, e o telão público e os
 * celulares passam a enxergar a feira fictícia enquanto ela roda.
 *
 * Ver docs/operacao/simulacao-de-evento.md.
 */
export const ModalSimulacaoEvento: React.FC<Propriedades> = ({
  aberto,
  aoFechar,
  aoAtualizarMetricas,
}) => {
  const { avisar, confirmar } = useAvisos();
  const simulacao = useSimulacao();
  const [parametros, setParametros] = useState<ParametrosSimulacao>(PARAMETROS_PADRAO);
  const [velocidade, setVelocidade] = useState(1);
  const [nomeDigitado, setNomeDigitado] = useState('');

  const emProducao = simulacao.ambiente !== 'local';
  const validacao = useMemo(
    () => validarParametros(parametros, simulacao.ambiente),
    [parametros, simulacao.ambiente],
  );
  const eventoAtivo = simulacao.preVoo?.eventoAtivo ?? null;
  const orfas = simulacao.preVoo?.orfas ?? [];
  const configurando = simulacao.passo === 'configurando';
  const rodando = simulacao.passo === 'rodando' || simulacao.passo === 'semeando';

  // Em produção, o nome do evento ativo é digitado à mão antes de qualquer escrita.
  const nomeConfere = !emProducao || nomeDigitado.trim() === (eventoAtivo?.nome_evento ?? '').trim();
  const podeIniciar = configurando && validacao.erros.length === 0 && nomeConfere
    && !simulacao.carregandoPreVoo;

  const metaTecnica = parametros.projetos * parametros.cota;

  const iniciar = async () => {
    const texto = [
      `Serão criados um evento novo, ${parametros.projetos} projetos e ${parametros.avaliadores} avaliadores fictícios.`,
      eventoAtivo
        ? `O evento "${eventoAtivo.nome_evento}" deixa de ser o ativo enquanto a simulação roda.`
        : 'Nenhum evento está ativo agora.',
      eventoAtivo?.janelaAberta
        ? 'ATENÇÃO: a janela de avaliação do evento atual está ABERTA agora. Avaliadores reais perderão o acesso à feira verdadeira.'
        : '',
      ...validacao.avisos,
    ].filter(Boolean).join(' ');

    const confirmado = await confirmar({
      titulo: emProducao ? 'Rodar a simulação no banco de produção?' : 'Iniciar a simulação?',
      mensagem: texto,
      rotuloConfirmar: 'Iniciar simulação',
    });
    if (!confirmado) return;

    await simulacao.iniciar(parametros);
    if (aoAtualizarMetricas) aoAtualizarMetricas();
  };

  const encerrar = async (idEvento?: string, nomeAnterior?: string | null) => {
    await simulacao.encerrarERestaurar(idEvento, nomeAnterior);
    if (aoAtualizarMetricas) aoAtualizarMetricas();
    await avisar({
      tipo: 'sucesso',
      titulo: 'Simulação encerrada',
      mensagem: 'As travas foram liberadas e o evento anterior voltou a ser o ativo.',
    });
  };

  const apagar = async (idEvento?: string) => {
    const confirmado = await confirmar({
      titulo: 'Apagar a simulação?',
      mensagem:
        'Apaga o evento fictício, seus projetos, avaliações e avaliadores. Não pode ser desfeito. ' +
        'A trilha de auditoria é mantida, porque não pode ser apagada por desenho.',
      rotuloConfirmar: 'Apagar simulação',
    });
    if (!confirmado) return;

    const limpeza = await simulacao.apagar(idEvento);
    if (aoAtualizarMetricas) aoAtualizarMetricas();
    if (limpeza) {
      await avisar({
        tipo: 'sucesso',
        titulo: 'Simulação apagada',
        mensagem:
          `${limpeza.avaliacoesApagadas} avaliação(ões) e ${limpeza.usuariosApagados} avaliador(es) ` +
          `removidos. ${limpeza.usuariosPreservados} preservado(s) por ter vínculo ou nota em outro evento.`,
      });
    }
  };

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Simulação de Evento"
      descricao="Cria uma feira fictícia e a executa pelo caminho real, para ensaio e teste de carga."
      tamanho="grande"
      acoes={
        <>
          <Botao variante="fantasma" onClick={aoFechar}>
            {rodando ? 'Fechar (a simulação para)' : 'Fechar'}
          </Botao>
          {configurando && (
            <Botao variante="primario" onClick={iniciar} disabled={!podeIniciar}>
              {simulacao.passo === 'semeando'
                ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                : <Play aria-hidden="true" className="w-4 h-4" />}
              Iniciar simulação
            </Botao>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {simulacao.erro && (
          <Estado
            situacao="erro"
            titulo="A simulação encontrou um problema"
            descricao={simulacao.erro}
          />
        )}

        {emProducao && (
          <section
            aria-labelledby="titulo-aviso-producao"
            className="rounded-2xl border border-perigo bg-superficie-alta p-3 space-y-2"
          >
            <h3 id="titulo-aviso-producao" className="flex items-center gap-1.5 text-corpo font-bold text-perigo">
              <AlertTriangle aria-hidden="true" className="w-4 h-4" />
              Este é o banco de produção
            </h3>
            <p className="text-apoio text-texto">
              A simulação cria um evento novo e o torna ativo. Enquanto ela roda, o telão público
              e os celulares dos avaliadores passam a mostrar a feira fictícia. Ao encerrar, o
              evento anterior volta a ser o ativo.
            </p>
            {eventoAtivo?.janelaAberta && (
              <p className="text-apoio font-bold text-perigo">
                A janela de avaliação do evento atual está aberta agora: há feira em andamento.
              </p>
            )}
            {eventoAtivo && (
              <Campo
                rotulo={`Para confirmar, digite o nome do evento ativo: ${eventoAtivo.nome_evento}`}
                value={nomeDigitado}
                onChange={(evento) => setNomeDigitado(evento.target.value)}
                erro={nomeDigitado.length > 0 && !nomeConfere ? 'O nome não confere.' : null}
                disabled={!configurando}
              />
            )}
          </section>
        )}

        {orfas.length > 0 && configurando && (
          <section aria-labelledby="titulo-orfas" className="rounded-2xl border border-aviso bg-superficie-alta p-3 space-y-2">
            <h3 id="titulo-orfas" className="text-corpo font-bold text-texto">
              Simulações no banco
            </h3>
            <ul className="space-y-2">
              {orfas.map((orfa) => (
                <li key={orfa.id_evento} className="flex flex-wrap items-center gap-2">
                  <span className="text-apoio text-texto">{orfa.nome_evento}</span>
                  {orfa.is_ativo && <Selo tom="aviso">ativa</Selo>}
                  {orfa.is_ativo && (
                    <Botao
                      tamanho="medio"
                      variante="secundario"
                      onClick={() => encerrar(orfa.id_evento, orfa.nomeEventoAnterior)}
                    >
                      Encerrar e restaurar
                    </Botao>
                  )}
                  {!orfa.is_ativo && (
                    <Botao tamanho="medio" variante="perigo" onClick={() => apagar(orfa.id_evento)}>
                      <Trash2 aria-hidden="true" className="w-4 h-4" /> Apagar
                    </Botao>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {configurando && (
          <>
            {validacao.erros.length > 0 && (
              <section
                aria-labelledby="titulo-ajustes"
                className="rounded-2xl border border-aviso bg-superficie-alta p-3"
              >
                <h3 id="titulo-ajustes" className="text-corpo font-bold text-texto">
                  Ajuste a configuração
                </h3>
                <ul className="list-disc pl-4 text-apoio text-texto">
                  {validacao.erros.map((mensagem) => <li key={mensagem}>{mensagem}</li>)}
                </ul>
              </section>
            )}
            <p className="flex items-center gap-1.5 text-apoio text-texto-secundario">
              <FlaskConical aria-hidden="true" className="w-4 h-4" />
              Esta configuração pede {metaTecnica} avaliações técnicas.
            </p>
            <FormularioParametrosSimulacao
              parametros={parametros}
              ambiente={simulacao.ambiente}
              aoMudar={setParametros}
            />
          </>
        )}

        {simulacao.passo === 'semeando' && (
          <Estado
            situacao="carregando"
            titulo="Criando a feira fictícia"
            descricao="Evento, catálogos, questionários, projetos e avaliadores."
          />
        )}

        {simulacao.progresso && simulacao.passo !== 'configurando' && (
          <PainelProgressoSimulacao
            progresso={simulacao.progresso}
            metaTecnica={metaTecnica}
            velocidade={velocidade}
            aoPausar={simulacao.pausar}
            aoRetomar={simulacao.retomar}
            aoEncerrar={simulacao.encerrar}
            aoAjustarVelocidade={(multiplicador) => {
              setVelocidade(multiplicador);
              simulacao.ajustarVelocidade(multiplicador);
            }}
          />
        )}

        {(simulacao.passo === 'concluida' || simulacao.passo === 'falhou') && simulacao.resumo && (
          <div className="flex flex-wrap gap-2.5 border-t border-borda pt-3">
            <Botao variante="secundario" onClick={() => encerrar()}>
              Encerrar e restaurar o evento anterior
            </Botao>
            <Botao variante="perigo" onClick={() => apagar()}>
              <Trash2 aria-hidden="true" className="w-4 h-4" /> Apagar a simulação
            </Botao>
          </div>
        )}
      </div>
    </Modal>
  );
};
