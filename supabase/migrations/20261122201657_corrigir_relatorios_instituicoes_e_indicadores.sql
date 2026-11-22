-- ==============================================================================
-- MIGRATION: 20261122201657_corrigir_relatorios_instituicoes_e_indicadores.sql
-- DESCRIÇÃO: conserta duas funções de relatório que falhavam em TODA chamada, em
--   qualquer evento, por SQL quebrado — não por dado. Achadas por
--   scripts/simular-feira.mjs, que chama as sete fn_relatorio_* contra o evento de
--   simulação; nenhum teste as cobria e o front-end não as chama, então o erro
--   ficou invisível.
--
--   1. fn_relatorio_instituicoes_completo: `column p.modalidade does not exist`
--      (42703). Referenciava três colunas textuais que `projetos` não tem, todas
--      como fallback de COALESCE: p.modalidade, p.area_conhecimento e
--      p.nome_instituicao. É a armadilha registrada no AGENTS.md ("projetos não tem
--      colunas textuais modalidade, area_conhecimento, nome_instituicao: use os
--      relacionamentos"). O Postgres para na primeira, então as três são corrigidas
--      de uma vez: o nome passa a vir só dos relacionamentos que já estavam em
--      LEFT JOIN (modalidades m, areas_tematicas ar, instituicoes inst) e o
--      fallback inexistente sai. Os textos padrão são preservados: 'Geral',
--      'Multidisciplinar' e 'Instituição Não Informada'.
--      `COALESCE(inst.id_instituicao, p.id_instituicao, ...)` continua: essa coluna
--      existe (é a FK pela qual o join é feito).
--
--   2. fn_relatorio_indicadores_gerenciais: `operator does not exist: timestamp
--      with time zone - character varying` (42883). avaliacoes.tempo_presenca é
--      texto, e a função subtraía a coluna direto de um timestamptz. Passa a usar o
--      mesmo tratamento da irmã fn_relatorio_avaliadores_completo: guarda por regex
--      de data ISO, cast ::timestamptz e ELSE 0 por linha, com o AVG filtrando as
--      linhas sem duração — assim um tempo_presenca malformado devolve 0 naquela
--      avaliação em vez de derrubar o relatório inteiro, e a média continua sendo
--      só das avaliações com duração medida.
--
-- Nada muda de assinatura, de tipo de retorno, de nome de coluna, de permissão nem
-- de modelo de segurança: as duas seguem SEM SECURITY DEFINER (direitos do
-- invocador, protegidas pela RLS de projetos/avaliacoes) e com os mesmos GRANTs,
-- redeclarados aqui para a migration ser autossuficiente. Antes da correção as
-- funções só levantavam exceção, então qualquer versão do front-end roda sobre
-- este banco sem ajuste (expand/contract: só o corpo muda).
--
-- PRÉ-REQUISITOS: 20261111060000_voto_popular_leitura.sql (última redefinição de
--   fn_relatorio_instituicoes_completo) e 20261025050000_relatorios_functions_rpc.sql
--   (origem de fn_relatorio_indicadores_gerenciais).
-- APLICAÇÃO: supabase db push
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. fn_relatorio_instituicoes_completo
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_relatorio_instituicoes_completo(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  id_instituicao uuid,
  nome_instituicao text,
  total_projetos integer,
  total_credenciados integer,
  total_avaliados integer,
  media_geral_escola numeric,
  projetos jsonb
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  WITH dados_base_projetos AS (
    SELECT
      p.id_projeto,
      p.id_evento,
      p.codigo_projeto,
      p.titulo,
      -- projetos não tem coluna textual de modalidade/área/instituição: o nome vem
      -- do relacionamento, e o texto padrão entra quando o projeto não tem o vínculo
      COALESCE(m.nome_modalidade, 'Geral') AS modalidade,
      COALESCE(ar.nome_area, 'Multidisciplinar') AS area_conhecimento,
      COALESCE(inst.id_instituicao, p.id_instituicao, '00000000-0000-0000-0000-000000000000'::uuid) AS id_instituicao_norm,
      COALESCE(inst.nome_exibicao, 'Instituição Não Informada') AS nome_instituicao_norm,
      COALESCE(p.is_check_in_realizado, true) AS is_check_in_realizado,
      (
        SELECT COUNT(*)::int
        FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto
          AND (av.status IS NULL OR av.status != 'CANCELADA')
          AND NOT av.is_voto_popular
      ) AS total_avaliacoes,
      (
        SELECT COALESCE(ROUND(AVG(av.nota_final)::numeric, 2) + coalesce(p.ajuste_media, 0), 0.00)
        FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto
          AND (av.status IS NULL OR av.status != 'CANCELADA')
          AND NOT av.is_voto_popular
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
    dbp.nome_instituicao_norm::text AS nome_instituicao,
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

ALTER FUNCTION public.fn_relatorio_instituicoes_completo(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_relatorio_instituicoes_completo(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_relatorio_instituicoes_completo(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_relatorio_instituicoes_completo(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_relatorio_instituicoes_completo(uuid) IS
  'Projetos agrupados por instituição no evento, com total, credenciados, avaliados e média da escola. Modalidade, área e nome da instituição vêm dos relacionamentos (projetos não tem essas colunas textuais); sem vínculo, usa Geral / Multidisciplinar / Instituição Não Informada. Sem SECURITY DEFINER: a RLS do invocador é que limita as linhas.';

-- ------------------------------------------------------------------------------
-- 2. fn_relatorio_indicadores_gerenciais
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_relatorio_indicadores_gerenciais(p_id_evento uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
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

  -- Avaliações válidas. tempo_presenca é texto: a duração sai do mesmo tratamento de
  -- fn_relatorio_avaliadores_completo — só converte o que tem cara de data ISO, e um
  -- valor ruim vale 0 naquela avaliação em vez de derrubar o relatório. A média
  -- considera apenas as avaliações com duração medida, para os zeros não diluírem.
  WITH avaliacoes_validas AS (
    SELECT
      a.nota_final,
      CASE
        WHEN a.tempo_presenca ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
         AND COALESCE(a.tempo_submissao, a.created_at) > a.tempo_presenca::timestamptz
        THEN EXTRACT(EPOCH FROM (COALESCE(a.tempo_submissao, a.created_at) - a.tempo_presenca::timestamptz))::int
        ELSE 0
      END AS duracao_segundos
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    WHERE (a.status IS NULL OR a.status != 'CANCELADA')
      AND (v_id_evento IS NULL OR p.id_evento = v_id_evento)
  )
  SELECT
    COUNT(*)::int,
    COALESCE(ROUND(AVG(av.nota_final)::numeric, 2), 0.00),
    COALESCE(ROUND(AVG(av.duracao_segundos) FILTER (WHERE av.duracao_segundos > 0))::int, 0)
  INTO v_total_avaliacoes, v_media_geral_notas, v_tempo_medio_seg
  FROM avaliacoes_validas av;

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

ALTER FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_relatorio_indicadores_gerenciais(uuid) IS
  'Indicadores gerenciais do evento (presença, comparecimento, conclusão, tempo médio, média geral, quarentena). A duração usa tempo_presenca, que é texto: só converte o que casa com data ISO, senão conta 0 naquela avaliação. Sem SECURITY DEFINER: a RLS do invocador é que limita as linhas.';

NOTIFY pgrst, 'reload schema';
