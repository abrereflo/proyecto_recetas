import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Corte 2 (docs/21-acceso-para-la-demo.md): the write path has to go through
 * `SignerPort`, not around it. Before this corte, `viem-chain.adapter.ts`
 * imported `injectedProvider` (and the `Eip1193Provider` type) straight from
 * `infrastructure/signer/eip1193-signer.adapter.ts`, so the concrete provider
 * reached the chain adapter without ever crossing the port. This test pins the
 * dependency direction: nothing under `infrastructure/chain` may import from
 * `infrastructure/signer` again.
 */

const CHAIN_DIR = locateChainDir();

function locateChainDir(): string {
  let directory = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(directory, 'src', 'infrastructure', 'chain');
    if (existsSync(candidate)) return candidate;
    directory = dirname(directory);
  }

  throw new Error('src/infrastructure/chain not found from the working directory');
}

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

describe('infrastructure/chain never imports infrastructure/signer', () => {
  it('keeps the write path behind SignerPort', async () => {
    const files = await sourceFiles(CHAIN_DIR);

    // A guard that scanned nothing would pass silently.
    expect(files.length).toBeGreaterThan(0);

    const importsFromSigner = /from\s+['"][^'"]*\/signer\//;

    for (const path of files) {
      const source = await readFile(path, 'utf8');
      expect({ path, importsSigner: importsFromSigner.test(source) }).toEqual({
        path,
        importsSigner: false,
      });
    }
  });
});
