# Padrões do Projeto

Padrões que todo código novo deve seguir. Se um padrão precisar mudar, registre a decisão em
[`docs/decisoes/`](../decisoes/README.md).

## Padrões de dados e domínio

### Upsert por chave natural
Chaves do domínio (`codigo_projeto`, `email`, `nome_normalizado`) são a âncora de idempotência. Importar a mesma
planilha duas vezes atualiza os registros, sem duplicar.

```ts
await supabase.from('projetos').upsert(listaProjetos, { onConflict: 'codigo_projeto' });
```

### UUID nunca aparece na interface
O UUID interno (`id_projeto` etc.) **nunca** é exibido. Use a chave natural (`codigo_projeto`, ex.: `FETEC-001`).
Ver [ADR 0002](../decisoes/0002-chave-natural-e-uuid-oculto.md).

### Importação em lote (batch upsert)
Toda carga de planilha é validada e montada em memória e enviada numa única chamada `.upsert([...])`. É proibido
`for ... await supabase...` linha a linha (centenas de registros devem levar menos de 1 s).
Ver [importação de planilhas](../regras-de-negocio/importacao-de-planilhas.md).

### Escopo por evento
Toda consulta e escrita de dados do evento filtra por `id_evento` do evento ativo. Ver
[eventos](../regras-de-negocio/eventos.md#escopo-por-evento).

### Travamento pessimista com expiração
Ao iniciar uma avaliação, é criado um registro em `locks_ativos` com
`expira_em = now() + minutos_timeout_lock` (padrão 30 min). Cada avaliador tem no máximo uma trava; um projeto pode
ter várias (banca). Travas expiradas são limpas a cada sorteio.

### Soft delete com desfazer
Avaliações não são apagadas: `excluir_avaliacao` marca `status = 'CANCELADA'` e a interface oferece **Desfazer** por
8 segundos (`restaurar_avaliacao`). Ver [ADR 0004](../decisoes/0004-soft-delete-de-avaliacoes-via-rpc.md).

### DELETE sempre com WHERE
O banco rejeita `DELETE` sem `WHERE` (safeupdate) e o CI bloqueia migrations com esse padrão. Em SQL use
`WHERE id IS NOT NULL`; no cliente use filtros explícitos.

### Fallback para schema cache
Inserções/atualizações que dependem de colunas novas tratam `PGRST204` / "schema cache" com uma segunda tentativa
usando só as colunas base. Ver [troubleshooting](../operacao/troubleshooting.md#schema-cache-desatualizado-no-postgrest).

## Padrões de interface

### Bento Grid no painel do Admin (`TelaAdmin`)
O painel é dividido em três blocos de cards. Cada card abre um modal independente, e o estado do painel não é
desmontado ao navegar entre módulos.

| Bloco | Cor | Cards |
|---|---|---|
| 1. Projetos & Pavilhão | Verde | Projetos, Projetos Bloqueados, Projetos em Quarentena, Atribuir Projeto, Excluir uma avaliação |
| 2. Pessoal & Formulários | Azul | Avaliadores, Equipe Staff, Questionários, Instituições, Modalidades e Níveis |
| 3. Monitoramento em Tempo Real & Relatórios | Âmbar | Classificação, Relatórios, Mapa de Estandes |

- Os cards não exibem contadores; as contagens ficam dentro de cada modal.
- A Gestão de Administradores fica nas Configurações Gerais (ícone de engrenagem no cabeçalho), fora do Bento Grid.

### Layout canônico dos modais de gestão
Todo gestor administrativo (`GestorProjetos`, `GestorAvaliadores`, `GestorStaff`, `GestorInstituicoes`,
`GestorModalidades`…) segue o mesmo layout:

1. **Cabeçalho**: título com ícone à esquerda; à direita `Baixar Modelo (.xlsx)` (quando houver),
   `Importar (.xls/.xlsx/.csv)`, `Novo...`, `Recarregar Lista` e `Fechar Janela`.
2. **Console de importação retrátil**: aparece só durante/após uma importação.
3. **Formulário de cadastro retrátil**: abre com `Novo...` e fecha sozinho após salvar.
4. **Linha de busca e contagem**: busca à esquerda; contador à direita no formato `Total: X itens (Y credenciados)`.
5. **Tabela** com colunas ordenáveis (`ArrowUpDown` / `ArrowUp` / `ArrowDown`) e ações compactas por ícone com tooltip
   (`Pencil` editar, `Trash2` excluir). Ações de estado continuam como botão em destaque
   (`Check-in`, `Credenciar / Descredenciar`).

### Importação de planilhas
- O botão é sempre `Importar (.xls/.xlsx/.csv)` e abre direto o seletor de arquivos.
- Sem subtítulos ou textos explicativos redundantes na tela.

### Interface enxuta
Evite subtítulos explicativos, termos técnicos entre parênteses (ex.: `(3FN)`, `(Modo Contingência)`) e contadores
duplicados. Títulos devem ser diretos.

### Ações destrutivas em duas etapas
Ações irreversíveis exigem confirmação explícita. O Reset Global exige digitar o token do evento
(ex.: `RESETAR-FETEC-MS-2026`) e confirmar em um segundo modal. A exclusão de avaliação mostra um resumo completo
antes de `Confirmar Exclusão`.

### Atualização sem recarregar
Toda alteração (novo evento, edição, credenciamento) atualiza o estado React na hora, sem exigir F5.

## Padrões de código React

- Funções de busca usadas em `useEffect` são estabilizadas com `useCallback`, e o estado é atualizado de forma
  funcional (`set_x(anterior => ...)`), para evitar loops de renderização.
  Ver [troubleshooting](../operacao/troubleshooting.md#loop-infinito-de-requisições-no-painel-admin).
- Contagens usam conjuntos únicos (`Set<string>`) e sempre filtram por `id_evento` e `papel`.
- Escritas administrativas chamam `garantirSessaoAdmin()` antes e tratam erros com `tratarErroEscritaAdmin()`
  (`src/lib/sessaoAdmin.ts`).
- Estrutura de pastas e regras de import: [frontend.md](frontend.md).
