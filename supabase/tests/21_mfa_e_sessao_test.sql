-- Segundo fator (MFA) do Admin e expiração de sessão (migration 20261031030000_mfa_e_sessao).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d2100000-0000-0000-0000-0000000000ad', 'admin21@teste.local', false, now()),
  ('d2100000-0000-0000-0000-000000000051', 'staff21@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('d2100000-0000-0000-0000-0000000000ad', 'admin21@teste.local', 'Admin', 'ADMIN', NULL),
  ('c2100000-0000-0000-0000-000000000051', 'staff21@teste.local', 'Staff', 'STAFF', 'd2100000-0000-0000-0000-000000000051');

-- Sessão do Auth com o nível de garantia (aal1 = só senha; aal2 = senha + segundo fator)
CREATE FUNCTION pg_temp.como(p_sub text, p_aal text DEFAULT 'aal1') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_sub IS NULL THEN
    PERFORM set_config('role', 'anon', true);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  ELSE
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal)::text, true);
  END IF;
END $$;

-- Padrão: MFA desligado, sem expiração
SELECT pg_temp.como('d2100000-0000-0000-0000-0000000000ad', 'aal1');
SELECT is(public.fn_politica_seguranca(), '{"exigir_mfa_admin": false, "minutos_inatividade_sessao": 0}'::jsonb, 'padrão: sem MFA e sem expiração');
SELECT ok(public.is_admin(), 'sem MFA exigido, o Admin com só senha é Admin');

-- Quem altera
SELECT pg_temp.como('d2100000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_salvar_configuracoes_seguranca(false, 30) $$, '42501', NULL, 'Staff não altera a política');
SELECT is(public.fn_politica_seguranca()->>'minutos_inatividade_sessao', '0', 'Staff lê a política (precisa do tempo de expiração)');
SELECT pg_temp.como(NULL);
SELECT throws_ok($$ SELECT public.fn_politica_seguranca() $$, '42501', NULL, 'anon não lê a política');

-- Tempo de expiração
SELECT pg_temp.como('d2100000-0000-0000-0000-0000000000ad', 'aal1');
SELECT throws_ok($$ SELECT public.admin_salvar_configuracoes_seguranca(false, 3) $$, '22023', NULL, 'tempo abaixo de 5 minutos é recusado');
SELECT throws_ok($$ SELECT public.admin_salvar_configuracoes_seguranca(false, 721) $$, '22023', NULL, 'tempo acima de 720 minutos é recusado');
SELECT lives_ok($$ SELECT public.admin_salvar_configuracoes_seguranca(false, 30) $$, 'Admin define 30 minutos');
SELECT is(public.fn_politica_seguranca()->>'minutos_inatividade_sessao', '30', 'tempo gravado');

-- Ligar o MFA exige estar com o segundo fator confirmado (não se tranca fora)
SELECT throws_ok($$ SELECT public.admin_salvar_configuracoes_seguranca(true, 30) $$, '42501', NULL,
  'ligar MFA com sessão só de senha é recusado');
SELECT pg_temp.como('d2100000-0000-0000-0000-0000000000ad', 'aal2');
SELECT lives_ok($$ SELECT public.admin_salvar_configuracoes_seguranca(true, 30) $$, 'ligar MFA com o segundo fator confirmado');
SELECT ok(public.is_admin(), 'com MFA exigido, o Admin verificado (aal2) é Admin');

-- Com MFA exigido, a sessão só de senha não é Admin no banco
SELECT pg_temp.como('d2100000-0000-0000-0000-0000000000ad', 'aal1');
SELECT ok(NOT public.is_admin(), 'com MFA exigido, só senha (aal1) não é Admin');
SELECT throws_ok($$ SELECT public.admin_reset_global(gen_random_uuid()) $$, '42501', NULL, 'só senha não roda função de Admin');
SELECT is((SELECT papel::text FROM public.usuarios WHERE id_usuario = 'd2100000-0000-0000-0000-0000000000ad'), 'ADMIN',
  'só senha ainda lê o próprio perfil (o login decide pedir o código)');
SELECT throws_ok($$ SELECT public.admin_salvar_configuracoes_seguranca(false, 0) $$, '42501', NULL, 'desligar MFA exige o segundo fator');

-- Staff não é afetado pelo MFA do Admin
SELECT pg_temp.como('d2100000-0000-0000-0000-000000000051', 'aal1');
SELECT ok(public.is_staff(), 'Staff com só senha continua Staff');

SELECT * FROM finish();
ROLLBACK;
