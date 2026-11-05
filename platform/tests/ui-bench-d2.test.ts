// D2 task 7: scripts/ui-bench.mjs passes --shard=I/N to vitest, names the raw report per shard and records the shard on
// its receipt. A stand-in vitest records the arguments it got and writes a fixed JSON report, so nothing real runs.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STAND_IN = `import { writeFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(new URL('../../args.jsonl', import.meta.url), JSON.stringify(args) + '\\n');
const out = args.find(arg => arg.startsWith('--outputFile.json=')).slice('--outputFile.json='.length);
writeFileSync(out, JSON.stringify({ numTotalTestSuites: 2, numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 }));
`;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ui-bench-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory, 'node_modules', 'vitest'), { recursive: true });
  await writeFile(join(directory, 'scripts', 'ui-bench.mjs'), await readFile(new URL('../../scripts/ui-bench.mjs', import.meta.url)));
  await writeFile(join(directory, 'node_modules', 'vitest', 'vitest.mjs'), STAND_IN);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  return {
    directory,
    invoke(args: string[]) {
      return spawnSync(process.execPath, [join(directory, 'scripts', 'ui-bench.mjs'), ...args], { cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    },
    async calls(): Promise<string[][]> {
      return (await readFile(join(directory, 'args.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    },
    async receipt(path = 'results/ui-tests.json') { return JSON.parse(await readFile(join(directory, path), 'utf8')); },
  };
}

test('--shard=2/3 reaches vitest, names the raw report for the shard and is kept on the receipt', async t => {
  const f = await fixture(t);
  const result = f.invoke(['--shard=2/3', '--output', 'results/ui-2.json']);
  assert.equal(result.status, 0, result.stderr);
  const [args] = await f.calls();
  assert.ok(args.includes('--shard=2/3'), JSON.stringify(args));
  assert.ok(args.some(arg => /^--outputFile\.json=.*ui-tests\.shard-2-of-3\.vitest\.json$/.test(arg.replaceAll('\\', '/'))), JSON.stringify(args));
  const receipt = await f.receipt('results/ui-2.json');
  assert.deepEqual(receipt.shard, { index: 2, total: 3 });
  assert.equal(receipt.passed, true);
  assert.ok(receipt.command.includes('--shard=2/3'));
  assert.deepEqual(receipt.counts, { suites: 2, tests: 3, pass: 3, fail: 0, skipped: 0, todo: 0 });
});

test('without a shard nothing changes: one raw report, shard null', async t => {
  const f = await fixture(t);
  assert.equal(f.invoke([]).status, 0);
  const [args] = await f.calls();
  assert.equal(args.some(arg => arg.startsWith('--shard')), false);
  assert.ok(args.some(arg => arg.replaceAll('\\', '/').endsWith('results/ui-tests.vitest.json')));
  assert.equal((await f.receipt()).shard, null);
  assert.equal(f.invoke(['--output=results/equals.json', '--shard', '1/2']).status, 0);
  assert.deepEqual((await f.receipt('results/equals.json')).shard, { index: 1, total: 2 });
});

test('a bad shard or option refuses before vitest starts', async t => {
  const f = await fixture(t);
  for (const args of [['--shard=0/3'], ['--shard=4/3'], ['--shard=1/9'], ['--shard=1/03'], ['--shard'], ['--shard=1/2', '--shard=2/2'], ['--unknown'], ['--output', '../x.json']]) {
    const result = f.invoke(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
  }
  assert.deepEqual(await f.calls(), []);
});
