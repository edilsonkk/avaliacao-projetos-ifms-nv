-- ==============================================================================
-- MIGRATION: 20261116010000_finalizar_evento.sql
-- DESCRIÇÃO: encerrar a feira passa a ser uma ação própria, e não um efeito de
--   desmarcar "Sistema liberado para avaliadores".
--
--   O problema: `eventos.sistema_liberado` servia para as duas coisas — a própria
--   dica do campo dizia "use para pausar ou encerrar a feira". Encerrar de verdade
--   exige soltar os avaliadores (revogar o vínculo do celular e apagar as travas),
--   mas fazer isso ao desmarcar o campo tornaria qualquer **pausa** destrutiva: o
--   avaliador só voltaria com o Staff pareando todo mundo de novo.
--
--   `admin_finalizar_evento(p_id_evento)` faz o encerramento numa transação:
--     1. sistema_liberado = false (ninguém sorteia nem envia nota nova);
--     2. apaga as travas do evento (avaliação em andamento é devolvida);
--     3. revoga o vínculo de celular dos avaliadores do evento;
--     4. queima os códigos de acesso pendentes do evento;
--     5. registra na trilha quantas travas e quantos aparelhos foram soltos.
--
--   **Não** desativa o evento (`is_ativo` segue true): Relatórios, Classificação,
--   Auditoria, Telão e Mapa de Estandes leem o evento ativo, e é justamente deles
--   que a comissão precisa depois do encerramento, na homologação e na premiação.
--
--   Não há agendador no projeto (nenhum pg_cron), então não existe encerramento
--   "por tempo": a janela por horário (`fn_janela_avaliacao_aberta`) continua como
--   está, e o encerramento é sempre um ato explícito do Admin.
-- FRONT-END: compatível com a versão anterior (função nova, nada removido).
-- PRÉ-REQUISITOS: public.is_admin() (20261026000000),
--   public.auditoria_registrar()/auditoria_marcar_origem() (20261106010000),
--   public.dispositivos_avaliador e public.codigos_acesso (20261028210000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_finalizar_evento(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_evento uuid;
  v_travas integer := 0;
  v_aparelhos integer := 0;
  v_codigos integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  -- Recusa rodar sem evento definido: sem isto, um p_id_evento nulo somado a um
  -- WHERE frouxo encerraria a feira errada (foi o que aconteceu no reset global).
  v_id_evento := coalesce(p_id_evento, public.evento_ativo_id());
  IF v_id_evento IS NULL THEN
    RAISE EXCEPTION 'Nenhum evento informado nem evento ativo: nada a finalizar.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos e WHERE e.id_evento = v_id_evento) THEN
    RAISE EXCEPTION 'Evento % não existe.', v_id_evento USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.auditoria_marcar_origem('admin_finalizar_evento');

  -- 1. Fecha o sistema para os avaliadores (a trigger auditar_eventos registra a mudança)
  UPDATE public.eventos
     SET sistema_liberado = false
   WHERE id_evento = v_id_evento;

  -- 2. Travas do evento. Só as dos projetos deste evento (regra 5: escopo por evento);
  --    o id_projeto é a única ligação de locks_ativos com o evento.
  DELETE FROM public.locks_ativos l
   WHERE l.id_projeto IN (SELECT p.id_projeto FROM public.projetos p WHERE p.id_evento = v_id_evento);
  GET DIAGNOSTICS v_travas = ROW_COUNT;

  -- 3. Vínculo do celular. O avaliador cai para o login e, para voltar, o Staff
  --    (ou o Admin) pareia de novo — é o que "finalizar" significa na prática.
  UPDATE public.dispositivos_avaliador
     SET revogado_em = now()
   WHERE id_evento = v_id_evento
     AND revogado_em IS NULL;
  GET DIAGNOSTICS v_aparelhos = ROW_COUNT;

  -- 4. Código de acesso pendente não deve sobreviver ao encerramento. Filtra pela
  --    coluna de evento da própria tabela (regra 5), não pela inscrição do avaliador.
  UPDATE public.codigos_acesso c
     SET usado_em = now()
   WHERE c.id_evento = v_id_evento
     AND c.usado_em IS NULL;
  GET DIAGNOSTICS v_codigos = ROW_COUNT;

  -- 5. Uma linha de resumo na trilha, como o reset global faz
  PERFORM public.auditoria_registrar(
    'evento_finalizado',
    'eventos',
    v_id_evento,
    jsonb_build_object(
      'travas_liberadas', v_travas,
      'aparelhos_desvinculados', v_aparelhos,
      'codigos_invalidados', v_codigos
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id_evento', v_id_evento,
    'travas_liberadas', v_travas,
    'aparelhos_desvinculados', v_aparelhos,
    'codigos_invalidados', v_codigos
  );
END;
$$;

COMMENT ON FUNCTION public.admin_finalizar_evento(uuid) IS
  'Encerra a feira do evento: fecha o sistema para avaliadores, apaga as travas, revoga os celulares e queima os códigos pendentes. Mantém o evento ativo, porque os relatórios e a premiação leem o evento ativo.';

ALTER FUNCTION public.admin_finalizar_evento(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_finalizar_evento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_finalizar_evento(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
