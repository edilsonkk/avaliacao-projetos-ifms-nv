# Configuração e Armazenamento Local

## Ambientes

| Ambiente | Banco | Front-end | Quem usa |
|---|---|---|---|
| **Local** | Supabase local em Docker (`npx supabase start`) | `npm run dev` | Desenvolvimento e testes manuais |
| **Produção** | Projeto Supabase na nuvem | Firebase Hosting (`avaliacao-projetos-ifms-nv.web.app`), publicado a cada versão | Usuários reais |

Não há homologação: o plano gratuito do Supabase permite dois projetos, e o segundo fica reservado para outra
aplicação. Por isso a validação antes da produção é feita localmente (`db reset` + testes) e cada versão passa pelo
PR de release ([ADR 0009](../decisoes/0009-ambientes-e-releases.md)).

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_SUPABASE_URL` | Sim | Endpoint do Supabase. Local: `http://127.0.0.1:54321` |
| `VITE_SUPABASE_ANON_KEY` | Sim | Chave pública (`anon` / `publishable`). Local: exibida por `npx supabase status` |
| `APP_URL` | Não | URL base da aplicação (ex.: `http://localhost:3000`) |

**Não existem valores padrão.** Se uma variável obrigatória faltar ou for inválida, a aplicação mostra a tela
"Configuração do Supabase ausente" em vez de se conectar a outro banco (`src/lib/ambiente.ts`). O motivo: um valor
padrão apontando para produção faria um desenvolvedor sem `.env` testar importações e resets nos dados reais sem
perceber. Em produção, os valores vêm dos secrets do ambiente `production` no GitHub
([CI/CD](../operacao/ci-cd-e-deploy.md#segredos-e-variáveis)), e o deploy falha se faltarem.

Variáveis com prefixo `VITE_` são embutidas no bundle e, portanto, **públicas**. Nunca coloque nelas a
`service_role` key ou senhas. A anon key é pública por definição: a proteção dos dados vem da RLS
([segurança](seguranca.md)).

Nos testes, `vitest.config.ts` define valores fictícios; nenhum teste acessa a rede.

## Desenvolvimento local

Pré-requisitos: Node.js 20+ e um runtime de Docker (Docker Desktop, OrbStack ou Colima) em execução.

```bash
npm install
npx supabase@2.122.0 start          # sobe Postgres, Auth, API e Studio; aplica migrations e seed.sql
npx supabase@2.122.0 status         # mostra a API URL e a chave anon/publishable
cp .env.example .env                # cole a chave em VITE_SUPABASE_ANON_KEY
npm run dev                         # http://localhost:3000
```

| Comando | Para quê |
|---|---|
| `npx supabase@2.122.0 db reset` | Recria o banco local do zero (migrations + `supabase/seed.sql`) |
| `npx supabase@2.122.0 migration new <nome>` | Cria uma migration |
| `npx supabase@2.122.0 stop` | Desliga os containers |
| Studio | http://127.0.0.1:54323 (tabelas, SQL, Auth) |

O `supabase/seed.sql` cria só um evento de teste. Não coloque credenciais nem dados reais nele.

## Criar um administrador

O login do Admin exige uma conta no Supabase Auth **e** uma linha em `usuarios` com o mesmo ID e `papel = 'ADMIN'`.

1. Crie a conta: Studio (local) ou painel do Supabase (produção) → *Authentication → Users → Add user*, com e-mail
   e senha (marque "Auto confirm").
2. No SQL Editor, vincule o perfil (é um dado, não uma mudança de estrutura, por isso não vira migration):
   ```sql
   INSERT INTO public.usuarios (id_usuario, email, nome, papel)
   SELECT id, email, 'Administrador', 'ADMIN' FROM auth.users WHERE email = 'admin@exemplo.com'
   ON CONFLICT (id_usuario) DO UPDATE SET papel = 'ADMIN';
   ```

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
