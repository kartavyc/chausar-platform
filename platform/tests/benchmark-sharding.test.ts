import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test, { type TestContext } from 'node:test';

interface BenchmarkReport {
  schema: string;
  command: string[];
  scope: string;
  shard: { index: number; total: number } | null;
  fullSuite: boolean;
  testFiles: { pattern: string; discovered: string[]; inventorySha256: string; selection: string; selectedFiles?: string[];
    plan?: { name: string; ordinaryShardTotal: number; dedicatedFile: string; groups: { index: number; files: string[] }[] } };
  passed: boolean;
  exitCode: number | null;
  productionQualified: boolean;
  timeout: boolean;
  outputTruncated: boolean;
  counts: { tests: number; pass: number; fail: number; cancelled: number; skipped: number; todo: number };
  qualification: { testRunComplete: boolean; specificationCoverageCertified: boolean };
}

// Copy the real CLI into a tiny synthetic repository. Every invocation runs actual
// Node test discovery, sharding and receipt generation, without the full vault suite.
const independentFixtureFile = 'platform/tests/workspace-activation-independent-public-acceptance.test.ts';

async function fixture(t: TestContext, failing = false, incomplete = false, fiveShard = false, ordinaryFiles = 6) {
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
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  async function writeFixture(file: string, index: number, options = '') {
    await writeFile(join(directory, file),
      `import test from 'node:test';\nimport { appendFile } from 'node:fs/promises';\n` +
      `test('fixture-file-${index}'${options}, async () => {\n` +
      `  await appendFile(new URL('../../executed.jsonl', import.meta.url), '${index}\\n');\n` +
      (failing ? `  throw new Error('Deliberate fixture failure');\n` : '') +
      `});\n`);
  }
  for (let index = 1; index <= ordinaryFiles; index++) {
    const options = incomplete && index === 1 ? ", { skip: 'Declared fixture skip' }" : incomplete && index === 2 ? ", { todo: 'Declared fixture todo' }" : '';
    await writeFixture(`platform/tests/fixture-${index}.test.ts`, index, options);
  }
  if (fiveShard) await writeFixture(independentFixtureFile, ordinaryFiles + 1);
  return {
    directory,
    invoke(args: string[]) {
      const env = { ...process.env };
      // This is an independent CLI/test runner, not another test inside this file's
      // worker. Node's inherited worker marker would suppress its TAP summary.
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, [join(directory, 'scripts', 'bench.mjs'), ...args],
        { cwd: directory, env, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.signal, null, result.stderr);
      return result;
    },
    async report(output = 'results/factory-bench.json'): Promise<BenchmarkReport> {
      return JSON.parse(await readFile(join(directory, output), 'utf8'));
    },
    async executed(): Promise<number[]> {
      return (await readFile(join(directory, 'executed.jsonl'), 'utf8')).trim().split('\n').map(Number);
    },
  };
}

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
  assert.ok(report.command.includes('--test-concurrency=1'));
  assert.equal(report.testFiles.pattern, 'platform/tests/*.test.ts');
  assert.deepEqual(report.testFiles.discovered, discovered);
  assert.equal(report.testFiles.inventorySha256, createHash('sha256').update(JSON.stringify(report.testFiles.discovered)).digest('hex'));
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
  assert.deepEqual(report.command, ['node', '--test', '--test-reporter=tap', '--test-concurrency=1', 'platform/tests/*.test.ts']);
  assert.deepEqual((await f.executed()).sort(), [1, 2, 3, 4, 5, 6]);
});

test('actual Node shards are disjoint and their union covers every fixture test file', async t => {
  const f = await fixture(t), covered: number[][] = [], inventories: BenchmarkReport['testFiles'][] = [];
  for (const index of [1, 2]) {
    await writeFile(join(f.directory, 'executed.jsonl'), '');
    const output = `results/shard-${index}.json`;
    const args = index === 1 ? ['--shard=1/2', '--output', output] : ['--output=' + output, '--shard', '2/2'];
    const result = f.invoke(args);
    assert.equal(result.status, 0, JSON.stringify(await f.report(output)));
    const report = await f.report(output);
    assertCompleteRun(report, 3);
    assert.equal(report.fullSuite, false);
    assert.deepEqual(report.shard, { index, total: 2 });
    assert.equal(report.testFiles.selection, 'node-test-shard');
    inventories.push(report.testFiles);
    assert.equal(report.scope, `Repository open tests (shard ${index}/2)`);
    assert.deepEqual(report.command, ['node', '--test', '--test-reporter=tap', '--test-concurrency=1', `--test-shard=${index}/2`, 'platform/tests/*.test.ts']);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.fullSuite, false);
    assert.deepEqual(summary.shard, report.shard);
    covered.push(await f.executed());
  }
  assert.equal(covered[0].filter(value => covered[1].includes(value)).length, 0);
  assert.deepEqual(inventories[0], inventories[1], 'Complementary receipts must record the same complete discovery universe.');
  assert.deepEqual(covered.flat().sort(), [1, 2, 3, 4, 5, 6]);
  await writeFile(join(f.directory, 'executed.jsonl'), '');
  assert.equal(f.invoke(['--shard=1/2', '--output=results/repeat.json']).status, 0);
  assert.deepEqual(await f.executed(), covered[0], 'Shard file assignment must be deterministic.');
});

test('actual four Node shards retain exact inventories and deterministic disjoint coverage of all fixture files', async t => {
  const f = await fixture(t), covered: number[][] = [], inventories: BenchmarkReport['testFiles'][] = [];
  for (const index of [1, 2, 3, 4]) {
    await writeFile(join(f.directory, 'executed.jsonl'), '');
    const output = `results/four-shard-${index}.json`;
    const args = index % 2 ? [`--shard=${index}/4`, '--output', output] : ['--output=' + output, '--shard', `${index}/4`];
    const result = f.invoke(args);
    assert.equal(result.status, 0, JSON.stringify(await f.report(output)));
    const executed = await f.executed(), report = await f.report(output);
    assert.ok(executed.length > 0, 'Every complementary fixture shard must execute test files.');
    assert.equal(new Set(executed).size, executed.length, 'A shard must execute each selected file once.');
    assertCompleteRun(report, executed.length);
    assert.equal(report.fullSuite, false);
    assert.deepEqual(report.shard, { index, total: 4 });
    assert.equal(report.testFiles.selection, 'node-test-shard');
    assert.equal(report.scope, `Repository open tests (shard ${index}/4)`);
    assert.deepEqual(report.command, ['node', '--test', '--test-reporter=tap', '--test-concurrency=1', `--test-shard=${index}/4`, 'platform/tests/*.test.ts']);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.fullSuite, false);
    assert.deepEqual(summary.shard, report.shard);
    for (const previous of covered) assert.equal(executed.filter(value => previous.includes(value)).length, 0);
    covered.push(executed); inventories.push(report.testFiles);
  }
  assert.deepEqual(covered.flat().sort((left, right) => left - right), [1, 2, 3, 4, 5, 6]);
  for (const inventory of inventories) assert.deepEqual(inventory, inventories[0], 'All four receipts must retain the exact same complete discovery universe.');
  for (const index of [1, 2, 3, 4]) {
    await writeFile(join(f.directory, 'executed.jsonl'), '');
    const output = `results/four-repeat-${index}.json`;
    assert.equal(f.invoke([`--shard=${index}/4`, '--output', output]).status, 0);
    const report = await f.report(output);
    assertCompleteRun(report, covered[index - 1].length);
    assert.deepEqual(report.testFiles, inventories[index - 1]);
    assert.deepEqual(report.shard, { index, total: 4 });
    assert.equal(report.fullSuite, false);
    assert.deepEqual(await f.executed(), covered[index - 1], 'Every four-shard file assignment must repeat deterministically.');
  }
});

test('five planned shards preserve the four ordinary groups and execute the independent file once with deterministic complete coverage', async t => {
  const f = await fixture(t, false, false, true), covered: number[][] = [], inventories: BenchmarkReport['testFiles'][] = [];
  const ordinaryFiles = Array.from({ length: 6 }, (_, index) => `platform/tests/fixture-${index + 1}.test.ts`);
  const discovered = [...ordinaryFiles, independentFixtureFile].sort();
  const groups = [...Array.from({ length: 4 }, (_, index) => ordinaryFiles.filter((_, position) => position % 4 === index)), [independentFixtureFile]];
  for (const index of [1, 2, 3, 4, 5]) {
    await writeFile(join(f.directory, 'executed.jsonl'), '');
    const output = `results/five-shard-${index}.json`;
    const args = index % 2 ? [`--shard=${index}/5`, '--output', output] : ['--output=' + output, '--shard', `${index}/5`];
    const result = f.invoke(args), report = await f.report(output), executed = await f.executed();
    assert.equal(result.status, 0, JSON.stringify(report));
    assertCompleteRun(report, groups[index - 1].length, discovered);
    assert.equal(report.fullSuite, false);
    assert.deepEqual(report.shard, { index, total: 5 });
    assert.equal(report.scope, `Repository open tests (shard ${index}/5)`);
    assert.equal(report.testFiles.selection, 'explicit-stable-five-shard-plan');
    assert.deepEqual(report.testFiles.selectedFiles, groups[index - 1]);
    assert.deepEqual(report.testFiles.plan, { name: 'four-stable-groups-plus-independent-activation-v1', ordinaryShardTotal: 4,
      dedicatedFile: independentFixtureFile, groups: groups.map((files, position) => ({ index: position + 1, files })) });
    assert.deepEqual(report.command, ['node', '--test', '--test-reporter=tap', '--test-concurrency=1', ...groups[index - 1]]);
    assert.equal(report.command.some(argument => argument.startsWith('--test-shard=')), false);
    assert.equal(new Set(executed).size, executed.length);
    for (const previous of covered) assert.equal(executed.filter(value => previous.includes(value)).length, 0);
    assert.deepEqual(JSON.parse(result.stdout.trim()).shard, report.shard);
    covered.push(executed); inventories.push(report.testFiles);
  }
  assert.deepEqual(covered, [[1, 5], [2, 6], [3], [4], [7]]);
  assert.deepEqual(covered.flat().sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7]);
  for (const inventory of inventories) {
    assert.deepEqual(inventory.discovered, discovered);
    assert.equal(inventory.inventorySha256, inventories[0].inventorySha256);
    assert.deepEqual(inventory.plan, inventories[0].plan);
  }
  assert.deepEqual(inventories[0].plan!.groups.flatMap(group => group.files).sort(), discovered);
  for (const index of [1, 2, 3, 4, 5]) {
    await writeFile(join(f.directory, 'executed.jsonl'), '');
    const output = `results/five-repeat-${index}.json`;
    assert.equal(f.invoke([`--shard=${index}/5`, '--output', output]).status, 0);
    const report = await f.report(output);
    assertCompleteRun(report, groups[index - 1].length, discovered);
    assert.deepEqual(report.testFiles, inventories[index - 1]);
    assert.deepEqual(await f.executed(), covered[index - 1]);
  }
});

test('a missing independent file or empty complementary group refuses the five-way plan before spawning tests', async t => {
  for (const f of [await fixture(t), await fixture(t, false, false, true, 3)]) {
    for (const index of [1, 2, 3, 4, 5]) {
      const result = f.invoke([`--shard=${index}/5`]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Five-shard plan requires the dedicated independent activation test file|Five-shard plan must provide nonempty, disjoint groups/);
    }
    await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(f.directory, 'results', 'factory-bench.json')), { code: 'ENOENT' });
  }
});

test('invalid, duplicated and unknown shard options refuse before spawning fixture tests', async t => {
  const f = await fixture(t);
  for (const args of [
    ['--shard'], ['--shard='], ['--shard', '--output=x.json'],
    ...['0/2', '3/2', '1/0', '1/1', '1/3', '01/2', '+1/2', '1.0/2', '1/02', '1/2/3', ' 1/2', '1/2 ',
      '0/4', '5/4', '01/4', '+1/4', '1.0/4', '1/04', '1/4/4', ' 1/4', '1/4 ',
      '0/5', '6/5', '1/6', '01/5', '+1/5', '1.0/5', '1/05', '1/5/5', ' 1/5', '1/5 '].map(value => ['--shard=' + value]),
    ['--shard=1/2', '--shard=2/2'], ['--shard', '1/2', '--shard', '1/2'],
    ['--shard=1/4', '--shard=4/4'], ['--shard', '3/4', '--shard', '3/4'], ['--shard=1/2', '--shard=1/4'],
    ['--shard=1/5', '--shard=5/5'], ['--shard', '3/5', '--shard', '3/5'], ['--shard=1/4', '--shard=1/5'],
    ['--output=a.json', '--output', 'b.json'], ['--unknown=1/2'], ['--shard=1/2', 'extra'],
  ]) {
    const result = f.invoke(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.match(result.stderr, /Usage: node scripts\/bench\.mjs|Benchmark shard must be exactly/);
  }
  await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.directory, 'results', 'factory-bench.json')), { code: 'ENOENT' });
});

test('output containment and JSON extension checks remain enforced with sharding', async t => {
  const f = await fixture(t);
  for (const output of ['../escape.json', join(f.directory, '..', 'escape.json'), 'results/report.txt', 'results/report.JSON']) {
    const result = f.invoke(['--shard=1/2', '--output', output]);
    assert.notEqual(result.status, 0, output);
    assert.match(result.stderr, /Benchmark output must be a JSON file within this repository/);
  }
  await assert.rejects(readFile(join(f.directory, 'executed.jsonl')), { code: 'ENOENT' });
  // Both historical output option spellings still work without a shard.
  for (const args of [['--output', 'results/separated.json'], ['--output=results/equals.json']]) {
    assert.equal(f.invoke(args).status, 0);
    assertCompleteRun(await f.report(args.length === 2 ? args[1] : args[0].slice(9)), 6);
  }
});

test('a failing fixture shard returns failure and never claims a full-suite result', async t => {
  const f = await fixture(t, true);
  const result = f.invoke(['--shard=2/2']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Repository test failure details \(bounded\):/);
  assert.match(result.stderr, /not ok .*fixture-file-/);
  assert.match(result.stderr, /Deliberate fixture failure/);
  assert.ok(Buffer.byteLength(result.stderr, 'utf8') <= 32 * 1024);
  assert.equal(JSON.parse(result.stdout.trim()).passed, false);
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

test('five planned shards retain failure, skip and todo admission guards', async t => {
  const failing = await fixture(t, true, false, true);
  for (const index of [1, 5]) {
    const output = `results/five-failing-${index}.json`;
    assert.equal(failing.invoke([`--shard=${index}/5`, '--output', output]).status, 1);
    const report = await failing.report(output);
    assert.equal(report.passed, false);
    assert.equal(report.counts.tests, index === 1 ? 2 : 1);
    assert.equal(report.counts.fail, report.counts.tests);
    assert.equal(report.fullSuite, false);
    assert.equal(report.productionQualified, false);
  }
  const incomplete = await fixture(t, false, true, true);
  for (const index of [1, 2]) {
    const output = `results/five-incomplete-${index}.json`;
    assert.equal(incomplete.invoke([`--shard=${index}/5`, '--output', output]).status, 1);
    const report = await incomplete.report(output);
    assert.equal(report.exitCode, 0);
    assert.equal(report.passed, false);
    assert.equal(report.counts.tests, 2);
    assert.equal(report.counts.fail, 0);
    assert.equal(report.counts.skipped + report.counts.todo, 1);
    assert.equal(report.qualification.testRunComplete, false);
    assert.equal(report.fullSuite, false);
  }
});

test('CI requires all five planned shards on both operating systems with ten unique report artifacts', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /shard: \[1, 2, 3, 4, 5\]/);
  assert.match(workflow, /node-version: '24\.13\.1'/);
  assert.match(workflow, /run: node scripts\/bench\.mjs --shard=\$\{\{ matrix\.shard \}\}\/5 --output results\/factory-bench\.json/);
  assert.match(workflow, /name: open-test-report-\$\{\{ matrix\.os \}\}-shard-\$\{\{ matrix\.shard \}\}-of-5/);
  const artifacts = ['ubuntu-latest', 'windows-latest'].flatMap(os => [1, 2, 3, 4, 5].map(shard => `open-test-report-${os}-shard-${shard}-of-5`));
  assert.equal(new Set(artifacts).size, 10);
  const script = await readFile(new URL('../../scripts/bench.mjs', import.meta.url), 'utf8');
  assert.match(script, /10 \* 60 \* 1000/);
  assert.match(script, /16 \* 1024 \* 1024/);
  assert.doesNotMatch(workflow, /continue-on-error: true|--test-name-pattern|--test-skip-pattern/);
});
