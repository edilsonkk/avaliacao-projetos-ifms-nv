# Modelo de Segurança

A segurança dos dados é garantida **no banco** (RLS, privilégios de coluna e funções `SECURITY DEFINER`). A interface
apenas reflete essas regras. Qualquer regra nova de permissão precisa existir no banco, não só no front-end.

Migrations de referência:

| Migration | O que faz |
|---|---|
| `20261026000000_rls_admin_definitivo.sql` | Modelo de RLS: leitura pública, escrita administrativa só para Admin |
| `20261026010000_rpc_enviar_avaliacao.sql` | Gravação de notas só via `fn_enviar_avaliacao` (validação no servidor) |
| `20261026020000_restringir_leitura_sensivel.sql` | Restringe leitura `anon` de colunas sensíveis |
| `20261026030000_proteger_funcoes_admin.sql` | Funções administrativas executáveis só por `authenticated` |

Decisões: [ADR 0006](../decisoes/0006-rls-escrita-restrita-a-admin.md) e
[ADR 0007](../decisoes/0007-gravacao-de-notas-via-rpc.md).

## Papéis

| Papel Postgres | Quem | Como |
|---|---|---|
| `authenticated` | Administrador | Login com e-mail e senha no Supabase Auth (`signInWithPassword`) |
| `anon` | Avaliador, Staff e Telão | Login sem senha; identidade guardada no `localStorage` |

`public.is_admin()` (`SECURITY DEFINER`) retorna verdadeiro quando o usuário autenticado tem `usuarios.papel = 'ADMIN'`
(comparação insensível a caixa).

## Regras por tabela

**Base (todas as tabelas do escopo):**
- `SELECT` para `anon` e `authenticated`, exceto as restrições de coluna abaixo.
- `ALL` (inserir, alterar, excluir) somente para `authenticated` com `is_admin()`.
- `TRUNCATE` revogado de todos (RLS não se aplica a `TRUNCATE`).

**Exceções operacionais para `anon`** (necessárias para Avaliador e Staff):

| Tabela | Permissão extra | Motivo |
|---|---|---|
| `instituicoes` | `INSERT` | Autocadastro do avaliador pode criar instituição |
| `usuarios` | `INSERT`, `UPDATE` restritos a papel `AVALIADOR` | Autocadastro e edição no balcão do Staff |
| `projetos` | `UPDATE` | Check-in pelo Staff e fixação de questionário pelo avaliador |
| `avaliadores_evento` | `INSERT`, `UPDATE` | Vínculo no autocadastro e credenciamento |
| `avaliacoes` | `DELETE` só de pendentes (`nota_final IS NULL`) | Liberação de avaliação não iniciada |
| `historico_impedimentos` | `INSERT` | Registro de conflito/ausência |
| `locks_ativos`, `fila_atribuicoes_direcionadas`, `avaliador_modalidades_bloqueadas`, `avaliador_areas` | `ALL` | Operação dinâmica de travas, fila e bloqueios |

`INSERT` em `avaliacoes` e `respostas_avaliacao` **não** é permitido a `anon`: notas só entram por
`fn_enviar_avaliacao`.

**Restrições de leitura por coluna** (`anon`):
- `usuarios`: sem acesso a `cpf` e `celular`.
- `avaliacoes`: só as colunas necessárias para a deduplicação do avaliador (`id_projeto`, `status`…); `nota_final` e
  `parecer_final` só para Admin.
- `respostas_avaliacao`: sem leitura.

Como o PostgREST exige grant em cada coluna projetada, consultas `anon` nessas tabelas **devem** listar as colunas
explicitamente. `select('*')` falha.

**Views** usam `security_invoker` (respeitam a RLS de quem consulta) e são somente leitura.

## Funções

| Função | Quem executa |
|---|---|
| `admin_*`, `excluir_avaliacao`, `restaurar_avaliacao` | Só `authenticated`/`service_role`; `excluir`/`restaurar` também checam `is_admin()` |
| `sortear_proximo_projeto`, `sortear_projeto` | `anon` (o avaliador precisa delas) |
| `fn_enviar_avaliacao` | `anon` (valida trava, regras e faixa de nota no servidor) |

## No front-end

- Antes de qualquer escrita administrativa: `await garantirSessaoAdmin()` (`src/lib/sessaoAdmin.ts`).
- Ao receber erro: `tratarErroEscritaAdmin(erro)`. Erros de RLS (código `42501`) disparam o evento
  `sessao-admin-expirada`, e `App.tsx` leva o usuário de volta ao login.

## Limites conhecidos

- **Identidade do avaliador e do staff vem do cliente.** Sem login autenticado para esses perfis não existe
  `auth.uid()`, então `p_id_usuario` em `fn_enviar_avaliacao` ainda é informado pelo navegador. A função exige posse
  de trava ativa e aplica todas as regras, mas a prova de identidade só virá com login autenticado (ex.: OTP por
  e-mail). Ver `docs/PRD.md`.
- As exceções operacionais de `anon` (ex.: `UPDATE` em `projetos`) são amplas por necessidade dos fluxos atuais. Ao
  introduzir autenticação para Staff/Avaliador, elas devem ser restringidas.
