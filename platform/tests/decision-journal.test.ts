import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { JournalContent, JournalDecision, JournalDraft, JournalObservation, MeasurementRef } from '../runtime/decision-journal.ts';
import { confirmDecision, draftDecision, dueDecisions, reviewDecision, reviseDecision } from '../runtime/decision-journal.ts';

const FIXED = {
  id: 'decision-fixed', actorId: 'owner',
  confirmAt: '2026-10-01T08:00:00.000Z',
  reviseAt: '2026-10-02T09:00:00.000Z',
  reviewAt: '2026-10-15T10:00:00.000Z',
  amendAt: '2026-10-16T11:00:00.000Z',
} as const;

// Full minimal typed receipts. Values are fixed reference literals, never produced by journal code under test.
const BASE: CalculationReceipt = {
  id: 'receipt-base', memberId: 'owner', epoch: 1,
  sourceIds: ['source-base'], operation: 'earned',
  createdAt: '2026-09-30T12:00:00.000Z', asOf: '2026-09-30T12:00:00.000Z',
  period: { from: '2026-09-01', to: '2026-09-30' }, comparePeriod: null,
  branch: 'main', currency: 'INR', ontologyVersion: 1,
  dictionaryHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  definitionHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  definitions: [],
  figures: [{ key: 'earned', label: 'Earned revenue',
    minor: '900719925474099391', display: 'INR 9,007,199,254,740,993.91',
    unit: 'money', currency: 'INR' }],
  valueMinor: '900719925474099391', totalMinor: '900719925474099391',
  rowIds: ['row-base'],
  rows: [{ factId: 'row-base', entityId: 'sale-base', sourceId: 'source-base',
    sourceRow: 2, kind: 'sale', amountMinor: '900719925474099391',
    validFrom: '2026-09-12', branch: 'main' }],
  exclusions: [{ rowId: 'row-base-excluded', reason: 'Outside measured window.' }],
  coverage: { selectedRows: 2, countedRows: 1, excludedRows: 1,
    unresolvedConflicts: 0, importIds: ['import-base'],
    completeness: 'reconciled-imports', gaps: [] },
  assumptions: {}, explanation: 'Receipt-backed measurement; causation was not assessed.',
  stale: false, allowedNumbers: ['900719925474099391', '9007199254740993.91'],
};

// Separate later observation; amount/display are explicit independent literals.
const MEASURED: CalculationReceipt = {
  ...structuredClone(BASE), id: 'receipt-measured', sourceIds: ['source-measured'],
  createdAt: '2026-10-15T09:00:00.000Z', asOf: '2026-10-15T09:00:00.000Z',
  period: { from: '2026-10-01', to: '2026-10-10' },
  figures: [{ key: 'earned', label: 'Earned revenue',
    minor: '900719925474099400', display: 'INR 9,007,199,254,740,994.00',
    unit: 'money', currency: 'INR' }],
  valueMinor: '900719925474099400', totalMinor: '900719925474099400',
  rowIds: ['row-measured'],
  rows: [{ factId: 'row-measured', entityId: 'sale-measured', sourceId: 'source-measured',
    sourceRow: 2, kind: 'sale', amountMinor: '900719925474099400',
    validFrom: '2026-10-05', branch: 'main' }],
  exclusions: [{ rowId: 'row-measured-excluded', reason: 'Outside measured window.' }],
  coverage: { selectedRows: 2, countedRows: 1, excludedRows: 1,
    unresolvedConflicts: 0, importIds: ['import-measured'],
    completeness: 'reconciled-imports', gaps: [] },
  allowedNumbers: ['900719925474099400', '9007199254740994.00'],
};

// Late correction for the amended review; again explicit literals rather than derived amounts.
const LATE: CalculationReceipt = {
  ...structuredClone(MEASURED), id: 'receipt-late', sourceIds: ['source-late'],
  createdAt: '2026-10-16T10:00:00.000Z', asOf: '2026-10-16T10:00:00.000Z',
  figures: [{ key: 'earned', label: 'Earned revenue',
    minor: '900719925474099450', display: 'INR 9,007,199,254,740,994.50',
    unit: 'money', currency: 'INR' }],
  valueMinor: '900719925474099450', totalMinor: '900719925474099450',
  rowIds: ['row-late'],
  rows: [{ factId: 'row-late', entityId: 'sale-late', sourceId: 'source-late',
    sourceRow: 3, kind: 'sale', amountMinor: '900719925474099450',
    validFrom: '2026-10-08', branch: 'main' }],
  exclusions: [],
  coverage: { selectedRows: 1, countedRows: 1, excludedRows: 0,
    unresolvedConflicts: 0, importIds: ['import-late'],
    completeness: 'reconciled-imports', gaps: [] },
  allowedNumbers: ['900719925474099450', '9007199254740994.50'],
};

const CONTENT: JournalContent = {
  text: 'Keep distributor terms and review the observed outcome.',
  options: [
    { id: 'keep', label: 'Keep terms', reason: 'Observe before changing terms.',
      evidence: [{ receiptId: 'receipt-base', figureKey: 'earned' }] },
    { id: 'tighten', label: 'Tighten terms', reason: 'Alternative for human consideration.', evidence: [] },
  ],
  assumptions: [{ id: 'lag', text: 'Some payments may arrive after the observation window.',
    status: 'unverified', evidence: [] }],
  selectedOptionId: 'keep', ownerId: 'owner',
  expectedOutcome: { description: 'Assess whether the observed outcome meets the owner expectation.',
    measure: 'earned revenue', population: 'main-branch distributor orders',
    baseline: { receiptId: 'receipt-base', figureKey: 'earned' },
    window: { from: '2026-10-01', to: '2026-10-10' }, maturityDate: '2026-10-15',
    lagRule: 'Wait for the explicitly recorded maturity date.',
    uncertainty: ['Concurrent activity can affect the observed result.'] },
  reviewDate: '2026-10-15',
  hypotheses: ['A delay is possible; no cause has been measured.'], branch: 'main',
};

const OBSERVATION: JournalObservation = {
  state: 'observable',
  measurements: [{ receiptId: 'receipt-measured', figureKey: 'earned' }],
  notes: 'Record the receipt figure without attributing the difference to this decision.',
  uncertainty: ['This observation does not establish a causal benefit.'],
  concurrentInterventions: ['A separate promotion overlapped the window.'],
  executionReceiptIds: ['execution-separate'],
};

for (const fixture of [BASE, MEASURED, LATE, CONTENT, OBSERVATION]) deepFreeze(fixture);

const STATES = ['pending', 'observable', 'inconclusive', 'achieved', 'not-achieved', 'amended'] as const;
const OUTCOMES = ['accepted', 'rejected', 'continue', 'completed'] as const;

type RevisionInput = Parameters<typeof reviseDecision>[2];
type ReviewInput = Parameters<typeof reviewDecision>[2];

const base = () => structuredClone(BASE);
const measured = () => structuredClone(MEASURED);
const late = () => structuredClone(LATE);
const content = () => structuredClone(CONTENT);
const observation = () => structuredClone(OBSERVATION);
const pending = (): JournalObservation => ({ ...observation(), state: 'pending', measurements: [] });
const rejects = (action: () => unknown, code: string) => assert.throws(action, { code });

const confirmation = (draft: JournalDraft) => ({ reviewedDigest: draft.digest, id: FIXED.id, actorId: FIXED.actorId, at: FIXED.confirmAt, receipts: [base()] });
const revisionInput = (overrides: Partial<RevisionInput> = {}): RevisionInput => ({ expectedRevision: 1, actorId: FIXED.actorId, at: FIXED.reviseAt, reason: 'Clarify the decision record.', receipts: [], ...overrides });
const reviewInput = (receipts: CalculationReceipt[], expectedRevision = 1, at: string = FIXED.reviewAt): ReviewInput => ({ expectedRevision, actorId: FIXED.actorId, at, receipts });

function confirmed(): JournalDecision {
  const draft = draftDecision(content(), [base()]);
  return confirmDecision(draft, confirmation(draft));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function reversed<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => reversed(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)])) as T;
  return value;
}

test('drafts only referenced receipts and confirms an explicit open decision with full lineage', () => {
  const draft = draftDecision(content(), [base(), measured()]);
  assert.equal(draft.kind, 'journal-draft');
  assert.deepEqual(draft.content, CONTENT);
  assert.deepEqual(draft.receipts, [BASE]);
  assert.equal(typeof draft.digest, 'string');
  assert.notEqual(draft.digest, '');
  assert.deepEqual(draftDecision(content(), [base()]), draft);

  const decision = confirmDecision(draft, confirmation(draft));
  assert.deepEqual(decision, {
    ...content(), id: FIXED.id, createdAt: FIXED.confirmAt, by: FIXED.actorId, status: 'open', revision: 1,
    receiptIds: ['receipt-base'], sourceIds: ['source-base'], rowIds: ['row-base', 'row-base-excluded'],
    receipts: [BASE], revisions: [], reviews: [],
  });
  assert.deepEqual(confirmDecision(draft, confirmation(draft)), decision);
});

test('normalizes only top-level text and keeps digests independent of key order but not array order', () => {
  const padded = content();
  padded.text = `  ${CONTENT.text}\n`;
  padded.options[1]!.label = '  Tighten terms  ';
  padded.hypotheses = ['  Spacing in a hypothesis is preserved.  '];
  const normalized = draftDecision(padded, [base()]).content;
  assert.equal(normalized.text, CONTENT.text);
  assert.equal(normalized.options[1]!.label, '  Tighten terms  ');
  assert.deepEqual(normalized.hypotheses, ['  Spacing in a hypothesis is preserved.  ']);

  const plain = draftDecision(content(), [base()]);
  assert.equal(draftDecision(reversed(content()), [reversed(base())]).digest, plain.digest);
  assert.deepEqual(confirmDecision(plain, { ...confirmation(plain), receipts: [reversed(base())] }).receipts, [BASE]);

  const swapped = content();
  swapped.options.reverse();
  assert.notEqual(draftDecision(swapped, [base()]).digest, plain.digest);
});

test('keeps inputs, drafts and confirmed decisions deeply detached from each other', () => {
  const input = content();
  const receipt = base();
  const draft = draftDecision(input, [receipt]);
  input.options[0]!.evidence[0]!.figureKey = 'mutated';
  input.expectedOutcome.uncertainty.push('Mutated after drafting.');
  receipt.figures[0]!.minor = '1';
  receipt.sourceIds.push('source-mutated');
  assert.deepEqual(draft.content, CONTENT);
  assert.deepEqual(draft.receipts, [BASE]);

  const reviewed = structuredClone(draft);
  const supplied = [base()];
  const decision = confirmDecision(draft, { ...confirmation(draft), receipts: supplied });
  assert.deepEqual(draft, reviewed);
  const decided = structuredClone(decision);
  draft.content.options[0]!.label = 'Mutated draft label';
  draft.receipts[0]!.figures[0]!.display = 'Mutated draft display';
  supplied[0]!.rowIds.push('row-mutated');
  assert.deepEqual(decision, decided);

  decision.receipts[0]!.exclusions.push({ rowId: 'row-mutated', reason: 'Mutated decision.' });
  decision.sourceIds.push('source-mutated');
  assert.deepEqual(supplied[0]!.exclusions, BASE.exclusions);
  assert.deepEqual(reviewed.receipts, [BASE]);
});

test('confirmation rejects tampered drafts, another reviewed digest and changed or unusable fresh evidence', () => {
  const draft = draftDecision(content(), [base()]);
  rejects(() => confirmDecision(draft, { ...confirmation(draft), reviewedDigest: `${draft.digest}0` }), 'REVIEW_DIGEST_MISMATCH');
  const editedContent = structuredClone(draft);
  editedContent.content.selectedOptionId = 'tighten';
  rejects(() => confirmDecision(editedContent, confirmation(draft)), 'DRAFT_CHANGED');
  const editedEvidence = structuredClone(draft);
  editedEvidence.receipts[0]!.figures[0]!.minor = '900719925474099392';
  rejects(() => confirmDecision(editedEvidence, confirmation(draft)), 'DRAFT_CHANGED');

  const changedFigure = base();
  changedFigure.figures[0]!.minor = '900719925474099392';
  const changedGaps = base();
  changedGaps.coverage.gaps = ['A late import is not reconciled.'];
  for (const receipt of [changedFigure, changedGaps])
    rejects(() => confirmDecision(draft, { ...confirmation(draft), receipts: [receipt] }), 'EVIDENCE_CHANGED');
  rejects(() => confirmDecision(draft, { ...confirmation(draft), receipts: [{ ...base(), stale: true, staleReason: 'Imports changed.' }] }), 'STALE_EVIDENCE');
  rejects(() => confirmDecision(draft, { ...confirmation(draft), receipts: [] }), 'RECEIPT_NOT_FOUND');
  rejects(() => confirmDecision(draft, { ...confirmation(draft), receipts: [base(), base()] }), 'AMBIGUOUS_EVIDENCE');
});

test('confirmation requires an explicit ID, actor and ISO timestamp and keeps the owner separate from the actor', () => {
  const draft = draftDecision(content(), [base()]);
  for (const at of ['', '2026-10-01', '2026-10-01 08:00:00Z', '2026-02-30T08:00:00.000Z', '2026-10-01T24:00:00.000Z'])
    rejects(() => confirmDecision(draft, { ...confirmation(draft), at }), 'INVALID_TIMESTAMP');
  rejects(() => confirmDecision(draft, { ...confirmation(draft), actorId: ' ' }), 'INVALID_ACTOR');
  rejects(() => confirmDecision(draft, { ...confirmation(draft), id: '' }), 'INVALID_CONFIRMATION');
  rejects(() => confirmDecision(draft, { ...confirmation(draft), ownerId: 'operator' } as never), 'INVALID_CONFIRMATION');

  const decision = confirmDecision(draft, { ...confirmation(draft), actorId: 'operator', at: '2026-10-01T13:30:00+05:30' });
  assert.equal(decision.createdAt, '2026-10-01T13:30:00+05:30');
  assert.equal(decision.by, 'operator');
  assert.equal(decision.ownerId, 'owner');
});

test('drafting rejects missing, duplicate and stale receipts and missing or ambiguous figure keys', () => {
  rejects(() => draftDecision(content(), [measured()]), 'RECEIPT_NOT_FOUND');
  rejects(() => draftDecision(content(), [base(), base()]), 'AMBIGUOUS_EVIDENCE');
  rejects(() => draftDecision(content(), [{ ...base(), stale: true, staleReason: 'Imports changed.' }]), 'STALE_EVIDENCE');
  const missingFigure = content();
  missingFigure.options[0]!.evidence[0]!.figureKey = 'missing';
  rejects(() => draftDecision(missingFigure, [base()]), 'FIGURE_NOT_FOUND');
  const repeatedFigure = base();
  repeatedFigure.figures.push(structuredClone(BASE.figures[0]!));
  rejects(() => draftDecision(content(), [repeatedFigure]), 'AMBIGUOUS_EVIDENCE');
});

test('drafting refuses unknown fields, invalid selections, duplicate IDs and invalid dates or windows', () => {
  const refused = (change: (value: JournalContent) => void, code = 'INVALID_DECISION') => {
    const value = content();
    change(value);
    rejects(() => draftDecision(deepFreeze(value), [base()]), code);
  };
  refused(value => Object.assign(value, { causalCredit: 'decision' }));
  refused(value => Object.assign(value.options[0]!, { score: 1 }));
  refused(value => Object.assign(value.assumptions[0]!, { confidence: 'high' }));
  refused(value => Object.assign(value.expectedOutcome, { improvement: '9' }));
  refused(value => Object.assign(value.expectedOutcome.window, { timezone: 'UTC' }));
  refused(value => Object.assign(value.options[0]!.evidence[0]!, { weight: 1 }), 'INVALID_REFERENCE');
  refused(value => { value.selectedOptionId = 'missing'; });
  refused(value => { value.options[1]!.id = 'keep'; });
  refused(value => { value.assumptions.push(structuredClone(value.assumptions[0]!)); });
  refused(value => { value.assumptions[0]!.status = 'verified' as never; });
  refused(value => { value.ownerId = ' '; });
  refused(value => { value.text = '   '; });
  refused(value => { value.reviewDate = '2026-02-30'; });
  refused(value => { value.expectedOutcome.maturityDate = '2026-13-01'; });
  refused(value => { value.expectedOutcome.window = { from: '2026-10-11', to: '2026-10-10' }; });
  refused(value => { value.expectedOutcome.window.from = '2026-10-1'; });

  const sameDay = content();
  sameDay.expectedOutcome.window = { from: '2026-10-10', to: '2026-10-10' };
  sameDay.expectedOutcome.maturityDate = '2026-10-01';
  assert.deepEqual(draftDecision(sameDay, [base()]).content.expectedOutcome, sameDay.expectedOutcome);
});

test('revision replaces full content, removes an omitted branch and keeps bounded before-content history', () => {
  const record = deepFreeze(confirmed());
  const original = structuredClone(record);
  const next = content();
  next.text = 'Tighten terms after the observed outcome.';
  next.ownerId = 'cofounder';
  next.reviewDate = '2026-10-20';
  next.selectedOptionId = 'tighten';
  delete next.branch;
  deepFreeze(next);
  const input = deepFreeze(revisionInput({ actorId: 'operator', reason: 'Ownership moved to the cofounder.' }));
  const revised = reviseDecision(record, next, input);
  assert.deepEqual(record, original);
  assert.deepEqual(revised, {
    ...structuredClone(next), id: FIXED.id, createdAt: FIXED.confirmAt, by: FIXED.actorId, status: 'open', revision: 2,
    receiptIds: ['receipt-base'], sourceIds: ['source-base'], rowIds: ['row-base', 'row-base-excluded'], receipts: [BASE],
    revisions: [{ fromRevision: 1, at: FIXED.reviseAt, by: 'operator', reason: 'Ownership moved to the cofounder.', before: CONTENT }],
    reviews: [],
  });
  assert.equal('branch' in revised, false);
  revised.receipts[0]!.figures[0]!.minor = 'mutated';
  revised.revisions[0]!.before.ownerId = 'mutated';
  assert.equal(revised.ownerId, 'cofounder');
  assert.deepEqual(record, original);

  rejects(() => reviseDecision(record, next, { ...input, expectedRevision: 2 }), 'REVISION_CONFLICT');
  rejects(() => reviseDecision(revised, content(), input), 'REVISION_CONFLICT');
  rejects(() => reviseDecision(record, next, { ...input, reason: ' ' }), 'INVALID_REVISION');
  rejects(() => reviseDecision(record, next, { ...input, at: '2026-10-02' }), 'INVALID_TIMESTAMP');
  assert.deepEqual(record, original);

  const unchanged = reviseDecision(record, next, input);
  const restored = reviseDecision(unchanged, content(), { ...input, expectedRevision: 2, at: FIXED.amendAt, reason: 'Restore the original terms.' });
  assert.equal(restored.revision, 3);
  assert.equal(restored.branch, 'main');
  assert.deepEqual(restored.revisions[0], unchanged.revisions[0]);
  assert.deepEqual(restored.revisions[1], { fromRevision: 2, at: FIXED.amendAt, by: 'operator', reason: 'Restore the original terms.', before: structuredClone(next) });
});

test('revision carries unchanged scoped references on retained history and needs fresh evidence for relinked ones', () => {
  const record = confirmed();
  record.receipts[0]!.stale = true;
  record.receipts[0]!.staleReason = 'A later import changed the measured period.';
  deepFreeze(record);
  const retained = structuredClone(record.receipts);

  const edited = content();
  edited.text = 'Keep terms; the owner clarified the wording.';
  edited.reviewDate = '2026-10-18';
  for (const receipts of [[], [{ ...base(), stale: true }]])
    assert.deepEqual(reviseDecision(record, edited, revisionInput({ receipts })).receipts, retained);

  const moved = content();
  moved.options[0]!.evidence = [];
  moved.options[1]!.evidence = [{ receiptId: 'receipt-base', figureKey: 'earned' }];
  const renamed = content();
  renamed.options[0]!.id = 'keep-terms';
  renamed.selectedOptionId = 'keep-terms';
  const assumed = content();
  assumed.assumptions[0]!.evidence = [{ receiptId: 'receipt-base', figureKey: 'earned' }];
  for (const next of [moved, renamed, assumed]) {
    rejects(() => reviseDecision(record, next, revisionInput({ receipts: [] })), 'RECEIPT_NOT_FOUND');
    rejects(() => reviseDecision(record, next, revisionInput({ receipts: [{ ...base(), stale: true }] })), 'STALE_EVIDENCE');
    const relinked = reviseDecision(record, next, revisionInput({ receipts: [base()] }));
    assert.deepEqual(relinked.receipts, retained);
    assert.deepEqual(relinked.receiptIds, ['receipt-base']);
  }
});

test('revision compares retained receipt identity ignoring only staleness and appends new evidence once', () => {
  const record = deepFreeze(confirmed());
  const relinked = content();
  relinked.options[1]!.evidence = [{ receiptId: 'receipt-base', figureKey: 'earned' }];
  const recalculated = { ...base(), staleReason: 'Recalculated after an import warning cleared.' };
  assert.deepEqual(reviseDecision(record, relinked, revisionInput({ receipts: [recalculated] })).receipts, [BASE]);
  rejects(() => reviseDecision(record, relinked, revisionInput({ receipts: [{ ...base(), explanation: 'A different explanation.' }] })), 'EVIDENCE_CHANGED');
  rejects(() => reviseDecision(record, relinked, revisionInput({ receipts: [{ ...base(), sourceIds: ['source-other'] }] })), 'EVIDENCE_CHANGED');

  const replaced = content();
  replaced.options[0]!.evidence = [];
  delete replaced.expectedOutcome.baseline;
  replaced.options[1]!.evidence = [{ receiptId: 'receipt-measured', figureKey: 'earned' }];
  replaced.assumptions[0]!.evidence = [{ receiptId: 'receipt-measured', figureKey: 'earned' }];
  const unused = { ...base(), id: 'receipt-unused', sourceIds: ['source-unused'], rowIds: ['row-unused'] };
  const revised = reviseDecision(record, replaced, revisionInput({ receipts: [unused, measured()] }));
  assert.deepEqual(revised.receipts, [BASE, MEASURED]);
  assert.deepEqual(revised.receiptIds, ['receipt-base', 'receipt-measured']);
  assert.deepEqual(revised.sourceIds, ['source-base', 'source-measured']);
  assert.deepEqual(revised.rowIds, ['row-base', 'row-base-excluded', 'row-measured', 'row-measured-excluded']);
  assert.deepEqual(revised.revisions[0]!.before, CONTENT);
});

test('review copies exact calculator figures and binds a human-declared assessment to the reviewed revision', () => {
  const record = deepFreeze(confirmed());
  const original = structuredClone(record);
  const review = deepFreeze({ outcome: 'continue' as const, observation: observation(), nextReviewDate: '2026-10-22' });
  const reviewed = reviewDecision(record, review, deepFreeze(reviewInput([measured()])));
  assert.deepEqual(record, original);
  assert.deepEqual(reviewed.reviews, [{
    outcome: 'continue', at: FIXED.reviewAt, by: FIXED.actorId, assessment: 'human-declared', atRevision: 1, content: CONTENT,
    observation: OBSERVATION,
    measuredFigures: [{ receiptId: 'receipt-measured', figure: { key: 'earned', label: 'Earned revenue', minor: '900719925474099400', display: 'INR 9,007,199,254,740,994.00', unit: 'money', currency: 'INR' } }],
    priorReviewDate: '2026-10-15', nextReviewDate: '2026-10-22',
  }]);
  assert.equal(reviewed.revision, 2);
  assert.equal(reviewed.status, 'open');
  assert.equal(reviewed.reviewDate, '2026-10-22');
  assert.deepEqual(reviewed.receipts, [BASE, MEASURED]);
  assert.deepEqual(reviewed.receiptIds, ['receipt-base', 'receipt-measured']);
  assert.deepEqual(reviewed.sourceIds, ['source-base', 'source-measured']);
  assert.deepEqual(reviewed.rowIds, ['row-base', 'row-base-excluded', 'row-measured', 'row-measured-excluded']);
  for (const ids of [reviewed.receiptIds, reviewed.sourceIds, reviewed.rowIds]) assert.equal(ids.includes('execution-separate'), false);

  reviewed.reviews[0]!.measuredFigures[0]!.figure.minor = 'mutated';
  reviewed.reviews[0]!.content.ownerId = 'mutated';
  reviewed.receipts[0]!.sourceIds.push('source-mutated');
  assert.equal(reviewed.receipts[1]!.figures[0]!.minor, '900719925474099400');
  assert.equal(reviewed.ownerId, 'owner');
  assert.deepEqual(record, original);
});

test('records all six observation states and four explicit conclusions without deriving either', () => {
  for (const state of STATES) {
    const measurements = state === 'pending' || state === 'inconclusive' ? [] : [{ receiptId: 'receipt-measured', figureKey: 'earned' }];
    const reviewed = reviewDecision(confirmed(), { outcome: 'accepted', observation: { ...observation(), state, measurements } }, reviewInput(measurements.length ? [measured()] : []));
    assert.equal(reviewed.reviews[0]!.observation.state, state);
    assert.equal(reviewed.reviews[0]!.outcome, 'accepted');
    assert.equal(reviewed.reviews[0]!.measuredFigures.length, measurements.length);
    assert.deepEqual(reviewed.receipts, measurements.length ? [BASE, MEASURED] : [BASE]);
  }

  const concluded = OUTCOMES.map(outcome => reviewDecision(confirmed(), { outcome, observation: observation() }, reviewInput([measured()])));
  assert.deepEqual(concluded.map(decision => decision.reviews[0]!.outcome), [...OUTCOMES]);
  assert.deepEqual(concluded.map(decision => decision.status), ['closed', 'closed', 'open', 'closed']);
  assert.deepEqual({ ...concluded[0]!.reviews[0]!, outcome: 'rejected' }, concluded[1]!.reviews[0]);
});

test('continue keeps or reschedules the review date and reopens, while other conclusions close', () => {
  const kept = reviewDecision(confirmed(), { outcome: 'continue', observation: pending() }, reviewInput([]));
  assert.equal(kept.status, 'open');
  assert.equal(kept.reviewDate, '2026-10-15');
  assert.equal(kept.reviews[0]!.priorReviewDate, '2026-10-15');
  assert.equal('nextReviewDate' in kept.reviews[0]!, false);
  assert.deepEqual(kept.reviews[0]!.measuredFigures, []);

  rejects(() => reviewDecision(confirmed(), { outcome: 'continue', observation: pending(), nextReviewDate: '2026-02-30' }, reviewInput([])), 'INVALID_REVIEW');
  for (const outcome of ['accepted', 'rejected', 'completed'] as const)
    rejects(() => reviewDecision(confirmed(), { outcome, observation: pending(), nextReviewDate: '2026-10-22' }, reviewInput([])), 'INVALID_REVIEW');

  const completed = deepFreeze(reviewDecision(confirmed(), { outcome: 'completed', observation: pending() }, reviewInput([])));
  assert.equal(completed.status, 'closed');
  const revised = reviseDecision(completed, content(), revisionInput({ expectedRevision: 2, at: FIXED.amendAt }));
  assert.equal(revised.status, 'closed');
  assert.equal(revised.revision, 3);
  assert.deepEqual(revised.reviews, completed.reviews);

  const reopened = reviewDecision(revised, { outcome: 'continue', observation: pending(), nextReviewDate: '2026-10-29' }, reviewInput([], 3, '2026-10-16T12:00:00.000Z'));
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.reviewDate, '2026-10-29');
  assert.equal(reopened.revision, 4);
  assert.deepEqual(reopened.reviews.slice(0, 1), completed.reviews);
  assert.equal(reopened.reviews[1]!.atRevision, 3);
  assert.equal(reopened.reviews[1]!.priorReviewDate, '2026-10-15');
  assert.equal(reopened.reviews[1]!.nextReviewDate, '2026-10-29');
});

test('a later amended review appends without rewriting the earlier assessment or evidence', () => {
  const first = deepFreeze(reviewDecision(confirmed(), { outcome: 'continue', observation: observation() }, reviewInput([measured()])));
  const earlier = structuredClone(first);
  const amendment = deepFreeze({
    outcome: 'continue' as const, notes: 'Late payments corrected the earlier observation.',
    observation: { ...observation(), state: 'amended' as const, measurements: [{ receiptId: 'receipt-late', figureKey: 'earned' }], uncertainty: ['Further late payments remain possible.'] },
  });
  const amended = reviewDecision(first, amendment, deepFreeze(reviewInput([late()], 2, FIXED.amendAt)));
  assert.deepEqual(first, earlier);
  assert.deepEqual(amended.reviews[0], earlier.reviews[0]);
  assert.deepEqual(amended.receipts, [BASE, MEASURED, LATE]);
  assert.deepEqual(amended.sourceIds, ['source-base', 'source-measured', 'source-late']);
  assert.deepEqual(amended.reviews[1], {
    outcome: 'continue', notes: 'Late payments corrected the earlier observation.', at: FIXED.amendAt, by: FIXED.actorId,
    assessment: 'human-declared', atRevision: 2, content: CONTENT, observation: amendment.observation,
    measuredFigures: [{ receiptId: 'receipt-late', figure: { key: 'earned', label: 'Earned revenue', minor: '900719925474099450', display: 'INR 9,007,199,254,740,994.50', unit: 'money', currency: 'INR' } }],
    priorReviewDate: '2026-10-15',
  });
});

test('measurements need an explicit figure key and fresh evidence even for a retained receipt', () => {
  const record = deepFreeze(confirmed());
  const original = structuredClone(record);
  const onBase = (receipts: CalculationReceipt[]) => reviewDecision(record, { outcome: 'accepted', observation: { ...observation(), measurements: [{ receiptId: 'receipt-base', figureKey: 'earned' }] } }, reviewInput(receipts));
  rejects(() => onBase([]), 'RECEIPT_NOT_FOUND');
  rejects(() => onBase([{ ...base(), stale: true, staleReason: 'Imports changed.' }]), 'STALE_EVIDENCE');
  rejects(() => onBase([base(), base()]), 'AMBIGUOUS_EVIDENCE');
  rejects(() => onBase([{ ...base(), asOf: '2026-10-15T00:00:00.000Z' }]), 'EVIDENCE_CHANGED');
  const remeasured = onBase([base()]);
  assert.deepEqual(remeasured.receipts, [BASE]);
  assert.deepEqual(remeasured.reviews[0]!.measuredFigures, [{ receiptId: 'receipt-base', figure: { key: 'earned', label: 'Earned revenue', minor: '900719925474099391', display: 'INR 9,007,199,254,740,993.91', unit: 'money', currency: 'INR' } }]);

  const measuring = (measurement: MeasurementRef) => () => reviewDecision(record, deepFreeze({ outcome: 'accepted' as const, observation: { ...observation(), measurements: [measurement] } }), reviewInput([measured()]));
  rejects(measuring({ receiptId: 'receipt-measured' } as MeasurementRef), 'INVALID_REFERENCE');
  rejects(measuring({ receiptId: 'receipt-measured', figureKey: ' ' }), 'INVALID_REFERENCE');
  rejects(measuring({ receiptId: 'receipt-measured', figureKey: 'missing' }), 'FIGURE_NOT_FOUND');
  assert.deepEqual(record, original);
});

test('scenario projections can inform options but are refused as measured outcomes', () => {
  const scenario: CalculationReceipt = {
    ...measured(), id: 'receipt-scenario',
    createdAt: '2026-10-15T09:30:00.000Z', asOf: '2026-10-15T09:30:00.000Z',
    figures: [{ key: 'scenario-earned', label: 'Scenario earned revenue',
      minor: '900719925474099500', display: 'INR 9,007,199,254,740,995.00',
      unit: 'money', currency: 'INR' }],
    valueMinor: '900719925474099500', totalMinor: '900719925474099500',
    assumptions: { priceChangeBps: 250 },
    explanation: 'Scenario only; recorded source facts are unchanged.',
    allowedNumbers: ['900719925474099500', '9007199254740995.00'],
  };
  deepFreeze(scenario);
  const record = deepFreeze(confirmed());
  const original = structuredClone(record);
  const projected = deepFreeze({ outcome: 'accepted' as const, observation: { ...observation(), measurements: [{ receiptId: 'receipt-scenario', figureKey: 'scenario-earned' }] } });
  rejects(() => reviewDecision(record, projected, reviewInput([scenario])), 'INVALID_MEASUREMENT');
  assert.deepEqual(record, original);

  const considered = content();
  considered.options[1]!.evidence = [{ receiptId: 'receipt-scenario', figureKey: 'scenario-earned' }];
  const draft = draftDecision(considered, [base(), scenario]);
  assert.deepEqual(draft.receipts, [BASE, scenario]);
  assert.deepEqual(draft.receipts[1]!.assumptions, { priceChangeBps: 250 });
});

test('review refuses revision conflicts, undeclared states or conclusions and extra causal fields without mutation', () => {
  const record = deepFreeze(reviewDecision(confirmed(), { outcome: 'continue', observation: observation() }, reviewInput([measured()])));
  const original = structuredClone(record);
  const valid = { outcome: 'accepted' as const, observation: observation() };
  for (const expectedRevision of [1, 3])
    rejects(() => reviewDecision(record, valid, reviewInput([measured()], expectedRevision)), 'REVISION_CONFLICT');
  rejects(() => reviseDecision(record, content(), revisionInput({ expectedRevision: 1 })), 'REVISION_CONFLICT');

  const invalid = [
    { ...valid, outcome: 'approved' },
    { ...valid, improvement: '9' },
    { ...valid, notes: 42 },
    { ...valid, observation: { ...observation(), state: 'succeeded' } },
    { ...valid, observation: { ...observation(), causalBenefit: 'The decision caused the change.' } },
    { ...valid, observation: { ...observation(), notes: undefined } },
    { ...valid, observation: { ...observation(), uncertainty: [42] } },
    { ...valid, observation: { ...observation(), concurrentInterventions: 'An overlapping promotion.' } },
    { ...valid, observation: { ...observation(), executionReceiptIds: [' '] } },
  ];
  for (const review of invalid)
    rejects(() => reviewDecision(record, deepFreeze(review) as never, reviewInput([measured()], 2)), 'INVALID_REVIEW');
  rejects(() => reviewDecision(record, valid, { ...reviewInput([measured()], 2), at: '2026-10-15' }), 'INVALID_TIMESTAMP');
  rejects(() => reviewDecision(record, valid, { ...reviewInput([measured()], 2), actorId: '' }), 'INVALID_ACTOR');
  assert.deepEqual(record, original);
});

test('due helper filters mixed rich and legacy records by inclusive open cutoff and the branch rule', () => {
  const rich = confirmed();
  const legacy = { id: 'decision-legacy', text: 'Legacy decision.', reviewDate: '2026-10-10', receiptIds: [], hypotheses: [], rowIds: [], createdAt: '2026-09-01T00:00:00.000Z', by: 'owner', status: 'open', reviews: [] };
  const closedLegacy = { ...legacy, id: 'decision-closed', reviewDate: '2026-10-01', status: 'closed' };
  const northern = { ...legacy, id: 'decision-north', reviewDate: '2026-10-12', branch: 'north' };
  const records: { id: string; reviewDate: string; status: string; branch?: string }[] = deepFreeze([rich, legacy, closedLegacy, northern]);
  const original = structuredClone(records);
  const due = (filter?: { dueOn?: string; branch?: string }) => dueDecisions(records, filter).map(record => record.id);

  assert.deepEqual(due({ dueOn: '2026-10-14' }), ['decision-legacy', 'decision-north']);
  assert.deepEqual(due({ dueOn: '2026-10-15' }), ['decision-fixed', 'decision-legacy', 'decision-north']);
  assert.deepEqual(due({ dueOn: '2026-10-16' }), ['decision-fixed', 'decision-legacy', 'decision-north']);
  assert.deepEqual(due({ dueOn: '2026-10-16', branch: 'main' }), ['decision-fixed', 'decision-legacy']);
  assert.deepEqual(due({ branch: 'north' }), ['decision-legacy', 'decision-closed', 'decision-north']);
  assert.deepEqual(due(), ['decision-fixed', 'decision-legacy', 'decision-closed', 'decision-north']);

  const copies = dueDecisions(records);
  assert.deepEqual(copies, records);
  assert.notEqual(copies[1], records[1]);
  copies[1]!.reviewDate = '2026-01-01';
  assert.deepEqual(records, original);

  rejects(() => dueDecisions(records, { dueOn: '2026-02-30' }), 'INVALID_FILTER');
  rejects(() => dueDecisions(records, { branch: ' ' }), 'INVALID_FILTER');
  rejects(() => dueDecisions(records, { dueOn: '2026-10-15', status: 'open' } as never), 'INVALID_FILTER');
});
