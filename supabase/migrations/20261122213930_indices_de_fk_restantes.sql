-- ==============================================================================
-- MIGRATION: 20261122213930_indices_de_fk_restantes.sql
-- DESCRIÇÃO: quatro índices de chave estrangeira. Continuação de
--   20261122210113 (respostas_avaliacao(id_avaliacao)), que saiu do defeito da
--   Classificação; a varredura do schema achou 14 FKs sem índice de cobertura e estas
--   são as quatro com argumento de desempenho. As outras dez foram avaliadas e
--   dispensadas, com o motivo registrado no fim deste cabeçalho.
--
--   Por que FK sem índice dói duas vezes neste banco: o PostgreSQL não indexa o lado
--   filho de uma FK automaticamente, então (a) toda ação referencial (CASCADE,
--   SET NULL, RESTRICT) varre a tabela filha inteira a cada linha do pai apagada, e
--   (b) quando a consulta vem de uma sessão `authenticated`, a policy de RLS entra
--   como filtro de linha nessa varredura e `is_admin()` — que é STABLE, não IMMUTABLE,
--   logo não é dobrada em constante — é avaliada UMA VEZ POR LINHA VARRIDA. Foi esse
--   segundo efeito que fez a Classificação estourar o statement_timeout.
--
-- ------------------------------------------------------------------------------
-- OS QUATRO ÍNDICES
-- ------------------------------------------------------------------------------
--   1. respostas_avaliacao(id_pergunta) — FK ON DELETE RESTRICT na maior tabela do
--      banco (25.485 linhas / 331 páginas na base de carga). RESTRICT precisa procurar
--      filho a cada pergunta removida, e `admin_salvar_questionario` remove e recria
--      perguntas ao editar um questionário, assim como `admin_excluir_questionario`.
--      Sem índice, cada pergunta tocada varre a tabela inteira.
--
--   2. avaliacoes(id_questionario) — FK ON DELETE SET NULL em tabela grande (3.350
--      linhas). Apagar um questionário precisa achar e anular as avaliações que o
--      apontam; hoje isso é um Seq Scan de avaliacoes por questionário apagado.
--
--   3. historico_impedimentos(id_projeto) — índice do lado filho da FK ON DELETE
--      CASCADE. ATENÇÃO: a suposição de que o `EXISTS (SELECT 1 FROM
--      historico_impedimentos hi WHERE hi.id_projeto = p.id_projeto AND hi.tipo =
--      'ausencia')` de `fn_relatorio_instituicoes_completo` repete o defeito do ranking
--      foi MEDIDA E NÃO SE CONFIRMA. O plano, com 3.005 linhas plantadas e sem índice,
--      mostra `SubPlan 2 -> Seq Scan on historico_impedimentos (actual rows=3005
--      loops=1)`: `loops=1`. O planejador converte o EXISTS correlacionado em SubPlan
--      HASHEADO — varre a tabela uma vez, monta o hash e sonda por projeto, então
--      `is_admin()` roda 3.005 vezes no total, não 601 × 3.005.
--
--      A diferença em relação ao ranking é de natureza, não de grau: lá o que se
--      repetia por projeto era uma CHAMADA DE FUNÇÃO (`fn_chave_desempate`) na lista de
--      seleção da view, e o planejador não consegue hashear nem içar nada por cima de
--      invocações de função — cada uma das 601 chamadas planeja e executa a própria
--      consulta. Subconsulta correlacionada o otimizador resolve; função por linha,
--      não. Fica a lição para a próxima suspeita de lentidão.
--
--      Medido, na leitura completa de `fn_relatorio_instituicoes_completo` em 601
--      projetos: 60 linhas (10% dos projetos, realista) 91 ms sem índice contra 89 ms
--      com; 3.005 linhas (pessimista) 111 ms contra 101 ms. Ganho de ~9% no cenário
--      pessimista. O índice entra pelo lado referencial e por ser barato, NÃO como
--      conserto de um estouro iminente.
--
--   4. perguntas_questionario(id_questionario) — ATENÇÃO, a justificativa não é a que
--      parecia: `fn_validar_respostas` NÃO está no caminho do envio do avaliador (ela
--      é chamada só por `admin_lancar_avaliacao` e `admin_corrigir_respostas_avaliacao`,
--      e as três são SECURITY DEFINER, onde a RLS nem se aplica). O `count(*)` por
--      questionário em todo envio acontece, sim, mas dentro do corpo de
--      `fn_enviar_avaliacao`, que é DEFINER — custo de Seq Scan de 3 páginas, sem
--      policy por linha. O caminho que a RLS realmente encarece é outro:
--      `TelaAvaliador.tsx` lê `perguntas_questionario` DIRETO (por `id_questionario`),
--      como o avaliador, a cada carregamento de questionário — ali a policy
--      `rls_perguntas_questionario_leitura` roda por linha varrida. Mais o lado
--      referencial: a FK é CASCADE e o filho é procurado a cada questionário apagado.
--
-- ------------------------------------------------------------------------------
-- AS DEZ FKs AVALIADAS E DISPENSADAS
-- ------------------------------------------------------------------------------
--   Índice custa escrita em todo INSERT/UPDATE e espaço; nestas o delete é raro e a
--   tabela é pequena, então o índice custaria mais do que rende:
--
--   - avaliador_areas(id_evento) — CASCADE, 330 linhas / 4 páginas. Consultas reais
--     filtram por (id_usuario, id_evento) e já são cobertas pelo índice único
--     (id_usuario, id_evento, id_area), cuja coluna líder é id_usuario;
--   - avaliador_modalidades_bloqueadas(id_evento) — CASCADE, 52 linhas, mesmo caso;
--   - codigos_acesso(id_evento) — CASCADE, tabela vazia fora da feira; a busca viva é
--     por (id_usuario) WHERE usado_em IS NULL, que já tem índice parcial próprio;
--   - pareamentos_pendentes(id_evento) — CASCADE, tabela efêmera (os códigos expiram);
--     a limpeza é por expira_em/auth_uid, não por evento;
--   - projetos(id_instituicao) — SET NULL, 777 linhas / 35 páginas, e apagar
--     instituição é ação de cadastro, rara;
--   - projetos(id_questionario_fixado) — SET NULL, mesma tabela e mesma raridade;
--   - avaliadores_evento(id_instituicao) — SET NULL, 175 linhas;
--   - avaliadores_evento(id_questionario) — SET NULL, 175 linhas;
--   - dispositivos_avaliador(id_evento) — CASCADE, 27 linhas; a busca viva é por
--     (id_usuario) WHERE revogado_em IS NULL, que já tem índice parcial;
--   - locks_ativos(id_projeto) — CASCADE, tabela que esvazia a cada sorteio, e os
--     agregados do Telão e do sorteio a leem INTEIRA de propósito (agrupando por
--     projeto), caso em que o índice não ajudaria nem se existisse.
--
--   Se alguma dessas tabelas crescer de ordem de grandeza, o critério muda e a decisão
--   deve ser revista com medição, não por princípio.
--
-- IDEMPOTENTE: CREATE INDEX IF NOT EXISTS. Sem CONCURRENTLY — o `db push` roda cada
--   arquivo numa transação (docs/banco-de-dados/migrations.md).
-- POSTURA DE SEGURANÇA: inalterada. Índice não altera visibilidade de linha, só o
--   caminho de acesso; nenhuma policy, GRANT ou REVOKE muda, e não há objeto novo com
--   permissão própria a declarar.
-- EXPAND/CONTRACT: trivial. Nada muda de schema, assinatura, coluna ou permissão, então
--   qualquer versão do front-end roda sobre este banco.
-- PRÉ-REQUISITOS: 20261122210113_indice_respostas_avaliacao_por_avaliacao.sql.
-- APLICAÇÃO: supabase db push
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_respostas_avaliacao_pergunta
  ON public.respostas_avaliacao (id_pergunta);
COMMENT ON INDEX public.idx_respostas_avaliacao_pergunta IS
  'Lado filho da FK ON DELETE RESTRICT para perguntas_questionario, na maior tabela do banco. Sem ele, cada pergunta removida (admin_salvar_questionario ao editar, admin_excluir_questionario) varre respostas_avaliacao inteira.';

CREATE INDEX IF NOT EXISTS idx_avaliacoes_questionario
  ON public.avaliacoes (id_questionario);
COMMENT ON INDEX public.idx_avaliacoes_questionario IS
  'Lado filho da FK ON DELETE SET NULL para questionarios. Sem ele, apagar um questionário varre avaliacoes inteira para anular as referências.';

CREATE INDEX IF NOT EXISTS idx_historico_impedimentos_projeto
  ON public.historico_impedimentos (id_projeto);
COMMENT ON INDEX public.idx_historico_impedimentos_projeto IS
  'Lado filho da FK ON DELETE CASCADE para projetos. fn_relatorio_instituicoes_completo também consulta a tabela por EXISTS correlacionado por projeto, mas isso NÃO é o caso do ranking: o planejador converte esse EXISTS em SubPlan hasheado (uma varredura, loops=1), e o ganho medido foi de ~9% com 3.005 linhas. O que o planejador não consegue otimizar é chamada de função por linha, como em view_ranking_top3.';

CREATE INDEX IF NOT EXISTS idx_perguntas_questionario_questionario
  ON public.perguntas_questionario (id_questionario);
COMMENT ON INDEX public.idx_perguntas_questionario_questionario IS
  'TelaAvaliador lê as perguntas por id_questionario direto da tabela, como o avaliador, então a policy de leitura é avaliada por linha varrida. Também é o índice da FK ON DELETE CASCADE.';
