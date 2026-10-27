# Credenciamento, Avaliadores e Staff

Código: `src/features/staff/` (`TelaStaff`, `GestorStaff`), `src/features/avaliadores/` (`GestorAvaliadores`),
`src/features/avaliacao/components/TelaAutocadastroAvaliador.tsx`, `src/features/auth/` (`TelaLogin`).

## Login

- Abas: Avaliador, Coordenação (Admin), Monitoramento e Expositor, sem subtítulos.
- Admin: e-mail e senha no Supabase Auth. Avaliador e Staff: sem senha ([segurança](../arquitetura/seguranca.md)).
- `App.tsx` decide a tela pelo caminho da URL e pelo papel em `localStorage` e impede o avaliador de abrir telas
  de Admin ou Staff.

## Gestor de Avaliadores (Admin)

**Colunas** (todas ordenáveis): `Credenciamento | Nome | Instituição | E-mail | Modalidades | Áreas | Ações`.
- Nome: só o nome, sem badges.
- Instituição: nome e sigla, ícone `Building2`.
- Modalidades: um chip por modalidade do evento, que alterna liberada/bloqueada na hora
  ([bloqueio por modalidade](sorteio-e-atribuicao.md#bloqueio-por-modalidade)).
- Áreas: badges das áreas de afinidade.

Cadastro e edição: nome, e-mail, instituição, modalidades bloqueadas e áreas. Importação: ver
[importação](importacao-de-planilhas.md).

## Gestor de Staff (Admin)

Mesmo layout canônico. Importa `Nome`, `E-mail` e `Papel` (`STAFF` ou `MONITOR`).

## Tela do Staff (recepção)

Título "Módulo de Recepção & Credenciamento", subtítulo "Painel da Equipe de Apoio", largura até 1800 px para telas
widescreen. Abas grandes, pensadas para toque em tablet: **Credenciar Expositores** e **Credenciar Avaliadores**.

**Credenciar Expositores**: tabela `Corredor | Estande | Projeto (título e código) | Instituição | Expositores | Check-in`,
com ordenação em todas as colunas. `Confirmar Check-in` / `Cancelar Check-in` em cada linha atualiza o contador na
hora.

**Credenciar Avaliadores**: mesma tabela do Gestor de Avaliadores, com estas diferenças:
- Ações: `Credenciar` / `Bloquear` e `Editar` (lápis).
- **Sem botão de excluir**: o Staff não pode apagar usuários.
- Sem botão "+ Novo Avaliador": o cadastro na recepção é feito por autocadastro.

O botão de navegação para o **Telão** fica oculto para o Staff (só o Admin vê).

## Autocadastro do avaliador (QR Code)

- A aba de avaliadores do Staff mostra um QR Code com
  `${window.location.origin}/?cadastro=avaliador&evento=<evento_ativo_id>`, gerado por `api.qrserver.com`, mais os
  botões `Copiar Link de Autocadastro` e `Abrir Tela de Cadastro`.
- `TelaAutocadastroAvaliador` (mobile-first): nome, e-mail, instituição (escolher ou digitar nova) e áreas de
  interesse.
- O avaliador fica **pendente de credenciamento presencial** e é orientado a procurar o Staff.
- O cadastro é idempotente por e-mail.

## Contagens

Contagens de credenciados usam conjuntos únicos de `id_usuario`, filtram por `id_evento` e separam por `papel`
(`AVALIADOR` × `STAFF`). Ver [troubleshooting](../operacao/troubleshooting.md#contagem-duplicada-de-credenciados).

Testes: `src/features/auth/__tests__/LoginZeroFriccao.test.tsx`, `src/features/avaliadores/__tests__/`,
`src/__tests__/integracao/TelaStaffLayoutEAutocadastro.test.tsx`.
