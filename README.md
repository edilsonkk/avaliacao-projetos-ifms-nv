# Sistema de Avaliação de Projetos IFMS

Sistema web para gestão, sorteio, avaliação e homologação de projetos no Instituto Federal de Mato Grosso do Sul (IFMS).

---

## 🚀 Como Rodar Localmente

### Pré-requisitos
- **Node.js** (versão 20 ou superior recomendada)
- **npm** (incluso com o Node.js)

### Passo a Passo

1. **Instalar dependências:**
   ```bash
   npm install
   ```
   *(Nota: O arquivo `.npmrc` já está configurado com `legacy-peer-deps=true` para garantir compatibilidade perfeita entre os pacotes)*

2. **Configuração de Variáveis de Ambiente:**
   Copie o modelo e preencha com os dados do seu projeto Supabase
   (detalhes em [docs/arquitetura/configuracao.md](docs/arquitetura/configuracao.md)):
   ```bash
   cp .env.example .env
   ```

3. **Iniciar o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```

4. **Acessar a aplicação:**
   Abra o navegador em: [http://localhost:3000](http://localhost:3000)

---

## 🛠️ Scripts Disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia o servidor Vite na porta 3000 (`http://localhost:3000`) |
| `npm run build` | Compila o projeto para produção no diretório `dist` |
| `npm run preview` | Visualiza localmente o build de produção |
| `npm run lint` | Executa a checagem de tipos com TypeScript (`tsc --noEmit`) |
| `npm test` | Executa todos os testes uma vez (Vitest) |
| `npm run test:watch` | Executa os testes em modo watch |
| `npm run clean` | Remove o diretório `dist` gerado pelo build |

---

## 🗂️ Estrutura do Projeto

O código é organizado por feature (domínio de negócio):

```text
src/
├── app/          # Entrypoint e roteamento entre telas
├── features/     # admin, atribuicoes, auth, avaliacao, avaliadores, cadastros, projetos, relatorios, staff
├── components/   # Componentes compartilhados entre features
├── lib/          # Supabase, sessão, Excel e parsers (sem React)
└── types/        # Tipos compartilhados
supabase/
├── migrations/   # Migrações do banco (fonte da verdade)
└── schema.sql    # DDL consolidado
```

## 📚 Documentação

| Documento | Conteúdo |
|---|---|
| [docs/README.md](docs/README.md) | Índice: arquitetura, banco de dados, regras de negócio, operação e decisões |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Fluxo de branches, commits, PRs e Definition of Done |
| [AGENTS.md](AGENTS.md) | Guia para agentes de IA (Claude Code, Antigravity…) |
| [docs/PRD.md](docs/PRD.md) | Requisitos do produto e roadmap |

---

## 🏛️ Perfis e Telas do Sistema
- **Avaliador**: Acesso com e-mail/código para realizar a avaliação de projetos atribuídos e preenchimento de critérios.
- **Staff / Recepção**: Credenciamento expresso, busca rápida de avaliadores e monitoramento de fluxo.
- **Administrador**: Gestão de projetos, critérios de questionários, instituições, avaliadores, auditoria e relatórios.
- **Telão ao Vivo**: Exibição em tempo real de notas, status e ranking dos projetos.