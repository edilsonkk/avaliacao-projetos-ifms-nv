/**
 * Guardas da auditoria de endurecimento: o que a auditoria de 15/11/2026 corrigiu e que precisa
 * continuar corrigido. Revisão que não vira regra executável tem de ser refeita por alguém a cada
 * ciclo — ver `docs/operacao/auditoria.md`.
 *
 * Regras BLOQUEANTES (travam o `npm run lint`, logo o CI):
 *   1. bundle-telas-lazy    — as telas de depois do login entram por `lazy(() => import(...))`.
 *   2. bundle-excel         — o ExcelJS entra só por `import()`; nunca no bundle inicial.
 *   3. service-role-no-src  — nenhuma chave `service_role` em código que vai para o navegador.
 *   4. orcamento-bundle     — o JS inicial não passa do teto de catraca (só quando há `dist/`).
 *
 * Regras PENDENTES (contadas no fim, sem travar): o que a auditoria mediu e deixou para os
 * próximos PRs. Cada uma vira bloqueante no dia em que zerar, como as pastas do `guardas.mjs`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// fileURLToPath: o caminho do projeto tem acentos, e `pathname` viria percent-encoded
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const APP = 'src/app/App.tsx';

/** Telas alcançáveis só depois de autenticar (ou por acesso pontual): nenhuma no bundle inicial. */
const TELAS_POS_LOGIN = ['TelaAvaliador', 'TelaStaff', 'TelaAdmin', 'TelaRedefinirSenha', 'TelaoAoVivo'];

/**
 * Teto de catraca do JavaScript inicial, em KB comprimidos (gzip). A medição de 15/11/2026 fechou
 * em 158 KB, de 553 KB antes da divisão do bundle. A meta de `lighthouse-budget.json` é 150 KB;
 * enquanto ela não é alcançada, o teto impede a volta do crescimento.
 */
const TETO_JS_INICIAL_KB = 165;

/** Sinalizadores de tipagem ainda desligados, com o número de erros medido em 15/11/2026. */
const TIPAGEM_PENDENTE = [
  ['noUncheckedIndexedAccess', 192],
  ['noUnusedLocals', 66],
  ['exactOptionalPropertyTypes', 18],
  ['noUnusedParameters', 6],
];

const problemas = [];
const pendencias = [];

const ler = (relativo) => readFileSync(join(RAIZ, relativo), 'utf8');

const listar = (pasta) => {
  const saida = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida.push(...listar(caminho));
    else if (/\.(ts|tsx)$/.test(nome)) saida.push(caminho);
  }
  return saida;
};

const ehTeste = (caminho) =>
  caminho.includes('__tests__') || caminho.includes('/test/') || /\.test\.tsx?$/.test(caminho);

const arquivosDeProducao = listar(join(RAIZ, 'src')).filter((c) => !ehTeste(c));

// ---------------------------------------------------------------------------
// 1. bundle-telas-lazy: quem abre o login no celular não baixa o painel inteiro
// ---------------------------------------------------------------------------
const app = ler(APP);
/** Linhas de import estático (`import ... from '...'`), onde nenhuma tela pós-login pode aparecer. */
const importsEstaticos = app.split('\n').filter((l) => /^import\s/.test(l) && !l.includes('import('));

for (const tela of TELAS_POS_LOGIN) {
  const temLazy = new RegExp(`const\\s+${tela}\\s*=\\s*lazy\\(`).test(app);
  const estatica = importsEstaticos.some((l) => new RegExp(`\\b${tela}\\b`).test(l));

  if (!temLazy) {
    problemas.push(`${APP}  bundle-telas-lazy: ${tela} precisa entrar por lazy(() => import(...))`);
  }
  if (estatica) {
    problemas.push(`${APP}  bundle-telas-lazy: ${tela} em import estático — ela volta ao bundle inicial`);
  }
}

if (!/from 'react'/.test(app) || !/\bSuspense\b/.test(app)) {
  problemas.push(`${APP}  bundle-telas-lazy: falta o <Suspense> que cobre a troca de tela`);
}

// ---------------------------------------------------------------------------
// 2. bundle-excel: ~930 KB que só quem abre planilha precisa baixar
// ---------------------------------------------------------------------------
for (const caminho of arquivosDeProducao) {
  const relativo = relative(RAIZ, caminho);
  const linhas = ler(relativo).split('\n');
  linhas.forEach((linha, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(linha)) return;
    if (/\bfrom\s+'exceljs'/.test(linha) || /\brequire\(\s*'exceljs'\s*\)/.test(linha)) {
      problemas.push(
        `${relativo}:${i + 1}  bundle-excel: import estático do exceljs — use await import('exceljs')`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 3. service-role-no-src: a chave que ignora a RLS nunca vai para o navegador
// ---------------------------------------------------------------------------
for (const caminho of listar(join(RAIZ, 'src'))) {
  const relativo = relative(RAIZ, caminho);
  const linhas = ler(relativo).split('\n');
  linhas.forEach((linha, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(linha)) return;
    if (/service_role|SERVICE_ROLE/.test(linha)) {
      problemas.push(
        `${relativo}:${i + 1}  service-role-no-src: chave de service_role em código de navegador`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 4. orcamento-bundle: o número que impede a performance de regredir em silêncio
// ---------------------------------------------------------------------------
const INDEX_BUILD = 'dist/index.html';
let orcamento = null;

if (existsSync(join(RAIZ, INDEX_BUILD))) {
  const html = ler(INDEX_BUILD);
  const iniciais = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const kb = (bytes) => bytes / 1024;
  let total = 0;

  for (const ativo of iniciais) {
    const caminho = join(RAIZ, 'dist', ativo);
    if (!existsSync(caminho)) continue;
    total += gzipSync(readFileSync(caminho)).length;
  }

  orcamento = { arquivos: iniciais.length, kb: kb(total) };

  if (kb(total) > TETO_JS_INICIAL_KB) {
    problemas.push(
      `${INDEX_BUILD}  orcamento-bundle: JS inicial em ${kb(total).toFixed(1)} KB comprimidos, ` +
        `acima do teto de ${TETO_JS_INICIAL_KB} KB (ver lighthouse-budget.json)`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. telas-lazy-efetivas (pendência): o `index.ts` da feature desfaz a divisão
// ---------------------------------------------------------------------------
for (const [, feature, tela] of app.matchAll(/import\('@\/features\/([^/']+)\/components\/(\w+)'\)/g)) {
  const barril = `src/features/${feature}/index.ts`;
  if (!existsSync(join(RAIZ, barril))) continue;
  const reexporta = ler(barril).includes(`./components/${tela}`);
  const barrilEstatico = importsEstaticos.some((l) => l.includes(`'@/features/${feature}'`));
  if (reexporta && barrilEstatico) {
    pendencias.push(
      `${barril}  telas-lazy-efetivas: ${tela} continua no bundle inicial — o App importa ` +
        `'@/features/${feature}' de forma estática e o barril reexporta a tela`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. ts-strict (pendência): sinalizadores de tipagem ainda por ligar
// ---------------------------------------------------------------------------
const tsconfig = JSON.parse(ler('tsconfig.json')).compilerOptions ?? {};

if (tsconfig.strict !== true) {
  problemas.push('tsconfig.json  ts-strict: "strict": true foi ligado na auditoria e não pode sair');
}
for (const [sinalizador, erros] of TIPAGEM_PENDENTE) {
  if (tsconfig[sinalizador] !== true) {
    pendencias.push(`tsconfig.json  ts-strict: "${sinalizador}" desligado — ${erros} erro(s) a tratar`);
  }
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------
if (problemas.length > 0) {
  console.error(`Guardas da auditoria: ${problemas.length} problema(s) bloqueante(s).\n`);
  for (const p of problemas) console.error('  ' + p);
  console.error('\nVer docs/operacao/auditoria.md');
  process.exit(1);
}

const medida = orcamento
  ? `JS inicial: ${orcamento.kb.toFixed(1)} KB comprimidos em ${orcamento.arquivos} arquivo(s), teto ${TETO_JS_INICIAL_KB} KB.`
  : 'Orçamento de bundle não conferido: rode `npm run build` antes para gerar dist/.';

console.log(`Guardas da auditoria: ok (${arquivosDeProducao.length} arquivos conferidos). ${medida}`);
if (pendencias.length > 0) {
  console.log(`Pendente da auditoria: ${pendencias.length} item(ns).`);
  for (const p of pendencias) console.log('  ' + p);
}
