import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../runtime/contracts.ts';
import { reconcileSyncPublication } from '../runtime/sync-publication-recovery.ts';
import type { SyncPublicationExpected } from '../runtime/sync-publication-recovery.ts';
import type { SyncHead, SyncSnapshot } from '../runtime/sync.ts';

// In-memory source fixtures only: these signatures and payloads do not qualify a
// signer, encrypted vault, native filesystem, cloud folder, or second device.
function snapshot(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
  const ciphertextBase64 = Buffer.from('opaque ciphertext fixture').toString('base64');
  return { format: 'chausar.sync.v1', workspaceId: 'workspace-fixture', vaultId: 'vault-fixture',
    revision: 10, sequence: 1, fence: 1, deviceId: 'device-fixture', signerId: 'signer-fixture',
    memberId: 'owner', epoch: 1, createdAt: '2026-10-01T00:00:00.000Z', previousHash: null,
    ciphertextBase64, ciphertextDigest: hash(ciphertextBase64), signature: 'unverified-fixture', ...overrides };
}
const headOf = (record: SyncSnapshot): SyncHead => ({ recordHash: hash(record), workspaceId: record.workspaceId,
  vaultId: record.vaultId, revision: record.revision, sequence: record.sequence, fence: record.fence });
const expectedOf = (record: SyncSnapshot): SyncPublicationExpected => ({ ...headOf(record), expectedHeadHash: record.previousHash });

class MemoryTransport {
  head: SyncHead | null = null;
  records = new Map<string, SyncSnapshot>();
  writes = 0;
  reads: string[] = [];
  async getHead() { return this.head; }
  async get(recordHash: string) { this.reads.push(recordHash); return this.records.get(recordHash) ?? null; }
  async acquireLease(): Promise<never> { this.writes++; throw new Error('reconciliation must not acquire a lease'); }
  async put(): Promise<never> { this.writes++; throw new Error('reconciliation must not publish'); }
  observe(record: SyncSnapshot) { this.records.set(hash(record), record); this.head = headOf(record); }
}

function chain() {
  const first = snapshot();
  const second = snapshot({ revision: 20, sequence: 2, fence: 2, previousHash: hash(first) });
  const third = snapshot({ revision: 30, sequence: 3, fence: 3, previousHash: hash(second) });
  const transport = new MemoryTransport();
  for (const record of [first, second, third]) transport.observe(record);
  return { first, second, third, transport };
}

test('lost acknowledgement reconciles to the exact observed head without writing', async () => {
  const transport = new MemoryTransport(); const record = snapshot();
  // The application lost its acknowledgement after the fixture committed.
  transport.observe(record);
  const result = await reconcileSyncPublication(transport, expectedOf(record));
  assert.deepEqual(result, { status: 'published', reason: 'HEAD_MATCH', recordHash: hash(record),
    observedHead: headOf(record), recordsRead: 1, automaticResubmission: false });
  assert.equal(transport.writes, 0);
});

test('an advanced head proves publication through exact predecessor links', async () => {
  const { first, third, transport } = chain();
  const result = await reconcileSyncPublication(transport, expectedOf(first));
  assert.equal(result.status, 'published'); assert.equal(result.reason, 'ANCESTOR_MATCH');
  assert.equal(result.recordsRead, 3); assert.deepEqual(result.observedHead, headOf(third));
  assert.deepEqual(transport.reads, [hash(first), hash(third), third.previousHash]);
  assert.equal(transport.writes, 0); assert.equal(result.automaticResubmission, false);
});

test('orphan ciphertext is not proof that a head was published', async () => {
  const record = snapshot(); const transport = new MemoryTransport(); transport.records.set(hash(record), record);
  const result = await reconcileSyncPublication(transport, expectedOf(record));
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'ORPHAN_RECORD');
  assert.equal(result.automaticResubmission, false); assert.equal(transport.writes, 0);
});

test('absent blob with empty unchanged head is not observed and cannot resubmit', async () => {
  const transport = new MemoryTransport(); const result = await reconcileSyncPublication(transport, expectedOf(snapshot()));
  assert.deepEqual(result, { status: 'not-observed', reason: 'HEAD_UNCHANGED_RECORD_ABSENT',
    observedHead: null, recordsRead: 1, automaticResubmission: false });
  assert.equal(transport.writes, 0);
});

test('unchanged nonempty head distinguishes an absent record from an orphan', async () => {
  const { first, second } = chain(); const transport = new MemoryTransport(); transport.observe(first);
  const absent = await reconcileSyncPublication(transport, expectedOf(second));
  assert.equal(absent.status, 'not-observed'); assert.equal(absent.automaticResubmission, false);
  transport.records.set(hash(second), second);
  const orphan = await reconcileSyncPublication(transport, expectedOf(second));
  assert.equal(orphan.status, 'unknown'); assert.equal(orphan.reason, 'ORPHAN_RECORD');
  assert.equal(transport.writes, 0);
});

test('head changed without publication proof remains unknown, whether blob exists or not', async () => {
  const record = snapshot(); const unrelated = snapshot({ revision: 15, fence: 2, deviceId: 'other-device' });
  const transport = new MemoryTransport(); transport.observe(unrelated);
  for (const exists of [false, true]) {
    if (exists) transport.records.set(hash(record), record);
    const result = await reconcileSyncPublication(transport, expectedOf(record));
    assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'HEAD_CHANGED_UNPROVEN');
    assert.equal(result.automaticResubmission, false);
  }
  assert.equal(transport.writes, 0);
});

test('incomplete ancestry cannot turn an orphan into publication evidence', async () => {
  const { first, second, transport } = chain(); transport.records.delete(hash(second));
  const result = await reconcileSyncPublication(transport, expectedOf(first));
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'CHAIN_INCOMPLETE');
  assert.equal(result.recordsRead, 3); assert.equal(transport.writes, 0);
});

test('a head pointing at the expected hash still requires the exact record', async () => {
  const record = snapshot(); const transport = new MemoryTransport(); transport.head = headOf(record);
  const result = await reconcileSyncPublication(transport, expectedOf(record));
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'CHAIN_INCOMPLETE');
});

test('exact expectation metadata and predecessor hash are required', async () => {
  const { second, transport } = chain(); transport.head = headOf(second);
  for (const changes of [{ revision: 21 }, { sequence: 3 }, { fence: 3 }, { expectedHeadHash: 'a'.repeat(64) }]) {
    const result = await reconcileSyncPublication(transport, { ...expectedOf(second), ...changes });
    assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'EXPECTED_RECORD_MISMATCH');
  }
  for (const changes of [{ workspaceId: 'other-workspace' }, { vaultId: 'other-vault' }]) {
    const result = await reconcileSyncPublication(transport, { ...expectedOf(second), ...changes });
    assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'IDENTITY_MISMATCH');
  }
});

test('the head must identify its record with all exact metadata', async () => {
  for (const changes of [{ revision: 99 }, { sequence: 2 }, { fence: 2 }]) {
    const record = snapshot(); const transport = new MemoryTransport(); transport.observe(record);
    Object.assign(transport.head!, changes);
    const result = await reconcileSyncPublication(transport, expectedOf(record));
    assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'HEAD_RECORD_MISMATCH');
  }
});

test('ancestry requires strictly increasing revisions, exact sequence and nondecreasing fences', async () => {
  const first = snapshot({ fence: 4 });
  for (const changes of [{ revision: 10 }, { sequence: 3 }, { fence: 3 }]) {
    const descendant = snapshot({ revision: 20, sequence: 2, fence: 4, previousHash: hash(first), ...changes });
    const transport = new MemoryTransport(); transport.observe(first); transport.observe(descendant);
    const result = await reconcileSyncPublication(transport, expectedOf(first));
    assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'CHAIN_INVALID');
  }
  const equalFence = snapshot({ revision: 20, sequence: 2, fence: 4, previousHash: hash(first) });
  const transport = new MemoryTransport(); transport.observe(first); transport.observe(equalFence);
  assert.equal((await reconcileSyncPublication(transport, expectedOf(first))).status, 'published');
});

test('ancestry cannot cross workspace or vault identities', async () => {
  for (const changes of [{ workspaceId: 'other-workspace' }, { vaultId: 'other-vault' }]) {
    const first = snapshot(); const middle = snapshot({ revision: 20, sequence: 2, previousHash: hash(first), ...changes });
    const tip = snapshot({ revision: 30, sequence: 3, previousHash: hash(middle) });
    const transport = new MemoryTransport(); for (const record of [first, middle, tip]) transport.observe(record);
    const result = await reconcileSyncPublication(transport, expectedOf(first));
    assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'IDENTITY_MISMATCH');
  }
});

test('records and expectations are detached from mutable adapter objects across awaits', async () => {
  const { first, third, transport } = chain(); const expected = expectedOf(first);
  let resume!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const originalGet = transport.get.bind(transport);
  transport.get = async recordHash => {
    if (recordHash === hash(third)) { entered(); await gate; }
    return originalGet(recordHash);
  };
  const capturedHead = structuredClone(transport.head); const pending = reconcileSyncPublication(transport, expected);
  await waiting;
  first.revision = 999; expected.revision = 999; transport.head!.revision = 999;
  resume(); const result = await pending;
  assert.equal(result.status, 'published'); assert.equal(result.reason, 'ANCESTOR_MATCH');
  assert.deepEqual(result.observedHead, capturedHead); assert.notEqual(result.observedHead, transport.head);
  assert.equal(Object.isFrozen(result.observedHead), true); assert.equal(Object.isFrozen(result), true);
});

test('expected metadata is captured before even the first head read settles', async () => {
  const record = snapshot(); const transport = new MemoryTransport(); transport.observe(record);
  let resume!: () => void;
  transport.getHead = () => new Promise<SyncHead | null>(resolve => { resume = () => resolve(transport.head); });
  const expected = expectedOf(record); const pending = reconcileSyncPublication(transport, expected);
  expected.revision = 999; resume();
  assert.equal((await pending).status, 'published');
});

test('corrupt content addressing, ciphertext digests and malformed records stay unknown', async () => {
  const record = snapshot(); const transport = new MemoryTransport(); transport.observe(record);
  const expected = expectedOf(record); record.signature = 'changed-after-content-addressing';
  const changed = await reconcileSyncPublication(transport, expected);
  assert.equal(changed.status, 'unknown'); assert.equal(changed.reason, 'RECORD_HASH_MISMATCH');
  const wrongDigest = snapshot({ ciphertextDigest: 'b'.repeat(64) }); transport.observe(wrongDigest);
  const corrupt = await reconcileSyncPublication(transport, expectedOf(wrongDigest));
  assert.equal(corrupt.status, 'unknown'); assert.equal(corrupt.reason, 'CIPHERTEXT_DIGEST_MISMATCH');
  const malformed = snapshot({ format: 'other-format' as SyncSnapshot['format'] }); transport.observe(malformed);
  const invalid = await reconcileSyncPublication(transport, expectedOf(malformed));
  assert.equal(invalid.status, 'unknown'); assert.equal(invalid.reason, 'RECORD_INVALID');
});

test('adapter errors and unclonable results return safe codes without error payloads', async () => {
  const expected = expectedOf(snapshot());
  const sensitive = new Error('fixture private path and ciphertext must not leak');
  const headError = await reconcileSyncPublication({ getHead: async () => { throw sensitive; }, get: async () => null }, expected);
  assert.equal(headError.reason, 'HEAD_UNREADABLE');
  const recordError = await reconcileSyncPublication({ getHead: async () => null, get: async () => { throw sensitive; } }, expected);
  assert.equal(recordError.reason, 'RECORD_UNREADABLE');
  const unclonable = snapshot() as SyncSnapshot & { extra?: () => void }; unclonable.extra = () => {};
  const cloneError = await reconcileSyncPublication({ getHead: async () => null, get: async () => unclonable }, expected);
  assert.equal(cloneError.reason, 'RECORD_UNREADABLE');
  for (const result of [headError, recordError, cloneError]) {
    assert.equal(result.status, 'unknown'); assert.equal(result.automaticResubmission, false);
    assert.equal(JSON.stringify(result).includes(sensitive.message), false);
    assert.equal(JSON.stringify(result).includes('ciphertextBase64'), false);
  }
});

test('malformed head metadata fails before reading any blob', async () => {
  const record = snapshot(); const transport = new MemoryTransport(); transport.head = { ...headOf(record), fence: NaN };
  const result = await reconcileSyncPublication(transport, expectedOf(record));
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'HEAD_INVALID');
  assert.equal(result.recordsRead, 0); assert.deepEqual(transport.reads, []);
});

test('record bound caps all unique reads including the expected blob', async () => {
  const { first, transport } = chain();
  const bounded = await reconcileSyncPublication(transport, expectedOf(first), { maxRecords: 2 });
  assert.equal(bounded.status, 'unknown'); assert.equal(bounded.reason, 'CHAIN_BOUND');
  assert.equal(bounded.recordsRead, 2); assert.equal(transport.reads.length, 2);
  transport.reads = [];
  const complete = await reconcileSyncPublication(transport, expectedOf(first), { maxRecords: 3 });
  assert.equal(complete.status, 'published'); assert.equal(complete.recordsRead, 3);
  assert.equal(transport.writes, 0);
});

test('invalid expectations and bounds do not perform adapter reads', async () => {
  const transport = new MemoryTransport();
  for (const changes of [{ recordHash: '../unsafe-path' }, { revision: -1 }, { sequence: 0 }, { fence: 0 },
    { expectedHeadHash: 'c'.repeat(64) }, { workspaceId: '' }]) {
    const result = await reconcileSyncPublication(transport, { ...expectedOf(snapshot()), ...changes });
    assert.equal(result.reason, 'INVALID_EXPECTATION'); assert.equal(result.recordsRead, 0);
  }
  for (const maxRecords of [0, -1, 1.5, Infinity, 1025]) {
    const result = await reconcileSyncPublication(transport, expectedOf(snapshot()), { maxRecords });
    assert.equal(result.reason, 'INVALID_BOUND'); assert.equal(result.recordsRead, 0);
  }
  assert.deepEqual(transport.reads, []); assert.equal(transport.writes, 0);
});

test('transport publication evidence does not certify fixture signatures or writer admission', async () => {
  const record = snapshot({ signerId: 'not-trusted', signature: 'not-a-valid-signature', memberId: 'revoked-fixture-member' });
  const transport = new MemoryTransport(); transport.observe(record);
  const result = await reconcileSyncPublication(transport, expectedOf(record));
  assert.equal(result.status, 'published'); assert.equal(result.automaticResubmission, false);
  assert.equal(transport.writes, 0);
});
