import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const checker = fileURLToPath(new URL('../../scripts/check.mjs', import.meta.url));

async function fixture(t: TestContext, files: Record<string, string>) {
  const scratch = resolve(tmpdir());
  if (process.platform === 'win32') assert.match(scratch, /^C:\\/i);
  const directory = await mkdtemp(join(scratch, 'chausar-source-syntax-'));
  t.after(async () => {
    const child = relative(scratch, directory);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    await rm(directory, { recursive: true, force: true });
  });
  for (const name of ['platform', 'app', 'scripts']) await mkdir(join(directory, name));
  // Match the repository's ESM package context for Node's TypeScript parser.
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const [name, contents] of Object.entries(files)) {
    const target = join(directory, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return spawnSync(process.execPath, [checker], { cwd: directory, encoding: 'utf8', timeout: 15000, windowsHide: true });
}

test('source syntax checker admits declarations with valid runtime TypeScript and JSON', async t => {
  const result = await fixture(t, {
    'app/modules.d.ts': "declare module '*.module.css' { const classes: Readonly<Record<string, string>>; export default classes; }\n",
    'platform/runtime.ts': 'const amount: bigint = 1n;\n',
    'app/config.json': '{"fixture":"synthetic"}\n',
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Syntax and JSON validation passed for 1 source files\./);
});

test('source syntax checker still refuses invalid executable TypeScript', async t => {
  const result = await fixture(t, { 'platform/runtime.ts': 'export const amount = ;\n' });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 1); assert.match(result.stderr, /SyntaxError/);
  assert.doesNotMatch(result.stdout, /validation passed/);
});

test('source syntax checker still refuses invalid JSON', async t => {
  const result = await fixture(t, { 'app/config.json': '{"fixture":}\n' });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 1); assert.match(result.stderr, /SyntaxError/);
  assert.doesNotMatch(result.stdout, /validation passed/);
});
