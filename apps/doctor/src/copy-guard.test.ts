import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The copy rules of docs/17, asserted over every Spanish string this app
 * exports, rather than screen by screen.
 *
 * "Nunca aparece «wallet», frase semilla ni saldo. Consecuencia de romperla:
 * una herramienta clínica se lee como producto cripto y pierde al usuario."
 *
 * Written in the style of apps/pharmacy/src/presentation/copy-guard.test.ts,
 * with one deliberate difference. That guard scans whole source files, which it
 * can because it only covers `src/presentation`. This app has no screens yet
 * and its copy lives in the domain and application layers, beside adapters that
 * legitimately use viem's `createWalletClient` and the `wallet_switchEthereumChain`
 * RPC method. Scanning whole files would therefore flag protocol identifiers as
 * interface copy. So the unit scanned here is the STRING LITERAL: module
 * specifiers and the one protocol literal are excluded by name, and everything
 * else a user could ever read is checked.
 *
 * Scanning sources rather than a rendered tree catches copy on branches no test
 * happens to reach — an error message behind a rare failure, a label on a
 * control that only appears on one device.
 */

/**
 * Resolved from the working directory rather than from `import.meta.url`: under
 * the jsdom environment that URL is an `http:` one and cannot be converted to a
 * path.
 */
const SOURCE_ROOT = locateSource();

function locateSource(): string {
  let directory = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(directory, 'src', 'domain');
    if (existsSync(candidate)) return resolve(directory, 'src');
    directory = dirname(directory);
  }

  throw new Error('src/domain not found from the working directory');
}

/** docs/17, "Reglas que la interfaz no puede romper". */
const FORBIDDEN_WORDS = ['wallet', 'frase semilla', 'saldo'];

/**
 * Nothing may offer, name or hint at reopening a dispensed prescription
 * (docs/04, docs/17).
 */
const REVERSAL = /\b(reabrir|reapertura|revertir|deshacer|anular la dispensaci)/i;

/** docs/07: revocation revokes future access; it deletes nothing. */
const RETROACTIVE_DELETION = /se (borra|borran|elimina|eliminan)[^.]{0,40}(dispensaci|receta)/i;

/** D-17: the ADSIB signature is never presented as legally valid. */
const SIMULATED_LEGAL_VALIDITY = /(validez legal|legalmente v[áa]lid|firma digital v[áa]lid)/i;

/**
 * Protocol identifiers that happen to contain a forbidden word. They are wire
 * format, never screen copy, and they stay inside the adapters.
 */
const PROTOCOL_LITERALS = new Set(['wallet_switchEthereumChain', 'wallet_addEthereumChain']);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      // `src/test` holds fixtures, not copy.
      if (entry.name === 'test') continue;
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
 * forbidden phrasing in order to explain why it is forbidden — "never «wallet»"
 * is the rule, not a violation of it. `//` preceded by a colon is left alone so
 * a URL is never mistaken for a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function isModuleSpecifier(value: string): boolean {
  return (
    value.startsWith('@') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('node:') ||
    value === 'viem'
  );
}

/** Every string literal a person could conceivably read, with its file. */
async function copyLiterals(): Promise<{ path: string; text: string }[]> {
  const files = await sourceFiles(SOURCE_ROOT);
  const literals: { path: string; text: string }[] = [];

  for (const path of files) {
    const source = stripComments(await readFile(path, 'utf8'));

    for (const match of source.matchAll(LITERAL)) {
      const text = match[0].slice(1, -1);
      if (text.length === 0 || isModuleSpecifier(text) || PROTOCOL_LITERALS.has(text)) continue;
      literals.push({ path, text });
    }
  }

  return literals;
}

describe('the Spanish surface of the whole doctor core', () => {
  it('covers every module that carries copy', async () => {
    const files = await sourceFiles(SOURCE_ROOT);

    // A guard that scanned nothing would pass silently.
    expect(files.length).toBeGreaterThanOrEqual(12);
    expect((await copyLiterals()).length).toBeGreaterThanOrEqual(60);
  });

  it.each(FORBIDDEN_WORDS)('never uses the word "%s"', async (forbidden) => {
    for (const { path, text } of await copyLiterals()) {
      expect(`${path}: ${text.toLowerCase()}`).not.toContain(forbidden);
    }
  });

  it('never offers to reopen, undo or revert a dispensed prescription', async () => {
    for (const { path, text } of await copyLiterals()) {
      expect({ path, match: REVERSAL.exec(text)?.[0] ?? null }).toEqual({ path, match: null });
    }
  });

  it('never says a revocation deletes anything already registered', async () => {
    for (const { path, text } of await copyLiterals()) {
      expect({ path, match: RETROACTIVE_DELETION.exec(text)?.[0] ?? null }).toEqual({
        path,
        match: null,
      });
    }
  });

  it('never claims legal validity for the unintegrated ADSIB signature (D-17)', async () => {
    for (const { path, text } of await copyLiterals()) {
      expect({ path, match: SIMULATED_LEGAL_VALIDITY.exec(text)?.[0] ?? null }).toEqual({
        path,
        match: null,
      });
    }
  });

  it('never falls back to a generic "operación fallida"', async () => {
    for (const { path, text } of await copyLiterals()) {
      expect(`${path}: ${text.toLowerCase()}`).not.toContain('operación fallida');
    }
  });

  it('never promises offline operation (D-20)', async () => {
    const promise = /(funciona|disponible|opera)[^.]{0,20}sin conexi[oó]n/i;

    for (const { path, text } of await copyLiterals()) {
      expect({ path, match: promise.exec(text)?.[0] ?? null }).toEqual({ path, match: null });
    }
  });

  it('never promises cross-pharmacy analytics or doctor shopping detection', async () => {
    const promise = /doctor shopping|anal[ií]tica por paciente|detecci[oó]n entre farmacias/i;

    for (const { path, text } of await copyLiterals()) {
      expect({ path, match: promise.exec(text)?.[0] ?? null }).toEqual({ path, match: null });
    }
  });

  it('never claims the rules engine reads a patient history (D-25)', async () => {
    const promise = /(historial|antecedentes)[^.]{0,30}(consulta|revisa|verifica)/i;

    for (const { path, text } of await copyLiterals()) {
      expect({ path, match: promise.exec(text)?.[0] ?? null }).toEqual({ path, match: null });
    }
  });
});

describe('no navigation state reaches the URL', () => {
  // docs/17 and packages/shared/src/qr.ts: the QR payload carries the raw
  // decryption key, so a router would leak clinical content into the address
  // bar, the history and every later `Referer` header.
  it('installs no router and touches no history API', async () => {
    for (const path of await sourceFiles(SOURCE_ROOT)) {
      const source = await readFile(path, 'utf8');
      expect(`${path}: ${source}`).not.toMatch(
        /react-router|wouter|history\.pushState|useNavigate/,
      );
    }
  });
});
