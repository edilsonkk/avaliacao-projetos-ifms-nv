# Cronograma Operacional da Feira

Roteiro padrão de uma semana de feira (segunda a sexta). Serve de checklist para a coordenação e para a equipe
técnica. Ajuste os horários à realidade de cada evento.

```
SEGUNDA              TERÇA                QUARTA               QUINTA               SEXTA
[Preparação]         [Carga de dados]     [Feira – dia 1]      [Feira – dia 2]      [Premiação]
08:00 Deploy         08:00 Projetos       07:30 Check-in       08:00 Rodada 3       08:30 Comissão
13:00 Instituições   13:00 Questionários  08:30 Rodada 1       11:30 Quarentena     10:30 Relatórios
17:00 Prontidão      15:30 Pessoas        13:30 Rodada 2       15:30 Encerramento   14:00 Cerimônia
```

## Segunda-feira: preparação técnica

- **08:00–10:30**: publicar a versão da feira (merge do PR de release: migrations + front-end,
  [CI/CD](ci-cd-e-deploy.md#como-uma-versão-é-publicada)) e conferir o pipeline de segurança.
- **10:30–12:00**: verificação pós-deploy: login nos quatro perfis, sorteio de teste, relatórios abrindo.
- **13:00–15:30**: importar Instituições (`GestorInstituicoes`), revisando o De-Para.
- **15:30–17:00**: cadastrar Áreas Temáticas (CNPq) e Modalidades e Níveis.
- **17:00–18:00**: checagem de prontidão. Anotar a tag em produção (para rollback) e ligar
  `CONGELAMENTO_DEPLOY = true` ([congelamento](ci-cd-e-deploy.md#congelamento-durante-a-feira)). Correção crítica
  durante a feira só com o modo *emergencia*.

## Terça-feira: carga de dados e calibração

- **08:00–11:00**: importar a planilha final de projetos (`GestorProjetos`) e conferir estandes e corredores.
- **11:00–12:00**: conferir duplicidades por `codigo_projeto`.
- **13:00–15:30**: ativar os questionários prontos ou reaproveitar os de eventos anteriores (`GestorQuestionarios`), e
  conferir critérios, escala, pesos de cálculo e prioridade de desempate.
- **15:30–17:00**: importar avaliadores (instituição, áreas, modalidades bloqueadas) e equipe Staff. Criar a conta
  de cada Staff no painel do Supabase ([como](../arquitetura/configuracao.md#criar-um-membro-do-staff)) e conferir a
  seção **Acesso dos avaliadores** nas Configurações do evento.
- **17:00–18:00**: simular um ciclo completo de avaliação em homologação. Configurar data, horários, cota e timeout
  do evento.

## Quarta-feira: feira, dia 1

- **07:30–08:30**: credenciamento na `TelaStaff`: check-in de estandes e **pareamento do celular de cada avaliador**
  (o avaliador mostra o código, o Staff clica em Aparelho → Parear); autocadastro por QR Code para quem não estava
  cadastrado.
- **08:30–12:00**: **1ª rodada**. Avaliadores recebem projetos por sorteio na `TelaAvaliador`.
- **12:00–13:30**: intervalo. Liberar travas abandonadas em **Projetos Bloqueados** (`admin_desbloquear_todos`).
- **13:30–17:30**: **2ª rodada**. Usar **Atribuir Projeto** para bancas em projetos complexos.
- **17:30–18:00**: fechamento. O Telão mostra a evolução das metas, sem notas.

## Quinta-feira: feira, dia 2

- **08:00–11:30**: **3ª rodada**, com foco em projetos abaixo da cota (Mapa de Estandes em âmbar).
- **11:30–13:00**: auditoria de **Projetos em Quarentena** (divergência > 2,5 pontos).
- **13:00–15:30**: avaliações de desempate em banca.
- **15:30–16:00**: encerrar as avaliações (`sistema_liberado = false` nas configurações do evento).
- **16:00–18:00**: conferir a lista de finalistas (Classificação / `view_ranking_top3`).

## Sexta-feira: homologação e premiação

- **08:30–10:30**: reunião da comissão científica para homologação das notas.
- **10:30–12:00**: emitir relatórios oficiais (PDF/CSV) em **Relatórios**.
- **14:00–17:00**: cerimônia. Ranking top 3 revelado no **Telão**.
- **17:00–18:00**: rodar *Actions → Backup do Banco (Produção)*, baixar o backup e guardá-lo fora do GitHub (o
  artefato expira em 30 dias). Desligar `CONGELAMENTO_DEPLOY`. Só depois disso considerar o [reset global](../regras-de-negocio/eventos.md#reset-global).
