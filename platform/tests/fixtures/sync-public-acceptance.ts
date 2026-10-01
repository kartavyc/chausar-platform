import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Engine } from '../../runtime/engine.ts';
import { FileSyncTransport } from '../../runtime/sync-file-transport.ts';
import type { FileSyncFaultPoint, FileSyncTransportOptions } from '../../runtime/sync-file-transport.ts';
import type { SyncTransport } from '../../runtime/sync.ts';
import { harness } from './conversation-acceptance-renderer.ts';

export const PASSWORD = 'Synthetic independent sync acceptance passphrase';
export const SOURCE = 'independent-sync-import', PRIVATE_MARKER = 'SYNTHETIC PRIVATE CUSTOMER DESCRIPTION';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export async function fixture(t: TestContext) {
  const base = resolve(tmpdir()); if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const directory = await mkdtemp(join(base, 'chausar-independent-sync-'));
  const storeDirectory = join(directory, 'picked-store'); await mkdir(storeDirectory);
  const pair = generateKeyPairSync('ed25519'); // Disposable fixture keys, no external credentials.
  let time = Date.parse('2026-10-01T12:00:00.000Z'), transport: FileSyncTransport;
  const clock = () => new Date(time), control: { fault?: (point: FileSyncFaultPoint) => void | Promise<void>; inPut: boolean; puts: any[]; leases: any[] } = { inPut: false, puts: [], leases: [] };
  const proxy: SyncTransport = {
    kind: 'local-file-sync',
    getHead: () => transport.getHead(), get: hash => transport.get(hash),
    acquireLease: async input => { const lease = await transport.acquireLease(input); control.leases.push(structuredClone(lease)); return lease; },
    put: async input => { control.puts.push(structuredClone(input)); control.inPut = true; try { return await transport.put(input); } finally { control.inPut = false; } },
  };
  const engineOptions = { directory: join(directory, 'sender'), demo: true, storage: 'experimental-file' as const,
    sync: { transport: proxy, enabled: true, mode: 'single-writer' as const, deviceId: 'independent-sender', signerId: 'independent-signer',
      signingKey: pair.privateKey, clock, leaseTtlMs: 1000 } };
  let engine = new Engine(engineOptions); const engines = [engine];
  t.after(async () => {
    for (const item of engines) await item.close();
    const child = relative(base, resolve(directory));
    assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
    assert.ok(child.startsWith('chausar-independent-sync-')); await rm(directory, { recursive: true, force: true });
  });
  const bridge = await harness({ dispatch: (method, payload) => engine.request(method, payload) });
  const request = (method: string, payload: Record<string, unknown> = {}) => bridge.exposed.request(method, payload);
  const created = await request('workspace.create', { name: 'Independent synthetic sync business', folder: 'main', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  const imported = await request('sources.import', { sourceId: SOURCE, format: 'csv',
    content: `id,kind,date,amount,currency,branch,status,description\ninvoice-a,invoice,2026-09-02,100.00,INR,main,issued,${PRIVATE_MARKER}\ninvoice-b,invoice,2026-09-03,200.00,INR,main,issued,${PRIVATE_MARKER}`,
    expectedTotals: { rowCount: 2, amountMinor: '30000' }, recipe: { version: 1, id: 'independent-sync-map', system: 'synthetic-csv', edition: '1',
      scope: { company: 'Independent synthetic sync business', branches: ['main'] }, bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status', 'description'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
      ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject' } });
  assert.equal(imported.coverage.reconciled, true);
  const calculation = await request('calculation.run', { operation: 'billed', sourceIds: [SOURCE], branch: 'main', period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(calculation.totalMinor, '30000');
  const backup = await request('workspace.backup'), envelope = JSON.parse(await readFile(backup.path, 'utf8'));
  const transportOptions: FileSyncTransportOptions = { directory: storeDirectory, workspaceId: created.workspace.id, vaultId: envelope.envelope.id, clock,
    fault: point => control.inPut ? control.fault?.(point) : undefined };
  transport = new FileSyncTransport(transportOptions);
  async function prepare() { const preview = await request('sync.preview'), approval = await request('sync.approve', { id: preview.id }); return { preview, approval, payload: { previewId: preview.id, approvalId: approval.id } }; }
  async function restart() {
    await engine.close(); transport = new FileSyncTransport(transportOptions);
    engine = new Engine(engineOptions); engines.push(engine); await request('workspace.open', { folder: 'main', passphrase: PASSWORD });
  }
  async function receiver() {
    const target = new Engine({ directory: join(directory, 'receiver'), demo: true, storage: 'experimental-file',
      sync: { transport: proxy, enabled: true, mode: 'single-writer', workspaceId: created.workspace.id, deviceId: 'independent-receiver', clock } });
    engines.push(target); const h = await harness({ dispatch: (method, payload) => target.request(method, payload) });
    const request = (method: string, payload: Record<string, unknown> = {}) => h.exposed.request(method, payload);
    await request('workspace.create', { name: 'Separate receiver authority', folder: 'main', passphrase: PASSWORD, demo: false });
    const identity = await bridge.exposed.request('sync.identity'), members = await request('members.list');
    const owner = members.find((item: any) => item.role === 'owner');
    await request('sync.trust', { signerId: identity.signerId, publicKey: identity.publicKey, memberId: owner.id, epoch: owner.epoch });
    return { engine: target, request, bridge: h };
  }
  return { directory, storeDirectory, request, bridge, calculation, imported, created, envelope, control, prepare, restart, receiver,
    get transport() { return transport; }, transportOptions, clock, setTime(value: number | string) { time = typeof value === 'number' ? value : Date.parse(value); } };
}
export type SyncFixture = Awaited<ReturnType<typeof fixture>>;
export async function readInFreshProcess(t: TestContext, f: SyncFixture, operation: string, input: unknown = {}) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile'].includes(name.toLowerCase())));
  const worker = join(root, 'platform/tests/fixtures/sync-acceptance-process.ts');
  const child = spawn(process.execPath, [worker], { env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr!.on('data', bytes => { stderr += String(bytes); });
  const exit = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exit; });
  const result = await new Promise<any>((resolveResult, reject) => {
    const deadline = setTimeout(() => reject(new Error('Owned sync fixture process timed out: ' + stderr)), 10000);
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('message', result => { clearTimeout(deadline); resolveResult(result); });
    child.send({ directory: f.storeDirectory, workspaceId: f.created.workspace.id, vaultId: f.envelope.envelope.id,
      time: f.clock().toISOString(), operation, input });
  });
  child.disconnect(); await exit; return result;
}
