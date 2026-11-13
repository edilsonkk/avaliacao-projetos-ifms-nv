-- ==============================================================================
-- MIGRATION: 20261112010000_situacao_do_projeto_no_banco.sql
-- DESCRIÇÃO: cota, vagas, média e quarentena de cada projeto saem do navegador e
--   passam a ter uma fonte única no banco (ADR 0001).
--   O Mapa de Estandes e a Atribuição Forçada liam `avaliacoes` e `locks_ativos`
--   crus e refaziam a conta em JavaScript. Com o voto popular, essa conta diverge
--   da do sorteio: um voto popular não ocupa vaga, não entra na média técnica e a
--   trava de um votante não impede o avaliador técnico. Resultado: estande verde
--   com vaga livre, vaga de banca a menos e média com voto popular misturado.
--   * fn_projetos_situacao: um registro por projeto do evento com a MESMA regra de
--     fn_vagas_projeto e de sortear_proximo_projeto — avaliações ativas (não
--     canceladas) e travas não vencidas, as duas só de nota técnica, contra a cota
--     do projeto. É a versão por evento, numa consulta só, para a tela não repetir
--     fn_vagas_projeto centenas de vezes.
--   * Admin apenas: a função é SECURITY DEFINER e o Staff não lê `avaliacoes`
--     (rls_avaliacoes_leitura). Sem o IF, o Staff receberia média e notas.
-- FRONT-END: compatível com a versão anterior (função nova; nada muda de assinatura).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_projetos_situacao(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  id_projeto uuid,
  cota integer,
  avaliacoes_tecnicas integer,
  travas_tecnicas integer,
  vagas_restantes integer,
  media_tecnica numeric,
  notas_tecnicas numeric[],
  votos_populares integer,
  media_voto_popular numeric,
  em_quarentena boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cota_padrao integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_id_evento IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(e.cota_avaliacoes_padrao, 3) INTO v_cota_padrao
  FROM public.eventos e WHERE e.id_evento = p_id_evento;
  v_cota_padrao := coalesce(v_cota_padrao, 3);

  RETURN QUERY
  WITH notas AS (
    SELECT a.id_projeto,
      count(*) FILTER (WHERE NOT a.is_voto_popular)::int AS tecnicas,
      round(avg(a.nota_final) FILTER (WHERE NOT a.is_voto_popular), 2) AS media_tec,
      array_agg(round(a.nota_final, 2) ORDER BY coalesce(a.tempo_submissao, a.created_at) DESC)
        FILTER (WHERE NOT a.is_voto_popular AND a.nota_final IS NOT NULL) AS notas_tec,
      count(*) FILTER (WHERE a.is_voto_popular)::int AS populares,
      round(avg(a.nota_final) FILTER (WHERE a.is_voto_popular), 2) AS media_pop
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    WHERE p.id_evento = p_id_evento
      AND (a.status IS NULL OR a.status <> 'CANCELADA')
    GROUP BY a.id_projeto
  ),
  -- Travas vencidas não ocupam vaga (o sorteio as apaga antes de contar). Mesma
  -- condição de fn_vagas_projeto, que é a conta oficial de vaga de um projeto só.
  travas AS (
    SELECT l.id_projeto, count(*) FILTER (WHERE NOT l.is_voto_popular)::int AS tecnicas
    FROM public.locks_ativos l
    JOIN public.projetos p ON p.id_projeto = l.id_projeto
    WHERE p.id_evento = p_id_evento
      AND l.expira_em > now()
    GROUP BY l.id_projeto
  ),
  quarentena AS (
    SELECT q.id_projeto FROM public.view_projetos_quarentena q WHERE q.id_evento = p_id_evento
  )
  SELECT p.id_projeto,
    coalesce(p.cota_avaliacoes_customizada, v_cota_padrao)::int,
    coalesce(n.tecnicas, 0),
    coalesce(t.tecnicas, 0),
    greatest(coalesce(p.cota_avaliacoes_customizada, v_cota_padrao) - (coalesce(n.tecnicas, 0) + coalesce(t.tecnicas, 0)), 0)::int,
    n.media_tec,
    coalesce(n.notas_tec, '{}'::numeric[]),
    coalesce(n.populares, 0),
    n.media_pop,
    (q.id_projeto IS NOT NULL)
  FROM public.projetos p
  LEFT JOIN notas n ON n.id_projeto = p.id_projeto
  LEFT JOIN travas t ON t.id_projeto = p.id_projeto
  LEFT JOIN quarentena q ON q.id_projeto = p.id_projeto
  WHERE p.id_evento = p_id_evento
  ORDER BY p.codigo_projeto, p.id_projeto;
END;
$$;

COMMENT ON FUNCTION public.fn_projetos_situacao(uuid) IS
  'Situação de cada projeto do evento pela regra do sorteio: cota, avaliações técnicas ativas, travas técnicas não vencidas, vagas restantes, média e notas técnicas, voto popular e quarentena. Fonte única do Mapa de Estandes e da Atribuição Forçada — o voto popular não ocupa vaga nem entra na média técnica. Restrita ao Admin.';

REVOKE ALL ON FUNCTION public.fn_projetos_situacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_situacao(uuid) TO authenticated, service_role;

COMMIT;
