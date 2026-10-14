// Fake-engine preview: the real host mounted on app/ui/src/bridge/fake.ts. Never served by the app.
//   dev:    node ./node_modules/vite/bin/vite.js --config ./frontend-validation/preview.vite.config.mjs
//   build:  node ./node_modules/vite/bin/vite.js build --config ./frontend-validation/preview.vite.config.mjs
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const validationRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(validationRoot);
export const previewRoot = resolve(workspaceRoot, 'app/ui/preview');
export const previewOutDir = resolve(validationRoot, 'dist/preview');

export function previewConfig({ outDir = previewOutDir, port = 5199 } = {}) {
  const modules = resolve(workspaceRoot, 'node_modules');
  let realModules = modules;
  try { realModules = realpathSync(modules); } catch { /* no local install; Vite reports the missing packages */ }
  return defineConfig({
    root: previewRoot,
    base: './',
    envDir: false,
    publicDir: false,
    logLevel: 'warn',
    cacheDir: resolve(validationRoot, '.vite/preview'),
    plugins: [react()],
    server: { host: '127.0.0.1', port, strictPort: false, fs: { strict: true, allow: [resolve(workspaceRoot, 'app/ui'), modules, realModules] } },
    preview: { host: '127.0.0.1', port },
    build: { target: 'es2022', outDir, emptyOutDir: true, assetsDir: 'assets', sourcemap: false, reportCompressedSize: false, chunkSizeWarningLimit: 4096 },
  });
}
export default previewConfig();
