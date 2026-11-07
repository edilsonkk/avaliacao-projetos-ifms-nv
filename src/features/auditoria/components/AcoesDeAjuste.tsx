import React, { useMemo, useState } from 'react';
import { Modal, Botao, Campo, CampoArea, CampoSelecao, Aviso } from '@/components/ui';
import { formatarAjuste, formatarNota, formatarPeso } from '@/lib/formatoNota';
import {
  ajustarMediaProjeto,
  arbitrarNotaFinal,
  corrigirRespostas,
  lancarAvaliacao,
} from '../api';
import type { CriterioDoMemorial, MemorialAvaliacao, MemorialProjeto, RespostaParaEnviar } from '../tipos';

/**
 * As quatro ações de ajuste manual do Admin. Ficam aqui, dentro da auditoria, e não espalhadas
 * pelas telas de operação: quem ajusta uma nota está vendo a conta que vai mudar.
 *
 * O motivo é opcional, mas a tela pede: é o que sustenta a decisão num recurso. A validação que
 * vale é a do banco (escala, questionário, cota, unicidade); aqui o campo só evita o ida e volta.
 */

/** Prévia da média ponderada, com a mesma fórmula do banco. O valor oficial é o que a RPC devolve. */
const calcularPrevia = (criterios: { peso_calculo: number; nota: number }[]): number | null => {
  const comPeso = criterios.filter((c) => Number(c.peso_calculo) > 0);
  if (comPeso.length === 0) return null;
  const somaPesos = comPeso.reduce((total, c) => total + Number(c.peso_calculo), 0);
  if (somaPesos === 0) return null;
  const somaProdutos = comPeso.reduce((total, c) => total + Number(c.nota) * Number(c.peso_calculo), 0);
  return Math.round((somaProdutos / somaPesos) * 100) / 100;
};

interface EstadoDeEnvio {
  salvando: boolean;
  erro: string | null;
}

const usarEnvio = () => {
  const [estado, setEstado] = useState<EstadoDeEnvio>({ salvando: false, erro: null });
  const enviar = async (acao: () => Promise<unknown>, aoConcluir: () => void) => {
    setEstado({ salvando: true, erro: null });
    try {
      await acao();
      setEstado({ salvando: false, erro: null });
      aoConcluir();
    } catch (erro) {
      setEstado({ salvando: false, erro: (erro as Error).message });
    }
  };
  return { ...estado, enviar, limpar: () => setEstado({ salvando: false, erro: null }) };
};

const CampoMotivo: React.FC<{ valor: string; aoMudar: (v: string) => void }> = ({ valor, aoMudar }) => (
  <CampoArea
    rotulo="Motivo (opcional)"
    descricao="Fica na trilha de auditoria e na folha de conferência. Num recurso, é o que explica a decisão."
    value={valor}
    onChange={(evento) => aoMudar(evento.target.value)}
    rows={2}
    maxLength={1000}
  />
);

const MensagemDeErro: React.FC<{ erro: string | null }> = ({ erro }) =>
  erro ? (
    <p role="alert" className="rounded-controle border border-perigo bg-superficie-alta p-3 text-apoio font-semibold text-perigo">
      {erro}
    </p>
  ) : null;

// ----------------------------------------------------------------------------
// Corrigir as notas por critério
// ----------------------------------------------------------------------------
interface PropsCorrigir {
  aberto: boolean;
  memorial: MemorialAvaliacao;
  aoFechar: () => void;
  aoConcluir: () => void;
}

export const ModalCorrigirNotas: React.FC<PropsCorrigir> = ({ aberto, memorial, aoFechar, aoConcluir }) => {
  const [notas, setNotas] = useState<Record<string, string>>(() =>
    Object.fromEntries(memorial.criterios.map((c) => [c.id_pergunta, String(c.nota)])),
  );
  const [motivo, setMotivo] = useState('');
  const { salvando, erro, enviar } = usarEnvio();

  const min = memorial.questionario?.escala_minima ?? 0;
  const max = memorial.questionario?.escala_maxima ?? 10;

  const previa = useMemo(
    () =>
      calcularPrevia(
        memorial.criterios.map((c: CriterioDoMemorial) => ({
          peso_calculo: c.peso_calculo,
          nota: Number(notas[c.id_pergunta] ?? c.nota),
        })),
      ),
    [memorial.criterios, notas],
  );

  const confirmar = () => {
    const respostas: RespostaParaEnviar[] = memorial.criterios.map((c) => ({
      id_pergunta: c.id_pergunta,
      nota: Number(notas[c.id_pergunta]),
    }));
    enviar(() => corrigirRespostas(memorial.id_avaliacao, respostas, motivo), aoConcluir);
  };

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Corrigir as notas por critério"
      descricao={`Avaliação de ${memorial.avaliador?.nome || 'avaliador não identificado'} · a nota final é recalculada pela fórmula oficial.`}
      papel="alertdialog"
      tamanho="grande"
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={confirmar} carregando={salvando}>
            Corrigir e recalcular
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        {memorial.criterios.map((criterio) => (
          <Campo
            key={criterio.id_pergunta}
            rotulo={`${criterio.criterio} (peso ${formatarPeso(criterio.peso_calculo)})`}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step="0.01"
            value={notas[criterio.id_pergunta] ?? ''}
            onChange={(evento) => setNotas((atual) => ({ ...atual, [criterio.id_pergunta]: evento.target.value }))}
            data-foco-inicial={criterio.ordem === 1 || undefined}
          />
        ))}

        <p className="rounded-controle bg-superficie-alta p-3 text-apoio text-texto">
          <span className="font-semibold">Prévia da nota final: </span>
          <strong className="tabular-nums">{formatarNota(previa)}</strong>{' '}
          <span className="text-texto-secundario">
            (era {formatarNota(memorial.nota_gravada)}; o valor oficial é o que o banco recalcular)
          </span>
        </p>

        <CampoMotivo valor={motivo} aoMudar={setMotivo} />
        <MensagemDeErro erro={erro} />
      </div>
    </Modal>
  );
};

// ----------------------------------------------------------------------------
// Arbitrar a nota final
// ----------------------------------------------------------------------------
export const ModalArbitrarNota: React.FC<PropsCorrigir> = ({ aberto, memorial, aoFechar, aoConcluir }) => {
  const [nota, setNota] = useState(String(memorial.nota_gravada ?? ''));
  const [motivo, setMotivo] = useState('');
  const { salvando, erro, enviar } = usarEnvio();

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Arbitrar a nota final"
      descricao="A nota passa a ser a que você informar, sem vir das notas por critério. A conferência vai mostrar esta avaliação como nota arbitrada, com o motivo."
      papel="alertdialog"
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="perigo" onClick={() => enviar(() => arbitrarNotaFinal(memorial.id_avaliacao, Number(nota), motivo), aoConcluir)} carregando={salvando}>
            Arbitrar nota
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-apoio text-texto-secundario">
          As notas por critério produzem <strong className="tabular-nums text-texto">{formatarNota(memorial.nota_arredondada)}</strong>.
          Hoje está gravado <strong className="tabular-nums text-texto">{formatarNota(memorial.nota_gravada)}</strong>.
        </p>
        <Campo
          rotulo="Nota final"
          descricao={
            memorial.questionario
              ? `Entre ${formatarPeso(memorial.questionario.escala_minima)} e ${formatarPeso(memorial.questionario.escala_maxima)}, a escala do questionário.`
              : undefined
          }
          type="number"
          inputMode="decimal"
          step="0.01"
          min={memorial.questionario?.escala_minima}
          max={memorial.questionario?.escala_maxima}
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          data-foco-inicial
        />
        <CampoMotivo valor={motivo} aoMudar={setMotivo} />
        <MensagemDeErro erro={erro} />
      </div>
    </Modal>
  );
};

// ----------------------------------------------------------------------------
// Ajustar a média do projeto
// ----------------------------------------------------------------------------
interface PropsAjustarMedia {
  aberto: boolean;
  projeto: MemorialProjeto;
  aoFechar: () => void;
  aoConcluir: () => void;
}

export const ModalAjustarMedia: React.FC<PropsAjustarMedia> = ({ aberto, projeto, aoFechar, aoConcluir }) => {
  const [delta, setDelta] = useState(String(projeto.ajuste_media ?? 0));
  const [motivo, setMotivo] = useState(projeto.ajuste_media_motivo ?? '');
  const { salvando, erro, enviar } = usarEnvio();

  const valor = Number(delta) || 0;
  const mediaResultante = projeto.media_geral === null ? null : Number(projeto.media_geral) + valor;

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Ajustar a média do projeto"
      descricao="Bónus ou penalidade de comissão. Não altera nenhuma avaliação: entra na média final, sempre visível ao lado da média das notas."
      papel="alertdialog"
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => enviar(() => ajustarMediaProjeto(projeto.id_projeto, valor, motivo), aoConcluir)} carregando={salvando}>
            {valor === 0 ? 'Remover o ajuste' : 'Aplicar ajuste'}
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        <Campo
          rotulo="Ajuste em pontos"
          descricao="Positivo para bónus, negativo para penalidade. Zero remove o ajuste."
          type="number"
          inputMode="decimal"
          step="0.01"
          value={delta}
          onChange={(evento) => setDelta(evento.target.value)}
          data-foco-inicial
        />
        <p className="rounded-controle bg-superficie-alta p-3 text-apoio text-texto">
          <span className="font-semibold">Média final: </span>
          <span className="tabular-nums">{formatarNota(projeto.media_geral)}</span>{' '}
          <span className="tabular-nums">{formatarAjuste(valor)}</span> ={' '}
          <strong className="tabular-nums">{formatarNota(mediaResultante)}</strong>
        </p>
        <CampoMotivo valor={motivo} aoMudar={setMotivo} />
        <MensagemDeErro erro={erro} />
      </div>
    </Modal>
  );
};

// ----------------------------------------------------------------------------
// Lançar avaliação em nome de um avaliador
// ----------------------------------------------------------------------------
interface PropsLancar {
  aberto: boolean;
  projeto: MemorialProjeto;
  avaliadores: { id_usuario: string; nome: string; email: string }[];
  criterios: CriterioDoMemorial[];
  aoFechar: () => void;
  aoConcluir: () => void;
}

export const ModalLancarAvaliacao: React.FC<PropsLancar> = ({
  aberto,
  projeto,
  avaliadores,
  criterios,
  aoFechar,
  aoConcluir,
}) => {
  const [idUsuario, setIdUsuario] = useState('');
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [parecer, setParecer] = useState('');
  const [motivo, setMotivo] = useState('');
  const [acimaDaCota, setAcimaDaCota] = useState(false);
  const { salvando, erro, enviar } = usarEnvio();

  const questionario = projeto.questionario_fixado;
  const cotaCheia = projeto.total_avaliacoes >= projeto.cota;
  const previa = useMemo(
    () => calcularPrevia(criterios.map((c) => ({ peso_calculo: c.peso_calculo, nota: Number(notas[c.id_pergunta] ?? NaN) }))),
    [criterios, notas],
  );

  const confirmar = () => {
    if (!questionario) return;
    enviar(
      () =>
        lancarAvaliacao({
          idProjeto: projeto.id_projeto,
          idUsuario,
          idQuestionario: questionario.id_questionario,
          respostas: criterios.map((c) => ({ id_pergunta: c.id_pergunta, nota: Number(notas[c.id_pergunta]) })),
          parecer,
          motivo,
          confirmarAcimaDaCota: acimaDaCota,
        }),
      aoConcluir,
    );
  };

  if (!questionario) {
    return (
      <Aviso
        aberto={aberto}
        tipo="atencao"
        titulo="Sem questionário definido"
        mensagem={`O projeto ${projeto.codigo_projeto || ''} ainda não tem questionário fixado. A primeira avaliação precisa vir pelo avaliador, ou fixe o questionário antes de lançar.`}
        aoFechar={aoFechar}
      />
    );
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Lançar avaliação"
      descricao={`Projeto ${projeto.codigo_projeto || projeto.titulo} · ${questionario.titulo}. Use para ficha em papel ou avaliador sem acesso ao celular.`}
      papel="alertdialog"
      tamanho="grande"
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={confirmar} carregando={salvando} disabled={!idUsuario}>
            Lançar avaliação
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        <CampoSelecao
          rotulo="Avaliador"
          descricao="Só avaliadores vinculados a este evento."
          value={idUsuario}
          onChange={(evento) => setIdUsuario(evento.target.value)}
          data-foco-inicial
        >
          <option value="">Escolha o avaliador…</option>
          {avaliadores.map((avaliador) => (
            <option key={avaliador.id_usuario} value={avaliador.id_usuario}>
              {avaliador.nome} · {avaliador.email}
            </option>
          ))}
        </CampoSelecao>

        {criterios.map((criterio) => (
          <Campo
            key={criterio.id_pergunta}
            rotulo={`${criterio.criterio} (peso ${formatarPeso(criterio.peso_calculo)})`}
            type="number"
            inputMode="decimal"
            min={questionario.escala_minima}
            max={questionario.escala_maxima}
            step="0.01"
            value={notas[criterio.id_pergunta] ?? ''}
            onChange={(evento) => setNotas((atual) => ({ ...atual, [criterio.id_pergunta]: evento.target.value }))}
          />
        ))}

        <p className="rounded-controle bg-superficie-alta p-3 text-apoio text-texto">
          <span className="font-semibold">Prévia da nota final: </span>
          <strong className="tabular-nums">{formatarNota(previa)}</strong>{' '}
          <span className="text-texto-secundario">(o valor oficial é o que o banco calcular)</span>
        </p>

        <CampoArea
          rotulo="Parecer (opcional)"
          value={parecer}
          onChange={(evento) => setParecer(evento.target.value)}
          rows={2}
          maxLength={5000}
        />
        <CampoMotivo valor={motivo} aoMudar={setMotivo} />

        {cotaCheia && (
          <label className="flex items-start gap-2 rounded-controle border border-aviso bg-superficie-alta p-3 text-apoio text-texto">
            <input
              type="checkbox"
              checked={acimaDaCota}
              onChange={(evento) => setAcimaDaCota(evento.target.checked)}
              className="mt-0.5 size-4 shrink-0"
            />
            <span>
              O projeto já tem {projeto.total_avaliacoes} de {projeto.cota} avaliações da cota. Confirmo o lançamento
              acima da cota, que fica marcado na trilha.
            </span>
          </label>
        )}

        <MensagemDeErro erro={erro} />
      </div>
    </Modal>
  );
};
