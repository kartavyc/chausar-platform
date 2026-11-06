// D11a task 11: `npm run near` picks the engine and UI test files that reach a changed file through imports (and through
// `new URL('<relative>', import.meta.url)`, how tests read scripts), then runs them. A fixture graph checks the pick;
// one --list run on this checkout checks the command, and runs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importsOf, nearTests } from '../../scripts/near.mjs';

const GRAPH: Record<string, string> = {
  'platform/runtime/leaf.ts': 'export const leaf = 1;\n',
  'platform/runtime/mid.ts': "import { leaf } from './leaf.ts';\nexport const mid = leaf;\n",
  'platform/runtime/loop-a.ts': "import './loop-b.ts';\nimport { leaf } from './leaf.ts';\n",
  'platform/runtime/loop-b.ts': "export * from './loop-a.ts';\n",
  'platform/runtime/other.ts': "import { readFile } from 'node:fs/promises';\nexport const other = readFile;\n",
  'platform/tests/leaf.test.ts': "import test from 'node:test';\nimport { mid } from '../runtime/mid.ts';\n",
  'platform/tests/loop.test.ts': "const lazy = await import('../runtime/loop-b.ts');\n",
  'platform/tests/other.test.ts': "import type { other } from '../runtime/other.ts';\n",
  'platform/tests/reads.test.ts': "const script = new URL('../../scripts/tool.mjs', import.meta.url);\n",
  'platform/tests/helpers/shared.ts': "export { leaf } from '../../runtime/leaf.ts';\n",
  'scripts/tool.mjs': "export default 1;\n",
  'app/ui/src/view.tsx': "import type { leaf } from '../../../platform/runtime/leaf.ts';\nexport const View = () => null;\n",
  'app/ui/tests/view.test.tsx': "import { View } from '../src/view.tsx';\n",
  'app/ui/tests/places/deep.test.ts': "import { View } from '../../src/view';\n",
  'app/ui/tests/unrelated.test.ts': "import { describe } from 'vitest';\n",
};
const files = Object.keys(GRAPH);
const read = (file: string) => GRAPH[file];

test('importsOf reads static, type, re-export, side-effect and dynamic imports, and new URL reads', () => {
  assert.deepEqual(importsOf("import a from './a.ts';\nimport type { B } from \"../b.ts\";\nexport * from './c.ts';\nimport './d.css';\nconst e = await import('./e.ts');\nconst f = new URL('../f.mjs', import.meta.url);\nimport x from 'node:fs';"),
    ['./a.ts', '../b.ts', './c.ts', './d.css', './e.ts', '../f.mjs', 'node:fs']);
});

test('a change to a leaf picks exactly the tests that reach it, engine and UI, through cycles too', () => {
  assert.deepEqual(nearTests({ changed: ['platform/runtime/leaf.ts'], files, read }), {
    engine: ['platform/tests/leaf.test.ts', 'platform/tests/loop.test.ts'],
    ui: ['app/ui/tests/places/deep.test.ts', 'app/ui/tests/view.test.tsx'],
  });
});

test('a script read through new URL picks its test; a changed test picks itself; an unrelated change picks nothing', () => {
  assert.deepEqual(nearTests({ changed: ['scripts/tool.mjs'], files, read }), { engine: ['platform/tests/reads.test.ts'], ui: [] });
  assert.deepEqual(nearTests({ changed: ['platform/tests/other.test.ts', 'app/ui/tests/unrelated.test.ts'], files, read }), { engine: ['platform/tests/other.test.ts'], ui: ['app/ui/tests/unrelated.test.ts'] });
  assert.deepEqual(nearTests({ changed: ['README.md', 'platform/runtime/gone.ts'], files, read }), { engine: [], ui: [] });
});

test('helpers under platform/tests/ are not test files, and only top-level engine tests run (as bench.mjs discovers them)', () => {
  const picked = nearTests({ changed: ['platform/runtime/leaf.ts'], files, read });
  assert.equal(picked.engine.includes('platform/tests/helpers/shared.ts'), false);
});

test('--list on this checkout prints the tests near a named change and runs nothing', () => {
  const script = fileURLToPath(new URL('../../scripts/near.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--list', '--changed=scripts/receipt.mjs'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  const listed = JSON.parse(result.stdout);
  assert.ok(listed.engine.includes('platform/tests/receipt-d11.test.ts'), result.stdout);
  assert.ok(listed.engine.includes('platform/tests/benchmark-sharding.test.ts'), 'reads bench.mjs, which imports receipt.mjs');
  assert.deepEqual(listed.ui, []);
});


test('cleanup: option-shaped base names are refused before git runs', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = await mkdtemp(join(tmpdir(), 'chausar-near-options-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../../scripts/near.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--list', `--base=--output=${join(folder, 'probe')}`], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /base must be a revision name/);
});
