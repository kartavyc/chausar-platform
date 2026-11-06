// Counts the local modules (and their source bytes) a given entry pulls in at import time.
import { registerHooks } from 'node:module';
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const seen = new Map();
registerHooks({
  load(url, context, next) {
    if (url.startsWith('file:') && !url.includes('node_modules')) {
      try { seen.set(url, statSync(fileURLToPath(url)).size); } catch {}
    }
    return next(url, context);
  },
});
const entry = process.argv[2];
const t0 = performance.now();
await import(pathToFileURL(entry).href);
const ms = performance.now() - t0;
let bytes = 0; for (const b of seen.values()) bytes += b;
const top = [...seen].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([u, b]) => `${(b / 1024).toFixed(0)}KB ${u.replace(/.*chausar-platform\//, '')}`);
console.log(JSON.stringify({ entry, ms: Math.round(ms), localModules: seen.size, localKB: Math.round(bytes / 1024), top }, null, 1));
