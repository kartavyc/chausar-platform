// D2 task 12: the shape of .github/workflows/nightly.yml. Regular expressions on the YAML prove the shape only; the
// first scheduled run shows whether GitHub accepts the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = (await readFile(new URL('../../.github/workflows/nightly.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

function job(name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:$`, 'm'));
  assert.ok(start >= 0, `the ${name} job exists`);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/^ {2}[a-z][\w-]*:$|^ {2}#|^\S/m);
  return end < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + end);
}
const runs = (text: string) => [...text.matchAll(/^\s+run: (.+)$/gm)].map(match => match[1].trim());
const INSTALL = 'npm ci --ignore-scripts --no-audit --no-fund';

test('nightly runs at 02:00 IST (20:30 UTC) and by hand on any branch, read-only, with no secrets and nothing allowed to fail quietly', () => {
  const on = workflow.slice(workflow.search(/^on:$/m), workflow.search(/^permissions:$/m));
  assert.match(on, /^ {2}schedule:\n {4}- cron: '30 20 \* \* \*'$/m);
  assert.match(on, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(on, /push:|pull_request:/);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(workflow, /secrets\.|continue-on-error|npm install\b/);
  assert.match(workflow, /^concurrency:\n {2}group: nightly-\$\{\{ github\.ref \}\}$/m);
});

test('every job installs with npm ci from the lock on Node 24.13.1', () => {
  const names = [...workflow.slice(workflow.search(/^jobs:$/m)).matchAll(/^ {2}([a-z][\w-]*):$/gm)].map(match => match[1]);
  assert.deepEqual(names, ['engine', 'engine-one-worker', 'ui', 'walk', 'desktop', 'perf']);
  for (const name of names) {
    const text = job(name);
    assert.ok(runs(text).includes(INSTALL), name);
    assert.match(text, /node-version: '24\.13\.1'/, name);
  }
});

test('the engine runs every tier on both operating systems: three shards of three workers', () => {
  const engine = job('engine');
  assert.match(engine, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(engine, /shard: \[1, 2, 3\]$/m);
  assert.ok(runs(engine).includes('node scripts/bench.mjs --tier=all --shard=${{ matrix.shard }}/3 --workers=3 --output results/factory-bench.json'));
  assert.match(engine, /name: nightly-engine-\$\{\{ matrix\.os \}\}-shard-\$\{\{ matrix\.shard \}\}-of-3$/m);
});

test('on Sundays (the scheduled run, checked by IST day) the engine also runs with one worker, which catches order bugs workers hide', () => {
  const single = job('engine-one-worker');
  assert.ok(single.split('\n').includes("    if: github.event_name == 'schedule'"));
  assert.match(single, /TZ=Asia\/Kolkata date \+%u/);
  assert.match(single, /shard: \[1, 2, 3, 4, 5, 6\]$/m, 'one worker needs six shards to stay inside the bench deadline');
  const bench = /- name: .+\n {8}if: steps\.day\.outputs\.sunday == 'yes'\n {8}run: node scripts\/bench\.mjs --shard=\$\{\{ matrix\.shard \}\}\/6 --workers=1 --output results\/factory-bench\.json$/m;
  assert.match(single, bench);
});

test('the full UI suite runs on both operating systems, the screenshot walk on Ubuntu with its report kept', () => {
  const ui = job('ui');
  assert.match(ui, /os: \[ubuntu-latest, windows-latest\]/);
  assert.ok(runs(ui).includes('node scripts/ui-bench.mjs --output results/ui-tests.json'));
  const walk = job('walk');
  assert.match(walk, /runs-on: ubuntu-latest/);
  assert.ok(runs(walk).includes('node scripts/ui-shots/walk.mjs --workers=4'));
  assert.match(walk, /if: always\(\)\n\s+uses: actions\/upload-artifact@v4\n\s+with:\n\s+name: nightly-walk-report\n\s+path: \|\n\s+app\/ui\/\.shots\/report\.json\n\s+app\/ui\/\.shots\/report\.md/);
});

test('the desktop job runs the worker smoke and the preview packaging check after installing Electron itself', () => {
  assert.deepEqual(runs(job('desktop')), [
    INSTALL,
    'node scripts/desktop-smoke.mjs',
    'node node_modules/electron/install.js',
    'node scripts/desktop-package.mjs --mode preview --platform linux --arch x64 --check',
  ]);
});

test('the perf budgets job builds the UI, reads the Ubuntu engine receipts and keeps its own receipt', () => {
  const perf = job('perf');
  assert.match(perf, /^ {4}needs: engine$/m);
  assert.match(perf, /if: always\(\)/);
  assert.match(perf, /uses: actions\/download-artifact@v4\n\s+with:\n\s+pattern: nightly-engine-ubuntu-latest-shard-\*\n\s+path: results\/engine/);
  assert.deepEqual(runs(perf), [INSTALL, 'npm run build:ui', 'node scripts/perf-budgets.mjs --timings results/engine --output results/perf-budgets.json']);
  assert.match(perf, /name: nightly-perf-budgets\n\s+path: results\/perf-budgets\.json/);
});
