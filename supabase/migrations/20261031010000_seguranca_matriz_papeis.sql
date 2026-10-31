-- ==============================================================================
-- MIGRATION: 20261031010000_seguranca_matriz_papeis.sql
-- DESCRIÇÃO: etapa 1 da revisão de segurança (matriz papel × objeto; OWASP API
-- Security Top 10, ASVS cap. 8). Achados confirmados por sondagem no banco local:
--   A1 (alto, API6/CWE-841) O avaliador gravava trava direto em locks_ativos, em
--      QUALQUER projeto e com QUALQUER validade: escolhia o projeto (fora do
--      sorteio) e podia bloquear um projeto por anos. Agora a trava só nasce no
--      banco: sorteio, atribuição do Admin ou fn_assumir_item_fila (fila
--      direcionada, com as mesmas regras de elegibilidade e cota).
--   A2 (médio, API1/CWE-639) O avaliador trocava o projeto do próprio item de fila.
--      A política de UPDATE do avaliador na fila sai; fn_enviar_avaliacao já
--      conclui o item, e fn_assumir_item_fila marca os demais estados.
--   A3 (médio, CWE-284) O avaliador registrava ausência/conflito em qualquer
--      projeto, falseando o relatório de ausências e os indicadores. Agora só por
--      fn_registrar_impedimento, no projeto em que está (com trava).
--   A4 (médio, LGPD/CWE-359) Staff lia CPF e celular de todos os avaliadores;
--      nenhuma tela usa esses campos. Usuários logados leem só as colunas usadas.
--   A5 (baixo) Staff credenciava qualquer usuário (inclusive o Admin); agora só
--      avaliadores (o Staff é credenciado pelo Admin).
--   A6 (baixo) fn_avaliacoes_do_questionario respondia a qualquer usuário logado;
--      agora só ao Admin.
--   A7 (baixo, defesa em profundidade) anon tinha INSERT/UPDATE/DELETE em tabelas
--      de cadastro, barrado só pela RLS. Permissões retiradas (fica a leitura).
--   A8 (baixo, CWE-426) admin_reset_global sem pg_temp no search_path.
-- FRONT-END: esta versão do front usa as funções novas. O front anterior perde a
--   gravação direta de trava da fila, ausência e conflito (contract junto com o
--   expand, por ser correção de segurança): publicar fora de evento.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A1/A2: fila direcionada assumida pelo banco
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_assumir_item_fila()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usuario uuid := public.avaliador_atual();
  v_item    record;
  v_motivo  text;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: este aparelho não está vinculado a um avaliador.' USING ERRCODE = '42501';
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

-- ---------------------------------------------------------------------------
-- A3: ausência/conflito só no projeto em que o avaliador está
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_registrar_impedimento(p_id_projeto uuid, p_tipo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usuario uuid := public.avaliador_atual();
BEGIN
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

REVOKE ALL ON FUNCTION public.fn_assumir_item_fila() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_registrar_impedimento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_assumir_item_fila() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_registrar_impedimento(uuid, text) TO authenticated, service_role;

DROP POLICY IF EXISTS rls_locks_ativos_avaliador_insere ON public.locks_ativos;
DROP POLICY IF EXISTS rls_historico_impedimentos_avaliador_insere ON public.historico_impedimentos;
DROP POLICY IF EXISTS rls_fila_avaliador_atualiza ON public.fila_atribuicoes_direcionadas;

-- ---------------------------------------------------------------------------
-- A4: CPF e celular fora da leitura de usuários logados (Admin grava pelas funções)
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.usuarios FROM authenticated;
GRANT SELECT (id_usuario, email, nome, papel, created_at, id_auth) ON public.usuarios TO authenticated;

-- ---------------------------------------------------------------------------
-- A5: Staff credencia só avaliadores
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rls_avaliadores_evento_staff_insere ON public.avaliadores_evento;
DROP POLICY IF EXISTS rls_avaliadores_evento_staff_atualiza ON public.avaliadores_evento;
CREATE POLICY rls_avaliadores_evento_staff_insere ON public.avaliadores_evento FOR INSERT TO authenticated
  WITH CHECK (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id_usuario = avaliadores_evento.id_usuario AND upper(u.papel::text) = 'AVALIADOR'));
CREATE POLICY rls_avaliadores_evento_staff_atualiza ON public.avaliadores_evento FOR UPDATE TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id_usuario = avaliadores_evento.id_usuario AND upper(u.papel::text) = 'AVALIADOR'))
  WITH CHECK (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id_usuario = avaliadores_evento.id_usuario AND upper(u.papel::text) = 'AVALIADOR'));

-- ---------------------------------------------------------------------------
-- A6: contagem de uso de questionário só para o Admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_avaliacoes_do_questionario(p_id_questionario uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
REVOKE ALL ON FUNCTION public.fn_avaliacoes_do_questionario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_avaliacoes_do_questionario(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A7: anon só lê os cadastros públicos (autocadastro e Telão gravam por função)
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.areas_tematicas, public.eventos, public.instituicao_aliases, public.instituicoes,
  public.modalidade_aliases, public.modalidades, public.perguntas_questionario, public.projetos,
  public.questionarios
FROM anon;

-- ---------------------------------------------------------------------------
-- A8
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.admin_reset_global(uuid) SET search_path = public, pg_temp;

NOTIFY pgrst, 'reload schema';

COMMIT;
