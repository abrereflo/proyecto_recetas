import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The copy rules of docs/17, asserted over the whole presentation layer at once
 * rather than screen by screen.
 *
 * "Nunca aparece «wallet», frase semilla ni saldo. Consecuencia de romperla:
 * una herramienta clínica se lee como producto cripto y pierde al usuario."
 *
 * Scanning the sources rather than a rendered tree catches copy on branches no
 * test happens to render — an error message behind a rare failure, a label on a
 * control that only appears on one device.
 */

/**
 * Resolved from the working directory rather than from `import.meta.url`: under
 * the jsdom environment that URL is an `http:` one and cannot be converted to a
 * path.
 */
const PRESENTATION = locatePresentation();

function locatePresentation(): string {
  let directory = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(directory, 'src', 'presentation');
    if (existsSync(candidate)) return candidate;
    directory = dirname(directory);
  }

  throw new Error('src/presentation not found from the working directory');
}

/** docs/17, "Reglas que la interfaz no puede romper". */
const FORBIDDEN_WORDS = ['wallet', 'frase semilla', 'saldo'];

/**
 * No screen may offer, name or hint at reopening a dispensed prescription
 * (docs/04, docs/17). The test files themselves assert the ABSENCE of these
 * words, so only the components are scanned.
 */
const REVERSAL = /\b(reabrir|reapertura|revertir|deshacer|anular la dispensaci)/i;

/** docs/07: revocation revokes future access; it deletes nothing. */
const RETROACTIVE_DELETION = /se (borra|borran|elimina|eliminan)[^.]{0,40}dispensaci/i;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
  }

  return files;
}

/**
 * Comments are stripped before scanning.
 *
 * These rules govern INTERFACE COPY, and the comments deliberately quote the
 * forbidden phrasing in order to explain why it is forbidden — "never
 * «operación fallida»" is the rule, not a violation of it. `//` preceded by a
 * colon is left alone so a URL is never mistaken for a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

async function presentationSources(): Promise<{ path: string; text: string }[]> {
  const files = await sourceFiles(PRESENTATION);
  return Promise.all(
    files.map(async (path) => ({ path, text: stripComments(await readFile(path, 'utf8')) })),
  );
}

describe('the whole Spanish surface of the presentation layer', () => {
  it('covers every screen and component', async () => {
    const sources = await presentationSources();

    // A guard that scanned nothing would pass silently.
    expect(sources.length).toBeGreaterThanOrEqual(12);
  });

  it.each(FORBIDDEN_WORDS)('never uses the word "%s"', async (forbidden) => {
    for (const { path, text } of await presentationSources()) {
      expect(`${path}: ${text.toLowerCase()}`).not.toContain(forbidden);
    }
  });

  it('never offers to reopen, undo or revert a dispensed prescription', async () => {
    for (const { path, text } of await presentationSources()) {
      expect({ path, match: REVERSAL.exec(text)?.[0] ?? null }).toEqual({ path, match: null });
    }
  });

  it('never says a revocation deletes anything already registered', async () => {
    for (const { path, text } of await presentationSources()) {
      expect({ path, match: RETROACTIVE_DELETION.exec(text)?.[0] ?? null }).toEqual({
        path,
        match: null,
      });
    }
  });

  it('never falls back to a generic "operación fallida"', async () => {
    for (const { path, text } of await presentationSources()) {
      expect(`${path}: ${text.toLowerCase()}`).not.toContain('operación fallida');
    }
  });

  it('never promises offline operation (D-20)', async () => {
    const promise = /(funciona|disponible|opera)[^.]{0,20}sin conexi[oó]n/i;

    for (const { path, text } of await presentationSources()) {
      expect({ path, match: promise.exec(text)?.[0] ?? null }).toEqual({ path, match: null });
    }
  });

  it('never promises cross-pharmacy analytics or doctor shopping detection', async () => {
    const promise = /doctor shopping|anal[ií]tica por paciente|detecci[oó]n entre farmacias/i;

    for (const { path, text } of await presentationSources()) {
      expect({ path, match: promise.exec(text)?.[0] ?? null }).toEqual({ path, match: null });
    }
  });
});

describe('no navigation state reaches the URL', () => {
  // docs/17 and packages/shared/src/qr.ts: the QR payload carries the raw
  // decryption key, so a router would leak clinical content into the address
  // bar, the history and every later `Referer` header.
  it('installs no router and touches no history API', async () => {
    for (const { path, text } of await presentationSources()) {
      expect(`${path}: ${text}`).not.toMatch(/react-router|wouter|history\.pushState|useNavigate/);
    }
  });
});
