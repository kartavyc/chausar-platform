import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test, { type TestContext } from 'node:test';
import { localDay } from '../runtime/run-root.mjs';
import { readTestReceipt } from '../../scripts/receipt.mjs';

interface BenchmarkReport {
  schema: string;
  command: string[];
  scope: string;
  shard: { index: number; total: number } | null;
  fullSuite: boolean;
  testFiles: { pattern: string; discovered: string[]; inventorySha256: string; selection: string; selectedFiles?: string[];
    plan?: { name: string; weights: string; defaultSeconds: number; groups: { index: number; files: string[]; estimatedSeconds: number }[] } };
  passed: boolean;
  workers: number;
  fileTimings: Record<string, number>;
  tempFreeBytes: number;
  tier: 'fast' | 'heavy' | 'all';
  isolation: 'process' | 'none';
  isolatedCommand: string[] | null;
  exitCode: number | null;
  productionQualified: boolean;
  timeout: boolean;
  outputTruncated: boolean;
  counts: { tests: number; pass: number; fail: number; cancelled: number; skipped: number; todo: number };
  qualification: { testRunComplete: boolean; specificationCoverageCertified: boolean };
}

/** D3: with no --output the receipt lands in the run root, <CHAUSAR_RUN_ROOT>/engine-tests/factory-bench.json. */
const DEFAULT_RECEIPT = 'runs/engine-tests/factory-bench.json';

// Copy the real CLI into a tiny synthetic repository. Every invocation runs actual
// Node test discovery, sharding and receipt generation, without the full vault suite.
const GIB = 1024 ** 3;

async function fixture(t: TestContext, failing = false, incomplete = false, ordinaryFiles = 6, sleeps: number[] = []) {
  const temporaryRoot = await realpath(resolve(tmpdir()));
  if (process.platform === 'win32') assert.match(temporaryRoot, /^C:\\/i);
  const directory = await mkdtemp(join(temporaryRoot, 'chausar-bench-sharding-'));
  t.after(async () => {
    const target = await realpath(directory), child = relative(temporaryRoot, target);
    assert.ok(child && !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep) && !child.includes(sep));
    assert.ok(basename(target).startsWith('chausar-bench-sharding-'));
    await rm(target, { recursive: true, force: true });
  });
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory, 'platform', 'tests'), { recursive: true });
  await writeFile(join(directory, 'scripts', 'bench.mjs'), await readFile(new URL('../../scripts/bench.mjs', import.meta.url)));
  await writeFile(join(directory, 'scripts', 'test-timing-reporter.mjs'), await readFile(new URL('../../scripts/test-timing-reporter.mjs', import.meta.url)).catch(() => ''));
  await writeFile(join(directory, 'scripts', 'receipt.mjs'), await readFile(new URL('../../scripts/receipt.mjs', import.meta.url)));
  // D3: the run-root rules the bench imports, at the same place beside it.
  await mkdir(join(directory, 'platform', 'runtime'), { recursive: true });
  await writeFile(join(directory, 'platform', 'runtime', 'run-root.mjs'), await readFile(new URL('../runtime/run-root.mjs', import.meta.url)));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  async function writeFixture(file: string, index: number, options = '') {
    await writeFile(join(directory, file),
      `import test from 'node:test';\nimport { appendFile } from 'node:fs/promises';\n` +
      `test('fixture-file-${index}'${options}, async () => {\n` +
      (sleeps[index - 1] ? `  await new Promise(done => setTimeout(done, ${sleeps[index - 1]}));\n` : '') +
      `  await appendFile(new URL('../../executed.jsonl', import.meta.url), '${index}\\n');\n` +
      (failing ? `  throw new Error('Deliberate fixture failure');\n` : '') +
      `});\n`);
  }
  for (let index = 1; index <= ordinaryFiles; index++) {
    const options = incomplete && index === 1 ? ", { skip: 'Declared fixture skip' }" : incomplete && index === 2 ? ", { todo: 'Declared fixture todo' }" : '';
    await writeFixture(`platform/tests/fixture-${index}.test.ts`, index, options);
  }
  return {
    directory,
    invoke(args: string[], extra: Record<string, string | undefined> = {}) {
      // D2: CI and the free space are set per call, so the default worker count and the space check are deterministic.
      const env: Record<string, string | undefined> = { ...process.env, CHAUSAR_BENCH_FREE_BYTES: String(100 * GIB) };
      delete env.CI; delete env.CHAUSAR_ALLOW_REPO_DATA;
      // D3: the run root is a folder inside this fixture unless a test says otherwise.
      env.CHAUSAR_RUN_ROOT = join(directory, 'runs');
      Object.assign(env, extra);
      // This is an independent CLI/test runner, not another test inside this file's
      // worker. Node's inherited worker marker would suppress its TAP summary.
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, [join(directory, 'scripts', 'bench.mjs'), ...args],
        { cwd: directory, env, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.signal, null, result.stderr);
      return result;
    },
    async report(output = DEFAULT_RECEIPT): Promise<BenchmarkReport> {
      return JSON.parse(await readFile(join(directory, output), 'utf8'));
    },
    async tiers(tiers: { heavy?: string[]; isolated?: string[] }) {
      await writeFile(join(directory, 'platform', 'tests', 'tiers.json'), JSON.stringify({ heavy: [], isolated: [], ...tiers }));
    },
    async weights(weights: Record<string, number>) {
      await writeFile(join(directory, 'platform', 'tests', 'test-weights.json'), JSON.stringify(weights));
    },
    async executed(): Promise<number[]> {
      // D2: files run side by side, so the order they finish in varies; which files ran is what is compared.
      return (await readFile(join(directory, 'executed.jsonl'), 'utf8')).trim().split('\n').map(Number).sort((left, right) => left - right);
    },
  };
}

/** The command without its reporter options, which task 3's own test checks once. */
const withoutReporters = (command: string[]) => command.filter(part => !part.startsWith('--test-reporter'));

function assertCompleteRun(report: BenchmarkReport, tests: number,
  discovered = Array.from({ length: 6 }, (_, index) => `platform/tests/fixture-${index + 1}.test.ts`)) {
  assert.equal(report.schema, 'chausar.factory-bench.v1');
  assert.deepEqual(report.counts, { tests, suites: 0, pass: tests, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.equal(report.passed, true);
  assert.equal(report.timeout, false);
  assert.equal(report.outputTruncated, false);
  assert.equal(report.qualification.testRunComplete, true);
  assert.equal(report.qualification.specificationCoverageCertified, false);
  assert.equal(report.productionQualified, false);
  assert.ok(Number.isSafeInteger(report.workers) && report.workers >= 1);
  assert.ok(report.command.includes(`--test-concurrency=${report.workers}`));
  assert.equal(report.tempFreeBytes, 100 * GIB);
  assert.equal(report.testFiles.pattern, 'platform/tests/*.test.ts');
  assert.deepEqual(report.testFiles.discovered, discovered);
  assert.equal(report.testFiles.inventorySha256, createHash('sha256').update(JSON.stringify(report.testFiles.discovered)).digest('hex'));
  // D11: the common receipt part (scripts/receipt.mjs) sits beside the bench's own fields, one row per file that ran.
  const common = readTestReceipt(report);
  assert.equal(common.tool, 'engine-tests');
  assert.equal(common.startedAt, (report as any).startedAt);
  assert.deepEqual(common.shard, report.shard);
  assert.equal(common.totals.tests, tests);
  assert.equal(common.totals.pass, tests);
  assert.deepEqual(common.files.map(row => row.file), Object.keys(report.fileTimings).sort());
}

test('unsharded benchmark retains its default command, output and complete open-suite receipt', async t => {
  const f = await fixture(t);
  assert.equal(f.invoke([]).status, 0, JSON.stringify(await f.report()));
  const report = await f.report();
  assertCompleteRun(report, 6);
  assert.equal(report.scope, 'Repository open tests');
  assert.equal(report.shard, null);
  assert.equal(report.fullSuite, true);
  assert.equal(report.testFiles.selection, 'all-discovered-files');
  assert.deepEqual(withoutReporters(report.command), ['node', '--test', `--test-concurrency=${report.workers}`, 'platform/tests/*.test.ts']);
  assert.deepEqual((await f.executed()).sort(), [1, 2, 3, 4, 5, 6]);
});

test('D2: the worker count reaches the command and the receipt; CI defaults to 3, a laptop to its cores less one', async t => {
  const f = await fixture(t);
  assert.equal(f.invoke(['--workers=2', '--output', 'results/two.json']).status, 0);
  const two = await f.report('results/two.json');
  assertCompleteRun(two, 6);
  assert.equal(two.workers, 2);
  assert.deepEqual(withoutReporters(two.command), ['node', '--test', '--test-concurrency=2', 'platform/tests/*.test.ts']);
  assert.equal(f.invoke(['--output=results/ci.json'], { CI: '1' }).status, 0);
  assert.equal((await f.report('results/ci.json')).workers, 3);
  assert.equal(f.invoke(['--output=results/local.json']).status, 0);
  assert.equal((await f.report('results/local.json')).workers, Math.max(1, availableParallelism() - 1));
  for (const bad of ['--workers=0', '--workers=x', '--workers=1.5', '--workers=65', '--workers']) {
    const result = f.invoke([bad, '--output=results/bad.json']);
    assert.notEqual(result.status, 0, bad);
    assert.match(result.stderr, /Usage: node scripts\/bench\.mjs|Workers must be a whole number from 1 to 64/);
  }
});

test('D2: the bench checks the temp folder first: under 2 GB it refuses before any test, under 6 GB it runs with 2 workers', async t => {
  const f = await fixture(t);
  const refused = f.invoke(['--workers=4'], { CHAUSAR_BENCH_FREE_BYTES: String(1 * GIB) });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Free space on .+ is 1\.0 GB\. The engine tests need at least 2 GB in the temp folder\./);
  await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.directory, DEFAULT_RECEIPT)), { code: 'ENOENT' });
  const capped = f.invoke(['--workers=5'], { CHAUSAR_BENCH_FREE_BYTES: String(4 * GIB) });
  assert.equal(capped.status, 0, capped.stderr);
  assert.match(capped.stderr, /Free space on .+ is 4\.0 GB, so the engine tests run with 2 workers\./);
  const report = await f.report();
  assert.equal(report.workers, 2);
  assert.equal(report.tempFreeBytes, 4 * GIB);
  assert.ok(report.command.includes('--test-concurrency=2'));
  assert.deepEqual((await f.executed()).sort(), [1, 2, 3, 4, 5, 6]);
});

test('D2: the receipt keeps each file time from a second reporter, beside the TAP text', async t => {
  const f = await fixture(t, false, false, 3, [600, 50, 300]);
  assert.equal(f.invoke(['--workers=1']).status, 0);
  const report = await f.report();
  assertCompleteRun(report, 3, ['platform/tests/fixture-1.test.ts', 'platform/tests/fixture-2.test.ts', 'platform/tests/fixture-3.test.ts']);
  assert.deepEqual(report.command.slice(1, 6), ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout',
    '--test-reporter=./scripts/test-timing-reporter.mjs', `--test-reporter-destination=${join(f.directory, 'runs', 'engine-tests', 'factory-bench.timings.jsonl')}`]);
  const timings = report.fileTimings;
  assert.deepEqual(Object.keys(timings).sort(), ['platform/tests/fixture-1.test.ts', 'platform/tests/fixture-2.test.ts', 'platform/tests/fixture-3.test.ts']);
  const bySpeed = Object.entries(timings).sort((left, right) => left[1] - right[1]).map(([file]) => file);
  assert.deepEqual(bySpeed, ['platform/tests/fixture-2.test.ts', 'platform/tests/fixture-3.test.ts', 'platform/tests/fixture-1.test.ts']);
  assert.ok(timings['platform/tests/fixture-1.test.ts'] >= 0.5, JSON.stringify(timings));
  await assert.rejects(readFile(join(f.directory, 'runs', 'engine-tests', 'factory-bench.timings.jsonl')), { code: 'ENOENT' }, 'the timings file is folded into the receipt');
});

// D2 task 4: one time-balanced plan replaces the 2, 4, 5 and 6-shard plans. Every shard count from 1 to 8 places the
// files heaviest first on the lightest shard, using platform/tests/test-weights.json (a missing file counts 1 s).
const files = (count: number) => Array.from({ length: count }, (_, index) => `platform/tests/fixture-${index + 1}.test.ts`);
const FIXTURE_WEIGHTS = { 'platform/tests/fixture-1.test.ts': 2, 'platform/tests/fixture-2.test.ts': 9, 'platform/tests/fixture-3.test.ts': 4,
  'platform/tests/fixture-4.test.ts': 3, 'platform/tests/fixture-5.test.ts': 6, 'platform/tests/fixture-6.test.ts': 5, 'platform/tests/gone.test.ts': 40 };

test('D2: every shard count from 1 to 8 covers each discovered file exactly once, and the plan repeats', async t => {
  const f = await fixture(t, false, false, 7);
  await f.weights(FIXTURE_WEIGHTS);
  for (let total = 1; total <= 7; total++) {
    const output = `results/plan-${total}.json`;
    assert.equal(f.invoke([`--shard=1/${total}`, '--workers=1', '--output', output]).status, 0, String(total));
    const report = await f.report(output);
    assert.equal(report.testFiles.selection, 'time-balanced-plan');
    const plan = report.testFiles.plan!;
    assert.equal(plan.name, 'time-balanced-v1');
    assert.equal(plan.groups.length, total);
    assert.deepEqual(plan.groups.flatMap(group => group.files).sort(), files(7), String(total));
    assert.deepEqual(report.testFiles.selectedFiles, plan.groups[0].files);
    assert.deepEqual(withoutReporters(report.command), ['node', '--test', '--test-concurrency=1', ...plan.groups[0].files]);
    assert.equal(f.invoke([`--shard=1/${total}`, '--workers=1', '--output', `results/again-${total}.json`]).status, 0);
    assert.deepEqual((await f.report(`results/again-${total}.json`)).testFiles.plan, plan, 'the plan is the same every run');
  }
});

test('D2: three shards run disjoint files whose union is the whole inventory, balanced by weight', async t => {
  const f = await fixture(t, false, false, 7);
  await f.weights(FIXTURE_WEIGHTS);
  const covered: number[][] = [];
  for (const index of [1, 2, 3]) {
    await writeFile(join(f.directory, 'executed.jsonl'), '');
    const output = `results/three-${index}.json`;
    const result = f.invoke(index % 2 ? [`--shard=${index}/3`, '--output', output] : ['--output=' + output, '--shard', `${index}/3`]);
    const report = await f.report(output);
    assert.equal(result.status, 0, JSON.stringify(report));
    assertCompleteRun(report, report.testFiles.selectedFiles!.length, files(7));
    assert.deepEqual(report.shard, { index, total: 3 });
    assert.equal(report.fullSuite, false);
    assert.equal(report.scope, `Repository open tests (shard ${index}/3)`);
    assert.deepEqual(JSON.parse(result.stdout.trim()).shard, report.shard);
    covered.push(await f.executed());
  }
  for (const [index, list] of covered.entries()) for (const other of covered.slice(index + 1)) assert.equal(list.filter(value => other.includes(value)).length, 0);
  assert.deepEqual(covered.flat().sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7]);
  // Weights 9, 6, 5, 4, 3, 2 and an unweighted 1: placed heaviest first, the shards hold 11, 10 and 9 seconds.
  const plan = (await f.report('results/three-1.json')).testFiles.plan!;
  assert.deepEqual(plan.groups.map(group => group.estimatedSeconds), [11, 10, 9]);
  const mean = plan.groups.reduce((sum, group) => sum + group.estimatedSeconds, 0) / plan.groups.length;
  const heaviest = plan.groups.reduce((best, group) => (group.estimatedSeconds > best.estimatedSeconds ? group : best));
  assert.ok(heaviest.estimatedSeconds <= 1.2 * mean || heaviest.files.length === 1);
  assert.ok(plan.groups.some(group => group.files.includes('platform/tests/fixture-7.test.ts')), 'a file with no weight still lands on a shard');
});

test('D2: a heavy file sits alone and the rest stay within 1.2 times the mean', async t => {
  const f = await fixture(t, false, false, 7);
  await f.weights({ ...FIXTURE_WEIGHTS, 'platform/tests/fixture-2.test.ts': 100 });
  assert.equal(f.invoke(['--shard=2/3', '--workers=1']).status, 0);
  const plan = (await f.report()).testFiles.plan!;
  assert.deepEqual(plan.groups[0].files, ['platform/tests/fixture-2.test.ts']);
  const rest = plan.groups.slice(1).map(group => group.estimatedSeconds);
  const mean = rest.reduce((sum, value) => sum + value, 0) / rest.length;
  for (const seconds of rest) assert.ok(seconds <= 1.2 * mean, JSON.stringify(plan.groups));
});

test('D2: --list prints the files and the plan and runs nothing, even with little free space', async t => {
  const f = await fixture(t, false, false, 7);
  await f.weights(FIXTURE_WEIGHTS);
  const result = f.invoke(['--shard=2/3', '--list'], { CHAUSAR_BENCH_FREE_BYTES: '0' });
  assert.equal(result.status, 0, result.stderr);
  const listed = JSON.parse(result.stdout);
  assert.deepEqual(listed.shard, { index: 2, total: 3 });
  assert.deepEqual(listed.plan.map((group: { estimatedSeconds: number }) => group.estimatedSeconds), [11, 10, 9]);
  assert.equal(listed.files.length, listed.plan[1].files);
  await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.directory, DEFAULT_RECEIPT)), { code: 'ENOENT' });
});

test('D2: more shards than files refuses the empty shard before spawning tests', async t => {
  const f = await fixture(t, false, false, 3);
  const result = f.invoke(['--shard=5/5']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Shard 5\/5 has no test files: there are fewer test files than shards\./);
  await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
});

test('D2: --write-weights turns the receipts file times into the weights file, sorted, in tenths of a second', async t => {
  const f = await fixture(t, false, false, 3, [300, 50, 150]);
  assert.equal(f.invoke(['--shard=1/2', '--workers=1', '--output', 'results/a.json']).status, 0);
  assert.equal(f.invoke(['--shard=2/2', '--workers=1', '--output', 'results/b.json']).status, 0);
  const written = f.invoke(['--write-weights=results/a.json,results/b.json']);
  assert.equal(written.status, 0, written.stderr);
  const weights = JSON.parse(await readFile(join(f.directory, 'platform', 'tests', 'test-weights.json'), 'utf8'));
  assert.deepEqual(Object.keys(weights), files(3));
  for (const seconds of Object.values(weights) as number[]) assert.ok(seconds >= 0.1 && Math.round(seconds * 10) === seconds * 10);
  assert.ok(weights['platform/tests/fixture-1.test.ts'] > weights['platform/tests/fixture-2.test.ts']);
  for (const args of [['--write-weights=../outside.json'], ['--write-weights=results/a.json', '--shard=1/2'], ['--write-weights=results/missing.json']]) {
    assert.notEqual(f.invoke(args).status, 0, JSON.stringify(args));
  }
});

// D2 task 5: platform/tests/tiers.json names the heavy files; --tier=fast runs every other file, --tier=heavy only those.
test('D2: --tier=fast skips the heavy files, --tier=heavy runs only them, and both shard over their own files', async t => {
  const f = await fixture(t, false, false, 6);
  await f.tiers({ heavy: ['platform/tests/fixture-2.test.ts', 'platform/tests/fixture-5.test.ts'] });
  assert.equal(f.invoke(['--tier=fast', '--output=results/fast.json']).status, 0);
  const fast = await f.report('results/fast.json');
  assertCompleteRun(fast, 4);
  assert.equal(fast.tier, 'fast');
  assert.equal(fast.testFiles.selection, 'tier');
  assert.deepEqual(fast.testFiles.selectedFiles, ['platform/tests/fixture-1.test.ts', 'platform/tests/fixture-3.test.ts', 'platform/tests/fixture-4.test.ts', 'platform/tests/fixture-6.test.ts']);
  assert.deepEqual(await f.executed(), [1, 3, 4, 6]);
  await writeFile(join(f.directory, 'executed.jsonl'), '');
  assert.equal(f.invoke(['--tier', 'heavy', '--output=results/heavy.json']).status, 0);
  assert.equal((await f.report('results/heavy.json')).tier, 'heavy');
  assert.deepEqual(await f.executed(), [2, 5]);
  await writeFile(join(f.directory, 'executed.jsonl'), '');
  assert.equal(f.invoke(['--tier=fast', '--shard=2/2', '--output=results/fast-2.json']).status, 0);
  const shardTwo = await f.report('results/fast-2.json');
  assert.deepEqual(shardTwo.testFiles.plan!.groups.flatMap(group => group.files).sort(), fast.testFiles.selectedFiles);
  assert.deepEqual(await f.executed(), shardTwo.testFiles.selectedFiles!.map(file => Number(/fixture-(\d)/.exec(file)![1])));
  assert.equal(f.invoke(['--output=results/all.json']).status, 0);
  assert.equal((await f.report('results/all.json')).tier, 'all');
  assert.equal((await f.report('results/all.json')).testFiles.selection, 'all-discovered-files');
  assert.notEqual(f.invoke(['--tier=slow']).status, 0);
});

test('D2: a heavy entry naming a missing file fails the run with its name before any test', async t => {
  const f = await fixture(t);
  await f.tiers({ heavy: ['platform/tests/fixture-1.test.ts', 'platform/tests/renamed-away.test.ts'] });
  const result = f.invoke(['--tier=fast']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /platform\/tests\/tiers\.json names a test file that does not exist: platform\/tests\/renamed-away\.test\.ts/);
  await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
});

// D2 task 6: --isolation=none runs the files that share no process state in one process; the files in tiers.json
// `isolated` (they set process.env, chdir, assign globalThis or mock timers) still get a process each, in the same receipt.
test('D2: --isolation=none reaches the command for the unlisted files only; the isolated ones keep their own processes', async t => {
  const f = await fixture(t, false, false, 4);
  await f.tiers({ isolated: ['platform/tests/fixture-3.test.ts'] });
  assert.equal(f.invoke(['--isolation=none', '--workers=2']).status, 0);
  const report = await f.report();
  assertCompleteRun(report, 4, files(4));
  assert.equal(report.isolation, 'none');
  assert.deepEqual(withoutReporters(report.command), ['node', '--test', '--test-isolation=none', '--test-concurrency=2',
    'platform/tests/fixture-1.test.ts', 'platform/tests/fixture-2.test.ts', 'platform/tests/fixture-4.test.ts']);
  assert.deepEqual(withoutReporters(report.isolatedCommand!), ['node', '--test', '--test-concurrency=2', 'platform/tests/fixture-3.test.ts']);
  assert.deepEqual(Object.keys(report.fileTimings).sort(), files(4));
  assert.deepEqual(await f.executed(), [1, 2, 3, 4]);
  await writeFile(join(f.directory, 'executed.jsonl'), '');
  assert.equal(f.invoke(['--output=results/plain.json']).status, 0);
  const plain = await f.report('results/plain.json');
  assert.equal(plain.isolation, 'process');
  assert.equal(plain.isolatedCommand, null);
  assert.equal(plain.command.some(part => part.startsWith('--test-isolation')), false);
  assert.notEqual(f.invoke(['--isolation=thread']).status, 0);
});

test('D2: --isolation=none counts a failure in either process and refuses an isolated entry naming a missing file', async t => {
  const failing = await fixture(t, true, false, 3);
  await failing.tiers({ isolated: ['platform/tests/fixture-1.test.ts'] });
  assert.equal(failing.invoke(['--isolation=none']).status, 1);
  const report = await failing.report();
  assert.equal(report.passed, false);
  assert.equal(report.counts.tests, 3);
  assert.equal(report.counts.fail, 3);
  const missing = await fixture(t);
  await missing.tiers({ isolated: ['platform/tests/gone.test.ts'] });
  const result = missing.invoke(['--isolation=none']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /platform\/tests\/tiers\.json names a test file that does not exist: platform\/tests\/gone\.test\.ts/);
});

test('invalid, duplicated and unknown shard options refuse before spawning fixture tests', async t => {
  const f = await fixture(t);
  for (const args of [
    ['--shard'], ['--shard='], ['--shard', '--output=x.json'],
    ...['0/2', '3/2', '1/0', '1/9', '9/9', '01/2', '+1/2', '1.0/2', '1/02', '1/2/3', ' 1/2', '1/2 ', '2/1', '10/10'].map(value => ['--shard=' + value]),
    ['--shard=1/2', '--shard=2/2'], ['--shard', '1/2', '--shard', '1/2'], ['--shard=1/2', '--shard=1/4'],
    ['--output=a.json', '--output', 'b.json'], ['--unknown=1/2'], ['--shard=1/2', 'extra'],
  ]) {
    const result = f.invoke(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.match(result.stderr, /Usage: node scripts\/bench\.mjs|Benchmark shard must be I\/N/);
  }
  await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.directory, DEFAULT_RECEIPT)), { code: 'ENOENT' });
});

// D3: the receipt goes to the run root by default; --output takes any .json path outside the checkout.
test('D3: the default receipt lands in CHAUSAR_RUN_ROOT, else the temp folder under chausar-runs, dated by the local day', async t => {
  const f = await fixture(t);
  const run = join(f.directory, 'elsewhere');
  const rooted = f.invoke(['--shard=1/2'], { CHAUSAR_RUN_ROOT: run });
  assert.equal(rooted.status, 0, rooted.stderr);
  assert.equal(JSON.parse(rooted.stdout.trim()).report, join(run, 'engine-tests', 'factory-bench.json').replaceAll('\\', '/'));
  assert.deepEqual((await f.report(join('elsewhere', 'engine-tests', 'factory-bench.json'))).shard, { index: 1, total: 2 });
  // No CHAUSAR_RUN_ROOT: the temp folder (pointed into the fixture here) under chausar-runs/<YYYY-MM-DD>-engine-tests.
  const temp = join(f.directory, 'temp');
  const before = localDay(new Date());
  const dated = f.invoke(['--shard=2/2'], { CHAUSAR_RUN_ROOT: undefined, TEMP: temp, TMP: temp, TMPDIR: temp });
  assert.equal(dated.status, 0, dated.stderr);
  const days = [...new Set([before, localDay(new Date())])];
  const found = await Promise.any(days.map(day => readFile(join(temp, 'chausar-runs', `${day}-engine-tests`, 'factory-bench.json'), 'utf8')));
  assert.deepEqual(JSON.parse(found).shard, { index: 2, total: 2 });
  await assert.rejects(readFile(join(f.directory, 'results', 'factory-bench.json')), { code: 'ENOENT' }, 'never results/ beside the code');
});

test('D3: an absolute --output outside the checkout works; the extension is checked; both spellings still work', async t => {
  const f = await fixture(t);
  const outside = await mkdtemp(join(await realpath(resolve(tmpdir())), 'chausar-bench-out-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  assert.equal(f.invoke(['--shard=1/2', '--output', join(outside, 'one.json')]).status, 0);
  assert.equal(JSON.parse(await readFile(join(outside, 'one.json'), 'utf8')).passed, true);
  for (const output of ['results/report.txt', 'results/report.JSON', join(outside, 'two.txt')]) {
    const result = f.invoke(['--shard=1/2', '--output', output]);
    assert.notEqual(result.status, 0, output);
    assert.match(result.stderr, /The output must be a \.json file\./);
  }
  for (const args of [['--output', 'results/separated.json'], ['--output=results/equals.json']]) {
    assert.equal(f.invoke(args).status, 0);
    assertCompleteRun(await f.report(args.length === 2 ? args[1] : args[0].slice(9)), 6);
  }
});

test('D3: inside a checkout (package.json chausar-desktop beside .git) an output or a run root there is refused before any test', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'package.json'), JSON.stringify({ name: 'chausar-desktop', type: 'module' }));
  await mkdir(join(f.directory, '.git'));
  for (const [args, extra] of [
    [['--output', 'results/inside.json'], {}],
    [['--output', join(f.directory, 'deep', 'inside.json')], {}],
    [[], { CHAUSAR_RUN_ROOT: join(f.directory, 'results') }],
  ] as [string[], Record<string, string>][]) {
    const result = f.invoke(args, extra);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.match(result.stderr, /Chausar keeps its data outside the code folder\./);
  }
  await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.directory, 'results', 'inside.json')), { code: 'ENOENT' });
  // The weights file is source: --write-weights is the one write inside the checkout, from receipts outside it.
  const outside = await mkdtemp(join(await realpath(resolve(tmpdir())), 'chausar-bench-out-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  assert.equal(f.invoke(['--workers=1', '--output', join(outside, 'receipt.json')], { CHAUSAR_RUN_ROOT: outside }).status, 0);
  assert.equal(f.invoke([`--write-weights=${join(outside, 'receipt.json')}`], { CHAUSAR_RUN_ROOT: outside }).status, 0);
  assert.equal(Object.keys(JSON.parse(await readFile(join(f.directory, 'platform', 'tests', 'test-weights.json'), 'utf8'))).length, 6);
});

test('a failing fixture shard returns failure and never claims a full-suite result', async t => {
  const f = await fixture(t, true);
  assert.equal(f.invoke(['--shard=2/2']).status, 1);
  const report = await f.report();
  assert.equal(report.passed, false);
  assert.equal(report.counts.tests, 3);
  assert.equal(report.counts.fail, 3);
  assert.equal(report.fullSuite, false);
  assert.equal(report.productionQualified, false);
  assert.deepEqual(report.shard, { index: 2, total: 2 });
});

test('shards containing skipped or todo tests fail complete-run admission even when Node exits zero', async t => {
  const f = await fixture(t, false, true), incompleteCounts: number[] = [];
  for (const index of [1, 2]) {
    const output = `results/incomplete-${index}.json`;
    assert.equal(f.invoke([`--shard=${index}/2`, '--output', output]).status, 1);
    const report = await f.report(output);
    assert.equal(report.passed, false);
    assert.equal(report.exitCode, 0, 'Node completed normally; incomplete counts must still fail benchmark admission.');
    assert.equal(report.counts.fail, 0);
    assert.equal(report.counts.cancelled, 0);
    assert.equal(report.counts.tests, 3);
    assert.equal(report.counts.skipped + report.counts.todo, 1);
    assert.equal(report.qualification.testRunComplete, false);
    assert.equal(report.fullSuite, false);
    incompleteCounts.push(report.counts.skipped, report.counts.todo);
  }
  assert.equal(incompleteCounts.reduce((sum, value) => sum + value, 0), 2);
});

// D1: the two ci.yml shape tests moved to ci-workflow-d1.test.ts, so later batches change one file.
