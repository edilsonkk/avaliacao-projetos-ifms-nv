-- ==============================================================================
-- MIGRATION: 20261026010000_rpc_enviar_avaliacao.sql
-- DESCRIÇÃO: Gravação de nota com validação SERVER-SIDE (defesa contra Broken
--   Access Control). Hoje TelaAvaliador.tsx faz INSERT direto em avaliacoes/
--   respostas_avaliacao com id_usuario vindo do localStorage, e a RLS aceita
--   WITH CHECK (true): qualquer cliente anon grava qualquer nota, em nome de
--   qualquer avaliador, sem trava, sem janela e fora da escala.
--
--   Esta migration cria fn_enviar_avaliacao() SECURITY DEFINER, que:
--     * exige posse de trava ativa em locks_ativos (p_id_usuario, p_id_projeto);
--     * valida projeto elegível, ausência de duplicidade, conflito institucional,
--       modalidade bloqueada, cota estrita, janela temporal e faixa de nota;
--     * calcula nota_final no banco (ignora qualquer valor do cliente);
--     * grava avaliacoes + respostas, remove a trava e conclui a fila, tudo numa
--       transação; aplica quarentena por divergência > 2.5.
--   E REMOVE as policies de INSERT anônimo em avaliacoes/respostas_avaliacao, de
--   modo que gravar nota só seja possível por esta função.
--
-- LIMITE CONHECIDO: sem login autenticado do avaliador (migration 1 / OTP),
--   não há auth.uid() para o avaliador, então p_id_usuario ainda vem do cliente.
--   Esta função eleva a barra (exige trava + todas as regras), mas a prova plena
--   de identidade do avaliador só vem com a migration 1.
--
-- COMPANION OBRIGATÓRIO (frontend, fora desta migration): TelaAvaliador.
--   enviar_avaliacao() deve passar a chamar supabase.rpc('fn_enviar_avaliacao').
--   Enquanto isso não for feito, o envio de notas deixa de funcionar.
--
-- IDEMPOTENTE. APLICAÇÃO: colar no SQL Editor do Supabase e executar.
-- ==============================================================================

BEGIN;

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

REVOKE ALL ON FUNCTION public.fn_enviar_avaliacao(uuid, uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_enviar_avaliacao(uuid, uuid, uuid, jsonb, text, text)
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- LOCKDOWN DO CAMINHO DIRETO: gravar nota só via a função acima.
-- A função é SECURITY DEFINER (roda como owner) e segue inserindo normalmente.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS rls_avaliacoes_insert_operacional ON public.avaliacoes;
DROP POLICY IF EXISTS rls_respostas_avaliacao_insert_operacional ON public.respostas_avaliacao;

COMMIT;
