import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, hash, type Context } from '../runtime/contracts.ts';
import { CalculatorService, type CalculationRequest, type CalculatorOptions } from '../runtime/calculator.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { FixtureStateStore } from './database-fixtures.ts';
import { explainAnswerRecovery, prepareAnswerRecovery, assertPreparedAnswerRecoveryCurrent, completeAnswerRecovery,
  type AnswerRecoveryEvidence, type AnswerRecoveryDeclaration, type AnswerRecoveryTimeScope } from '../runtime/answer-recovery.ts';

// Synthetic JavaScript fixtures only: no database, connector, provider, desktop or security qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const eventPeriod = { from: '2026-09-01', to: '2026-09-30' };
const chosenScope = (): AnswerRecoveryTimeScope => ({ asOf: '2026-09-25T00:00:00Z', period: { ...eventPeriod }, comparePeriod: null, onDate: null });
async function setup(request: CalculationRequest = { operation: 'billed', period: eventPeriod, sourceIds: ['fixture-source'] }, options: CalculatorOptions = {}) {
  const store = new FixtureStateStore(); await new OntologyService(store).publish(owner, 'retail');
  const memory = new MemoryService(store);
  await memory.append(owner, [{ sourceId: 'fixture-source', entityId: 'invoice-1', sourceRow: 2, kind: 'invoice',
    validFrom: '2026-09-10', branch: 'main', fields: { amountMinor: '10000', currency: 'INR', status: 'settled', invoiceId: 'I', customerId: 'C', dueDate: '2026-09-11' } }],
  { testLearnedAt: '2026-09-10T00:00:00Z' });
  const calculator = new CalculatorService(store, options);
  const receipt = await calculator.calculate(owner, { ...structuredClone(request), asOf: '2026-09-15T00:00:00Z' });
  const saved = store.read().answers.find(answer => answer.receiptId === receipt.id)!;
  // Deliberately retain a legacy request; this is test setup, never a recovery migration.
  await store.update(state => { delete state.answers.find(answer => answer.id === saved.id)!.request.asOf; });
  const evidence = (): AnswerRecoveryEvidence => {
    const state = store.read(), answer = state.answers.find(value => value.id === saved.id)!;
    return { workspaceId: state.workspace.id, answer: { id: answer.id, receiptId: answer.receiptId, request: structuredClone(answer.request) },
      receipt: calculator.receipt(owner, answer.receiptId) };
  };
  const declare = (scope = chosenScope()): AnswerRecoveryDeclaration => ({ version: 1, newRequestId: 'fresh-request-1',
    source: explainAnswerRecovery(evidence()).source, timeScope: scope, confirmedNewCalculation: true });
  return { store, calculator, memory, savedId: saved.id as string, oldReceiptId: receipt.id, evidence, declare };
}
const rejectsCode = (work: () => unknown, code: string) => assert.throws(work, error => error instanceof ChausarError && error.code === code);

test('disclosure identifies the exact legacy request without exposing a fabricated historical cutoff', async () => {
  const value = await setup(); const evidence = value.evidence(), original = structuredClone(evidence);
  const review = explainAnswerRecovery(evidence);
  assert.equal(review.status, 'new-time-scope-required'); assert.equal(review.historicalReplay, false); assert.equal(review.grantsAuthority, false);
  assert.deepEqual(review.requiredTimeFields, ['asOf', 'period', 'comparePeriod', 'onDate']);
  assert.equal(review.source.originalRequestDigest, hash(evidence.answer.request)); assert.equal(review.source.originalReceiptDigest, hash(evidence.receipt));
  assert.equal(Object.hasOwn(review, 'asOf'), false); assert.equal(JSON.stringify(review).includes(evidence.receipt.asOf), false);
  assert.deepEqual(evidence, original); assert.ok(Object.isFrozen(review)); assert.ok(Object.isFrozen(review.source));
});

test('a new declared offset instant and period preserve non-time filters and do not mutate originals or input', async () => {
  const value = await setup({ operation: 'billed', period: eventPeriod, sourceIds: ['fixture-source'], branch: 'main', customerId: 'C', orderId: 'O' });
  const evidence = value.evidence(), original = structuredClone(evidence);
  const input = value.declare({ asOf: '2026-09-26T05:30:00+05:30', period: { from: '2026-09-11', to: '2026-09-20' }, comparePeriod: null, onDate: null });
  const inputBefore = structuredClone(input), plan = prepareAnswerRecovery(evidence, input);
  assert.deepEqual(plan.request, { operation: 'billed', sourceIds: ['fixture-source'], branch: 'main', customerId: 'C', orderId: 'O',
    asOf: '2026-09-26T00:00:00.000Z', period: { from: '2026-09-11', to: '2026-09-20' } });
  assert.equal(plan.interpretation, 'new-calculation-with-declared-time-scope'); assert.equal(plan.historicalReplay, false);
  assert.equal(plan.requestDigest, hash(plan.request)); assert.equal(plan.newRequestId, 'fresh-request-1');
  assert.deepEqual(evidence, original); assert.deepEqual(input, inputBefore);
  evidence.answer.request.sourceIds![0] = 'mutated'; input.timeScope.period!.from = '2026-01-01';
  assert.deepEqual(plan.request.sourceIds, ['fixture-source']); assert.equal(plan.request.period!.from, '2026-09-11');
  assert.ok(Object.isFrozen(plan.request)); assert.ok(Object.isFrozen(plan.request.sourceIds));
});

test('actual calculator recovery uses the new selected knowledge cut and preserves all old record bytes', async () => {
  let consumerChecks = 0, receiptChecks = 0, verifierChecks = 0;
  const value = await setup(undefined, { consumerGuard: () => { consumerChecks++; }, receiptGuard: () => { receiptChecks++; },
    verifier: async () => { verifierChecks++; return { label: 'synthetic JavaScript verifier fixture only' }; } });
  await value.memory.correct(owner, value.store.read().facts[0].id, { amountMinor: '25000' }, { testLearnedAt: '2026-09-20T00:00:00Z' });
  const source = value.evidence(); assert.equal(source.receipt.stale, true);
  const beforeAnswer = JSON.stringify(value.store.read().answers.find(answer => answer.id === value.savedId));
  const beforeReceipt = JSON.stringify(value.store.read().receipts.find(receipt => receipt.id === value.oldReceiptId));
  const plan = prepareAnswerRecovery(source, value.declare()); assertPreparedAnswerRecoveryCurrent(value.evidence(), plan);
  const receipt = await value.calculator.calculate(owner, plan.request);
  assert.equal(receipt.totalMinor, '25000'); assert.equal(receipt.asOf, '2026-09-25T00:00:00.000Z');
  const answer = value.store.read().answers.find(saved => saved.receiptId === receipt.id)!;
  const lineage = completeAnswerRecovery(value.evidence(), plan, { answer: { id: answer.id, receiptId: answer.receiptId, request: answer.request },
    receipt: value.calculator.receipt(owner, receipt.id) });
  assert.notEqual(lineage.newAnswerId, value.savedId); assert.notEqual(lineage.newReceiptId, value.oldReceiptId);
  assert.equal(lineage.source.originalReceiptId, value.oldReceiptId); assert.equal(lineage.newRequestDigest, hash(answer.request));
  assert.equal(lineage.newReceiptDigest, hash(receipt)); assert.equal(lineage.preparationDigest, plan.digest);
  assert.equal(Object.hasOwn(receipt, 'restatement'), false); assert.equal(lineage.grantsAuthority, false);
  assert.equal(JSON.stringify(value.store.read().answers.find(saved => saved.id === value.savedId)), beforeAnswer);
  assert.equal(JSON.stringify(value.store.read().receipts.find(saved => saved.id === value.oldReceiptId)), beforeReceipt);
  assert.equal(Object.hasOwn(value.store.read().answers.find(saved => saved.id === value.savedId).request, 'asOf'), false);
  assert.equal(value.store.read().answers.length, 2); assert.equal(verifierChecks, 2); assert.ok(consumerChecks >= 6); assert.ok(receiptChecks >= 6);
});

test('every new time field and explicit new-calculation confirmation is required', async () => {
  const value = await setup(), evidence = value.evidence();
  for (const field of ['asOf', 'period', 'comparePeriod', 'onDate']) {
    const input = value.declare(); delete (input.timeScope as unknown as Record<string, unknown>)[field];
    rejectsCode(() => prepareAnswerRecovery(evidence, input), 'INVALID_ANSWER_RECOVERY');
  }
  const input = value.declare(); input.confirmedNewCalculation = false as true;
  rejectsCode(() => prepareAnswerRecovery(evidence, input), 'ANSWER_RECOVERY_CONFIRMATION_REQUIRED');
  const withDefault = { ...value.declare(), chooseNow: true };
  rejectsCode(() => prepareAnswerRecovery(evidence, withDefault), 'INVALID_ANSWER_RECOVERY');
});

for (const timestamp of ['2026-09-25', '09/25/2026', '2026-09-25T00:00:00', '2026-02-30T00:00:00Z', '2026-09-25T24:00:00Z',
  '2026-09-25T00:60:00Z', '2026-09-25T00:00:60Z', '2026-09-25T00:00:00+25:00', '2026-09-25T00:00:00.0000Z', '']) {
  test(`new cutoff refuses ambiguous or normalized timestamp ${JSON.stringify(timestamp)}`, async () => {
    const value = await setup(); const input = value.declare(); input.timeScope.asOf = timestamp;
    rejectsCode(() => prepareAnswerRecovery(value.evidence(), input), 'INVALID_ASOF');
  });
}

test('valid leap-day timestamp is accepted; invalid or reversed event periods refuse', async () => {
  const value = await setup(), input = value.declare(); input.timeScope.asOf = '2024-02-29T23:59:59.1Z';
  assert.equal(prepareAnswerRecovery(value.evidence(), input).request.asOf, '2024-02-29T23:59:59.100Z');
  for (const bad of [{ from: '2026-02-30', to: '2026-03-01' }, { from: '2026-09-30', to: '2026-09-01' }]) {
    const invalid = value.declare(); invalid.timeScope.period = bad;
    rejectsCode(() => prepareAnswerRecovery(value.evidence(), invalid), 'INVALID_PERIOD');
  }
});

test('explicit null event period means a newly selected all-event scope and never a default', async () => {
  const value = await setup(), input = value.declare(); input.timeScope.period = null;
  const plan = prepareAnswerRecovery(value.evidence(), input);
  assert.equal(Object.hasOwn(plan.request, 'period'), false); assert.equal(plan.timeScope.period, null); assert.ok(plan.request.asOf);
});

test('comparison recovery requires newly declared current and prior periods', async () => {
  const value = await setup({ operation: 'change', period: eventPeriod, comparePeriod: { from: '2026-08-01', to: '2026-08-31' } });
  const input = value.declare(); rejectsCode(() => prepareAnswerRecovery(value.evidence(), input), 'COMPARISON_REQUIRED');
  input.timeScope.comparePeriod = { from: '2026-07-01', to: '2026-07-31' };
  assert.deepEqual(prepareAnswerRecovery(value.evidence(), input).request.comparePeriod, input.timeScope.comparePeriod);
  input.timeScope.period = null; rejectsCode(() => prepareAnswerRecovery(value.evidence(), input), 'COMPARISON_REQUIRED');
});

test('legacy aging never inherits the implicit old aging date and requires a newly declared date', async () => {
  const value = await setup({ operation: 'aging', sourceIds: ['fixture-source'] }), input = value.declare();
  assert.equal(Object.hasOwn(value.evidence().answer.request, 'onDate'), false);
  rejectsCode(() => prepareAnswerRecovery(value.evidence(), input), 'INVALID_AGING_DATE');
  input.timeScope.onDate = '2026-09-24'; const plan = prepareAnswerRecovery(value.evidence(), input);
  assert.equal(plan.request.onDate, '2026-09-24'); assert.notEqual(plan.request.onDate, value.evidence().receipt.assumptions.onDate);
  const receipt = await value.calculator.calculate(owner, plan.request); assert.equal(receipt.assumptions.onDate, '2026-09-24');
});

test('irrelevant comparison and aging fields are refused instead of silently ignored', async () => {
  const value = await setup(), compare = value.declare(); compare.timeScope.comparePeriod = eventPeriod;
  rejectsCode(() => prepareAnswerRecovery(value.evidence(), compare), 'INVALID_CALCULATION');
  const aging = value.declare(); aging.timeScope.onDate = '2026-09-20';
  rejectsCode(() => prepareAnswerRecovery(value.evidence(), aging), 'INVALID_CALCULATION');
});

test('scenario retains its exact original assumption without accepting a new one through recovery', async () => {
  const value = await setup({ operation: 'scenario', assumptions: { priceChangeBps: '01000' }, sourceIds: ['fixture-source'] });
  const plan = prepareAnswerRecovery(value.evidence(), value.declare()); assert.deepEqual(plan.request.assumptions, { priceChangeBps: '01000' });
  const input = { ...value.declare(), assumptions: { priceChangeBps: '9000' } };
  rejectsCode(() => prepareAnswerRecovery(value.evidence(), input), 'INVALID_ANSWER_RECOVERY');
});

for (const sourceIds of [undefined, []] as (string[] | undefined)[]) {
  test(`recovery preserves ${sourceIds === undefined ? 'absent' : 'empty'} requested source scope exactly`, async () => {
    const value = await setup({ operation: 'billed', ...(sourceIds === undefined ? {} : { sourceIds }) });
    const plan = prepareAnswerRecovery(value.evidence(), value.declare());
    assert.equal(Object.hasOwn(plan.request, 'sourceIds'), sourceIds !== undefined);
    assert.deepEqual(plan.request.sourceIds, sourceIds);
    const receipt = await value.calculator.calculate(owner, plan.request);
    assert.equal(receipt.totalMinor, sourceIds === undefined ? '10000' : '0');
  });
}

test('already pinned and malformed cutoff values cannot enter the legacy recovery path', async () => {
  const value = await setup();
  for (const asOf of ['2026-09-15T00:00:00Z', null, undefined, 'bad']) {
    const evidence = value.evidence(); Object.assign(evidence.answer.request, { asOf });
    rejectsCode(() => explainAnswerRecovery(evidence), asOf === undefined ? 'INVALID_ANSWER_RECOVERY' : 'ANSWER_RECOVERY_NOT_UNPINNED');
  }
});

test('operation, source, period, branch, scenario and aging receipt mismatches refuse', async () => {
  const value = await setup();
  for (const change of [
    (e: AnswerRecoveryEvidence) => { e.answer.receiptId = 'other-receipt'; },
    (e: AnswerRecoveryEvidence) => { e.answer.request.operation = 'received'; },
    (e: AnswerRecoveryEvidence) => { e.answer.request.period!.from = '2026-09-02'; },
    (e: AnswerRecoveryEvidence) => { e.answer.request.sourceIds = []; },
    (e: AnswerRecoveryEvidence) => { e.answer.request.branch = 'other'; },
  ]) {
    const evidence = value.evidence(); change(evidence); rejectsCode(() => explainAnswerRecovery(evidence), 'ANSWER_RECOVERY_SOURCE_CHANGED');
  }
  const scenario = await setup({ operation: 'scenario', assumptions: { priceChangeBps: '1000' } });
  const changedScenario = scenario.evidence(); changedScenario.answer.request.assumptions!.priceChangeBps = '2000';
  rejectsCode(() => explainAnswerRecovery(changedScenario), 'ANSWER_RECOVERY_SOURCE_CHANGED');
  const aging = await setup({ operation: 'aging', onDate: '2026-09-15' }), changedAging = aging.evidence(); changedAging.answer.request.onDate = '2026-09-16';
  rejectsCode(() => explainAnswerRecovery(changedAging), 'ANSWER_RECOVERY_SOURCE_CHANGED');
});

test('evidence pins refuse changed originals, workspace identities and prepared requests', async () => {
  const value = await setup(), input = value.declare(), source = value.evidence();
  source.receipt.totalMinor = '999'; rejectsCode(() => prepareAnswerRecovery(source, input), 'ANSWER_RECOVERY_SOURCE_CHANGED');
  const moved = value.evidence(); moved.workspaceId = 'different-workspace'; rejectsCode(() => prepareAnswerRecovery(moved, input), 'ANSWER_RECOVERY_SOURCE_CHANGED');
  const plan = prepareAnswerRecovery(value.evidence(), input), tampered = structuredClone(plan); tampered.request.sourceIds = [];
  rejectsCode(() => assertPreparedAnswerRecoveryCurrent(value.evidence(), tampered), 'ANSWER_RECOVERY_PREPARATION_CHANGED');
  const changed = value.evidence(); changed.answer.request.customerId = 'different-filter';
  rejectsCode(() => assertPreparedAnswerRecoveryCurrent(changed, plan), 'ANSWER_RECOVERY_SOURCE_CHANGED');
});

test('original private diagnostic receipts and reused identities are refused', async () => {
  const value = await setup(), evidence = value.evidence(); evidence.receipt.restatement = { version: 1, interpretation: 'restated-private-diagnostic',
    trialId: 'trial', forkDigest: 'a'.repeat(64), candidateStateDigest: 'b'.repeat(64), publicationId: 'publication', originalAnswerId: 'old-answer', originalReceiptId: 'old-receipt' };
  rejectsCode(() => explainAnswerRecovery(evidence), 'ANSWER_RECOVERY_PRIVATE_DIAGNOSTIC');
  for (const reused of [value.savedId, value.oldReceiptId, '']) {
    const input = value.declare(); input.newRequestId = reused;
    rejectsCode(() => prepareAnswerRecovery(value.evidence(), input), 'ANSWER_RECOVERY_NEW_ID_REQUIRED');
  }
});

test('plain JSON, exact fields, structural bounds and finite data are required', async () => {
  const value = await setup(), source = value.evidence(); let getterInvoked = false;
  const withGetter = value.declare(); Object.defineProperty(withGetter.timeScope, 'asOf', { enumerable: true, get: () => { getterInvoked = true; return '2026-09-25T00:00:00Z'; } });
  rejectsCode(() => prepareAnswerRecovery(source, withGetter), 'INVALID_ANSWER_RECOVERY'); assert.equal(getterInvoked, false);
  const large = value.evidence(); large.answer.request.customerId = 'x'.repeat(65537);
  rejectsCode(() => explainAnswerRecovery(large), 'ANSWER_RECOVERY_LIMIT');
  const sparse = value.evidence(); sparse.answer.request.sourceIds = Array(1);
  rejectsCode(() => explainAnswerRecovery(sparse), 'INVALID_ANSWER_RECOVERY');
  const invalid = value.declare(); Object.assign(invalid.timeScope, { extra: NaN });
  rejectsCode(() => prepareAnswerRecovery(source, invalid), 'INVALID_ANSWER_RECOVERY');
});

test('completion refuses changed cutoff, request, account, identity and private restatement', async () => {
  const value = await setup(), source = value.evidence(), plan = prepareAnswerRecovery(source, value.declare());
  const receipt = await value.calculator.calculate(owner, plan.request), answer = value.store.read().answers.find(item => item.receiptId === receipt.id)!;
  const actual = { answer: { id: answer.id as string, receiptId: answer.receiptId as string, request: answer.request as CalculationRequest }, receipt };
  assert.equal(completeAnswerRecovery(source, plan, actual).newAnswerId, answer.id);
  for (const change of [
    (r: typeof actual) => { r.receipt.asOf = '2026-09-15T00:00:00.000Z'; },
    (r: typeof actual) => { r.answer.request.asOf = '2026-09-15T00:00:00.000Z'; },
    (r: typeof actual) => { r.answer.id = value.savedId; },
    (r: typeof actual) => { r.receipt.memberId = 'different-member'; },
    (r: typeof actual) => { r.receipt.epoch++; },
    (r: typeof actual) => { r.answer.id = plan.newRequestId; },
    (r: typeof actual) => { r.receipt.restatement = {} as NonNullable<typeof receipt.restatement>; },
  ]) {
    const changed = structuredClone(actual); change(changed);
    rejectsCode(() => completeAnswerRecovery(source, plan, changed), 'ANSWER_RECOVERY_RESULT_CHANGED');
  }
});

test('current source revocation still blocks actual calculator execution and receipt review', async () => {
  const value = await setup(), plan = prepareAnswerRecovery(value.evidence(), value.declare());
  await value.store.update(state => { state.sourceRules.push({ sourceId: 'fixture-source', revoked: true }); });
  assert.throws(() => value.evidence(), { code: 'SOURCE_REVOKED' });
  await assert.rejects(value.calculator.calculate(owner, plan.request), { code: 'SOURCE_REVOKED' });
  assert.equal(value.store.read().answers.length, 1); assert.equal(value.store.read().receipts.length, 1);
});

test('the configured current readiness guard still refuses the prepared fresh request', async () => {
  let ready = true;
  const value = await setup(undefined, { consumerGuard: () => { if (!ready) throw new ChausarError('SOURCE_NOT_READY', 'Synthetic readiness fixture refusal'); } });
  const plan = prepareAnswerRecovery(value.evidence(), value.declare()); ready = false;
  await assert.rejects(value.calculator.calculate(owner, plan.request), { code: 'SOURCE_NOT_READY' });
  assert.equal(value.store.read().answers.length, 1); assert.equal(value.store.read().receipts.length, 1);
});

test('permission epoch revocation blocks ordinary source review and calculation', async () => {
  const value = await setup(), plan = prepareAnswerRecovery(value.evidence(), value.declare());
  await value.store.update(state => { state.members[0].epoch++; });
  assert.throws(() => value.evidence(), { code: 'ACCESS_REVOKED' });
  await assert.rejects(value.calculator.calculate(owner, plan.request), { code: 'ACCESS_REVOKED' });
});

test('incomplete retained receipts refuse with a typed error rather than untyped hashing/property failures', async () => {
  const value = await setup();
  for (const field of ['period', 'comparePeriod', 'assumptions', 'asOf']) {
    const evidence = value.evidence(); delete (evidence.receipt as unknown as Record<string, unknown>)[field];
    rejectsCode(() => explainAnswerRecovery(evidence), 'ANSWER_RECOVERY_SOURCE_CHANGED');
  }
  const evidence = value.evidence(); evidence.receipt.assumptions = null as unknown as Record<string, unknown>;
  rejectsCode(() => explainAnswerRecovery(evidence), 'ANSWER_RECOVERY_SOURCE_CHANGED');
  const source = value.evidence(), plan = prepareAnswerRecovery(source, value.declare());
  rejectsCode(() => completeAnswerRecovery(source, plan, { answer: { id: 'new-answer', receiptId: 'new-receipt', request: plan.request },
    receipt: null as unknown as AnswerRecoveryEvidence['receipt'] }), 'ANSWER_RECOVERY_RESULT_CHANGED');
});
