-- ==============================================================================
-- MIGRATION: 20261030030000_gestor_instituicoes.sql
-- DESCRIÇÃO: instituições sem duplicatas e sem exclusão que desliga o conflito.
--   * nome_normalizado era calculado de três jeitos (a tela de Instituições
--     tirava espaços e pontuação; Projetos/Avaliadores/autocadastro usavam
--     minúsculas + sem acento). A mesma escola entrava duas vezes no evento.
--     Agora um trigger calcula sempre lower(btrim(unaccent(nome_exibicao))), o
--     mesmo critério das outras telas, e as linhas antigas são recalculadas
--     (menos as que colidiriam com outra: essas são duplicatas reais).
--   * A importação fazia upsert ON CONFLICT (nome_normalizado), que não casa
--     com o índice único parcial (id_evento, nome_normalizado): sempre caía no
--     insert simples e falhava se a planilha tivesse uma instituição já
--     cadastrada. admin_salvar_instituicoes grava a planilha numa transação.
--   * Excluir não era barrado: projetos.id_instituicao e
--     avaliadores_evento.id_instituicao são ON DELETE SET NULL, então a
--     exclusão desligava em silêncio a regra de conflito de instituição.
--     admin_excluir_instituicao recusa se houver vínculo.
-- FRONT-END: compatível com a versão anterior.
-- PRÉ-REQUISITO: public.is_admin() (20261026000000), extensão unaccent.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_normalizar_nome(p_texto text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(btrim(extensions.unaccent(coalesce(p_texto, ''))));
$$;

COMMENT ON FUNCTION public.fn_normalizar_nome(text) IS
  'Chave de comparação de nomes (minúsculas, sem acento, sem espaços nas pontas). Igual a normalizarChave() no front.';

CREATE OR REPLACE FUNCTION public.trg_instituicoes_normalizar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Só as pontas: Projetos/Avaliadores comparam sem colapsar espaços internos
  NEW.nome_exibicao := btrim(NEW.nome_exibicao);
  NEW.nome_normalizado := public.fn_normalizar_nome(NEW.nome_exibicao);
  NEW.sigla := nullif(upper(btrim(coalesce(NEW.sigla, ''))), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS instituicoes_normalizar ON public.instituicoes;
CREATE TRIGGER instituicoes_normalizar
  BEFORE INSERT OR UPDATE OF nome_exibicao, nome_normalizado, sigla ON public.instituicoes
  FOR EACH ROW EXECUTE FUNCTION public.trg_instituicoes_normalizar();

-- Recalcula as linhas antigas que não colidem com outra do mesmo evento
UPDATE public.instituicoes i
SET nome_normalizado = public.fn_normalizar_nome(i.nome_exibicao)
WHERE i.nome_normalizado IS DISTINCT FROM public.fn_normalizar_nome(i.nome_exibicao)
  AND NOT EXISTS (
    SELECT 1 FROM public.instituicoes o
    WHERE o.id_instituicao <> i.id_instituicao
      AND o.id_evento IS NOT DISTINCT FROM i.id_evento
      AND public.fn_normalizar_nome(o.nome_exibicao) = public.fn_normalizar_nome(i.nome_exibicao)
  );

-- ------------------------------------------------------------------------------
-- Cadastro manual e importação
--   p_itens: [{nome, sigla?, campus?}]
--   Retorna {cadastradas, atualizadas, ignoradas: [{nome, motivo}]}
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_instituicoes(p_id_evento uuid, p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item        jsonb;
  v_nome        text;
  v_sigla       text;
  v_campus      text;
  v_id          uuid;
  v_cadastradas integer := 0;
  v_atualizadas integer := 0;
  v_ignoradas   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Não há evento ativo para vincular as instituições.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de instituições inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_nome   := btrim(regexp_replace(coalesce(v_item->>'nome', ''), '\s+', ' ', 'g'));
    v_sigla  := nullif(upper(btrim(coalesce(v_item->>'sigla', ''))), '');
    v_campus := nullif(btrim(coalesce(v_item->>'campus', '')), '');

    IF length(v_nome) < 2 OR length(v_nome) > 255 THEN
      v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'Nome ausente ou muito longo.');
      CONTINUE;
    END IF;
    IF length(coalesce(v_sigla, '')) > 50 OR length(coalesce(v_campus, '')) > 150 THEN
      v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'Sigla (até 50) ou câmpus (até 150) muito longos.');
      CONTINUE;
    END IF;

    SELECT id_instituicao INTO v_id FROM public.instituicoes
    WHERE id_evento = p_id_evento AND nome_normalizado = public.fn_normalizar_nome(v_nome)
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado, sigla, campus)
      VALUES (p_id_evento, v_nome, public.fn_normalizar_nome(v_nome), v_sigla, v_campus);
      v_cadastradas := v_cadastradas + 1;
    ELSE
      UPDATE public.instituicoes
      SET sigla = coalesce(v_sigla, sigla), campus = coalesce(v_campus, campus)
      WHERE id_instituicao = v_id;
      v_atualizadas := v_atualizadas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cadastradas', v_cadastradas, 'atualizadas', v_atualizadas, 'ignoradas', v_ignoradas);
END;
$$;

-- ------------------------------------------------------------------------------
-- Exclusão: recusa se houver projeto ou avaliador vinculado
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_excluir_instituicao(p_id_instituicao uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_projetos   integer;
  v_avaliadores integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.instituicoes WHERE id_instituicao = p_id_instituicao FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instituição não encontrada.';
  END IF;
  SELECT count(*) INTO v_projetos FROM public.projetos WHERE id_instituicao = p_id_instituicao;
  SELECT count(*) INTO v_avaliadores FROM public.avaliadores_evento WHERE id_instituicao = p_id_instituicao;
  IF v_projetos + v_avaliadores > 0 THEN
    RAISE EXCEPTION 'A instituição está vinculada a % projeto(s) e % avaliador(es). Troque a instituição deles antes de excluir; senão a regra de conflito de instituição deixaria de valer para eles.', v_projetos, v_avaliadores;
  END IF;
  DELETE FROM public.instituicoes WHERE id_instituicao = p_id_instituicao;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_salvar_instituicoes(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_excluir_instituicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_instituicoes(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_excluir_instituicao(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
