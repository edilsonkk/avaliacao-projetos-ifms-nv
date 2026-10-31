import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Cabeçalhos HTTP de segurança do Firebase Hosting (etapa 4 da revisão de segurança, ASVS 3.4)
const firebase = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../firebase.json'), 'utf-8'));
const cabecalhosDeTudo: Record<string, string> = Object.fromEntries(
  firebase.hosting.headers
    .filter((h: { source: string }) => h.source === '**')
    .flatMap((h: { headers: { key: string; value: string }[] }) => h.headers.map((c) => [c.key, c.value]))
);
const diretivas = (csp: string) =>
  Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)]));

describe('cabeçalhos de segurança do site', () => {
  it('tem Content-Security-Policy restritiva', () => {
    // Arrange
    const csp = diretivas(cabecalhosDeTudo['Content-Security-Policy'] || '');

    // Assert
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]); // sem inline nem eval: um XSS não roda script próprio
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]); // não pode ser exibido dentro de outro site
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['connect-src']).toEqual(expect.arrayContaining(["'self'", 'https://*.supabase.co']));
  });

  it('tem os demais cabeçalhos de proteção', () => {
    // Assert
    expect(cabecalhosDeTudo['X-Content-Type-Options']).toBe('nosniff');
    expect(cabecalhosDeTudo['X-Frame-Options']).toBe('DENY');
    expect(cabecalhosDeTudo['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(cabecalhosDeTudo['Permissions-Policy']).toMatch(/microphone=\(\)/);
    expect(cabecalhosDeTudo['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('não carrega nada de domínios de terceiros no código do site', () => {
    // Arrange
    const raiz = path.resolve(__dirname, '../..');
    const arquivos: string[] = [];
    const varrer = (dir: string) =>
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') varrer(p); } else if (/\.(tsx?|css)$/.test(e.name)) arquivos.push(p);
      });
    varrer(raiz);

    // Act
    const externos = arquivos.flatMap((a) =>
      (fs.readFileSync(a, 'utf-8').match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
        .filter((u) => !/supabase\.co|localhost|127\.0\.0\.1|w3\.org|\.invalid$/i.test(u))
        .map((u) => `${path.relative(raiz, a)}: ${u}`)
    );

    // Assert
    expect(externos).toEqual([]);
  });
});
