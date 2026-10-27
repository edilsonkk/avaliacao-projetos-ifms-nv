# 0006. RLS com escrita administrativa restrita ao Admin

- **Status**: Aceito (substitui a RLS emergencial de 2026-10-25)
- **Data**: 2026-10-26

## Contexto

Avaliador e Staff entram sem senha (role `anon`). As policies anteriores permitiam que qualquer visitante anônimo
importasse, apagasse dados e executasse funções administrativas como `admin_reset_global`.

## Decisão

- Leitura pública; escrita total só para `authenticated` com `is_admin()`.
- Exceções `anon` mínimas para os fluxos de Avaliador e Staff (check-in, autocadastro, travas, fila, bloqueios).
- Colunas sensíveis (`cpf`, `celular`, notas e pareceres) sem leitura `anon`.
- Funções `admin_*`, `excluir_avaliacao` e `restaurar_avaliacao` só para `authenticated`.

Migrations `20261026000000`, `20261026020000` e `20261026030000`.

## Consequências

- O Admin precisa de conta no Supabase Auth e `usuarios.papel = 'ADMIN'`.
- O front-end valida a sessão antes de escrever (`garantirSessaoAdmin`).
- Consultas `anon` precisam projetar colunas explicitamente.
- Avaliador e Staff continuam sem prova de identidade forte (limite conhecido, ver [segurança](../arquitetura/seguranca.md#limites-conhecidos)).
