// D1: the shape of .github/workflows/ci.yml (one trigger per change, one lint job first, npm ci from the committed lock).
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

test('CI runs once per change: push only on main, plus pull requests (docs-only ones skipped) and a manual start', () => {
  const on = workflow.slice(workflow.search(/^on:$/m), workflow.search(/^permissions:$/m));
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(on, /^ {2}pull_request:\n {4}paths-ignore:\n {6}- 'docs\/\*\*'\n {6}- '\*\*\/\*\.md'$/m);
  assert.match(on, /^ {2}workflow_dispatch:$/m);
});

test('one lint job on Ubuntu installs from the lock, then checks syntax, both typechecks and the notices, in that order', () => {
  const lint = job('lint');
  assert.match(lint, /runs-on: ubuntu-latest/);
  assert.match(lint, /node-version: '24\.13\.1'/);
  assert.deepEqual(runs(lint), [
    'npm ci --ignore-scripts --no-audit --no-fund',
    'node scripts/check.mjs',
    'npm run typecheck',
    'npm run typecheck:ui',
    'node scripts/third-party-notices.mjs --check',
  ]);
});

test('verify and ui wait for lint and no longer repeat its checks', () => {
  for (const name of ['verify', 'ui']) {
    const text = job(name);
    assert.match(text, /^ {4}needs: lint$/m, name);
    assert.doesNotMatch(text, /scripts\/check\.mjs|npm run typecheck/, name);
  }
});

test('every install in every workflow is npm ci, and ci.yml caches npm from the lock', async () => {
  const folder = new URL('../../.github/workflows/', import.meta.url);
  for (const name of await readdir(folder)) {
    const text = await readFile(new URL(name, folder), 'utf8');
    assert.doesNotMatch(text, /npm install\b/, name);
  }
  assert.doesNotMatch(workflow, /package-manager-cache: false/);
  const setups = workflow.match(/uses: actions\/setup-node@v6\n\s+with:\n(?:\s+[\w-]+: .+\n)+/g) ?? [];
  assert.equal(setups.length, 3, 'lint, verify and ui each set up Node');
  for (const setup of setups) assert.match(setup, /cache: npm/);
  assert.equal(runs(workflow).filter(line => line.startsWith('npm ci')).length, 3);
});

test('verify keeps Node\'s compile cache between runs, keyed on the lock and the Node version', () => {
  const verify = job('verify');
  assert.match(verify, /^ {4}env:\n {6}NODE_COMPILE_CACHE: \$\{\{ runner\.temp \}\}\/node-cc$/m);
  assert.match(verify, /uses: actions\/cache@v4\n\s+with:\n\s+path: \$\{\{ runner\.temp \}\}\/node-cc\n\s+key: node-cc-\$\{\{ runner\.os \}\}-24\.13\.1-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/);
});

test('CI requires all six planned shards on both operating systems with twelve unique report artifacts', async () => {
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /shard: \[1, 2, 3, 4, 5, 6\]/);
  assert.match(workflow, /node-version: '24\.13\.1'/);
  assert.match(workflow, /run: node scripts\/bench\.mjs --shard=\$\{\{ matrix\.shard \}\}\/6 --output results\/factory-bench\.json/);
  assert.match(workflow, /name: open-test-report-\$\{\{ matrix\.os \}\}-shard-\$\{\{ matrix\.shard \}\}-of-6/);
  const artifacts = ['ubuntu-latest', 'windows-latest'].flatMap(os => [1, 2, 3, 4, 5, 6].map(shard => `open-test-report-${os}-shard-${shard}-of-6`));
  assert.equal(new Set(artifacts).size, 12);
  const script = await readFile(new URL('../../scripts/bench.mjs', import.meta.url), 'utf8');
  assert.match(script, /20 \* 60 \* 1000/);
  assert.match(job('verify'), /timeout-minutes: 25/);
  assert.match(script, /16 \* 1024 \* 1024/);
  assert.doesNotMatch(workflow, /continue-on-error: true|--test-name-pattern|--test-skip-pattern/);
});

test('CI runs the Ink frontend on both operating systems: every test with no skips, and the build', async () => {
  const ui = job('ui');
  assert.match(ui, /timeout-minutes: 25/, 'the complete wave-five UI run needs room for install and build');
  assert.match(ui, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(ui, /node-version: '24\.13\.1'/);
  assert.match(ui, /run: node scripts\/ui-bench\.mjs --output results\/ui-tests\.json/);
  assert.match(ui, /run: npm run build:ui/);
  assert.match(ui, /name: ui-test-report-\$\{\{ matrix\.os \}\}/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
  const script = await readFile(new URL('../../scripts/ui-bench.mjs', import.meta.url), 'utf8');
  assert.match(script, /counts\.fail === 0 && counts\.skipped === 0 && counts\.todo === 0/);
  assert.match(script, /counts\.tests > 0/);
});
