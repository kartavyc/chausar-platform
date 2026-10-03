// C-local validation build of the opt-in frontend library. No host activation.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const validationRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(validationRoot);
export default defineConfig({
  root: resolve(workspaceRoot, 'app/ui'),
  envDir: false,
  publicDir: false,
  cacheDir: resolve(validationRoot, '.vite'),
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: resolve(validationRoot, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(workspaceRoot, 'app/ui/src/app/main.tsx'),
      formats: ['es'],
      fileName: () => 'chausar-ui.js',
      cssFileName: 'chausar-ui',
    },
  },
});
