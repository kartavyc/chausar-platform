import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertsService, type AlertCreate, type AlertsOptions } from '../runtime/alerts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ChausarError, type Context, type StateStore } from '../runtime/contracts.ts';
import { ImportService } from '../runtime/ingest.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { FixtureStateStore } from './database-fixtures.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const period = { from: '2026-09-01', to: '2026-09-30' };
const header = 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch';
const csv = (amount: string, suffix = '') => `${header}\nrow,sale,2026-09-10,${amount},INR,customer,invoice,order,,delivered,${suffix},main\n`;
function config(receiptId: string, changes: Partial<AlertCreate> = {}): AlertCreate {
  return { conditionId: 'earned-high', label: 'Earned revenue threshold', baselineReceiptId: receiptId, figureKey: 'total', unit: { kind: 'money', currency: 'INR' },
    sourceIds: ['books'], periodMode: 'fixed', direction: 'above', activateMinor: '10000', clearMinor: '8000',
    activation: { observations: 1, durationMs: 0 }, clearance: { observations: 1, durationMs: 0 }, severity: { initial: 'warning', criticalMinor: '15000', downgrade: 'on-clear' },
    reopening: 'same-episode', maxEvidenceAgeMs: 3600000, maxObservationGapMs: 60000, ...changes };
}
async function setup(store: StateStore = new FixtureStateStore(), options: AlertsOptions = {}) {
  let tick = Date.now() + 10000;
  const service = new AlertsService(store, { clock: () => new Date(tick + 1000).toISOString(), ...options });
  const calculator = new CalculatorService(store), importer = new ImportService(store);
  await new OntologyService(store).publish(owner, 'ecommerce');
  async function receipt(amount = '120.00', changes: Record<string, unknown> = {}) {
    await importer.commit(owner, { sourceId: 'books', format: 'csv', content: csv(amount, String(tick)), expectedTotals: { rowCount: 1, amountMinor: String(BigInt(amount.replace('.', ''))) } });
    tick += 1000;
    return calculator.calculate(owner, { operation: 'earned', sourceIds: ['books'], branch: 'main', period, asOf: new Date(tick).toISOString(), ...changes });
  }
  const baseline = await receipt();
  async function published(changes: Partial<AlertCreate> = {}) {
    const draft = await service.create(owner, config(baseline.id, changes));
    return service.publish(owner, draft.id, { expectedRevision: draft.revision });
  }
  return { store, service, calculator, receipt, baseline, published, nextTime: () => new Date(tick += 1000).toISOString(), advance: (ms: number) => { tick += ms; } };
}

test('definition validation, private drafts, publication and one condition identity', async () => {
  const f = await setup();
  for (const changes of [{ clearMinor: '10000' }, { activateMinor: '1.5' }, { activation: { observations: 0, durationMs: 0 } },
    { unit: { kind: 'money' as const, currency: 'USD' } }, { sourceIds: ['books', 'absent'] }, { severity: { initial: 'warning' as const, criticalMinor: '9000', downgrade: 'on-clear' as const } }]) {
    await assert.rejects(f.service.create(owner, config(f.baseline.id, changes)));
  }
  const input = config(f.baseline.id), draft = await f.service.create(owner, input); input.label = 'mutated caller';
  assert.equal(draft.status, 'draft'); assert.equal(f.service.get(owner, draft.id).definition.label, 'Earned revenue threshold');
  await assert.rejects(f.service.evaluate(owner, draft.id, { expectedRevision: 1, observationId: 'first', observedAt: f.baseline.asOf, receiptId: f.baseline.id }), { code: 'ALERT_NOT_PUBLISHED' });
  await assert.rejects(f.service.create(owner, config(f.baseline.id)), { code: 'ALERT_CONDITION_EXISTS' });
  assert.equal(f.service.list(owner).length, 1);
  await assert.rejects(f.service.publish(owner, draft.id, { expectedRevision: 0 }), { code: 'ALERT_REVISION_CONFLICT' });
  const published = await f.service.publish(owner, draft.id, { expectedRevision: 1 });
  assert.equal(published.status, 'published'); assert.equal(published.revision, 2);
  await assert.rejects(f.service.publish(owner, draft.id, { expectedRevision: 2 }), { code: 'ALERT_ALREADY_PUBLISHED' });
});

test('duplicate identities and duplicate recalculated receipts never advance persistence or notices', async () => {
  const f = await setup(), alert = await f.published({ activation: { observations: 2, durationMs: 0 } });
  const input = { expectedRevision: alert.revision, observationId: 'sample', observedAt: f.baseline.asOf, receiptId: f.baseline.id };
  const first = await f.service.evaluate(owner, alert.id, input);
  assert.equal(first.alert.episodes.length, 0);
  const retry = await f.service.evaluate(owner, alert.id, input);
  assert.equal(retry.duplicate, true); assert.equal(retry.alert.revision, first.alert.revision);
  const reordered = await f.service.evaluate(owner, alert.id, { receiptId: input.receiptId, observedAt: input.observedAt, observationId: input.observationId, expectedRevision: input.expectedRevision });
  assert.equal(reordered.duplicate, true);
  await assert.rejects(f.service.evaluate(owner, alert.id, { ...input, missingReason: 'none', receiptId: undefined }), { code: 'ALERT_OBSERVATION_CONFLICT' });
  const receipt = await f.calculator.calculate(owner, { operation: 'earned', period, branch: 'main', sourceIds: ['books'], asOf: f.baseline.asOf });
  const repeat = await f.service.evaluate(owner, alert.id, { ...input, observationId: 'another-job', receiptId: receipt.id });
  assert.equal(repeat.duplicate, true); assert.deepEqual(repeat.notices, []); assert.equal(repeat.alert.observations.length, 1);
});

test('default calculator cuts remain distinct samples of unchanged reconciled facts', async () => {
  const f = await setup(), alert = await f.published({ activation: { observations: 2, durationMs: 0 } });
  const receipt = await f.calculator.calculate(owner, { operation: 'earned', sourceIds: ['books'], branch: 'main', period });
  const first = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'default-a', observedAt: receipt.asOf, receiptId: receipt.id });
  let next = await f.calculator.calculate(owner, { operation: 'earned', sourceIds: ['books'], branch: 'main', period });
  if (next.asOf === receipt.asOf) next = await f.calculator.calculate(owner, { operation: 'earned', sourceIds: ['books'], branch: 'main', period });
  assert.ok(next.asOf > receipt.asOf);
  const second = await f.service.evaluate(owner, alert.id, { expectedRevision: first.alert.revision, observationId: 'default-b', observedAt: next.asOf, receiptId: next.id });
  assert.equal(second.duplicate, false); assert.equal(second.alert.episodes[0].status, 'open');
});

test('a missing tick cannot let a moving measurement window move backwards', async () => {
  const f = await setup(), alert = await f.published({ periodMode: 'moving' });
  const first = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'september', observedAt: f.baseline.asOf, receiptId: f.baseline.id });
  const missing = await f.service.evaluate(owner, alert.id, { expectedRevision: first.alert.revision, observationId: 'missing', observedAt: f.nextTime(), missingReason: 'Source did not arrive' });
  const earlier = await f.receipt('50.00', { period: { from: '2026-08-01', to: '2026-08-30' } });
  await assert.rejects(f.service.evaluate(owner, alert.id, { expectedRevision: missing.alert.revision, observationId: 'august', observedAt: earlier.asOf, receiptId: earlier.id }), { code: 'ALERT_WINDOW_CHANGED' });
});

test('on-observation severity can fall in the hysteresis band while the episode stays open', async () => {
  const f = await setup(), alert = await f.published({ severity: { initial: 'warning', criticalMinor: '15000', downgrade: 'on-observation' } });
  const critical = await f.receipt('200.00');
  const opened = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'critical', observedAt: critical.asOf, receiptId: critical.id });
  const band = await f.receipt('90.00');
  const lowered = await f.service.evaluate(owner, alert.id, { expectedRevision: opened.alert.revision, observationId: 'band', observedAt: band.asOf, receiptId: band.id });
  assert.equal(lowered.alert.episodes[0].status, 'open'); assert.equal(lowered.alert.episodes[0].severity, 'warning');
  assert.equal(lowered.notices[0].transition, 'deescalated');
});

test('late complete evidence can amend an unavailable fixed-window observation', async () => {
  const f = await setup(), alert = await f.published();
  const missingAt = f.nextTime();
  const missing = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'unavailable', observedAt: missingAt, missingReason: 'Export missing' });
  const recovered = await f.receipt('120.00');
  const corrected = await f.service.evaluate(owner, alert.id, { expectedRevision: missing.alert.revision, observationId: 'recovered', observedAt: missingAt,
    receiptId: recovered.id, correction: { observationId: 'unavailable', reason: 'Late complete export recovered' } });
  assert.equal(corrected.alert.episodes[0].status, 'open'); assert.equal(corrected.notices[0].transition, 'amended');
});

test('exact below thresholds preserve huge integer values and inclusive boundaries', async () => {
  const f = await setup();
  const huge = '900719925474099391';
  const receipt = await f.receipt('9007199254740993.91');
  const draft = await f.service.create(owner, config(receipt.id, { direction: 'below', activateMinor: huge, clearMinor: '900719925474099500', severity: { initial: 'critical', downgrade: 'on-clear' } }));
  const alert = await f.service.publish(owner, draft.id, { expectedRevision: 1 });
  const result = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'huge', observedAt: receipt.asOf, receiptId: receipt.id });
  assert.equal(result.alert.observations[0].valueMinor, huge); assert.equal(result.alert.episodes[0].severity, 'critical');
});

test('freshness and sample gaps break activation continuity without inventing a clear', async () => {
  const f = await setup(), alert = await f.published({ activation: { observations: 2, durationMs: 5000 }, maxObservationGapMs: 3000 });
  let result = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'a', observedAt: f.baseline.asOf, receiptId: f.baseline.id });
  f.advance(6000); const later = await f.receipt();
  result = await f.service.evaluate(owner, alert.id, { expectedRevision: result.alert.revision, observationId: 'b', observedAt: later.asOf, receiptId: later.id });
  assert.equal(result.alert.episodes.length, 0);
  f.advance(3600001); const old = await f.service.evaluate(owner, alert.id, { expectedRevision: result.alert.revision, observationId: 'missing', observedAt: f.nextTime(), missingReason: 'source stopped' });
  assert.equal(old.alert.observations.at(-1)!.state, 'unknown');
  const g = await setup(), opened = await g.published(); g.advance(3600001);
  const expired = await g.service.evaluate(owner, opened.id, { expectedRevision: 2, observationId: 'expired', observedAt: g.baseline.asOf, receiptId: g.baseline.id });
  assert.equal(expired.alert.observations[0].state, 'unknown'); assert.ok(expired.alert.observations[0].issues.includes('expired-evidence'));
});

test('reads and commit entry recheck source, branch, epoch and private owner authority', async () => {
  for (const mutation of ['source', 'branch', 'epoch', 'inactive']) {
    const f = await setup(), alert = await f.published();
    await f.store.update(state => {
      if (mutation === 'source') state.sourceRules.push({ sourceId: 'books', revoked: true });
      if (mutation === 'branch') state.members[0].branches = ['west'];
      if (mutation === 'epoch') state.members[0].epoch++;
      if (mutation === 'inactive') state.members[0].active = false;
    });
    assert.throws(() => f.service.get(owner, alert.id));
    await assert.rejects(f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'denied', observedAt: f.baseline.asOf, receiptId: f.baseline.id }));
    if (mutation === 'source' || mutation === 'branch') assert.deepEqual(f.service.list(owner), []);
    else assert.throws(() => f.service.list(owner), { code: 'ACCESS_REVOKED' });
    assert.equal(f.store.read().answers.find(a => a.id === alert.id).observations.length, 0);
  }
  const f = await setup(), alert = await f.published();
  await f.store.update(state => state.members.push({ id: 'reader', role: 'viewer', name: 'Reader', active: true, epoch: 1, branches: ['*'] }));
  const reader: Context = { memberId: 'reader', role: 'viewer', epoch: 1, channel: 'desktop' };
  assert.throws(() => f.service.get(reader, alert.id), { code: 'ALERT_NOT_FOUND' }); assert.deepEqual(f.service.list(reader), []);
  await assert.rejects(f.service.create(reader, config(f.baseline.id)), { code: 'FORBIDDEN' });
  for (const ctx of [{ ...owner, channel: 'phone' as const }, { ...owner, sourceTainted: true }]) await assert.rejects(f.service.create(ctx, config(f.baseline.id)), { code: 'ALERT_APP_REQUIRED' });
});

test('queued commit uses current transaction authority and view-aware host guards', async () => {
  const underlying = new FixtureStateStore(); let revoke = false;
  const store: StateStore = { read: () => underlying.read(), update: change => underlying.update(state => {
    if (revoke) state.members[0].epoch++;
    return change(state);
  }) };
  const seen: StateStore[] = [];
  const f = await setup(store, { calculatorOptions: snapshot => {
    seen.push(snapshot); return { receiptGuard: (ctx, receipt) => { assert.equal(snapshot.read().members[0].epoch, ctx.epoch); assert.equal(receipt.requestedSourceIds?.[0], 'books'); } };
  } });
  const alert = await f.published(); assert.ok(seen.length >= 3); assert.ok(seen.every(snapshot => snapshot !== store));
  revoke = true;
  await assert.rejects(f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'race', observedAt: f.baseline.asOf, receiptId: f.baseline.id }), { code: 'ACCESS_REVOKED' });
  assert.equal(underlying.read().answers.find(a => a.id === alert.id).observations.length, 0);
});

test('host receipt guard denials, meaning changes and evidence mutations gate reopening', async () => {
  for (const mutation of ['guard', 'meaning', 'receipt', 'request']) {
    let denied = false;
    const f = await setup(undefined, { receiptGuard: () => { if (denied) throw new ChausarError('HOST_NOT_READY', 'Current connector authority denied reuse.'); } });
    const alert = await f.published();
    if (mutation === 'guard') denied = true;
    if (mutation === 'meaning') await new OntologyService(f.store).publish(owner, 'retail');
    if (mutation === 'receipt') await f.store.update(state => { state.receipts[0].figures[0].minor = '3'; });
    if (mutation === 'request') await f.store.update(state => { state.answers.find(a => a.receiptId === f.baseline.id).request.customerId = 'different'; });
    if (mutation !== 'meaning') assert.throws(() => f.service.get(owner, alert.id));
    await assert.rejects(f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'changed', observedAt: f.baseline.asOf, receiptId: f.baseline.id }));
  }
});

test('narrower source or customer scope, changed window and changed units cannot clear', async () => {
  for (const changes of [{ sourceIds: [] }, { customerId: 'absent' }, { period: { from: '2026-08-01', to: '2026-08-31' } }]) {
    const f = await setup(), alert = await f.published();
    const r = await f.receipt('50.00', changes);
    await assert.rejects(f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'wrong', observedAt: r.asOf, receiptId: r.id }));
  }
  const f = await setup(), alert = await f.published(), r = await f.receipt('50.00');
  await f.store.update(state => { state.receipts.find(item => item.id === r.id).figures[0].currency = 'USD'; });
  await assert.rejects(f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'wrong-unit', observedAt: r.asOf, receiptId: r.id }), { code: 'ALERT_UNIT_CHANGED' });
});

test('unknown corrections retain breaches and qualified corrections append retractions', async () => {
  const f = await setup(), alert = await f.published();
  const opened = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'original', observedAt: f.baseline.asOf, receiptId: f.baseline.id });
  const unknown = await f.service.evaluate(owner, alert.id, { expectedRevision: opened.alert.revision, observationId: 'uncertain-correction', observedAt: f.baseline.asOf,
    missingReason: 'Correction has no measured amount', correction: { observationId: 'original', reason: 'Late source report unavailable' } });
  assert.equal(unknown.alert.episodes[0].status, 'open'); assert.equal(unknown.alert.episodes[0].uncertain, true);
  const corrected = await f.receipt('50.00');
  const amended = await f.service.evaluate(owner, alert.id, { expectedRevision: unknown.alert.revision, observationId: 'measured-correction', observedAt: f.baseline.asOf,
    receiptId: corrected.id, correction: { observationId: 'original', reason: 'Source restated the original total' } });
  assert.equal(amended.alert.episodes[0].status, 'retracted'); assert.equal(amended.alert.observations.length, 3);
  assert.equal(amended.notices[0].transition, 'amended'); assert.equal(amended.notices[0].before!.status, 'open');
  assert.equal(amended.notices[0].delivery, 'local-only');
});

test('new-episode and never reopening policies preserve a single active episode', async () => {
  for (const reopening of ['new-episode', 'never'] as const) {
    const f = await setup(), alert = await f.published({ reopening });
    const first = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'first', observedAt: f.baseline.asOf, receiptId: f.baseline.id });
    const low = await f.receipt('50.00');
    const cleared = await f.service.evaluate(owner, alert.id, { expectedRevision: first.alert.revision, observationId: 'low', observedAt: low.asOf, receiptId: low.id });
    const high = await f.receipt('120.00');
    const next = await f.service.evaluate(owner, alert.id, { expectedRevision: cleared.alert.revision, observationId: 'high-again', observedAt: high.asOf, receiptId: high.id });
    assert.equal(next.alert.episodes.filter(episode => episode.status === 'open').length, reopening === 'new-episode' ? 1 : 0);
    assert.equal(next.alert.episodes.length, reopening === 'new-episode' ? 2 : 1);
    assert.equal(next.alert.episodes[0].status, 'cleared');
    assert.equal(next.notices.length, reopening === 'new-episode' ? 1 : 0);
  }
});

test('basis-point thresholds use the real ratio figure and a missing denominator cannot clear', async () => {
  const f = await setup();
  async function margin(refund = false) {
    const content = `${header}\nrow,sale,2026-09-10,120.00,INR,c,i,o,,delivered,sale,main\ncost,cost,2026-09-10,80.00,INR,c,i,o,,settled,cost,main\n`
      + (refund ? 'refund,refund,2026-09-10,120.00,INR,c,i,o,,settled,refund,main\n' : '');
    await new ImportService(f.store).commit(owner, { sourceId: 'books', format: 'csv', content, expectedTotals: { rowCount: refund ? 3 : 2, amountMinor: refund ? '32000' : '20000' } });
    return f.calculator.calculate(owner, { operation: 'margin', sourceIds: ['books'], branch: 'main', period, asOf: f.nextTime() });
  }
  const baseline = await margin();
  assert.equal(baseline.figures.find(figure => figure.key === 'marginBps')!.minor, '3333');
  const draft = await f.service.create(owner, config(baseline.id, { figureKey: 'marginBps', unit: { kind: 'basis-points' }, activateMinor: '3000', clearMinor: '1000', severity: { initial: 'warning', criticalMinor: '5000', downgrade: 'on-clear' } }));
  const alert = await f.service.publish(owner, draft.id, { expectedRevision: 1 });
  const first = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'ratio', observedAt: baseline.asOf, receiptId: baseline.id });
  const undefinedRatio = await margin(true);
  assert.equal(undefinedRatio.figures.some(figure => figure.key === 'marginBps'), false);
  const result = await f.service.evaluate(owner, alert.id, { expectedRevision: first.alert.revision, observationId: 'undefined', observedAt: undefinedRatio.asOf, receiptId: undefinedRatio.id });
  assert.equal(result.alert.observations.at(-1)!.state, 'unknown'); assert.ok(result.alert.observations.at(-1)!.issues.includes('missing-figure'));
  assert.equal(result.alert.episodes[0].status, 'open'); assert.equal(result.alert.episodes[0].uncertain, true);
});

test('source scope is a set even when callers enumerate sources in different orders', async () => {
  const f = await setup();
  await new ImportService(f.store).commit(owner, { sourceId: 'other', format: 'csv', content: csv('20.00').replace('row,sale', 'another,sale'), expectedTotals: { rowCount: 1, amountMinor: '2000' } });
  const cut = f.nextTime();
  const receipt = await f.calculator.calculate(owner, { operation: 'earned', sourceIds: ['books', 'other'], branch: 'main', period, asOf: cut });
  const draft = await f.service.create(owner, config(receipt.id, { sourceIds: ['books', 'other'] }));
  const alert = await f.service.publish(owner, draft.id, { expectedRevision: 1 });
  const first = await f.service.evaluate(owner, alert.id, { expectedRevision: 2, observationId: 'first', observedAt: cut, receiptId: receipt.id });
  const reversed = await f.calculator.calculate(owner, { operation: 'earned', sourceIds: ['other', 'books'], branch: 'main', period, asOf: cut });
  const duplicate = await f.service.evaluate(owner, alert.id, { expectedRevision: first.alert.revision, observationId: 'other-order', observedAt: cut, receiptId: reversed.id });
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.alert.observations.length, 1);
});
