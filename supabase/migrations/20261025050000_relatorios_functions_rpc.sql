-- ==============================================================================
-- MIGRATION: 20261025050000_relatorios_functions_rpc.sql
-- DESCRIÇÃO: Stored Functions (RPCs) especializadas para geração de relatórios
--            administrativos e gerenciais com dados pré-agrupados e sub-itens
--            em JSON, sem dependência de processamento pesado no cliente.
-- ==============================================================================

-- 1. FUNCTION: fn_relatorio_projetos_completo
-- Retorna todos os projetos do evento (ou geral) com suas respectivas notas e avaliações em JSON
CREATE OR REPLACE FUNCTION public.fn_relatorio_projetos_completo(p_id_evento uuid DEFAULT NULL)
RETURNS TABLE (
  id_projeto uuid,
  id_evento uuid,
  codigo_projeto text,
  titulo text,
  estande text,
  corredor text,
  modalidade text,
  area_conhecimento text,
  nome_instituicao text,
  id_instituicao uuid,
  is_check_in_realizado boolean,
  is_fora_da_competicao boolean,
  total_avaliacoes int,
  media_geral numeric,
  notas numeric[],
  detalhes_avaliacoes jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH avaliacoes_validas AS (
    SELECT
      a.id_avaliacao,
      a.id_projeto,
      a.id_usuario,
      u.nome AS avaliador_nome,
      ROUND(a.nota_final::numeric, 2) AS nota_final,
      COALESCE(a.parecer_final, '') AS parecer,
      a.created_at AS data
    FROM public.avaliacoes a
    JOIN public.usuarios u ON u.id_usuario = a.id_usuario
    WHERE (a.status IS NULL OR a.status != 'CANCELADA')
  ),
  projetos_com_detalhes AS (
    SELECT
      p.id_projeto,
      p.id_evento,
      p.codigo_projeto,
      p.titulo,
      p.estande,
      p.corredor,
      COALESCE(m.nome_modalidade, p.modalidade, 'Geral') AS modalidade,
      COALESCE(ar.nome_area, p.area_conhecimento, 'Multidisciplinar') AS area_conhecimento,
      COALESCE(inst.nome_exibicao, p.nome_instituicao, 'Não informada') AS nome_instituicao,
      p.id_instituicao,
      COALESCE(p.is_check_in_realizado, true) AS is_check_in_realizado,
      COALESCE(p.is_fora_da_competicao, false) AS is_fora_da_competicao,
      COUNT(av.id_avaliacao)::int AS total_avaliacoes,
      COALESCE(ROUND(AVG(av.nota_final)::numeric, 2), 0.00) AS media_geral,
      COALESCE(
        ARRAY_AGG(av.nota_final ORDER BY av.data DESC) FILTER (WHERE av.nota_final IS NOT NULL),
        '{}'::numeric[]
      ) AS notas,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id_avaliacao', av.id_avaliacao,
            'id_usuario', av.id_usuario,
            'avaliador_nome', av.avaliador_nome,
            'nota_final', av.nota_final,
            'parecer', av.parecer,
            'data', av.data
          ) ORDER BY av.data DESC
        ) FILTER (WHERE av.id_avaliacao IS NOT NULL),
        '[]'::jsonb
      ) AS detalhes_avaliacoes
    FROM public.projetos p
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    LEFT JOIN avaliacoes_validas av ON av.id_projeto = p.id_projeto
    WHERE (p_id_evento IS NULL OR p.id_evento = p_id_evento)
    GROUP BY
      p.id_projeto,
      p.id_evento,
      p.codigo_projeto,
      p.titulo,
      p.estande,
      p.corredor,
      m.nome_modalidade,
      p.modalidade,
      ar.nome_area,
      p.area_conhecimento,
      inst.nome_exibicao,
      p.nome_instituicao,
      p.id_instituicao,
      p.is_check_in_realizado,
      p.is_fora_da_competicao
  )
  SELECT * FROM projetos_com_detalhes
  ORDER BY projetos_com_detalhes.media_geral DESC, projetos_com_detalhes.titulo ASC;
END;
$$;


-- 2. FUNCTION: fn_relatorio_avaliadores_completo
-- Retorna cada avaliador com estatísticas e sua lista completa de avaliações em JSON
CREATE OR REPLACE FUNCTION public.fn_relatorio_avaliadores_completo(p_id_evento uuid DEFAULT NULL)
RETURNS TABLE (
  id_usuario uuid,
  avaliador_nome text,
  avaliador_email text,
  total_avaliacoes int,
  media_notas numeric,
  tempo_medio_segundos int,
  avaliacoes jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH avaliacoes_enriquecidas AS (
    SELECT
      a.id_avaliacao,
      a.id_usuario,
      u.nome AS avaliador_nome,
      u.email AS avaliador_email,
      p.id_projeto,
      p.id_evento,
      p.codigo_projeto,
      p.titulo AS projeto_titulo,
      p.estande AS projeto_estande,
      COALESCE(m.nome_modalidade, p.modalidade, 'Geral') AS projeto_modalidade,
      COALESCE(ar.nome_area, p.area_conhecimento, 'Multidisciplinar') AS projeto_area,
      ROUND(a.nota_final::numeric, 2) AS nota_final,
      COALESCE(a.parecer_final, '') AS parecer_comentario,
      a.tempo_presenca,
      COALESCE(a.tempo_submissao, a.created_at) AS tempo_submissao,
      a.created_at AS data_avaliacao,
      CASE
        WHEN a.tempo_presenca IS NOT NULL AND COALESCE(a.tempo_submissao, a.created_at) > a.tempo_presenca
        THEN EXTRACT(EPOCH FROM (COALESCE(a.tempo_submissao, a.created_at) - a.tempo_presenca))::int
        ELSE 0
      END AS duracao_segundos
    FROM public.avaliacoes a
    JOIN public.usuarios u ON u.id_usuario = a.id_usuario
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    WHERE (a.status IS NULL OR a.status != 'CANCELADA')
      AND (p_id_evento IS NULL OR p.id_evento = p_id_evento)
  )
  SELECT
    ae.id_usuario,
    ae.avaliador_nome,
    ae.avaliador_email,
    COUNT(ae.id_avaliacao)::int AS total_avaliacoes,
    COALESCE(ROUND(AVG(ae.nota_final)::numeric, 2), 0.00) AS media_notas,
    COALESCE(ROUND(AVG(ae.duracao_segundos) FILTER (WHERE ae.duracao_segundos > 0))::int, 0) AS tempo_medio_segundos,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id_avaliacao', ae.id_avaliacao,
          'id_projeto', ae.id_projeto,
          'id_evento', ae.id_evento,
          'codigo_projeto', ae.codigo_projeto,
          'projeto_titulo', ae.projeto_titulo,
          'projeto_estande', ae.projeto_estande,
          'projeto_modalidade', ae.projeto_modalidade,
          'projeto_area', ae.projeto_area,
          'nota_final', ae.nota_final,
          'parecer_comentario', ae.parecer_comentario,
          'tempo_presenca', ae.tempo_presenca,
          'tempo_submissao', ae.tempo_submissao,
          'data_avaliacao', ae.data_avaliacao,
          'duracao_segundos', ae.duracao_segundos
        ) ORDER BY ae.data_avaliacao DESC
      ),
      '[]'::jsonb
    ) AS avaliacoes
  FROM avaliacoes_enriquecidas ae
  GROUP BY ae.id_usuario, ae.avaliador_nome, ae.avaliador_email
  ORDER BY ae.avaliador_nome ASC;
END;
$$;


-- 3. FUNCTION: fn_relatorio_ausencias_completo
-- Retorna cada avaliador que registrou ausências com sua lista de projetos em JSON
CREATE OR REPLACE FUNCTION public.fn_relatorio_ausencias_completo(p_id_evento uuid DEFAULT NULL)
RETURNS TABLE (
  id_usuario uuid,
  avaliador_nome text,
  avaliador_email text,
  total_ausencias int,
  ausencias jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH ausencias_enriquecidas AS (
    SELECT
      hi.id_usuario,
      u.nome AS avaliador_nome,
      u.email AS avaliador_email,
      p.id_projeto,
      p.id_evento,
      p.codigo_projeto,
      p.titulo AS projeto_titulo,
      p.estande AS projeto_estande,
      COALESCE(m.nome_modalidade, p.modalidade, 'Geral') AS projeto_modalidade,
      COALESCE(ar.nome_area, p.area_conhecimento, 'Multidisciplinar') AS projeto_area,
      COALESCE(inst.nome_exibicao, p.nome_instituicao, 'Não informada') AS projeto_instituicao,
      hi.created_at AS data_ausencia,
      (
        SELECT COUNT(*)::int
        FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto
          AND (av.status IS NULL OR av.status != 'CANCELADA')
      ) AS total_avaliacoes_atuais
    FROM public.historico_impedimentos hi
    JOIN public.usuarios u ON u.id_usuario = hi.id_usuario
    JOIN public.projetos p ON p.id_projeto = hi.id_projeto
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    WHERE hi.tipo = 'ausencia'
      AND (p_id_evento IS NULL OR p.id_evento = p_id_evento)
  )
  SELECT
    ae.id_usuario,
    ae.avaliador_nome,
    ae.avaliador_email,
    COUNT(ae.id_projeto)::int AS total_ausencias,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id_projeto', ae.id_projeto,
          'id_evento', ae.id_evento,
          'codigo_projeto', ae.codigo_projeto,
          'projeto_titulo', ae.projeto_titulo,
          'projeto_estande', ae.projeto_estande,
          'projeto_modalidade', ae.projeto_modalidade,
          'projeto_area', ae.projeto_area,
          'projeto_instituicao', ae.projeto_instituicao,
          'data_ausencia', ae.data_ausencia,
          'total_avaliacoes_atuais', ae.total_avaliacoes_atuais
        ) ORDER BY ae.data_ausencia DESC
      ),
      '[]'::jsonb
    ) AS ausencias
  FROM ausencias_enriquecidas ae
  GROUP BY ae.id_usuario, ae.avaliador_nome, ae.avaliador_email
  ORDER BY ae.avaliador_nome ASC;
END;
$$;


-- 4. FUNCTION: fn_relatorio_instituicoes_completo
-- Retorna cada instituição com contagens consolidadas e lista de projetos submetidos em JSON
CREATE OR REPLACE FUNCTION public.fn_relatorio_instituicoes_completo(p_id_evento uuid DEFAULT NULL)
RETURNS TABLE (
  id_instituicao uuid,
  nome_instituicao text,
  total_projetos int,
  total_credenciados int,
  total_avaliados int,
  media_geral_escola numeric,
  projetos jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH dados_base_projetos AS (
    SELECT
      p.id_projeto,
      p.id_evento,
      p.codigo_projeto,
      p.titulo,
      COALESCE(m.nome_modalidade, p.modalidade, 'Geral') AS modalidade,
      COALESCE(ar.nome_area, p.area_conhecimento, 'Multidisciplinar') AS area_conhecimento,
      COALESCE(inst.id_instituicao, p.id_instituicao, '00000000-0000-0000-0000-000000000000'::uuid) AS id_instituicao_norm,
      COALESCE(inst.nome_exibicao, p.nome_instituicao, 'Instituição Não Informada') AS nome_instituicao_norm,
      COALESCE(p.is_check_in_realizado, true) AS is_check_in_realizado,
      (
        SELECT COUNT(*)::int
        FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto
          AND (av.status IS NULL OR av.status != 'CANCELADA')
      ) AS total_avaliacoes,
      (
        SELECT COALESCE(ROUND(AVG(av.nota_final)::numeric, 2), 0.00)
        FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto
          AND (av.status IS NULL OR av.status != 'CANCELADA')
      ) AS media_geral,
      EXISTS(
        SELECT 1 FROM public.historico_impedimentos hi
        WHERE hi.id_projeto = p.id_projeto AND hi.tipo = 'ausencia'
      ) AS foi_marcado_ausente
    FROM public.projetos p
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    WHERE (p_id_evento IS NULL OR p.id_evento = p_id_evento)
  )
  SELECT
    dbp.id_instituicao_norm AS id_instituicao,
    dbp.nome_instituicao_norm AS nome_instituicao,
    COUNT(dbp.id_projeto)::int AS total_projetos,
    COUNT(dbp.id_projeto) FILTER (WHERE dbp.is_check_in_realizado = true)::int AS total_credenciados,
    COUNT(dbp.id_projeto) FILTER (WHERE dbp.total_avaliacoes > 0)::int AS total_avaliados,
    COALESCE(
      ROUND(AVG(dbp.media_geral) FILTER (WHERE dbp.total_avaliacoes > 0)::numeric, 2),
      0.00
    ) AS media_geral_escola,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id_projeto', dbp.id_projeto,
          'codigo_projeto', dbp.codigo_projeto,
          'titulo', dbp.titulo,
          'modalidade', dbp.modalidade,
          'area_conhecimento', dbp.area_conhecimento,
          'is_check_in_realizado', dbp.is_check_in_realizado,
          'total_avaliacoes', dbp.total_avaliacoes,
          'media_geral', dbp.media_geral,
          'foi_marcado_ausente', dbp.foi_marcado_ausente
        ) ORDER BY dbp.titulo ASC
      ),
      '[]'::jsonb
    ) AS projetos
  FROM dados_base_projetos dbp
  GROUP BY dbp.id_instituicao_norm, dbp.nome_instituicao_norm
  ORDER BY total_projetos DESC, dbp.nome_instituicao_norm ASC;
END;
$$;


-- 5. FUNCTION: fn_relatorio_indicadores_gerenciais
-- Retorna os indicadores consolidados do evento ativo em um único objeto JSON
CREATE OR REPLACE FUNCTION public.fn_relatorio_indicadores_gerenciais(p_id_evento uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_resultado jsonb;
  v_id_evento uuid := p_id_evento;
  v_nome_evento text := 'FETEC MS 2026';
  v_data_evento text;
  v_cota_padrao int := 3;
  v_total_projetos int := 0;
  v_projetos_credenciados int := 0;
  v_total_avaliadores int := 0;
  v_avaliadores_credenciados int := 0;
  v_total_avaliacoes int := 0;
  v_tempo_medio_seg int := 0;
  v_media_geral_notas numeric := 0.00;
  v_quarentena_count int := 0;
BEGIN
  -- Se p_id_evento não for informado, busca o evento ativo
  IF v_id_evento IS NULL THEN
    SELECT e.id_evento, e.nome_evento, e.data_evento::text, COALESCE(e.cota_avaliacoes_padrao, 3)
    INTO v_id_evento, v_nome_evento, v_data_evento, v_cota_padrao
    FROM public.eventos e
    WHERE e.is_ativo = true
    LIMIT 1;
  ELSE
    SELECT e.nome_evento, e.data_evento::text, COALESCE(e.cota_avaliacoes_padrao, 3)
    INTO v_nome_evento, v_data_evento, v_cota_padrao
    FROM public.eventos e
    WHERE e.id_evento = v_id_evento;
  END IF;

  -- Contagens de projetos
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE COALESCE(p.is_check_in_realizado, true) = true)::int
  INTO v_total_projetos, v_projetos_credenciados
  FROM public.projetos p
  WHERE (v_id_evento IS NULL OR p.id_evento = v_id_evento);

  -- Contagens de avaliadores
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE ae.is_credenciado = true)::int
  INTO v_total_avaliadores, v_avaliadores_credenciados
  FROM public.avaliadores_evento ae
  WHERE (v_id_evento IS NULL OR ae.id_evento = v_id_evento);

  -- Avaliações válidas
  SELECT
    COUNT(*)::int,
    COALESCE(ROUND(AVG(a.nota_final)::numeric, 2), 0.00),
    COALESCE(
      ROUND(
        AVG(EXTRACT(EPOCH FROM (COALESCE(a.tempo_submissao, a.created_at) - a.tempo_presenca)))
        FILTER (WHERE a.tempo_presenca IS NOT NULL AND COALESCE(a.tempo_submissao, a.created_at) > a.tempo_presenca)
      )::int,
      0
    )
  INTO v_total_avaliacoes, v_media_geral_notas, v_tempo_medio_seg
  FROM public.avaliacoes a
  JOIN public.projetos p ON p.id_projeto = a.id_projeto
  WHERE (a.status IS NULL OR a.status != 'CANCELADA')
    AND (v_id_evento IS NULL OR p.id_evento = v_id_evento);

  -- Quarentena
  SELECT COUNT(*)::int INTO v_quarentena_count
  FROM public.view_projetos_quarentena vq
  WHERE (v_id_evento IS NULL OR vq.id_evento = v_id_evento);

  v_resultado := jsonb_build_object(
    'nome_evento', COALESCE(v_nome_evento, 'Sistema de Avaliação de Projetos - IFMS'),
    'data_evento', v_data_evento,
    'cota_padrao', v_cota_padrao,
    'total_projetos', v_total_projetos,
    'projetos_credenciados', v_projetos_credenciados,
    'projetos_ausentes', GREATEST(0, v_total_projetos - v_projetos_credenciados),
    'taxa_presenca_projetos', CASE WHEN v_total_projetos > 0 THEN ROUND((v_projetos_credenciados::numeric / v_total_projetos) * 100) ELSE 0 END,
    'total_avaliadores', v_total_avaliadores,
    'avaliadores_credenciados', v_avaliadores_credenciados,
    'avaliadores_ausentes', GREATEST(0, v_total_avaliadores - v_avaliadores_credenciados),
    'taxa_comparecimento_avaliadores', CASE WHEN v_total_avaliadores > 0 THEN ROUND((v_avaliadores_credenciados::numeric / v_total_avaliadores) * 100) ELSE 0 END,
    'total_avaliacoes_realizadas', v_total_avaliacoes,
    'cota_esperada_total', v_projetos_credenciados * v_cota_padrao,
    'porcentagem_conclusao', CASE WHEN (v_projetos_credenciados * v_cota_padrao) > 0 THEN LEAST(100, ROUND((v_total_avaliacoes::numeric / (v_projetos_credenciados * v_cota_padrao)) * 100)) ELSE 0 END,
    'tempo_medio_segundos', v_tempo_medio_seg,
    'media_geral_notas', v_media_geral_notas,
    'projetos_quarentena', v_quarentena_count
  );

  RETURN v_resultado;
END;
$$;


-- 6. PERMISSÕES DE EXECUÇÃO
GRANT EXECUTE ON FUNCTION public.fn_relatorio_projetos_completo(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_avaliadores_completo(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_ausencias_completo(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_instituicoes_completo(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) TO authenticated, anon, service_role;
