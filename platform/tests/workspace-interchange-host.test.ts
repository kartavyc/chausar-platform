import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import test from 'node:test';
import { ChausarError, type Context, type State } from '../runtime/contracts.ts';
import { canonicalInterchangeJson, interchangeDigest } from '../runtime/workspace-interchange.ts';
import {
  WorkspaceInterchangeHost, type WorkspaceInterchangeHostPorts, type WorkspaceInterchangeCustodyRecord,
  type WorkspaceInterchangeCustodyMeasurement, type WorkspaceInterchangeSourceLease,
} from '../runtime/workspace-interchange-host.ts';
import { artifactsFor, deterministicShopState, emptyTarget, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

// Actual AES-GCM in private fixture memory, not installed/native encrypted custody.
// No filesystem, authority activation, scheduler, provider or side-effect port.
type Cipher = { nonce: Buffer; tag: Buffer; data: Buffer };
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const EXPORT = { destinationId: 'synthetic_export', confirmed: true as const };
const PREPARE = { exportId: EXPORT.destinationId, candidateId: 'synthetic_candidate', targetId: 'target_fixture' };

function fixture() {
  const key = randomBytes(32), records = new Map<string, { archive: Cipher; pin: Cipher }>();
  let state: State = deterministicShopState(), target = emptyTarget();
  let sourceHeld = false, targetHeld = false, allocated = false, fullAccess = true, ready = true, complete = true;
  let sourceAssertions = 0, targetAssertions = 0, creates = 0, reads = 0, removes = 0;
  let onCreate: (() => void) | undefined, onRead: ((count: number) => void) | undefined;
  let onSourceAssert: ((count: number) => void) | undefined, onTargetAssert: ((count: number) => void) | undefined;
  let leaseOverride: Partial<WorkspaceInterchangeSourceLease> = {};
  const plaintext = new Map<string, string>(), plaintextInstances = new Map<string, string>();
  function seal(text: string, binding: string): Cipher {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(binding));
    const data = Buffer.concat([cipher.update(text), cipher.final()]);
    return { nonce, tag: cipher.getAuthTag(), data };
  }
  function unseal(cipher: Cipher, binding: string): string {
    const decipher = createDecipheriv('aes-256-gcm', key, cipher.nonce);
    decipher.setAAD(Buffer.from(binding)); decipher.setAuthTag(cipher.tag);
    return Buffer.concat([decipher.update(cipher.data), decipher.final()]).toString('utf8');
  }
  function readRecord(recordId: string): WorkspaceInterchangeCustodyRecord {
    const encrypted = records.get(recordId); if (!encrypted) throw new ChausarError('INTERCHANGE_RECORD_NOT_FOUND', 'Synthetic custody record is absent.');
    return { content: unseal(encrypted.archive, `${recordId}:archive`), pin: JSON.parse(unseal(encrypted.pin, `${recordId}:pin`)) };
  }
  function measured(recordId: string): WorkspaceInterchangeCustodyMeasurement {
    const encrypted = records.get(recordId)!;
    return { encrypted: true, archiveCiphertextBytes: encrypted.archive.data.length + 28,
      inventoryPinCiphertextBytes: encrypted.pin.data.length + 28, qualification: 'test-fixture' };
  }
  const ports: WorkspaceInterchangeHostPorts = {
    async withSource(context, _expected, work) {
      assert.equal(sourceHeld, false); sourceHeld = true;
      const originalState = interchangeDigest(state);
      const artifactCapture = artifactsFor(state); if (!complete) artifactCapture.categories.pop();
      const originalArtifacts = interchangeDigest({ ...artifactCapture, artifacts: artifactCapture.artifacts.map(item => ({ ...item, bytes: [...item.bytes] })) });
      const lease: WorkspaceInterchangeSourceLease = {
        ready, state: structuredClone(state), artifacts: artifactCapture,
        async assertCompleteOwner(ctx, historical) {
          await Promise.resolve(); assert.equal(sourceHeld, true);
          assert.equal(ctx.memberId, context.memberId); assert.equal(historical.workspace.id, state.workspace.id);
          if (!fullAccess) throw new ChausarError('ACCESS_REVOKED', 'Synthetic complete source access was revoked.');
          if (!ready) throw new ChausarError('INTERCHANGE_NOT_READY', 'Synthetic source readiness changed.');
          // Guards receive detached values, never the host's retained archive.
          historical.workspace.name = 'detached host guard copy'; ctx.memberId = 'detached guard context';
        },
        async assertCurrent() {
          await Promise.resolve(); assert.equal(sourceHeld, true); sourceAssertions++; onSourceAssert?.(sourceAssertions);
          if (interchangeDigest(state) !== originalState) throw new ChausarError('INTERCHANGE_AUTHORITY_CHANGED', 'Synthetic source fence changed.');
          const currentArtifacts = artifactsFor(state);
          const now = interchangeDigest({ ...currentArtifacts, artifacts: currentArtifacts.artifacts.map(item => ({ ...item, bytes: [...item.bytes] })) });
          if (now !== originalArtifacts && complete) throw new ChausarError('INTERCHANGE_AUTHORITY_CHANGED', 'Synthetic artifact fence changed.');
        }, ...leaseOverride,
      };
      try { return await work(lease); } finally { sourceHeld = false; }
    },
    async withTarget(_context, input, work) {
      assert.equal(sourceHeld, true); assert.equal(targetHeld, false); assert.equal(input.targetId, target.targetId);
      if (input.mode === 'allocate' && allocated) throw new ChausarError('INTERCHANGE_TARGET_EXISTS', 'Synthetic target was already allocated.');
      if (input.mode === 'existing' && !allocated) throw new ChausarError('INTERCHANGE_TARGET_NOT_FOUND', 'Synthetic target custody is absent.');
      const newlyAllocated = input.mode === 'allocate'; allocated = true; targetHeld = true;
      const original = interchangeDigest(target);
      try {
        return await work({ inspection: structuredClone(target), async assertCurrent() {
          await Promise.resolve(); assert.equal(targetHeld, true); targetAssertions++; onTargetAssert?.(targetAssertions);
          if (interchangeDigest(target) !== original) throw new ChausarError('INTERCHANGE_TARGET_CHANGED', 'Synthetic target fence changed.');
        } });
      } catch (error) { if (newlyAllocated) allocated = false; throw error; }
      finally { targetHeld = false; }
    },
    custody: {
      async create(_context, record) {
        assert.equal(sourceHeld, true); if (record.pin.kind === 'candidate') assert.equal(targetHeld, true);
        if (records.has(record.pin.recordId)) throw new ChausarError('OUTPUT_EXISTS', 'Synthetic custody never overwrites.');
        records.set(record.pin.recordId, { archive: seal(record.content, `${record.pin.recordId}:archive`),
          pin: seal(canonicalInterchangeJson(record.pin), `${record.pin.recordId}:pin`) });
        creates++; onCreate?.(); return measured(record.pin.recordId);
      },
      async read(_context, recordId) {
        onRead?.(++reads);
        return { ...readRecord(recordId), measurement: measured(recordId) };
      },
      async remove(_context, input) {
        // Exact creation rollback also runs after a failed outer lease exit.
        const current = readRecord(input.recordId);
        assert.equal(interchangeDigest(current.pin), input.expectedPinDigest);
        assert.equal(interchangeDigest(current.content), input.expectedContentDigest);
        records.delete(input.recordId); removes++;
      },
    },
    plaintext: {
      async create(_context, input, assertCurrent) {
        await assertCurrent(); assert.equal(sourceHeld, true);
        if (plaintext.has(input.destinationId)) throw new ChausarError('OUTPUT_EXISTS', 'Synthetic open export never overwrites.');
        try {
          plaintext.set(input.destinationId, input.text); plaintextInstances.set(input.destinationId, input.creationId);
          await assertCurrent(); return { utf8Bytes: Buffer.byteLength(input.text), creationId: input.creationId };
        } catch (error) {
          if (plaintextInstances.get(input.destinationId) === input.creationId) { plaintext.delete(input.destinationId); plaintextInstances.delete(input.destinationId); }
          throw error;
        }
      },
      async remove(_context, input) {
        const text = plaintext.get(input.destinationId);
        assert.notEqual(text, undefined); assert.equal(interchangeDigest(text), input.expectedContentDigest);
        assert.equal(plaintextInstances.get(input.destinationId), input.creationId);
        plaintext.delete(input.destinationId); plaintextInstances.delete(input.destinationId);
      },
    },
  };
  const host = new WorkspaceInterchangeHost(ports);
  return { host, ports, records, plaintext, plaintextInstances, measured, readRecord,
    export: () => host.export(interchangeOwner, EXPORT), prepare: () => host.prepare(interchangeOwner, PREPARE),
    reopen: () => new WorkspaceInterchangeHost(ports),
    state: () => structuredClone(state), target: () => structuredClone(target),
    mutateState: (change: (s: State) => void) => { change(state); }, mutateTarget: (change: (t: typeof target) => void) => { change(target); },
    setAccess: (value: boolean) => { fullAccess = value; }, setReady: (value: boolean) => { ready = value; },
    setComplete: (value: boolean) => { complete = value; }, setLease: (value: typeof leaseOverride) => { leaseOverride = value; },
    onCreate: (value: typeof onCreate) => { onCreate = value; }, onRead: (value: typeof onRead) => { onRead = value; },
    onSourceAssert: (value: typeof onSourceAssert) => { onSourceAssert = value; }, onTargetAssert: (value: typeof onTargetAssert) => { onTargetAssert = value; },
    counts: () => ({ creates, reads, removes, sourceAssertions, targetAssertions }),
    reseal: (recordId: string, change: (record: WorkspaceInterchangeCustodyRecord) => void) => {
      const value = readRecord(recordId); change(value);
      records.set(recordId, { archive: seal(value.content, `${recordId}:archive`), pin: seal(canonicalInterchangeJson(value.pin), `${recordId}:pin`) });
    },
  };
}

test('encrypted export and independent pin retain exact inert material with bounded public summaries', async () => {
  const f = fixture(), original = f.state();
  original.actions.push({ id: 'historical_approved', status: 'approved', payload: { text: 'private literal =1+1' } });
  f.mutateState(state => state.actions = original.actions);
  const summary = await f.export();
  assert.equal(summary.kind, 'export'); assert.equal(summary.inert, true); assert.equal(summary.activation, 'root-only');
  assert.equal(summary.inventory.stores, 26); assert.equal(summary.inventory.categoryCounts.length, 9);
  assert.equal(summary.custodyQualification, 'test-fixture'); assert.equal(summary.bytes.archiveCiphertext, summary.bytes.wireUtf8 + 28);
  assert.equal(JSON.stringify(summary).includes('private literal'), false); assert.equal('archive' in summary, false); assert.equal('state' in summary, false);
  const ciphertext = f.records.get(EXPORT.destinationId)!;
  assert.equal(ciphertext.archive.data.includes(Buffer.from('private literal')), false);
  assert.equal(ciphertext.pin.data.includes(Buffer.from('workspace-inventory')), false);
  assert.deepEqual(f.state(), original); assert.equal(f.counts().creates, 1);
});

test('candidate prepare/review survives host reopening and leaves all source authority inert and unchanged', async () => {
  const f = fixture(); const original = f.state(); await f.export(); const prepared = await f.prepare();
  const reopened = f.reopen(); const reviewed = await reopened.review(interchangeOwner, { candidateId: PREPARE.candidateId, reviewedDigest: prepared.reviewedDigest });
  assert.deepEqual(reviewed, prepared); assert.equal(prepared.target?.workspaceId, 'workspace_synthetic_empty_target');
  assert.deepEqual(f.state(), original); assert.equal(f.counts().creates, 2);
  const candidate = JSON.parse(f.readRecord(PREPARE.candidateId).content);
  assert.equal(candidate.inert, true); assert.equal(candidate.activation, 'root-only');
  assert.equal(prepared.reviewedDigest, interchangeDigest(candidate)); assert.ok(f.counts().sourceAssertions > 10); assert.ok(f.counts().targetAssertions > 3);
  assert.equal(JSON.stringify(prepared).includes('Synthetic portable shop'), false);
});

test('requires explicit confirmed destinations and separates open export from encrypted default', async () => {
  const f = fixture();
  await assert.rejects(f.host.export(interchangeOwner, { ...EXPORT, confirmed: false } as any), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(f.host.export(interchangeOwner, { ...EXPORT, destinationId: '../../outside' }), code('CONFIRMATION_REQUIRED'));
  await f.export(); assert.equal(f.plaintext.size, 0);
  const open = await f.host.exportPlaintext(interchangeOwner, { destinationId: 'explicit_open', confirmed: true });
  assert.equal(open.encrypted, false); assert.equal(open.utf8Bytes, Buffer.byteLength(f.plaintext.get('explicit_open')!));
  assert.equal(f.records.size, 1); assert.equal('text' in open, false);
  const { plaintext: _writer, ...withoutOpen } = f.ports;
  await assert.rejects(new WorkspaceInterchangeHost(withoutOpen).exportPlaintext(interchangeOwner, { destinationId: 'open_unavailable', confirmed: true }), code('INTERCHANGE_PLAINTEXT_UNAVAILABLE'));
});

test('export cannot overwrite an owned archive or invent missing category attestations', async () => {
  const f = fixture(); await f.export();
  await assert.rejects(f.export(), code('OUTPUT_EXISTS')); assert.equal(f.records.size, 1);
  const incomplete = fixture(); incomplete.setComplete(false);
  await assert.rejects(incomplete.export(), code('INTERCHANGE_INVENTORY')); assert.equal(incomplete.counts().creates, 0);
});

for (const [label, context] of [
  ['phone', { ...interchangeOwner, channel: 'phone' }], ['tainted', { ...interchangeOwner, sourceTainted: true }],
  ['wrong epoch', { ...interchangeOwner, epoch: 2 }], ['viewer', { ...interchangeOwner, role: 'viewer' }],
] as const) test(`full export refuses ${label} context before custody writes`, async () => {
  const f = fixture(); await assert.rejects(f.host.export(context as Context, EXPORT)); assert.equal(f.counts().creates, 0);
});

test('current complete source access and readiness are mandatory despite historical owner membership', async () => {
  for (const [setting, expected] of [['access', 'ACCESS_REVOKED'], ['ready', 'INTERCHANGE_NOT_READY']] as const) {
    const f = fixture(); if (setting === 'access') f.setAccess(false); else f.setReady(false);
    await assert.rejects(f.export(), code(expected)); assert.equal(f.records.size, 0);
  }
  const f = fixture(); await f.export(); f.setAccess(false);
  await assert.rejects(f.prepare(), code('ACCESS_REVOKED')); assert.equal(f.counts().creates, 1);
});

test('source changes or access revocation during encrypted creation refuse and remove the exact orphan', async () => {
  for (const [change, expected] of [
    [(f: ReturnType<typeof fixture>) => f.mutateState(state => state.revision++), 'INTERCHANGE_AUTHORITY_CHANGED'],
    [(f: ReturnType<typeof fixture>) => f.setAccess(false), 'ACCESS_REVOKED'],
  ] as const) {
    const f = fixture(); f.onCreate(() => change(f));
    await assert.rejects(f.export(), code(expected)); assert.equal(f.records.size, 0); assert.equal(f.counts().removes, 1);
  }
});

test('last outer source/target fence failures remove the exact created pair after lease exit', async () => {
  const f = fixture();
  f.onSourceAssert(count => { if (count === 6) f.mutateState(state => { state.revision++; }); });
  await assert.rejects(f.export(), code('INTERCHANGE_AUTHORITY_CHANGED'));
  assert.equal(f.records.size, 0); assert.equal(f.counts().removes, 1);
  const g = fixture(); await g.export();
  g.onTargetAssert(count => { if (count === 5) g.mutateTarget(target => { target.generation = 'last_assertion_race'; }); });
  await assert.rejects(g.prepare(), code('INTERCHANGE_TARGET_CHANGED'));
  assert.equal(g.records.has(EXPORT.destinationId), true); assert.equal(g.records.has(PREPARE.candidateId), false);
});

test('creation cleanup covers a root lease release error after a successful callback', async () => {
  const f = fixture(), source = f.ports.withSource;
  f.ports.withSource = async (context, expected, work) => { await source(context, expected, work); throw new Error('Synthetic root lease release failed'); };
  await assert.rejects(f.export(), /Synthetic root lease release failed/);
  assert.equal(f.records.size, 0); assert.equal(f.counts().removes, 1);
});

test('late cleanup cannot delete a same-content encrypted replacement with a different creation instance', async () => {
  const f = fixture(), remove = f.ports.custody.remove;
  f.onSourceAssert(count => { if (count === 6) f.mutateState(state => { state.revision++; }); });
  f.ports.custody.remove = async (ctx, input) => {
    // A concurrent authorized discard/recreate happened after the old lease exited.
    f.reseal(input.recordId, record => { record.pin.creationId = 'new_independent_creation'; });
    return remove(ctx, input);
  };
  await assert.rejects(f.export(), code('INTERCHANGE_CUSTODY_CLEANUP_REQUIRED'));
  assert.equal(f.records.size, 1); assert.equal(f.readRecord(EXPORT.destinationId).pin.creationId, 'new_independent_creation');
});

test('all caller destinations and exact review/discard inputs are detached before awaited custody', async () => {
  const f = fixture(), input = { ...EXPORT };
  f.onSourceAssert(count => { if (count === 1) { input.destinationId = 'unreviewed_destination'; input.confirmed = false as any; } });
  const exported = await f.host.export(interchangeOwner, input);
  assert.equal(exported.recordId, EXPORT.destinationId); assert.equal(f.records.has('unreviewed_destination'), false);
  f.onSourceAssert(undefined);
  const prepInput = { ...PREPARE };
  f.onRead(() => { prepInput.exportId = 'changed_export'; prepInput.candidateId = 'changed_candidate'; prepInput.targetId = 'changed_target'; });
  const candidate = await f.host.prepare(interchangeOwner, prepInput);
  assert.equal(candidate.recordId, PREPARE.candidateId); assert.equal(candidate.target?.targetId, PREPARE.targetId);
  const review = { candidateId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest };
  f.onRead(() => { review.candidateId = 'changed_candidate'; review.reviewedDigest = '0'.repeat(64); });
  assert.equal((await f.host.review(interchangeOwner, review)).reviewedDigest, candidate.reviewedDigest);
  const discard = { recordId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest };
  f.onRead(() => { discard.recordId = EXPORT.destinationId; discard.reviewedDigest = '0'.repeat(64); });
  await f.host.discard(interchangeOwner, discard);
  assert.equal(f.records.has(EXPORT.destinationId), true); assert.equal(f.records.has(PREPARE.candidateId), false);
});

test('open export detaches reviewed destination and cleans output after late guard or byte-count failure', async () => {
  const f = fixture(), input = { destinationId: 'original_open', confirmed: true as const };
  f.onSourceAssert(count => { if (count === 1) { input.destinationId = 'changed_open'; } });
  const summary = await f.host.exportPlaintext(interchangeOwner, input);
  assert.equal(summary.destinationId, 'original_open'); assert.equal(f.plaintext.has('changed_open'), false);
  const g = fixture();
  g.onSourceAssert(count => { if (count === 7) g.mutateState(state => { state.revision++; }); });
  await assert.rejects(g.host.exportPlaintext(interchangeOwner, { destinationId: 'late_failed_open', confirmed: true }), code('INTERCHANGE_AUTHORITY_CHANGED'));
  assert.equal(g.plaintext.size, 0);
  const h = fixture(), create = h.ports.plaintext!.create;
  h.ports.plaintext!.create = async (...args) => ({ ...await create(...args), utf8Bytes: 0 });
  await assert.rejects(h.host.exportPlaintext(interchangeOwner, { destinationId: 'bad_measure_open', confirmed: true }), code('INTERCHANGE_HOST_CUSTODY'));
  assert.equal(h.plaintext.size, 0);
});

test('open export reports retained output precisely if exact owned cleanup cannot complete', async () => {
  const f = fixture(), create = f.ports.plaintext!.create;
  f.ports.plaintext!.create = async (...args) => ({ ...await create(...args), utf8Bytes: 0 });
  f.ports.plaintext!.remove = async () => { throw new Error('Synthetic owned open-output cleanup unavailable'); };
  await assert.rejects(f.host.exportPlaintext(interchangeOwner, { destinationId: 'inspect_owned_open', confirmed: true }), code('INTERCHANGE_PLAINTEXT_CLEANUP_REQUIRED'));
  assert.equal(f.plaintext.has('inspect_owned_open'), true);
});

test('open-export cleanup cannot remove identical replacement bytes from another creation instance', async () => {
  const f = fixture(), create = f.ports.plaintext!.create, remove = f.ports.plaintext!.remove;
  f.ports.plaintext!.create = async (...args) => ({ ...await create(...args), utf8Bytes: 0 });
  f.ports.plaintext!.remove = async (ctx, input) => {
    f.plaintextInstances.set(input.destinationId, 'replacement_open_creation');
    return remove(ctx, input);
  };
  await assert.rejects(f.host.exportPlaintext(interchangeOwner, { destinationId: 'retained_replacement', confirmed: true }), code('INTERCHANGE_PLAINTEXT_CLEANUP_REQUIRED'));
  assert.equal(f.plaintext.has('retained_replacement'), true);
  assert.equal(f.plaintextInstances.get('retained_replacement'), 'replacement_open_creation');
});

test('candidate prepare refuses stale independent source pins even when stored wire is internally valid', async () => {
  const f = fixture(); await f.export(); f.mutateState(state => { state.workspace.name = 'Changed current authority'; state.revision++; });
  await assert.rejects(f.prepare(), code('INTERCHANGE_AUTHORITY_CHANGED')); assert.equal(f.counts().creates, 1);
});

test('actual target must be exclusively uninitialized and independently allocated', async () => {
  for (const mutate of [
    (t: ReturnType<typeof emptyTarget>) => { t.authorityRecords = 1; },
    (t: ReturnType<typeof emptyTarget>) => { t.stores.find(store => store.name === 'members')!.records = 1; },
    (t: ReturnType<typeof emptyTarget>) => { t.unexpectedEntries.push('unclassified-retained-entry'); },
    (t: ReturnType<typeof emptyTarget>) => { t.workspaceId = 'workspace_synthetic_source'; },
  ]) {
    const f = fixture(); await f.export(); f.mutateTarget(mutate); await assert.rejects(f.prepare()); assert.equal(f.counts().creates, 1);
  }
  const f = fixture(); await f.export(); await f.prepare();
  await assert.rejects(f.host.prepare(interchangeOwner, { ...PREPARE, candidateId: 'other_candidate' }), code('INTERCHANGE_TARGET_EXISTS'));
});

test('target creation races during candidate custody refuse and remove candidate without touching source/export', async () => {
  const f = fixture(); await f.export(); const original = f.state();
  f.onCreate(() => f.mutateTarget(target => { target.generation = 'superseded_target_fence'; }));
  await assert.rejects(f.prepare(), code('INTERCHANGE_TARGET_CHANGED'));
  assert.equal(f.records.has(EXPORT.destinationId), true); assert.equal(f.records.has(PREPARE.candidateId), false); assert.deepEqual(f.state(), original);
});

test('durable review refuses changed target/current source/context and wrong exact candidate digest', async () => {
  for (const failure of ['target', 'source', 'context', 'digest'] as const) {
    const f = fixture(); await f.export(); const candidate = await f.prepare();
    if (failure === 'target') f.mutateTarget(target => { target.accessDigest = 'b'.repeat(64); });
    if (failure === 'source') f.mutateState(state => { state.policy.sharing = true; });
    const ctx = failure === 'context' ? { ...interchangeOwner, epoch: 2 } : interchangeOwner;
    const expected = { target: 'INTERCHANGE_TARGET_CHANGED', source: 'INTERCHANGE_AUTHORITY_CHANGED', context: 'INTERCHANGE_CONTEXT_CHANGED', digest: 'INTERCHANGE_REVIEW_CHANGED' }[failure];
    await assert.rejects(f.reopen().review(ctx, { candidateId: PREPARE.candidateId, reviewedDigest: failure === 'digest' ? '0'.repeat(64) : candidate.reviewedDigest }), code(expected));
    assert.equal(f.counts().creates, 2);
  }
});

test('independent encrypted pin rejects re-sealed export wire and candidate mutations', async () => {
  const f = fixture(); await f.export();
  f.reseal(EXPORT.destinationId, record => { const packed = JSON.parse(record.content); packed.readable.definitions = '{}'; record.content = canonicalInterchangeJson(packed); });
  await assert.rejects(f.prepare(), code('INTERCHANGE_READABLE'));
  const g = fixture(); await g.export(); const prepared = await g.prepare();
  g.reseal(PREPARE.candidateId, record => { const candidate = JSON.parse(record.content); candidate.targetWorkspaceId = 'invented_target'; record.content = canonicalInterchangeJson(candidate); });
  await assert.rejects(g.reopen().review(interchangeOwner, { candidateId: PREPARE.candidateId, reviewedDigest: prepared.reviewedDigest }), code('INTERCHANGE_REVIEW_CHANGED'));
});

test('ciphertext archive and independent-pin authentication are required on durable reopening', async () => {
  for (const part of ['archive', 'pin'] as const) {
    const f = fixture(); await f.export(); f.records.get(EXPORT.destinationId)![part].data[0] ^= 1;
    await assert.rejects(f.prepare()); assert.equal(f.counts().creates, 1);
  }
});

test('custody record identities cannot be swapped under independently bound record AAD', async () => {
  const f = fixture(); await f.export(); f.records.set('swapped_record', f.records.get(EXPORT.destinationId)!);
  await assert.rejects(f.host.prepare(interchangeOwner, { ...PREPARE, exportId: 'swapped_record' })); assert.equal(f.counts().creates, 1);
});

test('review checks encrypted record again under both held fences and refuses mid-review replacement', async () => {
  const f = fixture(); await f.export(); const candidate = await f.prepare();
  let reads = 0;
  f.onRead(() => { if (++reads === 2) f.reseal(PREPARE.candidateId, record => { record.pin.contextDigest = 'f'.repeat(64); }); });
  await assert.rejects(f.host.review(interchangeOwner, { candidateId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest }), code('INTERCHANGE_CONTEXT_CHANGED'));
});

test('discard survives reopen, checks current complete owner and removes only reviewed archive/pin', async () => {
  const f = fixture(); await f.export(); const candidate = await f.prepare();
  f.setAccess(false); await assert.rejects(f.reopen().discard(interchangeOwner, { recordId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest }), code('ACCESS_REVOKED'));
  assert.equal(f.records.size, 2); f.setAccess(true);
  f.mutateState(state => { state.revision++; state.workspace.name = 'Changed source, owner may still discard historical archive'; });
  const result = await f.reopen().discard(interchangeOwner, { recordId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest });
  assert.deepEqual(result, { discarded: true, recordId: PREPARE.candidateId });
  assert.equal(f.records.has(PREPARE.candidateId), false); assert.equal(f.records.has(EXPORT.destinationId), true);
  assert.equal(f.target().workspaceId, 'workspace_synthetic_empty_target');
});

test('malformed or incomplete host custody and boolean async guard admission refuse', async () => {
  assert.throws(() => new WorkspaceInterchangeHost({} as any), code('INTERCHANGE_HOST_REQUIRED'));
  const f = fixture(); f.setLease({ assertCompleteOwner: async () => true as any });
  await assert.rejects(f.export(), code('INTERCHANGE_HOST_GUARD')); assert.equal(f.counts().creates, 0);
  const g = fixture(); const ports = { ...g.ports, withSource: async () => ({ fabricated: true }) as any };
  await assert.rejects(new WorkspaceInterchangeHost(ports).export(interchangeOwner, EXPORT), code('INTERCHANGE_HOST_CUSTODY'));
});

test('unmeasured custody and a failed exact orphan cleanup are reported without success claims', async () => {
  const f = fixture(); const create = f.ports.custody.create;
  f.ports.custody.create = async (ctx, record) => ({ ...await create(ctx, record), archiveCiphertextBytes: 0 });
  await assert.rejects(f.export(), code('INTERCHANGE_HOST_CUSTODY')); assert.equal(f.records.size, 0);
  const g = fixture(); g.onCreate(() => g.setAccess(false));
  g.ports.custody.remove = async () => { throw new Error('Synthetic exact cleanup was unavailable'); };
  await assert.rejects(g.export(), code('INTERCHANGE_CUSTODY_CLEANUP_REQUIRED')); assert.equal(g.records.size, 1);
});
