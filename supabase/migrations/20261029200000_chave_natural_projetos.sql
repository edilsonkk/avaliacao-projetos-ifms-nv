-- ==============================================================================
-- MIGRATION: 20261029200000_chave_natural_projetos.sql
-- DESCRIÇÃO: Chave natural de projetos para a importação por planilha.
--   A importação faz upsert por código do projeto, mas a tabela não tinha
--   nenhuma restrição de unicidade nessa coluna: o Postgres recusava com
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--   specification". O código se repete entre edições (FETEC-001 todo ano),
--   então a chave é (id_evento, codigo_projeto).
--   * Códigos com espaços nas pontas são aparados antes, para "A1 " e "A1"
--     não virarem projetos diferentes.
--   * Se já houver código repetido no mesmo evento, a migration para e lista
--     os casos: precisa decidir manualmente qual projeto fica (pode haver
--     avaliações ligadas a cada um).
--   * Projetos sem código continuam permitidos (NULL não conflita).
-- FRONT-END: GestorProjetos passa a usar onConflict 'id_evento,codigo_projeto'
--   (mesmo PR). A versão anterior do front já falhava na importação.
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

UPDATE public.projetos
SET codigo_projeto = nullif(btrim(codigo_projeto), '')
WHERE codigo_projeto IS DISTINCT FROM nullif(btrim(codigo_projeto), '');

DO $$
DECLARE
  v_repetidos text;
BEGIN
  SELECT string_agg(format('%s (evento %s, %s projetos)', codigo_projeto, coalesce(id_evento::text, 'sem evento'), total), '; ')
  INTO v_repetidos
  FROM (
    SELECT id_evento, codigo_projeto, count(*) AS total
    FROM public.projetos
    WHERE codigo_projeto IS NOT NULL
    GROUP BY id_evento, codigo_projeto
    HAVING count(*) > 1
  ) r;

  IF v_repetidos IS NOT NULL THEN
    RAISE EXCEPTION 'Há códigos de projeto repetidos no mesmo evento: %. Resolva antes de aplicar esta migration.', v_repetidos;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_projetos_evento_codigo' AND conrelid = 'public.projetos'::regclass
  ) THEN
    ALTER TABLE public.projetos
      ADD CONSTRAINT uq_projetos_evento_codigo UNIQUE (id_evento, codigo_projeto);
  END IF;
END $$;

COMMENT ON CONSTRAINT uq_projetos_evento_codigo ON public.projetos IS
  'Chave natural da importação: o código do projeto é único dentro do evento.';

COMMIT;
