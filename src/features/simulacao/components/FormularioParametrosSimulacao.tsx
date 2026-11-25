import React from 'react';
import { Campo, CampoSelecao, Dica } from '@/components/ui';
import {
  limitesDoAmbiente,
  type AmbienteSimulacao,
  type ParametrosSimulacao,
} from '@/lib/simulacao/parametros';

interface Propriedades {
  parametros: ParametrosSimulacao;
  ambiente: AmbienteSimulacao | null;
  aoMudar: (parametros: ParametrosSimulacao) => void;
  desabilitado?: boolean;
}

/** Campos da simulação, agrupados por assunto. Todo campo tem rótulo ligado por `htmlFor`. */
export const FormularioParametrosSimulacao: React.FC<Propriedades> = ({
  parametros,
  ambiente,
  aoMudar,
  desabilitado = false,
}) => {
  const limites = limitesDoAmbiente(ambiente);
  const numero = (campo: keyof ParametrosSimulacao) => (
    evento: React.ChangeEvent<HTMLInputElement>,
  ) => {
    aoMudar({ ...parametros, [campo]: Number(evento.target.value) });
  };

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3" disabled={desabilitado}>
        <legend className="text-apoio font-bold uppercase text-texto-secundario">Volume</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo
            rotulo="Projetos"
            type="number"
            min={1}
            max={limites.projetos}
            value={parametros.projetos}
            onChange={numero('projetos')}
            descricao={`Até ${limites.projetos} neste ambiente.`}
          />
          <Campo
            rotulo="Avaliadores"
            type="number"
            min={1}
            max={limites.avaliadores}
            value={parametros.avaliadores}
            onChange={numero('avaliadores')}
            descricao={`Até ${limites.avaliadores} neste ambiente.`}
          />
          <Campo
            rotulo="Staff"
            type="number"
            min={0}
            max={limites.staff}
            value={parametros.staff}
            onChange={numero('staff')}
            descricao="Só cadastra as pessoas: o check-in da simulação é feito pela coordenação."
          />
          <Campo
            rotulo="Avaliações por projeto"
            type="number"
            min={1}
            max={limites.cota}
            value={parametros.cota}
            onChange={numero('cota')}
            descricao="A cota do evento."
          />
          <Campo
            rotulo="Questionários técnicos"
            type="number"
            min={1}
            max={limites.questionariosTecnicos}
            value={parametros.questionariosTecnicos}
            onChange={numero('questionariosTecnicos')}
            descricao="Com mais de um, a trava do questionário no primeiro avaliador passa a valer."
          />
          <Campo
            rotulo="Semente do sorteio"
            type="number"
            min={1}
            value={parametros.semente}
            onChange={numero('semente')}
            descricao="A mesma semente repete exatamente a mesma feira."
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3" disabled={desabilitado}>
        <legend className="text-apoio font-bold uppercase text-texto-secundario">Ritmo</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo
            rotulo="Tempo entre avaliações (ms)"
            type="number"
            min={0}
            step={100}
            value={parametros.ritmoMs}
            onChange={numero('ritmoMs')}
            descricao="Varia de 0,5x a 1,5x em cada avaliador. Zero roda sem pausa, para medir."
          />
          <Campo
            rotulo="Requisições simultâneas"
            type="number"
            min={1}
            max={limites.concorrencia}
            value={parametros.concorrencia}
            onChange={numero('concorrencia')}
            descricao={`Até ${limites.concorrencia} aqui. Acima disso, mede-se a fila, não a aplicação.`}
          />
        </div>
        <div className="flex items-start gap-1">
          <CampoSelecao
            rotulo="Modo de sessão"
            className="flex-1"
            value={parametros.modoSessao}
            onChange={(evento) => aoMudar({
              ...parametros,
              modoSessao: evento.target.value as ParametrosSimulacao['modoSessao'],
            })}
          >
            <option value="admin">Pela sessão da coordenação</option>
            <option value="por-avaliador" disabled={!limites.permiteSessaoPorAvaliador}>
              Uma sessão por avaliador{limites.permiteSessaoPorAvaliador ? '' : ' — só no banco local'}
            </option>
          </CampoSelecao>
          <Dica alinhar="fim">
            Pela sessão da coordenação, a simulação exercita sorteio, cota, trava, conflito e
            quarentena. Uma sessão por avaliador exercita também o pareamento do aparelho e o
            credenciamento, mas só roda no banco local: cada sessão cria uma conta que apenas a
            chave de serviço apaga, e ela não existe no navegador.
          </Dica>
        </div>
      </fieldset>

      <fieldset className="space-y-3" disabled={desabilitado}>
        <legend className="text-apoio font-bold uppercase text-texto-secundario">
          Proporções e notas
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo
            rotulo="Voto popular (%)"
            type="number"
            min={0}
            max={100}
            value={parametros.porcentoVotoPopular}
            onChange={numero('porcentoVotoPopular')}
            descricao="Fatia dos avaliadores que entra como público votante."
          />
          <Campo
            rotulo="Check-in (%)"
            type="number"
            min={0}
            max={100}
            value={parametros.porcentoCheckIn}
            onChange={numero('porcentoCheckIn')}
            descricao="Projetos que chegam ao estande. Sem check-in, o projeto não é sorteado."
          />
          <Campo
            rotulo="Credenciamento (%)"
            type="number"
            min={0}
            max={100}
            value={parametros.porcentoCredenciamento}
            onChange={numero('porcentoCredenciamento')}
            descricao="Move o contador do telão; não é o que dá direito de avaliar."
          />
          <Campo
            rotulo="Dispersão das notas (%)"
            type="number"
            min={0}
            max={100}
            value={parametros.dispersaoNotas}
            onChange={numero('dispersaoNotas')}
            descricao="Zero concentra tudo no meio da escala; 100 usa a escala inteira."
          />
          <Campo
            rotulo="Projetos divergentes (%)"
            type="number"
            min={0}
            max={100}
            value={parametros.porcentoQuarentena}
            onChange={numero('porcentoQuarentena')}
            descricao="Recebem notas opostas de propósito, para cair em quarentena."
          />
        </div>
      </fieldset>
    </div>
  );
};
