// 15 Nov 2026 (the first walk of the built Windows app): workspace.create took 5 to 12 seconds. On Windows the vault key
// is kept through Windows PowerShell (DPAPI), one process start for each call, and "Keep this plan" made two in a row:
// the check that this computer can keep a key at all (the probe), then the key itself. Opening a business that this
// computer opens did the same. The check now starts with the first screen (workspace.status with no business open),
// once, in the background, so by the time the owner keeps a plan or a business opens, only the one start that carries
// the key is left to wait for. Nothing is skipped: it is the same check, and its answer is used exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { windowsDeviceKeyStore, type RunProcess } from '../runtime/device-custody.ts';
import { replay } from './fixtures/venture/compose-unit/plans.ts';
import { noGitHub } from './fixtures/venture/compose-unit/harness.ts';

/** A stand-in for Windows PowerShell and DPAPI: each call is one "process start"; protect and unprotect hand the data back. */
function standInPowerShell(options: { fails?: () => boolean } = {}) {
  const starts: string[] = [];
  let release: (() => void) | null = null;
  let held: Promise<void> | null = null;
  const run: RunProcess = async (_file, _args, input) => {
    const [op, entropy, data] = input.split('\n');
    starts.push(`${op} ${entropy!.endsWith(':probe') ? 'probe' : 'key'}`);
    if (held) await held;
    if (options.fails?.()) return { code: 1, stdout: '', timedOut: false };
    return { code: 0, stdout: `OK:${data}`, timedOut: false };
  };
  return { run, starts, hold() { held = new Promise<void>(accept => { release = accept; }); }, release() { release?.(); held = null; } };
}

async function engineWith(t: { after(fn: () => unknown): void }, shell: ReturnType<typeof standInPowerShell>) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-key-check-'));
  const keys = windowsDeviceKeyStore(shell.run, { SystemRoot: 'C:\\Windows' }, () => true);
  const engine = new Engine({ directory, demo: false, storage: 'experimental-file', workspaceCustody: { deviceKeys: keys, autoBackups: false }, venture: { host: 'desktop', modelTransport: replay([]), githubTransport: noGitHub } });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return { engine, directory };
}
const tick = () => new Promise<void>(accept => setImmediate(accept));

test('the key-storage check starts with the first screen, once, and Keep this plan waits for one start only', async t => {
  const shell = standInPowerShell();
  const { engine } = await engineWith(t, shell);
  shell.hold();
  const status = await engine.request('workspace.status', {});
  assert.equal(status.open, false, 'the first screen is answered at once: it does not wait for the check');
  await tick();
  assert.deepEqual(shell.starts, ['protect probe'], 'the check is on its way');
  // Asked again (a reconnect, another place): no second check.
  await engine.request('workspace.status', {});
  await engine.request('workspace.list', {});
  await tick();
  assert.deepEqual(shell.starts, ['protect probe']);
  shell.release();
  await tick();

  const created = await engine.request('workspace.create', { name: 'Pottery', pack: 'services', folder: null });
  assert.equal(created.unlock, 'this-computer');
  assert.deepEqual(shell.starts, ['protect probe', 'protect key'], 'creating the business starts PowerShell once, for the key itself');
  // With a business open the first screen's question checks nothing.
  await engine.request('workspace.status', {});
  await tick();
  assert.equal(shell.starts.length, 2);
});

test('a business this computer opens: the check is already on its way when it opens, and the answer is the same', async t => {
  const shell = standInPowerShell();
  const { engine, directory } = await engineWith(t, shell);
  await engine.request('workspace.create', { name: 'Pottery', pack: 'services', folder: null });
  await engine.close();
  // The next start: a new engine on the same folder.
  const next = standInPowerShell();
  const keys = windowsDeviceKeyStore(next.run, { SystemRoot: 'C:\\Windows' }, () => true);
  const again = new Engine({ directory, demo: false, storage: 'experimental-file', workspaceCustody: { deviceKeys: keys, autoBackups: false }, venture: { host: 'desktop', modelTransport: replay([]), githubTransport: noGitHub } });
  t.after(() => again.close().catch(() => {}));
  // The stand-in hands back what it is given, so the key the first engine kept opens under the second.
  await again.request('workspace.status', {});
  const list = await again.request('workspace.list', {});
  await again.request('workspace.open', { folder: list.businesses[0].folder });
  assert.equal((await again.request('workspace.status', {})).open, true);
  assert.deepEqual([...next.starts].sort(), ['protect probe', 'unprotect key'], 'one check and one key read, as before, and the check began first');
  assert.equal(next.starts[0], 'protect probe');
});

test('a computer that cannot keep a key: the first screen still answers, and creating a business says why, as before', async t => {
  const shell = standInPowerShell({ fails: () => true });
  const { engine } = await engineWith(t, shell);
  const status = await engine.request('workspace.status', {});
  assert.equal(status.open, false);
  await tick(); await tick();
  await assert.rejects(engine.request('workspace.create', { name: 'Pottery', pack: 'services', folder: null }), { code: 'DEVICE_KEYS_UNAVAILABLE' });
  assert.deepEqual(shell.starts, ['protect probe'], 'the failed check is not started again at once, and no key was sent');
  // A passphrase still makes the business.
  const typed = await engine.request('workspace.create', { name: 'Pottery', pack: 'services', folder: null, passphrase: 'long-enough-passphrase' });
  assert.equal(typed.unlock, 'passphrase');
});
