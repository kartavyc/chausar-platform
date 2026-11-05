// D2 task 13: scripts/perf-budgets.mjs measures what exists, compares each number with its budget plus tolerance and
// writes a receipt. Stand-in measures (CHAUSAR_PERF_STAND_IN, read by that script only) keep this test fast; the real
// measures run nightly.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/perf-budgets.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

type Entry = { name: string; status: 'pass' | 'over' | 'no-budget' | 'not-measured'; value: number | null; budget: number | null; limit: number | null; suggestedBudget?: number; reason?: string; files?: string[] };

async function fixture(t: TestContext, budgets: Record<string, unknown>, standIn: Record<string, number>, timings?: Record<string, number>) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-perf-budgets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'budgets.json'), JSON.stringify(budgets));
  await writeFile(join(directory, 'stand-in.json'), JSON.stringify(standIn));
  await writeFile(join(directory, 'tiers.json'), JSON.stringify({ heavy: ['platform/tests/known-heavy.test.ts'], isolated: [] }));
  await mkdir(join(directory, 'receipts', 'shard-1'), { recursive: true });
  if (timings) await writeFile(join(directory, 'receipts', 'shard-1', 'factory-bench.json'), JSON.stringify({ schema: 'chausar.factory-bench.v1', fileTimings: timings }));
  const result = spawnSync(process.execPath, [SCRIPT, '--budgets', join(directory, 'budgets.json'), '--tiers', join(directory, 'tiers.json'),
    '--timings', join(directory, 'receipts'), '--output', join(directory, 'receipt.json')],
  { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 60_000, env: { ...process.env, CHAUSAR_PERF_STAND_IN: join(directory, 'stand-in.json') } });
  const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8').catch(() => 'null'));
  const entry = (name: string): Entry => receipt.entries.find((item: Entry) => item.name === name);
  return { result, receipt, entry };
}

const budget = (value: number | null, unit = 'ms') => ({ budget: value, unit, tolerancePercent: 15, measuredOn: value === null ? null : '2026-11-05' });

test('a measure over its budget plus tolerance fails; one inside the tolerance passes', async t => {
  const f = await fixture(t, { 'engine-cold-import-ms': budget(1000), 'ui-entry-chunk-bytes': budget(500_000, 'bytes') },
    { 'engine-cold-import-ms': 1151, 'ui-entry-chunk-bytes': 574_999 });
  assert.equal(f.result.status, 1, f.result.stdout + f.result.stderr);
  assert.equal(f.entry('engine-cold-import-ms').status, 'over');
  assert.equal(f.entry('engine-cold-import-ms').limit, 1150);
  assert.equal(f.entry('ui-entry-chunk-bytes').status, 'pass');
  assert.match(f.result.stdout, /engine-cold-import-ms: 1151 ms is over its budget of 1000 ms plus 15% \(1150 ms\)/);
  assert.equal(f.receipt.passed, false);
  assert.equal(f.receipt.schema, 'chausar.perf-budgets.v1');
});

test('every measure inside its budget passes', async t => {
  const f = await fixture(t, { 'engine-cold-import-ms': budget(1000), 'vault-commit-ms-1k': budget(40) }, { 'engine-cold-import-ms': 900, 'vault-commit-ms-1k': 46 });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.equal(f.receipt.passed, true);
  assert.deepEqual(f.receipt.entries.map((entry: Entry) => entry.status), ['pass', 'pass']);
});

test('an unmeasured entry is reported as not measured with what it waits on, never as passing a number', async t => {
  const f = await fixture(t, { 'installer-bytes': { budget: null, unit: 'bytes', tolerancePercent: 15, measuredOn: null, measured: false, waitsOn: 'D5 and D7' } }, {});
  assert.equal(f.result.status, 0);
  const entry = f.entry('installer-bytes');
  assert.equal(entry.status, 'not-measured');
  assert.equal(entry.value, null);
  assert.match(entry.reason!, /D5 and D7/);
  assert.match(f.result.stdout, /installer-bytes: not measured \(waits on D5 and D7\)/);
});

test('a measure with no budget yet records the number and a suggested budget (plus 15%) without failing', async t => {
  const f = await fixture(t, { 'vault-commit-ms-10k': budget(null) }, { 'vault-commit-ms-10k': 200 });
  assert.equal(f.result.status, 0);
  assert.equal(f.entry('vault-commit-ms-10k').status, 'no-budget');
  assert.equal(f.entry('vault-commit-ms-10k').value, 200);
  assert.equal(f.entry('vault-commit-ms-10k').suggestedBudget, 230);
});

test('a test file over 30 s that is not in the heavy tier fails by name; a known heavy one does not', async t => {
  const f = await fixture(t, { 'slow-test-files': { budget: 0, unit: 'files', tolerancePercent: 0, measuredOn: '2026-11-05' } }, {},
    { 'platform/tests/known-heavy.test.ts': 90, 'platform/tests/new-slow.test.ts': 31.5, 'platform/tests/quick.test.ts': 2 });
  assert.equal(f.result.status, 1);
  assert.equal(f.entry('slow-test-files').status, 'over');
  assert.deepEqual(f.entry('slow-test-files').files, ['platform/tests/new-slow.test.ts']);
  assert.match(f.result.stdout, /platform\/tests\/new-slow\.test\.ts takes 31\.5 s and is not in the heavy tier/);
});

test('with no engine receipts the slow-file check is not measured, and an unknown budget name is refused', async t => {
  const none = await fixture(t, { 'slow-test-files': { budget: 0, unit: 'files', tolerancePercent: 0, measuredOn: '2026-11-05' } }, {});
  assert.equal(none.entry('slow-test-files').status, 'not-measured');
  const unknown = await fixture(t, { 'made-up-ms': budget(10) }, {});
  assert.notEqual(unknown.result.status, 0);
  assert.match(unknown.result.stderr, /made-up-ms is not a measure perf-budgets\.mjs knows/);
});

test('the real budgets file names every measure, the two waiting ones as not measured', async () => {
  const budgets = JSON.parse(await readFile(new URL('baselines/perf-budgets.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(budgets).sort(), ['engine-cold-import-ms', 'idle-memory-bytes', 'installer-bytes', 'slow-test-files',
    'ui-entry-chunk-bytes', 'vault-commit-ms-10k', 'vault-commit-ms-1k']);
  for (const name of ['installer-bytes', 'idle-memory-bytes']) {
    assert.equal(budgets[name].measured, false, name);
    assert.equal(budgets[name].budget, null, name);
    assert.ok(budgets[name].waitsOn.length > 5, name);
  }
  for (const entry of Object.values(budgets) as { tolerancePercent: number }[]) assert.ok(entry.tolerancePercent === 15 || entry.tolerancePercent === 0);
});
