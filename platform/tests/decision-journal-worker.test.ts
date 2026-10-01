import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import type { DesktopBridge } from '../../app/desktop/types.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { JournalContent, JournalDraft } from '../runtime/decision-journal.ts';
import { Vault } from '../runtime/vault.ts';

// All business facts, saved receipts, owners and assessment statements below are
// synthetic fixtures. The actual Node worker performs local encrypted-store RPCs;
// no database, CLI, provider or external effect transport is contacted.
const passphrase = 'synthetic journal worker fixture passphrase';
const exactAmount = '900719925474099391';
const content: JournalContent = {
  text: 'Keep synthetic terms pending human review.', ownerId: 'owner', branch: 'main',
  options: [{ id: 'keep', label: 'Keep', reason: 'Synthetic observation before intervention.',
    evidence: [{ receiptId: 'synthetic-receipt', figureKey: 'total' }] }],
  assumptions: [{ id: 'lag', text: 'Payment timing remains uncertain.', status: 'unverified', evidence: [] }],
  selectedOptionId: 'keep', reviewDate: '2026-10-15', hypotheses: ['No causal effect is established.'],
  expectedOutcome: { description: 'Human assessment of the observed result.', measure: 'earned revenue',
    population: 'synthetic main-branch orders', baseline: { receiptId: 'synthetic-receipt', figureKey: 'total' },
    window: { from: '2026-10-01', to: '2026-10-10' }, maturityDate: '2026-10-15',
    lagRule: 'Review after the declared date.', uncertainty: ['Concurrent activity can change the result.'] },
};
const observation = { state: 'observable', measurements: [{ receiptId: 'synthetic-receipt', figureKey: 'total' }],
  notes: 'Synthetic human observation only.', uncertainty: ['No causal claim.'],
  concurrentInterventions: ['Other synthetic activity'], executionReceiptIds: [] };

function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function records(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value)); return value.map(record);
}
function id(value: unknown): string { assert.equal(typeof value, 'string'); assert.ok(typeof value === 'string'); return value; }
function code(expected: string) {
  return (error: unknown) => record(error).code === expected;
}

// Type-only consumer regression: journal payloads and result contracts are named
// on the real desktop bridge, including mandatory revision for both rich writers.
function typedBridgeContract(bridge: DesktopBridge, draft: JournalDraft) {
  const pendingDraft: Promise<JournalDraft> = bridge.request('decisions.journal.draft', { content });
  void pendingDraft;
  void bridge.request('decisions.journal.confirm', { draft, reviewedDigest: draft.digest });
  void bridge.request('decisions.journal.revise', { id: 'synthetic', content, expectedRevision: 1, reason: 'Synthetic reason' });
  void bridge.request('decisions.journal.due', { dueOn: '2026-10-15' });
  // @ts-expect-error An explicit loaded revision is required for revision.
  void bridge.request('decisions.journal.revise', { id: 'synthetic', content, reason: 'Synthetic reason' });
  // @ts-expect-error An explicit loaded revision is required for review.
  void bridge.request('decisions.journal.review', { id: 'synthetic', review: { outcome: 'continue', observation: { state: 'pending', measurements: [], notes: '', uncertainty: [], concurrentInterventions: [], executionReceiptIds: [] } } });
}
void typedBridgeContract;

async function seed(directory: string) {
  const { vault } = await Vault.create({ directory: join(directory, 'main'), name: 'Synthetic journal worker',
    passphrase, demo: true, storage: 'experimental-file' });
  try {
    const receipt: CalculationReceipt = {
      id: 'synthetic-receipt', memberId: 'owner', epoch: 1, sourceIds: ['synthetic-source'], operation: 'earned',
      createdAt: '2026-09-30T12:00:00.000Z', asOf: '2026-09-30T12:00:00.000Z',
      period: { from: '2026-09-01', to: '2026-09-30' }, comparePeriod: null, branch: 'main', currency: 'INR',
      ontologyVersion: 1, dictionaryHash: 'a'.repeat(64), definitionHash: 'b'.repeat(64), definitions: [],
      figures: [{ key: 'total', label: 'Synthetic earned revenue', minor: exactAmount,
        display: 'INR 9,007,199,254,740,993.91', unit: 'money', currency: 'INR' }],
      valueMinor: exactAmount, totalMinor: exactAmount, rowIds: ['synthetic-row'],
      rows: [{ factId: 'synthetic-row', entityId: 'synthetic-row', sourceId: 'synthetic-source', sourceRow: 2,
        kind: 'sale', amountMinor: exactAmount, validFrom: '2026-09-12', branch: 'main' }],
      exclusions: [], coverage: { selectedRows: 1, countedRows: 1, excludedRows: 0, unresolvedConflicts: 0,
        importIds: [], completeness: 'unreconciled-facts', gaps: [] }, assumptions: {},
      explanation: 'Synthetic saved receipt, without provider or causal qualification.', stale: false, allowedNumbers: [exactAmount],
    };
    await vault.update(state => {
      state.facts.push({ id: 'synthetic-row', entityId: 'synthetic-row', sourceId: 'synthetic-source', sourceRow: 2,
        kind: 'sale', validFrom: '2026-09-12', validTo: null, learnedAt: new Date().toISOString(), supersededAt: null,
        fields: { amountMinor: exactAmount, currency: 'INR' }, branch: 'main' });
      state.receipts.push(receipt);
    });
  } finally { await vault.close(); }
}

test('real desktop harness persists the synthetic journal lifecycle and refuses revision/evidence bypasses', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-journal-worker-'));
  await seed(directory);
  const harness = new EngineHarness({ workerPath: fileURLToPath(new URL('../runtime/worker.ts', import.meta.url)),
    environment: { SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(), CHAUSAR_DEMO: '1',
      CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_UPDATE_PUBLIC_KEY: '' },
    requestTimeoutMs: 10000, startupTimeoutMs: 10000 });
  t.after(async () => {
    await harness.stop();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'chausar-journal-worker-')));
    await rm(directory, { recursive: true, force: true });
  });
  await harness.start();
  await harness.request('workspace.open', { passphrase });
  const draft = record(await harness.request('decisions.journal.draft', { content }));
  assert.equal(draft.kind, 'journal-draft');
  assert.equal(records(await harness.request('decisions.list')).length, 0, 'Drafts are transient.');
  await assert.rejects(harness.request('decisions.journal.confirm', { draft, reviewedDigest: 'unreviewed' }), code('REVIEW_DIGEST_MISMATCH'));
  await assert.rejects(harness.request('decisions.journal.confirm', { draft: null, reviewedDigest: draft.digest }), code('INVALID_DRAFT'));
  let decision = record(await harness.request('decisions.journal.confirm', { draft, reviewedDigest: draft.digest }));
  const decisionId = id(decision.id);
  assert.equal(decision.revision, 1); assert.equal(decision.status, 'open');
  assert.equal(records(decision.receipts)[0].totalMinor, exactAmount);
  await assert.rejects(harness.request('decisions.review', { id: decisionId, outcome: 'completed' }), code('JOURNAL_REVIEW_REQUIRED'));
  await assert.rejects(harness.request('decisions.journal.revise', { id: decisionId, content, reason: 'Missing revision' }), code('INVALID_REVISION'));
  await assert.rejects(harness.request('decisions.journal.review', { id: decisionId, review: { outcome: 'completed', observation } }), code('INVALID_REVIEW'));
  await assert.rejects(harness.request('decisions.journal.revise', { id: decisionId, content, reason: 'Bad revision', expectedRevision: '1' }), code('REVISION_CONFLICT'));
  await assert.rejects(harness.request('decisions.journal.review', { id: decisionId, expectedRevision: 1, review: { outcome: 'completed', observation }, executionReceipt: {} }), code('INVALID_REVIEW'));
  await assert.rejects(harness.request('decisions.journal.review', { id: decisionId, expectedRevision: 1,
    review: { outcome: 'completed', observation: { ...observation, executionReceiptIds: ['synthetic-unresolved-execution'] } } }), code('EXECUTION_RECEIPT_NOT_FOUND'));
  const concurrent = await Promise.allSettled([
    harness.request('decisions.journal.revise', { id: decisionId, expectedRevision: 1, content: { ...content, text: 'Synthetic revised terms.' }, reason: 'Review a changed premise.' }),
    harness.request('decisions.journal.review', { id: decisionId, expectedRevision: 1, review: { outcome: 'continue', observation } }),
  ]);
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
  const refused = concurrent.find(item => item.status === 'rejected'); assert.ok(refused?.status === 'rejected');
  assert.equal(record(refused.reason).code, 'REVISION_CONFLICT');
  const current = records(await harness.request('decisions.list')).find(item => item.id === decisionId);
  assert.ok(current); decision = current; assert.equal(decision.revision, 2);
  assert.equal(records(decision.revisions).length + records(decision.reviews).length, 1);
  decision = record(await harness.request('decisions.journal.review', { id: decisionId, expectedRevision: 2,
    review: { outcome: 'completed', observation } }));
  assert.equal(decision.revision, 3); assert.equal(decision.status, 'closed');
  const lastReview = records(decision.reviews).at(-1); assert.ok(lastReview);
  assert.equal(lastReview.assessment, 'human-declared');
  assert.equal(record(records(lastReview.measuredFigures)[0].figure).minor, exactAmount);
  assert.equal(records(await harness.request('decisions.journal.due', { dueOn: '2026-10-15' })).length, 0);
  decision = record(await harness.request('decisions.journal.review', { id: decisionId, expectedRevision: 3,
    review: { outcome: 'continue', observation, nextReviewDate: '2026-10-20' } }));
  assert.equal(decision.revision, 4); assert.equal(decision.status, 'open');
  assert.equal(records(await harness.request('decisions.journal.due', { dueOn: '2026-10-19' })).length, 0);
  assert.equal(records(await harness.request('decisions.journal.due', { dueOn: '2026-10-20', branch: 'main' })).length, 1);
  await assert.rejects(harness.request('decisions.journal.due', { dueOn: '2026-02-30' }), code('INVALID_DATE'));
  await assert.rejects(harness.request('decisions.journal.due', { dueOn: '' }), code('INVALID_DATE'));
  await assert.rejects(harness.request('decisions.journal.due', { evidence: [] }), code('INVALID_FILTER'));
  assert.equal(record(await harness.request('receipts.get', { id: 'synthetic-receipt' })).totalMinor, exactAmount);
  const activity = record(await harness.request('activity.list'));
  assert.equal(records(activity.items).filter(event => ['decision.created', 'decision.revised', 'decision.reviewed'].includes(id(event.event))).length, 4);
  await harness.request('workspace.lock');
  await harness.request('workspace.open', { passphrase });
  const reopened = records(await harness.request('decisions.list')).find(item => item.id === decisionId);
  assert.deepEqual(reopened, decision, 'Both revision and review history survive encrypted-store reopen.');
  await harness.request('trust.update', { allowedSources: [] });
  assert.equal(records(await harness.request('decisions.journal.due', { dueOn: '2026-10-20' })).length, 0);
  await assert.rejects(harness.request('decisions.journal.revise', { id: decisionId, content, expectedRevision: 4, reason: 'Revoked evidence' }), code('SOURCE_REVOKED'));
  assert.equal((await harness.stop()).graceful, true);
});
