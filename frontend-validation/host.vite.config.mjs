// Browser host library: production constants must be replaced at build time.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const validationRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(validationRoot);
export function hostBuildConfig(outputRoot) {
  return defineConfig({
    root: resolve(workspaceRoot, 'app/ui'),
    base: './',
    envDir: false,
    publicDir: false,
    cacheDir: resolve(outputRoot, 'cache'),
    plugins: [react()],
    // Vite library mode leaves process.env untouched unless explicitly defined.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      target: 'es2022',
      assetsDir: '',
      outDir: resolve(outputRoot, 'bundle'),
      emptyOutDir: false,
      sourcemap: true,
      lib: {
        entry: resolve(workspaceRoot, 'app/ui/src/host/bootstrap.tsx'),
        formats: ['es'],
        fileName: () => 'host.js',
        cssFileName: 'host',
      },
    },
  });
}
export default hostBuildConfig(resolve(validationRoot, 'dist/host'));
