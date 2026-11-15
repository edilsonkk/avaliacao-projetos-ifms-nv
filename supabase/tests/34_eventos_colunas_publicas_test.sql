-- Achado 3 da auditoria: `anon` lê o catálogo público de `eventos`, e só ele.
-- A política `rls_eventos_leitura` continua USING (true); a fronteira é a permissão por coluna.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

-- ---------------------------------------------------------------------------
-- O que a tela de login e o autocadastro pelo QR Code leem antes de existir sessão
-- ---------------------------------------------------------------------------
SELECT ok(has_column_privilege('anon', 'public.eventos', 'id_evento', 'SELECT'),
          'anon lê id_evento (o autocadastro acha o evento ativo)');
SELECT ok(has_column_privilege('anon', 'public.eventos', 'nome_evento', 'SELECT'),
          'anon lê nome_evento');
SELECT ok(has_column_privilege('anon', 'public.eventos', 'is_ativo', 'SELECT'),
          'anon lê is_ativo (filtro da consulta do autocadastro)');
SELECT ok(has_column_privilege('anon', 'public.eventos', 'edicao', 'SELECT'),
          'anon lê edicao');
SELECT ok(has_column_privilege('anon', 'public.eventos', 'horario_inicio', 'SELECT'),
          'anon lê horario_inicio');
SELECT ok(has_column_privilege('anon', 'public.eventos', 'cota_avaliacoes_padrao', 'SELECT'),
          'anon lê cota_avaliacoes_padrao (mapa de estandes)');

-- ---------------------------------------------------------------------------
-- O que calibra força bruta no código de acesso: fora do alcance de anon
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_column_privilege('anon', 'public.eventos', 'tamanho_codigo', 'SELECT'),
          'anon não lê tamanho_codigo');
SELECT ok(NOT has_column_privilege('anon', 'public.eventos', 'max_tentativas_codigo', 'SELECT'),
          'anon não lê max_tentativas_codigo');
SELECT ok(NOT has_column_privilege('anon', 'public.eventos', 'minutos_validade_codigo_acesso', 'SELECT'),
          'anon não lê minutos_validade_codigo_acesso');
SELECT ok(NOT has_column_privilege('anon', 'public.eventos', 'minutos_validade_pareamento', 'SELECT'),
          'anon não lê minutos_validade_pareamento');

-- ---------------------------------------------------------------------------
-- O que antecipa resultado ou expõe ajuste interno
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_column_privilege('anon', 'public.eventos', 'limite_corte', 'SELECT'),
          'anon não lê limite_corte (corte da premiação antes do resultado)');
SELECT ok(NOT has_column_privilege('anon', 'public.eventos', 'minutos_timeout_lock', 'SELECT'),
          'anon não lê minutos_timeout_lock');

-- ---------------------------------------------------------------------------
-- Admin e Staff continuam com a tabela inteira (`select('*')` nas telas de administração)
-- ---------------------------------------------------------------------------
SELECT ok(has_column_privilege('authenticated', 'public.eventos', 'limite_corte', 'SELECT'),
          'authenticated continua lendo a linha inteira');

SELECT * FROM finish();
ROLLBACK;
