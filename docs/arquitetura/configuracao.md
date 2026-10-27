# Configuração e Armazenamento Local

## Variáveis de ambiente

Copie `.env.example` para `.env`. O `.env` não é versionado.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_SUPABASE_URL` | Sim | Endpoint da instância Supabase (`https://<project-ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Sim | Chave pública da role `anon` (Supabase → Project Settings → API) |
| `APP_URL` | Não | URL base da aplicação (ex.: `http://localhost:3000`) |

Variáveis com prefixo `VITE_` são embutidas no bundle e, portanto, **públicas**. Nunca coloque nelas a
`service_role` key ou senhas.

> A anon key é pública por definição: a proteção dos dados vem da RLS ([segurança](seguranca.md)), não do sigilo da
> chave. Ainda assim, ela fica fora da documentação. Os valores ficam no `.env` e nos secrets do GitHub.

Segredos de CI/CD: ver [CI/CD e deploy](../operacao/ci-cd-e-deploy.md#segredos).

## Chaves do `localStorage`

O navegador guarda sessão e dados de contingência nestas chaves:

| Chave | Tipo | Uso |
|---|---|---|
| `sessao_papel` / `usuario_perfil` | `string` | Papel em sessão (`admin`, `staff`, `avaliador`); usado pelo roteamento em `App.tsx` |
| `sessao_id_usuario` / `usuario_id` | UUID | Usuário em sessão |
| `sessao_email` / `usuario_email` | `string` | E-mail do usuário em sessão |
| `avaliador_id_usuario`, `avaliador_email`, `avaliador_nome` | `string` | Dados do avaliador logado |
| `staff_id_usuario` | UUID | Membro do staff logado |
| `evento_ativo_id` | UUID | Evento ativo |
| `evento_ativo_nome` | `string` | Nome do evento exibido no cabeçalho (ex.: `FETEC MS 2026`) |
| `evento_ativo_data` | `string` | Data do evento ativo |
| `avaliadores_credenciados_local` | JSON `{ [id_usuario]: boolean }` | Fallback de credenciamento de avaliadores |
| `staff_credenciados_local` | JSON `{ [id_usuario]: boolean }` | Fallback de credenciamento do staff |
| `avaliacoes_canceladas_ids` | JSON `string[]` | IDs de avaliações canceladas (soft delete local) |
| `avaliacoes_offline_pendentes` | JSON | Avaliações aguardando envio |
| `tema_fecin` | `string` | Tema claro/escuro |

Os pares com `/` são nomes legados equivalentes. Ao criar código novo, use as chaves `sessao_*`.

> O `localStorage` não é fonte de verdade para permissões. Avaliador e Staff ainda são identificados pelo cliente
> (ver [limites conhecidos](seguranca.md#limites-conhecidos)).
