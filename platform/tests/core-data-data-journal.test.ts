import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, ChausarError, initialState, type Context, type Fact, type State, type StateStore } from '../runtime/contracts.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import { cancelDecision, confirmDecision, draftDecision, dueDecisions, reviewDecision, reviseDecision, type JournalContent, type JournalObservation } from '../runtime/decision-journal.ts';
import { ReportService } from '../runtime/reports.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { dataMethods } from '../runtime/core-data/data.ts';

// The decision journal's "recorded later" date and "cancelled" state (AS-15). Synthetic saved evidence only.

const AMOUNT = '900719925474099391';
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (value: string) => (error: unknown) => (error as ChausarError).code === value;
function receipt(id: string): CalculationReceipt {
  return { id, memberId: 'owner', epoch: 1, sourceIds: ['source-base'], operation: 'earned', createdAt: '2026-09-30T12:00:00.000Z', asOf: '2026-09-30T12:00:00.000Z',
    period: { from: '2026-09-01', to: '2026-09-30' }, comparePeriod: null, branch: 'main', currency: 'INR', ontologyVersion: 1, dictionaryHash: 'a'.repeat(64), definitionHash: 'b'.repeat(64), definitions: [],
    figures: [{ key: 'total', label: 'Earned revenue', minor: AMOUNT, display: 'INR 9,007,199,254,740,993.91', unit: 'money', currency: 'INR' }], valueMinor: AMOUNT, totalMinor: AMOUNT, rowIds: ['row-base'],
    rows: [{ factId: 'row-base', entityId: 'row-base', sourceId: 'source-base', sourceRow: 2, kind: 'sale', amountMinor: AMOUNT, validFrom: '2026-09-12', branch: 'main' }],
    exclusions: [], coverage: { selectedRows: 1, countedRows: 1, excludedRows: 0, unresolvedConflicts: 0, importIds: [], completeness: 'unreconciled-facts', gaps: [] },
    assumptions: {}, explanation: 'Synthetic saved evidence.', stale: false, allowedNumbers: [AMOUNT] } as CalculationReceipt;
}
function content(overrides: Partial<JournalContent> = {}): JournalContent {
  return { text: 'Keep the present distributor terms pending human review.',
    options: [{ id: 'keep', label: 'Keep terms', reason: 'Observe first.', evidence: [{ receiptId: 'receipt-base', figureKey: 'total' }] }, { id: 'change', label: 'Change terms', reason: 'An alternative.', evidence: [] }],
    assumptions: [], selectedOptionId: 'keep', ownerId: 'owner',
    expectedOutcome: { description: 'Review the result.', measure: 'earned revenue', population: 'main-branch orders', window: { from: '2026-10-01', to: '2026-10-10' }, maturityDate: '2026-10-15', lagRule: 'Human review after maturity.', uncertainty: [] },
    reviewDate: '2026-10-15', hypotheses: [], branch: 'main', ...overrides };
}
const observation: JournalObservation = { state: 'pending', measurements: [], notes: 'Awaiting evidence.', uncertainty: [], concurrentInterventions: [], executionReceiptIds: [] };
const AT = '2026-10-14T10:00:00.000Z';
const confirm = (c: JournalContent, extra: Record<string, unknown> = {}) => { const draft = draftDecision(c, [receipt('receipt-base')]); return confirmDecision(draft, { reviewedDigest: draft.digest, id: 'decision-1', actorId: 'owner', at: AT, receipts: [receipt('receipt-base')], ...extra }); };

test('AS-15: a decision without a decided-on date keeps its digest and shape', () => {
  const plain = draftDecision(content(), [receipt('receipt-base')]);
  assert.equal(draftDecision({ ...content(), decidedOn: undefined }, [receipt('receipt-base')]).digest, plain.digest);
  assert.equal(Object.hasOwn(plain.content, 'decidedOn'), false);
  const decision = confirm(content());
  for (const key of ['decidedOn', 'recordedOn', 'recordedLater', 'cancellation']) assert.equal(Object.hasOwn(decision, key), false, key);
});

test('AS-15: a decided-on date earlier than the recording day marks the decision recorded later; it is never after it', () => {
  assert.throws(() => draftDecision(content({ decidedOn: '2026-02-30' }), [receipt('receipt-base')]), code('INVALID_DECISION'));
  const later = confirm(content({ decidedOn: '2026-10-02' }));
  assert.deepEqual([later.decidedOn, later.recordedOn, later.recordedLater], ['2026-10-02', '2026-10-14', true]);
  const same = confirm(content({ decidedOn: '2026-10-14' }));
  assert.deepEqual([same.recordedOn, same.recordedLater], ['2026-10-14', false]);
  assert.throws(() => confirm(content({ decidedOn: '2026-10-15' })), code('DECIDED_ON_LATER'));
  // The workspace's own calendar day may be one day off the UTC day, never more.
  assert.equal(confirm(content({ decidedOn: '2026-10-15' }), { recordedOn: '2026-10-15' }).recordedLater, false);
  assert.throws(() => confirm(content({ decidedOn: '2026-10-02' }), { recordedOn: '2026-10-17' }), code('INVALID_TIMESTAMP'));
  // A revision keeps the recording day; the decided-on date can move only within it.
  const revised = reviseDecision(later, content({ decidedOn: '2026-10-05' }), { expectedRevision: 1, actorId: 'owner', at: '2026-10-20T10:00:00.000Z', reason: 'The meeting was later.', receipts: [] });
  assert.deepEqual([revised.decidedOn, revised.recordedOn, revised.recordedLater, revised.revision], ['2026-10-05', '2026-10-14', true, 2]);
  assert.throws(() => reviseDecision(later, content({ decidedOn: '2026-10-16' }), { expectedRevision: 1, actorId: 'owner', at: '2026-10-20T10:00:00.000Z', reason: 'x', receipts: [] }), code('DECIDED_ON_LATER'));
  const reviewed = reviewDecision(revised, { outcome: 'continue', observation, nextReviewDate: '2026-11-01' }, { expectedRevision: 2, actorId: 'owner', at: '2026-10-21T10:00:00.000Z', receipts: [] });
  assert.deepEqual([reviewed.decidedOn, reviewed.recordedOn, reviewed.recordedLater], ['2026-10-05', '2026-10-14', true]);
});

test('AS-15: only an open decision is cancelled, with its reason, by whom and when; it is then never due and never changed', () => {
  const open = confirm(content());
  assert.throws(() => cancelDecision(open, { expectedRevision: 2, actorId: 'owner', at: AT, reason: 'Plans changed.' }), code('REVISION_CONFLICT'));
  assert.throws(() => cancelDecision(open, { expectedRevision: 1, actorId: 'owner', at: AT, reason: '  ' }), code('INVALID_CANCELLATION'));
  const cancelled = cancelDecision(open, { expectedRevision: 1, actorId: 'owner', at: AT, reason: ' The supplier closed. ' });
  assert.deepEqual([cancelled.status, cancelled.revision, cancelled.cancellation], ['cancelled', 2, { reason: 'The supplier closed.', by: 'owner', at: AT }]);
  assert.equal(open.status, 'open', 'the input is not changed');
  assert.deepEqual(dueDecisions([open, cancelled], { dueOn: '2026-12-31' }).map(d => d.status), ['open']);
  assert.throws(() => cancelDecision(cancelled, { expectedRevision: 2, actorId: 'owner', at: AT, reason: 'Again.' }), code('DECISION_CANCELLED'));
  assert.throws(() => reviewDecision(cancelled, { outcome: 'accepted', observation }, { expectedRevision: 2, actorId: 'owner', at: AT, receipts: [] }), code('DECISION_CANCELLED'));
  assert.throws(() => reviseDecision(cancelled, content(), { expectedRevision: 2, actorId: 'owner', at: AT, reason: 'x', receipts: [] }), code('DECISION_CANCELLED'));
  const closed = reviewDecision(open, { outcome: 'completed', observation }, { expectedRevision: 1, actorId: 'owner', at: AT, receipts: [] });
  assert.throws(() => cancelDecision(closed, { expectedRevision: 2, actorId: 'owner', at: AT, reason: 'Too late.' }), code('DECISION_NOT_OPEN'));
});

class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic Journal Shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const fact: Fact = { id: 'row-base', entityId: 'row-base', sourceId: 'source-base', sourceRow: 2, kind: 'sale', validFrom: '2026-09-12', validTo: null, learnedAt: new Date().toISOString(), supersededAt: null, fields: { amountMinor: AMOUNT, currency: 'INR' }, branch: 'main' };

test('AS-15 through the journal facade and decisions.journal.cancel: the workspace day decides "recorded later"', async () => {
  const store = new TestStore(); await store.update(s => { s.facts.push(structuredClone(fact)); s.receipts.push(receipt('receipt-base')); s.workspace.timeZone = 'Pacific/Kiritimati'; });
  const reports = new ReportService(store);
  const host: ModuleHost = { store, services: { reports }, demo: true, directory: '/nonexistent', options: {}, async call() { throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); } };
  const call = (ctx: Context, method: string, payload: Record<string, unknown>) => { authorize(store, ctx, dataMethods[method].permission); return dataMethods[method].handler(ctx, payload, host) as Promise<any>; };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  assert.throws(() => reports.draftDecision(owner, content({ decidedOn: tomorrow })), code('DECIDED_ON_LATER'));
  const draft = reports.draftDecision(owner, content({ decidedOn: '2026-01-05' }));
  const decision = await reports.confirmDecision(owner, draft, { reviewedDigest: draft.digest });
  assert.deepEqual([decision.recordedOn, decision.recordedLater], [today, true], 'the recording day is the workspace\'s own day (UTC+14 here)');

  await assert.rejects(call({ ...owner, channel: 'phone' }, 'decisions.journal.cancel', { id: decision.id, revision: 1, reason: 'No.' }), code('APP_DECISION_REQUIRED'));
  await assert.rejects(call({ ...owner, sourceTainted: true }, 'decisions.journal.cancel', { id: decision.id, revision: 1, reason: 'No.' }), code('APP_DECISION_REQUIRED'));
  await assert.rejects(call(owner, 'decisions.journal.cancel', { id: decision.id, revision: 1 }), code('INVALID_CANCELLATION'));
  await assert.rejects(call(owner, 'decisions.journal.cancel', { id: decision.id, revision: 0, reason: 'No.' }), code('REVISION_CONFLICT'));
  await assert.rejects(call(owner, 'decisions.journal.cancel', { id: 'missing', revision: 1, reason: 'No.' }), code('DECISION_NOT_FOUND'));
  const cancelled = await call(owner, 'decisions.journal.cancel', { id: decision.id, revision: 1, reason: 'The supplier closed.' });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.cancellation.by, 'owner');
  assert.equal(store.read().decisions[0].status, 'cancelled');
  assert.deepEqual(reports.dueDecisions(owner, { dueOn: '2027-01-01' }), []);
  assert.equal(store.read().activity.filter(a => a.event === 'decision.cancelled').length, 1);
  await assert.rejects(call(owner, 'decisions.journal.cancel', { id: decision.id, revision: 2, reason: 'Again.' }), code('DECISION_CANCELLED'));
});
