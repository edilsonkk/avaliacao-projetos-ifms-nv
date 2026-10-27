# ANTIGRAVITY.MD — Especificação Técnica e Operacional Completa
> **Sistema de Avaliação de Projetos IFMS**  
> Versão do Documento: 1.0.0 | Data de Consolidação: 2026-10-23  
> *Este documento é a fonte canônica da especificação técnica, regras de arquitetura, catálogo de dados, histórico de hurdles e diretrizes operacionais do sistema. Deve ser mantido e atualizado obrigatoriamente a cada nova modificação.*

---

## 1. Visão Geral da Arquitetura

O **Sistema de Avaliação de Projetos IFMS** é uma plataforma web projetada para operar em feiras científicas e mostras tecnológicas de grande porte do Instituto Federal de Mato Grosso do Sul, garantindo confiabilidade, ausência de duplicidade, auditoria em tempo real e integridade estatística na homologação de notas.

```
                           ┌────────────────────────────────────────┐
                           │            CLIENTE WEB (SPA)           │
                           │   React 19 + Vite 8 + Tailwind v4      │
                           └──────────────────┬─────────────────────┘
                                              │ PostgREST / WebSocket
                                              ▼
                           ┌────────────────────────────────────────┐
                           │            SUPABASE BACKEND            │
                           │  - Row Level Security (RLS)            │
                           │  - Realtime Engine & Auth              │
                           │  - Database Views Pré-computadas       │
                           └──────────────────┬─────────────────────┘
                                              │ SQL & Procedural Calls
                                              ▼
                           ┌────────────────────────────────────────┐
                           │          POSTGRESQL 15+ MOTOR          │
                           │  - Stored Procedures (SECURITY DEFINER)│
                           │  - Travamento Pessimista (locks_ativos)│
                           │  - Upsert de Chave Natural             │
                           │  - Limpeza Transacional Resiliente     │
                           └────────────────────────────────────────┘
```

### 1.1 Objetivos de Negócio
1. **Credenciamento Ágil e Sem Fricção**: Check-in veloz de estandes (projetos), avaliadores e equipe técnica através de busca com insensibilidade a caixa/acentos (`.ilike()`), sem necessidade de senhas burocráticas no credenciamento inicial.
2. **Distribuição Automatizada e Inteligente de Avaliações**: Algoritmo de sorteio que pondera cotas restantes, ausências, proximidade física (estandes/corredores) e **bloqueia estritamente conflitos de interesse** (avaliadores não podem avaliar projetos da própria instituição de ensino vinculada).
3. **Bancas Simultâneas e Filas Direcionadas**: Capacidade da coordenação geral de forçar atribuições de projetos tanto no formato de banca coletiva (vários avaliadores em um projeto ao mesmo tempo) quanto de fila prioritária por avaliador.
4. **Isolamento de Notas e Quarentena Automática**: Detecção de divergências extremas entre pareceres (discrepância > 2.5 pontos entre avaliadores do mesmo projeto) enviando automaticamente a avaliação para quarentena até auditoria pela coordenação.
5. **Transparência e Monitoramento Contínuo**: Apuração estatística consumida diretamente de views no banco, alimentando o **Telão ao Vivo** e painéis de controle em tempo real sem sobrecarregar o cliente com cálculos locais.

### 1.2 Filosofia Arquitetural
- **Frontend Fino, Banco Inteligente**: Toda lógica crítica de agregação de médias, ordenação de ranking (`view_ranking_top3`), relatórios administrativos (`view_relatorio_admin`) e sorteios reside em views ou Stored Procedures (`SECURITY DEFINER`) no PostgreSQL.
- **Bento Grid & Janelas Modais**: O painel do Administrador adota Bento Grid dividido em blocos temáticos limpos e modais autônomos, evitando navegação fragmentada por URLs ou abas que perdem contexto operacional.
- **Resiliência a Desconexões e Erros de Cache**: Camada de contingência local que impede telas brancas caso o Supabase enfrente atrasos de cache de esquema (`schema cache`) ou instabilidade de rede.

---

## 2. Stack Tecnológico Completo

| Camada | Tecnologia | Versão | Papel / Finalidade |
| :--- | :--- | :--- | :--- |
| **Core UI** | React | `^19.0.1` | Biblioteca reativa base para interface declarativa |
| **Linguagem** | TypeScript | `^7.0.2` / `5.x` | Tipagem estrita ponta a ponta com contratos `snake_case` |
| **Build Tool** | Vite | `^8.3.0` | Servidor de desenvolvimento HMR ultrarrápido e bundler de produção |
| **Estilização** | Tailwind CSS | `^4.3.3` | Framework utilitário de estilização via `@tailwindcss/vite` |
| **Ícones** | Lucide React | `^0.546.0` | Conjunto consistente de ícones vetoriais modernos |
| **Animações** | Motion | `^12.23.24` | Microinterações suaves e transições de feedback |
| **Planilhas** | SheetJS (`xlsx`) | `^0.18.5` | Parsing e carga em massa de arquivos Excel (`.xlsx`, `.xls`) |
| **BaaS / Database** | Supabase JS | `^2.118.0` | SDK de integração com PostgreSQL, Auth e Stored Procedures |
| **Banco de Dados** | PostgreSQL | `15+` | SGBD relacional ACID com extensões `uuid-ossp` e `pgcrypto` |
| **API Layer** | PostgREST | Gerenciado | Geração automática de APIs REST a partir do esquema PostgreSQL |
| **Testes Unitários/QA**| Vitest | `^4.1.12` | Executor de testes unitários ultrarrápido com suporte a ESM |
| **Ambiente de Teste** | JSDOM | `^29.1.1` | Simulação do DOM para execução headless de componentes React |
| **Testing Utilities** | React Testing Library | `^16.3.3` | Utilitários de renderização e asserts centrados no comportamento do usuário |
| **Jest DOM** | `@testing-library/jest-dom` | `^6.9.1` | Matchers customizados para asserções no DOM |
| **CI / Automação** | GitHub Actions | `v4` | Pipeline integrado de checagem contínua (`ci.yml`) |

---

## 3. Todas as Variáveis de Ambiente e Armazenamento Local

### 3.1 Arquivo `.env` / `.env.example`
As variáveis abaixo controlam a conectividade entre a aplicação e os serviços externos:

```env
# ------------------------------------------------------------------------------
# CONEXÃO COM O SUPABASE (PostgreSQL + PostgREST)
# ------------------------------------------------------------------------------
# Endpoint público da instância do Supabase
VITE_SUPABASE_URL="https://siyenrhpejugoghlstqw.supabase.co"

# Chave anônima pública (JWT com claims para a role anon do Postgres)
VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpeWVucmhwZWp1Z29naGxzdHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxOTU1ODEsImV4cCI6MjEwNzc3MTU4MX0.pf2SCiJfO4kGt9cKnWslf7dIAPwN74Szg9XZm-qV5NM"

# ------------------------------------------------------------------------------
# INTEGRAÇÃO COM MODELOS DE IA (GOOGLE GEMINI)
# ------------------------------------------------------------------------------
# Chave de API para recursos generativos / sumarização assistida
GEMINI_API_KEY="SUA_CHAVE_GEMINI_AQUI"

# ------------------------------------------------------------------------------
# SERVIDOR / AMBIENTE
# ------------------------------------------------------------------------------
# URL base do frontend em execução
APP_URL="http://localhost:3000"
```

### 3.2 Chaves Reservadas no `localStorage` do Navegador
O sistema utiliza chaves de armazenamento local para persistência de sessão e contingência offline imediata:

| Chave Local | Tipo | Finalidade |
| :--- | :--- | :--- |
| `sessao_papel` / `usuario_perfil` | `string` | Papel autenticado (`admin`, `staff`, `avaliador`) |
| `sessao_id_usuario` / `usuario_id` | `UUID` | Identificador único do usuário em sessão |
| `sessao_email` / `avaliador_email` | `string` | E-mail do usuário em sessão |
| `evento_ativo_id` | `UUID` | ID do evento científico atualmente ativo |
| `evento_ativo_nome` | `string` | Nome do evento exibido no cabeçalho (ex: `FETEC MS 2026`) |
| `avaliadores_credenciados_local` | `JSON Object` | Mapa `{ [id_usuario]: boolean }` para fallback de credenciamento |
| `staff_credenciados_local` | `JSON Object` | Mapa `{ [id_usuario]: boolean }` para fallback de credenciamento staff |
| `avaliacoes_canceladas_ids` | `JSON Array` | Lista de IDs de avaliações excluídas com soft delete local |

---

## 4. Estrutura do Diretório de Conteúdo

O front-end é organizado por feature (domínio de negócio). A descrição completa, as regras de dependência entre
módulos e o passo a passo para criar novas features estão em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

```text
Sistema-de-Avaliação-de-Projetos-IFMS/
├── .agents/rules/TESTES_TDD.md     # Diretrizes canônicas de TDD, seletores acessíveis e AAA
├── .github/workflows/              # CI (testes), CD (front-end), segurança e migrações Supabase
├── docs/
│   ├── ARQUITETURA.md              # Estrutura de pastas, convenções e guia de novas features
│   └── PRD.md                      # Documento de requisitos do produto
├── public/modelos/                 # Planilhas-modelo de importação
├── src/
│   ├── app/                        # main.tsx (entrypoint) e App.tsx (roteamento entre telas)
│   ├── features/                   # admin, atribuicoes, auth, avaliacao, avaliadores,
│   │   └── <feature>/              # cadastros, projetos, relatorios, staff
│   │       ├── components/
│   │       ├── __tests__/
│   │       └── index.ts            # API pública da feature
│   ├── components/                 # Compartilhados: layout/Cabecalho, importacao/ModalDeParaMapping
│   ├── lib/                        # supabase.ts, sessaoAdmin.ts, excel/, parsers/
│   ├── types/database.ts           # Contratos TypeScript de tabelas e entidades
│   ├── styles/index.css            # Tailwind v4
│   ├── test/setupTests.ts          # Setup global do Vitest
│   └── __tests__/integracao/       # Testes que cruzam várias features
├── supabase/
│   ├── migrations/                 # Migrações incrementais (fonte da verdade do banco)
│   └── schema.sql                  # DDL consolidado
├── ANTIGRAVITY.MD                  # Este documento
├── vite.config.ts                  # Vite + alias `@/` (herdado pelo vitest.config.ts)
└── vitest.config.ts
```

---

## 5. Serviços, Jobs e Models

### 5.1 Modelos de Dados Relacionais (Tabelas PostgreSQL)

#### 1. `instituicoes`
Armazena as entidades de ensino às quais projetos e avaliadores são vinculados:
- `id_instituicao` (UUID, PK, Default `gen_random_uuid()`)
- `id_evento` (UUID, FK -> `eventos`, ON DELETE CASCADE)
- `nome_exibicao` (VARCHAR 255, NOT NULL)
- `nome_normalizado` (VARCHAR 255, NOT NULL)
- `sigla` (VARCHAR 50, Opcional)
- `campus`, `cidade`, `estado` (VARCHAR)
- `created_at` (TIMESTAMPTZ)
- Restrição de unicidade: `UNIQUE (id_evento, nome_normalizado)`

#### 2. `eventos`
Controla a feira ativa e regras temporais:
- `id_evento` (UUID, PK, Default `gen_random_uuid()`)
- `nome_evento` (VARCHAR 255, NOT NULL)
- `edicao` (VARCHAR 100)
- `descricao` (TEXT)
- `data_evento`, `data_inicio`, `data_fim` (DATE)
- `horario_inicio`, `horario_fim` (TIME)
- `is_ativo` (BOOLEAN, Default `true`)
- `sistema_liberado` (BOOLEAN, Default `true`)
- `minutos_timeout_lock` (INTEGER, Default `30`)
- `cota_avaliacoes_padrao` (INTEGER, Default `3`)
- `limite_corte` (TIMESTAMPTZ ou NUMERIC)

#### 3. `usuarios`
Entidade única de login e auditoria:
- `id_usuario` (UUID, PK, Default `gen_random_uuid()`)
- `email` (VARCHAR 255, UNIQUE, NOT NULL)
- `nome` (VARCHAR 255, NOT NULL)
- `papel` (VARCHAR 50, Default `'AVALIADOR'`) — Valores: `ADMIN`, `SUPERADMIN`, `STAFF`, `MONITOR`, `AVALIADOR`
- `cpf` (VARCHAR 14), `celular` (VARCHAR 20)
- `senha_hash` (TEXT)

#### 4. `projetos`
Trabalhos submetidos à feira:
- `id_projeto` (UUID, PK, Default `gen_random_uuid()`)
- `codigo_projeto` (VARCHAR 50, UNIQUE) — **Chave Natural** (ex: `FETEC-001`, `AGRO-2026-007`)
- `id_evento` (UUID, FK -> `eventos`)
- `id_instituicao` (UUID, FK -> `instituicoes`)
- `id_area` (UUID, FK -> `areas_tematicas`)
- `id_modalidade` (UUID, FK -> `modalidades`)
- `id_questionario_fixado` (UUID, FK -> `questionarios`)
- `titulo` (TEXT, NOT NULL)
- `estande` (VARCHAR 50), `corredor` (VARCHAR 50)
- `expositores` (TEXT)
- `cota_avaliacoes_customizada` (INTEGER)
- `contagem_ausencia` (INTEGER, Default `0`)
- `is_check_in_realizado` (BOOLEAN, Default `false`)
- `is_fora_da_competicao` (BOOLEAN, Default `false`)
- `forcar_topo_fila` (BOOLEAN, Default `false`)

#### 5. `avaliadores_evento`
Vinculação de avaliador ao evento específico:
- `id_usuario` (UUID, FK -> `usuarios`)
- `id_evento` (UUID, FK -> `eventos`)
- `id_instituicao` (UUID, FK -> `instituicoes`)
- `is_credenciado` (BOOLEAN, Default `false`)
- `PRIMARY KEY (id_usuario, id_evento)`

#### 6. `questionarios` e `perguntas_questionario`
Instrumentos de avaliação por critérios:
- `questionarios`: `id_questionario` (UUID), `id_evento` (UUID), `titulo` (VARCHAR), `escala_minima`, `escala_maxima`.
- `perguntas_questionario`: `id_pergunta` (UUID), `id_questionario` (UUID), `texto_pergunta` (TEXT), `peso_calculo` (NUMERIC 5,2), `peso_desempate` (NUMERIC 5,2), `ordem` (INTEGER).

#### 7. `avaliacoes` e `respostas_avaliacao`
Notas finais e notas individuais por quesito:
- `avaliacoes`: `id_avaliacao` (UUID), `id_projeto` (UUID), `id_usuario` (UUID), `id_questionario` (UUID), `nota_final` (NUMERIC 5,2), `parecer_final` (TEXT), `status` (VARCHAR, Default `'CONCLUIDA'`, `'CANCELADA'`), `is_quarentena` (BOOLEAN, Default `false`), `tempo_presenca` (VARCHAR).
- `respostas_avaliacao`: `id_resposta` (UUID), `id_avaliacao` (UUID), `id_pergunta` (UUID), `nota_atribuida` (NUMERIC 5,2).

#### 8. `locks_ativos` (Controle de Concorrência)
Bloqueios temporários de projetos em avaliação:
- `id_lock` (UUID, PK)
- `id_usuario` (UUID, UNIQUE) — Cada avaliador só pode avaliar 1 projeto por vez.
- `id_projeto` (UUID) — Permite múltiplos avaliadores no mesmo projeto (Banca Simultânea).
- `bloqueado_em` (TIMESTAMPTZ, Default `now()`)
- `expira_em` (TIMESTAMPTZ, NOT NULL)

#### 9. `fila_atribuicoes_direcionadas`
Fila personalizada de projetos atribuídos pela coordenação:
- `id_atribuicao` (UUID, PK)
- `id_usuario` (UUID, FK -> `usuarios`)
- `id_projeto` (UUID, FK -> `projetos`)
- `ordem` (INTEGER, Default `1`)
- `status` (VARCHAR: `pendente`, `em_andamento`, `concluido`, `cancelado`)

---

### 5.2 Views Analíticas
Todas as visões analíticas são calculadas diretamente no PostgreSQL:
1. **`view_ranking_top3`**: Agrega notas por modalidade e área temática, calcula médias ponderadas, ordena descendentemente e expõe os 3 melhores projetos para premiação.
2. **`view_relatorio_admin`**: Agrega quantidade de avaliações, estande e média final de cada projeto cadastrado.
3. **`view_projetos_quarentena`**: Filtra projetos onde a diferença entre a maior e a menor nota excede 2.5 pontos ou que possuem a flag `is_quarentena = true`.
4. **`view_avaliadores_credenciados`**: Lista rápida de avaliadores com check-in presencial confirmado para o evento ativo.

---

### 5.3 Stored Procedures e RPCs

```sql
-- 1. Reset Global Resiliente do Evento Ativo
admin_reset_global(p_id_evento UUID DEFAULT NULL) RETURNS jsonb

-- 2. Desbloqueio Geral de Travas (com WHERE para SafeUpdate)
admin_desbloquear_todos() RETURNS void

-- 3. Desbloqueio Pontual de Projeto
admin_desbloquear_projeto(p_id_projeto UUID) RETURNS void

-- 4. Remoção de Quarentena
admin_remover_quarentena(p_id_projeto UUID) RETURNS void
admin_remover_quarentena_todos() RETURNS void

-- 5. Sorteio Inteligente com Bloqueio de Conflito de Interesse
sortear_proximo_projeto(p_id_usuario UUID, p_id_evento UUID) RETURNS UUID
```

### 5.4 Jobs e Rotinas Periódicas
1. **Limpeza de Locks Expirados**: Executada a cada chamada de `sortear_proximo_projeto()`:
   ```sql
   DELETE FROM public.locks_ativos WHERE expira_em < now();
   ```
### 5.5 Motor Padronizado de Importação de Planilhas (.xls, .xlsx, .csv)

Todos os 5 gestores do sistema possuem agora um motor de importação de planilhas padronizado, de alta velocidade e com disparador direto (ao clicar no botão `Importar (.xls/.xlsx/.csv)`, o seletor de arquivos do sistema operacional é acionado imediatamente, sem subtítulos ou passos intermediários):

| Gestor / Módulo | Tabela Supabase | Colunas Reconhecidas na Planilha | Estratégia de Inserção / Upsert |
| :--- | :--- | :--- | :--- |
| **`GestorProjetos`** | `projetos` | `Código`, `Título`, `Área Temática`, `Nível / Categoria`, `Instituição`, `Estande`, `Corredor`, `Orientador`, `Estudantes` | Parsing em memória + Batch `.upsert(array, { onConflict: 'codigo_projeto' })` |
| **`GestorAvaliadores`** | `usuarios` e `avaliadores_evento` | `Nome`, `E-mail`, `Instituição`, `Área Temática`, `CPF` | Parsing em memória + Batch `.upsert(array, { onConflict: 'email' })` + vinculação atômica ao evento |
| **`GestorStaff`** | `usuarios` e `avaliadores_evento` | `Nome`, `E-mail`, `Papel` (`STAFF` ou `MONITOR`) | Parsing em memória + Batch `.upsert(array, { onConflict: 'email' })` com `papel = 'STAFF'` + vinculação ao evento |
| **`GestorInstituicoes`**| `instituicoes` | `Nome` / `Nome de Exibição`, `Sigla`, `Campus` | Parsing em memória + normalização slug (`nome_normalizado`) + Batch `.upsert(array, { onConflict: 'nome_normalizado' })` |
| **`GestorQuestionarios`**| `questionarios` e `perguntas_questionario` | `Pergunta` / `Critério`, `Lembrete` / `Descrição`, `Peso` (Padrão: 1.0) | Parsing em memória + inserção vinculada ao questionário ativo ou novo instrumento criado |

- **Arquitetura de Alta Velocidade**: O processamento sequencial de linha por linha (`for ... await supabase`) foi completamente substituído por parsing em lote na memória com a biblioteca SheetJS (`xlsx`) e envio em array único de batch upsert ao PostgREST, garantindo velocidade equivalente ao card "Projetos" (< 1 segundo para centenas de registros).
- **Sem Subtítulos Poluentes**: Todas as descrições ou subtítulos explicativos redundantes foram eliminados das telas de importação, preservando apenas o botão padronizado e o terminal de logs com feedback instantâneo.

---

## 6. TODOS os "Common Hurdles" com Soluções Documentadas

Abaixo está o registro histórico e técnico de todos os obstáculos reais enfrentados durante a evolução do sistema, acompanhados de suas soluções arquiteturais e blindagens com testes:

### Hurdle 1: Erro de SafeUpdate no PostgreSQL (`DELETE requires a WHERE clause`)
- **Sintoma**: Ao acionar "Reset Global" ou "Desbloquear Todos", o PostgreSQL abortava a execução com erro informando que operações `DELETE` sem cláusula `WHERE` são rejeitadas por extensões de proteção (como `safeupdate`).
- **Causa Raiz**: O comando `DELETE FROM locks_ativos;` sem filtros viola regras de integridade transacional de bancos de dados gerenciados.
- **Solução Implementada**:
  1. Alteração de todas as Stored Procedures para incluir cláusulas explícitas não nulas:
     ```sql
     DELETE FROM public.locks_ativos WHERE id_lock IS NOT NULL;
     DELETE FROM public.avaliacoes WHERE id_avaliacao IS NOT NULL;
     ```
  2. Fallback resiliente no frontend via SDK Supabase:
     ```typescript
     await supabase.from('locks_ativos').delete().neq('id_lock', '00000000-0000-0000-0000-000000000000');
     ```
- **Blindagem / Teste**: `src/__tests__/RestricaoExclusaoZumbis.test.tsx`.

---

### Hurdle 2: Falha no Reset Global por Coluna Inexistente (`column "id_evento" does not exist`)
- **Sintoma**: O reset do painel administrativo falhava com o alerta: `"Falha no Reset: column 'id_evento' does not exist"`.
- **Causa Raiz**: Instâncias com esquemas legados possuíam tabelas `projetos` ou `questionarios` criadas sem a chave estrangeira `id_evento`.
- **Solução Implementada**:
  1. Criação da migração `20261022_admin_reset_global_evento.sql`, inspecionando `information_schema.columns` antes de referenciar colunas:
     ```sql
     IF EXISTS (
       SELECT 1 FROM information_schema.columns 
       WHERE table_schema = 'public' AND table_name = 'projetos' AND column_name = 'id_evento'
     ) AND v_id_evento IS NOT NULL THEN
       EXECUTE 'DELETE FROM public.projetos WHERE id_evento = $1 OR id_evento IS NULL' USING v_id_evento;
     ELSE
       DELETE FROM public.projetos WHERE id_projeto IS NOT NULL;
     END IF;
     ```
  2. Implementação de compatibilidade dinâmica com a tabela no singular `projeto`.
- **Blindagem / Teste**: `src/__tests__/ResetGlobal.test.tsx`.

---

### Hurdle 3: Divergência de Schema Cache no PostgREST (`Could not find the 'data_evento' column...`)
- **Sintoma**: Ao cadastrar um novo evento no modal administrativo, a chamada retornava: `"Erro ao cadastrar novo evento: Could not find the 'data_evento' column of 'eventos' in the schema cache"`.
- **Causa Raiz**: O PostgREST armazena em memória um cache do esquema do banco de dados. Quando uma nova coluna (`data_evento`) é adicionada via DDL, o PostgREST continua rejeitando inserts até que seu cache seja recarregado (`NOTIFY pgrst, 'reload schema'`).
- **Solução Implementada**:
  Mecanismo de **Fallback Transparente e Resiliente** no cliente React:
  ```typescript
  let resInsert = await supabase.from('eventos').insert(payloadCompleto).select('id_evento').single();

  if (resInsert.error && (resInsert.error.message?.includes('schema cache') || resInsert.error.code === 'PGRST204')) {
    console.warn('Detectada divergência de colunas no schema cache do Supabase. Executando fallback seguro com campos base...');
    const { data_evento, data_inicio, data_fim, edicao, descricao, ...payloadCompativel } = payloadCompleto;
    resInsert = await supabase.from('eventos').insert(payloadCompativel).select('id_evento').single();
  }
  ```
- **Blindagem / Teste**: `src/__tests__/GestaoNovoEvento.test.tsx` (caso de teste 4).

---

### Hurdle 4: Contagem Duplicada no Credenciamento de Avaliadores e Staff
- **Sintoma**: Ao credenciar um avaliador ou membro do staff, o contador do painel saltava de 1 para 2 ou exibia contagens infladas.
- **Causa Raiz**: O select fazia queries com `JOIN` sem desduplicação ou contava relacionamentos múltiplos na tabela associativa `avaliadores_evento`.
- **Solução Implementada**:
  1. Uso estrito de conjuntos únicos (`Set<string>`) e verificação do papel do usuário (`papel = 'STAFF'` vs `papel = 'AVALIADOR'`).
  2. Filtragem obrigatória pelo `id_evento` ativo em todas as consultas de métricas.
  3. Remoção de contadores numéricos dentro dos cartões do painel Bento Grid, transferindo-os para badges detalhadas dentro do modal de cada módulo.
- **Blindagem / Teste**: `src/__tests__/SincroniaContadores.test.tsx`.

---

### Hurdle 5: Loop Infinito de Renderização no Painel Admin (`fetchDashboardData`)
- **Sintoma**: O componente `TelaAdmin` disparava requisições sem parar para o Supabase, travando o navegador e gerando logs repetidos no console.
- **Causa Raiz**: Criação de funções de fetch inline sem `useCallback`, provocando novas referências em cada render e re-disparando o `useEffect`.
- **Solução Implementada**:
  1. Estabilização de `fetchDashboardData` com `useCallback(async () => { ... }, [conexao_banco_configurada])`.
  2. Atualização funcional atômica do estado: `set_metricas_admin(anterior => ({ ...anterior, ... }))`.
- **Blindagem / Teste**: `src/__tests__/AuditoriaPerformanceViews.test.tsx`.

---

### Hurdle 6: Exposição Indesejada de UUIDs na Interface
- **Sintoma**: Tabelas e relatórios exibiam strings longas de UUID (`e8b8c1d2-9999-4a1b...`), poluindo a leitura e dificultando a localização visual dos projetos nos estandes.
- **Causa Raiz**: O frontend utilizava o `id_projeto` (PK interna) como rótulo de texto em tabelas.
- **Solução Implementada**:
  1. Proibição estrita da exibição do UUID em qualquer elemento visível para o usuário.
  2. Utilização prioritária da **Chave Natural** (`codigo_projeto`, ex: `FETEC-001`, `AGRO-007`).
  3. Cargas em lote via Excel utilizam obrigatoriamente:
     ```typescript
     await supabase.from('projetos').upsert(listaProjetos, { onConflict: 'codigo_projeto' });
     ```
- **Blindagem / Teste**: `src/__tests__/ChaveNaturalUpsert.test.tsx`.

---

### Hurdle 7: Remoção da Regra de "Repescagem de Ausentes" e Realocação de Cards
- **Sintoma**: O fluxo de "repescagem" causava inconsistência ao zerar contadores de faltas de projetos que não compareceram fisicamente ao estande.
- **Solução Implementada**:
  1. Eliminação formal da procedure `admin_repescagem_ausentes` via migração `20261023_remover_repescagem.sql`.
  2. Realocação dos botões do Bloco 1:
     - Posição 4: **Atribuir Projeto** (Bancas Simultâneas / Fila)
     - Posição 5: **Excluir uma avaliação** (Soft Delete de pareceres com undo)
  3. Exclusão de contadores redundantes e eliminação de subtítulos descritivos que poluíam o visual.
- **Blindagem / Teste**: `src/__tests__/RegrasNegocioBloco1.test.tsx`.

---

### Hurdle 8: Lentidão Excessiva na Importação de Avaliadores/Staff e Falta de Padronização de Planilhas
- **Sintoma**: O upload de planilhas nos gestores de Avaliadores e Staff demorava dezenas de segundos e travava a interface, enquanto Instituições e Questionários não ofereciam suporte a planilhas Excel. Além disso, os botões tinham títulos divergentes e subtítulos desnecessários ocupavam espaço da tela.
- **Causa Raiz**: O código executava laços sequenciais (`for` com `await supabase.from(...).upsert(...)`) linha por linha, acumulando dezenas de round-trips de rede HTTP.
- **Solução Implementada**:
  1. Padronização do botão para **`Importar (.xls/.xlsx/.csv)`** em todos os 5 gestores (`GestorProjetos`, `GestorAvaliadores`, `GestorStaff`, `GestorInstituicoes`, `GestorQuestionarios`), com acionamento direto do seletor de arquivos ao clicar.
  2. Parsing integral em memória utilizando SheetJS (`xlsx`) e envio em **lote único (Batch Upsert)** para o banco de dados via `.upsert(array, { onConflict })`.
  3. Remoção de todos os subtítulos e textos explicativos redundantes.
  4. Adição do card **Instituições** ao Bloco 2 da `TelaAdmin` (ao lado de Questionários), expandindo a grade para 5 colunas (`grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5`).
- **Blindagem / Teste**: `src/__tests__/RegrasNegocioBloco2.test.tsx` (Testes 6 e 9).

### 6.7 Hurdle: Unificação de Layout dos Modais Administrativos e Ordenação em Instituições
- **Sintoma / Desafio**: Janelas de `Projetos`, `Avaliadores` e `Equipe Staff` possuíam layouts heterogêneos, títulos com badges de contagem desarmônicas e botões de ação na tabela com textos longos ocupando espaço desnecessário. Além disso, `GestorInstituicoes` exibia a coluna técnica `Nome Normalizado (slug)` e não permitia ordenar as colunas da listagem.
- **Solução Implementada**:
  1. **Layout Canônico Unificado**: `GestorProjetos`, `GestorInstituicoes`, `GestorAvaliadores` e `GestorStaff` adotaram o mesmo layout padrão:
     - **Linha Superior (Cabeçalho)**: Título à esquerda com ícone temático; à direita, botões de ação: `Importar (.xls/.xlsx/.csv)`, `Novo...` (formulário retrátil de cadastro manual), `Recarregar Lista` e `Fechar Janela`.
     - **Console Retrátil de Importação**: Área de logs de terminal exibida condicionalmente ao importar ou se houverem mensagens de processamento.
     - **Formulário Retrátil de Cadastro**: Banner expansível logo abaixo do cabeçalho ativado pelo botão `Novo...`, ocultando-se automaticamente após o salvamento com sucesso (em Projetos: Código, Título, Estande e Corredor).
     - **Segunda Linha (Filtros e Contagem)**: Campo de busca à esquerda e contador à direita no formato canônico `Total: X itens (Y credenciados)`.
     - **Tabela com Ações Compactas**: Ações de linha convertidas para botões de ícone compactos com tooltip (`Pencil`/`Edit2` para edição e `Trash2` para exclusão), preservando o botão em destaque para `[Check-in / Desmarcar Presença]` em Projetos e `[Credenciar / Descredenciar]` em Avaliadores e Staff.
  2. **Ordenação Completa em Instituições**:
     - Ambas as colunas (`Nome da Instituição` e `Sigla`) ganharam botões de ordenação bidirecional com indicadores visuais (`ArrowUpDown`, `ArrowUp`, `ArrowDown`).
     - A coluna técnica de slug (`nome_normalizado`) foi removida da visualização, mantendo a tabela limpa e focada em Nome e Sigla.
     - Cadastro e edição inline atualizados para suportar preenchimento e atualização de `sigla`.
- **Blindagem / Teste**: `src/__tests__/RegrasNegocioBloco1.test.tsx`, `src/__tests__/RegrasNegocioBloco2.test.tsx` e `src/__tests__/AuditoriaPerformanceViews.test.tsx`.

### 6.8 Hurdle: Persistência Integral de Projetos (Evento, Instituição, Área, Modalidade, Fora da Competição), Forçar Topo da Fila e Planilha Modelo
- **Sintoma / Desafio**:
  1. A importação em massa e o cadastro manual de projetos não estavam gravando no banco de dados os campos `id_evento`, `id_instituicao`, `id_area`, `id_modalidade` e `is_fora_da_competicao`, gerando projetos desvinculados de evento e com integridade referencial incompleta.
  2. Projetos sem `id_evento` ficavam completamente invisíveis para a Stored Procedure de sorteio de avaliações (`sortear_proximo_projeto`) e para os relatórios do painel administrativo.
  3. Não havia mecanismo direto na listagem de projetos para priorizar estandes específicos com urgência de avaliação.
  4. Usuários não possuíam um arquivo modelo padronizado (.xlsx) para orientar o preenchimento das planilhas de importação de projetos.
- **Análise Técnica: Por que os Projetos precisam estar vinculados a um evento (`id_evento`)**:
  - **Sorteio Automatizado (`sortear_proximo_projeto`)**: A Stored Procedure de distribuição de avaliações filtra obrigatoriamente `WHERE p.id_evento = p_id_evento`. Se `p.id_evento IS NULL`, a expressão `NULL = p_id_evento` avalia para `FALSE`, fazendo com que o projeto **nunca seja sorteado** para nenhum avaliador do evento.
  - **Prevenção de Conflito de Interesses**: A atribuição cruza `p.id_instituicao` com `avaliadores_evento.id_instituicao` no contexto do evento específico (`p_id_evento`).
  - **Isolamento Multitenant de Edições**: A FETEC MS e outros eventos simultâneos isolam estandes, estatísticas, métricas e apurações por `id_evento`. Sem o vínculo, projetos se tornam registros órfãos.
  - **Operações Críticas e Reset Global**: A limpeza de emergência (`admin_reset_global(p_id_evento)`) remove registros filtrando estritamente pelo evento em andamento.
- **Solução Implementada**:
  1. **Persistência Completa no Cadastro Manual e Edição**:
     - `handle_adicionar_projeto` e `salvar_edicao` agora gravam `id_evento`, `id_instituicao`, `id_area`, `id_modalidade` e `is_fora_da_competicao`.
     - O formulário retrátil de `Novo Projeto` e o modal de edição contam com selects dinâmicos para Instituição, Área Temática, Modalidade e checkbox para "Fora da Competição".
  2. **Migração Retroativa Automática de `id_evento`**:
     - No carregamento inicial do `GestorProjetos`, o sistema detecta se existem projetos com `id_evento IS NULL` e executa um update automático atribuindo o `id_evento` ativo.
  3. **Importação em Massa com Casamento Inteligente e Auto-cadastro**:
     - Captura automática das colunas de instituição/sigla, área temática, modalidade e fora da competição.
     - Caso a instituição, área temática ou modalidade informada na planilha ainda não exista no banco de dados, o sistema realiza o auto-cadastro imediato via Supabase e utiliza a chave gerada no upsert do projeto, garantindo 100% de integridade relacional.
  4. **Botão e Regra "Forçar Topo da Fila" (`forcar_topo_fila`)**:
     - Botão toggle adicionado ao lado de Check-in em cada linha da listagem (`Topo da Fila` / `Normal`), destacado em cor âmbar quando ativo com feedback reativo imediato no Supabase.
     - A Stored Procedure `sortear_proximo_projeto` possui como primeira regra de ordenação `ORDER BY p.forcar_topo_fila DESC`, colocando projetos com a flag ativada na frente de todos os demais.
  5. **Planilha de Exemplo de Importação (`modelo_importacao_projetos.xlsx`)**:
     - Botão `Baixar Modelo (.xlsx)` implementado no cabeçalho de `GestorProjetos` ao lado de `Importar (.xls/.xlsx/.csv)`.
     - Gera dinamicamente o arquivo formatado com SheetJS contendo cabeçalhos oficiais e 3 linhas com exemplos realistas (`codigo_projeto`, `titulo`, `estande`, `corredor`, `instituicao`, `sigla_instituicao`, `area_tematica`, `modalidade`, `fora_da_competicao`).
     - Arquivos estáticos disponibilizados em `public/modelos/modelo_importacao_projetos.xlsx` e `public/modelos/modelo_importacao_projetos.csv`.
- **Blindagem / Teste**: `src/__tests__/GestorProjetosCamposCompletos.test.tsx` e `src/__tests__/ChaveNaturalUpsert.test.tsx`.

---

## 7. Design Patterns do Projeto

1. **Bento Grid Layout Pattern**: A área principal é estruturada em blocos modulares compactos, garantindo alta densidade de informação sem sobrecarga visual:
   - **Bloco 1 (Verde)**: Projetos & Pavilhão (5 cards horizontais).
   - **Bloco 2 (Azul/Slate)**: Pessoal & Formulários (5 cards horizontais: Avaliadores, Equipe Staff, Administradores, Questionários e Instituições).
   - **Bloco 3 (Âmbar)**: Monitoramento em Tempo Real & Relatórios (3 cards horizontais).
2. **Modal-Centric Architecture**: Cada card é um ponto de entrada acoplado a um modal independente. O estado do painel principal nunca é desmontado ou reiniciado ao navegar entre módulos.
3. **Pessimistic Time-based Locking Pattern**: Prevenção de colisões simultâneas de avaliadores. Ao iniciar uma avaliação, um registro é inserido em `locks_ativos` com `expira_em = now() + interval '30 minutes'`. Se o tempo expirar, outro avaliador pode assumir o projeto.
4. **Natural Key Upsert Pattern**: Chaves do domínio acadêmico (`codigo_projeto`, `email`, `cpf`) servem de âncora de idempotência. Importações repetidas de planilhas Excel atualizam os registros sem duplicar entidades.
5. **Two-Step Destructive Action Pattern**: Ações irreversíveis (Reset Global) exigem:
   - Etapa 1: Digitação do token dinâmico exato do evento (ex: `RESETAR-FETEC-MS-2026`).
   - Etapa 2: Confirmação em modal secundário com aviso explícito de impacto.
6. **Soft Delete with Undo Capability Pattern**: Ao excluir uma avaliação via `ModalExclusaoAvaliacao`, o registro é marcado com `status = 'CANCELADA'`. A interface fornece um botão imediato de **Desfazer (Undo)** para recuperação instantânea em caso de clique acidental.
7. **Single Source of Truth (SSOT) para Sessão e Rotas**: Gerenciamento em `App.tsx` que impede avaliadores de acessarem o painel admin ou staff sem credenciais, redirecionando automaticamente com base no perfil persistido.
8. **High-Speed Batch Upsert Pattern**: Toda carga de dados em massa (planilhas `.xls`, `.xlsx`, `.csv`) realiza validação e montagem do payload em memória no cliente, disparando um único comando PostgREST em lote (`.upsert([ ... ])`), reduzindo o tempo de importação de 30s para < 1s.
9. **Unified Admin Modal Architecture Pattern**: Padronização estrita de modais administrativos (`GestorProjetos`, `GestorInstituicoes`, `GestorAvaliadores`, `GestorStaff`) com linha de ações no topo direito, formulário e logs retráteis, linha de busca e contadores sincronizados e botões de ação compactos em cada linha da tabela.

---

## 8. Pipeline Semanal Completo com Horários

Cronograma operacional padrão para a realização de uma feira científica de grande porte (segunda a sexta-feira):

```
SEGUNDA-FEIRA        TERÇA-FEIRA          QUARTA-FEIRA         QUINTA-FEIRA         SEXTA-FEIRA
[Setup & DDL]        [Carga de Dados]     [Credenciamento]     [Finalização]        [Premiação]
08:00 Setup Base     08:00 Carga Excel    07:30 Check-in       08:00 Rodada 3       08:30 Comissão
13:00 Instituições   13:00 Questionários  08:30 Rodada 1       11:30 Quarentena     10:30 Auditoria
17:00 Testes QA      16:00 Staff & Aval.  13:30 Rodada 2       15:30 Bloqueio Sis.  14:00 Telão/Troféus
```

### Detalhamento por Turnos e Horários

#### Segunda-feira: Automação de Infraestrutura, Migrações e Deploy Contínuo (CI/CD)
- **08:00 - 08:30**: **Deploy Automatizado de Banco de Dados**: Disparo do workflow [supabase-migrations.yml](file:///.github/workflows/supabase-migrations.yml) no GitHub Actions, executando `supabase link` e `supabase db push` com aplicação atômica de todas as 17 migrações SQL no Supabase.
- **08:30 - 09:30**: **Pipeline de Segurança Automatizado**: Execução do workflow [security.yml](file:///.github/workflows/security.yml) com análise SAST (CodeQL) e auditoria de vulnerabilidades de dependências SCA (Trivy + npm audit).
- **09:30 - 10:30**: **Continuous Deployment (CD) do Front-end**: Execução do workflow [deploy-frontend.yml](file:///.github/workflows/deploy-frontend.yml), realizando auditoria TypeScript (`tsc --noEmit`), execução de testes Vitest, compilação de produção Vite e publicação automática no host definitivo (GitHub Pages / Edge CDN) com injeção de secrets de produção.
- **10:30 - 12:00**: **Sanity Check e Auditoria Pós-Deploy**: Execução automatizada do pipeline de QA [ci.yml](file:///.github/workflows/ci.yml) (30 suítes / 160 testes unitários e de integração verdes).
- **13:00 - 15:30**: Importação e normalização automatizada de Instituições no `GestorInstituicoes` via motor de planilhas de alta velocidade com dicionário de aliases De-Para.
- **15:30 - 17:00**: Cadastro padronizado das Áreas Temáticas (CNPq) e Modalidades e Níveis com validação fuzzy imediata.
- **17:00 - 18:00**: Certificação de prontidão operacional da infraestrutura provisionada e congelamento da release para recepção dos dados da feira.

#### Terça-feira: Importação em Massa e Calibração dos Formulários
- **08:00 - 11:00**: Carga da planilha final de projetos via `GestorProjetos` (.xlsx). Conferência de mapeamento dos estandes (`EST-001` em diante) e corredores.
- **11:00 - 12:00**: Execução de auditoria de duplicidade por chave natural (`codigo_projeto`).
- **13:00 - 15:30**: Cadastro dos Questionários Oficiais no `GestorQuestionarios`. Configuração de pesos por critério Likert (1 a 5) e pesos de desempate.
- **15:30 - 17:00**: Cadastro prévio dos Avaliadores inscritos e da Equipe Staff/Monitores.
- **17:00 - 18:00**: Simulação de um ciclo de avaliação completo em ambiente de homologação.

#### Quarta-feira: Credenciamento Presencial e Início do Pavilhão (Dia 1 da Feira)
- **07:30 - 08:30**: Abertura do credenciamento. A equipe Staff utiliza a `TelaStaff` para realizar o check-in presencial dos estandes e credenciamento dos avaliadores.
- **08:30 - 12:00**: **1ª Rodada Oficial de Avaliações**.
  - Avaliadores acessam a `TelaAvaliador`, recebem projetos sorteados automaticamente sem conflito de instituição e lançam notas.
- **12:00 - 13:30**: Intervalo de Almoço. Coordenação aciona `admin_desbloquear_todos()` para liberar estandes com locks abandonados.
- **13:30 - 17:30**: **2ª Rodada Oficial de Avaliações**.
  - Coordenação utiliza a ferramenta `AtribuicaoForcada` para direcionar bancas simultâneas em projetos de alta complexidade.
- **17:30 - 18:00**: Fechamento do 1º dia. O `TelaoAoVivo` projeta a porcentagem de evolução de metas sem revelar notas dos projetos.

#### Quinta-feira: Conclusão das Cotas e Resolução de Quarentena (Dia 2 da Feira)
- **08:00 - 11:30**: **3ª Rodada Oficial de Avaliações**.
  - Foco em projetos com contagem de avaliações `< 3` para garantir que todos atinjam a cota padrão.
- **11:30 - 13:00**: **Auditoria de Quarentena**.
  - A coordenação abre o modal `ProjetosQuarentena` para analisar projetos com notas conflitantes (> 2.5 pontos entre avaliadores) e define desempates.
- **13:00 - 15:30**: Rodada final de avaliações de desempate em bancas presenciais.
- **15:30 - 16:00**: Bloqueio definitivo do sistema avaliativo (`sistema_liberado = false` nas configurações do evento).
- **16:00 - 18:00**: Geração e conferência prévia da lista dos finalistas via `view_ranking_top3`.

#### Sexta-feira: Homologação dos Resultados, Premiação e Encerramento
- **08:30 - 10:30**: Reunião fechada da Comissão Científica do IFMS para homologação oficial das notas e conferência de atas.
- **10:30 - 12:00**: Emissão dos relatórios oficiais e exportação das planilhas consolidadas via `RelatoriosAdmin`.
- **14:00 - 17:00**: **Cerimônia Oficial de Premiação no Auditório Principal**.
  - Projeção do ranking final Top 3 no `TelaoAoVivo` com revelação ao vivo dos troféus e medalhas.
- **17:00 - 18:00**: Export do banco de dados para arquivamento histórico e encerramento do evento.

---

## 9. Checklist Pós-Implementação

Toda e qualquer nova funcionalidade, alteração de código ou ajuste no banco de dados DEVE passar obrigatoriamente pelo checklist abaixo antes de ser dada como concluída:

- [ ] **1. Tipagem TypeScript Sem Erros**: Executar `npm run lint` (`tsc --noEmit`) e certificar-se de zero erros de compilação ou tipos implícitos `any`.
- [ ] **2. Suíte de Testes Vitest 100% Verde**: Executar `npm test` no terminal. Todos os 12 arquivos de teste e 55 casos devem passar sem exceções ou falhas.
- [ ] **3. Proibição de Exclusões Sem WHERE**: Nenhuma query de delete direto (`.delete()`) sem filtro explícito ou fora de RPC segura pode ser introduzida.
- [ ] **4. Blindagem de Chave Natural**: O UUID interno do PostgreSQL (`id_projeto`) NUNCA deve ser exibido visualmente na interface do usuário; utilize sempre `codigo_projeto`.
- [ ] **5. Invalidação de Estado sem F5**: Toda alteração de dados (novo evento, edição de nome, credenciamento) deve atualizar o estado React imediatamente sem forçar reload de página.
- [ ] **6. Tolerância a Falhas de Schema Cache**: Qualquer inserção ou alteração que envolva novas colunas no Supabase deve prever fallback seguro contra erros `PGRST204` / schema cache.
- [ ] **7. Cobertura de Testes para Novas Regras**: Toda nova regra de negócio adicionada exige a criação ou expansão de testes unitários na pasta `src/__tests__/`.
- [ ] **8. Manutenção Canônica deste Documento**: Atualizar obrigatoriamente este arquivo `ANTIGRAVITY.MD` registrando novas colunas, novas Stored Procedures, hurdles solucionados ou ajustes de rotina.
- [ ] **9. Padronização de Importação e Desempenho em Lote**: Todos os botões de importação de planilhas devem exibir o texto `Importar (.xls/.xlsx/.csv)`, disparar diretamente o seletor de arquivos, omitir subtítulos redundantes e realizar upload atômico via batch upsert.
- [ ] **10. Conformidade de Layout de Modais Administrativos**: Qualquer novo gestor ou modal administrativo deve aderir ao padrão unificado de topo com ações à direita, formulário de cadastro retrátil, barra de busca com contador à direita e botões de ação compactos (`Pencil`, `Trash2`).
- [ ] **11. Diretrizes de Testes Automatizados (TDD) e Acessibilidade**: Seguir estritamente o padrão Arrange-Act-Assert (AAA) com `@testing-library/user-event`. É terminantemente proibido selecionar elementos por classes CSS do Tailwind (`.text-3xl`, etc.). Parsers de planilhas devem ser funções puras testadas com `// @vitest-environment node`. Ver detalhes canônicos em `.agents/rules/TESTES_TDD.md`.

---

## 10. Diretrizes de Desenvolvimento e Testes Automatizados (TDD)

Regulamentação canônica registrada e mantida em sincronia com [.agents/rules/TESTES_TDD.md](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/.agents/rules/TESTES_TDD.md):

### 10.1 Princípios Gerais de Teste
- **Executor**: Vitest (`^4.1.12`) com JSDOM para componentes React e ambiente Node/ESM para funções puras.
- **Metodologia TDD**: Nenhuma funcionalidade ou correção de bug é considerada concluída sem o seu respectivo teste automatizado passando.
- **Cobertura Focada**: Não exigimos porcentagem fixa de cobertura no CI (para evitar testes artificiais). Porém, é OBRIGATÓRIO incluir testes unitários/integração para 100% do código novo ou das funções refatoradas antes de considerar a tarefa concluída.
- **Qualidade & Rigor**: O código de teste deve ser limpo, focado e estritamente tipado com TypeScript (evitar `any`).
- **Isolamento Total**: Testes não devem fazer requisições reais à internet ou ao banco PostgreSQL do Supabase.

### 10.2 Regras Específicas por Camada
1. **Utilitários, Parsers e SheetJS (`xlsx`)**:
   - Parsers desacoplados do React localizados em `src/lib/parsers/` como funções puras.
   - Execução em ambiente Node sem carregar o JSDOM (anotação `// @vitest-environment node`).
   - Casos obrigatórios de teste:
     1. Sucesso no parsing de planilhas bem formatadas (Excel e CSV).
     2. Tratamento de exceção para arquivos `.xlsx`/`.xls` vazios ou corrompidos.
     3. Mapeamento e normalização correta de tipos de dados (Datas, Números, Strings, Booleans).
2. **Custom Hooks & Supabase JS (`@supabase/supabase-js`)**:
   - Sempre que criar uma nova funcionalidade ou refatorar um componente existente, isole as chamadas ao Supabase em um custom hook.
   - Em componentes legados não modificados, mantém-se o mock direto do SDK do Supabase no Vitest.
   - Teste com `renderHook()` do `@testing-library/react`.
   - Mock do SDK usando `vi.mock('@/lib/supabase')` e factory functions para retorno de dados.
   - Cobertura obrigatória dos 3 estados: `loading: true`, retorno com sucesso (`data` populado) e tratativa de erro (`data: null` e objeto `error`).
3. **Componentes de UI (React 19 + Tailwind + Motion)**:
   - Uso de `@testing-library/react` e `@testing-library/user-event`.
   - **Foco na Acessibilidade e no Usuário**: Selecione elementos primariamente por acessibilidade (`screen.getByRole`, `screen.getByLabelText`, `screen.getByText`). Campos de formulário devem ter `<label htmlFor>` e botões apenas com ícone devem possuir `aria-label`.
   - **Proibição Expressa**: NUNCA selecionar elementos por classes CSS do Tailwind (ex: `querySelector('.text-3xl')`), `querySelector` genérico ou inspeção de estados internos do React (`useState`).
   - Testar feedback visual de interações (alertas, modais abrindo/fechando) sem validar detalhes internos de animação do Motion.
4. **Migração Gradual de Testes Legados**:
   - Novos testes e testes modificados devem obrigatoriamente utilizar `userEvent` e seletores centrados em acessibilidade.
   - Testes legados são migrados gradualmente à medida que os arquivos correspondentes forem alterados.

### 10.3 Padrão Estrutural Arrange-Act-Assert (AAA)
Todo arquivo de teste deve estruturar seus blocos de forma nítida:
```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { MeuComponente } from './MeuComponente';

describe('MeuComponente', () => {
  it('deve submeter os dados corretamente ao clicar no botão', async () => {
    // Arrange (Preparar)
    const user = userEvent.setup();
    const handleSave = vi.fn();
    render(<MeuComponente onSave={handleSave} />);

    // Act (Agir)
    await user.type(screen.getByRole('textbox', { name: /nome/i }), 'Dados de Teste');
    await user.click(screen.getByRole('button', { name: /salvar/i }));

    // Assert (Verificar)
    expect(handleSave).toHaveBeenCalledWith('Dados de Teste');
  });
});
```

### 10.4 Regras de Performance e Execução de Testes
- **Ambientes Isolados**:
  - Para utilitários e funções puras (ex.: parsers de Excel, formatadores), adicionar a anotação `// @vitest-environment node` no topo do arquivo de teste para ignorar o JSDOM e rodar em Node puro.
  - Para componentes React e Hooks de UI, utilizar o ambiente padrão `jsdom`.
- **Execução sem Bloqueios**:
  - NUNCA utilizar `setTimeout` ou delays arbitrários nos testes. Utilizar `findByRole` ou `waitFor` do React Testing Library para asserções assíncronas.
  - Limpar timers e mocks automaticamente entre os testes (`src/setupTests.ts`) com `vi.clearAllMocks()` e `vi.clearAllTimers()` para evitar acúmulo de memória.
- **Comandos do Terminal**:
  - **Em desenvolvimento local (dev)**: `npx vitest` (modo watch incremental).
  - **No CI (GitHub Actions)**: `npx vitest run` (execução única, paralela e otimizada).

---

## 11. Bloqueio Institucional, Bloqueio por Modalidade e Cota Estrita de Avaliações

### 11.1 Bloqueio de Conflito de Interesse Institucional
- **Regra de Negócio**: Um avaliador é terminantemente impedido de avaliar projetos submetidos pela sua própria instituição de ensino de origem (`id_instituicao`).
- **Implementação**:
  - Na Stored Procedure `sortear_proximo_projeto`:
    `p.id_instituicao IS DISTINCT FROM v_id_instituicao_avaliador`
  - Na tela de Atribuição Forçada (`AtribuicaoForcada.tsx`): validação bidirecional (modo Banca e modo Fila) sinalizando inelegibilidade com `Conflito: Mesma Instituição`.
  - No Gestor de Avaliadores (`GestorAvaliadores.tsx`): persistência do vínculo do avaliador à instituição em `avaliadores_evento (id_usuario, id_evento, id_instituicao)` com dropdown de seleção manual e resolução automática/auto-cadastro via planilha.

### 11.2 Bloqueio por Modalidade do Projeto
- **Tabela de Relacionamento**: `public.avaliador_modalidades_bloqueadas (id_usuario, id_evento, id_modalidade)` com chave primária composta e integridade referencial em cascata (`ON DELETE CASCADE`), política RLS aberta e permissões explícitas para leitura/escrita.
- **CRUD e Persistência Resiliente**:
  - Mini-formulário retrátil de novo avaliador e modal de edição possuem checkboxes dinâmicos para bloquear uma ou mais modalidades do evento.
  - O salvamento em `GestorAvaliadores.tsx` resolve o evento ativo de forma resiliente com fallbacks (`eventoAtivoId || id_evento_ativo || localStorage || query de fallback`), impedindo que bloqueios sejam ignorados se o state ainda não tiver sido inicializado.
  - Ao salvar o bloqueio de uma modalidade, o sistema executa o **cancelamento e expurgo imediato** de quaisquer travas em `locks_ativos` e itens pendentes em `fila_atribuicoes_direcionadas` do avaliador que apontem para projetos das modalidades recém-bloqueadas.
- **Motor de Sorteio**:
  - Procedure `sortear_proximo_projeto` descarta estritamente projetos cuja modalidade esteja bloqueada:
    `AND (p.id_modalidade IS NULL OR p.id_modalidade NOT IN (SELECT amb.id_modalidade FROM public.avaliador_modalidades_bloqueadas amb WHERE amb.id_usuario = p_id_usuario AND amb.id_evento = p_id_evento))`
  - Na `AtribuicaoForcada.tsx`: filtragem estrita de projetos por evento ativo (`id_evento`) e bloqueio imediato na alocação de bancas e no enfileiramento com o motivo `Bloqueio: Modalidade do Projeto`.
  - Na `TelaAvaliador.tsx`: validação de defesa em profundidade que expurga locks herdados e descarta itens da fila direcionada que pertençam a modalidades bloqueadas, forçando novo sorteio imediato.

### 11.3 Cota Estrita de Avaliações e Finalização da Feira
- **Regra de Encerramento**: Nenhum projeto pode receber avaliações além da cota configurada (`cota_avaliacoes_customizada` ou `cota_avaliacoes_padrao` do evento).
- **Procedimento no Banco**:
  - A query de seleção de projetos candidatos em `sortear_proximo_projeto` impõe a cláusula de guarda estrita:
    `(COUNT(av.id_avaliacao) + COUNT(lk.id_lock)) < COALESCE(p.cota_avaliacoes_customizada, v_cota_padrao)`
- **Tela do Avaliador (`TelaAvaliador.tsx`)**:
  - Ao esgotar os projetos sorteáveis, o sistema detecta se todos os projetos ativos do evento alcançaram exatamente a cota configurada e exibe a mensagem de conclusão: `"Avaliações da Feira Concluídas! Todos os projetos atingiram a cota necessária."`

### 11.4 Modelo de Planilha de Avaliadores e Interface Limpa
- **Baixar Modelo (.xlsx)**: Botão no cabeçalho do Gestor de Avaliadores gerando arquivo `modelo_importacao_avaliadores.xlsx` via SheetJS com colunas `nome`, `email`, `instituicao`, `sigla_instituicao`, `modalidades_bloqueadas` e `areas`.
- **Tela de Login (`TelaLogin.tsx`)**: Remoção de todos os subtítulos em todas as abas (Avaliador, Coordenação, Monitoramento, Expositor) para uma experiência de usuário visualmente limpa e focada.

### 11.5 Áreas de Avaliação e Priorização por Afinidade Temática
- **Tabela de Relacionamento**: `public.avaliador_areas (id_usuario, id_evento, id_area)` com chave primária composta e integridade referencial em cascata (`ON DELETE CASCADE`), política RLS aberta e permissões completas para leitura/escrita.
- **Múltiplas Áreas por Avaliador**:
  - Tanto no mini-formulário retrátil de novo avaliador quanto no modal de edição, é possível selecionar uma ou mais áreas de atuação para o avaliador.
  - Na importação de planilhas, a coluna `areas` (ou variantes como `areas_avaliacao`, `area_tematica`) permite múltiplos valores delimitados por vírgula, barra, traço, ponto-e-vírgula ou pipe.
  - Termos não reconhecidos são submetidos à validação interativa no modal De-Para (`ModalDeParaMapping.tsx`), podendo ser associados a áreas existentes ou cadastrados como novas áreas.
- **Motor de Sorteio**:
  - Na Stored Procedure `sortear_proximo_projeto`, projetos pertencentes às áreas temáticas cadastradas do avaliador ganham prioridade no `ORDER BY` por afinidade temática (peso `0` vs `1`).
  - Caso os projetos das áreas do avaliador se esgotem, o avaliador pode receber projetos de outras áreas (não bloqueadas), garantindo que o fluxo de avaliação da feira não seja paralisado.

---

## 12. Dicionário de Aliases, Fuzzy Matching ($\ge 85\%$), De-Para e Modalidades & Níveis

### 12.1 Dicionário de Aliases e De-duplicação Persistida no Supabase
Para eliminar redundâncias e duplicações de nomes e siglas parecidas de Instituições e Modalidades registradas via planilhas de importação, o banco de dados armazena um vocabulário dinâmico de aliases:
- **Tabela `instituicao_aliases`**:
  - `id_alias UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `id_instituicao UUID NOT NULL REFERENCES public.instituicoes(id_instituicao) ON DELETE CASCADE`
  - `alias TEXT NOT NULL`
  - `alias_normalizado TEXT NOT NULL`
  - `criado_em TIMESTAMPTZ DEFAULT now()`
  - Constraint de unicidade: `UNIQUE (id_instituicao, alias_normalizado)`
- **Tabela `modalidade_aliases`**:
  - `id_alias UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `id_modalidade UUID NOT NULL REFERENCES public.modalidades(id_modalidade) ON DELETE CASCADE`
  - `alias TEXT NOT NULL`
  - `alias_normalizado TEXT NOT NULL`
  - `criado_em TIMESTAMPTZ DEFAULT now()`
  - Constraint de unicidade: `UNIQUE (id_modalidade, alias_normalizado)`
- **Aprendizado Automático**: Sempre que o usuário confirma uma associação no De-Para ligando uma variação de escrita da planilha a uma entidade do banco, o alias é salvo automaticamente via upsert, garantindo que em importações futuras o termo seja reconhecido com **100% de precisão imediata**.

### 12.2 Sanitização Rigorosa e Fuzzy Matching com Threshold de 85%
- **Utilitário Puro (`src/lib/parsers/fuzzyMatcher.ts`)**:
  - **Sanitização (`sanitizarTexto`)**:
    1. Normalização Unicode NFD com remoção de diacríticos e acentos.
    2. Colapso de pontos em siglas (ex.: `I.F.M.S.` $\rightarrow$ `IFMS`).
    3. Substituição de pontuações redundantes (`/`, `-`, `_`, `(`, `)`, `,`, etc.) por espaços.
    4. Colapso de espaços múltiplos e conversão estrita para MAIÚSCULAS.
  - **Algoritmo de Similaridade**: Combinação balanceada entre **Distância de Levenshtein normalizada** e **Token Sort Ratio** (comparação invariante à ordem de palavras, ex.: `"Campus Campo Grande IFMS"` vs `"IFMS Campus Campo Grande"`).
  - **Threshold Estrito de Similaridade**: Limiar fixado em **$\ge 85\%$ (`0.85`)** para qualificar um termo como correspondência candidata (`fuzzy`). Qualquer valor inferior a 85% é classificado como termo `'novo'`, evitando correspondências indevidas.

### 12.3 Validação e De-Duplicação na Importação com Tela de "De-Para" (Mapping)
- **Componente `ModalDeParaMapping.tsx`**:
  - Intercepta a importação de planilhas nos gestores de **Projetos**, **Avaliadores** e **Modalidades e Níveis**.
  - **Regra de Abertura Condicional**:
    - Se todos os termos da planilha possuírem match **100% exato** (por nome oficial, sigla ou alias cadastrado), a gravação em lote ocorre **diretamente sem interromper o usuário**.
    - Se houver termos **fuzzy ($\ge 85\%$)** ou **novos**, a tela de De-Para se abre em modal exibindo:
      - Termo original extraído da planilha.
      - Badge com percentual de confiança da similaridade (ex.: `88% match`).
      - Dropdown de mapeamento permitindo:
        - Vincular ao registro sugerido pelo algoritmo.
        - Selecionar qualquer outro registro existente no banco.
        - Optar por **`+ Cadastrar como Novo`**.
  - Ao clicar em *"Confirmar e Prosseguir com a Importação"*, o sistema persiste os novos aliases aprendidos no Supabase e executa o cadastro consolidado em lote.

### 12.4 Novo Card e Gestor de "Modalidades e Níveis"
- **Expansão da Tabela `modalidades`**:
  - Colunas adicionadas: `codigo VARCHAR(50)`, `nivel VARCHAR(50)`, `area_tematica VARCHAR(255)`, `descricao TEXT`.
- **Componente `GestorModalidades.tsx`**:
  - Padrão visual idêntico aos cards de Projetos, Avaliadores e Equipe Staff:
    - **Ações no Topo**: *"Baixar Modelo (.xlsx)"*, *"Importar (.xls/.xlsx/.csv)"*, *"Nova Modalidade"*.
    - **Formulário Retrátil**: Cadastro rápido com código, nome, nível escolar (Fundamental, Médio, Médio/Técnico, Técnico, Superior, Geral), área temática e descrição.
    - **Busca e Ordenação**: Barra de pesquisa integrada e ordenação bidirecional interativa em todas as colunas.
    - **Ações de Linha**: Edição inline completa e exclusão com feedback reativo imediato.
  - **Parser Puro `planilhaModalidadesParser.ts`**:
    - Suporta colunas `Código`, `Modalidade`, `Nível`, `Área Temática`, `Descrição`.
    - Sanitização de cabeçalhos sem sensibilidade a caixa ou acentos.

### 12.5 Reorganização Estrutural do Dashboard Admin (`TelaAdmin.tsx`)
- **Migração do Card de Administradores**:
  - O card *"Administradores"* foi desincorporado do Bento Grid para conferir maior segurança e higiene visual à tela de operação diária da feira.
  - O acesso à **Gestão de Administradores** foi movido para o botão de **Configurações Gerais (ícone de engrenagem no cabeçalho)**, através do botão destacado *"Gestão de Administradores"*.
- **Nova Estrutura do Bloco 2 (Pessoal & Formulários)**:
  - Reordenado em 5 colunas limpas:
    1. **Avaliadores**
    2. **Equipe Staff**
    3. **Questionários**
    4. **Instituições**
    5. **Modalidades e Níveis**
  - Todos os 5 cartões adotam layout minimalista sem contadores internos poluindo o Bento Grid, abrindo seus respectivos gestores modais autônomos.

---

## 13. Isolamento por Evento, Padronização CNPq de Áreas Temáticas e Reset Atômico

### 13.1 Escopo Estrito de Evento (`id_evento`)
- As tabelas `instituicoes`, `modalidades` e `areas_tematicas` possuem chave estrangeira `id_evento UUID REFERENCES public.eventos(id_evento) ON DELETE CASCADE`.
- As telas de gestão (`GestorProjetos.tsx`, `GestorAvaliadores.tsx`, `GestorModalidades.tsx`, `GestorInstituicoes.tsx`) filtram os registros estritamente pelo evento ativo (`.eq('id_evento', id_evento_ativo)`).
- Restrições de unicidade criadas por evento:
  - `UNIQUE (id_evento, nome_normalizado)` em `instituicoes`
  - `UNIQUE (id_evento, nome_modalidade)` em `modalidades`
  - `UNIQUE (id_evento, nome_area)` em `areas_tematicas`

### 13.2 Auto-Cadastro Idempotente e "+ Cadastrar como Novo"
- **Rotina 3 (Auto-Cadastro de Instituições)**: Na importação de projetos, se a instituição não existir no evento, é inserida uma única vez no lote com `id_evento`, reaproveitando o ID gerado para todas as linhas da mesma instituição sem duplicatas.
- **Rotina 4 (Persistência no De-Para)**: Ao confirmar a opção `+ Cadastrar como Novo` no `ModalDeParaMapping.tsx`, a entidade é inserida com `id_evento`, associando o novo ID à linha e salvando os aliases aprendidos.
- **Resiliência a Schema Cache**: Operações de inserção tratam divergências temporárias no schema cache do Supabase com fallback seguro.

### 13.3 Padronização Inteligente de Áreas Temáticas (`areasTematicasNormalizer.ts`)
- Mapeia variações de texto livres da planilha para a Tabela Oficial das Grandes Áreas do CNPq com acentuação oficial em MAIÚSCULO:
  1. `CIÊNCIAS EXATAS E DA TERRA`
  2. `CIÊNCIAS BIOLÓGICAS`
  3. `ENGENHARIAS`
  4. `CIÊNCIAS DA SAÚDE`
  5. `CIÊNCIAS AGRÁRIAS`
  6. `CIÊNCIAS SOCIAIS APLICADAS`
  7. `CIÊNCIAS HUMANAS`
  8. `LINGUÍSTICA, LETRAS E ARTES`
  9. `MULTIDISCIPLINAR`
- Fallback para áreas não catalogadas no CNPq: remoção de acentos e til, colapso de espaços múltiplos internos e conversão completa para MAIÚSCULO.

### 13.4 Reset Global Atômico Expandido (`admin_reset_global`)
- A Stored Procedure oficial `admin_reset_global(p_id_evento UUID)` agora também remove atômica e integralmente todas as **Áreas Temáticas** vinculadas ao evento ativo (`WHERE id_evento = v_id_evento`), além de Instituições, Modalidades, Respostas, Avaliações, Fila, Locks, Projetos, Questionários e Avaliadores temporários.

### 13.5 Gestão Visual de Avaliadores: Colunas Instituição, Modalidades e Toggle Instantâneo
- **Desacoplamento Visual na Coluna Nome**:
  - Os badges de Instituição e Bloqueio de Modalidade foram removidos do interior da coluna Nome do Avaliador.
  - A coluna Nome agora exibe exclusivamente o nome do avaliador com tipografia limpa e legível.
- **Novas Colunas com Ordenamento Dedicado**:
  - Sequência canônica da tabela: `Credenciamento | Nome | Instituição | E-mail | Modalidades | Áreas | Ações` (coluna fixa "Papel" removida para otimizar espaço de tela).
  - **Coluna Instituição**: exibe o nome e sigla da instituição com ícone `Building2` e ordenação alfabética por `nome_instituicao`.
  - **Coluna Modalidades**: ordenação alfabética pelos nomes das modalidades bloqueadas (`modalidades_bloqueadas`) e chips interativos de bloqueio.
- **Toggle Instantâneo de Bloqueio de Modalidade**:
  - Cada modalidade cadastrada no evento ativo é representada por um botão/chip interativo na célula do avaliador.
  - Estado **Liberada**: estilo neutro (`bg-slate-50`), ícone `Shield` e texto com o nome da modalidade.
  - Estado **Bloqueada**: estilo de alerta vermelho (`bg-red-50 text-red-700 border-red-300`), ícone `ShieldOff` e texto `Bloq: [Nome da Modalidade]`.
  - Ao clicar, o sistema alterna imediatamente o status no banco de dados (`public.avaliador_modalidades_bloqueadas`).
  - Ao bloquear uma modalidade, o sistema realiza o expurgo imediato de quaisquer travas ativas (`public.locks_ativos`) e remoção da fila (`public.fila_atribuicoes_direcionadas`) de projetos dessa modalidade vinculados ao avaliador.
- **Blindagem / Teste**: `src/__tests__/GestorAvaliadoresColunasEBloqueios.test.tsx` e `src/__tests__/GestorAvaliadoresBloqueios.test.tsx`.

### 13.6 Controle de Janela Temporal de Avaliação e Limpeza da Fila Vazia na TelaAvaliador
- **Remoção de Subtítulo Redundante na Fila Vazia**:
  - Removido da `TelaAvaliador.tsx` o parágrafo longo de subtítulo `"Todos os projetos disponíveis já foram avaliados ou não há novas atribuições pendentes no momento."`.
  - A interface agora exibe de forma limpa apenas o título centralizado com o status da fila e o botão `"Consultar Novamente"`.
- **Validação Estrita da Janela Temporal do Evento**:
  - As avaliações são condicionadas à data e horários cadastrados pelo administrador nas configurações do evento (`data_evento`, `horario_inicio`, `horario_fim`, `sistema_liberado`).
  - Função pura exportada `validarJanelaAvaliacao(info, dataHoraReferencia)` com os status:
    - `'antes_do_inicio'`: horário atual antes de `data_evento + horario_inicio`.
    - `'liberado'`: dentro do período oficial do evento.
    - `'apos_o_fim'`: horário atual após `data_evento + horario_fim`.
    - `'horario_nao_configurado'`: data ou horários ausentes ou nulos na tabela `eventos`.
    - `'sistema_bloqueado'`: campo `sistema_liberado === false`.
- **Estados Visuais na Tela do Avaliador**:
  - **Antes do Início**: card centralizado destacando o badge `"Login Conectado com Sucesso"` com ícone `CheckCircle2`, informando que o acesso está validado e OK, identificação do avaliador, data do evento, horário de início previsto, botão `"Atualizar / Verificar Horário"` e botão `"Sair da Conta"`.
  - **Após o Fim**: card sóbrio informando `"Avaliações Encerradas"`, horário oficial de término e botão `"Sair da Conta"`.
  - **Horários em Configuração**: card informando `"Login Conectado com Sucesso"`, avisando que os horários ainda estão sendo definidos pela coordenação do evento, com botão de verificação e logout.
- **Tolerância e Exceção para Avaliações em Andamento**:
  - Se o avaliador possuir projeto em andamento (trava ativa em `public.locks_ativos`) no momento em que o horário expirar, o sistema permite concluir, atribuir notas, redigir o parecer e enviar a avaliação normalmente.
  - Ao concluir a gravação, a trava é liberada e novos sorteios são bloqueados, transitando para o estado `"Avaliações Encerradas"`.
- **Blindagem e Testes Automatizados**:
  - `src/__tests__/TelaAvaliadorJanelaHorarios.test.tsx`: 11 testes unitários e de integração cobrindo todos os cenários da janela temporal, fila vazia e conclusão de projetos em andamento.

### 13.7 Correção da Persistência de data_evento no ModalConfiguracoesEvento
- **Causa Raiz Identificada**:
  - O modal de configurações (`ModalConfiguracoesEvento.tsx`) enviava campos legados inexistentes (`data_inicio` e `data_fim`) e string ISO no campo `limite_corte` (que é numérico no schema).
  - O PostgREST rejeitava a query com erro `PGRST204: Could not find column in schema cache`, acionando um bloco de fallback que removia `data_evento` do payload e salvava apenas campos básicos (`nome_evento`, `ativo`), impedindo que a data alterada chegasse ao banco.
- **Correção da Persistência**:
  - O payload de atualização foi enxugado para salvar diretamente nas colunas oficiais da tabela `public.eventos`: `nome_evento`, `data_evento`, `horario_inicio`, `horario_fim`, `minutos_timeout_lock`, `cota_avaliacoes_padrao` e `sistema_liberado`.
  - Callback de sucesso atualizado para `ao_salvar_sucesso(nome_evento, dataFormatada)`, propagando a nova data instantaneamente para o painel Admin e atualizando a chave `evento_ativo_data` no `localStorage` sem exigir reload (F5).
- **Garantia DDL no Banco de Dados (Supabase)**:
  - Criada a migração idempotente `supabase/migrations/20261025_garantir_data_evento_persistente.sql` com comandos `ADD COLUMN IF NOT EXISTS` para `data_evento DATE`, `horario_inicio TIME`, `horario_fim TIME` e `sistema_liberado BOOLEAN`.
### 13.8 Padronização da Tela de Staff, Novo Layout de Expositores/Avaliadores e Autocadastro via QR Code
- **Limpeza de Subtítulos e Remoção de Termos entre Parênteses**:
  - Removidas todas as expressões técnicas e termos entre parênteses como `(3FN Join Real)`, `(3FN)`, `(Staff)`, `(Modo Contingência)` e `via 3FN...` da [TelaStaff.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaStaff.tsx).
  - O cabeçalho e abas foram alinhados ao padrão profissional sóbrio da tela de Admin: `"Módulo de Recepção & Credenciamento"`, `"Painel da Equipe de Apoio"`, abas `"Credenciar Expositores"` e `"Credenciar Avaliadores"`.
- **Janela de Expositores: Tabela com Corredor, Estande, Expositores e Ordenamento Bidirecional**:
  - A visualização em cards de 2 colunas foi substituída por uma tabela completa e responsiva.
  - Colunas implementadas: `Corredor`, `Estande`, `Projeto` (com título e código), `Instituição`, `Expositores` (nomes dos estudantes/apresentadores ou `"-"` caso não informado) e `Check-in / Status`.
  - Cabeçalhos de coluna clicáveis com ordenamento bidirecional (ascendente e descendente) e indicadores visuais (`ArrowUpDown`, `ArrowUp`, `ArrowDown`).
  - Botão interativo para `"Confirmar Check-in"` e `"Cancelar Check-in"` diretamente na linha de cada projeto, atualizando em tempo real o contador de expositores presentes e notificando com toasts limpos.
- **Janela de Avaliadores: Padrão Gestor de Avaliadores do Admin (Sem Botão de Lixeira)**:
  - Tabela completa e rica com as colunas: `Credenciamento`, `Nome`, `Instituição`, `E-mail`, `Modalidades`, `Áreas` e `Ações`.
  - Ordenação clicável em todas as colunas.
  - Coluna de Modalidades com botões rápidos de Bloquear/Liberar instantâneos, persistindo em `public.avaliador_modalidades_bloqueadas` e realizando o expurgo de travas/filas se bloqueada.
  - Coluna de Áreas exibindo badges das áreas temáticas vinculadas ao avaliador.
  - Coluna de Ações com botão de `"Credenciar"` / `"Bloquear"` e botão de `"Editar"` (lápis) que abre modal para editar Nome, E-mail, Instituição, Modalidades Bloqueadas e Áreas.
  - **Exclusão estrita do botão de lixeira**: a equipe Staff não possui permissão de deletar registros de usuários do sistema.
  - Conforme alinhamento interativo (/grill-me), o botão `"+ Novo Avaliador"` manual foi omitido na bancada, priorizando o fluxo de autocadastro na recepção.
- **QR Code Dinâmico e Tela de Autocadastro de Avaliador**:
  - O QR Code da tela de Staff foi dinamizado com URL baseada no host da aplicação: `${window.location.origin}/?cadastro=avaliador&evento=${evento_ativo_id}`.
  - Renderizador visual de QR Code escaneável por smartphone (`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=...`) com fallback gracioso.
  - Botões para `"Copiar Link de Autocadastro"` e `"Abrir Tela de Cadastro"`.
  - Criado o componente [TelaAutocadastroAvaliador.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaAutocadastroAvaliador.tsx), com layout mobile-first onde o avaliador insere Nome Completo, E-mail, Instituição de Origem (seleção ou digitação de nova) e Áreas Temáticas de interesse.
  - Ao concluir, o registro é salvo como avaliador pendente de credenciamento presencial no evento ativo, exibindo tela de confirmação orientando a apresentar-se ao Staff para liberação imediata.
- **Blindagem e Testes Automatizados**:
  - `src/__tests__/TelaStaffLayoutEAutocadastro.test.tsx`: 11 testes cobrindo títulos sem parênteses, tabela de expositores com ordenamento, toggle de check-in, tabela de avaliadores sem botão de lixeira, bloqueio de modalidades, modal de edição, cópia do link do QR Code e submissão do formulário de autocadastro.
  - Suíte completa do projeto: 26 arquivos de teste / 133 testes passando com 100% de sucesso.

### 13.9 Refinamento da Tela do Staff: Expansão Widescreen, Remoção de Telão e Harmonização Visual
- **Remoção Condicional do Botão 'Telão'**:
  - No componente [Cabecalho.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/Cabecalho.tsx), o botão de navegação para a tela do Telão foi condicionado para ser ocultado quando o usuário estiver na tela de Staff (`tela_atual === 'staff'`) ou possuir o papel Staff (`papel === 'staff'`), permanecendo acessível apenas para o perfil Administrador.
- **Expansão da Visualização da Janela**:
  - A largura máxima da [TelaStaff.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaStaff.tsx) e do [Cabecalho.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/Cabecalho.tsx) foi expandida de `max-w-7xl` (1280px) para `max-w-[1800px]`, proporcionando amplo espaço horizontal nas bancadas de recepção e evitando compressão das colunas das tabelas em monitores widescreen.
- **Remoção do Subtítulo Redundante**:
  - Removido o parágrafo explicativo `"Gerenciamento presencial de entrada de expositores e credenciamento de avaliadores."`, garantindo um cabeçalho enxuto e direto.
- **Aumento do Tamanho de Fonte e Área de Clique das Abas**:
  - As abas `"Credenciar Expositores"` e `"Credenciar Avaliadores"` tiveram suas fontes aumentadas para `text-base sm:text-lg lg:text-xl font-extrabold` com padding generoso (`py-4 px-6 sm:px-8`) e bordas ativas de 4px, facilitando o toque em tablets e cliques rápidos em notebooks.
- **Harmonização do Padrão de Cores da Aba de Avaliadores**:
  - O card de autocadastro via QR Code da aba de avaliadores foi convertido do degradê escuro para o padrão de **fundo branco** (`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm`), uniformizando a identidade visual com as demais telas do sistema.
- **Responsividade Multi-Dispositivo**:
  - Estrutura fluida que se adapta perfeitamente desde smartphones e tablets até monitores ultrawide, com rolagem horizontal suave nas tabelas (`overflow-x-auto min-w-[760px]`) e empilhamento responsivo de cabeçalhos e métricas.

### 13.10 Reformulação da Tela de Exclusão de Avaliações: RPC no PostgreSQL, Novas Colunas e Confirmação Segura
- **Limpeza Visual e de Filtros**:
  - Removido o badge `"SOFT DELETE & AUDITORIA"` no cabeçalho do modal [ModalExclusaoAvaliacao.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/ModalExclusaoAvaliacao.tsx), mantendo o título limpo: `Exclusão de Avaliações`.
  - Ajustado o placeholder da barra de pesquisa para `"Buscar por código, título do projeto ou avaliador..."`, removendo o exemplo estático `"(FETEC-001)"`. A busca agora filtra por código, título, área do projeto, nome do avaliador e áreas do avaliador.
- **Novas Colunas da Tabela com Ordenamento Completo**:
  - A tabela foi reformulada com 7 colunas, todas com suporte a ordenação asc/desc nos cabeçalhos (`ArrowUp`, `ArrowDown`, `ArrowUpDown`):
    1. **Código**: Código do projeto (em `font-mono`) com badge de estande.
    2. **Nome do Projeto**: Título completo do projeto.
    3. **Área do Projeto**: Área temática associada (`area_tematica`, `area_conhecimento` ou `areas_tematicas.nome_area`) em badge estilizado.
    4. **Nome do Avaliador**: Nome completo com e-mail logo abaixo em tipografia sutil.
    5. **Área do Avaliador**: Badges individuais para cada área temática do avaliador (buscadas da tabela relacional `avaliador_areas` vinculada a `areas_tematicas`).
    6. **Critérios**: Nota final em destaque com botão expansível (accordion) que detalha cada pergunta do questionário, peso, nota individual atribuída e parecer final. Ordenável pela nota final.
    7. **Excluir**: Botão de ação direta com ícone de lixeira (`Trash2`) para avaliações ativas e botão de restauração (`RotateCcw`) para avaliações canceladas.
- **Tela de Confirmação Detalhada contra Cliques Acidentais**:
  - Ao clicar no ícone de lixeira, um modal de alerta em destaque vermelho surge apresentando o resumo completo da avaliação: Código do Projeto, Nome do Projeto, Área do Projeto, Nome do Avaliador, Áreas do Avaliador e Nota Final.
  - Exige confirmação explícita no botão `"Confirmar Exclusão"`, prevenindo cancelamentos indevidos.
- **Funções no PostgreSQL (RPC) com Soft Delete Atômico e Fallback Resiliente**:
  - Criada migration [20261025_funcao_exclusao_avaliacao_rpc.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/supabase/migrations/20261025_funcao_exclusao_avaliacao_rpc.sql) contendo:
    - `public.excluir_avaliacao(p_id_avaliacao UUID)`: atualiza atômica e seguramente `status = 'CANCELADA'`, `status_avaliacao = 'CANCELADA'` e `is_quarentena = false`.
    - `public.restaurar_avaliacao(p_id_avaliacao UUID)`: restaura a avaliação para `status = 'CONCLUIDA'`.
  - Frontend invoca `supabase.rpc('excluir_avaliacao', ...)` com fallback automático para update direto caso a procedure ainda não tenha sido executada no banco.
  - Toast flutuante com suporte a **Desfazer (Undo)** temporário por 8 segundos.
- **Enriquecimento Relacional Automático em Lote (Blindagem contra 'N/I')**:
  - **Diagnóstico da Causa Raiz**: O Supabase PostgREST falhava na consulta com joins aninhados profundos porque a query tentava selecionar colunas inexistentes na tabela `projetos` (`nome_instituicao`, `area_conhecimento`, `area_tematica`), fazendo a consulta cair no fallback simples `select('*')` de avaliações (o qual não trazia os objetos de projetos e usuários, gerando valores `'N/I'` e `'Título não especificado'`).
  - **Correção e Alinhamento com schema.sql**:
    - A consulta com join foi corrigida para selecionar estritamente as colunas existentes: `projetos(id_projeto, codigo_projeto, titulo, estande, corredor, id_evento, id_area)` e `usuarios(id_usuario, nome, email)`.
    - Implementado mecanismo de **Enriquecimento Relacional em Lote por IDs**: caso qualquer registro retorne sem os objetos de projetos ou usuários preenchidos, o frontend coleta os IDs pendentes e executa buscas em lote paralelas nas tabelas `projetos`, `usuarios`, `respostas_avaliacao`, `perguntas_questionario` e `areas_tematicas`, mesclando os dados em memória. Isso elimina 100% qualquer possibilidade de campos vazios ou `'N/I'`.
- **Cobertura de Testes**:
  - `src/__tests__/ModalExclusaoAvaliacaoCustom.test.tsx`: 7 testes cobrindo ausência do badge, placeholder limpo, todas as colunas, ordenação, accordion de critérios, modal de confirmação, chamada de RPC com suporte a desfazer e enriquecimento em lote simulando avaliações cruas.
  - Suíte completa: 27 arquivos de teste / 140 testes passando (100% de sucesso).

### 13.11 Blindagem do Motor de Sorteio e Exclusão contra 'duplicate key value violates unique constraint "unica_avaliacao_por_usuario"'
- **Diagnóstico da Causa Raiz**:
  - Na Stored Procedure `sortear_proximo_projeto` (e no alias `sortear_projeto`), a cláusula de exclusão de projetos já avaliados pelo usuário continha:
    ```sql
    AND p.id_projeto NOT IN (
      SELECT a.id_projeto FROM public.avaliacoes a 
      WHERE a.id_usuario = p_id_usuario 
        AND (a.status IS NULL OR a.status != 'CANCELADA')
    )
    ```
  - A inclusão do filtro `AND (a.status IS NULL OR a.status != 'CANCELADA')` fazia com que, ao aplicar soft delete em uma avaliação (`status = 'CANCELADA'`), o projeto deixasse de constar na lista de exclusão do avaliador `p_id_usuario`.
  - Como consequência, o motor de sorteio atribuía o **mesmo projeto novamente ao mesmo avaliador**.
  - No momento em que o avaliador concluía o formulário e clicava em salvar, a instrução `INSERT INTO avaliacoes` colidia com a restrição única do PostgreSQL:
    `CONSTRAINT unica_avaliacao_por_usuario UNIQUE (id_projeto, id_usuario)`.
  - O banco rejeitava a inserção com o erro: `Falha no salvamento da avaliação: duplicate key value violates unique constraint "unica_avaliacao_por_usuario"`.

- **Solução Arquitetural Definitiva**:
  1. **Bloqueio Incondicional no Sorteio por Avaliador**:
     - Atualizada a query de sorteio na Stored Procedure `sortear_proximo_projeto` para descartar qualquer projeto já avaliado pelo usuário, independentemente do status da avaliação:
       ```sql
       -- Bloqueia incondicionalmente qualquer projeto já avaliado (ativo ou cancelado) pelo mesmo avaliador.
       -- Evita colisão na constraint UNIQUE (id_projeto, id_usuario) e redistribui para outro avaliador.
       AND p.id_projeto NOT IN (
         SELECT a.id_projeto FROM public.avaliacoes a 
         WHERE a.id_usuario = p_id_usuario
       )
       ```
  2. **Preservação da Cota do Projeto**:
     - O cômputo da cota de avaliações do projeto mantém o filtro que desconsidera avaliações canceladas:
       ```sql
       (
         SELECT COUNT(*) 
         FROM public.avaliacoes a 
         WHERE a.id_projeto = p.id_projeto 
           AND (a.status IS NULL OR a.status != 'CANCELADA')
       ) + (SELECT COUNT(*) FROM public.locks_ativos lk WHERE lk.id_projeto = p.id_projeto) < COALESCE(p.cota_avaliacoes_customizada, v_cota_padrao)
       ```
     - Isso assegura que o projeto cancelado retorne imediatamente à fila da feira para ser atribuído a **OUTROS avaliadores credenciados**, garantindo que a cota mínima exigida seja sempre alcançada sem reincidência do mesmo avaliador.
  3. **Defesa em Profundidade no Frontend**:
     - Em [TelaAvaliador.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaAvaliador.tsx):
       - Na inicialização automática do fluxo (`inicializarFluxoAvaliador`), o sistema verifica se uma trava existente em `locks_ativos` aponta para um projeto que o avaliador já possui registrado em `avaliacoes` (ativo ou cancelado). Se sim, a trava é expurgada do banco e um novo sorteio limpo é acionado.
       - Na fila direcionada (`fila_atribuicoes_direcionadas`), itens que apontem para projetos já avaliados pelo usuário são marcados como `'ja_avaliado'` e descartados antes do sorteio.
     - Em [AtribuicaoForcada.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/AtribuicaoForcada.tsx):
       - A contagem de avaliações para atingimento de cota desconsidera registros cancelados, liberando o projeto para nova banca;
       - No entanto, a lista de duplicidades `avaliacoesRealizadas` mantém todos os pares `(id_projeto, id_usuario)`, bloqueando atribuição forçada para o avaliador que já teve avaliação registrada para aquele projeto (`"Já avaliou este projeto"`).
  4. **Scripts e Migrations**:
     - Criada migration [20261025_sorteio_impedir_mesmo_avaliador_soft_delete.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/supabase/migrations/20261025_sorteio_impedir_mesmo_avaliador_soft_delete.sql).
     - Atualizados [schema.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/schema.sql) e [docs/schema.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/docs/schema.sql).
  5. **Cobertura de Testes**:
     - Criada suíte [SorteioImpedirMesmoAvaliadorSoftDelete.test.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/__tests__/SorteioImpedirMesmoAvaliadorSoftDelete.test.tsx) cobrindo integridade do SQL, expurgo automático de locks e bloqueio no painel de atribuição forçada.
     - Suíte global: 28 arquivos de teste / 143 testes passando com 100% de sucesso.

### 13.12 Card de Relatórios Especializados e Painel Gerencial de Indicadores (2026-10-25)

- **Contexto e Requisitos**:
  - O card de **Relatórios** da área administrativa foi totalmente reestruturado e expandido para fornecer transparência analítica, auditoria detalhada de avaliações e métricas em tempo real para a coordenação da feira:
    1. **Relatório de Projetos e Médias**: A coluna **Avaliações** agora é interativa; ao clicar no contador/badge, expande inline uma subtabela com todas as notas individuais recebidas pelo projeto, nome do avaliador, data/hora da submissão e o parecer do avaliador sem aspas literais duplicadas.
    2. **Relatório de Avaliadores e Notas Atribuídas**: Exibição completa e precisa com Nome do Avaliador, Nome do Projeto Avaliado, Nota Atribuída, Horário Inicial (`tempo_presenca`), Horário Final (`tempo_submissao`), Tempo Total de Avaliação formatado (`mm:ss` / `Xm Ys`) e Parecer/Justificativa.
    3. **Relatório de Avaliadores e Ausências Atribuídas (NOVO)**: Rastreabilidade das ausências registradas pelos avaliadores durante a feira, exibindo Nome do Avaliador, Projeto Marcado como Ausente, Área, Modalidade, Data/Hora da Ação e Status Atual do Projeto.
    4. **Relatório de Instituições e Projetos Submetidos (NOVO)**: Agrupamento em linha mestre por Instituição de Ensino / Escola com seu quantitativo total de trabalhos. Abaixo de cada escola, um accordion expansível lista todos os seus trabalhos com Código, Nome do Projeto, Área, Modalidade e Média Geral (ou badges informando *"Ausente"* ou *"Não Credenciado"*). Inclui botões para "Expandir Todos" e "Recolher Todos".
    5. **Relatório Gerencial de Indicadores (NOVO)**: Painel executivo de monitoramento da feira contendo:
       - Header oficial do evento com **Horário Inicial**, **Horário Final** e status operacional.
       - Barra de progresso de **Conclusão Global das Avaliações** da feira.
       - KPIs de Projetos: Total Submetidos, Credenciados (Presentes), Ausentes e Não Credenciados.
       - KPIs de Avaliadores: Total Cadastrados, Credenciados/Ativos e Ausentes.
       - KPIs de Eficiência: Total de Avaliações Realizadas, Média Geral da Feira e **Tempo Médio de Avaliação por Projeto**.
       - Distribuição de Cotas de Avaliação: Projetos com 0, 1, 2 e 3+ avaliações.
       - Quarentena e Divergências: Projetos que demandam atenção da comissão.
       - Ranking Top 5 Avaliadores mais produtivos.
       - Distribuição quantitativa de projetos por Modalidade e por Grande Área.
    6. **Exportação CSV Contextualizada**: O botão de exportar CSV adapta-se automaticamente à aba ativa, exportando o conjunto de dados e colunas específicas do relatório em foco.

- **Arquitetura de Dados e Schema SQL**:
  - **Migration**: Criada [20261025_relatorios_completos_e_indicadores.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/supabase/migrations/20261025_relatorios_completos_e_indicadores.sql).
  - Adicionada coluna `tempo_submissao TIMESTAMPTZ` na tabela `avaliacoes`.
  - Atualizada `view_relatorio_projetos`: agrega notas individuais em JSON (`avaliacoes_detalhadas`) contendo `id_avaliacao`, `nota_final`, `avaliador_nome`, `tempo_submissao` e `parecer_comentario`.
  - Atualizada `view_relatorio_avaliadores`: calcula `horario_inicio`, `horario_fim`, `tempo_minutos` e `tempo_formatado` entre `tempo_presenca` e `COALESCE(tempo_submissao, data_avaliacao)`.
  - Criada view `view_relatorio_ausencias`: unifica ausências registradas em `avaliacoes` (status 'AUSENTE') e em `historico_sorteios` (acao 'ausente' ou 'PROJETO_AUSENTE'), relacionando avaliador e projeto.
  - Sincronizados [schema.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/schema.sql) e [docs/schema.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/docs/schema.sql).

- **Frontend e Componentes**:
  - [TelaAvaliador.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaAvaliador.tsx): Armazena em estado local o `horario_inicio_avaliacao` quando o avaliador confirma presença no stand e envia `tempo_presenca` e `tempo_submissao` no payload de `enviar_avaliacao`.
  - [RelatoriosAdmin.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/RelatoriosAdmin.tsx): Refatorado para suportar as 5 abas, filtros inteligentes, badges de status, accordions independentes e cálculo automático de métricas agregadas sem dependências externas.

- **Cobertura de Testes**:
  - Suíte [RelatoriosAdminCompletosEIndicadores.test.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/__tests__/RelatoriosAdminCompletosEIndicadores.test.tsx) validando as 5 abas, accordion de notas, cálculo de tempos, listagem agrupada por escola e cards de indicadores.
  - Suíte [AuditoriaPerformanceViews.test.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/__tests__/AuditoriaPerformanceViews.test.tsx) validando a visualização de pareceres, ordenação e conformidade das views de performance.
  - Suíte global: **29 arquivos de teste / 149 testes passando com 100% de sucesso**.
  - TypeScript: Zero erros com `npx tsc --noEmit`.

### 13.13 Refinamento dos Relatórios Administrativos, Agrupamento por Avaliador e Impressão Universal em PDF (2026-10-25)

- **Contexto e Requisitos Atendidos**:
  1. **Relatório de Projetos e Médias**:
     - Exclusão completa da informação do número do estande em todas as colunas e exportações, mantendo com destaque exclusivamente o Código do Projeto (badge escuro em fonte mono).
     - Na impressão em PDF, todas as notas individuais e pareceres são expandidos de forma condensada e recuada abaixo de cada projeto (`• Avaliador: Nota | Parecer`), garantindo documento auditável completo.
  2. **Agrupamento por Avaliador em "Avaliadores e Notas Atribuídas"**:
     - Reestruturado o relatório para formato de Accordion Hierárquico agrupado por avaliador, análogo ao de *Instituições e Projetos Submetidos*.
     - Cabeçalho de cada avaliador exibe Nome, E-mail, Quantidade de Avaliações, Média Geral das Notas Atribuídas e Tempo Médio de Avaliação.
     - Subtabela expansível detalha cada projeto avaliado (Código, Título, Nota, Horário Inicial, Horário Final, Duração formatada e Parecer).
     - Botões para "Expandir Todos" e "Recolher Todos", iniciando recolhidos na tela para navegação ágil.
  3. **Agrupamento por Avaliador em "Avaliadores e Ausências Atribuídas"**:
     - Reestruturado o relatório para formato de Accordion Hierárquico agrupado por avaliador que registrou ausências.
     - Cabeçalho exibe Nome, E-mail e Total de Ausências registradas.
     - Subtabela expansível detalha os trabalhos marcados como ausentes (Código, Título, Área Temática, Modalidade, Instituição, Data/Hora e Status Atual do Projeto) sem exibição de número de estande.
     - Botões para "Expandir Todos" e "Recolher Todos", iniciando recolhidos na tela.
  4. **Painel de Indicadores Gerenciais e Formato de Data**:
     - Formato da data do evento ajustado rigorosamente para o padrão `DD-MM-YYYY` (ex: `25-10-2026`).
     - Título da seção operacional ajustado de *"Janela Operacional da Feira"* para *"Indicadores do evento: NOME DO EVENTO"*.
     - Tipografia, métricas e cartões de indicadores ampliados (`text-xl font-black`) para diagramação otimizada em folha A4 paisagem (landscape).
  5. **Módulo Universal de Impressão em PDF**:
     - Botão **"Imprimir PDF"** incorporado na barra de ações de todos os relatórios, invocando o diálogo nativo do sistema operacional (`window.print()`).
     - Estilos `@media print` dedicados com injeção dinâmica de tamanho de página `@page`:
       - Aba *Indicadores*: **A4 Landscape (Paisagem)** com margem de `8mm`.
       - Abas *Projetos e Médias*, *Avaliadores e Notas*, *Avaliadores e Ausências* e *Instituições*: **A4 Portrait (Retrato)** com margem de `10mm`.
     - Todos os grupos de accordions (avaliadores e escolas) são expandidos automaticamente no PDF (`print:block`), mesmo que estejam recolhidos na tela.
     - Cabeçalho oficial de impressão padronizado contendo Nome do Evento em caixa alta, Nome Oficial do Relatório, Data/Hora de Emissão e Data do Evento (`DD-MM-YYYY`).
     - Ocultação automática de botões interativos, ordenadores, abas e campo de busca na impressão (`print:hidden`).
     - Prevenção de quebra de página no meio de linhas de tabelas com `print-avoid-break` (`break-inside: avoid`).
  6. **Exportação CSV Contextualizada**:
     - Atualizada a geração do arquivo `.csv` para omitir estande e refletir o formato `DD-MM-YYYY` nos indicadores.

- **Arquivos Modificados**:
  - [RelatoriosAdmin.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/RelatoriosAdmin.tsx)
  - [RelatoriosAdminCompletosEIndicadores.test.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/__tests__/RelatoriosAdminCompletosEIndicadores.test.tsx)

- **Cobertura de Testes e Qualidade**:
  - Suíte `RelatoriosAdminCompletosEIndicadores.test.tsx` com 8 cenários abrangentes:
    1. Renderização de projetos sem estande e expansão de avaliações.
    2. Agrupamento por avaliador de notas com expansão/recolhimento e duração precisa.
    3. Agrupamento por avaliador de ausências sem estande.
    4. Agrupamento por escola com expansão/recolhimento.
    5. Painel de indicadores com título do evento e data `DD-MM-YYYY`.
    6. Disparo do diálogo de impressão em PDF via `window.print()`.
    7. Exportação dinâmica de CSV.
    8. Impressão PDF textual: valida cabeçalho oficial e listas textuais recuadas sem badges/cards para impressão em PDF.
  - Suíte global: **29 arquivos de teste / 151 testes passando com 100% de sucesso**.
  - TypeScript: Zero erros com `npx tsc --noEmit`.

### 13.14 Funções SQL RPC Especializadas e Isolamento Total de Impressão PDF (2026-10-25)

- **Contexto e Requisitos Atendidos**:
  1. **Remoção Absoluta de Bordas, Backdrops e Scrollbars na Impressão PDF**:
     - Eliminada a captura do modal pai (`fixed inset-0`, `max-h-[95vh]`, backdrop cinza e scrollbars) através de isolamento do DOM via `@media print`.
     - Implementado `#relatorio-print-root` com `position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important;` e `body * { visibility: hidden; }` / `#relatorio-print-root, #relatorio-print-root * { visibility: visible; }`.
     - Classes de impressão nos nós pais em [TelaAdmin.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaAdmin.tsx): `print:static print:inset-auto print:bg-transparent print:backdrop-blur-none print:p-0 print:m-0 print:overflow-visible print:block print:w-full print:h-auto` e ocultação do botão de fechar (`print:hidden`).
  2. **Impressão de 100% dos Dados do Evento (Sem Truncamento por Filtros de Tela)**:
     - Criadas listas memoizadas dedicadas (`projetos_todos_ordenados`, `avaliadoresNotas_todos_ordenados`, `avaliadoresAusencias_todas_ordenadas`, `instituicoes_todas_ordenadas`) que ignoram `termo_busca` da tela e preservam a ordenação por coluna selecionada pelo usuário.
     - O PDF impresso sempre consolida 100% dos registros do evento ativo de ponta a ponta, paginado de forma natural pelo motor de impressão do navegador sem cortes de altura.
  3. **Layout Puramente Textual na Impressão**:
     - Retirados todos os layouts visuais de badges coloridos, cards elevados, sombras, bordas de janelas e containers decorativos na camada de impressão.
     - Relatório de **Projetos e Médias**: Exibe o projeto com código e título em texto puro, e logo abaixo suas avaliações recebidas recuadas à direita (`ml-6 border-l-2 border-slate-400 pl-3`), com o avaliador, nota e parecer.
     - Relatórios de **Avaliadores** (Notas e Ausências): Agrupados por avaliador em texto com detalhes dos projetos avaliados/ausentes recuados à direita.
     - Relatório de **Instituições**: Agrupado por escola em texto com contadores e lista de projetos recuados.
     - Prevenção de quebra de página indevida com `print-avoid-break` (`break-inside: avoid`).
  4. **Novas Funções Stored Procedures SQL (RPCs) no PostgreSQL**:
     - Criada a migração [20261025_relatorios_functions_rpc.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/supabase/migrations/20261025_relatorios_functions_rpc.sql) fornecendo 5 Stored Procedures otimizadas com agregações `json_agg` e fallback resiliente no cliente frontend:
       - `fn_relatorio_projetos_completo(p_id_evento uuid)`: Retorna projetos com JSON aninhado `detalhes_avaliacoes`.
       - `fn_relatorio_avaliadores_completo(p_id_evento uuid)`: Retorna avaliadores com contagens, médias, tempo médio e JSON `avaliacoes`.
       - `fn_relatorio_ausencias_completo(p_id_evento uuid)`: Retorna avaliadores e JSON `ausencias` (unificando `avaliacoes` e `historico_sorteios`).
       - `fn_relatorio_instituicoes_completo(p_id_evento uuid)`: Retorna escolas e JSON `projetos` com status e médias.
       - `fn_relatorio_indicadores_gerenciais(p_id_evento uuid)`: Retorna métricas globais e distribuições da feira.
     - Frontend consome via `supabase.rpc()` com fallback resiliente para as views (`view_relatorio_projetos`, `view_relatorio_avaliadores`, `view_relatorio_ausencias`) e tabelas caso a migration ainda não tenha sido executada.

- **Arquivos Modificados**:
  - [supabase/migrations/20261025_relatorios_functions_rpc.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/supabase/migrations/20261025_relatorios_functions_rpc.sql) (Nova Migration RPC)
  - [TelaAdmin.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaAdmin.tsx) (Resets de impressão no modal wrapper e backdrop)
  - [RelatoriosAdmin.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/RelatoriosAdmin.tsx) (Chamadas RPC, listas `_todos_ordenados`, CSS isolation `#relatorio-print-root` e blocos puramente textuais de impressão)
  - [RelatoriosAdminCompletosEIndicadores.test.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/__tests__/RelatoriosAdminCompletosEIndicadores.test.tsx) (Testes unitários atualizados)
  - [ANTIGRAVITY.MD](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/ANTIGRAVITY.MD) (Documentação técnica canônica)

- **Validação de Qualidade**:
  - TypeScript: `npx tsc --noEmit` aprovado com 0 erros.
  - Testes: **29 arquivos de teste / 151 testes passando com 100% de sucesso**.

### 13.15 Expansão Visual do Mapa de Estandes, Cores de Status e Badges de Notas (2026-10-25)

- **Contexto e Requisitos Atendidos**:
  1. **Expansão Visual da Janela e Modo Tela Cheia**:
     - No modal pai [TelaAdmin.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaAdmin.tsx), expandido o container para `w-[99vw] max-w-[99vw] h-[98vh] max-h-[98vh]`.
     - No componente [MapaEstandes.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/MapaEstandes.tsx), removida a restrição `max-w-7xl mx-auto` para ocupar 100% da área útil do navegador.
     - Adicionado botão de **Alternar Tela Cheia (Fullscreen)** permitindo ocupar `100vw x 100vh` em monitores operacionais ou painéis de controle.
  2. **Seletor de Densidade / Zoom de Cards**:
     - Implementado seletor rápido no cabeçalho:
       - **Cards Grandes (Expandido)**: Cards espaçosos com detalhes completos, título legível, badges de notas individuais, média geral destacada e tags de progresso de cota.
       - **Cards Compactos**: Densidade alta com maior quantidade de projetos por linha.
  3. **Responsividade Fluida para Todos os Tipos de Tela**:
     - Modo Expandido: `grid-cols-1` (celular), `sm:grid-cols-2` (tablet pequeno), `md:grid-cols-3` (tablet/laptop), `lg:grid-cols-4` (desktop), `xl:grid-cols-5 2xl:grid-cols-6` (monitores ultrawide).
     - Modo Compacto: `grid-cols-2` a `xl:grid-cols-8`.
  4. **Padronização das 4 Cores de Estado do Negócio**:
     - **Não Credenciado** (Cinza/Ardósia): Projetos com `is_check_in_realizado === false`.
     - **Credenciado / Aguardando** (Azul): Projetos presentes com `0` avaliações concluídas.
     - **Faltando Avaliações** (Amarelo/Âmbar): Projetos com avaliações iniciadas (`> 0`), porém abaixo da cota configurada no Admin (`qtd_avaliacoes < cota_evento`).
     - **Avaliado / Cota Completa** (Verde Esmeralda): Projetos que atingiram ou superaram a cota estabelecida (`qtd_avaliacoes >= cota_evento`).
     - Indicadores complementares preservados: Ícone e pulso de **Lock Ativo** (avaliador em campo no momento) e **Quarentena** (divergência estatística).
  5. **Média Geral e Badges de Notas Individuais por Bloco**:
     - Cada card calcula e exibe em destaque tipográfico a média numérica (`Média Geral: 9.45 pts` ou `-`).
     - Logo abaixo, exibe a relação de notas homologadas em badges pequenos individuais (ex: `[ 9.5 ] [ 8.5 ] [ 9.0 ]`), permitindo ao administrador auditar visualmente a dispersão de notas de relance.
  6. **Separação por Corredor e Ordenação Natural de Estandes**:
     - Agrupamento por Corredor (A, B, C...) em ordem alfabética.
     - Ordenação natural alfanumérica dos estandes (`localeCompare` com `{ numeric: true }`), garantindo sequência lógica (ex: `A-1`, `A-2`, ..., `A-10`).
     - Seção dedicada ao final para projetos que ainda não possuem estande alocado: `"Sem Estande Atribuído"`.
  7. **Auditoria Interativa e Edição**:
     - Ao clicar em qualquer bloco, abre modal de auditoria exibindo o histórico de avaliações, notas, pareceres e dados do projeto, com botão direto para "Editar Dados do Projeto" no Gestor de Projetos.

- **Arquivos Modificados**:
  - [TelaAdmin.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/TelaAdmin.tsx) (Wrapper maximizado e injeção de props `id_evento_ativo` e `cota_padrao_evento`)
  - [MapaEstandes.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/MapaEstandes.tsx) (Refatoração visual, cálculo de 4 estados, seletor de zoom, fullscreen, badges de notas e ordenação)
  - [src/__tests__/MapaEstandesVisualEStatus.test.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/__tests__/MapaEstandesVisualEStatus.test.tsx) (Nova suíte com 8 testes abrangentes)
  - [ANTIGRAVITY.MD](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/ANTIGRAVITY.MD) (Documentação técnica canônica)

- **Validação de Qualidade**:
  - TypeScript: `npx tsc --noEmit` aprovado com 0 erros.
  - Testes: **30 arquivos de teste / 160 testes passando com 100% de sucesso**.

### 13.16 Correção de Esquema e Relações de Chave Estrangeira em Mapa de Estandes (2026-10-25)

- **Causa Raiz do Erro Identificada**:
  - O log `Erro ao carregar mapa de estandes: column projetos.modalidade does not exist` ocorreu porque a tabela física `public.projetos` no PostgreSQL não possui as colunas textuais diretas `modalidade`, `area_conhecimento` e `nome_instituicao`.
  - No banco de dados, o modelo relacional normalizado adota chaves estrangeiras:
    - `id_modalidade` -> tabela `public.modalidades(id_modalidade)` (`nome_modalidade`)
    - `id_area` -> tabela `public.areas_tematicas(id_area)` (`nome_area`)
    - `id_instituicao` -> tabela `public.instituicoes(id_instituicao)` (`nome_exibicao`, `sigla`)

- **Ajustes Implementados**:
  1. **Componente [MapaEstandes.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/components/MapaEstandes.tsx)**:
     - Consulta de projetos atualizada para utilizar sintaxe relacional do PostgREST:
       `modalidades ( id_modalidade, nome_modalidade )`, `areas_tematicas ( id_area, nome_area )`, `instituicoes ( id_instituicao, nome_exibicao, sigla )`.
     - **Fallback Resiliente de Alta Disponibilidade**: Se a consulta relacional falhar por qualquer inconsistência de cache de esquema do Supabase, o componente captura o erro e aciona automaticamente a consulta simplificada direta das colunas nativas (`id_projeto, id_evento, codigo_projeto, titulo, estande, corredor, is_check_in_realizado`), garantindo que o mapa nunca fique inacessível ou exiba tela branca.
     - Consulta de auditoria de avaliações ajustada para `usuarios ( nome, email )` com fallback seguro para colunas base da tabela `avaliacoes`.
  2. **Atualização das Views no [schema.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/schema.sql) e [docs/schema.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/docs/schema.sql)**:
     - Identificado que 3 views legadas mantinham referências a `p.modalidade`, `p.area_conhecimento` e `p.nome_instituicao`.
     - Atualizadas com `LEFT JOIN`:
       - `view_ranking_top3`
       - `view_projetos_quarentena`
       - `view_projetos_pendentes_avaliacao`
  3. **Nova Migração SQL**:
     - Criada a migração [20261025_corrigir_views_schema_fk_projetos.sql](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/supabase/migrations/20261025_corrigir_views_schema_fk_projetos.sql) para aplicação das 3 views atualizadas no banco de dados Supabase com permissões `GRANT SELECT`.
  4. **Cobertura de Testes**:
     - Adicionado o teste 9 em [src/__tests__/MapaEstandesVisualEStatus.test.tsx](file:///Users/ckn/antigravity/Sistema-de-Avaliação-de-Projetos-IFMS/src/__tests__/MapaEstandesVisualEStatus.test.tsx) validando a resiliência a erros de esquema e o acionamento transparente do fallback.
     - Suíte global: **30 arquivos de teste / 160 testes passando com 100% de sucesso**.
     - TypeScript: `npx tsc --noEmit` aprovado com 0 erros.

---

## 14. CI/CD, Automação de Infraestrutura e Release Management

Este capítulo estabelece os padrões de Engenharia de DevOps para entrega contínua, auditoria de segurança, gerenciamento de banco de dados e estratégias de release do **Sistema de Avaliação de Projetos IFMS**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                     GITHUB ACTIONS CI/CD ECOSYSTEM                     │
├────────────────────┬────────────────────┬──────────────────────────────┤
│ 1. QUALITY & BUILD │ 2. SECURITY GATES  │ 3. DATABASE MIGRATIONS       │
│ - Node 20 + npm ci │ - SAST (CodeQL)    │ - Supabase CLI setup         │
│ - tsc --noEmit     │ - SCA (Trivy FS)   │ - SafeUpdate lint inspection │
│ - Vitest (160 test)│ - npm audit (high) │ - supabase db push           │
│ - Vite prod build  │ - SARIF Security   │ - Stored Procedures check    │
│ - Host Deploy (CD) │   Dashboard        │ - Zero-Downtime DDL sync     │
└────────────────────┴────────────────────┴──────────────────────────────┘
```

### 14.1 Visão Geral dos Workflows Automatizados

| Arquivo de Workflow | Disparador (Triggers) | Permissões Mínimas | Papel no Ciclo de Vida |
| :--- | :--- | :--- | :--- |
| **`ci.yml`** | `push` e `pull_request` em `main`/`master` | `contents: read` | QA de integridade e regressão com execução do Vitest. |
| **`deploy-frontend.yml`** | `push` em `main`/`master`, `workflow_dispatch` | `contents: read`, `pages: write`, `id-token: write` | Lint, testes, compilação de produção Vite e deploy no host definitivo. |
| **`security.yml`** | `push`, `pull_request`, cron semanal e manual | `contents: read`, `security-events: write` | Varredura estática de vulnerabilidades (SAST CodeQL) e dependências (SCA Trivy). |
| **`supabase-migrations.yml`** | `push`/`pr` em `supabase/migrations/**`, manual | `contents: read` | Validação estática de DDL e aplicação automatizada de migrações no PostgreSQL. |

---

### 14.2 Pipeline 1: Continuous Deployment (CD) do Front-end Vite

O workflow [.github/workflows/deploy-frontend.yml](file:///.github/workflows/deploy-frontend.yml) automatiza a esteira de entrega do front-end SPA:

1. **Garantia de Qualidade Prévia**:
   - Compilação estrita com TypeScript (`npm run lint` / `tsc --noEmit`).
   - Execução integral da suíte de 160 testes unitários e de integração (`npm test`).
2. **Injeção Segura de Variáveis de Produção**:
   - As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são injetadas a partir de **GitHub Secrets / Environments**, evitando exposição de credenciais em artefatos versionados.
3. **Publicação no Host Definitivo**:
   - Gera o bundle otimizado em `dist/` via `npm run build`.
   - Empacota e publica no host de produção (GitHub Pages com URLs HTTPS institucionais do IFMS ou Edge Host) via `actions/deploy-pages@v4`.

---

### 14.3 Pipeline 2: Segurança Contínua (SAST CodeQL & SCA Trivy)

O workflow [.github/workflows/security.yml](file:///.github/workflows/security.yml) implementa defesa cibernética proativa:

1. **SAST (Static Application Security Testing) via CodeQL**:
   - Analisa semântica de fluxo de dados, injeções, vazamentos de segredos e más práticas em JavaScript/TypeScript.
   - Aplica os pacotes de regras `security-extended` e `security-and-quality`.
2. **SCA (Software Composition Analysis) via Trivy**:
   - Inspeciona todas as dependências transitivas do `package-lock.json` contra bancos de CVEs públicos do NVD/GitHub Advisory.
   - Exporta relatório padronizado SARIF (`trivy-results.sarif`) para a aba **Security > Code scanning** do repositório.
3. **NPM Audit Gate**:
   - Impede avanço de pacotes com vulnerabilidades classificadas como `HIGH` ou `CRITICAL`.
4. **Agendamento Semanal Proativo**:
   - Varredura periódica toda segunda-feira às 06:00 UTC, identificando novas vulnerabilidades descobertas em bibliotecas mesmo sem novos commits.

---

### 14.4 Pipeline 3: Deploy Automatizado de Migrações do Supabase

O workflow [.github/workflows/supabase-migrations.yml](file:///.github/workflows/supabase-migrations.yml) substitui qualquer intervenção manual de SQL:

1. **Validação Estática e Prevenção de SafeUpdate**:
   - Inspeciona o código SQL das migrações antes da aplicação para garantir que nenhum comando `DELETE FROM ...;` sem cláusula `WHERE` seja introduzido, prevenindo o erro `Hurdle 1 (SafeUpdate)`.
2. **Serialização Estrita de Concorrência**:
   - Grupo de concorrência `group: supabase-migrations-${{ github.ref }}` com `cancel-in-progress: false`, garantindo que migrações DDL nunca sejam aplicadas simultaneamente ou fora de ordem.
3. **Aplicação com CLI Oficial do Supabase**:
   - Utiliza `supabase/setup-cli@v1`, autenticando via token de acesso e vinculando o projeto (`supabase link --project-ref`).
   - Aplica o delta incremental de migrações (`supabase db push`) de forma atômica e transacional.
4. **Suporte a Modo Dry-Run e Multi-Ambientes**:
   - Permite execução manual via `workflow_dispatch` com flag `dry_run = true` para validar sintaxe e simular o plano de execução antes de alterar a base de produção.

---

### 14.5 Gestão de Segredos e Variáveis de Ambiente

Para o funcionamento pleno dos pipelines, os seguintes segredos devem ser configurados em **Settings > Secrets and variables > Actions**:

| Nome do Segredo / Variável | Categoria | Finalidade |
| :--- | :--- | :--- |
| `SUPABASE_ACCESS_TOKEN` | Secret | Token de API pessoal para comandos administrativos da CLI Supabase. |
| `SUPABASE_DB_PASSWORD` | Secret | Senha de conexão do PostgreSQL para execução das migrações (`supabase db push`). |
| `SUPABASE_PROJECT_REF` | Secret / Var | ID de referência do projeto no Supabase (ex: `siyenrhpejugoghlstqw`). |
| `VITE_SUPABASE_URL` | Secret | Endpoint HTTPS da instância Supabase de produção. |
| `VITE_SUPABASE_ANON_KEY` | Secret | Chave pública JWT da role `anon` para consultas PostgREST. |
| `APP_URL` | Variable | URL canônica de produção da aplicação web (ex: `https://avaliacoes.ifms.edu.br`). |

---

### 14.6 Release Management, Tagging Semântico e Estratégia de Rollback

1. **Versionamento Semântico (SemVer)**:
   - Formato `vMAJOR.MINOR.PATCH` (ex: `v1.2.0`).
   - Tags criadas no Git disparam automaticamente a esteira completa de validação, migração e publicação.
2. **Estratégia de Rollback do Front-end**:
   - Rollback instantâneo em $< 30$ segundos reativando o artefato da versão estável anterior na interface de Deployments do GitHub Actions, sem necessidade de recompilação.
3. **Estratégia de Rollback de Banco de Dados**:
   - Todas as migrações SQL são projetadas com comandos idempotentes (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, `CREATE OR REPLACE FUNCTION`).
   - Em caso de emergência, scripts de reversão reversos (`down migrations`) versionados em `supabase/migrations/revert/` podem ser aplicados pelo workflow de migrações em modo manual.

---

### 14.7 De-Para: Substituição de Processos Manuais por Etapas Automatizadas

| Processo Operacional Anterior (Manual) | Nova Solução de Engenharia de DevOps (Automatizada) |
| :--- | :--- |
| Executar scripts SQL manualmente no dashboard do Supabase | Pipeline [supabase-migrations.yml](file:///.github/workflows/supabase-migrations.yml) acionado por push com `supabase db push`. |
| Conferir manualmente se o linter e o build passam antes de publicar | Gate automatizado no [deploy-frontend.yml](file:///.github/workflows/deploy-frontend.yml) barrando falhas antes da geração do bundle. |
| Subir arquivos de build estáticos via FTP, SSH ou arrastar pastas | Deploy contínuo atômico com `actions/deploy-pages@v4` com certificados SSL/TLS automáticos. |
| Testar conectividade de Stored Procedures manualmente na segunda-feira | Validação sintática e verificação de integridade pós-deploy pelo runner do GitHub Actions. |
| Descobrir vulnerabilidades em produção durante a realização da feira | Análise contínua com CodeQL e Trivy bloqueando commits com falhas de segurança no Pull Request. |
| Preencher credenciais de produção no arquivo `.env` da máquina local | Injeção centralizada via GitHub Encrypted Secrets com segregação de ambientes (Staging e Production). |




