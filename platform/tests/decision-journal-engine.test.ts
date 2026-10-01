import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { Context, Fact, State } from '../runtime/contracts.ts';
import { draftDecision as syntheticClientDraft, type JournalContent, type JournalObservation } from '../runtime/decision-journal.ts';
import { Engine } from '../runtime/engine.ts';
import type { ReportOptions } from '../runtime/reports.ts';
import { createLocalServer } from '../runtime/server.ts';

const BASE_AMOUNT = '900719925474099391';
const MEASURED_AMOUNT = '900719925474099400';
const PASSPHRASE = 'Synthetic journal HTTP fixture passphrase sufficiently long';
const ACCOUNTANT: Context = { memberId: 'accountant', role: 'accountant', epoch: 1, channel: 'desktop' };

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), 'Expected an object result.');
  return value;
}
function array(value: unknown): unknown[] { assert.ok(Array.isArray(value), 'Expected an array result.'); return value; }
function records(value: unknown): Record<string, unknown>[] { return array(value).map(record); }
function text(value: unknown): string { assert.equal(typeof value, 'string'); assert.ok(typeof value === 'string'); return value; }
type RpcReply = { status: number; body: Record<string, unknown> };
function success(reply: RpcReply): unknown {
  assert.equal(reply.status, 200, 'Expected a successful synthetic fixture RPC.'); assert.equal(reply.body.error, undefined); return reply.body.result;
}
const successRecord = (reply: RpcReply) => record(success(reply));
const successRecords = (reply: RpcReply) => records(success(reply));
function refused(reply: RpcReply, code: string) {
  assert.notEqual(reply.status, 200); assert.equal(reply.body.result, undefined);
  assert.equal(record(reply.body.error).code, code, JSON.stringify(reply.body));
}
function figure(value: Record<string, unknown>, key = 'total') {
  const found = records(value.figures).find(item => item.key === key); assert.ok(found); return found;
}
function currentVault(engine: Engine) { assert.ok(engine.vault); return engine.vault; }
function noJournalWrite(engine: Engine, before: State) {
  const after = currentVault(engine).read(); assert.deepEqual(after.decisions, before.decisions); assert.deepEqual(after.activity, before.activity);
  assert.equal(after.revision, before.revision);
}

// Deliberately synthetic saved evidence: no calculation, database, provider or
// execution transport is invoked by these fixtures. Values exceed Number safety.
function receipt(id: string, rowId: string, sourceId: string, memberId = 'owner', branch = 'main'): CalculationReceipt {
  return { id, memberId, epoch: 1, sourceIds: [sourceId], operation: 'earned',
    createdAt: '2026-09-30T12:00:00.000Z', asOf: '2026-09-30T12:00:00.000Z',
    period: { from: '2026-09-01', to: '2026-09-30' }, comparePeriod: null,
    branch, currency: 'INR', ontologyVersion: 1, dictionaryHash: 'a'.repeat(64), definitionHash: 'b'.repeat(64), definitions: [],
    figures: [{ key: 'total', label: 'Earned revenue', minor: BASE_AMOUNT, display: 'INR 9,007,199,254,740,993.91', unit: 'money', currency: 'INR' }],
    valueMinor: BASE_AMOUNT, totalMinor: BASE_AMOUNT, rowIds: [rowId],
    rows: [{ factId: rowId, entityId: rowId, sourceId, sourceRow: 2, kind: 'sale', amountMinor: BASE_AMOUNT, validFrom: '2026-09-12', branch }],
    exclusions: [], coverage: { selectedRows: 1, countedRows: 1, excludedRows: 0, unresolvedConflicts: 0, importIds: [], completeness: 'unreconciled-facts', gaps: [] },
    assumptions: {}, explanation: 'Synthetic saved evidence; no causal assessment.', stale: false, allowedNumbers: [BASE_AMOUNT] };
}
function fact(id: string, sourceId: string, branch = 'main'): Fact {
  return { id, entityId: id, sourceId, sourceRow: 2, kind: 'sale', validFrom: '2026-09-12', validTo: null,
    learnedAt: new Date().toISOString(), supersededAt: null, fields: { amountMinor: BASE_AMOUNT, currency: 'INR' }, branch };
}
function content(overrides: Partial<JournalContent> = {}, receiptId = 'receipt-base'): JournalContent {
  return { text: 'Keep the present distributor terms pending human review.',
    options: [{ id: 'keep', label: 'Keep terms', reason: 'Observe before another intervention.', evidence: [{ receiptId, figureKey: 'total' }] },
      { id: 'change', label: 'Change terms', reason: 'An alternative for human assessment.', evidence: [] }],
    assumptions: [{ id: 'lag', text: 'Payments might arrive after this observation window.', status: 'unverified', evidence: [] }],
    selectedOptionId: 'keep', ownerId: 'decision-owner', expectedOutcome: { description: 'Review the observed business result.', measure: 'earned revenue',
      population: 'main-branch distributor orders', baseline: { receiptId, figureKey: 'total' }, window: { from: '2026-10-01', to: '2026-10-10' },
      maturityDate: '2026-10-15', lagRule: 'Human review after the declared maturity date.', uncertainty: ['Concurrent activity can affect the result.'] },
    reviewDate: '2026-10-15', hypotheses: ['No measured causal explanation is available.'], branch: 'main', ...overrides };
}
function observation(overrides: Partial<JournalObservation> = {}): JournalObservation {
  return { state: 'pending', measurements: [], notes: 'Human assessment awaits further evidence.', uncertainty: ['The result cannot establish causality.'],
    concurrentInterventions: [], executionReceiptIds: [], ...overrides };
}

async function fixture(t: TestContext, reports: Pick<ReportOptions, 'executionReceipt'> = {}) {
  const tempRoot = resolve(tmpdir()), directory = await mkdtemp(join(tempRoot, 'chausar-journal-http-test-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', reports });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => {
    await app.close(); const target = resolve(directory), descendant = relative(tempRoot, target);
    assert.ok(descendant && !descendant.startsWith('..') && !isAbsolute(descendant));
    assert.ok(target.startsWith(join(tempRoot, 'chausar-journal-http-test-')));
    await rm(target, { recursive: true, force: true });
  });
  async function rpc(method: string, payload: unknown = {}, bearer = token): Promise<RpcReply> {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
    const body: unknown = await response.json(); return { status: response.status, body: record(body) };
  }
  const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(paired.status, 200); const pairingBody: unknown = await paired.json(); assert.equal(record(pairingBody).token, token);
  successRecord(await rpc('workspace.create', { name: 'Synthetic journal HTTP fixture', passphrase: PASSPHRASE, demo: false }));
  await currentVault(engine).update(state => {
    state.members.push(
      { id: 'accountant', name: 'Synthetic accountant', role: 'accountant', active: true, epoch: 1, branches: ['main'] },
      { id: 'viewer', name: 'Synthetic viewer', role: 'viewer', active: true, epoch: 1, branches: ['main'] },
      { id: 'decision-owner', name: 'Synthetic decision owner', role: 'accountant', active: true, epoch: 1, branches: ['main'] });
    state.facts.push(fact('row-base', 'source-base'), fact('row-excluded', 'source-base'), fact('row-measured', 'source-measured'),
      fact('row-execution', 'source-execution'), fact('row-west', 'source-west', 'west'));
    const base = receipt('receipt-base', 'row-base', 'source-base');
    base.exclusions = [{ rowId: 'row-excluded', reason: 'Outside the requested event period.' }];
    base.coverage.selectedRows = 2; base.coverage.excludedRows = 1;
    const measured = receipt('receipt-measured', 'row-measured', 'source-measured');
    measured.period = { from: '2020-01-01', to: '2020-01-31' };
    measured.figures[0].minor = MEASURED_AMOUNT; measured.figures[0].display = 'INR 9,007,199,254,740,994.00';
    measured.valueMinor = measured.totalMinor = MEASURED_AMOUNT;
    state.receipts.push(base, measured, receipt('receipt-accountant', 'row-base', 'source-base', 'accountant'),
      receipt('receipt-west', 'row-west', 'source-west', 'accountant', 'west'));
  });
  async function memberBearer(memberId: string) { return text(successRecord(await rpc('auth.session', { memberId })).token); }
  async function confirmed(input = content(), bearer = token) {
    const draft = successRecord(await rpc('decisions.journal.draft', { content: input }, bearer));
    return successRecord(await rpc('decisions.journal.confirm', { draft, reviewedDigest: draft.digest }, bearer));
  }
  return { engine, rpc, token, memberBearer, confirmed };
}

test('paired HTTP journal draft is transient and confirmation rejects changed digests and counterfeit evidence', async t => {
  const f = await fixture(t), before = currentVault(f.engine).read();
  const draft = successRecord(await f.rpc('decisions.journal.draft', { content: content() }));
  assert.equal(draft.kind, 'journal-draft'); assert.match(text(draft.digest), /^[a-f0-9]{64}$/); noJournalWrite(f.engine, before);
  refused(await f.rpc('decisions.journal.confirm', { draft, reviewedDigest: '0'.repeat(64) }), 'REVIEW_DIGEST_MISMATCH'); noJournalWrite(f.engine, before);
  const tampered = structuredClone(draft); record(tampered.content).text = 'Changed after the reviewed preview.';
  refused(await f.rpc('decisions.journal.confirm', { draft: tampered, reviewedDigest: draft.digest }), 'DRAFT_CHANGED'); noJournalWrite(f.engine, before);
  const counterfeit = receipt('receipt-base', 'row-base', 'source-base'); counterfeit.figures[0].minor = '1';
  const fabricated = syntheticClientDraft(content(), [counterfeit]);
  refused(await f.rpc('decisions.journal.confirm', { draft: fabricated, reviewedDigest: fabricated.digest }), 'EVIDENCE_CHANGED'); noJournalWrite(f.engine, before);
  const saved = successRecord(await f.rpc('decisions.journal.confirm', { draft, reviewedDigest: draft.digest }));
  assert.equal(saved.revision, 1); assert.equal(saved.status, 'open'); assert.equal(saved.by, 'owner'); assert.equal(saved.ownerId, 'decision-owner');
  assert.deepEqual(saved.rowIds, ['row-base', 'row-excluded']); assert.deepEqual(saved.sourceIds, ['source-base']);
  assert.equal(figure(records(saved.receipts)[0]).minor, BASE_AMOUNT);
  assert.equal(currentVault(f.engine).read().activity.length, before.activity.length + 1);
});

test('HTTP rich lifecycle preserves exact observations and historical receipts across closed revision, reopening and encrypted vault reopen', async t => {
  const f = await fixture(t), initial = await f.confirmed(), id = text(initial.id);
  const reviewed = successRecord(await f.rpc('decisions.journal.review', { id, expectedRevision: 1, review: { outcome: 'completed',
    observation: observation({ state: 'achieved', measurements: [{ receiptId: 'receipt-measured', figureKey: 'total' }],
      concurrentInterventions: ['Another campaign ran in parallel.'], notes: 'A human assessment, without a causal conclusion.' }) } }));
  assert.equal(reviewed.status, 'closed'); assert.equal(reviewed.revision, 2);
  const firstReview = records(reviewed.reviews)[0]; assert.equal(firstReview.assessment, 'human-declared'); assert.equal(firstReview.atRevision, 1);
  assert.equal(record(firstReview.observation).state, 'achieved');
  assert.equal(record(records(firstReview.measuredFigures)[0].figure).minor, MEASURED_AMOUNT);
  assert.deepEqual(record(records(reviewed.receipts)[1].period), { from: '2020-01-01', to: '2020-01-31' });
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', { dueOn: '2026-10-15' })), []);
  assert.equal(successRecords(await f.rpc('decisions.journal.due')).length, 1);
  await currentVault(f.engine).update(state => { state.receipts.forEach(value => { value.stale = true; }); });
  const next = content({ text: 'Retain the historical assessment while refining the statement.' });
  const revised = successRecord(await f.rpc('decisions.journal.revise', { id, content: next, expectedRevision: 2, reason: 'Clarify the human record.' }));
  assert.equal(revised.status, 'closed'); assert.equal(revised.revision, 3); assert.equal(records(revised.revisions)[0].fromRevision, 2);
  assert.equal(records(revised.receipts)[0].stale, false); assert.equal(records(revised.receipts)[1].stale, false);
  assert.deepEqual(records(revised.reviews)[0], firstReview);
  const reopened = successRecord(await f.rpc('decisions.journal.review', { id, expectedRevision: 3,
    review: { outcome: 'continue', observation: observation(), nextReviewDate: '2026-11-01' } }));
  assert.equal(reopened.status, 'open'); assert.equal(reopened.revision, 4); assert.equal(reopened.reviewDate, '2026-11-01');
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', { dueOn: '2026-10-31', branch: 'main' })), []);
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', { dueOn: '2026-11-01', branch: 'main' })).map(item => item.id), [id]);
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', { dueOn: '2026-11-01', branch: 'west' })), []);
  const savedReceipt = successRecord(await f.rpc('receipts.get', { id: 'receipt-measured' }));
  assert.equal(figure(savedReceipt).minor, MEASURED_AMOUNT); assert.equal(savedReceipt.stale, true);
  successRecord(await f.rpc('workspace.lock')); successRecord(await f.rpc('workspace.open', { passphrase: PASSPHRASE }));
  const persisted = successRecords(await f.rpc('decisions.list')).find(item => item.id === id); assert.ok(persisted);
  assert.deepEqual(persisted, reopened); assert.deepEqual(records(persisted.reviews)[0], firstReview);
  assert.equal(figure(successRecord(await f.rpc('receipts.get', { id: 'receipt-base' }))).minor, BASE_AMOUNT);
});

test('simultaneous HTTP revision and review consume one expected revision and audit only the winner', async t => {
  const f = await fixture(t), initial = await f.confirmed(), id = text(initial.id);
  const before = currentVault(f.engine).read();
  const outcomes = await Promise.all([
    f.rpc('decisions.journal.revise', { id, content: content({ text: 'A revised human decision.' }), expectedRevision: 1, reason: 'Clarify the statement.' }),
    f.rpc('decisions.journal.review', { id, review: { outcome: 'continue', observation: observation(), nextReviewDate: '2026-11-01' }, expectedRevision: 1 }),
  ]);
  assert.equal(outcomes.filter(reply => reply.status === 200).length, 1);
  const loser = outcomes.find(reply => reply.status !== 200); assert.ok(loser); refused(loser, 'REVISION_CONFLICT');
  const saved = successRecords(await f.rpc('decisions.list')).find(item => item.id === id); assert.ok(saved);
  assert.equal(saved.revision, 2); assert.equal(array(saved.revisions).length + array(saved.reviews).length, 1);
  const state = currentVault(f.engine).read(); assert.equal(state.revision, before.revision + 1); assert.equal(state.activity.length, before.activity.length + 1);
  const events = records(successRecord(await f.rpc('activity.list')).items);
  assert.equal(events.filter(item => record(item.details).decisionId === id).length, 2);
});

test('HTTP journal boundaries refuse unknown keys and omitted required fields without writes', async t => {
  const f = await fixture(t), saved = await f.confirmed(), id = text(saved.id);
  const draft = successRecord(await f.rpc('decisions.journal.draft', { content: content() }));
  const before = currentVault(f.engine).read();
  const invalid: { method: string; payload: unknown; code: string }[] = [
    { method: 'decisions.journal.draft', payload: {}, code: 'INVALID_DECISION' },
    { method: 'decisions.journal.draft', payload: { content: null }, code: 'INVALID_DECISION' },
    { method: 'decisions.journal.draft', payload: { content: content(), reports: { executionReceipt: 'injected' } }, code: 'INVALID_DECISION' },
    { method: 'decisions.journal.draft', payload: { content: { ...content(), executionReceipt: 'injected' } }, code: 'INVALID_DECISION' },
    { method: 'decisions.journal.confirm', payload: { reviewedDigest: draft.digest }, code: 'INVALID_CONFIRMATION' },
    { method: 'decisions.journal.confirm', payload: { draft }, code: 'INVALID_CONFIRMATION' },
    { method: 'decisions.journal.confirm', payload: { draft, reviewedDigest: draft.digest, executionReceipt: {} }, code: 'INVALID_CONFIRMATION' },
    { method: 'decisions.journal.confirm', payload: { draft: { ...draft, extra: true }, reviewedDigest: draft.digest }, code: 'INVALID_DRAFT' },
    { method: 'decisions.journal.revise', payload: { content: content(), expectedRevision: 1, reason: 'Missing decision ID.' }, code: 'INVALID_REVISION' },
    { method: 'decisions.journal.revise', payload: { id, expectedRevision: 1, reason: 'Missing content.' }, code: 'INVALID_REVISION' },
    { method: 'decisions.journal.revise', payload: { id, content: content(), reason: 'Missing revision.' }, code: 'INVALID_REVISION' },
    { method: 'decisions.journal.revise', payload: { id, content: content(), expectedRevision: 1 }, code: 'INVALID_REVISION' },
    { method: 'decisions.journal.revise', payload: { id, content: content(), expectedRevision: 1, reason: 'Unknown key.', options: {} }, code: 'INVALID_REVISION' },
    { method: 'decisions.journal.review', payload: { id, review: { outcome: 'completed', observation: observation() } }, code: 'INVALID_REVIEW' },
    { method: 'decisions.journal.review', payload: { id, expectedRevision: 1 }, code: 'INVALID_REVIEW' },
    { method: 'decisions.journal.review', payload: { expectedRevision: 1, review: { outcome: 'completed', observation: observation() } }, code: 'INVALID_REVIEW' },
    { method: 'decisions.journal.review', payload: { id, expectedRevision: 1, review: { outcome: 'completed' } }, code: 'INVALID_REVIEW' },
    { method: 'decisions.journal.review', payload: { id, expectedRevision: 1, review: { outcome: 'completed', observation: observation() }, reports: {} }, code: 'INVALID_REVIEW' },
    { method: 'decisions.journal.review', payload: { id, expectedRevision: 1, review: { outcome: 'completed', observation: { ...observation(), causal: true } } }, code: 'INVALID_REVIEW' },
    { method: 'decisions.journal.due', payload: { executionReceipt: {} }, code: 'INVALID_FILTER' },
    { method: 'decisions.journal.due', payload: { dueOn: '' }, code: 'INVALID_DATE' },
    { method: 'decisions.journal.due', payload: { dueOn: '2026-02-30' }, code: 'INVALID_DATE' },
    { method: 'decisions.journal.due', payload: { branch: '' }, code: 'INVALID_FILTER' },
  ];
  for (const entry of invalid) { refused(await f.rpc(entry.method, entry.payload), entry.code); noJournalWrite(f.engine, before); }
  for (const expectedRevision of [0, -1, 1.5, 2]) {
    refused(await f.rpc('decisions.journal.revise', { id, content: content(), expectedRevision, reason: 'Invalid revision.' }), 'REVISION_CONFLICT');
    refused(await f.rpc('decisions.journal.review', { id, review: { outcome: 'completed', observation: observation() }, expectedRevision }), 'REVISION_CONFLICT');
    noJournalWrite(f.engine, before);
  }
});

test('HTTP sessions enforce current private receipt, branch and source access on drafts, writes and due reads', async t => {
  const f = await fixture(t), ownerDecision = await f.confirmed();
  const accountant = await f.memberBearer('accountant'), viewer = await f.memberBearer('viewer');
  refused(await f.rpc('decisions.journal.draft', { content: content() }, viewer), 'FORBIDDEN');
  refused(await f.rpc('decisions.journal.draft', { content: content() }, accountant), 'RECEIPT_FORBIDDEN');
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', {}, accountant)), []);
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', {}, viewer)), []);
  const owned = await f.confirmed(content({}, 'receipt-accountant'), accountant), id = text(owned.id);
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', {}, accountant)).map(item => item.id), [id]);
  assert.ok(!successRecords(await f.rpc('decisions.journal.due', {}, accountant)).some(item => item.id === ownerDecision.id));
  refused(await f.rpc('decisions.journal.due', { branch: 'west' }, accountant), 'FORBIDDEN_BRANCH');
  await currentVault(f.engine).update(state => { const member = state.members.find(item => item.id === 'accountant'); assert.ok(member); member.branches = ['west']; });
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', {}, accountant)), []);
  let before = currentVault(f.engine).read();
  refused(await f.rpc('decisions.journal.review', { id, expectedRevision: 1, review: { outcome: 'completed', observation: observation() } }, accountant), 'FORBIDDEN_BRANCH'); noJournalWrite(f.engine, before);
  await currentVault(f.engine).update(state => {
    const member = state.members.find(item => item.id === 'accountant'); assert.ok(member); member.branches = ['main'];
    state.sourceRules.push({ sourceId: 'source-base', memberIds: ['owner'] });
  });
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', {}, accountant)), []); before = currentVault(f.engine).read();
  refused(await f.rpc('decisions.journal.review', { id, expectedRevision: 1, review: { outcome: 'completed', observation: observation() } }, accountant), 'SOURCE_REVOKED'); noJournalWrite(f.engine, before);
  await currentVault(f.engine).update(state => { const member = state.members.find(item => item.id === 'accountant'); assert.ok(member); member.epoch++; });
  refused(await f.rpc('decisions.journal.due', {}, accountant), 'UNAUTHENTICATED');
  await assert.rejects(f.engine.requestAs(ACCOUNTANT, 'decisions.journal.due'), { code: 'ACCESS_REVOKED' });
});

test('actual Engine requestAs refuses non-desktop and source-tainted journal writers without broadening role permissions', async t => {
  const f = await fixture(t), saved = await f.confirmed(), id = text(saved.id);
  const draft = successRecord(await f.rpc('decisions.journal.draft', { content: content() })), before = currentVault(f.engine).read();
  const writers = [
    { method: 'decisions.journal.draft', payload: { content: content() } },
    { method: 'decisions.journal.confirm', payload: { draft, reviewedDigest: draft.digest } },
    { method: 'decisions.journal.revise', payload: { id, content: content(), expectedRevision: 1, reason: 'Untrusted invocation.' } },
    { method: 'decisions.journal.review', payload: { id, expectedRevision: 1, review: { outcome: 'completed', observation: observation() } } },
  ];
  const contexts: Context[] = [
    { memberId: 'owner', role: 'owner', epoch: 1 },
    { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' },
    { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' },
    { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: true },
  ];
  for (const ctx of contexts) for (const writer of writers) {
    await assert.rejects(f.engine.requestAs(ctx, writer.method, writer.payload), { code: 'APP_DECISION_REQUIRED' }); noJournalWrite(f.engine, before);
  }
  for (const ctx of contexts) {
    const due: unknown = await f.engine.requestAs(ctx, 'decisions.journal.due', { dueOn: '2026-10-15', branch: 'main' });
    assert.deepEqual(records(due).map(item => item.id), [id]); noJournalWrite(f.engine, before);
  }
  await assert.rejects(f.engine.requestAs({ memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' }, 'decisions.journal.draft', { content: content() }), { code: 'FORBIDDEN' });
  noJournalWrite(f.engine, before);
});

test('HTTP unknown execution references refuse and RPC cannot supply a resolver', async t => {
  const f = await fixture(t), saved = await f.confirmed(), id = text(saved.id), before = currentVault(f.engine).read();
  const review = { outcome: 'completed', observation: observation({ executionReceiptIds: ['synthetic-host-evidence'] }) };
  refused(await f.rpc('decisions.journal.review', { id, expectedRevision: 1, review }), 'EXECUTION_RECEIPT_NOT_FOUND'); noJournalWrite(f.engine, before);
  refused(await f.rpc('decisions.journal.review', { id, expectedRevision: 1, review, executionReceipt: { verified: true } }), 'INVALID_REVIEW'); noJournalWrite(f.engine, before);
  refused(await f.rpc('decisions.journal.review', { id, expectedRevision: 1, review: { ...review, executionReceipts: [{ id: 'synthetic-host-evidence', verified: true }] } }), 'INVALID_REVIEW'); noJournalWrite(f.engine, before);
});

test('paired HTTP actual local draft effect joins the journal as verified execution without claiming business achievement', async t => {
  const f = await fixture(t), saved = await f.confirmed(), journalId = text(saved.id);
  const action = successRecord(await f.rpc('actions.prepare', { connector: 'local', operation: 'reminder-draft', sourceIds: ['source-base'],
    payload: { invoiceId: 'synthetic-invoice-target', text: 'Synthetic reminder draft only. No message is sent.' }, idempotencyKey: 'synthetic-journal-effect' }));
  const actionId = text(action.id), digest = text(action.digest);
  let before = currentVault(f.engine).read();
  refused(await f.rpc('decisions.journal.review', { id: journalId, expectedRevision: 1, review: { outcome: 'continue', observation: observation({ executionReceiptIds: [actionId] }) } }), 'EXECUTION_EFFECT_UNVERIFIED');
  noJournalWrite(f.engine, before);
  successRecord(await f.rpc('actions.approve', { id: actionId, digest }));
  const executed = successRecord(await f.rpc('actions.execute', { id: actionId, digest }));
  assert.equal(executed.status, 'verified'); assert.equal(executed.businessSuccess, false);
  const reviewed = successRecord(await f.rpc('decisions.journal.review', { id: journalId, expectedRevision: 1,
    review: { outcome: 'continue', observation: observation({ state: 'pending', executionReceiptIds: [actionId] }) } }));
  assert.equal(reviewed.revision, 2);
  const review = records(reviewed.reviews)[0], effect = records(review.executionReceipts)[0], snapshot = record(effect.snapshot);
  assert.equal(effect.id, actionId); assert.deepEqual(effect.sourceIds, ['source-base']); assert.deepEqual(effect.rowIds, []);
  assert.equal(record(snapshot.executionVerification).state, 'verified'); assert.equal(snapshot.providerReportedBusinessSuccess, false); assert.equal(snapshot.businessOutcome, 'not-assessed');
  assert.equal(record(review.observation).state, 'pending'); assert.equal(snapshot.payload, undefined); assert.equal(snapshot.result, undefined);
  successRecord(await f.rpc('workspace.lock')); successRecord(await f.rpc('workspace.open', { passphrase: PASSPHRASE }));
  const reopened = successRecords(await f.rpc('decisions.list')).find(item => item.id === journalId); assert.ok(reopened);
  assert.equal(record(records(records(reopened.reviews)[0].executionReceipts)[0].snapshot).businessOutcome, 'not-assessed');
  await currentVault(f.engine).update(state => { state.sourceRules.push({ sourceId: 'source-base', allow: false }); });
  assert.deepEqual(successRecords(await f.rpc('decisions.list')), []);
});

test('trusted Engine host resolver retains authoritative execution snapshots while human outcome and business success stay separate', async t => {
  let calls = 0;
  const authority = { verified: true, businessSuccess: false, effect: 'synthetic local draft', version: 1 };
  const f = await fixture(t, { executionReceipt: (ctx, id, view) => {
    assert.equal(ctx.memberId, 'owner'); assert.equal(ctx.channel, 'desktop'); assert.equal(id, 'synthetic-host-evidence');
    const state = view.read(); assert.ok(state.facts.some(item => item.id === 'row-execution')); assert.equal(state.decisions.length, 1); calls++;
    return { id, sourceIds: ['source-execution'], rowIds: ['row-execution'], snapshot: authority };
  } });
  const saved = await f.confirmed(), id = text(saved.id);
  const reviewed = successRecord(await f.rpc('decisions.journal.review', { id, expectedRevision: 1, review: { outcome: 'completed',
    observation: observation({ state: 'achieved', executionReceiptIds: ['synthetic-host-evidence'] }) } }));
  const retained = records(records(reviewed.reviews)[0].executionReceipts)[0];
  assert.equal(record(retained.snapshot).verified, true); assert.equal(record(retained.snapshot).businessSuccess, false);
  assert.equal(record(records(reviewed.reviews)[0].observation).state, 'achieved'); assert.equal(records(reviewed.reviews)[0].assessment, 'human-declared');
  authority.version = 2; authority.businessSuccess = true;
  const historical = successRecords(await f.rpc('decisions.journal.due')).find(item => item.id === id); assert.ok(historical);
  assert.equal(record(records(records(historical.reviews)[0].executionReceipts)[0].snapshot).version, 1);
  assert.equal(record(records(records(historical.reviews)[0].executionReceipts)[0].snapshot).businessSuccess, false); assert.ok(calls >= 2);
  await currentVault(f.engine).update(state => { state.sourceRules.push({ sourceId: 'source-execution', revoked: true }); });
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due')), []);
  const before = currentVault(f.engine).read();
  refused(await f.rpc('decisions.journal.review', { id, expectedRevision: 2, review: { outcome: 'continue', observation: observation() } }), 'SOURCE_REVOKED'); noJournalWrite(f.engine, before);
});

test('named journal methods preserve legacy creation, listing and review while legacy review cannot alter a rich record', async t => {
  const f = await fixture(t);
  const legacy = successRecord(await f.rpc('decisions.create', { text: 'A legacy human decision.', reviewDate: '2026-10-05', branch: 'main', receiptIds: ['receipt-base'] }));
  assert.equal(legacy.revision, undefined);
  const legacyReviewed = successRecord(await f.rpc('decisions.review', { id: legacy.id, outcome: 'completed', notes: 'Legacy review remains usable.' }));
  assert.equal(legacyReviewed.status, 'closed');
  const rich = await f.confirmed(), before = currentVault(f.engine).read();
  refused(await f.rpc('decisions.review', { id: rich.id, outcome: 'completed' }), 'JOURNAL_REVIEW_REQUIRED'); noJournalWrite(f.engine, before);
  const all = successRecords(await f.rpc('decisions.list')); assert.deepEqual(all.map(item => item.id), [legacy.id, rich.id]);
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due')).map(item => item.id), [legacy.id, rich.id]);
  assert.deepEqual(successRecords(await f.rpc('decisions.journal.due', { dueOn: '2026-10-15', branch: 'main' })).map(item => item.id), [rich.id]);
});
