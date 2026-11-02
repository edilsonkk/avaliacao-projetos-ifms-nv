/**
 * Guardas de interface que o `tsc` não cobre e que o ESLint cobriria se desse para usá-lo
 * (o `typescript-eslint` ainda não suporta TypeScript 7, a versão deste projeto —
 * https://github.com/typescript-eslint/typescript-eslint/issues/10940).
 *
 * Rodam no `npm run lint`, ou seja, também no CI. Regras, nas pastas já migradas:
 *   1. Nenhum `alert()`/`confirm()` do navegador: use `avisar()`/`confirmar()` de `useAvisos()`.
 *   2. Nenhum tamanho de texto em px fixo (`text-[10px]`): ele ignora o controle de tamanho
 *      de texto e o ajuste de fonte do aparelho.
 *
 * O que ainda não foi migrado é só contado no fim, como pendência: cada etapa da migração
 * acrescenta a pasta à lista `PASTAS_MIGRADAS` e o portão passa a valer para ela.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath: o caminho do projeto tem acentos, e `pathname` viria percent-encoded
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PASTAS_MIGRADAS = ['src/app', 'src/components', 'src/features/auth', 'src/features/avaliacao', 'src/lib'];

const listar = (pasta) => {
  const saida = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...listar(caminho));
    } else if (/\.(ts|tsx)$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
};

const ehTeste = (caminho) => caminho.includes('__tests__') || caminho.includes('/test/') || caminho.endsWith('.test.ts') || caminho.endsWith('.test.tsx');

/** Linha de comentário não é código: `// usa alert()` não é um alert(). */
const ehComentario = (linha) => /^\s*(\/\/|\/\*|\*)/.test(linha);

const problemas = [];
const pendencias = [];
const arquivos = listar(join(RAIZ, 'src')).filter((c) => !ehTeste(c));

for (const caminho of arquivos) {
  const relativo = relative(RAIZ, caminho);
  const migrado = PASTAS_MIGRADAS.some((p) => relativo.startsWith(p));
  const linhas = readFileSync(caminho, 'utf8').split('\n');

  linhas.forEach((linha, i) => {
    if (ehComentario(linha)) return;
    const numero = i + 1;
    const achados = [];

    if (/(^|[^.\w])(alert|confirm)\s*\(/.test(linha) || /window\.(alert|confirm)\s*\(/.test(linha)) {
      achados.push('diálogo do navegador — use avisar()/confirmar() de useAvisos()');
    }
    if (/text-\[\d+px\]/.test(linha)) {
      achados.push('tamanho de texto em px fixo — use text-legenda/apoio/corpo');
    }

    for (const achado of achados) {
      (migrado ? problemas : pendencias).push(`${relativo}:${numero}  ${achado}`);
    }
  });
}

if (problemas.length > 0) {
  console.error(`Guardas de interface: ${problemas.length} problema(s) em pasta já migrada.\n`);
  for (const p of problemas) console.error('  ' + p);
  console.error('\nVer docs/arquitetura/design-e-acessibilidade.md');
  process.exit(1);
}

console.log(`Guardas de interface: ok (${arquivos.length} arquivos conferidos).`);
if (pendencias.length > 0) {
  console.log(`Pendente nas telas ainda não migradas: ${pendencias.length} ocorrência(s).`);
}
