# Visão Geral da Arquitetura

O **Sistema de Avaliação de Projetos IFMS** é uma aplicação web para feiras científicas e mostras tecnológicas do
Instituto Federal de Mato Grosso do Sul. Ela cobre credenciamento, distribuição de avaliações, lançamento de notas,
auditoria e homologação dos resultados.

```
┌────────────────────────────────────────┐
│            CLIENTE WEB (SPA)           │
│   React 19 + Vite 8 + Tailwind v4      │
└──────────────────┬─────────────────────┘
                   │ HTTPS: PostgREST e Auth (supabase-js)
                   ▼
┌────────────────────────────────────────┐
│            SUPABASE                    │
│  - Auth (Admin, Staff e celulares)     │
│  - Row Level Security (RLS)            │
│  - Views pré-computadas                │
└──────────────────┬─────────────────────┘
                   │ SQL e chamadas RPC
                   ▼
┌────────────────────────────────────────┐
│          POSTGRESQL 17                 │
│  - Funções SECURITY DEFINER            │
│  - Travamento pessimista (locks_ativos)│
│  - Upsert por chave natural            │
└────────────────────────────────────────┘
```

## Objetivos de negócio

1. **Credenciamento sem fricção**: check-in rápido de projetos (estandes), avaliadores e staff, com busca insensível a
   caixa e acentos (`.ilike()`). O avaliador não usa senha: o celular é vinculado no balcão em segundos.
2. **Distribuição automática de avaliações**: o sorteio considera cotas restantes, ausências, afinidade temática e
   bloqueia conflitos de interesse (avaliador não avalia projeto da própria instituição).
   Ver [sorteio e atribuição](../regras-de-negocio/sorteio-e-atribuicao.md).
3. **Bancas simultâneas e filas direcionadas**: a coordenação pode forçar atribuições, tanto em banca (vários
   avaliadores no mesmo projeto) quanto em fila prioritária por avaliador.
4. **Quarentena automática**: divergência maior que 2,5 pontos entre avaliadores do mesmo projeto envia o projeto
   para auditoria. Ver [avaliação e quarentena](../regras-de-negocio/avaliacao-e-quarentena.md).
5. **Voto popular em pista separada**: um questionário marcado como voto popular cria uma segunda pista, que não
   entra na média técnica, na cota, na quarentena nem no ranking técnico; a classificação usa média bayesiana.
   Ver [ADR 0016](../decisoes/0016-voto-popular-separado-e-media-bayesiana.md).
6. **Nota conferível**: memorial de cálculo por avaliação, conferência por recálculo, trilha append-only e ajuste
   manual só por RPC marcada. Ver [auditoria de notas](../regras-de-negocio/auditoria-de-notas.md).
7. **Monitoramento em tempo real**: estatísticas vêm de views e funções no banco e alimentam o Telão ao Vivo e os
   painéis administrativos, sem cálculos pesados no cliente.

## Princípios

- **Front-end fino, banco inteligente**: agregação de médias, ranking (`view_ranking_top3`), relatórios e sorteio
  ficam em views e funções no PostgreSQL. Ver [ADR 0001](../decisoes/0001-logica-critica-no-banco.md).
- **Validação no servidor para operações sensíveis**: gravação de notas (`fn_enviar_avaliacao`) e operações
  administrativas são protegidas no banco, não só na interface. Ver [segurança](seguranca.md).
- **Painel administrativo em Bento Grid com modais**: cada módulo abre num modal sem perder o contexto do painel.
  Ver [padrões](padroes.md).
- **Resiliência**: fallbacks no cliente evitam tela branca quando o PostgREST está com o schema cache defasado ou a
  rede oscila. Ver [troubleshooting](../operacao/troubleshooting.md).

## Perfis de acesso

| Perfil | Como entra | Papel no banco | O que faz |
|---|---|---|---|
| Administrador | E-mail e senha (Supabase Auth) | `authenticated` + `is_admin()` | Toda a gestão do evento |
| Staff | E-mail e senha | `authenticated` + `is_staff()` | Check-in, credenciamento e vínculo dos celulares |
| Avaliador | Celular vinculado no credenciamento | `authenticated` (anônimo) + `avaliador_atual()` | Recebe projetos e envia notas |
| Telão | Acesso direto à tela | `anon` | Exibição pública do andamento e do ranking |

## Stack

| Camada | Tecnologia | Papel |
|---|---|---|
| UI | React 19 | Interface |
| Linguagem | TypeScript | Tipagem; contratos de dados em `snake_case` |
| Build | Vite 8 | Servidor de desenvolvimento e bundle de produção |
| Estilo | Tailwind CSS 4 (`@tailwindcss/vite`) | Estilização utilitária; dark mode via `@variant dark` em `src/styles/index.css` |
| Ícones | lucide-react | Ícones |
| Planilhas | exceljs | Leitura e geração de `.xlsx`/`.xls`/`.csv` (`src/lib/excel/`) |
| Backend | Supabase (`@supabase/supabase-js`) | Auth, PostgREST, RPC |
| Banco | PostgreSQL 17 no ambiente local (`supabase/config.toml`); em produção, a versão do projeto Supabase | Extensões `uuid-ossp` e `pgcrypto` |
| Testes | Vitest + JSDOM + Testing Library | Testes unitários e de integração |
| Hospedagem | Firebase Hosting | SPA estática em `avaliacao-projetos-ifms-nv.web.app` |
| CI/CD | GitHub Actions | Ver [CI/CD e deploy](../operacao/ci-cd-e-deploy.md) |

As versões exatas estão em `package.json`.
