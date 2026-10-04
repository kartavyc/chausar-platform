// Isolated React behavior checks for the first-run slice. Same shape as
// frontend-validation/vitest.config.mjs; this config activates no host and mounts no app.
// Run with `--configLoader native` so Vite loads this file directly instead of bundling it
// into node_modules/.vite-temp, which is read only in the frozen checkout.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  envDir: false,
  publicDir: false,
  cacheDir: fileURLToPath(new URL('./.vite/vitest', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['app/ui/tests/first-run/*.test.tsx'],
    globals: false,
    watch: false,
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60000,
    environmentOptions: { jsdom: { url: 'https://frontend-fixture.invalid/' } },
  },
});
