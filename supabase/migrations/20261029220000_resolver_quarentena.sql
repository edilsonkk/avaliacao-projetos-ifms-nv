-- ==============================================================================
-- MIGRATION: 20261029220000_resolver_quarentena.sql
-- DESCRIÇÃO: "Tirar de quarentena" passa a valer de verdade.
--   view_projetos_quarentena lista o projeto se alguma avaliação tem
--   is_quarentena = true OU se a diferença entre a maior e a menor nota passa
--   de 2,5. admin_remover_quarentena só zerava a flag: a divergência continuava
--   e o projeto voltava para a lista (e para o contador do painel) no próximo
--   carregamento.
--   * projetos.quarentena_resolvida_em / quarentena_resolvida_por: registram que
--     o Admin analisou e aceitou a divergência (auditoria).
--   * A view ignora a divergência de projetos resolvidos, até chegar uma
--     avaliação NOVA (created_at depois da resolução): aí ele volta sozinho.
--   * admin_remover_quarentena(p_id_projeto) e admin_remover_quarentena_todos()
--     registram a resolução. admin_remover_quarentena_evento(p_id_evento) faz o
--     mesmo só para o evento ativo (usada pela tela).
--   * A view deixa de ser concedida ao anon (já era security_invoker; o anon
--     não lê as tabelas de origem, então nada vazava).
-- FRONT-END: compatível com a versão anterior (mesmas assinaturas; colunas novas
--   no fim da view).
-- PRÉ-REQUISITO: public.is_admin() (20261026000000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

ALTER TABLE public.projetos ADD COLUMN IF NOT EXISTS quarentena_resolvida_em timestamptz;
ALTER TABLE public.projetos ADD COLUMN IF NOT EXISTS quarentena_resolvida_por uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projetos_quarentena_resolvida_por_fkey' AND conrelid = 'public.projetos'::regclass
  ) THEN
    ALTER TABLE public.projetos
      ADD CONSTRAINT projetos_quarentena_resolvida_por_fkey
      FOREIGN KEY (quarentena_resolvida_por) REFERENCES public.usuarios(id_usuario) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.projetos.quarentena_resolvida_em IS
  'Quando o Admin aceitou a divergência de notas. Avaliação nova depois disso reabre a quarentena.';
COMMENT ON COLUMN public.projetos.quarentena_resolvida_por IS 'Admin (usuarios.id_usuario) que resolveu a quarentena.';

-- ------------------------------------------------------------------------------
-- View: mesmas colunas e ordem (compatível), duas colunas novas no fim
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_projetos_quarentena WITH (security_invoker = true) AS
SELECT p.id_projeto,
       p.codigo_projeto,
       p.titulo,
       p.estande,
       p.corredor,
       COALESCE(m.nome_modalidade, 'Geral'::character varying) AS modalidade,
       COALESCE(ar.nome_area, 'Multidisciplinar'::character varying) AS area_tematica,
       COALESCE(inst.nome_exibicao, 'Não informada'::character varying) AS nome_instituicao,
       p.id_evento,
       count(a.id_avaliacao) AS total_avaliacoes,
       round(min(a.nota_final), 2) AS nota_minima,
       round(max(a.nota_final), 2) AS nota_maxima,
       round(max(a.nota_final) - min(a.nota_final), 2) AS diferenca_notas,
       bool_or(COALESCE(a.is_quarentena, false)) AS tem_flag_quarentena,
       p.quarentena_resolvida_em,
       max(a.created_at) AS ultima_avaliacao_em
FROM public.projetos p
LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
LEFT JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status::text <> 'CANCELADA')
GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area,
         inst.nome_exibicao, p.id_evento, p.quarentena_resolvida_em
HAVING bool_or(COALESCE(a.is_quarentena, false))
    OR (count(a.id_avaliacao) >= 2
        AND max(a.nota_final) - min(a.nota_final) > 2.5
        AND (p.quarentena_resolvida_em IS NULL OR max(a.created_at) > p.quarentena_resolvida_em));

REVOKE ALL ON public.view_projetos_quarentena FROM anon;
GRANT SELECT ON public.view_projetos_quarentena TO authenticated;

-- ------------------------------------------------------------------------------
-- Funções de resolução (Admin)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_remover_quarentena(p_id_projeto uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.avaliacoes SET is_quarentena = false WHERE id_projeto = p_id_projeto AND is_quarentena;
  UPDATE public.projetos
  SET quarentena_resolvida_em = now(),
      quarentena_resolvida_por = (SELECT u.id_usuario FROM public.usuarios u
                                  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1)
  WHERE id_projeto = p_id_projeto;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remover_quarentena_evento(p_id_evento uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_projetos uuid[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(id_projeto), '{}') INTO v_projetos
  FROM public.view_projetos_quarentena WHERE id_evento = p_id_evento;

  UPDATE public.avaliacoes SET is_quarentena = false WHERE id_projeto = ANY (v_projetos) AND is_quarentena;
  UPDATE public.projetos
  SET quarentena_resolvida_em = now(),
      quarentena_resolvida_por = (SELECT u.id_usuario FROM public.usuarios u
                                  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1)
  WHERE id_projeto = ANY (v_projetos);
  RETURN cardinality(v_projetos);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remover_quarentena_todos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_projetos uuid[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(id_projeto), '{}') INTO v_projetos FROM public.view_projetos_quarentena;

  UPDATE public.avaliacoes SET is_quarentena = false WHERE id_projeto = ANY (v_projetos) AND is_quarentena;
  UPDATE public.projetos
  SET quarentena_resolvida_em = now(),
      quarentena_resolvida_por = (SELECT u.id_usuario FROM public.usuarios u
                                  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1)
  WHERE id_projeto = ANY (v_projetos);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remover_quarentena(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_remover_quarentena_evento(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_remover_quarentena_todos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena_evento(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remover_quarentena_todos() TO authenticated, service_role;

COMMIT;
