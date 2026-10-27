# Arquitetura do Front-end

O código em `src/` é organizado **por feature (domínio de negócio)**, e não por tipo de arquivo. Cada feature agrupa
seus componentes e testes, e expõe uma API pública por meio de um `index.ts`. Assim uma mudança fica contida em uma
pasta e as dependências entre domínios ficam explícitas.

## Estrutura

```text
src/
├── app/                    # Composição da aplicação (entrypoint e roteamento entre telas)
│   ├── main.tsx
│   └── App.tsx
├── features/               # Um diretório por domínio de negócio
│   ├── admin/              # Painel administrativo (Bento Grid), configurações do evento, detalhamentos
│   ├── atribuicoes/        # Atribuição forçada, exclusão de avaliações, locks e quarentena de notas
│   ├── auth/               # Login
│   ├── avaliacao/          # Fluxo do avaliador: avaliação de projetos e autocadastro
│   ├── avaliadores/        # Gestão e importação de avaliadores
│   ├── cadastros/          # Instituições, modalidades e questionários
│   ├── projetos/           # Gestão de projetos e mapa de estandes
│   ├── relatorios/         # Relatórios, ranking de premiação e telão ao vivo
│   └── staff/              # Recepção/credenciamento e gestão da equipe
│       ├── components/     # Componentes React da feature
│       ├── __tests__/      # Testes da feature
│       └── index.ts        # API pública: o que outras partes do app podem importar
├── components/             # Componentes compartilhados por mais de uma feature
│   ├── importacao/         # Modal de mapeamento De-Para usado nas importações de planilhas
│   └── layout/             # Cabeçalho e navegação
├── lib/                    # Código sem React: clientes, utilitários e regras puras
│   ├── excel/              # Leitura/geração de planilhas (exceljs)
│   ├── parsers/            # Parsers puros de planilhas e normalização de texto
│   ├── sessaoAdmin.ts      # Validação de sessão do Admin antes de escritas
│   └── supabase.ts         # Cliente Supabase único da aplicação
├── types/                  # Contratos TypeScript compartilhados (tabelas, entidades)
├── styles/                 # CSS global (Tailwind v4)
├── test/                   # Setup global do Vitest
└── __tests__/integracao/   # Testes que exercitam várias features juntas
```

Fora de `src/`:

| Caminho | Conteúdo |
|---|---|
| `supabase/migrations/` | Migrações incrementais — **fonte da verdade** do banco |
| `supabase/schema.sql` | DDL consolidado (referência de leitura) |
| `public/modelos/` | Planilhas-modelo de importação |
| `docs/` | PRD e documentação técnica |

## Regras de dependência

1. **Imports absolutos com `@/`** para tudo que está fora da própria feature
   (`@/lib/supabase`, `@/components/layout/Cabecalho`, `@/features/projetos`).
   Dentro da mesma feature, use imports relativos (`./ModalDetalhamento`).
2. **Uma feature importa outra apenas pelo `index.ts`**: `import { GestorProjetos } from '@/features/projetos'`.
   Nunca `@/features/projetos/components/GestorProjetos`.
3. **Direção permitida**: `app → features → components → lib/types`. `lib/` e `types/` não importam React nem features.
4. **Um componente usado por duas ou mais features** sobe para `src/components/`.
5. **Acesso ao Supabase** sempre via `@/lib/supabase`; não crie outros clientes.

## Testes

Seguem [`.agents/rules/TESTES_TDD.md`](../../.agents/rules/TESTES_TDD.md). Onde colocar:

| Tipo | Local |
|---|---|
| Função pura de `lib/` | `src/lib/**/__tests__/*.test.ts` (com `// @vitest-environment node`) |
| Componente de uma feature | `src/features/<feature>/__tests__/*.test.tsx` |
| Fluxo que envolve várias features | `src/__tests__/integracao/*.test.tsx` |

Mocks usam o mesmo alias do código: `vi.mock('@/lib/supabase', ...)`.

## Como criar uma nova feature

1. Crie `src/features/<nome>/components/` e `src/features/<nome>/__tests__/`.
2. Escreva primeiro o teste (TDD), depois o componente.
3. Exporte o que for público em `src/features/<nome>/index.ts`:
   ```ts
   export * from './components/MinhaTela';
   ```
4. Consuma a feature em `src/app/App.tsx` (se for uma tela) ou em outra feature via `@/features/<nome>`.
5. Mudanças de banco entram como nova migração em `supabase/migrations/` (`AAAAMMDDHHMMSS_descricao.sql`)
   e o `supabase/schema.sql` é atualizado em seguida.

## Próximos passos recomendados

Débitos conhecidos que a nova estrutura facilita resolver (ver também [PRD](../PRD.md), item L8):

- **Quebrar componentes grandes** (`RelatoriosAdmin` ~3,2 mil linhas, `GestorAvaliadores` ~2,5 mil, `GestorProjetos` ~2,1 mil,
  `TelaAdmin` ~1,9 mil). Em cada feature, extrair:
  - `hooks/` — custom hooks com o acesso ao Supabase (`useProjetos`, `useAvaliadores`…), como pede o TESTES_TDD;
  - `services/` ou `api/` — funções que montam as queries/RPCs;
  - subcomponentes em `components/` para cada seção/modal.
- **Ativar `strict` no `tsconfig.json`** de forma incremental e trocar `createClient<any>` pelo tipo `EsqueMABanco`.
- **Adicionar ESLint + Prettier** com regra que proíba imports profundos entre features (`no-restricted-imports`).
- **Code-splitting** das telas em `App.tsx` com `React.lazy` (o bundle atual passa de 500 kB).
