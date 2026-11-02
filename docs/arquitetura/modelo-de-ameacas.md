# Modelo de Ameaças e Revisão de Segurança

Revisão sequencial por camada, guiada por OWASP (ASVS 5.0 nível 2, API Security Top 10, WSTG) e MITRE (CWE, CAPEC).
Cada achado vira um teste que precisa falhar sem a correção. Regras de acesso atuais: [segurança](seguranca.md).

| Etapa | Escopo | Situação |
|---|---|---|
| 0 | Modelo de ameaças (este documento) | concluída |
| 1 | Banco e API: matriz papel × objeto | concluída (migration `20261031010000`) |
| 2 | Autenticação e sessão (login anônimo, código de acesso, pareamento, senhas, limites) | concluída (migration `20261031020000`) |
| 3 | Regras de negócio e abuso (sorteio, cota, autocadastro, Telão público) | concluída (migration `20261031040000`) |
| 4 | Front-end (XSS, cabeçalhos no Firebase, dados no navegador) | concluída (sem migration) |
| 5 | Dependências, CI e configuração (cadeia de fornecimento, segredos, painel do Supabase) | concluída (sem migration) |

## Atores

| Ator | Como se identifica | Confiança |
|---|---|---|
| Visitante (`anon`) | chave pública do site (qualquer pessoa na internet) | nenhuma |
| Celular sem vínculo | login anônimo do Supabase Auth (`authenticated`) | nenhuma |
| Avaliador | celular vinculado (`avaliador_atual()`) por pareamento ou código de acesso | age só em nome próprio |
| Staff | e-mail e senha + perfil `STAFF` (`is_staff()`) | credencia, faz check-in, vincula celulares |
| Admin | e-mail e senha + perfil `ADMIN` (`is_admin()`) | total |
| Telão | página pública | só agregados (`fn_telao_resumo`) |

## O que proteger

- **Integridade da premiação:** notas, cota, sorteio aleatório (ninguém escolhe quem avalia o quê), quarentena.
- **Dados pessoais (LGPD):** e-mail, CPF e celular de avaliadores; nomes de expositores, inclusive menores de idade.
- **Disponibilidade no dia da feira:** projetos não podem ficar bloqueados; o Telão e o sorteio precisam responder.

## Fronteiras de confiança

```
navegador / celular ──(chave pública + JWT)──► PostgREST ──► Postgres (RLS + funções SECURITY DEFINER)
                                         └──► Supabase Auth (login anônimo, senha)
```

O front-end **não** é fronteira: qualquer chamada pode ser feita direto na API com a chave pública. Toda regra
precisa estar na RLS, nos `GRANT`s ou dentro das funções.

## Ameaças (STRIDE) e onde são tratadas

| Ameaça | Exemplo | Controle | Etapa |
|---|---|---|---|
| Falsificação de identidade | Enviar nota em nome de outro avaliador | `avaliador_atual()` dentro de sorteio e envio | 1, 2 |
| Adulteração | Escolher o projeto, furar a cota, alterar a fila | Trava só nasce no banco; cota com linha reservada | 1, 3 |
| Repúdio | Admin cancela avaliação sem rastro | `cancelada_por`/`cancelada_em` | 3 |
| Vazamento de informação | Ler e-mails, CPF, notas de outros | RLS, `GRANT` por coluna, views `security_invoker` | 1 |
| Negação de serviço | Bloquear projetos com travas longas; spam no autocadastro | Validade fixada no banco; limites do Auth | 1, 3 |
| Elevação de privilégio | Conta qualquer rodar `admin_*` | `is_admin()` em toda função de Admin | 1 |

## Etapa 1: matriz papel × objeto

Método: sondagem com cada papel no banco local (dentro de transação desfeita) e pela API real, mais revisão de todas
as políticas, `GRANT`s e funções `SECURITY DEFINER` executáveis por `anon`/`authenticated`.

Confirmado como **protegido**: visitante e celular sem vínculo não leem pessoas, notas nem projetos e não executam
funções de Admin; ninguém sorteia nem envia nota por outro; avaliador não lê notas alheias nem grava avaliação direto;
Staff não lê notas, não se promove a Admin e não roda funções de Admin; todas as views respeitam a RLS de quem
consulta; todas as funções `SECURITY DEFINER` têm `search_path` fixo.

Achados (corrigidos em `20261031010000_seguranca_matriz_papeis.sql`, testes em `19_seguranca_matriz_test.sql`):

| # | Gravidade | Achado | Referência | Correção |
|---|---|---|---|---|
| A1 | Alta | Avaliador gravava trava direto em qualquer projeto, com qualquer validade (escolhia o projeto fora do sorteio; podia bloqueá-lo por anos) | API6, CWE-841 | Sem `INSERT` do avaliador em `locks_ativos`; fila por `fn_assumir_item_fila` |
| A2 | Média | Avaliador trocava o projeto do próprio item de fila | API1, CWE-639 | Sem `UPDATE` do avaliador na fila |
| A3 | Média | Avaliador registrava ausência/conflito em qualquer projeto (falseava relatórios e indicadores) | CWE-284 | `fn_registrar_impedimento`, só com trava |
| A4 | Média | Staff lia CPF e celular de todos (nenhuma tela usa) | LGPD, CWE-359 | `SELECT` por coluna em `usuarios` |
| A5 | Baixa | Staff credenciava qualquer usuário, inclusive o Admin | CWE-285 | Política exige papel Avaliador |
| A6 | Baixa | `fn_avaliacoes_do_questionario` respondia a qualquer logado | CWE-862 | Só Admin |
| A7 | Baixa | `anon` tinha `INSERT/UPDATE/DELETE` em cadastros, barrado só pela RLS | ASVS 8.1, defesa em profundidade | Permissões retiradas |
| A8 | Baixa | `admin_reset_global` sem `pg_temp` no `search_path` | CWE-426 | `search_path = public, pg_temp` |

Riscos aceitos: Staff altera nome e e-mail de avaliadores no balcão (ele já vincula qualquer celular a qualquer
avaliador). Ver [limites conhecidos](seguranca.md#limites-conhecidos).

## Etapa 2: autenticação e sessão

Método: leitura das funções de vínculo (`gerar_codigo_curto`, `fn_solicitar_pareamento`, `fn_parear_dispositivo`,
`fn_gerar_codigo_acesso`, `fn_vincular_com_codigo`, `avaliador_atual`, `fn_meu_perfil`, `fn_vincular_conta_staff`),
da configuração do Auth e dos fluxos de login, saída e troca de senha; sondagem no banco local e medição de tempo de
resposta.

Confirmado como **protegido**: códigos gerados com gerador criptográfico e sem viés (29 símbolos sem ambíguos, 6
caracteres ≈ 594 milhões de combinações); código de acesso guardado só como bcrypt, de uso único, com validade e
limite de tentativas que é gravado mesmo no erro; mensagem de erro única; um aparelho ativo por avaliador (vínculo novo
revoga o anterior); desvincular revoga na hora; "Sair" encerra a sessão no Auth; Staff só vira Staff com e-mail
**confirmado**; login de Admin/Staff confere o papel e encerra a sessão se não bater.

Achados (corrigidos em `20261031020000_seguranca_sessao.sql`, testes em `20_seguranca_sessao_test.sql`):

| # | Gravidade | Achado | Referência | Correção |
|---|---|---|---|---|
| B1 | Alta | Suspender o credenciamento ("Bloquear") não parava o avaliador: o celular seguia sorteando e enviando notas. Celular de evento anterior também valia no evento ativo, sem inscrição | CWE-285, CWE-613, ASVS 7.4 | `avaliador_atual()` exige evento ativo e credenciamento ativo; gerar código credencia |
| B2 | Média | Login com código respondia em ~12 ms para e-mail com código ativo e ~0,1 ms para os demais (enumeração por tempo) | CWE-208, ASVS 6.3 | bcrypt também sem código: ~11,4 ms em todos os casos |
| B3 | Baixa | Autocadastro público respondia `ja_cadastrado` para e-mails existentes, inclusive de Admin e Staff | CWE-204 | Resposta sempre `recebido` |
| B4 | Média (configuração) | Senha mínima de 6 caracteres no Auth; troca de senha sem login recente | ASVS 6.2.1, 6.2.3 | Mínimo 12 (tela e `config.toml`) e *Secure password change*; **produção: ajustar no painel** |

Recomendações decididas pelo dono do projeto e implementadas (`20261031030000_mfa_e_sessao.sql`, testes em
`21_mfa_e_sessao_test.sql`), ambas configuráveis pelo Admin na engrenagem:
- **MFA (TOTP) opcional para o Admin** (ASVS 6.3.3): ligado, `is_admin()` exige `aal2` no banco.
- **Expiração da sessão de Admin/Staff por inatividade** (ASVS 7.3), aplicada no navegador.

Pendente: **proteção contra senhas vazadas** (HaveIBeenPwned) no Auth, recurso de plano pago.

## Etapa 3: regras de negócio e abuso

Método: leitura das funções de sorteio, fila, envio de nota, autocadastro e Telão; prova de cada abuso com um
avaliador real no banco local (transação desfeita) e medição de custo do resumo público do Telão.

Confirmado como **protegido**: cota com o projeto reservado (sorteios simultâneos, `20261030130000`); trava, fila e
impedimentos só por função (etapa 1); nota calculada no servidor, dentro da escala; avaliação única por avaliador e
projeto; quarentena automática por divergência; o resumo público do Telão custa ~3 ms e só devolve totais.

Achados (corrigidos em `20261031040000_seguranca_regras_negocio.sql`, testes em `22_seguranca_regras_negocio_test.sql`):

| # | Gravidade | Achado | Referência | Correção |
|---|---|---|---|---|
| C1 | Alta | A nota era a média de qualquer lista enviada: responder só 1 de 5 perguntas com nota máxima, repetir uma pergunta, usar perguntas ou questionário de outro evento, ou nenhum questionário. Na prova, as duas manobras gravaram **nota 10** | CWE-20, CWE-840, API6 | Questionário do evento (e o fixado, se houver); todas as perguntas, uma vez cada, com nota; parecer ≤ 5000 |
| C2 | Média | Data, horário e "sistema liberado" só eram conferidos na tela: pela API dava para sortear fora da janela ou com o sistema pausado | CWE-841, A04 | `fn_janela_avaliacao_aberta` no sorteio e na fila |
| C3 | Média | Autocadastro público sem limite: milhares de avaliadores pendentes e instituições com qualquer nome | CWE-770, A04 | 30 autocadastros/min e 20 instituições novas/hora |

Recomendação que depende de decisão: **CAPTCHA** (Cloudflare Turnstile, gratuito) no autocadastro, para barrar robôs
sem depender do limite global (que um robô pode esgotar por alguns minutos).

## Etapa 4: front-end

Método: varredura do código por pontos de XSS (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`,
`href`/`window.open` dinâmicos), recursos de terceiros, dados guardados no navegador e caminhos de login; leitura dos
cabeçalhos HTTP de produção; busca de `eval` no bundle; validação da CSP no Chrome (headless) com o build local e o
Supabase local, com um controle positivo que confirma que o Chrome registra as violações.

Confirmado como **protegido**: sem `innerHTML`/`eval`/`new Function` no código nem no bundle; o único
`dangerouslySetInnerHTML` é CSS fixo de impressão, sem dado de usuário; links externos com `rel="noopener
noreferrer"`; sem *source maps* publicados; HSTS (do Firebase); CSV com proteção contra fórmulas.

| # | Gravidade | Achado | Referência | Correção |
|---|---|---|---|---|
| D1 | Média | Sem `Content-Security-Policy`, proteção contra exibição em outro site (clickjacking), `nosniff`, `Referrer-Policy`, `Permissions-Policy` | ASVS 3.4, CWE-1021, CWE-693 | Cabeçalhos no `firebase.json`; CSP validada no navegador |
| D2 | Média | QR Code do autocadastro gerado por `api.qrserver.com`: o link do evento ia a terceiros, que poderiam servir um QR apontando para um site falso | CWE-829, ASVS 14 | QR gerado no navegador (`qrcode.react` 4.2.0, sem dependências) |
| D3 | Média | Sem internet, a avaliação ia para uma fila no navegador que **nenhum código enviava**: a nota se perdia e o avaliador via "salva para futura sincronização"; as notas ficavam em texto no navegador | CWE-922, A04 | Sem fila: a tela avisa que não foi enviada e mantém as notas para reenviar |
| D4 | Baixa | Botão "Entrar com Google" com o provedor desligado e sem tratamento do retorno (caminho de login morto, sem checagem de papel e de segundo fator) | ASVS 6.1, redução de superfície | Botão removido |
| D5 | Baixa | Login do Admin guardava o e-mail no navegador (CodeQL) | CWE-312 | Corrigido no #64 |

## Etapa 5: dependências, CI e configuração

Método: `npm audit` com análise de alcance; busca de segredos e chaves JWT em todo o histórico do Git (com o papel de
cada chave decodificado); leitura de todos os workflows (gatilhos, `permissions`, ações de terceiros, onde os segredos
aparecem); configuração do repositório (ruleset da `main`, ambiente `production`, Dependabot, varredura de segredos);
instalação limpa com `--ignore-scripts`. MITRE ATT&CK T1195 (comprometimento da cadeia de fornecimento).

Confirmado como **protegido**: nenhum segredo no histórico (a única chave JWT já commitada é a `anon`, pública por
definição); só `.env.example` é rastreado; varredura de segredos e *push protection* ligadas; token padrão dos
workflows só leitura; segredos de produção no ambiente `production`, só nos passos que os usam; ruleset da `main`
exige PR, squash e os checks de testes, pgTAP e CodeQL, e bloqueia force push e exclusão; backup do banco
criptografado; Trivy já fixado por hash; nenhuma dependência com script de instalação.

| # | Gravidade | Achado | Referência | Correção |
|---|---|---|---|---|
| E1 | Média | Ações de terceiros por tag/branch (`supabase/setup-cli@v1` era um **branch**; `action-hosting-deploy@v0` recebe a chave do Firebase; `release-please-action@v4` recebe o token): quem mover a tag executa código com esses segredos | ATT&CK T1195.001, CWE-829 | Todas as ações fixadas por hash; Dependabot para atualizar |
| E2 | Baixa | `npm ci` executaria scripts de instalação de um pacote comprometido no CI/deploy | CWE-829 | `npm ci --ignore-scripts` |
| E3 | Baixa | `ci.yml` sem `permissions` (dependia do padrão do repositório) | ASVS 14 | `contents: read` |
| E4 | Baixa | Sem atualização automática de dependências | ASVS 14.2 | `.github/dependabot.yml` |

Risco aceito: 8 alertas *moderate* do `npm audit` (cadeia `exceljs → archiver → glob → minimatch`), sem caminho
alcançável no uso do sistema ([CI/CD](../operacao/ci-cd-e-deploy.md#segurança)).

Configurações manuais recomendadas (só o dono do repositório e dos painéis pode fazer):
- GitHub, ambiente `production`: liberar só a branch `main` e as tags `v*`.
- GitHub, *Actions → General*: desmarcar *Allow GitHub Actions to create and approve pull requests* (o release usa o
  `RELEASE_PLEASE_TOKEN`).
- GitHub, *Code security*: ligar *Dependabot alerts* e *security updates*.
- Supabase: *Minimum password length* 8, *Secure password change* ligado, *TOTP* habilitado (etapas 2 e MFA).
- Google Cloud: a service account do deploy só com o papel *Firebase Hosting Admin* (ver CI/CD).

