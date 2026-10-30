-- ==============================================================================
-- MIGRATION: 20261030050000_normalizar_nome_igual_front.sql
-- DESCRIÇÃO: chave de nome do banco igual à do front-end.
--   * fn_normalizar_nome usava unaccent, que além dos acentos troca travessão
--     por hífen, aspas curvas por retas e ligaduras (œ → oe). O front
--     (normalizarChave/normalizarTexto) só tira os acentos. Desde que o trigger
--     de instituicoes passou a recalcular nome_normalizado (20261030030000),
--     a importação de projetos com uma instituição nova como "IFMS – Câmpus X"
--     (travessão, comum em planilhas) gravava a chave do banco, não casava com
--     a chave do front e o projeto ficava sem instituição: a regra de conflito
--     de instituição deixava de valer para ele. String.trim() também apara
--     espaço não separável, e btrim não.
--   * Agora: minúsculas, NFD sem os acentos combinantes (U+0300–U+036F) e as
--     pontas aparadas com o mesmo conjunto de espaços de String.trim().
--   * Linhas antigas são recalculadas (menos as que colidiriam com outra).
--   * fn_autocadastro_avaliador passa a procurar a instituição pela mesma chave.
-- FRONT-END: compatível com a versão anterior.
-- PRÉ-REQUISITO: 20261030030000_gestor_instituicoes.sql.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- Mesmo conjunto de espaços que String.prototype.trim()
CREATE OR REPLACE FUNCTION public.fn_aparar_texto(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(
    coalesce(p_texto, ''),
    '^[\s   -     　﻿]+|[\s   -     　﻿]+$',
    '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.fn_normalizar_nome(p_texto text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.fn_aparar_texto(regexp_replace(lower(normalize(coalesce(p_texto, ''), NFD)), '[̀-ͯ]', '', 'g'));
$$;

COMMENT ON FUNCTION public.fn_normalizar_nome(text) IS
  'Chave de comparação de nomes: minúsculas, sem acentos e sem espaços nas pontas. Igual a normalizarChave() no front.';

CREATE OR REPLACE FUNCTION public.trg_instituicoes_normalizar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Só as pontas: Projetos/Avaliadores comparam sem colapsar espaços internos
  NEW.nome_exibicao := public.fn_aparar_texto(NEW.nome_exibicao);
  NEW.nome_normalizado := public.fn_normalizar_nome(NEW.nome_exibicao);
  NEW.sigla := nullif(upper(public.fn_aparar_texto(NEW.sigla)), '');
  RETURN NEW;
END;
$$;

-- Recalcula as linhas que não colidem com outra do mesmo evento
UPDATE public.instituicoes i
SET nome_normalizado = public.fn_normalizar_nome(i.nome_exibicao)
WHERE i.nome_normalizado IS DISTINCT FROM public.fn_normalizar_nome(i.nome_exibicao)
  AND NOT EXISTS (
    SELECT 1 FROM public.instituicoes o
    WHERE o.id_instituicao <> i.id_instituicao
      AND o.id_evento IS NOT DISTINCT FROM i.id_evento
      AND public.fn_normalizar_nome(o.nome_exibicao) = public.fn_normalizar_nome(i.nome_exibicao)
  );

CREATE OR REPLACE FUNCTION public.fn_autocadastro_avaliador(p_id_evento uuid, p_nome text, p_email text, p_id_instituicao uuid, p_nome_instituicao_nova text, p_ids_areas uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_evento   uuid := coalesce(p_id_evento, public.evento_ativo_id());
  v_nome     text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_inst     uuid := p_id_instituicao;
  v_inst_nova text := btrim(regexp_replace(coalesce(p_nome_instituicao_nova, ''), '\s+', ' ', 'g'));
  v_usuario  public.usuarios;
BEGIN
  IF v_evento IS NULL OR NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = v_evento AND is_ativo) THEN
    RAISE EXCEPTION 'Evento não encontrado ou encerrado.';
  END IF;
  IF length(v_nome) < 3 OR length(v_nome) > 150 THEN
    RAISE EXCEPTION 'Informe o nome completo (3 a 150 caracteres).';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;

  SELECT * INTO v_usuario FROM public.usuarios WHERE lower(email) = v_email LIMIT 1;
  IF v_usuario.id_usuario IS NOT NULL THEN
    -- Já existe: não altera nada. Só garante a inscrição no evento, sem
    -- mudar credenciamento nem instituição de quem já está inscrito.
    IF upper(v_usuario.papel::text) = 'AVALIADOR' THEN
      INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado)
      VALUES (v_usuario.id_usuario, v_evento, false)
      ON CONFLICT (id_usuario, id_evento) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('ok', true, 'situacao', 'ja_cadastrado');
  END IF;

  -- Instituição: existente do evento ou nova (a chave é calculada pelo trigger)
  IF v_inst IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.instituicoes WHERE id_instituicao = v_inst AND id_evento = v_evento) THEN
    v_inst := NULL;
  END IF;
  IF v_inst IS NULL AND length(v_inst_nova) BETWEEN 2 AND 200 THEN
    SELECT id_instituicao INTO v_inst FROM public.instituicoes
    WHERE id_evento = v_evento AND nome_normalizado = public.fn_normalizar_nome(v_inst_nova);
    IF v_inst IS NULL THEN
      INSERT INTO public.instituicoes (id_evento, nome_exibicao, nome_normalizado)
      VALUES (v_evento, v_inst_nova, public.fn_normalizar_nome(v_inst_nova))
      RETURNING id_instituicao INTO v_inst;
    END IF;
  END IF;

  INSERT INTO public.usuarios (email, nome, papel) VALUES (v_email, v_nome, 'AVALIADOR')
  RETURNING * INTO v_usuario;
  INSERT INTO public.avaliadores_evento (id_usuario, id_evento, id_instituicao, is_credenciado)
  VALUES (v_usuario.id_usuario, v_evento, v_inst, false);

  IF p_ids_areas IS NOT NULL THEN
    INSERT INTO public.avaliador_areas (id_usuario, id_evento, id_area)
    SELECT v_usuario.id_usuario, v_evento, a.id_area
    FROM public.areas_tematicas a
    WHERE a.id_area = ANY (p_ids_areas) AND a.id_evento = v_evento
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'situacao', 'cadastrado');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_aparar_texto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aparar_texto(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_autocadastro_avaliador(uuid, text, text, uuid, text, uuid[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
