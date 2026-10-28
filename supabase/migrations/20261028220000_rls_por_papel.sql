-- ==============================================================================
-- MIGRATION: 20261028220000_rls_por_papel.sql
-- DESCRIÇÃO: Fase 3 da correção de segurança: RLS por papel com identidade real.
--   Substitui as exceções operacionais para `anon` de 20261026000000 (C2, C3, H1, H3):
--   * anon: só lê catálogos sem dados pessoais (eventos, instituições, áreas,
--     modalidades) e usa as RPCs públicas (autocadastro, Telão, perfil).
--   * avaliador vinculado (avaliador_atual()): lê projetos e questionários; só
--     lê/grava as PRÓPRIAS travas, fila, impedimentos e avaliações.
--   * staff (is_staff()): credenciamento, bloqueios, áreas e edição de avaliadores.
--   * admin (is_admin()): tudo, como antes.
--   * sortear_proximo_projeto e fn_enviar_avaliacao recusam p_id_usuario que não
--     seja o avaliador do aparelho (antes qualquer um forjava notas).
--   MUDANÇA INCOMPATÍVEL com o front-end anterior (ADR 0011): publicar junto.
-- PRÉ-REQUISITO: 20261028210000_identidade_avaliador_staff.sql.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Sorteio e envio de notas: só em nome do avaliador do aparelho
--    (corpos reproduzidos verbatim + guard)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sortear_proximo_projeto(p_id_usuario UUID, p_id_evento UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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

REVOKE EXECUTE ON FUNCTION public.sortear_proximo_projeto(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sortear_projeto(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_enviar_avaliacao(uuid, uuid, uuid, jsonb, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sortear_proximo_projeto(uuid, uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.sortear_projeto(uuid, uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_enviar_avaliacao(uuid, uuid, uuid, jsonb, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. Remove todas as policies e recria: base Admin + regras por papel
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  t text;
  tabelas text[] := ARRAY['eventos', 'instituicoes', 'modalidades', 'areas_tematicas', 'usuarios', 'questionarios', 'perguntas_questionario', 'projetos', 'avaliadores_evento', 'avaliacoes', 'respostas_avaliacao', 'locks_ativos', 'fila_atribuicoes_direcionadas', 'historico_impedimentos', 'avaliador_modalidades_bloqueadas', 'avaliador_areas', 'instituicao_aliases', 'modalidade_aliases'];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      'rls_' || t || '_admin', t);
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

CREATE POLICY rls_eventos_leitura ON public.eventos FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY rls_instituicoes_leitura ON public.instituicoes FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY rls_areas_tematicas_leitura ON public.areas_tematicas FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY rls_modalidades_leitura ON public.modalidades FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY rls_projetos_leitura ON public.projetos FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff() OR public.avaliador_atual() IS NOT NULL);
CREATE POLICY rls_questionarios_leitura ON public.questionarios FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff() OR public.avaliador_atual() IS NOT NULL);
CREATE POLICY rls_perguntas_questionario_leitura ON public.perguntas_questionario FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff() OR public.avaliador_atual() IS NOT NULL);
CREATE POLICY rls_instituicao_aliases_leitura ON public.instituicao_aliases FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff());
CREATE POLICY rls_modalidade_aliases_leitura ON public.modalidade_aliases FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff());
CREATE POLICY rls_usuarios_leitura ON public.usuarios FOR SELECT TO authenticated
  USING (public.is_admin() OR id_usuario = public.avaliador_atual() OR id_auth = auth.uid() OR (public.is_staff() AND upper(papel::text) = 'AVALIADOR'));
CREATE POLICY rls_usuarios_staff_atualiza_avaliador ON public.usuarios FOR UPDATE TO authenticated
  USING (public.is_staff() AND upper(papel::text) = 'AVALIADOR')
  WITH CHECK (public.is_staff() AND upper(papel::text) = 'AVALIADOR');
CREATE POLICY rls_avaliadores_evento_leitura ON public.avaliadores_evento FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff() OR id_usuario = public.avaliador_atual());
CREATE POLICY rls_avaliadores_evento_staff_insere ON public.avaliadores_evento FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY rls_avaliadores_evento_staff_atualiza ON public.avaliadores_evento FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
CREATE POLICY rls_avaliacoes_leitura ON public.avaliacoes FOR SELECT TO authenticated
  USING (public.is_admin() OR id_usuario = public.avaliador_atual());
CREATE POLICY rls_avaliacoes_staff_apaga_pendentes ON public.avaliacoes FOR DELETE TO authenticated
  USING (public.is_staff() AND nota_final IS NULL);
CREATE POLICY rls_locks_ativos_leitura ON public.locks_ativos FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff() OR id_usuario = public.avaliador_atual());
CREATE POLICY rls_locks_ativos_avaliador_insere ON public.locks_ativos FOR INSERT TO authenticated
  WITH CHECK (id_usuario = public.avaliador_atual());
CREATE POLICY rls_locks_ativos_apaga ON public.locks_ativos FOR DELETE TO authenticated
  USING (public.is_staff() OR id_usuario = public.avaliador_atual());
CREATE POLICY rls_fila_leitura ON public.fila_atribuicoes_direcionadas FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff() OR id_usuario = public.avaliador_atual());
CREATE POLICY rls_fila_avaliador_atualiza ON public.fila_atribuicoes_direcionadas FOR UPDATE TO authenticated
  USING (id_usuario = public.avaliador_atual())
  WITH CHECK (id_usuario = public.avaliador_atual());
CREATE POLICY rls_fila_staff_apaga ON public.fila_atribuicoes_direcionadas FOR DELETE TO authenticated
  USING (public.is_staff());
CREATE POLICY rls_historico_impedimentos_leitura ON public.historico_impedimentos FOR SELECT TO authenticated
  USING (public.is_admin() OR id_usuario = public.avaliador_atual());
CREATE POLICY rls_historico_impedimentos_avaliador_insere ON public.historico_impedimentos FOR INSERT TO authenticated
  WITH CHECK (id_usuario = public.avaliador_atual());
CREATE POLICY rls_amb_leitura ON public.avaliador_modalidades_bloqueadas FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff() OR id_usuario = public.avaliador_atual());
CREATE POLICY rls_amb_staff_insere ON public.avaliador_modalidades_bloqueadas FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY rls_amb_staff_atualiza ON public.avaliador_modalidades_bloqueadas FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
CREATE POLICY rls_amb_staff_apaga ON public.avaliador_modalidades_bloqueadas FOR DELETE TO authenticated
  USING (public.is_staff());
CREATE POLICY rls_areas_leitura ON public.avaliador_areas FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_staff() OR id_usuario = public.avaliador_atual());
CREATE POLICY rls_areas_staff_insere ON public.avaliador_areas FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY rls_areas_staff_atualiza ON public.avaliador_areas FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
CREATE POLICY rls_areas_staff_apaga ON public.avaliador_areas FOR DELETE TO authenticated
  USING (public.is_staff());

-- ------------------------------------------------------------------------------
-- 3. anon sem privilégio nas tabelas de pessoas e notas (além da RLS)
-- ------------------------------------------------------------------------------
REVOKE ALL ON public.usuarios, public.avaliacoes, public.respostas_avaliacao, public.avaliadores_evento,
              public.locks_ativos, public.fila_atribuicoes_direcionadas, public.historico_impedimentos,
              public.avaliador_modalidades_bloqueadas, public.avaliador_areas FROM anon;

COMMIT;
