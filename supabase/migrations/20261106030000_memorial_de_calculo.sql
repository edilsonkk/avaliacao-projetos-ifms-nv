-- ==============================================================================
-- MIGRATION: 20261106030000_memorial_de_calculo.sql
-- DESCRIÇÃO: o memorial de cálculo, que é a conta aberta de cada nota.
--   * fn_memorial_avaliacao(): por critério, o peso, a nota e o produto; depois a
--     soma dos produtos, a soma dos pesos, a divisão sem arredondar, o valor
--     arredondado e o que está gravado, com o selo de "confere". Era o que faltava
--     para auditar: peso_calculo nunca aparecia em nenhuma tela.
--   * fn_memorial_projeto(): as avaliações ativas e as canceladas com o memorial
--     de cada uma, a média do projeto, a chave de desempate detalhada por pergunta
--     de prioridade, o estado da quarentena (inclusive quem aceitou a divergência),
--     os achados de fn_auditar_notas do projeto e a trilha de auditoria.
--   Nunca devolvem UUID como identificação ao usuário (regra 6): o projeto é
--   sempre o codigo_projeto. Os ids vão junto só para a interface navegar.
-- FRONT-END: compatível com a versão anterior (funções novas).
-- PRÉ-REQUISITOS: public.is_admin(), public.fn_chave_desempate() (20261031050000),
--   public.fn_auditar_notas() (20261106020000), public.log_auditoria (20261106010000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Memorial de uma avaliação: a conta de uma nota, critério por critério
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_memorial_avaliacao(p_id_avaliacao uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: o memorial de cálculo é restrito a administradores.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id_avaliacao',    a.id_avaliacao,
    'codigo_projeto',  p.codigo_projeto,
    'titulo_projeto',  p.titulo,
    'avaliador',       jsonb_build_object('id_usuario', u.id_usuario, 'nome', u.nome, 'email', u.email),
    'status',          coalesce(a.status, 'CONCLUIDA'),
    'enviada_em',      a.tempo_submissao,
    'presenca_em',     a.tempo_presenca,
    'criada_em',       a.created_at,
    'parecer',         a.parecer_final,
    'is_quarentena',   coalesce(a.is_quarentena, false),
    'cancelada_em',    a.cancelada_em,
    'cancelada_por',   (SELECT jsonb_build_object('id_usuario', c.id_usuario, 'nome', c.nome)
                          FROM public.usuarios c WHERE c.id_usuario = a.cancelada_por),
    'questionario',    jsonb_build_object(
                         'id_questionario', q.id_questionario,
                         'titulo',          q.titulo,
                         'escala_minima',   q.escala_minima,
                         'escala_maxima',   q.escala_maxima
                       ),
    'criterios',       coalesce(crit.lista, '[]'::jsonb),
    'soma_produtos',   crit.soma_produtos,
    'soma_pesos',      crit.soma_pesos,
    'nota_bruta',      crit.nota_bruta,
    'nota_arredondada',crit.nota_arredondada,
    'nota_gravada',    a.nota_final,
    'confere',         a.nota_final IS NOT DISTINCT FROM crit.nota_arredondada,
    'motivo_do_log',   (SELECT l.motivo FROM public.log_auditoria l
                         WHERE l.id_avaliacao = a.id_avaliacao AND l.motivo IS NOT NULL
                         ORDER BY l.id_log DESC LIMIT 1)
  )
  INTO v_resultado
  FROM public.avaliacoes a
  JOIN public.projetos p  ON p.id_projeto = a.id_projeto
  LEFT JOIN public.usuarios u ON u.id_usuario = a.id_usuario
  LEFT JOIN public.questionarios q
    ON q.id_questionario = coalesce(a.id_questionario, p.id_questionario_fixado)
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(jsonb_build_object(
        'id_pergunta',    x.id_pergunta,
        'ordem',          x.ordem,
        'criterio',       x.texto_pergunta,
        'ajuda',          x.descricao_lembrete,
        'peso_calculo',   x.peso_calculo,
        'peso_desempate', x.peso_desempate,
        'nota',           x.nota_atribuida,
        'produto',        x.nota_atribuida * x.peso_calculo
      ) ORDER BY x.ordem, x.texto_pergunta) AS lista,
      sum(x.nota_atribuida * x.peso_calculo) FILTER (WHERE x.peso_calculo > 0)        AS soma_produtos,
      sum(x.peso_calculo) FILTER (WHERE x.peso_calculo > 0)                           AS soma_pesos,
      sum(x.nota_atribuida * x.peso_calculo) FILTER (WHERE x.peso_calculo > 0)
        / nullif(sum(x.peso_calculo) FILTER (WHERE x.peso_calculo > 0), 0)             AS nota_bruta,
      round(sum(x.nota_atribuida * x.peso_calculo) FILTER (WHERE x.peso_calculo > 0)
        / nullif(sum(x.peso_calculo) FILTER (WHERE x.peso_calculo > 0), 0), 2)         AS nota_arredondada
    FROM (
      SELECT pq.id_pergunta, pq.ordem, pq.texto_pergunta, pq.descricao_lembrete,
             pq.peso_calculo, pq.peso_desempate, r.nota_atribuida
      FROM public.respostas_avaliacao r
      JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
      WHERE r.id_avaliacao = a.id_avaliacao
    ) x
  ) crit ON true
  WHERE a.id_avaliacao = p_id_avaliacao;

  RETURN v_resultado;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Memorial de um projeto: a média, o desempate, a quarentena e a trilha
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_memorial_projeto(p_id_projeto uuid)
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
    'media_do_ranking',  rk.media_geral,
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

    'achados', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'severidade', f.severidade, 'codigo', f.codigo, 'titulo', f.titulo,
               'id_avaliacao', f.id_avaliacao, 'esperado', f.esperado,
               'encontrado', f.encontrado, 'detalhe', f.detalhe
             ) ORDER BY f.severidade, f.codigo)
      FROM public.fn_auditar_notas(v_id_evento) f
      WHERE f.id_projeto = p.id_projeto
    ), '[]'::jsonb),

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

-- ------------------------------------------------------------------------------
-- 3. Achar o projeto pelo código (a interface nunca mostra UUID, regra 6)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_memorial_por_codigo(p_codigo_projeto text, p_id_evento uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id_projeto uuid;
  v_id_evento  uuid := coalesce(p_id_evento, public.evento_ativo_id());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: o memorial de cálculo é restrito a administradores.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.id_projeto INTO v_id_projeto
  FROM public.projetos p
  WHERE p.id_evento = v_id_evento
    AND upper(btrim(p.codigo_projeto::text)) = upper(btrim(p_codigo_projeto))
  LIMIT 1;

  IF v_id_projeto IS NULL THEN
    RAISE EXCEPTION 'Nenhum projeto com o código % neste evento.', p_codigo_projeto
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN public.fn_memorial_projeto(v_id_projeto);
END $$;

ALTER FUNCTION public.fn_memorial_avaliacao(uuid) OWNER TO postgres;
ALTER FUNCTION public.fn_memorial_projeto(uuid) OWNER TO postgres;
ALTER FUNCTION public.fn_memorial_por_codigo(text, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.fn_memorial_avaliacao(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_memorial_projeto(uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_memorial_por_codigo(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_memorial_avaliacao(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_memorial_projeto(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_memorial_por_codigo(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_memorial_avaliacao(uuid) IS
  'Conta aberta de uma nota: critério, peso, nota, produto, soma, divisão e o que está gravado. Só Admin.';
COMMENT ON FUNCTION public.fn_memorial_projeto(uuid) IS
  'Memorial do projeto: avaliações, média, desempate, quarentena, achados da conferência e trilha. Só Admin.';
COMMENT ON FUNCTION public.fn_memorial_por_codigo(text, uuid) IS
  'Memorial do projeto a partir do codigo_projeto, para a interface não precisar de UUID.';

COMMIT;
