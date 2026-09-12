import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Repository root: the design tokens live outside this app's directory. */
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.DOCTOR_PORT ?? 5173),
    strictPort: true,
    fs: {
      // design/tokens.css and design/components.css are the single source of
      // truth shared with the mockups (docs/17). They must stay readable.
      allow: [workspaceRoot],
    },
    watch: {
      // Bind mounts from Windows into a Linux container do not deliver inotify
      // events reliably. Only relevant for the `apps` Compose profile.
      usePolling: process.env.VITE_USE_POLLING === 'true',
      interval: 300,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.DOCTOR_PORT ?? 5173),
  },
});
