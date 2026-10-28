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


CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.avaliacoes
  SET is_quarentena = false
  WHERE id_projeto = p_id_projeto;
END;
$$;


ALTER FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena_todos"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.avaliacoes
  SET is_quarentena = false
  WHERE id_avaliacao IS NOT NULL;
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


CREATE OR REPLACE FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id_projeto UUID;
  v_id_usuario UUID;
  v_status_antigo VARCHAR;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id_projeto, id_usuario, status
  INTO v_id_projeto, v_id_usuario, v_status_antigo
  FROM public.avaliacoes
  WHERE id_avaliacao = p_id_avaliacao;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'mensagem', 'Avaliação não encontrada no sistema.'
    );
  END IF;

  UPDATE public.avaliacoes
  SET
    status = 'CANCELADA',
    status_avaliacao = 'CANCELADA',
    is_quarentena = false
  WHERE id_avaliacao = p_id_avaliacao;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', p_id_avaliacao,
    'id_projeto', v_id_projeto,
    'id_usuario', v_id_usuario,
    'status_anterior', v_status_antigo,
    'novo_status', 'CANCELADA',
    'mensagem', 'Avaliação cancelada com sucesso.'
  );
END;
$$;


ALTER FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_usuario" "uuid", "avaliador_nome" "text", "avaliador_email" "text", "total_ausencias" integer, "ausencias" "jsonb")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_relatorio_ausencias_completo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_avaliadores_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_usuario" "uuid", "avaliador_nome" "text", "avaliador_email" "text", "total_avaliacoes" integer, "media_notas" numeric, "tempo_medio_segundos" integer, "avaliacoes" "jsonb")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
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


CREATE OR REPLACE FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id_projeto" "uuid", "id_evento" "uuid", "codigo_projeto" "text", "titulo" "text", "estande" "text", "corredor" "text", "modalidade" "text", "area_conhecimento" "text", "nome_instituicao" "text", "id_instituicao" "uuid", "is_check_in_realizado" boolean, "is_fora_da_competicao" boolean, "total_avaliacoes" integer, "media_geral" numeric, "notas" numeric[], "detalhes_avaliacoes" "jsonb")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_relatorio_projetos_completo"("p_id_evento" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id_usuario = auth.uid()
      AND upper(u.papel::text) = 'ADMIN'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id_projeto UUID;
  v_id_usuario UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT id_projeto, id_usuario
  INTO v_id_projeto, v_id_usuario
  FROM public.avaliacoes
  WHERE id_avaliacao = p_id_avaliacao;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'mensagem', 'Avaliação não encontrada no sistema.'
    );
  END IF;

  UPDATE public.avaliacoes
  SET
    status = 'CONCLUIDA',
    status_avaliacao = 'concluida'
  WHERE id_avaliacao = p_id_avaliacao;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', p_id_avaliacao,
    'id_projeto', v_id_projeto,
    'id_usuario', v_id_usuario,
    'novo_status', 'CONCLUIDA',
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
  v_id_instituicao_avaliador UUID;
  v_id_projeto_sorteado UUID;
  v_minutos_lock INTEGER := 30;
  v_cota_padrao INTEGER := 3;
BEGIN
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
  SELECT p.id_projeto INTO v_id_projeto_sorteado
  FROM public.projetos p
  LEFT JOIN public.locks_ativos l ON l.id_projeto = p.id_projeto
  WHERE p.id_evento = p_id_evento
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
  LIMIT 1;

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

SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    "tempo_submissao" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."avaliacoes" OWNER TO "postgres";


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
    "data_fim" "date" DEFAULT CURRENT_DATE
);


ALTER TABLE "public"."eventos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."eventos"."sistema_liberado" IS 'Controle booleano que permite ou pausa o sorteio de avaliações';



COMMENT ON COLUMN "public"."eventos"."horario_inicio" IS 'Horário de início das avaliações do evento (TIME)';



COMMENT ON COLUMN "public"."eventos"."horario_fim" IS 'Horário de término das avaliações do evento (TIME)';



COMMENT ON COLUMN "public"."eventos"."data_evento" IS 'Data oficial de realização do evento (DATE)';



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
    "expira_em" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."locks_ativos" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."perguntas_questionario" (
    "id_pergunta" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_questionario" "uuid",
    "ordem" integer DEFAULT 1,
    "texto_pergunta" "text" NOT NULL,
    "peso_calculo" numeric(5,2) DEFAULT 1.00,
    "peso_desempate" numeric(5,2) DEFAULT 1.00,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."perguntas_questionario" OWNER TO "postgres";


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
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."projetos" OWNER TO "postgres";


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
    "created_at" timestamp with time zone DEFAULT "now"()
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
    "bool_or"(COALESCE("a"."is_quarentena", false)) AS "tem_flag_quarentena"
   FROM (((("public"."projetos" "p"
     LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
     LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
     LEFT JOIN "public"."instituicoes" "inst" ON (("inst"."id_instituicao" = "p"."id_instituicao")))
     LEFT JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")))))
  GROUP BY "p"."id_projeto", "p"."codigo_projeto", "p"."titulo", "p"."estande", "p"."corredor", "m"."nome_modalidade", "ar"."nome_area", "inst"."nome_exibicao", "p"."id_evento"
 HAVING (("bool_or"(COALESCE("a"."is_quarentena", false)) = true) OR (("count"("a"."id_avaliacao") >= 2) AND (("max"("a"."nota_final") - "min"("a"."nota_final")) > 2.5)));


ALTER VIEW "public"."view_projetos_quarentena" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_ranking_top3" WITH ("security_invoker"='true') AS
 SELECT "p"."id_projeto",
    "p"."codigo_projeto",
    "p"."titulo",
    "p"."estande",
    "p"."corredor",
    COALESCE("m"."nome_modalidade", 'Geral'::character varying) AS "modalidade",
    COALESCE("ar"."nome_area", 'Multidisciplinar'::character varying) AS "area_tematica",
    COALESCE("inst"."nome_exibicao", 'Não informada'::character varying) AS "nome_instituicao",
    COALESCE("array_agg"("round"(("a"."nota_final")::numeric, 2)) FILTER (WHERE (("a"."nota_final" IS NOT NULL) AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")))), '{}'::numeric[]) AS "notas",
    COALESCE("round"("avg"("a"."nota_final"), 2), 0.00) AS "media_geral",
    "count"("a"."id_avaliacao") AS "total_avaliacoes",
    "p"."id_evento"
   FROM (((("public"."projetos" "p"
     LEFT JOIN "public"."modalidades" "m" ON (("m"."id_modalidade" = "p"."id_modalidade")))
     LEFT JOIN "public"."areas_tematicas" "ar" ON (("ar"."id_area" = "p"."id_area")))
     LEFT JOIN "public"."instituicoes" "inst" ON (("inst"."id_instituicao" = "p"."id_instituicao")))
     JOIN "public"."avaliacoes" "a" ON ((("a"."id_projeto" = "p"."id_projeto") AND (("a"."status" IS NULL) OR (("a"."status")::"text" <> 'CANCELADA'::"text")))))
  GROUP BY "p"."id_projeto", "p"."codigo_projeto", "p"."titulo", "p"."estande", "p"."corredor", "m"."nome_modalidade", "ar"."nome_area", "inst"."nome_exibicao", "p"."id_evento"
  ORDER BY COALESCE("round"("avg"("a"."nota_final"), 2), 0.00) DESC;


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



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id_usuario");



CREATE INDEX "idx_aa_area" ON "public"."avaliador_areas" USING "btree" ("id_area");



CREATE INDEX "idx_aa_usuario_evento" ON "public"."avaliador_areas" USING "btree" ("id_usuario", "id_evento");



CREATE INDEX "idx_amb_modalidade" ON "public"."avaliador_modalidades_bloqueadas" USING "btree" ("id_modalidade");



CREATE INDEX "idx_amb_usuario_evento" ON "public"."avaliador_modalidades_bloqueadas" USING "btree" ("id_usuario", "id_evento");



CREATE INDEX "idx_areas_tematicas_evento" ON "public"."areas_tematicas" USING "btree" ("id_evento");



CREATE INDEX "idx_avaliacoes_projeto" ON "public"."avaliacoes" USING "btree" ("id_projeto");



CREATE INDEX "idx_avaliacoes_usuario" ON "public"."avaliacoes" USING "btree" ("id_usuario");



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



ALTER TABLE "public"."areas_tematicas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliacoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliador_areas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliador_modalidades_bloqueadas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avaliadores_evento" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."eventos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fila_atribuicoes_direcionadas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."historico_impedimentos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instituicao_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instituicoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."locks_ativos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modalidade_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modalidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perguntas_questionario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projetos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."questionarios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."respostas_avaliacao" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rls_areas_tematicas_admin" ON "public"."areas_tematicas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_areas_tematicas_select" ON "public"."areas_tematicas" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_avaliacoes_admin" ON "public"."avaliacoes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliacoes_delete_pendentes" ON "public"."avaliacoes" FOR DELETE TO "authenticated", "anon" USING (("nota_final" IS NULL));



CREATE POLICY "rls_avaliacoes_select" ON "public"."avaliacoes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_avaliador_areas_admin" ON "public"."avaliador_areas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliador_areas_operacional" ON "public"."avaliador_areas" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "rls_avaliador_areas_select" ON "public"."avaliador_areas" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_avaliador_modalidades_bloqueadas_admin" ON "public"."avaliador_modalidades_bloqueadas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliador_modalidades_bloqueadas_operacional" ON "public"."avaliador_modalidades_bloqueadas" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "rls_avaliador_modalidades_bloqueadas_select" ON "public"."avaliador_modalidades_bloqueadas" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_avaliadores_evento_admin" ON "public"."avaliadores_evento" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_avaliadores_evento_insert_operacional" ON "public"."avaliadores_evento" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "rls_avaliadores_evento_select" ON "public"."avaliadores_evento" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_avaliadores_evento_update_operacional" ON "public"."avaliadores_evento" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "rls_eventos_admin" ON "public"."eventos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_eventos_select" ON "public"."eventos" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_fila_atribuicoes_direcionadas_admin" ON "public"."fila_atribuicoes_direcionadas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_fila_atribuicoes_direcionadas_select" ON "public"."fila_atribuicoes_direcionadas" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_fila_atribuicoes_operacional" ON "public"."fila_atribuicoes_direcionadas" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "rls_historico_impedimentos_admin" ON "public"."historico_impedimentos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_historico_impedimentos_insert_operacional" ON "public"."historico_impedimentos" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "rls_historico_impedimentos_select" ON "public"."historico_impedimentos" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_instituicao_aliases_admin" ON "public"."instituicao_aliases" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_instituicao_aliases_select" ON "public"."instituicao_aliases" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_instituicoes_admin" ON "public"."instituicoes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_instituicoes_insert_operacional" ON "public"."instituicoes" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "rls_instituicoes_select" ON "public"."instituicoes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_locks_ativos_admin" ON "public"."locks_ativos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_locks_ativos_operacional" ON "public"."locks_ativos" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "rls_locks_ativos_select" ON "public"."locks_ativos" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_modalidade_aliases_admin" ON "public"."modalidade_aliases" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_modalidade_aliases_select" ON "public"."modalidade_aliases" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_modalidades_admin" ON "public"."modalidades" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_modalidades_select" ON "public"."modalidades" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_perguntas_questionario_admin" ON "public"."perguntas_questionario" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_perguntas_questionario_select" ON "public"."perguntas_questionario" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_projetos_admin" ON "public"."projetos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_projetos_select" ON "public"."projetos" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_projetos_update_operacional" ON "public"."projetos" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "rls_questionarios_admin" ON "public"."questionarios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_questionarios_select" ON "public"."questionarios" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_respostas_avaliacao_admin" ON "public"."respostas_avaliacao" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_respostas_avaliacao_select" ON "public"."respostas_avaliacao" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_usuarios_admin" ON "public"."usuarios" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "rls_usuarios_insert_operacional" ON "public"."usuarios" FOR INSERT TO "authenticated", "anon" WITH CHECK (("upper"(COALESCE(("papel")::"text", 'AVALIADOR'::"text")) = 'AVALIADOR'::"text"));



CREATE POLICY "rls_usuarios_select" ON "public"."usuarios" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "rls_usuarios_update_operacional" ON "public"."usuarios" FOR UPDATE TO "authenticated", "anon" USING (("upper"(COALESCE(("papel")::"text", 'AVALIADOR'::"text")) = 'AVALIADOR'::"text")) WITH CHECK (("upper"(COALESCE(("papel")::"text", 'AVALIADOR'::"text")) = 'AVALIADOR'::"text"));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_desbloquear_projeto"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_desbloquear_projeto"("p_id_projeto" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_desbloquear_projeto"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_desbloquear_todos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_desbloquear_todos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_desbloquear_todos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remover_quarentena_todos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reset_global"("p_id_evento" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_tempo_presenca" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_tempo_presenca" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_tempo_presenca" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_enviar_avaliacao"("p_id_usuario" "uuid", "p_id_projeto" "uuid", "p_id_questionario" "uuid", "p_respostas" "jsonb", "p_parecer" "text", "p_tempo_presenca" "text") TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sortear_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sortear_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sortear_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sortear_proximo_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sortear_proximo_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sortear_proximo_projeto"("p_id_usuario" "uuid", "p_id_evento" "uuid") TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."areas_tematicas" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."areas_tematicas" TO "authenticated";
GRANT ALL ON TABLE "public"."areas_tematicas" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliacoes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."avaliacoes" TO "service_role";



GRANT SELECT("id_avaliacao") ON TABLE "public"."avaliacoes" TO "anon";



GRANT SELECT("id_projeto") ON TABLE "public"."avaliacoes" TO "anon";



GRANT SELECT("id_usuario") ON TABLE "public"."avaliacoes" TO "anon";



GRANT SELECT("status") ON TABLE "public"."avaliacoes" TO "anon";



GRANT SELECT("status_avaliacao") ON TABLE "public"."avaliacoes" TO "anon";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliador_areas" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliador_areas" TO "authenticated";
GRANT ALL ON TABLE "public"."avaliador_areas" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliador_modalidades_bloqueadas" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliador_modalidades_bloqueadas" TO "authenticated";
GRANT ALL ON TABLE "public"."avaliador_modalidades_bloqueadas" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliadores_evento" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."avaliadores_evento" TO "authenticated";
GRANT ALL ON TABLE "public"."avaliadores_evento" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."eventos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."eventos" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."fila_atribuicoes_direcionadas" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."fila_atribuicoes_direcionadas" TO "authenticated";
GRANT ALL ON TABLE "public"."fila_atribuicoes_direcionadas" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."historico_impedimentos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."historico_impedimentos" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_impedimentos" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicao_aliases" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicao_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."instituicao_aliases" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicoes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instituicoes" TO "authenticated";
GRANT ALL ON TABLE "public"."instituicoes" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."locks_ativos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."locks_ativos" TO "authenticated";
GRANT ALL ON TABLE "public"."locks_ativos" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidade_aliases" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidade_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."modalidade_aliases" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidades" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."modalidades" TO "authenticated";
GRANT ALL ON TABLE "public"."modalidades" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."perguntas_questionario" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."perguntas_questionario" TO "authenticated";
GRANT ALL ON TABLE "public"."perguntas_questionario" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."projetos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."projetos" TO "authenticated";
GRANT ALL ON TABLE "public"."projetos" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."questionarios" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."questionarios" TO "authenticated";
GRANT ALL ON TABLE "public"."questionarios" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."respostas_avaliacao" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."respostas_avaliacao" TO "authenticated";
GRANT ALL ON TABLE "public"."respostas_avaliacao" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."usuarios" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT SELECT("id_usuario") ON TABLE "public"."usuarios" TO "anon";



GRANT SELECT("email") ON TABLE "public"."usuarios" TO "anon";



GRANT SELECT("nome") ON TABLE "public"."usuarios" TO "anon";



GRANT SELECT("papel") ON TABLE "public"."usuarios" TO "anon";



GRANT SELECT("created_at") ON TABLE "public"."usuarios" TO "anon";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_avaliadores_credenciados" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_avaliadores_credenciados" TO "authenticated";
GRANT ALL ON TABLE "public"."view_avaliadores_credenciados" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "authenticated";
GRANT ALL ON TABLE "public"."view_projetos_pendentes_avaliacao" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_quarentena" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."view_projetos_quarentena" TO "authenticated";
GRANT ALL ON TABLE "public"."view_projetos_quarentena" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."view_ranking_top3" TO "anon";
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







