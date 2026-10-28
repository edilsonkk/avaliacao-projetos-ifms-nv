-- ==============================================================================
-- MIGRATION: 20261028210000_identidade_avaliador_staff.sql
-- DESCRIÇÃO: Fases 1 e 2 da correção de segurança: identidade real para
--   Avaliador e Staff (docs/arquitetura/seguranca.md).
--   * Avaliador: o celular tem uma sessão anônima do Supabase Auth
--     (auth.uid()) e é vinculado ao avaliador de duas formas:
--       1. pareamento: o celular mostra um código e o Staff o vincula;
--       2. código de acesso: o Staff gera um código e o avaliador digita
--          e-mail + código no próprio celular.
--   * Staff: conta com e-mail e senha no Supabase Auth, ligada ao perfil por
--     usuarios.id_auth no primeiro login.
--   * Parâmetros de validade, tamanho e tentativas por evento (engrenagem).
--   * RPCs públicas seguras para autocadastro e Telão.
--
--   Migration ADITIVA: não altera o fluxo atual. As proteções que exigem o
--   novo front-end (sorteio, envio de notas, RLS) vêm na migration seguinte.
-- PRÉ-REQUISITOS: is_admin() (20261026000000), pgcrypto.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ------------------------------------------------------------------------------
-- 1. Vínculo da conta do Auth com o perfil (Staff e, no futuro, Admin)
--    Mantém a PK id_usuario (referenciada por muitas tabelas).
-- ------------------------------------------------------------------------------
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS id_auth uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- 2. Parâmetros de acesso por evento (Configurações do evento)
--    Os limites ficam no banco: nem o Admin configura valores inseguros.
-- ------------------------------------------------------------------------------
ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS minutos_validade_pareamento    integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS minutos_validade_codigo_acesso integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS tamanho_codigo                 integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS max_tentativas_codigo          integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS metodos_vinculo                text    NOT NULL DEFAULT 'ambos';

ALTER TABLE public.eventos DROP CONSTRAINT IF EXISTS ck_eventos_minutos_validade_pareamento;
ALTER TABLE public.eventos ADD  CONSTRAINT ck_eventos_minutos_validade_pareamento
  CHECK (minutos_validade_pareamento BETWEEN 1 AND 60);
ALTER TABLE public.eventos DROP CONSTRAINT IF EXISTS ck_eventos_minutos_validade_codigo_acesso;
ALTER TABLE public.eventos ADD  CONSTRAINT ck_eventos_minutos_validade_codigo_acesso
  CHECK (minutos_validade_codigo_acesso BETWEEN 1 AND 120);
ALTER TABLE public.eventos DROP CONSTRAINT IF EXISTS ck_eventos_tamanho_codigo;
ALTER TABLE public.eventos ADD  CONSTRAINT ck_eventos_tamanho_codigo
  CHECK (tamanho_codigo BETWEEN 6 AND 10);
ALTER TABLE public.eventos DROP CONSTRAINT IF EXISTS ck_eventos_max_tentativas_codigo;
ALTER TABLE public.eventos ADD  CONSTRAINT ck_eventos_max_tentativas_codigo
  CHECK (max_tentativas_codigo BETWEEN 1 AND 10);
ALTER TABLE public.eventos DROP CONSTRAINT IF EXISTS ck_eventos_metodos_vinculo;
ALTER TABLE public.eventos ADD  CONSTRAINT ck_eventos_metodos_vinculo
  CHECK (metodos_vinculo IN ('ambos', 'pareamento', 'codigo'));

-- ------------------------------------------------------------------------------
-- 3. Tabelas de vínculo (acesso só pelas funções abaixo)
-- ------------------------------------------------------------------------------
-- Aparelho (sessão do Auth) vinculado a um avaliador. Um aparelho ativo por avaliador.
CREATE TABLE IF NOT EXISTS public.dispositivos_avaliador (
  auth_uid      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  id_usuario    uuid NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_evento     uuid REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  metodo        text NOT NULL CHECK (metodo IN ('pareamento', 'codigo')),
  vinculado_por uuid,
  vinculado_em  timestamptz NOT NULL DEFAULT now(),
  revogado_em   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_dispositivos_avaliador_usuario_ativo
  ON public.dispositivos_avaliador (id_usuario) WHERE revogado_em IS NULL;

-- Pareamento: o celular pede, o Staff confirma. O código só aponta o aparelho
-- (não é credencial: quem decide o vínculo é o Staff), por isso fica em texto.
CREATE TABLE IF NOT EXISTS public.pareamentos_pendentes (
  codigo    text PRIMARY KEY,
  auth_uid  uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  id_evento uuid REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL
);

-- Código de acesso: o Staff gera, o avaliador digita. É credencial: só o hash
-- (bcrypt) é gravado; uso único; tentativas limitadas.
CREATE TABLE IF NOT EXISTS public.codigos_acesso (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario     uuid NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
  id_evento      uuid REFERENCES public.eventos(id_evento) ON DELETE CASCADE,
  codigo_hash    text NOT NULL,
  gerado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  tentativas     integer NOT NULL DEFAULT 0,
  max_tentativas integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codigos_acesso_usuario_ativo
  ON public.codigos_acesso (id_usuario) WHERE usado_em IS NULL;

ALTER TABLE public.dispositivos_avaliador ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pareamentos_pendentes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_acesso         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dispositivos_avaliador, public.pareamentos_pendentes, public.codigos_acesso FROM anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Funções de identidade (usadas pela RLS e pelas RPCs)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE (u.id_usuario = auth.uid() OR u.id_auth = auth.uid())
      AND upper(u.papel::text) = 'ADMIN'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE (u.id_usuario = auth.uid() OR u.id_auth = auth.uid())
      AND upper(u.papel::text) IN ('STAFF', 'MONITOR')
  );
$$;

-- Avaliador vinculado ao aparelho (sessão) atual, ou NULL.
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
    AND upper(u.papel::text) = 'AVALIADOR'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.evento_ativo_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id_evento FROM public.eventos WHERE is_ativo = true ORDER BY created_at DESC LIMIT 1;
$$;

-- Código aleatório sem caracteres ambíguos (sem 0 O 1 I L 5 S). Amostragem por
-- rejeição sobre bytes criptográficos para não enviesar o alfabeto.
CREATE OR REPLACE FUNCTION public.gerar_codigo_curto(p_tamanho integer)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
  v_n        constant integer := 29;
  v_codigo   text := '';
  v_byte     integer;
BEGIN
  WHILE length(v_codigo) < p_tamanho LOOP
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    IF v_byte < 232 THEN  -- 232 = 29 * 8
      v_codigo := v_codigo || substr(v_alfabeto, (v_byte % v_n) + 1, 1);
    END IF;
  END LOOP;
  RETURN v_codigo;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalizar_codigo(p_codigo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.parametros_acesso(p_id_evento uuid)
RETURNS public.eventos
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.* FROM public.eventos e WHERE e.id_evento = coalesce(p_id_evento, public.evento_ativo_id());
$$;

-- ------------------------------------------------------------------------------
-- 5. RPCs do celular do avaliador
-- ------------------------------------------------------------------------------
-- Perfil da sessão atual. Chamável sem login (devolve só os métodos liberados).
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
    'metodos_vinculo', coalesce(v_evento.metodos_vinculo, 'ambos')
  );
END;
$$;

-- O celular pede um código de pareamento para mostrar ao Staff.
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

-- O avaliador digita e-mail + código de acesso gerado pelo Staff.
-- Retorna {ok, erro} em vez de lançar exceção para que a contagem de
-- tentativas seja gravada mesmo quando o código está errado.
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
-- 6. RPCs do Staff (e do Admin)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exigir_staff_ou_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_staff() OR public.is_admin()) THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita à equipe Staff ou ao Admin.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Garante que o usuário é avaliador inscrito no evento; devolve o evento.
CREATE OR REPLACE FUNCTION public.validar_avaliador_do_evento(p_id_usuario uuid, p_id_evento uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    JOIN public.avaliadores_evento ae ON ae.id_usuario = u.id_usuario AND ae.id_evento = p_id_evento
    WHERE u.id_usuario = p_id_usuario AND upper(u.papel::text) = 'AVALIADOR'
  ) THEN
    RAISE EXCEPTION 'Avaliador não encontrado neste evento.';
  END IF;
END;
$$;

-- O Staff confirma o código mostrado no celular e vincula ao avaliador.
-- A pessoa está no balcão: o avaliador também é credenciado.
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

-- O Staff gera um código de acesso para o avaliador digitar. Mostrado uma única vez.
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

  RETURN jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_desvincular_dispositivo(p_id_usuario uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_qtd integer;
BEGIN
  PERFORM public.exigir_staff_ou_admin();
  UPDATE public.dispositivos_avaliador SET revogado_em = now()
  WHERE id_usuario = p_id_usuario AND revogado_em IS NULL;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  UPDATE public.codigos_acesso SET usado_em = now() WHERE id_usuario = p_id_usuario AND usado_em IS NULL;
  DELETE FROM public.locks_ativos WHERE id_usuario = p_id_usuario;
  RETURN jsonb_build_object('ok', true, 'aparelhos_desvinculados', v_qtd);
END;
$$;

-- Situação de vínculo dos avaliadores do evento (para a tela do Staff).
CREATE OR REPLACE FUNCTION public.fn_situacao_vinculos(p_id_evento uuid)
RETURNS TABLE (id_usuario uuid, aparelho_vinculado boolean, vinculado_em timestamptz, metodo text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.exigir_staff_ou_admin();
  RETURN QUERY
  SELECT ae.id_usuario, d.auth_uid IS NOT NULL, d.vinculado_em, d.metodo
  FROM public.avaliadores_evento ae
  LEFT JOIN public.dispositivos_avaliador d ON d.id_usuario = ae.id_usuario AND d.revogado_em IS NULL
  WHERE ae.id_evento = coalesce(p_id_evento, public.evento_ativo_id());
END;
$$;

-- Primeiro login do Staff: liga a conta do Auth (e-mail confirmado) ao perfil.
CREATE OR REPLACE FUNCTION public.fn_vincular_conta_staff()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login com e-mail e senha.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(email) INTO v_email FROM auth.users
  WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL AND coalesce(is_anonymous, false) = false;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Conta sem e-mail confirmado.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.usuarios SET id_auth = auth.uid()
  WHERE lower(email) = v_email
    AND upper(papel::text) IN ('STAFF', 'MONITOR')
    AND (id_auth IS NULL OR id_auth = auth.uid())
  RETURNING id_usuario INTO v_id;

  RETURN jsonb_build_object('ok', v_id IS NOT NULL OR public.is_staff(), 'papel', CASE WHEN public.is_staff() THEN 'staff' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_check_in_projeto(p_id_projeto uuid, p_check_in boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.exigir_staff_ou_admin();
  UPDATE public.projetos SET is_check_in_realizado = p_check_in WHERE id_projeto = p_id_projeto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. RPCs do avaliador vinculado
-- ------------------------------------------------------------------------------
-- Fixa o questionário do projeto na primeira avaliação (só quem detém a trava).
CREATE OR REPLACE FUNCTION public.fn_fixar_questionario(p_id_projeto uuid, p_id_questionario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.avaliador_atual() IS NULL THEN
    RAISE EXCEPTION 'Aparelho não vinculado a um avaliador.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.locks_ativos
    WHERE id_usuario = public.avaliador_atual() AND id_projeto = p_id_projeto AND expira_em > now()
  ) THEN
    RAISE EXCEPTION 'É preciso estar com o projeto em avaliação.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.projetos SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL;
END;
$$;

-- Contagens para a fila do avaliador sem expor notas de terceiros.
CREATE OR REPLACE FUNCTION public.fn_avaliacoes_ativas_do_projeto(p_id_projeto uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN public.avaliador_atual() IS NULL AND NOT public.is_staff() AND NOT public.is_admin() THEN NULL
         ELSE (SELECT count(*)::integer FROM public.avaliacoes
               WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA')) END;
$$;

-- true quando todos os projetos em competição do evento atingiram a cota.
CREATE OR REPLACE FUNCTION public.fn_feira_concluida(p_id_evento uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ev AS (
    SELECT coalesce(cota_avaliacoes_padrao, 3) AS cota FROM public.eventos
    WHERE id_evento = coalesce(p_id_evento, public.evento_ativo_id())
  ), proj AS (
    SELECT p.id_projeto, coalesce(p.cota_avaliacoes_customizada, (SELECT cota FROM ev)) AS cota,
           (SELECT count(*) FROM public.avaliacoes a
            WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')) AS feitas
    FROM public.projetos p
    WHERE p.id_evento = coalesce(p_id_evento, public.evento_ativo_id())
      AND coalesce(p.is_fora_da_competicao, false) = false
  )
  SELECT CASE WHEN public.avaliador_atual() IS NULL AND NOT public.is_staff() AND NOT public.is_admin() THEN NULL
              WHEN NOT EXISTS (SELECT 1 FROM proj) THEN false
              ELSE bool_and(feitas >= cota) END
  FROM proj;
$$;

-- ------------------------------------------------------------------------------
-- 8. RPCs públicas (anon)
-- ------------------------------------------------------------------------------
-- Autocadastro pelo QR Code. Não altera cadastros existentes: impede que alguém
-- renomeie, troque as áreas ou descredencie outro avaliador só sabendo o e-mail.
CREATE OR REPLACE FUNCTION public.fn_autocadastro_avaliador(
  p_id_evento uuid,
  p_nome text,
  p_email text,
  p_id_instituicao uuid,
  p_nome_instituicao_nova text,
  p_ids_areas uuid[]
)
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
  v_norm     text;
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
    -- Já existe: não altera nada. Só garante a inscrição no evento, sem
    -- mudar credenciamento nem instituição de quem já está inscrito.
    IF upper(v_usuario.papel::text) = 'AVALIADOR' THEN
      INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
      VALUES (v_usuario.id_usuario, v_evento, false)
      ON CONFLICT (id_usuario, id_evento) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('ok', true, 'situacao', 'ja_cadastrado');
  END IF;

  -- Instituição: existente do evento ou nova (normalizada como o restante do sistema)
  IF v_inst IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.instituicoes WHERE id_instituicao = v_inst AND id_evento = v_evento) THEN
    v_inst := NULL;
  END IF;
  IF v_inst IS NULL AND length(v_inst_nova) BETWEEN 2 AND 200 THEN
    v_norm := lower(btrim(extensions.unaccent(v_inst_nova)));
    SELECT id_instituicao INTO v_inst FROM public.instituicoes WHERE id_evento = v_evento AND nome_normalizado = v_norm;
    IF v_inst IS NULL THEN
      INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
      VALUES (v_evento, v_inst_nova, v_norm)
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

  RETURN jsonb_build_object('ok', true, 'situacao', 'cadastrado');
END;
$$;

-- Resumo do Telão: só agregados, sem nomes nem notas.
CREATE OR REPLACE FUNCTION public.fn_telao_resumo(p_id_evento uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ev AS (
    SELECT id_evento, coalesce(cota_avaliacoes_padrao, 3) AS cota
    FROM public.eventos WHERE id_evento = coalesce(p_id_evento, public.evento_ativo_id())
  )
  SELECT jsonb_build_object(
    'total_projetos', (SELECT count(*) FROM public.projetos p, ev WHERE p.id_evento = ev.id_evento),
    'avaliadores_credenciados', (SELECT count(*) FROM public.avaliadores_evento ae, ev
                                 WHERE ae.id_evento = ev.id_evento AND ae.is_credenciado),
    'avaliacoes_em_andamento', (SELECT count(*) FROM public.locks_ativos l JOIN public.projetos p ON p.id_projeto = l.id_projeto, ev
                                WHERE p.id_evento = ev.id_evento AND l.expira_em > now()),
    'avaliacoes_realizadas', (SELECT count(*) FROM public.avaliacoes a JOIN public.projetos p ON p.id_projeto = a.id_projeto, ev
                              WHERE p.id_evento = ev.id_evento AND (a.status IS NULL OR a.status <> 'CANCELADA')
                                AND a.nota_final IS NOT NULL),
    'cota_padrao', (SELECT cota FROM ev)
  );
$$;

-- ------------------------------------------------------------------------------
-- 9. Privilégios das funções
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  f text;
  internas text[] := ARRAY[
    'gerar_codigo_curto(integer)', 'normalizar_codigo(text)', 'parametros_acesso(uuid)',
    'exigir_staff_ou_admin()', 'validar_avaliador_do_evento(uuid, uuid)'
  ];
  autenticadas text[] := ARRAY[
    'fn_solicitar_pareamento()', 'fn_vincular_com_codigo(text, text)',
    'fn_parear_dispositivo(text, uuid)', 'fn_gerar_codigo_acesso(uuid)',
    'fn_desvincular_dispositivo(uuid)', 'fn_situacao_vinculos(uuid)', 'fn_vincular_conta_staff()',
    'fn_check_in_projeto(uuid, boolean)', 'fn_fixar_questionario(uuid, uuid)',
    'fn_avaliacoes_ativas_do_projeto(uuid)', 'fn_feira_concluida(uuid)'
  ];
  publicas text[] := ARRAY[
    'is_admin()', 'is_staff()', 'avaliador_atual()', 'evento_ativo_id()', 'fn_meu_perfil()',
    'fn_autocadastro_avaliador(uuid, text, text, uuid, text, uuid[])', 'fn_telao_resumo(uuid)'
  ];
BEGIN
  FOREACH f IN ARRAY internas LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY autenticadas LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY publicas LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;

COMMIT;
