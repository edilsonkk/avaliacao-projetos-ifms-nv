# PRD — Sistema de Avaliação de Projetos IFMS

| | |
|---|---|
| **Status** | Retrato do produto atual + lacunas e roadmap |
| **Data** | 26-10-2026 |
| **Base** | Análise do código (`src/`, `supabase/migrations/`, `schema.sql`, `src/__tests__/`) e de `ANTIGRAVITY.MD` |
| **Documentos relacionados** | [`ANTIGRAVITY.MD`](../ANTIGRAVITY.MD) (especificação técnica), [`README.md`](../README.md) |

---

## 1. Visão do produto

Plataforma web para operar **feiras científicas e mostras tecnológicas do IFMS** (ex.: FETEC MS). Ela cobre o ciclo completo de um evento: carga de dados, credenciamento presencial, distribuição automática de projetos aos avaliadores, avaliação por critérios ponderados, auditoria de notas divergentes, relatórios e premiação ao vivo.

O sistema é uma SPA (React 19 + Vite + Tailwind) sobre o Supabase (PostgreSQL + PostgREST + Auth). A lógica crítica (sorteio, cotas, agregações, ranking, reset) fica no banco, em views e stored procedures.

## 2. Problema e objetivos

**Problema.** Em uma feira com centenas de projetos e dezenas de avaliadores, a distribuição manual de avaliações gera conflitos de interesse, projetos sem avaliação ou avaliados em excesso, filas na recepção e notas inconsistentes descobertas tarde demais.

| # | Objetivo | Meta mensurável |
|---|---|---|
| O1 | Credenciamento ágil e sem atrito | Check-in de avaliador ou expositor em menos de 10 s, sem senha |
| O2 | Distribuição automática e justa | 0 avaliações de projetos da própria instituição do avaliador; 0 avaliações em modalidade bloqueada |
| O3 | Cobertura completa | 100% dos projetos presentes atingem a cota configurada (padrão 3) e nenhum a ultrapassa |
| O4 | Integridade das notas | 100% dos projetos com divergência > 2,5 pontos sinalizados em quarentena antes da homologação |
| O5 | Transparência em tempo real | Telão e painéis atualizados a partir de views do banco, sem cálculo no cliente |
| O6 | Carga em massa rápida | Importação de centenas de registros por planilha em cerca de 1 s, com deduplicação |

## 3. Personas e papéis

| Persona | Papel (`usuarios.papel`) | Tela | Autenticação | O que pode fazer |
|---|---|---|---|---|
| **Coordenação / Administrador** | `ADMIN` (`SUPERADMIN`) | `TelaAdmin` | Supabase Auth (e-mail + senha, recuperação de senha, OAuth) | Tudo: configurar o evento, cadastros e importações, atribuição forçada, quarentena, desbloqueios, exclusão de avaliações, relatórios, reset global, gestão de administradores |
| **Staff / Recepção** | `STAFF`, `MONITOR` | `TelaStaff` | Somente e-mail (role `anon`) | Check-in de expositores, credenciar/bloquear avaliadores, editar dados e bloqueios de modalidade/áreas, divulgar QR Code de autocadastro. **Não exclui registros** |
| **Avaliador** | `AVALIADOR` | `TelaAvaliador` | Somente e-mail (role `anon`) | Receber projeto sorteado ou direcionado, marcar presença/ausência do expositor, avaliar por critérios, redigir parecer |
| **Avaliador não cadastrado** | — | `TelaAutocadastroAvaliador` (via QR Code) | Sem login | Cadastrar-se como avaliador pendente de credenciamento |
| **Público / Plateia** | — | `TelaoAoVivo` | Acesso pela rota `/telao` | Ver o progresso da feira e, na premiação, o ranking |
| **Expositor (estudante/orientador)** | — | — | — | Não usa o sistema; é credenciado pelo Staff |

## 4. Escopo

**Dentro do escopo (implementado):** configuração do evento; cadastros e importação de Projetos, Avaliadores, Staff, Instituições, Modalidades e Níveis, Questionários; login por papel; autocadastro por QR Code; credenciamento; motor de sorteio; atribuição forçada (banca e fila); avaliação; quarentena; bloqueios e desbloqueios; exclusão/restauração de avaliações; mapa de estandes; telão; ranking; relatórios com CSV/PDF; reset global.

**Fora do escopo (hoje):**
- Submissão de projetos pelos próprios estudantes (a carga é feita pela coordenação).
- Vários eventos ativos ao mesmo tempo (o sistema trabalha com um "evento ativo").
- Recursos de IA: `GEMINI_API_KEY` e `@google/genai` estão declarados, mas não são usados em `src/`.
- Emissão de certificados e notificações por e-mail aos avaliadores.
- App nativo ou modo offline completo (há apenas fallbacks em `localStorage`).

---

## 5. Requisitos funcionais

Os critérios de aceite referenciam as suítes em `src/__tests__/` que já os cobrem.

### 5.1 Configuração do evento — `ModalConfiguracoesEvento`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-01 | O admin define nome, `data_evento`, `horario_inicio`, `horario_fim`, `cota_avaliacoes_padrao`, `minutos_timeout_lock` e `sistema_liberado` | A data salva persiste após recarregar e é propagada ao cabeçalho sem F5 (`ModalConfiguracoesEventoData.test`) |
| RF-02 | Criar um novo evento e torná-lo ativo | `GestaoNovoEvento.test` |
| RF-03 | Cadastros (instituições, modalidades, áreas, projetos) são isolados por `id_evento` | Gestores filtram por `.eq('id_evento', ativo)`; unicidade por evento |

### 5.2 Cadastros e importação em massa — `Gestor*`, `ModalDeParaMapping`, `src/lib/parsers/*`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-10 | Cada gestor oferece "Baixar Modelo (.xlsx)", "Importar" e cadastro manual, com busca e ordenação por coluna | Seis gestores: Projetos, Avaliadores, Staff, Instituições, Modalidades e Níveis, Questionários |
| RF-11 | Importação em lote (parsing em memória + upsert único) por chave natural: `codigo_projeto` (projetos), `email` (usuários), `nome_normalizado` (instituições) | Reimportar a mesma planilha não duplica registros (`ChaveNaturalUpsert.test`) |
| RF-12 | Termos de instituição, modalidade e área são comparados por sanitização + similaridade (Levenshtein + token sort) com limiar **≥ 85%** | `fuzzyMatcher.test` |
| RF-13 | Se todos os termos têm correspondência exata (nome, sigla ou alias), grava direto; senão abre o **De-Para**, com % de confiança, troca de vínculo ou "+ Cadastrar como Novo" | `GestorModalidadesEDePara.test`, `CotaEstritaEAutoCadastroDePara.test` |
| RF-14 | Vínculos confirmados no De-Para viram aliases (`instituicao_aliases`, `modalidade_aliases`) e são reconhecidos automaticamente nas importações seguintes | — |
| RF-15 | Áreas temáticas são normalizadas para as 9 grandes áreas do CNPq (com fallback em maiúsculas sem acento) | `areasTematicasNormalizer.test` |
| RF-16 | Instituições inexistentes na importação de projetos são cadastradas uma única vez por lote | `AutoCadastroEAreasTematicasEvento.test` |
| RF-17 | Projeto guarda evento, instituição, área, modalidade, estande, corredor, orientador, estudantes, cota customizada, "fora da competição" e "forçar topo da fila" | `GestorProjetosCamposCompletos.test` |
| RF-18 | Avaliador guarda instituição, várias áreas de atuação e modalidades bloqueadas; o bloqueio é alternado com um clique na tabela | `GestorAvaliadoresAreas.test`, `GestorAvaliadoresBloqueios.test`, `GestorAvaliadoresColunasEBloqueios.test` |
| RF-19 | Questionário tem escala, perguntas ordenadas, `peso_calculo` e `peso_desempate`; o projeto pode fixar um questionário | — |
| RF-20 | Formatos aceitos: `.xlsx` e `.csv` | `.xls` é recusado com mensagem orientando a conversão (`excelUtils.ts`) |

### 5.3 Acesso e autocadastro — `TelaLogin`, `TelaAutocadastroAvaliador`, `App`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-30 | Login em abas por perfil: Avaliador e Staff só com e-mail; Admin com e-mail + senha no Supabase Auth | `LoginZeroFriccao.test` |
| RF-31 | Usuário sem papel `admin` não acessa a aba Admin, mesmo com senha válida (sessão é encerrada) | — |
| RF-32 | Escrita administrativa sem sessão válida dispara o aviso "Sessão de administrador expirada" e redireciona ao login | `SessaoAdmin.test` |
| RF-33 | O Staff exibe QR Code com `?cadastro=avaliador&evento=<id>`; o formulário mobile cria um avaliador **pendente de credenciamento** | `TelaStaffLayoutEAutocadastro.test` |

### 5.4 Credenciamento — `TelaStaff`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-40 | Tabela de expositores (corredor, estande, projeto, instituição, expositores, status) com confirmar/cancelar check-in e contador ao vivo | `TelaStaffLayoutEAutocadastro.test` |
| RF-41 | Tabela de avaliadores com credenciar/bloquear, editar e alternar modalidades; **sem botão de exclusão** | idem |
| RF-42 | Contadores de credenciados não duplicam | `SincroniaContadores.test` |

### 5.5 Motor de sorteio — `sortear_proximo_projeto` (SQL) + `TelaAvaliador`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-50 | Ao pedir projeto, o avaliador credenciado recebe primeiro sua fila direcionada; depois, um projeto sorteado | — |
| RF-51 | O sorteio respeita as regras RN-01 a RN-07 (seção 6) | `RegrasNegocioBloco1/2.test`, `BloqueioModalidadesSorteioEAtribuicao.test`, `SorteioImpedirMesmoAvaliadorSoftDelete.test` |
| RF-52 | O projeto sorteado fica travado (`locks_ativos`) para o avaliador até concluir ou expirar (`minutos_timeout_lock`) | — |
| RF-53 | Quando todos os projetos atingem a cota, mostra "Avaliações da Feira Concluídas!" | `CotaEstritaEAutoCadastroDePara.test` |

### 5.6 Atribuição forçada — `AtribuicaoForcada`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-60 | Modo **Banca**: vários avaliadores no mesmo projeto ao mesmo tempo | `AtribuicaoForcada.test` |
| RF-61 | Modo **Fila**: enfileirar projetos priorizados para um avaliador | idem |
| RF-62 | Avaliadores inelegíveis aparecem com o motivo: "Conflito: Mesma Instituição", "Bloqueio: Modalidade do Projeto", "Já avaliou este projeto" | idem |

### 5.7 Avaliação — `TelaAvaliador`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-70 | Antes de avaliar, o avaliador confirma **presença** ou **ausência** do expositor; a ausência é registrada e o projeto é liberado | — |
| RF-71 | Formulário com as perguntas do questionário, nota por critério, nota final ponderada e parecer; registra `tempo_presenca` e `tempo_submissao` | — |
| RF-72 | Janela temporal: estados `antes_do_inicio`, `liberado`, `apos_o_fim`, `horario_nao_configurado` e `sistema_bloqueado`, cada um com sua tela | `TelaAvaliadorJanelaHorarios.test` |
| RF-73 | Quem já está com projeto travado quando o horário termina pode concluir a avaliação; depois disso, novos sorteios ficam bloqueados | idem |

### 5.8 Auditoria e controle — `ProjetosQuarentena`, `ProjetosBloqueados`, `ModalExclusaoAvaliacao`, `ModalDetalhamento`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-80 | Listar projetos em quarentena (flag ou divergência > 2,5) e remover a quarentena de um ou de todos | `view_projetos_quarentena`, `admin_remover_quarentena[_todos]` |
| RF-81 | Listar projetos travados e desbloquear um ou todos (ex.: travas abandonadas no almoço) | `admin_desbloquear_projeto`, `admin_desbloquear_todos` |
| RF-82 | Excluir avaliação por **soft delete** (`CANCELADA`) com modal de confirmação detalhado, **desfazer em até 8 s** e restauração posterior; o projeto volta à fila de outros avaliadores | `ModalExclusaoAvaliacaoCustom.test`, `RestricaoExclusaoZumbis.test` |
| RF-83 | Reset global atômico do evento ativo (projetos, avaliações, filas, locks, cadastros e áreas) | `ResetGlobal.test` |

### 5.9 Acompanhamento e resultados — `MapaEstandes`, `TelaoAoVivo`, `RankingPremiacao`, `RelatoriosAdmin`
| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-90 | Mapa de estandes por corredor, com cores por status (pendente, em avaliação, concluído, quarentena, ausente) e badges de notas | `MapaEstandesVisualEStatus.test` |
| RF-91 | Telão: percentuais de concluídas, em andamento, na fila e em quarentena, e a barra de progresso geral, **sem revelar notas** durante a feira | — |
| RF-92 | Ranking para a premiação, agrupado por modalidade e filtrável por modalidade e área (`RankingPremiacao` sobre `view_ranking_top3`) | — |
| RF-93 | Cinco relatórios: Projetos e Médias, Avaliadores e Notas, Avaliadores e Ausências, Instituições e Projetos, Indicadores Gerenciais | `RelatoriosAdminCompletosEIndicadores.test`, `AuditoriaPerformanceViews.test` |
| RF-94 | Exportação CSV conforme a aba ativa e impressão em PDF (A4 retrato; Indicadores em paisagem) com 100% dos registros, ignorando o filtro da tela | idem |

---

## 6. Regras de negócio consolidadas

| ID | Regra | Onde está implementada |
|---|---|---|
| RN-01 | **Conflito institucional:** o avaliador nunca avalia projeto da própria instituição | `sortear_proximo_projeto` (`IS DISTINCT FROM`), `AtribuicaoForcada.tsx` |
| RN-02 | **Modalidade bloqueada:** projetos de modalidades bloqueadas para o avaliador são descartados; ao bloquear, locks e itens de fila pendentes dessa modalidade são apagados | SQL + `GestorAvaliadores.tsx`, `TelaStaff.tsx`, `TelaAvaliador.tsx` |
| RN-03 | **Cota estrita:** `avaliações ativas + locks < COALESCE(cota_customizada, cota_padrao)` | `sortear_proximo_projeto` |
| RN-04 | **Sem repetição:** o avaliador nunca recebe um projeto que já avaliou, **mesmo que a avaliação tenha sido cancelada** (a constraint `UNIQUE (id_projeto, id_usuario)` impede); a avaliação cancelada não conta para a cota | `20261025_sorteio_impedir_mesmo_avaliador_soft_delete.sql` |
| RN-05 | **Ordem do sorteio:** 1º projetos com `forcar_topo_fila`; 2º afinidade temática (áreas do avaliador); depois, menos avaliações recebidas, menos faltas e estande. Quando acabam os projetos das suas áreas, ele recebe de outras | `ORDER BY` em `sortear_proximo_projeto` |
| RN-06 | **Uma trava por avaliador** (`locks_ativos.id_usuario UNIQUE`). O sorteio automático ignora projetos com qualquer trava ativa; várias travas no mesmo projeto (banca) só existem pela atribuição forçada | `locks_ativos`, `sortear_proximo_projeto` |
| RN-07 | Travas expiradas são apagadas a cada chamada de sorteio | `sortear_proximo_projeto` |
| RN-08 | **Quarentena:** com ≥ 2 avaliações ativas e `max − min > 2,5`, ou com a flag `is_quarentena` | `view_projetos_quarentena` |
| RN-09 | Avaliação só é aceita dentro da janela do evento e com `sistema_liberado = true`, salvo projeto já travado | `validarJanelaAvaliacao` em `TelaAvaliador.tsx` |
| RN-10 | Só entram no sorteio projetos com **check-in realizado** e que **não** estejam marcados como "fora da competição" | `sortear_proximo_projeto` |
| RN-11 | Staff não exclui usuários; exclusões e reset são exclusivos do Admin | `TelaStaff.tsx` + RLS definitivo |
| RN-12 | **Ausência:** quando o avaliador marca o expositor como ausente, o impedimento é gravado em `historico_impedimentos` e o projeto deixa de ser sorteado **para aquele avaliador**, mas continua disponível para os demais | `TelaAvaliador.tsx` + SQL |

## 7. Requisitos não funcionais

| Categoria | Requisito |
|---|---|
| Desempenho | Importação em lote (um upsert por planilha); agregações em views e RPCs (`fn_relatorio_*`) |
| Segurança | RLS em todas as tabelas. Escrita administrativa só para `authenticated` com `is_admin()`. Operações de avaliador e Staff limitadas ao escopo operacional. `TRUNCATE` revogado; views com `security_invoker` |
| Resiliência | Fallback quando o schema cache do PostgREST diverge; RPCs com fallback para views e tabelas; enriquecimento em lote para evitar campos "N/I"; contingência em `localStorage` |
| Usabilidade | Interface sem jargão técnico; dashboard admin em Bento Grid com modais; UUIDs nunca exibidos; Staff em widescreen (até 1800 px) e tablet; avaliador e autocadastro mobile-first; modo escuro |
| Qualidade | TDD com Vitest + Testing Library (padrão AAA, seletores acessíveis), **31 suítes / 169 testes passando** (26-10-2026); `tsc --noEmit`; CI com build de produção |
| DevOps | GitHub Actions: `ci.yml`, `deploy-frontend.yml` (GitHub Pages), `security.yml` (CodeQL, Trivy, npm audit), `supabase-migrations.yml` |

## 8. Modelo de dados (resumo)

```
eventos ─┬─ instituicoes ── instituicao_aliases
         ├─ modalidades ─── modalidade_aliases
         ├─ areas_tematicas
         ├─ questionarios ── perguntas_questionario
         ├─ projetos ─────── avaliacoes ── respostas_avaliacao
         └─ avaliadores_evento (usuarios × evento, instituição, credenciado)
usuarios ─┬─ avaliador_areas / avaliador_modalidades_bloqueadas (por evento)
          ├─ locks_ativos (1 por usuário)
          ├─ fila_atribuicoes_direcionadas
          └─ historico_impedimentos
```

**Views:** `view_ranking_top3`, `view_relatorio_admin`, `view_relatorio_projetos`, `view_relatorio_avaliadores`, `view_relatorio_ausencias`, `view_projetos_quarentena`, `view_projetos_pendentes_avaliacao`, `view_avaliadores_credenciados`.

**Integrações externas:** Supabase (BD, Auth, PostgREST) e `api.qrserver.com` (geração da imagem do QR Code).

## 9. Fluxos principais

**Semana da feira (referência operacional):**
1. **Seg:** deploy, migrações, instituições, áreas e modalidades.
2. **Ter:** importação de projetos, questionários, avaliadores e Staff; simulação de um ciclo.
3. **Qua:** credenciamento às 07h30; rodadas 1 e 2; desbloqueio de travas no almoço; atribuição forçada.
4. **Qui:** rodada 3 focada em projetos abaixo da cota; auditoria de quarentena; `sistema_liberado = false`.
5. **Sex:** homologação, relatórios, premiação no telão e arquivamento.

**Jornada do avaliador:**
1. Escaneia o QR Code e se cadastra, ou já está cadastrado.
2. O Staff confirma o credenciamento.
3. Faz login com o e-mail e o sistema valida a janela de horário.
4. Recebe um projeto (fila direcionada ou sorteio) e vai ao estande.
5. Marca presença ou ausência, avalia os critérios, escreve o parecer e envia.
6. A trava é liberada e ele pede o próximo projeto, até a cota da feira se esgotar ou o horário terminar.

## 10. Métricas de sucesso

- Percentual de projetos presentes que atingiram a cota (meta: 100%).
- Número de violações de RN-01 a RN-04 (meta: 0).
- Tempo médio de avaliação por projeto e tempo médio de check-in.
- Percentual de projetos em quarentena e tempo até a resolução.
- Taxa de importação sem intervenção no De-Para; ela deve crescer a cada evento conforme os aliases são aprendidos.
- Incidentes durante o evento (tela branca, erro de RLS, travas órfãs).

---

## 11. Lacunas, riscos e roadmap

> **Auditoria de segurança (26-10-2026).** Uma revisão do controle de acesso encontrou três falhas de **Broken Access Control**, todas porque a autorização estava no cliente e o banco confiava em dados do navegador. As migrations `20261026010000` (RPC de envio de nota), `20261026020000` (leitura sensível) e `20261026030000` (funções admin) endereçam L12, L13 e L14. L1 (login sem senha do avaliador) continua pendente e é o que fecha em definitivo o L12.

| # | Achado no código | Risco | Recomendação | Prioridade |
|---|---|---|---|---|
| L12 | **Gravação de nota sem validação server-side:** `TelaAvaliador.tsx` faz `insert` direto em `avaliacoes`/`respostas_avaliacao` com `id_usuario` vindo do `localStorage`, e a RLS aceita `WITH CHECK (true)` | Qualquer cliente `anon` grava nota em nome de qualquer avaliador, fora da escala, sem trava e fora da janela | **Mitigado:** `fn_enviar_avaliacao` (`SECURITY DEFINER`) valida trava, elegibilidade, conflito, cota, janela e faixa, e calcula `nota_final` no banco; INSERT anônimo direto removido. **Fechado só com L1** (sem OTP, `id_usuario` ainda vem do cliente). Requer trocar `TelaAvaliador` para `rpc('fn_enviar_avaliacao')` | **Alta** |
| L13 | **Leitura pública de PII e notas:** a RLS dá `SELECT TO anon` em tudo, expondo `usuarios.cpf`, `celular`, `senha_hash` (coluna morta) e todas as notas/pareceres | Vazamento de dados pessoais (LGPD) e de notas antes da homologação | **Corrigido** por `20261026020000`: `senha_hash` removida; `cpf`/`celular` e `nota_final`/`parecer_final` saem do alcance da `anon` via GRANT de coluna | **Alta** |
| L14 | **Funções admin abertas à `anon`:** `admin_reset_global`, `excluir/restaurar_avaliacao`, `admin_desbloquear_*`, `admin_remover_quarentena_*` são `SECURITY DEFINER` sem checar o chamador e com `GRANT EXECUTE TO anon` | Visitante anônimo chama `admin_reset_global` e **apaga o evento inteiro** | **Corrigido** por `20261026030000`: `REVOKE EXECUTE FROM anon` + guard `is_admin()` em excluir/restaurar | **Alta** |
| L1 | Avaliador e Staff entram **só com e-mail** (sem senha/OTP) e escrevem no banco como `anon`; o `id_usuario` vem do `localStorage` | Qualquer pessoa que saiba o e-mail de um avaliador age em nome dele | Migration 1 (não feita): OTP/magic link do Supabase Auth, para o `id_usuario` vir de `auth.uid()` em vez do payload — é o que fecha o L12 por completo | **Alta** |
| L2 | `20261026000000_rls_admin_definitivo.sql` e as migrations de segurança acima precisam ser **coladas à mão** no SQL Editor; o CI não as aplica, embora exista `supabase-migrations.yml` | Divergência entre o repositório e o banco; a migration 4 só protege depois de aplicada | Commitar, aplicar as 4 migrations e ativar de fato o workflow de migrations | **Alta** |
| L3 | Papel e sessão em `localStorage`; a guarda de rota (`App.tsx`) é só no cliente | Basta editar o `localStorage` para abrir as telas (o RLS segura a escrita admin, mas não a leitura) | Derivar o papel da sessão do Supabase; restringir leituras sensíveis (notas, pareceres) via RLS | Média |
| L4 | Views citam `historico_sorteios`, mas nenhuma migration cria essa tabela | O relatório de ausências pode falhar ou depender do fallback | Criar a tabela ou remover a referência; usar `historico_impedimentos` de forma consistente | Média |
| L5 | A interface fala em "Importar (.xls/.xlsx/.csv)", mas `.xls` é recusado | Confusão do usuário | Ajustar os rótulos para `.xlsx/.csv` | Baixa |
| L6 | `@google/genai`, `express`, `dotenv` e `GEMINI_API_KEY` sem uso | Superfície de ataque e dependências desnecessárias | Remover, ou definir um caso de uso de IA (ex.: resumo de pareceres) | Baixa |
| L7 | QR Code gerado por `api.qrserver.com` | Dependência externa no dia do evento; o link (com o id do evento) é enviado a terceiros | Gerar o QR Code localmente (biblioteca JS) | Média |
| L8 | Componentes muito grandes (`RelatoriosAdmin` com 3,2 mil linhas, `GestorAvaliadores` 2,5 mil, `GestorProjetos` 2,1 mil) e `schema.sql` duplicado em `docs/` | Manutenção cara e regressões | Extrair hooks e serviços de dados; ter uma única fonte de schema | Média |
| L9 | Documentação desatualizada: ANTIGRAVITY cita SheetJS (o código usa `exceljs`), contagens de testes antigas e `supabase/migrations/revert/`, que não existe | Decisões tomadas com base em informação errada | Revisar o ANTIGRAVITY.MD e tratar este PRD como fonte do "o quê/porquê" | Baixa |
| L10 | Sem multi-evento simultâneo nem histórico consultável após o reset global | Perda de dados históricos se o reset for usado no lugar do arquivamento | Arquivar o evento (flag `is_ativo`) em vez de apagar; exportação completa antes do reset | Média |
| L11 | Apesar do nome, `view_ranking_top3` devolve **todos** os projetos com avaliação, ordenados por média geral simples, sem particionar por modalidade, sem limitar a 3, sem filtrar "fora da competição" e sem usar `peso_desempate`. O agrupamento e o corte ficam no front | Pódio pode incluir projeto fora da competição avaliado por atribuição forçada; empates sem critério oficial | Reescrever a view com `ROW_NUMBER() OVER (PARTITION BY modalidade ORDER BY media DESC, desempate DESC)`, filtrando `is_fora_da_competicao` | **Alta** |

**Roadmap sugerido**
- **Aplicar já (SQL Editor):** L14 e L13 (migrations `...030000` e `...020000`, não dependem de frontend), depois L12 (migration `...010000` junto da troca de `TelaAvaliador` para `rpc('fn_enviar_avaliacao')`).
- **Curto prazo (antes do próximo evento):** L1 (OTP, fecha o L12), L2 (aplicar/automatizar as migrations), L11, L4, L5, L7.
- **Médio prazo:** L3, L8, L10; certificados para avaliadores; notificações por e-mail.
- **Longo prazo:** portal de submissão de projetos; multi-evento; IA para apoio à comissão (resumo de pareceres, detecção de outliers).

## 12. Perguntas em aberto

1. O login sem senha de avaliadores é requisito de produto (atrito zero) ou pode virar código/OTP?
2. O telão deve revelar notas em algum momento, ou só o ranking final na premiação?
3. Qual o critério oficial de desempate: `peso_desempate` por critério, decisão da comissão ou ambos?
4. A divergência de 2,5 pontos deve ser configurável por evento/escala?
5. Hoje a ausência bloqueia o projeto só para o avaliador que a registrou. Após N ausências, o projeto deveria sair de todos os sorteios?
6. Há exigência de retenção de dados (LGPD) para CPF e celular dos avaliadores após o evento?
