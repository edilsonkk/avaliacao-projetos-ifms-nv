/**
 * Parâmetros de acesso dos avaliadores por evento (Configurações do evento).
 * Os limites espelham os CHECK de public.eventos (migration 20261028210000):
 * o banco recusa valores fora deles mesmo que a tela seja contornada.
 */

export type MetodoVinculo = 'ambos' | 'pareamento' | 'codigo';

export interface ParametrosAcesso {
  minutos_validade_pareamento: number;
  minutos_validade_codigo_acesso: number;
  tamanho_codigo: number;
  max_tentativas_codigo: number;
  metodos_vinculo: MetodoVinculo;
}

export const PARAMETROS_ACESSO_PADRAO: ParametrosAcesso = {
  minutos_validade_pareamento: 10,
  minutos_validade_codigo_acesso: 15,
  tamanho_codigo: 6,
  max_tentativas_codigo: 5,
  metodos_vinculo: 'ambos',
};

type CampoNumerico = Exclude<keyof ParametrosAcesso, 'metodos_vinculo'>;

export const LIMITES_ACESSO: Record<CampoNumerico, { min: number; max: number; rotulo: string; unidade: string }> = {
  minutos_validade_pareamento: { min: 1, max: 60, rotulo: 'Validade do código de pareamento', unidade: 'minutos' },
  minutos_validade_codigo_acesso: { min: 1, max: 120, rotulo: 'Validade do código de acesso', unidade: 'minutos' },
  tamanho_codigo: { min: 6, max: 10, rotulo: 'Tamanho dos códigos', unidade: 'caracteres' },
  max_tentativas_codigo: { min: 1, max: 10, rotulo: 'Tentativas por código de acesso', unidade: '' },
};

export const METODOS_VINCULO: { valor: MetodoVinculo; rotulo: string }[] = [
  { valor: 'ambos', rotulo: 'Pareamento pelo Staff e código de acesso' },
  { valor: 'pareamento', rotulo: 'Só pareamento pelo Staff' },
  { valor: 'codigo', rotulo: 'Só código de acesso' },
];

const isMetodo = (valor: unknown): valor is MetodoVinculo =>
  valor === 'ambos' || valor === 'pareamento' || valor === 'codigo';

export const lerParametrosAcesso = (evento: Partial<Record<keyof ParametrosAcesso, unknown>>): ParametrosAcesso => {
  const numero = (campo: CampoNumerico) => {
    const valor = Number(evento[campo]);
    return Number.isFinite(valor) && valor > 0 ? valor : PARAMETROS_ACESSO_PADRAO[campo];
  };
  return {
    minutos_validade_pareamento: numero('minutos_validade_pareamento'),
    minutos_validade_codigo_acesso: numero('minutos_validade_codigo_acesso'),
    tamanho_codigo: numero('tamanho_codigo'),
    max_tentativas_codigo: numero('max_tentativas_codigo'),
    metodos_vinculo: isMetodo(evento.metodos_vinculo) ? evento.metodos_vinculo : PARAMETROS_ACESSO_PADRAO.metodos_vinculo,
  };
};

export const validarParametrosAcesso = (parametros: ParametrosAcesso): string[] =>
  (Object.keys(LIMITES_ACESSO) as CampoNumerico[])
    .filter((campo) => {
      const { min, max } = LIMITES_ACESSO[campo];
      const valor = parametros[campo];
      return !Number.isInteger(valor) || valor < min || valor > max;
    })
    .map((campo) => {
      const { min, max, rotulo, unidade } = LIMITES_ACESSO[campo];
      return `${rotulo} deve ficar entre ${min} e ${max}${unidade ? ` ${unidade}` : ''}.`;
    });
