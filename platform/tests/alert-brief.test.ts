import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertsService, type AlertCreate } from '../runtime/alerts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ImportService } from '../runtime/ingest.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { FixtureStateStore } from './database-fixtures.ts';
import type { Context } from '../runtime/contracts.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
async function fixture() {
  const store = new FixtureStateStore();
  await new OntologyService(store).publish(owner, 'ecommerce');
  await new ImportService(store).commit(owner, { sourceId: 'books', format: 'csv',
    content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n'
      + 'row,sale,2026-09-10,120.00,INR,customer,invoice,order,,delivered,SYNTHETIC_BRIEF_EXPIRY,main\n',
    expectedTotals: { rowCount: 1, amountMinor: '12000' } });
  const receipt = await new CalculatorService(store).calculate(owner, {
    operation: 'earned', sourceIds: ['books'], branch: 'main', period: { from: '2026-09-01', to: '2026-09-30' },
  });
  // Explicit synthetic trusted-host clock; this fixture does not qualify a native clock or deployment.
  let at = Date.now() + 1000;
  const service = new AlertsService(store, { clock: () => new Date(at).toISOString() });
  const definition: AlertCreate = { conditionId: 'synthetic-earned-high', label: 'Synthetic retained condition',
    baselineReceiptId: receipt.id, figureKey: 'total', unit: { kind: 'money', currency: 'INR' }, sourceIds: ['books'],
    periodMode: 'fixed', direction: 'above', activateMinor: '10000', clearMinor: '8000',
    activation: { observations: 1, durationMs: 0 }, clearance: { observations: 1, durationMs: 0 },
    severity: { initial: 'warning', downgrade: 'on-clear' }, reopening: 'same-episode',
    maxEvidenceAgeMs: 60000, maxObservationGapMs: 30000 };
  const draft = await service.create(owner, definition), published = await service.publish(owner, draft.id, { expectedRevision: 1 });
  const evaluated = await service.evaluate(owner, published.id, { expectedRevision: published.revision,
    observationId: 'synthetic-known-breach', observedAt: receipt.asOf, receiptId: receipt.id });
  return { store, service, alert: evaluated.alert, advance: (ms: number) => { at += ms; } };
}

test('retained brief expires last-known evidence without mutating or clearing an open episode', async () => {
  const f = await fixture(), before = f.store.read(), first = f.service.brief(owner);
  assert.equal(first.evaluated, false); assert.equal(first.items[0].evidence.state, 'current');
  assert.equal(first.items[0].episodes[0].status, 'open');
  f.advance(1000); assert.equal(f.service.brief(owner).pin, first.pin, 'Clock-only reads before expiry preserve the content pin.');
  f.advance(60001); const expired = f.service.brief(owner);
  assert.equal(expired.items[0].evidence.state, 'uncertain');
  assert.ok(expired.items[0].evidence.issues.includes('expired-evidence'));
  assert.ok(expired.items[0].evidence.issues.includes('observation-gap'));
  assert.deepEqual(expired.items[0].episodes, f.alert.episodes); assert.notEqual(expired.pin, first.pin);
  assert.deepEqual(f.store.read(), before, 'A brief is an observation read, not an evaluation, clear, audit append or delivery.');
});

test('a changed definition cannot turn retained evidence into a current brief condition', async () => {
  const f = await fixture();
  await new OntologyService(f.store).publish(owner, 'ecommerce');
  const before = f.store.read(), brief = f.service.brief(owner);
  assert.equal(brief.items[0].evidence.state, 'uncertain');
  assert.ok(brief.items[0].evidence.issues.includes('definition-changed'));
  assert.deepEqual(brief.items[0].episodes, f.alert.episodes);
  assert.deepEqual(f.store.read(), before);
  assert.throws(() => f.service.brief(owner, { sourceIds: ['books', 'books'] }), { code: 'INVALID_SOURCE_SCOPE' });
});
