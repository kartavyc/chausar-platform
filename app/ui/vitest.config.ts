import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('.', import.meta.url));
const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  root,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  // C4 task 41: as vite.config.ts (parts/build-info.ts).
  define: { __CHAUSAR_VERSION__: JSON.stringify(version), __CHAUSAR_BUILT_AT__: JSON.stringify(new Date().toISOString()) },
  test: {
    root,
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
});
