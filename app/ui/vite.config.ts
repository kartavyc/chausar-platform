import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/** The built page carries the same strict policy the servers send: no inline script or style. Dev mode skips it
 *  because Vite's dev client injects styles at runtime; the built files never do. */
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' data:; img-src 'self' data:; media-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
function strictPolicy(): Plugin {
  return {
    name: 'chausar-strict-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

// `npm run dev:ui` runs with --mode fake: the app talks to the fake engine in src/engine/fake.ts.
// Every other mode talks to the real engine (desktop preload or /api/rpc) and the fake is left out of the build.
export default defineConfig({
  root,
  base: './',
  publicDir: 'public',
  plugins: [react(), strictPolicy()],
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
    target: 'es2022',
  },
  server: { port: 5178 },
  // Prebundle the icon set up front, so a fresh dev server does not reload the page on its first visit.
  optimizeDeps: { include: ['lucide-react'] },
});
