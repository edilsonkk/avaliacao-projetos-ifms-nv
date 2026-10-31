-- ==============================================================================
-- MIGRATION: 20261031050000_modelos_questionario.sql
-- DESCRIÇÃO: questionários prontos (modelos), reaproveitamento entre eventos,
--   nota com os pesos das perguntas e desempate pela prioridade das perguntas.
--   * modelos_questionario / perguntas_modelo_questionario: biblioteca fora de
--     qualquer evento, carregada com os 7 questionários do documento
--     "Questionários de Avaliação — Feira de Software" (escala 1 a 5). Em cada
--     item "Critério: texto de ajuda", o critério vira o texto da pergunta e o
--     resto vira o texto de ajuda (com as âncoras 1/3/5, quando houver).
--   * Ativar um modelo ou reaproveitar o questionário de um evento anterior
--     COPIA o questionário para o evento (admin_copiar_questionario): notas e
--     perguntas continuam pertencendo ao evento, e editar a cópia não altera o
--     modelo nem os eventos passados. questionarios.id_origem guarda a origem.
--   * fn_enviar_avaliacao: a nota final passa a ser a média PONDERADA pelo
--     peso_calculo de cada pergunta (lido do banco). Antes o peso era editável
--     no card mas ignorado. Com pesos iguais, o resultado é o mesmo de antes.
--   * view_ranking_top3: empate na média é desfeito pela média das perguntas na
--     ordem de prioridade (peso_desempate 1, 2, 3...; 0 = fora do desempate).
--     Nova coluna chave_desempate no fim.
-- FRONT-END: compatível com a versão anterior (tabelas, coluna e funções novas;
--   view com coluna nova no fim).
-- IDEMPOTENTE. APLICAÇÃO: supabase db push (workflow supabase-migrations.yml).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Modelos
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modelos_questionario (
  id_modelo     uuid PRIMARY KEY,
  codigo        text NOT NULL UNIQUE,
  titulo        varchar(255) NOT NULL,
  descricao     text,
  escala_minima numeric(5,2) NOT NULL DEFAULT 1,
  escala_maxima numeric(5,2) NOT NULL DEFAULT 5,
  ordem         integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.perguntas_modelo_questionario (
  id_modelo          uuid NOT NULL REFERENCES public.modelos_questionario(id_modelo) ON DELETE CASCADE,
  ordem              integer NOT NULL,
  texto_pergunta     text NOT NULL,
  descricao_lembrete text,
  peso_calculo       numeric(5,2) NOT NULL DEFAULT 1,
  peso_desempate     numeric(5,2) NOT NULL DEFAULT 1,
  PRIMARY KEY (id_modelo, ordem)
);

ALTER TABLE public.modelos_questionario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perguntas_modelo_questionario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_modelos_questionario_leitura ON public.modelos_questionario;
CREATE POLICY rls_modelos_questionario_leitura ON public.modelos_questionario FOR SELECT TO authenticated
  USING (public.is_admin());
DROP POLICY IF EXISTS rls_perguntas_modelo_questionario_leitura ON public.perguntas_modelo_questionario;
CREATE POLICY rls_perguntas_modelo_questionario_leitura ON public.perguntas_modelo_questionario FOR SELECT TO authenticated
  USING (public.is_admin());
REVOKE ALL ON public.modelos_questionario, public.perguntas_modelo_questionario FROM anon, authenticated;
GRANT SELECT ON public.modelos_questionario, public.perguntas_modelo_questionario TO authenticated;
GRANT ALL ON public.modelos_questionario, public.perguntas_modelo_questionario TO service_role;

-- Origem da cópia (modelo ou questionário de outro evento)
ALTER TABLE public.questionarios ADD COLUMN IF NOT EXISTS id_origem uuid;
COMMENT ON COLUMN public.questionarios.id_origem IS
  'Modelo (modelos_questionario) ou questionário de outro evento de onde esta cópia veio.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_questionarios_evento_origem
  ON public.questionarios (id_evento, id_origem) WHERE id_origem IS NOT NULL;

INSERT INTO public.modelos_questionario (id_modelo, codigo, titulo, descricao, escala_minima, escala_maxima, ordem) VALUES
  ('0d0de100-0000-4000-8000-000000000001', 'feira-software-q1', 'Técnico · Nível 1 Ideia', 'Projetos com problema e solução definidos, no máximo com wireframes. Núcleo comum (C1–C5) e nível Ideia (I1–I5).', 1, 5, 1),
  ('0d0de100-0000-4000-8000-000000000002', 'feira-software-q2', 'Técnico · Nível 2 Protótipo', 'Projetos com interface navegável e ao menos um fluxo principal funcionando, mesmo com dados simulados. Núcleo comum (C1–C5) e nível Protótipo (P1–P5).', 1, 5, 2),
  ('0d0de100-0000-4000-8000-000000000003', 'feira-software-q3', 'Técnico · Nível 3 Produção', 'Sistemas implantados e acessíveis (URL, loja ou cliente real), com dados persistidos e usuários reais ou piloto. Núcleo comum (C1–C5) e nível Produção (R1–R5).', 1, 5, 3),
  ('0d0de100-0000-4000-8000-000000000004', 'feira-software-q4', 'Convalidação de TCC (ensino médio)', 'Grupos de ensino médio, de qualquer maturidade; a referência é o esperado para um curso técnico de nível médio. Núcleo comum (C1–C5) e trilha ensino médio (E1–E5).', 1, 5, 4),
  ('0d0de100-0000-4000-8000-000000000005', 'feira-software-q5', 'Voto popular (visitantes)', 'Visitantes, em cerca de 1 minuto, só para projetos de nível superior; não entra na nota técnica (V1–V3). Atenção: o sistema não tem o fluxo de visitante por QR code; se ativado, aparece aos avaliadores como mais um questionário.', 1, 5, 5),
  ('0d0de100-0000-4000-8000-000000000006', 'feira-software-q6', 'Feira de Ciências · Pesquisa científica', 'Projetos avaliados como pesquisa científica: investigam uma pergunta ou hipótese, coletam e analisam dados. 10 critérios de peso igual (CI1–CI10).', 1, 5, 6),
  ('0d0de100-0000-4000-8000-000000000007', 'feira-software-q7', 'Feira de Ciências · Pesquisa tecnológica', 'Projetos avaliados como pesquisa tecnológica: constroem um protótipo, processo ou solução para uma necessidade. 10 critérios de peso igual (TE1–TE10).', 1, 5, 7)
ON CONFLICT (codigo) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao,
  escala_minima = EXCLUDED.escala_minima, escala_maxima = EXCLUDED.escala_maxima, ordem = EXCLUDED.ordem;

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

-- Perguntas retiradas de um modelo em versões futuras desta carga
DELETE FROM public.perguntas_modelo_questionario pm
WHERE pm.id_modelo IN (SELECT id_modelo FROM public.modelos_questionario WHERE codigo LIKE 'feira-software-q%')
  AND pm.ordem > CASE WHEN pm.id_modelo = '0d0de100-0000-4000-8000-000000000005' THEN 3 ELSE 10 END;

-- ------------------------------------------------------------------------------
-- Copiar um modelo ou um questionário de outro evento para o evento
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_copiar_questionario(p_id_origem uuid, p_id_evento uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_titulo        text;
  v_base          text;
  v_min           numeric(5,2);
  v_max           numeric(5,2);
  v_evento_origem uuid;
  v_origem_quest  uuid;
  v_eh_modelo     boolean;
  v_origem        uuid;
  v_id            uuid;
  v_n             integer := 1;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos WHERE id_evento = p_id_evento) THEN
    RAISE EXCEPTION 'Evento não encontrado.' USING ERRCODE = '22023';
  END IF;

  SELECT m.titulo, m.escala_minima, m.escala_maxima INTO v_titulo, v_min, v_max
  FROM public.modelos_questionario m WHERE m.id_modelo = p_id_origem;
  v_eh_modelo := FOUND;
  v_origem := p_id_origem;

  IF NOT v_eh_modelo THEN
    SELECT q.titulo, q.escala_minima, q.escala_maxima, q.id_evento, q.id_origem
      INTO v_titulo, v_min, v_max, v_evento_origem, v_origem_quest
    FROM public.questionarios q WHERE q.id_questionario = p_id_origem;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Questionário de origem não encontrado.' USING ERRCODE = '22023';
    END IF;
    IF v_evento_origem IS NOT DISTINCT FROM p_id_evento THEN
      RAISE EXCEPTION 'Este questionário já pertence ao evento.' USING ERRCODE = '22023';
    END IF;
    -- Cópia de um modelo continua apontando para o modelo: o card mostra o modelo como ativo
    IF v_origem_quest IS NOT NULL AND EXISTS (SELECT 1 FROM public.modelos_questionario WHERE id_modelo = v_origem_quest) THEN
      v_origem := v_origem_quest;
    END IF;
  END IF;

  -- Já copiado para este evento: devolve a cópia existente
  SELECT q.id_questionario INTO v_id FROM public.questionarios q
  WHERE q.id_evento = p_id_evento AND q.id_origem = v_origem;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  v_base := left(v_titulo, 240);
  v_titulo := v_base;
  WHILE EXISTS (SELECT 1 FROM public.questionarios WHERE id_evento = p_id_evento AND lower(titulo) = lower(v_titulo)) LOOP
    v_titulo := v_base || CASE WHEN v_n = 1 THEN ' (cópia)' ELSE ' (cópia ' || v_n || ')' END;
    v_n := v_n + 1;
  END LOOP;

  INSERT INTO public.questionarios (id_evento, titulo, escala_minima, escala_maxima, id_origem)
  VALUES (p_id_evento, v_titulo, v_min, v_max, v_origem)
  RETURNING id_questionario INTO v_id;

  IF v_eh_modelo THEN
    INSERT INTO public.perguntas_questionario (id_questionario, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
    SELECT v_id, pm.ordem, pm.texto_pergunta, pm.descricao_lembrete, pm.peso_calculo, pm.peso_desempate
    FROM public.perguntas_modelo_questionario pm WHERE pm.id_modelo = p_id_origem;
  ELSE
    INSERT INTO public.perguntas_questionario (id_questionario, ordem, texto_pergunta, descricao_lembrete, peso_calculo, peso_desempate)
    SELECT v_id, pq.ordem, pq.texto_pergunta, pq.descricao_lembrete, pq.peso_calculo, pq.peso_desempate
    FROM public.perguntas_questionario pq WHERE pq.id_questionario = p_id_origem;
  END IF;

  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- Questionários de outros eventos que podem ser reaproveitados
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_listar_questionarios_reaproveitaveis(p_id_evento uuid)
RETURNS TABLE (
  id_questionario  uuid,
  titulo           text,
  nome_evento      text,
  data_evento      date,
  total_perguntas  integer,
  total_avaliacoes integer,
  ja_no_evento     boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT q.id_questionario,
         q.titulo::text,
         e.nome_evento::text,
         coalesce(e.data_evento, e.data_inicio)::date,
         (SELECT count(*)::integer FROM public.perguntas_questionario pq WHERE pq.id_questionario = q.id_questionario),
         (SELECT count(*)::integer FROM public.avaliacoes a WHERE a.id_questionario = q.id_questionario),
         EXISTS (
           SELECT 1 FROM public.questionarios c
           WHERE c.id_evento = p_id_evento
             AND c.id_origem IN (q.id_questionario, q.id_origem)
         )
  FROM public.questionarios q
  JOIN public.eventos e ON e.id_evento = q.id_evento
  WHERE q.id_evento IS DISTINCT FROM p_id_evento
  ORDER BY coalesce(e.data_evento, e.data_inicio) DESC NULLS LAST, e.nome_evento, q.titulo;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_copiar_questionario(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_listar_questionarios_reaproveitaveis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_copiar_questionario(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_listar_questionarios_reaproveitaveis(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- Nota final ponderada pelo peso das perguntas (corpo de
-- 20261031040000_seguranca_regras_negocio.sql; muda só o passo 9)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_enviar_avaliacao(
  p_id_usuario      uuid,
  p_id_projeto      uuid,
  p_id_questionario uuid,
  p_respostas       jsonb,          -- [{ "id_pergunta": uuid, "nota": numeric }, ...]
  p_parecer         text DEFAULT NULL,
  p_tempo_presenca  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_evento             uuid;
  v_id_instituicao_aval   uuid;
  v_inst_projeto          uuid;
  v_modalidade_projeto    uuid;
  v_check_in              boolean;
  v_fora_competicao       boolean;
  v_tinha_trava           boolean;
  v_cota_padrao           integer;
  v_cota_projeto          integer;
  v_quest_fixado          uuid;
  v_quest_evento          uuid;
  v_total_perguntas       integer;
  v_distintas             integer;
  v_alheias               integer;
  v_nulas                 integer;
  v_sistema_liberado      boolean;
  v_escala_min            numeric(5,2);
  v_escala_max            numeric(5,2);
  v_qtd_respostas         integer;
  v_qtd_fora_escala       integer;
  v_soma                  numeric;
  v_nota_final            numeric(5,2);
  v_avaliacoes_ativas     integer;
  v_nota_min              numeric(5,2);
  v_nota_max              numeric(5,2);
  v_is_quarentena         boolean := false;
  v_id_avaliacao          uuid;
BEGIN
  -- Identidade real: o avaliador só age em nome de si mesmo (aparelho vinculado).
  IF NOT public.is_admin() AND public.avaliador_atual() IS DISTINCT FROM p_id_usuario THEN
    RAISE EXCEPTION 'Acesso negado: este aparelho não está vinculado a este avaliador.' USING ERRCODE = '42501';
  END IF;
  -- 1. POSSE DE TRAVA: o avaliador só grava se detém a trava ativa deste projeto.
  SELECT EXISTS (
    SELECT 1 FROM public.locks_ativos
    WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto
  ) INTO v_tinha_trava;

  IF NOT v_tinha_trava THEN
    RAISE EXCEPTION 'Sem trava ativa para este avaliador/projeto. Sorteie o projeto antes de avaliar.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. PROJETO ELEGÍVEL.
  SELECT p.id_evento, p.id_instituicao, p.id_modalidade,
         COALESCE(p.is_check_in_realizado, false),
         COALESCE(p.is_fora_da_competicao, false),
         p.cota_avaliacoes_customizada, p.id_questionario_fixado
    INTO v_id_evento, v_inst_projeto, v_modalidade_projeto,
         v_check_in, v_fora_competicao, v_cota_projeto, v_quest_fixado
  FROM public.projetos p
  WHERE p.id_projeto = p_id_projeto;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto inexistente.' USING ERRCODE = '42501';
  END IF;
  IF v_fora_competicao THEN
    RAISE EXCEPTION 'Projeto fora da competição não pode ser avaliado.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_check_in THEN
    RAISE EXCEPTION 'Projeto sem check-in presencial.' USING ERRCODE = '42501';
  END IF;

  -- 3. SEM DUPLICIDADE (respeita unica_avaliacao_por_usuario; inclui canceladas).
  IF EXISTS (
    SELECT 1 FROM public.avaliacoes
    WHERE id_projeto = p_id_projeto AND id_usuario = p_id_usuario
  ) THEN
    RAISE EXCEPTION 'Este avaliador já possui avaliação registrada para este projeto.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. CONFLITO INSTITUCIONAL (mesma regra de sortear_proximo_projeto).
  SELECT ae.id_instituicao INTO v_id_instituicao_aval
  FROM public.avaliadores_evento ae
  WHERE ae.id_usuario = p_id_usuario AND ae.id_evento = v_id_evento;

  IF v_id_instituicao_aval IS NOT NULL
     AND v_inst_projeto IS NOT DISTINCT FROM v_id_instituicao_aval THEN
    RAISE EXCEPTION 'Conflito de interesse: avaliador da mesma instituição do projeto.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. MODALIDADE BLOQUEADA.
  IF v_modalidade_projeto IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.avaliador_modalidades_bloqueadas amb
    WHERE amb.id_usuario = p_id_usuario
      AND amb.id_evento = v_id_evento
      AND amb.id_modalidade = v_modalidade_projeto
  ) THEN
    RAISE EXCEPTION 'Modalidade do projeto bloqueada para este avaliador.'
      USING ERRCODE = '42501';
  END IF;

  -- 6. COTA ESTRITA. A trava deste avaliador (que agora vira avaliação) não conta
  --    como avaliação ativa, então basta garantir que as avaliações já concluídas
  --    não tenham atingido a cota. O excesso de travas simultâneas é barrado no
  --    sorteio; aqui o avaliador já detém a sua e está concluindo.
  SELECT COALESCE(e.cota_avaliacoes_padrao, 3),
         COALESCE(e.sistema_liberado, true)
    INTO v_cota_padrao, v_sistema_liberado
  FROM public.eventos e WHERE e.id_evento = v_id_evento;

  SELECT COUNT(*) INTO v_avaliacoes_ativas
  FROM public.avaliacoes a
  WHERE a.id_projeto = p_id_projeto AND (a.status IS NULL OR a.status <> 'CANCELADA');

  IF v_avaliacoes_ativas >= COALESCE(v_cota_projeto, v_cota_padrao) THEN
    RAISE EXCEPTION 'Cota de avaliações do projeto já atingida.' USING ERRCODE = '42501';
  END IF;

  -- 7. JANELA TEMPORAL. Tolerância: como há trava ativa, o avaliador está
  --    concluindo um projeto em andamento; só bloqueamos se o sistema foi
  --    explicitamente desligado.
  IF v_sistema_liberado = false THEN
    RAISE EXCEPTION 'Sistema de avaliação bloqueado pela coordenação.' USING ERRCODE = '42501';
  END IF;

  -- 8. QUESTIONÁRIO DO PROJETO: do mesmo evento e, se já fixado, o mesmo.
  IF p_id_questionario IS NULL THEN
    RAISE EXCEPTION 'Escolha o questionário da avaliação.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(q.escala_minima, 0), COALESCE(q.escala_maxima, 10), q.id_evento
    INTO v_escala_min, v_escala_max, v_quest_evento
  FROM public.questionarios q WHERE q.id_questionario = p_id_questionario;
  IF NOT FOUND OR v_quest_evento IS DISTINCT FROM v_id_evento THEN
    RAISE EXCEPTION 'Questionário não pertence ao evento do projeto.' USING ERRCODE = '42501';
  END IF;
  IF v_quest_fixado IS NOT NULL AND v_quest_fixado <> p_id_questionario THEN
    RAISE EXCEPTION 'Este projeto já é avaliado com outro questionário.' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_parecer, '')) > 5000 THEN
    RAISE EXCEPTION 'Parecer muito longo (máximo de 5000 caracteres).' USING ERRCODE = '22001';
  END IF;

  -- 8.1 RESPOSTAS: todas as perguntas do questionário, uma vez cada, com nota.
  --     (antes, a média de qualquer lista enviada: responder só a pergunta conveniente ou repeti-la mudava a nota)
  IF jsonb_typeof(p_respostas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Respostas em formato inválido.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total_perguntas FROM public.perguntas_questionario WHERE id_questionario = p_id_questionario;
  SELECT count(*),
         count(DISTINCT r->>'id_pergunta'),
         count(*) FILTER (WHERE pq.id_pergunta IS NULL),
         count(*) FILTER (WHERE jsonb_typeof(r->'nota') IS DISTINCT FROM 'number')
    INTO v_qtd_respostas, v_distintas, v_alheias, v_nulas
  FROM jsonb_array_elements(p_respostas) AS r
  LEFT JOIN public.perguntas_questionario pq
    ON pq.id_pergunta::text = r->>'id_pergunta' AND pq.id_questionario = p_id_questionario;
  IF v_total_perguntas = 0 OR v_qtd_respostas <> v_total_perguntas OR v_distintas <> v_qtd_respostas
     OR v_alheias > 0 OR v_nulas > 0 THEN
    RAISE EXCEPTION 'Responda todas as % perguntas do questionário, uma vez cada, com uma nota.', v_total_perguntas
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (
           WHERE (r->>'nota')::numeric < v_escala_min
              OR (r->>'nota')::numeric > v_escala_max
         ),
         COALESCE(SUM((r->>'nota')::numeric), 0)
    INTO v_qtd_respostas, v_qtd_fora_escala, v_soma
  FROM jsonb_array_elements(p_respostas) AS r;

  IF v_qtd_respostas = 0 THEN
    RAISE EXCEPTION 'Nenhuma nota informada.' USING ERRCODE = '22023';
  END IF;
  IF v_qtd_fora_escala > 0 THEN
    RAISE EXCEPTION 'Nota fora da escala permitida (% a %).', v_escala_min, v_escala_max
      USING ERRCODE = '22003';
  END IF;

  -- 9. NOTA FINAL calculada no servidor: média ponderada pelo peso_calculo de
  --    cada pergunta (lido do banco, nunca do cliente). Pesos iguais = média simples.
  SELECT ROUND(SUM((r->>'nota')::numeric * pq.peso_calculo) / NULLIF(SUM(pq.peso_calculo), 0), 2)
    INTO v_nota_final
  FROM jsonb_array_elements(p_respostas) AS r
  JOIN public.perguntas_questionario pq
    ON pq.id_pergunta::text = r->>'id_pergunta' AND pq.id_questionario = p_id_questionario
  WHERE pq.peso_calculo > 0;
  v_nota_final := COALESCE(v_nota_final, ROUND(v_soma / v_qtd_respostas, 2));

  -- 10. GRAVAÇÃO ATÔMICA.
  INSERT INTO public.avaliacoes (
    id_projeto, id_usuario, id_questionario, nota_final, parecer_final,
    tempo_presenca, tempo_submissao, status, status_avaliacao
  ) VALUES (
    p_id_projeto, p_id_usuario, p_id_questionario, v_nota_final, p_parecer,
    p_tempo_presenca, now(), 'CONCLUIDA', 'concluida'
  )
  RETURNING id_avaliacao INTO v_id_avaliacao;

  INSERT INTO public.respostas_avaliacao (id_avaliacao, id_pergunta, nota_atribuida)
  SELECT v_id_avaliacao, (r->>'id_pergunta')::uuid, (r->>'nota')::numeric
  FROM jsonb_array_elements(p_respostas) AS r;

  -- Fixa o questionário do projeto se ainda não houver.
  UPDATE public.projetos
  SET id_questionario_fixado = p_id_questionario
  WHERE id_projeto = p_id_projeto AND id_questionario_fixado IS NULL
    AND p_id_questionario IS NOT NULL;

  -- Quarentena por divergência > 2.5 entre a maior e a menor nota ativa.
  SELECT MIN(nota_final), MAX(nota_final) INTO v_nota_min, v_nota_max
  FROM public.avaliacoes
  WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA');
  IF v_nota_max IS NOT NULL AND (v_nota_max - v_nota_min) > 2.5 THEN
    v_is_quarentena := true;
    UPDATE public.avaliacoes SET is_quarentena = true
    WHERE id_projeto = p_id_projeto AND (status IS NULL OR status <> 'CANCELADA');
  END IF;

  -- Libera a trava e conclui a fila direcionada, se houver.
  DELETE FROM public.locks_ativos
  WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto;

  UPDATE public.fila_atribuicoes_direcionadas
  SET status = 'concluido'
  WHERE id_usuario = p_id_usuario AND id_projeto = p_id_projeto
    AND status IN ('pendente', 'em_andamento');

  RETURN jsonb_build_object(
    'sucesso', true,
    'id_avaliacao', v_id_avaliacao,
    'nota_final', v_nota_final,
    'is_quarentena', v_is_quarentena
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- Desempate: média do projeto em cada pergunta, na ordem de prioridade
--   (peso_desempate 1, 2, 3...; 0 fica fora). Arrays são comparados item a
--   item, então ORDER BY chave DESC desfaz o empate pela pergunta de maior
--   prioridade e segue para a próxima enquanto houver empate.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_chave_desempate(p_id_projeto uuid)
RETURNS numeric[]
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(x.media ORDER BY x.prioridade, x.ordem), '{}'::numeric[])
  FROM (
    SELECT pq.peso_desempate AS prioridade, pq.ordem, round(avg(r.nota_atribuida), 2) AS media
    FROM public.avaliacoes a
    JOIN public.respostas_avaliacao r ON r.id_avaliacao = a.id_avaliacao
    JOIN public.perguntas_questionario pq ON pq.id_pergunta = r.id_pergunta
    WHERE a.id_projeto = p_id_projeto
      AND (a.status IS NULL OR a.status <> 'CANCELADA')
      AND pq.peso_desempate > 0
    GROUP BY pq.id_pergunta, pq.peso_desempate, pq.ordem
  ) x;
$$;
REVOKE ALL ON FUNCTION public.fn_chave_desempate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chave_desempate(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.view_ranking_top3
WITH (security_invoker = true) AS
WITH base AS (
  SELECT p.id_projeto,
    p.codigo_projeto,
    p.titulo,
    p.estande,
    p.corredor,
    COALESCE(m.nome_modalidade, 'Sem modalidade'::character varying) AS modalidade,
    COALESCE(ar.nome_area, 'Sem área temática'::character varying) AS area_tematica,
    COALESCE(inst.nome_exibicao, 'Não informada'::character varying) AS nome_instituicao,
    COALESCE(array_agg(round(a.nota_final::numeric, 2) ORDER BY a.tempo_submissao, a.created_at) FILTER (WHERE a.nota_final IS NOT NULL), '{}'::numeric[]) AS notas,
    COALESCE(round(avg(a.nota_final), 2), 0.00) AS media_geral,
    count(a.id_avaliacao) AS total_avaliacoes,
    p.id_evento
  FROM public.projetos p
    LEFT JOIN public.modalidades m ON m.id_modalidade = p.id_modalidade
    LEFT JOIN public.areas_tematicas ar ON ar.id_area = p.id_area
    LEFT JOIN public.instituicoes inst ON inst.id_instituicao = p.id_instituicao
    JOIN public.avaliacoes a ON a.id_projeto = p.id_projeto AND (a.status IS NULL OR a.status::text <> 'CANCELADA'::text)
  WHERE NOT COALESCE(p.is_fora_da_competicao, false)
  GROUP BY p.id_projeto, p.codigo_projeto, p.titulo, p.estande, p.corredor, m.nome_modalidade, ar.nome_area, inst.nome_exibicao, p.id_evento
), com_chave AS (
  SELECT b.*, public.fn_chave_desempate(b.id_projeto) AS chave_desempate FROM base b
)
SELECT b.id_projeto,
  b.codigo_projeto,
  b.titulo,
  b.estande,
  b.corredor,
  b.modalidade,
  b.area_tematica,
  b.nome_instituicao,
  b.notas,
  b.media_geral,
  b.total_avaliacoes,
  b.id_evento,
  rank() OVER (PARTITION BY b.id_evento, b.modalidade, b.area_tematica ORDER BY b.media_geral DESC, b.chave_desempate DESC) AS posicao,
  EXISTS (SELECT 1 FROM public.view_projetos_quarentena q WHERE q.id_projeto = b.id_projeto) AS em_quarentena,
  b.chave_desempate
FROM com_chave b
ORDER BY b.media_geral DESC, b.codigo_projeto;

REVOKE ALL ON public.view_ranking_top3 FROM anon;
GRANT SELECT ON public.view_ranking_top3 TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
