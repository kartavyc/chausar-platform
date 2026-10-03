import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { ImportService, type ImportInput, type MappingRecipe } from '../runtime/ingest.ts';
import { LearningService, assertLearningDecisionRecord, type LearningDecision } from '../runtime/learning.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';

// Actual services over an authored, serialized memory store. These cases do not
// qualify native storage, HTTP, providers, an export receiver or desktop behavior.
class MemoryStore implements StateStore {
  state = initialState('Synthetic refused-import cleanup', true);
  #tail: Promise<void> = Promise.resolve();
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const pending = this.#tail.then(async () => {
      const draft = this.read(), result = await change(draft);
      draft.revision++;
      this.state = draft;
      return result;
    });
    this.#tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const sourceId = 'PRIVATE_REFUSED_SOURCE_IDENTIFIER';
const recipe: MappingRecipe = {
  version: 1, id: 'PRIVATE_RECIPE_IDENTIFIER', system: 'synthetic-csv', edition: '1',
  scope: { company: 'PRIVATE_COMPANY_NAME', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'PRIVATE_AMOUNT_HEADER', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    ...['currency', 'branch', 'status', 'description', 'customerId', 'customerName', 'invoiceId'].map(target => ({ target, source: target, type: 'string' as const, nulls: 'reject' as const })),
  ],
  allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject',
};
const input: ImportInput = {
  sourceId, format: 'csv', recipe,
  content: 'id,kind,date,PRIVATE_AMOUNT_HEADER,currency,branch,status,description,customerId,customerName,invoiceId\nPRIVATE_ENTITY_IDENTIFIER,invoice,2026-09-01,123.45,INR,main,issued,PRIVATE_DESCRIPTION,PRIVATE_CUSTOMER_IDENTIFIER,PRIVATE_CUSTOMER_NAME,PRIVATE_INVOICE_IDENTIFIER',
  // The authored file contains one row and 12,345 minor units. This mismatch
  // creates a real reconciliation refusal, never an accepted import or fact.
  expectedTotals: { rowCount: 2, amountMinor: '12345' },
};
const contentHash = createHash('sha256').update(input.content).digest('hex');

async function fixture() {
  const store = new MemoryStore(), trust = new TrustService(store);
  await new OntologyService(store).publish(owner, 'ecommerce');
  const member = await trust.addMember(owner, { name: 'Synthetic import author', role: 'cofounder', branches: ['main'] });
  const importer: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  const imports = new ImportService(store), learning = new LearningService(store);
  const existingLearning = store.read().learning;
  assert.ok(existingLearning.some(item => item.category === 'dictionary' && item.decision === 'published'));
  await assert.rejects(imports.commit(importer, structuredClone(input)), { code: 'IMPORT_REFUSED' });
  const state = store.read();
  assert.equal(state.facts.length, 0);
  assert.equal(state.imports.length, 0);
  const decisions = state.learning.filter(item => item.type === 'decision');
  assert.equal(decisions.length, 1);
  assert.deepEqual(state.learning.filter(item => item.type !== 'decision'), existingLearning);
  const event = decisions[0];
  assertLearningDecisionRecord(event);
  assert.equal(event.memberId, importer.memberId);
  assert.equal(event.role, 'cofounder');
  assert.equal(event.epoch, 1);
  assert.equal(event.input.choice, 'rejected');
  assert.deepEqual(event.sourceIds, [sourceId]);
  assert.deepEqual(event.rowIds, []);
  const identity = event.importIdentity;
  assert.ok(identity);
  assert.equal(identity.outcome, 'rejected');
  assert.equal(identity.contentHash, contentHash);
  assert.deepEqual(identity.branches, ['main']);
  return { store, trust, imports, learning, importer, event, identity, existingLearning };
}

function assertNoPurge(before: State, after: State) {
  for (const key of ['facts', 'imports', 'learning', 'tombstones', 'unsupported'] as const) {
    assert.deepEqual(after[key], before[key], `${key} changed despite refusal`);
  }
  assert.equal(after.activity.filter(item => item.event === 'trust.source.deleted').length,
    before.activity.filter(item => item.event === 'trust.source.deleted').length);
  assert.equal(after.activity.filter(item => item.event === 'trust.retention.cleaned').length,
    before.activity.filter(item => item.event === 'trust.retention.cleaned').length);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('a current wildcard owner erases canonical refusal lineage after the original author is revoked', async () => {
  const f = await fixture();
  const preview = await f.learning.preview(owner, [f.event.id]);
  assert.deepEqual(preview.payload, { schema: 'chausar.structure.v1', events: [{
    kind: 'mapping', choice: 'rejected', reasonCode: 'reconciliation', fields: [
      { name: 'amount', type: 'decimal' }, { name: 'branch', type: 'string' },
      { name: 'currency', type: 'string' }, { name: 'customer_id', type: 'string' },
      { name: 'date', type: 'date' }, { name: 'description', type: 'string' },
      { name: 'invoice_id', type: 'string' }, { name: 'status', type: 'string' },
    ], reportShape: 'ledger',
  }] });
  for (const value of ['PRIVATE_', '12345', '123.45', '2026-09-01', 'main', 'issued', 'INR']) {
    assert.equal(JSON.stringify(preview.payload).includes(value), false, value);
  }
  assert.equal(f.store.read().policy.sharing, false);
  assert.equal(f.learning.exporter, undefined);
  await f.trust.revokeMember(owner, f.importer.memberId);
  assert.deepEqual(f.learning.list(owner), []);
  await assert.rejects(f.learning.preview(owner, [f.event.id]), { code: 'ACCESS_REVOKED' });
  const result = await f.trust.deleteSource(owner, sourceId);
  assert.equal(result.sourceId, sourceId);
  assert.equal(result.removed, 2);
  const state = f.store.read();
  assert.deepEqual(state.learning, f.existingLearning, 'Source erasure must preserve unrelated dictionary learning.');
  assert.deepEqual(state.facts, []);
  assert.deepEqual(state.imports, []);
  assert.ok(state.tombstones.some(item => item.kind === 'source' && item.sourceId === sourceId));
  assert.ok(state.tombstones.some(item => item.kind === 'content' && item.sourceId === sourceId && item.contentHash === contentHash));
  const renamed: ImportInput = { ...structuredClone(input), sourceId: 'PRIVATE_RENAMED_DELETED_SOURCE', expectedTotals: { rowCount: 1, amountMinor: '12345' } };
  await assert.rejects(f.imports.commit(owner, renamed), { code: 'SOURCE_DELETED' });
  assert.deepEqual(f.store.read(), state, 'Deleting refusal history must also prevent a content resend under a new source name.');
});

for (const role of ['owner', 'cofounder'] as const) {
  test(`a branch-limited ${role} cannot erase a refused-only source even when its recorded branch matches`, async () => {
    const f = await fixture();
    const member = await f.trust.addMember(owner, { name: 'Synthetic limited administrator', role, branches: ['main'] });
    const context: Context = { memberId: member.id, role: member.role, epoch: member.epoch };
    const before = f.store.read();
    await assert.rejects(f.trust.deleteSource(context, sourceId), { code: 'SOURCE_DELETE_SCOPE_FORBIDDEN' });
    assert.deepEqual(f.store.read(), before);
  });
}

test('current source revocation prevents deletion of an otherwise canonical refused-only source', async () => {
  const f = await fixture();
  await f.trust.grantSource(owner, { sourceId, revoked: true });
  const before = f.store.read();
  await assert.rejects(f.trust.deleteSource(owner, sourceId), { code: 'SOURCE_REVOKED' });
  assert.deepEqual(f.store.read(), before);
});

test('a revoked wildcard administrator cannot delete canonical refusal history', async () => {
  const f = await fixture();
  const member = await f.trust.addMember(owner, { name: 'Synthetic erasure administrator', role: 'cofounder', branches: ['*'] });
  const context: Context = { memberId: member.id, role: member.role, epoch: member.epoch };
  await f.trust.revokeMember(owner, member.id);
  const before = f.store.read();
  await assert.rejects(f.trust.deleteSource(context, sourceId), { code: 'ACCESS_REVOKED' });
  assert.deepEqual(f.store.read(), before);
});

const corruptions: { name: string; change: (event: LearningDecision) => void }[] = [
  { name: 'changed nested content hash without its bound envelope', change: event => { event.importIdentity!.contentHash = '0'.repeat(64); } },
  { name: 'resigned source roots that disagree with input and import identity', change: event => {
    event.sourceIds = [];
    const { recordIntegrity: ignored, ...record } = event;
    event.recordIntegrity = digest(record);
  } },
  { name: 'a legacy record version even with recomputed envelope integrity', change: event => {
    (event as unknown as { recordVersion: number }).recordVersion = 0;
    const { recordIntegrity: ignored, ...record } = event;
    event.recordIntegrity = digest(record);
  } },
  { name: 'missing import format with recomputed envelope integrity', change: event => {
    delete (event.importIdentity as unknown as { format?: string }).format;
    const { recordIntegrity: ignored, ...record } = event;
    event.recordIntegrity = digest(record);
  } },
  { name: 'an unknown import format with recomputed envelope integrity', change: event => {
    event.importIdentity!.format = 'javascript-runner';
    const { recordIntegrity: ignored, ...record } = event;
    event.recordIntegrity = digest(record);
  } },
  { name: 'a malformed attempt UUID with recomputed envelope integrity', change: event => {
    event.importIdentity!.id = 'importattempt_' + '-'.repeat(36);
    const { recordIntegrity: ignored, ...record } = event;
    event.recordIntegrity = digest(record);
  } },
  { name: 'an empty decision ID with recomputed envelope integrity', change: event => {
    event.id = '';
    const { recordIntegrity: ignored, ...record } = event;
    event.recordIntegrity = digest(record);
  } },
  { name: 'an empty historical author ID with recomputed envelope integrity', change: event => {
    event.memberId = '';
    const { recordIntegrity: ignored, ...record } = event;
    event.recordIntegrity = digest(record);
  } },
];
for (const corruption of corruptions) {
  test(`${corruption.name} cannot establish refused-only source existence`, async () => {
    const f = await fixture();
    await f.store.update(state => {
      const event = state.learning.find(item => item.id === f.event.id);
      assert.ok(event);
      corruption.change(event);
    });
    const before = f.store.read();
    await assert.rejects(f.trust.deleteSource(owner, sourceId), { code: 'SOURCE_NOT_FOUND' });
    assert.deepEqual(f.store.read(), before);
  });
}

const queuedChanges: { name: string; code: string; change: (state: State, memberId: string) => void }[] = [
  { name: 'administrator epoch revocation', code: 'ACCESS_REVOKED', change: (state, memberId) => {
    const member = state.members.find(item => item.id === memberId)!;
    member.active = false; member.epoch++;
  } },
  { name: 'loss of current wildcard branches', code: 'SOURCE_DELETE_SCOPE_FORBIDDEN', change: (state, memberId) => {
    state.members.find(item => item.id === memberId)!.branches = ['main'];
  } },
  { name: 'source policy revocation', code: 'SOURCE_REVOKED', change: state => { state.policy.allowedSources = []; } },
];
for (const change of queuedChanges) {
  test(`an admitted deletion rechecks ${change.name} after entering the writer queue`, async () => {
    const f = await fixture();
    const member = await f.trust.addMember(owner, { name: 'Synthetic queued administrator', role: 'cofounder', branches: ['*'] });
    const context: Context = { memberId: member.id, role: member.role, epoch: member.epoch };
    const entered = deferred(), release = deferred();
    const mutation = f.store.update(async state => {
      entered.resolve(); await release.promise; change.change(state, member.id);
    });
    await entered.promise;
    const before = f.store.read();
    const deletion = f.trust.deleteSource(context, sourceId);
    const refusal = assert.rejects(deletion, { code: change.code });
    release.resolve();
    await mutation;
    await refusal;
    assertNoPurge(before, f.store.read());
  });
}

test('queued retention rechecks the current owner wildcard before removing refusal history', async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const mutation = f.store.update(async state => {
    entered.resolve(); await release.promise;
    state.members.find(item => item.id === owner.memberId)!.branches = ['main'];
  });
  await entered.promise;
  const before = f.store.read(), at = new Date(Date.parse(f.event.at) + 91 * 86400000);
  const cleanup = f.trust.cleanup(owner, at);
  const refusal = assert.rejects(cleanup, { code: 'RETENTION_SCOPE_FORBIDDEN' });
  release.resolve();
  await mutation;
  await refusal;
  assertNoPurge(before, f.store.read());
});

test('current source revocation refuses retention of canonical refused-only history without purge effects', async () => {
  const f = await fixture();
  await f.trust.grantSource(owner, { sourceId, revoked: true });
  const before = f.store.read();
  await assert.rejects(f.trust.cleanup(owner, new Date(Date.parse(f.event.at) + 91 * 86400000)), { code: 'SOURCE_REVOKED' });
  assert.deepEqual(f.store.read(), before);
});

test('queued retention rechecks a source grant revoked through TrustService before its writer turn', async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const heldWriter = f.store.update(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const before = f.store.read();
  const revocation = f.trust.grantSource(owner, { sourceId, revoked: true });
  const cleanup = f.trust.cleanup(owner, new Date(Date.parse(f.event.at) + 91 * 86400000));
  const refusal = assert.rejects(cleanup, { code: 'SOURCE_REVOKED' });
  release.resolve();
  await heldWriter;
  await revocation;
  await refusal;
  assertNoPurge(before, f.store.read());
  assert.ok(f.store.read().sourceRules.some(rule => rule.sourceId === sourceId && rule.revoked === true));
});

test('retention erases a revoked author refusal, tombstones nested content identity and rejects a renamed resend', async () => {
  const f = await fixture();
  const preview = await f.learning.preview(owner, [f.event.id]);
  await f.trust.revokeMember(owner, f.importer.memberId);
  assert.deepEqual(f.learning.list(owner), []);
  const cleaned = await f.trust.cleanup(owner, new Date(Date.parse(f.event.at) + 91 * 86400000));
  // The dictionary publication, refused decision and its preview all expired.
  assert.equal(cleaned.removed, 3);
  const state = f.store.read();
  assert.ok(!state.learning.some(item => item.id === f.event.id || item.id === preview.id));
  assert.deepEqual(state.facts, []);
  assert.deepEqual(state.imports, []);
  assert.ok(state.tombstones.some(item => item.kind === 'retention' && item.contentHash === contentHash));
  assert.equal(state.tombstones.some(item => item.kind === 'source'), false);
  const renamed: ImportInput = { ...structuredClone(input), sourceId: 'PRIVATE_RENAMED_SOURCE_IDENTIFIER', expectedTotals: { rowCount: 1, amountMinor: '12345' } };
  await assert.rejects(f.imports.commit(owner, renamed), { code: 'SOURCE_DELETED' });
  assert.deepEqual(f.store.read(), state, 'Previously erased content must not create facts, imports or a new refusal record.');
});
