// D1: scripts/check.mjs checks the whole tree in one process (no node --check per file).
// Each case copies the script into a small temp repo and runs it there, as CI runs it at the repo root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check.mjs', import.meta.url));

// Files the check must accept. The first is the old trap: a .ts whose first statement is a bare type alias.
const GOOD: Record<string, string> = {
  'package.json': '{"type":"module"}\n',
  'platform/type-first.ts': "type Row = { a: string };\nconst row: Row = { a: 'x' };\nexport { row };\n",
  'platform/plain.ts': "import { join } from 'node:path';\nexport const where: string = join('a', 'b');\n",
  // Declaration files are left to tsc (npm run typecheck reads them): `export const X: T;` there is not runnable code.
  'platform/ambient.d.ts': 'declare const marker: number;\nexport const LIST: readonly string[];\nexport type Shape = { x: number };\n',
  'platform/tool.mjs': "import { join } from 'node:path';\nexport default join('a');\nawait Promise.resolve();\n",
  'platform/shell.cjs': "const path = require('node:path');\nmodule.exports = path.join('a');\nreturn;\n",
  'platform/shape.d.cts': "import { EventEmitter } from 'node:events';\nexport declare function make(): EventEmitter;\n",
  'platform/typed.cts': "const count: number = 1;\nmodule.exports = count;\n",
  'scripts/typed.mts': "export const name: string = 'x';\n",
  'scripts/run.mjs': "#!/usr/bin/env node\nconsole.log(import.meta.url);\n",
  'app/esm.js': "import { join } from 'node:path';\nexport const where = join('a');\n",
  'app/legacy/package.json': '{"type":"commonjs"}\n',
  'app/legacy/old.js': "module.exports = require('node:path').join('a');\n",
  // The Vite project compiles its TypeScript, so a parameter property there is fine (D1: the UI keeps its own rule).
  'app/ui/src/fake.ts': 'export class Fake {\n  constructor(private readonly host: string) {}\n  get name(): string { return this.host; }\n}\n',
  'app/data.json': '{"a": 1}\n',
  // Skipped folders: broken on purpose, never read.
  'platform/node_modules/broken.ts': 'const = ;\n',
  'platform/dist/broken.mjs': 'export const = ;\n',
  'app/release/broken.cjs': 'module.exports = ;\n',
  'scripts/data/broken.json': '{ nope\n',
  'platform/vaults/broken.ts': 'enum Kind { A }\n',
};

// Each bad file must fail the check alone, naming the file.
const BAD: Record<string, string> = {
  'platform/bad-syntax.ts': "export const value: number = ;\n",
  'platform/bad-enum.ts': 'export enum Kind { A }\n',
  'platform/bad-property.ts': 'export class Holder {\n  constructor(private x: number) {}\n}\n',
  'scripts/bad.mjs': "export const = 1;\n",
  'app/bad.cjs': 'module.exports = {;\n',
  'app/legacy/bad-import.js': "import { join } from 'node:path';\nmodule.exports = join;\n",
  'app/bad.json': '{ "a": 1,, }\n',
};

async function repo(t: any, extra: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'chausar-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries({ ...GOOD, ...extra })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  await mkdir(join(root, 'scripts'), { recursive: true });
  await copyFile(script, join(root, 'scripts/check.mjs'));
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: root, encoding: 'utf8' });
}

test('the good tree passes, including a .ts that opens with a type alias, and the skipped folders are never read', async t => {
  const root = await repo(t);
  const result = run(root);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  // 10 runnable sources from GOOD (declaration files are not counted) plus the copied check.mjs itself.
  assert.match(result.stdout, /passed for 11 source files/);
  assert.equal(result.stderr, '', 'no experimental warnings or other noise');
});

for (const [path, text] of Object.entries(BAD)) {
  test(`a bad file fails the check alone and is named: ${path}`, async t => {
    const root = await repo(t, { [path]: text });
    const result = run(root);
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.ok(result.stderr.replaceAll('\\', '/').includes(path), result.stderr);
  });
}

test('the script parses in process: no spawnSync and at most one spawn (its own start with the vm modules flag)', async () => {
  const source = await readFile(script, 'utf8');
  assert.doesNotMatch(source, /spawnSync\(/);
  assert.ok((source.match(/\bspawn\(/g) ?? []).length <= 1);
});

// The .ts cases are left out of the parity loop on purpose: on Node 24.13.1, node --check exits 0 for a .ts that opens
// with an import or export even when it holds a syntax error or an enum, so the old check never parsed those files.
test('parity with node --check: the bad JavaScript files fail there too, and the type-first file was the old false failure', async t => {
  const root = await repo(t, BAD);
  for (const path of ['scripts/bad.mjs', 'app/bad.cjs', 'app/legacy/bad-import.js']) {
    const result = spawnSync(process.execPath, ['--check', join(root, path)], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, path);
  }
  // node --check only strips types when the first statement is an import or export; the new check does not care.
  const old = spawnSync(process.execPath, ['--check', join(root, 'platform/type-first.ts')], { encoding: 'utf8' });
  assert.notEqual(old.status, 0, 'node --check refuses a .ts that opens with a type alias');
});
