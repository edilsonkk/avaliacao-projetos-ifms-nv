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

**Roadmap sugerido**
- **Feito:** as migrations `...010000`, `...020000` e `...030000` estão aplicadas e o `TelaAvaliador` já envia a nota por `rpc('fn_enviar_avaliacao')`. Resta [recriar o banco de teste](banco-de-dados/migrations.md#recriar-o-banco-remoto-do-zero).
- **Curto prazo (antes do próximo evento):** L1 (OTP, é o que fecha o L12 por completo), L4 e L5.
- **Médio prazo:** L3, L8, L10; certificados para avaliadores; notificações por e-mail.
- **Longo prazo:** portal de submissão de projetos; multi-evento; IA para apoio à comissão (resumo de pareceres, detecção de outliers).
