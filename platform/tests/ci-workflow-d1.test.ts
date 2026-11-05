// D1: the shape of .github/workflows/ci.yml (one lint job first, npm ci from the committed lock); D2: the matrix and the fast lane.
// The two older workflow tests moved here from benchmark-sharding.test.ts, so later batches change one file.
// Regular expressions on the YAML prove the shape only; the first push shows whether GitHub accepts the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// Line endings are normalised: a Windows checkout (core.autocrlf) reads the YAML with CRLF.
const workflow = (await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

/** The text of one top-level job: from its `  name:` line to the next job or the trailing comments. */
function job(name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:$`, 'm'));
  assert.ok(start >= 0, `the ${name} job exists`);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/^ {2}[a-z][\w-]*:$|^ {2}#/m);
  return end < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + end);
}

/** The run lines of a job, in order. */
const runs = (text: string) => [...text.matchAll(/^\s+run: (.+)$/gm)].map(match => match[1].trim());

test('CI runs on every push (a branch push gets the fast lane), on pull requests (docs-only ones skipped) and by hand', () => {
  const on = workflow.slice(workflow.search(/^on:$/m), workflow.search(/^permissions:$/m));
  assert.match(on, /^ {2}push:$/m);
  assert.doesNotMatch(on, /branches:/, 'D2: every branch push runs, the heavy jobs only on main');
  assert.match(on, /^ {2}pull_request:\n {4}paths-ignore:\n {6}- 'docs\/\*\*'\n {6}- '\*\*\/\*\.md'$/m);
  assert.match(on, /^ {2}workflow_dispatch:$/m);
  assert.match(workflow, /^concurrency:\n {2}group: open-verification-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true$/m, 'an older run on the same ref is cancelled');
});

test('one lint job on Ubuntu installs from the lock, then checks for tracked data, syntax, both typechecks and the notices, in that order', () => {
  const lint = job('lint');
  assert.match(lint, /runs-on: ubuntu-latest/);
  assert.match(lint, /node-version: '24\.13\.1'/);
  assert.doesNotMatch(lint, /^ {4}if:/m, 'lint runs on every event');
  assert.deepEqual(runs(lint), [
    'npm ci --ignore-scripts --no-audit --no-fund',
    'node scripts/check-clean-tree.mjs --tracked',
    'node scripts/check.mjs',
    'npm run typecheck',
    'npm run typecheck:ui',
    'node scripts/third-party-notices.mjs --check',
  ]);
});

// D3: each test job points the run root at the runner's temp folder before its tests and checks the checkout last.
const RUN_ROOT = 'echo "CHAUSAR_RUN_ROOT=$RUNNER_TEMP/chausar" >> "$GITHUB_ENV"';
const AFTER_RUN = 'node scripts/check-clean-tree.mjs --after-run';

const HEAVY_IF = "    if: github.event_name != 'push' || github.ref == 'refs/heads/main'";

test('D2: verify, ui and build wait for lint, skip a branch push, and never repeat lint\'s checks', () => {
  for (const name of ['verify', 'ui', 'build']) {
    const text = job(name);
    assert.match(text, /^ {4}needs: lint$/m, name);
    assert.ok(text.split('\n').includes(HEAVY_IF), `${name} carries the heavy-job condition`);
    assert.doesNotMatch(text, /scripts\/check\.mjs|npm run typecheck/, name);
  }
});

test('D2: a branch push runs only the fast lane: Ubuntu, the fast engine tier in three shards of 3 workers, the changed UI tests', () => {
  const fast = job('fast');
  assert.match(fast, /^ {4}needs: lint$/m);
  assert.ok(fast.split('\n').includes("    if: github.event_name == 'push' && github.ref != 'refs/heads/main'"));
  assert.match(fast, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(fast, /windows/);
  assert.match(fast, /shard: \[1, 2, 3\]$/m);
  assert.match(fast, /fetch-depth: 0/, 'vitest --changed compares with origin/main, so the history is fetched');
  assert.deepEqual(runs(fast), [
    'npm ci --ignore-scripts --no-audit --no-fund',
    RUN_ROOT,
    'node scripts/bench.mjs --tier=fast --shard=${{ matrix.shard }}/3 --workers=3',
    'node node_modules/vitest/vitest.mjs run --config app/ui/vitest.config.ts --changed origin/main --passWithNoTests',
    AFTER_RUN,
  ]);
  assert.match(fast, /if: matrix\.shard == 1\n {8}run: node node_modules\/vitest/, 'the changed UI tests run once');
});

test('every install in every workflow is npm ci, and ci.yml caches npm from the lock', async () => {
  const folder = new URL('../../.github/workflows/', import.meta.url);
  for (const name of await readdir(folder)) {
    const text = await readFile(new URL(name, folder), 'utf8');
    assert.doesNotMatch(text, /npm install\b/, name);
  }
  assert.doesNotMatch(workflow, /package-manager-cache: false/);
  const setups = workflow.match(/uses: actions\/setup-node@v6\n\s+with:\n(?:\s+[\w-]+: .+\n)+/g) ?? [];
  assert.equal(setups.length, 5, 'lint, verify, ui, build and fast each set up Node');
  for (const setup of setups) assert.match(setup, /cache: npm/);
  assert.equal(runs(workflow).filter(line => line.startsWith('npm ci')).length, 5);
});

test('verify keeps Node\'s compile cache between runs, keyed on the lock and the Node version', () => {
  const verify = job('verify');
  assert.match(verify, /^ {8}env:\n {10}NODE_COMPILE_CACHE: \$\{\{ runner\.temp \}\}\/node-cc\n {8}run: node scripts\/bench\.mjs /m);
  assert.match(verify, /uses: actions\/cache@v4\n\s+with:\n\s+path: \$\{\{ runner\.temp \}\}\/node-cc\n\s+key: node-cc-\$\{\{ runner\.os \}\}-24\.13\.1-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/);
});

test('D2: CI runs three time-balanced engine shards with 3 workers on both operating systems, six unique report artifacts', async () => {
  const verify = job('verify');
  assert.match(verify, /fail-fast: false/);
  assert.match(verify, /os: \[ubuntu-latest, windows-latest\]/, 'Windows stays: it is where owners are');
  assert.match(verify, /shard: \[1, 2, 3\]$/m);
  assert.match(verify, /node-version: '24\.13\.1'/);
  assert.match(verify, /run: node scripts\/bench\.mjs --shard=\$\{\{ matrix\.shard \}\}\/3 --workers=3$/m);
  assert.match(verify, /name: open-test-report-\$\{\{ matrix\.os \}\}-shard-\$\{\{ matrix\.shard \}\}-of-3$/m);
  const artifacts = ['ubuntu-latest', 'windows-latest'].flatMap(os => [1, 2, 3].map(shard => `open-test-report-${os}-shard-${shard}-of-3`));
  assert.equal(new Set(artifacts).size, 6);
  const script = await readFile(new URL('../../scripts/bench.mjs', import.meta.url), 'utf8');
  assert.match(script, /20 \* 60 \* 1000/);
  assert.match(verify, /timeout-minutes: 25/);
  assert.match(script, /16 \* 1024 \* 1024/);
  assert.doesNotMatch(workflow, /continue-on-error: true|--test-name-pattern|--test-skip-pattern/);
});

test('D2: CI runs the Ink frontend in three shards on both operating systems, every test with no skips; the build is its own job', async () => {
  const ui = job('ui');
  assert.match(ui, /timeout-minutes: 25/);
  assert.match(ui, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(ui, /shard: \[1, 2, 3\]$/m);
  assert.match(ui, /node-version: '24\.13\.1'/);
  assert.match(ui, /run: node scripts\/ui-bench\.mjs --shard=\$\{\{ matrix\.shard \}\}\/3$/m);
  assert.doesNotMatch(ui, /build:ui/);
  assert.match(ui, /name: ui-test-report-\$\{\{ matrix\.os \}\}-shard-\$\{\{ matrix\.shard \}\}-of-3$/m);
  const build = job('build');
  assert.match(build, /os: \[ubuntu-latest, windows-latest\]/);
  assert.deepEqual(runs(build), ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run build:ui']);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
  const script = await readFile(new URL('../../scripts/ui-bench.mjs', import.meta.url), 'utf8');
  assert.match(script, /counts\.fail === 0 && counts\.skipped === 0 && counts\.todo === 0/);
  assert.match(script, /counts\.tests > 0/);
});

// D1 fix: GitHub refused ci.yml because a job-level `env:` used `runner.temp`. Workflow-level keys and every job key
// except `steps` and `outputs` are evaluated before a runner exists, so `runner`, `steps` and `job` are not allowed
// there (and `matrix`, `strategy` and `needs` are not allowed at workflow level). Comments are ignored.
function contextsBeforeARunner(text: string): string[] {
  const found: string[] = [];
  let top = '', jobKey = '';
  for (const [index, line] of text.replace(/\r\n/g, '\n').split('\n').entries()) {
    if (/^\s*(#|$)/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) { top = line.split(':', 1)[0]; jobKey = ''; }
    if (top === 'jobs' && indent === 4) jobKey = line.trim().split(':', 1)[0];
    const expressions = [...line.matchAll(/\$\{\{(.*?)\}\}/g)].map(match => match[1]);
    if (/^\s*if: /.test(line) && !line.includes('${{')) expressions.push(line.trim().slice(4));
    const banned = top !== 'jobs' ? /\b(runner|steps|job|matrix|strategy|needs)\.\w/
      : indent >= 4 && !['steps', 'outputs'].includes(jobKey) ? /\b(runner|steps|job)\.\w/ : null;
    if (!banned) continue;
    for (const expression of expressions) if (banned.test(expression)) found.push(`${index + 1}: ${line.trim()}`);
  }
  return found;
}

test('no workflow uses runner, steps or job where GitHub evaluates it before a runner exists', async () => {
  const folder = new URL('../../.github/workflows/', import.meta.url);
  for (const name of await readdir(folder)) {
    const text = await readFile(new URL(name, folder), 'utf8');
    assert.deepEqual(contextsBeforeARunner(text), [], name);
  }
  // The scan itself: the refused shape is caught, the same line at step level is allowed.
  assert.equal(contextsBeforeARunner('jobs:\n  a:\n    env:\n      X: ${{ runner.temp }}/x\n').length, 1);
  assert.equal(contextsBeforeARunner('env:\n  X: ${{ runner.temp }}\njobs:\n').length, 1);
  assert.deepEqual(contextsBeforeARunner('jobs:\n  a:\n    steps:\n      - run: x\n        env:\n          X: ${{ runner.temp }}/x\n'), []);
});

// D3: run outputs live in the runner's temp folder, never results/ in the checkout. Each test job sets CHAUSAR_RUN_ROOT
// (a step, since runner.temp is not allowed in a job's env), uploads from there, and ends with the after-run guard,
// which runs even when a test failed.
test('D3: no workflow writes or uploads results/; each ci.yml test job sets the run root first and checks the checkout last', async () => {
  const folder = new URL('../../.github/workflows/', import.meta.url);
  for (const name of await readdir(folder)) assert.doesNotMatch(await readFile(new URL(name, folder), 'utf8'), /results\//, name);
  for (const name of ['verify', 'ui', 'fast']) {
    const text = job(name), lines = runs(text);
    assert.ok(lines.indexOf(RUN_ROOT) > 0 && lines.indexOf(RUN_ROOT) < lines.findIndex(line => line.startsWith('node ')), `${name} sets the run root before its tests`);
    assert.match(text, /- name: Point the run root at the runner's temp folder, outside the checkout\n {8}shell: bash\n/, name);
    assert.equal(lines.at(-1), AFTER_RUN, name);
    assert.match(text, /- name: Check that the run left nothing in the checkout\n {8}if: always\(\)\n {8}run: node scripts\/check-clean-tree\.mjs --after-run\s*$/, name);
  }
  assert.match(job('verify'), /path: \$\{\{ runner\.temp \}\}\/chausar\/engine-tests\/factory-bench\.json$/m);
  assert.match(job('ui'), /path: \$\{\{ runner\.temp \}\}\/chausar\/ui-tests\/ui-tests\.json$/m);
});
