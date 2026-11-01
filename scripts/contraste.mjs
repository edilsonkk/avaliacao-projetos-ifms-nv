/**
 * Mede o contraste WCAG dos tokens de cor de src/styles/index.css.
 * Rodar sempre que um token de cor mudar:  node scripts/contraste.mjs
 *
 * As cores do Tailwind 4 vêm em oklch; aqui elas são convertidas para sRGB linear
 * e comparadas pela razão de contraste da WCAG 2.2 (AA: 4,5:1 para texto normal,
 * 3:1 para texto grande, ícones e bordas de controle).
 */

/** Pares conferidos: [nome, cor do texto, cor de fundo, mínimo exigido]. */
const PARES = [
  ['Botão primário (texto branco sobre --cor-acao)', '#ffffff', 'oklch(50.8% 0.118 165.612)', 4.5],
  ['Botão primário pressionado (--cor-acao-ativa)', '#ffffff', 'oklch(43.2% 0.095 166.913)', 4.5],
  ['Botão de perigo (--cor-perigo)', '#ffffff', 'oklch(58.6% 0.253 17.585)', 4.5],
  ['Selo de aviso (--cor-aviso)', '#ffffff', 'oklch(55.5% 0.163 48.998)', 4.5],
  ['Selo de informação (--cor-info)', '#ffffff', 'oklch(50% 0.134 242.749)', 4.5],
  ['Texto principal no tema claro', 'oklch(20.8% 0.042 265.755)', '#ffffff', 4.5],
  ['Texto secundário no tema claro', 'oklch(55.4% 0.046 257.417)', '#ffffff', 4.5],
  ['Texto principal no tema escuro', 'oklch(96.8% 0.007 247.896)', 'oklch(27.9% 0.041 260.031)', 4.5],
  ['Texto secundário no tema escuro', 'oklch(70.4% 0.04 256.788)', 'oklch(20.8% 0.042 265.755)', 4.5],
  ['Informação no tema escuro', 'oklch(82.8% 0.111 230.318)', 'oklch(20.8% 0.042 265.755)', 4.5],
  ['Verde como texto no tema claro (--cor-acao-texto)', 'oklch(50.8% 0.118 165.612)', '#ffffff', 4.5],
  ['Verde como texto no tema escuro (--cor-acao-texto)', 'oklch(76.5% 0.177 163.223)', 'oklch(20.8% 0.042 265.755)', 4.5],
  ['Âmbar como texto no tema claro (--cor-aviso-texto)', 'oklch(55.5% 0.163 48.998)', '#ffffff', 4.5],
  ['Âmbar como texto no tema escuro (--cor-aviso-texto)', 'oklch(87.9% 0.169 91.605)', 'oklch(20.8% 0.042 265.755)', 4.5],
  // WCAG 1.4.11: contorno que identifica um controle precisa de 3:1
  ['Borda de campo no tema claro (--cor-borda-controle)', 'oklch(55.4% 0.046 257.417)', '#ffffff', 3.0],
  ['Borda de campo no tema escuro (--cor-borda-controle)', 'oklch(70.4% 0.04 256.788)', 'oklch(27.9% 0.041 260.031)', 3.0],
];

const paraLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const oklchParaLinear = (texto) => {
  const [l, c, h] = texto.match(/[\d.]+/g).map(Number);
  const rad = (h * Math.PI) / 180;
  const L = l / 100;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(Math.max(v, 0), 1));
};

const hexParaLinear = (hex) => {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => paraLinear(parseInt(n.slice(i, i + 2), 16) / 255));
};

const luminancia = (cor) => {
  const [r, g, b] = cor.startsWith('#') ? hexParaLinear(cor) : oklchParaLinear(cor);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contraste = (frente, fundo) => {
  const a = luminancia(frente);
  const b = luminancia(fundo);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

let falhou = false;
console.log('Contraste dos tokens (WCAG 2.2)\n');
for (const [nome, frente, fundo, minimo] of PARES) {
  const razao = contraste(frente, fundo);
  const passa = razao >= minimo;
  if (!passa) falhou = true;
  console.log(`${passa ? 'OK  ' : 'FALHA'} ${razao.toFixed(2).padStart(5)}:1 (mínimo ${minimo}:1)  ${nome}`);
}
if (falhou) {
  console.error('\nAlgum par ficou abaixo do mínimo: ajuste o token em src/styles/index.css.');
  process.exit(1);
}
console.log('\nTodos os pares passam no mínimo exigido.');
