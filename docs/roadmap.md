# Lacunas, riscos e roadmap

Riscos conhecidos, achados de auditoria e o que vem depois. Os requisitos e o retrato do produto ficam no
[PRD](PRD.md); o porquê das decisões, nos [ADRs](decisoes/README.md).

Cada linha tem um identificador (`L1`, `L2`…) usado como referência no resto da documentação. Item resolvido
fica **riscado** com a data, em vez de sair da tabela: é o histórico de como o sistema chegou aqui.

---

> **Auditoria de segurança (26-10-2026).** Uma revisão do controle de acesso encontrou três falhas de **Broken Access Control**, todas porque a autorização estava no cliente e o banco confiava em dados do navegador. As migrations `20261026010000` (RPC de envio de nota), `20261026020000` (leitura sensível) e `20261026030000` (funções admin) endereçam L12, L13 e L14. L1 (login sem senha do avaliador) continua pendente e é o que fecha em definitivo o L12.

| # | Achado no código | Risco | Recomendação | Prioridade |
|---|---|---|---|---|
| L12 | **Gravação de nota sem validação server-side:** `TelaAvaliador.tsx` faz `insert` direto em `avaliacoes`/`respostas_avaliacao` com `id_usuario` vindo do `localStorage`, e a RLS aceita `WITH CHECK (true)` | Qualquer cliente `anon` grava nota em nome de qualquer avaliador, fora da escala, sem trava e fora da janela | **Mitigado:** `fn_enviar_avaliacao` (`SECURITY DEFINER`) valida trava, elegibilidade, conflito, cota, janela e faixa, e calcula `nota_final` no banco; INSERT anônimo direto removido. **Fechado só com L1** (sem OTP, `id_usuario` ainda vem do cliente). Requer trocar `TelaAvaliador` para `rpc('fn_enviar_avaliacao')` | **Alta** |
| L13 | **Leitura pública de PII e notas:** a RLS dá `SELECT TO anon` em tudo, expondo `usuarios.cpf`, `celular`, `senha_hash` (coluna morta) e todas as notas/pareceres | Vazamento de dados pessoais (LGPD) e de notas antes da homologação | **Corrigido** por `20261026020000`: `senha_hash` removida; `cpf`/`celular` e `nota_final`/`parecer_final` saem do alcance da `anon` via GRANT de coluna | **Alta** |
| L14 | **Funções admin abertas à `anon`:** `admin_reset_global`, `excluir/restaurar_avaliacao`, `admin_desbloquear_*`, `admin_remover_quarentena_*` são `SECURITY DEFINER` sem checar o chamador e com `GRANT EXECUTE TO anon` | Visitante anônimo chama `admin_reset_global` e **apaga o evento inteiro** | **Corrigido** por `20261026030000`: `REVOKE EXECUTE FROM anon` + guard `is_admin()` em excluir/restaurar | **Alta** |
| L1 | ~~Avaliador e Staff entram **só com e-mail** (sem senha/OTP) e escrevem no banco como `anon`; o `id_usuario` vem do `localStorage`~~ **Resolvido em 2026-10-28**: celular vinculado pelo Staff (pareamento ou código de acesso), Staff com senha e RLS por papel ([ADR 0011](decisoes/0011-identidade-real-avaliador-e-staff.md)) | Qualquer pessoa que saiba o e-mail de um avaliador age em nome dele | Migration 1 (não feita): OTP/magic link do Supabase Auth, para o `id_usuario` vir de `auth.uid()` em vez do payload — é o que fecha o L12 por completo | **Alta** |
| L2 | ~~As migrations de segurança precisavam ser **coladas à mão** no SQL Editor; o CI não as aplicava~~ **Resolvido em 2026-10-27**: `supabase db push` aplica as migrations pelo workflow ([supabase-migrations.yml](../.github/workflows/supabase-migrations.yml)); colar SQL no painel deixou de ser caminho válido | Divergência entre o repositório e o banco | Falta recriar o banco de teste do zero ([migrations](banco-de-dados/migrations.md#recriar-o-banco-remoto-do-zero)) | Média |
| L3 | Papel e sessão em `localStorage`; a guarda de rota (`App.tsx`) é só no cliente | Basta editar o `localStorage` para abrir as telas (o RLS segura a escrita admin, mas não a leitura) | Derivar o papel da sessão do Supabase; restringir leituras sensíveis (notas, pareceres) via RLS | Média |
| L4 | Views citam `historico_sorteios`, mas nenhuma migration cria essa tabela | O relatório de ausências pode falhar ou depender do fallback | Criar a tabela ou remover a referência; usar `historico_impedimentos` de forma consistente | Média |
| L5 | A interface fala em "Importar (.xls/.xlsx/.csv)", mas `.xls` é recusado | Confusão do usuário | Ajustar os rótulos para `.xlsx/.csv` | Baixa |
| L6 | `@google/genai`, `express`, `dotenv` e `GEMINI_API_KEY` sem uso | Superfície de ataque e dependências desnecessárias | Remover, ou definir um caso de uso de IA (ex.: resumo de pareceres) | Baixa |
| L7 | ~~QR Code gerado por `api.qrserver.com`~~ **Resolvido em 2026-10-31**: gerado no navegador (`qrcode.react`) | Dependência externa no dia do evento; o link (com o id do evento) é enviado a terceiros | Gerar o QR Code localmente (biblioteca JS) | Média |
| L8 | Componentes muito grandes (`RelatoriosAdmin` com 3,2 mil linhas, `GestorAvaliadores` 2,5 mil, `GestorProjetos` 2,1 mil) | Manutenção cara e regressões | Extrair hooks e serviços de dados (o `schema.sql` duplicado foi resolvido em 2026-10-27) | Média |
| L9 | ~~Documentação desatualizada (ANTIGRAVITY.MD)~~ **Resolvido em 2026-10-27**: conteúdo revisado e dividido em `docs/` por assunto. `supabase/schema.sql` atualizado com as `20261026*` | Decisões tomadas com base em informação errada | — | Baixa |
| L10 | Sem multi-evento simultâneo nem histórico consultável após o reset global | Perda de dados históricos se o reset for usado no lugar do arquivamento | Arquivar o evento (flag `is_ativo`) em vez de apagar; exportação completa antes do reset | Média |
| L11 | ~~`view_ranking_top3` sem filtrar "fora da competição" e sem posição de empate~~ **Resolvido** (migration `20261030060000`): fora da competição não entra; `posicao` por `RANK()` (empate divide) por modalidade e área; marca `em_quarentena`. Desde a migration `20261031050000`, o empate na média é desfeito pelo `peso_desempate` (prioridade das perguntas) | ~~Empates sem critério oficial~~ (questão 3 decidida) | — | Média |

---

> **Auditoria de notas (06-11-2026).** Uma revisão de como as notas são calculadas, exibidas e alteradas
> encontrou seis caminhos pelos quais uma nota mudava ou desaparecia **sem deixar vestígio**, e uma origem de
> dado contaminada no formulário do avaliador. As migrations `20261106010000` a `20261106060000` endereçam
> L15 a L21. Desenho em [auditoria de notas](regras-de-negocio/auditoria-de-notas.md),
> [ADR 0014](decisoes/0014-trilha-de-auditoria-append-only.md) e
> [ADR 0015](decisoes/0015-ajuste-manual-de-notas.md).

| # | Achado no código | Risco | Recomendação | Prioridade |
|---|---|---|---|---|
| L15 | ~~**Nota alterável sem rastro:** a policy `FOR ALL` do Admin permitia `UPDATE avaliacoes SET nota_final = X` pela API REST; não havia `atualizado_em` nem trigger nenhuma no banco~~ **Resolvido em 2026-11-06**: `log_auditoria` append-only gravada por trigger (pega também a escrita direta), e a conferência acusa como achado grave (C10) | Resultado de feira alterado sem prova, inclusive por quem não é da coordenação se a sessão do Admin vazar | Fechar a policy `FOR ALL` (escrita de nota só por RPC) é o passo seguinte possível: com o ajuste manual oficial, o `UPDATE` direto perdeu o motivo de existir | **Alta** |
| L16 | ~~**A conta da nota era invisível:** `peso_calculo` entra em toda nota final e não aparecia em nenhuma tela; nada permitia refazer a conta~~ **Resolvido em 2026-11-06**: memorial de cálculo (`fn_memorial_*`) e conferência por recálculo (`fn_auditar_notas`, 12 checagens) | Impossível responder a um recurso ou conferir o resultado sem abrir o banco | — | **Alta** |
| L17 | ~~**Reset global apagava avaliações de todos os eventos:** os `DELETE` de `respostas_avaliacao` e `avaliacoes` não tinham filtro de evento, e sem evento ativo a função apagava o banco inteiro~~ **Resolvido em 2026-11-06**: filtra por evento, recusa rodar sem evento definido e registra na trilha o que vai apagar | Perda do histórico de todas as feiras anteriores num clique | Relacionado a L10 (arquivar em vez de apagar) | **Alta** |
| L18 | ~~**`ON DELETE CASCADE` apagava notas em silêncio:** apagar projeto ou usuário levava as avaliações; `GestorProjetos` tratava um erro `23503` que nunca acontecia~~ **Resolvido em 2026-11-06**: FKs em `RESTRICT`, com recusa explícita e mensagem | Resultado apagado como efeito colateral de uma operação de cadastro | — | **Alta** |
| L19 | ~~**Formulário do avaliador vinha com a nota máxima marcada** em todos os critérios (`escala_maxima`)~~ **Resolvido em 2026-11-06**: começa em branco e o envio exige nota em todos os critérios | Nota cheia gravada sem avaliação, indistinguível de uma decisão real do avaliador | — | **Alta** |
| L20 | ~~**Caminho legado de gravação no front** calculava a nota como média **simples** em JavaScript, ignorando os pesos~~ **Resolvido em 2026-11-06**: caminho removido; nota só por `fn_enviar_avaliacao` | Nota divergente da regra oficial quando algum peso ≠ 1 | — | Média |
| L22 | **Views legadas sem o filtro de voto popular:** `view_relatorio_admin`, `view_relatorio_projetos` e `view_relatorio_avaliadores` agregam `avaliacoes` sem distinguir voto popular. Nenhuma tem consumidor no front-end (as telas leem as `fn_relatorio_*_completo`), mas quem voltar a lê-las verá média misturada | Número errado numa tela de resultado, se alguém voltar a usá-las | Acrescentar o filtro ou remover as views | Média |
| L23 | ~~**Contagens de nota no navegador:** `MapaEstandes`, `AtribuicaoForcada`, `ProjetosQuarentena` e `ModalExclusaoAvaliacao` leem `avaliacoes`/`locks_ativos` crus e refazem cota, média e vagas no cliente~~ **Resolvido em 2026-11-12** (migration `20261112010000`): `fn_projetos_situacao` devolve cota, vagas, média, notas, voto popular e quarentena pela regra do sorteio, e as duas telas de contagem leem dela; a Quarentena filtra o voto popular no detalhe e o modal de exclusão marca o voto popular e avisa que cancelá-lo não libera vaga. A Atribuição Forçada também deixou de oferecer votante como avaliador técnico | Cor de estande e vagas de banca erradas; contrariava o [ADR 0001](decisoes/0001-logica-critica-no-banco.md) | — | Média |
| L21 | ~~**Três formatos de nota** na interface (`toFixed(1)`, `toFixed(2)`, `toLocaleString`) e `view_relatorio_admin` somando avaliação cancelada~~ **Resolvido em 2026-11-06**: `src/lib/formatoNota.ts` (duas casas, vírgula) e filtro de canceladas na view | A mesma nota com números diferentes em telas diferentes põe o resultado em dúvida | — | Média |

**Roadmap sugerido**
- **Feito:** as migrations `...010000`, `...020000` e `...030000` estão aplicadas e o `TelaAvaliador` já envia a nota por `rpc('fn_enviar_avaliacao')`. Resta [recriar o banco de teste](banco-de-dados/migrations.md#recriar-o-banco-remoto-do-zero).
- **Curto prazo (antes do próximo evento):** L1 (OTP, é o que fecha o L12 por completo), L4 e L5.
- **Médio prazo:** L3, L8, L10; certificados para avaliadores; notificações por e-mail.
- **Longo prazo:** portal de submissão de projetos; multi-evento; IA para apoio à comissão (resumo de pareceres, detecção de outliers).
