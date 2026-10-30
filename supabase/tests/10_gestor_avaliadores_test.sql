-- Gestor de Avaliadores (migration 20261030000000).
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(22);

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('da000000-0000-0000-0000-0000000000ad', 'admin10@teste.local', false, now()),
  ('da000000-0000-0000-0000-000000000051', 'staff10@teste.local', false, now());
INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('ca000000-0000-0000-0000-0000000000ad', 'admin10@teste.local', 'Admin Dez', 'ADMIN', 'da000000-0000-0000-0000-0000000000ad'),
  ('ca000000-0000-0000-0000-000000000051', 'staff10@teste.local', 'Staff Dez', 'STAFF', 'da000000-0000-0000-0000-000000000051'),
  ('ca000000-0000-0000-0000-0000000000a1', 'avaliou10@teste.local', 'Já Avaliou', 'AVALIADOR', NULL),
  ('ca000000-0000-0000-0000-0000000000a2', 'novato10@teste.local', 'Novato', 'AVALIADOR', NULL),
  ('ca000000-0000-0000-0000-0000000000a3', 'veterano10@teste.local', 'Veterano', 'AVALIADOR', NULL);
INSERT INTO public.eventos (id_evento, nome_evento, is_ativo) VALUES
  ('ea000000-0000-0000-0000-000000000001', 'Evento Dez', false),
  ('ea000000-0000-0000-0000-000000000002', 'Evento Anterior', false);
INSERT INTO public.modalidades (id_modalidade, nome_modalidade, id_evento) VALUES
  ('ba000000-0000-0000-0000-000000000001', 'Ensino Médio', 'ea000000-0000-0000-0000-000000000001'),
  ('ba000000-0000-0000-0000-000000000002', 'Outro Evento', 'ea000000-0000-0000-0000-000000000002');
INSERT INTO public.areas_tematicas (id_area, nome_area, id_evento) VALUES
  ('aa000000-0000-0000-0000-000000000001', 'EXATAS', 'ea000000-0000-0000-0000-000000000001');
INSERT INTO public.instituicoes (id_instituicao, nome_exibicao, nome_normalizado, id_evento) VALUES
  ('1a000000-0000-0000-0000-000000000001', 'IFMS', 'ifms', 'ea000000-0000-0000-0000-000000000001');
INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, id_modalidade) VALUES
  ('fa000000-0000-0000-0000-000000000001', 'AV-001', 'Projeto Médio', 'ea000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001');
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado) VALUES
  ('ca000000-0000-0000-0000-0000000000a1', 'ea000000-0000-0000-0000-000000000001', true),
  ('ca000000-0000-0000-0000-0000000000a2', 'ea000000-0000-0000-0000-000000000001', false),
  ('ca000000-0000-0000-0000-0000000000a3', 'ea000000-0000-0000-0000-000000000001', false),
  ('ca000000-0000-0000-0000-0000000000a3', 'ea000000-0000-0000-0000-000000000002', true);
INSERT INTO public.avaliacoes (id_avaliacao, id_projeto, id_usuario, nota_final, status) VALUES
  ('a0a00000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-0000000000a1', 8.0, 'CONCLUIDA');
INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em) VALUES
  ('ca000000-0000-0000-0000-0000000000a2', 'fa000000-0000-0000-0000-000000000001', now() + interval '10 minutes');

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

-- Staff não usa as funções do Admin
SELECT pg_temp.como('da000000-0000-0000-0000-000000000051');
SELECT throws_ok($$ SELECT public.admin_salvar_avaliadores('ea000000-0000-0000-0000-000000000001', '[]') $$, '42501', NULL, 'Staff não importa avaliadores');
SELECT throws_ok($$ SELECT public.admin_remover_avaliador_evento('ca000000-0000-0000-0000-0000000000a2', 'ea000000-0000-0000-0000-000000000001') $$, '42501', NULL, 'Staff não remove avaliador');
SELECT throws_ok($$ SELECT public.admin_bloquear_modalidade_avaliador('ca000000-0000-0000-0000-0000000000a2', 'ea000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', true) $$, '42501', NULL, 'Staff não usa o bloqueio do Admin');

SELECT pg_temp.como('da000000-0000-0000-0000-0000000000ad');

-- Importação: e-mail do Admin/Staff não é rebaixado
SELECT is(
  public.admin_salvar_avaliadores('ea000000-0000-0000-0000-000000000001', jsonb_build_array(
    jsonb_build_object('nome', 'Nova Pessoa', 'email', '  Nova.Pessoa@Teste.Local ',
                       'id_instituicao', '1a000000-0000-0000-0000-000000000001',
                       'ids_modalidades_bloqueadas', jsonb_build_array('ba000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000002'),
                       'ids_areas', jsonb_build_array('aa000000-0000-0000-0000-000000000001')),
    jsonb_build_object('nome', 'Tentativa', 'email', 'admin10@teste.local'),
    jsonb_build_object('nome', 'Veterano Renomeado', 'email', 'VETERANO10@teste.local'),
    jsonb_build_object('nome', 'Sem Email', 'email', 'nao-e-email')
  )) - 'ignorados',
  '{"cadastrados": 1, "atualizados": 1}'::jsonb,
  'importação cadastra 1 e atualiza 1'
);
SELECT is((SELECT papel FROM public.usuarios WHERE id_usuario = 'ca000000-0000-0000-0000-0000000000ad'), 'ADMIN', 'Admin continua ADMIN');
SELECT is((SELECT nome FROM public.usuarios WHERE id_usuario = 'ca000000-0000-0000-0000-0000000000ad'), 'Admin Dez', 'nome do Admin não muda');
SELECT is(
  jsonb_array_length(public.admin_salvar_avaliadores('ea000000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('nome', 'X', 'email', 'staff10@teste.local'))) -> 'ignorados'),
  1, 'e-mail de Staff é ignorado e informado');
SELECT is((SELECT papel FROM public.usuarios WHERE id_usuario = 'ca000000-0000-0000-0000-000000000051'), 'STAFF', 'Staff continua STAFF');
SELECT is((SELECT nome FROM public.usuarios WHERE id_usuario = 'ca000000-0000-0000-0000-0000000000a3'), 'Veterano Renomeado', 'avaliador existente é atualizado, sem duplicar');
SELECT is((SELECT count(*)::int FROM public.usuarios WHERE lower(email) = 'nova.pessoa@teste.local'), 1, 'e-mail gravado normalizado');
SELECT is(
  (SELECT count(*)::int FROM public.avaliador_modalidades_bloqueadas b JOIN public.usuarios u USING (id_usuario)
   WHERE u.email = 'nova.pessoa@teste.local'),
  1, 'só grava bloqueio de modalidade do próprio evento');
SELECT is(
  (SELECT ae.id_instituicao FROM public.avaliadores_evento ae JOIN public.usuarios u USING (id_usuario)
   WHERE u.email = 'nova.pessoa@teste.local'),
  '1a000000-0000-0000-0000-000000000001'::uuid, 'vínculo no evento com a instituição');

-- Bloquear modalidade tira a trava do avaliador nos projetos dela
SELECT lives_ok($$ SELECT public.admin_bloquear_modalidade_avaliador('ca000000-0000-0000-0000-0000000000a2', 'ea000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', true) $$, 'Admin bloqueia modalidade');
SELECT is((SELECT count(*)::int FROM public.locks_ativos WHERE id_usuario = 'ca000000-0000-0000-0000-0000000000a2'), 0, 'trava do projeto bloqueado é removida');
SELECT lives_ok($$ SELECT public.admin_bloquear_modalidade_avaliador('ca000000-0000-0000-0000-0000000000a2', 'ea000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001', false) $$, 'Admin libera modalidade');

-- Edição
SELECT throws_ok(
  $$ SELECT public.admin_atualizar_avaliador('ca000000-0000-0000-0000-0000000000a2', 'ea000000-0000-0000-0000-000000000001', 'Novato', 'veterano10@teste.local', NULL, '{}', '{}') $$,
  'P0001', 'Já existe outro usuário com o e-mail veterano10@teste.local.', 'edição recusa e-mail de outra pessoa');
SELECT lives_ok(
  $$ SELECT public.admin_atualizar_avaliador('ca000000-0000-0000-0000-0000000000a2', 'ea000000-0000-0000-0000-000000000001', 'Novato Editado', 'novato10@teste.local', '1a000000-0000-0000-0000-000000000001', '{ba000000-0000-0000-0000-000000000001}', '{aa000000-0000-0000-0000-000000000001}') $$,
  'edição grava tudo de uma vez');
SELECT throws_ok(
  $$ SELECT public.admin_atualizar_avaliador('ca000000-0000-0000-0000-000000000051', 'ea000000-0000-0000-0000-000000000001', 'Staff', 'staff10@teste.local', NULL, '{}', '{}') $$,
  'P0001', 'Este usuário não é avaliador.', 'edição não mexe em Staff');

-- Remover do evento
SELECT throws_ok(
  $$ SELECT public.admin_remover_avaliador_evento('ca000000-0000-0000-0000-0000000000a1', 'ea000000-0000-0000-0000-000000000001') $$,
  'P0001', NULL, 'não remove quem já avaliou no evento');
SELECT is((SELECT count(*)::int FROM public.avaliacoes WHERE id_usuario = 'ca000000-0000-0000-0000-0000000000a1'), 1, 'a nota continua lá');
SELECT is(
  public.admin_remover_avaliador_evento('ca000000-0000-0000-0000-0000000000a3', 'ea000000-0000-0000-0000-000000000001') ->> 'cadastro_apagado',
  'false', 'quem está em outro evento sai só deste evento');
SELECT is(
  public.admin_remover_avaliador_evento('ca000000-0000-0000-0000-0000000000a2', 'ea000000-0000-0000-0000-000000000001') ->> 'cadastro_apagado',
  'true', 'sem outro evento nem avaliação, o cadastro é apagado');

SELECT * FROM finish();
ROLLBACK;
