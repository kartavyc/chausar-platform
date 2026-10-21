// The Ink app (app/ui, built to app/ui/dist): the switch that turns it on and the allowlist of its built files. The
// local server (server.ts) and the hosted web server (hosted/server.ts) share both, so they never disagree on either.
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { check } from './contracts.ts';

export const INK_ROOT = fileURLToPath(new URL('../../app/ui/dist/', import.meta.url));
/** The content types of the files the Ink build makes. */
export const INK_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
});

/** Ink replaces the old renderer only with --ink or CHAUSAR_UI=ink. */
export const inkRequested = (args: readonly string[] = process.argv, environment: NodeJS.ProcessEnv = process.env) => args.includes('--ink') || environment.CHAUSAR_UI === 'ink';

/** The Ink allowlist: every regular file under the dist folder with a known type, listed once when a server starts. */
export async function listInkFiles(folder = INK_ROOT): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  async function walk(at: string, prefix: string) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(at, entry.name), `${name}/`);
      else if (entry.isFile() && /^[A-Za-z0-9._/-]+\.(html|js|css|svg|woff2|txt|json)$/.test(name)) found[`/${name}`] = name;
    }
  }
  await walk(folder, '');
  check(found['/index.html'], 'UI_NOT_BUILT', 'The Ink app is not built. Run npm run build:ui, then start the server again.');
  found['/'] = 'index.html';
  return found;
}
