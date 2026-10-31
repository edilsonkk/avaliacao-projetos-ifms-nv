-- ==============================================================================
-- MIGRATION: 20261031040000_seguranca_regras_negocio.sql
-- DESCRIÇÃO: etapa 3 da revisão de segurança (OWASP Top 10 A04, API Security
-- API6, CAPEC): regras de negócio e abuso. Achados provados no banco local:
--   C1 (alto, CWE-20/CWE-840) fn_enviar_avaliacao calculava a nota como a média de
--      QUALQUER lista enviada pelo celular: responder só 1 de 5 perguntas com nota
--      máxima, repetir uma pergunta, usar perguntas de outro questionário, outro
--      questionário (de outro evento ou diferente do fixado no projeto) ou nenhum.
--      Na prova, ambas as manobras gravaram nota 10. Agora: questionário do evento
--      do projeto (e o fixado, se houver), todas as perguntas uma vez cada, com nota;
--      parecer até 5000 caracteres.
--   C2 (médio, CWE-841) a janela do evento (data, horário, "sistema liberado") só
--      era conferida na tela: pela API dava para sortear antes do início, depois do
--      fim ou com o sistema pausado. Agora sorteio e fila conferem no banco
--      (fuso America/Campo_Grande). O envio continua aceito depois do horário para
--      quem já está com o projeto (regra documentada), mas não com o sistema pausado.
--   C3 (médio, CWE-770) autocadastro público sem limite: dava para criar milhares de
--      "avaliadores pendentes" e instituições com qualquer nome. Agora: até 30
--      autocadastros por minuto e 20 instituições novas por hora no sistema.
-- FRONT-END: compatível com a versão anterior (a tela já envia todas as perguntas
--   do questionário e confere a janela antes de sortear).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.registro_autocadastro (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_evento uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criou_instituicao boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_registro_autocadastro_criado_em ON public.registro_autocadastro (criado_em);
ALTER TABLE public.registro_autocadastro ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registro_autocadastro FROM anon, authenticated;
GRANT ALL ON public.registro_autocadastro TO service_role;

CREATE OR REPLACE FUNCTION public.fn_janela_avaliacao_aberta(p_id_evento uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Mesma regra da tela do avaliador (validarJanelaAvaliacao), no fuso de Mato Grosso do Sul
  SELECT coalesce(e.sistema_liberado, true)
     AND e.data_evento IS NOT NULL AND e.horario_inicio IS NOT NULL AND e.horario_fim IS NOT NULL
     AND (now() AT TIME ZONE 'America/Campo_Grande')
         BETWEEN (e.data_evento + e.horario_inicio) AND (e.data_evento + e.horario_fim)
  FROM public.eventos e
  WHERE e.id_evento = p_id_evento;
$$;
REVOKE ALL ON FUNCTION public.fn_janela_avaliacao_aberta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_janela_avaliacao_aberta(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_enviar_avaliacao(
  p_id_usuario      uuid,
  p_id_projeto      uuid,
  p_id_questionario uuid,
  p_respostas       jsonb,          -- [{ "id_pergunta": uuid, "nota": numeric }, ...]
  p_parecer         text DEFAULT NULL,
  p_tempo_presenca  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
         COALESCE(e.sistema_liberado, true)
    INTO v_cota_padrao, v_sistema_liberado
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
  IF v_quest_fixado IS NOT NULL AND v_quest_fixado <> p_id_questionario THEN
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

  -- 9. NOTA FINAL calculada no servidor (média simples, mesma semântica do front).
  v_nota_final := ROUND(v_soma / v_qtd_respostas, 2);

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

  -- Fixa o questionário do projeto se ainda não houver.
  UPDATE public.projetos
  SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL
    AND p_id_questionario IS NOT NULL;

  -- Quarentena por divergência > 2.5 entre a maior e a menor nota ativa.
  SELECT MIN(nota_final), MAX(nota_final) INTO v_nota_min, v_nota_max
  FROM public.avaliacoes
  WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA');
  IF v_nota_max IS NOT NULL AND (v_nota_max - v_nota_min) > 2.5 THEN
    v_is_quarentena := true;
    UPDATE public.avaliacoes SET is_quarentena = true
    WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA');
  END IF;

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

CREATE OR REPLACE FUNCTION public.sortear_proximo_projeto(p_id_usuario UUID, p_id_evento UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_descartados UUID[] := '{}';
  v_tentativas INTEGER := 0;
  v_id_instituicao_avaliador UUID;
  v_id_projeto_sorteado UUID;
  v_minutos_lock INTEGER := 30;
  v_cota_padrao INTEGER := 3;
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
      AND (
        (
          SELECT COUNT(*) 
          FROM public.avaliacoes a 
          WHERE a.id_projeto = p.id_projeto 
            AND (a.status IS NULL OR a.status != 'CANCELADA')
        ) +
        (
          SELECT COUNT(*) 
          FROM public.locks_ativos lk 
          WHERE lk.id_projeto = p.id_projeto
        )
      ) < COALESCE(p.cota_avaliacoes_customizada, v_cota_padrao)
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
      ) ASC,
      p.contagem_ausencia ASC,
      p.estande ASC
    LIMIT 1
    FOR UPDATE OF p SKIP LOCKED;
    EXIT WHEN v_id_projeto_sorteado IS NULL;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.locks_ativos lk WHERE lk.id_projeto = v_id_projeto_sorteado)
      AND (SELECT COUNT(*) FROM public.avaliacoes a
           WHERE a.id_projeto = v_id_projeto_sorteado AND (a.status IS NULL OR a.status <> 'CANCELADA'))
          < (SELECT COALESCE(p.cota_avaliacoes_customizada, v_cota_padrao) FROM public.projetos p WHERE p.id_projeto = v_id_projeto_sorteado);

    -- Outro sorteio ocupou este projeto: descarta e tenta o próximo
    v_descartados := v_descartados || v_id_projeto_sorteado;
    v_id_projeto_sorteado := NULL;
    v_tentativas := v_tentativas + 1;
    EXIT WHEN v_tentativas >= 50;
  END LOOP;

  -- 6. Se encontrou um projeto, insere a trava na tabela locks_ativos
  IF v_id_projeto_sorteado IS NOT NULL THEN
    INSERT INTO public.locks_ativos (id_usuario, id_projeto, bloqueado_em, expira_em)
    VALUES (
      p_id_usuario,
      v_id_projeto_sorteado,
      now(),
      now() + (v_minutos_lock || ' minutes')::interval
    );
  END IF;

  RETURN v_id_projeto_sorteado;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_assumir_item_fila()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usuario uuid := public.avaliador_atual();
  v_item    record;
  v_motivo  text;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: este aparelho não está vinculado a um avaliador.' USING ERRCODE = '42501';
  END IF;
  -- Fila só dentro da janela do evento (antes era conferida só na tela)
  IF NOT coalesce(public.fn_janela_avaliacao_aberta(public.evento_ativo_id()), false) THEN
    RAISE EXCEPTION 'Fora do horário de avaliação ou sistema pausado pela coordenação.' USING ERRCODE = 'P0001';
  END IF;

  -- Mesma regra do sorteio: a trava anterior do próprio avaliador é descartada
  DELETE FROM public.locks_ativos WHERE id_usuario = v_usuario;

  FOR v_item IN
    SELECT f.id_atribuicao, f.id_projeto
    FROM public.fila_atribuicoes_direcionadas f
    JOIN public.projetos p ON p.id_projeto = f.id_projeto
    WHERE f.id_usuario = v_usuario
      AND f.status = 'pendente'
      AND p.id_evento = public.evento_ativo_id()
    ORDER BY f.ordem, f.created_at
    FOR UPDATE OF f
  LOOP
    -- Projeto reservado: cota conferida sem corrida com o sorteio
    PERFORM 1 FROM public.projetos WHERE id_projeto = v_item.id_projeto FOR UPDATE;
    v_motivo := public.fn_motivo_inelegivel(v_item.id_projeto, v_usuario);
    IF v_motivo IS NULL AND public.fn_vagas_projeto(v_item.id_projeto) <= 0 THEN
      v_motivo := 'cota';
    END IF;

    IF v_motivo IS NULL THEN
      INSERT INTO public.locks_ativos (id_usuario, id_projeto, bloqueado_em, expira_em)
      VALUES (v_usuario, v_item.id_projeto, now(), now() + interval '2 hours');
      UPDATE public.fila_atribuicoes_direcionadas SET status = 'em_andamento' WHERE id_atribuicao = v_item.id_atribuicao;
      RETURN v_item.id_projeto;
    END IF;

    UPDATE public.fila_atribuicoes_direcionadas
    SET status = CASE
      WHEN v_motivo = 'Já avaliou este projeto' THEN 'ja_avaliado'
      WHEN v_motivo LIKE 'Bloqueio: modalidade%' THEN 'bloqueada_por_modalidade'
      WHEN v_motivo = 'cota' THEN 'concluida_por_outros'
      ELSE 'inelegivel'
    END
    WHERE id_atribuicao = v_item.id_atribuicao;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_autocadastro_avaliador(p_id_evento uuid, p_nome text, p_email text, p_id_instituicao uuid, p_nome_instituicao_nova text, p_ids_areas uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_criou_inst boolean := false;
  v_evento   uuid := coalesce(p_id_evento, public.evento_ativo_id());
  v_nome     text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_inst     uuid := p_id_instituicao;
  v_inst_nova text := btrim(regexp_replace(coalesce(p_nome_instituicao_nova, ''), '\s+', ' ', 'g'));
  v_usuario  public.usuarios;
BEGIN
  IF v_evento IS NULL OR NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = v_evento AND is_ativo) THEN
    RAISE EXCEPTION 'Evento não encontrado ou encerrado.';
  END IF;
  IF length(v_nome) < 3 OR length(v_nome) > 150 THEN
    RAISE EXCEPTION 'Informe o nome completo (3 a 150 caracteres).';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;

  -- Limite contra cadastro em massa (o endpoint é público): no máximo 30 autocadastros por minuto no sistema
  PERFORM pg_advisory_xact_lock(hashtext('fn_autocadastro_avaliador'));
  DELETE FROM public.registro_autocadastro WHERE criado_em < now() - interval '1 day';
  IF (SELECT count(*) FROM public.registro_autocadastro WHERE criado_em > now() - interval '1 minute') >= 30 THEN
    RAISE EXCEPTION 'Muitos cadastros neste momento. Aguarde um minuto e tente de novo.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_usuario FROM public.usuarios WHERE lower(email) = v_email LIMIT 1;
  IF v_usuario.id_usuario IS NOT NULL THEN
    -- Já existe: não altera nada e responde igual a um cadastro novo (não revela quem tem conta). Só garante a inscrição no evento, sem
    -- mudar credenciamento nem instituição de quem já está inscrito.
    IF upper(v_usuario.papel::text) = 'AVALIADOR' THEN
      INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
      VALUES (v_usuario.id_usuario, v_evento, false)
      ON CONFLICT (id_usuario, id_evento) DO NOTHING;
    END IF;
    INSERT INTO public.registro_autocadastro (id_evento, criou_instituicao) VALUES (v_evento, false);
    RETURN jsonb_build_object('ok', true, 'situacao', 'recebido');
  END IF;

  -- Instituição: existente do evento ou nova (a chave é calculada pelo trigger)
  IF v_inst IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.instituicoes WHERE id_instituicao = v_inst AND id_evento = v_evento) THEN
    v_inst := NULL;
  END IF;
  IF v_inst IS NULL AND length(v_inst_nova) BETWEEN 2 AND 200 THEN
    SELECT id_instituicao INTO v_inst FROM public.instituicoes
    WHERE id_evento = v_evento AND nome_normalizado = public.fn_normalizar_nome(v_inst_nova);
    -- Instituição nova digitada no autocadastro: no máximo 20 por hora (senão o cadastro segue sem instituição
    -- e o Staff ajusta), para ninguém encher as listas com nomes inventados
    IF v_inst IS NULL AND (SELECT count(*) FROM public.registro_autocadastro
                           WHERE criou_instituicao AND criado_em > now() - interval '1 hour') < 20 THEN
      INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
      VALUES (v_evento, v_inst_nova, public.fn_normalizar_nome(v_inst_nova))
      RETURNING id_instituicao INTO v_inst;
      v_criou_inst := true;
    END IF;
  END IF;

  INSERT INTO public.usuarios (email, nome, papel) VALUES (v_email, v_nome, 'AVALIADOR')
  RETURNING * INTO v_usuario;
  INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado)
  VALUES (v_usuario.id_usuario, v_evento, v_inst, false);

  IF p_ids_areas IS NOT NULL THEN
    INSERT INTO public.avaliador_areas (id_usuario, id_evento, id_area)
    SELECT v_usuario.id_usuario, v_evento, a.id_area
    FROM public.areas_tematicas a
    WHERE a.id_area = ANY (p_ids_areas) AND a.id_evento = v_evento
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.registro_autocadastro (id_evento, criou_instituicao) VALUES (v_evento, v_criou_inst);
  RETURN jsonb_build_object('ok', true, 'situacao', 'recebido');
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
