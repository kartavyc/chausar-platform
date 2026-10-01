import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import type { ForkOptions, SpawnOptions } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../runtime/engine.ts';

const password = 'fixture-worker-passphrase-2026';
const september = { from: '2026-09-01', to: '2026-09-30' };
async function childEngine(directory: string) {
  const options: ForkOptions & Pick<SpawnOptions, 'windowsHide'> = {
    execPath: process.execPath, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '1' },
  };
  const child = fork(fileURLToPath(new URL('../runtime/worker.ts', import.meta.url)), [], options);
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let sequence = 0;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker readiness deadline')), 15000);
    child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Worker stopped: ${code}`)); });
    child.on('message', (message: any) => {
      if (message.ready) { clearTimeout(timer); resolve(); return; }
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(Object.assign(new Error(message.error.message), { code: message.error.code })); else item.resolve(message.result);
    });
  });
  await ready;
  return {
    request(method: string, payload: any = {}) {
      return new Promise<any>((resolve, reject) => {
        const id = String(++sequence); const timer = setTimeout(() => { pending.delete(id); reject(new Error('Worker RPC deadline')); }, 15000);
        pending.set(id, { resolve, reject, timer }); child.send({ id, method, payload });
      });
    },
    close() { return new Promise<void>(resolve => { child.once('exit', () => resolve()); child.disconnect(); }); },
  };
}

test('separate engine process persists encrypted work and returns independently expected receipts after restart', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ipc-')); let worker: Awaited<ReturnType<typeof childEngine>> | undefined;
  try {
    worker = await childEngine(directory);
    const created = await worker.request('workspace.create', { name: 'Synthetic worker business', passphrase: password, demo: true });
    assert.ok(created.recoveryCode); assert.equal(created.experimental, true);
    const receipt = await worker.request('calculation.run', { operation: 'net_sales', period: september });
    assert.equal(receipt.totalMinor, '240000'); assert.ok(receipt.rowIds.length > 0);
    await worker.close(); worker = undefined;
    worker = await childEngine(directory);
    await assert.rejects(worker.request('workspace.open', { passphrase: 'wrong-fixture-passphrase' }));
    await worker.request('workspace.open', { passphrase: password });
    assert.equal((await worker.request('calculation.run', { operation: 'net_sales', period: september })).totalMinor, '240000');
    assert.equal((await worker.request('receipts.get', { id: receipt.id })).totalMinor, '240000');
  } finally { if (worker) await worker.close(); await rm(directory, { recursive: true, force: true }); }
});

test('public source coverage is candid and installed job runner requires its exact type', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-integration-')); const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  try {
    await engine.request('workspace.create', { name: 'Synthetic integration business', passphrase: password, demo: true });
    const sources = await engine.request('sources.catalogue');
    assert.equal(sources.length, 50); assert.ok(sources.every((item: any) => item.liveVerified === false));
    await assert.rejects(engine.request('sources.workbook', { bytesBase64: 'not a workbook' }));
    const job = { goal: 'Daily owner financial brief', budgetMinor: '100', stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 86400000).toISOString() } };
    await assert.rejects(engine.request('jobs.create', job), { code: 'JOB_TYPE_UNSUPPORTED' });
    const created = await engine.request('jobs.create', { ...job, type: 'owner-brief' });
    assert.equal(created.type, 'owner-brief');
    assert.equal((await engine.request('jobs.run', { id: created.id })).status, 'approval-blocked');
    await engine.request('trust.update', { autonomy: true });
    const delivered = await engine.request('jobs.run', { id: created.id });
    assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.spentMinor, '0'); assert.equal(delivered.deliverable.kind, 'brief');
  } finally { await engine.close(); await rm(directory, { recursive: true, force: true }); }
});

test('concurrent workspace transitions refuse instead of replacing another vault or losing its recovery kit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-transition-')); const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  try {
    const first = engine.request('workspace.create', { name: 'First synthetic workspace', passphrase: password, folder: 'first' });
    await assert.rejects(engine.request('workspace.create', { name: 'Second synthetic workspace', passphrase: password, folder: 'second' }), { code: 'VAULT_BUSY' });
    await assert.rejects(engine.request('dashboard.get'), { code: 'VAULT_BUSY' });
    const created = await first; assert.ok(created.recoveryCode);
    assert.equal((await engine.request('workspace.status')).workspace.name, 'First synthetic workspace');
    await engine.request('workspace.lock'); await engine.request('workspace.open', { folder: 'first', passphrase: password });
    assert.equal((await engine.request('workspace.status')).workspace.name, 'First synthetic workspace');
  } finally { await engine.close(); await rm(directory, { recursive: true, force: true }); }
});

test('scoped cofounders cannot export, back up or delete the complete private workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-copy-scope-')); const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  try {
    await engine.request('workspace.create', { name: 'Private synthetic business', passphrase: password, demo: true });
    const member = await engine.request('members.add', { name: 'Main branch cofounder', role: 'cofounder', branches: ['main'] });
    const ctx = { memberId: member.id, role: member.role, epoch: member.epoch };
    await assert.rejects(engine.requestAs(ctx, 'workspace.backup'), { code: 'FORBIDDEN' });
    await assert.rejects(engine.requestAs(ctx, 'workspace.export', { confirmed: true, plaintext: true }), { code: 'FORBIDDEN' });
    await assert.rejects(engine.requestAs(ctx, 'workspace.delete', { confirmation: 'Private synthetic business' }), { code: 'FORBIDDEN' });
    assert.equal((await engine.request('workspace.status')).open, true);
  } finally { await engine.close(); await rm(directory, { recursive: true, force: true }); }
});

test('managed backup deletion affects the current workspace and preserves another workspace backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-copy-isolation-')); const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  try {
    await engine.request('workspace.create', { name: 'Synthetic first business', folder: 'first', passphrase: password, demo: true });
    const first = await engine.request('workspace.backup'); await engine.request('workspace.lock');
    await engine.request('workspace.create', { name: 'Synthetic second business', folder: 'second', passphrase: password, demo: true });
    const second = await engine.request('workspace.backup');
    await engine.request('sources.delete', { id: 'demo-export' });
    await assert.rejects(access(second.path)); await access(first.path);
    await engine.request('workspace.delete', { confirmation: 'Synthetic second business' }); await access(first.path);
  } finally { await engine.close(); await rm(directory, { recursive: true, force: true }); }
});

test('shutdown drains an active workspace transaction and refuses new work before releasing authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-drain-')); const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  try {
    const creation = engine.request('workspace.create', { name: 'Synthetic draining business', passphrase: password });
    const draining = engine.shutdown();
    await assert.rejects(engine.request('workspace.status'), { code: 'ENGINE_STOPPING' });
    assert.ok((await creation).recoveryCode); await draining; assert.equal(engine.vault, null);
  } finally { await engine.close(); await rm(directory, { recursive: true, force: true }); }
});
