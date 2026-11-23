# Ambiente local do zero

Três comandos, do banco vazio até uma rodada de simulação:

```bash
npm run local:reset     # recria o banco (migrations + seed.sql) e as contas de Admin e Staff
npm run local:semear    # cria o evento de simulação com volume
npm run local:simular   # roda a feira
```

Os três já carregam `.env` e `.env.simulacao.local`, então não há `--env-file` para digitar. Argumentos extras
passam depois de `--`:

```bash
npm run local:simular -- --avaliadores=120 --staff=10 --telao=2 --ate-concluir
npm run local:semear -- --projetos=176 --avaliadores=45 --reutilizar
```

## Por que o reset exigia um passo que dava para esquecer

`npx supabase@2.122.0 db reset` recria o banco pelas migrations e aplica `supabase/seed.sql`. O seed cria só um
evento de teste: **nenhuma conta**, de propósito, porque credencial não entra em arquivo versionado. Medido num
reset, `auth.users` e `usuarios` vão a **zero** — e o login do Admin passa a falhar, derrubando qualquer rodada no
primeiro `signInWithPassword`.

Isso agora está coberto em dois lugares, que se complementam:

- **`npm run local:reset`** encadeia o `db reset` com a recriação das contas, em modo detalhado;
- **`semear-simulacao.mjs` e `simular-feira.mjs` garantem as contas na partida**, antes das pré-condições. Se já
  estiverem prontas, imprimem uma linha e seguem: `contas locais: ok (Admin e 1 staff já prontos)`. Ou seja, mesmo
  rodando os scripts direto, sem os atalhos de `npm`, não há passo manual a lembrar.

A lógica vive em **`scripts/lib/contas-locais.mjs`** — uma implementação só, usada pelos três chamadores
(`criar-contas-locais.mjs`, o seeder e o simulador).

## Credenciais

Lidas **só do ambiente**, nunca de arquivo versionado (regra 9 do `AGENTS.md`):

| Variável | Para quê |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | de `.env`; os scripts recusam URL que não seja `127.0.0.1`/`localhost` e recusam chave de `service_role` |
| `SUPABASE_ADMIN_EMAIL`, `SUPABASE_ADMIN_PASSWORD` | a conta de coordenação |
| `SUPABASE_STAFF_EMAIL`, `SUPABASE_STAFF_PASSWORD` | a conta de portaria (ou `..._EMAILS`/`..._PASSWORDS`, listas por vírgula, para vários) |

Ponha-as em `.env.simulacao.local`, que o `.gitignore` cobre por `.env.*`. Faltando alguma, o passo **aborta
dizendo qual variável falta e em qual arquivo defini-la** — nenhuma conta é criada com senha gerada sem o seu
conhecimento. Nenhum script imprime senha: só e-mail e o que aconteceu com cada conta.

## O que a garantia de contas faz, e por qual caminho

Caminho real da aplicação, para o ambiente local exercitar o mesmo fluxo da feira:

1. **conta de autenticação**: `signUp` com a chave anônima, como a tela de cadastro. Conta existente é
   reaproveitada e **a senha nunca é trocada** — se a senha do ambiente não entrar nela, o passo para e explica, em
   vez de sobrescrever;
2. **perfil do Admin** em `usuarios` com `papel = 'ADMIN'`: é a **única** escrita fora do caminho da aplicação, e é
   proposital. Não existe RPC que promova alguém a Admin, e não deve existir — seria escalada de privilégio exposta
   na API. A doc de [configuração](../arquitetura/configuracao.md#criar-um-administrador) manda fazer pelo SQL
   Editor; aqui a mesma escrita sai pela chave de serviço, que só existe no ambiente local. Se o e-mail já estiver
   em `usuarios` com outro papel, o passo **recusa** promovê-lo;
3. **perfil do Staff**: `admin_salvar_staff(NULL, …)` numa sessão de Admin de verdade — é o Gestor de Staff. O
   `p_id_evento` nulo é aceito pela função de propósito, porque o cadastro de staff não é por evento;
4. **vínculo do Staff**: `fn_vincular_conta_staff()` na sessão do próprio staff, que é o que acontece no primeiro
   login dele.

Cada passo é conferido com `fn_meu_perfil`, e o papel que o banco devolveu aparece na saída.

**Atalho, para a partida não custar caro:** se o Admin já entra e `fn_meu_perfil` devolve `admin`, e se os perfis de
staff já estão vinculados, nada é escrito e a chave de serviço nem é buscada (o `supabase status` custa segundos). O
preço do atalho é **um** login de Admin por partida de script, que conta no limite de
`sign_in_sign_ups` (30 por 5 minutos por IP, em `supabase/config.toml`).

## Idempotência

Rodar de novo não duplica nada. Os passos 2 e 3 do roteiro tratam `--projetos` e `--avaliadores` como **totais
desejados** e criam só a diferença que falta; com `--reutilizar`, o seeder também adianta `data_evento` para hoje,
porque a janela de `fn_janela_avaliacao_aberta` é de um dia só.

Depois de várias rodadas, `auth.users` cresce — mas **não** de contas duplicadas: cada avaliador da simulação abre
uma **sessão anônima de aparelho**, que é o mecanismo real do pareamento. Para separar as duas coisas:

```sql
select coalesce(is_anonymous, false) as anonima, count(*) from auth.users group by 1;
```

As contas de pessoa (`anonima = false`) continuam sendo exatamente as do seu `.env.simulacao.local`.

## Quando algo falha

| Sintoma | Causa |
|---|---|
| `RECUSADO: VITE_SUPABASE_URL aponta para "…", que não é local` | o `.env` está apontando para produção; o passo para antes de escrever |
| `Faltam credenciais para garantir as contas locais:` | falta variável no ambiente ou em `.env.simulacao.local`; a mensagem lista quais |
| `A conta … já existe, mas a senha do ambiente não entra nela` | a senha mudou; ajuste a variável ou apague a conta no Studio |
| `RECUSADO: … já existe em usuarios com papel "STAFF"` | o e-mail do Admin está cadastrado como outro papel |
| `PRÉ-CONDIÇÃO: fn_janela_avaliacao_aberta devolveu false` | o evento expirou à meia-noite; rode `npm run local:semear -- --reutilizar` |
| `429` / `Muitos cadastros neste momento` | limites do Auth local: 300 sessões anônimas por hora e 30 logins por 5 minutos, por IP |

Outros sintomas estão em [troubleshooting](troubleshooting.md).
