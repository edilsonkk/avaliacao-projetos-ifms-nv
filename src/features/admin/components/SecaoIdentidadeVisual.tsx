import React, { useRef, useState } from 'react';
import { ImageOff, Trash2 } from 'lucide-react';
import { Botao, useAvisos } from '@/components/ui';
import { useIdentidadeVisual } from '@/components/layout/IdentidadeVisual';
import {
  LIMITE_BYTES,
  enviarImagemIdentidade,
  removerImagemIdentidade,
  validarImagem,
  type TipoImagemIdentidade,
} from '@/lib/identidadeVisual';
import { tratarErroEscritaAdmin } from '@/lib/sessaoAdmin';

interface PropriedadesSecaoIdentidadeVisual {
  id_evento_ativo: string;
  /** Classe da caixa da seção, para combinar com as outras do modal. */
  className?: string;
  classeTitulo?: string;
}

interface PropriedadesCampoImagem {
  tipo: TipoImagemIdentidade;
  rotulo: string;
  ajuda: string;
  url: string | null;
  enviando: boolean;
  aoEscolher: (arquivo: File) => void;
  aoRemover: () => void;
  erro: string | null;
}

const CampoImagem: React.FC<PropriedadesCampoImagem> = ({ tipo, rotulo, ajuda, url, enviando, aoEscolher, aoRemover, erro }) => {
  const entrada = useRef<HTMLInputElement>(null);
  const idCampo = `identidade-${tipo}`;
  const idAjuda = `${idCampo}-ajuda`;
  const idErro = `${idCampo}-erro`;

  return (
    <div className="space-y-2">
      <label htmlFor={idCampo} className="block text-apoio font-bold text-texto">
        {rotulo}
      </label>
      <div className="flex items-center gap-3">
        <span className="h-14 w-14 shrink-0 rounded-controle border border-borda bg-superficie-alta flex items-center justify-center overflow-hidden">
          {url ? (
            <img src={url} alt={`Pré-visualização do ${rotulo.toLowerCase()}`} className="h-full w-full object-contain" />
          ) : (
            <ImageOff aria-hidden="true" className="w-5 h-5 text-texto-secundario" />
          )}
        </span>
        <input
          ref={entrada}
          id={idCampo}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          aria-describedby={erro ? `${idAjuda} ${idErro}` : idAjuda}
          aria-invalid={erro ? true : undefined}
          disabled={enviando}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) aoEscolher(arquivo);
            if (entrada.current) entrada.current.value = '';
          }}
          className="min-w-0 flex-1 text-apoio text-texto file:mr-3 file:min-h-11 file:px-4 file:rounded-controle file:border-0 file:bg-acao file:text-white file:font-bold file:cursor-pointer disabled:opacity-50"
        />
      </div>
      <p id={idAjuda} className="text-apoio text-texto-secundario">
        {ajuda}
      </p>
      {erro && (
        <p id={idErro} role="alert" className="text-apoio font-semibold text-perigo">
          {erro}
        </p>
      )}
      {url && (
        <Botao variante="fantasma" icone={<Trash2 className="w-4 h-4" />} onClick={aoRemover} disabled={enviando} className="text-perigo">
          Remover
        </Botao>
      )}
    </div>
  );
};

/**
 * Envio do ícone e da imagem do evento (engrenagem do Admin).
 *
 * O arquivo sobe para o bucket `identidade-visual` e o endereço é gravado no evento na
 * hora — não espera o "Salvar" do formulário, para a pré-visualização não mentir. Quem
 * pode gravar é a policy do banco (`is_admin()`); aqui só validamos antes de subir, para
 * a pessoa não esperar um envio que o banco vai recusar.
 */
export const SecaoIdentidadeVisual: React.FC<PropriedadesSecaoIdentidadeVisual> = ({
  id_evento_ativo,
  className,
  classeTitulo,
}) => {
  const { identidade, recarregar } = useIdentidadeVisual();
  const { avisar } = useAvisos();
  const [enviando, setEnviando] = useState<TipoImagemIdentidade | null>(null);
  const [erros, setErros] = useState<Partial<Record<TipoImagemIdentidade, string | null>>>({});

  const enviar = async (tipo: TipoImagemIdentidade, arquivo: File) => {
    const problema = validarImagem(tipo, arquivo);
    setErros((atual) => ({ ...atual, [tipo]: problema }));
    if (problema) return;

    setEnviando(tipo);
    try {
      await enviarImagemIdentidade(tipo, id_evento_ativo, arquivo);
      await recarregar();
      await avisar({
        tipo: 'sucesso',
        titulo: tipo === 'icone' ? 'Ícone atualizado' : 'Imagem do evento atualizada',
        mensagem: 'Já aparece nas telas. Se o navegador mostrar a imagem antiga, recarregue a página.',
      });
    } catch (e) {
      tratarErroEscritaAdmin(e);
      setErros((atual) => ({ ...atual, [tipo]: (e as Error).message }));
    } finally {
      setEnviando(null);
    }
  };

  const remover = async (tipo: TipoImagemIdentidade, url: string) => {
    setEnviando(tipo);
    try {
      await removerImagemIdentidade(tipo, id_evento_ativo, url);
      await recarregar();
    } catch (e) {
      tratarErroEscritaAdmin(e);
      setErros((atual) => ({ ...atual, [tipo]: (e as Error).message }));
    } finally {
      setEnviando(null);
    }
  };

  return (
    <section aria-labelledby="secao-identidade-visual" className={className}>
      <h3 id="secao-identidade-visual" className={classeTitulo}>
        Identidade Visual do Evento
      </h3>

      <div className="space-y-4">
        <CampoImagem
          tipo="icone"
          rotulo="Ícone do evento"
          ajuda={`Quadrado, PNG de 256px ou mais, até ${Math.round(LIMITE_BYTES.icone / 1024)} KB. Substitui o "IF" do cabeçalho e vira o ícone da aba e do atalho no celular.`}
          url={identidade.url_icone}
          enviando={enviando === 'icone'}
          aoEscolher={(arquivo) => void enviar('icone', arquivo)}
          aoRemover={() => identidade.url_icone && void remover('icone', identidade.url_icone)}
          erro={erros.icone ?? null}
        />

        <CampoImagem
          tipo="imagem"
          rotulo="Imagem do evento"
          ajuda={`Até 1600px de largura e ${Math.round(LIMITE_BYTES.imagem / 1024 / 1024)} MB. Aparece no login, no autocadastro, no Telão, nos relatórios impressos e no topo da tela do avaliador.`}
          url={identidade.url_imagem_evento}
          enviando={enviando === 'imagem'}
          aoEscolher={(arquivo) => void enviar('imagem', arquivo)}
          aoRemover={() => identidade.url_imagem_evento && void remover('imagem', identidade.url_imagem_evento)}
          erro={erros.imagem ?? null}
        />
      </div>
    </section>
  );
};
