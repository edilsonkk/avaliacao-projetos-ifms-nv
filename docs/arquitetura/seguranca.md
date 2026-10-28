# Modelo de Segurança

A segurança dos dados é garantida **no banco**: RLS, privilégios e funções com checagem de papel. A interface apenas
reflete essas regras. Toda regra de permissão precisa existir no banco, e não só no front-end. O `localStorage` é só
atalho de tela; nunca é prova de identidade.

Migrations de referência:

| Migration | O que faz |
|---|---|
| `20261026010000_rpc_enviar_avaliacao.sql` | Gravação de notas só via `fn_enviar_avaliacao` (validação no servidor) |
| `20261026020000_restringir_leitura_sensivel.sql` | Privilégios por coluna em `usuarios` e `avaliacoes` |
| `20261028200000_proteger_funcoes_admin_e_relatorios.sql` | Todas as `admin_*` exigem `is_admin()`; relatórios `SECURITY INVOKER` |
| `20261028210000_identidade_avaliador_staff.sql` | Vínculo do celular ao avaliador, códigos de acesso, conta do Staff |
| `20261028220000_rls_por_papel.sql` | RLS por papel; sorteio e notas só em nome do avaliador do aparelho |

Decisões: [ADR 0006](../decisoes/0006-rls-escrita-restrita-a-admin.md),
[ADR 0007](../decisoes/0007-gravacao-de-notas-via-rpc.md) e
[ADR 0011](../decisoes/0011-identidade-real-avaliador-e-staff.md).

## Papéis

Todos os perfis, exceto o visitante, têm uma sessão real no Supabase Auth. O papel é decidido pelo banco a partir de
`auth.uid()`:

| Perfil | Como entra | Identificado por |
|---|---|---|
| **Admin** | E-mail e senha | `is_admin()`: `usuarios.papel = 'ADMIN'` e `id_usuario` ou `id_auth` = `auth.uid()` |
| **Staff** | E-mail e senha (conta criada pelo Admin no painel) | `is_staff()`: papel `STAFF`/`MONITOR` e `id_auth = auth.uid()` |
| **Avaliador** | Celular com sessão anônima, vinculado no credenciamento | `avaliador_atual()`: vínculo ativo em `dispositivos_avaliador` |
| **Visitante / Telão** | Sem login (`anon`) | — |

### Como o celular do avaliador é vinculado

O celular cria uma sessão anônima própria (`signInAnonymously`). Ela só vale como avaliador depois de vinculada, por
um destes caminhos (configuráveis por evento na engrenagem):

1. **Pareamento**: o celular mostra um código curto, e o **Staff** digita o código no balcão e escolhe o avaliador
   (`fn_parear_dispositivo`). A pessoa está presente, então o pareamento também a credencia. O código só aponta o
   aparelho (quem autoriza é o Staff), por isso não é tratado como senha.
2. **Código de acesso**: o **Staff** gera um código (`fn_gerar_codigo_acesso`), e o avaliador digita e-mail e código no
   próprio celular (`fn_vincular_com_codigo`). Esse código **é** credencial: só o hash bcrypt é gravado, é de uso
   único, expira, e é invalidado após N tentativas erradas.

Um avaliador tem **um aparelho ativo**: um vínculo novo revoga o anterior. O Staff pode desvincular um aparelho
perdido ou trocado. Vincular pelo IP foi descartado: no Wi-Fi da feira todos compartilham o IP, e no 4G ele muda.

## Regras por tabela

Base: `ALL` para o Admin em todas as tabelas; `TRUNCATE` revogado de todos.

| Tabela | Visitante (`anon`) | Avaliador vinculado | Staff |
|---|---|---|---|
| `eventos`, `instituicoes`, `areas_tematicas`, `modalidades` | ler | ler | ler |
| `projetos`, `questionarios`, `perguntas_questionario` | — | ler | ler |
| `usuarios` | — | só o próprio | ler e alterar avaliadores |
| `avaliadores_evento` | — | ler o próprio | ler, inserir e alterar |
| `avaliacoes` | — | ler as próprias | apagar pendentes (sem nota) |
| `respostas_avaliacao` | — | — | — |
| `locks_ativos` | — | ler, criar e apagar **só as próprias** | ler e apagar |
| `fila_atribuicoes_direcionadas` | — | ler e alterar só as próprias | ler e apagar |
| `historico_impedimentos` | — | criar só em nome próprio | — |
| `avaliador_modalidades_bloqueadas`, `avaliador_areas` | — | ler as próprias | ler e gravar |
| `dispositivos_avaliador`, `pareamentos_pendentes`, `codigos_acesso` | — | — (só via funções) | — (só via funções) |

Regras de coluna que a RLS não alcança passam por funções:
- **Check-in do projeto:** o Staff usa `fn_check_in_projeto`, e não `UPDATE` em `projetos`.
- **Questionário fixado:** o avaliador usa `fn_fixar_questionario`.
- **Contagem para a cota:** o avaliador usa `fn_avaliacoes_ativas_do_projeto`, que devolve só o número, sem expor
  notas de outros.

O visitante não tem privilégio algum em `usuarios`, `avaliacoes` e nas tabelas operacionais. Contas sem papel
(qualquer cadastro feito pelo Auth público) só leem os catálogos públicos.

**Views** usam `security_invoker` (respeitam a RLS de quem consulta) e são somente leitura.

## Funções

| Função | Quem executa |
|---|---|
| `admin_*`, `excluir_avaliacao`, `restaurar_avaliacao` | Admin (`is_admin()` checado dentro da função) |
| `fn_relatorio_*` | Autenticados, como `SECURITY INVOKER`: só o Admin vê todos os dados |
| `sortear_proximo_projeto`, `fn_enviar_avaliacao` | Avaliador **em nome de si mesmo** (`p_id_usuario = avaliador_atual()`) ou Admin |
| `fn_parear_dispositivo`, `fn_gerar_codigo_acesso`, `fn_desvincular_dispositivo`, `fn_check_in_projeto` | Staff ou Admin |
| `fn_solicitar_pareamento`, `fn_vincular_com_codigo` | Qualquer sessão (é o próprio celular) |
| `fn_meu_perfil`, `fn_autocadastro_avaliador`, `fn_telao_resumo` | Público. O autocadastro nunca altera cadastro existente; o Telão só devolve totais |

Lista completa em [funções e RPCs](../banco-de-dados/funcoes-e-rpcs.md#identidade-e-vínculo-do-celular).

## Configuração do Supabase Auth

| Configuração | Valor | Por quê |
|---|---|---|
| *Allow new users to sign up* | **ligado** | Necessário para o login anônimo do celular. Desligar bloqueia o pareamento |
| *Anonymous sign-ins* | **ligado** | Sessão do celular do avaliador |
| Rate limit de logins anônimos por IP | cerca de 300/h | Todos os celulares da feira saem pelo mesmo IP |
| *Confirm email* | **ligado** | Impede que um cadastro se passe pelo e-mail de um Staff |

O cadastro público aberto **não dá acesso**. A conta criada não tem papel: não lê pessoas nem notas, não roda funções
de Admin, e só vira Staff se o **e-mail confirmado** for igual ao de um Staff cadastrado pelo Admin. Isso é coberto por
testes. Não desligue o provedor de e-mail: no Supabase, isso bloqueia também o login com senha de Admin e Staff.

## No front-end

- Escritas administrativas: `await garantirSessaoAdmin()` antes e `tratarErroEscritaAdmin(erro)` no erro
  (`src/lib/sessaoAdmin.ts`). Erro de RLS (`42501`) leva de volta ao login.
- Ao abrir o app, `App.tsx` confere o papel guardado no navegador com `fn_meu_perfil()`. Se não bater (aparelho
  desvinculado, `localStorage` editado, sessão expirada), volta ao login.
- Vínculo do celular: `src/features/auth/vinculoAparelho.ts` e `VinculoAvaliador`. No balcão:
  `src/features/staff/components/PainelAparelhoAvaliador.tsx`.

## Testes de segurança

Cada regra de acesso tem teste em `supabase/tests/` (pgTAP). Eles simulam visitante, celular sem vínculo, avaliador
tentando agir por outro, Staff e Admin:

```bash
npx supabase@2.122.0 db reset     # banco local com todas as migrations
npx supabase@2.122.0 test db      # roda supabase/tests/*.sql
```

O CI roda os testes em todo PR, e o check é obrigatório para o merge. Toda falha de segurança corrigida ganha um teste
que **precisa falhar** sem a correção. Antes da troca do modelo, 20 desses ataques passavam no banco.

## Limites conhecidos

- **Celular perdido ainda vinculado:** quem estiver com ele avalia como aquele avaliador até o Staff desvincular.
  Desvincular revoga o aparelho na hora.
- **Cadastro público aberto:** é inofensivo para os dados, mas permite criar contas vazias. Sujeito ao rate limit do
  Auth; se houver abuso, ativar CAPTCHA (Turnstile) no painel do Supabase.
- **Pareamento por QR:** hoje o Staff digita o código mostrado no celular. A leitura do código por câmera pode ser
  adicionada depois, sem mudar o banco.
