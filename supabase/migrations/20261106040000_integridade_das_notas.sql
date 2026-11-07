-- ==============================================================================
-- MIGRATION: 20261106040000_integridade_das_notas.sql
-- DESCRIÇÃO: fecha os caminhos pelos quais uma nota mudava ou desaparecia sem
--   rastro, e põe motivo opcional nas ações do Admin.
--   * admin_reset_global apagava respostas_avaliacao e avaliacoes SEM filtro de
--     evento (os passos 7 a 12 filtravam; só esses dois não), levando embora as
--     notas de feiras anteriores. Agora apaga só as do evento, registra antes o
--     resumo do que vai apagar, e recusa rodar sem evento definido (esse caminho
--     era o que apagava o banco inteiro).
--   * FKs avaliacoes→projetos, avaliacoes→usuarios e respostas→perguntas saem de
--     ON DELETE CASCADE para RESTRICT: apagar um projeto ou um usuário deixa de
--     levar as notas em silêncio. GestorProjetos já trata o erro 23503 — a
--     mensagem "já possui avaliações associadas" nunca aparecia porque o CASCADE
--     nunca deixava o erro acontecer.
--   * Policy do Staff passa a exigir avaliação sem resposta e não cancelada.
--   * view_relatorio_admin era a única leitura de média que somava avaliação
--     CANCELADA.
--   * fn_enviar_avaliacao passa a usar fn_recalcular_quarentena, a mesma regra de
--     excluir/restaurar e da view (o bloco inline não exigia 2 avaliações, não
--     respeitava quarentena_resolvida_em e só sabia marcar, nunca desmarcar).
--   * excluir_avaliacao, restaurar_avaliacao e admin_remover_quarentena(_evento)
--     ganham p_motivo opcional; as RPCs passam a se identificar na trilha por
--     auditoria_marcar_origem, para o log distinguir o que veio do sistema do que
--     veio direto da API REST.
-- FRONT-END: compatível com a versão anterior. p_motivo tem DEFAULT NULL, então
--   as chamadas atuais continuam válidas. Mudança de comportamento visível:
--   excluir projeto/usuário com nota agora é recusado (erro 23503), e o reset sem
--   evento ativo é recusado em vez de apagar tudo.
-- PRÉ-REQUISITOS: public.auditoria_marcar_origem(), public.auditoria_registrar()
--   (20261106010000), public.fn_recalcular_quarentena() (20261029240000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Nota de feira não é dado de cadastro: FK em RESTRICT
-- ------------------------------------------------------------------------------
ALTER TABLE public.avaliacoes DROP CONSTRAINT IF EXISTS avaliacoes_id_projeto_fkey;
ALTER TABLE public.avaliacoes
  ADD CONSTRAINT avaliacoes_id_projeto_fkey
  FOREIGN KEY (id_projeto) REFERENCES public.projetos(id_projeto) ON DELETE RESTRICT;

ALTER TABLE public.avaliacoes DROP CONSTRAINT IF EXISTS avaliacoes_id_usuario_fkey;
ALTER TABLE public.avaliacoes
  ADD CONSTRAINT avaliacoes_id_usuario_fkey
  FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario) ON DELETE RESTRICT;

ALTER TABLE public.respostas_avaliacao DROP CONSTRAINT IF EXISTS respostas_avaliacao_id_pergunta_fkey;
ALTER TABLE public.respostas_avaliacao
  ADD CONSTRAINT respostas_avaliacao_id_pergunta_fkey
  FOREIGN KEY (id_pergunta) REFERENCES public.perguntas_questionario(id_pergunta) ON DELETE RESTRICT;

-- respostas_avaliacao → avaliacoes continua CASCADE: a resposta é parte da
-- avaliação, e o soft delete (status CANCELADA) nunca apaga a avaliação.

COMMENT ON CONSTRAINT avaliacoes_id_projeto_fkey ON public.avaliacoes IS
  'RESTRICT: apagar projeto com nota é recusado (antes era CASCADE e apagava as notas em silêncio).';
COMMENT ON CONSTRAINT avaliacoes_id_usuario_fkey ON public.avaliacoes IS
  'RESTRICT: apagar usuário com nota é recusado. Para tirar o avaliador do evento, descredencie.';

-- ------------------------------------------------------------------------------
-- 2. O que o Staff pode apagar: só trava/avaliação vazia, nunca nota
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS rls_avaliacoes_staff_apaga_pendentes ON public.avaliacoes;
CREATE POLICY rls_avaliacoes_staff_apaga_pendentes ON public.avaliacoes
  FOR DELETE TO authenticated
  USING (
    public.is_staff()
    AND nota_final IS NULL
    AND (status IS NULL OR status <> 'CANCELADA')
    AND NOT EXISTS (
      SELECT 1 FROM public.respostas_avaliacao r WHERE r.id_avaliacao = avaliacoes.id_avaliacao
    )
  );

-- ------------------------------------------------------------------------------
-- 3. Avaliação cancelada não entra em média nenhuma
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_relatorio_admin WITH (security_invoker = 'true') AS
 SELECT p.id_projeto,
    p.codigo_projeto,
    p.titulo,
    p.estande,
    p.corredor,
    COALESCE(round(avg(a.nota_final), 2), 0.00) AS media_notas
   FROM public.projetos p
     LEFT JOIN public.avaliacoes a
       ON a.id_projeto = p.id_projeto
      AND (a.status IS NULL OR a.status::text <> 'CANCELADA'::text)
  GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor;

-- ------------------------------------------------------------------------------
-- 4. Reset global: só o evento, com resumo na trilha
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 5. Excluir Staff: recusa explícita quando há nota
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 6. Origem na trilha, motivo opcional e quarentena unificada
-- ------------------------------------------------------------------------------
-- 1. Notas: motivo opcional e origem registrada -----------------------------
DROP FUNCTION IF EXISTS public.excluir_avaliacao(uuid);
CREATE OR REPLACE FUNCTION "public"."excluir_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text" DEFAULT NULL) RETURNS "jsonb"
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

DROP FUNCTION IF EXISTS public.restaurar_avaliacao(uuid);
CREATE OR REPLACE FUNCTION "public"."restaurar_avaliacao"("p_id_avaliacao" "uuid", "p_motivo" "text" DEFAULT NULL) RETURNS "jsonb"
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

DROP FUNCTION IF EXISTS public.admin_remover_quarentena(uuid);
CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena"("p_id_projeto" "uuid", "p_motivo" "text" DEFAULT NULL) RETURNS "void"
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

DROP FUNCTION IF EXISTS public.admin_remover_quarentena_evento(uuid);
CREATE OR REPLACE FUNCTION "public"."admin_remover_quarentena_evento"("p_id_evento" "uuid", "p_motivo" "text" DEFAULT NULL) RETURNS integer
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

-- 2. Demais RPCs que mexem em nota, questionário, credenciamento e aparelho -
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

-- 3. Envio de nota: origem + quarentena pela mesma função de todo mundo -----
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

  -- Fixa o questionário do projeto se ainda não houver.
  UPDATE public.projetos
  SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL
    AND p_id_questionario IS NOT NULL;

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


-- ------------------------------------------------------------------------------
-- 7. Permissões das funções recriadas com assinatura nova
--    (o DROP levou os GRANT; sem isto, o default do banco liberaria para anon)
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.excluir_avaliacao(uuid, text) FROM PUBLIC, anon;
GRANT ALL  ON FUNCTION public.excluir_avaliacao(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.restaurar_avaliacao(uuid, text) FROM PUBLIC, anon;
GRANT ALL  ON FUNCTION public.restaurar_avaliacao(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_remover_quarentena(uuid, text) FROM PUBLIC, anon;
GRANT ALL  ON FUNCTION public.admin_remover_quarentena(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_remover_quarentena_evento(uuid, text) FROM PUBLIC, anon;
GRANT ALL  ON FUNCTION public.admin_remover_quarentena_evento(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.excluir_avaliacao(uuid, text) IS
  'Soft delete da avaliação (status CANCELADA), com motivo opcional registrado na trilha. Só Admin.';
COMMENT ON FUNCTION public.restaurar_avaliacao(uuid, text) IS
  'Restaura avaliação cancelada se a cota permitir, com motivo opcional na trilha. Só Admin.';

COMMIT;
