-- ==============================================================================
-- MIGRATION: 20261111080000_voto_popular_perfil_da_sessao.sql
-- DESCRIÇÃO: fn_meu_perfil informa o questionário vinculado ao avaliador.
--   A tela do avaliador precisa saber, antes de pedir projeto, se ela deve abrir
--   direto num questionário (e se ele é de voto popular) ou oferecer a escolha.
--   Vem por fn_meu_perfil, que é SECURITY DEFINER: não depende de RLS de
--   avaliadores_evento nem de uma leitura a mais no celular.
-- FRONT-END: compatível com a versão anterior (duas chaves novas no jsonb).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

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
  v_quest   uuid;
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
      v_quest := public.questionario_do_avaliador(v_usuario.id_usuario, v_evento.id_evento);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'autenticado',     auth.uid() IS NOT NULL,
    'papel',           v_papel,
    'id_usuario',      v_usuario.id_usuario,
    'nome',            v_usuario.nome,
    'email',           v_usuario.email,
    'id_evento',       v_evento.id_evento,
    'metodos_vinculo', coalesce(v_evento.metodos_vinculo, 'pareamento'),
    -- Trava do questionário no primeiro avaliador: decide se o celular oferece a escolha
    'fixar_questionario', coalesce(v_evento.fixar_questionario_primeira_avaliacao, true),
    -- Questionário vinculado a este avaliador no evento (NULL: usa o do projeto)
    'id_questionario_vinculado', v_quest,
    'voto_popular', CASE WHEN v_quest IS NULL THEN false
                         ELSE coalesce((SELECT q.is_voto_popular FROM public.questionarios q
                                        WHERE q.id_questionario = v_quest), false) END,
    -- Sessão de Admin/Staff neste navegador: a tela do avaliador precisa de uma sessão só do aparelho
    'sessao_equipe',   public.sessao_de_conta_da_equipe()
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
