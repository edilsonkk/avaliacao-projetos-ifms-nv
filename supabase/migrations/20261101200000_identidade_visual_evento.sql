-- ==============================================================================
-- MIGRATION: 20261101200000_identidade_visual_evento.sql
-- DESCRIÇÃO: o Admin passa a enviar o ícone e a imagem do evento nas Configurações.
--   * eventos.url_icone e eventos.url_imagem_evento (nulos): o ícone substitui o
--     bloco "IF" do cabeçalho e serve de favicon/atalho; a imagem aparece no login,
--     no autocadastro, no Telão, nos relatórios impressos e no topo da tela do
--     avaliador. Sem ícone enviado, o cabeçalho mostra um marcador de pendência.
--   * Bucket de Storage `identidade-visual`, o primeiro do projeto: público para
--     leitura (o cabeçalho e o login precisam da imagem antes de qualquer sessão) e
--     gravável só pelo Admin, via policy em storage.objects.
--   * fn_identidade_visual(): RPC pública com a identidade do evento ativo. É uma
--     função nova em vez de um campo novo em fn_meu_perfil para não disputar a
--     definição dessa função com outras migrations em revisão.
-- FRONT-END: compatível com a versão anterior (colunas e função novas).
-- PRÉ-REQUISITOS: public.is_admin() (20261026000000), public.evento_ativo_id()
--   (20261028210000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Onde a identidade do evento fica guardada
-- ------------------------------------------------------------------------------
ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS url_icone text,
  ADD COLUMN IF NOT EXISTS url_imagem_evento text;

COMMENT ON COLUMN public.eventos.url_icone IS
  'URL pública do ícone do evento (bucket identidade-visual). Substitui o "IF" do cabeçalho e serve de favicon.';
COMMENT ON COLUMN public.eventos.url_imagem_evento IS
  'URL pública da imagem do evento (bucket identidade-visual): login, autocadastro, Telão, relatórios e topo da tela do avaliador.';

-- ------------------------------------------------------------------------------
-- 2. Bucket público, com limite de tamanho e tipos permitidos
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'identidade-visual',
  'identidade-visual',
  true,
  2097152, -- 2 MB: o ícone é pequeno e a imagem do evento não precisa ser maior
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 2097152,
      allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

-- ------------------------------------------------------------------------------
-- 3. Quem lê e quem grava (regra 3 do AGENTS.md: a permissão é do banco)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS identidade_visual_leitura_publica ON storage.objects;
CREATE POLICY identidade_visual_leitura_publica ON storage.objects
  FOR SELECT
  USING (bucket_id = 'identidade-visual');

DROP POLICY IF EXISTS identidade_visual_admin_grava ON storage.objects;
CREATE POLICY identidade_visual_admin_grava ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'identidade-visual' AND public.is_admin());

DROP POLICY IF EXISTS identidade_visual_admin_atualiza ON storage.objects;
CREATE POLICY identidade_visual_admin_atualiza ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'identidade-visual' AND public.is_admin())
  WITH CHECK (bucket_id = 'identidade-visual' AND public.is_admin());

DROP POLICY IF EXISTS identidade_visual_admin_remove ON storage.objects;
CREATE POLICY identidade_visual_admin_remove ON storage.objects
  FOR DELETE
  USING (bucket_id = 'identidade-visual' AND public.is_admin());

-- ------------------------------------------------------------------------------
-- 4. Identidade do evento ativo, legível por qualquer visitante
--    (a tela de login mostra a imagem antes de existir sessão)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_identidade_visual()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (
      SELECT jsonb_build_object(
        'id_evento', e.id_evento,
        'nome_evento', e.nome_evento,
        'url_icone', e.url_icone,
        'url_imagem_evento', e.url_imagem_evento
      )
      FROM public.eventos e
      WHERE e.id_evento = public.evento_ativo_id()
    ),
    jsonb_build_object('id_evento', NULL, 'nome_evento', NULL, 'url_icone', NULL, 'url_imagem_evento', NULL)
  );
$$;

COMMENT ON FUNCTION public.fn_identidade_visual() IS
  'Ícone e imagem do evento ativo. Pública: o cabeçalho e o login precisam dela sem sessão.';

REVOKE ALL ON FUNCTION public.fn_identidade_visual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_identidade_visual() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
