-- ==============================================================================
-- MIGRATION: 20261029240000_excluir_restaurar_avaliacao.sql
-- DESCRIÇÃO: Cancelar e restaurar avaliação (card "Excluir uma avaliação").
--   * Quarentena: fn_enviar_avaliacao marca TODAS as avaliações do projeto quando a
--     divergência passa de 2,5. excluir_avaliacao só desmarcava a cancelada: as
--     outras continuavam marcadas e o projeto seguia em quarentena mesmo depois de
--     cancelar a nota fora da curva. Agora as duas funções recalculam a marcação do
--     projeto (fn_recalcular_quarentena), com a mesma regra da view, inclusive a
--     divergência já aceita pelo Admin (projetos.quarentena_resolvida_em).
--   * Cota: restaurar_avaliacao não olhava a cota. Se a vaga liberada pelo
--     cancelamento já foi ocupada (outra avaliação ou trava válida), restaurar
--     deixava o projeto acima da cota e distorcia o ranking. Agora recusa e explica.
--   * Auditoria: avaliacoes.cancelada_em / cancelada_por.
--   Assinaturas e retorno (jsonb com sucesso/mensagem) mantidos: compatível com a
--   versão anterior do front-end.
-- PRÉ-REQUISITO: 20261029220000_resolver_quarentena.sql e 20261029235000_remover_fk_ambiguas.sql.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

ALTER TABLE public.avaliacoes ADD COLUMN IF NOT EXISTS cancelada_em timestamptz;
ALTER TABLE public.avaliacoes ADD COLUMN IF NOT EXISTS cancelada_por uuid;

COMMENT ON COLUMN public.avaliacoes.cancelada_em IS 'Quando o Admin cancelou a avaliação (soft delete). NULL se ativa.';
-- Sem FK de propósito: avaliacoes já tem id_usuario -> usuarios e uma 2ª FK quebraria o embed usuarios(...)
-- do PostgREST (regra 12 de docs/banco-de-dados/migrations.md).
COMMENT ON COLUMN public.avaliacoes.cancelada_por IS 'Admin (usuarios.id_usuario) que cancelou a avaliação. Sem FK de propósito (embed do PostgREST).';

-- ------------------------------------------------------------------------------
-- Marcação de quarentena do projeto, com a mesma regra da view_projetos_quarentena
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_quarentena(p_id_projeto uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_em_quarentena boolean;
BEGIN
  SELECT count(*) >= 2
         AND max(a.nota_final) - min(a.nota_final) > 2.5
         AND (p.quarentena_resolvida_em IS NULL OR max(a.created_at) > p.quarentena_resolvida_em)
    INTO v_em_quarentena
  FROM public.projetos p
  JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
  WHERE p.id_projeto = p_id_projeto
  GROUP BY p.quarentena_resolvida_em;

  v_em_quarentena := coalesce(v_em_quarentena, false);

  UPDATE public.avaliacoes
  SET is_quarentena = (v_em_quarentena AND (status IS NULL OR status <> 'CANCELADA'))
  WHERE id_projeto = p_id_projeto
    AND is_quarentena IS DISTINCT FROM (v_em_quarentena AND (status IS NULL OR status <> 'CANCELADA'));

  RETURN v_em_quarentena;
END;
$$;

-- ------------------------------------------------------------------------------
-- Cancelar (soft delete)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_avaliacao(p_id_avaliacao uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_projeto uuid;
  v_id_usuario uuid;
  v_status_antigo varchar;
  v_quarentena boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id_projeto, id_usuario, status INTO v_id_projeto, v_id_usuario, v_status_antigo
  FROM public.avaliacoes WHERE id_avaliacao = p_id_avaliacao FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Avaliação não encontrada no sistema.');
  END IF;

  UPDATE public.avaliacoes
  SET status = 'CANCELADA',
      status_avaliacao = 'CANCELADA',
      is_quarentena = false,
      cancelada_em = coalesce(cancelada_em, now()),
      cancelada_por = coalesce(cancelada_por, (SELECT u.id_usuario FROM public.usuarios u
                                               WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1))
  WHERE id_avaliacao = p_id_avaliacao;

  v_quarentena := public.fn_recalcular_quarentena(v_id_projeto);

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', p_id_avaliacao,
    'id_projeto', v_id_projeto,
    'id_usuario', v_id_usuario,
    'status_anterior', v_status_antigo,
    'novo_status', 'CANCELADA',
    'projeto_em_quarentena', v_quarentena,
    'mensagem', 'Avaliação cancelada com sucesso.'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- Restaurar (desfazer o cancelamento), respeitando a cota
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restaurar_avaliacao(p_id_avaliacao uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_projeto uuid;
  v_id_usuario uuid;
  v_status varchar;
  v_cota integer;
  v_ocupadas integer;
  v_codigo text;
  v_quarentena boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id_projeto, id_usuario, status INTO v_id_projeto, v_id_usuario, v_status
  FROM public.avaliacoes WHERE id_avaliacao = p_id_avaliacao;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Avaliação não encontrada no sistema.');
  END IF;

  -- Serializa com o sorteio e a atribuição do mesmo projeto
  SELECT coalesce(p.codigo_projeto, p.titulo), coalesce(p.cota_avaliacoes_customizada, e.cota_avaliacoes_padrao, 3)
    INTO v_codigo, v_cota
  FROM public.projetos p LEFT JOIN public.eventos e ON e.id_evento = p.id_evento
  WHERE p.id_projeto = v_id_projeto
  FOR UPDATE OF p;

  IF v_status IS DISTINCT FROM 'CANCELADA' THEN
    RETURN jsonb_build_object('sucesso', true, 'id_avaliacao', p_id_avaliacao, 'novo_status', v_status,
                              'mensagem', 'A avaliação já estava ativa.');
  END IF;

  SELECT (SELECT count(*) FROM public.avaliacoes a
          WHERE a.id_projeto = v_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA'))::int
       + (SELECT count(*) FROM public.locks_ativos l
          WHERE l.id_projeto = v_id_projeto AND l.expira_em > now() AND l.id_usuario <> v_id_usuario)::int
    INTO v_ocupadas;

  IF v_ocupadas >= v_cota THEN
    RAISE EXCEPTION 'O projeto % já está com a cota completa (% de % vagas ocupadas). Cancele outra avaliação dele antes de restaurar esta.',
      v_codigo, v_ocupadas, v_cota USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.avaliacoes
  SET status = 'CONCLUIDA',
      status_avaliacao = 'concluida',
      cancelada_em = NULL,
      cancelada_por = NULL
  WHERE id_avaliacao = p_id_avaliacao;

  v_quarentena := public.fn_recalcular_quarentena(v_id_projeto);

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', p_id_avaliacao,
    'id_projeto', v_id_projeto,
    'id_usuario', v_id_usuario,
    'novo_status', 'CONCLUIDA',
    'projeto_em_quarentena', v_quarentena,
    'mensagem', 'Avaliação restaurada com sucesso.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recalcular_quarentena(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.excluir_avaliacao(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurar_avaliacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_avaliacao(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restaurar_avaliacao(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
