-- ==============================================================================
-- MIGRATION: 20261123001529_policies_com_initplan.sql
-- DESCRIÇÃO: envolve em subselect escalar toda chamada de função nas policies de RLS
--   — `is_admin()` vira `(SELECT public.is_admin())` e assim por diante. 46 ALTER
--   POLICY em 21 tabelas, que é o conjunto inteiro: das 50 policies de `public`, as
--   outras 4 são `USING (true)` e não chamam função.
--
--   O PORQUÊ: `is_admin()`, `is_staff()`, `avaliador_atual()` e `auth.uid()` são
--   STABLE, não IMMUTABLE, então o planejador não as dobra em constante — numa
--   cláusula USING elas entram como filtro de linha e são avaliadas UMA VEZ POR LINHA
--   VARRIDA. Envolvidas num subselect sem referência externa, viram InitPlan: uma
--   avaliação por comando. Medido no plano, lendo `projetos` como avaliador:
--
--     antes:  Filter: (is_admin() OR is_staff() OR (avaliador_atual() IS NOT NULL))
--             Execution Time: 12.637 ms   (176 linhas)
--     depois: Filter: ((InitPlan 1).col1 OR (InitPlan 2).col1 OR ((InitPlan 3).col1 IS NOT NULL))
--             InitPlan 1..3 -> Result (actual rows=1 loops=1)
--             Execution Time: 0.281 ms
--
--   Custo unitário medido: ~69 µs por linha para a expressão de três funções no
--   caminho do avaliador (`avaliador_atual()` sozinha responde por ~50 µs, porque são
--   três tabelas em join com um EXISTS e uma chamada aninhada a evento_ativo_id());
--   `is_admin()` sozinha, ~9,6 µs por chamada.
--
-- SEMÂNTICA IDÊNTICA, e por que: o critério é que os ARGUMENTOS da chamada não
--   referenciem a linha. As quatro funções são de zero argumento, então `(SELECT f())`
--   devolve o mesmo valor para todas as linhas do comando. O predicado em volta pode
--   variar por linha — `id_usuario = (SELECT avaliador_atual())` continua comparando
--   coluna a coluna; só a chamada é içada. Nada mais foi tocado:
--     - os EXISTS correlacionados à linha (`rls_avaliadores_evento_staff_atualiza`,
--       `..._staff_insere`, `rls_avaliacoes_staff_apaga_pendentes`) ficam como estavam,
--       porque dependem da linha e içá-los mudaria o significado da policy;
--     - `upper((papel)::text) = 'AVALIADOR'` fica como estava, porque `upper` recebe
--       coluna;
--     - as 4 policies `USING (true)` não entram.
--
-- FALHA ALTA, de propósito: são 46 `ALTER POLICY` nus. `ALTER POLICY` não aceita
--   `IF EXISTS` nesta forma e aqui não há `DO $$ ... EXCEPTION` nem bloco que engula
--   ausência: se alguém renomear ou remover uma policy, a migration quebra com 42704
--   em vez de pular em silêncio. Idempotência vem da natureza declarativa do ALTER —
--   rodar duas vezes deixa o mesmo estado.
--
-- LIMITE DO IDIOMA, que precisa ficar registrado: ele resolve policy reavaliada por
--   linha varrida. Ele NÃO protege contra função chamada por linha numa lista de
--   seleção — foi essa, `fn_chave_desempate` por projeto em `view_ranking_top3`, a
--   raiz do estouro da Classificação, e quem a resolveu foi o índice da migration
--   20261122210113. Critério de diagnóstico: subconsulta correlacionada o otimizador
--   resolve (vira SubPlan hasheado, `loops=1`); invocação de função por linha, não.
--   Ver docs/decisoes/0019-policies-com-initplan.md.
--
-- POSTURA DE SEGURANÇA: inalterada. Nenhum papel, GRANT, REVOKE, comando (FOR …) ou
--   conjunto de linhas visível muda; só a forma como a expressão é avaliada. A suíte
--   pgTAP inteira foi rodada contra o idioma antes desta migration existir: 621 ok,
--   0 not ok, inclusive 19_seguranca_matriz_test.sql.
-- EXPAND/CONTRACT: trivial. Nada muda de schema, assinatura, coluna ou permissão.
-- PRÉ-REQUISITOS: nenhum além do schema vigente.
-- APLICAÇÃO: supabase db push
-- ==============================================================================

-- areas_tematicas
ALTER POLICY rls_areas_tematicas_admin ON public.areas_tematicas
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

-- avaliacoes
ALTER POLICY rls_avaliacoes_admin ON public.avaliacoes
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_avaliacoes_leitura ON public.avaliacoes
  USING ((( SELECT public.is_admin() ) OR (id_usuario = ( SELECT public.avaliador_atual() ))));
ALTER POLICY rls_avaliacoes_staff_apaga_pendentes ON public.avaliacoes
  USING ((( SELECT public.is_staff() ) AND (nota_final IS NULL) AND ((status IS NULL) OR ((status)::text <> 'CANCELADA'::text)) AND (NOT (EXISTS ( SELECT 1 FROM respostas_avaliacao r WHERE (r.id_avaliacao = avaliacoes.id_avaliacao))))));

-- avaliador_areas
ALTER POLICY rls_areas_leitura ON public.avaliador_areas
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() ) OR (id_usuario = ( SELECT public.avaliador_atual() ))));
ALTER POLICY rls_areas_staff_apaga ON public.avaliador_areas
  USING (( SELECT public.is_staff() ));
ALTER POLICY rls_areas_staff_atualiza ON public.avaliador_areas
  USING (( SELECT public.is_staff() ))
  WITH CHECK (( SELECT public.is_staff() ));
ALTER POLICY rls_areas_staff_insere ON public.avaliador_areas
  WITH CHECK (( SELECT public.is_staff() ));
ALTER POLICY rls_avaliador_areas_admin ON public.avaliador_areas
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

-- avaliador_modalidades_bloqueadas
ALTER POLICY rls_amb_leitura ON public.avaliador_modalidades_bloqueadas
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() ) OR (id_usuario = ( SELECT public.avaliador_atual() ))));
ALTER POLICY rls_amb_staff_apaga ON public.avaliador_modalidades_bloqueadas
  USING (( SELECT public.is_staff() ));
ALTER POLICY rls_amb_staff_atualiza ON public.avaliador_modalidades_bloqueadas
  USING (( SELECT public.is_staff() ))
  WITH CHECK (( SELECT public.is_staff() ));
ALTER POLICY rls_amb_staff_insere ON public.avaliador_modalidades_bloqueadas
  WITH CHECK (( SELECT public.is_staff() ));
ALTER POLICY rls_avaliador_modalidades_bloqueadas_admin ON public.avaliador_modalidades_bloqueadas
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

-- avaliadores_evento
ALTER POLICY rls_avaliadores_evento_admin ON public.avaliadores_evento
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_avaliadores_evento_leitura ON public.avaliadores_evento
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() ) OR (id_usuario = ( SELECT public.avaliador_atual() ))));
ALTER POLICY rls_avaliadores_evento_staff_atualiza ON public.avaliadores_evento
  USING ((( SELECT public.is_staff() ) AND (EXISTS ( SELECT 1 FROM usuarios u WHERE ((u.id_usuario = avaliadores_evento.id_usuario) AND (upper((u.papel)::text) = 'AVALIADOR'::text))))))
  WITH CHECK ((( SELECT public.is_staff() ) AND (EXISTS ( SELECT 1 FROM usuarios u WHERE ((u.id_usuario = avaliadores_evento.id_usuario) AND (upper((u.papel)::text) = 'AVALIADOR'::text))))));
ALTER POLICY rls_avaliadores_evento_staff_insere ON public.avaliadores_evento
  WITH CHECK ((( SELECT public.is_staff() ) AND (EXISTS ( SELECT 1 FROM usuarios u WHERE ((u.id_usuario = avaliadores_evento.id_usuario) AND (upper((u.papel)::text) = 'AVALIADOR'::text))))));

-- eventos
ALTER POLICY rls_eventos_admin ON public.eventos
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

-- fila_atribuicoes_direcionadas
ALTER POLICY rls_fila_atribuicoes_direcionadas_admin ON public.fila_atribuicoes_direcionadas
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_fila_leitura ON public.fila_atribuicoes_direcionadas
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() ) OR (id_usuario = ( SELECT public.avaliador_atual() ))));
ALTER POLICY rls_fila_staff_apaga ON public.fila_atribuicoes_direcionadas
  USING (( SELECT public.is_staff() ));

-- historico_impedimentos
ALTER POLICY rls_historico_impedimentos_admin ON public.historico_impedimentos
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_historico_impedimentos_leitura ON public.historico_impedimentos
  USING ((( SELECT public.is_admin() ) OR (id_usuario = ( SELECT public.avaliador_atual() ))));

-- instituicao_aliases
ALTER POLICY rls_instituicao_aliases_admin ON public.instituicao_aliases
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_instituicao_aliases_leitura ON public.instituicao_aliases
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() )));

-- instituicoes
ALTER POLICY rls_instituicoes_admin ON public.instituicoes
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

-- locks_ativos
ALTER POLICY rls_locks_ativos_admin ON public.locks_ativos
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_locks_ativos_apaga ON public.locks_ativos
  USING ((( SELECT public.is_staff() ) OR (id_usuario = ( SELECT public.avaliador_atual() ))));
ALTER POLICY rls_locks_ativos_leitura ON public.locks_ativos
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() ) OR (id_usuario = ( SELECT public.avaliador_atual() ))));

-- log_auditoria
ALTER POLICY rls_log_auditoria_admin_le ON public.log_auditoria
  USING (( SELECT public.is_admin() ));

-- modalidade_aliases
ALTER POLICY rls_modalidade_aliases_admin ON public.modalidade_aliases
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_modalidade_aliases_leitura ON public.modalidade_aliases
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() )));

-- modalidades
ALTER POLICY rls_modalidades_admin ON public.modalidades
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

-- modelos_questionario
ALTER POLICY rls_modelos_questionario_leitura ON public.modelos_questionario
  USING (( SELECT public.is_admin() ));

-- perguntas_modelo_questionario
ALTER POLICY rls_perguntas_modelo_questionario_leitura ON public.perguntas_modelo_questionario
  USING (( SELECT public.is_admin() ));

-- perguntas_questionario
ALTER POLICY rls_perguntas_questionario_admin ON public.perguntas_questionario
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_perguntas_questionario_leitura ON public.perguntas_questionario
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() ) OR (( SELECT public.avaliador_atual() ) IS NOT NULL)));

-- projetos
ALTER POLICY rls_projetos_admin ON public.projetos
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_projetos_leitura ON public.projetos
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() ) OR (( SELECT public.avaliador_atual() ) IS NOT NULL)));

-- questionarios
ALTER POLICY rls_questionarios_admin ON public.questionarios
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_questionarios_leitura ON public.questionarios
  USING ((( SELECT public.is_admin() ) OR ( SELECT public.is_staff() ) OR (( SELECT public.avaliador_atual() ) IS NOT NULL)));

-- respostas_avaliacao
ALTER POLICY rls_respostas_avaliacao_admin ON public.respostas_avaliacao
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));

-- usuarios
ALTER POLICY rls_usuarios_admin ON public.usuarios
  USING (( SELECT public.is_admin() ))
  WITH CHECK (( SELECT public.is_admin() ));
ALTER POLICY rls_usuarios_leitura ON public.usuarios
  USING ((( SELECT public.is_admin() ) OR (id_usuario = ( SELECT auth.uid() )) OR (id_usuario = ( SELECT public.avaliador_atual() )) OR (id_auth = ( SELECT auth.uid() )) OR (( SELECT public.is_staff() ) AND (upper((papel)::text) = 'AVALIADOR'::text))));
ALTER POLICY rls_usuarios_staff_atualiza_avaliador ON public.usuarios
  USING ((( SELECT public.is_staff() ) AND (upper((papel)::text) = 'AVALIADOR'::text)))
  WITH CHECK ((( SELECT public.is_staff() ) AND (upper((papel)::text) = 'AVALIADOR'::text)));

