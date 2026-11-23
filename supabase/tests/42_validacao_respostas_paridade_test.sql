-- `fn_validar_respostas` e o `count(*)` inline de `fn_enviar_avaliacao` são duas cópias da mesma
-- regra — o COMMENT de fn_validar_respostas admite isso. `admin_lancar_avaliacao` usa a primeira;
-- `fn_enviar_avaliacao` tem a sua própria. Se alguém mudar uma, a nota lançada pelo Admin passa a
-- ser validada por critério diferente da enviada pelo avaliador, em silêncio e sem erro.
--
-- No espírito do teste 35: as duas implementações continuam existindo (unificá-las é outra
-- mudança); o que este arquivo cobra é que elas ACEITEM e RECUSEM o mesmo conjunto de respostas.
-- Cada caso roda pelos dois caminhos e compara o veredito, e também afirma a direção esperada —
-- senão "os dois recusam tudo" passaria como paridade.
-- Rodar: npx supabase@2.122.0 test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

-- ---------------------------------------------------------------------------
-- Cenário: evento ativo com a janela aberta, questionário de escala 0–10 com duas perguntas,
-- quatro projetos (um por caso), quatro avaliadoras com celular vinculado e trava ativa (uma por
-- caso, porque locks_ativos.id_usuario é único) e uma quinta avaliadora para o caminho do Admin.
-- Projetos e avaliadoras sem instituição, para o conflito institucional não interferir.
-- ---------------------------------------------------------------------------
UPDATE public.eventos SET is_ativo = false WHERE is_ativo;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at)
SELECT ('d4200000-0000-0000-0000-00000000000' || g)::uuid, NULL, true, NULL FROM generate_series(1, 4) g;
INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('d4200000-0000-0000-0000-0000000000ad', 'admin42@teste.local', false, now());

INSERT INTO public.usuarios (id_usuario, email, nome, papel, id_auth) VALUES
  ('c4200000-0000-0000-0000-0000000000ad', 'admin42@teste.local', 'Admin 42', 'ADMIN', 'd4200000-0000-0000-0000-0000000000ad');
INSERT INTO public.usuarios (id_usuario, email, nome, papel)
SELECT ('c4200000-0000-0000-0000-00000000000' || g)::uuid, 'ava42' || g || '@teste.local', 'Avaliadora ' || g, 'AVALIADOR'
  FROM generate_series(1, 4) g;
INSERT INTO public.usuarios (id_usuario, email, nome, papel) VALUES
  ('c4200000-0000-0000-0000-0000000000a9', 'ava429@teste.local', 'Avaliadora do Admin', 'AVALIADOR');

INSERT INTO public.eventos (id_evento, nome_evento, is_ativo, sistema_liberado, cota_avaliacoes_padrao,
                            data_evento, horario_inicio, horario_fim)
VALUES ('e4200000-0000-0000-0000-000000000001', 'Evento Paridade 42', true, true, 3,
        (now() AT TIME ZONE 'America/Campo_Grande')::date, '00:00', '23:59:59');

INSERT INTO public.questionarios (id_questionario, id_evento, titulo, escala_minima, escala_maxima, is_voto_popular) VALUES
  ('74200000-0000-0000-0000-000000000001', 'e4200000-0000-0000-0000-000000000001', 'Técnico 42', 0, 10, false);
INSERT INTO public.perguntas_questionario (id_pergunta, id_questionario, ordem, texto_pergunta, peso_calculo, peso_desempate) VALUES
  ('84200000-0000-0000-0000-000000000001', '74200000-0000-0000-0000-000000000001', 1, 'Critério A', 1, 1),
  ('84200000-0000-0000-0000-000000000002', '74200000-0000-0000-0000-000000000001', 2, 'Critério B', 2, 2);

INSERT INTO public.projetos (id_projeto, codigo_projeto, titulo, id_evento, is_check_in_realizado, is_fora_da_competicao)
SELECT ('f4200000-0000-0000-0000-00000000000' || g)::uuid, 'PAR-' || g, 'Projeto do caso ' || g,
       'e4200000-0000-0000-0000-000000000001', true, false
  FROM generate_series(1, 4) g;

INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_instituicao)
SELECT ('c4200000-0000-0000-0000-00000000000' || g)::uuid, 'e4200000-0000-0000-0000-000000000001', true, NULL
  FROM generate_series(1, 4) g;
INSERT INTO public.avaliadores_evento (id_usuario, id_evento, is_credenciado, id_instituicao) VALUES
  ('c4200000-0000-0000-0000-0000000000a9', 'e4200000-0000-0000-0000-000000000001', true, NULL);

INSERT INTO public.dispositivos_avaliador (auth_uid, id_usuario, id_evento, metodo)
SELECT ('d4200000-0000-0000-0000-00000000000' || g)::uuid, ('c4200000-0000-0000-0000-00000000000' || g)::uuid,
       'e4200000-0000-0000-0000-000000000001', 'pareamento'
  FROM generate_series(1, 4) g;

-- Uma trava por avaliadora: fn_enviar_avaliacao exige trava ativa, e o caminho do Admin não.
INSERT INTO public.locks_ativos (id_usuario, id_projeto, expira_em, is_voto_popular)
SELECT ('c4200000-0000-0000-0000-00000000000' || g)::uuid, ('f4200000-0000-0000-0000-00000000000' || g)::uuid,
       now() + interval '30 minutes', false
  FROM generate_series(1, 4) g;

CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
END $$;

CREATE TEMP TABLE veredito (caso text, caminho text, resultado text);
GRANT INSERT, SELECT ON veredito TO authenticated;

/*
 * 'aceito' ou 'recusado'. Só o veredito importa: as duas implementações podem recusar com
 * mensagens diferentes sem divergir de regra. Erro estrutural (classe 42) não é recusa de
 * regra e é deixado estourar, para não passar por "recusado".
 */
CREATE FUNCTION pg_temp.via_avaliador(p_caso text, p_g int, p_respostas jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.fn_enviar_avaliacao(
      ('c4200000-0000-0000-0000-00000000000' || p_g)::uuid,
      ('f4200000-0000-0000-0000-00000000000' || p_g)::uuid,
      '74200000-0000-0000-0000-000000000001', p_respostas, 'Paridade 42', NULL);
    INSERT INTO veredito VALUES (p_caso, 'fn_enviar_avaliacao', 'aceito');
  EXCEPTION
    WHEN sqlstate '42703' OR sqlstate '42883' OR sqlstate '42P01' THEN RAISE;
    WHEN OTHERS THEN INSERT INTO veredito VALUES (p_caso, 'fn_enviar_avaliacao', 'recusado');
  END;
END $$;

CREATE FUNCTION pg_temp.via_admin(p_caso text, p_g int, p_respostas jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.admin_lancar_avaliacao(
      ('f4200000-0000-0000-0000-00000000000' || p_g)::uuid,
      'c4200000-0000-0000-0000-0000000000a9',
      '74200000-0000-0000-0000-000000000001', p_respostas, 'Paridade 42', 'paridade 42', true);
    INSERT INTO veredito VALUES (p_caso, 'admin_lancar_avaliacao', 'aceito');
  EXCEPTION
    WHEN sqlstate '42703' OR sqlstate '42883' OR sqlstate '42P01' THEN RAISE;
    WHEN OTHERS THEN INSERT INTO veredito VALUES (p_caso, 'admin_lancar_avaliacao', 'recusado');
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Os quatro conjuntos, pelos dois caminhos
-- ---------------------------------------------------------------------------
-- caso 1: completo e dentro da escala        -> os dois têm de ACEITAR
-- caso 2: incompleto (falta o Critério B)    -> os dois têm de RECUSAR
-- caso 3: duplicado (Critério A duas vezes)  -> os dois têm de RECUSAR
-- caso 4: fora de escala (nota 99 em 0–10)   -> os dois têm de RECUSAR
SELECT pg_temp.como('d4200000-0000-0000-0000-000000000001');
SELECT pg_temp.via_avaliador('1 completo', 1,
  '[{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":7},{"id_pergunta":"84200000-0000-0000-0000-000000000002","nota":8}]'::jsonb);
SELECT pg_temp.como('d4200000-0000-0000-0000-000000000002');
SELECT pg_temp.via_avaliador('2 incompleto', 2,
  '[{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":7}]'::jsonb);
SELECT pg_temp.como('d4200000-0000-0000-0000-000000000003');
SELECT pg_temp.via_avaliador('3 duplicado', 3,
  '[{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":7},{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":8}]'::jsonb);
SELECT pg_temp.como('d4200000-0000-0000-0000-000000000004');
SELECT pg_temp.via_avaliador('4 fora de escala', 4,
  '[{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":99},{"id_pergunta":"84200000-0000-0000-0000-000000000002","nota":8}]'::jsonb);

SELECT pg_temp.como('d4200000-0000-0000-0000-0000000000ad');
SELECT pg_temp.via_admin('1 completo', 1,
  '[{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":7},{"id_pergunta":"84200000-0000-0000-0000-000000000002","nota":8}]'::jsonb);
SELECT pg_temp.via_admin('2 incompleto', 2,
  '[{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":7}]'::jsonb);
SELECT pg_temp.via_admin('3 duplicado', 3,
  '[{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":7},{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":8}]'::jsonb);
SELECT pg_temp.via_admin('4 fora de escala', 4,
  '[{"id_pergunta":"84200000-0000-0000-0000-000000000001","nota":99},{"id_pergunta":"84200000-0000-0000-0000-000000000002","nota":8}]'::jsonb);

RESET role;

CREATE FUNCTION pg_temp.par(p_caso text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(max(resultado) FILTER (WHERE caminho = 'fn_enviar_avaliacao'), 'não rodou')
      || ' | ' ||
         coalesce(max(resultado) FILTER (WHERE caminho = 'admin_lancar_avaliacao'), 'não rodou')
    FROM veredito WHERE caso = p_caso;
$$;

SELECT is(pg_temp.par('1 completo'), 'aceito | aceito',
  'conjunto completo e na escala: os dois caminhos aceitam');
SELECT is(pg_temp.par('2 incompleto'), 'recusado | recusado',
  'conjunto incompleto: os dois caminhos recusam');
SELECT is(pg_temp.par('3 duplicado'), 'recusado | recusado',
  'pergunta repetida: os dois caminhos recusam');
SELECT is(pg_temp.par('4 fora de escala'), 'recusado | recusado',
  'nota fora da escala do questionário: os dois caminhos recusam');

SELECT * FROM finish();
ROLLBACK;
