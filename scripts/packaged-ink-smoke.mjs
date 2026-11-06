// Evidence only: real packaged constructors with an injected loopback network address.
// No bundle is rewritten and no renderer/host method is added for this check.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAsarFileList } from './package-contents.mjs';

/** Rolldown leaves names in this unminified bundle. Refuse missing/ambiguous constructors. */
export async function bundledFunction(runtime, name) {
  assert.match(name, /^[A-Za-z][A-Za-z0-9]*$/);
  const found = new Set();
  for (const entry of await readdir(runtime, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const file = join(runtime, entry.name);
    const source = await readFile(file, 'utf8');
    if (!new RegExp(`function ${name}\\(`).test(source)) continue;
    const module = await import(pathToFileURL(file).href);
    for (const value of Object.values(module)) if (typeof value === 'function' && value.name === name) found.add(value);
  }
  assert.equal(found.size, 1, `Expected exactly one bundled ${name} export`);
  return [...found][0];
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function packagedInkSmoke({ packaged, worker, metadata }) {
  assert.ok(process.versions.electron, 'Archive reads require the packaged Electron Node mode');
  const runtime = dirname(worker);
  const createPhoneAccess = await bundledFunction(runtime, 'createPhoneAccess');
  const { createWorkerEngine } = await import(pathToFileURL(worker).href);
  assert.equal(typeof createWorkerEngine, 'function');
  const archive = join(packaged, 'resources', 'app.asar');
  const prefix = 'app/ui/dist/';
  const paths = (await readAsarFileList(archive)).filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length)).sort();
  assert.ok(paths.includes('index.html') && paths.some(path => /^assets\/.*\.js$/.test(path)));
  const folder = join(archive, 'app', 'ui', 'dist');
  const files = Object.fromEntries(paths.map(path => ['/' + path, path]));
  files['/'] = 'index.html';
  const directory = await mkdtemp(join(tmpdir(), 'chausar-packaged-ink-'));
  let engine, access, original;
  try {
    engine = await createWorkerEngine({ ...process.env, CHAUSAR_ENGINE_VERSION: metadata.version, CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_INK_ROOT: folder, CHAUSAR_DEMO: '1', CHAUSAR_UPDATE_PUBLIC_KEY: '' });
    original = engine.options.venture.phoneAccess;
    access = createPhoneAccess(() => engine, { bind: '127.0.0.1', addresses: () => [{ via: 'wifi', address: '127.0.0.1' }], ink: { folder, files } });
    // Before the first workspace/venture request, while the host is still unloaded.
    engine.options.venture.phoneAccess = access;
    engine.options.venture.modelTransport = { replay: false, http: async () => { throw new Error('No model network in packaged smoke'); }, process: async () => { throw new Error('No model process in packaged smoke'); } };
    await engine.request('workspace.create', { name: 'Synthetic package sample', passphrase: 'synthetic-package-passphrase', pack: 'services' });
    await engine.request('venture.create', { idea: 'Monthly bookkeeping for synthetic cafes.', countryCode: 'IN', workingName: 'Synthetic package sample' });
    assert.equal(access.status().on, false);
    const made = await engine.request('venture.phone.access', { action: 'link', via: 'wifi', hours: 1 });
    const link = new URL(made.link);
    assert.equal(link.hostname, '127.0.0.1');
    assert.equal(link.protocol, 'http:');
    const pair = await fetch(link.origin + '/api/phone/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: new URLSearchParams(link.hash.slice(1)).get('pair') }) });
    assert.equal(pair.status, 200);
    const session = await pair.json();
    assert.equal(typeof session.token, 'string');
    const status = await fetch(link.origin + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.token }, body: JSON.stringify({ method: 'workspace.status', payload: {} }) });
    assert.equal(status.status, 200);
    assert.equal(access.status().phones, 1);
    const fetched = [];
    for (const path of paths) {
      const response = await fetch(link.origin + '/' + path);
      assert.equal(response.status, 200, path);
      const bytes = Buffer.from(await response.arrayBuffer());
      const archived = await readFile(join(folder, ...path.split('/')));
      assert.equal(digest(bytes), digest(archived), path);
      if (path.endsWith('.js')) assert.match(response.headers.get('content-type'), /^text\/javascript/);
      if (path.endsWith('.css')) assert.match(response.headers.get('content-type'), /^text\/css/);
      fetched.push({ path, bytes: bytes.length, sha256: digest(bytes) });
    }
    await engine.request('venture.phone.access', { action: 'stop' });
    assert.equal(access.status().on, false);
    await assert.rejects(fetch(link.origin + '/api/health'));
    return { mode: 'packaged constructors with injected loopback address', approvedPairing: true, files: fetched, closed: true };
  } finally {
    await access?.close();
    await original?.close?.();
    await engine?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
