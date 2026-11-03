// The Ink app (app/ui, built to app/ui/dist): where its build lives and the allowlist of its built files. The local
// server (server.ts) and the hosted web server (hosted/server.ts) share both, so they never disagree on either. Ink is
// the only app: there is no switch, and a server refuses to start until the build exists (npm run build:ui).
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join } from 'node:path';
import { check } from './contracts.ts';

export const INK_ROOT = fileURLToPath(new URL('../../app/ui/dist/', import.meta.url));
/**
 * One-shot A4 (hands-on row 107): the Ink build a worker serves to a phone. The packaged desktop runs the worker from
 * app.asar.unpacked while the build stays inside app.asar, so desktop main names it (CHAUSAR_INK_ROOT, an absolute path;
 * Electron's Node mode reads inside the archive). Anything else is the build beside this file.
 */
export function inkFolderFor(environment: NodeJS.ProcessEnv): string {
  const named = environment.CHAUSAR_INK_ROOT;
  return typeof named === 'string' && isAbsolute(named) ? named : INK_ROOT;
}
/** The content types of the files the Ink build makes. */
export const INK_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
});

/** The Ink allowlist: every regular file under the dist folder with a known type, listed once when a server starts. */
export async function listInkFiles(folder = INK_ROOT): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  async function walk(at: string, prefix: string) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(at, entry.name), `${name}/`);
      else if (entry.isFile() && /^[A-Za-z0-9._/-]+\.(html|js|css|svg|woff2|txt|json|png|webmanifest)$/.test(name)) found[`/${name}`] = name;
    }
  }
  const notBuilt = 'The Ink app is not built. Run npm run build:ui, then start the server again.';
  // A missing dist folder is the usual first run, not a filesystem fault, so it gets the same plain reason.
  try { await walk(folder, ''); }
  catch (error) { check((error as NodeJS.ErrnoException).code !== 'ENOENT', 'UI_NOT_BUILT', notBuilt); throw error; }
  check(found['/index.html'], 'UI_NOT_BUILT', notBuilt);
  found['/'] = 'index.html';
  return found;
}
