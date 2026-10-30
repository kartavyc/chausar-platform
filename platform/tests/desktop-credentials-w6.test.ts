import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { processCredentialPort } from '../runtime/venture/models/credential-port.ts';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
const require = createRequire(import.meta.url);
const { createCredentialStore } = require('../../app/desktop/credential-store.cjs');
const { createCredentialRelay } = require('../../app/desktop/credential-relay.cjs');
const NAME = 'model:openai-gpt-6-luna';
function encryption() {
  const key = randomBytes(32);
  return { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString(text: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decryptString(bytes: Buffer) { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8'); } };
}
test('credential storage survives reload encrypted and binds each key to its exact workspace and preset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-credential-test-')), safeStorage = encryption(), secret = 'harmless synthetic credential';
  try {
    const store = createCredentialStore({ directory, safeStorage, platform: 'win32' });
    await store.set('workspace_a', NAME, secret);
    const files = await readdir(directory); assert.equal(files.length, 1);
    assert.equal((await readFile(join(directory, files[0]))).includes(Buffer.from(secret)), false);
    const reloaded = createCredentialStore({ directory, safeStorage, platform: 'win32' });
    assert.equal(await reloaded.get('workspace_a', NAME), secret); assert.equal(await reloaded.get('workspace_b', NAME), null);
    await reloaded.set('workspace_b', NAME, 'another harmless value');
    const other = (await readdir(directory)).find(file => file !== files[0])!;
    await copyFile(join(directory, files[0]), join(directory, other));
    await assert.rejects(reloaded.get('workspace_b', NAME), { code: 'CREDENTIAL_INVALID' });
    await reloaded.delete('workspace_a', NAME); assert.equal(await store.get('workspace_a', NAME), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('credential storage refuses plaintext Linux backends, unavailable protection and unknown key namespaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-credential-test-'));
  try {
    for (const safeStorage of [{ ...encryption(), getSelectedStorageBackend: () => 'basic_text' }, { ...encryption(), isEncryptionAvailable: () => false }]) {
      const store = createCredentialStore({ directory, safeStorage, platform: 'linux' });
      await assert.rejects(store.set('workspace_a', NAME, 'sample'), { code: 'CREDENTIAL_UNAVAILABLE' });
    }
    const store = createCredentialStore({ directory, safeStorage: encryption(), platform: 'win32' });
    for (const [scope, name] of [['../../outside', NAME], ['workspace_a', 'file:/outside'], ['workspace_a', 'model:unknown']]) await assert.rejects(store.set(scope, name, 'sample'), { code: 'CREDENTIAL_INVALID' });
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('private credential relay correlates replies, denies renderer-shaped requests and fails pending calls on disconnect', async () => {
  const channel = new EventEmitter() as any, child = new EventEmitter() as any, harness = new EventEmitter();
  channel.connected = child.connected = true;
  const relay = createCredentialRelay(harness, child), port = processCredentialPort(channel, { timeoutMs: 100 });
  channel.send = (message: unknown, callback: (error: Error | null) => void) => { relay.receive(message); callback(null); return true; };
  child.send = (message: unknown, callback: () => void) => { channel.emit('message', message); callback(); };
  let calls = 0;
  harness.on('credential', (request, answer) => { calls++; answer({ ok: true, value: request.op === 'get' ? 'synthetic value' : null }); });
  assert.equal(await port.get('workspace_a', NAME), 'synthetic value'); await port.set('workspace_a', NAME, 'synthetic value'); await port.delete('workspace_a', NAME);
  relay.receive({ id: 'renderer', kind: 'host-credential', op: 'get', workspaceId: 'workspace_a', name: NAME }); assert.equal(calls, 3);
  harness.removeAllListeners('credential'); harness.on('credential', () => {});
  const pending = port.get('workspace_a', NAME); channel.emit('disconnect'); await assert.rejects(pending, { code: 'CREDENTIAL_UNAVAILABLE' }); relay.close();
});

test('the real desktop harness routes credential IPC only to its private host listener', async () => {
  const child = new EventEmitter() as any; child.connected = true; const replies: any[] = [];
  child.send = (message: unknown, callback: () => void) => { replies.push(message); callback(); };
  child.kill = () => { child.emit('exit', 0); return true; };
  child.disconnect = () => { child.connected = false; child.emit('disconnect'); child.emit('exit', 0); };
  const harness = new EngineHarness({ workerPath: '/synthetic-worker', environment: {}, forkProcess: () => child });
  harness.on('credential', (_request: unknown, answer: (result: unknown) => void) => answer({ ok: true, value: 'harmless value' }));
  let events = 0; harness.on('venture-event', () => events++);
  const ready = harness.start(); child.emit('message', { ready: true }); await ready;
  child.emit('message', { kind: 'host-credential', callId: '12345678-1234-1234-1234-123456789abc', op: 'get', workspaceId: 'workspace_a', name: NAME });
  assert.equal(replies.at(-1)?.value, 'harmless value'); assert.equal(events, 0); await harness.stop();
});
