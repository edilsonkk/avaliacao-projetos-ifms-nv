-- ==============================================================================
-- MIGRATION: 20261124220000_apagar_simulacao.sql
-- DESCRIÇÃO: apagar um evento de simulação vira uma função do banco, numa
--   transação só e com a origem marcada na trilha.
--
--   O problema, medido num banco local: apagar a simulação pelo cliente deixava
--   achados GRAVES falsos na conferência de notas. A cascata do `DELETE` em
--   `avaliacoes` e em `questionarios` dispara os gatilhos de auditoria de
--   `respostas_avaliacao` e `perguntas_questionario`, que gravam com
--   `origem = 'direto'` e `id_evento` nulo — e a regra C10 de `fn_auditar_notas`
--   ("nota alterada fora do fluxo") inclui `id_evento IS NULL`, logo o achado
--   aparece em TODOS os eventos, inclusive na feira real. Uma rodada de 31
--   avaliações deixou 141 achados permanentes, porque `log_auditoria` é
--   append-only e não dá para desfazer.
--
--   Marcar a origem resolve, mas `auditoria_marcar_origem` vale só dentro da
--   transação, e pelo PostgREST cada chamada é uma transação própria — marcar numa
--   requisição e apagar na seguinte não tem efeito. Daí a função.
--
--   `admin_reset_global` NÃO serve para isto: o passo 13 dela apaga `usuarios` com
--   papel AVALIADOR ou STAFF em toda a base, sem filtrar por evento, preservando só
--   quem já tem nota. Em produção levaria avaliadores reais ainda sem avaliação.
--
--   Guardas, antes de qualquer escrita: só Admin; o evento tem de existir, ter o
--   prefixo de simulação e NÃO estar ativo (apagar o ativo deixaria a instalação
--   sem evento). A ordem segue o que as chaves estrangeiras impõem, porque
--   `avaliacoes.id_projeto` e `avaliacoes.id_usuario` são ON DELETE RESTRICT:
--   avaliações, depois o evento (que cascateia o resto), depois as pessoas que só
--   existiam na simulação.
-- FRONT-END: compatível com a versão anterior (função nova, nada removido).
-- PRÉ-REQUISITOS: public.is_admin() (20261026000000),
--   public.auditoria_marcar_origem() (20261106010000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_apagar_simulacao(p_id_evento uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefixo       text := 'Simulação de Carga';
  v_dominio       text := '%@simulacao.invalid';
  v_nome          text;
  v_ativo         boolean;
  v_avaliacoes    integer := 0;
  v_usuarios      integer := 0;
  v_preservados   integer := 0;
BEGIN
  -- Marca a origem ANTES de qualquer escrita: é o que impede a trilha de registrar
  -- esta limpeza como "escrita fora do fluxo" e sujar a auditoria dos outros eventos.
  PERFORM public.auditoria_marcar_origem('admin_apagar_simulacao', 'limpeza da simulação de evento');

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT nome_evento, coalesce(is_ativo, false) INTO v_nome, v_ativo
  FROM public.eventos WHERE id_evento = p_id_evento FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado: nada foi apagado.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_nome IS NULL OR left(v_nome, length(v_prefixo)) IS DISTINCT FROM v_prefixo THEN
    RAISE EXCEPTION '"%" não é um evento de simulação. Nada foi apagado.', v_nome
      USING ERRCODE = '22023';
  END IF;

  IF v_ativo THEN
    RAISE EXCEPTION 'Esta simulação ainda é o evento ativo. Encerre-a primeiro. Nada foi apagado.'
      USING ERRCODE = '22023';
  END IF;

  -- Quem nasceu nesta simulação, lido antes de o vínculo sumir junto com o evento.
  CREATE TEMP TABLE candidatos_simulacao ON COMMIT DROP AS
  SELECT DISTINCT ae.id_usuario
  FROM public.avaliadores_evento ae
  JOIN public.usuarios u ON u.id_usuario = ae.id_usuario
  WHERE ae.id_evento = p_id_evento AND u.email LIKE v_dominio;

  -- 1. Avaliações do evento. ON DELETE RESTRICT obriga a vir antes do evento;
  --    `respostas_avaliacao` cai por cascata, agora com a origem marcada.
  WITH apagadas AS (
    DELETE FROM public.avaliacoes a
    USING public.projetos p
    WHERE a.id_projeto = p.id_projeto AND p.id_evento = p_id_evento
    RETURNING a.id_avaliacao
  )
  SELECT count(*) INTO v_avaliacoes FROM apagadas;

  -- 2. O evento. A cascata leva projetos, questionários, perguntas, catálogos,
  --    inscrições, travas, impedimentos, fila, aparelhos e códigos.
  DELETE FROM public.eventos WHERE id_evento = p_id_evento;

  -- 3. As pessoas que só existiam na simulação. Fica quem ainda tem vínculo em
  --    outro evento ou nota em qualquer lugar — apagá-la levaria a avaliação junto.
  SELECT count(*) INTO v_preservados
  FROM candidatos_simulacao c
  WHERE EXISTS (SELECT 1 FROM public.avaliadores_evento ae WHERE ae.id_usuario = c.id_usuario)
     OR EXISTS (SELECT 1 FROM public.avaliacoes a WHERE a.id_usuario = c.id_usuario);

  WITH removidos AS (
    DELETE FROM public.usuarios u
    WHERE u.id_usuario IN (SELECT id_usuario FROM candidatos_simulacao)
      AND u.email LIKE v_dominio
      AND upper(coalesce(u.papel::text, '')) IN ('AVALIADOR', 'STAFF', 'MONITOR')
      AND NOT EXISTS (SELECT 1 FROM public.avaliadores_evento ae WHERE ae.id_usuario = u.id_usuario)
      AND NOT EXISTS (SELECT 1 FROM public.avaliacoes a WHERE a.id_usuario = u.id_usuario)
    RETURNING u.id_usuario
  )
  SELECT count(*) INTO v_usuarios FROM removidos;

  RETURN jsonb_build_object(
    'ok', true,
    'nome_evento', v_nome,
    'avaliacoes_apagadas', v_avaliacoes,
    'eventos_apagados', 1,
    'usuarios_apagados', v_usuarios,
    'usuarios_preservados', v_preservados
  );
END;
$$;

COMMENT ON FUNCTION public.admin_apagar_simulacao(uuid) IS
  'Apaga um evento de simulação (prefixo "Simulação de Carga") e as pessoas que só existiam nele, numa transação e com a origem marcada na trilha — sem isso a cascata vira achado grave C10 em todos os eventos. Recusa evento ativo ou que não seja de simulação. Só Admin.';

ALTER FUNCTION public.admin_apagar_simulacao(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_apagar_simulacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apagar_simulacao(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
