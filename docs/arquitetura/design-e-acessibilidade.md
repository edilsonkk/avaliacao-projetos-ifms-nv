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

`--escala-texto` (no `:root`) é o tamanho da raiz; o controle no cabeçalho a move entre **100%, 112,5% e 125%**
(`src/lib/preferenciasVisuais.ts`, chave `tamanho_texto_fecin`). Um script em `index.html` aplica tema e tamanho
antes da primeira pintura, para a tela não piscar. Por isso nada de tamanho em `px`: só o que está em `rem`
acompanha a escolha da pessoa e a configuração de fonte do aparelho.

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
| `Modal` | qualquer diálogo | `role="dialog"`/`alertdialog`, `aria-modal`, foco inicial (`data-foco-inicial`), foco preso, `Esc`, foco devolvido a quem abriu, rolagem do fundo travada |
| `Aviso` | o que antes era `alert()` | diálogo com a tipografia da tela, foco no botão de ciência |
| `ConfirmacaoPerigo` | o que antes era `confirm()` | `alertdialog`; o caminho seguro é o primário, recebe o foco e responde ao `Esc` |
| `ProvedorAvisos` + `useAvisos()` | `avisar`, `confirmar` e `notificar` | uma única região viva (`aria-live`), `assertive` só no erro |
| `Abas` + `PainelAba` | navegação por abas | `role="tablist"/"tab"/"tabpanel"`, tabulação só na aba ativa, setas e Home/End |
| `Dica` | explicação curta | `role="tooltip"`, abre no toque e fecha com `Esc` |
| `CabecalhoOrdenavel` | coluna de tabela | `aria-sort` e ordenação pelo teclado |

## Esqueleto da página

`App.tsx` abre com o link **"Pular para o conteúdo"** (primeiro item da tabulação, visível só no foco) apontando
para o `id="conteudo"` do bloco de tela. O cabeçalho não tem mais `<h1>`: **cada tela tem o seu, único**. A
navegação é um `<nav aria-label="Telas do sistema">` com `aria-current="page"` na tela ativa.

A camada base aplica `overflow-x: clip` no `<html>` como guarda contra rolagem horizontal — guarda, não desculpa:
a 360px, `document.documentElement.scrollWidth` tem de continuar igual ao `clientWidth`.

## Avisos, confirmações e notificações

Nenhum diálogo do navegador. A tela pede o que precisa ao `useAvisos()`:

```tsx
const { avisar, confirmar, notificar } = useAvisos();

await avisar({ tipo: 'sucesso', titulo: 'Avaliação enviada', mensagem: 'A nota foi gravada.' });

if (await confirmar({ titulo: 'Sair e desvincular?', rotuloConfirmar: 'Sair e desvincular', rotuloCancelar: 'Continuar avaliando' })) {
  // só aqui a ação destrutiva acontece
}

notificar('Novo projeto sorteado', 'sucesso'); // passageiro, não interrompe
```

Quando usar cada um: **`avisar`** para o que precisa de ciência, relata falha ou conclui uma ação (era o
`alert()`); **`confirmar`** para ação destrutiva (era o `window.confirm()`); **`notificar`** para o aviso
passageiro que não deve interromper — agora anunciado, ao contrário das caixas flutuantes antigas.

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

`Tabela` responsiva e a migração das telas (avaliador, Staff, Admin, Relatórios, Telão) — ver o plano de execução
por etapas.
