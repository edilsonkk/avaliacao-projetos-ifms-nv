-- ==============================================================================
-- MIGRATION: 20261111040000_voto_popular_estrutura.sql
-- DESCRIÇÃO: estrutura do voto popular (parte 1 de 3).
--   O voto popular é uma avaliação que NÃO entra na média técnica do projeto, não
--   ocupa cota, não aciona quarentena, não entra no ranking técnico nem na meta do
--   Telão e não fixa o questionário do projeto. Ele tem média, ranking e relatório
--   próprios (migrations seguintes).
--   * questionarios.is_voto_popular: a marca, definida pelo Admin. É ela que
--     classifica a nota — não o avaliador —, então a classificação fica gravada no
--     histórico e não muda se o vínculo de alguém mudar depois.
--   * avaliacoes.is_voto_popular: denormalizada, mantida por trigger BEFORE a
--     partir do questionário da avaliação. Congela a classificação e evita um join
--     em cada contagem de nota, cota e média do sistema.
--   * avaliadores_evento.id_questionario: vínculo opcional. O avaliador vinculado
--     sempre usa aquele questionário e não escolhe nada no celular.
--   * locks_ativos.is_voto_popular: para o sorteio técnico desconsiderar a trava
--     de um votante (vários votantes podem estar no mesmo projeto) sem precisar de
--     um join a cada sorteio.
--   * RPCs NOVAS para gravar a marca e o vínculo. admin_salvar_questionario e
--     admin_atualizar_avaliador NÃO mudam de assinatura: acrescentar parâmetro
--     criaria sobrecarga (PGRST203) e o DROP derrubaria a versão anterior do
--     front-end entre o db push e o deploy.
-- FRONT-END: compatível com a versão anterior (colunas com DEFAULT, funções novas).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Colunas
-- ------------------------------------------------------------------------------
ALTER TABLE public.questionarios
  ADD COLUMN IF NOT EXISTS is_voto_popular boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.questionarios.is_voto_popular IS
  'Questionário de voto popular: as notas dadas por ele não entram na média técnica, na cota, na quarentena, no ranking técnico nem na meta do Telão. Não pode ser alterada depois de o questionário ter avaliação.';

ALTER TABLE public.avaliacoes
  ADD COLUMN IF NOT EXISTS is_voto_popular boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.avaliacoes.is_voto_popular IS
  'Cópia de questionarios.is_voto_popular no momento da nota, mantida por trigger. Congela a classificação: média já publicada não muda se a marca do questionário for alterada.';

ALTER TABLE public.avaliadores_evento
  ADD COLUMN IF NOT EXISTS id_questionario uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'avaliadores_evento_id_questionario_fkey'
  ) THEN
    ALTER TABLE public.avaliadores_evento
      ADD CONSTRAINT avaliadores_evento_id_questionario_fkey
      FOREIGN KEY (id_questionario) REFERENCES public.questionarios(id_questionario) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_avaliadores_evento_questionario
  ON public.avaliadores_evento (id_evento, id_questionario);
COMMENT ON COLUMN public.avaliadores_evento.id_questionario IS
  'Questionário fixo deste avaliador no evento. Vazio: usa o questionário técnico do projeto. Apontando para um questionário de voto popular, o avaliador é um votante.';

ALTER TABLE public.locks_ativos
  ADD COLUMN IF NOT EXISTS is_voto_popular boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.locks_ativos.is_voto_popular IS
  'A reserva é de um votante do voto popular. O sorteio técnico a desconsidera (um votante no estande não impede o avaliador técnico, e vice-versa).';

-- ------------------------------------------------------------------------------
-- 2. Trigger: a avaliação nasce classificada pelo questionário que usou
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.avaliacao_classificar_voto_popular()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Sem questionário (linha legada), continua sendo nota técnica.
  NEW.is_voto_popular := coalesce(
    (SELECT q.is_voto_popular FROM public.questionarios q WHERE q.id_questionario = NEW.id_questionario),
    false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_avaliacao_classificar_voto_popular ON public.avaliacoes;
CREATE TRIGGER trg_avaliacao_classificar_voto_popular
  BEFORE INSERT OR UPDATE OF id_questionario ON public.avaliacoes
  FOR EACH ROW EXECUTE FUNCTION public.avaliacao_classificar_voto_popular();

-- Backfill: nenhuma linha hoje (não existe questionário de voto popular), mas deixa
-- a migration correta se for reaplicada depois de a marca existir.
UPDATE public.avaliacoes a
   SET is_voto_popular = true
  FROM public.questionarios q
 WHERE q.id_questionario = a.id_questionario
   AND q.is_voto_popular
   AND NOT a.is_voto_popular;

-- ------------------------------------------------------------------------------
-- 3. Quem é votante: um lugar só, usado pelo envio e pelo sorteio
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.questionario_do_avaliador(p_id_usuario uuid, p_id_evento uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ae.id_questionario
  FROM public.avaliadores_evento ae
  WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = p_id_evento;
$$;
COMMENT ON FUNCTION public.questionario_do_avaliador(uuid, uuid) IS
  'Questionário vinculado ao avaliador no evento, ou NULL quando ele usa o questionário do projeto.';

CREATE OR REPLACE FUNCTION public.avaliador_e_voto_popular(p_id_usuario uuid, p_id_evento uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT q.is_voto_popular
    FROM public.avaliadores_evento ae
    JOIN public.questionarios q ON q.id_questionario = ae.id_questionario
    WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = p_id_evento
  ), false);
$$;
COMMENT ON FUNCTION public.avaliador_e_voto_popular(uuid, uuid) IS
  'true quando o avaliador está vinculado a um questionário de voto popular no evento (é um votante).';

-- ------------------------------------------------------------------------------
-- 4. Escrita da marca e do vínculo: RPCs novas, assinaturas antigas intactas
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_marcar_questionario_voto_popular(
  p_id_questionario uuid,
  p_is_voto_popular boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_atual boolean;
  v_usos  integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT is_voto_popular INTO v_atual
  FROM public.questionarios WHERE id_questionario = p_id_questionario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionário não encontrado.';
  END IF;

  IF v_atual IS DISTINCT FROM coalesce(p_is_voto_popular, false) THEN
    v_usos := public.fn_avaliacoes_do_questionario(p_id_questionario);
    IF v_usos > 0 THEN
      RAISE EXCEPTION 'Este questionário já foi usado em % avaliação(ões): mudar a marca de voto popular agora reclassificaria notas já lançadas e alteraria médias publicadas.', v_usos
        USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM public.auditoria_marcar_origem('admin_marcar_questionario_voto_popular', NULL);
  UPDATE public.questionarios
     SET is_voto_popular = coalesce(p_is_voto_popular, false)
   WHERE id_questionario = p_id_questionario;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_vincular_questionario_avaliador(
  p_id_usuario uuid,
  p_id_evento uuid,
  p_id_questionario uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_id_evento IS NULL THEN
    RAISE EXCEPTION 'Informe o evento do vínculo.' USING ERRCODE = '22023';
  END IF;

  IF p_id_questionario IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.questionarios q
    WHERE q.id_questionario = p_id_questionario AND q.id_evento = p_id_evento
  ) THEN
    RAISE EXCEPTION 'O questionário precisa ser do mesmo evento do avaliador.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.avaliadores_evento ae
    WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = p_id_evento
  ) THEN
    RAISE EXCEPTION 'Avaliador não está no evento.' USING ERRCODE = '42501';
  END IF;

  PERFORM public.auditoria_marcar_origem('admin_vincular_questionario_avaliador', NULL);
  UPDATE public.avaliadores_evento
     SET id_questionario = p_id_questionario
   WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;
END;
$$;

REVOKE ALL ON FUNCTION public.questionario_do_avaliador(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.avaliador_e_voto_popular(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_marcar_questionario_voto_popular(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_vincular_questionario_avaliador(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.questionario_do_avaliador(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.avaliador_e_voto_popular(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_marcar_questionario_voto_popular(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_vincular_questionario_avaliador(uuid, uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
