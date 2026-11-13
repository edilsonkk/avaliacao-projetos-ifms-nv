-- ==============================================================================
-- MIGRATION: 20261111020000_pareamento_padrao.sql
-- DESCRIÇÃO: pareamento pelo Staff como padrão; "ambos" sai de circulação.
--   * eventos.metodos_vinculo nascia 'ambos', ou seja, o celular do avaliador
--     oferecia as duas formas de vínculo ao mesmo tempo. A coordenação quer uma
--     forma por evento: ou pareamento pelo Staff, ou código de acesso. O padrão
--     passa a ser 'pareamento', que é o mais seguro (exige o avaliador presente
--     no balcão).
--   * Os eventos que ainda estavam em 'ambos' passam a 'pareamento'.
--   * fn_meu_perfil deixa de devolver 'ambos' como valor de reserva.
--   * O CHECK ck_eventos_metodos_vinculo CONTINUA aceitando 'ambos', e as funções
--     de pareamento e de código continuam tolerando o valor: é a regra de
--     expand/contract do AGENTS.md. A versão anterior do front-end ainda pode
--     gravar 'ambos' entre o db push e o deploy, e um CHECK restrito faria o
--     salvamento das configurações do evento falhar. Tirar o valor do CHECK é
--     migration de contract, para depois de uma release.
-- FRONT-END: compatível com a versão anterior (nada é removido do CHECK).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

ALTER TABLE public.eventos ALTER COLUMN metodos_vinculo SET DEFAULT 'pareamento';

COMMENT ON COLUMN public.eventos.metodos_vinculo IS
  'Forma de vincular o celular do avaliador: ''pareamento'' (padrão, o Staff digita o código mostrado no celular) ou ''codigo'' (o Staff gera um código de uso único). ''ambos'' é legado e não é mais oferecido na interface.';

-- Normalização: nenhum evento fica em 'ambos'. WHERE obrigatório (regra 7 do AGENTS.md).
UPDATE public.eventos
   SET metodos_vinculo = 'pareamento'
 WHERE metodos_vinculo = 'ambos';

-- fn_meu_perfil: o valor de reserva passa a ser 'pareamento' (idêntica no resto).
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
    'metodos_vinculo', coalesce(v_evento.metodos_vinculo, 'pareamento'),
    -- Sessão de Admin/Staff neste navegador: a tela do avaliador precisa de uma sessão só do aparelho
    'sessao_equipe',   public.sessao_de_conta_da_equipe()
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
