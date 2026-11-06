// D11a task 10: one receipt format for the engine and UI test runs (scripts/receipt.mjs). Both bench scripts write it
// beside their own fields; perf-budgets reads it. The bench and ui-bench fixture runs are checked in their own tests
// (benchmark-sharding, ui-bench-d2); this file checks the format, the two row readers and the timing reporter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_RECEIPT_FORMAT, nodeTimingRows, readTestReceipt, receiptSeconds, testReceipt, vitestRows } from '../../scripts/receipt.mjs';
import timings from '../../scripts/test-timing-reporter.mjs';

const row = (file: string, ms: number, pass: number, fail = 0, skip = 0) => ({ file, ms, tests: pass + fail + skip, pass, fail, skip });

test('testReceipt keeps the files sorted and adds up the totals', () => {
  const receipt = testReceipt({ tool: 'engine-tests', startedAt: '2026-11-06T10:00:00.000Z', finishedAt: '2026-11-06T10:01:00.000Z', shard: { index: 1, total: 3 },
    files: [row('platform/tests/b.test.ts', 250, 2, 1), row('platform/tests/a.test.ts', 1000, 4, 0, 1)] });
  assert.deepEqual(receipt, {
    format: TEST_RECEIPT_FORMAT, tool: 'engine-tests', startedAt: '2026-11-06T10:00:00.000Z', finishedAt: '2026-11-06T10:01:00.000Z', shard: { index: 1, total: 3 },
    files: [row('platform/tests/a.test.ts', 1000, 4, 0, 1), row('platform/tests/b.test.ts', 250, 2, 1)],
    totals: { files: 2, ms: 1250, tests: 8, pass: 6, fail: 1, skip: 1 },
  });
  assert.equal(TEST_RECEIPT_FORMAT, 'chausar.test-receipt.v1');
  assert.deepEqual(testReceipt({ tool: 'ui-tests', startedAt: 'a', finishedAt: 'b', files: [] }).shard, null, 'no shard is null');
});

test('testReceipt refuses a row whose counts do not add up, a negative time or a repeated file', () => {
  const base = { tool: 'ui-tests', startedAt: 'a', finishedAt: 'b' };
  assert.throws(() => testReceipt({ ...base, files: [{ file: 'x', ms: 1, tests: 3, pass: 1, fail: 0, skip: 0 }] }), /x: tests must equal pass \+ fail \+ skip/);
  assert.throws(() => testReceipt({ ...base, files: [row('x', -1, 1)] }), /x: ms/);
  assert.throws(() => testReceipt({ ...base, files: [row('x', 1, 1), row('x', 2, 1)] }), /x is listed twice/);
  assert.throws(() => testReceipt({ ...base, tool: '', files: [] }), /tool/);
});

test('readTestReceipt reads the common part of either receipt, and refuses one without it', () => {
  const engine = { schema: 'chausar.factory-bench.v1', passed: true, ...testReceipt({ tool: 'engine-tests', startedAt: 'a', finishedAt: 'b', files: [row('f', 5, 1)] }) };
  assert.deepEqual(readTestReceipt(engine).totals, { files: 1, ms: 5, tests: 1, pass: 1, fail: 0, skip: 0 });
  assert.throws(() => readTestReceipt({ schema: 'chausar.factory-bench.v1', fileTimings: {} }), /not a chausar\.test-receipt\.v1 receipt/);
  assert.throws(() => readTestReceipt({ ...engine, totals: { ...engine.totals, pass: 9 } }), /totals/);
});

test('receiptSeconds gives seconds per file from the new format, else from an older bench receipt\'s fileTimings', () => {
  assert.deepEqual(receiptSeconds(testReceipt({ tool: 'engine-tests', startedAt: 'a', finishedAt: 'b', files: [row('f', 31500, 1)] })), { f: 31.5 });
  assert.deepEqual(receiptSeconds({ schema: 'chausar.factory-bench.v1', fileTimings: { g: 2 } }), { g: 2 });
  assert.deepEqual(receiptSeconds({ schema: 'chausar.ui-tests.v1' }), {});
});

test('nodeTimingRows turns the timing reporter lines into rows with repository paths', () => {
  const lines = [JSON.stringify({ file: 'C:\\repo\\platform\\tests\\a.test.ts', ms: 12.6, tests: 3, pass: 2, fail: 0, skip: 1 }), '',
    JSON.stringify({ file: 'C:\\repo\\platform\\tests\\old.test.ts', ms: 4 })].join('\n');
  const toPath = (file: string) => file.replace('C:\\repo\\', '').replaceAll('\\', '/');
  assert.deepEqual(nodeTimingRows(lines, toPath), [row('platform/tests/a.test.ts', 13, 2, 0, 1), row('platform/tests/old.test.ts', 4, 0)]);
});

test('vitestRows reads the per-file results of vitest\'s JSON report', () => {
  const report = { testResults: [
    { name: '/repo/app/ui/tests/b.test.tsx', startTime: 1000, endTime: 1250.4, assertionResults: [{ status: 'passed' }, { status: 'failed' }] },
    { name: '/repo/app/ui/tests/a.test.ts', startTime: 10, endTime: 20, assertionResults: [{ status: 'passed' }, { status: 'pending' }, { status: 'todo' }, { status: 'skipped' }] },
  ] };
  assert.deepEqual(vitestRows(report, (file: string) => file.replace('/repo/', '')), [row('app/ui/tests/a.test.ts', 10, 1, 0, 3), row('app/ui/tests/b.test.tsx', 250, 1, 1)]);
  assert.deepEqual(vitestRows({ numTotalTests: 0 }, (file: string) => file), [], 'a report without testResults gives no rows');
});

test('the timing reporter counts each file\'s top-level tests: pass, fail, and skip (skip and todo)', async () => {
  const event = (type: string, file: string, nesting: number, duration: number, extra = {}) => ({ type, data: { file, nesting, details: { duration_ms: duration }, ...extra } });
  async function* source() {
    yield event('test:pass', '/r/a.test.ts', 0, 5);
    yield event('test:pass', '/r/a.test.ts', 1, 3); // a subtest: not counted
    yield event('test:fail', '/r/a.test.ts', 0, 2);
    yield event('test:pass', '/r/a.test.ts', 0, 0.5, { skip: 'later' });
    yield event('test:pass', '/r/b.test.ts', 0, 1, { todo: true });
    yield { type: 'test:diagnostic', data: { message: 'x' } };
  }
  const out: string[] = [];
  for await (const line of timings(source())) out.push(line);
  assert.deepEqual(out.map(line => JSON.parse(line)), [
    { file: '/r/a.test.ts', ms: 7.5, tests: 3, pass: 1, fail: 1, skip: 1 },
    { file: '/r/b.test.ts', ms: 1, tests: 1, pass: 0, fail: 0, skip: 1 },
  ]);
});
