-- Identidade visual do evento: quem lê e quem grava no bucket, e a RPC pública.
-- Migration 20261101200000_identidade_visual_evento. Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

-- Cenário: evento ativo com identidade visual, um Admin e um Staff
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d6000000-0000-0000-0000-0000000000ad', 'admin26@teste.local', false, now()),
  ('d6000000-0000-0000-0000-000000000051', 'staff26@teste.local', false, now()),
  ('d6000000-0000-0000-0000-0000000000a1', NULL, true, NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, cota_avaliacoes_padrao, url_icone, url_imagem_evento) VALUES
  ('e6000000-0000-0000-0000-000000000001', 'Feira com Identidade', true, 3,
   'http://127.0.0.1:54321/storage/v1/object/public/identidade-visual/eventos/e6/icone.png',
   'http://127.0.0.1:54321/storage/v1/object/public/identidade-visual/eventos/e6/imagem.png');
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('d6000000-0000-0000-0000-0000000000ad', 'admin26@teste.local', 'Admin', 'ADMIN', NULL),
  ('c6000000-0000-0000-0000-000000000051', 'staff26@teste.local', 'Staff', 'STAFF', 'd6000000-0000-0000-0000-000000000051');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_sub IS NULL THEN
    PERFORM set_config('role', 'anon', true);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  ELSE
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- O bucket existe, é público e só aceita imagem
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT public FROM storage.buckets WHERE id = 'identidade-visual'),
  'bucket identidade-visual é público (o login mostra a imagem sem sessão)');
SELECT ok(
  (SELECT 'image/png' = ANY(allowed_mime_types) AND 'application/pdf' <> ALL(allowed_mime_types)
   FROM storage.buckets WHERE id = 'identidade-visual'),
  'bucket aceita imagem e recusa outros tipos');

-- Um objeto já enviado, para conferir a leitura
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('identidade-visual', 'eventos/e6000000-0000-0000-0000-000000000001/icone.png', NULL);

-- ---------------------------------------------------------------------------
-- Leitura: qualquer visitante
-- ---------------------------------------------------------------------------
SELECT pg_temp.como(NULL);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'identidade-visual'), 1,
  'visitante lê o que está no bucket');

-- ---------------------------------------------------------------------------
-- Escrita: só o Admin
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('identidade-visual', 'eventos/invadido.png') $$,
  '42501', NULL, 'visitante não envia imagem');

SELECT pg_temp.como('d6000000-0000-0000-0000-000000000051');
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('identidade-visual', 'eventos/staff.png') $$,
  '42501', NULL, 'Staff não envia imagem');

SELECT pg_temp.como('d6000000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('identidade-visual', 'eventos/celular.png') $$,
  '42501', NULL, 'celular do avaliador não envia imagem');

SELECT pg_temp.como('d6000000-0000-0000-0000-0000000000ad');
SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name) VALUES ('identidade-visual', 'eventos/e6000000-0000-0000-0000-000000000001/imagem.png') $$,
  'Admin envia imagem');

-- Apagar e substituir acontecem pela Storage API (um gatilho do Supabase proíbe DELETE
-- direto na tabela), então aqui conferimos que a policy existe e exige Admin.
SELECT set_config('role', 'postgres', true);
SELECT ok(
  (SELECT qual LIKE '%is_admin()%' FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'identidade_visual_admin_remove'),
  'apagar imagem exige Admin na policy');
SELECT ok(
  (SELECT qual LIKE '%is_admin()%' AND with_check LIKE '%is_admin()%' FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'identidade_visual_admin_atualiza'),
  'substituir imagem exige Admin na policy');

-- ---------------------------------------------------------------------------
-- A RPC pública devolve a identidade do evento ativo
-- ---------------------------------------------------------------------------
SELECT pg_temp.como(NULL);
SELECT is((public.fn_identidade_visual())->>'url_icone',
  'http://127.0.0.1:54321/storage/v1/object/public/identidade-visual/eventos/e6/icone.png',
  'visitante recebe o ícone do evento ativo');

-- Sem evento ativo a função responde com campos nulos, em vez de nada
SELECT set_config('role', 'postgres', true);
UPDATE public.eventos SET is_ativo = false WHERE id_evento = 'e6000000-0000-0000-0000-000000000001';
SELECT pg_temp.como(NULL);
SELECT is((public.fn_identidade_visual())->>'url_icone', NULL,
  'sem evento ativo, a identidade vem vazia e a tela cai no padrão');

SELECT * FROM finish();
ROLLBACK;
