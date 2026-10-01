import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, hash, initialState, type Fact, type State, type StateStore } from '../runtime/contracts.ts';
import { insertFacts, selectFacts, type FactInput } from '../runtime/memory.ts';
import {
  producerReplacementOutputDigest, producerReplacementPins, publishProducerReplacement,
  type ProducerReplacementHost, type ProducerReplacementRequest,
} from '../runtime/producer-replacement.ts';

// Synthetic draft tests. No Vault, native database, connector/model transport or GUI qualification.
const SOURCE = 'synthetic-producer';
const OTHER = 'synthetic-other';
const T0 = '2026-01-01T00:00:00.000Z', T1 = '2026-01-02T00:00:00.000Z', T2 = '2026-01-03T00:00:00.000Z', T3 = '2026-01-04T00:00:00.000Z';
const OWNER = { memberId: 'owner', role: 'owner', epoch: 1 } as const;
const INPUT = hash('authenticated synthetic full input'), RECIPE = hash('reviewed synthetic recipe');
function output(entityId: string, amountMinor: string, sourceRow = 1, sourceId = SOURCE): FactInput {
  return { entityId, sourceId, sourceRow, kind: 'invoice', validFrom: '2025-12-31', fields: { amountMinor, currency: 'INR', customerId: 'synthetic-customer' } };
}
function fixture(): State {
  const state = initialState('Synthetic producer replacement', true);
  insertFacts(state, [output('a', '100'), output('b', '200', 2), output('other', '700', 1, OTHER)], T0);
  state.imports.push({ id: 'retained-source-import', sourceId: SOURCE, contentHash: INPUT, recipeHash: RECIPE, rowIds: state.facts.filter(item => item.sourceId === SOURCE).map(item => item.id), retainedInput: { generation: 1, complete: true, digest: INPUT } });
  state.receipts.push({ id: 'synthetic-receipt', stale: false, sourceIds: [SOURCE] }); state.answers.push({ id: 'synthetic-answer', stale: false });
  return state;
}
function request(state: State, outputs: FactInput[], publishedAt = T1): ProducerReplacementRequest {
  return {
    version: 1, complete: true, sourceId: SOURCE, expected: producerReplacementPins(state, SOURCE), publishedAt, outputs: structuredClone(outputs),
    custody: { inputDigest: INPUT, recipeDigest: RECIPE, outputDigest: producerReplacementOutputDigest(outputs) },
    controls: { rowCount: outputs.length, sums: [{ field: 'amountMinor', minor: String(outputs.reduce((sum, item) => sum + BigInt(String(item.fields.amountMinor)), 0n)) }] },
    ...(outputs.length ? {} : { justifiedEmpty: { reason: 'Authenticated complete synthetic input contains no producer rows.', evidenceDigest: INPUT } }),
  };
}
const host: ProducerReplacementHost = { assertCustody: (_state, publication) => {
  assert.equal(publication.custody.inputDigest, INPUT); assert.equal(publication.custody.recipeDigest, RECIPE);
  if (publication.outputs.length === 0) assert.equal(publication.justifiedEmpty?.evidenceDigest, INPUT);
} };
function visible(state: State, asOf: string): Fact[] {
  const store: StateStore = { read: () => structuredClone(state), update: async () => { throw new Error('Selection must not update the draft.'); } };
  return selectFacts(store, OWNER, { asOf }).facts;
}
function sourceIds(state: State, asOf: string): string[] { return visible(state, asOf).filter(item => item.sourceId === SOURCE).map(item => item.entityId).sort(); }
function refusal(state: State, publication: ProducerReplacementRequest, code: string, assertions = host): void {
  const before = structuredClone(state);
  assert.throws(() => publishProducerReplacement(state, publication, assertions), (error: unknown) => error instanceof ChausarError && error.code === code);
  assert.deepEqual(state, before, 'Refusal must not modify any draft store.');
}

test('complete replacement proves 2 → 1 → justified empty → reinstated through public as-known selection', () => {
  const state = fixture(), original = structuredClone(state), originalImport = structuredClone(state.imports[0]);
  const a = state.facts.find(item => item.entityId === 'a')!, b = state.facts.find(item => item.entityId === 'b')!;
  const first = publishProducerReplacement(state, request(state, [output('a', '100')]), host);
  assert.equal(first.generation, 1); assert.equal(first.previousGeneration, 0); assert.equal(first.qualification, 'experimental-source-replacement');
  assert.deepEqual(first.lineage.map(item => item.status).sort(), ['retained', 'retracted']);
  assert.equal(a.supersededAt, null); assert.equal(b.supersededAt, T1); assert.equal(state.facts.length, 3);
  assert.deepEqual(sourceIds(state, T0), ['a', 'b']); assert.deepEqual(sourceIds(state, T1), ['a']);
  assert.deepEqual(first.staleArtifactIds, ['synthetic-answer']); assert.deepEqual(first.affectedReceiptIds, ['synthetic-receipt']);
  assert.ok(state.answers[0].stale); assert.deepEqual(state.receipts, original.receipts);
  const empty = publishProducerReplacement(state, request(state, [], T2), host);
  assert.equal(empty.generation, 2); assert.equal(empty.lineage[0].status, 'retracted'); assert.equal(a.supersededAt, T2);
  assert.deepEqual(sourceIds(state, T0), ['a', 'b']); assert.deepEqual(sourceIds(state, T1), ['a']); assert.deepEqual(sourceIds(state, T2), []);
  const restored = publishProducerReplacement(state, request(state, [output('a', '100')], T3), host);
  assert.equal(restored.generation, 3); assert.equal(restored.lineage[0].status, 'reinstated');
  const newA = state.facts.at(-1)!; assert.notEqual(newA.id, a.id); assert.equal(newA.learnedAt, T3); assert.equal(newA.supersededAt, null);
  assert.deepEqual(restored.lineage[0].previousFactIds, [a.id]); assert.equal(restored.lineage[0].nextFactId, newA.id);
  assert.deepEqual(sourceIds(state, T0), ['a', 'b']); assert.deepEqual(sourceIds(state, T1), ['a']); assert.deepEqual(sourceIds(state, T2), []); assert.deepEqual(sourceIds(state, T3), ['a']);
  assert.deepEqual(state.imports[0], originalImport); assert.deepEqual(state.receipts, original.receipts); assert.deepEqual(state.facts.filter(item => item.sourceId === OTHER), original.facts.filter(item => item.sourceId === OTHER));
  assert.equal(producerReplacementPins(state, SOURCE).relationDigest, restored.relationDigest);
});

test('changed relation retracts every prior live version and preserves historical values and other producers', () => {
  const state = fixture(); const previous = { ...structuredClone(state.facts[0]), id: 'synthetic-older-a', learnedAt: '2025-12-30T00:00:00.000Z', fields: { ...state.facts[0].fields, amountMinor: '50' } };
  state.facts.unshift(previous); const before = structuredClone(state.facts);
  const record = publishProducerReplacement(state, request(state, [output('a', '900719925474099300'), output('c', '25', 3)]), host);
  const newA = state.facts.find(item => item.entityId === 'a' && item.learnedAt === T1)!;
  assert.equal(newA.fields.amountMinor, '900719925474099300'); assert.equal(record.controls.sums[0].minor, '900719925474099325');
  assert.equal(state.facts[0].supersededAt, T1); assert.equal(state.facts[1].supersededAt, T1); assert.equal(state.facts[2].supersededAt, T1);
  assert.deepEqual(visible(state, '2025-12-30T00:00:00.000Z').filter(item => item.sourceId === SOURCE).map(item => item.fields.amountMinor), ['50']);
  assert.deepEqual(sourceIds(state, T0), ['a', 'b']); assert.deepEqual(sourceIds(state, T1), ['a', 'c']);
  assert.deepEqual(state.facts.filter(item => item.sourceId === OTHER), before.filter(item => item.sourceId === OTHER));
  assert.equal(record.lineage.find(item => item.entityId === 'a')?.status, 'replaced'); assert.equal(record.lineage.find(item => item.entityId === 'c')?.status, 'inserted');
  assert.deepEqual(record.lineage.find(item => item.entityId === 'a')?.previousFactIds, ['synthetic-older-a', before[1].id]);
});

test('a complete unchanged relation retains IDs without stale marking but records its next generation', () => {
  const state = fixture(), before = structuredClone(state.facts);
  const record = publishProducerReplacement(state, request(state, [output('a', '100'), output('b', '200', 2)]), host);
  assert.deepEqual(state.facts, before); assert.deepEqual(record.lineage.map(item => item.status), ['retained', 'retained']);
  assert.equal(record.generation, 1); assert.deepEqual(record.staleArtifactIds, []); assert.equal(state.answers[0].stale, false); assert.equal(state.receipts[0].stale, false);
});

test('field key ordering is semantically unchanged while custody still binds the exact output order', () => {
  const state = fixture(); state.facts[0].fields.nested = { first: 'one', second: [{ a: 'two', b: 'three' }] };
  const changedOrder = output('a', '100'); changedOrder.fields = { nested: { second: [{ b: 'three', a: 'two' }], first: 'one' }, customerId: 'synthetic-customer', currency: 'INR', amountMinor: '100' };
  const previousId = state.facts[0].id, previousFields = structuredClone(state.facts[0].fields);
  assert.notEqual(producerReplacementOutputDigest([{ ...changedOrder, fields: previousFields }]), producerReplacementOutputDigest([changedOrder]));
  const record = publishProducerReplacement(state, request(state, [changedOrder, output('b', '200', 2)]), host);
  assert.equal(record.lineage[0].status, 'retained'); assert.equal(record.lineage[0].nextFactId, previousId);
  assert.deepEqual(state.facts[0].fields, previousFields); assert.equal(state.facts.length, 3); assert.deepEqual(record.staleArtifactIds, []);
  const changedArray = structuredClone(changedOrder); changedArray.fields.nested = { first: 'one', second: [{ b: 'changed', a: 'two' }] };
  const replacement = publishProducerReplacement(state, request(state, [changedArray, output('b', '200', 2)], T2), host);
  assert.equal(replacement.lineage[0].status, 'replaced');
});

test('source row changes retain explicit new lineage even when the amount is unchanged', () => {
  const state = fixture(), oldId = state.facts[0].id;
  const record = publishProducerReplacement(state, request(state, [output('a', '100', 8), output('b', '200', 2)]), host);
  assert.equal(record.lineage[0].status, 'replaced'); assert.notEqual(record.lineage[0].nextFactId, oldId);
  assert.equal(state.facts.find(item => item.id === oldId)?.supersededAt, T1); assert.equal(state.facts.at(-1)?.sourceRow, 8);
});

test('retaining the latest claim also retracts older live branch versions from narrowed current reads', () => {
  const state = fixture(); const old = state.facts[0]; old.branch = 'old-branch'; old.fields.amountMinor = '50';
  insertFacts(state, [{ ...output('a', '100'), branch: 'current-branch' }], T1);
  const current = state.facts.at(-1)!; state.answers[0].stale = false;
  const store: StateStore = { read: () => structuredClone(state), update: async () => { throw new Error('Read only.'); } };
  const priorReceipts = structuredClone(state.receipts);
  const record = publishProducerReplacement(state, request(state, [{ ...output('a', '100'), branch: 'current-branch' }, output('b', '200', 2)], T2), host);
  const lineage = record.lineage.find(item => item.entityId === 'a')!;
  assert.equal(lineage.status, 'retained'); assert.equal(lineage.nextFactId, current.id); assert.deepEqual(lineage.retractedFactIds, [old.id]);
  assert.equal(old.supersededAt, T2); assert.equal(current.supersededAt, null); assert.equal(state.facts.length, 4);
  assert.deepEqual(selectFacts(store, OWNER, { branch: 'old-branch', asOf: T1 }).facts.map(item => item.fields.amountMinor), ['50']);
  assert.deepEqual(selectFacts(store, OWNER, { branch: 'old-branch', asOf: T2 }).facts, []);
  assert.deepEqual(selectFacts(store, OWNER, { branch: 'current-branch', asOf: T2 }).facts.map(item => item.id), [current.id]);
  state.members.push({ id: 'branch-viewer', name: 'Synthetic scoped viewer', active: true, role: 'viewer', epoch: 1, branches: ['old-branch'] });
  assert.deepEqual(selectFacts(store, { memberId: 'branch-viewer', role: 'viewer', epoch: 1 }, { asOf: T2 }).facts, []);
  assert.equal(state.answers[0].stale, true); assert.deepEqual(record.staleArtifactIds, ['synthetic-answer']); assert.deepEqual(state.receipts, priorReceipts);
});

for (const [name, code, change] of [
  ['partial relation', 'PRODUCER_REPLACEMENT_INCOMPLETE', (value: any) => { value.complete = false; }],
  ['another producer output', 'PRODUCER_OUTPUT_INVALID', (value: any) => { value.outputs[0].sourceId = OTHER; }],
  ['duplicate logical identity', 'PRODUCER_OUTPUT_DUPLICATE', (value: any) => { value.outputs.push(structuredClone(value.outputs[0])); }],
  ['invalid business date', 'PRODUCER_OUTPUT_DATE_INVALID', (value: any) => { value.outputs[0].validFrom = '2026-02-30'; }],
  ['changed output digest', 'PRODUCER_OUTPUT_DIGEST_MISMATCH', (value: any) => { value.custody.outputDigest = hash('different bytes'); }],
  ['row control mismatch', 'PRODUCER_CONTROL_MISMATCH', (value: any) => { value.controls.rowCount += 1; }],
  ['amount control mismatch', 'PRODUCER_CONTROL_MISMATCH', (value: any) => { value.controls.sums[0].minor = '999'; }],
  ['ambiguous numeric control value', 'PRODUCER_OUTPUT_DIGEST_MISMATCH', (value: any) => { value.outputs[0].fields.amountMinor = 100; }],
  ['duplicate control fields', 'PRODUCER_CONTROL_MISMATCH', (value: any) => { value.controls.sums.push(structuredClone(value.controls.sums[0])); }],
  ['unsafe integer field', 'PRODUCER_OUTPUT_INVALID', (value: any) => { value.outputs[0].fields.amountMinor = Number.MAX_SAFE_INTEGER + 1; }],
  ['invented output ID', 'PRODUCER_OUTPUT_INVALID', (value: any) => { value.outputs[0].id = 'invented'; }],
  ['invalid timestamp', 'PRODUCER_PUBLICATION_TIME_INVALID', (value: any) => { value.publishedAt = '2026-01-02'; }],
] as const) test(`${name} refuses without any draft mutation`, () => {
  const state = fixture(), publication = request(state, [output('a', '100')]); change(publication); refusal(state, publication, code);
});

test('empty output requires independently authenticated justification and zero controls', () => {
  const state = fixture(), publication = request(state, []); delete publication.justifiedEmpty;
  refusal(state, publication, 'PRODUCER_EMPTY_UNJUSTIFIED');
  publication.justifiedEmpty = { reason: 'Synthetic complete empty result', evidenceDigest: hash('not authenticated') };
  const before = structuredClone(state); assert.throws(() => publishProducerReplacement(state, publication, host)); assert.deepEqual(state, before);
  publication.justifiedEmpty.evidenceDigest = INPUT; publication.controls.sums[0].minor = '1'; refusal(state, publication, 'PRODUCER_CONTROL_MISMATCH');
});

test('racing prior generation and custody changes fence the publication without changing the current draft', () => {
  const state = fixture(), first = request(state, [output('a', '100')]), competing = request(state, [output('b', '200', 2)]);
  publishProducerReplacement(state, first, host); refusal(state, competing, 'PRODUCER_REPLACEMENT_STALE');
  const reviewed = request(state, [output('a', '100')], T2); state.imports[0].retainedInput.digest = hash('changed custody');
  refusal(state, reviewed, 'PRODUCER_REPLACEMENT_STALE');
});

test('equal semantic values with different learned lineage fence a prior relation review', () => {
  const state = fixture(), reviewed = request(state, [output('a', '100')]); state.facts[0].id = 'new-equal-value-fact';
  refusal(state, reviewed, 'PRODUCER_REPLACEMENT_STALE');
});

test('self-consistent partial outputs still fail the trusted independent complete-source assertion', () => {
  const state = fixture(), partial = request(state, [output('a', '100')]);
  const independentlyBound: ProducerReplacementHost = { assertCustody: (_view, candidate) => {
    if (candidate.controls.rowCount !== 2 || candidate.controls.sums[0].minor !== '300') {
      throw new ChausarError('SYNTHETIC_COVERAGE_REFUSED', 'The retained synthetic full-source controls do not authorize this partial relation.');
    }
  } };
  refusal(state, partial, 'SYNTHETIC_COVERAGE_REFUSED', independentlyBound);
});

test('validated pins are independent of JSON object key order', () => {
  const state = fixture(), candidate = request(state, [output('a', '100')]); const pins = candidate.expected;
  candidate.expected = { custodyDigest: pins.custodyDigest, relationDigest: pins.relationDigest, generation: pins.generation };
  assert.equal(publishProducerReplacement(state, candidate, host).generation, 1);
});

test('custody and managed admission refusals or async assertions happen before draft mutation', () => {
  const state = fixture(), publication = request(state, [output('a', '100')]);
  const fail: ProducerReplacementHost = { assertCustody: () => { throw new ChausarError('SYNTHETIC_CUSTODY_REFUSED', 'Synthetic refusal.'); } };
  refusal(state, publication, 'SYNTHETIC_CUSTODY_REFUSED', fail);
  refusal(state, publication, 'PRODUCER_HOST_ASSERTION_INVALID', { assertCustody: (() => Promise.resolve()) as unknown as ProducerReplacementHost['assertCustody'] });
  state.imports.push({ type: 'connector-capture-v1', sourceId: SOURCE, id: 'synthetic-managed-capture' }); const managed = request(state, [output('a', '100')]);
  refusal(state, managed, 'PRODUCER_MANAGED_ADMISSION_REQUIRED');
  refusal(state, managed, 'SOURCE_NOT_READY', { ...host, assertCurrentAdmission: () => { throw new ChausarError('SOURCE_NOT_READY', 'Actual synthetic gate refused.'); } });
  const admitted = publishProducerReplacement(state, managed, { ...host, assertCurrentAdmission: () => {} });
  assert.equal(admitted.qualification, 'managed-admission-checked'); assert.notEqual(admitted.qualification as string, 'qualified');
});

test('host receives immutable isolated views, not mutable live draft or caller outputs', () => {
  const state = fixture(), publication = request(state, [output('a', '100')]);
  const before = structuredClone(state);
  assert.throws(() => publishProducerReplacement(state, publication, { assertCustody: (view, input) => {
    assert.notEqual(view, state); assert.notEqual(input, publication); assert.ok(Object.isFrozen(view.facts)); assert.ok(Object.isFrozen(input.outputs[0].fields));
    view.facts.push({} as Fact);
  } }), TypeError);
  assert.deepEqual(state, before);
});

test('publication clock cannot precede source versions or any earlier producer publication', () => {
  const state = fixture(), backwards = request(state, [output('a', '100')], '2025-12-30T00:00:00.000Z');
  refusal(state, backwards, 'SYSTEM_CLOCK_REGRESSION');
  publishProducerReplacement(state, request(state, [output('a', '100'), output('b', '200', 2)], T2), host);
  refusal(state, request(state, [output('a', '100')], T1), 'SYSTEM_CLOCK_REGRESSION');
});

test('malformed retained producer generation refuses before any mutation', () => {
  const state = fixture(); publishProducerReplacement(state, request(state, [output('a', '100')]), host);
  const next = request(state, [], T2); state.imports.at(-1)!.generation = 3;
  refusal(state, next, 'PRODUCER_GENERATION_INVALID');
});

test('ordinary imports and producer tombstones remain retained rather than being erased by replacement', () => {
  const state = fixture(), oldB = state.facts[1]; state.tombstones.push({ id: 'synthetic-tombstone', factId: oldB.id });
  const beforeImports = structuredClone(state.imports), beforeTombstones = structuredClone(state.tombstones);
  publishProducerReplacement(state, request(state, [output('a', '100')]), host);
  assert.deepEqual(state.imports.slice(0, -1), beforeImports); assert.deepEqual(state.tombstones, beforeTombstones);
  assert.equal(state.facts.find(item => item.id === oldB.id)?.fields.amountMinor, '200');
});
