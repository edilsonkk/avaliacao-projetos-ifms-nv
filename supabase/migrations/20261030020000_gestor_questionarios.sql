-- ==============================================================================
-- MIGRATION: 20261030020000_gestor_questionarios.sql
-- DESCRIÇÃO: questionários gravados por funções do banco, sem apagar notas.
--   * A tela gravava questionarios.titulo_questionario e
--     perguntas_questionario.descricao_lembrete, colunas que não existem:
--     criar questionário sempre falhava.
--   * Editar apagava TODAS as perguntas e reinseria. Como
--     respostas_avaliacao.id_pergunta é ON DELETE CASCADE, isso apagava as notas
--     por critério de todas as avaliações feitas com o questionário; o insert
--     seguinte falhava (coluna inexistente) e o questionário ficava sem
--     perguntas, com mensagem de sucesso. Excluir (sem confirmação) também
--     apagava as notas por critério.
--   * perguntas_questionario.descricao_lembrete: texto de ajuda que a tela do
--     avaliador já sabe exibir.
--   * admin_salvar_questionario: cria ou edita numa transação. Questionário já
--     usado em avaliação só pode ter o título alterado.
--   * admin_excluir_questionario: recusa se já foi usado em avaliação.
-- FRONT-END: compatível com a versão anterior (coluna nova opcional, funções
--   novas).
-- PRÉ-REQUISITO: public.is_admin() (20261026000000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

ALTER TABLE public.perguntas_questionario ADD COLUMN IF NOT EXISTS descricao_lembrete text;
COMMENT ON COLUMN public.perguntas_questionario.descricao_lembrete IS
  'Texto de ajuda mostrado ao avaliador abaixo do critério (opcional).';

-- ------------------------------------------------------------------------------
-- Uso: avaliações (de qualquer status) feitas com o questionário
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_avaliacoes_do_questionario(p_id_questionario uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(DISTINCT x.id_avaliacao)::integer FROM (
    SELECT a.id_avaliacao FROM public.avaliacoes a WHERE a.id_questionario = p_id_questionario
    UNION
    SELECT r.id_avaliacao FROM public.respostas_avaliacao r
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE pq.id_questionario = p_id_questionario
  ) x;
$$;

-- ------------------------------------------------------------------------------
-- Criar / editar
--   p_perguntas: [{id_pergunta?, texto_pergunta, descricao_lembrete?, peso_calculo?, peso_desempate?}]
--   A ordem do array é a ordem das perguntas.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_questionario(
  p_id_questionario uuid,
  p_id_evento uuid,
  p_titulo text,
  p_escala_minima numeric,
  p_escala_maxima numeric,
  p_perguntas jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- ------------------------------------------------------------------------------
-- Excluir (só se nunca foi usado)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_excluir_questionario(p_id_questionario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usos integer;
BEGIN
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

REVOKE ALL ON FUNCTION public.fn_avaliacoes_do_questionario(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_salvar_questionario(uuid, uuid, text, numeric, numeric, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_excluir_questionario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_avaliacoes_do_questionario(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_salvar_questionario(uuid, uuid, text, numeric, numeric, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_excluir_questionario(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
