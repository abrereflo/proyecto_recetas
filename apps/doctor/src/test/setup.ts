import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Test environment setup.
 *
 * jsdom does not implement WebCrypto's `subtle`, which @recetas/crypto requires
 * for AES-256-GCM. Node 22 does, so the Node implementation is bridged in.
 * Without this, every envelope test fails with "WebCrypto is unavailable".
 */
if (globalThis.crypto?.subtle === undefined) {
  const { webcrypto } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
});
