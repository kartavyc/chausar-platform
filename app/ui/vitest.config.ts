import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// D2 task 10: the logic-only tests (the fake engine and the text keys) run in threads without isolation, in a plain
// node environment; every other test runs as before, in jsdom. The files in NEEDS_DOM sit in those folders but draw or
// parse HTML, so they stay with the page tests (tests/logic-project-d2.test.ts keeps this list true).
export const LOGIC = ['tests/engine/**/*.test.{ts,tsx}', 'tests/text*.test.{ts,tsx}'];
export const NEEDS_DOM = [
  'tests/text-keys-runtime-b1.test.tsx', // renders every place to collect the keys it asks for
  'tests/engine/fake-translation-media-public.test.ts', // renders the captions sheet
  'tests/engine/storefront-widget.test.ts', // runs the widget script against DOMParser
];
const logicFiles = LOGIC.flatMap(pattern => globSync(pattern, { cwd: root })).map(file => file.replaceAll('\\', '/'))
  .filter(file => !NEEDS_DOM.includes(file)).sort();

export default defineConfig({
  root,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  test: {
    root,
    restoreMocks: true,
    projects: [
      { extends: true, test: { name: 'logic', include: logicFiles, environment: 'node', pool: 'threads', isolate: false } },
      { extends: true, test: { name: 'dom', include: ['tests/**/*.test.{ts,tsx}'], exclude: logicFiles, environment: 'jsdom', setupFiles: ['tests/setup.ts'] } },
    ],
  },
});
