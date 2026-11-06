// D11a task 1: scripts/check-boundaries.mjs. platform/shared and platform/contract import no node: module and nothing
// from platform/runtime; app/ui/src value-imports from platform/ only through platform/shared or platform/contract
// (`import type` from platform/runtime stays allowed: it is erased). The script is copied into a temp tree with one
// good and one bad file each way. The real tree is checked strictly after D11a task 2 moves the helpers.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = new URL('../../scripts/check-boundaries.mjs', import.meta.url);

async function tree(t: TestContext, files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-boundaries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries({ 'scripts/check-boundaries.mjs': await readFile(SCRIPT, 'utf8'), ...files })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return (...args: string[]) => spawnSync(process.execPath, [join(root, 'scripts', 'check-boundaries.mjs'), ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
}

const GOOD = {
  'platform/shared/money.ts': "import type { Paise } from '../contract/money.ts';\nexport const zero = 0n;\n",
  'platform/contract/money.ts': 'export type Paise = bigint;\n',
  'platform/runtime/engine.ts': "import { readFile } from 'node:fs/promises';\nexport const engine = readFile;\n",
  'app/ui/src/good.tsx': [
    "import type { Engine } from '../../../platform/runtime/engine.ts';",
    "import { type Paise, type Other } from '../../../platform/runtime/types.ts';",
    "import { zero } from '../../../platform/shared/money.ts';",
    "import { useState } from 'react';",
    "export const view = zero;",
  ].join('\n'),
};
const BAD = {
  'platform/shared/reads-disk.ts': "import { readFile } from 'node:fs/promises';\nexport const read = readFile;\n",
  'platform/contract/leans-on-runtime.ts': "import type { State } from '../runtime/contracts.ts';\nexport type Copy = State;\n",
  'app/ui/src/bad.tsx': "import { engine } from '../../../platform/runtime/engine.ts';\nexport const bad = engine;\n",
  'app/ui/src/places/multi.ts': "import {\n  engine,\n  type Other,\n} from '../../../../platform/runtime/engine.ts';\nexport * from '../../../../platform/runtime/helpers.ts';\n",
};

test('a clean tree passes', async t => {
  const run = await tree(t, GOOD);
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No boundary crossings/);
});

test('each crossing is named with its file and line, and fails', async t => {
  const run = await tree(t, { ...GOOD, ...BAD });
  const result = run();
  assert.equal(result.status, 1);
  const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('  '));
  assert.deepEqual(lines.map(line => line.trim()).sort(), [
    "app/ui/src/bad.tsx:1: the UI value-imports '../../../platform/runtime/engine.ts'; go through platform/shared or platform/contract, or import type",
    "app/ui/src/places/multi.ts:1: the UI value-imports '../../../../platform/runtime/engine.ts'; go through platform/shared or platform/contract, or import type",
    "app/ui/src/places/multi.ts:5: the UI value-imports '../../../../platform/runtime/helpers.ts'; go through platform/shared or platform/contract, or import type",
    "platform/contract/leans-on-runtime.ts:1: platform/contract imports '../runtime/contracts.ts' from platform/runtime",
    "platform/shared/reads-disk.ts:1: platform/shared imports 'node:fs/promises', a Node module",
  ]);
  assert.match(result.stdout, /5 boundary crossings/);
});

test('--report prints the same crossings and does not fail', async t => {
  const run = await tree(t, { ...GOOD, ...BAD });
  const result = run('--report');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /5 boundary crossings \(report only\)/);
  assert.equal(run('--unknown').status, 2);
});

test('the real tree has no browser boundary crossings', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(SCRIPT)], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No boundary crossings/);
});

test('the CI lint job refuses browser boundary crossings', async () => {
  const workflow = (await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(workflow, /^ {8}run: node scripts\/check-boundaries\.mjs$/m);
});


