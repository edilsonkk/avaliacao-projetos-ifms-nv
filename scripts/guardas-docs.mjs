/**
 * Guardas de documentação: conferem que os `.md` continuam coerentes entre si e com o código.
 *
 * A doc é a fonte da verdade para agentes de IA (`CLAUDE.md` → `AGENTS.md` entra em toda sessão,
 * `docs/README.md` roteia o resto), então link morto e caminho inexistente custam contexto e levam
 * a conclusão errada. Rodam no `npm run lint`, ou seja, também no CI.
 *
 * Quebram o lint:
 *   1. Link relativo (e âncora `#secao`) que não resolve.
 *   2. Caminho de código em backticks (`src/…`, `supabase/…`) que não existe.
 *   3. Doc em `docs/` inalcançável a partir de `docs/README.md`.
 *   4. ADR fora do índice `docs/decisoes/README.md`.
 *   5. `npm run <x>` que não existe no `package.json`.
 *   6. Versão do Supabase CLI divergente entre os `.md` e o workflow de migrations.
 *   7. `file:///` ou segredo com valor literal.
 *   8. Auto-contexto (`CLAUDE.md` + `AGENTS.md`) acima do orçamento.
 *
 * Só avisam: arquivo grande demais, cabeçalho duplicado, contagem volátil
 * (as três regras de `docs/README.md` → "Mantendo a documentação").
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath: o caminho do projeto tem acentos, e `pathname` viria percent-encoded
const RAIZ = fileURLToPath(new URL('..', import.meta.url));

const IGNORAR_PASTAS = ['node_modules', '.git', 'dist', 'coverage', '.vscode'];
/** Gerado pelo release-please: não é doc escrita à mão. */
const IGNORAR_ARQUIVOS = ['CHANGELOG.md'];
/** Caminhos fictícios de propósito (exemplos). Chave: caminho citado; valor: por quê. */
const EXCECOES = new Map([['docs/regras-de-cota', 'exemplo de nome de branch em CONTRIBUTING.md']]);

const ORCAMENTO_AUTO_CONTEXTO = 8 * 1024; // CLAUDE.md + AGENTS.md, pagos em toda sessão
const AVISO_ARQUIVO_GRANDE = 24 * 1024;

const problemas = [];
const avisos = [];
const erro = (arquivo, linha, texto) => problemas.push(`${arquivo}:${linha}  ${texto}`);
const avisar = (arquivo, linha, texto) => avisos.push(`${arquivo}:${linha}  ${texto}`);

const listar = (pasta) => {
  const saida = [];
  for (const nome of readdirSync(pasta)) {
    if (IGNORAR_PASTAS.includes(nome)) continue;
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...listar(caminho));
    } else if (nome.endsWith('.md') && !IGNORAR_ARQUIVOS.includes(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
};

/** Slug de cabeçalho no estilo do GitHub: minúsculas, pontuação fora, espaço vira hífen. */
const slug = (texto) =>
  texto
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link no cabeçalho: só o texto
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

/** Linhas de cada arquivo, já sem as cercas de código (para links e caminhos). */
const foraDeCerca = (linhas) => {
  let dentro = false;
  return linhas.map((linha) => {
    if (/^\s*(```|~~~)/.test(linha)) {
      dentro = !dentro;
      return '';
    }
    return dentro ? '' : linha;
  });
};

const arquivos = listar(RAIZ);
const conteudos = new Map();
const cabecalhos = new Map(); // caminho absoluto -> Set de slugs

for (const caminho of arquivos) {
  const linhas = readFileSync(caminho, 'utf8').split('\n');
  conteudos.set(caminho, linhas);
  const slugs = new Set();
  const vistos = new Map();
  foraDeCerca(linhas).forEach((linha, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(linha);
    if (!m) return;
    const s = slug(m[2]);
    if (vistos.has(s)) {
      avisar(relative(RAIZ, caminho), i + 1, `cabeçalho duplicado "${m[2].trim()}" (âncora #${s} fica ambígua)`);
    }
    vistos.set(s, i + 1);
    slugs.add(s);
  });
  cabecalhos.set(caminho, slugs);
}

// 1 e 2: links e caminhos de código
const links = new Map(); // caminho absoluto -> Set de .md alcançados (para a checagem 3)
let totalLinks = 0;

for (const caminho of arquivos) {
  const rel = relative(RAIZ, caminho);
  const alcancados = new Set();
  foraDeCerca(conteudos.get(caminho)).forEach((linha, i) => {
    const numero = i + 1;

    for (const [, destino] of linha.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(destino)) continue;
      totalLinks += 1;
      const [alvo, ancora] = destino.split('#');
      const absoluto = alvo ? resolve(dirname(caminho), alvo) : caminho;
      if (alvo && !existsSync(absoluto)) {
        erro(rel, numero, `link quebrado -> ${destino}`);
        continue;
      }
      if (alvo && alvo.endsWith('.md')) alcancados.add(absoluto);
      if (ancora && cabecalhos.has(absoluto) && !cabecalhos.get(absoluto).has(ancora)) {
        erro(rel, numero, `âncora inexistente -> ${destino}`);
      }
    }

    for (const [, trecho] of linha.matchAll(/`([^`\n]+)`/g)) {
      if (!/^(src|supabase|scripts|docs|\.agents|\.github)\//.test(trecho)) continue;
      if (/[.]{3}|[*<>]/.test(trecho)) continue; // placeholder
      if (trecho.includes('@')) continue; // ação do GitHub (supabase/setup-cli@v1), não caminho
      if (EXCECOES.has(trecho)) continue;
      if (!existsSync(join(RAIZ, trecho))) {
        erro(rel, numero, `caminho inexistente -> ${trecho} (se for exemplo, acrescente a EXCECOES)`);
      }
    }
  });
  links.set(caminho, alcancados);
}

// 3: nenhuma doc órfã (BFS a partir de docs/README.md)
const indice = join(RAIZ, 'docs/README.md');
const alcancaveis = new Set([indice]);
const fila = [indice];
while (fila.length > 0) {
  for (const vizinho of links.get(fila.pop()) ?? []) {
    if (!alcancaveis.has(vizinho)) {
      alcancaveis.add(vizinho);
      fila.push(vizinho);
    }
  }
}
for (const caminho of arquivos) {
  const rel = relative(RAIZ, caminho);
  if (!/^(docs|\.agents)\//.test(rel)) continue;
  if (!alcancaveis.has(caminho)) {
    erro(rel, 1, 'doc inalcançável a partir de docs/README.md (acrescente um link ou remova o arquivo)');
  }
}

// 4: índice de ADRs
const indiceAdr = readFileSync(join(RAIZ, 'docs/decisoes/README.md'), 'utf8');
for (const nome of readdirSync(join(RAIZ, 'docs/decisoes'))) {
  if (!/^\d{4}-.*\.md$/.test(nome) || nome.startsWith('0000-')) continue;
  if (!indiceAdr.includes(nome)) {
    erro('docs/decisoes/README.md', 1, `ADR fora do índice -> ${nome}`);
  }
}

// 5, 6, 7: comandos, versão do CLI e higiene (valem também dentro das cercas)
const scriptsNpm = new Set(Object.keys(JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).scripts));
const workflow = readFileSync(join(RAIZ, '.github/workflows/supabase-migrations.yml'), 'utf8');
const versaoCli = /SUPABASE_CLI_VERSION:\s*([0-9][0-9.]*)/.exec(workflow)?.[1];
if (!versaoCli) {
  erro('.github/workflows/supabase-migrations.yml', 1, 'SUPABASE_CLI_VERSION não encontrada');
}

const SEGREDOS = [
  [/eyJ[A-Za-z0-9_-]{15,}/, 'parece um JWT'],
  [/sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/, 'parece uma chave do Supabase'],
  [/(service_role|anon)[_a-z]*\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}/i, 'parece uma chave com valor'],
  [/SUPABASE[A-Z_]*(KEY|TOKEN|PASSWORD)\s*=\s*['"]?[A-Za-z0-9_-]{16,}/, 'parece um segredo com valor'],
];

for (const caminho of arquivos) {
  const rel = relative(RAIZ, caminho);
  conteudos.get(caminho).forEach((linha, i) => {
    const numero = i + 1;

    for (const [, nome] of linha.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) {
      if (!scriptsNpm.has(nome)) erro(rel, numero, `npm run ${nome} não existe no package.json`);
    }

    for (const [, versao] of linha.matchAll(/supabase@([0-9][0-9.]*)/g)) {
      if (versaoCli && versao !== versaoCli) {
        erro(rel, numero, `supabase@${versao} divergente do SUPABASE_CLI_VERSION (${versaoCli}) do workflow`);
      }
    }

    if (/file:\/\/\/[\w\/.~-]/.test(linha)) erro(rel, numero, 'file:/// não serve para outra pessoa — use caminho relativo');
    for (const [padrao, texto] of SEGREDOS) {
      if (padrao.test(linha)) erro(rel, numero, `${texto} — segredo não entra na doc`);
    }
    const contagem = /(?<![\d.])\d+\s+(su[íi]tes?|testes?)\b/i.exec(linha);
    if (contagem) {
      avisar(rel, numero, `contagem volátil "${contagem[0].trim()}" — muda a todo commit (docs/README.md)`);
    }
  });
}

// 8 e 9: orçamento de contexto
const bytes = (rel) => readFileSync(join(RAIZ, rel)).length;
const autoContexto = bytes('CLAUDE.md') + bytes('AGENTS.md');
if (autoContexto > ORCAMENTO_AUTO_CONTEXTO) {
  erro(
    'AGENTS.md',
    1,
    `auto-contexto com ${(autoContexto / 1024).toFixed(1)} KB, acima do orçamento de ${ORCAMENTO_AUTO_CONTEXTO / 1024} KB ` +
      '(todo agente paga isso em toda sessão — mova detalhe para docs/)'
  );
}
for (const caminho of arquivos) {
  const tamanho = readFileSync(caminho).length;
  if (tamanho > AVISO_ARQUIVO_GRANDE) {
    avisar(relative(RAIZ, caminho), 1, `${(tamanho / 1024).toFixed(1)} KB — considere dividir: ler o arquivo todo custa contexto`);
  }
}

for (const aviso of avisos) console.log('  aviso: ' + aviso);

if (problemas.length > 0) {
  console.error(`\nGuardas de documentação: ${problemas.length} problema(s).\n`);
  for (const p of problemas) console.error('  ' + p);
  console.error('\nVer docs/README.md → "Mantendo a documentação"');
  process.exit(1);
}

const tokens = Math.round(autoContexto / 4);
console.log(
  `Guardas de documentação: ok (${arquivos.length} arquivos, ${totalLinks} links, auto-contexto ~${tokens} tokens).`
);
