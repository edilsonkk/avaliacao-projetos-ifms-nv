# Documentação

Comece pela [visão geral](arquitetura/visao-geral.md). Para contribuir, leia o
[CONTRIBUTING](../CONTRIBUTING.md).

## Procurando…

| Pergunta | Onde |
|---|---|
| O que o sistema faz e para quem? | [PRD](PRD.md), [visão geral](arquitetura/visao-geral.md) |
| Onde coloco um arquivo novo? Como crio uma feature? | [Front-end](arquitetura/frontend.md) |
| Quais padrões de código e de interface seguir? | [Padrões](arquitetura/padroes.md) |
| Quem pode ler/escrever o quê? | [Segurança](arquitetura/seguranca.md) |
| Ameaças, revisão OWASP/MITRE e achados | [Modelo de ameaças](arquitetura/modelo-de-ameacas.md) |
| Variáveis de ambiente e `localStorage` | [Configuração](arquitetura/configuracao.md) |
| O que significa cada tabela/coluna? | [Modelo de dados](banco-de-dados/modelo-de-dados.md) |
| Que funções/RPCs existem? | [Funções e RPCs](banco-de-dados/funcoes-e-rpcs.md) |
| Como criar e aplicar uma migration? | [Migrations](banco-de-dados/migrations.md) |
| Como funciona o sorteio, conflito, cota, bancas? | [Sorteio e atribuição](regras-de-negocio/sorteio-e-atribuicao.md) |
| Notas, quarentena, exclusão de avaliação | [Avaliação e quarentena](regras-de-negocio/avaliacao-e-quarentena.md) |
| Evento ativo, janela de horário, reset global | [Eventos](regras-de-negocio/eventos.md) |
| Importação de planilhas, De-Para, aliases, CNPq | [Importação de planilhas](regras-de-negocio/importacao-de-planilhas.md) |
| Gestão de projetos e mapa de estandes | [Projetos e estandes](regras-de-negocio/projetos-e-estandes.md) |
| Login, Staff, credenciamento, autocadastro | [Credenciamento e pessoas](regras-de-negocio/credenciamento-e-pessoas.md) |
| Relatórios, PDF, classificação, telão | [Relatórios e monitoramento](regras-de-negocio/relatorios-e-monitoramento.md) |
| Deu um erro conhecido | [Troubleshooting](operacao/troubleshooting.md) |
| Como publicar uma versão, rollback, backup, segredos | [CI/CD e deploy](operacao/ci-cd-e-deploy.md) |
| Como rodar o banco localmente / criar Admin | [Configuração](arquitetura/configuracao.md#desenvolvimento-local) |
| Roteiro da semana da feira | [Cronograma da feira](operacao/cronograma-da-feira.md) |
| Por que foi decidido assim? | [Decisões (ADRs)](decisoes/README.md) |
| Como escrever testes? | [TESTES_TDD](../.agents/rules/TESTES_TDD.md) |

## Estrutura

```
docs/
├── PRD.md                  Requisitos do produto e roadmap
├── arquitetura/            Como o sistema é construído
├── banco-de-dados/         Modelo de dados, funções e migrations
├── regras-de-negocio/      Regras vigentes, um arquivo por domínio
├── operacao/               Deploy, troubleshooting e operação da feira
└── decisoes/               ADRs: o porquê das decisões
```

## Mantendo a documentação

- As **regras de negócio** descrevem o estado **atual**. Ao mudar uma regra, edite o texto; não acrescente um
  "histórico". O histórico fica no git e nos ADRs.
- Toda mudança de comportamento atualiza a doc do domínio afetado **no mesmo PR** (item do template de PR).
- Use links relativos entre documentos e caminhos a partir da raiz do repositório para código
  (`src/features/...`). Nunca use `file:///`.
- Não registre contagens que mudam a todo commit (número de testes, de migrations).
- Não coloque segredos, chaves ou senhas em nenhum documento.
- Quando não tiver certeza de um fato, marque com `> ⚠️ A confirmar` em vez de adivinhar.
