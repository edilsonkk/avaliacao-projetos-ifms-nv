# Credenciamento, Avaliadores e Staff

Código: `src/features/staff/` (`TelaStaff`, `GestorStaff`), `src/features/avaliadores/` (`GestorAvaliadores`),
`src/features/avaliacao/components/TelaAutocadastroAvaliador.tsx`, `src/features/auth/` (`TelaLogin`).

## Login

- Abas: Avaliador, Coordenação (Admin), Monitoramento e Expositor, sem subtítulos.
- **Admin e Staff:** e-mail e senha no Supabase Auth. A conta do Staff é criada pelo Admin no painel do Supabase e
  ligada ao perfil no primeiro login ([criar Staff](../arquitetura/configuracao.md#criar-um-membro-do-staff)).
- **Avaliador:** sem senha. O celular é **vinculado** no credenciamento ([segurança](../arquitetura/seguranca.md#como-o-celular-do-avaliador-é-vinculado)):
  1. o avaliador abre a aba Avaliador, e o celular mostra um código curto;
  2. o Staff abre **Aparelho** na linha do avaliador, digita o código e clica em **Parear**. O avaliador é credenciado
     junto, e a tela do celular abre sozinha;
  3. alternativa sem o celular no balcão: o Staff clica em **Gerar código de acesso** (o avaliador é credenciado
     junto) e passa o código ao avaliador, que digita e-mail e código no celular. O código aparece uma única vez,
     expira e tem tentativas limitadas.
- O celular só funciona enquanto o avaliador estiver **credenciado no evento ativo**: **Bloquear** corta o acesso na
  hora (a tela do celular volta ao login) e **Credenciar** reativa o mesmo aparelho. Em um evento novo, o celular é
  vinculado de novo.
- Validade, tamanho dos códigos, tentativas e formas liberadas ficam nas Configurações do evento (engrenagem),
  seção **Acesso dos avaliadores**.
- Celular perdido ou trocado: **Aparelho → Desvincular aparelho** e parear o novo.
- A aba Avaliador precisa de um navegador **sem a conta do Admin/Staff**. No mesmo navegador em que a equipe está
  logada, a tela avisa e oferece **Sair desta conta e preparar o aparelho** (sai só ali); o pareamento e o código de
  acesso são recusados antes disso, para o código de uso único não ser gasto à toa.
- `App.tsx` decide a tela pelo caminho da URL e pelo papel em `localStorage` e impede o avaliador de abrir telas
  de Admin ou Staff.

## Gestor de Avaliadores (Admin)

**Colunas** (todas ordenáveis): `Credenciamento | Nome | Instituição | E-mail | Modalidades | Áreas | Ações`.
- Nome: só o nome, sem badges.
- Instituição: nome e sigla, ícone `Building2`.
- Modalidades: um chip por modalidade do evento, que alterna liberada/bloqueada na hora
  ([bloqueio por modalidade](sorteio-e-atribuicao.md#bloqueio-por-modalidade)).
- Áreas: badges das áreas de afinidade.

**Escopo:** a lista mostra só quem está inscrito no evento ativo (`avaliadores_evento`), sem Staff nem Admin. Sem
evento ativo, a tela avisa e não deixa cadastrar nem importar.

**Credenciar/Descredenciar** grava em `avaliadores_evento.is_credenciado` do evento ativo. O status vem sempre do
banco; erro do banco aparece na tela e o status não muda.

**Cadastro e importação** (`admin_salvar_avaliadores`, uma transação): nome, e-mail, instituição, modalidades
bloqueadas e áreas. Se o e-mail já existe como avaliador, a pessoa é inscrita no evento (e o nome é atualizado). Se o
e-mail é de um Admin ou Staff, a linha é ignorada e o motivo aparece; a conta nunca é rebaixada. Importação: ver
[importação](importacao-de-planilhas.md).

**Edição** (`admin_atualizar_avaliador`) grava tudo de uma vez e recusa e-mail de outra pessoa. Bloquear uma
modalidade (no chip ou na edição) tira as travas e a fila do avaliador nos projetos dela.

**Remover** (lixeira) pede confirmação e tira a pessoa **só do evento ativo**
(`admin_remover_avaliador_evento`). Se ela já avaliou algum projeto do evento, a remoção é recusada: use
Descredenciar, e as notas continuam valendo. O cadastro só é apagado quando não sobra nenhum evento nem avaliação.
Nunca apague a linha de `usuarios` direto: as FKs de avaliações são `ON DELETE CASCADE` e as notas sumiriam.

## Gestor de Staff (Admin)

Mesmo layout canônico. A equipe é global (contas de login); o credenciamento é do evento ativo
(`avaliadores_evento`). Para entrar, o membro precisa também de uma conta no Supabase Auth com **o mesmo e-mail**.

- **Cadastro e importação** (`admin_salvar_staff`, uma transação): `Nome`, `E-mail` e `Papel` (`STAFF`, padrão, ou
  `MONITOR`). E-mail de Admin ou Avaliador é ignorado e o motivo aparece: a conta nunca muda de papel. Reimportar não
  descredencia quem já está credenciado. Há modelo `modelo_importacao_staff.xlsx`.
- **Credenciar/Descredenciar** grava no banco; o status vem sempre do banco.
- **Edição** (`admin_atualizar_staff`) recusa e-mail de outra pessoa. Mudar o e-mail não muda o login.
- **Excluir** pede confirmação (`admin_excluir_staff`, só apaga Staff/Monitor). A conta de login fica no Auth, sem
  permissão.

## Tela do Staff (recepção)

Título "Módulo de Recepção & Credenciamento", subtítulo "Painel da Equipe de Apoio", largura até 1800 px para telas
widescreen. Abas grandes, pensadas para toque em tablet: **Credenciar Expositores** e **Credenciar Avaliadores**.

**Credenciar Expositores**: tabela `Corredor | Estande | Projeto (título e código) | Instituição | Expositores | Check-in`,
com ordenação em todas as colunas. `Confirmar Check-in` / `Cancelar Check-in` em cada linha atualiza o contador na
hora.

**Credenciar Avaliadores**: mesma tabela do Gestor de Avaliadores, com estas diferenças:
- Ações: `Credenciar` / `Bloquear`, `Aparelho` (Parear/Vinculado) e `Editar` (lápis).
- **Sem botão de excluir**: o Staff não pode apagar usuários.
- Sem botão "+ Novo Avaliador": o cadastro na recepção é feito por autocadastro.

O botão de navegação para o **Telão** fica oculto para o Staff (só o Admin vê).

## Autocadastro do avaliador (QR Code)

- A aba de avaliadores do Staff mostra um QR Code com
  `${window.location.origin}/?cadastro=avaliador&evento=<evento_ativo_id>`, gerado no navegador (`qrcode.react`, sem serviço de terceiros), mais os
  botões `Copiar Link de Autocadastro` e `Abrir Tela de Cadastro`.
- `TelaAutocadastroAvaliador` (mobile-first): nome, e-mail, instituição (escolher ou digitar nova) e áreas de
  interesse.
- O avaliador fica **pendente de credenciamento presencial** e é orientado a procurar o Staff.
- O cadastro é idempotente por e-mail.
- Limites contra cadastro em massa (o endereço é público): até **30 autocadastros por minuto** no sistema e **20
  instituições novas por hora** digitadas no autocadastro. Acima disso, o cadastro segue **sem** a instituição (o Staff
  ajusta) ou, no caso do limite por minuto, pede para tentar de novo em instantes.

## Contagens

Contagens de credenciados usam conjuntos únicos de `id_usuario`, filtram por `id_evento` e separam por `papel`
(`AVALIADOR` × `STAFF`). Ver [troubleshooting](../operacao/troubleshooting.md#contagem-duplicada-de-credenciados).

Testes: `src/features/auth/__tests__/LoginZeroFriccao.test.tsx`, `src/features/avaliadores/__tests__/`,
`src/__tests__/integracao/TelaStaffLayoutEAutocadastro.test.tsx`.
