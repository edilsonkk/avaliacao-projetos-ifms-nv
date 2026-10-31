-- ==============================================================================
-- MIGRATION: 20261031020000_seguranca_sessao.sql
-- DESCRIÇÃO: etapa 2 da revisão de segurança (ASVS cap. 6 e 7: autenticação e sessão).
--   B1 (alto, CWE-285/613) avaliador_atual() aceitava qualquer celular vinculado e
--      não revogado: o Staff "Bloquear" (suspender credenciamento) não parava o
--      avaliador, e um celular vinculado num evento anterior continuava valendo no
--      evento ativo (até sem inscrição, sem a regra de conflito de instituição).
--      Agora o celular só vale no evento ativo e com credenciamento ativo; voltar a
--      credenciar reativa sem novo pareamento. Gerar código de acesso credencia (como
--      o pareamento), porque o código sozinho já não basta.
--   B2 (médio, CWE-208) fn_vincular_com_codigo respondia em ~12 ms para e-mail com
--      código ativo e ~0,1 ms para os demais: dava para descobrir os e-mails de
--      avaliadores pelo tempo. Agora roda o bcrypt também nos casos sem código.
--   B3 (baixo, CWE-204) o autocadastro público respondia "ja_cadastrado" para
--      e-mails existentes (inclusive Admin e Staff). Agora a resposta é sempre
--      "recebido".
-- FRONT-END: compatível com a versão anterior (o autocadastro não usa `situacao`).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.avaliador_atual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id_usuario
  FROM public.dispositivos_avaliador d
  JOIN public.usuarios u ON u.id_usuario = d.id_usuario
  WHERE d.auth_uid = auth.uid()
    AND d.revogado_em IS NULL
    -- Só vale no evento ativo e enquanto o Staff mantiver o credenciamento
    AND d.id_evento = public.evento_ativo_id()
    AND EXISTS (
      SELECT 1 FROM public.avaliadores_evento ae
      WHERE ae.id_usuario = d.id_usuario AND ae.id_evento = d.id_evento AND ae.is_credenciado
    )
    AND upper(u.papel::text) = 'AVALIADOR'
  LIMIT 1;
$$;

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

CREATE OR REPLACE FUNCTION public.fn_gerar_codigo_acesso(p_id_usuario uuid)
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
  PERFORM public.exigir_staff_ou_admin();
  v_evento := public.parametros_acesso(NULL);
  IF v_evento.metodos_vinculo NOT IN ('ambos', 'codigo') THEN
    RAISE EXCEPTION 'Código de acesso desativado neste evento (Configurações do evento).';
  END IF;
  PERFORM public.validar_avaliador_do_evento(p_id_usuario, v_evento.id_evento);

  -- Um código válido por avaliador: gerar outro invalida o anterior.
  UPDATE public.codigos_acesso SET usado_em = now() WHERE id_usuario = p_id_usuario AND usado_em IS NULL;

  v_codigo := public.gerar_codigo_curto(v_evento.tamanho_codigo);
  v_expira := now() + make_interval(mins => v_evento.minutos_validade_codigo_acesso);
  INSERT INTO public.codigos_acesso (id_usuario, id_evento, codigo_hash, gerado_por, expira_em, max_tentativas)
  VALUES (p_id_usuario, v_evento.id_evento, extensions.crypt(v_codigo, extensions.gen_salt('bf', 8)),
          auth.uid(), v_expira, v_evento.max_tentativas_codigo);

  -- Gerar o código é o Staff liberando o avaliador (como no pareamento): o celular só vale credenciado
  UPDATE public.avaliadores_evento SET is_credenciado = true
  WHERE id_usuario = p_id_usuario AND id_evento = v_evento.id_evento;

  RETURN jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_autocadastro_avaliador(p_id_evento uuid, p_nome text, p_email text, p_id_instituicao uuid, p_nome_instituicao_nova text, p_ids_areas uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_evento   uuid := coalesce(p_id_evento, public.evento_ativo_id());
  v_nome     text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_inst     uuid := p_id_instituicao;
  v_inst_nova text := btrim(regexp_replace(coalesce(p_nome_instituicao_nova, ''), '\s+', ' ', 'g'));
  v_usuario  public.usuarios;
BEGIN
  IF v_evento IS NULL OR NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = v_evento AND is_ativo) THEN
    RAISE EXCEPTION 'Evento não encontrado ou encerrado.';
  END IF;
  IF length(v_nome) < 3 OR length(v_nome) > 150 THEN
    RAISE EXCEPTION 'Informe o nome completo (3 a 150 caracteres).';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;

  SELECT * INTO v_usuario FROM public.usuarios WHERE lower(email) = v_email LIMIT 1;
  IF v_usuario.id_usuario IS NOT NULL THEN
    -- Já existe: não altera nada e responde igual a um cadastro novo (não revela quem tem conta). Só garante a inscrição no evento, sem
    -- mudar credenciamento nem instituição de quem já está inscrito.
    IF upper(v_usuario.papel::text) = 'AVALIADOR' THEN
      INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
      VALUES (v_usuario.id_usuario, v_evento, false)
      ON CONFLICT (id_usuario, id_evento) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('ok', true, 'situacao', 'recebido');
  END IF;

  -- Instituição: existente do evento ou nova (a chave é calculada pelo trigger)
  IF v_inst IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.instituicoes WHERE id_instituicao = v_inst AND id_evento = v_evento) THEN
    v_inst := NULL;
  END IF;
  IF v_inst IS NULL AND length(v_inst_nova) BETWEEN 2 AND 200 THEN
    SELECT id_instituicao INTO v_inst FROM public.instituicoes
    WHERE id_evento = v_evento AND nome_normalizado = public.fn_normalizar_nome(v_inst_nova);
    IF v_inst IS NULL THEN
      INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
      VALUES (v_evento, v_inst_nova, public.fn_normalizar_nome(v_inst_nova))
      RETURNING id_instituicao INTO v_inst;
    END IF;
  END IF;

  INSERT INTO public.usuarios (email, nome, papel) VALUES (v_email, v_nome, 'AVALIADOR')
  RETURNING * INTO v_usuario;
  INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado)
  VALUES (v_usuario.id_usuario, v_evento, v_inst, false);

  IF p_ids_areas IS NOT NULL THEN
    INSERT INTO public.avaliador_areas (id_usuario, id_evento, id_area)
    SELECT v_usuario.id_usuario, v_evento, a.id_area
    FROM public.areas_tematicas a
    WHERE a.id_area = ANY (p_ids_areas) AND a.id_evento = v_evento
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'situacao', 'recebido');
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
