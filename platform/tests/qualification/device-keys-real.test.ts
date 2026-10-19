// Qualification run: this computer's real key store keeps a business's vault key (KEYCHAIN-SPEC 13.1). The open suite
// checks every key store with fake processes (device-custody.test.ts) and the custody journeys with an in-memory store
// (workspace-custody.test.ts), so CI never asks an operating system for a key. This file does, and it lives in a
// subfolder so the open benchmark (platform/tests/*.test.ts) never picks it up. It qualifies Windows DPAPI only:
//   - DPAPI itself: a round trip, a record for one vault that won't open as another, a blob with one flipped byte
//     refused, and the probe run once for the store;
//   - an Engine with deviceKeys 'os' that makes a business with no passphrase, shuts down, and a second Engine on the
//     same folder that opens it with no passphrase;
//   - the real local server (node platform/runtime/server.ts --demo) doing the same across a stop and a start.
// It writes only to temp folders, and DPAPI blobs live only in those folders. Run it on a Windows login with:
//   node --test platform/tests/qualification/device-keys-real.test.ts
// On any other platform it fails with one test that says so. It never skips, so a qualification run can't pass by
// accident. The macOS keychain and the Linux Secret Service are written and tested with fake processes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../../runtime/engine.ts';
import { execFileRun, osDeviceKeyStore, type RunProcess } from '../../runtime/device-custody.ts';
import { CUSTODY_WORDS } from '../../runtime/workspace-custody-contracts.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };
const leaks = (text: string, value: Buffer) => text.includes(value.toString('base64')) || text.includes(value.toString('base64url')) || text.includes(value.toString('hex'));

async function folder(t: any, prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function engineAt(t: any, directory: string) {
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', workspaceCustody: { deviceKeys: 'os', autoBackups: true } });
  t.after(() => engine.close().catch(() => {}));
  const ask = (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload);
  return { engine, ask };
}
const backupsOf = async (directory: string) => (await readdir(join(directory, 'backups')).catch(() => [] as string[])).sort();

/** Starts the real local server (node platform/runtime/server.ts --demo) on a free port and returns its RPC. */
async function startServer(t: any, directory: string) {
  const server = fileURLToPath(new URL('../../runtime/server.ts', import.meta.url));
  const child = spawn(process.execPath, [server, '--demo'], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, CHAUSAR_PORT: '0', CHAUSAR_VAULT_DIRECTORY: directory } });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const link = await new Promise<string>((accept, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('The server did not print its pairing link.')), 30_000);
    child.stdout!.on('data', chunk => { output += chunk; const match = /(http:\/\/127\.0\.0\.1:\d+)\/#token=([a-f0-9]+)/.exec(output); if (match) { clearTimeout(timer); accept(`${match[1]} ${match[2]}`); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('The server exited before it was ready.')); });
  });
  const [origin, token] = link.split(' ');
  const rpc = async (method: string, payload: Record<string, unknown> = {}) => {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as any;
    if (body.error) throw Object.assign(new Error(body.error.message), body.error);
    return body.result;
  };
  const stop = async () => { const exited = new Promise(accept => child.once('exit', accept)); child.kill(); await exited; };
  return { rpc, stop };
}

if (process.platform !== 'win32') {
  test('this qualification run needs a Windows login with DPAPI', () => {
    assert.fail(`This computer runs ${process.platform}, so it has no Windows DPAPI. Run `
      + 'node --test platform/tests/qualification/device-keys-real.test.ts on a Windows login. Nothing was checked against a real key store.');
  });
} else {
  test('Windows DPAPI for real on this computer: a round trip, one vault cannot open another, a flipped byte fails', async () => {
    let runs = 0;
    const counted: RunProcess = (...args) => { runs++; return execFileRun(...args); };
    const store = osDeviceKeyStore('win32', counted);
    assert.equal(store.scheme, 'windows-dpapi');
    const started = Date.now();
    assert.deepEqual(await store.probe(), { available: true });
    const probeMs = Date.now() - started;
    assert.deepEqual(await store.probe(), { available: true });
    assert.equal(runs, 1, 'the probe ran once for this store');
    const value = randomBytes(32);
    const protectStart = Date.now();
    const record = await store.protect('dpapi-test-vault-a', value);
    const protectMs = Date.now() - protectStart;
    assert.ok(!leaks(JSON.stringify(record), value));
    const unprotectStart = Date.now();
    assert.ok((await store.unprotect(record))!.equals(value));
    const unprotectMs = Date.now() - unprotectStart;
    await assert.rejects(store.unprotect({ ...record, vaultId: 'dpapi-test-vault-b' }), code('DEVICE_KEY_FAILED'));
    const blob = Buffer.from(record.blob!, 'base64'); blob[blob.length - 5] ^= 0x01;
    await assert.rejects(store.unprotect({ ...record, blob: blob.toString('base64') }), code('DEVICE_KEY_FAILED'));
    console.log(`real DPAPI on this computer: probe ${probeMs} ms, protect ${protectMs} ms, unprotect ${unprotectMs} ms, blob ${Buffer.from(record.blob!, 'base64').length} bytes`);
  });

  test('Windows for real: a business made with no passphrase opens again in a new engine on the same folder', async t => {
    const directory = await folder(t, 'chausar-dpapi-engine-');
    const first = engineAt(t, directory);
    const view = await first.ask('workspace.custody.get');
    assert.deepEqual([view.computer.available, view.computer.scheme, view.computer.checked, view.computer.where], [true, 'windows-dpapi', true, CUSTODY_WORDS.where['windows-dpapi']]);
    const created = await first.ask('workspace.create', { name: 'Real Windows Shop', pack: 'services', folder: null });
    assert.equal(created.unlock, 'this-computer');
    await first.ask('trust.update', { retentionDays: 45 });
    await first.engine.shutdown(5000);
    const record = JSON.parse(await readFile(join(directory, 'custody', 'keys', `${JSON.parse(await readFile(join(directory, 'custody', 'cards', 'real-windows-shop.json'), 'utf8')).vaultId}.json`), 'utf8'));
    assert.equal(record.scheme, 'windows-dpapi'); assert.equal(typeof record.blob, 'string');
    const second = engineAt(t, directory);
    assert.equal((await second.ask('workspace.list')).businesses[0].opens, 'with-this-computer');
    await second.ask('workspace.open', { folder: 'real-windows-shop' });
    assert.equal((await second.ask('trust.get')).retentionDays, 45);
    assert.ok((await backupsOf(directory)).some(name => name.endsWith('-auto.backup')), 'shutting down after a change wrote an automatic backup');
  });

  test('Windows for real: the local server makes a business with no passphrase, is stopped, starts again and opens it with no typing', { timeout: 120_000 }, async t => {
    const directory = await folder(t, 'chausar-dpapi-server-');
    const first = await startServer(t, directory);
    const custody = await first.rpc('workspace.custody.get');
    assert.deepEqual([custody.computer.available, custody.computer.scheme, custody.computer.checked], [true, 'windows-dpapi', true]);
    const created = await first.rpc('workspace.create', { name: 'Restart Test Shop', pack: 'services', folder: null });
    assert.deepEqual([created.unlock, created.recoveryCode, created.folder], ['this-computer', null, 'restart-test-shop']);
    await first.rpc('trust.update', { retentionDays: 33 });
    await first.stop();
    const second = await startServer(t, directory);
    assert.equal((await second.rpc('workspace.status')).open, false);
    const list = await second.rpc('workspace.list');
    assert.deepEqual(list.businesses.map((row: any) => [row.folder, row.name, row.opens]), [['restart-test-shop', 'Restart Test Shop', 'with-this-computer']]);
    await second.rpc('workspace.open', { folder: 'restart-test-shop' });
    assert.equal((await second.rpc('trust.get')).retentionDays, 33);
    await assert.rejects(second.rpc('workspace.open', { folder: 'restart-test-shop' }), code('VAULT_OPEN'));
    await second.stop();
  });
}
