# 0011. Identidade real para Avaliador e Staff

- **Status**: Aceito (substitui o "login zero-fricção" por e-mail)
- **Data**: 2026-10-28

## Contexto

Avaliador, Staff e Telão usavam o papel `anon`. O login pedia só o e-mail e guardava o ID no `localStorage`, e os
e-mails de todos eram legíveis pela API. Na prática, qualquer pessoa na internet podia:
- se passar por qualquer avaliador ou membro do Staff;
- criar travas e enviar notas em nome de outro;
- trocar a própria instituição para burlar o conflito de interesse;
- credenciar-se sozinha e alterar projetos.

Os testes pgTAP comprovaram 20 desses ataques no banco. Vincular o IP do celular foi proposto e descartado: no Wi-Fi
da feira todos compartilham o IP, e no 4G ele muda.

## Decisão

- **Avaliador**: o celular tem uma sessão anônima do Supabase Auth, vinculada ao avaliador por **pareamento** (o Staff
  confirma o código mostrado no celular) ou por **código de acesso** (o Staff gera, o avaliador digita). Ambos são
  configuráveis por evento, com limites em `CHECK` no banco. Um aparelho ativo por avaliador.
- **Staff**: conta com e-mail e senha, criada pelo Admin no painel e ligada ao perfil no primeiro login (`id_auth`).
- **RLS por papel** (`is_admin()`, `is_staff()`, `avaliador_atual()`). O avaliador só lê e grava as próprias linhas;
  sorteio e notas recusam `p_id_usuario` que não seja o do aparelho.
- O `localStorage` vira só atalho de tela. O `App.tsx` confere o papel com `fn_meu_perfil()` ao abrir.
- O cadastro público do Auth fica **ligado**, porque é exigido pelo login anônimo. Ele é inofensivo, porque contas
  sem papel não têm acesso.

## Consequências

- **Mudança incompatível** com a versão anterior do front-end (exceção ao expand/contract do ADR 0009): banco e
  front-end são publicados no mesmo release, fora de período de evento.
- O credenciamento ganha um passo: parear o celular, cerca de 10 segundos por pessoa.
- O Admin precisa criar a conta do Staff no painel do Supabase antes do evento.
- Um celular perdido continua vinculado até o Staff desvincular.
