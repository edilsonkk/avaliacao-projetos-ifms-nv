# Auditoria da documentação

Revisão de `docs/` contra o código, as migrations e as próprias regras de manutenção do
[índice](../README.md#mantendo-a-documentação). Cada achado tem um identificador (`D1`, `D2`…) para a próxima
auditoria comparar. Achado resolvido fica **riscado** com a data, em vez de sair da tabela.

- **Rodada atual:** 2026-11-14 (primeira; ver "Linha de base"). **Todos os 17 achados foram corrigidos na mesma
  data**, no mesmo PR da auditoria.
- **Método:** guardas automatizadas (`npm run guardas:docs`) + conferência manual de cada afirmação verificável
  contra `supabase/migrations/`, `supabase/schema.sql`, `src/` e `package.json`.

## Linha de base

Não existia rodada anterior com que comparar. O arquivo deste relatório não estava no repositório nem no histórico
do git (`git log --all -- 'docs/auditoria/*'` não devolvia nada). Os achados de auditoria já registrados eram os de
**segurança (26-10-2026)** e de **notas (06-11-2026)**, que ficam no [roadmap](../roadmap.md) como `L1`–`L24` e
tratam do código, não da documentação. Portanto, nesta rodada, "resolvido desde a última" e "continua pendente" não
se aplicam: `D1`–`D17` nasceram aqui.

## O que está saudável

Verificado nesta rodada, sem achado:

- As guardas de `npm run lint` passam: 51 arquivos `.md`, todos os links e âncoras resolvem, nenhum caminho de
  código citado em backticks está morto, nenhuma doc órfã, nenhum segredo, auto-contexto (`CLAUDE.md` +
  `AGENTS.md`) dentro do orçamento.
- **Migrations:** as 69 de `supabase/migrations/` estão descritas em
  [migrations](../banco-de-dados/migrations.md), inclusive a mais recente (`20261114010000`).
- **ADRs:** todos os arquivos `NNNN-*.md` estão no [índice](../decisoes/README.md).
- **Regras conferidas contra o SQL:** quarentena (divergência > 2,5 com ao menos 2 avaliações), média bayesiana do
  voto popular (fórmula e `m` automático do [ADR 0016](../decisoes/0016-voto-popular-separado-e-media-bayesiana.md)),
  contadores do Telão (técnico × votante), checagens `C1`–`C14` da conferência de notas.
- **Configuração:** a tabela de chaves do `localStorage` e a de variáveis de ambiente em
  [configuração](../arquitetura/configuracao.md) batem com `src/`; Node 24+ bate com os workflows e com `engines`.
- **Funções:** nenhuma RPC chamada pelo front-end está ausente do banco.

## Achados

Todos resolvidos em 2026-11-14. A coluna "Correção" diz o que foi feito.

| # | Gravidade | Onde | Achado | Correção |
|---|---|---|---|---|
| D1 | **Alta** | [funções e RPCs](../banco-de-dados/funcoes-e-rpcs.md) | ~~`fn_enviar_avaliacao` descrita como **"único caminho para gravar notas"**, enquanto o mesmo arquivo documenta `admin_lancar_avaliacao`, `admin_arbitrar_nota_final`, `admin_corrigir_respostas_avaliacao` e `admin_ajustar_media_projeto`, que também gravam ou alteram nota. `AGENTS.md` repetia a frase~~ | Passou a "único caminho **do avaliador**", com parágrafo listando os caminhos da coordenação (todos `is_admin()`, marcados em `ajuste_tipo` e na trilha). A regra 3 do `AGENTS.md` foi reescrita no mesmo sentido |
| D2 | **Alta** | [ADR 0007](../decisoes/0007-gravacao-de-notas-via-rpc.md) | ~~Título e última consequência ("a identidade do avaliador **ainda vem do cliente**") não valiam mais: a função recusa `p_id_usuario` diferente de `avaliador_atual()` desde a migration `20261028220000`. O índice mostrava "Aceito", sem referência a 0011/0015~~ | Status virou "Aceito, emendado por 0011 e 0015" (no ADR e no índice), a consequência foi corrigida e o ADR ganhou a seção **Emendas**. O [ADR 0015](../decisoes/0015-ajuste-manual-de-notas.md) ganhou **Relacionados** apontando de volta para o 0007 |
| D3 | **Alta** | [roadmap](../roadmap.md) (L12) | ~~L12 dizia "**Fechado só com L1** (sem OTP, `id_usuario` ainda vem do cliente)" e "requer trocar `TelaAvaliador` para `rpc(...)`", enquanto o "Roadmap sugerido" do mesmo arquivo dizia que a troca já estava feita~~ | L12 riscado com a data real (2026-10-28) e com o fecho da identidade; L1 passou a dizer que o vínculo do aparelho substituiu o OTP; o "Roadmap sugerido" foi refeito (curto prazo = L15 e L10) |
| D4 | Média | [roadmap](../roadmap.md) (L4) | ~~L4 afirmava que "views citam `historico_sorteios`", nome que não aparece mais em `supabase/` nem em `src/` — só no próprio roadmap. Ainda estava no "curto prazo"~~ | Riscado como obsoleto |
| D5 | Média | [roadmap](../roadmap.md) (L5) | ~~L5 ("a interface fala em `.xls`") já estava resolvido: todos os campos usam `accept=".csv, .xlsx"` e `src/lib/excel/excelUtils.ts` recusa o legado com mensagem~~ | Riscado |
| D6 | Média | [roadmap](../roadmap.md) (L6), [PRD](../PRD.md) | ~~Os dois diziam que `@google/genai`, `express`, `dotenv` e `GEMINI_API_KEY` "estão declarados". Nenhum está no `package.json`; o vestígio é a capacidade `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` no `metadata.json`~~ | L6 riscado, com a capacidade do `metadata.json` como pendência residual; o "fora do escopo" do PRD corrigido |
| D7 | Média | [roadmap](../roadmap.md) (L8) | ~~Contagens de linha erradas (`GestorAvaliadores` descrito com 2,5 mil, hoje ~1,5 mil) e dois dos maiores componentes ausentes. Contagem volátil contraria a regra do [índice](../README.md#mantendo-a-documentação)~~ | Números fora; ficaram a lista dos arquivos e o comando que mede |
| D8 | Média | [roadmap](../roadmap.md) (L16), [funções e RPCs](../banco-de-dados/funcoes-e-rpcs.md) | ~~L16 falava em "12 checagens" e a descrição de `fn_auditar_notas` em "C1 a C12"; são 14 (`C1`–`C14`)~~ | As duas passaram a apontar para a lista em [auditoria de notas](../regras-de-negocio/auditoria-de-notas.md), sem número |
| D9 | Média | [cronograma da feira](../operacao/cronograma-da-feira.md) | ~~A terça mandava "simular um ciclo completo de avaliação **em homologação**", ambiente que o [ADR 0009](../decisoes/0009-ambientes-e-releases.md) diz não existir~~ | Trocado por simulação no ambiente local (`db reset`), com link para o ADR |
| D10 | Média | [PRD](../PRD.md) | ~~Contradição interna: a "Jornada do avaliador" dizia "faz login com o **e-mail**", contra RF-30 no mesmo documento. O escopo implementado não citava voto popular, auditoria de notas nem ajuste manual~~ | Jornada corrigida (pareamento ou código de acesso) e os três assuntos acrescentados ao escopo |
| D11 | Média | [modelo de dados](../banco-de-dados/modelo-de-dados.md) | ~~Faltavam `is_voto_popular` em `questionarios` (a marca que define a pista) e em `locks_ativos`, `id_questionario` em `avaliadores_evento`, e as tabelas `configuracoes_seguranca` e `registro_autocadastro` (esta ausente de toda a `docs/`)~~ | As três colunas e as duas tabelas documentadas |
| D12 | Média | [funções e RPCs](../banco-de-dados/funcoes-e-rpcs.md) | ~~Três RPCs chamadas pelo front-end estavam fora do arquivo que se declara a lista delas: `admin_vincular_questionario_avaliador` (ausente de toda a `docs/`), `admin_marcar_questionario_voto_popular` e `fn_identidade_visual`; `fn_auditar_voto_popular` só aparecia na doc de auditoria~~ | As quatro acrescentadas às seções correspondentes |
| D13 | Baixa | [modelo de dados](../banco-de-dados/modelo-de-dados.md) | ~~`eventos.logo_url` e `eventos.intervalo_pausa_avaliador` não apareciam em doc nenhuma; as duas estão mortas (a primeira só na migration inicial, a segunda só gravada como `0`)~~ | Documentadas como **mortas**, com o substituto de cada uma. Removê-las por migration continua possível, mas não é urgente |
| D14 | Baixa | [avaliação e quarentena](../regras-de-negocio/avaliacao-e-quarentena.md), [auditoria de notas](../regras-de-negocio/auditoria-de-notas.md) | ~~Narrativa histórica dentro de regra de negócio, contra a regra 1 do [índice](../README.md#mantendo-a-documentação): dois "Antes da migration …", um parêntese e a seção "O que mudou no caminho das notas"~~ | Histórico removido do texto da regra; a seção virou **Histórico**, de cinco linhas, apontando para `L15`–`L21` no roadmap e para os ADRs 0014/0015 |
| D15 | Baixa | [índice](../README.md), [visão geral](../arquitetura/visao-geral.md) | ~~O voto popular não tinha linha na tabela "Procurando…" nem aparecia entre os objetivos de negócio~~ | Linha no índice e dois objetivos novos na visão geral (voto popular e nota conferível) |
| D16 | Baixa | [visão geral](../arquitetura/visao-geral.md) | ~~Dizia "PostgreSQL 15+"; o ambiente local roda `major_version = 17`~~ | Diagrama e tabela passaram a dizer 17, explicitando que é a versão do ambiente local |
| D17 | Baixa | [troubleshooting](../operacao/troubleshooting.md) | ~~Não havia cabeçalho para o sintoma corrigido em 14-11 (questionário de voto popular fixado no projeto prendia o avaliador técnico)~~ | Seção nova com a mensagem de erro, a causa, a trigger que fecha o caso e o SQL de conferência |

## Leitura dos achados

Os guardas automatizados cobrem bem o que é mecânico — link, âncora, caminho de código, órfã, segredo, versão do
CLI — e nada disso apareceu. Os 17 achados eram todos de **conteúdo**, em dois padrões:

1. **O roadmap envelhece mais rápido que o resto** (`D3`–`D8`): seis achados em um arquivo, porque ele descreve o
   código num instante e o código mudou. A prática de riscar com data funciona; o que faltava era riscar.
2. **A doc do domínio acompanha a mudança, o ponto de entrada não** (`D10`, `D11`, `D15`): voto popular, auditoria
   de notas e ajuste manual estavam descritos em detalhe nas regras de negócio e nos ADRs, e ausentes do PRD, da
   visão geral e da tabela "Procurando…".

Nenhum achado era de regra de negócio errada: onde a doc descreve uma regra, ela bate com o SQL. O risco dos
achados altos (`D1`–`D3`) era outro — quem lesse só o resumo concluiria que a única forma de gravar nota é a do
avaliador, ou que a identidade ainda vem do cliente, e decidiria com base nisso.

## Para a próxima rodada

- Conferir se `D7` voltou: contagem de linha no roadmap reaparece com facilidade.
- Repetir os cruzamentos que acharam `D11` e `D12`, que são mecânicos e poderiam virar guarda: coluna de tabela do
  `schema.sql` ausente do [modelo de dados](../banco-de-dados/modelo-de-dados.md), e `supabase.rpc('…')` do `src/`
  ausente de [funções e RPCs](../banco-de-dados/funcoes-e-rpcs.md).
- Verificar as pendências residuais: capacidade de IA no `metadata.json` (`D6`) e as duas colunas mortas de
  `eventos` (`D13`).
