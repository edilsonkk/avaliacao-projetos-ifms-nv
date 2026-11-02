import { supabase } from '@/lib/supabase';

/**
 * Identidade visual do evento: o ícone (que substitui o "IF" do cabeçalho e serve de
 * favicon) e a imagem do evento (login, autocadastro, Telão, relatórios e topo da tela
 * do avaliador). Os arquivos ficam no bucket público `identidade-visual`; o endereço
 * fica em `eventos.url_icone` e `eventos.url_imagem_evento`.
 *
 * Quem pode gravar é o banco que decide (policy com `is_admin()`), não esta camada.
 */

export const BUCKET_IDENTIDADE = 'identidade-visual';
/** Ícone de reserva, no repositório, para quando o evento não enviou o seu. */
export const ICONE_PADRAO = '/icone.svg';

export type TipoImagemIdentidade = 'icone' | 'imagem';

export interface IdentidadeVisual {
  id_evento: string | null;
  nome_evento: string | null;
  url_icone: string | null;
  url_imagem_evento: string | null;
}

export const IDENTIDADE_VAZIA: IdentidadeVisual = {
  id_evento: null,
  nome_evento: null,
  url_icone: null,
  url_imagem_evento: null,
};

const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Limite por tipo de imagem, em bytes. O ícone é pequeno de propósito. */
export const LIMITE_BYTES: Record<TipoImagemIdentidade, number> = {
  icone: 512 * 1024,
  imagem: 2 * 1024 * 1024,
};

const EXTENSOES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** Identidade do evento ativo. Função pública: funciona antes de existir sessão. */
export const lerIdentidadeVisual = async (): Promise<IdentidadeVisual> => {
  const { data, error } = await supabase.rpc('fn_identidade_visual');
  if (error) throw new Error(error.message || 'Não foi possível ler a identidade visual do evento.');
  return { ...IDENTIDADE_VAZIA, ...((data as IdentidadeVisual | null) ?? {}) };
};

/** Recusa o arquivo antes de subir, com a mensagem que vai aparecer no campo. */
export const validarImagem = (tipo: TipoImagemIdentidade, arquivo: File): string | null => {
  if (!TIPOS_ACEITOS.includes(arquivo.type)) {
    return 'Formato não aceito. Envie PNG, JPG, WEBP ou SVG.';
  }
  if (arquivo.size > LIMITE_BYTES[tipo]) {
    const limite = Math.round(LIMITE_BYTES[tipo] / 1024);
    return `Arquivo muito grande (máximo ${limite} KB).`;
  }
  return null;
};

const caminhoNoBucket = (tipo: TipoImagemIdentidade, idEvento: string, mime: string) =>
  `eventos/${idEvento}/${tipo}.${EXTENSOES[mime] ?? 'png'}`;

/**
 * Envia a imagem e grava o endereço no evento. O caminho é fixo por evento e por tipo
 * (`upsert`), então trocar a imagem não deixa arquivo órfão no bucket. A URL leva `?v=`
 * para o navegador não continuar mostrando a imagem antiga do cache.
 */
export const enviarImagemIdentidade = async (
  tipo: TipoImagemIdentidade,
  idEvento: string,
  arquivo: File,
): Promise<string> => {
  const problema = validarImagem(tipo, arquivo);
  if (problema) throw new Error(problema);

  const caminho = caminhoNoBucket(tipo, idEvento, arquivo.type);
  const { error: erroEnvio } = await supabase.storage
    .from(BUCKET_IDENTIDADE)
    .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type });
  if (erroEnvio) throw new Error(erroEnvio.message || 'Não foi possível enviar a imagem.');

  const { data } = supabase.storage.from(BUCKET_IDENTIDADE).getPublicUrl(caminho);
  const url = `${data.publicUrl}?v=${Date.now()}`;

  const coluna = tipo === 'icone' ? 'url_icone' : 'url_imagem_evento';
  const { error: erroEvento } = await supabase.from('eventos').update({ [coluna]: url }).eq('id_evento', idEvento);
  if (erroEvento) throw new Error(erroEvento.message || 'A imagem subiu, mas não foi possível gravá-la no evento.');

  return url;
};

/** Tira a imagem do evento e apaga o arquivo do bucket. */
export const removerImagemIdentidade = async (tipo: TipoImagemIdentidade, idEvento: string, url: string): Promise<void> => {
  const coluna = tipo === 'icone' ? 'url_icone' : 'url_imagem_evento';
  const { error: erroEvento } = await supabase.from('eventos').update({ [coluna]: null }).eq('id_evento', idEvento);
  if (erroEvento) throw new Error(erroEvento.message || 'Não foi possível tirar a imagem do evento.');

  const caminho = url.split(`${BUCKET_IDENTIDADE}/`)[1]?.split('?')[0];
  if (caminho) await supabase.storage.from(BUCKET_IDENTIDADE).remove([caminho]);
};

/**
 * Aponta o ícone da aba e o do atalho no celular para o ícone do evento.
 * Sem ícone enviado, volta para o do repositório.
 */
export const aplicarIconeDoNavegador = (url: string | null): void => {
  const destino = url || ICONE_PADRAO;
  for (const rel of ['icon', 'apple-touch-icon']) {
    let elemento = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!elemento) {
      elemento = document.createElement('link');
      elemento.rel = rel;
      document.head.appendChild(elemento);
    }
    elemento.href = destino;
  }
};
