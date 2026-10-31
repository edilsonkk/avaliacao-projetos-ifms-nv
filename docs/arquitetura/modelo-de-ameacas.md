# Modelo de Ameaças e Revisão de Segurança

Revisão sequencial por camada, guiada por OWASP (ASVS 5.0 nível 2, API Security Top 10, WSTG) e MITRE (CWE, CAPEC).
Cada achado vira um teste que precisa falhar sem a correção. Regras de acesso atuais: [segurança](seguranca.md).

| Etapa | Escopo | Situação |
|---|---|---|
| 0 | Modelo de ameaças (este documento) | concluída |
| 1 | Banco e API: matriz papel × objeto | concluída (migration `20261031010000`) |
| 2 | Autenticação e sessão (login anônimo, código de acesso, pareamento, senhas, limites) | pendente |
| 3 | Regras de negócio e abuso (sorteio, cota, autocadastro, Telão público) | pendente |
| 4 | Front-end (XSS, cabeçalhos no Firebase, dados no navegador) | pendente |
| 5 | Dependências, CI e configuração (cadeia de fornecimento, segredos, painel do Supabase) | pendente |

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
