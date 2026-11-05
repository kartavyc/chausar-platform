// B1 fix round 1 (quality findings 1 and 2): every refusal a transport sends says whether its words are written for the
// owner. A flagged refusal reaches the screen exactly as sent; only the few codes whose engine text is developer text
// (owner-flag.ts) travel without the flag, so the app can say them in its own words. The flag is plain data, so it
// survives JSON: the local server, the desktop worker, main and the preload, and the hosted server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { ChausarError } from '../runtime/contracts.ts';
import { ownerError, UNEXPECTED_WORDS } from '../runtime/owner-error.ts';
import { DEVELOPER_TEXT_CODES } from '../runtime/owner-flag.ts';
import { refusalError } from '../runtime/venture/refusal-brand.ts';
import { asRefusal } from '../runtime/venture/refusals.ts';
import { validateExternalServers } from '../runtime/venture/agent-runtime/external-config.ts';
import { TRIAL_ENDED_LINE } from '../runtime/hosted/trial.ts';
import { NOT_BUILT_TOOL } from '../runtime/venture/delivery/harness/tool-stub.ts';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import ipcContract from '../../app/desktop/ipc-contract.cjs';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { listInkFiles } from '../runtime/ui-ink.ts';

const { publicError } = ipcContract;

function thrown(work: () => unknown): unknown {
  try { work(); } catch (error) { return error; }
  throw new Error('expected a refusal');
}

/** The refusals the review named, each as the engine throws it. */
const NAMED: readonly [string, string][] = [
  ['CONFIRMATION_REQUIRED', 'Confirm the exact reviewed archive and separate closed copy.'],
  ['CONFIRMATION_REQUIRED', 'Confirm a new empty managed activation target.'],
  ['CONFIRMATION_REQUIRED', 'Confirm the export in the app.'],
  ['CONFIRMATION_REQUIRED', 'Type the business name to start a new never-contact list.'],
  ['CONFIRMATION_REQUIRED', 'Confirm the restore in the app.'],
  ['CONFIRMATION_REQUIRED', 'Type your email address to delete your account.'],
  ['NOT_BUILT_YET', 'This part of Chausar is not built yet.'],
  ['NOT_BUILT_YET', NOT_BUILT_TOOL],
  ['NOT_BUILT_YET', 'The model recording could not be read, so model calls are off.'],
  ['UNAUTHENTICATED', 'Your session ended. Sign in again.'],
  ['UNAUTHENTICATED', TRIAL_ENDED_LINE],
  ['VAULT_LOCKED', 'Choose one of your businesses first.'],
  ['VAULT_LOCKED', 'The temporary business did not open.'],
  ['INVALID_VENTURE_REQUEST', 'Send the digest of the consent you read.'],
  ['PRICE_REQUIRED', 'Set your price for Digest Ltd first.'],
];

test('B1 fix 1: Chausar\'s own refusals are flagged for the owner and keep their words', () => {
  for (const [code, message] of NAMED) assert.deepEqual(ownerError(new ChausarError(code, message)), { code, message, owner: true }, message);
  const external = thrown(() => validateExternalServers([{ id: 'files', name: 'Files', transport: 'http', url: 'https://user:pass@example.com/mcp' }]));
  assert.deepEqual(ownerError(external), { code: (external as ChausarError).code, message: 'Use HTTPS, or local HTTP, without credentials or query parameters.', owner: true });
  // A plain sentence in place of an engine fault is Chausar's own too.
  assert.deepEqual(ownerError(new TypeError('x is not a function')), { code: 'REQUEST_FAILED', message: UNEXPECTED_WORDS, owner: true });
});

test('B1 fix 1: a code whose engine text is developer text travels without the flag', async () => {
  for (const code of DEVELOPER_TEXT_CODES) assert.equal(ownerError(new ChausarError(code, 'Nested vault operations are not supported.')).owner, undefined, code);
  // The phone protocol's refusals say only their code: that is not words either.
  const { PhoneError } = await import('../runtime/phone/contracts.ts');
  assert.deepEqual(ownerError(new PhoneError('ACCESS_REVOKED')), { code: 'ACCESS_REVOKED', message: 'ACCESS_REVOKED' });
  assert.deepEqual(ownerError(new ChausarError('UNLOCK_FAILED', 'Unable to unlock vault. Check your credential or restore a valid backup.')),
    { code: 'UNLOCK_FAILED', message: 'Unable to unlock vault. Check your credential or restore a valid backup.' });
});

test('B1 fix 1: a branded refusal carries owner: true as plain data, through JSON and into its ChausarError', () => {
  const raw = refusalError(new Error('Give the Search Console export.'), { code: 'GSC_EXPORT_INVALID' });
  assert.equal(JSON.parse(JSON.stringify(raw)).owner, true);
  const refusal = asRefusal(raw)!;
  assert.equal((refusal as ChausarError & { owner?: unknown }).owner, true);
  assert.deepEqual(ownerError(refusal), { code: 'GSC_EXPORT_INVALID', message: 'Give the Search Console export.', owner: true });
});

class Child extends EventEmitter {
  connected = true; sent: any[] = [];
  send(value: any, callback: (error?: Error) => void) { this.sent.push(value); callback(); }
  disconnect() { this.connected = false; this.emit('disconnect'); queueMicrotask(() => this.emit('exit', 0, null)); }
  kill() { this.connected = false; queueMicrotask(() => this.emit('exit', 137, 'SIGKILL')); return true; }
}

test('B1 fix 1: over the desktop, the flag goes worker to main to the window', async () => {
  const child = new Child();
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: {}, startupTimeoutMs: 2000, shutdownTimeoutMs: 30, requestTimeoutMs: 2000, forkProcess: () => child });
  const started = harness.start(); child.emit('message', { ready: true }); await started;
  const asked = harness.request('workspace.status');
  child.emit('message', { id: child.sent[0].id, error: ownerError(new ChausarError('CONFIRMATION_REQUIRED', 'Confirm the export in the app.')) });
  const refused = await asked.then(() => null, (error: unknown) => error as Error & { code: string; owner?: unknown });
  assert.deepEqual([refused?.code, refused?.message, refused?.owner], ['CONFIRMATION_REQUIRED', 'Confirm the export in the app.', true]);
  // Main's reply to the window keeps it, and only as true.
  assert.deepEqual(publicError(refused), { code: 'CONFIRMATION_REQUIRED', message: 'Confirm the export in the app.', owner: true });
  assert.deepEqual(publicError(Object.assign(new Error('Nested vault operations are not supported.'), { code: 'REENTRANT_TRANSACTION' })), { code: 'REENTRANT_TRANSACTION', message: 'Nested vault operations are not supported.' });
  assert.equal(publicError(Object.assign(new Error('x'), { code: 'X', owner: 'yes' })).owner, undefined);
  // The preload throws it on to the page.
  const source = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  const ipc = new EventEmitter() as any; let api: any;
  ipc.invoke = async () => ({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: 'Confirm the export in the app.', owner: true } });
  vm.runInNewContext(source, { require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = value; } } }) });
  const shown = await api.request('workspace.export', {}).then(() => null, (error: any) => error);
  assert.deepEqual([shown.code, shown.message, shown.owner], ['CONFIRMATION_REQUIRED', 'Confirm the export in the app.', true]);
  ipc.invoke = async () => ({ ok: false, error: { code: 'REENTRANT_TRANSACTION', message: 'Nested vault operations are not supported.' } });
  assert.equal((await api.request('workspace.status').then(() => null, (error: any) => error)).owner, undefined);
  await harness.stop();
});

test('B1 fix 1: over the local server, a refusal and a 401 both carry the flag', async t => {
  const path = await mkdtemp(join(tmpdir(), 'chausar-owner-flag-'));
  const engine = new Engine({ directory: path, demo: true, storage: 'experimental-file' });
  const folder = join(path, 'ink'); await mkdir(folder); await writeFile(join(folder, 'index.html'), '<!doctype html><title>Chausar</title>');
  const app = createLocalServer(engine, { ink: { folder, files: await listInkFiles(folder) } }); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(path, { recursive: true, force: true }); });
  const call = (bearer: string) => fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method: 'venture.get', payload: {} }) });
  const refused = await call(token); const body = await refused.json() as { error: { code: string; message: string; owner?: unknown } };
  assert.equal(body.error.owner, true, body.error.message);
  const ended = await call('a'.repeat(64)); const endedBody = await ended.json() as { error: { code: string; owner?: unknown } };
  assert.deepEqual([ended.status, endedBody.error.code, endedBody.error.owner], [401, 'UNAUTHENTICATED', true]);
});
