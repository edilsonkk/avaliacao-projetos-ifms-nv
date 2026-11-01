# 0013. Base de design própria com acessibilidade verificada

- **Status**: Aceito
- **Data**: 2026-11-01

## Contexto

Cada tela escrevia o próprio estilo: 201 combinações de classe com forma de botão (46 só da variante verde
primária), 37 variações de campo, 48 de selo, 43 sobreposições de modal — nenhuma com armadilha de foco ou `Esc` —
e 276 textos em 10 ou 11 px. `src/styles/index.css` tinha 3 linhas, sem nenhum token.

Havia também reprovação objetiva de acessibilidade, medida e não suposta: o botão primário
(`bg-emerald-600` + texto branco) dava 3,67:1 e o `text-slate-400` sobre branco dava 2,63:1, contra o mínimo de
4,5:1 da WCAG 2.2 AA; 31 de 119 campos não tinham rótulo programático; 44 avisos usavam `alert()`/`confirm()` do
navegador; e não havia nenhuma ferramenta de verificação (sem ESLint, sem `jsx-a11y`, sem axe).

Como o IFMS é instituição federal, WCAG 2.2 AA e eMAG não são preferência, são exigência.

## Decisão

Criar uma base de design **própria**, sem dependência nova de UI:

1. **Tokens semânticos** em `src/styles/index.css` (`acao`, `perigo`, `aviso`, `info`, `texto`,
   `texto-secundario`, `superficie`, `borda`, `borda-controle`), com escala de texto em `rem` (12/14/16/20/24/30),
   três raios e três sombras. Cor é escolhida pelo papel, não pelo tom do Tailwind.
2. **Componentes compartilhados** em `src/components/ui/`, com a acessibilidade embutida em vez de repetida: o
   `Botao` exige `aria-label` pelo TypeScript quando é só ícone; o `Campo` sempre liga `<label htmlFor>`,
   `aria-invalid` e `aria-describedby`; o `Estado` anuncia carregamento e erro.
3. **Contraste verificado por script** (`npm run contraste`), que falha quando um token fica abaixo do mínimo.
4. Camada base com anel de foco único (`:focus-visible`), respeito a `prefers-reduced-motion` e tamanho de texto
   controlável pela pessoa.

## Consequências

- Tela nova fica mais curta e nasce acessível: o acerto está no componente, não na memória de quem escreve.
- O contraste deixa de ser opinião: mudar um token sem rodar o script derruba a verificação.
- As telas existentes passam a conviver com dois estilos até serem migradas, uma por PR. Enquanto isso, o visual
  fica levemente desigual — é o preço de migrar aos poucos em vez de um PR gigante.
- Cores e tamanhos "soltos" (`bg-emerald-600`, `text-[10px]`) passam a ser regressão, e serão barrados por regra
  de lint quando o ESLint entrar.
- A identidade visual atual (verde e cinza) é mantida; a troca para a paleta institucional acontece depois, só
  nos tokens.

## Alternativas consideradas

- **Adotar Radix UI ou Headless UI** para modal, abas e menus: resolveria foco e teclado sem código próprio, mas
  acrescenta dependências ao bundle, ao Trivy e ao Dependabot. Descartado: o projeto fixa ações por hash e evita
  dependência nova; os primitivos de que precisamos são poucos e ficam cobertos por teste.
- **`clsx` + `tailwind-merge`**: substituídos por um `cn()` de 3 linhas.
- **Redesenho visual completo de uma vez**: descartado por tocar quase todo o JSX e os testes ao mesmo tempo,
  sem ganho de acessibilidade maior do que a padronização.
