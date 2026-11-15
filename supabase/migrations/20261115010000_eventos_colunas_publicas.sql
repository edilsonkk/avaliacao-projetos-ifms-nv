-- Achado 3 da auditoria de 15/11/2026 (docs/operacao/auditoria.md).
--
-- A política `rls_eventos_leitura` libera SELECT em `eventos` para `anon` com USING (true). Para o
-- catálogo público (nome, edição, datas, horários, identidade visual) isso está certo — a tela de
-- login e o autocadastro pelo QR Code precisam desses campos antes de existir sessão.
--
-- O problema é a linha inteira: junto iam os parâmetros do código de acesso (tamanho do código,
-- máximo de tentativas, validade do pareamento) e o `limite_corte` da premiação. Nada disso dá
-- acesso a ninguém, mas o primeiro grupo calibra tentativa de força bruta e o segundo antecipa o
-- corte antes do resultado sair.
--
-- A política continua a mesma; o que muda é a permissão por coluna, que o PostgREST respeita. O
-- papel `authenticated` segue com a tabela inteira: Admin e Staff leem `select('*')`.
--
-- Compatível com a versão anterior do front-end: as únicas consultas de `anon` a esta tabela
-- projetam `id_evento`, `nome_evento`, `edicao`, `data_evento`, `horario_inicio`, `horario_fim`,
-- `sistema_liberado` e `cota_avaliacoes_padrao`, e filtram por `is_ativo` — todas na lista abaixo.
-- O que não está aqui, `anon` obtém por função (`fn_identidade_visual`, `fn_perfil_sessao`), que
-- roda como dono e devolve só o campo necessário.

REVOKE SELECT ON TABLE public.eventos FROM anon;

GRANT SELECT (
  id_evento,
  nome_evento,
  edicao,
  descricao,
  logo_url,
  url_icone,
  url_imagem_evento,
  is_ativo,
  sistema_liberado,
  data_evento,
  data_inicio,
  data_fim,
  horario_inicio,
  horario_fim,
  cota_avaliacoes_padrao
) ON TABLE public.eventos TO anon;
