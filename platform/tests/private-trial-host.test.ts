import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, check, hash, type Context, type StateStore } from '../runtime/contracts.ts';
import {
  PrivateTrialHostService, type PrivateTrialArtifactPort, type PrivateTrialArtifactRef,
  type PrivateTrialAtomicPublication, type PrivateTrialHostOptions,
} from '../runtime/private-trial-host.ts';
import type { PrivateTrialFork, PrivateTrialPromotionRequest } from '../runtime/private-trial-contracts.ts';
import { OWNER, SyntheticTrialStore, definitionChange, saveQuestions, syntheticHost } from './fixtures/private-trial-fixture.ts';

// The custody port here is an explicit in-memory contract fixture, not encrypted Vault evidence.
// byte counts are the fixture's stored record sizes. Root Vault/public acceptance must measure real files.
class SyntheticCustody implements PrivateTrialArtifactPort {
  records = new Map<string, { value: unknown; valueDigest: string; diskBytes: number }>();
  calls: string[] = [];
  refuseRemoval = new Set<string>();
  beforeWrite?: (id: string) => Promise<void>;
  afterRead?: (id: string) => Promise<void>;
  async write(input: Parameters<PrivateTrialArtifactPort['write']>[0]) {
    this.calls.push(`write:${input.id}`); await this.beforeWrite?.(input.id);
    const prior = this.records.get(input.id);
    check(input.expectedDigest === null ? !prior : prior?.valueDigest === input.expectedDigest,
      'SYNTHETIC_CAS_CHANGED', 'The trusted custody writer must compare the prior digest atomically.');
    const value = structuredClone(input.value), valueDigest = hash(JSON.stringify(value));
    const diskBytes = Buffer.byteLength(JSON.stringify({ purpose: input.purpose, id: input.id, fixtureCiphertext: JSON.stringify(value) }));
    this.records.set(input.id, { value, valueDigest, diskBytes });
    return { id: input.id, purpose: input.purpose, valueDigest, diskBytes };
  }
  async read(input: Parameters<PrivateTrialArtifactPort['read']>[0]) {
    this.calls.push(`read:${input.id}`); const value = this.records.get(input.id);
    check(value, 'SYNTHETIC_ARTIFACT_MISSING', 'The fixture has no such retained artifact.');
    const result = { id: input.id, purpose: input.purpose, ...structuredClone(value) };
    await this.afterRead?.(input.id); return result;
  }
  async list(input: Parameters<PrivateTrialArtifactPort['list']>[0]): Promise<PrivateTrialArtifactRef[]> {
    return [...this.records].map(([id, value]) => ({ id, purpose: input.purpose, valueDigest: value.valueDigest, diskBytes: value.diskBytes }));
  }
  async remove(input: Parameters<PrivateTrialArtifactPort['remove']>[0]) {
    this.calls.push(`remove:${input.id}`);
    check(!this.refuseRemoval.has(input.id), 'SYNTHETIC_CLEANUP_FAILED', 'Simulated filesystem deletion failure.');
    const value = this.records.get(input.id); if (!value) return { removed: false, diskBytes: 0 };
    check(value.valueDigest === input.expectedDigest, 'SYNTHETIC_CAS_CHANGED', 'Never delete an artifact whose retained content changed.');
    this.records.delete(input.id); return { removed: true, diskBytes: value.diskBytes };
  }
}
function code(expected: string) { return (error: unknown) => error instanceof ChausarError && error.code === expected; }
async function setup() {
  const store = new SyntheticTrialStore(), savedAnswerIds = await saveQuestions(store), fixture = syntheticHost(store), custody = new SyntheticCustody();
  const publications: PrivateTrialAtomicPublication[] = [];
  const options: PrivateTrialHostOptions = {
    ...fixture.host, custody,
    promoteAtomic: async (ctx, publication) => {
      publications.push(publication);
      return store.update(state => {
        const commitView: StateStore = { read: () => structuredClone(state), update: async () => { throw new Error('No nested transaction.'); } };
        publication.assertCurrent(commitView);
        state.ontology = structuredClone(publication.fork.candidate.ontology);
        return { publicationId: 'synthetic-publication' };
      });
    },
  };
  const host = new PrivateTrialHostService(store, options), request = { version: 1 as const, savedAnswerIds, change: definitionChange(store) };
  return { store, fixture, custody, options, host, request, publications, reopen: () => new PrivateTrialHostService(store, options) };
}
async function prepared(value: Awaited<ReturnType<typeof setup>>) {
  const created = await value.host.create(OWNER, value.request), evaluated = await value.host.evaluate(OWNER, created.trialId);
  return { created, evaluated };
}
async function promotion(value: Awaited<ReturnType<typeof setup>>, trialId: string, evaluationDigest: string): Promise<PrivateTrialPromotionRequest> {
  const impact = await value.host.promotionImpact(OWNER, trialId, 'prospective');
  return { trialId, evaluationDigest, strategy: 'prospective', acknowledgedImpactDigest: impact.digest };
}

test('host persists private issuance and returns summaries without fork States; reopened host replays all three saved cuts exactly', async () => {
  const value = await setup(), liveBefore = value.store.read(), created = await value.host.create(OWNER, value.request);
  assert.equal(created.status, 'created'); assert.equal(created.qualification, 'isolated-source-replay');
  for (const forbidden of ['baseline', 'candidate', 'recipeEvidence']) assert.equal(Object.hasOwn(created, forbidden), false);
  assert.equal(created.evaluation, undefined); assert.equal(created.cost.hostElapsedMs >= 0, true);
  assert.equal(created.cost.totalDiskBytes, [...value.custody.records.values()].reduce((sum, item) => sum + item.diskBytes, 0));
  const reopened = value.reopen(), readBeforeEvaluation = await reopened.read(OWNER, created.trialId);
  assert.equal(readBeforeEvaluation.forkDigest, created.forkDigest);
  const evaluated = await reopened.evaluate(OWNER, created.trialId); assert.equal(evaluated.status, 'evaluated');
  assert.ok(evaluated.evaluation);
  assert.deepEqual(evaluated.evaluation.comparisons.map(item => {
    assert.equal(item.baseline.status, 'calculated'); assert.equal(item.candidate.status, 'calculated');
    if (item.baseline.status !== 'calculated' || item.candidate.status !== 'calculated') throw new Error('Expected fixture calculations.');
    return [item.baseline.receipt.totalMinor, item.candidate.receipt.totalMinor, item.totalDeltaMinor];
  }), [['900719925474099400', '100', '-900719925474099300'], ['7000', '7000', '0'], ['12500', '12500', '0']]);
  const secondReopen = value.reopen(), retained = await secondReopen.read(OWNER, created.trialId);
  assert.deepEqual(retained.evaluation, evaluated.evaluation);
  const oldDigest = evaluated.evaluationDigest, count = value.custody.records.size;
  assert.equal((await secondReopen.evaluate(OWNER, created.trialId)).evaluationDigest, oldDigest);
  assert.equal(value.custody.records.size, count); assert.deepEqual(value.store.read(), liveBefore);
  assert.deepEqual((await secondReopen.list(OWNER)).map(item => item.trialId), [created.trialId]);
  assert.ok(value.fixture.calls.some(call => call.side === 'candidate' && call.dictionaryHash === created.candidatePin.dictionaryHash));
});

test('resealing a forged fork cannot replace the separately custody-issued artifact identity', async () => {
  const value = await setup(), created = await value.host.create(OWNER, value.request), id = `${created.trialId}-fork`;
  const retained = value.custody.records.get(id)!; const forged = structuredClone(retained.value) as PrivateTrialFork;
  forged.candidate.facts[0].fields.amountMinor = '1';
  const { digest: ignored, ...body } = forged; forged.digest = hash(body);
  retained.value = forged; retained.valueDigest = hash(JSON.stringify(forged));
  await assert.rejects(value.reopen().evaluate(OWNER, created.trialId), code('TRIAL_ARTIFACT_UNAUTHENTIC'));
  assert.equal(value.publications.length, 0);
});

test('tampered payload bytes without matching custody authentication refuse before trial use', async () => {
  const value = await setup(), created = await value.host.create(OWNER, value.request);
  const retained = value.custody.records.get(`${created.trialId}-fork`)!;
  (retained.value as PrivateTrialFork).createdAt = '2020-01-01T00:00:00.000Z';
  await assert.rejects(value.reopen().read(OWNER, created.trialId), code('TRIAL_CUSTODY_CHANGED'));
});

test('every use checks current workspace member epoch and source-tainted requests never reach custody', async () => {
  const value = await setup(), created = await value.host.create(OWNER, value.request), calls = value.custody.calls.length;
  await assert.rejects(value.host.read({ ...OWNER, sourceTainted: true }, created.trialId), code('TRIAL_TAINTED_CONTEXT'));
  await assert.rejects(value.host.discard({ ...OWNER, sourceTainted: true }, created.trialId), code('TRIAL_TAINTED_CONTEXT'));
  assert.equal(value.custody.calls.length, calls);
  value.store.state.members[0].epoch++;
  await assert.rejects(value.reopen().evaluate(OWNER, created.trialId), code('ACCESS_REVOKED'));
  await assert.rejects(value.reopen().read({ ...OWNER, epoch: 2 }, created.trialId), code('TRIAL_FORBIDDEN'));
});

test('live evidence and retained saved request changes refuse but an owner may discard a stale trial', async () => {
  const value = await setup(), { created } = await prepared(value);
  const original = value.store.state.facts[0].fields.amountMinor; value.store.state.facts[0].fields.amountMinor = '2';
  await assert.rejects(value.reopen().read(OWNER, created.trialId), code('TRIAL_STALE_BASE'));
  value.store.state.facts[0].fields.amountMinor = original;
  value.store.state.answers[0].request.operation = 'received';
  await assert.rejects(value.reopen().evaluate(OWNER, created.trialId), code('TRIAL_SAVED_REQUEST_CHANGED'));
  const discarded = await value.reopen().discard(OWNER, created.trialId); assert.equal(discarded.cleanupComplete, true);
});

test('readiness revocation is enforced for created and evaluated private views after reopening', async () => {
  const value = await setup(), created = await value.host.create(OWNER, value.request);
  value.fixture.controls.blocked = { phase: 'read', side: 'candidate', kind: 'consumer' };
  await assert.rejects(value.reopen().read(OWNER, created.trialId), code('SYNTHETIC_READINESS_REVOKED'));
  delete value.fixture.controls.blocked; await value.host.evaluate(OWNER, created.trialId);
  value.fixture.controls.blocked = { phase: 'read', side: 'baseline', kind: 'receipt' };
  await assert.rejects(value.reopen().read(OWNER, created.trialId), code('SYNTHETIC_READINESS_REVOKED'));
});

test('discard revokes issuance durably before cleanup and reports supplied measured byte and elapsed costs', async () => {
  const value = await setup(), { created, evaluated } = await prepared(value);
  const expectedRemoved = evaluated.cost.forkDiskBytes + evaluated.cost.evaluationDiskBytes;
  value.custody.calls = []; const discarded = await value.host.discard(OWNER, created.trialId);
  assert.equal(discarded.cleanupComplete, true); assert.equal(discarded.removedDiskBytes, expectedRemoved);
  assert.ok(discarded.discardElapsedMs >= 0); assert.equal(value.custody.records.size, 1);
  assert.equal(discarded.retainedTombstoneDiskBytes, value.custody.records.get(`${created.trialId}-binding`)!.diskBytes);
  assert.ok(value.custody.calls.indexOf(`write:${created.trialId}-binding`) < value.custody.calls.indexOf(`remove:${created.trialId}-fork`));
  const reopened = value.reopen();
  await assert.rejects(reopened.read(OWNER, created.trialId), code('TRIAL_DISCARDED'));
  await assert.rejects(reopened.evaluate(OWNER, created.trialId), code('TRIAL_DISCARDED'));
  assert.deepEqual(await reopened.list(OWNER), []);
  assert.equal((await reopened.discard(OWNER, created.trialId)).removedDiskBytes, 0);
});

test('failed deletion remains discarded after reopening and bounded repeat cleanup may remove the retained payload', async () => {
  const value = await setup(), { created, evaluated } = await prepared(value);
  const id = `${created.trialId}-fork`; value.custody.refuseRemoval.add(id);
  const discarded = await value.host.discard(OWNER, created.trialId);
  assert.equal(discarded.cleanupComplete, false); assert.deepEqual(discarded.failedArtifactIds, [id]);
  assert.equal(discarded.removedDiskBytes, evaluated.cost.evaluationDiskBytes);
  await assert.rejects(value.reopen().read(OWNER, created.trialId), code('TRIAL_DISCARDED'));
  value.custody.refuseRemoval.clear(); const cleanup = await value.reopen().discard(OWNER, created.trialId);
  assert.equal(cleanup.cleanupComplete, true); assert.equal(cleanup.removedDiskBytes, evaluated.cost.forkDiskBytes);
});

test('separate host writers cannot resurrect a trial when discard races retained evaluation', async () => {
  const value = await setup(), created = await value.host.create(OWNER, value.request);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { entered = resolve; });
  value.custody.beforeWrite = async id => { if (id === `${created.trialId}-evaluation`) { entered(); await gate; } };
  const evaluating = value.host.evaluate(OWNER, created.trialId);
  const rejected = assert.rejects(evaluating, code('SYNTHETIC_CAS_CHANGED'));
  await ready; const discarded = await value.reopen().discard(OWNER, created.trialId); assert.equal(discarded.cleanupComplete, true);
  release(); await rejected;
  await assert.rejects(value.reopen().read(OWNER, created.trialId), code('TRIAL_DISCARDED'));
  assert.equal((value.custody.records.get(`${created.trialId}-binding`)!.value as { status: string }).status, 'discarded');
  assert.equal(value.custody.records.has(`${created.trialId}-evaluation`), false, 'The losing writer cleans its unissued payload.');
  // A cleanup failure would still be an unreachable orphan, never an issued evaluation.
});

test('reopening repeats the issuance fence after awaited payload reads so a concurrent discard cannot return an active summary', async () => {
  const value = await setup(), created = await value.host.create(OWNER, value.request);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { entered = resolve; });
  value.custody.afterRead = async id => { if (id === `${created.trialId}-fork`) { entered(); await gate; } };
  const reading = value.reopen().read(OWNER, created.trialId), rejected = assert.rejects(reading, code('TRIAL_DISCARDED'));
  await ready; await value.host.discard(OWNER, created.trialId); release(); await rejected;
});

test('custody awaits cannot carry stale readiness into a newly returned summary', async () => {
  const value = await setup();
  value.custody.beforeWrite = async id => {
    if (id.endsWith('-binding')) value.fixture.controls.blocked = { phase: 'read', side: 'candidate', kind: 'consumer' };
  };
  await assert.rejects(value.host.create(OWNER, value.request), code('SYNTHETIC_READINESS_REVOKED'));
  assert.equal(value.publications.length, 0);
});

test('asynchronous readiness refuses instead of being mistaken for a completed current check', async () => {
  const value = await setup(), created = await value.host.create(OWNER, value.request);
  value.options.calculatorGuards = () => ({ consumerGuard: async () => {}, receiptGuard: () => {} });
  await assert.rejects(value.reopen().read(OWNER, created.trialId), code('TRIAL_READINESS_REQUIRED'));
});

test('promotion hands exact retained artifacts to the atomic root transaction and requires its current commit-state assertion', async () => {
  const value = await setup(), { created, evaluated } = await prepared(value);
  const request = await promotion(value, created.trialId, evaluated.evaluationDigest!);
  const receipts = structuredClone(value.store.state.receipts), result = await value.host.promote(OWNER, request);
  assert.deepEqual(result, { trialId: created.trialId, status: 'promoted', publicationId: 'synthetic-publication' });
  assert.equal(value.publications.length, 1); assert.equal(value.publications[0].fork.digest, created.forkDigest);
  assert.equal(value.publications[0].evaluation.digest, evaluated.evaluationDigest);
  assert.equal(value.store.state.ontology.current.hash, created.candidatePin.dictionaryHash);
  assert.deepEqual(value.store.state.receipts, receipts);
  await assert.rejects(value.reopen().read(OWNER, created.trialId), code('TRIAL_PUBLICATION_RESERVED'));
});

test('live changes at root commit refuse promotion and leave a fail-closed reservation instead of reactivating uncertain publication', async () => {
  const value = await setup(), { created, evaluated } = await prepared(value), request = await promotion(value, created.trialId, evaluated.evaluationDigest!);
  const oldHash = value.store.state.ontology.current.hash;
  value.options.promoteAtomic = async (_ctx, publication) => {
    const changed = value.store.read(); changed.facts[0].fields.amountMinor = '3';
    publication.assertCurrent({ read: () => changed, update: async () => { throw new Error('Read-only commit view.'); } });
    throw new Error('The assertion should have refused.');
  };
  await assert.rejects(value.host.promote(OWNER, request), code('TRIAL_STALE_BASE'));
  assert.equal(value.store.state.ontology.current.hash, oldHash);
  await assert.rejects(value.reopen().discard(OWNER, created.trialId), code('TRIAL_PUBLICATION_RESERVED'));
});

test('a root callback that omits commit-state validation cannot be acknowledged as publication', async () => {
  const value = await setup(), { created, evaluated } = await prepared(value), request = await promotion(value, created.trialId, evaluated.evaluationDigest!);
  value.options.promoteAtomic = async () => ({ publicationId: 'unverified' });
  await assert.rejects(value.host.promote(OWNER, request), code('TRIAL_ATOMIC_PUBLICATION_REQUIRED'));
  await assert.rejects(value.reopen().evaluate(OWNER, created.trialId), code('TRIAL_PUBLICATION_RESERVED'));
});

test('incomplete impacts and affected active work prevent a promotion reservation', async () => {
  const value = await setup(), { created, evaluated } = await prepared(value);
  value.fixture.controls.impact.activeWorkIds = ['affected-running-job'];
  const request = await promotion(value, created.trialId, evaluated.evaluationDigest!);
  await assert.rejects(value.host.promote(OWNER, request), code('TRIAL_ACTIVE_WORK'));
  assert.equal((value.custody.records.get(`${created.trialId}-binding`)!.value as { status: string }).status, 'active');
  value.fixture.controls.impact.complete = false as true;
  await assert.rejects(value.host.promotionImpact(OWNER, created.trialId, 'prospective'), code('TRIAL_IMPACT_REQUIRED'));
});

test('opaque artifact IDs refuse paths before custody and unknown current members cannot enumerate or discard', async () => {
  const value = await setup(); const calls = value.custody.calls.length;
  await assert.rejects(value.host.read(OWNER, '../other'), code('INVALID_PRIVATE_TRIAL'));
  assert.equal(value.custody.calls.length, calls);
  const stranger: Context = { memberId: 'stranger', role: 'owner', epoch: 1 };
  await assert.rejects(value.host.list(stranger), code('ACCESS_REVOKED'));
  await assert.rejects(value.host.discard(stranger, 'trial_unknown'), code('ACCESS_REVOKED'));
});
