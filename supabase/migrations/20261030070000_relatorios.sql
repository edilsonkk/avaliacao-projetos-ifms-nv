-- ==============================================================================
-- MIGRATION: 20261030070000_relatorios.sql
-- DESCRIÇÃO: funções de relatório que funcionam.
--   * fn_relatorio_projetos_completo, fn_relatorio_avaliadores_completo e
--     fn_relatorio_ausencias_completo liam p.modalidade, p.area_conhecimento e
--     p.nome_instituicao, colunas que não existem em projetos. Como eram
--     plpgsql, o erro só aparecia na execução (42703) e a tela de Relatórios
--     caía em consultas alternativas, silenciosamente. Agora são LANGUAGE sql
--     (as colunas são conferidas ao criar a função) e usam os relacionamentos.
--   * Sem modalidade/área: "Sem modalidade"/"Sem área temática" (não "Geral"/
--     "Multidisciplinar"). Check-in nulo não é mais presumido como feito.
--   * p_id_evento é obrigatório na prática: nulo não devolve nada (antes
--     devolvia todos os eventos misturados).
-- FRONT-END: compatível com a versão anterior (mesmas assinaturas e colunas).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_relatorio_projetos_completo(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS TABLE(id_projeto uuid, id_evento uuid, codigo_projeto text, titulo text, estande text, corredor text, modalidade text, area_conhecimento text, nome_instituicao text, id_instituicao uuid, is_check_in_realizado boolean, is_fora_da_competicao boolean, total_avaliacoes integer, media_geral numeric, notas numeric[], detalhes_avaliacoes jsonb)
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
    ) ORDER BY av.data DESC) FILTER (WHERE av.id_avaliacao IS NOT NULL), '[]'::jsonb)
  FROM public.projetos p
  LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
  LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
  LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
  LEFT JOIN avaliacoes_validas av ON av.id_projeto = p.id_projeto
  WHERE p.id_evento = p_id_evento
  GROUP BY p.id_projeto, m.nome_modalidade, ar.nome_area, inst.nome_exibicao
  ORDER BY p.codigo_projeto, p.id_projeto;
$$;

CREATE OR REPLACE FUNCTION public.fn_relatorio_avaliadores_completo(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS TABLE(id_usuario uuid, avaliador_nome text, avaliador_email text, total_avaliacoes integer, media_notas numeric, tempo_medio_segundos integer, avaliacoes jsonb)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH avaliacoes_enriquecidas AS (
    SELECT a.id_avaliacao, a.id_usuario, u.nome AS avaliador_nome, u.email AS avaliador_email,
      p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo AS projeto_titulo, p.estande AS projeto_estande,
      coalesce(m.nome_modalidade, 'Sem modalidade') AS projeto_modalidade,
      coalesce(ar.nome_area, 'Sem área temática') AS projeto_area,
      round(a.nota_final::numeric, 2) AS nota_final,
      coalesce(a.parecer_final, '') AS parecer_comentario,
      a.tempo_presenca,
      coalesce(a.tempo_submissao, a.created_at) AS tempo_submissao,
      a.created_at AS data_avaliacao,
      -- tempo_presenca é texto: só converte o que tem cara de data ISO (um valor ruim não derruba o relatório)
      CASE
        WHEN a.tempo_presenca ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
         AND coalesce(a.tempo_submissao, a.created_at) > a.tempo_presenca::timestamptz
        THEN extract(epoch FROM (coalesce(a.tempo_submissao, a.created_at) - a.tempo_presenca::timestamptz))::int
        ELSE 0
      END AS duracao_segundos
    FROM public.avaliacoes a
    JOIN public.usuarios u ON u.id_usuario = a.id_usuario
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    WHERE (a.status IS NULL OR a.status <> 'CANCELADA')
      AND p.id_evento = p_id_evento
  )
  SELECT ae.id_usuario, ae.avaliador_nome::text, ae.avaliador_email::text,
    count(ae.id_avaliacao)::int,
    coalesce(round(avg(ae.nota_final), 2), 0.00),
    coalesce(round(avg(ae.duracao_segundos) FILTER (WHERE ae.duracao_segundos > 0))::int, 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id_avaliacao', ae.id_avaliacao, 'id_projeto', ae.id_projeto, 'id_evento', ae.id_evento,
      'codigo_projeto', ae.codigo_projeto, 'projeto_titulo', ae.projeto_titulo, 'projeto_estande', ae.projeto_estande,
      'projeto_modalidade', ae.projeto_modalidade, 'projeto_area', ae.projeto_area, 'nota_final', ae.nota_final,
      'parecer_comentario', ae.parecer_comentario, 'tempo_presenca', ae.tempo_presenca,
      'tempo_submissao', ae.tempo_submissao, 'data_avaliacao', ae.data_avaliacao, 'duracao_segundos', ae.duracao_segundos
    ) ORDER BY ae.data_avaliacao DESC), '[]'::jsonb)
  FROM avaliacoes_enriquecidas ae
  GROUP BY ae.id_usuario, ae.avaliador_nome, ae.avaliador_email
  ORDER BY ae.avaliador_nome, ae.id_usuario;
$$;

CREATE OR REPLACE FUNCTION public.fn_relatorio_ausencias_completo(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS TABLE(id_usuario uuid, avaliador_nome text, avaliador_email text, total_ausencias integer, ausencias jsonb)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ausencias_enriquecidas AS (
    SELECT hi.id_usuario, u.nome AS avaliador_nome, u.email AS avaliador_email,
      p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo AS projeto_titulo, p.estande AS projeto_estande,
      coalesce(m.nome_modalidade, 'Sem modalidade') AS projeto_modalidade,
      coalesce(ar.nome_area, 'Sem área temática') AS projeto_area,
      coalesce(inst.nome_exibicao, 'Não informada') AS projeto_instituicao,
      hi.created_at AS data_ausencia,
      (SELECT count(*)::int FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto AND (av.status IS NULL OR av.status <> 'CANCELADA')) AS total_avaliacoes_atuais
    FROM public.historico_impedimentos hi
    JOIN public.usuarios u ON u.id_usuario = hi.id_usuario
    JOIN public.projetos p ON p.id_projeto = hi.id_projeto
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    WHERE hi.tipo = 'ausencia'
      AND p.id_evento = p_id_evento
  )
  SELECT ae.id_usuario, ae.avaliador_nome::text, ae.avaliador_email::text,
    count(ae.id_projeto)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'id_projeto', ae.id_projeto, 'id_evento', ae.id_evento, 'codigo_projeto', ae.codigo_projeto,
      'projeto_titulo', ae.projeto_titulo, 'projeto_estande', ae.projeto_estande,
      'projeto_modalidade', ae.projeto_modalidade, 'projeto_area', ae.projeto_area,
      'projeto_instituicao', ae.projeto_instituicao, 'data_ausencia', ae.data_ausencia,
      'total_avaliacoes_atuais', ae.total_avaliacoes_atuais
    ) ORDER BY ae.data_ausencia DESC), '[]'::jsonb)
  FROM ausencias_enriquecidas ae
  GROUP BY ae.id_usuario, ae.avaliador_nome, ae.avaliador_email
  ORDER BY ae.avaliador_nome, ae.id_usuario;
$$;

REVOKE ALL ON FUNCTION public.fn_relatorio_projetos_completo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_relatorio_avaliadores_completo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_relatorio_ausencias_completo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_projetos_completo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_avaliadores_completo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_ausencias_completo(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
