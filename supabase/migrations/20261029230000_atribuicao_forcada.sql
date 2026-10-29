-- ==============================================================================
-- MIGRATION: 20261029230000_atribuicao_forcada.sql
-- DESCRIÇÃO: Atribuição forçada (card "Atribuir Projeto") validada no banco.
--   A tela gravava travas e fila direto nas tabelas, validando só no navegador:
--   contava travas vencidas, misturava avaliações de todos os eventos, ignorava
--   conflito declarado pelo avaliador e não tinha proteção contra corrida com o
--   sorteio (a cota podia estourar). Erros da fila eram engolidos e a tela
--   mostrava sucesso. Uma atribuição inválida só aparecia quando o avaliador
--   tentava enviar a nota (fn_enviar_avaliacao recusa).
--   * locks_ativos.atribuido_por: trava criada pelo Admin. O celular retoma essa
--     trava em vez de apagá-la ao sortear.
--   * fn_motivo_inelegivel(projeto, avaliador): mesmas regras do sorteio e do
--     envio da nota, com o motivo em texto (uso interno).
--   * admin_atribuir_banca(p_id_projeto, p_ids_usuarios[]): N avaliadores no
--     mesmo projeto, tudo ou nada, com a cota checada sob lock do projeto.
--   * admin_enfileirar_projetos(p_id_usuario, p_ids_projetos[]): o 1º vira trava
--     (se o avaliador estiver livre) e os demais entram na fila, na ordem dada,
--     depois dos itens pendentes que ele já tinha.
--   Travas da atribuição valem 2 horas (banca pode esperar o avaliador chegar).
-- FRONT-END: AtribuicaoForcada e TelaAvaliador no mesmo PR. Compatível: a versão
--   anterior continua gravando direto (RLS do Admin) e ignora a coluna nova.
-- PRÉ-REQUISITO: public.is_admin() (20261026000000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

ALTER TABLE public.locks_ativos ADD COLUMN IF NOT EXISTS atribuido_por uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locks_ativos_atribuido_por_fkey' AND conrelid = 'public.locks_ativos'::regclass
  ) THEN
    ALTER TABLE public.locks_ativos
      ADD CONSTRAINT locks_ativos_atribuido_por_fkey
      FOREIGN KEY (atribuido_por) REFERENCES public.usuarios(id_usuario) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.locks_ativos.atribuido_por IS
  'Admin que atribuiu o projeto (atribuição forçada). NULL = trava do sorteio. O celular retoma esta trava ao sortear.';

-- ------------------------------------------------------------------------------
-- Regras de elegibilidade (as mesmas do sorteio e de fn_enviar_avaliacao)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_motivo_inelegivel(p_id_projeto uuid, p_id_usuario uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

/** Vagas livres do projeto: cota - avaliações ativas - travas válidas. */
CREATE OR REPLACE FUNCTION public.fn_vagas_projeto(p_id_projeto uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- ------------------------------------------------------------------------------
-- Banca: vários avaliadores no mesmo projeto (tudo ou nada)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_atribuir_banca(p_id_projeto uuid, p_ids_usuarios uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- ------------------------------------------------------------------------------
-- Fila: vários projetos para um avaliador, na ordem escolhida
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_enfileirar_projetos(p_id_usuario uuid, p_ids_projetos uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.fn_motivo_inelegivel(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_vagas_projeto(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_atribuir_banca(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_enfileirar_projetos(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_atribuir_banca(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_enfileirar_projetos(uuid, uuid[]) TO authenticated, service_role;

COMMIT;
