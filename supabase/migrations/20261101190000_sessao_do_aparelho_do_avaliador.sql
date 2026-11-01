-- ==============================================================================
-- MIGRATION: 20261101190000_sessao_do_aparelho_do_avaliador.sql
-- DESCRIÇÃO: o vínculo do celular passa a exigir uma sessão só do aparelho.
--   O navegador guarda uma sessão por origem: abrindo a aba Avaliador no mesmo
--   navegador em que o Admin (ou o Staff) está logado, `garantirSessaoAparelho`
--   reaproveitava aquela sessão e o aparelho era vinculado ao auth_uid da conta
--   da equipe. Resultado, com o Staff vendo "pareado com sucesso":
--     * pareamento: fn_meu_perfil continua respondendo 'admin'/'staff' (esse
--       ramo vem antes de avaliador_atual()), e a tela do celular ficava presa
--       esperando para sempre;
--     * código de acesso: a primeira tentativa consumia o código (uso único) e
--       o avaliador só via "E-mail ou código inválido, expirado ou já utilizado"
--       nas tentativas seguintes.
--   Agora o banco recusa antes de consumir nada: conta_da_equipe(uuid) diz se um
--   auth_uid é de ADMIN/STAFF/MONITOR (sem depender do MFA, ao contrário de
--   is_admin()), fn_solicitar_pareamento e fn_vincular_com_codigo recusam a
--   sessão da equipe com mensagem que diz o que fazer, fn_parear_dispositivo
--   recusa código pendente vindo de uma sessão da equipe e fn_meu_perfil informa
--   `sessao_equipe` para a tela oferecer "preparar este aparelho".
-- FRONT-END: compatível com a versão anterior (só um campo novo em fn_meu_perfil).
-- PRÉ-REQUISITO: 20261031020000_seguranca_sessao.sql.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- A conta é da equipe? (papel real, sem passar pelo MFA de is_admin())
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conta_da_equipe(p_auth_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_auth_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE (u.id_usuario = p_auth_uid OR u.id_auth = p_auth_uid)
      AND upper(u.papel::text) IN ('ADMIN', 'STAFF', 'MONITOR')
  );
$$;

CREATE OR REPLACE FUNCTION public.sessao_de_conta_da_equipe()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.conta_da_equipe(auth.uid());
$$;

COMMENT ON FUNCTION public.conta_da_equipe(uuid) IS
  'auth_uid pertence a ADMIN/STAFF/MONITOR? Usado para não vincular o celular do avaliador à sessão da equipe.';

-- ------------------------------------------------------------------------------
-- Perfil da sessão: a tela precisa saber que o navegador está com a conta da equipe
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_meu_perfil()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_evento  public.eventos;
  v_usuario public.usuarios;
  v_papel   text;
BEGIN
  v_evento := public.parametros_acesso(NULL);

  IF auth.uid() IS NOT NULL THEN
    IF public.is_admin() OR public.is_staff() THEN
      SELECT * INTO v_usuario FROM public.usuarios
      WHERE (id_usuario = auth.uid() OR id_auth = auth.uid()) LIMIT 1;
      v_papel := CASE WHEN public.is_admin() THEN 'admin' ELSE 'staff' END;
    ELSIF public.avaliador_atual() IS NOT NULL THEN
      SELECT * INTO v_usuario FROM public.usuarios WHERE id_usuario = public.avaliador_atual();
      v_papel := 'avaliador';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'autenticado',     auth.uid() IS NOT NULL,
    'papel',           v_papel,
    'id_usuario',      v_usuario.id_usuario,
    'nome',            v_usuario.nome,
    'email',           v_usuario.email,
    'id_evento',       v_evento.id_evento,
    'metodos_vinculo', coalesce(v_evento.metodos_vinculo, 'ambos'),
    -- Sessão de Admin/Staff neste navegador: a tela do avaliador precisa de uma sessão só do aparelho
    'sessao_equipe',   public.sessao_de_conta_da_equipe()
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- Pareamento: a sessão da equipe não pode pedir código para o próprio navegador
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_solicitar_pareamento()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_evento public.eventos;
  v_codigo text;
  v_expira timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão do aparelho não iniciada.' USING ERRCODE = '42501';
  END IF;
  IF public.sessao_de_conta_da_equipe() THEN
    RAISE EXCEPTION 'Este navegador está logado como Admin ou Staff. Saia dessa conta para vincular o celular do avaliador.'
      USING ERRCODE = '42501';
  END IF;
  v_evento := public.parametros_acesso(NULL);
  IF v_evento.id_evento IS NULL THEN
    RAISE EXCEPTION 'Nenhum evento ativo.';
  END IF;
  IF v_evento.metodos_vinculo NOT IN ('ambos', 'pareamento') THEN
    RAISE EXCEPTION 'Pareamento desativado neste evento. Use o código de acesso.';
  END IF;

  DELETE FROM public.pareamentos_pendentes WHERE expira_em < now() OR auth_uid = auth.uid();
  v_expira := now() + make_interval(mins => v_evento.minutos_validade_pareamento);

  LOOP
    v_codigo := public.gerar_codigo_curto(v_evento.tamanho_codigo);
    BEGIN
      INSERT INTO public.pareamentos_pendentes (codigo, auth_uid, id_evento, expira_em)
      VALUES (v_codigo, auth.uid(), v_evento.id_evento, v_expira);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- colisão de código: sorteia outro
    END;
  END LOOP;

  RETURN jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
END;
$$;

-- ------------------------------------------------------------------------------
-- Código de acesso: recusa a sessão da equipe ANTES de marcar o código como usado
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_vincular_com_codigo(p_email text, p_codigo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_evento     public.eventos;
  v_usuario    public.usuarios;
  v_cod        public.codigos_acesso;
  v_erro_padrao constant text := 'E-mail ou código inválido, expirado ou já utilizado.';
  -- Hash de um código que não existe: a resposta leva o mesmo tempo com ou sem código ativo
  -- (sem isso, a demora do bcrypt revelava quais e-mails são de avaliadores com código pendente)
  v_hash_falso  constant text := '$2a$08$ie/XW71pyb9bnxcEXTtuY.As1yr3hdoN6v.lALJZUc8swDbePZkOS';
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sessão do aparelho não iniciada.');
  END IF;
  IF public.sessao_de_conta_da_equipe() THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Este navegador está logado como Admin ou Staff. Saia dessa conta para vincular o celular do avaliador.');
  END IF;
  v_evento := public.parametros_acesso(NULL);
  IF v_evento.metodos_vinculo NOT IN ('ambos', 'codigo') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Código de acesso desativado neste evento. Procure o Staff para parear o aparelho.');
  END IF;

  SELECT * INTO v_usuario FROM public.usuarios
  WHERE lower(email) = lower(trim(p_email)) AND upper(papel::text) = 'AVALIADOR'
  LIMIT 1;
  IF v_usuario.id_usuario IS NULL THEN
    PERFORM extensions.crypt(public.normalizar_codigo(p_codigo), v_hash_falso);
    RETURN jsonb_build_object('ok', false, 'erro', v_erro_padrao);
  END IF;

  SELECT * INTO v_cod FROM public.codigos_acesso
  WHERE id_usuario = v_usuario.id_usuario
    AND usado_em IS NULL
    AND expira_em > now()
    AND tentativas < max_tentativas
  ORDER BY criado_em DESC
  LIMIT 1
  FOR UPDATE;
  IF v_cod.id IS NULL THEN
    PERFORM extensions.crypt(public.normalizar_codigo(p_codigo), v_hash_falso);
    RETURN jsonb_build_object('ok', false, 'erro', v_erro_padrao);
  END IF;

  IF extensions.crypt(public.normalizar_codigo(p_codigo), v_cod.codigo_hash) <> v_cod.codigo_hash THEN
    UPDATE public.codigos_acesso
    SET tentativas = tentativas + 1,
        usado_em = CASE WHEN tentativas + 1 >= max_tentativas THEN now() ELSE NULL END
    WHERE id = v_cod.id;
    RETURN jsonb_build_object('ok', false, 'erro', v_erro_padrao);
  END IF;

  UPDATE public.codigos_acesso SET usado_em = now() WHERE id = v_cod.id;
  UPDATE public.dispositivos_avaliador SET revogado_em = now()
  WHERE id_usuario = v_usuario.id_usuario AND revogado_em IS NULL AND auth_uid <> auth.uid();
  INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo, vinculado_por)
  VALUES (auth.uid(), v_usuario.id_usuario, v_cod.id_evento, 'codigo', v_cod.gerado_por)
  ON CONFLICT (auth_uid) DO UPDATE
    SET id_usuario = EXCLUDED.id_usuario, id_evento = EXCLUDED.id_evento, metodo = 'codigo',
        vinculado_por = EXCLUDED.vinculado_por, vinculado_em = now(), revogado_em = NULL;

  RETURN jsonb_build_object('ok', true, 'id_usuario', v_usuario.id_usuario, 'nome', v_usuario.nome);
END;
$$;

-- ------------------------------------------------------------------------------
-- Balcão do Staff: não pareia código vindo de um navegador logado como equipe
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_parear_dispositivo(p_codigo text, p_id_usuario uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pend public.pareamentos_pendentes;
  v_nome text;
BEGIN
  PERFORM public.exigir_staff_ou_admin();

  SELECT * INTO v_pend FROM public.pareamentos_pendentes
  WHERE codigo = public.normalizar_codigo(p_codigo) AND expira_em > now()
  FOR UPDATE;
  IF v_pend.codigo IS NULL THEN
    RAISE EXCEPTION 'Código de pareamento inválido ou expirado. Peça para o avaliador gerar outro.';
  END IF;
  -- Código gerado num navegador logado como Admin/Staff: vincular ali deixaria o celular preso na
  -- tela de espera (fn_meu_perfil responderia 'admin'/'staff'), então o pareamento não acontece.
  IF public.conta_da_equipe(v_pend.auth_uid) THEN
    DELETE FROM public.pareamentos_pendentes WHERE codigo = v_pend.codigo;
    RAISE EXCEPTION 'Esse código foi gerado num navegador logado como Admin ou Staff. Peça para sair dessa conta e gerar outro código.';
  END IF;

  PERFORM public.validar_avaliador_do_evento(p_id_usuario, v_pend.id_evento);

  UPDATE public.dispositivos_avaliador SET revogado_em = now()
  WHERE id_usuario = p_id_usuario AND revogado_em IS NULL AND auth_uid <> v_pend.auth_uid;
  INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo, vinculado_por)
  VALUES (v_pend.auth_uid, p_id_usuario, v_pend.id_evento, 'pareamento', auth.uid())
  ON CONFLICT (auth_uid) DO UPDATE
    SET id_usuario = EXCLUDED.id_usuario, id_evento = EXCLUDED.id_evento, metodo = 'pareamento',
        vinculado_por = EXCLUDED.vinculado_por, vinculado_em = now(), revogado_em = NULL;

  UPDATE public.avaliadores_evento SET is_credenciado = true
  WHERE id_usuario = p_id_usuario AND id_evento = v_pend.id_evento;
  DELETE FROM public.pareamentos_pendentes WHERE codigo = v_pend.codigo;

  SELECT nome INTO v_nome FROM public.usuarios WHERE id_usuario = p_id_usuario;
  RETURN jsonb_build_object('ok', true, 'id_usuario', p_id_usuario, 'nome', v_nome);
END;
$$;

-- ------------------------------------------------------------------------------
-- Permissões (as funções novas só são chamadas de dentro de outras SECURITY DEFINER)
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.conta_da_equipe(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sessao_de_conta_da_equipe() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conta_da_equipe(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sessao_de_conta_da_equipe() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
