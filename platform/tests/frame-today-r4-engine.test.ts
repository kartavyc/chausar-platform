import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { shell } from '../runtime/frame-today/frame.ts';
import { apply, stage, updates } from '../runtime/frame-today/updates.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import type { Context } from '../runtime/contracts.ts';
import { isFaultReport, isShellReply, isUpdatesReply, isUpdateStepReply } from '../../app/ui/src/bridge/todayx-contract.ts';

// Round 4, frame-today engine: SH-03 banners from other lanes' methods, SH-08 updates over the release lane,
// SH-11 send refusal and a fault report filtered by what the caller may see. Synthetic data only.
const owner: Context = { memberId: 'member-owner', role: 'owner', epoch: 1, channel: 'desktop' };
const absent = () => { throw Object.assign(new Error('Unknown request'), { code: 'UNKNOWN_METHOD' }); };

/** A module host whose other lanes are the given replies; any other method is absent. */
function hostWith(replies: Record<string, unknown | (() => unknown)>, options: Record<string, unknown> = {}) {
  const state: any = { workspace: { demo: false }, extensions: {}, activity: [], members: [{ id: owner.memberId, role: 'owner', epoch: 1, active: true, branches: ['*'] }] };
  const calls: [string, unknown][] = [];
  const host = {
    demo: false, directory: '/synthetic', options, services: {},
    store: { read: () => state, update: async (change: (s: any) => unknown) => change(state) },
    call: async (method: string, payload: unknown) => {
      calls.push([method, payload]);
      if (!Object.hasOwn(replies, method)) return absent();
      const reply = replies[method];
      return typeof reply === 'function' ? (reply as () => unknown)() : structuredClone(reply);
    },
  } as unknown as ModuleHost;
  return { host, state, calls };
}

test('banners come from the driving, work-books, gateway and release lanes, in the fixed order, and absent sources show nothing', async () => {
  const none = hostWith({});
  const quiet = await shell(owner, none.host);
  assert.ok(isShellReply(quiet));
  assert.deepEqual(quiet.banners, [], 'No source: no banner, never an error.');

  const all = hostWith({
    'session.status': { state: 'driving', window: { id: 'w1', title: 'Synthetic ledger window' }, steps: [] },
    'approvals.afterRestore': { sendingClosed: true, items: [{ id: 'a1' }, { id: 'a2' }], notes: [], noteKeys: [] },
    'network.online': { online: false },
    'release.status': { configured: true, version: '1.0.0', build: { updateNeeded: true, expiresAt: '2026-10-01T00:00:00.000Z' }, vaultCompatible: true },
  });
  const reply = await shell(owner, all.host);
  assert.ok(isShellReply(reply), JSON.stringify(reply));
  assert.deepEqual(reply.banners, [
    { kind: 'driving', program: 'Synthetic ledger window' },
    { kind: 'sending-closed', restoredFrom: null, unchecked: '2' },
    { kind: 'update-needed', reason: 'expired', date: '2026-10-01T00:00:00.000Z' },
    { kind: 'no-connection' },
  ]);
  // Core updates.status is not read while the release lane answers.
  assert.equal(all.calls.some(([method]) => method === 'updates.status'), false);
});

test('each banner shows only for its own condition', async () => {
  const idle = await shell(owner, hostWith({
    'session.status': { state: 'idle', window: null, steps: [] }, 'approvals.afterRestore': { sendingClosed: false, items: [] },
    'network.online': { online: true }, 'release.status': { configured: false, version: '1.0.0', vaultCompatible: true },
  }).host);
  assert.deepEqual(idle.banners, []);
  // Sending closed by actions this seat cannot see: closed, with no count and no date invented.
  const hidden = await shell(owner, hostWith({ 'approvals.afterRestore': { sendingClosed: true, items: [] } }).host);
  assert.deepEqual(hidden.banners, [{ kind: 'sending-closed', restoredFrom: null, unchecked: null }]);
  // A driving reply whose window title does not fit is not drawn.
  const odd = await shell(owner, hostWith({ 'session.status': { state: 'driving', window: { id: 'w', title: 'a\nb' } } }).host);
  assert.deepEqual(odd.banners, []);
  // A vault written by a newer build, and a withdrawn release.
  const newer = await shell(owner, hostWith({ 'release.status': { configured: true, version: '1.0.0', vaultCompatible: false, build: { updateNeeded: false } } }).host);
  assert.deepEqual(newer.banners, [{ kind: 'update-needed', reason: 'vault-newer', date: null }]);
  const withdrawn = await shell(owner, hostWith({ 'release.status': { configured: true, version: '1.0.0', vaultCompatible: true, withdrawn: true } }).host);
  assert.deepEqual(withdrawn.banners, [{ kind: 'update-needed', reason: 'withdrawn', date: null }]);
  // Release absent: the core updates.status is the fallback.
  const core = hostWith({ 'updates.status': { state: 'expired', date: '2026-09-01' } });
  assert.deepEqual((await shell(owner, core.host)).banners, [{ kind: 'update-needed', reason: 'expired', date: '2026-09-01' }]);
  // A release lane that fails is not "absent": no fallback, no banner.
  const failing = hostWith({ 'release.status': () => { throw Object.assign(new Error('x'), { code: 'RELEASE_VERSION_UNKNOWN' }); }, 'updates.status': { state: 'expired' } });
  assert.deepEqual((await shell(owner, failing.host)).banners, []);
});

test('SH-08: the updates state over release.status, and stage and apply with the release lane\'s exact payloads', async () => {
  assert.equal((await updates(owner, hostWith({}).host)).state, 'not-built');
  const status = { configured: true, version: '1.0.0', channel: 'preview', build: { updateNeeded: false, expiresAt: '2026-12-01T00:00:00.000Z' }, vaultCompatible: true, candidate: { version: '1.1.0', dataSchemaVersion: 1 } };
  const ready = hostWith({ 'release.status': status, 'release.stageUpdate': { staged: true, version: '1.1.0', installMode: 'in-place-swap' }, 'release.applyUpdate': { applied: true, version: '1.1.0', previous: '1.0.0', state: 'trial', restartRequired: true } }, { platform: 'darwin' });
  const before = await updates(owner, ready.host);
  assert.ok(isUpdatesReply(before), JSON.stringify(before));
  assert.deepEqual(before, { state: 'ready', version: '1.0.0', channel: 'preview', expiresAt: '2026-12-01T00:00:00.000Z', candidate: '1.1.0', platform: 'mac', canUpdate: true });
  const staged = await stage(owner, ready.host);
  assert.ok(isUpdateStepReply(staged)); assert.deepEqual(staged, { step: 'checked', version: '1.1.0' });
  const applied = await apply(owner, ready.host);
  assert.deepEqual(applied, { step: 'restart', version: '1.1.0' });
  assert.deepEqual(ready.calls.filter(([method]) => method.startsWith('release.') && method !== 'release.status'),
    [['release.stageUpdate', { confirmed: true }], ['release.applyUpdate', { confirmed: true }]]);
  assert.deepEqual(ready.state.extensions['frame-today'].update.version, '1.1.0');
  assert.ok(ready.state.activity.some((item: any) => item.event === 'update.applied'));
  // Before a restart the old build is still running: "restart". After one that still runs it: "rolled back".
  assert.equal((await updates(owner, ready.host)).state, 'restart');
  const rolled = hostWith({ 'release.status': { ...status, candidate: null } }, { startedAt: Date.now() + 60_000 });
  rolled.state.extensions['frame-today'] = { update: { version: '1.1.0', from: '1.0.0', at: new Date().toISOString() } };
  assert.equal((await updates(owner, rolled.host)).state, 'rolled-back');
  // The update took: the running version is the one applied.
  const took = hostWith({ 'release.status': { ...status, version: '1.1.0', candidate: null } }, { startedAt: Date.now() + 60_000 });
  took.state.extensions['frame-today'] = { update: { version: '1.1.0', from: '1.0.0', at: new Date().toISOString() } };
  assert.equal((await updates(owner, took.host)).state, 'current');
  // An older build meeting a newer vault, a build that cannot update itself, and a viewer.
  assert.equal((await updates(owner, hostWith({ 'release.status': { ...status, vaultCompatible: false } }).host)).state, 'older-than-vault');
  const manual = hostWith({ 'release.stageUpdate': { staged: true, version: '1.1.0', installMode: 'manual-native-installer-required' } });
  assert.deepEqual(await stage(owner, manual.host), { step: 'manual', version: '1.1.0' });
  const viewer = hostWith({ 'release.status': status });
  viewer.state.members.push({ id: 'member-viewer', role: 'viewer', epoch: 1, active: true, branches: ['*'] });
  assert.equal((await updates({ memberId: 'member-viewer', role: 'viewer', epoch: 1, channel: 'desktop' }, viewer.host)).canUpdate, false);
  assert.equal((await updates({ ...owner, channel: 'phone' } as Context, viewer.host)).canUpdate, false);
});

test('through the engine: the new methods, the send refusal, and a fault report filtered by what the caller may see', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-frame-r4-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic R4 Shop', passphrase: 'Frame round four synthetic passphrase', demo: true, pack: 'ecommerce', folder: 'main' });

  const shellReply = await engine.request('todayx.shell', {});
  assert.ok(isShellReply(shellReply));
  assert.deepEqual(shellReply.banners, [], 'A fresh workspace: no driving lane, nothing restored, no update needed.');
  const state = await engine.request('todayx.updates', {});
  assert.ok(isUpdatesReply(state), JSON.stringify(state));
  assert.equal(state.state, 'not-configured', 'The release lane answers; this build has no update key.');
  assert.equal(state.canUpdate, true);
  await assert.rejects(engine.request('todayx.updates.apply', {}), (error: any) => error?.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(engine.request('todayx.faultReport.send', {}), (error: any) => error?.code === 'FAULT_REPORT_SEND_UNAVAILABLE');

  // The owner's refused import leaves a reason code; a seat that did not do it does not see it in its report.
  const recipe = {
    version: 1, id: 'frame-r4-fixture-v1', system: 'fixture-csv', edition: '1', scope: { company: 'Synthetic R4 Shop', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ],
    allowedKinds: ['sale'], allowedStatuses: ['settled'], onUnmapped: 'reject',
  };
  const content = 'id,kind,date,amount,currency\nrow-1,sale,2026-09-03,10.00,INR\n';
  await assert.rejects(engine.request('sources.import', { sourceId: 'r4.csv', format: 'csv', content, recipe, expectedTotals: { rowCount: 9, amountMinor: '1000' } }));
  const ownerReport = await engine.request('todayx.faultReport', {});
  assert.ok(isFaultReport(ownerReport));
  assert.ok(ownerReport.errorCodes.includes('RECONCILIATION'), JSON.stringify(ownerReport));
  const member = await engine.request('members.add', { id: 'frame-r4-accountant', name: 'Synthetic accountant', role: 'accountant', branches: ['main'] });
  const accountant: Context = { memberId: member.id, role: 'accountant', epoch: member.epoch, channel: 'desktop' };
  const theirs = await engine.requestAs(accountant, 'todayx.faultReport', {});
  assert.ok(isFaultReport(theirs));
  assert.equal(theirs.errorCodes.includes('RECONCILIATION'), false, 'Another seat\'s refusal is not in this report.');
  assert.equal(theirs.eventKinds.includes('source.refused'), false);
  assert.equal((await engine.requestAs(accountant, 'todayx.updates', {})).canUpdate, false);
  await assert.rejects(engine.requestAs(accountant, 'todayx.updates.stage', { confirmed: true }), (error: any) => ['FORBIDDEN', 'DEMO_EXTERNAL_DISABLED'].includes(error?.code));
});
