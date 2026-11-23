-- ==============================================================================
-- MIGRATION: 20261123191829_varios_tecnicos_e_trava_do_voto_popular.sql
-- DESCRIÇÃO: duas mudanças na família de conferência, as duas vindas de informação que
--   chegou depois de 20261123174858:
--
--   1. C15 passa de ATENÇÃO para INFORMATIVO. Vários questionários técnicos por evento
--      são configuração PREVISTA da feira, não desvio.
--   2. `fn_auditar_voto_popular` ganha a trava de `is_admin()` que não tinha.
--
-- 1. VÁRIOS TÉCNICOS SÃO O NORMAL
--
--   A migração anterior nasceu da regra "um questionário técnico por evento", e por isso
--   C15 saiu grave; medida a configuração real (três técnicos), virou atenção. A
--   informação que faltava é mais simples: vários técnicos por evento são previstos. Um
--   achado de atenção sobre configuração escolhida de propósito continua sendo alarme
--   falso — menor, mas falso.
--
--   C15 fica como INFORMATIVO, e o texto deixa de sugerir desvio: ele mostra quantos
--   técnicos o evento tem e qual o efeito a conhecer — a trava do questionário no
--   primeiro avaliador, que é o que pode impedir a cota de um projeto de fechar —, com o
--   comando que confere o fechamento antes da feira.
--
--   C16 continua o ÚNICO grave, e com vários técnicos sendo o normal ele fica mais
--   importante, não menos: é ele que pega escalas divergentes entre técnicos, que entram
--   na mesma média e no mesmo ranking.
--
-- 2. A TRAVA QUE FALTAVA EM fn_auditar_voto_popular
--
--   Ela é SECURITY DEFINER, está concedida a `authenticated` e não chamava `is_admin()`.
--   Medido com uma sessão de avaliador pareado de verdade no banco local:
--
--     select count(*) from avaliacoes            -> 0    (rls_avaliacoes_leitura: só as próprias)
--     select * from fn_auditar_voto_popular(NULL) -> 1 linha: C14, projeto SIM-0001,
--                                                   com o id_avaliacao DE OUTRA PESSOA
--
--   É furo de RLS: a função devolve a existência e o id de avaliação alheia, que a
--   policy devolve zero. O alcance é estreito — só linhas que já são anomalia (C13 e
--   C14), sem nota, sem nome e sem média, e num evento saudável ela devolve nada —, mas
--   não há motivo para manter a exceção: ela tem UM chamador, `fn_auditar_notas`, que já
--   exige Admin, e nada em `src/` a chama. Nenhum caminho do front-end muda.
--
--   A função passa de `sql` para `plpgsql` só para poder RAISE; o corpo da consulta é
--   byte a byte o mesmo de antes.
--
-- IDEMPOTENTE: só CREATE OR REPLACE FUNCTION e COMMENT.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. C15 informativo
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auditar_configuracao_questionarios(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(severidade text, codigo text, titulo text, id_projeto uuid, codigo_projeto text, id_avaliacao uuid, esperado text, encontrado text, detalhe text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id_evento uuid := coalesce(p_id_evento, public.evento_ativo_id());
BEGIN
  -- Mesma postura de fn_auditar_notas: a conferência é do Admin. (Diferente de
  -- fn_auditar_voto_popular, que hoje não tem essa trava — ver ADR 0020.)
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: a conferência de notas é restrita a administradores.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH tec AS (
    SELECT q.id_questionario, q.titulo AS titulo_quest, q.escala_minima, q.escala_maxima
    FROM public.questionarios q
    WHERE q.id_evento = v_id_evento
      AND NOT coalesce(q.is_voto_popular, false)
  ),
  escalas AS (
    SELECT DISTINCT t.escala_minima, t.escala_maxima FROM tec t
  ),
  -- Agregado por questionário, e não uma linha por pessoa: na configuração real da
  -- feira são 48 avaliadores vinculados, e 48 achados enterrariam o resto do Painel.
  vinc AS (
    SELECT t.titulo_quest, count(*) AS quantos,
           (array_agg(u.nome ORDER BY u.nome))[1:3] AS primeiros
    FROM public.avaliadores_evento ae
    JOIN tec t ON t.id_questionario = ae.id_questionario
    JOIN public.usuarios u ON u.id_usuario = ae.id_usuario
    WHERE ae.id_evento = v_id_evento
    GROUP BY t.titulo_quest
  )

  -- C15: quantos técnicos o evento tem. Vários é configuração normal da feira; o que o
  -- achado faz é mostrar que a trava do questionário está em jogo.
  SELECT 'informativo'::text, 'C15'::text, 'Evento com mais de um questionário técnico'::text,
         NULL::uuid, NULL::text, NULL::uuid,
         'configuração conferida antes da feira'::text,
         ((SELECT count(*) FROM tec) || ' questionários técnicos')::text,
         ('Mais de um questionário técnico por evento é configuração prevista. O efeito a conhecer '
          || 'é a trava do questionário: o projeto fica preso ao primeiro técnico que o avaliar, então '
          || 'um avaliador vinculado a outro técnico não consegue avaliá-lo, e a cota daquele projeto '
          || 'depende de sobrar quem possa. Confira o fechamento antes da feira com '
          || '`npm run local:simular -- --questionarios=existentes --ate-concluir`. Técnicos no evento: '
          || (SELECT string_agg(t.titulo_quest, ', ' ORDER BY t.titulo_quest) FROM tec t))::text
  WHERE (SELECT count(*) FROM tec) > 1

  UNION ALL
  -- C16: escala única entre os técnicos, senão a posição depende de quem avaliou
  SELECT 'grave'::text, 'C16'::text, 'Questionários técnicos com escalas diferentes'::text,
         NULL::uuid, NULL::text, NULL::uuid,
         'uma escala só entre os questionários técnicos'::text,
         -- trim_scale: as colunas são numeric(5,2), então 0 e 10 sairiam '0.00 a 10.00'
         -- no Painel. A ordem é fixada para o texto não variar entre execuções.
         (SELECT string_agg(trim_scale(e.escala_minima) || ' a ' || trim_scale(e.escala_maxima), '; '
                            ORDER BY e.escala_minima, e.escala_maxima)
            FROM escalas e)::text,
         ('Notas de escalas diferentes entram na mesma média e no mesmo ranking: a posição do '
          || 'projeto passa a depender da escala de quem o avaliou, não do projeto.')::text
  WHERE (SELECT count(*) FROM escalas) > 1

  UNION ALL
  -- C17: vínculo técnico — legítimo, mas restringe quem o tem a um questionário só
  SELECT 'informativo'::text, 'C17'::text, 'Avaliadores vinculados a questionário técnico'::text,
         NULL::uuid, NULL::text, NULL::uuid,
         'vínculo vazio, para o avaliador usar o questionário do projeto'::text,
         (v.quantos || ' avaliador(es) vinculado(s)')::text,
         format('%s%s só consegue(m) enviar nota pelo questionário %s: fn_enviar_avaliacao recusa '
             || 'qualquer outro. É assim que uma feira com mais de um técnico diz qual banca usa '
             || 'qual; com um técnico só, o vínculo pode ficar vazio.',
             array_to_string(v.primeiros, ', '),
             CASE WHEN v.quantos > 3 THEN format(' e outros %s', v.quantos - 3) ELSE '' END,
             v.titulo_quest)::text
  FROM vinc v;
END $function$;

COMMENT ON FUNCTION public.fn_auditar_configuracao_questionarios(uuid) IS
  'Achados de configuração de questionários do evento: C15 informativo (quantos técnicos o evento tem, e a trava do questionário em jogo), C16 grave (escalas divergentes entre os técnicos) e C17 informativo (avaliadores fixados num técnico, agregado por questionário). Só Admin.';


-- ------------------------------------------------------------------------------
-- 2. A trava de Admin em fn_auditar_voto_popular
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auditar_voto_popular(p_id_evento uuid DEFAULT NULL::uuid)
 RETURNS TABLE(severidade text, codigo text, titulo text, id_projeto uuid, codigo_projeto text,
               id_avaliacao uuid, esperado text, encontrado text, detalhe text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- A trava que faltava. Igual à de fn_auditar_notas e fn_auditar_configuracao_questionarios:
  -- a conferência é do Admin. Única mudança nesta função; o corpo da consulta é o mesmo.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: a conferência de notas é restrita a administradores.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY

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
END $function$;
COMMENT ON FUNCTION public.fn_auditar_voto_popular(uuid) IS
  'Achados próprios do voto popular (C13 e C14): a classificação gravada na avaliação divergir da marca do questionário, e votante com nota na média técnica. Só Admin.';
