-- ==============================================================================
-- MIGRATION: 20261031060000_crud_modelos_questionario.sql
-- DESCRIÇÃO: CRUD dos questionários prontos (modelos) pelo Admin.
--   * modelos_questionario.is_original marca os 7 modelos do documento
--     "Questionários de Avaliação — Feira de Software".
--   * admin_salvar_modelo_questionario: cria ou edita um modelo. Ao editar, a
--     cópia do modelo no evento ativo também é atualizada, se ainda não foi
--     usada em avaliação; se já foi, fica como está e a resposta avisa.
--   * admin_excluir_modelo_questionario: exclui qualquer modelo; as cópias já
--     ativadas nos eventos continuam existindo.
--   * admin_salvar_questionario_como_modelo: transforma um questionário do
--     evento em modelo.
--   * admin_restaurar_modelos_originais: recria os 7 originais excluídos e
--     devolve o texto original aos editados; modelos do Admin não mudam.
-- FRONT-END: compatível com a versão anterior (coluna e funções novas).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

ALTER TABLE public.modelos_questionario ADD COLUMN IF NOT EXISTS is_original boolean NOT NULL DEFAULT false;
UPDATE public.modelos_questionario SET is_original = true WHERE codigo LIKE 'feira-software-q%' AND NOT is_original;

-- ------------------------------------------------------------------------------
-- Validação comum de título, escala e perguntas (mesmas regras de admin_salvar_questionario)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validar_dados_questionario(p_titulo text, p_escala_minima numeric, p_escala_maxima numeric, p_perguntas jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_titulo text := btrim(regexp_replace(coalesce(p_titulo, ''), '\s+', ' ', 'g'));
BEGIN
  IF length(v_titulo) < 3 OR length(v_titulo) > 255 THEN
    RAISE EXCEPTION 'Informe o título do questionário (3 a 255 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF p_escala_minima IS NULL OR p_escala_maxima IS NULL OR p_escala_minima < 0 OR p_escala_maxima > 100
     OR p_escala_minima >= p_escala_maxima THEN
    RAISE EXCEPTION 'Escala inválida: a mínima precisa ser menor que a máxima (entre 0 e 100).' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_perguntas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_perguntas) = 0 THEN
    RAISE EXCEPTION 'O questionário precisa de pelo menos uma pergunta.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_perguntas) e WHERE btrim(coalesce(e->>'texto_pergunta', '')) = '') THEN
    RAISE EXCEPTION 'Preencha o texto de todas as perguntas.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_perguntas) e
             WHERE coalesce((e->>'peso_calculo')::numeric, 1) <= 0 OR coalesce((e->>'peso_desempate')::numeric, 1) < 0) THEN
    RAISE EXCEPTION 'Os pesos precisam ser positivos.' USING ERRCODE = '22023';
  END IF;
  RETURN v_titulo;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_validar_dados_questionario(text, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Criar / editar modelo
--   p_perguntas: [{texto_pergunta, descricao_lembrete?, peso_calculo?, peso_desempate?}] na ordem
--   Retorno: {id_modelo, copia: 'sem_copia' | 'atualizada' | 'em_uso', usos}
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_modelo_questionario(
  p_id_modelo uuid,
  p_titulo text,
  p_descricao text,
  p_escala_minima numeric,
  p_escala_maxima numeric,
  p_perguntas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_titulo  text;
  v_id      uuid := p_id_modelo;
  v_evento  uuid;
  v_copia   uuid;
  v_usos    integer := 0;
  v_situacao text := 'sem_copia';
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  v_titulo := public.fn_validar_dados_questionario(p_titulo, p_escala_minima, p_escala_maxima, p_perguntas);
  IF length(coalesce(p_descricao, '')) > 2000 THEN
    RAISE EXCEPTION 'Descrição muito longa (máximo de 2000 caracteres).' USING ERRCODE = '22001';
  END IF;

  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    INSERT INTO public.modelos_questionario (id_modelo, codigo, titulo, descricao, escala_minima, escala_maxima, ordem, is_original)
    VALUES (v_id, 'admin-' || v_id, v_titulo, nullif(btrim(coalesce(p_descricao, '')), ''), p_escala_minima, p_escala_maxima,
            (SELECT coalesce(max(ordem), 0) + 1 FROM public.modelos_questionario), false);
  ELSE
    UPDATE public.modelos_questionario
    SET titulo = v_titulo, descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
        escala_minima = p_escala_minima, escala_maxima = p_escala_maxima
    WHERE id_modelo = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = '22023';
    END IF;
    -- Modelos não têm notas: as perguntas podem ser trocadas inteiras
    DELETE FROM public.perguntas_modelo_questionario WHERE id_modelo = v_id;
  END IF;

  INSERT INTO public.perguntas_modelo_questionario (id_modelo, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
  SELECT v_id, e.n::integer, btrim(e.item->>'texto_pergunta'),
         nullif(btrim(coalesce(e.item->>'descricao_lembrete', '')), ''),
         coalesce((e.item->>'peso_calculo')::numeric, 1), coalesce((e.item->>'peso_desempate')::numeric, 1)
  FROM jsonb_array_elements(p_perguntas) WITH ORDINALITY e(item, n);

  -- Cópia no evento ativo: atualizada se ainda não foi usada
  IF p_id_modelo IS NOT NULL THEN
    v_evento := public.evento_ativo_id();
    SELECT q.id_questionario INTO v_copia FROM public.questionarios q
    WHERE q.id_evento = v_evento AND q.id_origem = v_id;
    IF FOUND THEN
      v_usos := public.fn_avaliacoes_do_questionario(v_copia);
      IF v_usos > 0 THEN
        v_situacao := 'em_uso';
      ELSE
        UPDATE public.questionarios
        SET titulo = v_titulo, escala_minima = p_escala_minima, escala_maxima = p_escala_maxima
        WHERE id_questionario = v_copia;
        DELETE FROM public.perguntas_questionario WHERE id_questionario = v_copia;
        INSERT INTO public.perguntas_questionario (id_questionario, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
        SELECT v_copia, pm.ordem, pm.texto_pergunta, pm.descricao_lembrete, pm.peso_calculo, pm.peso_desempate
        FROM public.perguntas_modelo_questionario pm WHERE pm.id_modelo = v_id;
        v_situacao := 'atualizada';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('id_modelo', v_id, 'copia', v_situacao, 'usos', v_usos);
END;
$$;

-- ------------------------------------------------------------------------------
-- Excluir modelo (as cópias nos eventos continuam)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_excluir_modelo_questionario(p_id_modelo uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.modelos_questionario WHERE id_modelo = p_id_modelo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- Salvar um questionário do evento como modelo
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_questionario_como_modelo(p_id_questionario uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q      public.questionarios;
  v_id     uuid := gen_random_uuid();
  v_base   text;
  v_titulo text;
  v_n      integer := 1;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_q FROM public.questionarios WHERE id_questionario = p_id_questionario;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionário não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perguntas_questionario WHERE id_questionario = p_id_questionario) THEN
    RAISE EXCEPTION 'O questionário precisa de pelo menos uma pergunta.' USING ERRCODE = '22023';
  END IF;

  v_base := left(v_q.titulo, 240);
  v_titulo := v_base;
  WHILE EXISTS (SELECT 1 FROM public.modelos_questionario WHERE lower(titulo) = lower(v_titulo)) LOOP
    v_titulo := v_base || CASE WHEN v_n = 1 THEN ' (cópia)' ELSE ' (cópia ' || v_n || ')' END;
    v_n := v_n + 1;
  END LOOP;

  INSERT INTO public.modelos_questionario (id_modelo, codigo, titulo, descricao, escala_minima, escala_maxima, ordem, is_original)
  VALUES (v_id, 'admin-' || v_id, v_titulo, NULL, v_q.escala_minima, v_q.escala_maxima,
          (SELECT coalesce(max(ordem), 0) + 1 FROM public.modelos_questionario), false);
  INSERT INTO public.perguntas_modelo_questionario (id_modelo, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
  SELECT v_id, row_number() OVER (ORDER BY pq.ordem, pq.created_at)::integer, pq.texto_pergunta, pq.descricao_lembrete,
         coalesce(pq.peso_calculo, 1), coalesce(pq.peso_desempate, 1)
  FROM public.perguntas_questionario pq WHERE pq.id_questionario = p_id_questionario;

  -- O questionário passa a ser a cópia do modelo no evento (o interruptor aparece ligado)
  UPDATE public.questionarios SET id_origem = v_id
  WHERE id_questionario = p_id_questionario AND id_origem IS NULL;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- Restaurar os 7 originais
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_restaurar_modelos_originais()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.modelos_questionario (id_modelo, codigo, titulo, descricao, escala_minima, escala_maxima, ordem, is_original) VALUES
    ('0d0de100-0000-4000-8000-000000000001', 'feira-software-q1', 'Técnico · Nível 1 Ideia', 'Projetos com problema e solução definidos, no máximo com wireframes. Núcleo comum (C1–C5) e nível Ideia (I1–I5).', 1, 5, 1, true),
    ('0d0de100-0000-4000-8000-000000000002', 'feira-software-q2', 'Técnico · Nível 2 Protótipo', 'Projetos com interface navegável e ao menos um fluxo principal funcionando, mesmo com dados simulados. Núcleo comum (C1–C5) e nível Protótipo (P1–P5).', 1, 5, 2, true),
    ('0d0de100-0000-4000-8000-000000000003', 'feira-software-q3', 'Técnico · Nível 3 Produção', 'Sistemas implantados e acessíveis (URL, loja ou cliente real), com dados persistidos e usuários reais ou piloto. Núcleo comum (C1–C5) e nível Produção (R1–R5).', 1, 5, 3, true),
    ('0d0de100-0000-4000-8000-000000000004', 'feira-software-q4', 'Convalidação de TCC (ensino médio)', 'Grupos de ensino médio, de qualquer maturidade; a referência é o esperado para um curso técnico de nível médio. Núcleo comum (C1–C5) e trilha ensino médio (E1–E5).', 1, 5, 4, true),
    ('0d0de100-0000-4000-8000-000000000005', 'feira-software-q5', 'Voto popular (visitantes)', 'Visitantes, em cerca de 1 minuto, só para projetos de nível superior; não entra na nota técnica (V1–V3). Atenção: o sistema não tem o fluxo de visitante por QR code; se ativado, aparece aos avaliadores como mais um questionário.', 1, 5, 5, true),
    ('0d0de100-0000-4000-8000-000000000006', 'feira-software-q6', 'Feira de Ciências · Pesquisa científica', 'Projetos avaliados como pesquisa científica: investigam uma pergunta ou hipótese, coletam e analisam dados. 10 critérios de peso igual (CI1–CI10).', 1, 5, 6, true),
    ('0d0de100-0000-4000-8000-000000000007', 'feira-software-q7', 'Feira de Ciências · Pesquisa tecnológica', 'Projetos avaliados como pesquisa tecnológica: constroem um protótipo, processo ou solução para uma necessidade. 10 critérios de peso igual (TE1–TE10).', 1, 5, 7, true)
  ON CONFLICT (codigo) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao,
    escala_minima = EXCLUDED.escala_minima, escala_maxima = EXCLUDED.escala_maxima, is_original = true;

  INSERT INTO public.perguntas_modelo_questionario (id_modelo, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate) VALUES
    ('0d0de100-0000-4000-8000-000000000001', 1, 'Problema e Público-Alvo', 'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais', 1, 1),
    ('0d0de100-0000-4000-8000-000000000001', 2, 'Coerência da Solução', 'Capacidade da solução de resolver o problema, frente a alternativas. Referência — 1: Solução não resolve o problema apresentado · 3: Solução resolve o núcleo do problema · 5: Solução resolve o problema de forma direta e justificada frente a alternativas', 1, 2),
    ('0d0de100-0000-4000-8000-000000000001', 3, 'Domínio Técnico', 'Conhecimento da equipe e justificativa das escolhas técnicas. Referência — 1: Não explica as escolhas técnicas · 3: Explica tecnologias e arquitetura previstas · 5: Justifica escolhas, trade-offs e limitações com segurança; todos os membros respondem', 1, 3),
    ('0d0de100-0000-4000-8000-000000000001', 4, 'Apresentação', 'Clareza, objetividade e cumprimento do tempo. Referência — 1: Confusa, sem foco · 3: Clara e dentro do tempo · 5: Objetiva e envolvente, com bom uso de demonstração ou material visual', 1, 4),
    ('0d0de100-0000-4000-8000-000000000001', 5, 'Originalidade', 'Diferencial em relação ao que já existe. Referência — 1: Cópia de solução existente, sem diferencial · 3: Diferencial identificável · 5: Abordagem nova ou diferencial claro e defensável frente ao mercado', 1, 5),
    ('0d0de100-0000-4000-8000-000000000001', 6, 'Validação do Problema', 'Evidências de contato com usuários ou uso de dados. Referência — 1: Nenhum contato com usuários ou dados · 3: Algumas entrevistas ou dados secundários · 5: Pesquisa estruturada com usuários e achados que moldaram a proposta', 1, 6),
    ('0d0de100-0000-4000-8000-000000000001', 7, 'Análise de Concorrentes', 'Comparação com soluções existentes e lacuna que o projeto ocupa. Referência — 1: Ignora soluções existentes · 3: Lista concorrentes principais · 5: Compara concorrentes e mostra a lacuna que o projeto ocupa', 1, 7),
    ('0d0de100-0000-4000-8000-000000000001', 8, 'Viabilidade Técnica', 'Realismo da arquitetura, dos riscos e do esforço estimados. Referência — 1: Sem noção de como construir · 3: Tecnologias e arquitetura preliminar definidas · 5: Arquitetura, riscos técnicos e esforço estimados de forma realista', 1, 8),
    ('0d0de100-0000-4000-8000-000000000001', 9, 'Representação da Solução', 'Qualidade dos requisitos, wireframes ou protótipo de baixa fidelidade. Referência — 1: Apenas descrição verbal · 3: Wireframes ou requisitos/histórias de usuário · 5: Protótipo de baixa fidelidade testável e requisitos priorizados', 1, 9),
    ('0d0de100-0000-4000-8000-000000000001', 10, 'Plano de Desenvolvimento', 'Escopo do MVP, marcos e critério de sucesso. Referência — 1: Sem próximos passos · 3: Escopo de MVP definido · 5: Roadmap com MVP, marcos e critério de sucesso mensurável', 1, 10),
    ('0d0de100-0000-4000-8000-000000000002', 1, 'Problema e Público-Alvo', 'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais', 1, 1),
    ('0d0de100-0000-4000-8000-000000000002', 2, 'Coerência da Solução', 'Capacidade da solução de resolver o problema, frente a alternativas. Referência — 1: Solução não resolve o problema apresentado · 3: Solução resolve o núcleo do problema · 5: Solução resolve o problema de forma direta e justificada frente a alternativas', 1, 2),
    ('0d0de100-0000-4000-8000-000000000002', 3, 'Domínio Técnico', 'Conhecimento da equipe e justificativa das escolhas técnicas. Referência — 1: Não explica as escolhas técnicas · 3: Explica tecnologias e arquitetura usadas · 5: Justifica escolhas, trade-offs e limitações com segurança; todos os membros respondem', 1, 3),
    ('0d0de100-0000-4000-8000-000000000002', 4, 'Apresentação', 'Clareza, objetividade e cumprimento do tempo. Referência — 1: Confusa, sem foco · 3: Clara e dentro do tempo · 5: Objetiva e envolvente, com bom uso de demonstração ou material visual', 1, 4),
    ('0d0de100-0000-4000-8000-000000000002', 5, 'Originalidade', 'Diferencial em relação ao que já existe. Referência — 1: Cópia de solução existente, sem diferencial · 3: Diferencial identificável · 5: Abordagem nova ou diferencial claro e defensável frente ao mercado', 1, 5),
    ('0d0de100-0000-4000-8000-000000000002', 6, 'Fluxo Principal', 'Funcionamento do fluxo central na demonstração. Referência — 1: Fluxo principal não funciona · 3: Funciona com dados simulados · 5: Fluxo principal e secundários funcionam com dados persistidos', 1, 6),
    ('0d0de100-0000-4000-8000-000000000002', 7, 'Usabilidade e Navegação', 'Facilidade de concluir uma tarefa sem ajuda. Referência — 1: O avaliador se perde ao navegar · 3: Navegação compreensível com orientação · 5: O avaliador completa uma tarefa sozinho, sem ajuda', 1, 7),
    ('0d0de100-0000-4000-8000-000000000002', 8, 'Qualidade da Interface', 'Consistência, legibilidade, responsividade e acessibilidade. Referência — 1: Inconsistente, ilegível · 3: Consistente e legível · 5: Consistente, responsiva e com cuidados básicos de acessibilidade', 1, 8),
    ('0d0de100-0000-4000-8000-000000000002', 9, 'Engenharia do Protótipo', 'Versionamento, organização do código e modelagem. Referência — 1: Sem versionamento nem modelagem · 3: Repositório versionado e modelagem básica (dados, casos de uso) · 5: Código organizado, commits frequentes, modelagem coerente com o implementado', 1, 9),
    ('0d0de100-0000-4000-8000-000000000002', 10, 'Teste com Usuários', 'Feedback de terceiros e ajustes feitos a partir dele. Referência — 1: Nunca testado por terceiros · 3: Testado informalmente por algumas pessoas · 5: Teste de usabilidade registrado e ajustes feitos a partir dele', 1, 10),
    ('0d0de100-0000-4000-8000-000000000003', 1, 'Problema e Público-Alvo', 'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais', 1, 1),
    ('0d0de100-0000-4000-8000-000000000003', 2, 'Coerência da Solução', 'Capacidade da solução de resolver o problema, frente a alternativas. Referência — 1: Solução não resolve o problema apresentado · 3: Solução resolve o núcleo do problema · 5: Solução resolve o problema de forma direta e justificada frente a alternativas', 1, 2),
    ('0d0de100-0000-4000-8000-000000000003', 3, 'Domínio Técnico', 'Conhecimento da equipe e justificativa das escolhas técnicas. Referência — 1: Não explica as escolhas técnicas · 3: Explica tecnologias e arquitetura usadas · 5: Justifica escolhas, trade-offs e limitações com segurança; todos os membros respondem', 1, 3),
    ('0d0de100-0000-4000-8000-000000000003', 4, 'Apresentação', 'Clareza, objetividade e cumprimento do tempo. Referência — 1: Confusa, sem foco · 3: Clara e dentro do tempo · 5: Objetiva e envolvente, com bom uso de demonstração ou material visual', 1, 4),
    ('0d0de100-0000-4000-8000-000000000003', 5, 'Originalidade', 'Diferencial em relação ao que já existe. Referência — 1: Cópia de solução existente, sem diferencial · 3: Diferencial identificável · 5: Abordagem nova ou diferencial claro e defensável frente ao mercado', 1, 5),
    ('0d0de100-0000-4000-8000-000000000003', 6, 'Funcionamento em Ambiente Real', 'Estabilidade, logs ou monitoramento e tratamento de erros. Referência — 1: Falha ou só roda localmente · 3: Estável no ambiente publicado durante a demonstração · 5: Estável, com monitoramento ou logs e tratamento de erros visível', 1, 6),
    ('0d0de100-0000-4000-8000-000000000003', 7, 'Qualidade de Software', 'Testes automatizados, CI/CD e documentação técnica. Referência — 1: Sem testes nem documentação · 3: Alguns testes e README de instalação · 5: Testes automatizados, pipeline de CI/CD e documentação técnica', 1, 7),
    ('0d0de100-0000-4000-8000-000000000003', 8, 'Segurança e Privacidade', 'Boas práticas (OWASP), controle de acesso e cuidado com a LGPD. Referência — 1: Falhas evidentes (senhas em texto puro, entradas sem validação) · 3: Autenticação adequada e validação de entradas · 5: Boas práticas OWASP aplicadas, controle de acesso e cuidado com LGPD', 1, 8),
    ('0d0de100-0000-4000-8000-000000000003', 9, 'Uso Real e Impacto', 'Usuários reais, métricas de uso e feedback comprovado. Referência — 1: Sem usuários · 3: Piloto com usuários reais · 5: Métricas de uso e feedback real apresentados, com evolução ao longo do tempo', 1, 9),
    ('0d0de100-0000-4000-8000-000000000003', 10, 'Sustentabilidade', 'Plano de manutenção, backlog e preparo para evoluir. Referência — 1: Sem plano para manter o sistema · 3: Responsáveis e plano de manutenção definidos · 5: Arquitetura preparada para escalar, com backlog e plano de sustentabilidade', 1, 10),
    ('0d0de100-0000-4000-8000-000000000004', 1, 'Problema e Público-Alvo', 'Relevância e delimitação do problema e de quem é afetado por ele. Referência — 1: Problema vago, sem público definido · 3: Problema claro e público identificado · 5: Problema relevante, bem delimitado e sustentado por dados ou relatos reais', 1, 1),
    ('0d0de100-0000-4000-8000-000000000004', 2, 'Coerência da Solução', 'Capacidade da solução de resolver o problema, frente a alternativas. Referência — 1: Solução não resolve o problema apresentado · 3: Solução resolve o núcleo do problema · 5: Solução resolve o problema de forma direta e justificada frente a alternativas', 1, 2),
    ('0d0de100-0000-4000-8000-000000000004', 3, 'Domínio Técnico', 'Conhecimento da equipe e justificativa das escolhas técnicas. Referência — 1: Não explica as escolhas técnicas · 3: Explica tecnologias e arquitetura usadas · 5: Justifica escolhas, trade-offs e limitações com segurança; todos os membros respondem', 1, 3),
    ('0d0de100-0000-4000-8000-000000000004', 4, 'Apresentação', 'Clareza, objetividade e cumprimento do tempo. Referência — 1: Confusa, sem foco · 3: Clara e dentro do tempo · 5: Objetiva e envolvente, com bom uso de demonstração ou material visual', 1, 4),
    ('0d0de100-0000-4000-8000-000000000004', 5, 'Originalidade', 'Diferencial em relação ao que já existe. Referência — 1: Cópia de solução existente, sem diferencial · 3: Diferencial identificável · 5: Abordagem nova ou diferencial claro e defensável frente ao mercado', 1, 5),
    ('0d0de100-0000-4000-8000-000000000004', 6, 'Cumprimento da Proposta', 'Quanto foi entregue em relação à proposta aprovada do TCC. Referência — 1: Entregou bem menos do que a proposta aprovada · 3: Entregou o essencial da proposta · 5: Entregou a proposta completa ou foi além', 1, 6),
    ('0d0de100-0000-4000-8000-000000000004', 7, 'Aplicação do Curso', 'Uso dos conteúdos do curso e busca de conhecimento além do currículo. Referência — 1: Não relaciona o projeto ao curso · 3: Aplica conteúdos centrais do curso · 5: Integra vários conteúdos e busca conhecimento além do currículo', 1, 7),
    ('0d0de100-0000-4000-8000-000000000004', 8, 'Processo e Metodologia', 'Organização, cronograma e registro do trabalho. Referência — 1: Sem organização nem registro do trabalho · 3: Cronograma e registro básico seguidos · 5: Processo documentado, com decisões e correções de rota explicadas', 1, 8),
    ('0d0de100-0000-4000-8000-000000000004', 9, 'Participação Individual', 'Domínio de todos os integrantes sobre o projeto. Referência — 1: Apenas um integrante domina o projeto · 3: Todos explicam sua parte · 5: Todos explicam sua parte e entendem o projeto como um todo', 1, 9),
    ('0d0de100-0000-4000-8000-000000000004', 10, 'Coerência com o Texto', 'Relação entre o produto e o texto do TCC, com resultados e limitações. Referência — 1: Produto e texto não conversam · 3: Produto corresponde ao descrito no texto · 5: Texto e produto se complementam, com resultados e limitações discutidos', 1, 10),
    ('0d0de100-0000-4000-8000-000000000005', 1, 'Clareza', 'Quanto ficou claro qual problema este projeto resolve.', 1, 1),
    ('0d0de100-0000-4000-8000-000000000005', 2, 'Utilidade', 'Quanto você usaria ou recomendaria esta solução.', 1, 2),
    ('0d0de100-0000-4000-8000-000000000005', 3, 'Apresentação', 'Clareza e interesse da apresentação da equipe.', 1, 3),
    ('0d0de100-0000-4000-8000-000000000006', 1, 'Problema e Hipótese', 'Clareza na formulação, delimitação e relação com os objetivos.', 1, 1),
    ('0d0de100-0000-4000-8000-000000000006', 2, 'Originalidade e Relevância Social', 'Impacto e ineditismo da pesquisa.', 1, 2),
    ('0d0de100-0000-4000-8000-000000000006', 3, 'Metodologia', 'Adequação da metodologia utilizada para o trabalho.', 1, 3),
    ('0d0de100-0000-4000-8000-000000000006', 4, 'Coleta de Dados e Amostragem', 'Qualidade dos instrumentos e seleção da amostra.', 1, 4),
    ('0d0de100-0000-4000-8000-000000000006', 5, 'Análise de Dados', 'Como os alunos interpretaram os dados coletados.', 1, 5),
    ('0d0de100-0000-4000-8000-000000000006', 6, 'Considerações Finais', 'Relação da conclusão com as hipóteses e resultados esperados.', 1, 6),
    ('0d0de100-0000-4000-8000-000000000006', 7, 'Resumo Expandido', 'Clareza, conteúdo e linguagem científica.', 1, 7),
    ('0d0de100-0000-4000-8000-000000000006', 8, 'Banner e Apresentação Oral', 'Organização visual e domínio da fala.', 1, 8),
    ('0d0de100-0000-4000-8000-000000000006', 9, 'Relatório Técnico', 'Detalhamento escrito do trabalho desenvolvido.', 1, 9),
    ('0d0de100-0000-4000-8000-000000000006', 10, 'Diário de Bordo', 'Registro adequado dos procedimentos e datas.', 1, 10),
    ('0d0de100-0000-4000-8000-000000000007', 1, 'Problema e Base Teórica', 'Definição clara do problema e uso de conceitos tecnológicos.', 1, 1),
    ('0d0de100-0000-4000-8000-000000000007', 2, 'Originalidade e Relevância Social', 'Impacto, ineditismo e utilidade da solução.', 1, 2),
    ('0d0de100-0000-4000-8000-000000000007', 3, 'Metodologia e Conhecimento', 'Materiais e métodos utilizados na elaboração.', 1, 3),
    ('0d0de100-0000-4000-8000-000000000007', 4, 'O Protótipo / Processo', 'Qualidade na construção do protótipo ou gestão do processo.', 1, 4),
    ('0d0de100-0000-4000-8000-000000000007', 5, 'Viabilidade Técnica', 'Resposta à necessidade inicial e custo-benefício.', 1, 5),
    ('0d0de100-0000-4000-8000-000000000007', 6, 'Inovação e Impacto', 'Nível de inovação tecnológica e impacto alcançado.', 1, 6),
    ('0d0de100-0000-4000-8000-000000000007', 7, 'Resumo Expandido', 'Clareza, conteúdo e linguagem científica.', 1, 7),
    ('0d0de100-0000-4000-8000-000000000007', 8, 'Banner e Apresentação Oral', 'Organização visual e domínio da fala.', 1, 8),
    ('0d0de100-0000-4000-8000-000000000007', 9, 'Relatório Técnico', 'Detalhamento escrito do trabalho desenvolvido.', 1, 9),
    ('0d0de100-0000-4000-8000-000000000007', 10, 'Diário de Bordo', 'Registro adequado dos procedimentos e datas.', 1, 10)
  ON CONFLICT (id_modelo, ordem) DO UPDATE SET texto_pergunta = EXCLUDED.texto_pergunta,
    descricao_lembrete = EXCLUDED.descricao_lembrete, peso_calculo = EXCLUDED.peso_calculo, peso_desempate = EXCLUDED.peso_desempate;


  -- Perguntas acrescentadas aos originais saem (os originais têm 10 perguntas; o voto popular, 3)
  DELETE FROM public.perguntas_modelo_questionario pm
  WHERE pm.id_modelo IN (SELECT id_modelo FROM public.modelos_questionario WHERE codigo LIKE 'feira-software-q%')
    AND pm.ordem > CASE WHEN pm.id_modelo = '0d0de100-0000-4000-8000-000000000005' THEN 3 ELSE 10 END;

  RETURN (SELECT count(*)::integer FROM public.modelos_questionario WHERE is_original);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_salvar_modelo_questionario(uuid, text, text, numeric, numeric, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_excluir_modelo_questionario(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_salvar_questionario_como_modelo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restaurar_modelos_originais() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_modelo_questionario(uuid, text, text, numeric, numeric, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_excluir_modelo_questionario(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_salvar_questionario_como_modelo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_restaurar_modelos_originais() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
