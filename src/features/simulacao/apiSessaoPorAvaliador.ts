import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { configuracao_supabase, supabase } from '@/lib/supabase';
import { traduzirErroEscritaAdmin } from '@/lib/sessaoAdmin';
import { buscarTodas } from '@/lib/buscarTodas';
import type { AvaliadorDoPlano } from '@/lib/simulacao/plano';
import type { PonteSimulacao, QuestionarioResolvido } from '@/lib/simulacao/motor';

/**
 * Ponte do modo FIEL: uma sessão por avaliador, como num celular de verdade.
 *
 * Aqui o sorteio e o envio NÃO usam a isenção de `is_admin()`: cada avaliador abre a própria
 * sessão anônima, pede o código, é pareado pela coordenação e passa a ser reconhecido por
 * `avaliador_atual()`. É o credenciamento real da portaria, e é o único modo que exercita
 * esse caminho.
 *
 * POR QUE SÓ NO BANCO LOCAL. Cada `signInAnonymously` cria uma linha permanente em
 * `auth.users`, e nenhuma função do projeto apaga `auth.users` — só a chave de serviço, que
 * por desenho não existe no navegador. Em local, `npx supabase db reset` zera tudo; em
 * produção o lixo seria permanente. Há ainda o limite de sign-ins anônimos por IP (em
 * `supabase/config.toml`, 300/hora no local), e aqui todos os "aparelhos" saem do mesmo IP.
 * `validarParametros` recusa este modo fora do local.
 *
 * EXCEÇÃO CONSCIENTE à regra 5 de docs/arquitetura/frontend.md ("não crie outros clientes"):
 * sessões distintas exigem clientes distintos. Eles usam `persistSession: false` para não
 * encostar no `localStorage` nem derrubar a sessão do Admin, e são descartados no fim.
 * Registrada em docs/decisoes/0021-*.
 */

interface SessaoDeAvaliador {
  cliente: SupabaseClient;
}

const mensagem = (erro: unknown): string =>
  (erro as { message?: string } | null)?.message ?? String(erro);

export const criarPonteSessaoPorAvaliador = (): PonteSimulacao & { encerrarSessoes: () => Promise<void> } => {
  const sessoes = new Map<string, SessaoDeAvaliador>();

  if (!configuracao_supabase.valida) {
    throw new Error('Supabase não configurado: o modo "sessão por avaliador" não pode rodar.');
  }
  const { url, chaveAnonima } = configuracao_supabase;

  const clienteDe = (idUsuario: string): SupabaseClient => {
    const sessao = sessoes.get(idUsuario);
    if (!sessao) {
      throw new Error('Aparelho deste avaliador não foi preparado: pareamento não aconteceu.');
    }
    return sessao.cliente;
  };

  return {
    /** Sessão anônima + pedido de código + pareamento pela coordenação, uma vez por avaliador. */
    prepararAvaliador: async (avaliador: AvaliadorDoPlano) => {
      const cliente = createClient(url, chaveAnonima, {
        auth: {
          // Sem persistência: nada vai para o localStorage, e a sessão do Admin fica intacta.
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      const { error: erroSessao } = await cliente.auth.signInAnonymously();
      if (erroSessao) {
        throw new Error(
          `Não foi possível abrir a sessão do aparelho: ${mensagem(erroSessao)}. ` +
          'Em rodadas grandes isso costuma ser o limite de sessões anônimas por IP.',
        );
      }

      const { data: pedido, error: erroPedido } = await cliente.rpc('fn_solicitar_pareamento');
      if (erroPedido) throw new Error(`Não foi possível pedir o pareamento: ${mensagem(erroPedido)}`);
      const codigo = (pedido as { codigo?: string } | null)?.codigo;
      if (!codigo) throw new Error('O pedido de pareamento não devolveu código.');

      // A coordenação pareia: é o Admin desta sessão fazendo o papel do staff na portaria.
      const { error: erroPareamento } = await supabase.rpc('fn_parear_dispositivo', {
        p_codigo: codigo,
        p_id_usuario: avaliador.id_usuario,
      });
      if (erroPareamento) {
        throw new Error(`Não foi possível parear o aparelho: ${traduzirErroEscritaAdmin(erroPareamento)}`);
      }

      // O papel vem do BANCO, não de palpite: se o pareamento não pegou, paramos aqui.
      const { data: perfil, error: erroPerfil } = await cliente.rpc('fn_meu_perfil');
      if (erroPerfil) throw new Error(`Não foi possível ler o perfil do aparelho: ${mensagem(erroPerfil)}`);
      const papel = (perfil as { papel?: string } | null)?.papel;
      if (papel !== 'avaliador') {
        throw new Error(`O aparelho não virou avaliador depois do pareamento (papel: ${papel ?? 'nenhum'}).`);
      }

      sessoes.set(avaliador.id_usuario, { cliente });
    },

    // O check-in continua sendo da coordenação, que é quem tem esse direito no banco.
    checkIn: async (idProjeto) => {
      const { error } = await supabase.rpc('fn_check_in_projeto', {
        p_id_projeto: idProjeto,
        p_check_in: true,
      });
      if (error) throw new Error(traduzirErroEscritaAdmin(error));
    },

    sortear: async (idUsuario, idEvento) => {
      const { data, error } = await clienteDe(idUsuario).rpc('sortear_proximo_projeto', {
        p_id_usuario: idUsuario,
        p_id_evento: idEvento,
      });
      if (error) throw new Error(mensagem(error));
      if (data && typeof data === 'object') {
        return (Object.values(data as Record<string, unknown>)[0] as string) ?? null;
      }
      return (data as string | null) ?? null;
    },

    lerProjeto: async (idProjeto) => {
      const { data, error } = await supabase
        .from('projetos')
        .select('id_questionario_fixado')
        .eq('id_projeto', idProjeto)
        .maybeSingle();
      if (error) throw new Error(mensagem(error));
      return { idQuestionarioFixado: data?.id_questionario_fixado ?? null };
    },

    lerQuestionario: async (idQuestionario): Promise<QuestionarioResolvido> => {
      const { data, error } = await supabase
        .from('questionarios')
        .select('id_questionario, escala_minima, escala_maxima, is_voto_popular')
        .eq('id_questionario', idQuestionario)
        .maybeSingle();
      if (error) throw new Error(mensagem(error));
      if (!data) throw new Error('Questionário não encontrado.');

      const perguntas = await buscarTodas<{ id_pergunta: string }>(() =>
        supabase
          .from('perguntas_questionario')
          .select('id_pergunta')
          .eq('id_questionario', idQuestionario)
          .order('ordem', { ascending: true }),
      );

      return {
        id_questionario: data.id_questionario,
        escala_minima: Number(data.escala_minima),
        escala_maxima: Number(data.escala_maxima),
        is_voto_popular: data.is_voto_popular === true,
        idsPerguntas: perguntas.map((pergunta) => pergunta.id_pergunta),
      };
    },

    /** O envio sai da sessão do PRÓPRIO avaliador: é o caminho que o celular percorre. */
    enviar: async (entrada) => {
      const { error } = await clienteDe(entrada.idUsuario).rpc('fn_enviar_avaliacao', {
        p_id_usuario: entrada.idUsuario,
        p_id_projeto: entrada.idProjeto,
        p_id_questionario: entrada.idQuestionario,
        p_respostas: entrada.respostas,
        p_parecer: entrada.parecer,
        p_tempo_presenca: null,
      });
      if (error) throw new Error(mensagem(error));
    },

    /** Fecha as sessões anônimas no fim da rodada. As contas em `auth.users` permanecem. */
    encerrarSessoes: async () => {
      for (const { cliente } of sessoes.values()) {
        try {
          await cliente.auth.signOut({ scope: 'local' });
        } catch {
          // Encerrar sessão é limpeza: falha aqui não deve derrubar o fim da rodada.
        }
      }
      sessoes.clear();
    },
  };
};
