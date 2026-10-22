import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { listInkFiles } from '../runtime/ui-ink.ts';

async function server(t: any) {
  const path = await mkdtemp(join(tmpdir(), 'chausar-http-')); const engine = new Engine({ directory: path, demo: true, storage: 'experimental-file' });
  // A one-page stand-in for the Ink build (app/ui/dist), listed the way the entrypoint lists the real one.
  const folder = join(path, 'ink'); await mkdir(folder); await writeFile(join(folder, 'index.html'), '<!doctype html><title>Chausar</title>');
  const app = createLocalServer(engine, { ink: { folder, files: await listInkFiles(folder) } }); const connection = await app.listen();
  t.after(async () => { await app.close(); await rm(path, { recursive: true, force: true }); }); return { ...connection, engine, app };
}
test('real local HTTP application serves its app and authenticates named requests', async t => {
  const { origin, token } = await server(t);
  const page = await fetch(origin); assert.equal(page.status, 200); assert.ok((await page.text()).includes('<title>Chausar')); assert.ok(page.headers.get('content-security-policy')?.includes("script-src 'self'"));
  assert.equal((await fetch(`${origin}/api/session`)).status, 401);
  const session = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } }); assert.equal((await session.json() as any).token, token);
  const denied = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'workspace.status' }) }); assert.equal(denied.status, 401);
  const status = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method: 'workspace.status' }) }); assert.equal(status.status, 200); assert.equal((await status.json() as any).result.open, false);
});
test('loopback HTTP rejects cross-origin CSRF, arbitrary files, and unsafe JSON object keys', async t => {
  const { origin, token } = await server(t);
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const cross = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: JSON.stringify({ method: 'workspace.status' }) }); assert.equal(cross.status, 403);
  assert.equal((await fetch(`${origin}/package.json`)).status, 404);
  const unsafe = await fetch(`${origin}/api/rpc`, { method: 'POST', headers, body: '{"method":"workspace.status","payload":{"__proto__":{"leak":true}}}' }); assert.equal(unsafe.status, 400);
  assert.equal(({} as any).leak, undefined);
  assert.equal((await fetch(`${origin}/api/rpc`, { method: 'GET', headers })).status, 405);
});
test('production startup refuses to create a plaintext or silently substituted database', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-production-'));
  const engine = new Engine({ directory }); t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(engine.request('workspace.create', { name: 'Actual business', passphrase: 'long-enough-passphrase' }), (e: any) => e.code === 'DATABASE_REQUIRED');
  assert.equal(engine.vault, null);
});
