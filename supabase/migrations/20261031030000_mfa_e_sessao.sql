-- ==============================================================================
-- MIGRATION: 20261031030000_mfa_e_sessao.sql
-- DESCRIÇÃO: segundo fator (MFA/TOTP) do Admin e expiração de sessão por
-- inatividade, configuráveis pelo Admin na engrenagem (ASVS 6.3.3 e 7.3).
--   * configuracoes_seguranca (linha única): exigir_mfa_admin e
--     minutos_inatividade_sessao (0 = não expira; 5 a 720).
--   * Com exigir_mfa_admin, is_admin() só reconhece sessão com segundo fator
--     verificado (claim aal = 'aal2' do Supabase Auth): a exigência vale no banco,
--     não só na tela.
--   * Ligar ou desligar o MFA exige estar com o segundo fator verificado (aal2):
--     o Admin não se tranca fora e uma sessão só de senha não desliga a proteção.
--   * O usuário logado lê a própria linha de usuarios (o login do Admin com só a
--     senha precisa saber o papel para pedir o código).
--   * A expiração por inatividade é aplicada pelo front (o plano gratuito do
--     Supabase não limita a sessão no servidor); fn_politica_seguranca informa o tempo.
-- FRONT-END: compatível com a versão anterior (padrão: MFA desligado, sem expiração).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.configuracoes_seguranca (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  exigir_mfa_admin boolean NOT NULL DEFAULT false,
  minutos_inatividade_sessao integer NOT NULL DEFAULT 0
    CHECK (minutos_inatividade_sessao = 0 OR minutos_inatividade_sessao BETWEEN 5 AND 720),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
INSERT INTO public.configuracoes_seguranca (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.configuracoes_seguranca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.configuracoes_seguranca FROM anon, authenticated;
GRANT ALL ON public.configuracoes_seguranca TO service_role;

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
  )
  -- Com o MFA exigido, só a sessão que passou pelo segundo fator é Admin
  AND (
    NOT coalesce((SELECT c.exigir_mfa_admin FROM public.configuracoes_seguranca c WHERE c.id), false)
    OR coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_politica_seguranca()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'exigir_mfa_admin', coalesce(c.exigir_mfa_admin, false),
    'minutos_inatividade_sessao', coalesce(c.minutos_inatividade_sessao, 0)
  )
  FROM (SELECT 1) x
  LEFT JOIN public.configuracoes_seguranca c ON c.id;
$$;

CREATE OR REPLACE FUNCTION public.admin_salvar_configuracoes_seguranca(p_exigir_mfa_admin boolean, p_minutos_inatividade integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_atual public.configuracoes_seguranca;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_minutos_inatividade IS NULL OR NOT (p_minutos_inatividade = 0 OR p_minutos_inatividade BETWEEN 5 AND 720) THEN
    RAISE EXCEPTION 'Tempo de expiração inválido: use 0 (não expira) ou de 5 a 720 minutos.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.configuracoes_seguranca WHERE id;
  -- Mudar a exigência do MFA só com o segundo fator confirmado nesta sessão
  IF coalesce(p_exigir_mfa_admin, false) IS DISTINCT FROM coalesce(v_atual.exigir_mfa_admin, false)
     AND coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'Confirme o código do aplicativo autenticador antes de mudar a exigência do segundo fator.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.configuracoes_seguranca (id, exigir_mfa_admin, minutos_inatividade_sessao, atualizado_em, atualizado_por)
  VALUES (true, coalesce(p_exigir_mfa_admin, false), p_minutos_inatividade, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET exigir_mfa_admin = EXCLUDED.exigir_mfa_admin,
        minutos_inatividade_sessao = EXCLUDED.minutos_inatividade_sessao,
        atualizado_em = now(),
        atualizado_por = auth.uid();

  RETURN public.fn_politica_seguranca();
END;
$$;

REVOKE ALL ON FUNCTION public.fn_politica_seguranca() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_salvar_configuracoes_seguranca(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_politica_seguranca() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_salvar_configuracoes_seguranca(boolean, integer) TO authenticated, service_role;

-- O usuário logado lê a própria linha (o login do Admin precisa do papel antes do segundo fator)
DROP POLICY IF EXISTS rls_usuarios_leitura ON public.usuarios;
CREATE POLICY rls_usuarios_leitura ON public.usuarios FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR id_usuario = auth.uid()
    OR id_usuario = public.avaliador_atual()
    OR id_auth = auth.uid()
    OR (public.is_staff() AND upper(papel::text) = 'AVALIADOR')
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
