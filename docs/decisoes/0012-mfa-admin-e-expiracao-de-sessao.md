# 0012. Segundo fator do Admin e expiração de sessão configuráveis

- **Status**: Aceito
- **Data**: 2026-10-31

## Contexto

A revisão de segurança (etapa 2, ver [modelo de ameaças](../arquitetura/modelo-de-ameacas.md)) apontou que o Admin,
que pode alterar e cancelar notas, entrava só com senha, e que as sessões de Admin e Staff não expiravam. O ASVS 5.0
nível 2 pede segundo fator para contas privilegiadas (6.3.3) e encerramento de sessão por inatividade (7.3). O plano
gratuito do Supabase oferece TOTP, mas não limita a duração da sessão no servidor.

## Decisão

- O Admin escolhe na engrenagem (**Segurança das contas**) se o login do Admin exige segundo fator (aplicativo
  autenticador, TOTP do Supabase Auth). Ligada, a exigência vale **no banco**: `is_admin()` só reconhece a sessão
  `aal2`. Ligar ou desligar exige `aal2`, para ninguém se trancar fora e para uma sessão só de senha não desligar a
  proteção.
- O Admin define na engrenagem o tempo sem uso (5 a 720 minutos; 0 = não expira) após o qual a sessão de Admin e
  Staff é encerrada. A expiração é aplicada no navegador.
- A política fica em `configuracoes_seguranca` (linha única), válida para o sistema todo, não por evento.

## Consequências

- Com o MFA ligado, perder o celular do aplicativo exige remover o fator no painel do Supabase (*Authentication →
  Users*). Ver [configuração](../arquitetura/configuracao.md#segundo-fator-mfa-do-admin).
- A expiração por inatividade não protege um token copiado para fora do navegador; o MFA reduz o impacto para o Admin.
- Para projetar o Telão por horas, usar `/telao` (sem login), e não o Telão aberto dentro do painel do Admin.

## Alternativas consideradas

- **MFA obrigatório sempre:** descartado por decisão do dono do projeto; fica opcional e configurável.
- **Limite de sessão no servidor (Supabase *Time-box/Inactivity timeout*)**: recurso de plano pago.
