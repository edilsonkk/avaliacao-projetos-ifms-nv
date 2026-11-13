-- ==============================================================================
-- MIGRATION: 20261111010000_relatorio_devolucoes.sql
-- DESCRIÇÃO: relatório "Avaliadores e Devoluções Atribuídas".
--   * O botão "Devolver (Conflito de Interesse)" da tela do avaliador grava
--     historico_impedimentos com tipo = 'conflito' (fn_registrar_impedimento) e
--     devolve o projeto à fila. Esses registros não apareciam em relatório
--     nenhum: fn_relatorio_ausencias_completo filtra só tipo = 'ausencia', então
--     a coordenação não tinha como saber quantas devoluções cada avaliador fez.
--   * fn_relatorio_devolucoes_completo é a irmã dela para tipo = 'conflito':
--     mesma forma, mesmas permissões, agrupada por avaliador.
-- FRONT-END: compatível com a versão anterior (função nova, nada é alterado).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_relatorio_devolucoes_completo(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS TABLE(id_usuario uuid, avaliador_nome text, avaliador_email text, total_devolucoes integer, devolucoes jsonb)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH devolucoes_enriquecidas AS (
    SELECT hi.id_usuario, u.nome AS avaliador_nome, u.email AS avaliador_email,
      p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo AS projeto_titulo, p.estande AS projeto_estande,
      coalesce(m.nome_modalidade, 'Sem modalidade') AS projeto_modalidade,
      coalesce(ar.nome_area, 'Sem área temática') AS projeto_area,
      coalesce(inst.nome_exibicao, 'Não informada') AS projeto_instituicao,
      hi.created_at AS data_devolucao,
      (SELECT count(*)::int FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto AND (av.status IS NULL OR av.status <> 'CANCELADA')) AS total_avaliacoes_atuais
    FROM public.historico_impedimentos hi
    JOIN public.usuarios u ON u.id_usuario = hi.id_usuario
    JOIN public.projetos p ON p.id_projeto = hi.id_projeto
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    WHERE hi.tipo = 'conflito'
      AND p.id_evento = p_id_evento
  )
  SELECT de.id_usuario, de.avaliador_nome::text, de.avaliador_email::text,
    count(de.id_projeto)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'id_projeto', de.id_projeto, 'id_evento', de.id_evento, 'codigo_projeto', de.codigo_projeto,
      'projeto_titulo', de.projeto_titulo, 'projeto_estande', de.projeto_estande,
      'projeto_modalidade', de.projeto_modalidade, 'projeto_area', de.projeto_area,
      'projeto_instituicao', de.projeto_instituicao, 'data_devolucao', de.data_devolucao,
      'total_avaliacoes_atuais', de.total_avaliacoes_atuais
    ) ORDER BY de.data_devolucao DESC), '[]'::jsonb)
  FROM devolucoes_enriquecidas de
  GROUP BY de.id_usuario, de.avaliador_nome, de.avaliador_email
  ORDER BY de.avaliador_nome, de.id_usuario;
$$;

COMMENT ON FUNCTION public.fn_relatorio_devolucoes_completo(uuid) IS
  'Devoluções por conflito de interesse (historico_impedimentos.tipo = ''conflito'') agrupadas por avaliador, no evento informado.';

REVOKE ALL ON FUNCTION public.fn_relatorio_devolucoes_completo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_devolucoes_completo(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
