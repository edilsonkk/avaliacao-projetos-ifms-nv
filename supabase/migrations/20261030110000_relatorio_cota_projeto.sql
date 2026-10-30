-- ==============================================================================
-- MIGRATION: 20261030110000_relatorio_cota_projeto.sql
-- DESCRIÇÃO: fn_relatorio_projetos_completo devolve a cota de cada projeto.
--   * Os Indicadores dos Relatórios calculavam a meta como projetos com check-in
--     × cota padrão (contando os fora da competição e ignorando a cota
--     customizada) e a distribuição "Cota concluída" fixa em 3 avaliações. Com a
--     coluna nova `cota_avaliacoes` (customizada do projeto, senão a padrão do
--     evento, senão 3) a tela usa a mesma regra do Telão e do Mapa de Estandes.
--   * Mudar o tipo de retorno exige DROP + CREATE (na mesma transação). A
--     coluna nova vem no fim: o front anterior continua funcionando.
-- FRONT-END: compatível com a versão anterior.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.fn_relatorio_projetos_completo(uuid);

CREATE FUNCTION public.fn_relatorio_projetos_completo(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS TABLE(id_projeto uuid, id_evento uuid, codigo_projeto text, titulo text, estande text, corredor text, modalidade text, area_conhecimento text, nome_instituicao text, id_instituicao uuid, is_check_in_realizado boolean, is_fora_da_competicao boolean, total_avaliacoes integer, media_geral numeric, notas numeric[], detalhes_avaliacoes jsonb, cota_avaliacoes integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH avaliacoes_validas AS (
    SELECT a.id_avaliacao, a.id_projeto, a.id_usuario, u.nome AS avaliador_nome,
      round(a.nota_final::numeric, 2) AS nota_final,
      coalesce(a.parecer_final, '') AS parecer,
      coalesce(a.tempo_submissao, a.created_at) AS data
    FROM public.avaliacoes a
    JOIN public.usuarios u ON u.id_usuario = a.id_usuario
    WHERE a.status IS NULL OR a.status <> 'CANCELADA'
  )
  SELECT p.id_projeto, p.id_evento, p.codigo_projeto::text, p.titulo::text, p.estande::text, p.corredor::text,
    coalesce(m.nome_modalidade, 'Sem modalidade')::text,
    coalesce(ar.nome_area, 'Sem área temática')::text,
    coalesce(inst.nome_exibicao, 'Não informada')::text,
    p.id_instituicao,
    coalesce(p.is_check_in_realizado, false),
    coalesce(p.is_fora_da_competicao, false),
    count(av.id_avaliacao)::int,
    coalesce(round(avg(av.nota_final), 2), 0.00),
    coalesce(array_agg(av.nota_final ORDER BY av.data DESC) FILTER (WHERE av.nota_final IS NOT NULL), '{}'::numeric[]),
    coalesce(jsonb_agg(jsonb_build_object(
      'id_avaliacao', av.id_avaliacao, 'id_usuario', av.id_usuario, 'avaliador_nome', av.avaliador_nome,
      'nota_final', av.nota_final, 'parecer', av.parecer, 'data', av.data
    ) ORDER BY av.data DESC) FILTER (WHERE av.id_avaliacao IS NOT NULL), '[]'::jsonb),
    coalesce(p.cota_avaliacoes_customizada, ev.cota_avaliacoes_padrao, 3)::int
  FROM public.projetos p
  JOIN public.eventos ev ON ev.id_evento = p.id_evento
  LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
  LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
  LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
  LEFT JOIN avaliacoes_validas av ON av.id_projeto = p.id_projeto
  WHERE p.id_evento = p_id_evento
  GROUP BY p.id_projeto, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, ev.cota_avaliacoes_padrao
  ORDER BY p.codigo_projeto, p.id_projeto;
$$;

REVOKE ALL ON FUNCTION public.fn_relatorio_projetos_completo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_projetos_completo(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
