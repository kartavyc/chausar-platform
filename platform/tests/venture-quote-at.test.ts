// Ink v2 wave 4, package 4J16 (catalogue Q4): a cited quote must appear at its page, row or timestamp, within a small
// window (2 lines or rows, or 10 seconds of a transcript). A quote found elsewhere gets one correction round that says
// where it really is; on the second round it fails. Spot checks pick quotes the same way every time for the same seed.
// On a YouTube draft, quotes written "words" (12:03) are checked against the order's transcript.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Deliverable } from '../runtime/venture/contracts.ts';
import { QUOTE_WINDOW, checkQuote, draftQuotes, moveQuoteTimes, quoteCheck, spotCheckQuotes, type QuoteSource } from '../runtime/venture/delivery/checks/quote-at.ts';
import { withMeta } from '../runtime/venture/views/row-meta.ts';
import { business, owner } from './venture-judge-helpers.ts';
import { runFlagshipChecks, withQuoteFixes, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';
import type { FileLike } from '../runtime/venture/delivery/harness/files.ts';
import { digest, ventureAction } from '../runtime/venture/records.ts';

const cue = (id: string, startS: number, endS: number, text: string) => ({ id, startMs: startS * 1000, endMs: endS * 1000, text });
const TRANSCRIPT: QuoteSource = {
  kind: 'transcript',
  cues: [
    cue('s1', 0, 4, 'Welcome back to the show.'),
    cue('s2', 4, 9, 'Today we talk about budgets that actually work.'),
    cue('s3', 185, 190, 'The emergency fund comes first,'),
    cue('s4', 190, 195, 'before any investing at all.'),
    cue('s5', 760, 766, 'Never borrow to buy a phone.'),
  ],
};

test('a quote at its timestamp, within ten seconds, is found; one spread over two cues is found too', () => {
  assert.equal(QUOTE_WINDOW.ms, 10_000);
  assert.equal(QUOTE_WINDOW.lines, 2);
  assert.equal(checkQuote({ quote: 'budgets that actually work', at: { kind: 'time', ms: 5_000 } }, TRANSCRIPT).found, true);
  // Eight seconds off is inside the window; the words are read without case or punctuation.
  assert.equal(checkQuote({ quote: 'Budgets, that actually WORK!', at: { kind: 'time', ms: 13_000 } }, TRANSCRIPT).found, true);
  assert.equal(checkQuote({ quote: 'the emergency fund comes first before any investing', at: { kind: 'time', ms: 186_000 } }, TRANSCRIPT).found, true);
});

test('a quote said elsewhere is not at its place: the first round asks for one fix with where it really is, the second fails', () => {
  const moved = { quote: 'Never borrow to buy a phone', at: { kind: 'time' as const, ms: 185_000 } };
  const first = checkQuote(moved, TRANSCRIPT);
  assert.equal(first.found, false);
  assert.deepEqual(first.foundAt, { kind: 'time', ms: 760_000 });
  const round1 = quoteCheck([moved], TRANSCRIPT, 1);
  assert.equal(round1.outcome, 'fix');
  assert.match(round1.detail, /is at 12:40, not 3:05/);
  assert.match(round1.detail, /one correction/);
  const round2 = quoteCheck([moved], TRANSCRIPT, 2);
  assert.equal(round2.outcome, 'fail');
  assert.match(round2.detail, /is at 12:40, not 3:05/);
  // A quote that is nowhere is said so.
  const missing = quoteCheck([{ quote: 'Buy the phone on credit', at: { kind: 'time', ms: 760_000 } }], TRANSCRIPT, 2);
  assert.equal(missing.outcome, 'fail');
  assert.match(missing.detail, /does not appear in the transcript/);
  assert.equal(quoteCheck([], TRANSCRIPT, 1).outcome, 'pass');
});

test('pages and rows: the quote must be on the cited page, or within two lines of the cited line or row', () => {
  const pages: QuoteSource = { kind: 'pages', pages: [{ page: 1, text: 'Form 16 Part B\nGross salary as per section 17(1)\nDeductions under Chapter VI-A' }, { page: 2, text: 'Tax deducted at source\nSignature of the employer' }] };
  assert.equal(checkQuote({ quote: 'Gross salary as per section 17(1)', at: { kind: 'page', page: 1 } }, pages).found, true);
  const wrongPage = checkQuote({ quote: 'Tax deducted at source', at: { kind: 'page', page: 1 } }, pages);
  assert.equal(wrongPage.found, false);
  assert.deepEqual(wrongPage.foundAt, { kind: 'page', page: 2, line: 1 });
  assert.equal(checkQuote({ quote: 'Deductions under Chapter VI-A', at: { kind: 'page', page: 1, line: 1 } }, pages).found, true);
  const rows: QuoteSource = { kind: 'rows', rows: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((id, index) => ({ id, text: `Row ${index + 1} note ${id === 'r6' ? 'paid in cash' : 'paid by bank'}` })) };
  assert.equal(checkQuote({ quote: 'paid in cash', at: { kind: 'row', row: 'r4' } }, rows).found, true);
  const far = checkQuote({ quote: 'paid in cash', at: { kind: 'row', row: 'r2' } }, rows);
  assert.equal(far.found, false);
  assert.deepEqual(far.foundAt, { kind: 'row', row: 'r6' });
});

test('spot checks: the same seed picks the same quotes, at most the number asked, each checked', () => {
  const citations = ['budgets that actually work', 'The emergency fund comes first', 'Never borrow to buy a phone', 'Welcome back to the show']
    .map((quote, index) => ({ quote, at: { kind: 'time' as const, ms: [5_000, 186_000, 760_000, 1_000][index] } }));
  const a = spotCheckQuotes(citations, TRANSCRIPT, { sample: 2, seed: 'run_1' });
  const b = spotCheckQuotes(citations, TRANSCRIPT, { sample: 2, seed: 'run_1' });
  assert.equal(a.length, 2);
  assert.deepEqual(a.map(item => item.quote), b.map(item => item.quote));
  assert.ok(a.every(item => item.found));
  assert.equal(spotCheckQuotes(citations, TRANSCRIPT, { sample: 10, seed: 'x' }).length, 4);
});

test('draft quotes are read from "words" (12:03), [12:03] and (page 2) marks', () => {
  const found = draftQuotes('She said "Never borrow to buy a phone" (12:40). Later: \u201Cbudgets that actually work\u201D [0:05]. The form says "Tax deducted at source" (page 2).');
  assert.deepEqual(found, [
    { quote: 'Never borrow to buy a phone', at: { kind: 'time', ms: 760_000 } },
    { quote: 'budgets that actually work', at: { kind: 'time', ms: 5_000 } },
    { quote: 'Tax deducted at source', at: { kind: 'page', page: 2 } },
  ]);
  assert.deepEqual(draftQuotes('No quotes here, "short" (1:00) is too short to cite.'), []);
});

// ---------------------------------------------------------------------------
// On a YouTube draft
// ---------------------------------------------------------------------------

const SRT = ['1', '00:12:40,000 --> 00:12:46,000', 'Never borrow to buy a phone.', '', '2', '00:00:04,000 --> 00:00:09,000', 'Today we talk about budgets that actually work.', ''].join('\n');
const transcriptFile = (): FileLike => {
  const content = Buffer.from(SRT, 'utf8').toString('base64');
  return { id: 'upload_t', name: 'episode.srt', format: 'transcript', bytes: SRT.length, digest: digest(content), contentBase64: content, clientData: true };
};
const draft = (line: string): Deliverable => ({ title: 'Your episode', sections: [{ heading: 'Description', parts: [{ kind: 'text', text: line }] }], questionsForClient: [] });
const input = (line: string, files: FileLike[]): FlagshipCheckInput => ({
  flagship: 'youtube', offerKey: null, servedBy: 'model', deliverable: draft(line), request: 'One episode on budgets.', intake: null,
  files, receipts: [], known: [], mode: 'client', today: '2026-10-21', dateOrder: 'day-month-year', finishing: null,
});
const quoteResult = async (value: FlagshipCheckInput) => (await runFlagshipChecks(value)).find(item => item.check === 'quotes-at-source');

test('a YouTube draft that quotes the talk is checked against the transcript; without one the check did not run', async () => {
  assert.equal((await quoteResult(input('In this episode: "Never borrow to buy a phone" (12:40).', [transcriptFile()])))?.outcome, 'pass');
  const wrong = await quoteResult(input('In this episode: "Never borrow to buy a phone" (3:05).', [transcriptFile()]));
  assert.equal(wrong?.outcome, 'fail');
  assert.match(wrong!.detail, /is at 12:40, not 3:05/);
  const noTranscript = await quoteResult(input('In this episode: "Never borrow to buy a phone" (12:40).', []));
  assert.equal(noTranscript?.outcome, 'not-run');
  assert.match(noTranscript!.detail, /^not run: /);
  // A draft that quotes nothing has no quote check at all.
  assert.equal(await quoteResult(input('In this episode we talk about budgets.', [transcriptFile()])), undefined);
});

test('round 1 runs in the draft pre-check: a quote found at another time is moved there by code, once, and the final check (round 2) says so', async () => {
  const before = draft('In this episode: "Never borrow to buy a phone" (3:05). And "Buy the phone on credit" (0:05).');
  const fixed = withQuoteFixes(before, [transcriptFile()], 'youtube');
  const words = (fixed.sections[0].parts[0] as { text: string }).text;
  assert.match(words, /"Never borrow to buy a phone" \(12:40\)/);
  // A quote that is nowhere in the transcript is not moved: round 2 fails it.
  assert.match(words, /"Buy the phone on credit" \(0:05\)/);
  assert.deepEqual(fixed.quoteFixes, ['"Never borrow to buy a phone" moved from 3:05 to 12:40, where the transcript says it.']);
  assert.equal((before as Deliverable).quoteFixes, undefined, 'the draft it was given is not changed');
  const final = await quoteResult({ ...input('', [transcriptFile()]), deliverable: fixed });
  assert.equal(final?.outcome, 'fail');
  assert.match(final!.detail, /does not appear in the transcript/);
  assert.match(final!.detail, /Chausar moved 1 quote/);
  // With every quote now at its place, round 2 passes and still names what code moved.
  const one = withQuoteFixes(draft('In this episode: "Never borrow to buy a phone" (3:05).'), [transcriptFile()], 'youtube');
  const passed = await quoteResult({ ...input('', [transcriptFile()]), deliverable: one });
  assert.equal(passed?.outcome, 'pass');
  // The move comes first, inside the part of the line Today shows (160 characters), so the owner sees it before Approve.
  assert.match(passed!.detail.slice(0, 160), /^Chausar moved 1 quote; check it before you approve: "Never borrow to buy a phone" moved from 3:05 to 12:40/);
  // Round 1 is one round: a draft already corrected is not corrected again, and other playbooks are left alone.
  assert.deepEqual(withQuoteFixes(one, [transcriptFile()], 'youtube'), one);
  assert.deepEqual(withQuoteFixes(before, [transcriptFile()], 'social-agency'), before);
  assert.deepEqual(withQuoteFixes(before, [], 'youtube'), before);
});

test('a quote said more than once in the transcript is not moved: the check says it is ambiguous', async () => {
  const twice: QuoteSource = { kind: 'transcript', cues: [...TRANSCRIPT.cues, cue('s6', 900, 905, 'So again: never borrow to buy a phone.')] };
  const look = checkQuote({ quote: 'Never borrow to buy a phone', at: { kind: 'time', ms: 185_000 } }, twice);
  assert.equal(look.found, false);
  assert.equal(look.foundAt, null);
  assert.deepEqual(look.elsewhere, [{ kind: 'time', ms: 760_000 }, { kind: 'time', ms: 900_000 }]);
  assert.deepEqual(moveQuoteTimes('"Never borrow to buy a phone" (3:05)', twice.cues), { text: '"Never borrow to buy a phone" (3:05)', fixes: [] });
  const result = quoteCheck([{ quote: 'Never borrow to buy a phone', at: { kind: 'time', ms: 185_000 } }], twice, 2);
  assert.equal(result.outcome, 'fail');
  assert.match(result.detail, /is said 2 times in the transcript \(at 12:40 and 15:00\), so it is ambiguous/);
});

test('the quotes code moved show on the Today row beside Approve, as meta', async () => {
  const env = await business('Run a YouTube channel that explains personal finance in plain words');
  const fixes = ['"Never borrow to buy a phone" moved from 3:05 to 12:40, where the transcript says it.'];
  const runId = await ventureAction(env.deps, owner, 'prepare', 'seed.run', tx => (tx.put({
    ...tx.base('venture-delivery-run'), orderId: 'order_x', playbookId: 'p', playbookHash: 'h', status: 'ready-for-review', servedBy: 'model', practice: false,
    callId: null, preview: null, deliverable: { ...draft('x'), quoteFixes: fixes }, renderedText: 'x', checks: [], verdict: null, editedText: null,
  } as never) as unknown as { id: string }).id);
  const row = { id: `run:${runId}:ready`, businessId: 'b', businessName: 'Test Business', kind: 'draft', title: 't', digest: 'd', createdAt: '2026-10-21T10:00:00.000Z', actions: [], viewRef: { kind: 'draft', id: runId } };
  const [withFixes] = withMeta(env.store.read(), [row as never], '2026-10-21T10:00:00.000Z');
  assert.deepEqual(withFixes.meta!.quoteFixes, fixes);
  const [plain] = withMeta(env.store.read(), [{ ...row, id: 'run:none:ready' } as never], '2026-10-21T10:00:00.000Z');
  assert.equal(plain.meta!.quoteFixes, undefined);
});
