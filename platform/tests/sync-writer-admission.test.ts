import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { FileSyncWriterAdmission, writerStateDigest } from '../runtime/sync-writer-admission.ts';
import type { SyncWriterReview } from '../runtime/sync-writer-admission.ts';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State } from '../runtime/contracts.ts';
import { Vault } from '../runtime/vault.ts';
import { FileSyncTransport } from '../runtime/sync-file-transport.ts';

const start = '2026-10-01T12:00:00.000Z';
const context: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => error.code === expected;
async function fixture(t: TestContext) {
  const root = resolve(tmpdir());
  if (process.platform === 'win32') assert.match(root, /^C:\\/i, 'Writer fixtures use only C-drive temporary files.');
  const directory = await mkdtemp(join(root, 'chausar-sync-writer-'));
  t.after(async () => { assert.ok(relative(root, directory).startsWith('chausar-sync-writer-')); await rm(directory, { recursive: true, force: true }); });
  const state = initialState('Authored synthetic writer fixture', true); state.workspace.id = 'workspace';
  let time = new Date(start);
  const options = { directory, workspaceId: 'workspace', vaultId: 'vault', deviceId: 'device-a', clock: () => time };
  const admission = new FileSyncWriterAdmission(options);
  const input = { state, vaultId: 'vault' };
  const review = (changes: Partial<SyncWriterReview> = {}): SyncWriterReview => ({ expectedFence: 0, expectedStateDigest: writerStateDigest(state), deviceId: 'device-a', memberId: 'owner', epoch: 1, expiresAt: new Date(time.getTime() + 60000).toISOString(), reason: 'Owner reviewed this exact synthetic state and local device.', ...changes });
  const advance = (ms: number) => { time = new Date(time.getTime() + ms); };
  return { directory, options, admission, input, state, review, advance, setTime: (value: string) => { time = new Date(value); } };
}
const authorityPath = (directory: string) => join(directory, 'writer-authority.json');

test('unreviewed status is readonly, zero-fenced and has no implicit admission', async t => {
  const { admission, input, directory } = await fixture(t);
  const status = await admission.status(input);
  assert.deepEqual(status, { readonly: true, reason: 'SYNC_WRITER_REVIEW_REQUIRED', fence: 0, stateDigest: writerStateDigest(input.state), localStateDigest: writerStateDigest(input.state), grant: null, qualification: 'local-cooperative-process-only' });
  let called = false;
  await assert.rejects(admission.run(input, async () => { called = true; return { result: 'no', committedState: input.state }; }), code('SYNC_WRITER_REVIEW_REQUIRED'));
  assert.equal(called, false); assert.deepEqual(await readdir(directory), []);
});

test('explicit owner review creates a durable grant and successful writes advance only its digest', async t => {
  const { admission, input, directory, options, review, advance } = await fixture(t);
  const admitted = await admission.review(context, input.state, input.vaultId, review());
  assert.equal(admitted.readonly, false); assert.equal(admitted.fence, 1);
  advance(1000);
  const next = structuredClone(input.state); next.workspace.name = 'Committed synthetic name'; next.revision++;
  assert.equal(await admission.run(input, async assertCurrent => { assertCurrent(); return { result: 17, committedState: next }; }), 17);
  const restarted = new FileSyncWriterAdmission(options), current = await restarted.status({ ...input, state: next });
  assert.equal(current.readonly, false); assert.equal(current.fence, admitted.fence); assert.equal(current.stateDigest, writerStateDigest(next));
  assert.deepEqual(current.grant, admitted.grant);
  assert.equal((JSON.parse(await readFile(authorityPath(directory), 'utf8'))).clockFloorMs, Date.parse(start) + 1000);
});

test('state digest ignores only revision and sync receipts/activity, retaining business and authority', () => {
  const state = initialState('Synthetic digest');
  const initial = writerStateDigest(state), excluded = structuredClone(state);
  excluded.revision = 999; excluded.modelReceipts.push({ kind: 'sync-preview', payloadBase64: 'excluded synthetic bookkeeping' }); excluded.activity.push({ event: 'sync.push.completed' });
  assert.equal(writerStateDigest(excluded), initial);
  const changes: ((state: State) => void)[] = [
    s => { s.workspace.name = 'Different'; }, s => { s.members[0].epoch++; }, s => { s.policy.allowedSources = []; },
    s => { s.sourceRules.push({ sourceId: 's', revoked: true }); }, s => { s.tombstones.push({ sourceId: 's' }); },
    s => { s.facts.push({ id: 'f', entityId: 'e', sourceId: 's', sourceRow: 1, kind: 'invoice', validFrom: start, validTo: null, learnedAt: start, supersededAt: null, fields: { syntheticMinor: '100' } }); },
    s => { s.modelReceipts.push({ kind: 'model-result', synthetic: true }); }, s => { s.activity.push({ event: 'import.completed' }); },
    s => { s.jobs.push({ id: 'j' }); }, s => { s.decisions.push({ id: 'd' }); },
  ];
  for (const change of changes) { const candidate = structuredClone(state); change(candidate); assert.notEqual(writerStateDigest(candidate), initial); }
});

test('stale fence and stale digest review refuse without changing durable authority', async t => {
  const { admission, input, directory, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const before = await readFile(authorityPath(directory), 'utf8');
  await assert.rejects(admission.review(context, input.state, input.vaultId, review()), code('SYNC_WRITER_CAS_CONFLICT'));
  await assert.rejects(admission.review(context, input.state, input.vaultId, review({ expectedFence: 1, expectedStateDigest: '0'.repeat(64) })), code('SYNC_WRITER_STATE_CONFLICT'));
  assert.equal(await readFile(authorityPath(directory), 'utf8'), before);
});

test('divergent local state is preserved and cannot be admitted by a fresh review', async t => {
  const { admission, input, review, directory } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const divergent = structuredClone(input.state); divergent.workspace.name = 'Divergent synthetic copy';
  const before = await readFile(authorityPath(directory), 'utf8');
  const status = await admission.status({ ...input, state: divergent });
  assert.equal(status.reason, 'SYNC_WRITER_STATE_CONFLICT'); assert.equal(status.localStateDigest, writerStateDigest(divergent)); assert.notEqual(status.localStateDigest, status.stateDigest);
  await assert.rejects(admission.review(context, divergent, input.vaultId, review({ expectedFence: 1, expectedStateDigest: writerStateDigest(divergent) })), code('SYNC_WRITER_STATE_CONFLICT'));
  let called = false;
  await assert.rejects(admission.run({ ...input, state: divergent }, async () => { called = true; return { result: undefined, committedState: divergent }; }), code('SYNC_WRITER_STATE_CONFLICT'));
  assert.equal(called, false); assert.equal(await readFile(authorityPath(directory), 'utf8'), before); assert.equal(divergent.workspace.name, 'Divergent synthetic copy');
});

test('explicit handover rotates the independent fence and the former device refuses', async t => {
  const { admission, input, options, review } = await fixture(t);
  await admission.review(context, input.state, input.vaultId, review());
  const handover = await admission.review(context, input.state, input.vaultId, review({ expectedFence: 1, deviceId: 'device-b' }));
  assert.equal(handover.fence, 2); assert.equal(handover.reason, 'SYNC_WRITER_DEVICE_MISMATCH');
  await assert.rejects(admission.run(input, async () => ({ result: undefined, committedState: input.state })), code('SYNC_WRITER_DEVICE_MISMATCH'));
  const next = new FileSyncWriterAdmission({ ...options, deviceId: 'device-b' });
  assert.equal((await next.status(input)).readonly, false);
  assert.equal(await next.run(input, async checkCurrent => { checkCurrent(); return { result: 'new writer', committedState: input.state }; }), 'new writer');
  assert.equal((await next.status(input)).fence, 2);
});

test('expiry refuses writes and records time before a restarted clock can resurrect the grant', async t => {
  const { admission, input, options, review, advance, setTime } = await fixture(t);
  await admission.review(context, input.state, input.vaultId, review()); advance(60000);
  assert.equal((await admission.status(input)).reason, 'SYNC_WRITER_EXPIRED');
  await assert.rejects(admission.run(input, async () => ({ result: undefined, committedState: input.state })), code('SYNC_WRITER_EXPIRED'));
  setTime(start);
  await assert.rejects(new FileSyncWriterAdmission(options).status(input), code('SYNC_CLOCK_REGRESSED'));
  await assert.rejects(new FileSyncWriterAdmission(options).review(context, input.state, input.vaultId, review({ expectedFence: 1 })), code('SYNC_CLOCK_REGRESSED'));
});

test('expiry during asynchronous work is checked before the caller authority commit', async t => {
  const { admission, input, options, review, advance, setTime } = await fixture(t);
  await admission.review(context, input.state, input.vaultId, review()); let committed = false;
  await assert.rejects(admission.run(input, async assertCurrent => {
    await Promise.resolve(); advance(60001); assertCurrent(); committed = true;
    return { result: undefined, committedState: input.state };
  }), code('SYNC_WRITER_EXPIRED'));
  assert.equal(committed, false); setTime(start);
  await assert.rejects(new FileSyncWriterAdmission(options).status(input), code('SYNC_CLOCK_REGRESSED'));
});

test('clock rollback inside work refuses and retains the last observed durable floor', async t => {
  const { admission, input, options, review, advance, setTime, directory } = await fixture(t);
  await admission.review(context, input.state, input.vaultId, review());
  await assert.rejects(admission.run(input, async assertCurrent => { advance(1000); assertCurrent(); setTime(start); assertCurrent(); return { result: undefined, committedState: input.state }; }), code('SYNC_CLOCK_REGRESSED'));
  assert.equal(JSON.parse(await readFile(authorityPath(directory), 'utf8')).clockFloorMs, Date.parse(start) + 1000);
  await assert.rejects(new FileSyncWriterAdmission(options).status(input), code('SYNC_CLOCK_REGRESSED'));
});

test('failed work preserves its prior state digest and does not renew expiry or rotate the fence', async t => {
  const { admission, input, review, advance } = await fixture(t); const before = await admission.review(context, input.state, input.vaultId, review());
  advance(100);
  await assert.rejects(admission.run(input, async () => { throw new Error('Authored failure before synthetic commit'); }), /Authored failure/);
  const after = await admission.status(input); assert.equal(after.stateDigest, before.stateDigest); assert.equal(after.fence, before.fence); assert.deepEqual(after.grant, before.grant);
});

test('lost acknowledgment after a caller commit leaves a digest conflict with no automatic retry', async t => {
  const { admission, input, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const committed = structuredClone(input.state); committed.decisions.push({ id: 'authored-synthetic-decision' }); committed.revision++;
  let dispatches = 0;
  await assert.rejects(admission.run(input, async assertCurrent => { assertCurrent(); dispatches++; throw new Error('Caller committed but lost its synthetic acknowledgment'); }), /lost its synthetic acknowledgment/);
  assert.equal((await admission.status({ ...input, state: committed })).reason, 'SYNC_WRITER_STATE_CONFLICT');
  await assert.rejects(admission.run({ ...input, state: committed }, async () => { dispatches++; return { result: undefined, committedState: committed }; }), code('SYNC_WRITER_STATE_CONFLICT'));
  assert.equal(dispatches, 1);
});

test('assertCurrent is transaction-bound and cannot be retained as later writer authority', async t => {
  const { admission, input, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  let retained: (() => void) | undefined;
  await admission.run(input, async assertCurrent => { retained = assertCurrent; return { result: undefined, committedState: input.state }; });
  assert.throws(() => retained!(), code('SYNC_WRITER_REVIEW_REQUIRED'));
});

test('run rejects a changed workspace, backward revision and mutated borrowed state', async t => {
  const { admission, input, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const other = structuredClone(input.state); other.workspace.id = 'other';
  await assert.rejects(admission.run(input, async () => ({ result: undefined, committedState: other })), code('SYNC_WORKSPACE_MISMATCH'));
  const current = structuredClone(input.state); current.revision = 2;
  // Revision itself is bookkeeping, but a write must not rewind it.
  await assert.rejects(admission.run({ ...input, state: current }, async () => ({ result: undefined, committedState: input.state })), code('SYNC_WRITER_STATE_CONFLICT'));
  await assert.rejects(admission.run(input, async assertCurrent => { input.state.workspace.name = 'Mutated borrowed authority'; assertCurrent(); return { result: undefined, committedState: input.state }; }), code('SYNC_WRITER_STATE_CONFLICT'));
});

test('admitted member epoch and admin scope remain current after each successful write', async t => {
  const { admission, input, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const changed = structuredClone(input.state); changed.members[0].epoch++; changed.revision++;
  await admission.run(input, async assertCurrent => { assertCurrent(); return { result: undefined, committedState: changed }; });
  assert.equal((await admission.status({ ...input, state: changed })).reason, 'SYNC_WRITER_REVOKED');
  await assert.rejects(admission.run({ ...input, state: changed }, async () => ({ result: undefined, committedState: changed })), code('SYNC_WRITER_REVOKED'));
  await assert.rejects(admission.review(context, changed, input.vaultId, review({ expectedFence: 1, expectedStateDigest: writerStateDigest(changed) })), code('ACCESS_REVOKED'));
});

test('current member can explicitly re-review a newly admitted epoch without resetting its fence', async t => {
  const { admission, input, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const changed = structuredClone(input.state); changed.members[0].epoch++; changed.revision++;
  await admission.run(input, async () => ({ result: undefined, committedState: changed }));
  const reviewed = await admission.review({ ...context, epoch: 2 }, changed, input.vaultId, review({ expectedFence: 1, expectedStateDigest: writerStateDigest(changed), epoch: 2 }));
  assert.equal(reviewed.readonly, false); assert.equal(reviewed.fence, 2); assert.equal(reviewed.grant!.epoch, 2);
});

test('actual actor binding refuses foreign members, epochs, roles, channels and source-tainted sessions', async t => {
  const { admission, input, review } = await fixture(t);
  input.state.members.push({ id: 'other', name: 'Authored synthetic cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['*'] });
  await admission.review(context, input.state, input.vaultId, review());
  assert.equal((await admission.status({ ...input, context })).readonly, false);
  const actors: Context[] = [
    { memberId: 'other', role: 'cofounder', epoch: 1, channel: 'desktop' }, { ...context, epoch: 2 }, { ...context, role: 'cofounder' },
    { ...context, channel: 'phone' }, { ...context, channel: 'mcp' }, { ...context, channel: undefined }, { ...context, sourceTainted: true },
  ];
  for (const actor of actors) {
    assert.equal((await admission.status({ ...input, context: actor })).reason, 'SYNC_WRITER_ACTOR_MISMATCH');
    let called = false;
    await assert.rejects(admission.run({ ...input, context: actor }, async () => { called = true; return { result: undefined, committedState: input.state }; }), code('SYNC_WRITER_ACTOR_MISMATCH'));
    assert.equal(called, false);
  }
  assert.equal(await admission.run({ ...input, context }, async assertCurrent => { assertCurrent(); return { result: 'matching actor', committedState: input.state }; }), 'matching actor');
});

test('actor identity is checked again immediately before a commit', async t => {
  const { admission, input, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const actor = { ...context }; let committed = false;
  await assert.rejects(admission.run({ ...input, context: actor }, async assertCurrent => {
    actor.epoch++; assertCurrent(); committed = true; return { result: undefined, committedState: input.state };
  }), code('SYNC_WRITER_ACTOR_MISMATCH'));
  assert.equal(committed, false);
});

test('handover to a different current administrator grants only that actual actor', async t => {
  const { admission, input, review } = await fixture(t);
  input.state.members.push({ id: 'other', name: 'Authored synthetic cofounder', role: 'cofounder', active: true, epoch: 4, branches: ['*'] });
  const status = await admission.review(context, input.state, input.vaultId, review({ memberId: 'other', epoch: 4 }));
  assert.equal(status.reason, 'SYNC_WRITER_ACTOR_MISMATCH');
  await assert.rejects(admission.run({ ...input, context }, async () => ({ result: undefined, committedState: input.state })), code('SYNC_WRITER_ACTOR_MISMATCH'));
  const other: Context = { memberId: 'other', role: 'cofounder', epoch: 4, channel: 'desktop' };
  assert.equal((await admission.status({ ...input, context: other })).readonly, false);
  assert.equal(await admission.run({ ...input, context: other }, async assertCurrent => { assertCurrent(); return { result: 'reviewed cofounder', committedState: input.state }; }), 'reviewed cofounder');
});

test('publication lease renewals never rotate or extend the separately reviewed writer grant', async t => {
  const { admission, input, directory, options, review, advance } = await fixture(t);
  // Separate existing local directory: publication authority cannot double as admission.
  const transportDirectory = join(directory, 'publication');
  await admission.review(context, input.state, input.vaultId, review());
  await mkdir(transportDirectory);
  const transport = new FileSyncTransport({ ...options, directory: transportDirectory });
  const request = { deviceId: 'device-a', memberId: 'owner', epoch: 1, now: start, ttlMs: 120000 };
  const first = await transport.acquireLease(request), second = await transport.acquireLease(request);
  assert.ok(first); assert.ok(second); assert.ok(second.fence > first.fence);
  const writer = await admission.status(input);
  assert.equal(writer.fence, 1); assert.equal(writer.grant!.expiresAt, '2026-10-01T12:01:00.000Z');
  advance(60000);
  assert.equal((await admission.status(input)).reason, 'SYNC_WRITER_EXPIRED');
  assert.ok(await transport.acquireLease(request));
  await assert.rejects(admission.run(input, async () => ({ result: undefined, committedState: input.state })), code('SYNC_WRITER_EXPIRED'));
});

test('final review commit checks expiry and preserves its observed clock without changing the old fence', async t => {
  const { input, options, review, advance, setTime, directory } = await fixture(t);
  let advanceAtCommit = false, reads = 0;
  const admission = new FileSyncWriterAdmission({ ...options, clock: () => {
    const time = options.clock();
    // Model time advancing between preparing the temporary record and its rename.
    return advanceAtCommit && reads++ > 0 ? new Date(time.getTime() + 60001) : time;
  } });
  await admission.review(context, input.state, input.vaultId, review()); advance(1000); advanceAtCommit = true;
  await assert.rejects(admission.review(context, input.state, input.vaultId, review({ expectedFence: 1 })), code('SYNC_WRITER_EXPIRED'));
  const authority = JSON.parse(await readFile(authorityPath(directory), 'utf8'));
  assert.equal(authority.fence, 1); assert.equal(authority.clockFloorMs, Date.parse(start) + 61001);
  advanceAtCommit = false; setTime('2026-10-01T12:00:01.000Z');
  await assert.rejects(new FileSyncWriterAdmission(options).status(input), code('SYNC_CLOCK_REGRESSED'));
});

test('first enrollment expiry leaves a durable readonly seed and a restarted explicit review can succeed', async t => {
  const { input, options, review, directory } = await fixture(t);
  let firstSample = true, time = new Date(start);
  const clock = () => {
    if (firstSample) { firstSample = false; return new Date(start); }
    time = new Date(Date.parse(start) + 2); return time;
  };
  const admission = new FileSyncWriterAdmission({ ...options, clock });
  await assert.rejects(admission.review(context, input.state, input.vaultId, review({ expiresAt: new Date(Date.parse(start) + 1).toISOString() })), code('SYNC_WRITER_EXPIRED'));
  const identity = await readFile(join(directory, 'writer-identity.json'), 'utf8');
  const persisted = JSON.parse(await readFile(authorityPath(directory), 'utf8'));
  assert.equal(persisted.fence, 0); assert.equal(persisted.grant, null); assert.equal(persisted.stateDigest, writerStateDigest(input.state)); assert.equal(persisted.clockFloorMs, time.getTime());
  const restarted = new FileSyncWriterAdmission({ ...options, clock: () => time });
  const status = await restarted.status(input);
  assert.equal(status.reason, 'SYNC_WRITER_REVIEW_REQUIRED'); assert.equal(status.fence, 0); assert.equal(status.grant, null); assert.equal(status.stateDigest, persisted.stateDigest);
  let called = false;
  await assert.rejects(restarted.run(input, async () => { called = true; return { result: undefined, committedState: input.state }; }), code('SYNC_WRITER_REVIEW_REQUIRED'));
  assert.equal(called, false);
  const renewedReview = await restarted.review(context, input.state, input.vaultId, review({ expiresAt: new Date(time.getTime() + 1000).toISOString() }));
  assert.equal(renewedReview.fence, 1); assert.equal(renewedReview.readonly, false); assert.equal(renewedReview.stateDigest, persisted.stateDigest);
  assert.equal(await readFile(join(directory, 'writer-identity.json'), 'utf8'), identity);
});

test('failed first enrollment retains its clock floor and exact digest rather than adopting a new baseline', async t => {
  const { input, options, review, directory } = await fixture(t);
  let samples = 0, time = new Date(start);
  const clock = () => samples++ === 0 ? new Date(start) : (time = new Date(Date.parse(start) + 2));
  await assert.rejects(new FileSyncWriterAdmission({ ...options, clock }).review(context, input.state, input.vaultId, review({ expiresAt: new Date(Date.parse(start) + 1).toISOString() })), code('SYNC_WRITER_EXPIRED'));
  const restarted = new FileSyncWriterAdmission({ ...options, clock: () => time });
  const authority = JSON.parse(await readFile(authorityPath(directory), 'utf8'));
  time = new Date(start);
  await assert.rejects(restarted.status(input), code('SYNC_CLOCK_REGRESSED'));
  await assert.rejects(restarted.review(context, input.state, input.vaultId, review()), code('SYNC_CLOCK_REGRESSED'));
  time = new Date(Date.parse(start) + 2);
  const divergent = structuredClone(input.state); divergent.workspace.name = 'Authored divergent unadmitted copy';
  assert.equal((await restarted.status({ ...input, state: divergent })).reason, 'SYNC_WRITER_STATE_CONFLICT');
  await assert.rejects(restarted.review(context, divergent, input.vaultId, review({ expectedStateDigest: writerStateDigest(divergent) })), code('SYNC_WRITER_STATE_CONFLICT'));
  const after = JSON.parse(await readFile(authorityPath(directory), 'utf8'));
  assert.equal(after.controlId, authority.controlId); assert.equal(after.stateDigest, authority.stateDigest); assert.equal(after.fence, 0); assert.equal(after.grant, null);
  await unlink(authorityPath(directory));
  await assert.rejects(restarted.status(input), code('SYNC_WRITER_STORE_CORRUPT'));
  await assert.rejects(restarted.review(context, input.state, input.vaultId, review()), code('SYNC_WRITER_STORE_CORRUPT'));
});

test('expiry at the final digest publication leaves committed business state in conflict instead of guessing success', async t => {
  const { input, options, review, directory } = await fixture(t);
  let committed = false, postCommitReads = 0;
  const admission = new FileSyncWriterAdmission({ ...options, clock: () => {
    const time = options.clock();
    return committed && postCommitReads++ > 0 ? new Date(time.getTime() + 60001) : time;
  } });
  await admission.review(context, input.state, input.vaultId, review());
  const next = structuredClone(input.state); next.workspace.name = 'Authored committed state'; next.revision++;
  await assert.rejects(admission.run(input, async assertCurrent => { assertCurrent(); committed = true; return { result: undefined, committedState: next }; }), code('SYNC_WRITER_EXPIRED'));
  assert.equal(JSON.parse(await readFile(authorityPath(directory), 'utf8')).stateDigest, writerStateDigest(input.state));
  assert.equal(JSON.parse(await readFile(authorityPath(directory), 'utf8')).clockFloorMs, Date.parse(start) + 60001);
  assert.equal((await admission.status({ ...input, state: next })).reason, 'SYNC_WRITER_STATE_CONFLICT');
});

test('returned volatile configuration is restored under the process lock when final admission expires', async t => {
  const { input, options, review, directory, advance } = await fixture(t);
  let settingEnabled = false, returnedWork = false, readsAfterReturn = 0, restoredUnderLock = false;
  const admission = new FileSyncWriterAdmission({ ...options, clock: () => {
    const time = options.clock();
    return returnedWork && readsAfterReturn++ > 0 ? new Date(time.getTime() + 60001) : time;
  } });
  await admission.review(context, input.state, input.vaultId, review());
  await assert.rejects(admission.run(input, async assertCurrent => {
    assertCurrent(); settingEnabled = true; returnedWork = true;
    return { result: 'enabled', committedState: input.state, rollback: () => {
      settingEnabled = false; restoredUnderLock = existsSync(join(directory, '.admission.lock'));
    } };
  }), code('SYNC_WRITER_EXPIRED'));
  assert.equal(settingEnabled, false); assert.equal(restoredUnderLock, true);
  advance(60001);
  const next = new FileSyncWriterAdmission(options);
  const current = await next.status(input);
  assert.equal(current.fence, 1); assert.equal(current.stateDigest, writerStateDigest(input.state));
  assert.equal((await next.review(context, input.state, input.vaultId, review({ expectedFence: 1 }))).fence, 2);
  assert.equal(await next.run(input, async assertCurrent => { assertCurrent(); return { result: settingEnabled, committedState: input.state }; }), false);
});

test('successful volatile configuration does not run rollback and rollback errors cannot mask admission failure', async t => {
  const { admission, input, review, advance } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  let restored = false;
  assert.equal(await admission.run(input, async () => ({ result: 'committed', committedState: input.state, rollback: () => { restored = true; } })), 'committed');
  assert.equal(restored, false);
  await assert.rejects(admission.run(input, async () => { advance(60001); return { result: 'expired', committedState: input.state, rollback: () => { restored = true; throw new Error('Authored volatile restoration failure'); } }; }), code('SYNC_WRITER_EXPIRED'));
  assert.equal(restored, true);
});

test('review refuses phone, MCP, implicit channel, tainted, inactive and limited administrators', async t => {
  const { admission, input, review } = await fixture(t);
  for (const update of [{ channel: 'phone' }, { channel: 'mcp' }, { channel: undefined }, { sourceTainted: true }]) {
    await assert.rejects(admission.review({ ...context, ...update } as Context, input.state, input.vaultId, review()), code('APP_APPROVAL_REQUIRED'));
  }
  const inactive = structuredClone(input.state); inactive.members[0].active = false;
  await assert.rejects(admission.review(context, inactive, input.vaultId, review()), code('ACCESS_REVOKED'));
  const limited = structuredClone(input.state); limited.members[0].branches = ['main'];
  await assert.rejects(admission.review(context, limited, input.vaultId, review()), code('SYNC_SCOPE_DENIED'));
  const accountant = structuredClone(input.state); accountant.members[0].role = 'accountant';
  await assert.rejects(admission.review({ ...context, role: 'accountant' }, accountant, input.vaultId, review()), code('FORBIDDEN'));
});

test('review checks all current source access for both reviewer and target member', async t => {
  const { admission, input, review } = await fixture(t);
  input.state.facts.push({ id: 'f', entityId: 'e', sourceId: 's', sourceRow: 1, kind: 'invoice', validFrom: start, validTo: null, learnedAt: start, supersededAt: null, fields: { synthetic: true } });
  input.state.sourceRules.push({ sourceId: 's', revoked: true });
  await assert.rejects(admission.review(context, input.state, input.vaultId, review()), code('SOURCE_REVOKED'));
  input.state.sourceRules = [{ sourceId: 's', memberIds: ['owner'] }];
  input.state.members.push({ id: 'other', name: 'Synthetic cofounder', role: 'cofounder', active: true, epoch: 3, branches: ['*'] });
  await assert.rejects(admission.review(context, input.state, input.vaultId, review({ memberId: 'other', epoch: 3 })), code('SOURCE_REVOKED'));
});

test('review requires explicit canonical bounded expiry, complete fields and current target epoch', async t => {
  const { admission, input, review } = await fixture(t);
  const invalids = [
    { expiresAt: start }, { expiresAt: '2026-10-01T12:02:00.001Z' }, { expiresAt: '2026-10-01T12:01:00Z' },
    { expectedFence: -1 }, { expectedFence: 0.5 }, { expectedStateDigest: 'SHA' }, { deviceId: '' },
    { reason: '   ' }, { reason: 'x'.repeat(1001) }, { epoch: 0 }, { extra: true },
  ];
  for (const fields of invalids) await assert.rejects(admission.review(context, input.state, input.vaultId, { ...review(), ...fields }), code('INVALID_SYNC_WRITER_REVIEW'));
  await assert.rejects(admission.review(context, input.state, input.vaultId, review({ memberId: 'missing' })), code('ACCESS_REVOKED'));
  await assert.rejects(admission.review(context, input.state, input.vaultId, review({ epoch: 2 })), code('ACCESS_REVOKED'));
  assert.equal((await admission.status(input)).fence, 0);
  const limit = await admission.review(context, input.state, input.vaultId, review({ expiresAt: '2026-10-01T12:02:00.000Z' }));
  assert.equal(limit.readonly, false);
});

test('status exposes no explanation plaintext or authority identifier while grant reason is hashed', async t => {
  const { admission, input, review, directory } = await fixture(t), explanation = 'Authored synthetic private review explanation.';
  const status = await admission.review(context, input.state, input.vaultId, review({ reason: explanation }));
  const raw = await readFile(authorityPath(directory), 'utf8');
  assert.equal(raw.includes(explanation), false); assert.match(JSON.parse(raw).grant.reasonDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(status).includes('controlId'), false); assert.equal(JSON.stringify(status).includes('reasonDigest'), false);
  status.grant!.deviceId = 'caller-mutated'; assert.equal((await admission.status(input)).grant!.deviceId, 'device-a');
});

test('missing initialized authority and a surviving authority without identity cannot reset a fence', async t => {
  const { admission, input, options, review, directory } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const raw = await readFile(authorityPath(directory), 'utf8'); await unlink(authorityPath(directory));
  await assert.rejects(new FileSyncWriterAdmission(options).status(input), code('SYNC_WRITER_STORE_CORRUPT'));
  await assert.rejects(new FileSyncWriterAdmission(options).review(context, input.state, input.vaultId, review()), code('SYNC_WRITER_STORE_CORRUPT'));
  await writeFile(authorityPath(directory), raw); await unlink(join(directory, 'writer-identity.json'));
  await assert.rejects(new FileSyncWriterAdmission(options).status(input), code('SYNC_WRITER_STORE_CORRUPT'));
});

test('malformed, oversized, unknown and inconsistent persistent records fail closed', async t => {
  const { admission, input, options, review, directory } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const authority = JSON.parse(await readFile(authorityPath(directory), 'utf8'));
  const records = [
    '{"partial":', ' '.repeat(8193), JSON.stringify({ ...authority, extra: true }), JSON.stringify({ ...authority, fence: 0 }), JSON.stringify({ ...authority, grant: null }),
    JSON.stringify({ ...authority, stateDigest: 'no' }), JSON.stringify({ ...authority, controlId: '00000000-0000-0000-0000-000000000000' }),
    JSON.stringify({ ...authority, grant: { ...authority.grant, epoch: 0 } }), JSON.stringify({ ...authority, grant: { ...authority.grant, expiresAt: '2026-10-01T12:02:00.001Z' } }),
    JSON.stringify({ ...authority, clockFloorMs: Date.parse(start) - 1 }), JSON.stringify(authority) + '\n',
  ];
  for (const raw of records) { await writeFile(authorityPath(directory), raw); await assert.rejects(new FileSyncWriterAdmission(options).status(input), code('SYNC_WRITER_STORE_CORRUPT')); }
});

test('preexisting unrelated directory contents are not adopted as a fresh writer control', async t => {
  const { admission, input, review, directory } = await fixture(t); await writeFile(join(directory, 'existing-user-file.txt'), 'Authored synthetic existing file');
  await assert.rejects(admission.status(input), code('SYNC_WRITER_STORE_CORRUPT'));
  await assert.rejects(admission.review(context, input.state, input.vaultId, review()), code('SYNC_WRITER_STORE_CORRUPT'));
  assert.equal(await readFile(join(directory, 'existing-user-file.txt'), 'utf8'), 'Authored synthetic existing file');
});

test('workspace and vault identities cannot be changed by status, review, run or a new adapter', async t => {
  const { admission, input, options, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  await assert.rejects(admission.status({ ...input, vaultId: 'other' }), code('SYNC_WORKSPACE_MISMATCH'));
  const other = structuredClone(input.state); other.workspace.id = 'other';
  await assert.rejects(admission.run({ ...input, state: other }, async () => ({ result: undefined, committedState: other })), code('SYNC_WORKSPACE_MISMATCH'));
  await assert.rejects(admission.review(context, other, input.vaultId, review()), code('SYNC_WORKSPACE_MISMATCH'));
  await assert.rejects(new FileSyncWriterAdmission({ ...options, workspaceId: 'other' }).status({ state: other, vaultId: input.vaultId }), code('SYNC_WORKSPACE_MISMATCH'));
  await assert.rejects(new FileSyncWriterAdmission({ ...options, vaultId: 'other' }).status({ ...input, vaultId: 'other' }), code('SYNC_WORKSPACE_MISMATCH'));
});

test('invalid or unavailable trusted clocks refuse without trusting caller expiry', async t => {
  const { input, options, review } = await fixture(t);
  for (const clock of [() => new Date(NaN), () => { throw new Error('Authored clock unavailable'); }, () => ({ getTime: () => Date.parse(start) }) as Date]) {
    const admission = new FileSyncWriterAdmission({ ...options, clock });
    await assert.rejects(admission.status(input), code('SYNC_CLOCK_INVALID'));
    await assert.rejects(admission.review(context, input.state, input.vaultId, review()), code('SYNC_CLOCK_INVALID'));
  }
});

test('same-process lock exclusion covers the complete asynchronous work and denies handover until release', async t => {
  const { admission, input, options, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  let enter!: () => void, resume!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { resume = resolve; });
  const running = admission.run(input, async assertCurrent => { enter(); await held; assertCurrent(); return { result: 'finished', committedState: input.state }; });
  await entered;
  try {
    const competing = new FileSyncWriterAdmission(options);
    await assert.rejects(competing.status(input), code('SYNC_WRITER_BUSY'));
    await assert.rejects(competing.review(context, input.state, input.vaultId, review({ expectedFence: 1, deviceId: 'device-b' })), code('SYNC_WRITER_BUSY'));
    await assert.rejects(competing.run(input, async () => ({ result: undefined, committedState: input.state })), code('SYNC_WRITER_BUSY'));
  } finally { resume(); }
  assert.equal(await running, 'finished');
  assert.equal((await admission.review(context, input.state, input.vaultId, review({ expectedFence: 1, deviceId: 'device-b' }))).fence, 2);
});

test('a real second Node process cannot enter or review while a local writer holds asynchronous work', async t => {
  const { admission, input, options, review } = await fixture(t); await admission.review(context, input.state, input.vaultId, review());
  const script = `import { FileSyncWriterAdmission } from ${JSON.stringify(new URL('../runtime/sync-writer-admission.ts', import.meta.url).href)};
    const data = JSON.parse(process.argv[1]);
    const admission = new FileSyncWriterAdmission({ ...data.options, clock: () => new Date(data.time) });
    await admission.run(data.input, async assertCurrent => {
      process.stdout.write('held\\n');
      await new Promise(resolve => process.stdin.once('data', resolve));
      assertCurrent(); return { result: 'finished', committedState: data.input.state };
    }); process.stdout.write('finished\\n');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ options: { directory: options.directory, workspaceId: options.workspaceId, vaultId: options.vaultId, deviceId: options.deviceId }, input, time: start })], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '', errors = ''; child.stdout.on('data', bytes => { output += bytes.toString(); }); child.stderr.on('data', bytes => { errors += bytes.toString(); });
  const exit = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Synthetic child writer did not enter: ${errors}`)), 15000);
    child.stdout.on('data', () => { if (output.includes('held\n')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { if (!output.includes('held\n')) { clearTimeout(timer); reject(new Error(`Synthetic child writer exited before admission: ${errors}`)); } });
  });
  try {
    await assert.rejects(admission.status(input), code('SYNC_WRITER_BUSY'));
    await assert.rejects(admission.review(context, input.state, input.vaultId, review({ expectedFence: 1, deviceId: 'device-b' })), code('SYNC_WRITER_BUSY'));
  } finally { child.stdin.end('release\n'); }
  assert.equal(await exit, 0, errors); assert.match(output, /finished/); assert.equal((await admission.status(input)).readonly, false);
});

test('real encrypted vault bytes are untouched when writer digest admission refuses', async t => {
  const { admission, input, directory, options, review } = await fixture(t);
  const vaultDirectory = await mkdtemp(join(resolve(tmpdir()), 'chausar-sync-writer-vault-'));
  t.after(async () => { await rm(vaultDirectory, { recursive: true, force: true }); });
  const { vault } = await Vault.create({ directory: vaultDirectory, storage: 'experimental-file', name: 'Authored synthetic encrypted writer vault', demo: true, passphrase: 'authored synthetic writer fixture passphrase' });
  t.after(() => vault.close());
  const realInput = { state: vault.read(), vaultId: vault.vaultId };
  const actual = new FileSyncWriterAdmission({ ...options, workspaceId: realInput.state.workspace.id, vaultId: realInput.vaultId });
  await actual.review(context, realInput.state, realInput.vaultId, { ...review(), expectedStateDigest: writerStateDigest(realInput.state) });
  const next = structuredClone(realInput.state); next.workspace.name = 'Divergent encrypted vault state';
  const before = await readFile(join(vaultDirectory, 'authority.encrypted.json'));
  let called = false;
  await assert.rejects(actual.run({ ...realInput, state: next }, async assertCurrent => {
    called = true; assertCurrent(); await vault.update(state => { state.workspace.name = 'Must never commit'; });
    return { result: undefined, committedState: vault.read() };
  }), code('SYNC_WRITER_STATE_CONFLICT'));
  assert.equal(called, false); assert.deepEqual(await readFile(join(vaultDirectory, 'authority.encrypted.json')), before);
  assert.equal((await actual.status(realInput)).readonly, false); assert.ok((await readdir(directory)).includes('writer-authority.json'));
  await assert.rejects(admission.status(input), code('SYNC_WORKSPACE_MISMATCH'));
});

test('real process exit between encrypted vault commit and admission record leaves a persistent conflict', async t => {
  const { directory, options, review } = await fixture(t);
  const vaultDirectory = await mkdtemp(join(resolve(tmpdir()), 'chausar-sync-writer-crash-vault-'));
  let opened: Vault | undefined;
  t.after(async () => { await opened?.close(); await rm(vaultDirectory, { recursive: true, force: true }); });
  const passphrase = 'authored synthetic crash fixture passphrase';
  const created = await Vault.create({ directory: vaultDirectory, storage: 'experimental-file', name: 'Authored synthetic crash vault', demo: true, passphrase });
  const original = { state: created.vault.read(), vaultId: created.vault.vaultId };
  const boundOptions = { directory, workspaceId: original.state.workspace.id, vaultId: original.vaultId, deviceId: options.deviceId };
  const admission = new FileSyncWriterAdmission({ ...boundOptions, clock: options.clock });
  await admission.review(context, original.state, original.vaultId, { ...review(), expectedStateDigest: writerStateDigest(original.state) });
  await created.vault.close();
  const script = `import { FileSyncWriterAdmission } from ${JSON.stringify(new URL('../runtime/sync-writer-admission.ts', import.meta.url).href)};
    import { Vault } from ${JSON.stringify(new URL('../runtime/vault.ts', import.meta.url).href)};
    const data = JSON.parse(process.argv[1]);
    const vault = await Vault.open({ directory: data.vaultDirectory, storage: 'experimental-file', passphrase: data.passphrase });
    const admission = new FileSyncWriterAdmission({ ...data.options, clock: () => new Date(data.time) });
    await admission.run({ state: vault.read(), vaultId: vault.vaultId }, async assertCurrent => {
      assertCurrent(); await vault.update(state => { state.workspace.name = 'Committed before authored process exit'; });
      process.exit(86);
    });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ vaultDirectory, passphrase, options: boundOptions, time: start })], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let errors = ''; child.stderr.on('data', bytes => { errors += bytes.toString(); });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exit = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Authored crash fixture exceeded its bounded wait.')); }, 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', value => { clearTimeout(timer); resolve(value); });
  });
  assert.equal(exit, 86, errors);
  opened = await Vault.open({ directory: vaultDirectory, storage: 'experimental-file', passphrase });
  const committed = { state: opened.read(), vaultId: opened.vaultId };
  assert.equal(committed.state.workspace.name, 'Committed before authored process exit');
  assert.equal((await new FileSyncWriterAdmission({ ...boundOptions, clock: options.clock }).status(committed)).reason, 'SYNC_WRITER_STATE_CONFLICT');
  const bytes = await readFile(join(vaultDirectory, 'authority.encrypted.json')); let retried = false;
  await assert.rejects(admission.run(committed, async () => { retried = true; return { result: undefined, committedState: opened!.read() }; }), code('SYNC_WRITER_STATE_CONFLICT'));
  assert.equal(retried, false); assert.deepEqual(await readFile(join(vaultDirectory, 'authority.encrypted.json')), bytes);
  assert.equal(JSON.parse(await readFile(authorityPath(directory), 'utf8')).stateDigest, writerStateDigest(original.state));
});
