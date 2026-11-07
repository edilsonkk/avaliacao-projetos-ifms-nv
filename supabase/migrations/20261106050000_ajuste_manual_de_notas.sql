-- ==============================================================================
-- MIGRATION: 20261106050000_ajuste_manual_de_notas.sql
-- DESCRIÇÃO: o ajuste manual do Admin passa a existir como caminho oficial, e
--   sempre marcado. Antes não havia mecanismo nenhum (nenhuma RPC, nenhuma
--   coluna), então todo ajuste real acontecia por UPDATE direto na API REST —
--   sem validação de escala, sem recálculo e sem rastro.
--   Quatro ações, todas registradas na trilha com motivo opcional:
--     * admin_corrigir_respostas_avaliacao: troca notas por critério e recalcula
--       a nota final pela fórmula oficial (a conta continua fechando).
--     * admin_lancar_avaliacao: lança a avaliação de um avaliador identificado
--       (ficha em papel, celular sem acesso). Passar da cota exige confirmação.
--     * admin_arbitrar_nota_final: define a nota final sem mexer nas respostas.
--       É o único caso em que a conta não fecha por desenho, e a conferência
--       passa a dizer "nota arbitrada" em vez de acusar adulteração.
--     * admin_ajustar_media_projeto: bónus/penalidade de comissão na média do
--       projeto, sem tocar em nenhuma avaliação.
--   A média do projeto passa a ser exposta sempre aberta:
--     media_geral (média das notas) + ajuste_media = media_final (o que premia).
--   fn_validar_respostas() centraliza a validação do conjunto de respostas e o
--   cálculo da média ponderada; fn_enviar_avaliacao mantém a sua validação
--   inline, e o teste 27 confere que as duas dão a mesma nota (AGENTS.md: funções
--   equivalentes têm de ficar em sincronia).
-- FRONT-END: compatível com a versão anterior (colunas e funções novas; as
--   colunas novas são acrescentadas ao fim do retorno dos relatórios).
-- PRÉ-REQUISITOS: 20261106010000 (trilha), 20261106020000 (conferência),
--   20261106030000 (memorial), public.fn_recalcular_quarentena.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Onde fica a marca do ajuste
--    Uma coluna por registro, para o selo custar nada em qualquer consulta; o
--    antes/depois completo fica na trilha (log_auditoria).
-- ------------------------------------------------------------------------------
ALTER TABLE public.avaliacoes
  ADD COLUMN IF NOT EXISTS ajuste_tipo    text,
  ADD COLUMN IF NOT EXISTS ajustada_em    timestamptz,
  ADD COLUMN IF NOT EXISTS ajustada_por   uuid,
  ADD COLUMN IF NOT EXISTS ajuste_motivo  text;

ALTER TABLE public.avaliacoes DROP CONSTRAINT IF EXISTS ck_avaliacoes_ajuste_tipo;
ALTER TABLE public.avaliacoes
  ADD CONSTRAINT ck_avaliacoes_ajuste_tipo
  CHECK (ajuste_tipo IS NULL OR ajuste_tipo IN ('respostas_corrigidas', 'nota_arbitrada', 'lancada_pelo_admin'));

COMMENT ON COLUMN public.avaliacoes.ajuste_tipo IS
  'Marca de ajuste manual do Admin: respostas_corrigidas, nota_arbitrada ou lancada_pelo_admin. NULL = avaliação enviada pelo avaliador.';
COMMENT ON COLUMN public.avaliacoes.ajustada_por IS
  'Admin (usuarios.id_usuario) que fez o ajuste. Sem FK de propósito, como cancelada_por.';

ALTER TABLE public.projetos
  ADD COLUMN IF NOT EXISTS ajuste_media        numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ajuste_media_em     timestamptz,
  ADD COLUMN IF NOT EXISTS ajuste_media_por    uuid,
  ADD COLUMN IF NOT EXISTS ajuste_media_motivo text;

COMMENT ON COLUMN public.projetos.ajuste_media IS
  'Bónus (positivo) ou penalidade (negativo) de comissão somado à média do projeto. 0 = sem ajuste. media_final = media_geral + ajuste_media.';

-- ------------------------------------------------------------------------------
-- 2. Validação do conjunto de respostas e cálculo da nota
--    Mesma regra de fn_enviar_avaliacao: todas as perguntas do questionário, uma
--    vez cada, com nota dentro da escala; a nota é a média ponderada pelo
--    peso_calculo lido do banco.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validar_respostas(p_id_questionario uuid, p_respostas jsonb)
  RETURNS numeric
  LANGUAGE plpgsql STABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total_perguntas integer;
  v_qtd_respostas   integer;
  v_distintas       integer;
  v_alheias         integer;
  v_nulas           integer;
  v_fora_escala     integer;
  v_escala_min      numeric;
  v_escala_max      numeric;
  v_soma            numeric;
  v_nota            numeric;
BEGIN
  IF jsonb_typeof(p_respostas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Respostas em formato inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT q.escala_minima, q.escala_maxima INTO v_escala_min, v_escala_max
  FROM public.questionarios q WHERE q.id_questionario = p_id_questionario;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionário não encontrado.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total_perguntas
  FROM public.perguntas_questionario pq WHERE pq.id_questionario = p_id_questionario;

  SELECT count(*),
         count(DISTINCT r ->> 'id_pergunta'),
         count(*) FILTER (WHERE pq.id_pergunta IS NULL),
         count(*) FILTER (WHERE jsonb_typeof(r -> 'nota') IS DISTINCT FROM 'number')
    INTO v_qtd_respostas, v_distintas, v_alheias, v_nulas
  FROM jsonb_array_elements(p_respostas) AS r
  LEFT JOIN public.perguntas_questionario pq
    ON pq.id_pergunta::text = r ->> 'id_pergunta' AND pq.id_questionario = p_id_questionario;

  IF v_total_perguntas = 0 OR v_qtd_respostas <> v_total_perguntas OR v_distintas <> v_qtd_respostas
     OR v_alheias > 0 OR v_nulas > 0 THEN
    RAISE EXCEPTION 'Responda todas as % perguntas do questionário, uma vez cada, com uma nota.', v_total_perguntas
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) FILTER (WHERE (r ->> 'nota')::numeric < v_escala_min
                             OR (r ->> 'nota')::numeric > v_escala_max),
         coalesce(sum((r ->> 'nota')::numeric), 0)
    INTO v_fora_escala, v_soma
  FROM jsonb_array_elements(p_respostas) AS r;

  IF v_fora_escala > 0 THEN
    RAISE EXCEPTION 'Nota fora da escala do questionário (% a %).', v_escala_min, v_escala_max
      USING ERRCODE = '22023';
  END IF;

  SELECT ROUND(SUM((r ->> 'nota')::numeric * pq.peso_calculo) / NULLIF(SUM(pq.peso_calculo), 0), 2)
    INTO v_nota
  FROM jsonb_array_elements(p_respostas) AS r
  JOIN public.perguntas_questionario pq
    ON pq.id_pergunta::text = r ->> 'id_pergunta' AND pq.id_questionario = p_id_questionario
  WHERE pq.peso_calculo > 0;

  RETURN coalesce(v_nota, ROUND(v_soma / v_qtd_respostas, 2));
END $$;

ALTER FUNCTION public.fn_validar_respostas(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_validar_respostas(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_validar_respostas(uuid, jsonb) TO authenticated;
COMMENT ON FUNCTION public.fn_validar_respostas(uuid, jsonb) IS
  'Valida o conjunto de respostas e devolve a média ponderada pelo peso_calculo. Mesma regra de fn_enviar_avaliacao.';

-- ------------------------------------------------------------------------------
-- 3. Corrigir as notas por critério de uma avaliação
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_corrigir_respostas_avaliacao(
  p_id_avaliacao uuid,
  p_respostas    jsonb,
  p_motivo       text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id_projeto   uuid;
  v_id_quest     uuid;
  v_status       text;
  v_nota_antiga  numeric(5,2);
  v_nota_nova    numeric(5,2);
  v_ator         uuid;
  v_quarentena   boolean;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_corrigir_respostas_avaliacao', p_motivo);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT a.id_projeto, coalesce(a.id_questionario, p.id_questionario_fixado), a.status, a.nota_final
    INTO v_id_projeto, v_id_quest, v_status, v_nota_antiga
  FROM public.avaliacoes a
  JOIN public.projetos p ON p.id_projeto = a.id_projeto
  WHERE a.id_avaliacao = p_id_avaliacao
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliação não encontrada.' USING ERRCODE = 'no_data_found';
  END IF;
  IF upper(coalesce(v_status, '')) = 'CANCELADA' THEN
    RAISE EXCEPTION 'Esta avaliação está cancelada: restaure antes de corrigir as notas.' USING ERRCODE = '22023';
  END IF;
  IF v_id_quest IS NULL THEN
    RAISE EXCEPTION 'Esta avaliação não tem questionário definido: não há critérios para corrigir.' USING ERRCODE = '22023';
  END IF;

  v_nota_nova := public.fn_validar_respostas(v_id_quest, p_respostas);

  SELECT u.id_usuario INTO v_ator FROM public.usuarios u
  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1;

  -- Atualiza no lugar (mantém id_resposta, e a trilha mostra o antes/depois de cada critério)
  UPDATE public.respostas_avaliacao r
  SET nota_atribuida = (nova ->> 'nota')::numeric
  FROM jsonb_array_elements(p_respostas) AS nova
  WHERE r.id_avaliacao = p_id_avaliacao
    AND r.id_pergunta = (nova ->> 'id_pergunta')::uuid
    AND r.nota_atribuida IS DISTINCT FROM (nova ->> 'nota')::numeric;

  -- Critério que ainda não tinha resposta gravada
  INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida)
  SELECT p_id_avaliacao, (nova ->> 'id_pergunta')::uuid, (nova ->> 'nota')::numeric
  FROM jsonb_array_elements(p_respostas) AS nova
  WHERE NOT EXISTS (
    SELECT 1 FROM public.respostas_avaliacao r
    WHERE r.id_avaliacao = p_id_avaliacao AND r.id_pergunta = (nova ->> 'id_pergunta')::uuid
  );

  UPDATE public.avaliacoes
  SET nota_final     = v_nota_nova,
      ajuste_tipo    = 'respostas_corrigidas',
      ajustada_em    = now(),
      ajustada_por   = v_ator,
      ajuste_motivo  = nullif(btrim(p_motivo), '')
  WHERE id_avaliacao = p_id_avaliacao;

  v_quarentena := public.fn_recalcular_quarentena(v_id_projeto);

  RETURN jsonb_build_object(
    'sucesso', true,
    'nota_anterior', v_nota_antiga,
    'nota_nova', v_nota_nova,
    'projeto_em_quarentena', v_quarentena
  );
END $$;

-- ------------------------------------------------------------------------------
-- 4. Lançar a avaliação de um avaliador identificado
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_lancar_avaliacao(
  p_id_projeto              uuid,
  p_id_usuario              uuid,
  p_id_questionario         uuid,
  p_respostas               jsonb,
  p_parecer                 text    DEFAULT NULL,
  p_motivo                  text    DEFAULT NULL,
  p_confirmar_acima_da_cota boolean DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id_evento     uuid;
  v_cota          integer;
  v_quest_fixado  uuid;
  v_codigo        text;
  v_ativas        integer;
  v_status_exist  text;
  v_nota          numeric(5,2);
  v_id_avaliacao  uuid;
  v_ator          uuid;
  v_quarentena    boolean;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_lancar_avaliacao', p_motivo);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id_evento, coalesce(p.cota_avaliacoes_customizada, e.cota_avaliacoes_padrao, 3),
         p.id_questionario_fixado, coalesce(p.codigo_projeto, p.titulo)
    INTO v_id_evento, v_cota, v_quest_fixado, v_codigo
  FROM public.projetos p
  LEFT JOIN public.eventos e ON e.id_evento = p.id_evento
  WHERE p.id_projeto = p_id_projeto
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto não encontrado.' USING ERRCODE = 'no_data_found';
  END IF;

  -- O avaliador precisa existir, ser avaliador e estar no evento do projeto
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    JOIN public.avaliadores_evento ae ON ae.id_usuario = u.id_usuario AND ae.id_evento = v_id_evento
    WHERE u.id_usuario = p_id_usuario AND upper(u.papel::text) = 'AVALIADOR'
  ) THEN
    RAISE EXCEPTION 'Este avaliador não está vinculado ao evento do projeto.' USING ERRCODE = '22023';
  END IF;

  -- Questionário do evento e compatível com o que o projeto já fixou
  IF NOT EXISTS (SELECT 1 FROM public.questionarios q
                  WHERE q.id_questionario = p_id_questionario AND q.id_evento = v_id_evento) THEN
    RAISE EXCEPTION 'Questionário de outro evento.' USING ERRCODE = '22023';
  END IF;
  IF v_quest_fixado IS NOT NULL AND v_quest_fixado IS DISTINCT FROM p_id_questionario THEN
    RAISE EXCEPTION 'O projeto % já está fixado em outro questionário: use o mesmo das demais avaliações.', v_codigo
      USING ERRCODE = '22023';
  END IF;

  -- Um avaliador, uma avaliação por projeto (vale também para a cancelada)
  SELECT a.status INTO v_status_exist FROM public.avaliacoes a
  WHERE a.id_projeto = p_id_projeto AND a.id_usuario = p_id_usuario;
  IF FOUND THEN
    IF upper(coalesce(v_status_exist, '')) = 'CANCELADA' THEN
      RAISE EXCEPTION 'Este avaliador já tem uma avaliação cancelada do projeto %: restaure em vez de lançar outra.', v_codigo
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'Este avaliador já avaliou o projeto %.', v_codigo USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_ativas FROM public.avaliacoes a
  WHERE a.id_projeto = p_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA');

  IF v_ativas >= v_cota AND NOT p_confirmar_acima_da_cota THEN
    RAISE EXCEPTION 'O projeto % já tem % de % avaliações da cota. Confirme para lançar acima da cota.',
      v_codigo, v_ativas, v_cota USING ERRCODE = '22023';
  END IF;

  v_nota := public.fn_validar_respostas(p_id_questionario, p_respostas);

  SELECT u.id_usuario INTO v_ator FROM public.usuarios u
  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1;

  INSERT INTO public.avaliacoes (
    id_projeto, id_usuario, id_questionario, nota_final, parecer_final,
    tempo_submissao, status, status_avaliacao,
    ajuste_tipo, ajustada_em, ajustada_por, ajuste_motivo
  ) VALUES (
    p_id_projeto, p_id_usuario, p_id_questionario, v_nota, p_parecer,
    now(), 'CONCLUIDA', 'concluida',
    'lancada_pelo_admin', now(), v_ator, nullif(btrim(p_motivo), '')
  )
  RETURNING id_avaliacao INTO v_id_avaliacao;

  INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida)
  SELECT v_id_avaliacao, (r ->> 'id_pergunta')::uuid, (r ->> 'nota')::numeric
  FROM jsonb_array_elements(p_respostas) AS r;

  UPDATE public.projetos
  SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL;

  v_quarentena := public.fn_recalcular_quarentena(p_id_projeto);

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', v_id_avaliacao,
    'nota_final', v_nota,
    'acima_da_cota', v_ativas >= v_cota,
    'projeto_em_quarentena', v_quarentena
  );
END $$;

-- ------------------------------------------------------------------------------
-- 5. Arbitrar a nota final (o único caso em que a conta não fecha por desenho)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_arbitrar_nota_final(
  p_id_avaliacao uuid,
  p_nota         numeric,
  p_motivo       text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id_projeto  uuid;
  v_status      text;
  v_nota_antiga numeric(5,2);
  v_min         numeric;
  v_max         numeric;
  v_ator        uuid;
  v_quarentena  boolean;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_arbitrar_nota_final', p_motivo);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT a.id_projeto, a.status, a.nota_final, q.escala_minima, q.escala_maxima
    INTO v_id_projeto, v_status, v_nota_antiga, v_min, v_max
  FROM public.avaliacoes a
  JOIN public.projetos p ON p.id_projeto = a.id_projeto
  LEFT JOIN public.questionarios q
    ON q.id_questionario = coalesce(a.id_questionario, p.id_questionario_fixado)
  WHERE a.id_avaliacao = p_id_avaliacao
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliação não encontrada.' USING ERRCODE = 'no_data_found';
  END IF;
  IF upper(coalesce(v_status, '')) = 'CANCELADA' THEN
    RAISE EXCEPTION 'Esta avaliação está cancelada: restaure antes de arbitrar a nota.' USING ERRCODE = '22023';
  END IF;
  IF p_nota IS NULL THEN
    RAISE EXCEPTION 'Informe a nota.' USING ERRCODE = '22023';
  END IF;
  IF v_min IS NOT NULL AND (p_nota < v_min OR p_nota > v_max) THEN
    RAISE EXCEPTION 'A nota precisa estar entre % e %, a escala do questionário.', v_min, v_max
      USING ERRCODE = '22023';
  END IF;

  SELECT u.id_usuario INTO v_ator FROM public.usuarios u
  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1;

  UPDATE public.avaliacoes
  SET nota_final    = round(p_nota, 2),
      ajuste_tipo   = 'nota_arbitrada',
      ajustada_em   = now(),
      ajustada_por  = v_ator,
      ajuste_motivo = nullif(btrim(p_motivo), '')
  WHERE id_avaliacao = p_id_avaliacao;

  v_quarentena := public.fn_recalcular_quarentena(v_id_projeto);

  RETURN jsonb_build_object(
    'sucesso', true,
    'nota_anterior', v_nota_antiga,
    'nota_nova', round(p_nota, 2),
    'projeto_em_quarentena', v_quarentena
  );
END $$;

-- ------------------------------------------------------------------------------
-- 6. Ajustar a média do projeto (bónus ou penalidade de comissão)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ajustar_media_projeto(
  p_id_projeto uuid,
  p_delta      numeric,
  p_motivo     text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id_evento   uuid;
  v_amplitude   numeric;
  v_delta       numeric := coalesce(round(p_delta, 2), 0);
  v_ator        uuid;
  v_codigo      text;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_ajustar_media_projeto', p_motivo);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id_evento, coalesce(p.codigo_projeto, p.titulo) INTO v_id_evento, v_codigo
  FROM public.projetos p WHERE p.id_projeto = p_id_projeto FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto não encontrado.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Teto do ajuste: a amplitude da escala em uso (um dedo errado não cria nota impossível)
  SELECT coalesce(
    (SELECT q.escala_maxima - q.escala_minima FROM public.questionarios q
      JOIN public.projetos p ON p.id_questionario_fixado = q.id_questionario
     WHERE p.id_projeto = p_id_projeto),
    (SELECT max(q.escala_maxima - q.escala_minima) FROM public.questionarios q WHERE q.id_evento = v_id_evento),
    10
  ) INTO v_amplitude;

  IF abs(v_delta) > v_amplitude THEN
    RAISE EXCEPTION 'O ajuste não pode passar de % pontos, a amplitude da escala em uso.', v_amplitude
      USING ERRCODE = '22023';
  END IF;

  SELECT u.id_usuario INTO v_ator FROM public.usuarios u
  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1;

  UPDATE public.projetos
  SET ajuste_media        = v_delta,
      ajuste_media_em     = CASE WHEN v_delta = 0 THEN NULL ELSE now() END,
      ajuste_media_por    = CASE WHEN v_delta = 0 THEN NULL ELSE v_ator END,
      ajuste_media_motivo = CASE WHEN v_delta = 0 THEN NULL ELSE nullif(btrim(p_motivo), '') END
  WHERE id_projeto = p_id_projeto;

  RETURN jsonb_build_object('sucesso', true, 'codigo_projeto', v_codigo, 'ajuste_media', v_delta);
END $$;

ALTER FUNCTION public.admin_corrigir_respostas_avaliacao(uuid, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.admin_lancar_avaliacao(uuid, uuid, uuid, jsonb, text, text, boolean) OWNER TO postgres;
ALTER FUNCTION public.admin_arbitrar_nota_final(uuid, numeric, text) OWNER TO postgres;
ALTER FUNCTION public.admin_ajustar_media_projeto(uuid, numeric, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_corrigir_respostas_avaliacao(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_lancar_avaliacao(uuid, uuid, uuid, jsonb, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_arbitrar_nota_final(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_ajustar_media_projeto(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_corrigir_respostas_avaliacao(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lancar_avaliacao(uuid, uuid, uuid, jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_arbitrar_nota_final(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ajustar_media_projeto(uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.admin_corrigir_respostas_avaliacao(uuid, jsonb, text) IS
  'Corrige as notas por critério e recalcula a nota final pela fórmula oficial. Marca ajuste_tipo = respostas_corrigidas. Só Admin.';
COMMENT ON FUNCTION public.admin_lancar_avaliacao(uuid, uuid, uuid, jsonb, text, text, boolean) IS
  'Lança a avaliação de um avaliador do evento (ficha em papel). Acima da cota só com p_confirmar_acima_da_cota. Só Admin.';
COMMENT ON FUNCTION public.admin_arbitrar_nota_final(uuid, numeric, text) IS
  'Define a nota final sem mexer nas respostas: a conferência passa a mostrar "nota arbitrada". Só Admin.';
COMMENT ON FUNCTION public.admin_ajustar_media_projeto(uuid, numeric, text) IS
  'Bónus ou penalidade na média do projeto, limitado à amplitude da escala. p_delta = 0 remove o ajuste. Só Admin.';

-- ------------------------------------------------------------------------------
-- 7. A média do projeto, sempre aberta: media_geral + ajuste_media = media_final
--    O RANK() passa a ordenar pela média final, que é o número que premia.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_ranking_top3 WITH (security_invoker = 'true') AS
 WITH base AS (
         SELECT p.id_projeto,
            p.codigo_projeto,
            p.titulo,
            p.estande,
            p.corredor,
            COALESCE(m.nome_modalidade, 'Sem modalidade'::character varying) AS modalidade,
            COALESCE(ar.nome_area, 'Sem área temática'::character varying) AS area_tematica,
            COALESCE(inst.nome_exibicao, 'Não informada'::character varying) AS nome_instituicao,
            COALESCE(array_agg(round(a.nota_final::numeric, 2) ORDER BY a.tempo_submissao, a.created_at)
                     FILTER (WHERE a.nota_final IS NOT NULL), '{}'::numeric[]) AS notas,
            COALESCE(round(avg(a.nota_final), 2), 0.00) AS media_geral,
            COALESCE(p.ajuste_media, 0) AS ajuste_media,
            COALESCE(round(avg(a.nota_final), 2), 0.00) + COALESCE(p.ajuste_media, 0) AS media_final,
            count(a.id_avaliacao) AS total_avaliacoes,
            p.id_evento
           FROM public.projetos p
             LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
             LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
             LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
             JOIN public.avaliacoes a
               ON a.id_projeto = p.id_projeto
              AND (a.status IS NULL OR a.status::text <> 'CANCELADA'::text)
          WHERE NOT COALESCE(p.is_fora_da_competicao, false)
          GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor,
                   m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento, p.ajuste_media
        ), com_chave AS (
         SELECT b_1.*, public.fn_chave_desempate(b_1.id_projeto) AS chave_desempate
           FROM base b_1
        )
 SELECT id_projeto,
    codigo_projeto,
    titulo,
    estande,
    corredor,
    modalidade,
    area_tematica,
    nome_instituicao,
    notas,
    media_geral,
    total_avaliacoes,
    id_evento,
    rank() OVER (PARTITION BY id_evento, modalidade, area_tematica
                 ORDER BY media_final DESC, chave_desempate DESC) AS posicao,
    (EXISTS ( SELECT 1
           FROM public.view_projetos_quarentena q
          WHERE q.id_projeto = b.id_projeto)) AS em_quarentena,
    chave_desempate,
    -- Colunas novas no fim: CREATE OR REPLACE VIEW só acrescenta ao final
    ajuste_media,
    media_final
   FROM com_chave b
  ORDER BY media_final DESC, codigo_projeto;

-- ------------------------------------------------------------------------------
-- 8. Relatório de projetos: três colunas novas no fim (expand/contract)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_relatorio_projetos_completo(uuid);
CREATE OR REPLACE FUNCTION public.fn_relatorio_projetos_completo(p_id_evento uuid DEFAULT NULL)
RETURNS TABLE(
  id_projeto uuid, id_evento uuid, codigo_projeto text, titulo text, estande text, corredor text,
  modalidade text, area_conhecimento text, nome_instituicao text, id_instituicao uuid,
  is_check_in_realizado boolean, is_fora_da_competicao boolean, total_avaliacoes integer,
  media_geral numeric, notas numeric[], detalhes_avaliacoes jsonb, cota_avaliacoes integer,
  ajuste_media numeric, media_final numeric, tem_ajuste_manual boolean
)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH avaliacoes_validas AS (
    SELECT a.id_avaliacao, a.id_projeto, a.id_usuario, u.nome AS avaliador_nome,
      round(a.nota_final::numeric, 2) AS nota_final,
      coalesce(a.parecer_final, '') AS parecer,
      coalesce(a.tempo_submissao, a.created_at) AS data,
      a.ajuste_tipo, a.ajuste_motivo
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
      'nota_final', av.nota_final, 'parecer', av.parecer, 'data', av.data,
      'ajuste_tipo', av.ajuste_tipo, 'ajuste_motivo', av.ajuste_motivo
    ) ORDER BY av.data DESC) FILTER (WHERE av.id_avaliacao IS NOT NULL), '[]'::jsonb),
    coalesce(p.cota_avaliacoes_customizada, ev.cota_avaliacoes_padrao, 3)::int,
    coalesce(p.ajuste_media, 0),
    coalesce(round(avg(av.nota_final), 2), 0.00) + coalesce(p.ajuste_media, 0),
    coalesce(p.ajuste_media, 0) <> 0 OR bool_or(av.ajuste_tipo IS NOT NULL)
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

ALTER FUNCTION public.fn_relatorio_projetos_completo(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_relatorio_projetos_completo(uuid) FROM PUBLIC, anon;
GRANT ALL  ON FUNCTION public.fn_relatorio_projetos_completo(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. Relatório de instituições: a média do projeto já com o ajuste
--    (a "média geral de notas" dos Indicadores continua sendo a média das notas
--     lançadas: é um indicador sobre notas, não sobre o resultado final.)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_instituicao" "uuid", "nome_instituicao" "text", "total_projetos" integer, "total_credenciados" integer, "total_avaliados" integer, "media_geral_escola" numeric, "projetos" "jsonb")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
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
        SELECT COALESCE(ROUND(AVG(av.nota_final)::numeric, 2) + coalesce(p.ajuste_media, 0), 0.00)
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

-- ------------------------------------------------------------------------------
-- 10. A conferência aprende a diferença entre ajuste declarado e adulteração
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auditar_notas(p_id_evento uuid DEFAULT NULL)
  RETURNS TABLE (
    severidade     text,
    codigo         text,
    titulo         text,
    id_projeto     uuid,
    codigo_projeto text,
    id_avaliacao   uuid,
    esperado       text,
    encontrado     text,
    detalhe        text
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id_evento uuid := coalesce(p_id_evento, public.evento_ativo_id());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: a conferência de notas é restrita a administradores.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH proj AS (
    SELECT p.id_projeto, p.codigo_projeto::text AS codigo_projeto, p.titulo, p.id_questionario_fixado,
           p.is_check_in_realizado, p.is_fora_da_competicao,
           coalesce(p.ajuste_media, 0) AS ajuste_media,
           coalesce(p.cota_avaliacoes_customizada,
                    (SELECT coalesce(e.cota_avaliacoes_padrao, 3) FROM public.eventos e WHERE e.id_evento = v_id_evento)
           ) AS cota
    FROM public.projetos p
    WHERE p.id_evento = v_id_evento
  ),
  av AS (
    SELECT a.id_avaliacao, a.id_projeto, a.nota_final, a.id_usuario, a.created_at,
           a.ajuste_tipo, a.ajustada_em, a.ajustada_por, a.ajuste_motivo,
           pr.codigo_projeto, pr.id_questionario_fixado,
           coalesce(a.id_questionario, pr.id_questionario_fixado) AS id_quest
    FROM public.avaliacoes a
    JOIN proj pr ON pr.id_projeto = a.id_projeto
    WHERE a.status IS NULL OR a.status <> 'CANCELADA'
  ),
  escala AS (
    SELECT q.id_questionario, q.escala_minima, q.escala_maxima,
           (SELECT count(*) FROM public.perguntas_questionario pq WHERE pq.id_questionario = q.id_questionario) AS qtd_perguntas
    FROM public.questionarios q
  ),
  recalculo AS (
    SELECT r.id_avaliacao,
           round(sum(r.nota_atribuida * pq.peso_calculo) / nullif(sum(pq.peso_calculo), 0), 2) AS nota_calculada,
           sum(r.nota_atribuida * pq.peso_calculo) AS soma_produtos,
           sum(pq.peso_calculo) AS soma_pesos
    FROM public.respostas_avaliacao r
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE pq.peso_calculo > 0
    GROUP BY r.id_avaliacao
  )

  -- C1: a conta não fecha
  SELECT CASE WHEN av.ajuste_tipo = 'nota_arbitrada' THEN 'informativo' ELSE 'grave' END,
         'C1',
         CASE WHEN av.ajuste_tipo = 'nota_arbitrada'
              THEN 'Nota arbitrada pelo Admin (não vem das respostas)'
              ELSE 'Nota final não confere com as notas por critério' END,
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         to_char(rc.nota_calculada, 'FM999990.00'), to_char(av.nota_final, 'FM999990.00'),
         CASE WHEN av.ajuste_tipo = 'nota_arbitrada'
              THEN format('Nota arbitrada em %s. Motivo: %s. As respostas dariam %s.',
                          to_char(av.ajustada_em, 'DD-MM-YYYY HH24:MI'),
                          coalesce(av.ajuste_motivo, 'não informado'), rc.nota_calculada)
              ELSE format('Σ(nota × peso) = %s · Σ(pesos) = %s · %s ÷ %s = %s, mas está gravado %s',
                          rc.soma_produtos, rc.soma_pesos, rc.soma_produtos, rc.soma_pesos,
                          rc.nota_calculada, av.nota_final) END
  FROM av JOIN recalculo rc ON rc.id_avaliacao = av.id_avaliacao
  WHERE av.nota_final IS DISTINCT FROM rc.nota_calculada

  UNION ALL
  -- C2: avaliação ativa sem resposta nenhuma
  SELECT 'grave', 'C2', 'Avaliação ativa sem notas por critério',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         'uma resposta por pergunta do questionário', 'nenhuma resposta gravada',
         'Sem as respostas não há como refazer a conta desta nota.'
  FROM av
  WHERE NOT EXISTS (SELECT 1 FROM public.respostas_avaliacao r WHERE r.id_avaliacao = av.id_avaliacao)

  UNION ALL
  -- C3a: número de respostas diferente do número de perguntas
  SELECT 'grave', 'C3', 'Quantidade de respostas diferente do questionário',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         e.qtd_perguntas::text || ' respostas', cnt.qtd::text || ' respostas',
         'O questionário tem outra quantidade de perguntas do que o que foi respondido.'
  FROM av
  JOIN escala e ON e.id_questionario = av.id_quest
  JOIN LATERAL (SELECT count(*) AS qtd FROM public.respostas_avaliacao r WHERE r.id_avaliacao = av.id_avaliacao) cnt ON true
  WHERE cnt.qtd > 0 AND cnt.qtd <> e.qtd_perguntas

  UNION ALL
  -- C3b: pergunta respondida mais de uma vez
  SELECT 'grave', 'C3', 'Pergunta respondida mais de uma vez',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         'uma resposta por pergunta', d.qtd::text || ' respostas para a mesma pergunta',
         'Repetir uma pergunta muda o peso dela na média.'
  FROM av
  JOIN LATERAL (
    SELECT r.id_pergunta, count(*) AS qtd
    FROM public.respostas_avaliacao r
    WHERE r.id_avaliacao = av.id_avaliacao
    GROUP BY r.id_pergunta HAVING count(*) > 1
    LIMIT 1
  ) d ON true

  UNION ALL
  -- C3c: resposta de pergunta que não é do questionário da avaliação
  SELECT 'grave', 'C3', 'Resposta de pergunta de outro questionário',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         'perguntas do questionário da avaliação', 'pergunta de outro questionário',
         'A nota foi composta com critério que não pertence ao questionário usado.'
  FROM av
  WHERE EXISTS (
    SELECT 1 FROM public.respostas_avaliacao r
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE r.id_avaliacao = av.id_avaliacao
      AND pq.id_questionario IS DISTINCT FROM av.id_quest
  )

  UNION ALL
  -- C4: nota por critério fora da escala
  SELECT 'grave', 'C4', 'Nota por critério fora da escala',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         format('entre %s e %s', e.escala_minima, e.escala_maxima),
         to_char(r.nota_atribuida, 'FM999990.00'),
         'Uma nota fora da escala do questionário distorce a média.'
  FROM av
  JOIN escala e ON e.id_questionario = av.id_quest
  JOIN public.respostas_avaliacao r ON r.id_avaliacao = av.id_avaliacao
  WHERE r.nota_atribuida < e.escala_minima OR r.nota_atribuida > e.escala_maxima

  UNION ALL
  -- C5: nota final fora da escala
  SELECT 'grave', 'C5', 'Nota final fora da escala',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         format('entre %s e %s', e.escala_minima, e.escala_maxima),
         to_char(av.nota_final, 'FM999990.00'),
         'A média ponderada nunca pode cair fora da escala do questionário.'
  FROM av JOIN escala e ON e.id_questionario = av.id_quest
  WHERE av.nota_final IS NOT NULL
    AND (av.nota_final < e.escala_minima OR av.nota_final > e.escala_maxima)

  UNION ALL
  -- C6: mais avaliações ativas do que a cota
  SELECT 'atencao', 'C6', 'Projeto com mais avaliações que a cota',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         pr.cota::text || ' avaliações', c.qtd::text || ' avaliações',
         'Avaliação além da cota entra na média e desequilibra a comparação com os outros projetos.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av WHERE av.id_projeto = pr.id_projeto) c ON true
  WHERE c.qtd > pr.cota

  UNION ALL
  -- C7a: avaliação ativa de projeto fora da competição
  SELECT 'atencao', 'C7', 'Projeto fora da competição com avaliação ativa',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         'nenhuma avaliação', c.qtd::text || ' avaliações',
         'O projeto não entra no ranking, mas as notas continuam gravadas.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av WHERE av.id_projeto = pr.id_projeto) c ON true
  WHERE pr.is_fora_da_competicao AND c.qtd > 0

  UNION ALL
  -- C7b: avaliação ativa de projeto sem check-in
  SELECT 'atencao', 'C7', 'Projeto sem check-in com avaliação ativa',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         'check-in feito antes da avaliação', 'sem check-in',
         'fn_enviar_avaliacao exige check-in: uma avaliação assim entrou por outro caminho.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av WHERE av.id_projeto = pr.id_projeto) c ON true
  WHERE NOT coalesce(pr.is_check_in_realizado, false) AND c.qtd > 0

  UNION ALL
  -- C8: questionário diferente do fixado no projeto
  SELECT 'grave', 'C8', 'Avaliação com questionário diferente do fixado',
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         coalesce(qf.titulo, 'questionário fixado no projeto'),
         coalesce(qa.titulo, 'outro questionário'),
         'Projetos da mesma modalidade precisam ser comparados pelo mesmo questionário.'
  FROM av
  LEFT JOIN public.questionarios qf ON qf.id_questionario = av.id_questionario_fixado
  LEFT JOIN public.questionarios qa ON qa.id_questionario = av.id_quest
  WHERE av.id_questionario_fixado IS NOT NULL
    AND av.id_quest IS DISTINCT FROM av.id_questionario_fixado

  UNION ALL
  -- C9: a mesma média com números diferentes em telas diferentes
  SELECT 'grave', 'C9', 'Média diferente entre a Classificação e os Relatórios',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         to_char(direto.media, 'FM999990.00'),
         format('ranking %s · relatório %s',
                coalesce(to_char(rk.media_final, 'FM999990.00'), '—'),
                coalesce(to_char(rel.media_final, 'FM999990.00'), '—')),
         'As telas calculam a média em lugares diferentes: divergência aqui é erro de uma das fontes.'
  FROM proj pr
  JOIN LATERAL (SELECT round(avg(av.nota_final), 2) + pr.ajuste_media AS media, count(*) AS qtd
                FROM av WHERE av.id_projeto = pr.id_projeto) direto ON true
  LEFT JOIN public.view_ranking_top3 rk ON rk.id_projeto = pr.id_projeto
  LEFT JOIN public.fn_relatorio_projetos_completo(v_id_evento) rel ON rel.id_projeto = pr.id_projeto
  WHERE direto.qtd > 0
    AND NOT pr.is_fora_da_competicao
    AND (rk.media_final IS DISTINCT FROM direto.media OR rel.media_final IS DISTINCT FROM direto.media)

  UNION ALL
  -- C10: escrita de nota que não passou por RPC nenhuma
  SELECT 'grave', 'C10', 'Nota alterada fora do fluxo do sistema',
         l.id_projeto, coalesce(pr.codigo_projeto, l.id_registro), l.id_avaliacao,
         'alteração por RPC (fn_enviar_avaliacao, excluir_avaliacao...)',
         format('%s direto em %s', l.operacao, l.tabela),
         format('Em %s, por %s. Antes: %s · Depois: %s',
                to_char(l.criado_em, 'DD-MM-YYYY HH24:MI'),
                coalesce(l.ator_papel, 'origem não identificada'),
                coalesce(l.dados_antes ->> 'nota_final', l.dados_antes ->> 'nota_atribuida', '—'),
                coalesce(l.dados_depois ->> 'nota_final', l.dados_depois ->> 'nota_atribuida', '—'))
  FROM public.log_auditoria l
  LEFT JOIN proj pr ON pr.id_projeto = l.id_projeto
  WHERE l.origem = 'direto'
    AND l.tabela IN ('avaliacoes', 'respostas_avaliacao', 'perguntas_questionario')
    AND l.operacao IN ('UPDATE', 'DELETE')
    AND (l.id_evento = v_id_evento OR l.id_evento IS NULL)

  UNION ALL
  -- C11: peso alterado depois de o questionário já ter sido usado
  SELECT 'atencao', 'C11', 'Peso de pergunta alterado depois da primeira avaliação',
         NULL::uuid, NULL::text, NULL::uuid,
         coalesce(l.dados_antes ->> 'peso_calculo', '—'),
         coalesce(l.dados_depois ->> 'peso_calculo', '—'),
         format('Pergunta "%s" em %s: as notas gravadas antes disso usaram o peso antigo.',
                coalesce(l.dados_depois ->> 'texto_pergunta', '?'),
                to_char(l.criado_em, 'DD-MM-YYYY HH24:MI'))
  FROM public.log_auditoria l
  WHERE l.acao = 'peso_calculo_alterado'
    AND l.id_evento = v_id_evento
    AND EXISTS (
      SELECT 1 FROM av
      JOIN public.respostas_avaliacao r ON r.id_avaliacao = av.id_avaliacao
      WHERE r.id_pergunta = (l.dados_depois ->> 'id_pergunta')::uuid
        AND av.created_at < l.criado_em
    )

  UNION ALL
  -- C12a: avaliação ajustada à mão pelo Admin (nunca é erro: é a lista que a
  --       comissão confere antes de homologar)
  SELECT 'informativo', 'C12',
         CASE av.ajuste_tipo
           WHEN 'respostas_corrigidas' THEN 'Notas por critério corrigidas pelo Admin'
           WHEN 'nota_arbitrada'       THEN 'Nota final arbitrada pelo Admin'
           WHEN 'lancada_pelo_admin'   THEN 'Avaliação lançada pelo Admin'
           ELSE 'Avaliação ajustada pelo Admin'
         END,
         av.id_projeto, av.codigo_projeto, av.id_avaliacao,
         '—', to_char(av.nota_final, 'FM999990.00'),
         format('Em %s, por %s. Motivo: %s',
                to_char(av.ajustada_em, 'DD-MM-YYYY HH24:MI'),
                coalesce((SELECT u.nome FROM public.usuarios u WHERE u.id_usuario = av.ajustada_por), 'Admin'),
                coalesce(av.ajuste_motivo, 'não informado'))
  FROM av
  WHERE av.ajuste_tipo IS NOT NULL

  UNION ALL
  -- C12b: média do projeto ajustada por decisão de comissão
  SELECT 'informativo', 'C12', 'Média do projeto ajustada por decisão de comissão',
         p.id_projeto, p.codigo_projeto::text, NULL::uuid,
         to_char(media.valor, 'FM999990.00'),
         to_char(media.valor + p.ajuste_media, 'FM999990.00'),
         format('Ajuste de %s ponto(s) em %s, por %s. Motivo: %s',
                to_char(p.ajuste_media, 'FM999990.00'),
                to_char(p.ajuste_media_em, 'DD-MM-YYYY HH24:MI'),
                coalesce((SELECT u.nome FROM public.usuarios u WHERE u.id_usuario = p.ajuste_media_por), 'Admin'),
                coalesce(p.ajuste_media_motivo, 'não informado'))
  FROM public.projetos p
  JOIN LATERAL (SELECT coalesce(round(avg(a.nota_final), 2), 0) AS valor
                FROM public.avaliacoes a
                WHERE a.id_projeto = p.id_projeto
                  AND (a.status IS NULL OR a.status <> 'CANCELADA')) media ON true
  WHERE p.id_evento = v_id_evento AND p.ajuste_media <> 0;
END $$;

-- ------------------------------------------------------------------------------
-- 11. O memorial mostra o ajuste e a média final
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
                         ORDER BY l.id_log DESC LIMIT 1),
    -- Ajuste manual: é o que distingue nota arbitrada (legítima, com motivo) de
    -- nota que não fecha sem explicação nenhuma.
    'ajuste',          CASE WHEN a.ajuste_tipo IS NULL THEN NULL ELSE jsonb_build_object(
                         'tipo',   a.ajuste_tipo,
                         'em',     a.ajustada_em,
                         'motivo', a.ajuste_motivo,
                         'por',    (SELECT jsonb_build_object('id_usuario', aj.id_usuario, 'nome', aj.nome)
                                      FROM public.usuarios aj WHERE aj.id_usuario = a.ajustada_por)
                       ) END
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

COMMIT;
