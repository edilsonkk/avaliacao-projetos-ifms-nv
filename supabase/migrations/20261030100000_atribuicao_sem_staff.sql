-- ==============================================================================
-- MIGRATION: 20261030100000_atribuicao_sem_staff.sql
-- DESCRIÇÃO: atribuição forçada só para quem é avaliador.
--   * O credenciamento do Staff fica em avaliadores_evento, a mesma tabela dos
--     avaliadores. fn_motivo_inelegivel só conferia o credenciamento, então o
--     Admin conseguia forçar um projeto (banca ou fila) para um Staff, que não
--     pode avaliar: a trava ocupava a vaga do projeto até vencer. Agora recusa
--     com "Usuário não é avaliador" (vale para admin_atribuir_banca e
--     admin_enfileirar_projetos, que usam esta função).
-- FRONT-END: compatível com a versão anterior.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

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

REVOKE ALL ON FUNCTION public.fn_motivo_inelegivel(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_motivo_inelegivel(uuid, uuid) TO service_role;

COMMIT;
