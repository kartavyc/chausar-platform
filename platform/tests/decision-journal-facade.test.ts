import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import { check, type Context, type Fact, type State, type StateStore } from '../runtime/contracts.ts';
import type { JournalContent, JournalDecision, JournalObservation } from '../runtime/decision-journal.ts';
import { draftDecision as syntheticClientDraft } from '../runtime/decision-journal.ts';
import { ReportService, type ReportOptions } from '../runtime/reports.ts';
import { TrustService } from '../runtime/trust.ts';
import { Vault } from '../runtime/vault.ts';

const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const PREPARER: Context = { memberId: 'preparer', role: 'accountant', epoch: 1 };
const VIEWER: Context = { memberId: 'viewer', role: 'viewer', epoch: 1 };
const FIXTURE_AMOUNT = '900719925474099391';

// These saved calculation receipts are explicit synthetic evidence. They do not
// exercise a calculator, database, provider, or external execution transport.
function receipt(id: string, sourceId: string, rowId: string, ctx = OWNER): CalculationReceipt {
  return {
    id, memberId: ctx.memberId, epoch: ctx.epoch, sourceIds: [sourceId], operation: 'earned',
    createdAt: '2026-09-30T12:00:00.000Z', asOf: '2026-09-30T12:00:00.000Z',
    period: { from: '2026-09-01', to: '2026-09-30' }, comparePeriod: null,
    branch: 'main', currency: 'INR', ontologyVersion: 1,
    dictionaryHash: 'a'.repeat(64), definitionHash: 'b'.repeat(64), definitions: [],
    figures: [{ key: 'total', label: 'Earned revenue', minor: FIXTURE_AMOUNT,
      display: 'INR 9,007,199,254,740,993.91', unit: 'money', currency: 'INR' }],
    valueMinor: FIXTURE_AMOUNT, totalMinor: FIXTURE_AMOUNT, rowIds: [rowId],
    rows: [{ factId: rowId, entityId: rowId, sourceId, sourceRow: 2, kind: 'sale',
      amountMinor: FIXTURE_AMOUNT, validFrom: '2026-09-12', branch: 'main' }],
    exclusions: [], coverage: { selectedRows: 1, countedRows: 1, excludedRows: 0,
      unresolvedConflicts: 0, importIds: [], completeness: 'unreconciled-facts', gaps: [] },
    assumptions: {}, explanation: 'Synthetic saved receipt; no causal assessment.',
    stale: false, allowedNumbers: [FIXTURE_AMOUNT],
  };
}

function fact(id: string, sourceId: string): Fact {
  return { id, entityId: id, sourceId, sourceRow: 2, kind: 'sale',
    validFrom: '2026-09-12', validTo: null, learnedAt: new Date().toISOString(),
    supersededAt: null, fields: { amountMinor: FIXTURE_AMOUNT, currency: 'INR' }, branch: 'main' };
}

function content(overrides: Partial<JournalContent> = {}): JournalContent {
  return {
    text: 'Keep the present distributor terms pending human review.',
    options: [
      { id: 'keep', label: 'Keep terms', reason: 'Observe before making another intervention.',
        evidence: [{ receiptId: 'receipt-base', figureKey: 'total' }] },
      { id: 'change', label: 'Change terms', reason: 'An alternative for human assessment.', evidence: [] },
    ],
    assumptions: [{ id: 'lag', text: 'Payments might arrive after this observation window.',
      status: 'unverified', evidence: [] }],
    selectedOptionId: 'keep', ownerId: 'decision-owner',
    expectedOutcome: { description: 'Review the observed business result.', measure: 'earned revenue',
      population: 'main-branch distributor orders', baseline: { receiptId: 'receipt-base', figureKey: 'total' },
      window: { from: '2026-10-01', to: '2026-10-10' }, maturityDate: '2026-10-15',
      lagRule: 'Human review after the declared maturity date.', uncertainty: ['Concurrent activity can affect the result.'] },
    reviewDate: '2026-10-15', hypotheses: ['No measured causal explanation is available.'], branch: 'main',
    ...overrides,
  };
}

function observation(overrides: Partial<JournalObservation> = {}): JournalObservation {
  return { state: 'pending', measurements: [], notes: 'Human assessment awaits further evidence.',
    uncertainty: ['The result cannot establish causality.'], concurrentInterventions: [], executionReceiptIds: [], ...overrides };
}

// The wrapper delegates all commits to a real Vault. Only the next callback's
// transaction draft is changed; read() deliberately continues to expose the
// committed snapshot so pre-transaction checks cannot detect this fixture race.
class CallbackRaceStore implements StateStore {
  readonly vault: Vault;
  next?: (state: State) => void;
  constructor(vault: Vault) { this.vault = vault; }
  read() { return this.vault.read(); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const inject = this.next;
    this.next = undefined;
    return this.vault.update(state => { inject?.(state); return change(state); });
  }
}

async function fixture(t: TestContext, ctx = OWNER, options: ReportOptions = {}) {
  const tempRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'chausar-journal-facade-test-'));
  const { vault } = await Vault.create({ directory, name: 'Synthetic decision journal facade',
    passphrase: 'synthetic journal test passphrase sufficiently long', demo: true, storage: 'experimental-file' });
  t.after(async () => {
    await vault.close();
    const target = resolve(directory), descendant = relative(tempRoot, target);
    assert.ok(descendant && !descendant.startsWith('..') && !isAbsolute(descendant), 'Cleanup stays inside the temporary directory.');
    assert.ok(target.startsWith(join(tempRoot, 'chausar-journal-facade-test-')), 'Cleanup targets only this fixture prefix.');
    await rm(target, { recursive: true, force: true });
  });
  await vault.update(state => {
    state.members.push(
      { id: 'preparer', name: 'Synthetic accountant', role: 'accountant', active: true, epoch: 1, branches: ['main'] },
      { id: 'viewer', name: 'Synthetic viewer', role: 'viewer', active: true, epoch: 1, branches: ['main'] },
      { id: 'decision-owner', name: 'Synthetic decision owner', role: 'accountant', active: true, epoch: 1, branches: ['main'] },
      { id: 'other-owner', name: 'Synthetic replacement owner', role: 'cofounder', active: true, epoch: 1, branches: ['main'] },
    );
    state.facts.push(fact('row-base', 'source-base'), fact('row-excluded', 'source-base'),
      fact('row-measured', 'source-measured'), fact('row-execution', 'source-execution'));
    const base = receipt('receipt-base', 'source-base', 'row-base', ctx);
    base.exclusions = [{ rowId: 'row-excluded', reason: 'Outside the requested event period.' }];
    base.coverage.selectedRows = 2; base.coverage.excludedRows = 1;
    const measured = receipt('receipt-measured', 'source-measured', 'row-measured', ctx);
    measured.period = { from: '2020-01-01', to: '2020-01-31' };
    measured.figures[0].minor = '900719925474099400';
    measured.figures[0].display = 'INR 9,007,199,254,740,994.00';
    measured.valueMinor = measured.totalMinor = '900719925474099400';
    state.receipts.push(base, measured);
  });
  const store = new CallbackRaceStore(vault);
  return { vault, store, reports: new ReportService(store, options), ctx,
    trust: new TrustService(vault), directory };
}

async function confirmed(f: Awaited<ReturnType<typeof fixture>>, input = content()): Promise<JournalDecision> {
  const draft = f.reports.draftDecision(f.ctx, input);
  return f.reports.confirmDecision(f.ctx, draft, { reviewedDigest: draft.digest });
}

const decisionAudits = (state: State) => state.activity.filter(item => /decision|journal/.test(item.event));

test('an accountant can confirm an explicitly owned draft; snapshots, return values and audit are detached', async t => {
  const f = await fixture(t, PREPARER);
  const draft = f.reports.draftDecision(f.ctx, content());
  assert.equal(f.vault.read().decisions.length, 0);
  const saved = await f.reports.confirmDecision(f.ctx, draft, { reviewedDigest: draft.digest });
  assert.equal(saved.revision, 1); assert.equal(saved.by, PREPARER.memberId);
  assert.equal(saved.ownerId, 'decision-owner'); assert.equal(saved.status, 'open');
  assert.deepEqual(saved.rowIds, ['row-base', 'row-excluded']);
  assert.equal(saved.receipts[0].figures[0].minor, FIXTURE_AMOUNT);
  const events = decisionAudits(f.vault.read());
  assert.equal(events.length, 1); assert.equal(events[0].details.decisionId, saved.id);
  draft.content.text = 'Changed client draft'; draft.receipts[0].figures[0].minor = '1';
  saved.receipts[0].figures[0].minor = '2'; saved.options[0].label = 'Changed return value';
  const stored = f.vault.read().decisions[0];
  assert.equal(stored.receipts[0].figures[0].minor, FIXTURE_AMOUNT);
  assert.equal(stored.options[0].label, 'Keep terms');
  assert.equal(stored.text, content().text);
});

test('a draft digest never gives the client authority to substitute saved evidence', async t => {
  const f = await fixture(t);
  const draft = f.reports.draftDecision(f.ctx, content());
  const before = f.vault.read();
  draft.receipts[0].figures[0].minor = '1';
  await assert.rejects(f.reports.confirmDecision(f.ctx, draft, { reviewedDigest: draft.digest }), { code: 'DRAFT_CHANGED' });
  assert.equal(f.vault.read().decisions.length, 0);
  assert.equal(f.vault.read().activity.length, before.activity.length);
});

test('a valid client-computed digest still cannot confirm fabricated authoritative receipt content', async t => {
  const f = await fixture(t);
  const counterfeit = structuredClone(f.vault.read().receipts[0]) as CalculationReceipt;
  counterfeit.figures[0].minor = '1';
  const clientDraft = syntheticClientDraft(content(), [counterfeit]);
  const before = f.vault.read();
  await assert.rejects(f.reports.confirmDecision(f.ctx, clientDraft, { reviewedDigest: clientDraft.digest }), { code: 'EVIDENCE_CHANGED' });
  assert.deepEqual(f.vault.read().decisions, before.decisions);
  assert.deepEqual(f.vault.read().activity, before.activity);
});

test('confirmation rechecks evidence changed inside the transaction rather than its earlier committed copy', async t => {
  const f = await fixture(t);
  const draft = f.reports.draftDecision(f.ctx, content());
  const before = f.vault.read();
  f.store.next = state => { state.receipts[0].figures[0].minor = '3'; };
  await assert.rejects(f.reports.confirmDecision(f.ctx, draft, { reviewedDigest: draft.digest }), { code: 'EVIDENCE_CHANGED' });
  assert.deepEqual(f.vault.read().decisions, before.decisions);
  assert.deepEqual(f.vault.read().activity, before.activity);
});

test('the configured calculator receipt guard also receives the callback-state receipt', async t => {
  const f = await fixture(t, OWNER, { receiptGuard: (_ctx, value) => {
    check(value.explanation !== 'Synthetic callback guard refusal.', 'SYNTHETIC_RECEIPT_GUARD_DENIED', 'Synthetic guard refused the current receipt.');
  } });
  const draft = f.reports.draftDecision(f.ctx, content());
  f.store.next = state => { state.receipts[0].explanation = 'Synthetic callback guard refusal.'; };
  const before = f.vault.read();
  await assert.rejects(f.reports.confirmDecision(f.ctx, draft, { reviewedDigest: draft.digest }), { code: 'SYNTHETIC_RECEIPT_GUARD_DENIED' });
  assert.deepEqual(f.vault.read().decisions, before.decisions);
  assert.deepEqual(f.vault.read().activity, before.activity);
});

test('concurrent rich revision and review consume one expected revision and audit only the winner', async t => {
  const f = await fixture(t);
  const d = await confirmed(f);
  const auditCount = f.vault.read().activity.length;
  const results = await Promise.allSettled([
    f.reports.reviseDecision(f.ctx, d.id, content({ text: 'A revised human decision.' }), { expectedRevision: 1, reason: 'Clarify the record.' }),
    f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue', observation: observation(), nextReviewDate: '2026-11-01' }, { expectedRevision: 1 }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected');
  assert.ok(failed && failed.status === 'rejected'); assert.equal(failed.reason.code, 'REVISION_CONFLICT');
  const state = f.vault.read();
  assert.equal(state.decisions[0].revision, 2); assert.equal(state.activity.length, auditCount + 1);
  assert.equal(state.decisions[0].revisions.length + state.decisions[0].reviews.length, 1);
});

for (const race of [
  { name: 'caller permission epoch', code: 'ACCESS_REVOKED', inject: (s: State) => { s.members.find(m => m.id === PREPARER.memberId)!.epoch++; } },
  { name: 'current caller branch', code: 'FORBIDDEN_BRANCH', inject: (s: State) => { s.members.find(m => m.id === PREPARER.memberId)!.branches = ['west']; } },
  { name: 'current decision owner', code: 'INVALID_DECISION_OWNER', inject: (s: State) => { s.members.find(m => m.id === 'decision-owner')!.active = false; } },
  { name: 'saved receipt ownership', code: 'RECEIPT_FORBIDDEN', inject: (s: State) => { s.receipts[0].memberId = 'viewer'; } },
  { name: 'source grant', code: 'SOURCE_REVOKED', inject: (s: State) => { s.sourceRules.push({ sourceId: 'source-base', revoked: true }); } },
] as const) {
  test(`transaction callback rechecks ${race.name} and rolls back the refused rich write`, async t => {
    const f = await fixture(t, PREPARER), d = await confirmed(f);
    const before = f.vault.read();
    f.store.next = race.inject;
    await assert.rejects(f.reports.reviseDecision(f.ctx, d.id, content({ text: 'An unauthorized update.' }),
      { expectedRevision: 1, reason: 'Synthetic callback race.' }), { code: race.code });
    assert.deepEqual(f.vault.read().decisions, before.decisions);
    assert.deepEqual(f.vault.read().activity, before.activity);
  });
}

test('a permission change already queued ahead of a journal write takes effect before mutation', async t => {
  const f = await fixture(t, PREPARER), d = await confirmed(f);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(accept => { entered = accept; });
  const gate = new Promise<void>(accept => { release = accept; });
  const revoke = f.vault.update(async state => {
    entered(); await gate;
    state.members.find(member => member.id === PREPARER.memberId)!.active = false;
  });
  await started;
  const auditCount = f.vault.read().activity.length;
  const refused = assert.rejects(f.reports.reviewJournalDecision(f.ctx, d.id,
    { outcome: 'completed', observation: observation() }, { expectedRevision: 1 }), { code: 'ACCESS_REVOKED' });
  release(); await revoke; await refused;
  assert.equal(f.vault.read().decisions[0].revision, 1);
  assert.equal(f.vault.read().activity.length, auditCount);
});

test('current and proposed owners must be active with the decision branch; inactive ownership cannot be transferred', async t => {
  const f = await fixture(t), d = await confirmed(f);
  await f.vault.update(state => { state.members.find(member => member.id === 'other-owner')!.branches = ['west']; });
  await assert.rejects(f.reports.reviseDecision(f.ctx, d.id, content({ ownerId: 'other-owner' }),
    { expectedRevision: 1, reason: 'Owner outside the branch.' }), { code: 'INVALID_DECISION_OWNER' });
  await f.vault.update(state => { state.members.find(member => member.id === 'decision-owner')!.active = false; });
  await assert.rejects(f.reports.reviseDecision(f.ctx, d.id, content({ ownerId: 'owner' }),
    { expectedRevision: 1, reason: 'Attempted transfer from an inactive owner.' }), { code: 'INVALID_DECISION_OWNER' });
  assert.equal(f.vault.read().decisions[0].revision, 1);
  assert.throws(() => f.reports.draftDecision(f.ctx, content({ ownerId: 'missing-owner' })), { code: 'INVALID_DECISION_OWNER' });
});

test('a viewer cannot prepare a rich journal or bypass the preparation permission with a reviewed digest', async t => {
  const f = await fixture(t);
  const draft = f.reports.draftDecision(f.ctx, content());
  assert.throws(() => f.reports.draftDecision(VIEWER, content()), { code: 'FORBIDDEN' });
  await assert.rejects(f.reports.confirmDecision(VIEWER, draft, { reviewedDigest: draft.digest }), { code: 'FORBIDDEN' });
  assert.equal(f.vault.read().decisions.length, 0);
});

test('retained stale evidence stays historical; relinking it or measuring from it requires fresh evidence', async t => {
  const f = await fixture(t), d = await confirmed(f);
  const retained = structuredClone(d.receipts[0]);
  await f.vault.update(state => { state.receipts[0].stale = true; state.receipts[0].staleReason = 'Synthetic correction.'; });
  const revised = await f.reports.reviseDecision(f.ctx, d.id, content({ text: 'Clarify wording while retaining original evidence.' }),
    { expectedRevision: 1, reason: 'Keep historical evidence.' });
  assert.deepEqual(revised.receipts[0], retained); assert.equal(revised.receipts[0].stale, false);
  assert.equal(f.reports.decisions(f.ctx).length, 1);
  const relinked = content(); relinked.options[1].evidence = [{ receiptId: 'receipt-base', figureKey: 'total' }];
  await assert.rejects(f.reports.reviseDecision(f.ctx, d.id, relinked,
    { expectedRevision: 2, reason: 'Attach old evidence in a new scope.' }), { code: 'STALE_EVIDENCE' });
  await assert.rejects(f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ state: 'observable', measurements: [{ receiptId: 'receipt-base', figureKey: 'total' }] }) },
  { expectedRevision: 2 }), { code: 'STALE_EVIDENCE' });
  assert.equal(f.vault.read().decisions[0].revision, 2);
});

test('excluded receipt rows remain access dependencies on reads and transaction writes', async t => {
  const f = await fixture(t, PREPARER), d = await confirmed(f);
  const before = f.vault.read();
  f.store.next = state => { state.facts.find(row => row.id === 'row-excluded')!.branch = 'west'; };
  await assert.rejects(f.reports.reviewJournalDecision(f.ctx, d.id,
    { outcome: 'continue', observation: observation() }, { expectedRevision: 1 }), { code: 'RECEIPT_FORBIDDEN' });
  assert.deepEqual(f.vault.read().activity, before.activity);
  await f.vault.update(state => { state.facts.find(row => row.id === 'row-excluded')!.deletedAt = new Date().toISOString(); });
  assert.deepEqual(f.reports.decisions(f.ctx), []);
  assert.deepEqual(f.reports.dueDecisions(f.ctx, { dueOn: '2026-10-15' }), []);
});

test('a source named only by receipt lineage is reauthorized even without a counted row', async t => {
  const f = await fixture(t);
  await f.vault.update(state => { state.receipts[0].sourceIds.push('source-metadata-only'); });
  const d = await confirmed(f);
  await f.vault.update(state => { state.sourceRules.push({ sourceId: 'source-metadata-only', revoked: true }); });
  assert.deepEqual(f.reports.decisions(f.ctx), []);
  await assert.rejects(f.reports.reviseDecision(f.ctx, d.id, content(), { expectedRevision: 1, reason: 'No access to retained lineage.' }));
  assert.equal(f.vault.read().decisions[0].revision, 1);
});

test('dropping every current citation does not remove access checks for historical snapshots and revisions', async t => {
  const f = await fixture(t), d = await confirmed(f);
  const next = content(); next.options[0].evidence = []; delete next.expectedOutcome.baseline;
  const revised = await f.reports.reviseDecision(f.ctx, d.id, next, { expectedRevision: 1, reason: 'Drop current citations while retaining history.' });
  assert.equal(revised.receipts.length, 1); assert.equal(revised.revisions[0].before.options[0].evidence.length, 1);
  await f.vault.update(state => { state.sourceRules.push({ sourceId: 'source-base', revoked: true }); });
  assert.deepEqual(f.reports.decisions(f.ctx), []);
  await assert.rejects(f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue', observation: observation() }, { expectedRevision: 2 }));
  assert.equal(f.vault.read().decisions[0].revision, 2);
});

function syntheticExecution(snapshot: Record<string, unknown> = { fixture: 'synthetic execution', status: 'completed' }) {
  return { id: 'execution-synthetic', sourceIds: ['source-execution'], rowIds: ['row-execution'], snapshot };
}

test('execution links require the trusted resolver; the client cannot forge an execution snapshot', async t => {
  const f = await fixture(t), d = await confirmed(f);
  await assert.rejects(f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 1 }),
  { code: 'EXECUTION_RECEIPT_UNAVAILABLE' });
  const forged = new ReportService(f.store, { executionReceipt: () => syntheticExecution() });
  await assert.rejects(forged.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: { ...observation(), executionReceipts: [syntheticExecution({ authority: 'forged client' })] } as any },
  { expectedRevision: 1 }), { code: 'INVALID_REVIEW' });
  assert.equal(f.vault.read().decisions[0].revision, 1);
  assert.equal(decisionAudits(f.vault.read()).length, 1);
});

test('execution snapshots come from the resolver, detach, preserve review history and stay dependencies after revision', async t => {
  let authoritative = syntheticExecution({ fixture: 'synthetic execution', transportResult: { status: 'first receipt' } });
  const f = await fixture(t, OWNER, { executionReceipt: (_ctx, id) => {
    check(id === authoritative.id, 'EXECUTION_RECEIPT_UNAVAILABLE', 'Synthetic receipt unavailable.'); return authoritative;
  } });
  const d = await confirmed(f);
  const first = await f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }), nextReviewDate: '2026-11-01' }, { expectedRevision: 1 });
  assert.deepEqual(first.reviews[0].executionReceipts, [syntheticExecution({ fixture: 'synthetic execution', transportResult: { status: 'first receipt' } })]);
  authoritative.snapshot = { fixture: 'synthetic execution', transportResult: { status: 'second receipt' } };
  first.reviews[0].executionReceipts![0].snapshot.fixture = 'Changed returned snapshot';
  const revised = await f.reports.reviseDecision(f.ctx, d.id, content({ reviewDate: '2026-11-01', text: 'Retain review history.' }),
    { expectedRevision: 2, reason: 'Human clarification after the first review.' });
  assert.equal((revised.reviews[0].executionReceipts![0].snapshot.transportResult as any).status, 'first receipt');
  const second = await f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 3 });
  assert.equal((second.reviews[0].executionReceipts![0].snapshot.transportResult as any).status, 'first receipt');
  assert.equal((second.reviews[1].executionReceipts![0].snapshot.transportResult as any).status, 'second receipt');
  await f.trust.deleteSource(OWNER, 'source-execution');
  assert.equal(f.vault.read().decisions.length, 0, 'Execution-only source lineage must remove the dependent journal.');
  assert.ok(f.vault.read().facts.some(row => row.id === 'row-base'), 'Unrelated calculation evidence is retained.');
});

test('retained execution IDs are resolved again with the current transaction view and on reads', async t => {
  const views: State[] = [];
  const f = await fixture(t, OWNER, { executionReceipt: (_ctx, id, view) => {
    const state = view.read(); views.push(state);
    check(id === 'execution-synthetic', 'EXECUTION_RECEIPT_UNAVAILABLE', 'Synthetic receipt unavailable.');
    check(!state.schedules.some(item => item.type === 'synthetic-execution-authorization-marker'),
      'SYNTHETIC_EXECUTION_ACCESS_REVOKED', 'The synthetic resolver refuses the current transaction state.');
    return syntheticExecution();
  } });
  const d = await confirmed(f);
  await f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 1 });
  const before = f.vault.read(); views.length = 0;
  f.store.next = state => { state.schedules.push({ type: 'synthetic-execution-authorization-marker' }); };
  await assert.rejects(f.reports.reviseDecision(f.ctx, d.id, content(), { expectedRevision: 2, reason: 'Recheck execution dependency.' }), { code: 'SYNTHETIC_EXECUTION_ACCESS_REVOKED' });
  assert.ok(views.some(state => state.schedules.some(item => item.type === 'synthetic-execution-authorization-marker')), 'Resolver sees callback state, not the previous committed state.');
  assert.deepEqual(f.vault.read().activity, before.activity);
  await f.vault.update(state => { state.sourceRules.push({ sourceId: 'source-execution', revoked: true }); });
  assert.deepEqual(f.reports.decisions(f.ctx), []); assert.deepEqual(f.reports.dueDecisions(f.ctx), []);
});

test('changed resolver lineage cannot release access checks for saved execution snapshot history', async t => {
  let authoritative = syntheticExecution();
  const f = await fixture(t, OWNER, { executionReceipt: () => authoritative }), d = await confirmed(f);
  await f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 1 });
  authoritative = { ...syntheticExecution(), sourceIds: ['source-base'], rowIds: ['row-base'] };
  await f.vault.update(state => { state.sourceRules.push({ sourceId: 'source-execution', revoked: true }); });
  const before = f.vault.read();
  assert.deepEqual(f.reports.decisions(f.ctx), [], 'The original snapshot still depends on the revoked source.');
  await assert.rejects(f.reports.reviseDecision(f.ctx, d.id, content(),
    { expectedRevision: 2, reason: 'The saved execution snapshot remains protected.' }), { code: 'SOURCE_REVOKED' });
  assert.deepEqual(f.vault.read().decisions, before.decisions); assert.deepEqual(f.vault.read().activity, before.activity);
});

test('execution row access is checked independently of a resolver that returns a successful synthetic receipt', async t => {
  const f = await fixture(t, PREPARER, { executionReceipt: () => syntheticExecution() }), d = await confirmed(f);
  f.store.next = state => { state.facts.find(row => row.id === 'row-execution')!.branch = 'west'; };
  const before = f.vault.read();
  await assert.rejects(f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 1 }), { code: 'EXECUTION_RECEIPT_FORBIDDEN' });
  assert.deepEqual(f.vault.read().decisions, before.decisions); assert.deepEqual(f.vault.read().activity, before.activity);
});

test('trusted execution snapshots still refuse oversized, non-JSON and mismatched resolver results without audit', async t => {
  const f = await fixture(t), d = await confirmed(f);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const results = [
    { label: 'oversized ASCII bytes', receipt: syntheticExecution({ value: 'x'.repeat(2 * 1024 * 1024 + 1) }) },
    { label: 'oversized UTF-8 bytes', receipt: syntheticExecution({ value: '\u20b9'.repeat(800_000) }) },
    { label: 'nonplain date value', receipt: syntheticExecution({ timestamp: new Date() }) },
    { label: 'function value', receipt: syntheticExecution({ unsupported: () => 'synthetic function' }) },
    { label: 'cyclic value', receipt: syntheticExecution(cycle) },
    { label: 'nonfinite number', receipt: syntheticExecution({ nonfinite: NaN }) },
    { label: 'mismatched receipt ID', receipt: { ...syntheticExecution(), id: 'another-execution' } },
  ];
  const before = f.vault.read();
  for (const result of results) {
    const reports = new ReportService(f.store, { executionReceipt: () => result.receipt });
    await assert.rejects(reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
      observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 1 }), result.label);
  }
  assert.deepEqual(f.vault.read().decisions, before.decisions); assert.deepEqual(f.vault.read().activity, before.activity);
});

test('execution records normalize optional undefined properties into detached JSON history', async t => {
  const f = await fixture(t, OWNER, { executionReceipt: () => syntheticExecution({
    fixture: 'synthetic optional provider fields', businessSuccess: undefined, delivery: { response: undefined, status: 'completed' },
  }) }), d = await confirmed(f);
  const saved = await f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 1 });
  assert.deepEqual(saved.reviews[0].executionReceipts![0].snapshot,
    { fixture: 'synthetic optional provider fields', delivery: { status: 'completed' } });
  assert.equal(Object.hasOwn(f.vault.read().decisions[0].reviews[0].executionReceipts[0].snapshot, 'businessSuccess'), false);
});

test('the trusted resolver receives a detached read-only state view', async t => {
  const views: StateStore[] = [];
  const f = await fixture(t, OWNER, { executionReceipt: (_ctx, _id, view) => {
    views.push(view);
    const copy = view.read(); copy.members[0].active = false;
    assert.equal(view.read().members[0].active, true, 'Changing a returned state cannot alter authorization.');
    return syntheticExecution();
  } }), d = await confirmed(f);
  await f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 1 });
  assert.ok(views.length > 0);
  await assert.rejects(views[0].update(state => { state.members[0].active = false; }), /read-only/);
  assert.equal(f.vault.read().members[0].active, true); assert.equal(f.vault.read().decisions[0].revision, 2);
});

test('retention cleanup removes a journal whose only expired dependency is an execution receipt row', async t => {
  const f = await fixture(t, OWNER, { executionReceipt: () => syntheticExecution() }), d = await confirmed(f);
  await f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'continue',
    observation: observation({ executionReceiptIds: ['execution-synthetic'] }) }, { expectedRevision: 1 });
  await f.vault.update(state => { state.facts.find(row => row.id === 'row-execution')!.learnedAt = '2000-01-01T00:00:00.000Z'; });
  await f.trust.cleanup(OWNER, new Date());
  const state = f.vault.read();
  assert.equal(state.decisions.length, 0); assert.ok(state.facts.some(row => row.id === 'row-base'));
});

test('legacy reviews remain compatible while every revision-bearing record requires the rich review path', async t => {
  const f = await fixture(t);
  const legacy = await f.reports.decision(f.ctx, { text: 'A legacy human decision.', reviewDate: '2026-10-01', receiptIds: ['receipt-base'], branch: 'main' });
  const reviewed = await f.reports.reviewDecision(f.ctx, legacy.id, { outcome: 'continue', notes: 'Legacy follow-up remains available.' });
  assert.equal(reviewed.status, 'open'); assert.equal(reviewed.reviews.length, 1);
  const rich = await confirmed(f);
  const audits = f.vault.read().activity.length;
  await assert.rejects(f.reports.reviewDecision(f.ctx, rich.id, { outcome: 'completed' }), { code: 'JOURNAL_REVIEW_REQUIRED' });
  await f.vault.update(state => { state.decisions.find(d => d.id === legacy.id).revision = 0; });
  await assert.rejects(f.reports.reviewDecision(f.ctx, legacy.id, { outcome: 'completed' }), { code: 'JOURNAL_REVIEW_REQUIRED' });
  assert.equal(f.vault.read().activity.length, audits); assert.equal(f.vault.read().decisions.find(d => d.id === rich.id).revision, 1);
});

test('legacy creation and review also recheck callback-state branch and receipt access', async t => {
  const f = await fixture(t, PREPARER);
  f.store.next = state => { state.facts.find(row => row.id === 'row-excluded')!.branch = 'west'; };
  await assert.rejects(f.reports.decision(f.ctx, { text: 'Legacy creation race.', reviewDate: '2026-10-01', receiptIds: ['receipt-base'], branch: 'main' }), { code: 'RECEIPT_FORBIDDEN' });
  assert.equal(f.vault.read().decisions.length, 0); assert.equal(f.vault.read().activity.length, 0);
  const legacy = await f.reports.decision(f.ctx, { text: 'Legacy review race.', reviewDate: '2026-10-01', branch: 'main' });
  const before = f.vault.read();
  f.store.next = state => { state.members.find(member => member.id === PREPARER.memberId)!.branches = ['west']; };
  await assert.rejects(f.reports.reviewDecision(f.ctx, legacy.id, { outcome: 'completed' }), { code: 'FORBIDDEN_BRANCH' });
  assert.deepEqual(f.vault.read().decisions, before.decisions); assert.deepEqual(f.vault.read().activity, before.activity);
});

test('due lists preserve mixed legacy and rich order, filter dates, detach and keep the legacy INVALID_DATE contract', async t => {
  const f = await fixture(t);
  const rich = await confirmed(f, content({ reviewDate: '2026-10-15' }));
  const legacy = await f.reports.decision(f.ctx, { text: 'Earlier legacy review date.', reviewDate: '2026-10-01', branch: 'main' });
  const future = await confirmed(f, content({ reviewDate: '2026-12-01', text: 'A later review.' }));
  const due = f.reports.dueDecisions(f.ctx, { dueOn: '2026-10-15', branch: 'main' });
  assert.deepEqual(due.map(d => d.id), [rich.id, legacy.id]);
  assert.deepEqual(f.reports.decisions(f.ctx, { dueOn: '2026-10-15' }).map(d => d.id), [rich.id, legacy.id]);
  due[0].text = 'Changed list result';
  assert.equal(f.vault.read().decisions.find(d => d.id === rich.id).text, content().text);
  assert.ok(!due.some(d => d.id === future.id));
  for (const date of ['2026-02-30', 'tomorrow', '2026-1-01', '']) {
    assert.throws(() => f.reports.dueDecisions(f.ctx, { dueOn: date }), { code: 'INVALID_DATE' });
    assert.throws(() => f.reports.decisions(f.ctx, { dueOn: date }), { code: 'INVALID_DATE' });
  }
  await f.reports.reviewJournalDecision(f.ctx, rich.id, { outcome: 'completed', observation: observation() }, { expectedRevision: 1 });
  assert.deepEqual(f.reports.dueDecisions(f.ctx, { dueOn: '2026-10-15' }).map(d => d.id), [legacy.id]);
});

test('exact measured figures and a declared observation do not imply causality or an automatic outcome-window gate', async t => {
  const f = await fixture(t), d = await confirmed(f);
  const measured = f.vault.read().receipts.find(r => r.id === 'receipt-measured') as CalculationReceipt;
  const review = await f.reports.reviewJournalDecision(f.ctx, d.id, { outcome: 'completed',
    observation: observation({ state: 'inconclusive', measurements: [{ receiptId: measured.id, figureKey: 'total' }],
      notes: 'The independently dated measurement cannot establish a causal result.',
      concurrentInterventions: ['Synthetic concurrent promotion.'] }) }, { expectedRevision: 1 });
  assert.equal(review.reviews[0].assessment, 'human-declared');
  assert.equal(review.reviews[0].observation.state, 'inconclusive');
  assert.deepEqual(review.reviews[0].measuredFigures, [{ receiptId: measured.id, figure: measured.figures[0] }]);
  assert.equal(review.reviews[0].measuredFigures[0].figure.minor, '900719925474099400');
  assert.equal(review.status, 'closed'); assert.equal(review.revision, 2);
  assert.equal(f.vault.read().actions.length, 0); assert.equal(f.vault.read().jobs.length, 0);
});
