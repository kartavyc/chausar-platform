// The receipts check (catalogue Q3): every number in a draft or a run summary either has a receipt (the calculator, a
// tool result or the client's own words) or is labelled "model estimate" automatically, and a playbook that allows no
// estimates (the CA firm) fails it instead; a file or link the draft names must be in the run's evidence with a
// matching digest; a figure the calculator can refute is replaced by the calculator's value, with its receipt and a
// note. No model and no network: every receipt and file here is made by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { CHECK_IDS } from '../runtime/venture/contracts.ts';
import type {
  Deliverable, DeliveryRunView, Episode, HarnessState, ModelOutcome, ModelPort, ModelPreview, ModelStatusView, ModelTask, PriceReceiptRecord, RunDetail, SecretShelf,
  SimulationRunRecord, TextPart, VentureDeps, VentureMethod, WorkReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { correctDraft, estimateRule, runChecks, summaryReceipts, type CheckInput } from '../runtime/venture/delivery/checks.ts';
import { VERIFY_CHECKS } from '../runtime/venture/delivery/check-lists.ts';
import { DEFAULT_LIMITS, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import type { FileLike } from '../runtime/venture/delivery/harness/files.ts';
import { checkReceipts, prepareEvidence, type ReceiptEvidence } from '../runtime/venture/delivery/judge/claim-check.ts';
import { renderDeliverable } from '../runtime/venture/delivery/deliverable.ts';
import { diagnose, scoreEpisode } from '../runtime/venture/delivery/improve.ts';
import { scenariosFor } from '../runtime/venture/delivery/scenarios.ts';
import { SOCIAL_STEPS } from '../runtime/venture/playbooks/social/playbook.ts';
import { VentureTestStore } from './venture-test-store.ts';

const text = (value: string): TextPart => ({ kind: 'text', text: value });

function draftOf(...lines: string[]): Deliverable {
  return { title: 'Your September books', sections: [{ heading: 'Summary', parts: lines.map(text) }], questionsForClient: [] };
}

function input(deliverable: Deliverable, extra: Partial<CheckInput> = {}): CheckInput {
  return {
    checks: ['receipts'], deliverable, renderedText: '', serviceType: 'bookkeeping', allowed: [], receipts: [], ventureId: 'venture_1',
    mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: false, grounding: { clientRequest: 'Please close my September books.' },
    ...extra,
  };
}

const receipts = (result: ReturnType<typeof runChecks>) => {
  const found = result.find(item => item.check === 'receipts');
  assert.ok(found, 'the receipts check ran');
  return found;
};

function priceReceipt(id: string, figures: { key: string; label: string; display: string }[], ventureId = 'venture_1'): PriceReceiptRecord {
  return {
    id, kind: 'venture-price-receipt', ventureId, operation: 'venture.price', explanation: '', stale: false,
    figures: figures.map(figure => ({ ...figure, minor: '0', currency: 'INR' })),
  } as unknown as PriceReceiptRecord;
}

const PRICE = priceReceipt('receipt_1', [
  { key: 'tax', label: 'GST at 18%', display: 'INR 449.82' },
  { key: 'total', label: 'Total', display: 'INR 2,948.82' },
]);

const WORK = {
  id: 'work_1', kind: 'venture-work-receipt', ventureId: 'venture_1', operation: 'work.reconcile', explanation: '', currency: 'INR',
  figures: [{ key: 'matched-count', label: 'Payments matched to bills', minor: '3', display: '3', currency: 'INR', unit: 'count' }],
  inputs: { tables: [{ id: 'table_1', name: 'bills-september.csv', digest: 'ef'.repeat(32) }], columns: {}, rowIds: [] },
  steps: [], reconciliation: null, allowedNumbers: [], digest: 'x', runRef: { kind: 'delivery', runId: 'delivery_1' },
} as unknown as WorkReceiptRecord;

/** A price receipt with a GST total, for the probes the calculator must never refute. */
const TAXED = priceReceipt('receipt_3', [
  { key: 'tax', label: 'GST total', display: 'INR 180.00' },
  { key: 'total', label: 'Total', display: 'INR 1,180.00' },
]);
const MONEY_IN = {
  ...WORK, id: 'work_2', figures: [{ key: 'money-in', label: 'Money in', minor: '5000000', display: 'INR 50,000.00', currency: 'INR', unit: 'money' }],
} as unknown as WorkReceiptRecord;
/** A draft whose one text line sits beside a figure part that opens the receipt, so that receipt's figures may refute. */
const cites = (receipt: PriceReceiptRecord, line: string): Deliverable => ({
  title: 'Your order', questionsForClient: [], sections: [{ heading: 'Summary', parts: [text(line), { kind: 'figure', receiptId: receipt.id, figureKey: 'total' }] }],
});

const STATEMENT: FileLike = {
  id: 'upload_1', name: 'bank-statement.csv', format: 'csv', bytes: 60, digest: 'ab'.repeat(32), clientData: true,
  contentBase64: Buffer.from('Date,Narration,Amount\n01/09/2026,NEFT MEHTA PAPER MART,12500.00\n').toString('base64'),
};

function harnessWith(result: unknown): HarnessState {
  return {
    ...newHarnessState(['files.read'], DEFAULT_LIMITS, []),
    toolCalls: [{ id: 't1.1', turn: 1, tool: 'files.read', input: null, inputDigest: '', envelope: { ok: true, result: result as never }, outcome: 'succeeded', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] }],
  };
}

// ---------------------------------------------------------------------------
// Where it runs
// ---------------------------------------------------------------------------

test('receipts: the check is one of the check ids and the verify step of every real order runs it', () => {
  assert.ok(CHECK_IDS.includes('receipts'));
  assert.ok(VERIFY_CHECKS.includes('receipts'));
});

// ---------------------------------------------------------------------------
// Numbers: receipt or model estimate
// ---------------------------------------------------------------------------

test('receipts: a number with no receipt is labelled "model estimate" automatically, and the draft still passes', () => {
  const [result] = runChecks(input(draftOf('We will need about three days and 12 photos of your bills.')));
  assert.equal(result.check, 'receipts');
  assert.equal(result.passed, true, result.detail);
  assert.match(result.detail, /model estimates/);
  assert.match(result.detail, /"three"/);
  assert.match(result.detail, /"12"/);

  const labelled = checkReceipts('We will need about three days and 12 photos of your bills.', { sources: [] });
  assert.equal(labelled.labelled, 'We will need about three (model estimate) days and 12 (model estimate) photos of your bills.');
  assert.deepEqual(labelled.numbers.map(item => [item.text, item.status]), [['three', 'estimate'], ['12', 'estimate']]);
});

test('receipts: a number on a receipt, in a tool result or in the client\'s own words has a receipt and is not labelled', () => {
  const fromTool = runChecks(input(draftOf('Mehta Exports was paid 1200.'), { grounding: { clientRequest: 'Close my books.', harness: harnessWith({ rows: [{ cells: { Amount: '1200.00' } }] }) } }));
  assert.equal(receipts(fromTool).passed, true);
  assert.match(receipts(fromTool).detail, /Every number, file and link in the draft comes from a receipt, a tool result or the client/);

  const fromClient = checkReceipts('We will sort your 40 bills.', { sources: [{ id: 'client-message', text: 'I have 40 bills this month.' }] });
  assert.deepEqual(fromClient.numbers.map(item => [item.text, item.status, item.sourceId]), [['40', 'receipted', 'client-message']]);
  assert.equal(fromClient.labelled, 'We will sort your 40 bills.');

  const fromReceipt = runChecks(input(draftOf('Your total for the month is 2,948.82.'), { receipts: [PRICE] }));
  assert.equal(receipts(fromReceipt).passed, true);
  assert.doesNotMatch(receipts(fromReceipt).detail, /model estimate/);
  // Another business's receipt is no receipt for this one.
  const other = runChecks(input(draftOf('Your total for the month is 2,948.82.'), { receipts: [priceReceipt('receipt_9', [{ key: 'total', label: 'Total', display: 'INR 2,948.82' }], 'venture_other')] }));
  assert.match(receipts(other).detail, /model estimate/);
});

test('receipts: dates, years, document names, names with digits and names the business uses are not numbers to label', () => {
  const draft = draftOf('Form 16 for AY 2026-27 is due by 15 June 2026, and GSTR-3B comes in 2026 for Studio 54.');
  const [result] = runChecks(input(draft, { grounding: { clientRequest: 'Hello.', known: ['Studio 54'] } }));
  assert.equal(result.passed, true, result.detail);
  assert.match(result.detail, /states no number/);
  // One and first are words, not numbers, as the model-number rule of 21 October has it.
  assert.equal(checkReceipts('One of us will read the first bill.', { sources: [] }).numbers.length, 0);
});

test('receipts: a year span is a year, not a number, even for the CA firm', () => {
  for (const line of ['Advance tax for 2025-26 is due in March.', 'Your tax year 2026-27 papers follow.', 'The tax for FY 2025/26 is worked by the calculator.']) {
    const [result] = runChecks(input(draftOf(line), { flagship: 'ca-firm' }));
    assert.equal(result.passed, true, `${line}: ${result.detail}`);
  }
});

test('receipts: the owner\'s own links are sources; a link with no digest held skips the digest test; links are found before known names are masked', () => {
  const grounding = { clientRequest: 'Hi.', ownerWords: ['Cafe books, booking at https://ledgercafe.example.in/book'] };
  assert.equal(receipts(runChecks(input(draftOf('Book a call at https://ledgercafe.example.in/book.'), { grounding }))).passed, true);
  const stated = receipts(runChecks(input(draftOf('Book a call at https://ledgercafe.example.in/book (sha256 abcdef12).'), { grounding })));
  assert.equal(stated.passed, true, stated.detail);
  // A known name inside a link does not hide the link from the check.
  const hidden = receipts(runChecks(input(draftOf('See https://example.com/pricing for the rest.'), { grounding: { clientRequest: 'Hi.', known: ['example'] } })));
  assert.equal(hidden.passed, false);
  assert.match(hidden.detail, /https:\/\/example\.com\/pricing/);
});

test('receipts: evidence prepared once gives the same answer as evidence read each time', () => {
  const evidence: ReceiptEvidence = { sources: [{ id: 'client-message', text: 'I have 40 bills.' }], clientIds: ['client-message'] };
  const prepared = prepareEvidence(evidence);
  for (const line of ['We will sort your 40 bills.', 'We need about three days.']) assert.deepEqual(checkReceipts(line, prepared), checkReceipts(line, evidence));
});

test('receipts: where the playbook forbids estimates (the CA firm) money, rates and tax with no receipt fail; counts are only labelled', () => {
  assert.equal(estimateRule('ca-firm'), 'forbid');
  assert.equal(estimateRule('youtube'), 'label');
  assert.equal(estimateRule(null), 'label');
  assert.equal(estimateRule(undefined), 'label');

  // A count of things with no receipt is labelled, never failed, even where estimates are forbidden.
  const [counts] = runChecks(input(draftOf('Please confirm the two invoices marked as missing, for 3 clients.'), { estimates: 'forbid' }));
  assert.equal(counts.passed, true, counts.detail);
  assert.match(counts.detail, /model estimates/);
  assert.match(counts.detail, /"two"/);
  assert.equal(runChecks(input(draftOf('Your refund should arrive in about three weeks.'), { estimates: 'forbid' }))[0].passed, true);

  // Money, a rate or a tax figure with no receipt fails.
  for (const line of ['Your tax comes to about 12,500.', 'The rate is 12%.', 'Interest of 500 is due.', 'Your income is about two lakh.', 'The tax comes to 12,500 across the year.']) {
    const [refused] = runChecks(input(draftOf(line), { estimates: 'forbid' }));
    assert.equal(refused.passed, false, line);
    assert.match(refused.detail, /allows no model estimates of money, rates or tax/, line);
  }
  const [mixed] = runChecks(input(draftOf('Your tax comes to about 12,500 for 3 clients.'), { estimates: 'forbid' }));
  assert.equal(mixed.passed, false);
  assert.match(mixed.detail, /"12,500"/);
  assert.match(mixed.detail, /This number has no receipt, so it shows as a model estimate: "3"/);
  assert.deepEqual(checkReceipts('Your tax comes to about 12,500 for 3 clients.', { sources: [] }).numbers.map(item => [item.text, item.amount]), [['12,500', true], ['3', false]]);

  const [backed] = runChecks(input(draftOf('Your total for the month is 2,948.82.'), { receipts: [PRICE], estimates: 'forbid' }));
  assert.equal(backed.passed, true, backed.detail);
  // Absent estimates, the draft's flagship playbook decides: the CA firm forbids, others label.
  assert.equal(runChecks(input(draftOf('Your tax comes to about 12,500.'), { flagship: 'ca-firm' }))[0].passed, false);
  assert.equal(runChecks(input(draftOf('Your tax comes to about 12,500.'), { flagship: 'youtube' }))[0].passed, true);
});

// ---------------------------------------------------------------------------
// Files and links
// ---------------------------------------------------------------------------

test('receipts: a file the draft names must be in the run\'s evidence, with a matching digest when the draft states one', () => {
  const grounding = { clientRequest: 'Close my books.', files: [STATEMENT] };
  assert.equal(receipts(runChecks(input(draftOf('We read bank-statement.csv for September.'), { grounding }))).passed, true);
  assert.equal(receipts(runChecks(input(draftOf('We read bank-statement.csv (sha256 abababab) for September.'), { grounding }))).passed, true);

  const missing = receipts(runChecks(input(draftOf('We read march-bills.csv for September.'), { grounding })));
  assert.equal(missing.passed, false);
  assert.match(missing.detail, /"march-bills\.csv"/);
  assert.match(missing.detail, /not in this run's evidence/);

  const changed = receipts(runChecks(input(draftOf('We read bank-statement.csv (sha256 cdcdcdcd) for September.'), { grounding })));
  assert.equal(changed.passed, false);
  assert.match(changed.detail, /does not match/);
  // The digest is not a number to label.
  assert.doesNotMatch(changed.detail, /model estimate/);

  // A table the calculator read is evidence too.
  assert.equal(receipts(runChecks(input(draftOf('The bills came from bills-september.csv.'), { receipts: [WORK] }))).passed, true);
  // A question asking the client for a file is a request, not a claim that the file exists.
  const asked: Deliverable = { ...draftOf('Here is what we need.'), questionsForClient: ['Can you send march-bills.csv?'] };
  assert.equal(receipts(runChecks(input(asked, { grounding }))).passed, true);
});

test('receipts: a link the draft names must be in the run\'s evidence', () => {
  const grounding = { clientRequest: 'Our brief is at https://example.com/brief.' };
  const found = receipts(runChecks(input(draftOf('We will follow the brief at https://example.com/brief.'), { grounding })));
  assert.equal(found.passed, true, found.detail);
  const invented = receipts(runChecks(input(draftOf('See https://example.com/pricing for the rest.'), { grounding })));
  assert.equal(invented.passed, false);
  assert.match(invented.detail, /https:\/\/example\.com\/pricing/);
  // A tool result of the run that holds the link counts.
  const viaTool = receipts(runChecks(input(draftOf('See https://example.com/pricing for the rest.'), { grounding: { clientRequest: 'Hi.', harness: harnessWith({ url: 'https://example.com/pricing' }) } })));
  assert.equal(viaTool.passed, true, viaTool.detail);
  // A digits-only link path is not a number to label.
  assert.equal(checkReceipts('Read https://example.com/2026/09/brief now.', { sources: [{ id: 'client-message', text: 'https://example.com/2026/09/brief' }] }).numbers.length, 0);
});

// ---------------------------------------------------------------------------
// The calculator refutes a figure
// ---------------------------------------------------------------------------

test('receipts: a figure the calculator refutes fails the check with the calculator\'s value and its receipt', () => {
  const result = receipts(runChecks(input(cites(PRICE, 'The GST on this order comes to 500.'), { receipts: [PRICE] })));
  assert.equal(result.passed, false);
  assert.match(result.detail, /refutes "500"/);
  assert.match(result.detail, /GST at 18% is INR 449\.82/);
  assert.match(result.detail, /receipt_1/);
  // The same words with the calculator's own figure pass.
  assert.equal(receipts(runChecks(input(cites(PRICE, 'The GST on this order comes to 449.82.'), { receipts: [PRICE] }))).passed, true);
});

test('receipts: the calculator never refutes the client\'s own figure, a figure its label is not next to, or a price where no fee, price, quote or order is named', () => {
  // Total income from the client: the client's own figure stays.
  const income = runChecks(input(cites(TAXED, 'Your total income is 8,50,000 for this year.'), { receipts: [TAXED], grounding: { clientRequest: 'My total income this year is 8,50,000.' } }));
  assert.equal(receipts(income).passed, true, receipts(income).detail);
  assert.doesNotMatch(receipts(income).detail, /refutes/);
  assert.deepEqual(correctDraft(input(cites(TAXED, 'Your total income is 8,50,000 for this year.'), { receipts: [TAXED], grounding: { clientRequest: 'My total income this year is 8,50,000.' } })).corrections, []);
  // A GST total on March sales is not this order's GST.
  const sales = cites(TAXED, 'The GST total on your March sales is 18,000.');
  assert.doesNotMatch(receipts(runChecks(input(sales, { receipts: [TAXED] }))).detail, /refutes/);
  assert.deepEqual(correctDraft(input(sales, { receipts: [TAXED] })).corrections, []);
  // The owner's own money is not the money in the reconciliation.
  const own = summaryReceipts('You added 12,000 of your own money in March.', { receipts: [MONEY_IN], ventureId: 'venture_1' });
  assert.deepEqual(own.numbers.map(item => [item.text, item.status]), [['12,000', 'estimate']]);
  // Even right beside the label and with the order named, a number the client gave is the client's.
  const evidence: ReceiptEvidence = {
    sources: [{ id: 'client-message', text: 'The total for my order is 8,50,000.' }], clientIds: ['client-message'],
    figures: [{ receiptId: 'receipt_3', figureKey: 'total', label: 'Total', display: 'INR 1,180.00', unit: 'money', kind: 'price' }],
  };
  assert.deepEqual(checkReceipts('The total for this order is 8,50,000.', evidence).numbers.map(item => [item.status, item.sourceId]), [['receipted', 'client-message']]);
  // Without the client's figure the same words are refuted.
  assert.equal(checkReceipts('The total for this order is 8,50,000.', { ...evidence, sources: [], clientIds: [] }).numbers[0].status, 'refuted');
});

test('receipts: correctDraft replaces a refuted figure, keeps the punctuation after it, and the receipts check stays failed until the owner checks it', () => {
  const draft: Deliverable = { ...cites(PRICE, 'The GST on this order comes to 500.'), estimate: true };
  const fixed = correctDraft(input(draft, { receipts: [PRICE] }));
  assert.deepEqual(fixed.deliverable.sections[0].parts, [
    text('The GST on this order comes to'), { kind: 'figure', receiptId: 'receipt_1', figureKey: 'tax' }, text('.'),
    { kind: 'figure', receiptId: 'receipt_1', figureKey: 'total' },
  ]);
  assert.match(renderDeliverable(fixed.deliverable, [PRICE], { dateOrder: 'day-month-year' }), /comes to GST at 18%: INR 449\.82\. Total: INR 2,948\.82/);
  assert.equal(fixed.deliverable.estimate, undefined, 'no number of the model\'s own is left, so the draft is no longer an estimate');
  assert.equal(fixed.corrections.length, 1);
  const [note] = fixed.corrections;
  assert.deepEqual([note.said, note.receiptId, note.figureKey, note.display], ['500', 'receipt_1', 'tax', 'INR 449.82']);
  assert.match(note.note, /said 500/);
  assert.match(note.note, /GST at 18% is INR 449\.82/);
  // A number of the model's own that stays (18%) keeps the draft an estimate.
  const kept = correctDraft(input(cites(PRICE, 'The GST at 18% on this order comes to 500.'), { receipts: [PRICE] }));
  assert.equal(kept.corrections.length, 1);
  assert.equal(kept.deliverable.estimate, true);

  // Checked after the correction, the check stays failed and says what Chausar changed, for the owner to check.
  const after = runChecks(input(fixed.deliverable, { receipts: [PRICE], corrections: fixed.corrections, checks: ['receipts', 'figures-resolve'] }));
  assert.equal(receipts(after).passed, false);
  assert.match(receipts(after).detail, /Chausar corrected one figure; check them/);
  assert.match(receipts(after).detail, /449\.82/);
  assert.equal(after.find(item => item.check === 'figures-resolve')!.passed, true);

  // A draft whose checks do not include receipts is never corrected; nor is one with nothing to correct.
  assert.deepEqual(correctDraft(input(draft, { receipts: [PRICE], checks: ['house-style'] })), { deliverable: draft, corrections: [] });
  const clean = draftOf('We will sort your bills.');
  assert.deepEqual(correctDraft(input(clean)), { deliverable: clean, corrections: [] });
});

test('receipts: a count is refuted only when the words count what the receipt counts; an unclear match is never refuted', () => {
  const summary = summaryReceipts('We matched 4 payments to bills, and 14 rows were read.', { receipts: [WORK], ventureId: 'venture_1' });
  assert.equal(summary.passed, false);
  assert.equal(summary.labelled, 'We matched 3 (receipt work_1, corrected from 4) payments to bills, and 14 (model estimate) rows were read.');
  assert.deepEqual(summary.numbers.map(item => [item.text, item.status]), [['4', 'refuted'], ['14', 'estimate']]);
  assert.match(summary.detail, /summary/);

  // "3 bills" counts bills, not the total: the total does not refute it.
  const counted = summaryReceipts('The total covers 3 bills.', { receipts: [PRICE], ventureId: 'venture_1' });
  assert.deepEqual(counted.numbers.map(item => [item.text, item.status]), [['3', 'estimate']]);
  // Two receipts with different totals: which one the words mean is unclear, so nothing is refuted.
  const two = summaryReceipts('Your total for this order is 1,000.', { receipts: [PRICE, priceReceipt('receipt_2', [{ key: 'total', label: 'Total', display: 'INR 5,000.00' }])], ventureId: 'venture_1' });
  assert.deepEqual(two.numbers.map(item => [item.text, item.status]), [['1,000', 'estimate']]);
  // A matching count is a receipt.
  const right = summaryReceipts('We matched three payments to bills.', { receipts: [WORK], ventureId: 'venture_1' });
  assert.deepEqual(right.numbers.map(item => [item.text, item.status, item.sourceId]), [['three', 'receipted', 'work_1']]);
  assert.equal(right.passed, true);
});

// ---------------------------------------------------------------------------
// Prompt leaks on drafts no flagship playbook checks
// ---------------------------------------------------------------------------

test('prompt-leak: every draft without a flagship playbook is linted for words meant for the AI; a flagship leaves it to its own checks', () => {
  assert.ok(CHECK_IDS.includes('prompt-leak'));
  assert.ok(VERIFY_CHECKS.includes('prompt-leak'));
  const leaky = draftOf('Here is a reply for your September books.', 'I hope this helps.');
  const [leak] = runChecks(input(leaky, { checks: ['prompt-leak'] }));
  assert.equal(leak.check, 'prompt-leak');
  assert.equal(leak.passed, false);
  assert.match(leak.detail, /words meant for the AI/);
  assert.match(leak.detail, /I hope this helps/);
  assert.equal(runChecks(input(draftOf('We will send it to [client name] on Monday.'), { checks: ['prompt-leak'] }))[0].passed, false, 'a placeholder left behind');
  const asked: Deliverable = { ...draftOf('Here is what we need.'), questionsForClient: ['As an AI, I cannot open files. Can you send them?'] };
  assert.equal(runChecks(input(asked, { checks: ['prompt-leak'] }))[0].passed, false, "questions are the agent's words too");
  const [clean] = runChecks(input(draftOf('We will sort your bills and match them to the bank statement.'), { checks: ['prompt-leak'] }));
  assert.equal(clean.passed, true, clean.detail);
  assert.match(clean.detail, /no words meant for the AI/);
  // A flagship playbook's own checks lint its drafts (playbooks/draft-checks.ts), so the check is left out, not passed.
  assert.deepEqual(runChecks(input(leaky, { checks: ['prompt-leak'], flagship: 'youtube' })), []);
});

// ---------------------------------------------------------------------------
// Wired in: real orders, rehearsal, the playbooks and the runs view
// ---------------------------------------------------------------------------

test("check lists: rehearsal cases and the social playbook's verify step run the receipts check; rehearsal lints for prompt leaks", () => {
  for (const scenario of scenariosFor('bookkeeping')) {
    assert.ok(scenario.checks.includes('receipts'), scenario.id);
    assert.ok(scenario.checks.includes('prompt-leak'), scenario.id);
  }
  const verify = SOCIAL_STEPS.find(step => step.kind === 'verify');
  assert.ok(verify && verify.checks.includes('receipts'));
});

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const EXPIRES = '2026-10-21T10:30:00.000Z';
const PLAIN_IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';
type RawPart = { kind: 'text' | 'figure'; text: string; ref: string };
const said = (line: string): RawPart => ({ kind: 'text', text: line, ref: '' });
/** A bookkeeping draft with every required heading: the given parts under Summary, plain words under the rest. */
const raw = (title: string, parts: RawPart[], questionsForClient: string[] = []) => ({
  title, questionsForClient, sections: [
    { heading: 'Summary', parts },
    { heading: 'What we will do', parts: [said('We will sort your bills and match them to the bank statement.')] },
    { heading: 'What we need from you', parts: [said('Please send the bank statement and your bills.')] },
    { heading: 'Next steps', parts: [said('Once the files arrive, we will prepare a short report for you to review.')] },
  ],
});
const priced = (ref: string): RawPart => ({ kind: 'figure', text: '', ref });

/** The main tier is an AI and the quick tier built-in templates. Previews wait; an approved preview answers with the next queued draft. */
class Port implements ModelPort {
  drafts: unknown[] = [];
  #calls = 0;
  #previews = new Map<string, string>();
  status(): ModelStatusView {
    return {
      connections: [], spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
      tiers: {
        fast: { presetId: 'built-in-templates', model: null, usable: true, reason: 'No AI connected; using built-in templates' },
        main: { presetId: 'anthropic-sonnet-5-5', model: 'anthropic-sonnet-5-5', usable: true, reason: 'Uses your Anthropic key.' },
      },
    } as ModelStatusView;
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    if (task.purpose !== 'delivery') {
      if (!task.template) throw new ChausarError('NO_MODEL_CONNECTED', 'No template.');
      return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    }
    this.#calls += 1;
    return { value: task.validate(this.drafts.shift()), by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, digest(payloadText));
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: EXPIRES,
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (value: unknown) => T): Promise<ModelOutcome<T>> {
    if (this.#previews.get(callId) !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again.');
    this.#previews.delete(callId);
    return { value: validate(this.drafts.shift()), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
}

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

/** A plain bookkeeping business (no flagship playbook) on the template route: every offer priced at 1000, accepted, at approve each, one client. */
async function plainBusiness() {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new Port();
  const secrets = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const deps: VentureDeps = {
    store, clock: () => new Date('2026-10-21T10:00:00.000Z'), models, services: { calculator, ontology, trust },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  const call = (method: VentureMethod, payload: unknown = {}): Promise<any> => HANDLERS[method](deps, owner, payload);
  await call('venture.create', { idea: PLAIN_IDEA, countryCode: 'IN', workingName: 'Test Business' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await call('venture.blueprint.draft', { useTemplate: true });
  const plan = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await call('venture.blueprint.accept', { digest: plan.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  const offerId = plan.blueprint.offers[0].id as string;
  // A current price receipt for the first offer, so rehearsal drafts have a total to cite (the template route makes none).
  await ventureAction(deps, owner, 'prepare', 'seed.receipt', tx => tx.put({
    ...tx.base('venture-price-receipt'), subject: { type: 'offer', offerId }, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: { unitPriceMinor: '100000', quantity: '1', discountBps: '0', taxMode: 'none', taxRateBps: '0', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'not-registered', blueprintDigest: plan.blueprint.digest },
    steps: [], figures: [{ key: 'total', label: 'Total', minor: '100000', display: 'INR 1,000.00', currency: 'INR' }],
    totalMinor: '100000', allowedNumbers: [], explanation: '1 x month at INR 1,000.00 = INR 1,000.00.', digest: 'receipt-digest', stale: false,
  } as PriceReceiptRecord));
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return { call, models, client, offerId, deps };
}

async function deliver(env: Awaited<ReturnType<typeof plainBusiness>>, answer: unknown): Promise<DeliveryRunView> {
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offerId, request: 'Please close my September books.' });
  const waiting = await env.call('venture.delivery.run', { orderId: order.id });
  assert.equal(waiting.status, 'waiting-for-you');
  env.models.drafts.push(answer);
  return env.call('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest });
}

test("wired: a real order's draft carries the calculator's figure in place of a refuted one, with the note on its receipts check", async () => {
  const env = await plainBusiness();
  const run = await deliver(env, raw('Plan for your books', [said('The total comes to 500 for this order.'), priced('order.total')]));
  assert.equal(run.status, 'ready-for-review');
  const parts = run.deliverable!.sections[0].parts;
  assert.equal(parts[0].kind === 'text' && parts[0].text, 'The total comes to');
  assert.equal(parts[1].kind === 'figure' && parts[1].figureKey, 'total');
  assert.ok(!run.renderedText!.includes('500'), run.renderedText!);
  const receipts = run.checks.find(item => item.check === 'receipts')!;
  assert.equal(receipts.passed, false);
  assert.match(receipts.detail, /Chausar corrected one figure; check them/);
  assert.match(receipts.detail, /said 500/);
  assert.equal(run.checks.find(item => item.check === 'claims-grounded')!.passed, true);
  // Not green until the owner checks it: Accept waits, and the owner's edit settles the draft.
  assert.equal(run.canAccept, false);
  const edited = await env.call('venture.delivery.review', { runId: run.id, verdict: 'edited', editedText: 'The total for this order is on the receipt below.' });
  assert.equal(edited.status, 'edited');
});

test("wired: a business whose stored playbook predates the receipts and prompt-leak checks still runs both, and is corrected", async () => {
  const env = await plainBusiness();
  await env.call('venture.delivery.playbook');
  await ventureAction(env.deps, owner, 'prepare', 'seed.older', tx => {
    for (const record of listRecords(tx.state, 'venture-playbook', tx.venture!.id)) {
      tx.replace({ ...record, steps: record.steps.map(step => ({ ...step, checks: step.checks.filter(id => id !== 'receipts' && id !== 'prompt-leak') })) });
    }
  });
  const run = await deliver(env, raw('Plan for your books', [said('The total comes to 500 for this order.'), priced('order.total')]));
  assert.ok(run.checks.some(item => item.check === 'prompt-leak'));
  assert.match(run.checks.find(item => item.check === 'receipts')!.detail, /Chausar corrected one figure/);
  assert.ok(!run.renderedText!.includes('500'));
});

test('wired: Today shows the agent\'s words with numbers that have no receipt labelled', async () => {
  const env = await plainBusiness();
  const ready = await deliver(env, raw('Plan for your 3 bills', [said('We will sort your bills.'), priced('order.total')]));
  const draftItem = await env.call('venture.queue.view', { id: ready.id, kind: 'draft' });
  assert.equal(draftItem.title, 'Plan for your 3 (model estimate) bills');

  // The same run asking the owner a question, with the agent's own note on its step.
  await ventureAction(env.deps, owner, 'prepare', 'seed.question', tx => {
    const stored = tx.find('venture-delivery-run', ready.id)!;
    tx.replace({
      ...stored, status: 'needs-answer', deliverable: null, renderedText: null, checks: [], harness: {
        ...newHarnessState(['files.read'], DEFAULT_LIMITS, []), phase: 'needs-answer',
        handoffs: [{ to: 'owner', question: 'Are the 3 bills from March?', turn: 1, answer: null, answeredBy: null }],
        turns: [{ turn: 1, step: 'act', note: 'Read 14 rows of the statement.', calls: [], finished: false, forced: false, by: 'model', callId: null, costMicros: '0' }],
      },
    });
  });
  const list = await env.call('venture.queue.list', {});
  const row = list.rows.find((item: any) => item.kind === 'question');
  assert.ok(row, JSON.stringify(list.rows.map((item: any) => item.kind)));
  assert.equal(row.line, 'Are the 3 (model estimate) bills from March?');
  const asked = await env.call('venture.queue.view', { id: ready.id, kind: 'draft' });
  assert.equal(asked.line, 'Are the 3 (model estimate) bills from March?');
  assert.ok(asked.sections.some((section: any) => section.lines.includes('Read 14 (model estimate) rows of the statement.')), JSON.stringify(asked.sections));
});

test("wired: a real order's draft with words meant for the AI fails prompt-leak and cannot be accepted", async () => {
  const env = await plainBusiness();
  const run = await deliver(env, raw('Plan for your books', [said('Here is a reply for your September books. I hope this helps.'), priced('order.total')]));
  const leak = run.checks.find(item => item.check === 'prompt-leak')!;
  assert.equal(leak.passed, false);
  assert.equal(run.canAccept, false);
});

test('wired: the runs view labels a number the agent wrote with no receipt as a model estimate', async () => {
  const env = await plainBusiness();
  const run = await deliver(env, raw('Plan for your 3 bills', [said('We will sort your bills.'), priced('order.total')]));
  const detail: RunDetail = await env.call('venture.runs.get', { runId: run.id });
  const labels = detail.steps.flatMap(step => (step.evidence ?? []).filter(item => item.kind === 'draft').map(item => item.label));
  assert.deepEqual(labels, ['Plan for your 3 (model estimate) bills']);
});

test('wired: a rehearsal draft is corrected by the calculator before its checks, and every case runs the receipts check', async () => {
  const env = await plainBusiness();
  for (let index = 0; index < 8; index += 1) env.models.drafts.push(raw('Plan for your books', [said('The total comes to 500 for this order.'), priced(`${env.offerId}.total`)]));
  const record: SimulationRunRecord = await env.call('venture.simulation.run', { episodes: 1 });
  const drafted = record.episodes.filter(episode => episode.deliverable);
  assert.ok(drafted.length >= 1, JSON.stringify(record.episodes.map(episode => [episode.scenarioId, episode.firstFailure, episode.turns.map(turn => turn.text.slice(0, 80))])));
  for (const episode of drafted) {
    const receipts = episode.checks.find(item => item.check === 'receipts');
    assert.ok(receipts, episode.scenarioId);
    assert.equal(receipts.passed, false);
    assert.match(receipts.detail, /Chausar corrected one figure; check them/);
    assert.ok(!episode.renderedText!.includes('500'), episode.renderedText!);
  }
});

// ---------------------------------------------------------------------------
// The improvement loop keeps both checks
// ---------------------------------------------------------------------------

test('improve: a failed receipts or prompt-leak check is a cluster the loop can patch, and receipts is critical', () => {
  const episode = (check: 'receipts' | 'prompt-leak'): Episode => ({
    scenarioId: 'bookkeeping-clean', index: 0, turns: [], deliverable: null, renderedText: null, mocks: [], judge: [], passed: false, firstFailure: check, costMicros: '0',
    checks: [{ check, passed: false, detail: 'Failed.' }],
  });
  for (const check of ['receipts', 'prompt-leak'] as const) {
    const found = diagnose([], [episode(check)], new Set());
    assert.deepEqual(found.clusters.map(cluster => cluster.reason), [check]);
    assert.ok(found.chosen && found.chosen.reason === check, check);
  }
  assert.equal(scoreEpisode(episode('receipts')).critical, 'receipts');
  assert.equal(scoreEpisode(episode('prompt-leak')).critical, null);
});
