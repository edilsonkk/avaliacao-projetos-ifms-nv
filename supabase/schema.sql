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


CREATE OR REPLACE FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_usos integer;
BEGIN
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

  DELETE FROM public.usuarios WHERE id_usuario = p_id_usuario;
END;
$$;


ALTER FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
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


ALTER FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_projetos uuid[];
BEGIN
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


ALTER FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid") OWNER TO "postgres";


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
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_id_evento UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  -- 1. Determina o evento alvo (especificado ou ativo)
  IF p_id_evento IS NOT NULL THEN
    v_id_evento := p_id_evento;
  ELSE
    SELECT id_evento INTO v_id_evento FROM public.eventos WHERE is_ativo = true LIMIT 1;
  END IF;

  -- 2. Limpeza de respostas de avaliação
  DELETE FROM public.respostas_avaliacao 
  WHERE id_avaliacao IS NOT NULL;

  -- 3. Limpeza de avaliações
  DELETE FROM public.avaliacoes 
  WHERE id_avaliacao IS NOT NULL;

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

  -- 6. Limpeza do histórico de impedimentos e ausências
  DELETE FROM public.historico_impedimentos 
  WHERE id_usuario IS NOT NULL;

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
    EXECUTE 'DELETE FROM public.perguntas_questionario WHERE id_pergunta IS NOT NULL';
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
  DELETE FROM public.usuarios
  WHERE papel IN ('AVALIADOR', 'STAFF')
    AND papel NOT IN ('ADMIN', 'SUPERADMIN')
    AND id_usuario IS NOT NULL;

  RETURN jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Reset Global executado com sucesso.',
    'id_evento', v_id_evento
  );
END;
$_$;


ALTER FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."avaliador_atual"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT d.id_usuario
  FROM public.dispositivos_avaliador d
  JOIN public.usuarios u ON u.id_usuario = d.id_usuario
  WHERE d.auth_uid = auth.uid()
    AND d.revogado_em IS NULL
    AND upper(u.papel::text) = 'AVALIADOR'
  LIMIT 1;
$$;


ALTER FUNCTION "public"."avaliador_atual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."evento_ativo_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT id_evento FROM public.eventos WHERE is_ativo = true ORDER BY created_at DESC LIMIT 1;
$$;


ALTER FUNCTION "public"."evento_ativo_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id_projeto uuid;
  v_id_usuario uuid;
  v_status_antigo varchar;
  v_quarentena boolean;
BEGIN
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


ALTER FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."fn_autocadastro_avaliador"("p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_nome_instituicao_nova" "text", "p_ids_areas" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
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

  SELECT * INTO v_usuario FROM public.usuarios WHERE lower(email) = v_email LIMIT 1;
  IF v_usuario.id_usuario IS NOT NULL THEN
    -- Já existe: não altera nada. Só garante a inscrição no evento, sem
    -- mudar credenciamento nem instituição de quem já está inscrito.
    IF upper(v_usuario.papel::text) = 'AVALIADOR' THEN
      INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
      VALUES (v_usuario.id_usuario, v_evento, false)
      ON CONFLICT (id_usuario, id_evento) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('ok', true, 'situacao', 'ja_cadastrado');
  END IF;

  -- Instituição: existente do evento ou nova (a chave é calculada pelo trigger)
  IF v_inst IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.instituicoes WHERE id_instituicao = v_inst AND id_evento = v_evento) THEN
    v_inst := NULL;
  END IF;
  IF v_inst IS NULL AND length(v_inst_nova) BETWEEN 2 AND 200 THEN
    SELECT id_instituicao INTO v_inst FROM public.instituicoes
    WHERE id_evento = v_evento AND nome_normalizado = public.fn_normalizar_nome(v_inst_nova);
    IF v_inst IS NULL THEN
      INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
      VALUES (v_evento, v_inst_nova, public.fn_normalizar_nome(v_inst_nova))
      RETURNING id_instituicao INTO v_inst;
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

  RETURN jsonb_build_object('ok', true, 'situacao', 'cadastrado');
END;
$_$;


ALTER FUNCTION "public"."fn_autocadastro_avaliador"("p_id_evento" "uuid", "p_nome" "text", "p_email" "text", "p_id_instituicao" "uuid", "p_nome_instituicao_nova" "text", "p_ids_areas" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_avaliacoes_ativas_do_projeto"("p_id_projeto" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE WHEN public.avaliador_atual() IS NULL AND NOT public.is_staff() AND NOT public.is_admin() THEN NULL
         ELSE (SELECT count(*)::integer FROM public.avaliacoes
               WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA')) END;
$$;


ALTER FUNCTION "public"."fn_avaliacoes_ativas_do_projeto"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_avaliacoes_do_questionario"("p_id_questionario" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT count(DISTINCT x.id_avaliacao)::integer FROM (
    SELECT a.id_avaliacao FROM public.avaliacoes a WHERE a.id_questionario = p_id_questionario
    UNION
    SELECT r.id_avaliacao FROM public.respostas_avaliacao r
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE pq.id_questionario = p_id_questionario
  ) x;
$$;


ALTER FUNCTION "public"."fn_avaliacoes_do_questionario"("p_id_questionario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_in_projeto"("p_id_projeto" "uuid", "p_check_in" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
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
         p.cota_avaliacoes_customizada
    INTO v_id_evento, v_inst_projeto, v_modalidade_projeto,
         v_check_in, v_fora_competicao, v_cota_projeto
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

  -- 8. FAIXA DE NOTA conforme o questionário.
  SELECT COALESCE(q.escala_minima, 0), COALESCE(q.escala_maxima, 10)
    INTO v_escala_min, v_escala_max
  FROM public.questionarios q WHERE q.id_questionario = p_id_questionario;
  IF NOT FOUND THEN
    v_escala_min := 0; v_escala_max := 10;
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
            WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA')) AS feitas
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

  RETURN jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira);
END;
$$;


ALTER FUNCTION "public"."fn_gerar_codigo_acesso"("p_id_usuario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_meu_perfil"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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
    'metodos_vinculo', coalesce(v_evento.metodos_vinculo, 'ambos')
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
  PERFORM public.exigir_staff_ou_admin();

  SELECT * INTO v_pend FROM public.pareamentos_pendentes
  WHERE codigo = public.normalizar_codigo(p_codigo) AND expira_em > now()
  FOR UPDATE;
  IF v_pend.codigo IS NULL THEN
    RAISE EXCEPTION 'Código de pareamento inválido ou expirado. Peça para o avaliador gerar outro.';
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
  WHERE p.id_projeto = p_id_projeto
  GROUP BY p.quarentena_resolvida_em;

  v_em_quarentena := coalesce(v_em_quarentena, false);

  UPDATE public.avaliacoes
  SET is_quarentena = (v_em_quarentena AND (status IS NULL OR status <> 'CANCELADA'))
  WHERE id_projeto = p_id_projeto
    AND is_quarentena IS DISTINCT FROM (v_em_quarentena AND (status IS NULL OR status <> 'CANCELADA'));

  RETURN v_em_quarentena;
END;
$$;


ALTER FUNCTION "public"."fn_recalcular_quarentena"("p_id_projeto" "uuid") OWNER TO "postgres";


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


ALTER FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_projeto" "uuid", "id_evento" "uuid", "codigo_projeto" "text", "titulo" "text", "estande" "text", "corredor" "text", "modalidade" "text", "area_conhecimento" "text", "nome_instituicao" "text", "id_instituicao" "uuid", "is_check_in_realizado" boolean, "is_fora_da_competicao" boolean, "total_avaliacoes" integer, "media_geral" numeric, "notas" numeric[], "detalhes_avaliacoes" "jsonb", "cota_avaliacoes" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
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
    ) ORDER BY av.data DESC) FILTER (WHERE av.id_avaliacao IS NOT NULL), '[]'::jsonb),
    coalesce(p.cota_avaliacoes_customizada, ev.cota_avaliacoes_padrao, 3)::int
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
    GROUP BY a.id_projeto
  ),
  travas AS (
    SELECT l.id_projeto, count(*) AS qtd
    FROM public.locks_ativos l
    JOIN public.projetos p ON p.id_projeto = l.id_projeto
    JOIN ev ON ev.id_evento = p.id_evento
    WHERE l.expira_em > now()
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
    'avaliacao_finalizada', (SELECT count(*) > 0 AND bool_and(qtd >= cota) FROM presentes)
  );
$$;


ALTER FUNCTION "public"."fn_telao_resumo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_vagas_projeto"("p_id_projeto" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce(p.cota_avaliacoes_customizada, e.cota_avaliacoes_padrao, 3)
         - (SELECT count(*) FROM public.avaliacoes a
            WHERE a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA'))::int
         - (SELECT count(*) FROM public.locks_ativos l
            WHERE l.id_projeto = p.id_projeto AND l.expira_em > now())::int
  FROM public.projetos p
  LEFT JOIN public.eventos e ON e.id_evento = p.id_evento
  WHERE p.id_projeto = p_id_projeto
$$;


ALTER FUNCTION "public"."fn_vagas_projeto"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_vincular_com_codigo"("p_email" "text", "p_codigo" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_evento     public.eventos;
  v_usuario    public.usuarios;
  v_cod        public.codigos_acesso;
  v_erro_padrao constant text := 'E-mail ou código inválido, expirado ou já utilizado.';
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sessão do aparelho não iniciada.');
  END IF;
  v_evento := public.parametros_acesso(NULL);
  IF v_evento.metodos_vinculo NOT IN ('ambos', 'codigo') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Código de acesso desativado neste evento. Procure o Staff para parear o aparelho.');
  END IF;

  SELECT * INTO v_usuario FROM public.usuarios
  WHERE lower(email) = lower(trim(p_email)) AND upper(papel::text) = 'AVALIADOR'
  LIMIT 1;
  IF v_usuario.id_usuario IS NULL THEN
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
$$;


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
    "metodos_vinculo" "text" DEFAULT 'ambos'::"text" NOT NULL,
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



CREATE OR REPLACE FUNCTION "public"."parametros_acesso"("p_id_evento" "uuid") RETURNS "public"."eventos"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT e.* FROM public.eventos e WHERE e.id_evento = coalesce(p_id_evento, public.evento_ativo_id());
$$;


ALTER FUNCTION "public"."parametros_acesso"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") RETURNS "jsonb"
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
          WHERE a.id_projeto = v_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA'))::int
       + (SELECT count(*) FROM public.locks_ativos l
          WHERE l.id_projeto = v_id_projeto AND l.expira_em > now() AND l.id_usuario <> v_id_usuario)::int
    INTO v_ocupadas;

  IF v_ocupadas >= v_cota THEN
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


ALTER FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") OWNER TO "postgres";


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
BEGIN
  -- Identidade real: o avaliador só age em nome de si mesmo (aparelho vinculado).
  IF NOT public.is_admin() AND public.avaliador_atual() IS DISTINCT FROM p_id_usuario THEN
    RAISE EXCEPTION 'Acesso negado: este aparelho não está vinculado a este avaliador.' USING ERRCODE = '42501';
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
    "cancelada_por" "uuid"
);


ALTER TABLE "public"."avaliacoes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."avaliacoes"."cancelada_em" IS 'Quando o Admin cancelou a avaliação (soft delete). NULL se ativa.';



COMMENT ON COLUMN "public"."avaliacoes"."cancelada_por" IS 'Admin (usuarios.id_usuario) que cancelou a avaliação. Sem FK de propósito (embed do PostgREST).';



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
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."avaliadores_evento" OWNER TO "postgres";


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
    "atribuido_por" "uuid"
);


ALTER TABLE "public"."locks_ativos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."locks_ativos"."atribuido_por" IS 'Admin (usuarios.id_usuario) que atribuiu o projeto. Sem FK de propósito: uma 2ª FK para usuarios quebra o embed usuarios(...) do PostgREST. NULL = trava do sorteio.';



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


CREATE TABLE IF NOT EXISTS "public"."pareamentos_pendentes" (
    "codigo" "text" NOT NULL,
    "auth_uid" "uuid" NOT NULL,
    "id_evento" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expira_em" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."pareamentos_pendentes" OWNER TO "postgres";


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
    "quarentena_resolvida_por" "uuid"
);


ALTER TABLE "public"."projetos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."projetos"."quarentena_resolvida_em" IS 'Quando o Admin aceitou a divergência de notas. Avaliação nova depois disso reabre a quarentena.';



COMMENT ON COLUMN "public"."projetos"."quarentena_resolvida_por" IS 'Admin (usuarios.id_usuario) que resolveu a quarentena. Sem FK de propósito (embed do PostgREST).';



CREATE TABLE IF NOT EXISTS "public"."questionarios" (
    "id_questionario" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_evento" "uuid",
    "titulo" character varying(255) NOT NULL,
    "escala_minima" numeric(5,2) DEFAULT 0.00,
    "escala_maxima" numeric(5,2) DEFAULT 10.00,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."questionarios" OWNER TO "postgres";


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
     LEFT JOIN "public"."avaliacoes" "a" ON (("a"."id_projeto" = "p"."id_projeto")))
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
     LEFT JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")))))
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
            "count"("a"."id_avaliacao") AS "total_avaliacoes",
            "p"."id_evento"
           FROM (((("public"."projetos" "p"
             LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
             LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
             LEFT JOIN "public"."instituicoes" "inst" ON (("inst"."id_instituicao" = "p"."id_instituicao")))
             JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")))))
          WHERE (NOT COALESCE("p"."is_fora_da_competicao", false))
          GROUP BY "p"."id_projeto", "p"."codigo_projeto", "p"."titulo", "p"."estande", "p"."corredor", "m"."nome_modalidade", "ar"."nome_area", "inst"."nome_exibicao", "p"."id_evento"
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
    "rank"() OVER (PARTITION BY "id_evento", "modalidade", "area_tematica" ORDER BY "media_geral" DESC) AS "posicao",
    (EXISTS ( SELECT 1
           FROM "public"."view_projetos_quarentena" "q"
          WHERE ("q"."id_projeto" = "b"."id_projeto"))) AS "em_quarentena"
   FROM "base" "b"
  ORDER BY "media_geral" DESC, "codigo_projeto";


ALTER VIEW "public"."view_ranking_top3" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_relatorio_admin" WITH ("security_invoker"='true') AS
 SELECT "p"."id_projeto",
    "p"."codigo_projeto",
    "p"."titulo",
    "p"."estande",
    "p"."corredor",
    COALESCE("round"("avg"("a"."nota_final"), 2), 0.00) AS "media_notas"
   FROM ("public"."projetos" "p"
     LEFT JOIN "public"."avaliacoes" "a" ON (("a"."id_projeto" = "p"."id_projeto")))
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



ALTER TABLE ONLY "public"."modalidade_aliases"
    ADD CONSTRAINT "modalidade_aliases_pkey" PRIMARY KEY ("id_alias");



ALTER TABLE ONLY "public"."modalidades"
    ADD CONSTRAINT "modalidades_pkey" PRIMARY KEY ("id_modalidade");



ALTER TABLE ONLY "public"."pareamentos_pendentes"
    ADD CONSTRAINT "pareamentos_pendentes_auth_uid_key" UNIQUE ("auth_uid");



ALTER TABLE ONLY "public"."pareamentos_pendentes"
    ADD CONSTRAINT "pareamentos_pendentes_pkey" PRIMARY KEY ("codigo");



ALTER TABLE ONLY "public"."perguntas_questionario"
    ADD CONSTRAINT "perguntas_questionario_pkey" PRIMARY KEY ("id_pergunta");



ALTER TABLE ONLY "public"."projetos"
    ADD CONSTRAINT "projetos_pkey" PRIMARY KEY ("id_projeto");



ALTER TABLE ONLY "public"."questionarios"
    ADD CONSTRAINT "questionarios_pkey" PRIMARY KEY ("id_questionario");



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



CREATE INDEX "idx_codigos_acesso_usuario_ativo" ON "public"."codigos_acesso" USING "btree" ("id_usuario") WHERE ("usado_em" IS NULL);



CREATE INDEX "idx_dispositivos_avaliador_usuario_ativo" ON "public"."dispositivos_avaliador" USING "btree" ("id_usuario") WHERE ("revogado_em" IS NULL);



CREATE INDEX "idx_fila_atribuicoes_projeto" ON "public"."fila_atribuicoes_direcionadas" USING "btree" ("id_projeto");



CREATE INDEX "idx_fila_atribuicoes_usuario" ON "public"."fila_atribuicoes_direcionadas" USING "btree" ("id_usuario", "status", "ordem");



CREATE INDEX "idx_instituicao_aliases_norm" ON "public"."instituicao_aliases" USING "btree" ("alias_normalizado");



CREATE INDEX "idx_instituicoes_evento" ON "public"."instituicoes" USING "btree" ("id_evento");



CREATE INDEX "idx_locks_expira" ON "public"."locks_ativos" USING "btree" ("expira_em");



CREATE INDEX "idx_modalidade_aliases_norm" ON "public"."modalidade_aliases" USING "btree" ("alias_normalizado");



CREATE INDEX "idx_modalidades_evento" ON "public"."modalidades" USING "btree" ("id_evento");



CREATE INDEX "idx_projetos_area" ON "public"."projetos" USING "btree" ("id_area");



CREATE INDEX "idx_projetos_estande" ON "public"."projetos" USING "btree" ("estande");



CREATE INDEX "idx_projetos_evento" ON "public"."projetos" USING "btree" ("id_evento");



CREATE INDEX "idx_projetos_modalidade" ON "public"."projetos" USING "btree" ("id_modalidade");



CREATE UNIQUE INDEX "uq_idx_areas_tematicas_evento_nome" ON "public"."areas_tematicas" USING "btree" ("id_evento", "nome_area") WHERE ("id_evento" IS NOT NULL);



CREATE UNIQUE INDEX "uq_idx_instituicoes_evento_norm" ON "public"."instituicoes" USING "btree" ("id_evento", "nome_normalizado") WHERE ("id_evento" IS NOT NULL);



CREATE UNIQUE INDEX "uq_idx_modalidades_evento_nome" ON "public"."modalidades" USING "btree" ("id_evento", "nome_modalidade") WHERE ("id_evento" IS NOT NULL);



CREATE OR REPLACE TRIGGER "instituicoes_normalizar" BEFORE INSERT OR UPDATE OF "nome_exibicao", "nome_normalizado", "sigla" ON "public"."instituicoes" FOR EACH ROW EXECUTE FUNCTION "public"."trg_instituicoes_normalizar"();



ALTER TABLE ONLY "public"."areas_tematicas"
    ADD CONSTRAINT "areas_tematicas_id_evento_fkey" FOREIGN KEY ("id_evento") REFERENCES "public"."eventos"("id_evento") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliacoes"
    ADD CONSTRAINT "avaliacoes_id_projeto_fkey" FOREIGN KEY ("id_projeto") REFERENCES "public"."projetos"("id_projeto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."avaliacoes"
    ADD CONSTRAINT "avaliacoes_id_questionario_fkey" FOREIGN KEY ("id_questionario") REFERENCES "public"."questionarios"("id_questionario") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."avaliacoes"
    ADD CONSTRAINT "avaliacoes_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "public"."usuarios"("id_usuario") ON DELETE CASCADE;



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
    ADD CONSTRAINT "respostas_avaliacao_id_pergunta_fkey" FOREIGN KEY ("id_pergunta") REFERENCES "public"."perguntas_questionario"("id_pergunta") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_auth_fkey" FOREIGN KEY ("id_auth") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE "public"."areas_tematicas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliacoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliador_areas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliador_modalidades_bloqueadas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliadores_evento" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."codigos_acesso" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dispositivos_avaliador" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."eventos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fila_atribuicoes_direcionadas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."historico_impedimentos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instituicao_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instituicoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."locks_ativos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modalidade_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modalidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pareamentos_pendentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perguntas_questionario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projetos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."questionarios" ENABLE ROW LEVEL SECURITY;


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



CREATE POLICY "rls_avaliacoes_staff_apaga_pendentes" ON "public"."avaliacoes" FOR DELETE TO "authenticated" USING (("public"."is_staff"() AND ("nota_final" IS NULL)));



CREATE POLICY "rls_avaliador_areas_admin" ON "public"."avaliador_areas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliador_modalidades_bloqueadas_admin" ON "public"."avaliador_modalidades_bloqueadas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliadores_evento_admin" ON "public"."avaliadores_evento" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliadores_evento_leitura" ON "public"."avaliadores_evento" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_avaliadores_evento_staff_atualiza" ON "public"."avaliadores_evento" FOR UPDATE TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



CREATE POLICY "rls_avaliadores_evento_staff_insere" ON "public"."avaliadores_evento" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_staff"());



CREATE POLICY "rls_eventos_admin" ON "public"."eventos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_eventos_leitura" ON "public"."eventos" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_fila_atribuicoes_direcionadas_admin" ON "public"."fila_atribuicoes_direcionadas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_fila_avaliador_atualiza" ON "public"."fila_atribuicoes_direcionadas" FOR UPDATE TO "authenticated" USING (("id_usuario" = "public"."avaliador_atual"())) WITH CHECK (("id_usuario" = "public"."avaliador_atual"()));



CREATE POLICY "rls_fila_leitura" ON "public"."fila_atribuicoes_direcionadas" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_fila_staff_apaga" ON "public"."fila_atribuicoes_direcionadas" FOR DELETE TO "authenticated" USING ("public"."is_staff"());



CREATE POLICY "rls_historico_impedimentos_admin" ON "public"."historico_impedimentos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_historico_impedimentos_avaliador_insere" ON "public"."historico_impedimentos" FOR INSERT TO "authenticated" WITH CHECK (("id_usuario" = "public"."avaliador_atual"()));



CREATE POLICY "rls_historico_impedimentos_leitura" ON "public"."historico_impedimentos" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_instituicao_aliases_admin" ON "public"."instituicao_aliases" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_instituicao_aliases_leitura" ON "public"."instituicao_aliases" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"()));



CREATE POLICY "rls_instituicoes_admin" ON "public"."instituicoes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_instituicoes_leitura" ON "public"."instituicoes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_locks_ativos_admin" ON "public"."locks_ativos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_locks_ativos_apaga" ON "public"."locks_ativos" FOR DELETE TO "authenticated" USING (("public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_locks_ativos_avaliador_insere" ON "public"."locks_ativos" FOR INSERT TO "authenticated" WITH CHECK (("id_usuario" = "public"."avaliador_atual"()));



CREATE POLICY "rls_locks_ativos_leitura" ON "public"."locks_ativos" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("id_usuario" = "public"."avaliador_atual"())));



CREATE POLICY "rls_modalidade_aliases_admin" ON "public"."modalidade_aliases" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_modalidade_aliases_leitura" ON "public"."modalidade_aliases" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"()));



CREATE POLICY "rls_modalidades_admin" ON "public"."modalidades" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_modalidades_leitura" ON "public"."modalidades" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_perguntas_questionario_admin" ON "public"."perguntas_questionario" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_perguntas_questionario_leitura" ON "public"."perguntas_questionario" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("public"."avaliador_atual"() IS NOT NULL)));



CREATE POLICY "rls_projetos_admin" ON "public"."projetos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_projetos_leitura" ON "public"."projetos" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("public"."avaliador_atual"() IS NOT NULL)));



CREATE POLICY "rls_questionarios_admin" ON "public"."questionarios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_questionarios_leitura" ON "public"."questionarios" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_staff"() OR ("public"."avaliador_atual"() IS NOT NULL)));



CREATE POLICY "rls_respostas_avaliacao_admin" ON "public"."respostas_avaliacao" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_usuarios_admin" ON "public"."usuarios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_usuarios_leitura" ON "public"."usuarios" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("id_usuario" = "public"."avaliador_atual"()) OR ("id_auth" = "auth"."uid"()) OR ("public"."is_staff"() AND ("upper"(("papel")::"text") = 'AVALIADOR'::"text"))));



CREATE POLICY "rls_usuarios_staff_atualiza_avaliador" ON "public"."usuarios" FOR UPDATE TO "authenticated" USING (("public"."is_staff"() AND ("upper"(("papel")::"text") = 'AVALIADOR'::"text"))) WITH CHECK (("public"."is_staff"() AND ("upper"(("papel")::"text") = 'AVALIADOR'::"text")));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_excluir_questionario"("p_id_questionario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_excluir_staff"("p_id_usuario" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_avaliador_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_avaliador_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_avaliador_evento"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_avaliadores"("p_id_evento" "uuid", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_avaliadores"("p_id_evento" "uuid", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_avaliadores"("p_id_evento" "uuid", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_instituicoes"("p_id_evento" "uuid", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_instituicoes"("p_id_evento" "uuid", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_instituicoes"("p_id_evento" "uuid", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_modalidades"("p_id_evento" "uuid", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_modalidades"("p_id_evento" "uuid", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_modalidades"("p_id_evento" "uuid", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_questionario"("p_id_questionario" "uuid", "p_id_evento" "uuid", "p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_questionario"("p_id_questionario" "uuid", "p_id_evento" "uuid", "p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_questionario"("p_id_questionario" "uuid", "p_id_evento" "uuid", "p_titulo" "text", "p_escala_minima" numeric, "p_escala_maxima" numeric, "p_perguntas" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_salvar_staff"("p_id_evento" "uuid", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_salvar_staff"("p_id_evento" "uuid", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_salvar_staff"("p_id_evento" "uuid", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."avaliador_atual"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."avaliador_atual"() TO "anon";
GRANT ALL ON FUNCTION "public"."avaliador_atual"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."avaliador_atual"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."evento_ativo_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."evento_ativo_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."evento_ativo_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."evento_ativo_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."exigir_staff_ou_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."exigir_staff_ou_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_aparar_texto"("p_texto" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_aparar_texto"("p_texto" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_aparar_texto"("p_texto" "text") TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."fn_recalcular_quarentena"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_recalcular_quarentena"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_indicadores_gerenciais"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_indicadores_gerenciais"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_indicadores_gerenciais"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_instituicoes_completo"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid") TO "service_role";



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



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."eventos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."eventos" TO "service_role";



REVOKE ALL ON FUNCTION "public"."parametros_acesso"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."parametros_acesso"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") TO "service_role";



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



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."areas_tematicas" TO "anon";
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



GRANT ALL ON TABLE "public"."dispositivos_avaliador" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."fila_atribuicoes_direcionadas" TO "authenticated";
GRANT ALL ON TABLE "public"."fila_atribuicoes_direcionadas" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."historico_impedimentos" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_impedimentos" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicao_aliases" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicao_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."instituicao_aliases" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicoes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicoes" TO "authenticated";
GRANT ALL ON TABLE "public"."instituicoes" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."locks_ativos" TO "authenticated";
GRANT ALL ON TABLE "public"."locks_ativos" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidade_aliases" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidade_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."modalidade_aliases" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidades" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidades" TO "authenticated";
GRANT ALL ON TABLE "public"."modalidades" TO "service_role";



GRANT ALL ON TABLE "public"."pareamentos_pendentes" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."perguntas_questionario" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."perguntas_questionario" TO "authenticated";
GRANT ALL ON TABLE "public"."perguntas_questionario" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."projetos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."projetos" TO "authenticated";
GRANT ALL ON TABLE "public"."projetos" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."questionarios" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."questionarios" TO "authenticated";
GRANT ALL ON TABLE "public"."questionarios" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."respostas_avaliacao" TO "authenticated";
GRANT ALL ON TABLE "public"."respostas_avaliacao" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_avaliadores_credenciados" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_avaliadores_credenciados" TO "authenticated";
GRANT ALL ON TABLE "public"."view_avaliadores_credenciados" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "authenticated";
GRANT ALL ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_quarentena" TO "authenticated";
GRANT ALL ON TABLE "public"."view_projetos_quarentena" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_ranking_top3" TO "authenticated";
GRANT ALL ON TABLE "public"."view_ranking_top3" TO "service_role";



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







