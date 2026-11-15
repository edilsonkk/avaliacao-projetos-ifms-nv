---
description: Audita permissões, fronteira cliente/servidor, entrada e caminho de erro das mudanças atuais, sem corrigir nada
argument-hint: "[caminho, PR ou 'tudo' — o padrão é o diff da branch contra main]"
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(npm run lint), Bash(npx vitest run:*), Bash(npm run build), Bash(grep:*), Bash(rg:*), Read, Glob, Grep, Task
---

# Auditar

Alvo: **$1** (sem argumento, audite o diff desta branch contra `main`; com `tudo`, o `src/` e o
`supabase/` inteiros).

Rode as fases 1 a 5 de [`docs/operacao/auditoria.md`](../../docs/operacao/auditoria.md) sobre esse alvo.
Delegue a varredura ao subagente `auditor`, cujo contexto não inclui a construção do código: quem escreveu
não é testemunha confiável sobre o que escreveu.

## Regras

1. **Não corrija nada.** Descoberta e correção são etapas separadas; agente que corrige enquanto procura
   apaga a evidência e torna impossível verificar. Ao terminar, pare e espere.
2. **Achado sem arquivo, linha e cenário concreto não é achado, é opinião.** Use o formato abaixo.
3. **Refute antes de propor.** Para cada achado, tente derrubá-lo primeiro: há guarda na RLS, em função
   `SECURITY DEFINER` ou em `garantirSessaoAdmin()` que já barra o cenário? Se houver, descarte e diga por quê.
   Falso positivo é o maior custo escondido de auditoria assistida.
4. **O banco é a fonte da verdade de permissão.** Front-end não autoriza nada
   ([segurança](../../docs/arquitetura/seguranca.md)). Um achado de autorização que só cita código de tela,
   sem apontar a policy ou a função que deveria barrar, está incompleto.

## O que procurar, em ordem de retorno

1. **Autorização por objeto.** Para cada leitura e escrita nova: quem pode chamar, qual checagem de
   identidade existe (`is_admin()`, `is_staff()`, `avaliador_atual()`) e qual checagem de posse do objeto
   existe. Onde a posse depender só de valor enviado pelo cliente, é ACHADO.
2. **Escopo por evento.** Toda leitura e escrita filtra por `id_evento`? Falta de filtro cruza dados entre
   feiras — é ACHADO, mesmo quando só existe um evento ativo hoje.
3. **Nota e trilha.** Nota de avaliador grava só por `fn_enviar_avaliacao`; coordenação, só pelas RPCs
   `admin_*`. Qualquer outro caminho de gravação de nota é ACHADO.
4. **Fronteira cliente/servidor.** Nenhum `service_role` em `src/`. Papel vem do banco, nunca do
   `localStorage`. Tabela liberada para `anon` é ACHADO até que se prove que a coluna é pública.
5. **Confiança na entrada.** Onde campo vindo da tela é gravado: existe lista explícita de campos? Corpo
   repassado inteiro (spread, `Object.assign`, `insert(objeto)`) é ACHADO de *mass assignment*.
6. **Caminho de erro.** O que acontece quando a consulta falha, o registro não existe, o parâmetro é
   malformado e a rede cai no meio. Mensagem do Postgres, nome de coluna ou UUID aparecendo na tela é ACHADO
   (a interface nunca mostra UUID: use `codigo_projeto`).
7. **Peso no carregamento.** Import estático novo de biblioteca pesada, ou tela pós-login fora de `lazy()`.
   Rode `npm run lint` e `npm run build` e compare com o teto de `scripts/guardas-auditoria.mjs`.

## Formato de cada achado

```
Arquivo:  src/features/projetos/components/GestorProjetos.tsx
Linha:    412
Classe:   autorização quebrada / escopo de evento / mass assignment / caminho de erro / peso
Cenário:  avaliador autenticado chama <x> e recebe <dado que não é dele>
Refutação tentada: o que foi conferido na RLS/função e por que não barra
Prova:    o teste que falha hoje (caminho e nome), ou o número medido antes e depois
Correção sugerida: uma frase — sem aplicar
```

## Saída

Lista de achados em ordem de severidade (Alto, Médio, Baixo), cada um no formato acima, e no fim:

- o que foi conferido e **não** virou achado, em uma linha cada (evita reauditar o mesmo ponto);
- quais achados podem virar regra em `scripts/guardas-auditoria.mjs` ou teste em `supabase/tests/`.
  Revisão que não vira guarda precisa ser refeita por alguém todo ciclo.
