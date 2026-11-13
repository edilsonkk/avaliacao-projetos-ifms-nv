-- ==============================================================================
-- MIGRATION: 20261111050000_voto_popular_caminho_da_nota.sql
-- DESCRIÇÃO: voto popular no caminho crítico da nota (parte 2 de 3).
--   Toda contagem de avaliação que decide cota, quarentena, vaga, trava ou fim da
--   feira passa a contar só nota técnica (NOT is_voto_popular), e o sorteio ganha
--   a pista do votante.
--   * fn_enviar_avaliacao: avaliador vinculado só envia o questionário dele; a
--     cota não se aplica ao voto popular e conta só nota técnica; questionário de
--     voto popular nunca fixa o do projeto nem bate na trava do passo 8.
--   * sortear_proximo_projeto: votante ignora a cota técnica e as travas (vários
--     votantes no mesmo projeto, e um votante não impede o avaliador técnico); o
--     avaliador técnico passa a ignorar a trava de votante. Mantém
--     FOR UPDATE ... SKIP LOCKED e o retry dos dois lados.
--   * fn_vagas_projeto, fn_avaliacoes_ativas_do_projeto, fn_feira_concluida,
--     fn_recalcular_quarentena, admin_lancar_avaliacao e restaurar_avaliacao:
--     contagens de cota e divergência só com nota técnica.
--   * fn_motivo_inelegivel: banca e fila direcionada recusam votante — são
--     ferramentas de avaliação técnica e a trava ocuparia vaga indevidamente.
-- FRONT-END: compatível com a versão anterior (assinaturas inalteradas).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- 1. Envio da nota -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_enviar_avaliacao(p_id_usuario uuid, p_id_projeto uuid, p_id_questionario uuid, p_respostas jsonb, p_parecer text DEFAULT NULL::text, p_tempo_presenca text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_voto_popular          boolean;
  v_quest_vinculado       uuid;
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

  -- Esta avaliação é de voto popular? Quem decide é a marca do questionário.
  SELECT coalesce(q.is_voto_popular, false) INTO v_voto_popular
  FROM public.questionarios q WHERE q.id_questionario = p_id_questionario;
  v_voto_popular := coalesce(v_voto_popular, false);

  -- Avaliador vinculado a um questionário só usa aquele (é assim que o votante existe)
  v_quest_vinculado := public.questionario_do_avaliador(p_id_usuario, v_id_evento);
  IF v_quest_vinculado IS NOT NULL AND v_quest_vinculado IS DISTINCT FROM p_id_questionario THEN
    RAISE EXCEPTION 'Este avaliador está vinculado a outro questionário neste evento.' USING ERRCODE = '42501';
  END IF;

  -- COTA: só vale para nota técnica, e conta só nota técnica. O voto popular corre à parte.
  SELECT COUNT(*) INTO v_avaliacoes_ativas
  FROM public.avaliacoes a
  WHERE a.id_projeto = p_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
    AND NOT a.is_voto_popular;

  IF NOT v_voto_popular AND v_avaliacoes_ativas >= COALESCE(v_cota_projeto, v_cota_padrao) THEN
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
  IF v_fixar_questionario AND NOT v_voto_popular AND v_quest_fixado IS NOT NULL AND v_quest_fixado <> p_id_questionario THEN
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
    AND v_fixar_questionario
    AND NOT v_voto_popular;

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
$function$;


-- 2. Sorteio: pista do votante ----------------------------------------------
CREATE OR REPLACE FUNCTION public.sortear_proximo_projeto(p_id_usuario uuid, p_id_evento uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_descartados UUID[] := '{}';
  v_tentativas INTEGER := 0;
  v_id_instituicao_avaliador UUID;
  v_id_projeto_sorteado UUID;
  v_minutos_lock INTEGER := 30;
  v_cota_padrao INTEGER := 3;
  v_votante BOOLEAN := false;
BEGIN
  -- Identidade real: o avaliador só age em nome de si mesmo (aparelho vinculado).
  IF NOT public.is_admin() AND public.avaliador_atual() IS DISTINCT FROM p_id_usuario THEN
    RAISE EXCEPTION 'Acesso negado: este aparelho não está vinculado a este avaliador.' USING ERRCODE = '42501';
  END IF;
  -- Sorteio só dentro da janela do evento (antes era conferida só na tela)
  IF NOT coalesce(public.fn_janela_avaliacao_aberta(p_id_evento), false) THEN
    RAISE EXCEPTION 'Fora do horário de avaliação ou sistema pausado pela coordenação.' USING ERRCODE = 'P0001';
  END IF;
  -- 1. Limpa locks expirados do sistema
  DELETE FROM public.locks_ativos 
  WHERE expira_em < now();

  -- 2. Limpa lock anterior do avaliador, se houver
  DELETE FROM public.locks_ativos 
  WHERE id_usuario = p_id_usuario;

  -- Votante do voto popular: ignora a cota técnica e as travas, porque vários votantes podem
  -- estar no mesmo projeto e um votante não ocupa vaga de avaliação técnica.
  v_votante := public.avaliador_e_voto_popular(p_id_usuario, p_id_evento);

  -- 3. Obtém instituição de origem do avaliador para evitar conflito de interesse
  SELECT id_instituicao INTO v_id_instituicao_avaliador
  FROM public.avaliadores_evento
  WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;

  -- 4. Obtém o tempo de timeout e cota padrão configurados no evento
  SELECT COALESCE(minutos_timeout_lock, 30), COALESCE(cota_avaliacoes_padrao, 3)
  INTO v_minutos_lock, v_cota_padrao
  FROM public.eventos
  WHERE id_evento = p_id_evento;

  -- 5. Seleciona o projeto mais prioritário que:
  --    a) Pertence ao evento ativo e tem check-in presencial confirmado;
  --    b) Não é da mesma instituição do avaliador (se vinculada);
  --    c) Não pertence a modalidade bloqueada para este avaliador;
  --    d) Não está bloqueado atualmente por outro avaliador;
  --    e) NÃO FOI AVALIADO ANTERIORMENTE POR ESTE AVALIADOR (INCONDICIONAL: nem ativa, nem cancelada);
  --    f) Não possui impedimento registrado (ausência/conflito) por este avaliador;
  --    g) Respeita a cota estrita (avaliações ativas não-canceladas + locks < cota);
  --    h) Ordena prioritariamente por topo da fila, afinidade temática, menos avaliações ativas recebidas, menos faltas e estande.
  -- Concorrência: dois avaliadores sorteando ao mesmo tempo viam o mesmo projeto livre e ambos
  -- recebiam trava (o segundo avaliava e o envio era recusado por cota). Agora a linha do projeto
  -- é reservada (FOR UPDATE ... SKIP LOCKED) e, com ela reservada, trava e cota são conferidas de
  -- novo com dados atualizados (cada comando vê o que outros sorteios já gravaram).
  LOOP
    SELECT p.id_projeto INTO v_id_projeto_sorteado
    FROM public.projetos p
    LEFT JOIN public.locks_ativos l ON l.id_projeto = p.id_projeto
      AND NOT v_votante AND NOT l.is_voto_popular
    WHERE p.id_evento = p_id_evento
      AND NOT (p.id_projeto = ANY (v_descartados))
      AND p.is_check_in_realizado = true
      AND p.is_fora_da_competicao = false
      AND l.id_projeto IS NULL
      AND (v_id_instituicao_avaliador IS NULL OR p.id_instituicao IS DISTINCT FROM v_id_instituicao_avaliador)
      AND (
        p.id_modalidade IS NULL OR p.id_modalidade NOT IN (
          SELECT amb.id_modalidade 
          FROM public.avaliador_modalidades_bloqueadas amb 
          WHERE amb.id_usuario = p_id_usuario AND amb.id_evento = p_id_evento
        )
      )
      -- REGRA CRÍTICA: Bloqueia incondicionalmente qualquer projeto já avaliado (ativo ou cancelado) pelo mesmo avaliador.
      -- Evita colisão na constraint UNIQUE (id_projeto, id_usuario) e impede reavaliação pelo mesmo usuário.
      AND p.id_projeto NOT IN (
        SELECT a.id_projeto FROM public.avaliacoes a 
        WHERE a.id_usuario = p_id_usuario
      )
      AND p.id_projeto NOT IN (
        SELECT hi.id_projeto FROM public.historico_impedimentos hi WHERE hi.id_usuario = p_id_usuario
      )
      -- COTA DO PROJETO: Avaliações canceladas NÃO contam para a cota, liberando a vaga para OUTROS avaliadores.
      AND (v_votante OR (
        (
          SELECT COUNT(*) 
          FROM public.avaliacoes a 
          WHERE a.id_projeto = p.id_projeto 
            AND (a.status IS NULL OR a.status != 'CANCELADA')
            AND NOT a.is_voto_popular
        ) +
        (
          SELECT COUNT(*) 
          FROM public.locks_ativos lk 
          WHERE lk.id_projeto = p.id_projeto
            AND NOT lk.is_voto_popular
        )
      ) < COALESCE(p.cota_avaliacoes_customizada, v_cota_padrao))
    ORDER BY 
      p.forcar_topo_fila DESC,
      -- Prioridade por Afinidade Temática: 0 se o projeto for da área do avaliador, 1 se for de outra área
      CASE 
        WHEN EXISTS (SELECT 1 FROM public.avaliador_areas aa WHERE aa.id_usuario = p_id_usuario AND aa.id_evento = p_id_evento)
        THEN (
          CASE 
            WHEN p.id_area IN (SELECT aa.id_area FROM public.avaliador_areas aa WHERE aa.id_usuario = p_id_usuario AND aa.id_evento = p_id_evento) THEN 0 
            ELSE 1 
          END
        )
        ELSE 0
      END ASC,
      (
        SELECT COUNT(*) 
        FROM public.avaliacoes a 
        WHERE a.id_projeto = p.id_projeto 
          AND (a.status IS NULL OR a.status != 'CANCELADA')
          AND NOT a.is_voto_popular
      ) ASC,
      p.contagem_ausencia ASC,
      p.estande ASC
    LIMIT 1
    FOR UPDATE OF p SKIP LOCKED;
    EXIT WHEN v_id_projeto_sorteado IS NULL;

    EXIT WHEN v_votante
      OR (NOT EXISTS (SELECT 1 FROM public.locks_ativos lk
                       WHERE lk.id_projeto = v_id_projeto_sorteado AND NOT lk.is_voto_popular)
      AND (SELECT COUNT(*) FROM public.avaliacoes a
           WHERE a.id_projeto = v_id_projeto_sorteado AND (a.status IS NULL OR a.status <> 'CANCELADA')
             AND NOT a.is_voto_popular)
          < (SELECT COALESCE(p.cota_avaliacoes_customizada, v_cota_padrao) FROM public.projetos p WHERE p.id_projeto = v_id_projeto_sorteado));

    -- Outro sorteio ocupou este projeto: descarta e tenta o próximo
    v_descartados := v_descartados || v_id_projeto_sorteado;
    v_id_projeto_sorteado := NULL;
    v_tentativas := v_tentativas + 1;
    EXIT WHEN v_tentativas >= 50;
  END LOOP;

  -- 6. Se encontrou um projeto, insere a trava na tabela locks_ativos
  IF v_id_projeto_sorteado IS NOT NULL THEN
    INSERT INTO public.locks_ativos (id_usuario, id_projeto, bloqueado_em, expira_em, is_voto_popular)
    VALUES (
      p_id_usuario,
      v_id_projeto_sorteado,
      now(),
      now() + (v_minutos_lock || ' minutes')::interval,
      v_votante
    );
  END IF;

  RETURN v_id_projeto_sorteado;
END;
$function$;


-- 3. Vagas do projeto -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_vagas_projeto(p_id_projeto uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(p.cota_avaliacoes_customizada, e.cota_avaliacoes_padrao, 3)
         - (SELECT count(*) FROM public.avaliacoes a
            WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
              AND NOT a.is_voto_popular)::int
         - (SELECT count(*) FROM public.locks_ativos l
            WHERE l.id_projeto = p.id_projeto AND l.expira_em > now()
              AND NOT l.is_voto_popular)::int
  FROM public.projetos p
  LEFT JOIN public.eventos e ON e.id_evento = p.id_evento
  WHERE p.id_projeto = p_id_projeto
$function$;


-- 4. Contagem que o avaliador vê --------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_avaliacoes_ativas_do_projeto(p_id_projeto uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN public.avaliador_atual() IS NULL AND NOT public.is_staff() AND NOT public.is_admin() THEN NULL
         ELSE (SELECT count(*)::integer FROM public.avaliacoes
               WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA')
                 AND NOT is_voto_popular) END;
$function$;


-- 5. Quarentena por divergência ---------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_quarentena(p_id_projeto uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_em_quarentena boolean;
BEGIN
  SELECT count(*) >= 2
         AND max(a.nota_final) - min(a.nota_final) > 2.5
         AND (p.quarentena_resolvida_em IS NULL OR max(a.created_at) > p.quarentena_resolvida_em)
    INTO v_em_quarentena
  FROM public.projetos p
  JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
    AND NOT a.is_voto_popular
  WHERE p.id_projeto = p_id_projeto
  GROUP BY p.quarentena_resolvida_em;

  v_em_quarentena := coalesce(v_em_quarentena, false);

  UPDATE public.avaliacoes
  SET is_quarentena = (v_em_quarentena AND (status IS NULL OR status <> 'CANCELADA'))
  WHERE id_projeto = p_id_projeto
    AND NOT is_voto_popular
    AND is_quarentena IS DISTINCT FROM (v_em_quarentena AND (status IS NULL OR status <> 'CANCELADA'));

  RETURN v_em_quarentena;
END;
$function$;


-- 6. Fim da feira -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_feira_concluida(p_id_evento uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ev AS (
    SELECT coalesce(cota_avaliacoes_padrao, 3) AS cota FROM public.eventos
    WHERE id_evento = coalesce(p_id_evento, public.evento_ativo_id())
  ), proj AS (
    SELECT p.id_projeto, coalesce(p.cota_avaliacoes_customizada, (SELECT cota FROM ev)) AS cota,
           (SELECT count(*) FROM public.avaliacoes a
            WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
              AND NOT a.is_voto_popular) AS feitas
    FROM public.projetos p
    WHERE p.id_evento = coalesce(p_id_evento, public.evento_ativo_id())
      AND coalesce(p.is_fora_da_competicao, false) = false
      AND p.is_check_in_realizado IS TRUE
  )
  SELECT CASE WHEN public.avaliador_atual() IS NULL AND NOT public.is_staff() AND NOT public.is_admin() THEN NULL
              WHEN NOT EXISTS (SELECT 1 FROM proj) THEN false
              ELSE bool_and(feitas >= cota) END
  FROM proj;
$function$;


-- 7. Lançamento manual pelo Admin ------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_lancar_avaliacao(p_id_projeto uuid, p_id_usuario uuid, p_id_questionario uuid, p_respostas jsonb, p_parecer text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text, p_confirmar_acima_da_cota boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id_evento     uuid;
  v_cota          integer;
  v_voto_popular  boolean;
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

  SELECT coalesce(q.is_voto_popular, false) INTO v_voto_popular
  FROM public.questionarios q WHERE q.id_questionario = p_id_questionario;
  v_voto_popular := coalesce(v_voto_popular, false);

  -- Cota é de nota técnica: lançar voto popular não consome vaga nem pede confirmação
  SELECT count(*) INTO v_ativas FROM public.avaliacoes a
  WHERE a.id_projeto = p_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
    AND NOT a.is_voto_popular;

  IF NOT v_voto_popular AND v_ativas >= v_cota AND NOT p_confirmar_acima_da_cota THEN
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
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL
    AND NOT v_voto_popular;

  v_quarentena := public.fn_recalcular_quarentena(p_id_projeto);

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', v_id_avaliacao,
    'nota_final', v_nota,
    'acima_da_cota', v_ativas >= v_cota,
    'projeto_em_quarentena', v_quarentena
  );
END $function$;


-- 8. Restauração de avaliação ----------------------------------------------
CREATE OR REPLACE FUNCTION public.restaurar_avaliacao(p_id_avaliacao uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id_projeto uuid;
  v_id_usuario uuid;
  v_status varchar;
  v_cota integer;
  v_ocupadas integer;
  v_codigo text;
  v_quarentena boolean;
BEGIN
  PERFORM public.auditoria_marcar_origem('restaurar_avaliacao', p_motivo);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id_projeto, id_usuario, status INTO v_id_projeto, v_id_usuario, v_status
  FROM public.avaliacoes WHERE id_avaliacao = p_id_avaliacao;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Avaliação não encontrada no sistema.');
  END IF;

  -- Serializa com o sorteio e a atribuição do mesmo projeto
  SELECT coalesce(p.codigo_projeto, p.titulo), coalesce(p.cota_avaliacoes_customizada, e.cota_avaliacoes_padrao, 3)
    INTO v_codigo, v_cota
  FROM public.projetos p LEFT JOIN public.eventos e ON e.id_evento = p.id_evento
  WHERE p.id_projeto = v_id_projeto
  FOR UPDATE OF p;

  IF v_status IS DISTINCT FROM 'CANCELADA' THEN
    RETURN jsonb_build_object('sucesso', true, 'id_avaliacao', p_id_avaliacao, 'novo_status', v_status,
                              'mensagem', 'A avaliação já estava ativa.');
  END IF;

  SELECT (SELECT count(*) FROM public.avaliacoes a
          WHERE a.id_projeto = v_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
            AND NOT a.is_voto_popular)::int
       + (SELECT count(*) FROM public.locks_ativos l
          WHERE l.id_projeto = v_id_projeto AND l.expira_em > now() AND l.id_usuario <> v_id_usuario
            AND NOT l.is_voto_popular)::int
    INTO v_ocupadas;

  IF v_ocupadas >= v_cota
     AND NOT (SELECT coalesce(is_voto_popular, false) FROM public.avaliacoes WHERE id_avaliacao = p_id_avaliacao) THEN
    RAISE EXCEPTION 'O projeto % já está com a cota completa (% de % vagas ocupadas). Cancele outra avaliação dele antes de restaurar esta.',
      v_codigo, v_ocupadas, v_cota USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.avaliacoes
  SET status = 'CONCLUIDA',
      status_avaliacao = 'concluida',
      cancelada_em = NULL,
      cancelada_por = NULL
  WHERE id_avaliacao = p_id_avaliacao;

  v_quarentena := public.fn_recalcular_quarentena(v_id_projeto);

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', p_id_avaliacao,
    'id_projeto', v_id_projeto,
    'id_usuario', v_id_usuario,
    'novo_status', 'CONCLUIDA',
    'projeto_em_quarentena', v_quarentena,
    'mensagem', 'Avaliação restaurada com sucesso.'
  );
END;
$function$;


-- 9. Elegibilidade da atribuição forçada -----------------------------------
CREATE OR REPLACE FUNCTION public.fn_motivo_inelegivel(p_id_projeto uuid, p_id_usuario uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_projeto record;
  v_inst_avaliador uuid;
BEGIN
  SELECT id_evento, id_instituicao, id_modalidade,
         coalesce(is_check_in_realizado, false) AS check_in,
         coalesce(is_fora_da_competicao, false) AS fora
    INTO v_projeto
  FROM public.projetos WHERE id_projeto = p_id_projeto;

  IF NOT FOUND THEN RETURN 'Projeto não encontrado'; END IF;
  IF NOT v_projeto.check_in THEN RETURN 'Projeto sem check-in'; END IF;
  IF v_projeto.fora THEN RETURN 'Projeto fora da competição'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id_usuario = p_id_usuario AND upper(u.papel::text) = 'AVALIADOR') THEN
    RETURN 'Usuário não é avaliador';
  END IF;

  SELECT ae.id_instituicao INTO v_inst_avaliador
  FROM public.avaliadores_evento ae
  WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = v_projeto.id_evento AND ae.is_credenciado;
  IF NOT FOUND THEN RETURN 'Avaliador não credenciado no evento'; END IF;

  IF public.avaliador_e_voto_popular(p_id_usuario, v_projeto.id_evento) THEN
    RETURN 'Avaliador de voto popular (a banca e a fila são de avaliação técnica)';
  END IF;

  IF v_inst_avaliador IS NOT NULL AND v_projeto.id_instituicao IS NOT DISTINCT FROM v_inst_avaliador THEN
    RETURN 'Conflito: mesma instituição';
  END IF;
  IF v_projeto.id_modalidade IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.avaliador_modalidades_bloqueadas amb
    WHERE amb.id_usuario = p_id_usuario AND amb.id_evento = v_projeto.id_evento AND amb.id_modalidade = v_projeto.id_modalidade
  ) THEN
    RETURN 'Bloqueio: modalidade do projeto';
  END IF;
  IF EXISTS (SELECT 1 FROM public.avaliacoes a WHERE a.id_projeto = p_id_projeto AND a.id_usuario = p_id_usuario) THEN
    RETURN 'Já avaliou este projeto';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.historico_impedimentos hi
    WHERE hi.id_projeto = p_id_projeto AND hi.id_usuario = p_id_usuario AND hi.tipo = 'conflito'
  ) THEN
    RETURN 'Avaliador declarou conflito com este projeto';
  END IF;
  RETURN NULL;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
