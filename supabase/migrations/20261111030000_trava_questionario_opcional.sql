-- ==============================================================================
-- MIGRATION: 20261111030000_trava_questionario_opcional.sql
-- DESCRIÇÃO: travar o questionário no primeiro avaliador passa a ser opção do evento.
--   * Até aqui a regra era incondicional: a primeira avaliação gravava
--     projetos.id_questionario_fixado e o servidor recusava qualquer outro
--     questionário naquele projeto ("Este projeto já é avaliado com outro
--     questionário"). Em feira com mais de um questionário aplicável, isso
--     obrigava a coordenação a aceitar o que o primeiro avaliador escolheu.
--   * eventos.fixar_questionario_primeira_avaliacao (DEFAULT true) mantém o
--     comportamento atual. Desligada: cada avaliador escolhe, nada é fixado e o
--     servidor não recusa mais questionário diferente — inclusive em projeto que
--     já tinha questionário fixado de antes.
--   * fn_auditar_notas: a checagem C8 ("questionário diferente do fixado") só
--     vale com a trava ligada, senão a conferência acusaria como grave o que é
--     regra do evento.
--   * fn_fixar_questionario (hoje sem chamador no front-end) respeita a opção.
--   * fn_meu_perfil devolve a opção, para a tela do avaliador saber se pode
--     oferecer a escolha do questionário.
-- FRONT-END: compatível com a versão anterior (coluna nova com DEFAULT true,
--   assinaturas inalteradas; a versão antiga simplesmente não lê a chave nova).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS fixar_questionario_primeira_avaliacao boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.eventos.fixar_questionario_primeira_avaliacao IS
  'Ligada (padrão): a primeira avaliação fixa o questionário do projeto (projetos.id_questionario_fixado) e os demais avaliadores ficam presos a ele. Desligada: cada avaliador escolhe o questionário e nada é fixado.';

-- ------------------------------------------------------------------------------
-- 1. Envio de nota: a fixação e a recusa passam a depender da opção do evento
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text" DEFAULT NULL::"text", "p_tempo_presenca" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id_evento             uuid;
  v_id_instituicao_aval   uuid;
  v_inst_projeto          uuid;
  v_modalidade_projeto    uuid;
  v_check_in              boolean;
  v_fora_competicao       boolean;
  v_tinha_trava           boolean;
  v_cota_padrao           integer;
  v_cota_projeto          integer;
  v_quest_fixado          uuid;
  v_quest_evento          uuid;
  v_total_perguntas       integer;
  v_distintas             integer;
  v_alheias               integer;
  v_nulas                 integer;
  v_sistema_liberado      boolean;
  v_fixar_questionario    boolean;
  v_escala_min            numeric(5,2);
  v_escala_max            numeric(5,2);
  v_qtd_respostas         integer;
  v_qtd_fora_escala       integer;
  v_soma                  numeric;
  v_nota_final            numeric(5,2);
  v_avaliacoes_ativas     integer;
  v_nota_min              numeric(5,2);
  v_nota_max              numeric(5,2);
  v_is_quarentena         boolean := false;
  v_id_avaliacao          uuid;
BEGIN
  PERFORM public.auditoria_marcar_origem('fn_enviar_avaliacao');
  -- Identidade real: o avaliador só age em nome de si mesmo (aparelho vinculado).
  IF NOT public.is_admin() AND public.avaliador_atual() IS DISTINCT FROM p_id_usuario THEN
    RAISE EXCEPTION 'Acesso negado: este aparelho não está vinculado a este avaliador.' USING ERRCODE = '42501';
  END IF;
  -- 1. POSSE DE TRAVA: o avaliador só grava se detém a trava ativa deste projeto.
  SELECT EXISTS (
    SELECT 1 FROM public.locks_ativos
    WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto
  ) INTO v_tinha_trava;

  IF NOT v_tinha_trava THEN
    RAISE EXCEPTION 'Sem trava ativa para este avaliador/projeto. Sorteie o projeto antes de avaliar.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. PROJETO ELEGÍVEL.
  SELECT p.id_evento, p.id_instituicao, p.id_modalidade,
         COALESCE(p.is_check_in_realizado, false),
         COALESCE(p.is_fora_da_competicao, false),
         p.cota_avaliacoes_customizada, p.id_questionario_fixado
    INTO v_id_evento, v_inst_projeto, v_modalidade_projeto,
         v_check_in, v_fora_competicao, v_cota_projeto, v_quest_fixado
  FROM public.projetos p
  WHERE p.id_projeto = p_id_projeto;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto inexistente.' USING ERRCODE = '42501';
  END IF;
  IF v_fora_competicao THEN
    RAISE EXCEPTION 'Projeto fora da competição não pode ser avaliado.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_check_in THEN
    RAISE EXCEPTION 'Projeto sem check-in presencial.' USING ERRCODE = '42501';
  END IF;

  -- 3. SEM DUPLICIDADE (respeita unica_avaliacao_por_usuario; inclui canceladas).
  IF EXISTS (
    SELECT 1 FROM public.avaliacoes
    WHERE id_projeto = p_id_projeto AND id_usuario = p_id_usuario
  ) THEN
    RAISE EXCEPTION 'Este avaliador já possui avaliação registrada para este projeto.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. CONFLITO INSTITUCIONAL (mesma regra de sortear_proximo_projeto).
  SELECT ae.id_instituicao INTO v_id_instituicao_aval
  FROM public.avaliadores_evento ae
  WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = v_id_evento;

  IF v_id_instituicao_aval IS NOT NULL
     AND v_inst_projeto IS NOT DISTINCT FROM v_id_instituicao_aval THEN
    RAISE EXCEPTION 'Conflito de interesse: avaliador da mesma instituição do projeto.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. MODALIDADE BLOQUEADA.
  IF v_modalidade_projeto IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.avaliador_modalidades_bloqueadas amb
    WHERE amb.id_usuario = p_id_usuario
      AND amb.id_evento = v_id_evento
      AND amb.id_modalidade = v_modalidade_projeto
  ) THEN
    RAISE EXCEPTION 'Modalidade do projeto bloqueada para este avaliador.'
      USING ERRCODE = '42501';
  END IF;

  -- 6. COTA ESTRITA. A trava deste avaliador (que agora vira avaliação) não conta
  --    como avaliação ativa, então basta garantir que as avaliações já concluídas
  --    não tenham atingido a cota. O excesso de travas simultâneas é barrado no
  --    sorteio; aqui o avaliador já detém a sua e está concluindo.
  SELECT COALESCE(e.cota_avaliacoes_padrao, 3),
         COALESCE(e.sistema_liberado, true),
         COALESCE(e.fixar_questionario_primeira_avaliacao, true)
    INTO v_cota_padrao, v_sistema_liberado, v_fixar_questionario
  FROM public.eventos e WHERE e.id_evento = v_id_evento;

  SELECT COUNT(*) INTO v_avaliacoes_ativas
  FROM public.avaliacoes a
  WHERE a.id_projeto = p_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA');

  IF v_avaliacoes_ativas >= COALESCE(v_cota_projeto, v_cota_padrao) THEN
    RAISE EXCEPTION 'Cota de avaliações do projeto já atingida.' USING ERRCODE = '42501';
  END IF;

  -- 7. JANELA TEMPORAL. Tolerância: como há trava ativa, o avaliador está
  --    concluindo um projeto em andamento; só bloqueamos se o sistema foi
  --    explicitamente desligado.
  IF v_sistema_liberado = false THEN
    RAISE EXCEPTION 'Sistema de avaliação bloqueado pela coordenação.' USING ERRCODE = '42501';
  END IF;

  -- 8. QUESTIONÁRIO DO PROJETO: do mesmo evento e, se já fixado, o mesmo.
  IF p_id_questionario IS NULL THEN
    RAISE EXCEPTION 'Escolha o questionário da avaliação.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(q.escala_minima, 0), COALESCE(q.escala_maxima, 10), q.id_evento
    INTO v_escala_min, v_escala_max, v_quest_evento
  FROM public.questionarios q WHERE q.id_questionario = p_id_questionario;
  IF NOT FOUND OR v_quest_evento IS DISTINCT FROM v_id_evento THEN
    RAISE EXCEPTION 'Questionário não pertence ao evento do projeto.' USING ERRCODE = '42501';
  END IF;
  -- Só recusa quando o evento trava o questionário no primeiro avaliador
  IF v_fixar_questionario AND v_quest_fixado IS NOT NULL AND v_quest_fixado <> p_id_questionario THEN
    RAISE EXCEPTION 'Este projeto já é avaliado com outro questionário.' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_parecer, '')) > 5000 THEN
    RAISE EXCEPTION 'Parecer muito longo (máximo de 5000 caracteres).' USING ERRCODE = '22001';
  END IF;

  -- 8.1 RESPOSTAS: todas as perguntas do questionário, uma vez cada, com nota.
  --     (antes, a média de qualquer lista enviada: responder só a pergunta conveniente ou repeti-la mudava a nota)
  IF jsonb_typeof(p_respostas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Respostas em formato inválido.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total_perguntas FROM public.perguntas_questionario WHERE id_questionario = p_id_questionario;
  SELECT count(*),
         count(DISTINCT r->>'id_pergunta'),
         count(*) FILTER (WHERE pq.id_pergunta IS NULL),
         count(*) FILTER (WHERE jsonb_typeof(r->'nota') IS DISTINCT FROM 'number')
    INTO v_qtd_respostas, v_distintas, v_alheias, v_nulas
  FROM jsonb_array_elements(p_respostas) AS r
  LEFT JOIN public.perguntas_questionario pq
    ON pq.id_pergunta::text = r->>'id_pergunta' AND pq.id_questionario = p_id_questionario;
  IF v_total_perguntas = 0 OR v_qtd_respostas <> v_total_perguntas OR v_distintas <> v_qtd_respostas
     OR v_alheias > 0 OR v_nulas > 0 THEN
    RAISE EXCEPTION 'Responda todas as % perguntas do questionário, uma vez cada, com uma nota.', v_total_perguntas
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (
           WHERE (r->>'nota')::numeric < v_escala_min
              OR (r->>'nota')::numeric > v_escala_max
         ),
         COALESCE(SUM((r->>'nota')::numeric), 0)
    INTO v_qtd_respostas, v_qtd_fora_escala, v_soma
  FROM jsonb_array_elements(p_respostas) AS r;

  IF v_qtd_respostas = 0 THEN
    RAISE EXCEPTION 'Nenhuma nota informada.' USING ERRCODE = '22023';
  END IF;
  IF v_qtd_fora_escala > 0 THEN
    RAISE EXCEPTION 'Nota fora da escala permitida (% a %).', v_escala_min, v_escala_max
      USING ERRCODE = '22003';
  END IF;

  -- 9. NOTA FINAL calculada no servidor: média ponderada pelo peso_calculo de
  --    cada pergunta (lido do banco, nunca do cliente). Pesos iguais = média simples.
  SELECT ROUND(SUM((r->>'nota')::numeric * pq.peso_calculo) / NULLIF(SUM(pq.peso_calculo), 0), 2)
    INTO v_nota_final
  FROM jsonb_array_elements(p_respostas) AS r
  JOIN public.perguntas_questionario pq
    ON pq.id_pergunta::text = r->>'id_pergunta' AND pq.id_questionario = p_id_questionario
  WHERE pq.peso_calculo > 0;
  v_nota_final := COALESCE(v_nota_final, ROUND(v_soma / v_qtd_respostas, 2));

  -- 10. GRAVAÇÃO ATÔMICA.
  INSERT INTO public.avaliacoes (
    id_projeto, id_usuario, id_questionario, nota_final, parecer_final,
    tempo_presenca, tempo_submissao, status, status_avaliacao
  ) VALUES (
    p_id_projeto, p_id_usuario, p_id_questionario, v_nota_final, p_parecer,
    p_tempo_presenca, now(), 'CONCLUIDA', 'concluida'
  )
  RETURNING id_avaliacao INTO v_id_avaliacao;

  INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida)
  SELECT v_id_avaliacao, (r->>'id_pergunta')::uuid, (r->>'nota')::numeric
  FROM jsonb_array_elements(p_respostas) AS r;

  -- Fixa o questionário do projeto se ainda não houver, e só se o evento travar no primeiro avaliador.
  UPDATE public.projetos
  SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL
    AND p_id_questionario IS NOT NULL
    AND v_fixar_questionario;

  -- Quarentena: a MESMA função usada por excluir/restaurar e pela view.
  -- Antes este bloco duplicava a regra sem exigir 2 avaliações nem respeitar
  -- quarentena_resolvida_em, e só sabia marcar, nunca desmarcar.
  v_is_quarentena := public.fn_recalcular_quarentena(p_id_projeto);

  -- Libera a trava e conclui a fila direcionada, se houver.
  DELETE FROM public.locks_ativos
  WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto;

  UPDATE public.fila_atribuicoes_direcionadas
  SET status = 'concluido'
  WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto
    AND status IN ('pendente', 'em_andamento');

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', v_id_avaliacao,
    'nota_final', v_nota_final,
    'is_quarentena', v_is_quarentena
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Fixar questionário à parte (sem chamador no front-end hoje): mesma regra
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fixar_questionario(p_id_projeto uuid, p_id_questionario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixar boolean;
BEGIN
  IF public.avaliador_atual() IS NULL THEN
    RAISE EXCEPTION 'Aparelho não vinculado a um avaliador.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.locks_ativos
    WHERE id_usuario = public.avaliador_atual() AND id_projeto = p_id_projeto AND expira_em > now()
  ) THEN
    RAISE EXCEPTION 'É preciso estar com o projeto em avaliação.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(e.fixar_questionario_primeira_avaliacao, true) INTO v_fixar
  FROM public.eventos e
  JOIN public.projetos p ON p.id_evento = e.id_evento
  WHERE p.id_projeto = p_id_projeto;

  IF NOT coalesce(v_fixar, true) THEN
    RAISE EXCEPTION 'Este evento não trava o questionário no primeiro avaliador.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.projetos SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Conferência de notas: C8 só vale com a trava ligada
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
    -- Só é achado quando o evento trava o questionário no primeiro avaliador: com a trava
    -- desligada, questionário diferente é a regra do evento, não um erro.
    AND coalesce((SELECT e.fixar_questionario_primeira_avaliacao FROM public.eventos e
                   WHERE e.id_evento = v_id_evento), true)

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
-- 4. Perfil da sessão: a tela do avaliador precisa saber se pode escolher
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_meu_perfil()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_evento  public.eventos;
  v_usuario public.usuarios;
  v_papel   text;
BEGIN
  v_evento := public.parametros_acesso(NULL);

  IF auth.uid() IS NOT NULL THEN
    IF public.is_admin() OR public.is_staff() THEN
      SELECT * INTO v_usuario FROM public.usuarios
      WHERE (id_usuario = auth.uid() OR id_auth = auth.uid()) LIMIT 1;
      v_papel := CASE WHEN public.is_admin() THEN 'admin' ELSE 'staff' END;
    ELSIF public.avaliador_atual() IS NOT NULL THEN
      SELECT * INTO v_usuario FROM public.usuarios WHERE id_usuario = public.avaliador_atual();
      v_papel := 'avaliador';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'autenticado',     auth.uid() IS NOT NULL,
    'papel',           v_papel,
    'id_usuario',      v_usuario.id_usuario,
    'nome',            v_usuario.nome,
    'email',           v_usuario.email,
    'id_evento',       v_evento.id_evento,
    'metodos_vinculo', coalesce(v_evento.metodos_vinculo, 'pareamento'),
    -- Trava do questionário no primeiro avaliador: decide se o celular oferece a escolha
    'fixar_questionario', coalesce(v_evento.fixar_questionario_primeira_avaliacao, true),
    -- Sessão de Admin/Staff neste navegador: a tela do avaliador precisa de uma sessão só do aparelho
    'sessao_equipe',   public.sessao_de_conta_da_equipe()
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
