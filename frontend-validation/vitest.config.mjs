// Isolated React behavior checks. This config does not activate the application host.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  envDir: false,
  publicDir: false,
  cacheDir: fileURLToPath(new URL('./.vite/vitest', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['frontend-validation/tests/*.test.tsx'],
    globals: false,
    watch: false,
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    maxWorkers: 1,
    environmentOptions: { jsdom: { url: 'https://frontend-fixture.invalid/' } },
  },
});
