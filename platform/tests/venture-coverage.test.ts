// Ink v2 wave 4 (4J14, Q6): coverage that can't be faked. The work over a client's files is a worklist; files.read
// marks the rows, lines and pages code really handed over (from its own answer, never the agent's words); a result is
// partial unless coverage is complete; coverage leads as a fraction; what was never observed is null, never 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, RunDetail, ToolCallRecord, WorkReceiptRecord } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { readMarks, worklistOf, type FileLike } from '../runtime/venture/delivery/harness/files.ts';
import { coverageView, readCoverage, resultOf, workReceiptCoverage } from '../runtime/venture/delivery/coverage.ts';
import { toolSpec, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { BATCH_CHARS, PREVIEW_LIMIT_CHARS } from '../runtime/venture/delivery/harness/hygiene.ts';
import { call, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup } from './venture-views-env.ts';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const csv = (rows: number) => ['Date,Text,Amount', ...Array.from({ length: rows }, (_, i) => `2026-09-${String(1 + (i % 28)).padStart(2, '0')},Item ${i + 1},${100 + i}`)].join('\n');
const srt = (cues: number) => Array.from({ length: cues }, (_, i) => `${i + 1}\n00:00:${String(i).padStart(2, '0')},000 --> 00:00:${String(i).padStart(2, '0')},900\nLine ${i + 1}\n`).join('\n');
const file = (id: string, name: string, format: FileLike['format'], text: string): FileLike => ({ id, name, format, bytes: text.length, digest: `d-${id}`, contentBase64: b64(text), clientData: true });

const BANK = file('upload_bank', 'bank.csv', 'csv', csv(130));
const TALK = file('upload_talk', 'talk.srt', 'transcript', srt(12));
const BILLS = file('upload_bills', 'bills.pdf', 'pdf', '%PDF-1.4');

let n = 0;
function read(input: Record<string, unknown>, result: unknown, ok = true, turn = 1): ToolCallRecord {
  n += 1;
  return {
    id: `tc_${n}`, turn, tool: 'files.read', input: input as never, inputDigest: 'd',
    envelope: ok ? { ok: true, result: result as never } : { ok: false, error: { code: 'TOOL_FAILED', name: 'ToolFailed', message: 'No.' } },
    outcome: ok ? 'succeeded' : 'failed', effect: 'read', tier: 'code', receiptIds: [], tableIds: [],
  };
}
const rowsOf = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `r${from + i}` }));

test('the worklist: a table\'s rows, a transcript\'s lines, and a PDF\'s pages only once read', () => {
  const list = worklistOf([BANK, TALK, BILLS]);
  assert.deepEqual(list.map(item => [item.target, item.name, item.unit, item.ids?.length ?? null]), [
    ['upload_bank', 'bank.csv', 'rows', 130], ['upload_talk', 'talk.srt', 'lines', 12], ['upload_bills', 'bills.pdf', 'pages', null],
  ]);
  const broken = file('upload_bad', 'bad.csv', 'csv', '');
  assert.deepEqual(worklistOf([broken]).map(item => item.ids), [null], 'a table code could not read has no known count');
});

test('files.read marks only what code handed over, from its own answer', () => {
  const files = [BANK, TALK, BILLS];
  assert.deepEqual(readMarks(read({ target: 'f1', part: 'rows' }, { table: 'f1', columns: [], rows: rowsOf(1, 60), next: 'r61' }), files),
    [{ target: 'upload_bank', ids: rowsOf(1, 60).map(row => row.id) }]);
  assert.deepEqual(readMarks(read({ target: 'f1', part: 'sample' }, { table: 'f1', columns: [], rows: 130, sample: rowsOf(1, 5) }), files),
    [{ target: 'upload_bank', ids: ['r1', 'r2', 'r3', 'r4', 'r5'] }]);
  assert.deepEqual(readMarks(read({ target: 'f1', part: 'columns' }, { table: 'f1', columns: [], rows: 130 }), files), [], 'column names are no rows');
  assert.deepEqual(readMarks(read({ target: 'f2', part: 'pages' }, { file: 'f2', segments: [{ id: 'seg-1' }, { id: 'seg-2' }], next: null }), files),
    [{ target: 'upload_talk', ids: ['seg-1', 'seg-2'] }]);
  assert.deepEqual(readMarks(read({ target: 'f3', part: 'pages' }, { file: 'f3', pages: [{ page: 1, text: 'one' }, { page: 2, text: 'two' }], amounts: [], dates: [] }), files),
    [{ target: 'upload_bills', ids: ['p1', 'p2'], total: 2 }], 'a PDF is read whole, so its count is known once read');
  assert.deepEqual(readMarks(read({ target: 'f1', part: 'rows', from: 'r61' }, null, false), files), [], 'a failed read marks nothing');
  assert.deepEqual(readMarks(read({ target: 'f1', part: 'rows', from: 'r1' }, { table: 't1', columns: [], rows: rowsOf(1, 3) }), files), [], 'a table a tool made is not a client file');
  assert.deepEqual(readMarks(read({ target: 'f9', part: 'rows' }, { table: 'f9', columns: [], rows: rowsOf(1, 3) }), files), [], 'no such file');
  assert.deepEqual(readMarks({ ...read({}, { table: 'f1', rows: rowsOf(1, 3) }), tool: 'files.list' }, files), [], 'only files.read marks');
});

test('coverage leads as a fraction; partial unless complete; never observed is null, never 0', () => {
  assert.deepEqual(coverageView(1204, 1210, 'lines', 'matched'), { done: 1204, total: 1210, unit: 'lines', verb: 'matched', complete: false, line: '1,204 of 1,210 lines matched' });
  assert.deepEqual(coverageView(3, 3, 'pages', 'read'), { done: 3, total: 3, unit: 'pages', verb: 'read', complete: true, line: '3 of 3 pages read' });
  assert.equal(coverageView(1, 1, 'pages', 'read').line, '1 of 1 page read');
  assert.equal(coverageView(0, 4, 'rows', 'read').line, '0 of 4 rows read');
  assert.deepEqual(coverageView(2, null, 'pages', 'read'), { done: 2, total: null, unit: 'pages', verb: 'read', complete: false, line: '2 pages read; how many there are is not known' });
  assert.deepEqual(coverageView(null, 10, 'rows', 'read'), { done: null, total: 10, unit: 'rows', verb: 'read', complete: false, line: 'Rows read: not observed' });
  assert.equal(resultOf(coverageView(3, 3, 'pages', 'read')), 'complete');
  assert.equal(resultOf(coverageView(2, 3, 'pages', 'read')), 'partial');
  assert.equal(resultOf(coverageView(2, null, 'pages', 'read')), 'partial');
  assert.equal(resultOf(null), 'partial', 'no coverage at all is not complete');
});

test('a run\'s reading coverage: rows read of rows sent, file by file, re-reads counted once', () => {
  const files = [BANK, TALK];
  const calls = [
    read({ target: 'f1', part: 'rows' }, { table: 'f1', rows: rowsOf(1, 60) }),
    read({ target: 'f1', part: 'rows', from: 'r61' }, { table: 'f1', rows: rowsOf(61, 120) }),
    read({ target: 'f1', part: 'rows' }, { table: 'f1', rows: rowsOf(1, 60) }),
    read({ target: 'f2', part: 'pages' }, { file: 'f2', segments: Array.from({ length: 12 }, (_, i) => ({ id: `seg-${i + 1}` })) }),
  ];
  const seen = readCoverage(files, calls)!;
  assert.deepEqual(seen.files.map(item => item.line), ['120 of 130 rows read', '12 of 12 lines read']);
  assert.deepEqual(seen.coverage, { done: 132, total: 142, unit: 'items', units: ['rows', 'lines'], verb: 'read', complete: false, line: '132 of 142 rows and lines read' },
    'an items count names the units it adds up, so the screen words it for itself');
  const pdf = readCoverage([BANK, BILLS], [read({ target: 'f1', part: 'rows' }, { table: 'f1', rows: rowsOf(1, 130) })])!;
  assert.deepEqual(pdf.files.map(item => item.line), ['130 of 130 rows read', 'Pages read: not observed']);
  assert.equal(pdf.coverage.total, null, 'an unread PDF leaves the whole count unknown');
  assert.equal(pdf.coverage.complete, false);
  assert.equal(readCoverage([], calls), null, 'no files, no worklist');
  const whole = readCoverage([BANK], [read({ target: 'f1', part: 'rows' }, { table: 'f1', rows: rowsOf(1, 130) })])!;
  assert.deepEqual(whole.coverage, { done: 130, total: 130, unit: 'rows', verb: 'read', complete: true, line: '130 of 130 rows read' });
});

test('a work receipt\'s coverage: bank lines matched, rows used; a CA engine receipt has none', () => {
  const base = { id: 'work_1', kind: 'venture-work-receipt', ventureId: 'v', memberId: 'm', epoch: 1, at: '2026-10-15T10:00:00.000Z', runRef: { kind: 'delivery', runId: 'd' }, currency: 'INR', steps: [], figures: [], allowedNumbers: [], explanation: '', digest: 'x' } as const;
  const line = (rowId: string) => ({ rowId, date: null, text: 't', amountMinor: '100', display: 'INR 1.00' });
  const reconcile = { ...base, operation: 'work.reconcile', inputs: { tables: [], columns: {}, rowIds: [] },
    reconciliation: { balanced: true, statementClosing: true, matched: Array.from({ length: 1204 }, (_, i) => ({ bankRowId: `r${i}`, billRowId: `b${i}`, amountMinor: '1', display: '', bankText: '', billText: '', rule: 'amount-only' as const })), unmatchedBank: Array.from({ length: 6 }, (_, i) => line(`u${i}`)), unmatchedBills: [], moneyIn: [] } } as unknown as WorkReceiptRecord;
  const state = { conversations: [] } as never;
  assert.equal(workReceiptCoverage(state, [], reconcile)?.line, '1,204 of 1,210 bank lines matched');
  const sum = { ...base, operation: 'work.sum', reconciliation: null, inputs: { tables: [{ id: 'upload_bank', name: 'bank.csv', digest: 'd' }], columns: {}, rowIds: ['r1', 'r2', 'r2', 'r3'] } } as unknown as WorkReceiptRecord;
  assert.equal(workReceiptCoverage(state, [BANK], sum)?.line, '3 of 130 rows used');
  assert.equal(workReceiptCoverage(state, [], sum)?.line, '3 rows used; how many there are is not known', 'its table is not here, so its size is not known');
  assert.equal(workReceiptCoverage(state, [], { ...base, operation: 'ca.engine', reconciliation: null, inputs: { tables: [], columns: {}, rowIds: [] } } as unknown as WorkReceiptRecord), null);
});

test('venture.runs.get: the read step leads with coverage, the work receipt with its fraction, unrun checks are listed', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  await ventureAction(env.deps, owner, 'prepare', 'seed.files', tx => {
    const ventureId = tx.venture!.id;
    tx.state.conversations.push({ ...BANK, kind: 'venture-upload', ventureId, scope: { kind: 'order', orderId: order.id } });
    tx.state.conversations.push({ id: 'work_1', kind: 'venture-work-receipt', ventureId, operation: 'work.sum', explanation: 'Money out adds up to INR 41,250.00.', figures: [],
      inputs: { tables: [{ id: 'upload_bank', name: 'bank.csv', digest: 'd' }], columns: {}, rowIds: rowsOf(1, 120).map(row => row.id) }, reconciliation: null });
  });
  const run = await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'ready-for-review',
    deliverable: { title: 'September books', sections: [] } as never, renderedText: 'Draft.',
    checks: [{ check: 'house-style', passed: true, detail: 'Fine.' }],
    playbookChecks: [{ playbook: 'ca-firm', check: 'statement-match', outcome: 'not-run', detail: 'not run: no statements were matched to the books in this run.' }],
    harness: harness({
      phase: 'done', uploadIds: ['upload_bank'], workReceiptIds: ['work_1'],
      toolCalls: [
        read({ target: 'f1', part: 'rows' }, { table: 'f1', rows: rowsOf(1, 60) }),
        read({ target: 'f1', part: 'rows', from: 'r61' }, { table: 'f1', rows: rowsOf(61, 120) }),
      ],
    }),
  } as Partial<DeliveryRunRecord>);
  const detail = await call<RunDetail>(env, 'venture.runs.get', { runId: run.id });
  const gather = detail.steps.find(step => step.id === 'gather')!;
  assert.deepEqual(gather.coverage, { done: 120, total: 130, unit: 'rows', verb: 'read', complete: false, line: '120 of 130 rows read' });
  const work = detail.steps.find(step => step.id === 'work')!;
  assert.deepEqual(work.evidence, [{ kind: 'work-receipt', id: 'work_1', label: '120 of 130 rows used. Money out adds up to INR 41,250.00.' }]);
  const verify = detail.steps.find(step => step.id === 'verify')!;
  assert.deepEqual(verify.notRun, [{ id: 'ca-firm:statement-match', line: 'Not run: no statements were matched to the books in this run.' }]);
  assert.equal(detail.report?.result, 'partial', 'a result is partial unless coverage is complete');
  assert.equal(detail.report?.coverage?.line, '120 of 130 rows read');
  assert.equal(detail.report?.review.complete, false);
  assert.equal(detail.report?.review.line, 'Review incomplete: this is not a review.');
  assert.equal(detail.report?.verdict, null, 'nothing failed, but not everything ran: no PASS');
  // The list of runs carries none of this weight: only the run's own sheet does.
  const listed = await call<{ runs: Record<string, unknown>[] }>(env, 'venture.runs.list', {});
  assert.ok(listed.runs.every(item => !('report' in item) && !('coverage' in item)));
  // venture.work.get leads with the same fraction.
  const receipt = await delivery['venture.work.get']!(env.deps, owner, { id: 'work_1' }) as WorkReceiptRecord & { coverage?: { line: string } };
  assert.equal(receipt.coverage?.line, '120 of 130 rows used');
});

test('coverage counts only what the agent saw: a result shown as a preview, whole or past the batch of its turn, marks nothing', () => {
  const wide = (from: number, to: number, cell: string) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `r${from + i}`, Text: cell }));
  // One result over the single-result limit is shown to the agent as its start only.
  const huge = read({ target: 'f1', part: 'rows' }, { table: 'f1', rows: wide(1, 60, 'x'.repeat(Math.ceil(PREVIEW_LIMIT_CHARS / 50))) });
  assert.equal(readCoverage([BANK], [huge])!.coverage.done, 0, 'a previewed result is not read');
  // Two results in one turn past the batch: the larger is previewed; one in another turn is seen whole.
  const big = read({ target: 'f1', part: 'rows' }, { table: 'f1', rows: wide(1, 60, 'y'.repeat(300)) }, true, 2);
  const bigger = read({ target: 'f1', part: 'rows', from: 'r61' }, { table: 'f1', rows: wide(61, 120, 'z'.repeat(360)) }, true, 2);
  assert.ok(JSON.stringify(bigger.envelope).length < PREVIEW_LIMIT_CHARS && JSON.stringify([big.envelope, bigger.envelope]).length > BATCH_CHARS, 'each fits alone; together they pass the batch');
  const later = read({ target: 'f1', part: 'rows', from: 'r121' }, { table: 'f1', rows: rowsOf(121, 130) }, true, 3);
  assert.deepEqual(readCoverage([BANK], [big, bigger, later])!.files.map(item => item.line), ['70 of 130 rows read']);
});

test('a PDF page whose text the read cut short is not marked read', () => {
  const pdf = read({ target: 'f1', part: 'pages' }, { file: 'f1', pages: [{ page: 1, text: 'short' }, { page: 2, text: 'p'.repeat(6000) }], amounts: [], dates: [] });
  assert.deepEqual(readMarks(pdf, [BILLS]), [{ target: 'upload_bills', ids: ['p1'], total: 2 }]);
  assert.equal(readCoverage([BILLS], [pdf])!.coverage.line, '1 of 2 pages read');
});

test('through the real files.read: rows, a transcript and a PDF, its stored answer fed to readMarks', async () => {
  const LONG = file('upload_long', 'long.pdf', 'pdf', '%PDF-1.7 long');
  const files = [BANK, TALK, LONG];
  const helper = { async run(name: string) { assert.equal(name, 'pdf.extract'); return { result: { pages: [{ page: 1, text: 'Total 120.00' }, { page: 2, text: 'q'.repeat(9000) }], coverage: 'Text extraction only.' } }; } };
  const env = { deps: { host: 'test', services: { helper } }, files, tables: [], receipts: [], currency: 'INR', dateOrder: 'DMY' } as unknown as ToolEnv;
  const spec = toolSpec('files.read')!;
  const stored = async (input: Record<string, unknown>) => read(input, (await spec.run(env, input)).result);
  const calls = [
    await stored({ target: 'f1', part: 'rows' }),
    await stored({ target: 'f1', part: 'sample' }),
    await stored({ target: 'f1', part: 'columns' }),
    await stored({ target: 'f2', part: 'pages' }),
    await stored({ target: 'f3', part: 'pages' }),
  ];
  assert.deepEqual(calls.map(item => readMarks(item, files).map(mark => [mark.target, mark.ids.length, mark.total ?? null])), [
    [['upload_bank', 60, null]], [['upload_bank', 5, null]], [], [['upload_talk', 12, null]], [['upload_long', 1, 2]],
  ]);
  assert.deepEqual(readCoverage(files, calls)!.files.map(item => item.line), ['60 of 130 rows read', '12 of 12 lines read', '1 of 2 pages read']);
});
