-- O front-end usa embeds do PostgREST como avaliacoes?select=usuarios(nome). Se uma tabela tiver
-- duas FKs para a mesma tabela, o embed falha com PGRST201. Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(1);

SELECT is(
  (SELECT string_agg(format('%s -> %s (%s FKs)', origem, destino, total), '; ' ORDER BY origem, destino)
   FROM (
     SELECT c.conrelid::regclass::text AS origem, c.confrelid::regclass::text AS destino, count(*) AS total
     FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.contype = 'f' AND n.nspname = 'public'
     GROUP BY 1, 2
     HAVING count(*) > 1
   ) d),
  NULL,
  'nenhuma tabela tem duas FKs para a mesma tabela (embed do PostgREST ficaria ambíguo)'
);

SELECT * FROM finish();
ROLLBACK;
