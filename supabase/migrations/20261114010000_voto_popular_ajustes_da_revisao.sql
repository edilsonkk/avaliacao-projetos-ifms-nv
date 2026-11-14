-- ==============================================================================
-- MIGRATION: 20261114010000_voto_popular_ajustes_da_revisao.sql
-- DESCRIÇÃO: o que sobrou da revisão do voto popular — questionário fixado em voto
--   popular, contagem de avaliador diluída por votante, views legadas sem filtro e
--   cópia de questionário perdendo a marca.
--   * REPARO: projetos.id_questionario_fixado apontando para questionário de voto
--     popular. A tela do avaliador impõe o fixado quando o evento trava o
--     questionário, então o projeto ficava preso no questionário de voto popular e o
--     avaliador técnico não conseguia escolher o certo. Voto popular nunca fixa
--     (migration 20261111050000); quem gravou foi a versão anterior das funções.
--   * trg_projetos_fixado_tecnico: guarda para não acontecer de novo — recusa gravar
--     em id_questionario_fixado um questionário marcado como voto popular.
--   * admin_lancar_avaliacao: o UPDATE do fixado ignorava
--     eventos.fixar_questionario_primeira_avaliacao, então o lançamento manual
--     fixava o questionário mesmo com a trava desligada no evento.
--   * admin_copiar_questionario: a cópia perdia is_voto_popular e virava técnica.
--     Copiar de modelo continua nascendo técnica (modelos não têm a marca).
--   * fn_telao_resumo: avaliadores_credenciados conta só avaliador técnico. O
--     votante já tem votantes_credenciados, e somar os dois diluía a média por
--     avaliador. Nenhuma chave nova.
--   * views legadas (view_relatorio_admin, view_relatorio_projetos,
--     view_relatorio_avaliadores): passam a excluir voto popular, como as
--     fn_relatorio_*_completo. Fecha o L22 do roadmap.
-- FRONT-END: compatível com a versão anterior (nenhuma coluna ou chave sai).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- 1. Reparo: nenhum projeto fica preso num questionário de voto popular ---------
UPDATE public.projetos p
   SET id_questionario_fixado = NULL
 WHERE p.id_questionario_fixado IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.questionarios q
     WHERE q.id_questionario = p.id_questionario_fixado
       AND coalesce(q.is_voto_popular, false)
   );

-- 2. Guarda: o fixado é sempre de nota técnica ---------------------------------
CREATE OR REPLACE FUNCTION public.trg_projetos_fixado_tecnico()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id_questionario_fixado IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.questionarios q
                 WHERE q.id_questionario = NEW.id_questionario_fixado
                   AND coalesce(q.is_voto_popular, false)) THEN
    RAISE EXCEPTION 'Questionário de voto popular não fixa o questionário do projeto.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.trg_projetos_fixado_tecnico() IS
  'Recusa gravar questionário de voto popular em projetos.id_questionario_fixado: o fixado é a escala da nota técnica, e a tela do avaliador o impõe quando o evento trava o questionário.';

DROP TRIGGER IF EXISTS trg_projetos_fixado_tecnico ON public.projetos;
CREATE TRIGGER trg_projetos_fixado_tecnico
  BEFORE INSERT OR UPDATE OF id_questionario_fixado ON public.projetos
  FOR EACH ROW EXECUTE FUNCTION public.trg_projetos_fixado_tecnico();

-- 3. Lançamento manual: o fixado também respeita a trava do evento -------------
CREATE OR REPLACE FUNCTION public.admin_lancar_avaliacao(p_id_projeto uuid, p_id_usuario uuid, p_id_questionario uuid, p_respostas jsonb, p_parecer text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text, p_confirmar_acima_da_cota boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id_evento     uuid;
  v_cota          integer;
  v_fixar_quest   boolean;
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
         p.id_questionario_fixado, coalesce(p.codigo_projeto, p.titulo),
         coalesce(e.fixar_questionario_primeira_avaliacao, true)
    INTO v_id_evento, v_cota, v_quest_fixado, v_codigo, v_fixar_quest
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
  SELECT coalesce(q.is_voto_popular, false) INTO v_voto_popular
  FROM public.questionarios q WHERE q.id_questionario = p_id_questionario;
  v_voto_popular := coalesce(v_voto_popular, false);

  -- Mesma regra de fn_enviar_avaliacao: só recusa quando o evento trava o
  -- questionário no primeiro avaliador, e o voto popular nunca bate na trava
  -- (o questionário dele é, por desenho, diferente do fixado no projeto).
  IF v_fixar_quest AND NOT v_voto_popular
     AND v_quest_fixado IS NOT NULL AND v_quest_fixado IS DISTINCT FROM p_id_questionario THEN
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

  -- Fixa o questionário do projeto só quando o evento trava no primeiro avaliador,
  -- e nunca por voto popular (igual a fn_enviar_avaliacao).
  UPDATE public.projetos
  SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL
    AND v_fixar_quest
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

COMMENT ON FUNCTION public.admin_lancar_avaliacao(uuid, uuid, uuid, jsonb, text, text, boolean) IS
  'Lança a avaliação de um avaliador do evento (ficha em papel, celular sem acesso). Cota, trava do questionário e fixação seguem as mesmas regras de fn_enviar_avaliacao: só nota técnica ocupa cota, e voto popular nunca fixa o questionário do projeto.';

-- 4. Cópia de questionário carrega a marca ------------------------------------
CREATE OR REPLACE FUNCTION public.admin_copiar_questionario(p_id_origem uuid, p_id_evento uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_titulo        text;
  v_base          text;
  v_min           numeric(5,2);
  v_max           numeric(5,2);
  v_evento_origem uuid;
  v_origem_quest  uuid;
  v_voto_popular  boolean := false;
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
    -- A marca acompanha a cópia: copiar um questionário de voto popular dava um
    -- questionário técnico com as perguntas do voto popular.
    SELECT q.titulo, q.escala_minima, q.escala_maxima, q.id_evento, q.id_origem,
           coalesce(q.is_voto_popular, false)
      INTO v_titulo, v_min, v_max, v_evento_origem, v_origem_quest, v_voto_popular
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

  INSERT INTO public.questionarios (id_evento, titulo, escala_minima, escala_maxima, id_origem, is_voto_popular)
  VALUES (p_id_evento, v_titulo, v_min, v_max, v_origem, v_voto_popular)
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

COMMENT ON FUNCTION public.admin_copiar_questionario(uuid, uuid) IS
  'Copia um questionário (ou modelo) para o evento, com perguntas e pesos. A marca is_voto_popular acompanha a cópia de questionário; cópia de modelo nasce técnica.';

-- 5. Telão: avaliador técnico e votante contados à parte -----------------------
CREATE OR REPLACE FUNCTION public.fn_telao_resumo(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- Só avaliador técnico: o votante entra em votantes_credenciados, senão a
    -- média por avaliador do painel sai diluída.
    'avaliadores_credenciados', (SELECT count(*) FROM public.avaliadores_evento ae
                                 JOIN ev ON ev.id_evento = ae.id_evento
                                 JOIN public.usuarios u ON u.id_usuario = ae.id_usuario
                                 LEFT JOIN public.questionarios q ON q.id_questionario = ae.id_questionario
                                 WHERE ae.is_credenciado AND upper(u.papel) = 'AVALIADOR'
                                   AND NOT coalesce(q.is_voto_popular, false)),
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
$function$;

COMMENT ON FUNCTION public.fn_telao_resumo(uuid) IS
  'Resumo agregado do Telão: só contadores, sem nota, nome ou e-mail. Meta, realizadas, em andamento e avaliadores_credenciados são de nota técnica; o voto popular tem votos_populares, projetos_votados e votantes_credenciados.';

-- 6. Views legadas: fora do caminho do front, mas sem média misturada ----------
CREATE OR REPLACE VIEW public.view_relatorio_admin WITH (security_invoker = true) AS
 SELECT p.id_projeto,
    p.codigo_projeto,
    p.titulo,
    p.estande,
    p.corredor,
    COALESCE(round(avg(a.nota_final), 2), 0.00) AS media_notas
   FROM (public.projetos p
     LEFT JOIN public.avaliacoes a ON ((a.id_projeto = p.id_projeto)
       AND ((a.status IS NULL) OR ((a.status)::text <> 'CANCELADA'::text))
       AND (NOT a.is_voto_popular)))
  GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor;

COMMENT ON VIEW public.view_relatorio_admin IS
  'Média por projeto, só de nota técnica. Legada: as telas leem fn_relatorio_projetos_completo.';

CREATE OR REPLACE VIEW public.view_relatorio_avaliadores WITH (security_invoker = true) AS
 SELECT a.id_avaliacao,
    u.id_usuario,
    u.nome AS avaliador_nome,
    u.email AS avaliador_email,
    p.id_projeto,
    p.id_evento,
    p.codigo_projeto,
    p.titulo AS projeto_titulo,
    p.estande AS projeto_estande,
    m.nome_modalidade AS projeto_modalidade,
    ar.nome_area AS projeto_area,
    a.nota_final,
    COALESCE(a.parecer_final, ''::text) AS parecer_comentario,
    a.parecer_final,
    a.tempo_presenca,
    a.tempo_submissao,
    a.created_at AS data_avaliacao,
    a.status
   FROM ((((public.avaliacoes a
     JOIN public.usuarios u ON ((u.id_usuario = a.id_usuario)))
     JOIN public.projetos p ON ((p.id_projeto = a.id_projeto)))
     LEFT JOIN public.modalidades m ON ((m.id_modalidade = p.id_modalidade)))
     LEFT JOIN public.areas_tematicas ar ON ((ar.id_area = p.id_area)))
  WHERE ((a.status IS NULL) OR ((a.status)::text <> 'CANCELADA'::text))
    AND (NOT a.is_voto_popular)
  ORDER BY u.nome, a.created_at DESC;

COMMENT ON VIEW public.view_relatorio_avaliadores IS
  'Avaliações por avaliador, só de nota técnica (o voto popular tem fn_relatorio_voto_popular_completo). Legada: as telas leem fn_relatorio_avaliadores_completo.';

CREATE OR REPLACE VIEW public.view_relatorio_projetos WITH (security_invoker = true) AS
 SELECT p.id_projeto,
    p.id_evento,
    p.codigo_projeto,
    p.titulo,
    p.estande,
    p.corredor,
    m.nome_modalidade AS modalidade,
    ar.nome_area AS area_conhecimento,
    inst.nome_exibicao AS nome_instituicao,
    p.id_instituicao,
    p.id_modalidade,
    p.id_area,
    p.is_check_in_realizado,
    p.is_fora_da_competicao,
    count(a.id_avaliacao) AS total_avaliacoes,
    COALESCE(round(avg(a.nota_final), 2), 0.00) AS media_geral,
    COALESCE(array_agg(round((a.nota_final)::numeric, 2)) FILTER (WHERE ((a.nota_final IS NOT NULL) AND ((a.status IS NULL) OR ((a.status)::text <> 'CANCELADA'::text)))), '{}'::numeric[]) AS notas
   FROM ((((public.projetos p
     LEFT JOIN public.modalidades m ON ((m.id_modalidade = p.id_modalidade)))
     LEFT JOIN public.areas_tematicas ar ON ((ar.id_area = p.id_area)))
     LEFT JOIN public.instituicoes inst ON ((inst.id_instituicao = p.id_instituicao)))
     LEFT JOIN public.avaliacoes a ON ((a.id_projeto = p.id_projeto)
       AND ((a.status IS NULL) OR ((a.status)::text <> 'CANCELADA'::text))
       AND (NOT a.is_voto_popular)))
  GROUP BY p.id_projeto, p.id_evento, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_instituicao, p.id_modalidade, p.id_area, p.is_check_in_realizado, p.is_fora_da_competicao
  ORDER BY COALESCE(round(avg(a.nota_final), 2), 0.00) DESC;

COMMENT ON VIEW public.view_relatorio_projetos IS
  'Contagem, média e notas por projeto, só de nota técnica. Legada: as telas leem fn_relatorio_projetos_completo.';

-- CREATE OR REPLACE VIEW preserva os privilégios; repetidos aqui para a migration
-- ser idempotente mesmo num banco recriado do zero.
GRANT SELECT ON public.view_relatorio_admin TO anon, authenticated;
GRANT ALL ON public.view_relatorio_admin TO service_role;
GRANT SELECT ON public.view_relatorio_avaliadores TO anon, authenticated;
GRANT ALL ON public.view_relatorio_avaliadores TO service_role;
GRANT SELECT ON public.view_relatorio_projetos TO anon, authenticated;
GRANT ALL ON public.view_relatorio_projetos TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
