-- ==============================================================================
-- MIGRATION: 20261106060000_memorial_do_evento.sql
-- DESCRIÇÃO: fn_memorial_evento(), a folha de conferência consolidada do evento.
--   * fn_memorial_projeto() ganha p_incluir_achados (default true, então a chamada
--     de uma só folha continua igual). A folha do evento pede false e anexa os
--     achados de UMA rodada de fn_auditar_notas: a conferência olha o evento
--     inteiro, e chamá-la por projeto repetiria o mesmo trabalho centenas de vezes.
--   * fn_memorial_evento() devolve os projetos em ordem de código, cada um com o
--     memorial completo das suas avaliações.
-- FRONT-END: compatível com a versão anterior (parâmetro novo com default).
-- PRÉ-REQUISITOS: 20261106030000 e 20261106050000 (memorial e ajuste manual).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.fn_memorial_projeto(uuid);

CREATE OR REPLACE FUNCTION public.fn_memorial_projeto(p_id_projeto uuid, p_incluir_achados boolean DEFAULT true)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_resultado jsonb;
  v_id_evento uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: o memorial de cálculo é restrito a administradores.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.id_evento INTO v_id_evento FROM public.projetos p WHERE p.id_projeto = p_id_projeto;

  SELECT jsonb_build_object(
    'id_projeto',       p.id_projeto,
    'codigo_projeto',   p.codigo_projeto,
    'titulo',           p.titulo,
    'modalidade',       coalesce(m.nome_modalidade, 'Sem modalidade'),
    'area_tematica',    coalesce(ar.nome_area, 'Sem área temática'),
    'instituicao',      coalesce(inst.nome_exibicao, 'Não informada'),
    'estande',          p.estande,
    'check_in',         coalesce(p.is_check_in_realizado, false),
    'fora_da_competicao', coalesce(p.is_fora_da_competicao, false),
    'cota',             coalesce(p.cota_avaliacoes_customizada, coalesce(e.cota_avaliacoes_padrao, 3)),
    'questionario_fixado', (SELECT jsonb_build_object('id_questionario', q.id_questionario, 'titulo', q.titulo,
                                                      'escala_minima', q.escala_minima, 'escala_maxima', q.escala_maxima)
                              FROM public.questionarios q WHERE q.id_questionario = p.id_questionario_fixado),

    'avaliacoes_ativas', coalesce((
      SELECT jsonb_agg(public.fn_memorial_avaliacao(a.id_avaliacao) ORDER BY a.created_at)
      FROM public.avaliacoes a
      WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
    ), '[]'::jsonb),
    'avaliacoes_canceladas', coalesce((
      SELECT jsonb_agg(public.fn_memorial_avaliacao(a.id_avaliacao) ORDER BY a.created_at)
      FROM public.avaliacoes a
      WHERE a.id_projeto = p.id_projeto AND a.status = 'CANCELADA'
    ), '[]'::jsonb),

    'total_avaliacoes',  ativas.qtd,
    'notas',             coalesce(ativas.notas, '[]'::jsonb),
    'media_geral',       ativas.media,
    'ajuste_media',      coalesce(p.ajuste_media, 0),
    'media_final',       CASE WHEN ativas.qtd > 0 THEN ativas.media + coalesce(p.ajuste_media, 0) END,
    'ajuste_media_em',   p.ajuste_media_em,
    'ajuste_media_motivo', p.ajuste_media_motivo,
    'ajuste_media_por',  (SELECT jsonb_build_object('id_usuario', c.id_usuario, 'nome', c.nome)
                            FROM public.usuarios c WHERE c.id_usuario = p.ajuste_media_por),
    'media_do_ranking',  rk.media_final,
    'posicao_no_ranking',rk.posicao,

    'desempate', jsonb_build_object(
      'chave', coalesce(to_jsonb(public.fn_chave_desempate(p.id_projeto)), '[]'::jsonb),
      'por_prioridade', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'prioridade', d.peso_desempate,
                 'ordem',      d.ordem,
                 'criterio',   d.texto_pergunta,
                 'media',      d.media
               ) ORDER BY d.peso_desempate, d.ordem)
        FROM (
          SELECT pq.peso_desempate, pq.ordem, pq.texto_pergunta,
                 round(avg(r.nota_atribuida), 2) AS media
          FROM public.avaliacoes a
          JOIN public.respostas_avaliacao r ON r.id_avaliacao = a.id_avaliacao
          JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
          WHERE a.id_projeto = p.id_projeto
            AND (a.status IS NULL OR a.status <> 'CANCELADA')
            AND pq.peso_desempate > 0
          GROUP BY pq.id_pergunta, pq.peso_desempate, pq.ordem, pq.texto_pergunta
        ) d
      ), '[]'::jsonb)
    ),

    'quarentena', jsonb_build_object(
      'pendente',      EXISTS (SELECT 1 FROM public.view_projetos_quarentena vq WHERE vq.id_projeto = p.id_projeto),
      'nota_minima',   ativas.nota_min,
      'nota_maxima',   ativas.nota_max,
      'divergencia',   round(ativas.nota_max - ativas.nota_min, 2),
      'limite',        2.5,
      'resolvida_em',  p.quarentena_resolvida_em,
      'resolvida_por', (SELECT jsonb_build_object('id_usuario', c.id_usuario, 'nome', c.nome)
                          FROM public.usuarios c WHERE c.id_usuario = p.quarentena_resolvida_por)
    ),

    -- A folha consolidada do evento passa p_incluir_achados = false e anexa os achados
    -- de uma única rodada de fn_auditar_notas: rodar a conferência inteira por projeto
    -- seria o mesmo trabalho repetido centenas de vezes.
    'achados', CASE WHEN NOT p_incluir_achados THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'severidade', f.severidade, 'codigo', f.codigo, 'titulo', f.titulo,
               'id_avaliacao', f.id_avaliacao, 'esperado', f.esperado,
               'encontrado', f.encontrado, 'detalhe', f.detalhe
             ) ORDER BY f.severidade, f.codigo)
      FROM public.fn_auditar_notas(v_id_evento) f
      WHERE f.id_projeto = p.id_projeto
    ), '[]'::jsonb) END,

    'trilha', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id_log', l.id_log, 'quando', l.criado_em, 'acao', l.acao,
               'operacao', l.operacao, 'tabela', l.tabela, 'origem', l.origem,
               'motivo', l.motivo, 'ator_papel', l.ator_papel,
               'ator', (SELECT at.nome FROM public.usuarios at WHERE at.id_usuario = l.ator_usuario),
               'campos_alterados', l.campos_alterados,
               'dados_antes', l.dados_antes, 'dados_depois', l.dados_depois
             ) ORDER BY l.id_log DESC)
      FROM public.log_auditoria l
      WHERE l.id_projeto = p.id_projeto
    ), '[]'::jsonb),

    'trilha_comeca_em', (SELECT min(l.criado_em) FROM public.log_auditoria l)
  )
  INTO v_resultado
  FROM public.projetos p
  LEFT JOIN public.eventos e        ON e.id_evento = p.id_evento
  LEFT JOIN public.modalidades m    ON m.id_modalidade = p.id_modalidade
  LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
  LEFT JOIN public.instituicoes inst  ON inst.id_instituicao = p.id_instituicao
  LEFT JOIN public.view_ranking_top3 rk ON rk.id_projeto = p.id_projeto
  LEFT JOIN LATERAL (
    SELECT count(*) AS qtd,
           round(avg(a.nota_final), 2) AS media,
           min(a.nota_final) AS nota_min,
           max(a.nota_final) AS nota_max,
           jsonb_agg(a.nota_final ORDER BY a.created_at) AS notas
    FROM public.avaliacoes a
    WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
  ) ativas ON true
  WHERE p.id_projeto = p_id_projeto;

  RETURN v_resultado;
END $$;

ALTER FUNCTION public.fn_memorial_projeto(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_memorial_projeto(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_memorial_projeto(uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.fn_memorial_projeto(uuid, boolean) IS
  'Memorial do projeto: avaliações, média aberta, desempate, quarentena, achados e trilha. Só Admin.';

CREATE OR REPLACE FUNCTION public.fn_memorial_evento(p_id_evento uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id_evento uuid := coalesce(p_id_evento, public.evento_ativo_id());
  v_resultado jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: a folha de conferência é restrita a administradores.'
      USING ERRCODE = '42501';
  END IF;

  WITH achados AS (
    SELECT f.id_projeto,
           jsonb_agg(jsonb_build_object(
             'severidade', f.severidade, 'codigo', f.codigo, 'titulo', f.titulo,
             'id_avaliacao', f.id_avaliacao, 'esperado', f.esperado,
             'encontrado', f.encontrado, 'detalhe', f.detalhe
           ) ORDER BY f.severidade, f.codigo) AS lista
    FROM public.fn_auditar_notas(v_id_evento) f
    WHERE f.id_projeto IS NOT NULL
    GROUP BY f.id_projeto
  )
  SELECT jsonb_build_object(
    'evento', (SELECT jsonb_build_object('id_evento', e.id_evento, 'nome', e.nome_evento,
                                         'edicao', e.edicao, 'data_evento', e.data_evento)
                 FROM public.eventos e WHERE e.id_evento = v_id_evento),
    'emitida_em', now(),
    'trilha_comeca_em', (SELECT min(l.criado_em) FROM public.log_auditoria l),
    'projetos', coalesce(jsonb_agg(x.memorial ORDER BY x.codigo_projeto), '[]'::jsonb)
  )
  INTO v_resultado
  FROM (
    SELECT p.codigo_projeto,
           public.fn_memorial_projeto(p.id_projeto, false)
             || jsonb_build_object('achados', coalesce(a.lista, '[]'::jsonb)) AS memorial
    FROM public.projetos p
    LEFT JOIN achados a ON a.id_projeto = p.id_projeto
    WHERE p.id_evento = v_id_evento
  ) x;

  RETURN v_resultado;
END $$;

ALTER FUNCTION public.fn_memorial_evento(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_memorial_evento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_memorial_evento(uuid) TO authenticated;
COMMENT ON FUNCTION public.fn_memorial_evento(uuid) IS
  'Folha de conferência consolidada: todos os projetos do evento com o memorial de cada avaliação. Só Admin.';

COMMIT;
