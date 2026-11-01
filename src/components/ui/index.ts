/** API pública dos componentes de interface. As features importam só por `@/components/ui`. */
export { cn, type ValorClasse } from './cn';
export { Botao, type PropriedadesBotao, type VarianteBotao, type TamanhoBotao } from './Botao';
export {
  Campo,
  CampoArea,
  CampoSelecao,
  type PropriedadesCampo,
  type PropriedadesCampoArea,
  type PropriedadesCampoSelecao,
} from './Campo';
export { Cartao } from './Cartao';
export { Selo, type TomSelo } from './Selo';
export { Estado, type SituacaoEstado } from './Estado';
export { Modal, type TamanhoModal } from './Modal';
export { Aviso, type TipoAviso } from './Aviso';
export { ConfirmacaoPerigo } from './ConfirmacaoPerigo';
export { ProvedorAvisos, useAvisos, type ApiAvisos, type TipoNotificacao } from './Avisos';
export { Abas, PainelAba, idPainelAba, type DefinicaoAba } from './Abas';
export { Dica } from './Dica';
export { CabecalhoOrdenavel, compararNatural } from './CabecalhoOrdenavel';
