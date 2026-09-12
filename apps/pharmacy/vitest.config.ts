import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Repository root: the `VITE_*` variables live in the root `.env`. */
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  // Mirrors packages/crypto/vitest.config.ts; the environment is jsdom because
  // this app's adapters talk to `window.ethereum`, `fetch` and, later, a camera.
  envDir: workspaceRoot,
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
