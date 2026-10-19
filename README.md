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
   O arquivo `.env` já vem pré-configurado para uso imediato com as credenciais do Supabase. Caso queira personalizar ou conectar a outra instância, consulte o [.env.example](.env.example):
   ```env
   VITE_SUPABASE_URL="https://siyenrhpejugoghlstqw.supabase.co"
   VITE_SUPABASE_ANON_KEY="seu_anon_key_aqui"
   GEMINI_API_KEY="sua_chave_gemini_aqui"
   APP_URL="http://localhost:3000"
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
| `npm run clean` | Remove o diretório `dist` gerado pelo build |

---

## 🏛️ Perfis e Telas do Sistema
- **Avaliador**: Acesso com e-mail/código para realizar a avaliação de projetos atribuídos e preenchimento de critérios.
- **Staff / Recepção**: Credenciamento expresso, busca rápida de avaliadores e monitoramento de fluxo.
- **Administrador**: Gestão de projetos, critérios de questionários, instituições, avaliadores, auditoria e relatórios.
- **Telão ao Vivo**: Exibição em tempo real de notas, status e ranking dos projetos.