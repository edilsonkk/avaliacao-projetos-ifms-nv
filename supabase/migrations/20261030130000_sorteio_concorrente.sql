-- ==============================================================================
-- MIGRATION: 20261030130000_sorteio_concorrente.sql
-- DESCRIÇÃO: sorteio sem projeto repetido quando vários avaliadores sorteiam juntos.
--   * sortear_proximo_projeto escolhia "projeto sem trava e com vaga" sem reservar
--     a linha. Sorteios simultâneos viam o mesmo projeto livre e todos gravavam
--     trava: o projeto passava da cota e os avaliadores excedentes avaliavam à
--     toa (fn_enviar_avaliacao recusa por cota). Na simulação local (118
--     avaliadores) foram 28 fichas perdidas; num teste com 20 vagas e 60
--     sorteios simultâneos, 13-14 projetos ficavam acima da cota.
--   * Agora reserva a linha do projeto (FOR UPDATE OF p SKIP LOCKED) e, com ela
--     reservada, confere de novo trava e cota antes de gravar a trava. Regras de
--     elegibilidade e ordem de prioridade não mudam. sortear_projeto delega a
--     esta função (continua em sincronia).
-- FRONT-END: compatível com a versão anterior (mesma assinatura).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

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

REVOKE EXECUTE ON FUNCTION public.sortear_proximo_projeto(uuid, uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sortear_proximo_projeto(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
