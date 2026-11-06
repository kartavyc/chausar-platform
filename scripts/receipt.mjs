// D11: one receipt format for the engine and UI test runs. scripts/bench.mjs and scripts/ui-bench.mjs each write their
// own receipt (counts, command, passed and so on) and carry this common part beside it:
//   { format: 'chausar.test-receipt.v1', tool, startedAt, finishedAt, shard, files: [{ file, ms, tests, pass, fail, skip }], totals }
// `skip` counts skipped and todo tests together; `ms` is the sum of the file's top-level test times, rounded.
// scripts/perf-budgets.mjs reads `files` through receiptSeconds, which also reads an older bench receipt's fileTimings.

export const TEST_RECEIPT_FORMAT = 'chausar.test-receipt.v1';
const COUNTS = ['tests', 'pass', 'fail', 'skip'];

function validRow(row) {
  const name = typeof row?.file === 'string' && row.file ? row.file : '(a row with no file)';
  if (name === '(a row with no file)') throw new Error(`${name}: every row names its file.`);
  if (!Number.isSafeInteger(row.ms) || row.ms < 0) throw new Error(`${name}: ms must be a whole number of milliseconds, 0 or more.`);
  for (const key of COUNTS) if (!Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error(`${name}: ${key} must be a count, 0 or more.`);
  if (row.tests !== row.pass + row.fail + row.skip) throw new Error(`${name}: tests must equal pass + fail + skip.`);
  return { file: row.file, ms: row.ms, tests: row.tests, pass: row.pass, fail: row.fail, skip: row.skip };
}

function totalsOf(files) {
  const totals = { files: files.length, ms: 0, tests: 0, pass: 0, fail: 0, skip: 0 };
  for (const row of files) for (const key of ['ms', ...COUNTS]) totals[key] += row[key];
  return totals;
}

/** The common part of a test receipt, from one run's per-file rows. */
export function testReceipt({ tool, startedAt, finishedAt, shard = null, files }) {
  if (typeof tool !== 'string' || !tool) throw new Error('A test receipt names its tool.');
  if (typeof startedAt !== 'string' || typeof finishedAt !== 'string') throw new Error('A test receipt has startedAt and finishedAt.');
  const rows = files.map(validRow).sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
  for (let index = 1; index < rows.length; index++) if (rows[index].file === rows[index - 1].file) throw new Error(`${rows[index].file} is listed twice.`);
  return { format: TEST_RECEIPT_FORMAT, tool, startedAt, finishedAt, shard: shard ?? null, files: rows, totals: totalsOf(rows) };
}

/** The common part of a receipt that carries it; refuses a receipt without it or with totals that do not add up. */
export function readTestReceipt(receipt) {
  if (receipt?.format !== TEST_RECEIPT_FORMAT || !Array.isArray(receipt.files)) throw new Error(`This is not a ${TEST_RECEIPT_FORMAT} receipt.`);
  const common = testReceipt(receipt);
  if (JSON.stringify(common.totals) !== JSON.stringify(receipt.totals)) throw new Error('The receipt totals do not match its files.');
  return common;
}

/** Seconds per file from a receipt: the common format's files, else an older bench receipt's fileTimings. */
export function receiptSeconds(receipt) {
  if (receipt?.format === TEST_RECEIPT_FORMAT && Array.isArray(receipt.files)) return Object.fromEntries(readTestReceipt(receipt).files.map(row => [row.file, row.ms / 1000]));
  if (receipt?.schema === 'chausar.factory-bench.v1' && receipt.fileTimings && typeof receipt.fileTimings === 'object') return { ...receipt.fileTimings };
  return {};
}

/** Rows from scripts/test-timing-reporter.mjs output (one JSON line per file); toPath makes the repository path. */
export function nodeTimingRows(text, toPath) {
  return text.split('\n').filter(line => line.trim()).map(line => {
    const { file, ms, tests = 0, pass = 0, fail = 0, skip = 0 } = JSON.parse(line);
    return { file: toPath(file), ms: Math.round(ms), tests, pass, fail, skip };
  });
}

/** Rows from vitest's JSON report (`--reporter=json`): each file's tests by status and its run time. */
export function vitestRows(report, toPath) {
  if (!Array.isArray(report?.testResults)) return [];
  return report.testResults.map(result => {
    const statuses = (result.assertionResults ?? []).map(assertion => assertion.status);
    const pass = statuses.filter(status => status === 'passed').length, fail = statuses.filter(status => status === 'failed').length;
    const ms = Number.isFinite(result.endTime) && Number.isFinite(result.startTime) ? Math.max(0, Math.round(result.endTime - result.startTime)) : 0;
    return { file: toPath(result.name), ms, tests: statuses.length, pass, fail, skip: statuses.length - pass - fail };
  }).sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
}
