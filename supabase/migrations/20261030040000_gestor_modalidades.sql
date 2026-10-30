-- ==============================================================================
-- MIGRATION: 20261030040000_gestor_modalidades.sql
-- DESCRIÇÃO: modalidades gravadas por funções do banco.
--   * A importação fazia um insert simples de todas as linhas que não foram
--     associadas no De-Para. Linha que já existia (casamento exato) batia no
--     índice único (id_evento, nome_modalidade) e derrubava a planilha inteira:
--     reimportar era impossível. "Associar a existente" também não gravava o
--     apelido, e a próxima planilha de projetos voltava a pedir o De-Para.
--     admin_salvar_modalidades cria ou atualiza por nome (sem diferenciar
--     maiúsculas/acentos) e grava os apelidos, numa transação.
--   * Excluir não era barrado: avaliador_modalidades_bloqueadas é ON DELETE
--     CASCADE e projetos.id_modalidade é ON DELETE SET NULL, então a exclusão
--     apagava os bloqueios dos avaliadores e tirava a modalidade dos projetos
--     (o bloqueio deixava de valer). admin_excluir_modalidade recusa se houver
--     vínculo.
-- FRONT-END: compatível com a versão anterior (só funções novas).
-- PRÉ-REQUISITO: public.is_admin() (20261026000000), public.fn_normalizar_nome
--   (20261030030000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Cadastro manual e importação
--   p_itens: [{nome, codigo?, nivel?, area_tematica?, descricao?, id_existente?}]
--   id_existente: o De-Para associou o nome a uma modalidade já cadastrada;
--   o nome vira apelido dela (nada é criado).
--   Retorna {cadastradas, atualizadas, associadas, ignoradas: [{nome, motivo}]}
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_modalidades(p_id_evento uuid, p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item        jsonb;
  v_nome        text;
  v_codigo      text;
  v_nivel       text;
  v_area        text;
  v_descricao   text;
  v_id          uuid;
  v_cadastradas integer := 0;
  v_atualizadas integer := 0;
  v_associadas  integer := 0;
  v_ignoradas   jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Não há evento ativo para vincular as modalidades.';
  END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de modalidades inválida.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_nome      := btrim(regexp_replace(coalesce(v_item->>'nome', ''), '\s+', ' ', 'g'));
    v_codigo    := nullif(btrim(coalesce(v_item->>'codigo', '')), '');
    v_nivel     := nullif(btrim(coalesce(v_item->>'nivel', '')), '');
    v_area      := nullif(btrim(coalesce(v_item->>'area_tematica', '')), '');
    v_descricao := nullif(btrim(coalesce(v_item->>'descricao', '')), '');

    IF length(v_nome) < 2 OR length(v_nome) > 150 THEN
      v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'Nome ausente ou com mais de 150 caracteres.');
      CONTINUE;
    END IF;
    IF length(coalesce(v_codigo, '')) > 50 OR length(coalesce(v_nivel, '')) > 100 OR length(coalesce(v_area, '')) > 150 THEN
      v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'Código (até 50), nível (até 100) ou área (até 150) muito longos.');
      CONTINUE;
    END IF;

    -- Associação do De-Para: grava o nome como apelido da modalidade escolhida
    IF nullif(v_item->>'id_existente', '') IS NOT NULL THEN
      SELECT id_modalidade INTO v_id FROM public.modalidades
      WHERE id_modalidade = (v_item->>'id_existente')::uuid AND id_evento = p_id_evento;
      IF v_id IS NULL THEN
        v_ignoradas := v_ignoradas || jsonb_build_object('nome', v_nome, 'motivo', 'A modalidade escolhida no De-Para não é deste evento.');
        CONTINUE;
      END IF;
      IF public.fn_normalizar_nome(v_nome) <> (SELECT public.fn_normalizar_nome(nome_modalidade) FROM public.modalidades WHERE id_modalidade = v_id) THEN
        INSERT INTO public.modalidade_aliases (id_modalidade, alias, alias_normalizado)
        VALUES (v_id, v_nome, public.fn_normalizar_nome(v_nome))
        ON CONFLICT (id_modalidade, alias_normalizado) DO NOTHING;
      END IF;
      v_associadas := v_associadas + 1;
      CONTINUE;
    END IF;

    SELECT id_modalidade INTO v_id FROM public.modalidades
    WHERE id_evento = p_id_evento AND public.fn_normalizar_nome(nome_modalidade) = public.fn_normalizar_nome(v_nome)
    ORDER BY created_at
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.modalidades (id_evento, nome_modalidade, codigo, nivel, area_tematica, descricao)
      VALUES (p_id_evento, v_nome, v_codigo, v_nivel, v_area, v_descricao);
      v_cadastradas := v_cadastradas + 1;
    ELSE
      UPDATE public.modalidades
      SET codigo = coalesce(v_codigo, codigo),
          nivel = coalesce(v_nivel, nivel),
          area_tematica = coalesce(v_area, area_tematica),
          descricao = coalesce(v_descricao, descricao)
      WHERE id_modalidade = v_id;
      v_atualizadas := v_atualizadas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cadastradas', v_cadastradas, 'atualizadas', v_atualizadas,
                            'associadas', v_associadas, 'ignoradas', v_ignoradas);
END;
$$;

-- ------------------------------------------------------------------------------
-- Exclusão: recusa se houver projeto ou bloqueio de avaliador
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_excluir_modalidade(p_id_modalidade uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_projetos  integer;
  v_bloqueios integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.modalidades WHERE id_modalidade = p_id_modalidade FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modalidade não encontrada.';
  END IF;
  SELECT count(*) INTO v_projetos FROM public.projetos WHERE id_modalidade = p_id_modalidade;
  SELECT count(*) INTO v_bloqueios FROM public.avaliador_modalidades_bloqueadas WHERE id_modalidade = p_id_modalidade;
  IF v_projetos + v_bloqueios > 0 THEN
    RAISE EXCEPTION 'A modalidade tem % projeto(s) e está bloqueada para % avaliador(es). Mude a modalidade desses projetos e libere os bloqueios antes de excluir.', v_projetos, v_bloqueios;
  END IF;
  DELETE FROM public.modalidades WHERE id_modalidade = p_id_modalidade;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_salvar_modalidades(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_excluir_modalidade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_modalidades(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_excluir_modalidade(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
