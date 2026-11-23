-- ==============================================================================
-- MIGRATION: 20261122210113_indice_respostas_avaliacao_por_avaliacao.sql
-- DESCRIÇÃO: índice em respostas_avaliacao(id_avaliacao). A tela de Classificação
--   (RankingPremiacao) lê view_ranking_top3 direto, como `authenticated`, e a leitura
--   completa estourava: 79 s medidos num evento de 601 projetos, contra o
--   statement_timeout de 8 s do papel.
--
--   Causa, pelo plano e não por suposição: a tabela só tinha a PK (id_resposta), então
--   o join `respostas_avaliacao r ON r.id_avaliacao = a.id_avaliacao` dentro de
--   fn_chave_desempate caía em Seq Scan da tabela inteira — e a view chama essa função
--   UMA VEZ POR PROJETO. Sob RLS, a policy `rls_respostas_avaliacao_admin USING
--   is_admin()` entra como filtro de linha nesse Seq Scan e, como is_admin() é STABLE
--   (não IMMUTABLE), ela é avaliada uma vez POR LINHA varrida. O custo é
--   projetos × linhas de respostas_avaliacao, ou seja quadrático no tamanho do evento:
--   120 projetos / 4.113 respostas = 2,9 s; 601 projetos / 20.369 respostas = 79 s.
--
--   Com o índice, o Seq Scan vira Index Scan de poucas linhas por chamada e is_admin()
--   deixa de rodar milhares de vezes. Medição da leitura completa do ranking, como
--   `authenticated`, nos mesmos dados (o "antes" é o índice derrubado numa transação
--   revertida): está no ADR docs/decisoes/0018-indice-em-respostas-avaliacao.md.
--
-- POSTURA DE SEGURANÇA: inalterada, de propósito. fn_chave_desempate continua
--   SECURITY INVOKER e view_ranking_top3 continua security_invoker = true, então a RLS
--   de avaliacoes e respostas_avaliacao segue valendo para quem lê: um avaliador
--   continua vendo só as avaliações dele, e `anon` continua recusado com 42501. Nenhum
--   GRANT, REVOKE ou policy muda aqui — um índice não altera visibilidade de linha, só
--   o caminho de acesso. A alternativa de tornar fn_chave_desempate SECURITY DEFINER
--   foi considerada e recusada no ADR: ela abriria as médias por critério de qualquer
--   projeto para toda sessão `authenticated` (inclusive o celular pareado de qualquer
--   avaliador) sem necessidade, já que o índice resolve o custo.
--
--   Efeito colateral bem-vindo: a FK respostas_avaliacao_id_avaliacao_fkey é
--   ON DELETE CASCADE e estava sem índice, então apagar uma avaliação também varria a
--   tabela inteira. Passa a ser busca indexada.
--
-- IDEMPOTENTE: CREATE INDEX IF NOT EXISTS. Sem CONCURRENTLY — o `db push` roda cada
--   arquivo numa transação (docs/banco-de-dados/migrations.md).
-- EXPAND/CONTRACT: compatível com qualquer versão do front-end. Nada muda de schema,
--   assinatura, coluna ou permissão; só o plano de consulta.
-- PRÉ-REQUISITOS: 20261030060000_classificacao.sql (view_ranking_top3) e
--   20261031050000 (fn_chave_desempate).
-- APLICAÇÃO: supabase db push
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_respostas_avaliacao_avaliacao
  ON public.respostas_avaliacao (id_avaliacao);

COMMENT ON INDEX public.idx_respostas_avaliacao_avaliacao IS
  'Busca das respostas de uma avaliação. Sem ele, fn_chave_desempate (uma chamada por projeto em view_ranking_top3) varre respostas_avaliacao inteira e a RLS reavalia is_admin() por linha, o que fazia a Classificação estourar o statement_timeout. Também é o índice da FK ON DELETE CASCADE.';

-- Não há GRANT/REVOKE nem RLS a declarar: índice não é objeto com permissão própria e
-- a RLS de respostas_avaliacao (rls_respostas_avaliacao_admin) continua exatamente como
-- estava. O schema cache do PostgREST também não precisa recarregar — nenhuma coluna,
-- tabela ou função mudou de forma.
