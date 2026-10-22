// The hosted web server serves the Ink app (app/ui/dist) at /app/, from an allowlist built from the dist folder, under
// the hosted content policy. The sign-in page at / stays, with the app's icon. startHosted always lists the build first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostedConfig } from '../runtime/hosted/config.ts';
import { createHostedServer } from '../runtime/hosted/server.ts';
import type { HostedApp } from '../runtime/hosted/app.ts';
import { listInkFiles } from '../runtime/ui-ink.ts';

const ORIGIN = 'http://localhost:4398';
const HOST = 'localhost:4398';

async function dist() {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-hosted-ink-'));
  await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'index.html'), '<!doctype html>\n<html lang="en">\n<head>\n  <title>Ink</title>\n  <script src="./theme.js"></script>\n</head>\n<body></body>\n</html>\n');
  await writeFile(join(folder, 'theme.js'), '/* theme */');
  await writeFile(join(folder, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(folder, 'assets/index-abc.js'), 'export {};');
  await writeFile(join(folder, 'assets/font-x.woff2'), 'wOF2');
  await writeFile(join(folder, 'assets/notes.exe'), 'MZ');
  return folder;
}

/** Static pages never reach the hosted app, so a stand-in that only closes is enough. */
const standIn = { options: { directory: {} }, close: async () => {} } as unknown as HostedApp;

function get(port: number, path: string): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path, headers: { Host: HOST } }, res => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function serve(t: any, ink?: { folder: string; files: Record<string, string> }) {
  const http = createHostedServer(standIn, { origin: ORIGIN, tls: { kind: 'none' }, trustProxy: false, maxBodyBytes: 1_000_000, ...(ink ? { ink } : {}) });
  const { port } = await http.listen('127.0.0.1', 0);
  t.after(() => http.close());
  return port;
}

test('hosted has no app switch: the config carries no ui choice, whatever the old switch says', () => {
  for (const [env, args] of [[{ CHAUSAR_HOSTED: '1' }, ['--dev']], [{ CHAUSAR_HOSTED: '1', CHAUSAR_UI: 'legacy' }, ['--dev', '--ink']]] as const) {
    assert.equal(Object.hasOwn(hostedConfig(env, args), 'ui'), false);
  }
});

test('with Ink, /app/ serves the built files told they run hosted, under the hosted policy, and nothing else', async t => {
  const folder = await dist(); t.after(() => rm(folder, { recursive: true, force: true }));
  const port = await serve(t, { folder, files: await listInkFiles(folder) });
  for (const path of ['/app/', '/app/index.html']) {
    const page = await get(port, path);
    assert.equal(page.status, 200, path);
    assert.match(page.text, /<title>Ink<\/title>/);
    assert.match(page.text, /<head>\n {2}<meta name="chausar-mode" content="hosted">/, 'the page knows it runs hosted');
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
    const policy = String(page.headers['content-security-policy'] ?? '');
    assert.match(policy, /script-src 'self'; style-src 'self'/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(String(page.headers['set-cookie'] ?? ''), /chausar-browser=/, 'an html page starts the browser binding, as before');
  }
  const script = await get(port, '/app/assets/index-abc.js');
  assert.equal(script.status, 200);
  assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await get(port, '/app/theme.js')).status, 200);
  assert.equal((await get(port, '/app/assets/font-x.woff2')).headers['content-type'], 'font/woff2');
  for (const path of ['/app/app.js', '/app/launch.js', '/app/styles.css', '/app/assets/notes.exe', '/app/assets/../index.html.bak', '/theme.js', '/assets/index-abc.js']) {
    assert.equal((await get(port, path)).status, 404, path);
  }
  // The sign-in page at / is the hosted one, with the Ink build's icon.
  const landing = await get(port, '/');
  assert.equal(landing.status, 200);
  assert.match(landing.text, /hosted\.js/);
  assert.match(landing.text, /href="\.\/app\/icon\.svg"/);
  assert.equal((await get(port, '/app/icon.svg')).headers['content-type'], 'image/svg+xml');
  assert.equal((await get(port, '/assets/icon.svg')).status, 404);
  assert.equal((await get(port, '/app')).status, 308);
});

test('a hosted server made without the Ink build serves the sign-in page and no app file', async t => {
  const port = await serve(t);
  assert.equal((await get(port, '/')).status, 200);
  for (const path of ['/app/', '/app/index.html', '/app/app.js', '/app/launch.js', '/app/theme.js', '/assets/icon.svg']) assert.equal((await get(port, path)).status, 404, path);
});
