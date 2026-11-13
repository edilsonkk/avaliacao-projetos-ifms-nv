-- ==============================================================================
-- SISTEMA DE AVALIAÇÃO DE PROJETOS IFMS
-- DDL CONSOLIDADO DO SCHEMA public — ARQUIVO GERADO, NÃO EDITE À MÃO.
--
-- Gerado do banco local depois de aplicar todas as migrations:
--   npx supabase@2.122.0 db reset
--   npx supabase@2.122.0 db dump --local -s public -f supabase/schema.sql   (+ este cabeçalho)
-- Referência para leitura. A fonte da verdade são as migrations em supabase/migrations/.
-- ==============================================================================



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."papel_usuario" AS ENUM (
    'ADMIN',
    'STAFF',
    'AVALIADOR'
);


ALTER TYPE "public"."papel_usuario" OWNER TO "postgres";


CREATE TYPE "public"."tipo_impedimento" AS ENUM (
    'AUSENCIA',
    'CONFLITO'
);


ALTER TYPE "public"."tipo_impedimento" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_ajustar_media_projeto"("p_id_projeto" "uuid", "p_delta" numeric, "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."admin_ajustar_media_projeto"("p_id_projeto" "uuid", "p_delta" numeric, "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_ajustar_media_projeto"("p_id_projeto" "uuid", "p_delta" numeric, "p_motivo" "text") IS 'Bónus ou penalidade na média do projeto, limitado à amplitude da escala. p_delta = 0 remove o ajuste. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."admin_arbitrar_nota_final"("p_id_avaliacao" "uuid", "p_nota" numeric, "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."admin_arbitrar_nota_final"("p_id_avaliacao" "uuid", "p_nota" numeric, "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_arbitrar_nota_final"("p_id_avaliacao" "uuid", "p_nota" numeric, "p_motivo" "text") IS 'Define a nota final sem mexer nas respostas: a conferência passa a mostrar "nota arbitrada". Só Admin.';



CREATE OR REPLACE FUNCTION "public"."admin_atribuir_banca"("p_id_projeto" "uuid", "p_ids_usuarios" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin uuid;
  v_ids uuid[];
  v_id uuid;
  v_motivo text;
  v_vagas integer;
  v_codigo text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT u.id_usuario INTO v_admin FROM public.usuarios u WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1;

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_ids_usuarios) AS x WHERE x IS NOT NULL;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Selecione pelo menos um avaliador.' USING ERRCODE = '22023';
  END IF;

  -- Serializa com o sorteio e com outras atribuições do mesmo projeto
  SELECT coalesce(codigo_projeto, titulo) INTO v_codigo FROM public.projetos WHERE id_projeto = p_id_projeto FOR UPDATE;
  DELETE FROM public.locks_ativos WHERE expira_em <= now();

  FOREACH v_id IN ARRAY v_ids LOOP
    v_motivo := public.fn_motivo_inelegivel(p_id_projeto, v_id);
    IF v_motivo IS NULL AND EXISTS (SELECT 1 FROM public.locks_ativos WHERE id_usuario = v_id) THEN
      v_motivo := 'Ocupado em outra avaliação';
    END IF;
    IF v_motivo IS NOT NULL THEN
      RAISE EXCEPTION '% não pode avaliar o projeto %: %.',
        (SELECT nome FROM public.usuarios WHERE id_usuario = v_id), v_codigo, v_motivo USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_vagas := public.fn_vagas_projeto(p_id_projeto);
  IF cardinality(v_ids) > v_vagas THEN
    RAISE EXCEPTION 'O projeto % tem só % vaga(s) e foram escolhidos % avaliadores.', v_codigo, greatest(v_vagas, 0), cardinality(v_ids)
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.locks_ativos (id_usuario, id_projeto, bloqueado_em, expira_em, atribuido_por)
  SELECT x, p_id_projeto, now(), now() + interval '2 hours', v_admin FROM unnest(v_ids) AS x;

  RETURN cardinality(v_ids);
END;
$$;


ALTER FUNCTION "public"."admin_atribuir_banca"("p_id_projeto" "uuid", "p_ids_usuarios" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_atualizar_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_ids_modalidades_bloqueadas" "uuid"[], "p_ids_areas" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_nome  text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_papel text;
  v_inst  uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT papel INTO v_papel FROM public.usuarios WHERE id_usuario = p_id_usuario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliador não encontrado.';
  END IF;
  IF upper(coalesce(v_papel, '')) <> 'AVALIADOR' THEN
    RAISE EXCEPTION 'Este usuário não é avaliador.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;
  IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
    RAISE EXCEPTION 'Informe o nome do avaliador.';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.usuarios WHERE lower(email) = v_email AND id_usuario <> p_id_usuario) THEN
    RAISE EXCEPTION 'Já existe outro usuário com o e-mail %.', v_email;
  END IF;

  UPDATE public.usuarios SET nome = v_nome, email = v_email WHERE id_usuario = p_id_usuario;

  SELECT id_instituicao INTO v_inst FROM public.instituicoes
  WHERE id_instituicao = p_id_instituicao AND id_evento = p_id_evento;

  INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado)
  VALUES (p_id_usuario, p_id_evento, v_inst, false)
  ON CONFLICT (id_usuario, id_evento) DO UPDATE SET id_instituicao = EXCLUDED.id_instituicao;

  DELETE FROM public.avaliador_modalidades_bloqueadas
  WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento
    AND id_modalidade <> ALL (coalesce(p_ids_modalidades_bloqueadas, '{}'));
  INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade)
  SELECT p_id_usuario, p_id_evento, m.id_modalidade
  FROM public.modalidades m
  WHERE m.id_evento = p_id_evento AND m.id_modalidade = ANY (coalesce(p_ids_modalidades_bloqueadas, '{}'))
  ON CONFLICT DO NOTHING;

  DELETE FROM public.avaliador_areas
  WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento
    AND id_area <> ALL (coalesce(p_ids_areas, '{}'));
  INSERT INTO public.avaliador_areas (id_usuario, id_evento, id_area)
  SELECT p_id_usuario, p_id_evento, a.id_area
  FROM public.areas_tematicas a
  WHERE a.id_evento = p_id_evento AND a.id_area = ANY (coalesce(p_ids_areas, '{}'))
  ON CONFLICT DO NOTHING;

  PERFORM public.fn_expurgar_modalidades_bloqueadas(p_id_usuario, p_id_evento);
END;
$_$;


ALTER FUNCTION "public"."admin_atualizar_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_ids_modalidades_bloqueadas" "uuid"[], "p_ids_areas" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_atualizar_staff"("p_id_usuario" "uuid", "p_nome" "text", "p_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_nome  text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_papel text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT papel INTO v_papel FROM public.usuarios WHERE id_usuario = p_id_usuario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro do Staff não encontrado.';
  END IF;
  IF upper(coalesce(v_papel, '')) NOT IN ('STAFF', 'MONITOR') THEN
    RAISE EXCEPTION 'Este usuário não é da equipe Staff.';
  END IF;
  IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
    RAISE EXCEPTION 'Informe o nome.';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.usuarios WHERE lower(email) = v_email AND id_usuario <> p_id_usuario) THEN
    RAISE EXCEPTION 'Já existe outro usuário com o e-mail %.', v_email;
  END IF;

  UPDATE public.usuarios SET nome = v_nome, email = v_email WHERE id_usuario = p_id_usuario;
END;
$_$;


ALTER FUNCTION "public"."admin_atualizar_staff"("p_id_usuario" "uuid", "p_nome" "text", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_bloquear_modalidade_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_modalidade" "uuid", "p_bloquear" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modalidades WHERE id_modalidade = p_id_modalidade AND id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Modalidade não encontrada neste evento.';
  END IF;

  IF p_bloquear THEN
    INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade)
    VALUES (p_id_usuario, p_id_evento, p_id_modalidade)
    ON CONFLICT DO NOTHING;
    PERFORM public.fn_expurgar_modalidades_bloqueadas(p_id_usuario, p_id_evento);
  ELSE
    DELETE FROM public.avaliador_modalidades_bloqueadas
    WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento AND id_modalidade = p_id_modalidade;
  END IF;
END;
$$;


ALTER FUNCTION "public"."admin_bloquear_modalidade_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_modalidade" "uuid", "p_bloquear" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_copiar_questionario"("p_id_origem" "uuid", "p_id_evento" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_titulo        text;
  v_base          text;
  v_min           numeric(5,2);
  v_max           numeric(5,2);
  v_evento_origem uuid;
  v_origem_quest  uuid;
  v_eh_modelo     boolean;
  v_origem        uuid;
  v_id            uuid;
  v_n             integer := 1;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_copiar_questionario');
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Evento não encontrado.' USING ERRCODE = '22023';
  END IF;

  SELECT m.titulo, m.escala_minima, m.escala_maxima INTO v_titulo, v_min, v_max
  FROM public.modelos_questionario m WHERE m.id_modelo = p_id_origem;
  v_eh_modelo := FOUND;
  v_origem := p_id_origem;

  IF NOT v_eh_modelo THEN
    SELECT q.titulo, q.escala_minima, q.escala_maxima, q.id_evento, q.id_origem
      INTO v_titulo, v_min, v_max, v_evento_origem, v_origem_quest
    FROM public.questionarios q WHERE q.id_questionario = p_id_origem;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Questionário de origem não encontrado.' USING ERRCODE = '22023';
    END IF;
    IF v_evento_origem IS NOT DISTINCT FROM p_id_evento THEN
      RAISE EXCEPTION 'Este questionário já pertence ao evento.' USING ERRCODE = '22023';
    END IF;
    -- Cópia de um modelo continua apontando para o modelo: o card mostra o modelo como ativo
    IF v_origem_quest IS NOT NULL AND EXISTS (SELECT 1 FROM public.modelos_questionario WHERE id_modelo = v_origem_quest) THEN
      v_origem := v_origem_quest;
    END IF;
  END IF;

  -- Já copiado para este evento: devolve a cópia existente
  SELECT q.id_questionario INTO v_id FROM public.questionarios q
  WHERE q.id_evento = p_id_evento AND q.id_origem = v_origem;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  v_base := left(v_titulo, 240);
  v_titulo := v_base;
  WHILE EXISTS (SELECT 1 FROM public.questionarios WHERE id_evento = p_id_evento AND lower(titulo) = lower(v_titulo)) LOOP
    v_titulo := v_base || CASE WHEN v_n = 1 THEN ' (cópia)' ELSE ' (cópia ' || v_n || ')' END;
    v_n := v_n + 1;
  END LOOP;

  INSERT INTO public.questionarios (id_evento, titulo, escala_minima, escala_maxima, id_origem)
  VALUES (p_id_evento, v_titulo, v_min, v_max, v_origem)
  RETURNING id_questionario INTO v_id;

  IF v_eh_modelo THEN
    INSERT INTO public.perguntas_questionario (id_questionario, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
    SELECT v_id, pm.ordem, pm.texto_pergunta, pm.descricao_lembrete, pm.peso_calculo, pm.peso_desempate
    FROM public.perguntas_modelo_questionario pm WHERE pm.id_modelo = p_id_origem;
  ELSE
    INSERT INTO public.perguntas_questionario (id_questionario, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
    SELECT v_id, pq.ordem, pq.texto_pergunta, pq.descricao_lembrete, pq.peso_calculo, pq.peso_desempate
    FROM public.perguntas_questionario pq WHERE pq.id_questionario = p_id_origem;
  END IF;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."admin_copiar_questionario"("p_id_origem" "uuid", "p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_corrigir_respostas_avaliacao"("p_id_avaliacao" "uuid", "p_respostas" "jsonb", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."admin_corrigir_respostas_avaliacao"("p_id_avaliacao" "uuid", "p_respostas" "jsonb", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_corrigir_respostas_avaliacao"("p_id_avaliacao" "uuid", "p_respostas" "jsonb", "p_motivo" "text") IS 'Corrige as notas por critério e recalcula a nota final pela fórmula oficial. Marca ajuste_tipo = respostas_corrigidas. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."admin_desbloquear_projeto"("p_id_projeto" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.locks_ativos 
  WHERE id_projeto = p_id_projeto;
END;
$$;


ALTER FUNCTION "public"."admin_desbloquear_projeto"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_desbloquear_todos"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.locks_ativos 
  WHERE id_lock IS NOT NULL;
END;
$$;


ALTER FUNCTION "public"."admin_desbloquear_todos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_desbloquear_trava"("p_id_lock" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_apagadas integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.locks_ativos WHERE id_lock = p_id_lock;
  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RETURN v_apagadas > 0;
END;
$$;


ALTER FUNCTION "public"."admin_desbloquear_trava"("p_id_lock" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_desbloquear_trava"("p_id_lock" "uuid") IS 'Admin libera a trava de um avaliador (uma linha de locks_ativos), sem afetar os outros avaliadores do projeto.';



CREATE OR REPLACE FUNCTION "public"."admin_enfileirar_projetos"("p_id_usuario" "uuid", "p_ids_projetos" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin uuid;
  v_ids uuid[];
  v_id uuid;
  v_motivo text;
  v_codigo text;
  v_livre boolean;
  v_ativado uuid;
  v_ordem integer;
  v_enfileirados integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT u.id_usuario INTO v_admin FROM public.usuarios u WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1;

  -- Mantém a ordem escolhida e descarta repetidos
  SELECT array_agg(x ORDER BY pos) INTO v_ids
  FROM (SELECT x, min(pos) AS pos FROM unnest(p_ids_projetos) WITH ORDINALITY AS t(x, pos) WHERE x IS NOT NULL GROUP BY x) d;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Selecione pelo menos um projeto.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.projetos WHERE id_projeto = ANY (v_ids) ORDER BY id_projeto FOR UPDATE;
  DELETE FROM public.locks_ativos WHERE expira_em <= now();

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT coalesce(codigo_projeto, titulo) INTO v_codigo FROM public.projetos WHERE id_projeto = v_id;
    v_motivo := public.fn_motivo_inelegivel(v_id, p_id_usuario);
    IF v_motivo IS NULL AND EXISTS (
      SELECT 1 FROM public.fila_atribuicoes_direcionadas
      WHERE id_usuario = p_id_usuario AND id_projeto = v_id AND status IN ('pendente', 'em_andamento')
    ) THEN
      v_motivo := 'Já está na fila deste avaliador';
    END IF;
    IF v_motivo IS NULL AND EXISTS (SELECT 1 FROM public.locks_ativos WHERE id_usuario = p_id_usuario AND id_projeto = v_id) THEN
      v_motivo := 'É o projeto que o avaliador está avaliando agora';
    END IF;
    IF v_motivo IS NULL AND public.fn_vagas_projeto(v_id) <= 0 THEN
      v_motivo := 'Cota de avaliações atingida';
    END IF;
    IF v_motivo IS NOT NULL THEN
      RAISE EXCEPTION 'Projeto %: %.', v_codigo, v_motivo USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_livre := NOT EXISTS (SELECT 1 FROM public.locks_ativos WHERE id_usuario = p_id_usuario);
  IF v_livre THEN
    v_ativado := v_ids[1];
    INSERT INTO public.locks_ativos (id_usuario, id_projeto, bloqueado_em, expira_em, atribuido_por)
    VALUES (p_id_usuario, v_ativado, now(), now() + interval '2 hours', v_admin);
    v_ids := v_ids[2:];
  END IF;

  SELECT coalesce(max(ordem), 0) INTO v_ordem
  FROM public.fila_atribuicoes_direcionadas
  WHERE id_usuario = p_id_usuario AND status IN ('pendente', 'em_andamento');

  IF cardinality(v_ids) > 0 THEN
    INSERT INTO public.fila_atribuicoes_direcionadas (id_usuario, id_projeto, ordem, status)
    SELECT p_id_usuario, x, v_ordem + pos::int, 'pendente'
    FROM unnest(v_ids) WITH ORDINALITY AS t(x, pos);
    v_enfileirados := cardinality(v_ids);
  END IF;

  RETURN jsonb_build_object('ativado', v_ativado, 'enfileirados', v_enfileirados);
END;
$$;


ALTER FUNCTION "public"."admin_enfileirar_projetos"("p_id_usuario" "uuid", "p_ids_projetos" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_excluir_instituicao"("p_id_instituicao" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_projetos   integer;
  v_avaliadores integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.instituicoes WHERE id_instituicao = p_id_instituicao FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instituição não encontrada.';
  END IF;
  SELECT count(*) INTO v_projetos FROM public.projetos WHERE id_instituicao = p_id_instituicao;
  SELECT count(*) INTO v_avaliadores FROM public.avaliadores_evento WHERE id_instituicao = p_id_instituicao;
  IF v_projetos + v_avaliadores > 0 THEN
    RAISE EXCEPTION 'A instituição está vinculada a % projeto(s) e % avaliador(es). Troque a instituição deles antes de excluir; senão a regra de conflito de instituição deixaria de valer para eles.', v_projetos, v_avaliadores;
  END IF;
  DELETE FROM public.instituicoes WHERE id_instituicao = p_id_instituicao;
END;
$$;


ALTER FUNCTION "public"."admin_excluir_instituicao"("p_id_instituicao" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_excluir_modalidade"("p_id_modalidade" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_projetos  integer;
  v_bloqueios integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.modalidades WHERE id_modalidade = p_id_modalidade FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modalidade não encontrada.';
  END IF;
  SELECT count(*) INTO v_projetos FROM public.projetos WHERE id_modalidade = p_id_modalidade;
  SELECT count(*) INTO v_bloqueios FROM public.avaliador_modalidades_bloqueadas WHERE id_modalidade = p_id_modalidade;
  IF v_projetos + v_bloqueios > 0 THEN
    RAISE EXCEPTION 'A modalidade tem % projeto(s) e está bloqueada para % avaliador(es). Mude a modalidade desses projetos e libere os bloqueios antes de excluir.', v_projetos, v_bloqueios;
  END IF;
  DELETE FROM public.modalidades WHERE id_modalidade = p_id_modalidade;
END;
$$;


ALTER FUNCTION "public"."admin_excluir_modalidade"("p_id_modalidade" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_excluir_modelo_questionario"("p_id_modelo" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.modelos_questionario WHERE id_modelo = p_id_modelo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = '22023';
  END IF;
END;
$$;


ALTER FUNCTION "public"."admin_excluir_modelo_questionario"("p_id_modelo" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_usos integer;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_excluir_questionario');
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.questionarios WHERE id_questionario = p_id_questionario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionário não encontrado.';
  END IF;
  v_usos := public.fn_avaliacoes_do_questionario(p_id_questionario);
  IF v_usos > 0 THEN
    RAISE EXCEPTION 'Este questionário já foi usado em % avaliação(ões) e não pode ser excluído: as notas por critério seriam apagadas.', v_usos;
  END IF;
  DELETE FROM public.questionarios WHERE id_questionario = p_id_questionario;
END;
$$;


ALTER FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_papel text;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_excluir_staff');
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT papel INTO v_papel FROM public.usuarios WHERE id_usuario = p_id_usuario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membro do Staff não encontrado.';
  END IF;
  IF upper(coalesce(v_papel, '')) NOT IN ('STAFF', 'MONITOR') THEN
    RAISE EXCEPTION 'Este usuário não é da equipe Staff.';
  END IF;

  -- Com a FK em RESTRICT, apagar alguém com nota viraria erro cru de FK.
  -- Aqui a recusa é explícita: nota de feira não se apaga por tabela de cadastro.
  IF EXISTS (SELECT 1 FROM public.avaliacoes a WHERE a.id_usuario = p_id_usuario) THEN
    RAISE EXCEPTION 'Este usuário tem avaliações registradas e não pode ser excluído: as notas seriam apagadas. Use Descredenciar.'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.usuarios WHERE id_usuario = p_id_usuario;
END;
$$;


ALTER FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_lancar_avaliacao"("p_id_projeto" "uuid", "p_id_usuario" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text" DEFAULT NULL::"text", "p_motivo" "text" DEFAULT NULL::"text", "p_confirmar_acima_da_cota" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
END $$;


ALTER FUNCTION "public"."admin_lancar_avaliacao"("p_id_projeto" "uuid", "p_id_usuario" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_motivo" "text", "p_confirmar_acima_da_cota" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_lancar_avaliacao"("p_id_projeto" "uuid", "p_id_usuario" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_motivo" "text", "p_confirmar_acima_da_cota" boolean) IS 'Lança a avaliação de um avaliador do evento (ficha em papel). Acima da cota só com p_confirmar_acima_da_cota. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."admin_listar_questionarios_reaproveitaveis"("p_id_evento" "uuid") RETURNS TABLE("id_questionario" "uuid", "titulo" "text", "nome_evento" "text", "data_evento" "date", "total_perguntas" integer, "total_avaliacoes" integer, "ja_no_evento" boolean, "is_voto_popular" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT q.id_questionario,
         q.titulo::text,
         e.nome_evento::text,
         coalesce(e.data_evento, e.data_inicio)::date,
         (SELECT count(*)::integer FROM public.perguntas_questionario pq WHERE pq.id_questionario = q.id_questionario),
         (SELECT count(*)::integer FROM public.avaliacoes a WHERE a.id_questionario = q.id_questionario),
         EXISTS (
           SELECT 1 FROM public.questionarios c
           WHERE c.id_evento = p_id_evento
             AND c.id_origem IN (q.id_questionario, q.id_origem)
         )
    , coalesce(q.is_voto_popular, false)
  FROM public.questionarios q
  JOIN public.eventos e ON e.id_evento = q.id_evento
  WHERE q.id_evento IS DISTINCT FROM p_id_evento
  ORDER BY coalesce(e.data_evento, e.data_inicio) DESC NULLS LAST, e.nome_evento, q.titulo;
END;
$$;


ALTER FUNCTION "public"."admin_listar_questionarios_reaproveitaveis"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_marcar_questionario_voto_popular"("p_id_questionario" "uuid", "p_is_voto_popular" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_atual boolean;
  v_usos  integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT is_voto_popular INTO v_atual
  FROM public.questionarios WHERE id_questionario = p_id_questionario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionário não encontrado.';
  END IF;

  IF v_atual IS DISTINCT FROM coalesce(p_is_voto_popular, false) THEN
    v_usos := public.fn_avaliacoes_do_questionario(p_id_questionario);
    IF v_usos > 0 THEN
      RAISE EXCEPTION 'Este questionário já foi usado em % avaliação(ões): mudar a marca de voto popular agora reclassificaria notas já lançadas e alteraria médias publicadas.', v_usos
        USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM public.auditoria_marcar_origem('admin_marcar_questionario_voto_popular', NULL);
  UPDATE public.questionarios
     SET is_voto_popular = coalesce(p_is_voto_popular, false)
   WHERE id_questionario = p_id_questionario;
END;
$$;


ALTER FUNCTION "public"."admin_marcar_questionario_voto_popular"("p_id_questionario" "uuid", "p_is_voto_popular" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_remover_avaliador_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_papel     text;
  v_avaliacoes integer;
  v_apagou    boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT papel INTO v_papel FROM public.usuarios WHERE id_usuario = p_id_usuario FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliador não encontrado.';
  END IF;
  IF upper(coalesce(v_papel, '')) <> 'AVALIADOR' THEN
    RAISE EXCEPTION 'Este usuário não é avaliador.';
  END IF;

  SELECT count(*) INTO v_avaliacoes
  FROM public.avaliacoes a JOIN public.projetos p ON p.id_projeto = a.id_projeto
  WHERE a.id_usuario = p_id_usuario AND p.id_evento = p_id_evento
    AND (a.status IS NULL OR a.status::text <> 'CANCELADA');
  IF v_avaliacoes > 0 THEN
    RAISE EXCEPTION 'Este avaliador já tem % avaliação(ões) neste evento. Para ele não avaliar mais, use Descredenciar; as notas continuam valendo.', v_avaliacoes;
  END IF;

  DELETE FROM public.locks_ativos l USING public.projetos p
  WHERE l.id_projeto = p.id_projeto AND p.id_evento = p_id_evento AND l.id_usuario = p_id_usuario;
  DELETE FROM public.fila_atribuicoes_direcionadas f USING public.projetos p
  WHERE f.id_projeto = p.id_projeto AND p.id_evento = p_id_evento AND f.id_usuario = p_id_usuario;
  DELETE FROM public.avaliador_modalidades_bloqueadas WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;
  DELETE FROM public.avaliador_areas WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;
  UPDATE public.dispositivos_avaliador SET revogado_em = now()
  WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento AND revogado_em IS NULL;
  DELETE FROM public.avaliadores_evento WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;

  IF NOT EXISTS (SELECT 1 FROM public.avaliadores_evento WHERE id_usuario = p_id_usuario)
     AND NOT EXISTS (SELECT 1 FROM public.avaliacoes WHERE id_usuario = p_id_usuario) THEN
    DELETE FROM public.usuarios WHERE id_usuario = p_id_usuario;
    v_apagou := true;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'cadastro_apagado', v_apagou);
END;
$$;


ALTER FUNCTION "public"."admin_remover_avaliador_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_remover_quarentena', p_motivo);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.avaliacoes SET is_quarentena = false WHERE id_projeto = p_id_projeto AND is_quarentena;
  UPDATE public.projetos
  SET quarentena_resolvida_em = now(),
      quarentena_resolvida_por = (SELECT u.id_usuario FROM public.usuarios u
                                  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1)
  WHERE id_projeto = p_id_projeto;
END;
$$;


ALTER FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid", "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid", "p_motivo" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_projetos uuid[];
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_remover_quarentena_evento', p_motivo);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(id_projeto), '{}') INTO v_projetos
  FROM public.view_projetos_quarentena WHERE id_evento = p_id_evento;

  UPDATE public.avaliacoes SET is_quarentena = false WHERE id_projeto = ANY (v_projetos) AND is_quarentena;
  UPDATE public.projetos
  SET quarentena_resolvida_em = now(),
      quarentena_resolvida_por = (SELECT u.id_usuario FROM public.usuarios u
                                  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1)
  WHERE id_projeto = ANY (v_projetos);
  RETURN cardinality(v_projetos);
END;
$$;


ALTER FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid", "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena_todos"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_projetos uuid[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(id_projeto), '{}') INTO v_projetos FROM public.view_projetos_quarentena;

  UPDATE public.avaliacoes SET is_quarentena = false WHERE id_projeto = ANY (v_projetos) AND is_quarentena;
  UPDATE public.projetos
  SET quarentena_resolvida_em = now(),
      quarentena_resolvida_por = (SELECT u.id_usuario FROM public.usuarios u
                                  WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1)
  WHERE id_projeto = ANY (v_projetos);
END;
$$;


ALTER FUNCTION "public"."admin_remover_quarentena_todos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_id_evento UUID;
  v_qtd_avaliacoes integer;
  v_qtd_projetos integer;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_reset_global');
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  -- 1. Determina o evento alvo (especificado ou ativo)
  IF p_id_evento IS NOT NULL THEN
    v_id_evento := p_id_evento;
  ELSE
    SELECT id_evento INTO v_id_evento FROM public.eventos WHERE is_ativo = true LIMIT 1;
  END IF;

  IF v_id_evento IS NULL THEN
    RAISE EXCEPTION 'Nenhum evento ativo: escolha o evento antes de resetar.' USING ERRCODE = '22023';
  END IF;

  -- 2 e 3. Notas: SÓ as do evento. Antes estes dois DELETE não tinham filtro
  --         nenhum e apagavam as avaliações de todos os eventos já realizados
  --         (os passos 7 a 12 sempre filtraram; só estes dois não).
  SELECT count(*) INTO v_qtd_projetos
  FROM public.projetos p WHERE p.id_evento = v_id_evento OR p.id_evento IS NULL;

  SELECT count(*) INTO v_qtd_avaliacoes
  FROM public.avaliacoes a
  WHERE a.id_projeto IN (SELECT p.id_projeto FROM public.projetos p
                          WHERE p.id_evento = v_id_evento OR p.id_evento IS NULL);

  -- O que vai ser apagado fica registrado ANTES de apagar (a trilha sobrevive ao reset)
  PERFORM public.auditoria_registrar('reset_global', 'avaliacoes', v_id_evento,
    jsonb_build_object('avaliacoes_apagadas', v_qtd_avaliacoes,
                       'projetos_apagados', v_qtd_projetos));

  DELETE FROM public.respostas_avaliacao r
  WHERE r.id_avaliacao IN (
    SELECT a.id_avaliacao FROM public.avaliacoes a
    WHERE a.id_projeto IN (SELECT p.id_projeto FROM public.projetos p
                            WHERE p.id_evento = v_id_evento OR p.id_evento IS NULL));

  DELETE FROM public.avaliacoes a
  WHERE a.id_projeto IN (SELECT p.id_projeto FROM public.projetos p
                          WHERE p.id_evento = v_id_evento OR p.id_evento IS NULL);

  -- 4. Limpeza da fila de bancas / atribuições direcionadas (se existir)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'fila_atribuicoes_direcionadas'
  ) THEN
    EXECUTE 'DELETE FROM public.fila_atribuicoes_direcionadas WHERE id_atribuicao IS NOT NULL';
  END IF;

  -- 5. Limpeza de travas ativas (locks) de estandes
  DELETE FROM public.locks_ativos 
  WHERE id_lock IS NOT NULL;

  -- 6. Impedimentos: só os do evento (a ausência de outra feira é histórico auditável)
  DELETE FROM public.historico_impedimentos h
  WHERE h.id_projeto IN (SELECT p.id_projeto FROM public.projetos p
                          WHERE p.id_evento = v_id_evento OR p.id_evento IS NULL);

  -- 7. Limpeza de projetos vinculados ao evento
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'projetos' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.projetos WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.projetos WHERE id_projeto IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'projeto'
  ) THEN
    EXECUTE 'DELETE FROM public.projeto WHERE id IS NOT NULL';
  END IF;

  -- 8. Limpeza de questionários do evento
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'perguntas_questionario'
  ) THEN
    DELETE FROM public.perguntas_questionario pq
    WHERE pq.id_questionario IN (SELECT q.id_questionario FROM public.questionarios q
                                  WHERE q.id_evento = v_id_evento OR q.id_evento IS NULL);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'questionarios' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.questionarios WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.questionarios WHERE id_questionario IS NOT NULL;
  END IF;

  -- 9. Desassociação de avaliadores e staff do evento
  IF v_id_evento IS NOT NULL THEN
    DELETE FROM public.avaliadores_evento WHERE id_evento = v_id_evento;
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'avaliador_modalidades_bloqueadas'
    ) THEN
      DELETE FROM public.avaliador_modalidades_bloqueadas WHERE id_evento = v_id_evento;
    END IF;
  ELSE
    DELETE FROM public.avaliadores_evento WHERE id_usuario IS NOT NULL;
  END IF;

  -- 10. Limpeza de Áreas Temáticas do evento ativo
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'areas_tematicas' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.areas_tematicas WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'areas_tematicas'
  ) THEN
    DELETE FROM public.areas_tematicas WHERE id_area IS NOT NULL;
  END IF;

  -- 11. Limpeza de Modalidades e Níveis do evento ativo (aliases são deletados por CASCADE)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'modalidades' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.modalidades WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.modalidades WHERE id_modalidade IS NOT NULL;
  END IF;

  -- 12. Limpeza de Instituições do evento ativo (aliases são deletados por CASCADE)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'instituicoes' AND column_name = 'id_evento'
  ) AND v_id_evento IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.instituicoes WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
  ELSE
    DELETE FROM public.instituicoes WHERE id_instituicao IS NOT NULL;
  END IF;

  -- 13. Exclusão de usuários temporários (AVALIADOR e STAFF)
  DELETE FROM public.usuarios u
  WHERE u.papel IN ('AVALIADOR', 'STAFF')
    AND u.papel NOT IN ('ADMIN', 'SUPERADMIN')
    AND u.id_usuario IS NOT NULL
    -- Quem ainda tem nota em outro evento fica: antes, o ON DELETE CASCADE
    -- apagava as avaliações dele junto, sem deixar vestígio.
    AND NOT EXISTS (SELECT 1 FROM public.avaliacoes a WHERE a.id_usuario = u.id_usuario);

  RETURN jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Reset Global executado com sucesso.',
    'id_evento', v_id_evento
  );
END;
$_$;


ALTER FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_restaurar_modelos_originais"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.modelos_questionario (id_modelo, codigo, titulo, descricao, escala_minima, escala_maxima, ordem, is_original) VALUES
    ('0d0de100-0000-4000-8000-000000000001', 'feira-software-q1', 'Técnico · Nível 1 Ideia', 'Projetos com problema e solução definidos, no máximo com wireframes. Núcleo comum (C1–C5) e nível Ideia (I1–I5).', 1, 5, 1, true),
    ('0d0de100-0000-4000-8000-000000000002', 'feira-software-q2', 'Técnico · Nível 2 Protótipo', 'Projetos com interface navegável e ao menos um fluxo principal funcionando, mesmo com dados simulados. Núcleo comum (C1–C5) e nível Protótipo (P1–P5).', 1, 5, 2, true),
    ('0d0de100-0000-4000-8000-000000000003', 'feira-software-q3', 'Técnico · Nível 3 Produção', 'Sistemas implantados e acessíveis (URL, loja ou cliente real), com dados persistidos e usuários reais ou piloto. Núcleo comum (C1–C5) e nível Produção (R1–R5).', 1, 5, 3, true),
    ('0d0de100-0000-4000-8000-000000000004', 'feira-software-q4', 'Convalidação de TCC (ensino médio)', 'Grupos de ensino médio, de qualquer maturidade; a referência é o esperado para um curso técnico de nível médio. Núcleo comum (C1–C5) e trilha ensino médio (E1–E5).', 1, 5, 4, true),
    ('0d0de100-0000-4000-8000-000000000005', 'feira-software-q5', 'Voto popular (visitantes)', 'Visitantes, em cerca de 1 minuto, só para projetos de nível superior; não entra na nota técnica (V1–V3). Atenção: o sistema não tem o fluxo de visitante por QR code; se ativado, aparece aos avaliadores como mais um questionário.', 1, 5, 5, true),
    ('0d0de100-0000-4000-8000-000000000006', 'feira-software-q6', 'Feira de Ciências · Pesquisa científica', 'Projetos avaliados como pesquisa científica: investigam uma pergunta ou hipótese, coletam e analisam dados. 10 critérios de peso igual (CI1–CI10).', 1, 5, 6, true),
    ('0d0de100-0000-4000-8000-000000000007', 'feira-software-q7', 'Feira de Ciências · Pesquisa tecnológica', 'Projetos avaliados como pesquisa tecnológica: constroem um protótipo, processo ou solução para uma necessidade. 10 critérios de peso igual (TE1–TE10).', 1, 5, 7, true)
  ON CONFLICT (codigo) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao,
    escala_minima = EXCLUDED.escala_minima, escala_maxima = EXCLUDED.escala_maxima, is_original = true;

  INSERT INTO public.perguntas_modelo_questionario (id_modelo, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate) VALUES
    ('0d0de100-0000-4000-8000-000000000001', 1, 'Problema e Público-Alvo', 'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais', 1, 1),
    ('0d0de100-0000-4000-8000-000000000001', 2, 'Coerência da Solução', 'Capacidade da solução de resolver o problema, frente a alternativas. Referência — 1: Solução não resolve o problema apresentado · 3: Solução resolve o núcleo do problema · 5: Solução resolve o problema de forma direta e justificada frente a alternativas', 1, 2),
    ('0d0de100-0000-4000-8000-000000000001', 3, 'Domínio Técnico', 'Conhecimento da equipe e justificativa das escolhas técnicas. Referência — 1: Não explica as escolhas técnicas · 3: Explica tecnologias e arquitetura previstas · 5: Justifica escolhas, trade-offs e limitações com segurança; todos os membros respondem', 1, 3),
    ('0d0de100-0000-4000-8000-000000000001', 4, 'Apresentação', 'Clareza, objetividade e cumprimento do tempo. Referência — 1: Confusa, sem foco · 3: Clara e dentro do tempo · 5: Objetiva e envolvente, com bom uso de demonstração ou material visual', 1, 4),
    ('0d0de100-0000-4000-8000-000000000001', 5, 'Originalidade', 'Diferencial em relação ao que já existe. Referência — 1: Cópia de solução existente, sem diferencial · 3: Diferencial identificável · 5: Abordagem nova ou diferencial claro e defensável frente ao mercado', 1, 5),
    ('0d0de100-0000-4000-8000-000000000001', 6, 'Validação do Problema', 'Evidências de contato com usuários ou uso de dados. Referência — 1: Nenhum contato com usuários ou dados · 3: Algumas entrevistas ou dados secundários · 5: Pesquisa estruturada com usuários e achados que moldaram a proposta', 1, 6),
    ('0d0de100-0000-4000-8000-000000000001', 7, 'Análise de Concorrentes', 'Comparação com soluções existentes e lacuna que o projeto ocupa. Referência — 1: Ignora soluções existentes · 3: Lista concorrentes principais · 5: Compara concorrentes e mostra a lacuna que o projeto ocupa', 1, 7),
    ('0d0de100-0000-4000-8000-000000000001', 8, 'Viabilidade Técnica', 'Realismo da arquitetura, dos riscos e do esforço estimados. Referência — 1: Sem noção de como construir · 3: Tecnologias e arquitetura preliminar definidas · 5: Arquitetura, riscos técnicos e esforço estimados de forma realista', 1, 8),
    ('0d0de100-0000-4000-8000-000000000001', 9, 'Representação da Solução', 'Qualidade dos requisitos, wireframes ou protótipo de baixa fidelidade. Referência — 1: Apenas descrição verbal · 3: Wireframes ou requisitos/histórias de usuário · 5: Protótipo de baixa fidelidade testável e requisitos priorizados', 1, 9),
    ('0d0de100-0000-4000-8000-000000000001', 10, 'Plano de Desenvolvimento', 'Escopo do MVP, marcos e critério de sucesso. Referência — 1: Sem próximos passos · 3: Escopo de MVP definido · 5: Roadmap com MVP, marcos e critério de sucesso mensurável', 1, 10),
    ('0d0de100-0000-4000-8000-000000000002', 1, 'Problema e Público-Alvo', 'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais', 1, 1),
    ('0d0de100-0000-4000-8000-000000000002', 2, 'Coerência da Solução', 'Capacidade da solução de resolver o problema, frente a alternativas. Referência — 1: Solução não resolve o problema apresentado · 3: Solução resolve o núcleo do problema · 5: Solução resolve o problema de forma direta e justificada frente a alternativas', 1, 2),
    ('0d0de100-0000-4000-8000-000000000002', 3, 'Domínio Técnico', 'Conhecimento da equipe e justificativa das escolhas técnicas. Referência — 1: Não explica as escolhas técnicas · 3: Explica tecnologias e arquitetura usadas · 5: Justifica escolhas, trade-offs e limitações com segurança; todos os membros respondem', 1, 3),
    ('0d0de100-0000-4000-8000-000000000002', 4, 'Apresentação', 'Clareza, objetividade e cumprimento do tempo. Referência — 1: Confusa, sem foco · 3: Clara e dentro do tempo · 5: Objetiva e envolvente, com bom uso de demonstração ou material visual', 1, 4),
    ('0d0de100-0000-4000-8000-000000000002', 5, 'Originalidade', 'Diferencial em relação ao que já existe. Referência — 1: Cópia de solução existente, sem diferencial · 3: Diferencial identificável · 5: Abordagem nova ou diferencial claro e defensável frente ao mercado', 1, 5),
    ('0d0de100-0000-4000-8000-000000000002', 6, 'Fluxo Principal', 'Funcionamento do fluxo central na demonstração. Referência — 1: Fluxo principal não funciona · 3: Funciona com dados simulados · 5: Fluxo principal e secundários funcionam com dados persistidos', 1, 6),
    ('0d0de100-0000-4000-8000-000000000002', 7, 'Usabilidade e Navegação', 'Facilidade de concluir uma tarefa sem ajuda. Referência — 1: O avaliador se perde ao navegar · 3: Navegação compreensível com orientação · 5: O avaliador completa uma tarefa sozinho, sem ajuda', 1, 7),
    ('0d0de100-0000-4000-8000-000000000002', 8, 'Qualidade da Interface', 'Consistência, legibilidade, responsividade e acessibilidade. Referência — 1: Inconsistente, ilegível · 3: Consistente e legível · 5: Consistente, responsiva e com cuidados básicos de acessibilidade', 1, 8),
    ('0d0de100-0000-4000-8000-000000000002', 9, 'Engenharia do Protótipo', 'Versionamento, organização do código e modelagem. Referência — 1: Sem versionamento nem modelagem · 3: Repositório versionado e modelagem básica (dados, casos de uso) · 5: Código organizado, commits frequentes, modelagem coerente com o implementado', 1, 9),
    ('0d0de100-0000-4000-8000-000000000002', 10, 'Teste com Usuários', 'Feedback de terceiros e ajustes feitos a partir dele. Referência — 1: Nunca testado por terceiros · 3: Testado informalmente por algumas pessoas · 5: Teste de usabilidade registrado e ajustes feitos a partir dele', 1, 10),
    ('0d0de100-0000-4000-8000-000000000003', 1, 'Problema e Público-Alvo', 'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais', 1, 1),
    ('0d0de100-0000-4000-8000-000000000003', 2, 'Coerência da Solução', 'Capacidade da solução de resolver o problema, frente a alternativas. Referência — 1: Solução não resolve o problema apresentado · 3: Solução resolve o núcleo do problema · 5: Solução resolve o problema de forma direta e justificada frente a alternativas', 1, 2),
    ('0d0de100-0000-4000-8000-000000000003', 3, 'Domínio Técnico', 'Conhecimento da equipe e justificativa das escolhas técnicas. Referência — 1: Não explica as escolhas técnicas · 3: Explica tecnologias e arquitetura usadas · 5: Justifica escolhas, trade-offs e limitações com segurança; todos os membros respondem', 1, 3),
    ('0d0de100-0000-4000-8000-000000000003', 4, 'Apresentação', 'Clareza, objetividade e cumprimento do tempo. Referência — 1: Confusa, sem foco · 3: Clara e dentro do tempo · 5: Objetiva e envolvente, com bom uso de demonstração ou material visual', 1, 4),
    ('0d0de100-0000-4000-8000-000000000003', 5, 'Originalidade', 'Diferencial em relação ao que já existe. Referência — 1: Cópia de solução existente, sem diferencial · 3: Diferencial identificável · 5: Abordagem nova ou diferencial claro e defensável frente ao mercado', 1, 5),
    ('0d0de100-0000-4000-8000-000000000003', 6, 'Funcionamento em Ambiente Real', 'Estabilidade, logs ou monitoramento e tratamento de erros. Referência — 1: Falha ou só roda localmente · 3: Estável no ambiente publicado durante a demonstração · 5: Estável, com monitoramento ou logs e tratamento de erros visível', 1, 6),
    ('0d0de100-0000-4000-8000-000000000003', 7, 'Qualidade de Software', 'Testes automatizados, CI/CD e documentação técnica. Referência — 1: Sem testes nem documentação · 3: Alguns testes e README de instalação · 5: Testes automatizados, pipeline de CI/CD e documentação técnica', 1, 7),
    ('0d0de100-0000-4000-8000-000000000003', 8, 'Segurança e Privacidade', 'Boas práticas (OWASP), controle de acesso e cuidado com a LGPD. Referência — 1: Falhas evidentes (senhas em texto puro, entradas sem validação) · 3: Autenticação adequada e validação de entradas · 5: Boas práticas OWASP aplicadas, controle de acesso e cuidado com LGPD', 1, 8),
    ('0d0de100-0000-4000-8000-000000000003', 9, 'Uso Real e Impacto', 'Usuários reais, métricas de uso e feedback comprovado. Referência — 1: Sem usuários · 3: Piloto com usuários reais · 5: Métricas de uso e feedback real apresentados, com evolução ao longo do tempo', 1, 9),
    ('0d0de100-0000-4000-8000-000000000003', 10, 'Sustentabilidade', 'Plano de manutenção, backlog e preparo para evoluir. Referência — 1: Sem plano para manter o sistema · 3: Responsáveis e plano de manutenção definidos · 5: Arquitetura preparada para escalar, com backlog e plano de sustentabilidade', 1, 10),
    ('0d0de100-0000-4000-8000-000000000004', 1, 'Problema e Público-Alvo', 'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais', 1, 1),
    ('0d0de100-0000-4000-8000-000000000004', 2, 'Coerência da Solução', 'Capacidade da solução de resolver o problema, frente a alternativas. Referência — 1: Solução não resolve o problema apresentado · 3: Solução resolve o núcleo do problema · 5: Solução resolve o problema de forma direta e justificada frente a alternativas', 1, 2),
    ('0d0de100-0000-4000-8000-000000000004', 3, 'Domínio Técnico', 'Conhecimento da equipe e justificativa das escolhas técnicas. Referência — 1: Não explica as escolhas técnicas · 3: Explica tecnologias e arquitetura usadas · 5: Justifica escolhas, trade-offs e limitações com segurança; todos os membros respondem', 1, 3),
    ('0d0de100-0000-4000-8000-000000000004', 4, 'Apresentação', 'Clareza, objetividade e cumprimento do tempo. Referência — 1: Confusa, sem foco · 3: Clara e dentro do tempo · 5: Objetiva e envolvente, com bom uso de demonstração ou material visual', 1, 4),
    ('0d0de100-0000-4000-8000-000000000004', 5, 'Originalidade', 'Diferencial em relação ao que já existe. Referência — 1: Cópia de solução existente, sem diferencial · 3: Diferencial identificável · 5: Abordagem nova ou diferencial claro e defensável frente ao mercado', 1, 5),
    ('0d0de100-0000-4000-8000-000000000004', 6, 'Cumprimento da Proposta', 'Quanto foi entregue em relação à proposta aprovada do TCC. Referência — 1: Entregou bem menos do que a proposta aprovada · 3: Entregou o essencial da proposta · 5: Entregou a proposta completa ou foi além', 1, 6),
    ('0d0de100-0000-4000-8000-000000000004', 7, 'Aplicação do Curso', 'Uso dos conteúdos do curso e busca de conhecimento além do currículo. Referência — 1: Não relaciona o projeto ao curso · 3: Aplica conteúdos centrais do curso · 5: Integra vários conteúdos e busca conhecimento além do currículo', 1, 7),
    ('0d0de100-0000-4000-8000-000000000004', 8, 'Processo e Metodologia', 'Organização, cronograma e registro do trabalho. Referência — 1: Sem organização nem registro do trabalho · 3: Cronograma e registro básico seguidos · 5: Processo documentado, com decisões e correções de rota explicadas', 1, 8),
    ('0d0de100-0000-4000-8000-000000000004', 9, 'Participação Individual', 'Domínio de todos os integrantes sobre o projeto. Referência — 1: Apenas um integrante domina o projeto · 3: Todos explicam sua parte · 5: Todos explicam sua parte e entendem o projeto como um todo', 1, 9),
    ('0d0de100-0000-4000-8000-000000000004', 10, 'Coerência com o Texto', 'Relação entre o produto e o texto do TCC, com resultados e limitações. Referência — 1: Produto e texto não conversam · 3: Produto corresponde ao descrito no texto · 5: Texto e produto se complementam, com resultados e limitações discutidos', 1, 10),
    ('0d0de100-0000-4000-8000-000000000005', 1, 'Clareza', 'Quanto ficou claro qual problema este projeto resolve.', 1, 1),
    ('0d0de100-0000-4000-8000-000000000005', 2, 'Utilidade', 'Quanto você usaria ou recomendaria esta solução.', 1, 2),
    ('0d0de100-0000-4000-8000-000000000005', 3, 'Apresentação', 'Clareza e interesse da apresentação da equipe.', 1, 3),
    ('0d0de100-0000-4000-8000-000000000006', 1, 'Problema e Hipótese', 'Clareza na formulação, delimitação e relação com os objetivos.', 1, 1),
    ('0d0de100-0000-4000-8000-000000000006', 2, 'Originalidade e Relevância Social', 'Impacto e ineditismo da pesquisa.', 1, 2),
    ('0d0de100-0000-4000-8000-000000000006', 3, 'Metodologia', 'Adequação da metodologia utilizada para o trabalho.', 1, 3),
    ('0d0de100-0000-4000-8000-000000000006', 4, 'Coleta de Dados e Amostragem', 'Qualidade dos instrumentos e seleção da amostra.', 1, 4),
    ('0d0de100-0000-4000-8000-000000000006', 5, 'Análise de Dados', 'Como os alunos interpretaram os dados coletados.', 1, 5),
    ('0d0de100-0000-4000-8000-000000000006', 6, 'Considerações Finais', 'Relação da conclusão com as hipóteses e resultados esperados.', 1, 6),
    ('0d0de100-0000-4000-8000-000000000006', 7, 'Resumo Expandido', 'Clareza, conteúdo e linguagem científica.', 1, 7),
    ('0d0de100-0000-4000-8000-000000000006', 8, 'Banner e Apresentação Oral', 'Organização visual e domínio da fala.', 1, 8),
    ('0d0de100-0000-4000-8000-000000000006', 9, 'Relatório Técnico', 'Detalhamento escrito do trabalho desenvolvido.', 1, 9),
    ('0d0de100-0000-4000-8000-000000000006', 10, 'Diário de Bordo', 'Registro adequado dos procedimentos e datas.', 1, 10),
    ('0d0de100-0000-4000-8000-000000000007', 1, 'Problema e Base Teórica', 'Definição clara do problema e uso de conceitos tecnológicos.', 1, 1),
    ('0d0de100-0000-4000-8000-000000000007', 2, 'Originalidade e Relevância Social', 'Impacto, ineditismo e utilidade da solução.', 1, 2),
    ('0d0de100-0000-4000-8000-000000000007', 3, 'Metodologia e Conhecimento', 'Materiais e métodos utilizados na elaboração.', 1, 3),
    ('0d0de100-0000-4000-8000-000000000007', 4, 'O Protótipo / Processo', 'Qualidade na construção do protótipo ou gestão do processo.', 1, 4),
    ('0d0de100-0000-4000-8000-000000000007', 5, 'Viabilidade Técnica', 'Resposta à necessidade inicial e custo-benefício.', 1, 5),
    ('0d0de100-0000-4000-8000-000000000007', 6, 'Inovação e Impacto', 'Nível de inovação tecnológica e impacto alcançado.', 1, 6),
    ('0d0de100-0000-4000-8000-000000000007', 7, 'Resumo Expandido', 'Clareza, conteúdo e linguagem científica.', 1, 7),
    ('0d0de100-0000-4000-8000-000000000007', 8, 'Banner e Apresentação Oral', 'Organização visual e domínio da fala.', 1, 8),
    ('0d0de100-0000-4000-8000-000000000007', 9, 'Relatório Técnico', 'Detalhamento escrito do trabalho desenvolvido.', 1, 9),
    ('0d0de100-0000-4000-8000-000000000007', 10, 'Diário de Bordo', 'Registro adequado dos procedimentos e datas.', 1, 10)
  ON CONFLICT (id_modelo, ordem) DO UPDATE SET texto_pergunta = EXCLUDED.texto_pergunta,
    descricao_lembrete = EXCLUDED.descricao_lembrete, peso_calculo = EXCLUDED.peso_calculo, peso_desempate = EXCLUDED.peso_desempate;


  -- Perguntas acrescentadas aos originais saem (os originais têm 10 perguntas; o voto popular, 3)
  DELETE FROM public.perguntas_modelo_questionario pm
  WHERE pm.id_modelo IN (SELECT id_modelo FROM public.modelos_questionario WHERE codigo LIKE 'feira-software-q%')
    AND pm.ordem > CASE WHEN pm.id_modelo = '0d0de100-0000-4000-8000-000000000005' THEN 3 ELSE 10 END;

  RETURN (SELECT count(*)::integer FROM public.modelos_questionario WHERE is_original);
END;
$$;


ALTER FUNCTION "public"."admin_restaurar_modelos_originais"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_salvar_avaliadores"("p_id_evento" "uuid", "p_itens" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_item        jsonb;
  v_nome        text;
  v_email       text;
  v_inst        uuid;
  v_usuario     public.usuarios;
  v_cadastrados integer := 0;
  v_atualizados integer := 0;
  v_ignorados   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de avaliadores inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_nome  := btrim(regexp_replace(coalesce(v_item->>'nome', ''), '\s+', ' ', 'g'));
    v_email := lower(btrim(coalesce(v_item->>'email', '')));

    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
      v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', 'E-mail inválido.');
      CONTINUE;
    END IF;

    SELECT * INTO v_usuario FROM public.usuarios WHERE lower(email) = v_email ORDER BY created_at LIMIT 1;

    IF v_usuario.id_usuario IS NOT NULL AND upper(coalesce(v_usuario.papel, '')) <> 'AVALIADOR' THEN
      v_ignorados := v_ignorados || jsonb_build_object(
        'email', v_email,
        'motivo', format('O e-mail pertence a um usuário %s; ele não foi alterado.', upper(v_usuario.papel)));
      CONTINUE;
    END IF;

    IF v_usuario.id_usuario IS NULL THEN
      IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
        v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', 'Nome ausente ou muito longo.');
        CONTINUE;
      END IF;
      INSERT INTO public.usuarios (email, nome, papel) VALUES (v_email, v_nome, 'AVALIADOR')
      RETURNING * INTO v_usuario;
      v_cadastrados := v_cadastrados + 1;
    ELSE
      IF length(v_nome) BETWEEN 2 AND 255 AND v_nome <> v_usuario.nome THEN
        UPDATE public.usuarios SET nome = v_nome WHERE id_usuario = v_usuario.id_usuario;
      END IF;
      v_atualizados := v_atualizados + 1;
    END IF;

    -- Instituição só vale se for do evento
    v_inst := NULL;
    IF nullif(v_item->>'id_instituicao', '') IS NOT NULL THEN
      SELECT id_instituicao INTO v_inst FROM public.instituicoes
      WHERE id_instituicao = (v_item->>'id_instituicao')::uuid AND id_evento = p_id_evento;
    END IF;

    INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado)
    VALUES (v_usuario.id_usuario, p_id_evento, v_inst, false)
    ON CONFLICT (id_usuario, id_evento)
    DO UPDATE SET id_instituicao = coalesce(EXCLUDED.id_instituicao, avaliadores_evento.id_instituicao);

    INSERT INTO public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade)
    SELECT v_usuario.id_usuario, p_id_evento, m.id_modalidade
    FROM public.modalidades m
    WHERE m.id_evento = p_id_evento
      AND m.id_modalidade::text IN (SELECT jsonb_array_elements_text(coalesce(v_item->'ids_modalidades_bloqueadas', '[]'::jsonb)))
    ON CONFLICT DO NOTHING;

    INSERT INTO public.avaliador_areas (id_usuario, id_evento, id_area)
    SELECT v_usuario.id_usuario, p_id_evento, a.id_area
    FROM public.areas_tematicas a
    WHERE a.id_evento = p_id_evento
      AND a.id_area::text IN (SELECT jsonb_array_elements_text(coalesce(v_item->'ids_areas', '[]'::jsonb)))
    ON CONFLICT DO NOTHING;

    PERFORM public.fn_expurgar_modalidades_bloqueadas(v_usuario.id_usuario, p_id_evento);
  END LOOP;

  RETURN jsonb_build_object('cadastrados', v_cadastrados, 'atualizados', v_atualizados, 'ignorados', v_ignorados);
END;
$_$;


ALTER FUNCTION "public"."admin_salvar_avaliadores"("p_id_evento" "uuid", "p_itens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_salvar_configuracoes_seguranca"("p_exigir_mfa_admin" boolean, "p_minutos_inatividade" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_atual public.configuracoes_seguranca;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_minutos_inatividade IS NULL OR NOT (p_minutos_inatividade = 0 OR p_minutos_inatividade BETWEEN 5 AND 720) THEN
    RAISE EXCEPTION 'Tempo de expiração inválido: use 0 (não expira) ou de 5 a 720 minutos.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.configuracoes_seguranca WHERE id;
  -- Mudar a exigência do MFA só com o segundo fator confirmado nesta sessão
  IF coalesce(p_exigir_mfa_admin, false) IS DISTINCT FROM coalesce(v_atual.exigir_mfa_admin, false)
     AND coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'Confirme o código do aplicativo autenticador antes de mudar a exigência do segundo fator.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.configuracoes_seguranca (id, exigir_mfa_admin, minutos_inatividade_sessao, atualizado_em, atualizado_por)
  VALUES (true, coalesce(p_exigir_mfa_admin, false), p_minutos_inatividade, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET exigir_mfa_admin = EXCLUDED.exigir_mfa_admin,
        minutos_inatividade_sessao = EXCLUDED.minutos_inatividade_sessao,
        atualizado_em = now(),
        atualizado_por = auth.uid();

  RETURN public.fn_politica_seguranca();
END;
$$;


ALTER FUNCTION "public"."admin_salvar_configuracoes_seguranca"("p_exigir_mfa_admin" boolean, "p_minutos_inatividade" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_salvar_instituicoes"("p_id_evento" "uuid", "p_itens" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_item        jsonb;
  v_nome        text;
  v_sigla       text;
  v_campus      text;
  v_id          uuid;
  v_cadastradas integer := 0;
  v_atualizadas integer := 0;
  v_ignoradas   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Não há evento ativo para vincular as instituições.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de instituições inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_nome   := btrim(regexp_replace(coalesce(v_item->>'nome', ''), '\s+', ' ', 'g'));
    v_sigla  := nullif(upper(btrim(coalesce(v_item->>'sigla', ''))), '');
    v_campus := nullif(btrim(coalesce(v_item->>'campus', '')), '');

    IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
      v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'Nome ausente ou muito longo.');
      CONTINUE;
    END IF;
    IF length(coalesce(v_sigla, '')) > 50 OR length(coalesce(v_campus, '')) > 150 THEN
      v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'Sigla (até 50) ou câmpus (até 150) muito longos.');
      CONTINUE;
    END IF;

    SELECT id_instituicao INTO v_id FROM public.instituicoes
    WHERE id_evento = p_id_evento AND nome_normalizado = public.fn_normalizar_nome(v_nome)
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado, sigla, campus)
      VALUES (p_id_evento, v_nome, public.fn_normalizar_nome(v_nome), v_sigla, v_campus);
      v_cadastradas := v_cadastradas + 1;
    ELSE
      UPDATE public.instituicoes
      SET sigla = coalesce(v_sigla, sigla), campus = coalesce(v_campus, campus)
      WHERE id_instituicao = v_id;
      v_atualizadas := v_atualizadas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cadastradas', v_cadastradas, 'atualizadas', v_atualizadas, 'ignoradas', v_ignoradas);
END;
$$;


ALTER FUNCTION "public"."admin_salvar_instituicoes"("p_id_evento" "uuid", "p_itens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_salvar_modalidades"("p_id_evento" "uuid", "p_itens" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_item        jsonb;
  v_nome        text;
  v_codigo      text;
  v_nivel       text;
  v_area        text;
  v_descricao   text;
  v_id          uuid;
  v_cadastradas integer := 0;
  v_atualizadas integer := 0;
  v_associadas  integer := 0;
  v_ignoradas   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Não há evento ativo para vincular as modalidades.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de modalidades inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_nome      := btrim(regexp_replace(coalesce(v_item->>'nome', ''), '\s+', ' ', 'g'));
    v_codigo    := nullif(btrim(coalesce(v_item->>'codigo', '')), '');
    v_nivel     := nullif(btrim(coalesce(v_item->>'nivel', '')), '');
    v_area      := nullif(btrim(coalesce(v_item->>'area_tematica', '')), '');
    v_descricao := nullif(btrim(coalesce(v_item->>'descricao', '')), '');

    IF length(v_nome) < 2 OR length(v_nome) > 150 THEN
      v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'Nome ausente ou com mais de 150 caracteres.');
      CONTINUE;
    END IF;
    IF length(coalesce(v_codigo, '')) > 50 OR length(coalesce(v_nivel, '')) > 100 OR length(coalesce(v_area, '')) > 150 THEN
      v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'Código (até 50), nível (até 100) ou área (até 150) muito longos.');
      CONTINUE;
    END IF;

    -- Associação do De-Para: grava o nome como apelido da modalidade escolhida
    IF nullif(v_item->>'id_existente', '') IS NOT NULL THEN
      SELECT id_modalidade INTO v_id FROM public.modalidades
      WHERE id_modalidade = (v_item->>'id_existente')::uuid AND id_evento = p_id_evento;
      IF v_id IS NULL THEN
        v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'A modalidade escolhida no De-Para não é deste evento.');
        CONTINUE;
      END IF;
      IF public.fn_normalizar_nome(v_nome) <> (SELECT public.fn_normalizar_nome(nome_modalidade) FROM public.modalidades WHERE id_modalidade = v_id) THEN
        INSERT INTO public.modalidade_aliases (id_modalidade, alias, alias_normalizado)
        VALUES (v_id, v_nome, public.fn_normalizar_nome(v_nome))
        ON CONFLICT (id_modalidade, alias_normalizado) DO NOTHING;
      END IF;
      v_associadas := v_associadas + 1;
      CONTINUE;
    END IF;

    SELECT id_modalidade INTO v_id FROM public.modalidades
    WHERE id_evento = p_id_evento AND public.fn_normalizar_nome(nome_modalidade) = public.fn_normalizar_nome(v_nome)
    ORDER BY created_at
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.modalidades (id_evento, nome_modalidade, codigo, nivel, area_tematica, descricao)
      VALUES (p_id_evento, v_nome, v_codigo, v_nivel, v_area, v_descricao);
      v_cadastradas := v_cadastradas + 1;
    ELSE
      UPDATE public.modalidades
      SET codigo = coalesce(v_codigo, codigo),
          nivel = coalesce(v_nivel, nivel),
          area_tematica = coalesce(v_area, area_tematica),
          descricao = coalesce(v_descricao, descricao)
      WHERE id_modalidade = v_id;
      v_atualizadas := v_atualizadas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cadastradas', v_cadastradas, 'atualizadas', v_atualizadas,
                            'associadas', v_associadas, 'ignoradas', v_ignoradas);
END;
$$;


ALTER FUNCTION "public"."admin_salvar_modalidades"("p_id_evento" "uuid", "p_itens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_salvar_modelo_questionario"("p_id_modelo" "uuid", "p_titulo" "text", "p_descricao" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_titulo  text;
  v_id      uuid := p_id_modelo;
  v_evento  uuid;
  v_copia   uuid;
  v_usos    integer := 0;
  v_situacao text := 'sem_copia';
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_salvar_modelo_questionario');
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  v_titulo := public.fn_validar_dados_questionario(p_titulo, p_escala_minima, p_escala_maxima, p_perguntas);
  IF length(coalesce(p_descricao, '')) > 2000 THEN
    RAISE EXCEPTION 'Descrição muito longa (máximo de 2000 caracteres).' USING ERRCODE = '22001';
  END IF;

  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    INSERT INTO public.modelos_questionario (id_modelo, codigo, titulo, descricao, escala_minima, escala_maxima, ordem, is_original)
    VALUES (v_id, 'admin-' || v_id, v_titulo, nullif(btrim(coalesce(p_descricao, '')), ''), p_escala_minima, p_escala_maxima,
            (SELECT coalesce(max(ordem), 0) + 1 FROM public.modelos_questionario), false);
  ELSE
    UPDATE public.modelos_questionario
    SET titulo = v_titulo, descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
        escala_minima = p_escala_minima, escala_maxima = p_escala_maxima
    WHERE id_modelo = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = '22023';
    END IF;
    -- Modelos não têm notas: as perguntas podem ser trocadas inteiras
    DELETE FROM public.perguntas_modelo_questionario WHERE id_modelo = v_id;
  END IF;

  INSERT INTO public.perguntas_modelo_questionario (id_modelo, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
  SELECT v_id, e.n::integer, btrim(e.item->>'texto_pergunta'),
         nullif(btrim(coalesce(e.item->>'descricao_lembrete', '')), ''),
         coalesce((e.item->>'peso_calculo')::numeric, 1), coalesce((e.item->>'peso_desempate')::numeric, 1)
  FROM jsonb_array_elements(p_perguntas) WITH ORDINALITY e(item, n);

  -- Cópia no evento ativo: atualizada se ainda não foi usada
  IF p_id_modelo IS NOT NULL THEN
    v_evento := public.evento_ativo_id();
    SELECT q.id_questionario INTO v_copia FROM public.questionarios q
    WHERE q.id_evento = v_evento AND q.id_origem = v_id;
    IF FOUND THEN
      v_usos := public.fn_avaliacoes_do_questionario(v_copia);
      IF v_usos > 0 THEN
        v_situacao := 'em_uso';
      ELSE
        UPDATE public.questionarios
        SET titulo = v_titulo, escala_minima = p_escala_minima, escala_maxima = p_escala_maxima
        WHERE id_questionario = v_copia;
        DELETE FROM public.perguntas_questionario WHERE id_questionario = v_copia;
        INSERT INTO public.perguntas_questionario (id_questionario, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
        SELECT v_copia, pm.ordem, pm.texto_pergunta, pm.descricao_lembrete, pm.peso_calculo, pm.peso_desempate
        FROM public.perguntas_modelo_questionario pm WHERE pm.id_modelo = v_id;
        v_situacao := 'atualizada';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('id_modelo', v_id, 'copia', v_situacao, 'usos', v_usos);
END;
$$;


ALTER FUNCTION "public"."admin_salvar_modelo_questionario"("p_id_modelo" "uuid", "p_titulo" "text", "p_descricao" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_salvar_questionario"("p_id_questionario" "uuid", "p_id_evento" "uuid", "p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_titulo   text := btrim(regexp_replace(coalesce(p_titulo, ''), '\s+', ' ', 'g'));
  v_id       uuid := p_id_questionario;
  v_atual    public.questionarios;
  v_usos     integer;
  v_item     jsonb;
  v_ordem    integer := 0;
  v_ids      uuid[] := '{}';
  v_id_perg  uuid;
  v_mudou    boolean;
BEGIN
  PERFORM public.auditoria_marcar_origem('admin_salvar_questionario');
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF length(v_titulo) < 3 OR length(v_titulo) > 255 THEN
    RAISE EXCEPTION 'Informe o título do questionário (3 a 255 caracteres).';
  END IF;
  IF p_escala_minima IS NULL OR p_escala_maxima IS NULL OR p_escala_minima < 0 OR p_escala_maxima > 100
     OR p_escala_minima >= p_escala_maxima THEN
    RAISE EXCEPTION 'Escala inválida: a mínima precisa ser menor que a máxima (entre 0 e 100).';
  END IF;
  IF jsonb_typeof(p_perguntas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_perguntas) = 0 THEN
    RAISE EXCEPTION 'O questionário precisa de pelo menos uma pergunta.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_perguntas) e WHERE btrim(coalesce(e->>'texto_pergunta', '')) = '') THEN
    RAISE EXCEPTION 'Preencha o texto de todas as perguntas.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_perguntas) e
             WHERE coalesce((e->>'peso_calculo')::numeric, 1) <= 0 OR coalesce((e->>'peso_desempate')::numeric, 1) < 0) THEN
    RAISE EXCEPTION 'Os pesos precisam ser positivos.';
  END IF;

  IF v_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
      RAISE EXCEPTION 'Não há evento ativo para vincular o questionário.';
    END IF;
    INSERT INTO public.questionarios (id_evento, titulo, escala_minima, escala_maxima)
    VALUES (p_id_evento, v_titulo, p_escala_minima, p_escala_maxima)
    RETURNING id_questionario INTO v_id;
  ELSE
    SELECT * INTO v_atual FROM public.questionarios WHERE id_questionario = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Questionário não encontrado.';
    END IF;
    v_usos := public.fn_avaliacoes_do_questionario(v_id);
    IF v_usos > 0 THEN
      -- Já usado: só o título pode mudar; perguntas, pesos e escala ficam como estão
      SELECT v_atual.escala_minima IS DISTINCT FROM p_escala_minima
          OR v_atual.escala_maxima IS DISTINCT FROM p_escala_maxima
          OR (SELECT count(*) FROM public.perguntas_questionario WHERE id_questionario = v_id) <> jsonb_array_length(p_perguntas)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_perguntas) WITH ORDINALITY e(item, n)
            LEFT JOIN public.perguntas_questionario pq
              ON pq.id_pergunta::text = e.item->>'id_pergunta' AND pq.id_questionario = v_id
            WHERE pq.id_pergunta IS NULL
               OR pq.texto_pergunta IS DISTINCT FROM btrim(e.item->>'texto_pergunta')
               OR coalesce(pq.descricao_lembrete, '') IS DISTINCT FROM btrim(coalesce(e.item->>'descricao_lembrete', ''))
               OR pq.peso_calculo IS DISTINCT FROM coalesce((e.item->>'peso_calculo')::numeric, 1)
               OR pq.peso_desempate IS DISTINCT FROM coalesce((e.item->>'peso_desempate')::numeric, 1)
               OR pq.ordem IS DISTINCT FROM e.n::integer
          )
        INTO v_mudou;
      IF v_mudou THEN
        RAISE EXCEPTION 'Este questionário já foi usado em % avaliação(ões): só o título pode ser alterado. Para mudar perguntas, pesos ou escala, crie um questionário novo.', v_usos;
      END IF;
      UPDATE public.questionarios SET titulo = v_titulo WHERE id_questionario = v_id;
      RETURN v_id;
    END IF;
    UPDATE public.questionarios
    SET titulo = v_titulo, escala_minima = p_escala_minima, escala_maxima = p_escala_maxima
    WHERE id_questionario = v_id;
  END IF;

  -- Perguntas: atualiza as existentes, insere as novas, apaga as retiradas
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_perguntas) LOOP
    v_ordem := v_ordem + 1;
    v_id_perg := NULL;
    IF nullif(v_item->>'id_pergunta', '') IS NOT NULL THEN
      UPDATE public.perguntas_questionario
      SET ordem = v_ordem,
          texto_pergunta = btrim(v_item->>'texto_pergunta'),
          descricao_lembrete = nullif(btrim(coalesce(v_item->>'descricao_lembrete', '')), ''),
          peso_calculo = coalesce((v_item->>'peso_calculo')::numeric, 1),
          peso_desempate = coalesce((v_item->>'peso_desempate')::numeric, v_ordem)
      WHERE id_pergunta = (v_item->>'id_pergunta')::uuid AND id_questionario = v_id
      RETURNING id_pergunta INTO v_id_perg;
    END IF;
    IF v_id_perg IS NULL THEN
      INSERT INTO public.perguntas_questionario (id_questionario, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
      VALUES (v_id, v_ordem, btrim(v_item->>'texto_pergunta'),
              nullif(btrim(coalesce(v_item->>'descricao_lembrete', '')), ''),
              coalesce((v_item->>'peso_calculo')::numeric, 1),
              coalesce((v_item->>'peso_desempate')::numeric, v_ordem))
      RETURNING id_pergunta INTO v_id_perg;
    END IF;
    v_ids := v_ids || v_id_perg;
  END LOOP;

  DELETE FROM public.perguntas_questionario WHERE id_questionario = v_id AND id_pergunta <> ALL (v_ids);
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."admin_salvar_questionario"("p_id_questionario" "uuid", "p_id_evento" "uuid", "p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_salvar_questionario_como_modelo"("p_id_questionario" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_q      public.questionarios;
  v_id     uuid := gen_random_uuid();
  v_base   text;
  v_titulo text;
  v_n      integer := 1;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_q FROM public.questionarios WHERE id_questionario = p_id_questionario;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionário não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perguntas_questionario WHERE id_questionario = p_id_questionario) THEN
    RAISE EXCEPTION 'O questionário precisa de pelo menos uma pergunta.' USING ERRCODE = '22023';
  END IF;

  v_base := left(v_q.titulo, 240);
  v_titulo := v_base;
  WHILE EXISTS (SELECT 1 FROM public.modelos_questionario WHERE lower(titulo) = lower(v_titulo)) LOOP
    v_titulo := v_base || CASE WHEN v_n = 1 THEN ' (cópia)' ELSE ' (cópia ' || v_n || ')' END;
    v_n := v_n + 1;
  END LOOP;

  INSERT INTO public.modelos_questionario (id_modelo, codigo, titulo, descricao, escala_minima, escala_maxima, ordem, is_original)
  VALUES (v_id, 'admin-' || v_id, v_titulo, NULL, v_q.escala_minima, v_q.escala_maxima,
          (SELECT coalesce(max(ordem), 0) + 1 FROM public.modelos_questionario), false);
  INSERT INTO public.perguntas_modelo_questionario (id_modelo, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
  SELECT v_id, row_number() OVER (ORDER BY pq.ordem, pq.created_at)::integer, pq.texto_pergunta, pq.descricao_lembrete,
         coalesce(pq.peso_calculo, 1), coalesce(pq.peso_desempate, 1)
  FROM public.perguntas_questionario pq WHERE pq.id_questionario = p_id_questionario;

  -- O questionário passa a ser a cópia do modelo no evento (o interruptor aparece ligado)
  UPDATE public.questionarios SET id_origem = v_id
  WHERE id_questionario = p_id_questionario AND id_origem IS NULL;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."admin_salvar_questionario_como_modelo"("p_id_questionario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_salvar_staff"("p_id_evento" "uuid", "p_itens" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_item        jsonb;
  v_nome        text;
  v_email       text;
  v_papel       text;
  v_usuario     public.usuarios;
  v_cadastrados integer := 0;
  v_atualizados integer := 0;
  v_ignorados   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_id_evento IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de membros do Staff inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_nome  := btrim(regexp_replace(coalesce(v_item->>'nome', ''), '\s+', ' ', 'g'));
    v_email := lower(btrim(coalesce(v_item->>'email', '')));
    v_papel := upper(btrim(coalesce(nullif(v_item->>'papel', ''), 'STAFF')));

    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
      v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', 'E-mail inválido.');
      CONTINUE;
    END IF;
    IF v_papel NOT IN ('STAFF', 'MONITOR') THEN
      v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', format('Papel "%s" inválido: use STAFF ou MONITOR.', v_papel));
      CONTINUE;
    END IF;

    SELECT * INTO v_usuario FROM public.usuarios WHERE lower(email) = v_email ORDER BY created_at LIMIT 1;

    IF v_usuario.id_usuario IS NOT NULL AND upper(coalesce(v_usuario.papel, '')) NOT IN ('STAFF', 'MONITOR') THEN
      v_ignorados := v_ignorados || jsonb_build_object(
        'email', v_email,
        'motivo', format('O e-mail pertence a um usuário %s; ele não foi alterado.', upper(coalesce(v_usuario.papel, 'sem papel'))));
      CONTINUE;
    END IF;

    IF v_usuario.id_usuario IS NULL THEN
      IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
        v_ignorados := v_ignorados || jsonb_build_object('email', v_email, 'motivo', 'Nome ausente ou muito longo.');
        CONTINUE;
      END IF;
      INSERT INTO public.usuarios (email, nome, papel) VALUES (v_email, v_nome, v_papel)
      RETURNING * INTO v_usuario;
      v_cadastrados := v_cadastrados + 1;
    ELSE
      UPDATE public.usuarios
      SET nome = CASE WHEN length(v_nome) BETWEEN 2 AND 255 THEN v_nome ELSE nome END,
          papel = v_papel
      WHERE id_usuario = v_usuario.id_usuario;
      v_atualizados := v_atualizados + 1;
    END IF;

    -- Inscreve no evento sem mexer no credenciamento de quem já está lá
    IF p_id_evento IS NOT NULL THEN
      INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
      VALUES (v_usuario.id_usuario, p_id_evento, false)
      ON CONFLICT (id_usuario, id_evento) DO NOTHING;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cadastrados', v_cadastrados, 'atualizados', v_atualizados, 'ignorados', v_ignorados);
END;
$_$;


ALTER FUNCTION "public"."admin_salvar_staff"("p_id_evento" "uuid", "p_itens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_vincular_questionario_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_questionario" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_id_evento IS NULL THEN
    RAISE EXCEPTION 'Informe o evento do vínculo.' USING ERRCODE = '22023';
  END IF;

  IF p_id_questionario IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.questionarios q
    WHERE q.id_questionario = p_id_questionario AND q.id_evento = p_id_evento
  ) THEN
    RAISE EXCEPTION 'O questionário precisa ser do mesmo evento do avaliador.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.avaliadores_evento ae
    WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = p_id_evento
  ) THEN
    RAISE EXCEPTION 'Avaliador não está no evento.' USING ERRCODE = '42501';
  END IF;

  PERFORM public.auditoria_marcar_origem('admin_vincular_questionario_avaliador', NULL);
  UPDATE public.avaliadores_evento
     SET id_questionario = p_id_questionario
   WHERE id_usuario = p_id_usuario AND id_evento = p_id_evento;
END;
$$;


ALTER FUNCTION "public"."admin_vincular_questionario_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_questionario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auditoria_ator"() RETURNS TABLE("id_usuario" "uuid", "papel" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT u.id_usuario, upper(u.papel::text)
  FROM public.usuarios u
  WHERE u.id_usuario = coalesce(
    (SELECT x.id_usuario
       FROM public.usuarios x
      WHERE auth.uid() IS NOT NULL
        AND (x.id_usuario = auth.uid() OR x.id_auth = auth.uid())
      LIMIT 1),
    public.avaliador_atual()
  )
  LIMIT 1;
$$;


ALTER FUNCTION "public"."auditoria_ator"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auditoria_marcar_origem"("p_origem" "text", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM set_config('app.auditoria_origem', coalesce(p_origem, 'direto'), true);
  PERFORM set_config('app.auditoria_motivo', coalesce(nullif(btrim(p_motivo), ''), ''), true);
END $$;


ALTER FUNCTION "public"."auditoria_marcar_origem"("p_origem" "text", "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auditoria_motivo"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT nullif(current_setting('app.auditoria_motivo', true), '');
$$;


ALTER FUNCTION "public"."auditoria_motivo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auditoria_origem"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce(nullif(current_setting('app.auditoria_origem', true), ''), 'direto');
$$;


ALTER FUNCTION "public"."auditoria_origem"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auditoria_registrar"("p_acao" "text", "p_tabela" "text", "p_id_evento" "uuid" DEFAULT NULL::"uuid", "p_dados" "jsonb" DEFAULT NULL::"jsonb", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ator record;
BEGIN
  SELECT * INTO v_ator FROM public.auditoria_ator();

  INSERT INTO public.log_auditoria (
    id_evento, tabela, operacao, acao, ator_auth, ator_usuario, ator_papel,
    origem, motivo, dados_depois
  ) VALUES (
    coalesce(p_id_evento, public.evento_ativo_id()), p_tabela, 'EVENTO', p_acao,
    auth.uid(), v_ator.id_usuario, v_ator.papel,
    public.auditoria_origem(), coalesce(nullif(btrim(p_motivo), ''), public.auditoria_motivo()), p_dados
  );
END $$;


ALTER FUNCTION "public"."auditoria_registrar"("p_acao" "text", "p_tabela" "text", "p_id_evento" "uuid", "p_dados" "jsonb", "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."avaliacao_classificar_voto_popular"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Sem questionário (linha legada), continua sendo nota técnica.
  NEW.is_voto_popular := coalesce(
    (SELECT q.is_voto_popular FROM public.questionarios q WHERE q.id_questionario = NEW.id_questionario),
    false);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."avaliacao_classificar_voto_popular"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."avaliador_atual"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT d.id_usuario
  FROM public.dispositivos_avaliador d
  JOIN public.usuarios u ON u.id_usuario = d.id_usuario
  WHERE d.auth_uid = auth.uid()
    AND d.revogado_em IS NULL
    -- Só vale no evento ativo e enquanto o Staff mantiver o credenciamento
    AND d.id_evento = public.evento_ativo_id()
    AND EXISTS (
      SELECT 1 FROM public.avaliadores_evento ae
      WHERE ae.id_usuario = d.id_usuario AND ae.id_evento = d.id_evento AND ae.is_credenciado
    )
    AND upper(u.papel::text) = 'AVALIADOR'
  LIMIT 1;
$$;


ALTER FUNCTION "public"."avaliador_atual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."avaliador_e_voto_popular"("p_id_usuario" "uuid", "p_id_evento" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce((
    SELECT q.is_voto_popular
    FROM public.avaliadores_evento ae
    JOIN public.questionarios q ON q.id_questionario = ae.id_questionario
    WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = p_id_evento
  ), false);
$$;


ALTER FUNCTION "public"."avaliador_e_voto_popular"("p_id_usuario" "uuid", "p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."avaliador_e_voto_popular"("p_id_usuario" "uuid", "p_id_evento" "uuid") IS 'true quando o avaliador está vinculado a um questionário de voto popular no evento (é um votante).';



CREATE OR REPLACE FUNCTION "public"."conta_da_equipe"("p_auth_uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT p_auth_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE (u.id_usuario = p_auth_uid OR u.id_auth = p_auth_uid)
      AND upper(u.papel::text) IN ('ADMIN', 'STAFF', 'MONITOR')
  );
$$;


ALTER FUNCTION "public"."conta_da_equipe"("p_auth_uid" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."conta_da_equipe"("p_auth_uid" "uuid") IS 'auth_uid pertence a ADMIN/STAFF/MONITOR? Usado para não vincular o celular do avaliador à sessão da equipe.';



CREATE OR REPLACE FUNCTION "public"."evento_ativo_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT id_evento FROM public.eventos WHERE is_ativo = true ORDER BY created_at DESC LIMIT 1;
$$;


ALTER FUNCTION "public"."evento_ativo_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id_projeto uuid;
  v_id_usuario uuid;
  v_status_antigo varchar;
  v_quarentena boolean;
BEGIN
  PERFORM public.auditoria_marcar_origem('excluir_avaliacao', p_motivo);
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id_projeto, id_usuario, status INTO v_id_projeto, v_id_usuario, v_status_antigo
  FROM public.avaliacoes WHERE id_avaliacao = p_id_avaliacao FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'mensagem', 'Avaliação não encontrada no sistema.');
  END IF;

  UPDATE public.avaliacoes
  SET status = 'CANCELADA',
      status_avaliacao = 'CANCELADA',
      is_quarentena = false,
      cancelada_em = coalesce(cancelada_em, now()),
      cancelada_por = coalesce(cancelada_por, (SELECT u.id_usuario FROM public.usuarios u
                                               WHERE u.id_usuario = auth.uid() OR u.id_auth = auth.uid() LIMIT 1))
  WHERE id_avaliacao = p_id_avaliacao;

  v_quarentena := public.fn_recalcular_quarentena(v_id_projeto);

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', p_id_avaliacao,
    'id_projeto', v_id_projeto,
    'id_usuario', v_id_usuario,
    'status_anterior', v_status_antigo,
    'novo_status', 'CANCELADA',
    'projeto_em_quarentena', v_quarentena,
    'mensagem', 'Avaliação cancelada com sucesso.'
  );
END;
$$;


ALTER FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") IS 'Soft delete da avaliação (status CANCELADA), com motivo opcional registrado na trilha. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."exigir_staff_ou_admin"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT (public.is_staff() OR public.is_admin()) THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita à equipe Staff ou ao Admin.' USING ERRCODE = '42501';
  END IF;
END;
$$;


ALTER FUNCTION "public"."exigir_staff_ou_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_aparar_texto"("p_texto" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
  SELECT regexp_replace(
    coalesce(p_texto, ''),
    '^[\s   -     　﻿]+|[\s   -     　﻿]+$',
    '', 'g');
$_$;


ALTER FUNCTION "public"."fn_aparar_texto"("p_texto" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_assumir_item_fila"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_assumir_item_fila"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_auditar"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_entidade     text := TG_ARGV[0];
  v_antes        jsonb;
  v_depois       jsonb;
  v_linha        jsonb;
  v_campos       text[];
  v_acao         text;
  v_id_evento    uuid;
  v_id_projeto   uuid;
  v_id_avaliacao uuid;
  v_id_registro  text;
  v_ator         record;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_antes  := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_depois := to_jsonb(NEW); END IF;
  v_linha := coalesce(v_depois, v_antes);

  -- Dado pessoal não entra na trilha (LGPD): o log diz que o cadastro mudou,
  -- não guarda uma segunda cópia do CPF e do celular.
  IF TG_TABLE_NAME = 'usuarios' THEN
    v_antes  := v_antes  - 'cpf' - 'celular' - 'id_auth';
    v_depois := v_depois - 'cpf' - 'celular' - 'id_auth';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO v_campos
    FROM jsonb_object_keys(v_depois) AS k
    WHERE (v_antes -> k) IS DISTINCT FROM (v_depois -> k);

    -- UPDATE que não mudou nada não vira linha de log (evita ruído)
    IF v_campos IS NULL OR cardinality(v_campos) = 0 THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Escopo: evento, projeto e avaliação de cada tabela
  CASE TG_TABLE_NAME
    WHEN 'avaliacoes' THEN
      v_id_avaliacao := (v_linha ->> 'id_avaliacao')::uuid;
      v_id_projeto   := (v_linha ->> 'id_projeto')::uuid;
      v_id_registro  := v_linha ->> 'id_avaliacao';
      SELECT p.id_evento INTO v_id_evento FROM public.projetos p WHERE p.id_projeto = v_id_projeto;
    WHEN 'respostas_avaliacao' THEN
      v_id_avaliacao := (v_linha ->> 'id_avaliacao')::uuid;
      v_id_registro  := v_linha ->> 'id_resposta';
      SELECT a.id_projeto, p.id_evento INTO v_id_projeto, v_id_evento
        FROM public.avaliacoes a
        JOIN public.projetos p ON p.id_projeto = a.id_projeto
       WHERE a.id_avaliacao = v_id_avaliacao;
    WHEN 'projetos' THEN
      v_id_projeto  := (v_linha ->> 'id_projeto')::uuid;
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'codigo_projeto';
    WHEN 'perguntas_questionario' THEN
      v_id_registro := v_linha ->> 'id_pergunta';
      SELECT q.id_evento INTO v_id_evento
        FROM public.questionarios q
       WHERE q.id_questionario = (v_linha ->> 'id_questionario')::uuid;
    WHEN 'questionarios' THEN
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'id_questionario';
    WHEN 'avaliadores_evento' THEN
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'id_usuario';
    WHEN 'dispositivos_avaliador' THEN
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'id_usuario';
    WHEN 'eventos' THEN
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'id_evento';
    WHEN 'usuarios' THEN
      v_id_evento   := public.evento_ativo_id();
      v_id_registro := v_linha ->> 'id_usuario';
    ELSE
      v_id_evento   := public.evento_ativo_id();
  END CASE;

  -- Rótulo: a entidade, refinada quando a mudança tem nome próprio
  v_acao := v_entidade;

  IF TG_TABLE_NAME = 'avaliacoes' THEN
    IF TG_OP = 'INSERT' THEN
      v_acao := 'avaliacao_criada';
    ELSIF TG_OP = 'DELETE' THEN
      v_acao := 'avaliacao_apagada';
    ELSIF 'nota_final' = ANY (v_campos) THEN
      v_acao := 'nota_alterada';
    ELSIF 'status' = ANY (v_campos) THEN
      v_acao := CASE WHEN upper(coalesce(v_depois ->> 'status', '')) = 'CANCELADA'
                     THEN 'avaliacao_cancelada' ELSE 'avaliacao_restaurada' END;
    ELSIF 'is_quarentena' = ANY (v_campos) THEN
      v_acao := CASE WHEN (v_depois ->> 'is_quarentena')::boolean
                     THEN 'quarentena_marcada' ELSE 'quarentena_desmarcada' END;
    END IF;
  ELSIF TG_TABLE_NAME = 'avaliadores_evento' THEN
    v_acao := CASE WHEN coalesce((v_depois ->> 'is_credenciado')::boolean, false)
                   THEN 'credenciamento_concedido' ELSE 'credenciamento_suspenso' END;
  ELSIF TG_TABLE_NAME = 'dispositivos_avaliador' THEN
    v_acao := CASE
                WHEN TG_OP = 'DELETE' OR (v_depois ->> 'revogado_em') IS NOT NULL THEN 'dispositivo_revogado'
                ELSE 'dispositivo_vinculado'
              END;
  ELSIF TG_TABLE_NAME = 'projetos' AND TG_OP = 'UPDATE' THEN
    IF 'is_check_in_realizado' = ANY (v_campos) THEN
      v_acao := CASE WHEN coalesce((v_depois ->> 'is_check_in_realizado')::boolean, false)
                     THEN 'check_in_realizado' ELSE 'check_in_desfeito' END;
    ELSIF 'quarentena_resolvida_em' = ANY (v_campos) THEN
      v_acao := 'quarentena_resolvida';
    ELSIF 'cota_avaliacoes_customizada' = ANY (v_campos) THEN
      v_acao := 'cota_alterada';
    ELSIF 'is_fora_da_competicao' = ANY (v_campos) THEN
      v_acao := 'competicao_alterada';
    ELSIF 'id_questionario_fixado' = ANY (v_campos) THEN
      v_acao := 'questionario_fixado';
    END IF;
  ELSIF TG_TABLE_NAME = 'perguntas_questionario' AND TG_OP = 'UPDATE' THEN
    IF 'peso_calculo' = ANY (v_campos) THEN
      v_acao := 'peso_calculo_alterado';
    ELSIF 'peso_desempate' = ANY (v_campos) THEN
      v_acao := 'peso_desempate_alterado';
    END IF;
  ELSIF TG_TABLE_NAME = 'questionarios' AND TG_OP = 'UPDATE' THEN
    IF 'escala_minima' = ANY (v_campos) OR 'escala_maxima' = ANY (v_campos) THEN
      v_acao := 'escala_alterada';
    END IF;
  ELSIF TG_TABLE_NAME = 'usuarios' AND TG_OP = 'UPDATE' AND 'papel' = ANY (v_campos) THEN
    v_acao := 'papel_alterado';
  END IF;

  SELECT * INTO v_ator FROM public.auditoria_ator();

  INSERT INTO public.log_auditoria (
    id_evento, tabela, operacao, acao, id_registro, id_projeto, id_avaliacao,
    ator_auth, ator_usuario, ator_papel, origem, motivo,
    dados_antes, dados_depois, campos_alterados
  ) VALUES (
    v_id_evento, TG_TABLE_NAME, TG_OP, v_acao, v_id_registro, v_id_projeto, v_id_avaliacao,
    auth.uid(), v_ator.id_usuario, v_ator.papel,
    public.auditoria_origem(), public.auditoria_motivo(),
    v_antes, v_depois, v_campos
  );

  RETURN NULL; -- AFTER trigger: o retorno é ignorado
END $$;


ALTER FUNCTION "public"."fn_auditar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_auditar_notas"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("severidade" "text", "codigo" "text", "titulo" "text", "id_projeto" "uuid", "codigo_projeto" "text", "id_avaliacao" "uuid", "esperado" "text", "encontrado" "text", "detalhe" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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
           coalesce(a.is_voto_popular, false) AS is_voto_popular,
           -- O fallback para o questionário fixado é da nota técnica. Num voto popular ele
           -- apontaria para o questionário técnico e C3a, C3c, C4 e C5 acusariam todas as notas.
           CASE WHEN a.is_voto_popular THEN a.id_questionario
                ELSE coalesce(a.id_questionario, pr.id_questionario_fixado) END AS id_quest
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
  JOIN LATERAL (SELECT count(*) AS qtd FROM av
                WHERE av.id_projeto = pr.id_projeto AND NOT av.is_voto_popular) c ON true
  WHERE c.qtd > pr.cota

  UNION ALL
  -- C7a: avaliação ativa de projeto fora da competição
  SELECT 'atencao', 'C7', 'Projeto fora da competição com avaliação ativa',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         'nenhuma avaliação', c.qtd::text || ' avaliações',
         'O projeto não entra no ranking, mas as notas continuam gravadas.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av
                WHERE av.id_projeto = pr.id_projeto AND NOT av.is_voto_popular) c ON true
  WHERE pr.is_fora_da_competicao AND c.qtd > 0

  UNION ALL
  -- C7b: avaliação ativa de projeto sem check-in
  SELECT 'atencao', 'C7', 'Projeto sem check-in com avaliação ativa',
         pr.id_projeto, pr.codigo_projeto, NULL::uuid,
         'check-in feito antes da avaliação', 'sem check-in',
         'fn_enviar_avaliacao exige check-in: uma avaliação assim entrou por outro caminho.'
  FROM proj pr
  JOIN LATERAL (SELECT count(*) AS qtd FROM av
                WHERE av.id_projeto = pr.id_projeto AND NOT av.is_voto_popular) c ON true
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
    AND NOT av.is_voto_popular
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
                FROM av WHERE av.id_projeto = pr.id_projeto AND NOT av.is_voto_popular) direto ON true
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
                  AND (a.status IS NULL OR a.status <> 'CANCELADA')
                  AND NOT a.is_voto_popular) media ON true
  WHERE p.id_evento = v_id_evento AND p.ajuste_media <> 0;
END $$;


ALTER FUNCTION "public"."fn_auditar_notas"("p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_auditar_notas"("p_id_evento" "uuid") IS 'Conferência de notas do evento: recalcula a nota final a partir das respostas e lista o que não fecha. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."fn_auditar_voto_popular"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("severidade" "text", "codigo" "text", "titulo" "text", "id_projeto" "uuid", "codigo_projeto" "text", "id_avaliacao" "uuid", "esperado" "text", "encontrado" "text", "detalhe" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH ev AS (SELECT coalesce(p_id_evento, public.evento_ativo_id()) AS id_evento)
  SELECT 'grave'::text, 'C13'::text, 'Classificação de voto popular divergente do questionário'::text,
         p.id_projeto, p.codigo_projeto::text, a.id_avaliacao,
         CASE WHEN q.is_voto_popular THEN 'voto popular' ELSE 'nota técnica' END::text,
         CASE WHEN a.is_voto_popular THEN 'voto popular' ELSE 'nota técnica' END::text,
         'avaliacoes.is_voto_popular é cópia da marca do questionário, mantida por trigger. Divergência significa escrita que não passou pelo trigger.'::text
  FROM public.avaliacoes a
  JOIN public.projetos p ON p.id_projeto = a.id_projeto
  JOIN ev ON ev.id_evento = p.id_evento
  JOIN public.questionarios q ON q.id_questionario = a.id_questionario
  WHERE coalesce(a.is_voto_popular, false) IS DISTINCT FROM coalesce(q.is_voto_popular, false)

  UNION ALL
  SELECT 'atencao'::text, 'C14'::text, 'Avaliador de voto popular com nota técnica'::text,
         p.id_projeto, p.codigo_projeto::text, a.id_avaliacao,
         'nota pelo questionário vinculado'::text, 'nota técnica'::text,
         'O avaliador está vinculado a um questionário de voto popular, mas esta nota entrou na média técnica do projeto.'::text
  FROM public.avaliacoes a
  JOIN public.projetos p ON p.id_projeto = a.id_projeto
  JOIN ev ON ev.id_evento = p.id_evento
  WHERE (a.status IS NULL OR a.status <> 'CANCELADA')
    AND NOT coalesce(a.is_voto_popular, false)
    AND public.avaliador_e_voto_popular(a.id_usuario, p.id_evento);
$$;


ALTER FUNCTION "public"."fn_auditar_voto_popular"("p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_auditar_voto_popular"("p_id_evento" "uuid") IS 'Achados próprios do voto popular (C13 e C14): a classificação gravada na avaliação divergir da marca do questionário, e votante com nota na média técnica.';



CREATE OR REPLACE FUNCTION "public"."fn_autocadastro_avaliador"("p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_nome_instituicao_nova" "text", "p_ids_areas" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."fn_autocadastro_avaliador"("p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_nome_instituicao_nova" "text", "p_ids_areas" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_avaliacoes_ativas_do_projeto"("p_id_projeto" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE WHEN public.avaliador_atual() IS NULL AND NOT public.is_staff() AND NOT public.is_admin() THEN NULL
         ELSE (SELECT count(*)::integer FROM public.avaliacoes
               WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA')
                 AND NOT is_voto_popular) END;
$$;


ALTER FUNCTION "public"."fn_avaliacoes_ativas_do_projeto"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_avaliacoes_do_questionario"("p_id_questionario" "uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(DISTINCT x.id_avaliacao)::integer FROM (
      SELECT a.id_avaliacao FROM public.avaliacoes a WHERE a.id_questionario = p_id_questionario
      UNION
      SELECT r.id_avaliacao FROM public.respostas_avaliacao r
      JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
      WHERE pq.id_questionario = p_id_questionario
    ) x
  );
END;
$$;


ALTER FUNCTION "public"."fn_avaliacoes_do_questionario"("p_id_questionario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_chave_desempate"("p_id_projeto" "uuid") RETURNS numeric[]
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce(array_agg(x.media ORDER BY x.prioridade, x.ordem), '{}'::numeric[])
  FROM (
    SELECT pq.peso_desempate AS prioridade, pq.ordem, round(avg(r.nota_atribuida), 2) AS media
    FROM public.avaliacoes a
    JOIN public.respostas_avaliacao r ON r.id_avaliacao = a.id_avaliacao
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE a.id_projeto = p_id_projeto
      AND (a.status IS NULL OR a.status <> 'CANCELADA')
      AND NOT a.is_voto_popular
      AND pq.peso_desempate > 0
    GROUP BY pq.id_pergunta, pq.peso_desempate, pq.ordem
  ) x;
$$;


ALTER FUNCTION "public"."fn_chave_desempate"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_in_projeto"("p_id_projeto" "uuid", "p_check_in" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.auditoria_marcar_origem('fn_check_in_projeto');
  PERFORM public.exigir_staff_ou_admin();
  UPDATE public.projetos SET is_check_in_realizado = p_check_in WHERE id_projeto = p_id_projeto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;
END;
$$;


ALTER FUNCTION "public"."fn_check_in_projeto"("p_id_projeto" "uuid", "p_check_in" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_desvincular_dispositivo"("p_id_usuario" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_qtd integer;
BEGIN
  PERFORM public.auditoria_marcar_origem('fn_desvincular_dispositivo');
  PERFORM public.exigir_staff_ou_admin();
  UPDATE public.dispositivos_avaliador SET revogado_em = now()
  WHERE id_usuario = p_id_usuario AND revogado_em IS NULL;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  UPDATE public.codigos_acesso SET usado_em = now() WHERE id_usuario = p_id_usuario AND usado_em IS NULL;
  DELETE FROM public.locks_ativos WHERE id_usuario = p_id_usuario;
  RETURN jsonb_build_object('ok', true, 'aparelhos_desvinculados', v_qtd);
END;
$$;


ALTER FUNCTION "public"."fn_desvincular_dispositivo"("p_id_usuario" "uuid") OWNER TO "postgres";


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
$$;


ALTER FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_tempo_presenca" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_expurgar_modalidades_bloqueadas"("p_id_usuario" "uuid", "p_id_evento" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH projetos_bloqueados AS (
    SELECT p.id_projeto
    FROM public.projetos p
    JOIN public.avaliador_modalidades_bloqueadas b
      ON b.id_modalidade = p.id_modalidade AND b.id_usuario = p_id_usuario AND b.id_evento = p_id_evento
    WHERE p.id_evento = p_id_evento
  ), travas AS (
    DELETE FROM public.locks_ativos l
    WHERE l.id_usuario = p_id_usuario AND l.id_projeto IN (SELECT id_projeto FROM projetos_bloqueados)
  )
  DELETE FROM public.fila_atribuicoes_direcionadas f
  WHERE f.id_usuario = p_id_usuario AND f.id_projeto IN (SELECT id_projeto FROM projetos_bloqueados);
$$;


ALTER FUNCTION "public"."fn_expurgar_modalidades_bloqueadas"("p_id_usuario" "uuid", "p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_feira_concluida"("p_id_evento" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_feira_concluida"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_fixar_questionario"("p_id_projeto" "uuid", "p_id_questionario" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_fixar_questionario"("p_id_projeto" "uuid", "p_id_questionario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_gerar_codigo_acesso"("p_id_usuario" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_evento public.eventos;
  v_codigo text;
  v_expira timestamptz;
BEGIN
  PERFORM public.exigir_staff_ou_admin();
  v_evento := public.parametros_acesso(NULL);
  IF v_evento.metodos_vinculo NOT IN ('ambos', 'codigo') THEN
    RAISE EXCEPTION 'Código de acesso desativado neste evento (Configurações do evento).';
  END IF;
  PERFORM public.validar_avaliador_do_evento(p_id_usuario, v_evento.id_evento);

  -- Um código válido por avaliador: gerar outro invalida o anterior.
  UPDATE public.codigos_acesso SET usado_em = now() WHERE id_usuario = p_id_usuario AND usado_em IS NULL;

  v_codigo := public.gerar_codigo_curto(v_evento.tamanho_codigo);
  v_expira := now() + make_interval(mins => v_evento.minutos_validade_codigo_acesso);
  INSERT INTO public.codigos_acesso (id_usuario, id_evento, codigo_hash, gerado_por, expira_em, max_tentativas)
  VALUES (p_id_usuario, v_evento.id_evento, extensions.crypt(v_codigo, extensions.gen_salt('bf', 8)),
          auth.uid(), v_expira, v_evento.max_tentativas_codigo);

  -- Gerar o código é o Staff liberando o avaliador (como no pareamento): o celular só vale credenciado
  UPDATE public.avaliadores_evento SET is_credenciado = true
  WHERE id_usuario = p_id_usuario AND id_evento = v_evento.id_evento;

  RETURN jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
END;
$$;


ALTER FUNCTION "public"."fn_gerar_codigo_acesso"("p_id_usuario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_identidade_visual"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce(
    (
      SELECT jsonb_build_object(
        'id_evento', e.id_evento,
        'nome_evento', e.nome_evento,
        'url_icone', e.url_icone,
        'url_imagem_evento', e.url_imagem_evento
      )
      FROM public.eventos e
      WHERE e.id_evento = public.evento_ativo_id()
    ),
    jsonb_build_object('id_evento', NULL, 'nome_evento', NULL, 'url_icone', NULL, 'url_imagem_evento', NULL)
  );
$$;


ALTER FUNCTION "public"."fn_identidade_visual"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_identidade_visual"() IS 'Ícone e imagem do evento ativo. Pública: o cabeçalho e o login precisam dela sem sessão.';



CREATE OR REPLACE FUNCTION "public"."fn_janela_avaliacao_aberta"("p_id_evento" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  -- Mesma regra da tela do avaliador (validarJanelaAvaliacao), no fuso de Mato Grosso do Sul
  SELECT coalesce(e.sistema_liberado, true)
     AND e.data_evento IS NOT NULL AND e.horario_inicio IS NOT NULL AND e.horario_fim IS NOT NULL
     AND (now() AT TIME ZONE 'America/Campo_Grande')
         BETWEEN (e.data_evento + e.horario_inicio) AND (e.data_evento + e.horario_fim)
  FROM public.eventos e
  WHERE e.id_evento = p_id_evento;
$$;


ALTER FUNCTION "public"."fn_janela_avaliacao_aberta"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_log_auditoria_imutavel"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RAISE EXCEPTION 'A trilha de auditoria é append-only: % em log_auditoria não é permitido.', TG_OP
    USING ERRCODE = '42501';
END $$;


ALTER FUNCTION "public"."fn_log_auditoria_imutavel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_memorial_avaliacao"("p_id_avaliacao" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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
    'is_voto_popular',  coalesce(a.is_voto_popular, false),
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
    -- O fallback para o questionário fixado no projeto só vale para nota técnica: num voto
    -- popular ele apontaria para o questionário técnico e daria a escala errada.
    ON q.id_questionario = CASE WHEN a.is_voto_popular THEN a.id_questionario
                                ELSE coalesce(a.id_questionario, p.id_questionario_fixado) END
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


ALTER FUNCTION "public"."fn_memorial_avaliacao"("p_id_avaliacao" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_memorial_avaliacao"("p_id_avaliacao" "uuid") IS 'Conta aberta de uma nota: critério, peso, nota, produto, soma, divisão e o que está gravado. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."fn_memorial_evento"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_memorial_evento"("p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_memorial_evento"("p_id_evento" "uuid") IS 'Folha de conferência consolidada: todos os projetos do evento com o memorial de cada avaliação. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."fn_memorial_por_codigo"("p_codigo_projeto" "text", "p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_memorial_por_codigo"("p_codigo_projeto" "text", "p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_memorial_por_codigo"("p_codigo_projeto" "text", "p_id_evento" "uuid") IS 'Memorial do projeto a partir do codigo_projeto, para a interface não precisar de UUID.';



CREATE OR REPLACE FUNCTION "public"."fn_memorial_projeto"("p_id_projeto" "uuid", "p_incluir_achados" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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
        AND NOT a.is_voto_popular
    ), '[]'::jsonb),
    -- Voto popular em lista própria: não entra na média técnica nem na quarentena
    'avaliacoes_voto_popular', coalesce((
      SELECT jsonb_agg(public.fn_memorial_avaliacao(a.id_avaliacao) ORDER BY a.created_at)
      FROM public.avaliacoes a
      WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
        AND a.is_voto_popular
    ), '[]'::jsonb),
    'total_votos_populares', coalesce(votos.qtd, 0),
    'media_voto_popular', votos.media,
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
      AND NOT a.is_voto_popular
  ) ativas ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS qtd, round(avg(a.nota_final), 2) AS media
    FROM public.avaliacoes a
    WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')
      AND a.is_voto_popular
  ) votos ON true
  WHERE p.id_projeto = p_id_projeto;

  RETURN v_resultado;
END $$;


ALTER FUNCTION "public"."fn_memorial_projeto"("p_id_projeto" "uuid", "p_incluir_achados" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_memorial_projeto"("p_id_projeto" "uuid", "p_incluir_achados" boolean) IS 'Memorial do projeto: avaliações, média aberta, desempate, quarentena, achados e trilha. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."fn_meu_perfil"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_evento  public.eventos;
  v_usuario public.usuarios;
  v_papel   text;
  v_quest   uuid;
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
      v_quest := public.questionario_do_avaliador(v_usuario.id_usuario, v_evento.id_evento);
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
    -- Questionário vinculado a este avaliador no evento (NULL: usa o do projeto)
    'id_questionario_vinculado', v_quest,
    'voto_popular', CASE WHEN v_quest IS NULL THEN false
                         ELSE coalesce((SELECT q.is_voto_popular FROM public.questionarios q
                                        WHERE q.id_questionario = v_quest), false) END,
    -- Sessão de Admin/Staff neste navegador: a tela do avaliador precisa de uma sessão só do aparelho
    'sessao_equipe',   public.sessao_de_conta_da_equipe()
  );
END;
$$;


ALTER FUNCTION "public"."fn_meu_perfil"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_motivo_inelegivel"("p_id_projeto" "uuid", "p_id_usuario" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_motivo_inelegivel"("p_id_projeto" "uuid", "p_id_usuario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_normalizar_nome"("p_texto" "text") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.fn_aparar_texto(regexp_replace(lower(normalize(coalesce(p_texto, ''), NFD)), '[̀-ͯ]', '', 'g'));
$$;


ALTER FUNCTION "public"."fn_normalizar_nome"("p_texto" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_normalizar_nome"("p_texto" "text") IS 'Chave de comparação de nomes: minúsculas, sem acentos e sem espaços nas pontas. Igual a normalizarChave() no front.';



CREATE OR REPLACE FUNCTION "public"."fn_parear_dispositivo"("p_codigo" "text", "p_id_usuario" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_pend public.pareamentos_pendentes;
  v_nome text;
BEGIN
  PERFORM public.auditoria_marcar_origem('fn_parear_dispositivo');
  PERFORM public.exigir_staff_ou_admin();

  SELECT * INTO v_pend FROM public.pareamentos_pendentes
  WHERE codigo = public.normalizar_codigo(p_codigo) AND expira_em > now()
  FOR UPDATE;
  IF v_pend.codigo IS NULL THEN
    RAISE EXCEPTION 'Código de pareamento inválido ou expirado. Peça para o avaliador gerar outro.';
  END IF;
  -- Código gerado num navegador logado como Admin/Staff: vincular ali deixaria o celular preso na
  -- tela de espera (fn_meu_perfil responderia 'admin'/'staff'), então o pareamento não acontece.
  IF public.conta_da_equipe(v_pend.auth_uid) THEN
    DELETE FROM public.pareamentos_pendentes WHERE codigo = v_pend.codigo;
    RAISE EXCEPTION 'Esse código foi gerado num navegador logado como Admin ou Staff. Peça para sair dessa conta e gerar outro código.';
  END IF;

  PERFORM public.validar_avaliador_do_evento(p_id_usuario, v_pend.id_evento);

  UPDATE public.dispositivos_avaliador SET revogado_em = now()
  WHERE id_usuario = p_id_usuario AND revogado_em IS NULL AND auth_uid <> v_pend.auth_uid;
  INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo, vinculado_por)
  VALUES (v_pend.auth_uid, p_id_usuario, v_pend.id_evento, 'pareamento', auth.uid())
  ON CONFLICT (auth_uid) DO UPDATE
    SET id_usuario = EXCLUDED.id_usuario, id_evento = EXCLUDED.id_evento, metodo = 'pareamento',
        vinculado_por = EXCLUDED.vinculado_por, vinculado_em = now(), revogado_em = NULL;

  UPDATE public.avaliadores_evento SET is_credenciado = true
  WHERE id_usuario = p_id_usuario AND id_evento = v_pend.id_evento;
  DELETE FROM public.pareamentos_pendentes WHERE codigo = v_pend.codigo;

  SELECT nome INTO v_nome FROM public.usuarios WHERE id_usuario = p_id_usuario;
  RETURN jsonb_build_object('ok', true, 'id_usuario', p_id_usuario, 'nome', v_nome);
END;
$$;


ALTER FUNCTION "public"."fn_parear_dispositivo"("p_codigo" "text", "p_id_usuario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_politica_seguranca"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT jsonb_build_object(
    'exigir_mfa_admin', coalesce(c.exigir_mfa_admin, false),
    'minutos_inatividade_sessao', coalesce(c.minutos_inatividade_sessao, 0)
  )
  FROM (SELECT 1) x
  LEFT JOIN public.configuracoes_seguranca c ON c.id;
$$;


ALTER FUNCTION "public"."fn_politica_seguranca"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_projetos_situacao"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_projeto" "uuid", "cota" integer, "avaliacoes_tecnicas" integer, "travas_tecnicas" integer, "vagas_restantes" integer, "media_tecnica" numeric, "notas_tecnicas" numeric[], "votos_populares" integer, "media_voto_popular" numeric, "em_quarentena" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cota_padrao integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_id_evento IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(e.cota_avaliacoes_padrao, 3) INTO v_cota_padrao
  FROM public.eventos e WHERE e.id_evento = p_id_evento;
  v_cota_padrao := coalesce(v_cota_padrao, 3);

  RETURN QUERY
  WITH notas AS (
    SELECT a.id_projeto,
      count(*) FILTER (WHERE NOT a.is_voto_popular)::int AS tecnicas,
      round(avg(a.nota_final) FILTER (WHERE NOT a.is_voto_popular), 2) AS media_tec,
      array_agg(round(a.nota_final, 2) ORDER BY coalesce(a.tempo_submissao, a.created_at) DESC)
        FILTER (WHERE NOT a.is_voto_popular AND a.nota_final IS NOT NULL) AS notas_tec,
      count(*) FILTER (WHERE a.is_voto_popular)::int AS populares,
      round(avg(a.nota_final) FILTER (WHERE a.is_voto_popular), 2) AS media_pop
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    WHERE p.id_evento = p_id_evento
      AND (a.status IS NULL OR a.status <> 'CANCELADA')
    GROUP BY a.id_projeto
  ),
  -- Travas vencidas não ocupam vaga (o sorteio as apaga antes de contar). Mesma
  -- condição de fn_vagas_projeto, que é a conta oficial de vaga de um projeto só.
  travas AS (
    SELECT l.id_projeto, count(*) FILTER (WHERE NOT l.is_voto_popular)::int AS tecnicas
    FROM public.locks_ativos l
    JOIN public.projetos p ON p.id_projeto = l.id_projeto
    WHERE p.id_evento = p_id_evento
      AND l.expira_em > now()
    GROUP BY l.id_projeto
  ),
  quarentena AS (
    SELECT q.id_projeto FROM public.view_projetos_quarentena q WHERE q.id_evento = p_id_evento
  )
  SELECT p.id_projeto,
    coalesce(p.cota_avaliacoes_customizada, v_cota_padrao)::int,
    coalesce(n.tecnicas, 0),
    coalesce(t.tecnicas, 0),
    greatest(coalesce(p.cota_avaliacoes_customizada, v_cota_padrao) - (coalesce(n.tecnicas, 0) + coalesce(t.tecnicas, 0)), 0)::int,
    n.media_tec,
    coalesce(n.notas_tec, '{}'::numeric[]),
    coalesce(n.populares, 0),
    n.media_pop,
    (q.id_projeto IS NOT NULL)
  FROM public.projetos p
  LEFT JOIN notas n ON n.id_projeto = p.id_projeto
  LEFT JOIN travas t ON t.id_projeto = p.id_projeto
  LEFT JOIN quarentena q ON q.id_projeto = p.id_projeto
  WHERE p.id_evento = p_id_evento
  ORDER BY p.codigo_projeto, p.id_projeto;
END;
$$;


ALTER FUNCTION "public"."fn_projetos_situacao"("p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_projetos_situacao"("p_id_evento" "uuid") IS 'Situação de cada projeto do evento pela regra do sorteio: cota, avaliações técnicas ativas, travas técnicas não vencidas, vagas restantes, média e notas técnicas, voto popular e quarentena. Fonte única do Mapa de Estandes e da Atribuição Forçada — o voto popular não ocupa vaga nem entra na média técnica. Restrita ao Admin.';



CREATE OR REPLACE FUNCTION "public"."fn_recalcular_quarentena"("p_id_projeto" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_recalcular_quarentena"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_registrar_impedimento"("p_id_projeto" "uuid", "p_tipo" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_usuario uuid := public.avaliador_atual();
BEGIN
  PERFORM public.auditoria_marcar_origem('fn_registrar_impedimento');
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: este aparelho não está vinculado a um avaliador.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('ausencia', 'conflito') THEN
    RAISE EXCEPTION 'Tipo de impedimento inválido: use ausencia ou conflito.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.locks_ativos
    WHERE id_usuario = v_usuario AND id_projeto = p_id_projeto AND expira_em > now()
  ) THEN
    RAISE EXCEPTION 'Só é possível registrar ausência ou conflito no projeto em que você está.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.historico_impedimentos (id_usuario, id_projeto, tipo) VALUES (v_usuario, p_id_projeto, p_tipo);
  DELETE FROM public.locks_ativos WHERE id_usuario = v_usuario;
END;
$$;


ALTER FUNCTION "public"."fn_registrar_impedimento"("p_id_projeto" "uuid", "p_tipo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_usuario" "uuid", "avaliador_nome" "text", "avaliador_email" "text", "total_ausencias" integer, "ausencias" "jsonb")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH ausencias_enriquecidas AS (
    SELECT hi.id_usuario, u.nome AS avaliador_nome, u.email AS avaliador_email,
      p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo AS projeto_titulo, p.estande AS projeto_estande,
      coalesce(m.nome_modalidade, 'Sem modalidade') AS projeto_modalidade,
      coalesce(ar.nome_area, 'Sem área temática') AS projeto_area,
      coalesce(inst.nome_exibicao, 'Não informada') AS projeto_instituicao,
      hi.created_at AS data_ausencia,
      (SELECT count(*)::int FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto AND (av.status IS NULL OR av.status <> 'CANCELADA')
          AND NOT av.is_voto_popular) AS total_avaliacoes_atuais
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


ALTER FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_usuario" "uuid", "avaliador_nome" "text", "avaliador_email" "text", "total_avaliacoes" integer, "media_notas" numeric, "tempo_medio_segundos" integer, "avaliacoes" "jsonb")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
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
      AND NOT a.is_voto_popular
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


ALTER FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_devolucoes_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_usuario" "uuid", "avaliador_nome" "text", "avaliador_email" "text", "total_devolucoes" integer, "devolucoes" "jsonb")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH devolucoes_enriquecidas AS (
    SELECT hi.id_usuario, u.nome AS avaliador_nome, u.email AS avaliador_email,
      p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo AS projeto_titulo, p.estande AS projeto_estande,
      coalesce(m.nome_modalidade, 'Sem modalidade') AS projeto_modalidade,
      coalesce(ar.nome_area, 'Sem área temática') AS projeto_area,
      coalesce(inst.nome_exibicao, 'Não informada') AS projeto_instituicao,
      hi.created_at AS data_devolucao,
      (SELECT count(*)::int FROM public.avaliacoes av
        WHERE av.id_projeto = p.id_projeto AND (av.status IS NULL OR av.status <> 'CANCELADA')
          AND NOT av.is_voto_popular) AS total_avaliacoes_atuais
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


ALTER FUNCTION "public"."fn_relatorio_devolucoes_completo"("p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_relatorio_devolucoes_completo"("p_id_evento" "uuid") IS 'Devoluções por conflito de interesse (historico_impedimentos.tipo = ''conflito'') agrupadas por avaliador, no evento informado.';



CREATE OR REPLACE FUNCTION "public"."fn_relatorio_indicadores_gerenciais"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_relatorio_indicadores_gerenciais"("p_id_evento" "uuid") OWNER TO "postgres";


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


ALTER FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_projeto" "uuid", "id_evento" "uuid", "codigo_projeto" "text", "titulo" "text", "estande" "text", "corredor" "text", "modalidade" "text", "area_conhecimento" "text", "nome_instituicao" "text", "id_instituicao" "uuid", "is_check_in_realizado" boolean, "is_fora_da_competicao" boolean, "total_avaliacoes" integer, "media_geral" numeric, "notas" numeric[], "detalhes_avaliacoes" "jsonb", "cota_avaliacoes" integer, "ajuste_media" numeric, "media_final" numeric, "tem_ajuste_manual" boolean, "total_votos_populares" integer, "media_voto_popular" numeric, "votos_populares" "jsonb")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH avaliacoes_validas AS (
    SELECT a.id_avaliacao, a.id_projeto, a.id_usuario, u.nome AS avaliador_nome,
      round(a.nota_final::numeric, 2) AS nota_final,
      coalesce(a.parecer_final, '') AS parecer,
      coalesce(a.tempo_submissao, a.created_at) AS data,
      a.ajuste_tipo, a.ajuste_motivo, a.is_voto_popular
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
    count(av.id_avaliacao) FILTER (WHERE NOT av.is_voto_popular)::int,
    coalesce(round(avg(av.nota_final) FILTER (WHERE NOT av.is_voto_popular), 2), 0.00),
    coalesce(array_agg(av.nota_final ORDER BY av.data DESC) FILTER (WHERE av.nota_final IS NOT NULL AND NOT av.is_voto_popular), '{}'::numeric[]),
    coalesce(jsonb_agg(jsonb_build_object(
      'id_avaliacao', av.id_avaliacao, 'id_usuario', av.id_usuario, 'avaliador_nome', av.avaliador_nome,
      'nota_final', av.nota_final, 'parecer', av.parecer, 'data', av.data,
      'ajuste_tipo', av.ajuste_tipo, 'ajuste_motivo', av.ajuste_motivo
    ) ORDER BY av.data DESC) FILTER (WHERE av.id_avaliacao IS NOT NULL AND NOT av.is_voto_popular), '[]'::jsonb),
    coalesce(p.cota_avaliacoes_customizada, ev.cota_avaliacoes_padrao, 3)::int,
    coalesce(p.ajuste_media, 0),
    coalesce(round(avg(av.nota_final) FILTER (WHERE NOT av.is_voto_popular), 2), 0.00) + coalesce(p.ajuste_media, 0),
    coalesce(p.ajuste_media, 0) <> 0 OR coalesce(bool_or(av.ajuste_tipo IS NOT NULL) FILTER (WHERE NOT av.is_voto_popular), false),
    count(av.id_avaliacao) FILTER (WHERE av.is_voto_popular)::int,
    round(avg(av.nota_final) FILTER (WHERE av.is_voto_popular), 2),
    coalesce(jsonb_agg(jsonb_build_object(
      'id_avaliacao', av.id_avaliacao, 'id_usuario', av.id_usuario, 'avaliador_nome', av.avaliador_nome,
      'nota_final', av.nota_final, 'parecer', av.parecer, 'data', av.data
    ) ORDER BY av.data DESC) FILTER (WHERE av.id_avaliacao IS NOT NULL AND av.is_voto_popular), '[]'::jsonb)
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


ALTER FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_voto_popular_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_projeto" "uuid", "codigo_projeto" "text", "titulo" "text", "modalidade" "text", "area_tematica" "text", "nome_instituicao" "text", "total_votos" integer, "media_simples" numeric, "media_bayesiana" numeric, "media_evento" numeric, "peso_ancora" numeric, "posicao" integer, "votos" "jsonb")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH votos_validos AS (
    SELECT a.id_avaliacao, a.id_projeto, a.id_usuario, u.nome AS avaliador_nome,
      round(a.nota_final::numeric, 2) AS nota,
      coalesce(a.tempo_submissao, a.created_at) AS data
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    JOIN public.usuarios u ON u.id_usuario = a.id_usuario
    WHERE p.id_evento = p_id_evento
      AND a.is_voto_popular
      AND (a.status IS NULL OR a.status <> 'CANCELADA')
      AND a.nota_final IS NOT NULL
  ),
  por_projeto AS (
    SELECT v.id_projeto, count(*)::int AS total_votos, round(avg(v.nota), 2) AS media_simples,
      jsonb_agg(jsonb_build_object(
        'id_avaliacao', v.id_avaliacao, 'id_usuario', v.id_usuario,
        'avaliador_nome', v.avaliador_nome, 'nota_final', v.nota, 'data', v.data
      ) ORDER BY v.data DESC) AS votos
    FROM votos_validos v
    GROUP BY v.id_projeto
  ),
  -- Âncora da média bayesiana: C = média de todos os votos do evento;
  -- m = votos por projeto votado (automático, acompanha o volume real da feira).
  ancora AS (
    SELECT round(avg(v.nota), 4) AS media_evento,
      round(count(*)::numeric / nullif((SELECT count(*) FROM por_projeto), 0), 4) AS peso
    FROM votos_validos v
  ),
  calculo AS (
    SELECT pp.id_projeto, pp.total_votos, pp.media_simples, pp.votos,
      an.media_evento, an.peso,
      round(
        (pp.total_votos::numeric / nullif(pp.total_votos + an.peso, 0)) * pp.media_simples
        + (an.peso / nullif(pp.total_votos + an.peso, 0)) * an.media_evento
      , 2) AS media_bayesiana
    FROM por_projeto pp CROSS JOIN ancora an
  )
  SELECT c.id_projeto, p.codigo_projeto::text, p.titulo::text,
    coalesce(m.nome_modalidade, 'Sem modalidade')::text,
    coalesce(ar.nome_area, 'Sem área temática')::text,
    coalesce(inst.nome_exibicao, 'Não informada')::text,
    c.total_votos, c.media_simples, c.media_bayesiana, c.media_evento, c.peso,
    rank() OVER (ORDER BY c.media_bayesiana DESC, c.total_votos DESC, p.codigo_projeto)::int,
    c.votos
  FROM calculo c
  JOIN public.projetos p ON p.id_projeto = c.id_projeto
  LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
  LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
  LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
  ORDER BY c.media_bayesiana DESC, c.total_votos DESC, p.codigo_projeto;
$$;


ALTER FUNCTION "public"."fn_relatorio_voto_popular_completo"("p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_relatorio_voto_popular_completo"("p_id_evento" "uuid") IS 'Voto popular por projeto no evento: votos, média simples e média bayesiana, com a âncora (media_evento) e o peso (peso_ancora) para a conta aberta na tela. Ordena pela bayesiana. Alimenta o relatório e a classificação do voto popular — um lugar só, para os dois não divergirem.';



CREATE OR REPLACE FUNCTION "public"."fn_situacao_vinculos"("p_id_evento" "uuid") RETURNS TABLE("id_usuario" "uuid", "aparelho_vinculado" boolean, "vinculado_em" timestamp with time zone, "metodo" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.exigir_staff_ou_admin();
  RETURN QUERY
  SELECT ae.id_usuario, d.auth_uid IS NOT NULL, d.vinculado_em, d.metodo
  FROM public.avaliadores_evento ae
  LEFT JOIN public.dispositivos_avaliador d ON d.id_usuario = ae.id_usuario AND d.revogado_em IS NULL
  WHERE ae.id_evento = coalesce(p_id_evento, public.evento_ativo_id());
END;
$$;


ALTER FUNCTION "public"."fn_situacao_vinculos"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_solicitar_pareamento"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_evento public.eventos;
  v_codigo text;
  v_expira timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão do aparelho não iniciada.' USING ERRCODE = '42501';
  END IF;
  IF public.sessao_de_conta_da_equipe() THEN
    RAISE EXCEPTION 'Este navegador está logado como Admin ou Staff. Saia dessa conta para vincular o celular do avaliador.'
      USING ERRCODE = '42501';
  END IF;
  v_evento := public.parametros_acesso(NULL);
  IF v_evento.id_evento IS NULL THEN
    RAISE EXCEPTION 'Nenhum evento ativo.';
  END IF;
  IF v_evento.metodos_vinculo NOT IN ('ambos', 'pareamento') THEN
    RAISE EXCEPTION 'Pareamento desativado neste evento. Use o código de acesso.';
  END IF;

  DELETE FROM public.pareamentos_pendentes WHERE expira_em < now() OR auth_uid = auth.uid();
  v_expira := now() + make_interval(mins => v_evento.minutos_validade_pareamento);

  LOOP
    v_codigo := public.gerar_codigo_curto(v_evento.tamanho_codigo);
    BEGIN
      INSERT INTO public.pareamentos_pendentes (codigo, auth_uid, id_evento, expira_em)
      VALUES (v_codigo, auth.uid(), v_evento.id_evento, v_expira);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- colisão de código: sorteia outro
    END;
  END LOOP;

  RETURN jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
END;
$$;


ALTER FUNCTION "public"."fn_solicitar_pareamento"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_telao_resumo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH ev AS (
    SELECT id_evento, nome_evento, edicao, coalesce(data_evento, data_inicio) AS data_evento,
      horario_inicio, horario_fim, coalesce(cota_avaliacoes_padrao, 3) AS cota
    FROM public.eventos WHERE id_evento = coalesce(p_id_evento, public.evento_ativo_id())
  ),
  validas AS (
    SELECT a.id_projeto, count(*) AS qtd
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE (a.status IS NULL OR a.status <> 'CANCELADA') AND a.nota_final IS NOT NULL
      AND NOT a.is_voto_popular
    GROUP BY a.id_projeto
  ),
  votos AS (
    SELECT a.id_projeto, count(*) AS qtd
    FROM public.avaliacoes a
    JOIN public.projetos p ON p.id_projeto = a.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE (a.status IS NULL OR a.status <> 'CANCELADA') AND a.nota_final IS NOT NULL
      AND a.is_voto_popular
    GROUP BY a.id_projeto
  ),
  travas AS (
    SELECT l.id_projeto, count(*) AS qtd
    FROM public.locks_ativos l
    JOIN public.projetos p ON p.id_projeto = l.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE l.expira_em > now()
      AND NOT l.is_voto_popular
    GROUP BY l.id_projeto
  ),
  presentes AS (
    SELECT p.id_projeto, coalesce(p.cota_avaliacoes_customizada, ev.cota) AS cota,
      coalesce(v.qtd, 0) AS qtd, coalesce(t.qtd, 0) AS travas
    FROM public.projetos p
    JOIN ev ON ev.id_evento = p.id_evento
    LEFT JOIN validas v ON v.id_projeto = p.id_projeto
    LEFT JOIN travas t ON t.id_projeto = p.id_projeto
    WHERE p.is_check_in_realizado IS TRUE AND NOT coalesce(p.is_fora_da_competicao, false)
  )
  SELECT jsonb_build_object(
    'nome_evento', (SELECT nome_evento FROM ev),
    'edicao', (SELECT edicao FROM ev),
    'data_evento', (SELECT data_evento FROM ev),
    'horario_inicio', (SELECT horario_inicio FROM ev),
    'horario_fim', (SELECT horario_fim FROM ev),
    'total_projetos', (SELECT count(*) FROM public.projetos p JOIN ev ON ev.id_evento = p.id_evento),
    'projetos_presentes', (SELECT count(*) FROM presentes),
    'avaliadores_credenciados', (SELECT count(*) FROM public.avaliadores_evento ae
                                 JOIN ev ON ev.id_evento = ae.id_evento
                                 JOIN public.usuarios u ON u.id_usuario = ae.id_usuario
                                 WHERE ae.is_credenciado AND upper(u.papel) = 'AVALIADOR'),
    'avaliacoes_em_andamento', (SELECT coalesce(sum(qtd), 0) FROM travas),
    'em_andamento_na_meta', (SELECT coalesce(sum(least(travas, greatest(cota - qtd, 0))), 0) FROM presentes),
    'avaliacoes_realizadas', (SELECT coalesce(sum(qtd), 0) FROM validas),
    'meta_global', (SELECT coalesce(sum(cota), 0) FROM presentes),
    'avaliacoes_na_meta', (SELECT coalesce(sum(least(qtd, cota)), 0) FROM presentes),
    'projetos_quarentena', (SELECT count(*) FROM public.view_projetos_quarentena q JOIN ev ON ev.id_evento = q.id_evento),
    'cota_padrao', (SELECT cota FROM ev),
    'avaliacao_finalizada', (SELECT count(*) > 0 AND bool_and(qtd >= cota) FROM presentes),
    'votos_populares', (SELECT coalesce(sum(qtd), 0) FROM votos),
    'projetos_votados', (SELECT count(*) FROM votos),
    'votantes_credenciados', (SELECT count(*) FROM public.avaliadores_evento ae
                              JOIN ev ON ev.id_evento = ae.id_evento
                              JOIN public.questionarios q ON q.id_questionario = ae.id_questionario
                              WHERE ae.is_credenciado AND q.is_voto_popular)
  );
$$;


ALTER FUNCTION "public"."fn_telao_resumo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_vagas_projeto"("p_id_projeto" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_vagas_projeto"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_validar_dados_questionario"("p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_titulo text := btrim(regexp_replace(coalesce(p_titulo, ''), '\s+', ' ', 'g'));
BEGIN
  IF length(v_titulo) < 3 OR length(v_titulo) > 255 THEN
    RAISE EXCEPTION 'Informe o título do questionário (3 a 255 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF p_escala_minima IS NULL OR p_escala_maxima IS NULL OR p_escala_minima < 0 OR p_escala_maxima > 100
     OR p_escala_minima >= p_escala_maxima THEN
    RAISE EXCEPTION 'Escala inválida: a mínima precisa ser menor que a máxima (entre 0 e 100).' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_perguntas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_perguntas) = 0 THEN
    RAISE EXCEPTION 'O questionário precisa de pelo menos uma pergunta.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_perguntas) e WHERE btrim(coalesce(e->>'texto_pergunta', '')) = '') THEN
    RAISE EXCEPTION 'Preencha o texto de todas as perguntas.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_perguntas) e
             WHERE coalesce((e->>'peso_calculo')::numeric, 1) <= 0 OR coalesce((e->>'peso_desempate')::numeric, 1) < 0) THEN
    RAISE EXCEPTION 'Os pesos precisam ser positivos.' USING ERRCODE = '22023';
  END IF;
  RETURN v_titulo;
END;
$$;


ALTER FUNCTION "public"."fn_validar_dados_questionario"("p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_validar_respostas"("p_id_questionario" "uuid", "p_respostas" "jsonb") RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_validar_respostas"("p_id_questionario" "uuid", "p_respostas" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_validar_respostas"("p_id_questionario" "uuid", "p_respostas" "jsonb") IS 'Valida o conjunto de respostas e devolve a média ponderada pelo peso_calculo. Mesma regra de fn_enviar_avaliacao.';



CREATE OR REPLACE FUNCTION "public"."fn_vincular_com_codigo"("p_email" "text", "p_codigo" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_evento     public.eventos;
  v_usuario    public.usuarios;
  v_cod        public.codigos_acesso;
  v_erro_padrao constant text := 'E-mail ou código inválido, expirado ou já utilizado.';
  -- Hash de um código que não existe: a resposta leva o mesmo tempo com ou sem código ativo
  -- (sem isso, a demora do bcrypt revelava quais e-mails são de avaliadores com código pendente)
  v_hash_falso  constant text := '$2a$08$ie/XW71pyb9bnxcEXTtuY.As1yr3hdoN6v.lALJZUc8swDbePZkOS';
BEGIN
  PERFORM public.auditoria_marcar_origem('fn_vincular_com_codigo');
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sessão do aparelho não iniciada.');
  END IF;
  IF public.sessao_de_conta_da_equipe() THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Este navegador está logado como Admin ou Staff. Saia dessa conta para vincular o celular do avaliador.');
  END IF;
  v_evento := public.parametros_acesso(NULL);
  IF v_evento.metodos_vinculo NOT IN ('ambos', 'codigo') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Código de acesso desativado neste evento. Procure o Staff para parear o aparelho.');
  END IF;

  SELECT * INTO v_usuario FROM public.usuarios
  WHERE lower(email) = lower(trim(p_email)) AND upper(papel::text) = 'AVALIADOR'
  LIMIT 1;
  IF v_usuario.id_usuario IS NULL THEN
    PERFORM extensions.crypt(public.normalizar_codigo(p_codigo), v_hash_falso);
    RETURN jsonb_build_object('ok', false, 'erro', v_erro_padrao);
  END IF;

  SELECT * INTO v_cod FROM public.codigos_acesso
  WHERE id_usuario = v_usuario.id_usuario
    AND usado_em IS NULL
    AND expira_em > now()
    AND tentativas < max_tentativas
  ORDER BY criado_em DESC
  LIMIT 1
  FOR UPDATE;
  IF v_cod.id IS NULL THEN
    PERFORM extensions.crypt(public.normalizar_codigo(p_codigo), v_hash_falso);
    RETURN jsonb_build_object('ok', false, 'erro', v_erro_padrao);
  END IF;

  IF extensions.crypt(public.normalizar_codigo(p_codigo), v_cod.codigo_hash) <> v_cod.codigo_hash THEN
    UPDATE public.codigos_acesso
    SET tentativas = tentativas + 1,
        usado_em = CASE WHEN tentativas + 1 >= max_tentativas THEN now() ELSE NULL END
    WHERE id = v_cod.id;
    RETURN jsonb_build_object('ok', false, 'erro', v_erro_padrao);
  END IF;

  UPDATE public.codigos_acesso SET usado_em = now() WHERE id = v_cod.id;
  UPDATE public.dispositivos_avaliador SET revogado_em = now()
  WHERE id_usuario = v_usuario.id_usuario AND revogado_em IS NULL AND auth_uid <> auth.uid();
  INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo, vinculado_por)
  VALUES (auth.uid(), v_usuario.id_usuario, v_cod.id_evento, 'codigo', v_cod.gerado_por)
  ON CONFLICT (auth_uid) DO UPDATE
    SET id_usuario = EXCLUDED.id_usuario, id_evento = EXCLUDED.id_evento, metodo = 'codigo',
        vinculado_por = EXCLUDED.vinculado_por, vinculado_em = now(), revogado_em = NULL;

  RETURN jsonb_build_object('ok', true, 'id_usuario', v_usuario.id_usuario, 'nome', v_usuario.nome);
END;
$_$;


ALTER FUNCTION "public"."fn_vincular_com_codigo"("p_email" "text", "p_codigo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_vincular_conta_staff"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_email text;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login com e-mail e senha.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(email) INTO v_email FROM auth.users
  WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL AND coalesce(is_anonymous, false) = false;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Conta sem e-mail confirmado.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.usuarios SET id_auth = auth.uid()
  WHERE lower(email) = v_email
    AND upper(papel::text) IN ('STAFF', 'MONITOR')
    AND (id_auth IS NULL OR id_auth = auth.uid())
  RETURNING id_usuario INTO v_id;

  RETURN jsonb_build_object('ok', v_id IS NOT NULL OR public.is_staff(), 'papel', CASE WHEN public.is_staff() THEN 'staff' END);
END;
$$;


ALTER FUNCTION "public"."fn_vincular_conta_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gerar_codigo_curto"("p_tamanho" integer) RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
  v_n        constant integer := 29;
  v_codigo   text := '';
  v_byte     integer;
BEGIN
  WHILE length(v_codigo) < p_tamanho LOOP
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    IF v_byte < 232 THEN  -- 232 = 29 * 8
      v_codigo := v_codigo || substr(v_alfabeto, (v_byte % v_n) + 1, 1);
    END IF;
  END LOOP;
  RETURN v_codigo;
END;
$$;


ALTER FUNCTION "public"."gerar_codigo_curto"("p_tamanho" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE (u.id_usuario = auth.uid() OR u.id_auth = auth.uid())
      AND upper(u.papel::text) = 'ADMIN'
  )
  -- Com o MFA exigido, só a sessão que passou pelo segundo fator é Admin
  AND (
    NOT coalesce((SELECT c.exigir_mfa_admin FROM public.configuracoes_seguranca c WHERE c.id), false)
    OR coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE (u.id_usuario = auth.uid() OR u.id_auth = auth.uid())
      AND upper(u.papel::text) IN ('STAFF', 'MONITOR')
  );
$$;


ALTER FUNCTION "public"."is_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalizar_codigo"("p_codigo" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
$$;


ALTER FUNCTION "public"."normalizar_codigo"("p_codigo" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."eventos" (
    "id_evento" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome_evento" character varying(255) NOT NULL,
    "edicao" character varying(100),
    "descricao" "text",
    "logo_url" "text",
    "is_ativo" boolean DEFAULT true,
    "minutos_timeout_lock" integer DEFAULT 30,
    "cota_avaliacoes_padrao" integer DEFAULT 3,
    "limite_corte" numeric(5,2) DEFAULT 0.00,
    "sistema_liberado" boolean DEFAULT true,
    "horario_inicio" time without time zone,
    "horario_fim" time without time zone,
    "intervalo_pausa_avaliador" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "data_evento" "date" DEFAULT CURRENT_DATE,
    "data_inicio" "date" DEFAULT CURRENT_DATE,
    "data_fim" "date" DEFAULT CURRENT_DATE,
    "minutos_validade_pareamento" integer DEFAULT 10 NOT NULL,
    "minutos_validade_codigo_acesso" integer DEFAULT 15 NOT NULL,
    "tamanho_codigo" integer DEFAULT 6 NOT NULL,
    "max_tentativas_codigo" integer DEFAULT 5 NOT NULL,
    "metodos_vinculo" "text" DEFAULT 'pareamento'::"text" NOT NULL,
    "url_icone" "text",
    "url_imagem_evento" "text",
    "fixar_questionario_primeira_avaliacao" boolean DEFAULT true NOT NULL,
    CONSTRAINT "ck_eventos_max_tentativas_codigo" CHECK ((("max_tentativas_codigo" >= 1) AND ("max_tentativas_codigo" <= 10))),
    CONSTRAINT "ck_eventos_metodos_vinculo" CHECK (("metodos_vinculo" = ANY (ARRAY['ambos'::"text", 'pareamento'::"text", 'codigo'::"text"]))),
    CONSTRAINT "ck_eventos_minutos_validade_codigo_acesso" CHECK ((("minutos_validade_codigo_acesso" >= 1) AND ("minutos_validade_codigo_acesso" <= 120))),
    CONSTRAINT "ck_eventos_minutos_validade_pareamento" CHECK ((("minutos_validade_pareamento" >= 1) AND ("minutos_validade_pareamento" <= 60))),
    CONSTRAINT "ck_eventos_tamanho_codigo" CHECK ((("tamanho_codigo" >= 6) AND ("tamanho_codigo" <= 10)))
);


ALTER TABLE "public"."eventos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."eventos"."sistema_liberado" IS 'Controle booleano que permite ou pausa o sorteio de avaliações';



COMMENT ON COLUMN "public"."eventos"."horario_inicio" IS 'Horário de início das avaliações do evento (TIME)';



COMMENT ON COLUMN "public"."eventos"."horario_fim" IS 'Horário de término das avaliações do evento (TIME)';



COMMENT ON COLUMN "public"."eventos"."data_evento" IS 'Data oficial de realização do evento (DATE)';



COMMENT ON COLUMN "public"."eventos"."metodos_vinculo" IS 'Forma de vincular o celular do avaliador: ''pareamento'' (padrão, o Staff digita o código mostrado no celular) ou ''codigo'' (o Staff gera um código de uso único). ''ambos'' é legado e não é mais oferecido na interface.';



COMMENT ON COLUMN "public"."eventos"."url_icone" IS 'URL pública do ícone do evento (bucket identidade-visual). Substitui o "IF" do cabeçalho e serve de favicon.';



COMMENT ON COLUMN "public"."eventos"."url_imagem_evento" IS 'URL pública da imagem do evento (bucket identidade-visual): login, autocadastro, Telão, relatórios e topo da tela do avaliador.';



COMMENT ON COLUMN "public"."eventos"."fixar_questionario_primeira_avaliacao" IS 'Ligada (padrão): a primeira avaliação fixa o questionário do projeto (projetos.id_questionario_fixado) e os demais avaliadores ficam presos a ele. Desligada: cada avaliador escolhe o questionário e nada é fixado.';



CREATE OR REPLACE FUNCTION "public"."parametros_acesso"("p_id_evento" "uuid") RETURNS "public"."eventos"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT e.* FROM public.eventos e WHERE e.id_evento = coalesce(p_id_evento, public.evento_ativo_id());
$$;


ALTER FUNCTION "public"."parametros_acesso"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."questionario_do_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT ae.id_questionario
  FROM public.avaliadores_evento ae
  WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = p_id_evento;
$$;


ALTER FUNCTION "public"."questionario_do_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."questionario_do_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid") IS 'Questionário vinculado ao avaliador no evento, ou NULL quando ele usa o questionário do projeto.';



CREATE OR REPLACE FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") IS 'Restaura avaliação cancelada se a cota permitir, com motivo opcional na trilha. Só Admin.';



CREATE OR REPLACE FUNCTION "public"."sessao_de_conta_da_equipe"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.conta_da_equipe(auth.uid());
$$;


ALTER FUNCTION "public"."sessao_de_conta_da_equipe"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sortear_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN public.sortear_proximo_projeto(p_id_usuario, p_id_evento);
END;
$$;


ALTER FUNCTION "public"."sortear_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sortear_proximo_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."sortear_proximo_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_instituicoes_normalizar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Só as pontas: Projetos/Avaliadores comparam sem colapsar espaços internos
  NEW.nome_exibicao := public.fn_aparar_texto(NEW.nome_exibicao);
  NEW.nome_normalizado := public.fn_normalizar_nome(NEW.nome_exibicao);
  NEW.sigla := nullif(upper(public.fn_aparar_texto(NEW.sigla)), '');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_instituicoes_normalizar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_avaliador_do_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    JOIN public.avaliadores_evento ae ON ae.id_usuario = u.id_usuario AND ae.id_evento = p_id_evento
    WHERE u.id_usuario = p_id_usuario AND upper(u.papel::text) = 'AVALIADOR'
  ) THEN
    RAISE EXCEPTION 'Avaliador não encontrado neste evento.';
  END IF;
END;
$$;


ALTER FUNCTION "public"."validar_avaliador_do_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."areas_tematicas" (
    "id_area" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome_area" character varying(150) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "id_evento" "uuid"
);


ALTER TABLE "public"."areas_tematicas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."avaliacoes" (
    "id_avaliacao" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_projeto" "uuid" NOT NULL,
    "id_usuario" "uuid" NOT NULL,
    "id_questionario" "uuid",
    "nota_final" numeric(5,2),
    "parecer_final" "text",
    "tempo_presenca" character varying(50),
    "is_quarentena" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "status" character varying(30) DEFAULT 'CONCLUIDA'::character varying,
    "status_avaliacao" character varying(30) DEFAULT 'concluida'::character varying,
    "tempo_submissao" timestamp with time zone DEFAULT "now"(),
    "cancelada_em" timestamp with time zone,
    "cancelada_por" "uuid",
    "ajuste_tipo" "text",
    "ajustada_em" timestamp with time zone,
    "ajustada_por" "uuid",
    "ajuste_motivo" "text",
    "is_voto_popular" boolean DEFAULT false NOT NULL,
    CONSTRAINT "ck_avaliacoes_ajuste_tipo" CHECK ((("ajuste_tipo" IS NULL) OR ("ajuste_tipo" = ANY (ARRAY['respostas_corrigidas'::"text", 'nota_arbitrada'::"text", 'lancada_pelo_admin'::"text"]))))
);


ALTER TABLE "public"."avaliacoes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."avaliacoes"."cancelada_em" IS 'Quando o Admin cancelou a avaliação (soft delete). NULL se ativa.';



COMMENT ON COLUMN "public"."avaliacoes"."cancelada_por" IS 'Admin (usuarios.id_usuario) que cancelou a avaliação. Sem FK de propósito (embed do PostgREST).';



COMMENT ON COLUMN "public"."avaliacoes"."ajuste_tipo" IS 'Marca de ajuste manual do Admin: respostas_corrigidas, nota_arbitrada ou lancada_pelo_admin. NULL = avaliação enviada pelo avaliador.';



COMMENT ON COLUMN "public"."avaliacoes"."ajustada_por" IS 'Admin (usuarios.id_usuario) que fez o ajuste. Sem FK de propósito, como cancelada_por.';



COMMENT ON COLUMN "public"."avaliacoes"."is_voto_popular" IS 'Cópia de questionarios.is_voto_popular no momento da nota, mantida por trigger. Congela a classificação: média já publicada não muda se a marca do questionário for alterada.';



CREATE TABLE IF NOT EXISTS "public"."avaliador_areas" (
    "id_usuario" "uuid" NOT NULL,
    "id_evento" "uuid" NOT NULL,
    "id_area" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."avaliador_areas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."avaliador_modalidades_bloqueadas" (
    "id_usuario" "uuid" NOT NULL,
    "id_evento" "uuid" NOT NULL,
    "id_modalidade" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."avaliador_modalidades_bloqueadas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."avaliadores_evento" (
    "id_usuario" "uuid" NOT NULL,
    "id_evento" "uuid" NOT NULL,
    "id_instituicao" "uuid",
    "is_credenciado" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "id_questionario" "uuid"
);


ALTER TABLE "public"."avaliadores_evento" OWNER TO "postgres";


COMMENT ON COLUMN "public"."avaliadores_evento"."id_questionario" IS 'Questionário fixo deste avaliador no evento. Vazio: usa o questionário técnico do projeto. Apontando para um questionário de voto popular, o avaliador é um votante.';



CREATE TABLE IF NOT EXISTS "public"."codigos_acesso" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_usuario" "uuid" NOT NULL,
    "id_evento" "uuid",
    "codigo_hash" "text" NOT NULL,
    "gerado_por" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expira_em" timestamp with time zone NOT NULL,
    "usado_em" timestamp with time zone,
    "tentativas" integer DEFAULT 0 NOT NULL,
    "max_tentativas" integer NOT NULL
);


ALTER TABLE "public"."codigos_acesso" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracoes_seguranca" (
    "id" boolean DEFAULT true NOT NULL,
    "exigir_mfa_admin" boolean DEFAULT false NOT NULL,
    "minutos_inatividade_sessao" integer DEFAULT 0 NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_por" "uuid",
    CONSTRAINT "configuracoes_seguranca_id_check" CHECK ("id"),
    CONSTRAINT "configuracoes_seguranca_minutos_inatividade_sessao_check" CHECK ((("minutos_inatividade_sessao" = 0) OR (("minutos_inatividade_sessao" >= 5) AND ("minutos_inatividade_sessao" <= 720))))
);


ALTER TABLE "public"."configuracoes_seguranca" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dispositivos_avaliador" (
    "auth_uid" "uuid" NOT NULL,
    "id_usuario" "uuid" NOT NULL,
    "id_evento" "uuid",
    "metodo" "text" NOT NULL,
    "vinculado_por" "uuid",
    "vinculado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revogado_em" timestamp with time zone,
    CONSTRAINT "dispositivos_avaliador_metodo_check" CHECK (("metodo" = ANY (ARRAY['pareamento'::"text", 'codigo'::"text"])))
);


ALTER TABLE "public"."dispositivos_avaliador" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fila_atribuicoes_direcionadas" (
    "id_atribuicao" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_usuario" "uuid" NOT NULL,
    "id_projeto" "uuid" NOT NULL,
    "ordem" integer DEFAULT 1 NOT NULL,
    "status" character varying(30) DEFAULT 'pendente'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fila_atribuicoes_direcionadas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."historico_impedimentos" (
    "id_usuario" "uuid" NOT NULL,
    "id_projeto" "uuid" NOT NULL,
    "tipo" character varying(50) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."historico_impedimentos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."instituicao_aliases" (
    "id_alias" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_instituicao" "uuid" NOT NULL,
    "alias" character varying(255) NOT NULL,
    "alias_normalizado" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."instituicao_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."instituicoes" (
    "id_instituicao" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome_exibicao" character varying(255) NOT NULL,
    "nome_normalizado" character varying(255) NOT NULL,
    "sigla" character varying(50),
    "campus" character varying(150),
    "cidade" character varying(150),
    "estado" character varying(2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "id_evento" "uuid"
);


ALTER TABLE "public"."instituicoes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locks_ativos" (
    "id_lock" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_usuario" "uuid" NOT NULL,
    "id_projeto" "uuid" NOT NULL,
    "bloqueado_em" timestamp with time zone DEFAULT "now"(),
    "expira_em" timestamp with time zone NOT NULL,
    "atribuido_por" "uuid",
    "is_voto_popular" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."locks_ativos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."locks_ativos"."atribuido_por" IS 'Admin (usuarios.id_usuario) que atribuiu o projeto. Sem FK de propósito: uma 2ª FK para usuarios quebra o embed usuarios(...) do PostgREST. NULL = trava do sorteio.';



COMMENT ON COLUMN "public"."locks_ativos"."is_voto_popular" IS 'A reserva é de um votante do voto popular. O sorteio técnico a desconsidera (um votante no estande não impede o avaliador técnico, e vice-versa).';



CREATE TABLE IF NOT EXISTS "public"."log_auditoria" (
    "id_log" bigint NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id_evento" "uuid",
    "tabela" "text" NOT NULL,
    "operacao" "text" NOT NULL,
    "acao" "text" NOT NULL,
    "id_registro" "text",
    "id_projeto" "uuid",
    "id_avaliacao" "uuid",
    "ator_auth" "uuid",
    "ator_usuario" "uuid",
    "ator_papel" "text",
    "origem" "text" NOT NULL,
    "motivo" "text",
    "dados_antes" "jsonb",
    "dados_depois" "jsonb",
    "campos_alterados" "text"[],
    CONSTRAINT "log_auditoria_operacao_check" CHECK (("operacao" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text", 'EVENTO'::"text"])))
);


ALTER TABLE "public"."log_auditoria" OWNER TO "postgres";


COMMENT ON TABLE "public"."log_auditoria" IS 'Trilha de auditoria append-only. Preenchida por trigger, inclusive quando a escrita vem direto da API REST. Sobrevive ao reset global.';



COMMENT ON COLUMN "public"."log_auditoria"."operacao" IS 'INSERT/UPDATE/DELETE da trigger, ou EVENTO para registro feito por RPC (reset global, por exemplo).';



COMMENT ON COLUMN "public"."log_auditoria"."acao" IS 'Rótulo semântico estável (nota_alterada, credenciamento_concedido, check_in_realizado...). A interface traduz para português.';



COMMENT ON COLUMN "public"."log_auditoria"."origem" IS 'Nome da RPC que se identificou por auditoria_marcar_origem(), ou ''direto'' quando a escrita não passou por função nenhuma.';



ALTER TABLE "public"."log_auditoria" ALTER COLUMN "id_log" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."log_auditoria_id_log_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."modalidade_aliases" (
    "id_alias" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_modalidade" "uuid" NOT NULL,
    "alias" character varying(255) NOT NULL,
    "alias_normalizado" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."modalidade_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modalidades" (
    "id_modalidade" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome_modalidade" character varying(150) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "codigo" character varying(50),
    "nivel" character varying(100),
    "area_tematica" character varying(150),
    "descricao" "text",
    "id_evento" "uuid"
);


ALTER TABLE "public"."modalidades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modelos_questionario" (
    "id_modelo" "uuid" NOT NULL,
    "codigo" "text" NOT NULL,
    "titulo" character varying(255) NOT NULL,
    "descricao" "text",
    "escala_minima" numeric(5,2) DEFAULT 1 NOT NULL,
    "escala_maxima" numeric(5,2) DEFAULT 5 NOT NULL,
    "ordem" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_original" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."modelos_questionario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pareamentos_pendentes" (
    "codigo" "text" NOT NULL,
    "auth_uid" "uuid" NOT NULL,
    "id_evento" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expira_em" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."pareamentos_pendentes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perguntas_modelo_questionario" (
    "id_modelo" "uuid" NOT NULL,
    "ordem" integer NOT NULL,
    "texto_pergunta" "text" NOT NULL,
    "descricao_lembrete" "text",
    "peso_calculo" numeric(5,2) DEFAULT 1 NOT NULL,
    "peso_desempate" numeric(5,2) DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."perguntas_modelo_questionario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perguntas_questionario" (
    "id_pergunta" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_questionario" "uuid",
    "ordem" integer DEFAULT 1,
    "texto_pergunta" "text" NOT NULL,
    "peso_calculo" numeric(5,2) DEFAULT 1.00,
    "peso_desempate" numeric(5,2) DEFAULT 1.00,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "descricao_lembrete" "text"
);


ALTER TABLE "public"."perguntas_questionario" OWNER TO "postgres";


COMMENT ON COLUMN "public"."perguntas_questionario"."descricao_lembrete" IS 'Texto de ajuda mostrado ao avaliador abaixo do critério (opcional).';



CREATE TABLE IF NOT EXISTS "public"."projetos" (
    "id_projeto" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo_projeto" character varying(50),
    "codigo_legado" character varying(50),
    "id_evento" "uuid",
    "id_instituicao" "uuid",
    "id_area" "uuid",
    "id_modalidade" "uuid",
    "id_questionario_fixado" "uuid",
    "titulo" "text" NOT NULL,
    "estande" character varying(50),
    "corredor" character varying(50),
    "expositores" "text",
    "cota_avaliacoes_customizada" integer,
    "contagem_ausencia" integer DEFAULT 0,
    "is_check_in_realizado" boolean DEFAULT false,
    "is_fora_da_competicao" boolean DEFAULT false,
    "forcar_topo_fila" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "quarentena_resolvida_em" timestamp with time zone,
    "quarentena_resolvida_por" "uuid",
    "ajuste_media" numeric(5,2) DEFAULT 0 NOT NULL,
    "ajuste_media_em" timestamp with time zone,
    "ajuste_media_por" "uuid",
    "ajuste_media_motivo" "text"
);


ALTER TABLE "public"."projetos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."projetos"."quarentena_resolvida_em" IS 'Quando o Admin aceitou a divergência de notas. Avaliação nova depois disso reabre a quarentena.';



COMMENT ON COLUMN "public"."projetos"."quarentena_resolvida_por" IS 'Admin (usuarios.id_usuario) que resolveu a quarentena. Sem FK de propósito (embed do PostgREST).';



COMMENT ON COLUMN "public"."projetos"."ajuste_media" IS 'Bónus (positivo) ou penalidade (negativo) de comissão somado à média do projeto. 0 = sem ajuste. media_final = media_geral + ajuste_media.';



CREATE TABLE IF NOT EXISTS "public"."questionarios" (
    "id_questionario" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_evento" "uuid",
    "titulo" character varying(255) NOT NULL,
    "escala_minima" numeric(5,2) DEFAULT 0.00,
    "escala_maxima" numeric(5,2) DEFAULT 10.00,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "id_origem" "uuid",
    "is_voto_popular" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."questionarios" OWNER TO "postgres";


COMMENT ON COLUMN "public"."questionarios"."id_origem" IS 'Modelo (modelos_questionario) ou questionário de outro evento de onde esta cópia veio.';



COMMENT ON COLUMN "public"."questionarios"."is_voto_popular" IS 'Questionário de voto popular: as notas dadas por ele não entram na média técnica, na cota, na quarentena, no ranking técnico nem na meta do Telão. Não pode ser alterada depois de o questionário ter avaliação.';



CREATE TABLE IF NOT EXISTS "public"."registro_autocadastro" (
    "id" bigint NOT NULL,
    "id_evento" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "criou_instituicao" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."registro_autocadastro" OWNER TO "postgres";


ALTER TABLE "public"."registro_autocadastro" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."registro_autocadastro_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."respostas_avaliacao" (
    "id_resposta" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_avaliacao" "uuid" NOT NULL,
    "id_pergunta" "uuid" NOT NULL,
    "nota_atribuida" numeric(5,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."respostas_avaliacao" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id_usuario" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" character varying(255) NOT NULL,
    "nome" character varying(255) NOT NULL,
    "papel" character varying(50) DEFAULT 'AVALIADOR'::character varying,
    "cpf" character varying(14),
    "celular" character varying(20),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "id_auth" "uuid"
);


ALTER TABLE "public"."usuarios" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_avaliadores_credenciados" WITH ("security_invoker"='true') AS
 SELECT "u"."id_usuario",
    "u"."nome",
    "u"."email",
    "ae"."is_credenciado"
   FROM ("public"."usuarios" "u"
     JOIN "public"."avaliadores_evento" "ae" ON (("ae"."id_usuario" = "u"."id_usuario")))
  WHERE ("ae"."is_credenciado" = true);


ALTER VIEW "public"."view_avaliadores_credenciados" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_projetos_pendentes_avaliacao" WITH ("security_invoker"='true') AS
 SELECT "p"."id_projeto",
    "p"."codigo_projeto",
    "p"."titulo",
    "p"."estande",
    "p"."corredor",
    COALESCE("m"."nome_modalidade", 'Geral'::character varying) AS "modalidade",
    "p"."id_instituicao",
    COALESCE("inst"."nome_exibicao", 'Não informada'::character varying) AS "nome_instituicao",
    "p"."id_evento",
    "count"("a"."id_avaliacao") FILTER (WHERE (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text"))) AS "total_avaliacoes"
   FROM (((("public"."projetos" "p"
     LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
     LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
     LEFT JOIN "public"."instituicoes" "inst" ON (("inst"."id_instituicao" = "p"."id_instituicao")))
     LEFT JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (NOT "a"."is_voto_popular"))))
  WHERE ((COALESCE("p"."is_check_in_realizado", true) = true) AND (COALESCE("p"."is_fora_da_competicao", false) = false))
  GROUP BY "p"."id_projeto", "p"."codigo_projeto", "p"."titulo", "p"."estande", "p"."corredor", "m"."nome_modalidade", "p"."id_instituicao", "inst"."nome_exibicao", "p"."id_evento"
 HAVING ("count"("a"."id_avaliacao") FILTER (WHERE (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text"))) < 3);


ALTER VIEW "public"."view_projetos_pendentes_avaliacao" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_projetos_quarentena" WITH ("security_invoker"='true') AS
 SELECT "p"."id_projeto",
    "p"."codigo_projeto",
    "p"."titulo",
    "p"."estande",
    "p"."corredor",
    COALESCE("m"."nome_modalidade", 'Geral'::character varying) AS "modalidade",
    COALESCE("ar"."nome_area", 'Multidisciplinar'::character varying) AS "area_tematica",
    COALESCE("inst"."nome_exibicao", 'Não informada'::character varying) AS "nome_instituicao",
    "p"."id_evento",
    "count"("a"."id_avaliacao") AS "total_avaliacoes",
    "round"("min"("a"."nota_final"), 2) AS "nota_minima",
    "round"("max"("a"."nota_final"), 2) AS "nota_maxima",
    "round"(("max"("a"."nota_final") - "min"("a"."nota_final")), 2) AS "diferenca_notas",
    "bool_or"(COALESCE("a"."is_quarentena", false)) AS "tem_flag_quarentena",
    "p"."quarentena_resolvida_em",
    "max"("a"."created_at") AS "ultima_avaliacao_em"
   FROM (((("public"."projetos" "p"
     LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
     LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
     LEFT JOIN "public"."instituicoes" "inst" ON (("inst"."id_instituicao" = "p"."id_instituicao")))
     LEFT JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")) AND (NOT "a"."is_voto_popular"))))
  GROUP BY "p"."id_projeto", "p"."codigo_projeto", "p"."titulo", "p"."estande", "p"."corredor", "m"."nome_modalidade", "ar"."nome_area", "inst"."nome_exibicao", "p"."id_evento", "p"."quarentena_resolvida_em"
 HAVING ("bool_or"(COALESCE("a"."is_quarentena", false)) OR (("count"("a"."id_avaliacao") >= 2) AND (("max"("a"."nota_final") - "min"("a"."nota_final")) > 2.5) AND (("p"."quarentena_resolvida_em" IS NULL) OR ("max"("a"."created_at") > "p"."quarentena_resolvida_em"))));


ALTER VIEW "public"."view_projetos_quarentena" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_ranking_top3" WITH ("security_invoker"='true') AS
 WITH "base" AS (
         SELECT "p"."id_projeto",
            "p"."codigo_projeto",
            "p"."titulo",
            "p"."estande",
            "p"."corredor",
            COALESCE("m"."nome_modalidade", 'Sem modalidade'::character varying) AS "modalidade",
            COALESCE("ar"."nome_area", 'Sem área temática'::character varying) AS "area_tematica",
            COALESCE("inst"."nome_exibicao", 'Não informada'::character varying) AS "nome_instituicao",
            COALESCE("array_agg"("round"(("a"."nota_final")::numeric, 2) ORDER BY "a"."tempo_submissao", "a"."created_at") FILTER (WHERE ("a"."nota_final" IS NOT NULL)), '{}'::numeric[]) AS "notas",
            COALESCE("round"("avg"("a"."nota_final"), 2), 0.00) AS "media_geral",
            COALESCE("p"."ajuste_media", (0)::numeric) AS "ajuste_media",
            (COALESCE("round"("avg"("a"."nota_final"), 2), 0.00) + COALESCE("p"."ajuste_media", (0)::numeric)) AS "media_final",
            "count"("a"."id_avaliacao") AS "total_avaliacoes",
            "p"."id_evento"
           FROM (((("public"."projetos" "p"
             LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
             LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
             LEFT JOIN "public"."instituicoes" "inst" ON (("inst"."id_instituicao" = "p"."id_instituicao")))
             JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")) AND (NOT "a"."is_voto_popular"))))
          WHERE (NOT COALESCE("p"."is_fora_da_competicao", false))
          GROUP BY "p"."id_projeto", "p"."codigo_projeto", "p"."titulo", "p"."estande", "p"."corredor", "m"."nome_modalidade", "ar"."nome_area", "inst"."nome_exibicao", "p"."id_evento", "p"."ajuste_media"
        ), "com_chave" AS (
         SELECT "b_1"."id_projeto",
            "b_1"."codigo_projeto",
            "b_1"."titulo",
            "b_1"."estande",
            "b_1"."corredor",
            "b_1"."modalidade",
            "b_1"."area_tematica",
            "b_1"."nome_instituicao",
            "b_1"."notas",
            "b_1"."media_geral",
            "b_1"."ajuste_media",
            "b_1"."media_final",
            "b_1"."total_avaliacoes",
            "b_1"."id_evento",
            "public"."fn_chave_desempate"("b_1"."id_projeto") AS "chave_desempate"
           FROM "base" "b_1"
        )
 SELECT "id_projeto",
    "codigo_projeto",
    "titulo",
    "estande",
    "corredor",
    "modalidade",
    "area_tematica",
    "nome_instituicao",
    "notas",
    "media_geral",
    "total_avaliacoes",
    "id_evento",
    "rank"() OVER (PARTITION BY "id_evento", "modalidade", "area_tematica" ORDER BY "media_final" DESC, "chave_desempate" DESC) AS "posicao",
    (EXISTS ( SELECT 1
           FROM "public"."view_projetos_quarentena" "q"
          WHERE ("q"."id_projeto" = "b"."id_projeto"))) AS "em_quarentena",
    "chave_desempate",
    "ajuste_media",
    "media_final"
   FROM "com_chave" "b"
  ORDER BY "media_final" DESC, "codigo_projeto";


ALTER VIEW "public"."view_ranking_top3" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_relatorio_admin" WITH ("security_invoker"='true') AS
 SELECT "p"."id_projeto",
    "p"."codigo_projeto",
    "p"."titulo",
    "p"."estande",
    "p"."corredor",
    COALESCE("round"("avg"("a"."nota_final"), 2), 0.00) AS "media_notas"
   FROM ("public"."projetos" "p"
     LEFT JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")))))
  GROUP BY "p"."id_projeto", "p"."codigo_projeto", "p"."titulo", "p"."estande", "p"."corredor";


ALTER VIEW "public"."view_relatorio_admin" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_relatorio_ausencias" WITH ("security_invoker"='true') AS
 SELECT "hi"."id_usuario",
    "hi"."id_projeto",
    "hi"."tipo",
    "hi"."created_at" AS "data_ausencia",
    "u"."nome" AS "avaliador_nome",
    "u"."email" AS "avaliador_email",
    "p"."id_evento",
    "p"."codigo_projeto",
    "p"."titulo" AS "projeto_titulo",
    "p"."estande" AS "projeto_estande",
    "m"."nome_modalidade" AS "projeto_modalidade",
    "ar"."nome_area" AS "projeto_area",
    "inst"."nome_exibicao" AS "projeto_instituicao",
    ( SELECT "count"(*) AS "count"
           FROM "public"."avaliacoes" "av"
          WHERE (("av"."id_projeto" = "p"."id_projeto") AND (("av"."status" IS NULL) OR (("av"."status")::"text" <> 'CANCELADA'::"text")))) AS "total_avaliacoes_atuais"
   FROM ((((("public"."historico_impedimentos" "hi"
     JOIN "public"."usuarios" "u" ON (("u"."id_usuario" = "hi"."id_usuario")))
     JOIN "public"."projetos" "p" ON (("p"."id_projeto" = "hi"."id_projeto")))
     LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
     LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
     LEFT JOIN "public"."instituicoes" "inst" ON (("inst"."id_instituicao" = "p"."id_instituicao")))
  WHERE (("hi"."tipo")::"text" = 'ausencia'::"text")
  ORDER BY "hi"."created_at" DESC;


ALTER VIEW "public"."view_relatorio_ausencias" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_relatorio_avaliadores" WITH ("security_invoker"='true') AS
 SELECT "a"."id_avaliacao",
    "u"."id_usuario",
    "u"."nome" AS "avaliador_nome",
    "u"."email" AS "avaliador_email",
    "p"."id_projeto",
    "p"."id_evento",
    "p"."codigo_projeto",
    "p"."titulo" AS "projeto_titulo",
    "p"."estande" AS "projeto_estande",
    "m"."nome_modalidade" AS "projeto_modalidade",
    "ar"."nome_area" AS "projeto_area",
    "a"."nota_final",
    COALESCE("a"."parecer_final", ''::"text") AS "parecer_comentario",
    "a"."parecer_final",
    "a"."tempo_presenca",
    "a"."tempo_submissao",
    "a"."created_at" AS "data_avaliacao",
    "a"."status"
   FROM (((("public"."avaliacoes" "a"
     JOIN "public"."usuarios" "u" ON (("u"."id_usuario" = "a"."id_usuario")))
     JOIN "public"."projetos" "p" ON (("p"."id_projeto" = "a"."id_projeto")))
     LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
     LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
  WHERE (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text"))
  ORDER BY "u"."nome", "a"."created_at" DESC;


ALTER VIEW "public"."view_relatorio_avaliadores" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_relatorio_projetos" WITH ("security_invoker"='true') AS
 SELECT "p"."id_projeto",
    "p"."id_evento",
    "p"."codigo_projeto",
    "p"."titulo",
    "p"."estande",
    "p"."corredor",
    "m"."nome_modalidade" AS "modalidade",
    "ar"."nome_area" AS "area_conhecimento",
    "inst"."nome_exibicao" AS "nome_instituicao",
    "p"."id_instituicao",
    "p"."id_modalidade",
    "p"."id_area",
    "p"."is_check_in_realizado",
    "p"."is_fora_da_competicao",
    "count"("a"."id_avaliacao") AS "total_avaliacoes",
    COALESCE("round"("avg"("a"."nota_final"), 2), 0.00) AS "media_geral",
    COALESCE("array_agg"("round"(("a"."nota_final")::numeric, 2)) FILTER (WHERE (("a"."nota_final" IS NOT NULL) AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")))), '{}'::numeric[]) AS "notas"
   FROM (((("public"."projetos" "p"
     LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
     LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
     LEFT JOIN "public"."instituicoes" "inst" ON (("inst"."id_instituicao" = "p"."id_instituicao")))
     LEFT JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")))))
  GROUP BY "p"."id_projeto", "p"."id_evento", "p"."codigo_projeto", "p"."titulo", "p"."estande", "p"."corredor", "m"."nome_modalidade", "ar"."nome_area", "inst"."nome_exibicao", "p"."id_instituicao", "p"."id_modalidade", "p"."id_area", "p"."is_check_in_realizado", "p"."is_fora_da_competicao"
  ORDER BY COALESCE("round"("avg"("a"."nota_final"), 2), 0.00) DESC;


ALTER VIEW "public"."view_relatorio_projetos" OWNER TO "postgres";


ALTER TABLE ONLY "public"."areas_tematicas"
    ADD CONSTRAINT "areas_tematicas_pkey" PRIMARY KEY ("id_area");



ALTER TABLE ONLY "public"."avaliacoes"
    ADD CONSTRAINT "avaliacoes_pkey" PRIMARY KEY ("id_avaliacao");



ALTER TABLE ONLY "public"."avaliador_areas"
    ADD CONSTRAINT "avaliador_areas_pkey" PRIMARY KEY ("id_usuario", "id_evento", "id_area");



ALTER TABLE ONLY "public"."avaliador_modalidades_bloqueadas"
    ADD CONSTRAINT "avaliador_modalidades_bloqueadas_pkey" PRIMARY KEY ("id_usuario", "id_evento", "id_modalidade");



ALTER TABLE ONLY "public"."avaliadores_evento"
    ADD CONSTRAINT "avaliadores_evento_pkey" PRIMARY KEY ("id_usuario", "id_evento");



ALTER TABLE ONLY "public"."codigos_acesso"
    ADD CONSTRAINT "codigos_acesso_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracoes_seguranca"
    ADD CONSTRAINT "configuracoes_seguranca_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dispositivos_avaliador"
    ADD CONSTRAINT "dispositivos_avaliador_pkey" PRIMARY KEY ("auth_uid");



ALTER TABLE ONLY "public"."eventos"
    ADD CONSTRAINT "eventos_pkey" PRIMARY KEY ("id_evento");



ALTER TABLE ONLY "public"."fila_atribuicoes_direcionadas"
    ADD CONSTRAINT "fila_atribuicoes_direcionadas_pkey" PRIMARY KEY ("id_atribuicao");



ALTER TABLE ONLY "public"."historico_impedimentos"
    ADD CONSTRAINT "historico_impedimentos_pkey" PRIMARY KEY ("id_usuario", "id_projeto", "tipo", "created_at");



ALTER TABLE ONLY "public"."instituicao_aliases"
    ADD CONSTRAINT "instituicao_aliases_pkey" PRIMARY KEY ("id_alias");



ALTER TABLE ONLY "public"."instituicoes"
    ADD CONSTRAINT "instituicoes_pkey" PRIMARY KEY ("id_instituicao");



ALTER TABLE ONLY "public"."locks_ativos"
    ADD CONSTRAINT "locks_ativos_id_usuario_key" UNIQUE ("id_usuario");



ALTER TABLE ONLY "public"."locks_ativos"
    ADD CONSTRAINT "locks_ativos_pkey" PRIMARY KEY ("id_lock");



ALTER TABLE ONLY "public"."log_auditoria"
    ADD CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id_log");



ALTER TABLE ONLY "public"."modalidade_aliases"
    ADD CONSTRAINT "modalidade_aliases_pkey" PRIMARY KEY ("id_alias");



ALTER TABLE ONLY "public"."modalidades"
    ADD CONSTRAINT "modalidades_pkey" PRIMARY KEY ("id_modalidade");



ALTER TABLE ONLY "public"."modelos_questionario"
    ADD CONSTRAINT "modelos_questionario_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."modelos_questionario"
    ADD CONSTRAINT "modelos_questionario_pkey" PRIMARY KEY ("id_modelo");



ALTER TABLE ONLY "public"."pareamentos_pendentes"
    ADD CONSTRAINT "pareamentos_pendentes_auth_uid_key" UNIQUE ("auth_uid");



ALTER TABLE ONLY "public"."pareamentos_pendentes"
    ADD CONSTRAINT "pareamentos_pendentes_pkey" PRIMARY KEY ("codigo");



ALTER TABLE ONLY "public"."perguntas_modelo_questionario"
    ADD CONSTRAINT "perguntas_modelo_questionario_pkey" PRIMARY KEY ("id_modelo", "ordem");



ALTER TABLE ONLY "public"."perguntas_questionario"
    ADD CONSTRAINT "perguntas_questionario_pkey" PRIMARY KEY ("id_pergunta");



ALTER TABLE ONLY "public"."projetos"
    ADD CONSTRAINT "projetos_pkey" PRIMARY KEY ("id_projeto");



ALTER TABLE ONLY "public"."questionarios"
    ADD CONSTRAINT "questionarios_pkey" PRIMARY KEY ("id_questionario");



ALTER TABLE ONLY "public"."registro_autocadastro"
    ADD CONSTRAINT "registro_autocadastro_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."respostas_avaliacao"
    ADD CONSTRAINT "respostas_avaliacao_pkey" PRIMARY KEY ("id_resposta");



ALTER TABLE ONLY "public"."avaliacoes"
    ADD CONSTRAINT "unica_avaliacao_por_usuario" UNIQUE ("id_projeto", "id_usuario");



ALTER TABLE ONLY "public"."instituicao_aliases"
    ADD CONSTRAINT "uq_instituicao_alias_normalizado" UNIQUE ("id_instituicao", "alias_normalizado");



ALTER TABLE ONLY "public"."modalidade_aliases"
    ADD CONSTRAINT "uq_modalidade_alias_normalizado" UNIQUE ("id_modalidade", "alias_normalizado");



ALTER TABLE ONLY "public"."projetos"
    ADD CONSTRAINT "uq_projetos_evento_codigo" UNIQUE ("id_evento", "codigo_projeto");



COMMENT ON CONSTRAINT "uq_projetos_evento_codigo" ON "public"."projetos" IS 'Chave natural da importação: o código do projeto é único dentro do evento.';



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_auth_key" UNIQUE ("id_auth");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id_usuario");



CREATE INDEX "idx_aa_area" ON "public"."avaliador_areas" USING "btree" ("id_area");



CREATE INDEX "idx_aa_usuario_evento" ON "public"."avaliador_areas" USING "btree" ("id_usuario", "id_evento");



CREATE INDEX "idx_amb_modalidade" ON "public"."avaliador_modalidades_bloqueadas" USING "btree" ("id_modalidade");



CREATE INDEX "idx_amb_usuario_evento" ON "public"."avaliador_modalidades_bloqueadas" USING "btree" ("id_usuario", "id_evento");



CREATE INDEX "idx_areas_tematicas_evento" ON "public"."areas_tematicas" USING "btree" ("id_evento");



CREATE INDEX "idx_avaliacoes_projeto" ON "public"."avaliacoes" USING "btree" ("id_projeto");



CREATE INDEX "idx_avaliacoes_usuario" ON "public"."avaliacoes" USING "btree" ("id_usuario");



CREATE INDEX "idx_avaliadores_evento_questionario" ON "public"."avaliadores_evento" USING "btree" ("id_evento", "id_questionario");



CREATE INDEX "idx_codigos_acesso_usuario_ativo" ON "public"."codigos_acesso" USING "btree" ("id_usuario") WHERE ("usado_em" IS NULL);



CREATE INDEX "idx_dispositivos_avaliador_usuario_ativo" ON "public"."dispositivos_avaliador" USING "btree" ("id_usuario") WHERE ("revogado_em" IS NULL);



CREATE INDEX "idx_fila_atribuicoes_projeto" ON "public"."fila_atribuicoes_direcionadas" USING "btree" ("id_projeto");



CREATE INDEX "idx_fila_atribuicoes_usuario" ON "public"."fila_atribuicoes_direcionadas" USING "btree" ("id_usuario", "status", "ordem");



CREATE INDEX "idx_instituicao_aliases_norm" ON "public"."instituicao_aliases" USING "btree" ("alias_normalizado");



CREATE INDEX "idx_instituicoes_evento" ON "public"."instituicoes" USING "btree" ("id_evento");



CREATE INDEX "idx_locks_expira" ON "public"."locks_ativos" USING "btree" ("expira_em");



CREATE INDEX "idx_log_auditoria_avaliacao" ON "public"."log_auditoria" USING "btree" ("id_avaliacao") WHERE ("id_avaliacao" IS NOT NULL);



CREATE INDEX "idx_log_auditoria_evento" ON "public"."log_auditoria" USING "btree" ("id_evento", "criado_em" DESC);



CREATE INDEX "idx_log_auditoria_fora_fluxo" ON "public"."log_auditoria" USING "btree" ("criado_em" DESC) WHERE ("origem" = 'direto'::"text");



CREATE INDEX "idx_log_auditoria_projeto" ON "public"."log_auditoria" USING "btree" ("id_projeto") WHERE ("id_projeto" IS NOT NULL);



CREATE INDEX "idx_log_auditoria_tabela" ON "public"."log_auditoria" USING "btree" ("tabela", "criado_em" DESC);



CREATE INDEX "idx_modalidade_aliases_norm" ON "public"."modalidade_aliases" USING "btree" ("alias_normalizado");



CREATE INDEX "idx_modalidades_evento" ON "public"."modalidades" USING "btree" ("id_evento");



CREATE INDEX "idx_projetos_area" ON "public"."projetos" USING "btree" ("id_area");



CREATE INDEX "idx_projetos_estande" ON "public"."projetos" USING "btree" ("estande");



CREATE INDEX "idx_projetos_evento" ON "public"."projetos" USING "btree" ("id_evento");



CREATE INDEX "idx_projetos_modalidade" ON "public"."projetos" USING "btree" ("id_modalidade");



CREATE INDEX "idx_registro_autocadastro_criado_em" ON "public"."registro_autocadastro" USING "btree" ("criado_em");



CREATE UNIQUE INDEX "uq_idx_areas_tematicas_evento_nome" ON "public"."areas_tematicas" USING "btree" ("id_evento", "nome_area") WHERE ("id_evento" IS NOT NULL);



CREATE UNIQUE INDEX "uq_idx_instituicoes_evento_norm" ON "public"."instituicoes" USING "btree" ("id_evento", "nome_normalizado") WHERE ("id_evento" IS NOT NULL);



CREATE UNIQUE INDEX "uq_idx_modalidades_evento_nome" ON "public"."modalidades" USING "btree" ("id_evento", "nome_modalidade") WHERE ("id_evento" IS NOT NULL);



CREATE UNIQUE INDEX "uq_questionarios_evento_origem" ON "public"."questionarios" USING "btree" ("id_evento", "id_origem") WHERE ("id_origem" IS NOT NULL);



CREATE OR REPLACE TRIGGER "auditar_avaliacoes" AFTER INSERT OR DELETE OR UPDATE ON "public"."avaliacoes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('avaliacao');



CREATE OR REPLACE TRIGGER "auditar_avaliadores_evento" AFTER INSERT OR DELETE OR UPDATE ON "public"."avaliadores_evento" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('credenciamento');



CREATE OR REPLACE TRIGGER "auditar_dispositivos_avaliador" AFTER INSERT OR DELETE OR UPDATE ON "public"."dispositivos_avaliador" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('dispositivo');



CREATE OR REPLACE TRIGGER "auditar_eventos" AFTER UPDATE ON "public"."eventos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('evento');



CREATE OR REPLACE TRIGGER "auditar_perguntas_questionario" AFTER INSERT OR DELETE OR UPDATE ON "public"."perguntas_questionario" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('pergunta');



CREATE OR REPLACE TRIGGER "auditar_projetos" AFTER INSERT OR DELETE OR UPDATE OF "codigo_projeto", "titulo", "id_evento", "id_instituicao", "id_area", "id_modalidade", "id_questionario_fixado", "cota_avaliacoes_customizada", "is_check_in_realizado", "is_fora_da_competicao", "quarentena_resolvida_em", "quarentena_resolvida_por" ON "public"."projetos" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('projeto');



CREATE OR REPLACE TRIGGER "auditar_questionarios" AFTER INSERT OR DELETE OR UPDATE ON "public"."questionarios" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('questionario');



CREATE OR REPLACE TRIGGER "auditar_respostas_avaliacao" AFTER DELETE OR UPDATE ON "public"."respostas_avaliacao" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('resposta_alterada');



CREATE OR REPLACE TRIGGER "auditar_usuarios" AFTER DELETE OR UPDATE OF "papel" ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auditar"('usuario');



CREATE OR REPLACE TRIGGER "instituicoes_normalizar" BEFORE INSERT OR UPDATE OF "nome_exibicao", "nome_normalizado", "sigla" ON "public"."instituicoes" FOR EACH ROW EXECUTE FUNCTION "public"."trg_instituicoes_normalizar"();



CREATE OR REPLACE TRIGGER "log_auditoria_imutavel_linha" BEFORE DELETE OR UPDATE ON "public"."log_auditoria" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_auditoria_imutavel"();



CREATE OR REPLACE TRIGGER "log_auditoria_imutavel_truncate" BEFORE TRUNCATE ON "public"."log_auditoria" FOR EACH STATEMENT EXECUTE FUNCTION "public"."fn_log_auditoria_imutavel"();



CREATE OR REPLACE TRIGGER "trg_avaliacao_classificar_voto_popular" BEFORE INSERT OR UPDATE OF "id_questionario" ON "public"."avaliacoes" FOR EACH ROW EXECUTE FUNCTION "public"."avaliacao_classificar_voto_popular"();



ALTER TABLE ONLY "public"."areas_tematicas"
    ADD CONSTRAINT "areas_tematicas_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliacoes"
    ADD CONSTRAINT "avaliacoes_id_projeto_fkey" FOREIGN KEY ("id_projeto") REFERENCES "public"."projetos"("id_projeto") ON DELETE RESTRICT;



COMMENT ON CONSTRAINT "avaliacoes_id_projeto_fkey" ON "public"."avaliacoes" IS 'RESTRICT: apagar projeto com nota é recusado (antes era CASCADE e apagava as notas em silêncio).';



ALTER TABLE ONLY "public"."avaliacoes"
    ADD CONSTRAINT "avaliacoes_id_questionario_fkey" FOREIGN KEY ("id_questionario") REFERENCES "public"."questionarios"("id_questionario") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."avaliacoes"
    ADD CONSTRAINT "avaliacoes_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE RESTRICT;



COMMENT ON CONSTRAINT "avaliacoes_id_usuario_fkey" ON "public"."avaliacoes" IS 'RESTRICT: apagar usuário com nota é recusado. Para tirar o avaliador do evento, descredencie.';



ALTER TABLE ONLY "public"."avaliador_areas"
    ADD CONSTRAINT "avaliador_areas_id_area_fkey" FOREIGN KEY ("id_area") REFERENCES "public"."areas_tematicas"("id_area") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliador_areas"
    ADD CONSTRAINT "avaliador_areas_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliador_areas"
    ADD CONSTRAINT "avaliador_areas_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliador_modalidades_bloqueadas"
    ADD CONSTRAINT "avaliador_modalidades_bloqueadas_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliador_modalidades_bloqueadas"
    ADD CONSTRAINT "avaliador_modalidades_bloqueadas_id_modalidade_fkey" FOREIGN KEY ("id_modalidade") REFERENCES "public"."modalidades"("id_modalidade") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliador_modalidades_bloqueadas"
    ADD CONSTRAINT "avaliador_modalidades_bloqueadas_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliadores_evento"
    ADD CONSTRAINT "avaliadores_evento_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliadores_evento"
    ADD CONSTRAINT "avaliadores_evento_id_instituicao_fkey" FOREIGN KEY ("id_instituicao") REFERENCES "public"."instituicoes"("id_instituicao") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."avaliadores_evento"
    ADD CONSTRAINT "avaliadores_evento_id_questionario_fkey" FOREIGN KEY ("id_questionario") REFERENCES "public"."questionarios"("id_questionario") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."avaliadores_evento"
    ADD CONSTRAINT "avaliadores_evento_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."codigos_acesso"
    ADD CONSTRAINT "codigos_acesso_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."codigos_acesso"
    ADD CONSTRAINT "codigos_acesso_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dispositivos_avaliador"
    ADD CONSTRAINT "dispositivos_avaliador_auth_uid_fkey" FOREIGN KEY ("auth_uid") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dispositivos_avaliador"
    ADD CONSTRAINT "dispositivos_avaliador_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dispositivos_avaliador"
    ADD CONSTRAINT "dispositivos_avaliador_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fila_atribuicoes_direcionadas"
    ADD CONSTRAINT "fila_atribuicoes_direcionadas_id_projeto_fkey" FOREIGN KEY ("id_projeto") REFERENCES "public"."projetos"("id_projeto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fila_atribuicoes_direcionadas"
    ADD CONSTRAINT "fila_atribuicoes_direcionadas_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."historico_impedimentos"
    ADD CONSTRAINT "historico_impedimentos_id_projeto_fkey" FOREIGN KEY ("id_projeto") REFERENCES "public"."projetos"("id_projeto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."historico_impedimentos"
    ADD CONSTRAINT "historico_impedimentos_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instituicao_aliases"
    ADD CONSTRAINT "instituicao_aliases_id_instituicao_fkey" FOREIGN KEY ("id_instituicao") REFERENCES "public"."instituicoes"("id_instituicao") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instituicoes"
    ADD CONSTRAINT "instituicoes_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locks_ativos"
    ADD CONSTRAINT "locks_ativos_id_projeto_fkey" FOREIGN KEY ("id_projeto") REFERENCES "public"."projetos"("id_projeto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locks_ativos"
    ADD CONSTRAINT "locks_ativos_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."modalidade_aliases"
    ADD CONSTRAINT "modalidade_aliases_id_modalidade_fkey" FOREIGN KEY ("id_modalidade") REFERENCES "public"."modalidades"("id_modalidade") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."modalidades"
    ADD CONSTRAINT "modalidades_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pareamentos_pendentes"
    ADD CONSTRAINT "pareamentos_pendentes_auth_uid_fkey" FOREIGN KEY ("auth_uid") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pareamentos_pendentes"
    ADD CONSTRAINT "pareamentos_pendentes_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."perguntas_modelo_questionario"
    ADD CONSTRAINT "perguntas_modelo_questionario_id_modelo_fkey" FOREIGN KEY ("id_modelo") REFERENCES "public"."modelos_questionario"("id_modelo") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."perguntas_questionario"
    ADD CONSTRAINT "perguntas_questionario_id_questionario_fkey" FOREIGN KEY ("id_questionario") REFERENCES "public"."questionarios"("id_questionario") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projetos"
    ADD CONSTRAINT "projetos_id_area_fkey" FOREIGN KEY ("id_area") REFERENCES "public"."areas_tematicas"("id_area") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projetos"
    ADD CONSTRAINT "projetos_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projetos"
    ADD CONSTRAINT "projetos_id_instituicao_fkey" FOREIGN KEY ("id_instituicao") REFERENCES "public"."instituicoes"("id_instituicao") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projetos"
    ADD CONSTRAINT "projetos_id_modalidade_fkey" FOREIGN KEY ("id_modalidade") REFERENCES "public"."modalidades"("id_modalidade") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projetos"
    ADD CONSTRAINT "projetos_id_questionario_fixado_fkey" FOREIGN KEY ("id_questionario_fixado") REFERENCES "public"."questionarios"("id_questionario") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."questionarios"
    ADD CONSTRAINT "questionarios_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."respostas_avaliacao"
    ADD CONSTRAINT "respostas_avaliacao_id_avaliacao_fkey" FOREIGN KEY ("id_avaliacao") REFERENCES "public"."avaliacoes"("id_avaliacao") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."respostas_avaliacao"
    ADD CONSTRAINT "respostas_avaliacao_id_pergunta_fkey" FOREIGN KEY ("id_pergunta") REFERENCES "public"."perguntas_questionario"("id_pergunta") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_auth_fkey" FOREIGN KEY ("id_auth") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE "public"."areas_tematicas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliacoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliador_areas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliador_modalidades_bloqueadas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliadores_evento" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."codigos_acesso" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracoes_seguranca" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dispositivos_avaliador" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."eventos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fila_atribuicoes_direcionadas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."historico_impedimentos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instituicao_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instituicoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."locks_ativos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."log_auditoria" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modalidade_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modalidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modelos_questionario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pareamentos_pendentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perguntas_modelo_questionario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perguntas_questionario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projetos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."questionarios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."registro_autocadastro" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."respostas_avaliacao" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rls_amb_leitura" ON "public"."avaliador_modalidades_bloqueadas" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_amb_staff_apaga" ON "public"."avaliador_modalidades_bloqueadas" FOR DELETE TO "authenticated" USING ("public"."is_staff"());



CREATE POLICY "rls_amb_staff_atualiza" ON "public"."avaliador_modalidades_bloqueadas" FOR UPDATE TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



CREATE POLICY "rls_amb_staff_insere" ON "public"."avaliador_modalidades_bloqueadas" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_staff"());



CREATE POLICY "rls_areas_leitura" ON "public"."avaliador_areas" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_areas_staff_apaga" ON "public"."avaliador_areas" FOR DELETE TO "authenticated" USING ("public"."is_staff"());



CREATE POLICY "rls_areas_staff_atualiza" ON "public"."avaliador_areas" FOR UPDATE TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



CREATE POLICY "rls_areas_staff_insere" ON "public"."avaliador_areas" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_staff"());



CREATE POLICY "rls_areas_tematicas_admin" ON "public"."areas_tematicas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_areas_tematicas_leitura" ON "public"."areas_tematicas" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_avaliacoes_admin" ON "public"."avaliacoes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliacoes_leitura" ON "public"."avaliacoes" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_avaliacoes_staff_apaga_pendentes" ON "public"."avaliacoes" FOR DELETE TO "authenticated" USING (("public"."is_staff"() AND ("nota_final" IS NULL) AND (("status" IS NULL) OR (("status")::"text" <> 'CANCELADA'::"text")) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."respostas_avaliacao" "r"
  WHERE ("r"."id_avaliacao" = "avaliacoes"."id_avaliacao"))))));



CREATE POLICY "rls_avaliador_areas_admin" ON "public"."avaliador_areas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliador_modalidades_bloqueadas_admin" ON "public"."avaliador_modalidades_bloqueadas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliadores_evento_admin" ON "public"."avaliadores_evento" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliadores_evento_leitura" ON "public"."avaliadores_evento" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_avaliadores_evento_staff_atualiza" ON "public"."avaliadores_evento" FOR UPDATE TO "authenticated" USING (("public"."is_staff"() AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id_usuario" = "avaliadores_evento"."id_usuario") AND ("upper"(("u"."papel")::"text") = 'AVALIADOR'::"text")))))) WITH CHECK (("public"."is_staff"() AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id_usuario" = "avaliadores_evento"."id_usuario") AND ("upper"(("u"."papel")::"text") = 'AVALIADOR'::"text"))))));



CREATE POLICY "rls_avaliadores_evento_staff_insere" ON "public"."avaliadores_evento" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_staff"() AND (EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id_usuario" = "avaliadores_evento"."id_usuario") AND ("upper"(("u"."papel")::"text") = 'AVALIADOR'::"text"))))));



CREATE POLICY "rls_eventos_admin" ON "public"."eventos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_eventos_leitura" ON "public"."eventos" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_fila_atribuicoes_direcionadas_admin" ON "public"."fila_atribuicoes_direcionadas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_fila_leitura" ON "public"."fila_atribuicoes_direcionadas" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_fila_staff_apaga" ON "public"."fila_atribuicoes_direcionadas" FOR DELETE TO "authenticated" USING ("public"."is_staff"());



CREATE POLICY "rls_historico_impedimentos_admin" ON "public"."historico_impedimentos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_historico_impedimentos_leitura" ON "public"."historico_impedimentos" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_instituicao_aliases_admin" ON "public"."instituicao_aliases" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_instituicao_aliases_leitura" ON "public"."instituicao_aliases" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"()));



CREATE POLICY "rls_instituicoes_admin" ON "public"."instituicoes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_instituicoes_leitura" ON "public"."instituicoes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_locks_ativos_admin" ON "public"."locks_ativos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_locks_ativos_apaga" ON "public"."locks_ativos" FOR DELETE TO "authenticated" USING (("public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_locks_ativos_leitura" ON "public"."locks_ativos" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_log_auditoria_admin_le" ON "public"."log_auditoria" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "rls_modalidade_aliases_admin" ON "public"."modalidade_aliases" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_modalidade_aliases_leitura" ON "public"."modalidade_aliases" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"()));



CREATE POLICY "rls_modalidades_admin" ON "public"."modalidades" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_modalidades_leitura" ON "public"."modalidades" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_modelos_questionario_leitura" ON "public"."modelos_questionario" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "rls_perguntas_modelo_questionario_leitura" ON "public"."perguntas_modelo_questionario" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "rls_perguntas_questionario_admin" ON "public"."perguntas_questionario" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_perguntas_questionario_leitura" ON "public"."perguntas_questionario" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("public"."avaliador_atual"() IS NOT NULL)));



CREATE POLICY "rls_projetos_admin" ON "public"."projetos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_projetos_leitura" ON "public"."projetos" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("public"."avaliador_atual"() IS NOT NULL)));



CREATE POLICY "rls_questionarios_admin" ON "public"."questionarios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_questionarios_leitura" ON "public"."questionarios" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("public"."avaliador_atual"() IS NOT NULL)));



CREATE POLICY "rls_respostas_avaliacao_admin" ON "public"."respostas_avaliacao" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_usuarios_admin" ON "public"."usuarios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_usuarios_leitura" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("id_usuario" = "auth"."uid"()) OR ("id_usuario" = "public"."avaliador_atual"()) OR ("id_auth" = "auth"."uid"()) OR ("public"."is_staff"() AND ("upper"(("papel")::"text") = 'AVALIADOR'::"text"))));



CREATE POLICY "rls_usuarios_staff_atualiza_avaliador" ON "public"."usuarios" FOR UPDATE TO "authenticated" USING (("public"."is_staff"() AND ("upper"(("papel")::"text") = 'AVALIADOR'::"text"))) WITH CHECK (("public"."is_staff"() AND ("upper"(("papel")::"text") = 'AVALIADOR'::"text")));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_ajustar_media_projeto"("p_id_projeto" "uuid", "p_delta" numeric, "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_ajustar_media_projeto"("p_id_projeto" "uuid", "p_delta" numeric, "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_ajustar_media_projeto"("p_id_projeto" "uuid", "p_delta" numeric, "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_arbitrar_nota_final"("p_id_avaliacao" "uuid", "p_nota" numeric, "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_arbitrar_nota_final"("p_id_avaliacao" "uuid", "p_nota" numeric, "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_arbitrar_nota_final"("p_id_avaliacao" "uuid", "p_nota" numeric, "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_atribuir_banca"("p_id_projeto" "uuid", "p_ids_usuarios" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_atribuir_banca"("p_id_projeto" "uuid", "p_ids_usuarios" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_atribuir_banca"("p_id_projeto" "uuid", "p_ids_usuarios" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_atualizar_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_ids_modalidades_bloqueadas" "uuid"[], "p_ids_areas" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_atualizar_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_ids_modalidades_bloqueadas" "uuid"[], "p_ids_areas" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_atualizar_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_ids_modalidades_bloqueadas" "uuid"[], "p_ids_areas" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_atualizar_staff"("p_id_usuario" "uuid", "p_nome" "text", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_atualizar_staff"("p_id_usuario" "uuid", "p_nome" "text", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_atualizar_staff"("p_id_usuario" "uuid", "p_nome" "text", "p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_bloquear_modalidade_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_modalidade" "uuid", "p_bloquear" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_bloquear_modalidade_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_modalidade" "uuid", "p_bloquear" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_bloquear_modalidade_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_modalidade" "uuid", "p_bloquear" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_copiar_questionario"("p_id_origem" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_copiar_questionario"("p_id_origem" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_copiar_questionario"("p_id_origem" "uuid", "p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_corrigir_respostas_avaliacao"("p_id_avaliacao" "uuid", "p_respostas" "jsonb", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_corrigir_respostas_avaliacao"("p_id_avaliacao" "uuid", "p_respostas" "jsonb", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_corrigir_respostas_avaliacao"("p_id_avaliacao" "uuid", "p_respostas" "jsonb", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_desbloquear_projeto"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_desbloquear_projeto"("p_id_projeto" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_desbloquear_projeto"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_desbloquear_todos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_desbloquear_todos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_desbloquear_todos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_desbloquear_trava"("p_id_lock" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_desbloquear_trava"("p_id_lock" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_desbloquear_trava"("p_id_lock" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_enfileirar_projetos"("p_id_usuario" "uuid", "p_ids_projetos" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_enfileirar_projetos"("p_id_usuario" "uuid", "p_ids_projetos" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_enfileirar_projetos"("p_id_usuario" "uuid", "p_ids_projetos" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_excluir_instituicao"("p_id_instituicao" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_excluir_instituicao"("p_id_instituicao" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_excluir_instituicao"("p_id_instituicao" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_excluir_modalidade"("p_id_modalidade" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_excluir_modalidade"("p_id_modalidade" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_excluir_modalidade"("p_id_modalidade" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_excluir_modelo_questionario"("p_id_modelo" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_excluir_modelo_questionario"("p_id_modelo" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_excluir_modelo_questionario"("p_id_modelo" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_lancar_avaliacao"("p_id_projeto" "uuid", "p_id_usuario" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_motivo" "text", "p_confirmar_acima_da_cota" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_lancar_avaliacao"("p_id_projeto" "uuid", "p_id_usuario" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_motivo" "text", "p_confirmar_acima_da_cota" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_lancar_avaliacao"("p_id_projeto" "uuid", "p_id_usuario" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_motivo" "text", "p_confirmar_acima_da_cota" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_listar_questionarios_reaproveitaveis"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_listar_questionarios_reaproveitaveis"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_listar_questionarios_reaproveitaveis"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_marcar_questionario_voto_popular"("p_id_questionario" "uuid", "p_is_voto_popular" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_marcar_questionario_voto_popular"("p_id_questionario" "uuid", "p_is_voto_popular" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_marcar_questionario_voto_popular"("p_id_questionario" "uuid", "p_is_voto_popular" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_avaliador_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_avaliador_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_avaliador_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_restaurar_modelos_originais"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_restaurar_modelos_originais"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_restaurar_modelos_originais"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_avaliadores"("p_id_evento" "uuid", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_avaliadores"("p_id_evento" "uuid", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_avaliadores"("p_id_evento" "uuid", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_configuracoes_seguranca"("p_exigir_mfa_admin" boolean, "p_minutos_inatividade" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_configuracoes_seguranca"("p_exigir_mfa_admin" boolean, "p_minutos_inatividade" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_configuracoes_seguranca"("p_exigir_mfa_admin" boolean, "p_minutos_inatividade" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_instituicoes"("p_id_evento" "uuid", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_instituicoes"("p_id_evento" "uuid", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_instituicoes"("p_id_evento" "uuid", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_modalidades"("p_id_evento" "uuid", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_modalidades"("p_id_evento" "uuid", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_modalidades"("p_id_evento" "uuid", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_modelo_questionario"("p_id_modelo" "uuid", "p_titulo" "text", "p_descricao" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_modelo_questionario"("p_id_modelo" "uuid", "p_titulo" "text", "p_descricao" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_modelo_questionario"("p_id_modelo" "uuid", "p_titulo" "text", "p_descricao" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_questionario"("p_id_questionario" "uuid", "p_id_evento" "uuid", "p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_questionario"("p_id_questionario" "uuid", "p_id_evento" "uuid", "p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_questionario"("p_id_questionario" "uuid", "p_id_evento" "uuid", "p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_questionario_como_modelo"("p_id_questionario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_questionario_como_modelo"("p_id_questionario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_questionario_como_modelo"("p_id_questionario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_staff"("p_id_evento" "uuid", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_staff"("p_id_evento" "uuid", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_staff"("p_id_evento" "uuid", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_vincular_questionario_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_questionario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_vincular_questionario_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_questionario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_vincular_questionario_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid", "p_id_questionario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."auditoria_ator"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auditoria_ator"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auditoria_marcar_origem"("p_origem" "text", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auditoria_marcar_origem"("p_origem" "text", "p_motivo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."auditoria_motivo"() TO "anon";
GRANT ALL ON FUNCTION "public"."auditoria_motivo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auditoria_motivo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auditoria_origem"() TO "anon";
GRANT ALL ON FUNCTION "public"."auditoria_origem"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auditoria_origem"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auditoria_registrar"("p_acao" "text", "p_tabela" "text", "p_id_evento" "uuid", "p_dados" "jsonb", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auditoria_registrar"("p_acao" "text", "p_tabela" "text", "p_id_evento" "uuid", "p_dados" "jsonb", "p_motivo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."avaliacao_classificar_voto_popular"() TO "anon";
GRANT ALL ON FUNCTION "public"."avaliacao_classificar_voto_popular"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."avaliacao_classificar_voto_popular"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."avaliador_atual"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."avaliador_atual"() TO "anon";
GRANT ALL ON FUNCTION "public"."avaliador_atual"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."avaliador_atual"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."avaliador_e_voto_popular"("p_id_usuario" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."avaliador_e_voto_popular"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avaliador_e_voto_popular"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."conta_da_equipe"("p_auth_uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."conta_da_equipe"("p_auth_uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."evento_ativo_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."evento_ativo_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."evento_ativo_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."evento_ativo_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."exigir_staff_ou_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."exigir_staff_ou_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_aparar_texto"("p_texto" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_aparar_texto"("p_texto" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_aparar_texto"("p_texto" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_assumir_item_fila"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_assumir_item_fila"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_assumir_item_fila"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_auditar"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_auditar"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_auditar_notas"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_auditar_notas"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auditar_notas"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_auditar_voto_popular"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_auditar_voto_popular"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auditar_voto_popular"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_autocadastro_avaliador"("p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_nome_instituicao_nova" "text", "p_ids_areas" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_autocadastro_avaliador"("p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_nome_instituicao_nova" "text", "p_ids_areas" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_autocadastro_avaliador"("p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_nome_instituicao_nova" "text", "p_ids_areas" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_autocadastro_avaliador"("p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_nome_instituicao_nova" "text", "p_ids_areas" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_avaliacoes_ativas_do_projeto"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_avaliacoes_ativas_do_projeto"("p_id_projeto" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_avaliacoes_ativas_do_projeto"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_avaliacoes_do_questionario"("p_id_questionario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_avaliacoes_do_questionario"("p_id_questionario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_avaliacoes_do_questionario"("p_id_questionario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_chave_desempate"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_chave_desempate"("p_id_projeto" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_chave_desempate"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_check_in_projeto"("p_id_projeto" "uuid", "p_check_in" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_check_in_projeto"("p_id_projeto" "uuid", "p_check_in" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_in_projeto"("p_id_projeto" "uuid", "p_check_in" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_desvincular_dispositivo"("p_id_usuario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_desvincular_dispositivo"("p_id_usuario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_desvincular_dispositivo"("p_id_usuario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_tempo_presenca" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_tempo_presenca" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_tempo_presenca" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_expurgar_modalidades_bloqueadas"("p_id_usuario" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_expurgar_modalidades_bloqueadas"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_feira_concluida"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_feira_concluida"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_feira_concluida"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_fixar_questionario"("p_id_projeto" "uuid", "p_id_questionario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_fixar_questionario"("p_id_projeto" "uuid", "p_id_questionario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_fixar_questionario"("p_id_projeto" "uuid", "p_id_questionario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_gerar_codigo_acesso"("p_id_usuario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_gerar_codigo_acesso"("p_id_usuario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_gerar_codigo_acesso"("p_id_usuario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_identidade_visual"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_identidade_visual"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_identidade_visual"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_identidade_visual"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_janela_avaliacao_aberta"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_janela_avaliacao_aberta"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_janela_avaliacao_aberta"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_log_auditoria_imutavel"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_log_auditoria_imutavel"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_memorial_avaliacao"("p_id_avaliacao" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_memorial_avaliacao"("p_id_avaliacao" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_memorial_avaliacao"("p_id_avaliacao" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_memorial_evento"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_memorial_evento"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_memorial_evento"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_memorial_por_codigo"("p_codigo_projeto" "text", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_memorial_por_codigo"("p_codigo_projeto" "text", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_memorial_por_codigo"("p_codigo_projeto" "text", "p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_memorial_projeto"("p_id_projeto" "uuid", "p_incluir_achados" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_memorial_projeto"("p_id_projeto" "uuid", "p_incluir_achados" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_memorial_projeto"("p_id_projeto" "uuid", "p_incluir_achados" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_meu_perfil"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_meu_perfil"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_meu_perfil"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_meu_perfil"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_motivo_inelegivel"("p_id_projeto" "uuid", "p_id_usuario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_motivo_inelegivel"("p_id_projeto" "uuid", "p_id_usuario" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_normalizar_nome"("p_texto" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_normalizar_nome"("p_texto" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_normalizar_nome"("p_texto" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_parear_dispositivo"("p_codigo" "text", "p_id_usuario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_parear_dispositivo"("p_codigo" "text", "p_id_usuario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_parear_dispositivo"("p_codigo" "text", "p_id_usuario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_politica_seguranca"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_politica_seguranca"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_politica_seguranca"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_projetos_situacao"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_projetos_situacao"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_projetos_situacao"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_recalcular_quarentena"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_recalcular_quarentena"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_registrar_impedimento"("p_id_projeto" "uuid", "p_tipo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_registrar_impedimento"("p_id_projeto" "uuid", "p_tipo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_registrar_impedimento"("p_id_projeto" "uuid", "p_tipo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_devolucoes_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_devolucoes_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_devolucoes_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_indicadores_gerenciais"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_indicadores_gerenciais"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_indicadores_gerenciais"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_voto_popular_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_voto_popular_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_voto_popular_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_situacao_vinculos"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_situacao_vinculos"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_situacao_vinculos"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_solicitar_pareamento"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_solicitar_pareamento"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_solicitar_pareamento"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_telao_resumo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_telao_resumo"("p_id_evento" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_telao_resumo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_telao_resumo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_vagas_projeto"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_vagas_projeto"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_validar_dados_questionario"("p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_validar_dados_questionario"("p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_validar_respostas"("p_id_questionario" "uuid", "p_respostas" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_validar_respostas"("p_id_questionario" "uuid", "p_respostas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_validar_respostas"("p_id_questionario" "uuid", "p_respostas" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_vincular_com_codigo"("p_email" "text", "p_codigo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_vincular_com_codigo"("p_email" "text", "p_codigo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_vincular_com_codigo"("p_email" "text", "p_codigo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_vincular_conta_staff"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_vincular_conta_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_vincular_conta_staff"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."gerar_codigo_curto"("p_tamanho" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."gerar_codigo_curto"("p_tamanho" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_staff"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_staff"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_staff"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalizar_codigo"("p_codigo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalizar_codigo"("p_codigo" "text") TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."eventos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."eventos" TO "service_role";



REVOKE ALL ON FUNCTION "public"."parametros_acesso"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."parametros_acesso"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."questionario_do_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."questionario_do_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."questionario_do_avaliador"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sessao_de_conta_da_equipe"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sessao_de_conta_da_equipe"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sortear_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sortear_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sortear_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sortear_proximo_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sortear_proximo_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sortear_proximo_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_instituicoes_normalizar"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_instituicoes_normalizar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_instituicoes_normalizar"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validar_avaliador_do_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validar_avaliador_do_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."areas_tematicas" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."areas_tematicas" TO "authenticated";
GRANT ALL ON TABLE "public"."areas_tematicas" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."avaliacoes" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliador_areas" TO "authenticated";
GRANT ALL ON TABLE "public"."avaliador_areas" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliador_modalidades_bloqueadas" TO "authenticated";
GRANT ALL ON TABLE "public"."avaliador_modalidades_bloqueadas" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliadores_evento" TO "authenticated";
GRANT ALL ON TABLE "public"."avaliadores_evento" TO "service_role";



GRANT ALL ON TABLE "public"."codigos_acesso" TO "service_role";



GRANT ALL ON TABLE "public"."configuracoes_seguranca" TO "service_role";



GRANT ALL ON TABLE "public"."dispositivos_avaliador" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."fila_atribuicoes_direcionadas" TO "authenticated";
GRANT ALL ON TABLE "public"."fila_atribuicoes_direcionadas" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."historico_impedimentos" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_impedimentos" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."instituicao_aliases" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicao_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."instituicao_aliases" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."instituicoes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicoes" TO "authenticated";
GRANT ALL ON TABLE "public"."instituicoes" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."locks_ativos" TO "authenticated";
GRANT ALL ON TABLE "public"."locks_ativos" TO "service_role";



GRANT ALL ON TABLE "public"."log_auditoria" TO "service_role";
GRANT SELECT ON TABLE "public"."log_auditoria" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."log_auditoria_id_log_seq" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."modalidade_aliases" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidade_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."modalidade_aliases" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."modalidades" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidades" TO "authenticated";
GRANT ALL ON TABLE "public"."modalidades" TO "service_role";



GRANT ALL ON TABLE "public"."modelos_questionario" TO "service_role";
GRANT SELECT ON TABLE "public"."modelos_questionario" TO "authenticated";



GRANT ALL ON TABLE "public"."pareamentos_pendentes" TO "service_role";



GRANT ALL ON TABLE "public"."perguntas_modelo_questionario" TO "service_role";
GRANT SELECT ON TABLE "public"."perguntas_modelo_questionario" TO "authenticated";



GRANT SELECT,MAINTAIN ON TABLE "public"."perguntas_questionario" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."perguntas_questionario" TO "authenticated";
GRANT ALL ON TABLE "public"."perguntas_questionario" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."projetos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."projetos" TO "authenticated";
GRANT ALL ON TABLE "public"."projetos" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."questionarios" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."questionarios" TO "authenticated";
GRANT ALL ON TABLE "public"."questionarios" TO "service_role";



GRANT ALL ON TABLE "public"."registro_autocadastro" TO "service_role";



GRANT ALL ON SEQUENCE "public"."registro_autocadastro_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."registro_autocadastro_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."registro_autocadastro_id_seq" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."respostas_avaliacao" TO "authenticated";
GRANT ALL ON TABLE "public"."respostas_avaliacao" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT SELECT("id_usuario") ON TABLE "public"."usuarios" TO "authenticated";



GRANT SELECT("email") ON TABLE "public"."usuarios" TO "authenticated";



GRANT SELECT("nome") ON TABLE "public"."usuarios" TO "authenticated";



GRANT SELECT("papel") ON TABLE "public"."usuarios" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."usuarios" TO "authenticated";



GRANT SELECT("id_auth") ON TABLE "public"."usuarios" TO "authenticated";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_avaliadores_credenciados" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_avaliadores_credenciados" TO "authenticated";
GRANT ALL ON TABLE "public"."view_avaliadores_credenciados" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "authenticated";
GRANT ALL ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_quarentena" TO "authenticated";
GRANT ALL ON TABLE "public"."view_projetos_quarentena" TO "service_role";
GRANT SELECT ON TABLE "public"."view_projetos_quarentena" TO "anon";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_ranking_top3" TO "authenticated";
GRANT ALL ON TABLE "public"."view_ranking_top3" TO "service_role";
GRANT SELECT ON TABLE "public"."view_ranking_top3" TO "anon";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_relatorio_admin" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_relatorio_admin" TO "authenticated";
GRANT ALL ON TABLE "public"."view_relatorio_admin" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_relatorio_ausencias" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_relatorio_ausencias" TO "authenticated";
GRANT ALL ON TABLE "public"."view_relatorio_ausencias" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_relatorio_avaliadores" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_relatorio_avaliadores" TO "authenticated";
GRANT ALL ON TABLE "public"."view_relatorio_avaliadores" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_relatorio_projetos" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_relatorio_projetos" TO "authenticated";
GRANT ALL ON TABLE "public"."view_relatorio_projetos" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







