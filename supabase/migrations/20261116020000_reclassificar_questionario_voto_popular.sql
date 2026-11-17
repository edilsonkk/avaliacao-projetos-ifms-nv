-- ==============================================================================
-- MIGRATION: 20261116020000_reclassificar_questionario_voto_popular.sql
-- DESCRIÇÃO: dois defeitos no caminho da marca de voto popular.
--
--   (1) A RECUSA VINHA DISFARÇADA DE SESSÃO EXPIRADA.
--   `admin_marcar_questionario_voto_popular` recusa trocar a marca de um
--   questionário que já tem avaliação — regra certa, porque reclassificar nota já
--   lançada muda média publicada. Mas a recusa era levantada com ERRCODE 42501, e
--   `isErroPermissaoRls()` no front trata 42501 como falha de permissão: a
--   mensagem real ("já foi usado em N avaliação(ões)") era substituída por
--   "Sessão de administrador expirada. Faça login novamente", e o evento de sessão
--   expirada era disparado. Quem marcava a caixa via a tela pedir um login que não
--   resolvia nada, e a caixa voltava desmarcada sem explicação.
--   Agora a regra de negócio usa P0001; 42501 fica só para acesso negado.
--
--   (2) NÃO HAVIA COMO CORRIGIR UMA MARCA ERRADA.
--   Se o questionário de voto popular nasceu sem a marca, os votos dados com ele
--   entram como nota técnica (o gatilho copia a marca do questionário na gravação).
--   Resultado: o relatório "Voto Popular" fica vazio e os votos inflam a média
--   técnica, a cota e os contadores do Telão. E a correção ficava impossível: a
--   marca não podia mudar porque já havia avaliações, e as avaliações só mudariam
--   se a marca mudasse.
--   `admin_reclassificar_questionario_voto_popular` quebra esse laço: troca a marca
--   do questionário E reclassifica as avaliações dele na mesma transação, com as
--   contagens na trilha. É operação de correção, explícita e auditada — não um
--   caminho silencioso.
-- FRONT-END: compatível com a versão anterior (função nova; a outra só muda ERRCODE).
-- PRÉ-REQUISITOS: public.is_admin(), public.fn_avaliacoes_do_questionario()
--   (20261031050000), public.auditoria_registrar() (20261106010000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. A recusa passa a ser regra de negócio (P0001), não permissão (42501)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_marcar_questionario_voto_popular(
  p_id_questionario uuid,
  p_is_voto_popular boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_atual boolean;
  v_usos  integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT is_voto_popular INTO v_atual
  FROM public.questionarios WHERE id_questionario = p_id_questionario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionário não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_atual IS DISTINCT FROM coalesce(p_is_voto_popular, false) THEN
    v_usos := public.fn_avaliacoes_do_questionario(p_id_questionario);
    IF v_usos > 0 THEN
      -- P0001, e não 42501: isto não é falta de permissão. Com 42501 o front
      -- traduzia a recusa como "sessão expirada" e escondia o motivo real.
      RAISE EXCEPTION 'Este questionário já foi usado em % avaliação(ões): mudar a marca de voto popular agora reclassificaria notas já lançadas e alteraria médias publicadas. Use a reclassificação do questionário, que troca a marca e as avaliações juntas e fica registrada na trilha.', v_usos
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM public.auditoria_marcar_origem('admin_marcar_questionario_voto_popular', NULL);
  UPDATE public.questionarios
     SET is_voto_popular = coalesce(p_is_voto_popular, false)
   WHERE id_questionario = p_id_questionario;
END;
$$;

ALTER FUNCTION public.admin_marcar_questionario_voto_popular(uuid, boolean) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 2. Correção explícita: marca do questionário + avaliações dele, numa transação
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reclassificar_questionario_voto_popular(
  p_id_questionario uuid,
  p_is_voto_popular boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_destino    boolean := coalesce(p_is_voto_popular, false);
  v_quest      public.questionarios;
  v_avaliacoes integer := 0;
  v_travas     integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_quest FROM public.questionarios
   WHERE id_questionario = p_id_questionario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionário não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_quest.is_voto_popular IS NOT DISTINCT FROM v_destino THEN
    RAISE EXCEPTION 'O questionário já está marcado assim: nada a reclassificar.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.auditoria_marcar_origem(
    'admin_reclassificar_questionario_voto_popular',
    'Correção da marca de voto popular do questionário e das avaliações já lançadas com ele.'
  );

  UPDATE public.questionarios
     SET is_voto_popular = v_destino
   WHERE id_questionario = p_id_questionario;

  -- As avaliações seguem a marca do questionário que as produziu. A trigger
  -- trg_avaliacao_classificar_voto_popular dispara em INSERT e em UPDATE OF
  -- id_questionario, então este UPDATE não é sobrescrito por ela.
  UPDATE public.avaliacoes a
     SET is_voto_popular = v_destino
   WHERE a.id_questionario = p_id_questionario
     AND a.is_voto_popular IS DISTINCT FROM v_destino;
  GET DIAGNOSTICS v_avaliacoes = ROW_COUNT;

  -- Travas em aberto do mesmo questionário acompanham, senão uma reserva de votante
  -- continuaria ocupando vaga técnica (ou o contrário) até vencer.
  UPDATE public.locks_ativos l
     SET is_voto_popular = v_destino
   WHERE l.is_voto_popular IS DISTINCT FROM v_destino
     AND EXISTS (
       SELECT 1 FROM public.avaliadores_evento ae
        WHERE ae.id_usuario = l.id_usuario
          AND ae.id_evento = v_quest.id_evento
          AND ae.id_questionario = p_id_questionario
     );
  GET DIAGNOSTICS v_travas = ROW_COUNT;

  PERFORM public.auditoria_registrar(
    'questionario_voto_popular_reclassificado',
    'questionarios',
    v_quest.id_evento,
    jsonb_build_object(
      'id_questionario', p_id_questionario,
      'titulo', v_quest.titulo,
      'de', v_quest.is_voto_popular,
      'para', v_destino,
      'avaliacoes_reclassificadas', v_avaliacoes,
      'travas_reclassificadas', v_travas
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id_questionario', p_id_questionario,
    'is_voto_popular', v_destino,
    'avaliacoes_reclassificadas', v_avaliacoes,
    'travas_reclassificadas', v_travas
  );
END;
$$;

COMMENT ON FUNCTION public.admin_reclassificar_questionario_voto_popular(uuid, boolean) IS
  'Corrige a marca de voto popular de um questionário E das avaliações já lançadas com ele, numa transação, registrando as contagens na trilha. Existe porque a marca errada na criação prendia o conserto: a marca não mudava por haver avaliações, e as avaliações só mudavam com a marca.';

ALTER FUNCTION public.admin_reclassificar_questionario_voto_popular(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_reclassificar_questionario_voto_popular(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reclassificar_questionario_voto_popular(uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
