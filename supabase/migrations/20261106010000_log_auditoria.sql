-- ==============================================================================
-- MIGRATION: 20261106010000_log_auditoria.sql
-- DESCRIÇÃO: trilha de auditoria append-only para conferência de notas.
--   * public.log_auditoria: uma linha por alteração relevante, com quem, quando,
--     de onde veio, o antes e o depois. Ninguém pode editar nem apagar linha:
--     não há policy de escrita, os GRANT são revogados e um trigger recusa
--     UPDATE/DELETE/TRUNCATE até para o dono da tabela.
--   * A gravação é por TRIGGER, não por RPC. É o único jeito de registrar também
--     a escrita direta na API REST: a policy rls_*_admin é FOR ALL (ADR 0006), e
--     um "UPDATE avaliacoes SET nota_final = 10" não passava por nenhuma função.
--   * public.auditoria_marcar_origem(): cada RPC confiável se identifica numa
--     variável local à transação. O que não se identifica fica como 'direto' e a
--     tela de auditoria destaca em vermelho. Decisão: registrar e alertar, não
--     impedir (ADR 0014). As chamadas dentro de cada RPC entram na migration
--     20261106040000, que já reescreve essas funções por outro motivo.
--   * O log cobre notas, respostas, pesos/escala do questionário, check-in, cota,
--     competição, quarentena resolvida, credenciamento (hora e autor, que antes
--     não existiam em lugar nenhum), pareamento, papel do usuário e evento.
-- FRONT-END: compatível com a versão anterior (tabela e funções novas).
-- PRÉ-REQUISITOS: public.is_admin() (20261026000000), public.evento_ativo_id()
--   (20261028210000), public.avaliador_atual() (20261101190000).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. A tabela da trilha
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.log_auditoria (
  id_log           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  id_evento        uuid,
  tabela           text NOT NULL,
  operacao         text NOT NULL,
  acao             text NOT NULL,
  id_registro      text,
  id_projeto       uuid,
  id_avaliacao     uuid,
  ator_auth        uuid,
  ator_usuario     uuid,
  ator_papel       text,
  origem           text NOT NULL,
  motivo           text,
  dados_antes      jsonb,
  dados_depois     jsonb,
  campos_alterados text[],
  CONSTRAINT log_auditoria_operacao_check
    CHECK (operacao IN ('INSERT', 'UPDATE', 'DELETE', 'EVENTO'))
);

COMMENT ON TABLE public.log_auditoria IS
  'Trilha de auditoria append-only. Preenchida por trigger, inclusive quando a escrita vem direto da API REST. Sobrevive ao reset global.';
COMMENT ON COLUMN public.log_auditoria.origem IS
  'Nome da RPC que se identificou por auditoria_marcar_origem(), ou ''direto'' quando a escrita não passou por função nenhuma.';
COMMENT ON COLUMN public.log_auditoria.acao IS
  'Rótulo semântico estável (nota_alterada, credenciamento_concedido, check_in_realizado...). A interface traduz para português.';
COMMENT ON COLUMN public.log_auditoria.operacao IS
  'INSERT/UPDATE/DELETE da trigger, ou EVENTO para registro feito por RPC (reset global, por exemplo).';

CREATE INDEX IF NOT EXISTS idx_log_auditoria_evento      ON public.log_auditoria (id_evento, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_log_auditoria_projeto     ON public.log_auditoria (id_projeto) WHERE id_projeto IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_auditoria_avaliacao   ON public.log_auditoria (id_avaliacao) WHERE id_avaliacao IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_auditoria_tabela      ON public.log_auditoria (tabela, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_log_auditoria_fora_fluxo  ON public.log_auditoria (criado_em DESC) WHERE origem = 'direto';

-- ------------------------------------------------------------------------------
-- 2. Append-only: só o Admin lê, e ninguém altera
--    Atenção: este banco tem ALTER DEFAULT PRIVILEGES concedendo ALL ON TABLES a
--    anon e authenticated. Sem o REVOKE abaixo, a trilha nasceria gravável.
-- ------------------------------------------------------------------------------
ALTER TABLE public.log_auditoria ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.log_auditoria FROM anon, authenticated;
GRANT SELECT ON TABLE public.log_auditoria TO authenticated;
GRANT ALL    ON TABLE public.log_auditoria TO service_role;

-- A sequência e a função da trigger também nascem abertas por ALTER DEFAULT PRIVILEGES
REVOKE ALL ON SEQUENCE public.log_auditoria_id_log_seq FROM anon, authenticated;

DROP POLICY IF EXISTS rls_log_auditoria_admin_le ON public.log_auditoria;
CREATE POLICY rls_log_auditoria_admin_le ON public.log_auditoria
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Sem policy de INSERT/UPDATE/DELETE: a trigger grava como dono da tabela.

CREATE OR REPLACE FUNCTION public.fn_log_auditoria_imutavel() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'A trilha de auditoria é append-only: % em log_auditoria não é permitido.', TG_OP
    USING ERRCODE = '42501';
END $$;

ALTER FUNCTION public.fn_log_auditoria_imutavel() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_log_auditoria_imutavel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS log_auditoria_imutavel_linha ON public.log_auditoria;
CREATE TRIGGER log_auditoria_imutavel_linha
  BEFORE UPDATE OR DELETE ON public.log_auditoria
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_auditoria_imutavel();

DROP TRIGGER IF EXISTS log_auditoria_imutavel_truncate ON public.log_auditoria;
CREATE TRIGGER log_auditoria_imutavel_truncate
  BEFORE TRUNCATE ON public.log_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_log_auditoria_imutavel();

-- ------------------------------------------------------------------------------
-- 3. Origem e motivo: como uma RPC confiável se identifica
--    set_config(..., true) vale só dentro da transação. Uma requisição direta do
--    PostgREST não passa por nenhuma RPC, então a variável não existe e a origem
--    fica 'direto'.
--    Estas funções NÃO podem ser chamáveis pela API (senão a origem seria
--    forjável): o REVOKE é obrigatório, porque o banco concede ALL ON FUNCTIONS
--    a anon e authenticated por padrão.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auditoria_marcar_origem(p_origem text, p_motivo text DEFAULT NULL)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM set_config('app.auditoria_origem', coalesce(p_origem, 'direto'), true);
  PERFORM set_config('app.auditoria_motivo', coalesce(nullif(btrim(p_motivo), ''), ''), true);
END $$;

CREATE OR REPLACE FUNCTION public.auditoria_origem() RETURNS text
  LANGUAGE sql STABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(nullif(current_setting('app.auditoria_origem', true), ''), 'direto');
$$;

CREATE OR REPLACE FUNCTION public.auditoria_motivo() RETURNS text
  LANGUAGE sql STABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT nullif(current_setting('app.auditoria_motivo', true), '');
$$;

-- Quem está agindo: Admin/Staff vêm de usuarios; o avaliador vem do aparelho
-- vinculado (o auth.uid() dele é do dispositivo, não da conta).
CREATE OR REPLACE FUNCTION public.auditoria_ator()
  RETURNS TABLE (id_usuario uuid, papel text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT u.id_usuario, upper(u.papel::text)
  FROM public.usuarios u
  WHERE u.id_usuario = coalesce(
    (SELECT x.id_usuario
       FROM public.usuarios x
      WHERE auth.uid() IS NOT NULL
        AND (x.id_usuario = auth.uid() OR x.id_auth = auth.uid())
      LIMIT 1),
    public.avaliador_atual()
  )
  LIMIT 1;
$$;

ALTER FUNCTION public.auditoria_marcar_origem(text, text) OWNER TO postgres;
ALTER FUNCTION public.auditoria_origem() OWNER TO postgres;
ALTER FUNCTION public.auditoria_motivo() OWNER TO postgres;
ALTER FUNCTION public.auditoria_ator() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.auditoria_marcar_origem(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auditoria_ator()                    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auditoria_origem() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auditoria_motivo() TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. Registro feito à mão por uma RPC (o que não é mudança de linha)
--    Usado, por exemplo, pelo reset global para dizer o que apagou.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auditoria_registrar(
  p_acao      text,
  p_tabela    text,
  p_id_evento uuid DEFAULT NULL,
  p_dados     jsonb DEFAULT NULL,
  p_motivo    text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ator record;
BEGIN
  SELECT * INTO v_ator FROM public.auditoria_ator();

  INSERT INTO public.log_auditoria (
    id_evento, tabela, operacao, acao, ator_auth, ator_usuario, ator_papel,
    origem, motivo, dados_depois
  ) VALUES (
    coalesce(p_id_evento, public.evento_ativo_id()), p_tabela, 'EVENTO', p_acao,
    auth.uid(), v_ator.id_usuario, v_ator.papel,
    public.auditoria_origem(), coalesce(nullif(btrim(p_motivo), ''), public.auditoria_motivo()), p_dados
  );
END $$;

ALTER FUNCTION public.auditoria_registrar(text, text, uuid, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auditoria_registrar(text, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. A trigger genérica
--    TG_ARGV[0] = nome da entidade (rótulo base da ação).
--    Resolve o escopo do evento (regra 5 do AGENTS.md), compara antes e depois,
--    e refina o rótulo quando a mudança tem significado próprio.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auditar() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_entidade     text := TG_ARGV[0];
  v_antes        jsonb;
  v_depois       jsonb;
  v_linha        jsonb;
  v_campos       text[];
  v_acao         text;
  v_id_evento    uuid;
  v_id_projeto   uuid;
  v_id_avaliacao uuid;
  v_id_registro  text;
  v_ator         record;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_antes  := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_depois := to_jsonb(NEW); END IF;
  v_linha := coalesce(v_depois, v_antes);

  -- Dado pessoal não entra na trilha (LGPD): o log diz que o cadastro mudou,
  -- não guarda uma segunda cópia do CPF e do celular.
  IF TG_TABLE_NAME = 'usuarios' THEN
    v_antes  := v_antes  - 'cpf' - 'celular' - 'id_auth';
    v_depois := v_depois - 'cpf' - 'celular' - 'id_auth';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO v_campos
    FROM jsonb_object_keys(v_depois) AS k
    WHERE (v_antes -> k) IS DISTINCT FROM (v_depois -> k);

    -- UPDATE que não mudou nada não vira linha de log (evita ruído)
    IF v_campos IS NULL OR cardinality(v_campos) = 0 THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Escopo: evento, projeto e avaliação de cada tabela
  CASE TG_TABLE_NAME
    WHEN 'avaliacoes' THEN
      v_id_avaliacao := (v_linha ->> 'id_avaliacao')::uuid;
      v_id_projeto   := (v_linha ->> 'id_projeto')::uuid;
      v_id_registro  := v_linha ->> 'id_avaliacao';
      SELECT p.id_evento INTO v_id_evento FROM public.projetos p WHERE p.id_projeto = v_id_projeto;
    WHEN 'respostas_avaliacao' THEN
      v_id_avaliacao := (v_linha ->> 'id_avaliacao')::uuid;
      v_id_registro  := v_linha ->> 'id_resposta';
      SELECT a.id_projeto, p.id_evento INTO v_id_projeto, v_id_evento
        FROM public.avaliacoes a
        JOIN public.projetos p ON p.id_projeto = a.id_projeto
       WHERE a.id_avaliacao = v_id_avaliacao;
    WHEN 'projetos' THEN
      v_id_projeto  := (v_linha ->> 'id_projeto')::uuid;
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'codigo_projeto';
    WHEN 'perguntas_questionario' THEN
      v_id_registro := v_linha ->> 'id_pergunta';
      SELECT q.id_evento INTO v_id_evento
        FROM public.questionarios q
       WHERE q.id_questionario = (v_linha ->> 'id_questionario')::uuid;
    WHEN 'questionarios' THEN
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'id_questionario';
    WHEN 'avaliadores_evento' THEN
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'id_usuario';
    WHEN 'dispositivos_avaliador' THEN
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'id_usuario';
    WHEN 'eventos' THEN
      v_id_evento   := (v_linha ->> 'id_evento')::uuid;
      v_id_registro := v_linha ->> 'id_evento';
    WHEN 'usuarios' THEN
      v_id_evento   := public.evento_ativo_id();
      v_id_registro := v_linha ->> 'id_usuario';
    ELSE
      v_id_evento   := public.evento_ativo_id();
  END CASE;

  -- Rótulo: a entidade, refinada quando a mudança tem nome próprio
  v_acao := v_entidade;

  IF TG_TABLE_NAME = 'avaliacoes' THEN
    IF TG_OP = 'INSERT' THEN
      v_acao := 'avaliacao_criada';
    ELSIF TG_OP = 'DELETE' THEN
      v_acao := 'avaliacao_apagada';
    ELSIF 'nota_final' = ANY (v_campos) THEN
      v_acao := 'nota_alterada';
    ELSIF 'status' = ANY (v_campos) THEN
      v_acao := CASE WHEN upper(coalesce(v_depois ->> 'status', '')) = 'CANCELADA'
                     THEN 'avaliacao_cancelada' ELSE 'avaliacao_restaurada' END;
    ELSIF 'is_quarentena' = ANY (v_campos) THEN
      v_acao := CASE WHEN (v_depois ->> 'is_quarentena')::boolean
                     THEN 'quarentena_marcada' ELSE 'quarentena_desmarcada' END;
    END IF;
  ELSIF TG_TABLE_NAME = 'avaliadores_evento' THEN
    v_acao := CASE WHEN coalesce((v_depois ->> 'is_credenciado')::boolean, false)
                   THEN 'credenciamento_concedido' ELSE 'credenciamento_suspenso' END;
  ELSIF TG_TABLE_NAME = 'dispositivos_avaliador' THEN
    v_acao := CASE
                WHEN TG_OP = 'DELETE' OR (v_depois ->> 'revogado_em') IS NOT NULL THEN 'dispositivo_revogado'
                ELSE 'dispositivo_vinculado'
              END;
  ELSIF TG_TABLE_NAME = 'projetos' AND TG_OP = 'UPDATE' THEN
    IF 'is_check_in_realizado' = ANY (v_campos) THEN
      v_acao := CASE WHEN coalesce((v_depois ->> 'is_check_in_realizado')::boolean, false)
                     THEN 'check_in_realizado' ELSE 'check_in_desfeito' END;
    ELSIF 'quarentena_resolvida_em' = ANY (v_campos) THEN
      v_acao := 'quarentena_resolvida';
    ELSIF 'cota_avaliacoes_customizada' = ANY (v_campos) THEN
      v_acao := 'cota_alterada';
    ELSIF 'is_fora_da_competicao' = ANY (v_campos) THEN
      v_acao := 'competicao_alterada';
    ELSIF 'id_questionario_fixado' = ANY (v_campos) THEN
      v_acao := 'questionario_fixado';
    END IF;
  ELSIF TG_TABLE_NAME = 'perguntas_questionario' AND TG_OP = 'UPDATE' THEN
    IF 'peso_calculo' = ANY (v_campos) THEN
      v_acao := 'peso_calculo_alterado';
    ELSIF 'peso_desempate' = ANY (v_campos) THEN
      v_acao := 'peso_desempate_alterado';
    END IF;
  ELSIF TG_TABLE_NAME = 'questionarios' AND TG_OP = 'UPDATE' THEN
    IF 'escala_minima' = ANY (v_campos) OR 'escala_maxima' = ANY (v_campos) THEN
      v_acao := 'escala_alterada';
    END IF;
  ELSIF TG_TABLE_NAME = 'usuarios' AND TG_OP = 'UPDATE' AND 'papel' = ANY (v_campos) THEN
    v_acao := 'papel_alterado';
  END IF;

  SELECT * INTO v_ator FROM public.auditoria_ator();

  INSERT INTO public.log_auditoria (
    id_evento, tabela, operacao, acao, id_registro, id_projeto, id_avaliacao,
    ator_auth, ator_usuario, ator_papel, origem, motivo,
    dados_antes, dados_depois, campos_alterados
  ) VALUES (
    v_id_evento, TG_TABLE_NAME, TG_OP, v_acao, v_id_registro, v_id_projeto, v_id_avaliacao,
    auth.uid(), v_ator.id_usuario, v_ator.papel,
    public.auditoria_origem(), public.auditoria_motivo(),
    v_antes, v_depois, v_campos
  );

  RETURN NULL; -- AFTER trigger: o retorno é ignorado
END $$;

ALTER FUNCTION public.fn_auditar() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_auditar() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 6. Onde a trilha escuta
--    respostas_avaliacao só em UPDATE/DELETE: o INSERT do envio já fica
--    registrado na linha da avaliação, e logar cada resposta encheria o log de
--    N linhas por avaliação enviada.
--    projetos escuta uma lista fechada de colunas: as que mexem com nota, cota,
--    competição, pódio (modalidade/área) e identificação. Estande, corredor e
--    fila são operação pura e ficam de fora para a trilha não virar ruído.
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS auditar_avaliacoes ON public.avaliacoes;
CREATE TRIGGER auditar_avaliacoes
  AFTER INSERT OR UPDATE OR DELETE ON public.avaliacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('avaliacao');

DROP TRIGGER IF EXISTS auditar_respostas_avaliacao ON public.respostas_avaliacao;
CREATE TRIGGER auditar_respostas_avaliacao
  AFTER UPDATE OR DELETE ON public.respostas_avaliacao
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('resposta_alterada');

DROP TRIGGER IF EXISTS auditar_perguntas_questionario ON public.perguntas_questionario;
CREATE TRIGGER auditar_perguntas_questionario
  AFTER INSERT OR UPDATE OR DELETE ON public.perguntas_questionario
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('pergunta');

DROP TRIGGER IF EXISTS auditar_questionarios ON public.questionarios;
CREATE TRIGGER auditar_questionarios
  AFTER INSERT OR UPDATE OR DELETE ON public.questionarios
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('questionario');

DROP TRIGGER IF EXISTS auditar_projetos ON public.projetos;
CREATE TRIGGER auditar_projetos
  AFTER INSERT OR DELETE OR UPDATE OF
    codigo_projeto, titulo, id_evento, id_instituicao, id_area, id_modalidade,
    id_questionario_fixado, cota_avaliacoes_customizada, is_check_in_realizado,
    is_fora_da_competicao, quarentena_resolvida_em, quarentena_resolvida_por
  ON public.projetos
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('projeto');

DROP TRIGGER IF EXISTS auditar_avaliadores_evento ON public.avaliadores_evento;
CREATE TRIGGER auditar_avaliadores_evento
  AFTER INSERT OR UPDATE OR DELETE ON public.avaliadores_evento
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('credenciamento');

DROP TRIGGER IF EXISTS auditar_dispositivos_avaliador ON public.dispositivos_avaliador;
CREATE TRIGGER auditar_dispositivos_avaliador
  AFTER INSERT OR UPDATE OR DELETE ON public.dispositivos_avaliador
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('dispositivo');

DROP TRIGGER IF EXISTS auditar_usuarios ON public.usuarios;
CREATE TRIGGER auditar_usuarios
  AFTER DELETE OR UPDATE OF papel ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('usuario');

DROP TRIGGER IF EXISTS auditar_eventos ON public.eventos;
CREATE TRIGGER auditar_eventos
  AFTER UPDATE ON public.eventos
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditar('evento');

COMMIT;
