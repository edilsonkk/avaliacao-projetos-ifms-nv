# Design e acessibilidade

Base visual do sistema: tokens de cor, escala de texto e componentes de interface compartilhados, com os
critérios de acessibilidade que valem para toda tela nova.

Referências: **WCAG 2.2 nível AA** e **eMAG** (o IFMS é instituição federal). Decisão registrada na
[ADR 0013](../decisoes/0013-design-system-e-acessibilidade.md).

## Por que existe

Antes desta base, cada tela escrevia o próprio estilo: 201 combinações de classe com forma de botão (46 só da
variante verde primária), 37 variações de campo, 43 sobreposições de modal e 276 textos em 10 ou 11 px. Além da
inconsistência, havia reprovação objetiva de contraste — o botão primário `bg-emerald-600` com texto branco dava
3,67:1, abaixo do mínimo de 4,5:1.

## Tokens

Definidos em [`src/styles/index.css`](../../src/styles/index.css). As cores são **semânticas**: use
`bg-acao`, não `bg-emerald-700`. Os tokens de cor trocam sozinhos no tema escuro.

### Cor

| Token | Papel | Claro | Escuro | Contraste medido |
|---|---|---|---|---|
| `acao` / `acao-ativa` | ação primária, sucesso | emerald-700 / 800 | iguais | 5,37:1 com branco |
| `perigo` / `perigo-ativa` | ação destrutiva, erro | rose-600 / 700 | iguais | 4,51:1 com branco |
| `aviso` | atenção | amber-700 | igual | 5,05:1 com branco |
| `info` | informativo (ambiente, dicas) | sky-700 | sky-300 | 5,85:1 / 10,71:1 |
| `texto` | texto principal | slate-900 | slate-100 | 17,84:1 / 13,37:1 |
| `texto-secundario` | apoio, metadados | slate-500 | slate-400 | 4,77:1 / 6,79:1 |
| `superficie` / `superficie-alta` | fundo de cartão / de página | branco / slate-50 | slate-800 / slate-900 | — |
| `borda` | divisória **decorativa** | slate-200 | slate-700 | não exige 3:1 |
| `borda-controle` | contorno de campo e de botão secundário | slate-500 | slate-400 | 4,77:1 / 5,58:1 (WCAG 1.4.11 exige 3:1) |

Cores proibidas por reprovarem o contraste: `bg-emerald-600`/`bg-emerald-500`/`bg-amber-500`/`bg-rose-500` com
texto branco e `text-slate-400` no tema claro.

### Texto

Toda a escala é em `rem`, para acompanhar o controle de tamanho do cabeçalho e o ajuste de fonte do próprio
celular. **Nunca use tamanho em px fixo** (`text-[10px]`): ele ignora as duas coisas.

| Utilidade | Tamanho | Uso |
|---|---|---|
| `text-corpo` | 16px | o que a pessoa lê e digita (nota, título do projeto, parecer, botões). Em campo de formulário evita o zoom automático do iOS |
| `text-apoio` | 14px | rótulos, legendas, metadados |
| `text-legenda` | 12px | **piso absoluto**: selos e cabeçalho de tabela |
| `text-titulo-3/2/1` | 20 / 24 / 30px | `h3` / `h2` / `h1` |

`--escala-texto` (no `:root`) é o tamanho da raiz; o controle no cabeçalho a move entre 100%, 112,5% e 125%.

### Forma

`rounded-controle` (botões e campos), `rounded-cartao`, `rounded-painel` (modais); `shadow-cartao`,
`shadow-flutuante`, `shadow-painel`. Três níveis de cada, no lugar dos 9 raios e 10 sombras que havia.

## Componentes

Importe sempre pelo índice: `import { Botao, Campo } from '@/components/ui'`.

| Componente | Para quê | Acessibilidade embutida |
|---|---|---|
| `Botao` | ação | 44px de alvo, `aria-busy` ao carregar, `aria-label` **exigido pelo TypeScript** quando é só ícone |
| `Campo`, `CampoArea`, `CampoSelecao` | formulário | `<label htmlFor>` sempre, `aria-invalid` e `aria-describedby` ligando apoio e erro ao campo |
| `Cartao` | superfície/região | título vira cabeçalho no nível indicado; como `section`, nomeia a região |
| `Selo` | etiqueta de situação | piso de 12px, não quebra linha |
| `Estado` | carregando / vazio / erro | `role="status"` ao carregar, `role="alert"` no erro |
| `Dica` | explicação curta | `role="tooltip"`, abre no toque e fecha com `Esc` |
| `CabecalhoOrdenavel` | coluna de tabela | `aria-sort` e ordenação pelo teclado |

## Regras para tela nova

1. Nada de `alert()` ou `confirm()` do navegador.
2. Todo campo tem rótulo visível ligado por `htmlFor`; erro ligado por `aria-describedby`.
3. Botão só com ícone precisa de `aria-label`.
4. Ícone decorativo leva `aria-hidden="true"`.
5. Um `<h1>` por tela, sem salto de nível.
6. Alvo de toque mínimo de 44px.
7. Texto nunca abaixo de 12px, e sempre pela escala (sem `text-[Npx]`).
8. Nada identificado só por cor; nada identificado só por `title`.
9. A tela não pode rolar na horizontal: a 360px, `document.documentElement.scrollWidth` igual ao `clientWidth`.

## Conferir o contraste

Ao mudar um token de cor, rode:

```bash
npm run contraste
```

O script ([`scripts/contraste.mjs`](../../scripts/contraste.mjs)) converte o oklch do Tailwind para sRGB, calcula
a razão da WCAG e falha se algum par ficar abaixo do mínimo (4,5:1 para texto, 3:1 para contorno de controle).

## Ainda por fazer

`Modal` (com armadilha de foco e `Esc`), `Aviso` (o substituto do `alert()`), `ConfirmacaoPerigo`, `Abas`
(`role="tablist"`), região viva de notificações, `Tabela` responsiva, controle de tamanho de texto no cabeçalho e
a migração das telas — ver o plano de execução por etapas.
