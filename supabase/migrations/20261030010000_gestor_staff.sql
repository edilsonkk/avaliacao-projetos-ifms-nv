-- ==============================================================================
-- MIGRATION: 20261030010000_gestor_staff.sql
-- DESCRIÇÃO: escritas do Gestor da Equipe Staff passam por funções do banco.
--   * Cadastro manual e importação faziam upsert em usuarios por e-mail com
--     papel = 'STAFF': o e-mail do Admin virava Staff (perdia o acesso) e um
--     avaliador com notas virava Staff. A importação ainda regravava
--     is_credenciado = false, descredenciando quem já estava credenciado.
--     admin_salvar_staff ignora (e informa) e-mails de Admin/Avaliador, não
--     mexe no credenciamento de quem já está no evento e grava numa transação.
--   * admin_atualizar_staff recusa e-mail de outra pessoa e usuário que não é
--     Staff.
--   * admin_excluir_staff só apaga quem é Staff/Monitor (antes o front apagava
--     os vínculos de todos os eventos antes de saber se o DELETE ia funcionar).
-- FRONT-END: compatível com a versão anterior (só funções novas).
-- PRÉ-REQUISITO: public.is_admin() (20261026000000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Cadastro manual e importação
--   p_itens: [{nome, email, papel?}]  papel: STAFF (padrão) ou MONITOR
--   Retorna {cadastrados, atualizados, ignorados: [{email, motivo}]}
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_staff(p_id_evento uuid, p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item        jsonb;
  v_nome        text;
  v_email       text;
  v_papel       text;
  v_usuario     public.usuarios;
  v_cadastrados integer := 0;
  v_atualizados integer := 0;
  v_ignorados   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_id_evento IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de membros do Staff inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_nome  := btrim(regexp_replace(coalesce(v_item->>'nome', ''), '\s+', ' ', 'g'));
    v_email := lower(btrim(coalesce(v_item->>'email', '')));
    v_papel := upper(btrim(coalesce(nullif(v_item->>'papel', ''), 'STAFF')));

    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
      v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', 'E-mail inválido.');
      CONTINUE;
    END IF;
    IF v_papel NOT IN ('STAFF', 'MONITOR') THEN
      v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', format('Papel "%s" inválido: use STAFF ou MONITOR.', v_papel));
      CONTINUE;
    END IF;

    SELECT * INTO v_usuario FROM public.usuarios WHERE lower(email) = v_email ORDER BY created_at LIMIT 1;

    IF v_usuario.id_usuario IS NOT NULL AND upper(coalesce(v_usuario.papel, '')) NOT IN ('STAFF', 'MONITOR') THEN
      v_ignorados := v_ignorados || jsonb_build_object(
        'email', v_email,
        'motivo', format('O e-mail pertence a um usuário %s; ele não foi alterado.', upper(coalesce(v_usuario.papel, 'sem papel'))));
      CONTINUE;
    END IF;

    IF v_usuario.id_usuario IS NULL THEN
      IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
        v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', 'Nome ausente ou muito longo.');
        CONTINUE;
      END IF;
      INSERT INTO public.usuarios (email, nome, papel) VALUES (v_email, v_nome, v_papel)
      RETURNING * INTO v_usuario;
      v_cadastrados := v_cadastrados + 1;
    ELSE
      UPDATE public.usuarios
      SET nome = CASE WHEN length(v_nome) BETWEEN 2 AND 255 THEN v_nome ELSE nome END,
          papel = v_papel
      WHERE id_usuario = v_usuario.id_usuario;
      v_atualizados := v_atualizados + 1;
    END IF;

    -- Inscreve no evento sem mexer no credenciamento de quem já está lá
    IF p_id_evento IS NOT NULL THEN
      INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
      VALUES (v_usuario.id_usuario, p_id_evento, false)
      ON CONFLICT (id_usuario, id_evento) DO NOTHING;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cadastrados', v_cadastrados, 'atualizados', v_atualizados, 'ignorados', v_ignorados);
END;
$$;

-- ------------------------------------------------------------------------------
-- Edição
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_atualizar_staff(p_id_usuario uuid, p_nome text, p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nome  text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_papel text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT papel INTO v_papel FROM public.usuarios WHERE id_usuario = p_id_usuario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro do Staff não encontrado.';
  END IF;
  IF upper(coalesce(v_papel, '')) NOT IN ('STAFF', 'MONITOR') THEN
    RAISE EXCEPTION 'Este usuário não é da equipe Staff.';
  END IF;
  IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
    RAISE EXCEPTION 'Informe o nome.';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.usuarios WHERE lower(email) = v_email AND id_usuario <> p_id_usuario) THEN
    RAISE EXCEPTION 'Já existe outro usuário com o e-mail %.', v_email;
  END IF;

  UPDATE public.usuarios SET nome = v_nome, email = v_email WHERE id_usuario = p_id_usuario;
END;
$$;

-- ------------------------------------------------------------------------------
-- Exclusão (só Staff/Monitor; a conta de login no Auth continua, sem acesso)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_excluir_staff(p_id_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_papel text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT papel INTO v_papel FROM public.usuarios WHERE id_usuario = p_id_usuario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro do Staff não encontrado.';
  END IF;
  IF upper(coalesce(v_papel, '')) NOT IN ('STAFF', 'MONITOR') THEN
    RAISE EXCEPTION 'Este usuário não é da equipe Staff.';
  END IF;

  DELETE FROM public.usuarios WHERE id_usuario = p_id_usuario;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_salvar_staff(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_atualizar_staff(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_excluir_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_staff(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_staff(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_excluir_staff(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
