-- ==============================================================================
-- MIGRATION: 20261030000000_gestor_avaliadores.sql
-- DESCRIÇÃO: escritas do Gestor de Avaliadores passam por funções do banco.
--   * "Excluir avaliador" apagava a linha de usuarios. Como avaliacoes, travas,
--     fila etc. têm FK ON DELETE CASCADE, um clique (sem confirmação) apagava
--     TODAS as notas da pessoa em TODOS os eventos.
--     admin_remover_avaliador_evento tira a pessoa só do evento e recusa se ela
--     já tem avaliação no evento (aí o certo é descredenciar).
--   * Cadastro manual e importação faziam upsert em usuarios por e-mail com
--     papel = 'AVALIADOR': uma planilha com o e-mail do Admin ou de um Staff
--     rebaixava a conta. admin_salvar_avaliadores ignora (e informa) e-mails de
--     Admin/Staff e grava tudo numa transação.
--   * A edição apagava e regravava bloqueios/áreas em vários passos, ignorando
--     erros. admin_atualizar_avaliador faz tudo de uma vez.
--   * Bloquear uma modalidade tira as travas e a fila do avaliador nos projetos
--     dessa modalidade (antes era feito pelo navegador, ignorando erros).
-- FRONT-END: compatível com a versão anterior (só funções novas).
-- PRÉ-REQUISITO: public.is_admin() (20261026000000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Interna: tira travas e fila do avaliador em projetos de modalidades bloqueadas
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_expurgar_modalidades_bloqueadas(p_id_usuario uuid, p_id_evento uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH projetos_bloqueados AS (
    SELECT p.id_projeto
    FROM public.projetos p
    JOIN public.avaliador_modalidades_bloqueadas b
      ON b.id_modalidade = p.id_modalidade AND b.id_usuario = p_id_usuario AND b.id_evento = p_id_evento
    WHERE p.id_evento = p_id_evento
  ), travas AS (
    DELETE FROM public.locks_ativos l
    WHERE l.id_usuario = p_id_usuario AND l.id_projeto IN (SELECT id_projeto FROM projetos_bloqueados)
  )
  DELETE FROM public.fila_atribuicoes_direcionadas f
  WHERE f.id_usuario = p_id_usuario AND f.id_projeto IN (SELECT id_projeto FROM projetos_bloqueados);
$$;

REVOKE ALL ON FUNCTION public.fn_expurgar_modalidades_bloqueadas(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Cadastro manual e importação
--   p_itens: [{nome, email, id_instituicao?, ids_modalidades_bloqueadas?, ids_areas?}]
--   Retorna {cadastrados, atualizados, ignorados: [{email, motivo}]}
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_avaliadores(p_id_evento uuid, p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item        jsonb;
  v_nome        text;
  v_email       text;
  v_inst        uuid;
  v_usuario     public.usuarios;
  v_cadastrados integer := 0;
  v_atualizados integer := 0;
  v_ignorados   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de avaliadores inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_nome  := btrim(regexp_replace(coalesce(v_item->>'nome', ''), '\s+', ' ', 'g'));
    v_email := lower(btrim(coalesce(v_item->>'email', '')));

    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
      v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', 'E-mail inválido.');
      CONTINUE;
    END IF;

    SELECT * INTO v_usuario FROM public.usuarios WHERE lower(email) = v_email ORDER BY created_at LIMIT 1;

    IF v_usuario.id_usuario IS NOT NULL AND upper(coalesce(v_usuario.papel, '')) <> 'AVALIADOR' THEN
      v_ignorados := v_ignorados || jsonb_build_object(
        'email', v_email,
        'motivo', format('O e-mail pertence a um usuário %s; ele não foi alterado.', upper(v_usuario.papel)));
      CONTINUE;
    END IF;

    IF v_usuario.id_usuario IS NULL THEN
      IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
        v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', 'Nome ausente ou muito longo.');
        CONTINUE;
      END IF;
      INSERT INTO public.usuarios (email, nome, papel) VALUES (v_email, v_nome, 'AVALIADOR')
      RETURNING * INTO v_usuario;
      v_cadastrados := v_cadastrados + 1;
    ELSE
      IF length(v_nome) BETWEEN 2 AND 255 AND v_nome <> v_usuario.nome THEN
        UPDATE public.usuarios SET nome = v_nome WHERE id_usuario = v_usuario.id_usuario;
      END IF;
      v_atualizados := v_atualizados + 1;
    END IF;

    -- Instituição só vale se for do evento
    v_inst := NULL;
    IF nullif(v_item->>'id_instituicao', '') IS NOT NULL THEN
      SELECT id_instituicao INTO v_inst FROM public.instituicoes
      WHERE id_instituicao = (v_item->>'id_instituicao')::uuid AND id_evento = p_id_evento;
    END IF;

    INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado)
    VALUES (v_usuario.id_usuario, p_id_evento, v_inst, false)
    ON CONFLICT (id_usuario, id_evento)
    DO UPDATE SET id_instituicao = coalesce(EXCLUDED.id_instituicao, avaliadores_evento.id_instituicao);

    INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade)
    SELECT v_usuario.id_usuario, p_id_evento, m.id_modalidade
    FROM public.modalidades m
    WHERE m.id_evento = p_id_evento
      AND m.id_modalidade::text IN (SELECT jsonb_array_elements_text(coalesce(v_item->'ids_modalidades_bloqueadas', '[]'::jsonb)))
    ON CONFLICT DO NOTHING;

    INSERT INTO public.avaliador_areas (id_usuario, id_evento, id_area)
    SELECT v_usuario.id_usuario, p_id_evento, a.id_area
    FROM public.areas_tematicas a
    WHERE a.id_evento = p_id_evento
      AND a.id_area::text IN (SELECT jsonb_array_elements_text(coalesce(v_item->'ids_areas', '[]'::jsonb)))
    ON CONFLICT DO NOTHING;

    PERFORM public.fn_expurgar_modalidades_bloqueadas(v_usuario.id_usuario, p_id_evento);
  END LOOP;

  RETURN jsonb_build_object('cadastrados', v_cadastrados, 'atualizados', v_atualizados, 'ignorados', v_ignorados);
END;
$$;

-- ------------------------------------------------------------------------------
-- Edição (substitui instituição, bloqueios e áreas no evento)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_atualizar_avaliador(
  p_id_usuario uuid,
  p_id_evento uuid,
  p_nome text,
  p_email text,
  p_id_instituicao uuid,
  p_ids_modalidades_bloqueadas uuid[],
  p_ids_areas uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nome  text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_papel text;
  v_inst  uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT papel INTO v_papel FROM public.usuarios WHERE id_usuario = p_id_usuario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliador não encontrado.';
  END IF;
  IF upper(coalesce(v_papel, '')) <> 'AVALIADOR' THEN
    RAISE EXCEPTION 'Este usuário não é avaliador.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;
  IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
    RAISE EXCEPTION 'Informe o nome do avaliador.';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.usuarios WHERE lower(email) = v_email AND id_usuario <> p_id_usuario) THEN
    RAISE EXCEPTION 'Já existe outro usuário com o e-mail %.', v_email;
  END IF;

  UPDATE public.usuarios SET nome = v_nome, email = v_email WHERE id_usuario = p_id_usuario;

  SELECT id_instituicao INTO v_inst FROM public.instituicoes
  WHERE id_instituicao = p_id_instituicao AND id_evento = p_id_evento;

  INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado)
  VALUES (p_id_usuario, p_id_evento, v_inst, false)
  ON CONFLICT (id_usuario, id_evento) DO UPDATE SET id_instituicao = EXCLUDED.id_instituicao;

  DELETE FROM public.avaliador_modalidades_bloqueadas
  WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento
    AND id_modalidade <> ALL (coalesce(p_ids_modalidades_bloqueadas, '{}'));
  INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade)
  SELECT p_id_usuario, p_id_evento, m.id_modalidade
  FROM public.modalidades m
  WHERE m.id_evento = p_id_evento AND m.id_modalidade = ANY (coalesce(p_ids_modalidades_bloqueadas, '{}'))
  ON CONFLICT DO NOTHING;

  DELETE FROM public.avaliador_areas
  WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento
    AND id_area <> ALL (coalesce(p_ids_areas, '{}'));
  INSERT INTO public.avaliador_areas (id_usuario, id_evento, id_area)
  SELECT p_id_usuario, p_id_evento, a.id_area
  FROM public.areas_tematicas a
  WHERE a.id_evento = p_id_evento AND a.id_area = ANY (coalesce(p_ids_areas, '{}'))
  ON CONFLICT DO NOTHING;

  PERFORM public.fn_expurgar_modalidades_bloqueadas(p_id_usuario, p_id_evento);
END;
$$;

-- ------------------------------------------------------------------------------
-- Chip de modalidade (bloquear/liberar na hora)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_bloquear_modalidade_avaliador(
  p_id_usuario uuid,
  p_id_evento uuid,
  p_id_modalidade uuid,
  p_bloquear boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modalidades WHERE id_modalidade = p_id_modalidade AND id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Modalidade não encontrada neste evento.';
  END IF;

  IF p_bloquear THEN
    INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade)
    VALUES (p_id_usuario, p_id_evento, p_id_modalidade)
    ON CONFLICT DO NOTHING;
    PERFORM public.fn_expurgar_modalidades_bloqueadas(p_id_usuario, p_id_evento);
  ELSE
    DELETE FROM public.avaliador_modalidades_bloqueadas
    WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento AND id_modalidade = p_id_modalidade;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- Remover do evento (substitui o DELETE em usuarios)
--   Recusa se houver avaliação (não cancelada) dele no evento.
--   Só apaga o cadastro quando ele não tem mais nenhum evento nem avaliação.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_remover_avaliador_evento(p_id_usuario uuid, p_id_evento uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_papel     text;
  v_avaliacoes integer;
  v_apagou    boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT papel INTO v_papel FROM public.usuarios WHERE id_usuario = p_id_usuario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliador não encontrado.';
  END IF;
  IF upper(coalesce(v_papel, '')) <> 'AVALIADOR' THEN
    RAISE EXCEPTION 'Este usuário não é avaliador.';
  END IF;

  SELECT count(*) INTO v_avaliacoes
  FROM public.avaliacoes a JOIN public.projetos p ON p.id_projeto = a.id_projeto
  WHERE a.id_usuario = p_id_usuario AND p.id_evento = p_id_evento
    AND (a.status IS NULL OR a.status::text <> 'CANCELADA');
  IF v_avaliacoes > 0 THEN
    RAISE EXCEPTION 'Este avaliador já tem % avaliação(ões) neste evento. Para ele não avaliar mais, use Descredenciar; as notas continuam valendo.', v_avaliacoes;
  END IF;

  DELETE FROM public.locks_ativos l USING public.projetos p
  WHERE l.id_projeto = p.id_projeto AND p.id_evento = p_id_evento AND l.id_usuario = p_id_usuario;
  DELETE FROM public.fila_atribuicoes_direcionadas f USING public.projetos p
  WHERE f.id_projeto = p.id_projeto AND p.id_evento = p_id_evento AND f.id_usuario = p_id_usuario;
  DELETE FROM public.avaliador_modalidades_bloqueadas WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;
  DELETE FROM public.avaliador_areas WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;
  UPDATE public.dispositivos_avaliador SET revogado_em = now()
  WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento AND revogado_em IS NULL;
  DELETE FROM public.avaliadores_evento WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;

  IF NOT EXISTS (SELECT 1 FROM public.avaliadores_evento WHERE id_usuario = p_id_usuario)
     AND NOT EXISTS (SELECT 1 FROM public.avaliacoes WHERE id_usuario = p_id_usuario) THEN
    DELETE FROM public.usuarios WHERE id_usuario = p_id_usuario;
    v_apagou := true;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'cadastro_apagado', v_apagou);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_salvar_avaliadores(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_atualizar_avaliador(uuid, uuid, text, text, uuid, uuid[], uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_bloquear_modalidade_avaliador(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_remover_avaliador_evento(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_avaliadores(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_avaliador(uuid, uuid, text, text, uuid, uuid[], uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_bloquear_modalidade_avaliador(uuid, uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_avaliador_evento(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
